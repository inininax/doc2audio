"""Trace API options through the real worker/encoder, with explicit synthetic SDK audio."""

import json
import shutil
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

from doc2audio.catalog import validate_options
from doc2audio_server.app import create_app
from doc2audio_server.worker import execute


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg required")
@pytest.mark.parametrize("model_id", ["qwen3-1.7b", "qwen3-0.6b", "supertonic-3"])
def test_all_exposed_options_reach_native_call_and_encoded_output(tmp_path, monkeypatch, model_id):
    monkeypatch.setenv("DOC2AUDIO_MODELS_DIR", str(tmp_path / "models"))
    monkeypatch.setattr("doc2audio_server.app.missing_files", lambda *_: [])
    monkeypatch.setattr("doc2audio.engines.missing_files", lambda *_: [])
    audio = (0.1 * np.sin(np.arange(2400) * 2 * np.pi * 440 / 24000)).astype(np.float32)
    calls, seeds = [], []
    requested = {"seed": 13, "speed": 1.5, "pause": 0.2, "chunk_chars": 40}
    if model_id.startswith("qwen"):
        import mlx.core as mx
        import mlx_audio.tts.utils

        requested.update(
            speaker="Ryan",
            language="auto",
            temperature=1.1,
            top_k=7,
            top_p=0.6,
            repetition_penalty=1.2,
        )
        if model_id == "qwen3-1.7b":
            requested["instruct"] = "밝고 명확하게 읽어 주세요."

        def generate_custom_voice(**kwargs):
            calls.append(kwargs)
            yield SimpleNamespace(audio=audio, token_count=5, sample_rate=24000)

        model = SimpleNamespace(
            tokenizer=object(),
            speech_tokenizer=object(),
            supported_speakers=["Ryan"],
            generate_custom_voice=generate_custom_voice,
        )
        monkeypatch.setattr("doc2audio.model.require_platform", lambda: None)
        monkeypatch.setattr(mx.metal, "is_available", lambda: True)
        monkeypatch.setattr(mx.random, "seed", seeds.append)
        monkeypatch.setattr(mlx_audio.tts.utils, "load_model", lambda _: model)
    else:
        requested.update(speaker="M3", language="en", total_steps=5, speech_speed=1.4)

        def synthesize(text, **kwargs):
            calls.append({"text": text, **kwargs})
            seeds.append(np.random.randint(100000))
            return audio[None, :], np.array([0.1])

        model = SimpleNamespace(
            sample_rate=24000, get_voice_style=lambda speaker: speaker, synthesize=synthesize
        )
        monkeypatch.setattr("supertonic.TTS", lambda **_: model)
    with TestClient(create_app(tmp_path / "jobs", start_worker=False)) as client:
        response = client.post(
            "/api/jobs",
            headers={"X-Doc2Audio": "1"},
            data={
                "model_id": model_id,
                "text": "첫 번째 문장입니다.\n\n두 번째 문장입니다.",
                "options": json.dumps(requested),
            },
        )
        assert response.status_code == 202, response.text
        job = response.json()
        assert job["options"]["voice"] == validate_options(model_id, requested)
        store = client.app.state.store
        store.claim()
        execute(store, job["id"])
        result = store.get(job["id"])
        assert result["status"] == "completed"
        assert result["result"]["chunks"] == 2
        assert result["result"]["seconds"] == pytest.approx((0.2 + 0.2) / 1.5, abs=0.01)
        assert (store.root / "jobs" / job["id"] / "audio.mp3").stat().st_size > 100
        assert len(calls) == 2
        if model_id.startswith("qwen"):
            assert seeds == [13, 14]
            for call in calls:
                for key in (
                    "speaker",
                    "language",
                    "temperature",
                    "top_k",
                    "top_p",
                    "repetition_penalty",
                ):
                    assert call[key] == requested[key]
                assert call["instruct"] == requested.get("instruct", "")
        else:
            assert seeds == [np.random.RandomState(seed).randint(100000) for seed in (13, 14)]
            for call in calls:
                assert call["voice_style"] == requested["speaker"]
                assert call["lang"] == requested["language"]
                assert call["total_steps"] == requested["total_steps"]
                assert call["speed"] == requested["speech_speed"]
        manifests = list((store.root / "jobs" / job["id"] / "chunks").glob("*/manifest.json"))
        manifest = json.loads(manifests[0].read_text())
        assert manifest["pipeline_revision"] == 3
        assert manifest["options"] == {
            key: value
            for key, value in validate_options(model_id, requested).items()
            if key not in {"speed", "pause"}
        }


def test_qwen_new_controls_are_validated_and_supertonic_default_is_normal_speed():
    for model_id in ("qwen3-1.7b", "qwen3-0.6b"):
        assert validate_options(model_id, {"top_k": 0, "language": "auto"})["top_k"] == 0
        assert validate_options(model_id, {})["top_k"] == 50
        assert validate_options(model_id, {})["repetition_penalty"] == 1.05
    assert validate_options("supertonic-3", {})["speech_speed"] == 1
