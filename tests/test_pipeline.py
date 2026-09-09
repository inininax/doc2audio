import json
import shutil
import subprocess

import numpy as np
import pytest

from doc2audio.audio import prepare_audio
from doc2audio.cli import main
from doc2audio.errors import Doc2AudioError
from doc2audio.pipeline import Options, convert_document, job_lock


class SyntheticNarrator:
    """Deterministic test tone only; never used by the production CLI."""

    def __init__(self, fail_on=None):
        self.calls = []
        self.fail_on = fail_on

    def generate(self, text, seed):
        self.calls.append((text, seed))
        if len(self.calls) == self.fail_on:
            raise Doc2AudioError("test interruption")
        return (0.1 * np.sin(np.arange(2400) * 2 * np.pi * 440 / 24000)).astype(np.float32), 24000


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg required")
def test_resume_after_failure_and_corrupt_chunk_regeneration(tmp_path):
    source = tmp_path / "source.txt"
    source.write_text("첫 단락입니다.\n\n둘째 단락입니다.\n\n마지막 단락입니다.", encoding="utf-8")
    output = tmp_path / "책 ' 한글.mp3"
    interrupted = SyntheticNarrator(fail_on=2)
    with pytest.raises(Doc2AudioError, match="interruption"):
        convert_document(
            source, output, narrator_factory=lambda: interrupted, progress=lambda _: None
        )
    assert not output.exists()
    resumed = SyntheticNarrator()
    result = convert_document(
        source, output, narrator_factory=lambda: resumed, progress=lambda _: None
    )
    assert result["reused_chunks"] == 1
    assert len(resumed.calls) == 2
    assert resumed.calls[-1][0] == "마지막 단락입니다."
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=codec_name,sample_rate,channels",
            "-of",
            "json",
            str(output),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    stream = json.loads(probe.stdout)["streams"][0]
    assert stream == {"codec_name": "mp3", "sample_rate": "24000", "channels": 1}
    original = output.read_bytes()
    with pytest.raises(Doc2AudioError, match="이미"):
        convert_document(source, output)
    assert output.read_bytes() == original
    next(tmp_path.glob(".doc2audio/*/00001.wav")).write_bytes(b"corrupt")
    repaired = SyntheticNarrator()
    result = convert_document(
        source, output, overwrite=True, narrator_factory=lambda: repaired, progress=lambda _: None
    )
    assert result["reused_chunks"] == 2
    assert len(repaired.calls) == 1
    assert repaired.calls[0][0] == "둘째 단락입니다."
    internal_source = next(tmp_path.glob(".doc2audio/*/narration.txt"))
    before = internal_source.stat().st_mtime_ns
    with pytest.raises(Doc2AudioError, match="내부 작업 경로"):
        convert_document(internal_source, tmp_path / "different.mp3")
    assert internal_source.stat().st_mtime_ns == before


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg required")
def test_changed_text_or_voice_does_not_reuse_old_audio(tmp_path):
    source = tmp_path / "source.txt"
    source.write_text("첫 번째 원문입니다.", encoding="utf-8")
    output = tmp_path / "voice.wav"
    narrator = SyntheticNarrator()
    convert_document(source, output, narrator_factory=lambda: narrator, progress=lambda _: None)
    source.write_text("바뀐 원문입니다.", encoding="utf-8")
    changed = convert_document(
        source, output, overwrite=True, narrator_factory=lambda: narrator, progress=lambda _: None
    )
    assert changed["reused_chunks"] == 0
    changed_voice = convert_document(
        source,
        output,
        overwrite=True,
        options=Options(speaker="Ryan"),
        narrator_factory=lambda: narrator,
        progress=lambda _: None,
    )
    assert changed_voice["reused_chunks"] == 0


def test_lock_prevents_concurrent_same_job(tmp_path):
    with job_lock(tmp_path), pytest.raises(Doc2AudioError, match="이미 실행"):
        with job_lock(tmp_path):
            pytest.fail("second lock must not be acquired")


@pytest.mark.parametrize("audio", [np.zeros(2400), np.full(2400, np.nan), np.array([])])
def test_invalid_model_audio_fails(audio):
    with pytest.raises(Doc2AudioError):
        prepare_audio(audio, 24000)


def test_quiet_but_valid_audio_and_clipping_handled():
    quiet = np.sin(np.arange(2400) / 20).astype(np.float32) * 0.0005
    assert len(prepare_audio(quiet, 24000)) > 0
    assert np.max(np.abs(prepare_audio(quiet * 10000, 24000))) <= 1


def test_cli_fails_usefully_before_model_load(tmp_path, capsys):
    assert main([str(tmp_path / "missing.pdf")]) == 1
    assert "파일을 찾을 수 없습니다" in capsys.readouterr().err
    source = tmp_path / "read.txt"
    source.write_text("한국어 본문", encoding="utf-8")
    assert main(["extract", str(source)]) == 0
    assert "한국어 본문" in capsys.readouterr().out
    assert main(["extract", str(source), "-o", str(source), "--overwrite"]) == 1
    assert source.read_text() == "한국어 본문"
