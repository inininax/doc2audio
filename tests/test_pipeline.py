import json
import shutil
import subprocess

import numpy as np
import pytest

from doc2audio.audio import prepare_audio
from doc2audio.errors import Doc2AudioError
from doc2audio.pipeline import Options, convert_document, job_lock
from doc2audio_cli.cli import main


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


@pytest.mark.parametrize("gain", [2, 400, 1000])
def test_clipping_uses_the_normalized_peak_to_find_speech(gain):
    audio = np.sin(np.arange(7200) / 20).astype(np.float32) * gain
    # A quiet ending exposes inconsistent trimming even before the empty-mask boundary.
    audio[-3600:] *= 0.004
    normalized = audio / np.max(np.abs(audio)) * 0.98
    expected = prepare_audio(normalized, 24000)
    actual = prepare_audio(audio, 24000)
    np.testing.assert_allclose(actual, expected)
    assert np.isfinite(actual).all()


def test_cli_fails_usefully_before_model_load(tmp_path, capsys):
    assert main([str(tmp_path / "missing.pdf")]) == 1
    assert "파일을 찾을 수 없습니다" in capsys.readouterr().err
    source = tmp_path / "read.txt"
    source.write_text("한국어 본문", encoding="utf-8")
    assert main(["extract", str(source)]) == 0
    assert "한국어 본문" in capsys.readouterr().out
    assert main(["extract", str(source), "-o", str(source), "--overwrite"]) == 1
    assert source.read_text() == "한국어 본문"


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg required")
def test_output_speed_change_reuses_voice_chunks(tmp_path):
    source = tmp_path / "source.txt"
    source.write_text("속도를 바꾸어도 목소리는 다시 만들지 않습니다.", encoding="utf-8")
    narrator = SyntheticNarrator()
    convert_document(source, tmp_path / "normal.mp3", narrator_factory=lambda: narrator)
    faster = convert_document(
        source,
        tmp_path / "faster.mp3",
        options=Options(speed=1.5),
        narrator_factory=lambda: narrator,
    )
    assert len(narrator.calls) == 1
    assert faster["reused_chunks"] == 1


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg required")
@pytest.mark.parametrize("broken_manifest", [[], None, "broken"])
def test_wrong_shaped_manifest_is_recovered(tmp_path, broken_manifest):
    source = tmp_path / "source.txt"
    source.write_text("저장 기록이 손상되어도 다시 생성합니다.", encoding="utf-8")
    output = tmp_path / "voice.wav"
    convert_document(source, output, narrator_factory=SyntheticNarrator, progress=lambda _: None)
    manifest = next(tmp_path.glob(".doc2audio/*/manifest.json"))
    manifest.write_text(json.dumps(broken_manifest), encoding="utf-8")
    messages = []
    regenerated = SyntheticNarrator()
    result = convert_document(
        source,
        output,
        overwrite=True,
        narrator_factory=lambda: regenerated,
        progress=messages.append,
    )
    assert result["reused_chunks"] == 0
    assert len(regenerated.calls) == 1
    assert any("이전 작업 기록" in message for message in messages)
    assert len(json.loads(manifest.read_text())["completed"]) == 1


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg required")
def test_decorative_paragraphs_preserve_text_and_original_cache_indexes(tmp_path):
    source = tmp_path / "source.txt"
    original = "첫 문장입니다.\n\n🎉\n\n---\n\n마지막 문장입니다."
    source.write_text(original, encoding="utf-8")
    output = tmp_path / "voice.wav"
    interrupted = SyntheticNarrator(fail_on=2)
    with pytest.raises(Doc2AudioError, match="interruption"):
        convert_document(
            source, output, narrator_factory=lambda: interrupted, progress=lambda _: None
        )
    assert interrupted.calls == [("첫 문장입니다.", 42), ("마지막 문장입니다.", 45)]
    cache = next(tmp_path.glob(".doc2audio/*"))
    first_hash = (cache / "00000.wav").read_bytes()
    resumed = SyntheticNarrator()
    result = convert_document(
        source, output, narrator_factory=lambda: resumed, progress=lambda _: None
    )
    assert result["chunks"] == 2 and result["reused_chunks"] == 1
    assert resumed.calls == [("마지막 문장입니다.", 45)]
    assert (cache / "00000.wav").read_bytes() == first_hash
    assert (cache / "00003.wav").is_file()
    assert not (cache / "00001.wav").exists() and not (cache / "00002.wav").exists()
    assert source.read_text(encoding="utf-8") == original
    assert (cache / "extracted.txt").read_text(encoding="utf-8") == original + "\n"
    assert (cache / "narration.txt").read_text(encoding="utf-8") == original + "\n"
    assert json.loads((cache / "manifest.json").read_text())["chunks"] == original.split("\n\n")
    assert any("2개 구간" in warning for warning in result["warnings"])


