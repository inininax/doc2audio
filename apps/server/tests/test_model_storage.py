"""Model removal uses tiny owned fixtures; real user model files are never mutated."""

import copy
import gc
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from huggingface_hub._local_folder import get_local_download_paths

from doc2audio.catalog import CATALOG, get_model, model_path
from doc2audio.model_lock import ModelBusyError, lock_path, model_instance_lock, model_lock
from doc2audio_server.app import create_app

HEADERS = {"X-Doc2Audio": "1"}
MODEL = "supertonic-3"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DOC2AUDIO_MODELS_DIR", str(tmp_path / "models"))
    specs = copy.deepcopy(CATALOG["models"])
    for spec in specs:
        spec["files"] = {"config.json": 4, "onnx/model.onnx": 4}
        spec["size_bytes"] = 8
    monkeypatch.setitem(CATALOG, "models", specs)
    monkeypatch.setattr("doc2audio_server.app.shutil.which", lambda _: "/test/ffmpeg")
    with TestClient(create_app(tmp_path / "data", start_worker=False)) as result:
        yield result


def install(model_id=MODEL):
    path = model_path(model_id)
    for name in get_model(model_id)["files"]:
        target = path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"data")
    return path


def info(client, model_id=MODEL):
    return next(
        item for item in client.get("/api/models").json()["items"] if item["id"] == model_id
    )


def remove(client, model_id=MODEL):
    return client.post(f"/api/models/{model_id}/delete", headers=HEADERS)


def submit(client):
    return client.post(
        "/api/jobs", data={"model_id": MODEL, "text": "테스트 본문"}, headers=HEADERS
    )


def test_uninstalled_storage_is_read_only_and_delete_is_idempotent(client, tmp_path):
    storage = info(client)["storage"]
    assert storage == {
        "kind": "filesystem",
        "location": str(model_path(MODEL)),
        "used_bytes": 0,
        "has_data": False,
        "can_delete": False,
    }
    assert not (tmp_path / "models").exists()
    assert remove(client).json() == {"deleted": True, "freed_bytes": 0}
    assert not (tmp_path / "models").exists()
    assert remove(client, "unknown").status_code == 422
    assert not (tmp_path / "models").exists()


def test_delete_removes_full_partial_and_cache_but_preserves_jobs_audio_and_other_models(client):
    path = install()
    other = install("qwen3-0.6b")
    cache = get_local_download_paths(path, "onnx/model.onnx")
    cache.incomplete_path("a" * 64).write_bytes(b"partial data")
    cache.metadata_path.write_text("synthetic metadata")
    cache.lock_path.touch()
    job = submit(client).json()
    store = client.app.state.store
    store.update(job["id"], status="completed")
    audio = store.root / "jobs" / job["id"] / "audio.mp3"
    audio.write_bytes(b"synthetic test artifact")
    before = store.get(job["id"])
    original = Path(before["source"]).read_bytes()
    expected = sum(p.stat().st_size for p in path.rglob("*") if p.is_file())
    assert info(client)["storage"] == {
        "kind": "filesystem",
        "location": str(path),
        "used_bytes": expected,
        "has_data": True,
        "can_delete": True,
    }
    assert remove(client).json() == {"deleted": True, "freed_bytes": expected}
    assert not path.exists()
    assert lock_path(path).is_file(), "Deleting a lock inode would allow concurrent leases"
    assert (other / "config.json").read_bytes() == b"data"
    assert Path(before["source"]).read_bytes() == original
    assert audio.read_bytes() == b"synthetic test artifact"
    assert store.get(job["id"]) == before
    assert not info(client)["installed"]
    assert not info(client)["storage"]["has_data"]


def test_partial_download_can_be_deleted_without_installation(client):
    path = model_path(MODEL)
    cached = get_local_download_paths(path, "config.json")
    cached.incomplete_path("b" * 40).write_bytes(b"partial")
    assert not info(client)["installed"]
    assert info(client)["storage"]["can_delete"]
    assert remove(client).status_code == 200
    assert not path.exists()


@pytest.mark.parametrize("status", ["queued", "running", "cancelling"])
@pytest.mark.parametrize("kind", ["download", "conversion"])
def test_active_model_jobs_block_deletion(client, status, kind):
    path = install()
    store = client.app.state.store
    job = store.create(kind=kind, model_id=MODEL, title="active")
    store.update(job["id"], status=status)
    assert remove(client).status_code == 409
    assert (path / "config.json").read_bytes() == b"data"
    storage = info(client)["storage"]
    assert not storage["can_delete"] and "작업" in storage["delete_blocked_reason"]


def test_other_model_jobs_do_not_block_removal(client):
    install()
    client.app.state.store.create(kind="download", model_id="qwen3-0.6b", title="other")
    assert remove(client).status_code == 200


