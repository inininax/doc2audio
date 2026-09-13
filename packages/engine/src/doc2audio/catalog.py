"""Curated, revision-pinned model catalog and validated capability descriptions."""

import json
import math
from pathlib import Path

from .errors import Doc2AudioError
from .paths import models_dir
from .text import is_utf8_text

CATALOG = json.loads(Path(__file__).with_suffix(".json").read_text())
DEFAULT_MODEL = "qwen3-1.7b"
QWEN_LANGUAGES = [
    "auto",
    "Korean",
    "English",
    "Chinese",
    "Japanese",
    "German",
    "French",
    "Russian",
    "Portuguese",
    "Spanish",
    "Italian",
]
QWEN_VOICES = [
    "Sohee",
    "Serena",
    "Vivian",
    "Uncle_Fu",
    "Ryan",
    "Aiden",
    "Ono_Anna",
    "Eric",
    "Dylan",
]


def get_model(model_id: str) -> dict:
    for model in CATALOG["models"]:
        if model["id"] == model_id:
            return model
    raise Doc2AudioError(f"등록되지 않은 모델입니다: {model_id}")


def model_path(model_id: str) -> Path:
    get_model(model_id)
    folder = "qwen3-tts-1.7b-8bit" if model_id == DEFAULT_MODEL else model_id
    return models_dir() / folder


def missing_files(model_id: str, path: Path | None = None) -> list[str]:
    path = path or model_path(model_id)
    missing = []
    for name, size in get_model(model_id)["files"].items():
        try:
            if not (path / name).is_file() or (path / name).stat().st_size != size:
                missing.append(name)
        except OSError:
            missing.append(name)
    return missing


def field(key, label, kind, default, **kwargs):
    return dict(key=key, label=label, type=kind, default=default, **kwargs)


def option_schema(model_id: str) -> list[dict]:
    model = get_model(model_id)
    if model["engine"] == "qwen":
        options = [
            field("speaker", "목소리", "select", "Sohee", choices=QWEN_VOICES),
            field("language", "언어", "select", "Korean", choices=QWEN_LANGUAGES),
            field("temperature", "표현 다양성", "number", 0.7, min=0.1, max=1.5, step=0.05),
            field(
                "top_k",
                "음성 토큰 후보 수 (top-k)",
                "integer",
                50,
                min=0,
                max=1000,
                step=1,
                help="작을수록 후보를 좁힙니다. 0이면 후보 수를 제한하지 않습니다.",
            ),
            field("top_p", "샘플링 범위 (top-p)", "number", 0.9, min=0.1, max=1, step=0.05),
            field("repetition_penalty", "반복 억제", "number", 1.05, min=1, max=2, step=0.05),
        ]
        if model_id == "qwen3-1.7b":
            options.insert(
                2,
                field(
                    "instruct",
                    "말투 지시",
                    "text",
                    "차분하고 따뜻한 한국어로 또렷하게 읽어 주세요.",
                    max_length=1000,
                ),
            )
    else:
        options = [
            field(
                "speaker",
                "목소리",
                "select",
                "F1",
                choices=[f"{gender}{i}" for gender in ["F", "M"] for i in range(1, 6)],
            ),
            field("language", "언어", "select", "ko", choices=model["languages"]),
            field(
                "total_steps",
                "음성 생성 단계",
                "integer",
                8,
                min=2,
                max=30,
                step=1,
                help="단계를 높이면 생성 시간이 늘어납니다.",
            ),
            field(
                "speech_speed",
                "모델 발화 속도",
                "number",
                1,
                min=0.7,
                max=2,
                step=0.05,
                help="모델이 말하는 속도입니다. 아래 출력 배속과 함께 적용됩니다.",
            ),
        ]
    return options + [
        field("speed", "출력 배속", "number", 1, min=0.5, max=2, step=0.05),
        field("pause", "구간 사이 쉼 (초)", "number", 0.3, min=0, max=3, step=0.1),
        field("seed", "랜덤 시드", "integer", 42, min=0, max=4294967295, step=1),
        field(
            "chunk_chars",
            "구간 최대 글자 수",
            "integer",
            120 if model["engine"] == "supertonic" else 240,
            min=40,
            max=600,
            step=1,
        ),
    ]


def validate_options(model_id: str, values: dict) -> dict:
    if not isinstance(values, dict):
        raise Doc2AudioError("음성 설정은 객체여야 합니다.")
    if not all(is_utf8_text(key) for key in values):
        raise Doc2AudioError("음성 설정의 옵션 이름이 올바르지 않습니다.")
    schema = option_schema(model_id)
    unknown = set(values) - {f["key"] for f in schema}
    if unknown:
        raise Doc2AudioError(f"이 모델이 지원하지 않는 옵션입니다: {', '.join(sorted(unknown))}")
    result = {}
    for f in schema:
        value = values.get(f["key"], f["default"])
        valid = True
        if f["type"] == "select":
            valid = value in f["choices"]
        elif f["type"] == "text":
            valid = is_utf8_text(value) and len(value) <= f["max_length"]
        else:
            valid = (
                isinstance(value, (int, float))
                and not isinstance(value, bool)
                and f["min"] <= value <= f["max"]
                and math.isfinite(value)
            )
            if f["type"] == "integer":
                valid = valid and int(value) == value
                if valid:
                    value = int(value)
        if not valid:
            raise Doc2AudioError(f"{f['label']} 값이 올바르지 않습니다.")
        result[f["key"]] = value
    return result


def public_models() -> list[dict]:
    return [
        {
            **{k: v for k, v in m.items() if k != "files"},
            "installed": not missing_files(m["id"]),
            "options": option_schema(m["id"]),
            "reviewed_at": CATALOG["reviewed_at"],
        }
        for m in CATALOG["models"]
    ]
