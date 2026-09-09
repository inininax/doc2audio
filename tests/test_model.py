from types import SimpleNamespace

import numpy as np
import pytest

from doc2audio.errors import GenerationLimitError
from doc2audio.model import QwenNarrator


def test_repetition_limit_cannot_be_accepted_as_completed_audio():
    narrator = QwenNarrator.__new__(QwenNarrator)
    narrator.speaker, narrator.instruct = "Sohee", ""

    def capped(**kwargs):
        yield SimpleNamespace(
            token_count=kwargs["max_tokens"], audio=np.ones(24000), sample_rate=24000
        )

    narrator.model = SimpleNamespace(generate_custom_voice=capped)
    with pytest.raises(GenerationLimitError):
        narrator._generate_once("짧은 문장", 42)


def test_limit_retry_preserves_full_text_and_is_bounded():
    narrator = QwenNarrator.__new__(QwenNarrator)
    original = (
        "첫 번째 문장에는 중요한 정보가 있습니다. 두 번째 문장도 순서대로 빠짐없이 읽어야 합니다."
    )
    successful = []

    def generate_once(text, seed):
        if len(text) > 40:
            raise GenerationLimitError("limit")
        successful.append(text)
        return np.ones(2400, dtype=np.float32) * 0.1, 24000

    narrator._generate_once = generate_once
    audio, rate = narrator.generate(original, 42)
    assert "".join(successful).replace(" ", "") == original.replace(" ", "")
    assert rate == 24000 and len(audio) > 4800

    attempts = []

    def always_fails(text, seed):
        attempts.append(seed)
        raise GenerationLimitError("limit")

    narrator._generate_once = always_fails
    with pytest.raises(GenerationLimitError):
        narrator.generate("짧은 문장", 42)
    assert len(attempts) == 2
    assert attempts[0] != attempts[1]