def test_pronunciation_mapping_with_no_spoken_text_fails_before_loading_model(tmp_path):
    source = tmp_path / "source.txt"
    source.write_text("그림", encoding="utf-8")
    dictionary = tmp_path / "dictionary.json"
    dictionary.write_text(json.dumps({"그림": "🎉"}), encoding="utf-8")

    def unexpected_model():
        pytest.fail("No model should load when the pronunciation text has no speech")

    with pytest.raises(Doc2AudioError, match="읽을 본문"):
        convert_document(
            source,
            tmp_path / "voice.wav",
            pronunciations=dictionary,
            narrator_factory=unexpected_model,
            progress=lambda _: None,
        )


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg required")
def test_internal_segments_preserve_order_and_reuse_after_pause_speed_changes(
    tmp_path, monkeypatch
):
    import doc2audio.pipeline as pipeline

    source = tmp_path / "source.txt"
    source.write_text("첫 문장입니다.\n\n마지막 문장입니다.")
    output = tmp_path / "segments.wav"
    calls, encoded = [], []

    class SegmentedNarrator:
        def generate_segments(self, text, seed):
            calls.append((text, seed))
            return [
                ((0.1 * np.sin(np.arange(2400) * 2 * np.pi * hz / 24000)).astype(np.float32), 24000)
                for hz in (300 + seed, 600 + seed)
            ]

    encode = pipeline.encode_audio

    def capture(paths, *args, **kwargs):
        encoded.append([path.name for path in paths])
        return encode(paths, *args, **kwargs)

    monkeypatch.setattr(pipeline, "encode_audio", capture)
    arguments = dict(narrator_factory=SegmentedNarrator, progress=lambda _: None, overwrite=True)
    initial = convert_document(source, output, generation_options={"pause": 0.3}, **arguments)
    assert initial["chunks"] == 2 and initial["reused_chunks"] == 0
    assert initial["seconds"] == pytest.approx(1.3, abs=0.01)
    assert encoded[-1] == ["00000.wav", "00000-001.wav", "00001.wav", "00001-001.wav"]
    assert len(calls) == 2
    no_pause = convert_document(source, output, generation_options={"pause": 0}, **arguments)
    assert no_pause["reused_chunks"] == 2 and len(calls) == 2
    assert no_pause["seconds"] == pytest.approx(0.4, abs=0.01)
    fast = convert_document(
        source, output, generation_options={"pause": 0.4, "speed": 2}, **arguments
    )
    assert fast["reused_chunks"] == 2 and len(calls) == 2
    assert fast["seconds"] == pytest.approx(0.8, abs=0.01)
    assert len(set(map(tuple, encoded))) == 1
    cache = next(tmp_path.glob(".doc2audio/*"))
    last = (cache / "00001-001.wav").read_bytes()
    (cache / "00000-001.wav").write_bytes(b"broken")
    repaired = convert_document(source, output, generation_options={"pause": 0}, **arguments)
    assert repaired["reused_chunks"] == 1 and len(calls) == 3
    assert calls[-1][0] == "첫 문장입니다."
    assert (cache / "00001-001.wav").read_bytes() == last
    assert repaired["seconds"] == pytest.approx(0.4, abs=0.01)


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg required")
def test_incomplete_internal_segments_are_never_marked_completed(tmp_path):
    source = tmp_path / "source.txt"
    source.write_text("본문입니다.")

    class InterruptedSegments:
        def generate_segments(self, text, seed):
            yield np.full(2400, 0.1, dtype=np.float32), 24000
            raise Doc2AudioError("test segment interruption")

    with pytest.raises(Doc2AudioError, match="segment interruption"):
        convert_document(
            source,
            tmp_path / "output.wav",
            narrator_factory=InterruptedSegments,
            progress=lambda _: None,
        )
    cache = next(tmp_path.glob(".doc2audio/*"))
    manifest = json.loads((cache / "manifest.json").read_text())
    assert manifest["completed"] == {}
    assert not (tmp_path / "output.wav").exists()
    result = convert_document(
        source, tmp_path / "output.wav", narrator_factory=SyntheticNarrator, progress=lambda _: None
    )
    assert result["reused_chunks"] == 0 and result["chunks"] == 1
