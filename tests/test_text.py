import json
import re

import pytest

from doc2audio.errors import Doc2AudioError
from doc2audio.text import apply_pronunciations, load_pronunciations, normalize_text, split_text


def test_cleanup_keeps_paragraphs_numbers_and_meaning():
    assert normalize_text("한글\u200b 문서\r\n 줄바꿈\r\n\r\n값: 3.14, 1,200원\x0c끝") == (
        "한글 문서 줄바꿈\n\n값: 3.14, 1,200원\n\n끝"
    )


@pytest.mark.parametrize("limit", [40, 80, 240, 600])
def test_chunks_do_not_drop_or_repeat_any_nonwhitespace_character(limit):
    text = normalize_text(
        ('한국어 문장입니다. "정말인가요?" 값은 3.14이고 날짜는 2026.09.09입니다. ' * 25)
        + "\n\n"
        + "가" * 1500
        + "\n\n마지막 문장!"
    )
    chunks = split_text(text, limit)
    assert all(0 < len(chunk) <= limit for chunk in chunks)
    assert re.sub(r"\s", "", "".join(chunks)) == re.sub(r"\s", "", text)
    assert chunks[-1] == "마지막 문장!"


def test_prefers_sentence_boundary_without_splitting_decimal():
    chunks = split_text(
        "첫 번째 문장에는 3.14라는 숫자가 나옵니다. 다음 문장은 충분히 길어서 잘라야 합니다.", 40
    )
    assert chunks[0] == "첫 번째 문장에는 3.14라는 숫자가 나옵니다."


def test_pronunciation_replacements_are_single_pass():
    assert (
        apply_pronunciations(
            "API PDF AB", {"API": "에이피아이", "PDF": "API", "A": "가", "AB": "나"}
        )
        == "에이피아이 API 나"
    )


@pytest.mark.parametrize("value", [[], {"": "empty"}, {"key": ""}, {"key": 3}, "bad"])
def test_bad_dictionary_is_rejected(tmp_path, value):
    path = tmp_path / "pronunciation.json"
    path.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(Doc2AudioError):
        load_pronunciations(path)
