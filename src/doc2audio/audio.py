import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

from .errors import Doc2AudioError


def prepare_audio(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    if sample_rate <= 0 or len(audio) < sample_rate // 10 or not np.isfinite(audio).all():
        raise Doc2AudioError("생성된 오디오가 비어 있거나 유효하지 않습니다.")
    peak = float(np.max(np.abs(audio)))
    if peak < 0.0001:
        raise Doc2AudioError("음성 모델이 무음에 가까운 오디오를 반환했습니다.")
    if peak > 1:
        audio = audio / peak * 0.98
    # Retain 120 ms around speech and fade only at the outermost 5 ms boundaries.
    active = np.flatnonzero(np.abs(audio) > max(0.00001, peak * 0.003))
    padding = int(sample_rate * 0.12)
    audio = audio[max(0, active[0] - padding) : min(len(audio), active[-1] + padding + 1)].copy()
    fade = min(int(sample_rate * 0.005), len(audio) // 2)
    audio[:fade] *= np.linspace(0, 1, fade)
    audio[-fade:] *= np.linspace(1, 0, fade)
    return audio


def atomic_publish(temporary: Path, destination: Path, overwrite: bool = False) -> None:
    if overwrite:
        os.replace(temporary, destination)
    else:
        # Unlike an exists() + rename() pair, link() cannot clobber a concurrent output.
        try:
            os.link(temporary, destination)
        except FileExistsError as exc:
            raise Doc2AudioError(
                f"출력 파일이 이미 있습니다: {destination} (--overwrite로 교체)"
            ) from exc
        temporary.unlink()


def valid_wav(path: Path) -> bool:
    if not path.is_file():
        return False
    try:
        info = sf.info(path)
        return (
            info.format == "WAV"
            and info.frames > 0
            and info.channels == 1
            and info.samplerate == 24000
        )
    except (OSError, RuntimeError):
        return False


def encode_audio(
    chunks: list[Path],
    destination: Path,
    *,
    speed: float = 1.0,
    pause: float = 0.3,
    overwrite: bool = False,
) -> float:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise Doc2AudioError("ffmpeg가 없습니다. brew install ffmpeg로 설치하세요.")
    if not 0.5 <= speed <= 2.0 or not 0 <= pause <= 3:
        raise Doc2AudioError("속도는 0.5~2.0, 구간 쉼은 0~3초여야 합니다.")
    if not chunks:
        raise Doc2AudioError("합칠 음성 구간이 없습니다.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".doc2audio-", dir=destination.parent) as folder:
        folder = Path(folder)
        joined = folder / "joined.wav"
        frames = 0
        # Stream PCM blocks to disk: memory use does not grow with document length.
        with sf.SoundFile(joined, "w", samplerate=24000, channels=1, subtype="PCM_16") as output:
            silence = np.zeros(round(24000 * pause), dtype=np.float32)
            for index, path in enumerate(chunks):
                with sf.SoundFile(path) as source:
                    if source.samplerate != 24000 or source.channels != 1:
                        raise Doc2AudioError(f"구간 오디오 형식이 올바르지 않습니다: {path.name}")
                    for block in source.blocks(blocksize=65536, dtype="float32"):
                        output.write(block)
                        frames += len(block)
                if index + 1 < len(chunks):
                    output.write(silence)
                    frames += len(silence)
        encoded = folder / ("encoded" + destination.suffix.lower())
        codec = (
            ["-codec:a", "libmp3lame", "-b:a", "128k"]
            if destination.suffix.lower() == ".mp3"
            else ["-codec:a", "pcm_s16le"]
        )
        command = [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-i",
            str(joined),
            "-map_metadata",
            "-1",
            "-af",
            f"atempo={speed},loudnorm=I=-18:TP=-1.5:LRA=11",
            "-ar",
            "24000",
            "-ac",
            "1",
            *codec,
            "-metadata",
            f"title={destination.stem}",
            "-metadata",
            "comment=AI narration: Qwen3-TTS / doc2audio",
            str(encoded),
        ]
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
        if completed.returncode or not encoded.is_file() or encoded.stat().st_size < 100:
            raise Doc2AudioError(f"오디오 저장에 실패했습니다: {completed.stderr.strip()}")
        atomic_publish(encoded, destination, overwrite)
    return frames / 24000 / speed
