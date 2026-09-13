import json

import pytest

from doc2audio.catalog import validate_options
from doc2audio_cli import cli


@pytest.fixture
def converted_options(monkeypatch):
    captured = []

    def capture_conversion(source, output, *, model_id, generation_options, **kwargs):
        captured.append(validate_options(model_id, generation_options))
        return {"output": str(output)}

    monkeypatch.setattr(cli, "convert_document", capture_conversion)
    return captured


@pytest.mark.parametrize("model_id", ["qwen3-1.7b", "qwen3-0.6b", "supertonic-3"])
def test_model_options_are_preserved_without_explicit_flags(model_id, converted_options):
    requested = {"speed": 1.5, "pause": 0, "seed": 123}
    assert (
        cli.main(["source.txt", "--model", model_id, "--model-options", json.dumps(requested)]) == 0
    )
    assert {key: converted_options[0][key] for key in requested} == requested


def test_explicit_flags_override_model_options_even_with_default_values(converted_options):
    assert (
        cli.main(
            [
                "source.txt",
                "--model-options",
                json.dumps({"speed": 1.5, "pause": 0, "seed": 123}),
                "--speed",
                "1.0",
                "--pause",
                "0.3",
                "--seed",
                "42",
            ]
        )
        == 0
    )
    assert {key: converted_options[0][key] for key in ("speed", "pause", "seed")} == {
        "speed": 1.0,
        "pause": 0.3,
        "seed": 42,
    }


@pytest.mark.parametrize("model_id", ["qwen3-1.7b", "qwen3-0.6b", "supertonic-3"])
def test_omitted_options_keep_catalog_defaults(model_id, converted_options):
    assert cli.main(["source.txt", "--model", model_id]) == 0
    assert converted_options == [validate_options(model_id, {})]


def test_invalid_json_option_is_not_hidden_by_flag_default(converted_options, capsys):
    assert cli.main(["source.txt", "--model-options", '{"speed": 20}']) == 1
    assert "출력 배속 값이 올바르지 않습니다" in capsys.readouterr().err
    assert converted_options == []


def test_download_network_failure_returns_actionable_error(tmp_path, monkeypatch, capsys):
    import httpx

    def unavailable(*args, **kwargs):
        raise httpx.ConnectError("test network unavailable")

    monkeypatch.setattr("huggingface_hub.hf_hub_download", unavailable)
    assert cli.main(["download", "--model", "supertonic-3", "--model-dir", str(tmp_path)]) == 1
    error = capsys.readouterr().err
    assert "모델 다운로드 실패" in error
    assert "재시도" in error
    assert "Traceback" not in error
