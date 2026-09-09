import contextlib
import os
import platform
import shutil
import sys
from pathlib import Path

from .errors import Doc2AudioError, GenerationLimitError
from .text import split_text

MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit"
MODEL_REVISION = "41d3337e8b7f2843a75841595fc14e4b9a7a4b96"
DEFAULT_MODEL_DIR = Path(__file__).resolve().parents[2] / ".models" / "qwen3-tts-1.7b-8bit"
DEFAULT_INSTRUCT = (
    "차분하고 따뜻한 한국어 오디오북 낭독. 자연스러운 표준 한국어 발음으로, "
    "문장과 문단 사이에 적절히 쉬면서 또렷하게 읽어 주세요. "
    "과장된 감정 없이 편안한 속도로 읽으세요."
)
# File lengths from the pinned HF tree. Also detects interrupted/truncated downloads.
MODEL_FILES = {
    "config.json": 6058,
    "generation_config.json": 245,
    "merges.txt": 1671839,
    "model.safetensors": 2393308931,
    "model.safetensors.index.json": 71786,
    "preprocessor_config.json": 127,
    "speech_tokenizer/config.json": 2336,
    "speech_tokenizer/configuration.json": 76,
    "speech_tokenizer/model.safetensors": 682293092,
    "speech_tokenizer/preprocessor_config.json": 234,
    "tokenizer_config.json": 7344,
    "vocab.json": 2776833,
}


def require_platform() -> None:
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise Doc2AudioError("이 버전은 Apple Silicon Mac(macOS arm64)용입니다.")


def missing_model_files(path: Path) -> list[str]:
    return [
        name
        for name, size in MODEL_FILES.items()
        if not (path / name).is_file() or (path / name).stat().st_size != size
    ]


def ensure_model(path: Path, *, offline: bool = False) -> Path:
    require_platform()
    path = path.expanduser().resolve()
    missing = missing_model_files(path)
    if missing:
        if offline:
            raise Doc2AudioError(
                "모델이 없거나 불완전합니다. 먼저 doc2audio download를 실행하세요."
            )
        path.mkdir(parents=True, exist_ok=True)
        needed = sum(MODEL_FILES[name] for name in missing) + 512 * 1024**2
        if shutil.disk_usage(path).free < needed:
            raise Doc2AudioError(
                f"모델 다운로드 공간이 부족합니다. 약 {needed / 1024**3:.1f} GiB가 필요합니다."
            )
        os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
        from huggingface_hub import snapshot_download

        print(f"모델 다운로드: {MODEL_ID} (전체 약 3.1 GB)", file=sys.stderr)
        try:
            snapshot_download(
                MODEL_ID,
                revision=MODEL_REVISION,
                local_dir=path,
                token=False,
                max_workers=3,
                allow_patterns=list(MODEL_FILES),
            )
        except Exception as exc:
            raise Doc2AudioError(
                f"모델 다운로드 실패: {exc}. 같은 명령으로 재시도할 수 있습니다."
            ) from exc
        if missing_model_files(path):
            raise Doc2AudioError(
                "모델 파일이 불완전합니다. doc2audio download로 다시 내려받으세요."
            )
    return path


class QwenNarrator:
    def __init__(self, path: Path, *, speaker: str = "Sohee", instruct: str = DEFAULT_INSTRUCT):
        require_platform()
        # Model files are resolved before loading. No hosted inference or remote tokenizer lookup.
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
        import mlx.core as mx
        from mlx_audio.tts.utils import load_model

        if not mx.metal.is_available():
            raise Doc2AudioError("Metal GPU를 사용할 수 없습니다.")
        with contextlib.redirect_stdout(sys.stderr):
            self.model = load_model(path)
        if self.model.tokenizer is None or self.model.speech_tokenizer is None:
            raise Doc2AudioError("텍스트/음성 토크나이저를 불러오지 못했습니다.")
        if speaker.lower() not in [s.lower() for s in self.model.supported_speakers]:
            raise Doc2AudioError(f"지원하지 않는 화자입니다: {speaker}")
        self.speaker = speaker
        self.instruct = instruct

    def generate(self, text: str, seed: int, _depth: int = 0):
        import numpy as np

        try:
            return self._generate_once(text, seed)
        except GenerationLimitError:
            # AR speech models can occasionally loop. Never publish that partial
            # audio; retry with smaller inputs while retaining every source word.
            parts = split_text(text, max(40, min(600, len(text) // 2)))
            if _depth < 2 and len(parts) > 1:
                print("음성 길이 제한에 도달해 해당 구간을 나누어 재생성합니다.", file=sys.stderr)
                pieces = []
                for index, part in enumerate(parts):
                    audio, rate = self.generate(
                        part, (seed + 104729 * (index + 1)) % 2**32, _depth + 1
                    )
                    if rate != 24000:
                        raise Doc2AudioError("재생성 구간의 샘플레이트가 다릅니다.") from None
                    if pieces:
                        pieces.append(np.zeros(4800, dtype=np.float32))
                    pieces.append(audio)
                return np.concatenate(pieces), 24000
            print("음성 종료를 확인하지 못해 다른 seed로 한 번 재시도합니다.", file=sys.stderr)
            return self._generate_once(text, (seed + 7919) % 2**32)

    def _generate_once(self, text: str, seed: int):
        import mlx.core as mx
        import numpy as np

        mx.random.seed(seed)
        # Allow ample headroom for Korean numbers and a slow reading (12.5 frames/s).
        # Hitting the cap is never a successful but silently truncated narration.
        max_tokens = max(256, len(text) * 5 + 128)
        results = self.model.generate_custom_voice(
            text=text,
            speaker=self.speaker,
            language="Korean",
            instruct=self.instruct,
            temperature=0.7,
            top_p=0.9,
            repetition_penalty=1.05,
            max_tokens=max_tokens,
            verbose=False,
        )
        generated = []
        sample_rate = None
        for result in results:
            if result.token_count >= max_tokens:
                raise GenerationLimitError(
                    "음성 생성이 길이 제한에 도달했습니다. --chunk-chars를 줄여 재실행하세요."
                )
            if sample_rate is not None and sample_rate != result.sample_rate:
                raise Doc2AudioError("음성 모델의 샘플레이트가 구간 중 변경되었습니다.")
            sample_rate = result.sample_rate
            generated.append(np.asarray(result.audio, dtype=np.float32).reshape(-1))
        if not generated:
            raise Doc2AudioError("음성 모델이 오디오를 반환하지 않았습니다.")
        return np.concatenate(generated), sample_rate