@pytest.mark.parametrize("kind", ["model", "nested", "broken", "cycle"])
def test_symlinks_never_delete_external_files(client, tmp_path, kind):
    outside = tmp_path / "outside"
    outside.mkdir()
    survivor = outside / "document.txt"
    survivor.write_text("preserve original")
    path = model_path(MODEL)
    path.parent.mkdir(parents=True)
    if kind == "model":
        path.symlink_to(outside, target_is_directory=True)
    elif kind == "broken":
        path.symlink_to(tmp_path / "missing", target_is_directory=True)
    elif kind == "cycle":
        path.symlink_to(path, target_is_directory=True)
    else:
        path.mkdir()
        (path / "onnx").symlink_to(outside, target_is_directory=True)
    assert not info(client)["storage"]["can_delete"]
    assert remove(client).status_code == 409
    assert survivor.read_text() == "preserve original"


def test_unknown_user_files_block_all_removal(client):
    path = install()
    document = path / "original.txt"
    document.write_text("my document")
    assert not info(client)["storage"]["can_delete"]
    assert remove(client).status_code == 409
    assert document.read_text() == "my document"
    assert (path / "config.json").read_bytes() == b"data"


def test_shared_data_root_is_protected(tmp_path, monkeypatch):
    monkeypatch.setenv("DOC2AUDIO_MODELS_DIR", str(tmp_path))
    with TestClient(create_app(tmp_path / MODEL, start_worker=False)) as client:
        assert not info(client)["storage"]["can_delete"]
        assert remove(client).status_code == 409
        assert client.app.state.store.path.is_file()


@pytest.mark.parametrize("operation", ["submit", "retry", "download"])
def test_delete_transaction_serializes_registration_and_retry(client, monkeypatch, operation):
    install()
    store = client.app.state.store
    if operation == "retry":
        job = submit(client).json()
        store.update(job["id"], status="failed")
    import doc2audio_server.app as app_module

    original_remove = app_module.remove_model_files
    removing, release, registering = threading.Event(), threading.Event(), threading.Event()

    def held_delete(*args):
        removing.set()
        assert release.wait(5)
        return original_remove(*args)

    method = "update" if operation == "retry" else "create"
    original_register = getattr(store, method)

    def register(*args, **kwargs):
        registering.set()
        return original_register(*args, **kwargs)

    monkeypatch.setattr(app_module, "remove_model_files", held_delete)
    monkeypatch.setattr(store, method, register)
    with ThreadPoolExecutor(max_workers=2) as pool:
        deletion = pool.submit(remove, client)
        try:
            assert removing.wait(3)
            if operation == "submit":
                mutation = pool.submit(submit, client)
            else:
                url = (
                    f"/api/jobs/{job['id']}/retry"
                    if operation == "retry"
                    else f"/api/models/{MODEL}/download"
                )
                mutation = pool.submit(client.post, url, headers=HEADERS)
            assert registering.wait(3)
            assert not mutation.done()
        finally:
            release.set()
        assert deletion.result(3).status_code == 200
        response = mutation.result(3)
        assert response.status_code == (202 if operation == "download" else 409)
    if operation == "submit":
        assert store.list() == []
        assert list((store.root / "jobs").iterdir()) == []
    elif operation == "retry":
        assert store.get(job["id"])["status"] == "failed"


def test_process_model_lease_blocks_delete_for_explicit_and_canonical_paths(client, tmp_path):
    path = install()
    alias = tmp_path / "model-alias"
    alias.symlink_to(path, target_is_directory=True)
    script = (
        "from pathlib import Path; from doc2audio.model_lock import acquire_model_lock; "
        "import sys; lease=acquire_model_lock(Path(sys.argv[1])); "
        "print('ready',flush=True); sys.stdin.readline(); lease.close()"
    )
    with subprocess.Popen(
        [sys.executable, "-c", script, str(alias)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    ) as child:
        try:
            assert child.stdout.readline().strip() == "ready"
            assert not info(client)["storage"]["can_delete"]
            assert remove(client).status_code == 409
            assert (path / "config.json").read_bytes() == b"data"
        finally:
            child.communicate("\n", timeout=5)
    assert remove(client).status_code == 200


def test_exclusive_delete_lease_blocks_nested_install_or_narrator_load(client):
    path = install()
    with model_lock(path, exclusive=True):
        with pytest.raises(ModelBusyError):
            with model_lock(path):
                pytest.fail("An exclusive removal lease must exclude model loading")


def test_installer_lease_before_model_folder_creation_blocks_delete(client):
    path = model_path(MODEL)
    with model_lock(path):
        assert not path.exists()
        storage = info(client)["storage"]
        assert not storage["has_data"] and not storage["can_delete"]
        assert "진행 중" in storage["delete_blocked_reason"]
        assert remove(client).status_code == 409
    assert remove(client).json() == {"deleted": True, "freed_bytes": 0}
    assert not path.exists()


def test_narrator_retains_lease_until_released_and_nested_shared_leases_work(tmp_path):
    class Narrator:
        @model_instance_lock
        def __init__(self, path):
            with model_lock(path):
                pass

    path = tmp_path / "model"
    narrator = Narrator(path)
    with pytest.raises(ModelBusyError):
        with model_lock(path, exclusive=True):
            pytest.fail("A live narrator still owns its model files")
    del narrator
    gc.collect()
    with model_lock(path, exclusive=True):
        pass
