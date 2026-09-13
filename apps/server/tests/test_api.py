import json
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from doc2audio.catalog import option_schema, validate_options
from doc2audio.errors import Doc2AudioError
from doc2audio_server.app import create_app
from doc2audio_server.runner import Runner
from doc2audio_server.store import Store
from doc2audio_server.worker import execute

HEADERS = {"X-Doc2Audio": "1"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr("doc2audio_server.app.missing_files", lambda _: [])
    monkeypatch.setattr("doc2audio_server.app.shutil.which", lambda _: "/test/ffmpeg")
    with TestClient(create_app(tmp_path, start_worker=False)) as client:
        yield client


def submit(client, **overrides):
    data = {"model_id": "supertonic-3", "text": "안녕하세요. 영구 작업 기록 테스트입니다."}
    data.update(overrides)
    return client.post("/api/jobs", data=data, headers=HEADERS)


def test_job_survives_new_client_and_database_reopen(client, tmp_path):
    created = submit(client, title="기록 검증", options=json.dumps({"speaker": "M2", "speed": 1.2}))
    assert created.status_code == 202
    job = created.json()
    assert job["status"] == "queued"
    assert job["options"]["voice"]["speaker"] == "M2"
    assert "source" not in job
    assert (tmp_path / "jobs" / job["id"] / "source.txt").read_text().startswith("안녕하세요")
    with TestClient(create_app(tmp_path, start_worker=False)) as reopened:
        restored = reopened.get(f"/api/jobs/{job['id']}").json()
        assert restored["id"] == job["id"]
        assert restored["options"]["voice"]["speed"] == 1.2
        assert reopened.get("/api/jobs").json()["total"] == 1


def test_job_registration_does_not_lose_source_on_post_commit_read_failure(
    client, tmp_path, monkeypatch
):
    def unavailable(job_id):
        raise sqlite3.OperationalError("Injected post-commit read failure")

    store = client.app.state.store
    with monkeypatch.context() as patch:
        patch.setattr(store, "get", unavailable)
        response = submit(client)
    assert response.status_code == 202
    job = store.get(response.json()["id"])
    assert job["status"] == "queued"
    assert Path(job["source"]).read_text() == "안녕하세요. 영구 작업 기록 테스트입니다."


def test_job_registration_rolls_back_if_response_decoding_fails(client, tmp_path, monkeypatch):
    def fail(row):
        raise ValueError("Injected job decoding failure")

    store = client.app.state.store
    with monkeypatch.context() as patch:
        patch.setattr(store, "decode", fail)
        with pytest.raises(ValueError, match="Injected job decoding failure"):
            submit(client)
    assert store.list() == []
    assert not list((tmp_path / "jobs").iterdir())


def test_cancel_retry_and_completion_guards(client):
    job = submit(client).json()
    route = f"/api/jobs/{job['id']}"
    assert client.get(route + "/audio").status_code == 409
    assert client.post(route + "/retry", headers=HEADERS).status_code == 409
    assert client.post(route + "/cancel", headers=HEADERS).json()["status"] == "cancelled"
    retry = client.post(route + "/retry", headers=HEADERS).json()
    assert retry["status"] == "queued" and retry["attempt"] == 2
    assert len(client.get(route).json()["events"]) == 2


def test_untrusted_write_requests_cannot_enqueue(client):
    assert client.post("/api/models/supertonic-3/download").status_code == 403
    assert (
        client.post(
            "/api/models/supertonic-3/download",
            headers={**HEADERS, "Origin": "https://evil.example"},
        ).status_code
        == 403
    )
    assert client.get("/api/jobs", headers={"Host": "evil.example"}).status_code == 400
    assert client.get("/api/jobs").json()["total"] == 0


def test_model_capabilities_reject_unsupported_and_invalid_options(client):
    assert submit(client, options='{"instruct":"지원하지 않는 말투"}').status_code == 422
    assert submit(client, options='{"total_steps":0}').status_code == 422
    assert submit(client, options='{"speed":null}').status_code == 422
    assert submit(client, options="[]").status_code == 422
    assert submit(client, options="broken").status_code == 422
    assert submit(client, model_id="unknown").status_code == 422
    assert client.get("/api/jobs").json()["total"] == 0


def test_invalid_input_is_rejected_and_uploaded_name_cannot_escape(client, tmp_path):
    assert submit(client, text="").status_code == 422
    assert (
        client.post(
            "/api/jobs",
            data={"model_id": "supertonic-3"},
            files={"file": ("x.exe", b"x")},
            headers=HEADERS,
        ).status_code
        == 422
    )
    response = client.post(
        "/api/jobs",
        data={"model_id": "supertonic-3"},
        files={"file": ("../../unsafe.txt", "문서 본문".encode())},
        headers=HEADERS,
    )
    assert response.status_code == 202
    job = response.json()
    assert job["title"] == "unsafe.txt"
    assert (tmp_path / "jobs" / job["id"] / "source.txt").read_text() == "문서 본문"
    assert len(list((tmp_path / "jobs").iterdir())) == 1


def test_missing_model_fails_before_job_registration(client, monkeypatch):
    monkeypatch.setattr("doc2audio_server.app.missing_files", lambda _: ["model.onnx"])
    assert submit(client).status_code == 409
    assert client.get("/api/jobs").json()["total"] == 0


def test_download_deduplication_is_atomic(tmp_path):
    store = Store(tmp_path)

    def create(_):
        return store.create(kind="download", model_id="supertonic-3", title="설치")["id"]

    with ThreadPoolExecutor(max_workers=6) as pool:
        ids = list(pool.map(create, range(12)))
    assert len(set(ids)) == 1
    assert len(store.list()) == 1


def test_recovery_preserves_terminal_and_queued_jobs(tmp_path):
    store = Store(tmp_path)
    jobs = [
        store.create(kind="conversion", model_id="supertonic-3", title=str(i)) for i in range(4)
    ]
    store.update(jobs[0]["id"], status="running", progress=0.4)
    store.update(jobs[1]["id"], status="completed", progress=1)
    store.update(jobs[2]["id"], status="failed", error="실제 오류")
    store.recover()
    assert store.get(jobs[0]["id"])["status"] == "interrupted"
    assert store.get(jobs[0]["id"])["progress"] == 0.4
    assert [store.get(j["id"])["status"] for j in jobs[1:]] == ["completed", "failed", "queued"]


def test_second_runner_cannot_recover_live_work(tmp_path):
    store = Store(tmp_path)
    first = Runner(store)
    first.start()
    try:
        with pytest.raises(RuntimeError, match="이미 실행"):
            Runner(Store(tmp_path)).start()
    finally:
        first.close()


def test_runner_directory_failure_fails_job_and_continues_queue(tmp_path, monkeypatch):
    store = Store(tmp_path)
    first = store.create(kind="download", model_id="supertonic-3", title="저장 실패")
    second = store.create(kind="download", model_id="qwen3-0.6b", title="후속 작업")
    original_mkdir = Path.mkdir
    second_started = threading.Event()

    def mkdir(path, *args, **kwargs):
        if path == store.root / "jobs" / first["id"]:
            raise OSError(28, "No space left on device")
        return original_mkdir(path, *args, **kwargs)

    class CompletedProcess:
        returncode = 0

        def poll(self):
            return self.returncode

    def start_process(command, **kwargs):
        assert command[-1] == second["id"]
        store.update(second["id"], expected=["running"], status="completed")
        second_started.set()
        return CompletedProcess()

    monkeypatch.setattr(Path, "mkdir", mkdir)
    monkeypatch.setattr("doc2audio_server.runner.subprocess.Popen", start_process)
    runner = Runner(store)
    runner.start()
    try:
        assert second_started.wait(timeout=3), "폴더 생성 실패로 대기열이 멈췄습니다."
        failed = store.get(first["id"])
        assert failed["status"] == "failed"
        assert "No space left on device" in failed["error"]
        assert store.get(second["id"])["status"] == "completed"
        assert runner.thread.is_alive()
    finally:
        runner.close()


def test_worker_persists_failure_without_fake_success(tmp_path, monkeypatch):
    store = Store(tmp_path)
    job = store.create(
        kind="conversion",
        model_id="supertonic-3",
        title="실패 검증",
        source="missing.txt",
        options={"voice": {}},
    )
    store.claim()

    def fail(*args, **kwargs):
        kwargs["progress"]("[1/2] 완료 · 음성 1.0초")
        raise Doc2AudioError("실제 생성 실패")

    monkeypatch.setattr("doc2audio_server.worker.convert_document", fail)
    with pytest.raises(Doc2AudioError, match="실제 생성 실패"):
        execute(store, job["id"])
    restored = store.get(job["id"])
    assert restored["status"] == "failed"
    assert restored["result"] is None
    assert restored["progress"] == 0.475
    assert restored["error"] == "실제 생성 실패"


def test_model_specific_defaults_and_nonfinite_values():
    assert validate_options("supertonic-3", {})["speaker"] == "F1"
    assert validate_options("qwen3-1.7b", {})["speaker"] == "Sohee"
    assert "instruct" not in {o["key"] for o in option_schema("qwen3-0.6b")}
    for value in [float("nan"), float("inf"), True, None, "1"]:
        with pytest.raises(Doc2AudioError):
            validate_options("supertonic-3", {"speed": value})


def test_multipart_accepts_one_million_korean_characters(client, tmp_path):
    text = "가" * 1_000_000
    response = client.post(
        "/api/jobs",
        headers=HEADERS,
        files={"model_id": (None, "supertonic-3"), "text": (None, text)},
    )
    assert response.status_code == 202, response.text
    source = tmp_path / "jobs" / response.json()["id"] / "source.txt"
    assert source.read_text(encoding="utf-8") == text
    too_long = client.post(
        "/api/jobs",
        headers=HEADERS,
        files={"model_id": (None, "supertonic-3"), "text": (None, text + "가")},
    )
    assert too_long.status_code == 413
    assert client.get("/api/jobs").json()["total"] == 1


def test_store_expands_explicit_home_path(tmp_path, monkeypatch):
    from pathlib import Path

    expected = tmp_path / "custom-data"
    original = Path.expanduser
    monkeypatch.setattr(
        Path,
        "expanduser",
        lambda path: expected if str(path) == "~/custom-data" else original(path),
    )
    store = Store(Path("~/custom-data"))
    assert store.root == expected
    assert store.path.is_file()
