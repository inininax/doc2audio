"""Conservative text cleanup and lossless sentence-oriented chunking."""

import json
import re
import unicodedata
from pathlib import Path

from .errors import Doc2AudioError


def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFC", text).replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\x0c", "\n\n")
    text = "".join(c for c in text if c in "\n\t" or unicodedata.category(c) not in {"Cc", "Cf"})
    paragraphs = []
    for paragraph in re.split(r"\n\s*\n", text):
        # PDF hard line breaks do not imply a new sentence. Keep paragraph boundaries.
        lines = [re.sub(r"[\t \u00a0]+", " ", line).strip() for line in paragraph.splitlines()]
        paragraph = " ".join(line for line in lines if line)
        if paragraph:
            paragraphs.append(paragraph)
    return "\n\n".join(paragraphs)


def load_pronunciations(path: Path | None) -> dict[str, str]:
    if path is None:
        return {}
    try:
        value = json.loads(path.expanduser().read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise Doc2AudioError(f"발음 사전 JSON을 읽을 수 없습니다: {path}") from exc
    if not isinstance(value, dict) or any(
        not isinstance(k, str) or not k or not isinstance(v, str) or not v.strip()
        for k, v in value.items()
    ):
        raise Doc2AudioError('발음 사전은 {"원문": "읽을 발음"} 형태여야 합니다.')
    return value


def apply_pronunciations(text: str, mapping: dict[str, str]) -> str:
    if not mapping:
        return text
    pattern = re.compile("|".join(re.escape(k) for k in sorted(mapping, key=len, reverse=True)))
    # A single pass prevents replacements from replacing one another.
    return normalize_text(pattern.sub(lambda match: mapping[match[0]], text))


def split_text(text: str, max_chars: int = 240) -> list[str]:
    if not 40 <= max_chars <= 600:
        raise Doc2AudioError("구간 길이는 40~600자여야 합니다.")
    chunks = []
    for paragraph in text.split("\n\n"):
        remaining = paragraph.strip()
        while remaining:
            if len(remaining) <= max_chars:
                chunks.append(remaining)
                break
            window = remaining[: max_chars + 1]
            # Do not split decimals or abbreviations unless followed by whitespace.
            ends = [m.end() for m in re.finditer(r'[.!?。！？][”’"\)]*(?=\s)', window)]
            if ends:
                end = ends[-1]
            else:
                ends = [m.end() for m in re.finditer(r"[,;:，；](?=\s)", window)]
                end = ends[-1] if ends else window.rfind(" ", 0, max_chars + 1)
            if end <= 0:
                end = max_chars
            chunks.append(remaining[:end].strip())
            remaining = remaining[end:].strip()
    return chunks
