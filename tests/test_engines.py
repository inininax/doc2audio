from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from doc2audio.catalog import validate_options
from doc2audio.engines import SupertonicNarrator, create_narrator, install_model
from doc2audio.errors import Doc2AudioError


@pytest.mark.parametrize(
    "text",
    [
        "안녕하세요.",
        ("한국어 문장은 끝까지 보존되어야 합니다. " * 20) + "마지막 문장입니다.",
    ],
)
def test_supertonic_long_text_retains_last_chunk_before_padding(text):
    narrator = SupertonicNarrator.__new__(SupertonicNarrator)
    narrator.options = validate_options("supertonic-3", {})
    narrator.style = object()
    calls = []

    def synthesize(text, **options):
        calls.append(text)
        assert options["max_chunk_length"] > len(text)
        assert options["max_chunk_length"] >= 10
        # Different speech values expose cutting a later segment by earlier padding.
        wav = np.r_[np.full(2400, len(calls) / 10, dtype=np.float32), np.zeros(600)]
        return wav[None, :], np.array([0.1])

    narrator.model = SimpleNamespace(sample_rate=24000, synthesize=synthesize)
    audio, rate = narrator.generate(text, 42)
    assert len(calls) >= 1
    assert "".join(calls).replace(" ", "") == text.replace(" ", "")
    assert all(len(part) <= 120 for part in calls)
    assert len(audio) == len(calls) * 2400 + (len(calls) - 1) * 7200
    np.testing.assert_allclose(audio[-2400:], len(calls) / 10)
    assert rate == 24000


def test_explicit_home_model_path_is_normalized(tmp_path, monkeypatch):
    # Patch expansion directly without repurposing the user's HOME environment.
    expected = tmp_path / "models"
    original = Path.expanduser
    monkeypatch.setattr(
        Path, "expanduser", lambda path: expected if str(path) == "~/models" else original(path)
    )
    checked = []
    monkeypatch.setattr(
        "doc2audio.engines.missing_files", lambda model_id, path: checked.append(path) or []
    )
    monkeypatch.setattr("doc2audio.engines.SupertonicNarrator", lambda path, options: path)
    assert install_model("supertonic-3", path=Path("~/models")) == expected
    assert create_narrator("supertonic-3", {}, path=Path("~/models")) == expected
    assert checked and all(path == expected for path in checked)


def test_damaged_model_bypasses_hf_cache_but_new_download_can_resume(tmp_path, monkeypatch):
    from huggingface_hub._local_folder import write_download_metadata

    from doc2audio.catalog import CATALOG, get_model, missing_files

    payloads = {"config.json": b"valid config", "new-file.json": b"new file"}
    spec = {
        **get_model("supertonic-3"),
        "files": {name: len(data) for name, data in payloads.items()},
        "size_bytes": sum(map(len, payloads.values())),
    }
    monkeypatch.setitem(CATALOG, "models", [spec])
    damaged = tmp_path / "config.json"
    damaged.write_bytes(b"bad")
    write_download_metadata(
        local_dir=tmp_path,
        filename=damaged.name,
        commit_hash=spec["revision"],
        etag="test-etag",
    )

    # Exercise the real HF local-file/cache logic, replacing only network I/O.
    def remote_metadata(**kwargs):
        filename = kwargs["filename"]
        return (
            "https://example.invalid/" + filename,
            "test-etag",
            spec["revision"],
            len(payloads[filename]),
            None,
            None,
        )

    downloads = {}

    def transfer(**kwargs):
        destination = kwargs["destination_path"]
        downloads[destination.name] = kwargs["force_download"]
        destination.write_bytes(payloads[destination.name])

    monkeypatch.setattr(
        "huggingface_hub.file_download._get_metadata_or_catch_error", remote_metadata
    )
    monkeypatch.setattr("huggingface_hub.file_download.try_to_load_from_cache", lambda **_: None)
    monkeypatch.setattr("huggingface_hub.file_download._download_to_tmp_and_move", transfer)
    assert install_model("supertonic-3", path=tmp_path) == tmp_path
    assert missing_files("supertonic-3", tmp_path) == []
    assert downloads == {"config.json": True, "new-file.json": False}


@pytest.mark.parametrize("duration", [1.0, 0.000001, float("inf"), float("nan"), -1.0])
def test_supertonic_rejects_incomplete_or_invalid_model_duration(duration):
    narrator = SupertonicNarrator.__new__(SupertonicNarrator)
    narrator.options = validate_options("supertonic-3", {})
    narrator.style = object()
    narrator.model = SimpleNamespace(
        sample_rate=24000,
        synthesize=lambda *args, **kwargs: (
            np.full((1, 2400), 0.1, dtype=np.float32),
            np.array([duration]),
        ),
    )
    with pytest.raises(Doc2AudioError):
        narrator.generate("본문의 끝까지 생성되어야 합니다.", 42)


def test_supertonic_preserves_valid_tail_with_float32_duration_rounding():
    narrator = SupertonicNarrator.__new__(SupertonicNarrator)
    narrator.options = validate_options("supertonic-3", {})
    narrator.style = object()
    waveform = np.full((1, 2400), 0.1, dtype=np.float32)
    waveform[0, -1] = 0.7
    # The duration may round up across a single output-sample boundary.
    duration = np.nextafter(np.float32(2401 / 24000), np.float32(np.inf))
    narrator.model = SimpleNamespace(
        sample_rate=24000,
        synthesize=lambda *args, **kwargs: (waveform, np.array([duration])),
    )
    audio, rate = narrator.generate("마지막 음성을 보존합니다.", 42)
    assert rate == 24000
    np.testing.assert_array_equal(audio, waveform[0])


@pytest.mark.parametrize("installed", [True, False])
def test_disk_reserve_is_only_required_for_files_to_download(tmp_path, monkeypatch, installed):
    from doc2audio.catalog import CATALOG, get_model

    spec = {**get_model("supertonic-3"), "files": {"config.json": 4}, "size_bytes": 4}
    monkeypatch.setitem(CATALOG, "models", [spec])
    if installed:
        (tmp_path / "config.json").write_bytes(b"data")
    monkeypatch.setattr(
        "doc2audio.engines.shutil.disk_usage", lambda _: SimpleNamespace(free=128 * 1024**2)
    )

    def unexpected_download(*args, **kwargs):
        pytest.fail("No model download should start in either case")

    monkeypatch.setattr("huggingface_hub.hf_hub_download", unexpected_download)
    if installed:
        assert install_model("supertonic-3", path=tmp_path) == tmp_path
    else:
        with pytest.raises(Doc2AudioError, match="공간"):
            install_model("supertonic-3", path=tmp_path)
