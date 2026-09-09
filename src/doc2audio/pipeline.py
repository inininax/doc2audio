import fcntl
import hashlib
import json
import os
import shutil
import time
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path

import soundfile as sf

from . import __version__
from .audio import encode_audio, prepare_audio, valid_wav
from .documents import extract_document
from .errors import Doc2AudioError
from .model import DEFAULT_INSTRUCT, DEFAULT_MODEL_DIR, MODEL_ID, MODEL_REVISION
from .text import apply_pronunciations, load_pronunciations, split_text


@dataclass(frozen=True)
class Options:
    speaker: str = "Sohee"
    instruct: str = DEFAULT_INSTRUCT
    chunk_chars: int = 240
    seed: int = 42
    speed: float = 1.0
    pause: float = 0.3


def file_hash(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write_json(path: Path, value: dict) -> None:
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


@contextmanager
def job_lock(path: Path):
    with (path / "job.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise Doc2AudioError("같은 문서의 변환이 이미 실행 중입니다.") from exc
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def cached_chunk(wav: Path, record: dict) -> bool:
    return bool(record) and valid_wav(wav) and file_hash(wav) == record.get("sha256")


def convert_document(
    source: Path,
    destination: Path,
    *,
    options: Options | None = None,
    model_dir: Path = DEFAULT_MODEL_DIR,
    pages: str | None = None,
    ocr: str = "auto",
    pronunciations: Path | None = None,
    offline: bool = False,
    overwrite: bool = False,
    work_dir: Path | None = None,
    progress: Callable[[str], None] = print,
    narrator_factory=None,
) -> dict:
    from .model import QwenNarrator, ensure_model

    options = options or Options()
    source = source.expanduser().resolve()
    destination = destination.expanduser().absolute()
    if source == destination.resolve():
        raise Doc2AudioError("입력 문서를 출력 파일로 덮어쓸 수 없습니다.")
    if destination.suffix.lower() not in {".mp3", ".wav"}:
        raise Doc2AudioError("출력 확장자는 .mp3 또는 .wav를 사용하세요. 기본 형식은 MP3입니다.")
    if destination.exists() and not overwrite:
        raise Doc2AudioError(f"출력 파일이 이미 있습니다: {destination} (--overwrite로 교체)")
    if (
        not 0.5 <= options.speed <= 2
        or not 0 <= options.pause <= 3
        or not 0 <= options.seed < 2**32
    ):
        raise Doc2AudioError("속도는 0.5~2.0, 쉼은 0~3초, seed는 0~4294967295여야 합니다.")
    if not shutil.which("ffmpeg"):
        raise Doc2AudioError("ffmpeg가 없습니다. brew install ffmpeg로 설치하세요.")
    start = time.monotonic()
    document = extract_document(source, pages=pages, ocr=ocr)
    for warning in document.warnings:
        progress(f"주의: {warning}")
    text = apply_pronunciations(document.text, load_pronunciations(pronunciations))
    chunks = split_text(text, options.chunk_chars)
    if not chunks:
        raise Doc2AudioError("읽을 본문이 없습니다.")
    progress(f"본문 {len(text):,}자 · {len(chunks)}개 구간 · OCR {len(document.ocr_pages)}쪽")
    identity = {
        "version": __version__,
        "model": MODEL_ID,
        "revision": MODEL_REVISION,
        "options": asdict(options),
        "chunks": chunks,
    }
    job_id = hashlib.sha256(
        json.dumps(identity, ensure_ascii=False, sort_keys=True).encode()
    ).hexdigest()[:24]
    job = (work_dir or destination.parent / ".doc2audio").expanduser().resolve() / job_id
    if source.is_relative_to(job):
        raise Doc2AudioError(
            "입력과 내부 작업 경로가 겹칩니다. --work-dir로 다른 폴더를 지정하세요."
        )
    job.mkdir(parents=True, exist_ok=True, mode=0o700)
    destination.parent.mkdir(parents=True, exist_ok=True)
    progress(f"이어하기 저장 위치: {job}")
    with job_lock(job):
        manifest_path = job / "manifest.json"
        manifest = {"job_id": job_id, **identity, "completed": {}}
        if manifest_path.is_file():
            try:
                previous = json.loads(manifest_path.read_text(encoding="utf-8"))
                if previous.get("job_id") == job_id and isinstance(previous.get("completed"), dict):
                    manifest["completed"] = previous["completed"]
            except (ValueError, OSError):
                progress("이전 작업 기록을 읽지 못해 음성을 다시 생성합니다.")
        (job / "extracted.txt").write_text(document.text + "\n", encoding="utf-8")
        (job / "narration.txt").write_text(text + "\n", encoding="utf-8")
        write_json(manifest_path, manifest)
        narrator = None
        wav_paths, reused = [], 0
        for index, chunk in enumerate(chunks):
            wav = job / f"{index:05d}.wav"
            record = manifest["completed"].get(str(index), {})
            if isinstance(record, dict) and cached_chunk(wav, record):
                progress(f"[{index + 1}/{len(chunks)}] 저장된 음성 재사용")
                reused += 1
            else:
                if narrator is None:
                    if narrator_factory is None:
                        path = ensure_model(model_dir, offline=offline)
                        progress("한국어 음성 모델을 불러옵니다.")
                        narrator = QwenNarrator(
                            path, speaker=options.speaker, instruct=options.instruct
                        )
                    else:
                        narrator = narrator_factory()
                progress(f"[{index + 1}/{len(chunks)}] {len(chunk)}자 음성 생성 중")
                audio, rate = narrator.generate(chunk, (options.seed + index) % 2**32)
                if rate != 24000:
                    raise Doc2AudioError(f"예상하지 못한 샘플레이트입니다: {rate}")
                audio = prepare_audio(audio, rate)
                temporary = wav.with_suffix(".tmp.wav")
                sf.write(temporary, audio, rate, subtype="PCM_16")
                os.replace(temporary, wav)
                manifest["completed"][str(index)] = {
                    "sha256": file_hash(wav),
                    "seconds": len(audio) / rate,
                }
                write_json(manifest_path, manifest)
                progress(f"[{index + 1}/{len(chunks)}] 완료 · 음성 {len(audio) / rate:.1f}초")
            wav_paths.append(wav)
        progress("음량을 맞추고 오디오 파일을 저장합니다.")
        duration = encode_audio(
            wav_paths,
            destination,
            speed=options.speed,
            pause=options.pause,
            overwrite=overwrite,
        )
        result = {
            "output": str(destination),
            "seconds": round(duration, 2),
            "chunks": len(chunks),
            "reused_chunks": reused,
            "elapsed_seconds": round(time.monotonic() - start, 2),
            "model": MODEL_ID,
            "revision": MODEL_REVISION,
            "speaker": options.speaker,
            "ocr_pages": document.ocr_pages,
            "warnings": document.warnings,
        }
        manifest["result"] = result
        write_json(manifest_path, manifest)
    return result
