"""Model installation and adapters. Inference never enables remote downloads."""

import contextlib
import os
import shutil
import sys
from pathlib import Path

from .catalog import get_model, missing_files, model_path, validate_options
from .errors import Doc2AudioError
from .model_lock import model_instance_lock, model_lock
from .text import split_text


def install_model(
    model_id: str, progress=lambda message, fraction: None, path: Path | None = None
) -> Path:
    path = (path or model_path(model_id)).expanduser().resolve()
    with model_lock(path):
        return _install_model(model_id, progress, path)


def _install_model(model_id: str, progress, path: Path) -> Path:
    from huggingface_hub import hf_hub_download

    spec = get_model(model_id)
    path = (path or model_path(model_id)).expanduser().resolve()
    path.mkdir(parents=True, exist_ok=True)
    missing = missing_files(model_id, path)
    needed = sum(spec["files"][name] for name in missing)
    if missing and shutil.disk_usage(path).free < needed + 512 * 1024**2:
        raise Doc2AudioError("모델을 다운로드할 디스크 공간이 부족합니다.")
    total = spec["size_bytes"]
    done = total - needed
    progress("모델 파일을 확인합니다.", done / total)
    for name in missing:
        progress(f"다운로드 중: {name}", done / total)
        try:
            hf_hub_download(
                spec["repo_id"],
                name,
                revision=spec["revision"],
                local_dir=path,
                token=False,
                # A known invalid file must bypass HF's revision/metadata cache.
                # Missing files retain resumable downloads of their partial data.
                force_download=(path / name).is_file(),
            )
        except Exception as exc:
            raise Doc2AudioError(
                f"모델 다운로드 실패 ({name}): {exc}. 같은 명령으로 재시도할 수 있습니다."
            ) from exc
        done += spec["files"][name]
        progress(f"다운로드 완료: {name}", done / total)
    if missing_files(model_id, path):
        raise Doc2AudioError("모델 파일 검증에 실패했습니다. 다운로드를 재시도하세요.")
    return path


class SupertonicNarrator:
    @model_instance_lock
    def __init__(self, path: Path, options: dict):
        from supertonic import TTS

        with contextlib.redirect_stdout(sys.stderr):
            self.model = TTS(
                model="supertonic-3",
                model_dir=path,
                auto_download=False,
                intra_op_num_threads=4,
                inter_op_num_threads=1,
            )
        self.options = options
        self.style = self.model.get_voice_style(options["speaker"])

    def generate(self, text: str, seed: int):
        import numpy as np

        pieces = []
        for audio, _ in self.generate_segments(text, seed):
            if pieces:
                pieces.append(np.zeros(7200, dtype=np.float32))
            pieces.append(audio)
        return np.concatenate(pieces), 24000

    def generate_segments(self, text: str, seed: int):
        """Return model-call boundaries so final encoding owns all inserted pauses."""
        from math import gcd

        import numpy as np
        from scipy.signal import resample_poly

        np.random.seed(seed)
        rate = self.model.sample_rate
        pieces = []
        # Remove padding per model call, before concatenating; the library's
        # multi-chunk duration excludes padding within the concatenated waveform.
        limit = 120 if self.options["language"] in {"ko", "ja"} else 300
        for part in split_text(text, limit):
            wav, duration = self.model.synthesize(
                part,
                voice_style=self.style,
                lang=self.options["language"],
                total_steps=self.options["total_steps"],
                speed=self.options["speech_speed"],
                max_chunk_length=max(10, len(part) + 1),
            )
            samples = np.asarray(wav, dtype=np.float32).reshape(-1)
            seconds = float(np.asarray(duration).reshape(-1)[0])
            if not np.isfinite(seconds) or seconds <= 0:
                raise Doc2AudioError("모델이 유효하지 않은 음성 길이를 반환했습니다.")
            frames = int(seconds * rate)
            # Duration originates in float32 model output. Permit a one-sample
            # rounding discrepancy, but never publish a genuinely truncated part.
            if frames < 1 or frames > samples.size + 1:
                raise Doc2AudioError("모델이 불완전한 음성을 반환했습니다. 다시 시도하세요.")
            divisor = gcd(rate, 24000)
            audio = resample_poly(samples[:frames], 24000 // divisor, rate // divisor)
            pieces.append((audio.astype(np.float32), 24000))
        if not pieces:
            raise Doc2AudioError("읽을 본문이 없습니다.")
        return pieces


def create_narrator(model_id: str, options: dict, *, offline=True, path=None):
    path = (path or model_path(model_id)).expanduser().resolve()
    with model_lock(path):
        return _create_narrator(model_id, options, offline=offline, path=path)


def _create_narrator(model_id: str, options: dict, *, offline=True, path=None):
    from .model import QwenNarrator

    options = validate_options(model_id, options)
    path = (path or model_path(model_id)).expanduser().resolve()
    if missing_files(model_id, path):
        if offline:
            raise Doc2AudioError("모델이 설치되지 않았습니다. 모델 보관함에서 다운로드하세요.")
        install_model(model_id, path=path)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    if get_model(model_id)["engine"] == "supertonic":
        return SupertonicNarrator(path, options)
    return QwenNarrator(
        path,
        speaker=options["speaker"],
        instruct=options.get("instruct", ""),
        language=options["language"],
        temperature=options["temperature"],
        top_k=options["top_k"],
        top_p=options["top_p"],
        repetition_penalty=options["repetition_penalty"],
    )
