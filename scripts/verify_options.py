"""Opt-in real model-option, audio re-encoding, and native speech-speed checks.

Run after model installation: uv run --offline python scripts/verify_options.py
Uses synthetic text and installed models only; no downloads or server jobs.
Each invocation starts a fresh cache under output/options/<run-id>/ so existing
audio cannot satisfy the initial inference check. MP3s and JSON evidence remain there.
"""

import argparse
import gc
import json
import os
import shutil
import subprocess
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VARIANTS = {
    "qwen3-1.7b": {
        "speaker": "Sohee",
        "language": "auto",
        "instruct": "밝고 또렷하게 읽어 주세요.",
        "temperature": 0.85,
        "top_k": 32,
        "top_p": 0.95,
        "repetition_penalty": 1.1,
        "seed": 123,
        "chunk_chars": 40,
        "speed": 1,
        "pause": 0,
    },
    "qwen3-0.6b": {
        "speaker": "Ryan",
        "language": "auto",
        "temperature": 0.8,
        "top_k": 0,
        "top_p": 0.85,
        "repetition_penalty": 1.15,
        "seed": 7,
        "chunk_chars": 40,
        "speed": 1.25,
        "pause": 0.25,
    },
    "supertonic-3": {
        "speaker": "M1",
        "language": "ko",
        "total_steps": 6,
        "speech_speed": 1,
        "seed": 37,
        "chunk_chars": 40,
        "speed": 0.9,
        "pause": 0.5,
    },
}


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def probe_mp3(path):
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=codec_name,sample_rate,channels:format=duration",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    result = json.loads(probe.stdout)
    assert result["streams"] == [{"codec_name": "mp3", "sample_rate": "24000", "channels": 1}]
    assert float(result["format"]["duration"]) > 0
    return result


def verify_model(model_id, source, output):
    from doc2audio.catalog import validate_options
    from doc2audio.pipeline import convert_document

    requested = VARIANTS[model_id]
    folder = output / model_id
    folder.mkdir()

    def progress(message):
        print(f"{model_id}: {message}", flush=True)

    first = convert_document(
        source,
        folder / "configured.mp3",
        model_id=model_id,
        generation_options=requested,
        offline=True,
        work_dir=folder / "cache",
        progress=progress,
    )
    assert first["reused_chunks"] == 0, "Actual inference was bypassed by the audio cache"
    reencoded_options = {**requested, "speed": 1.6, "pause": 0.75}
    after = convert_document(
        source,
        folder / "reencoded.mp3",
        model_id=model_id,
        generation_options=reencoded_options,
        offline=True,
        work_dir=folder / "cache",
        progress=progress,
    )
    assert after["reused_chunks"] == first["chunks"] == 2
    result = {
        "model_id": model_id,
        "options": validate_options(model_id, requested),
        "reencoded_options": validate_options(model_id, reencoded_options),
        "first": first,
        "reencoded": after,
        "configured_probe": probe_mp3(folder / "configured.mp3"),
        "reencoded_probe": probe_mp3(folder / "reencoded.mp3"),
    }
    gc.collect()
    if model_id.startswith("qwen"):
        import mlx.core as mx

        mx.clear_cache()
    print(f"REAL_OPTIONS_PASS: {model_id}; reencoded without model inference", flush=True)
    return result


def verify_speech_speed(output):
    from doc2audio.engines import create_narrator

    narrator = create_narrator("supertonic-3", {"speech_speed": 1, "total_steps": 4}, offline=True)
    text = "같은 문장을 다른 속도로 읽습니다."
    normal = narrator.generate_segments(text, 42)
    narrator.options["speech_speed"] = 1.5
    fast = narrator.generate_segments(text, 42)
    normal_frames = sum(len(audio) for audio, _ in normal)
    fast_frames = sum(len(audio) for audio, _ in fast)
    assert normal_frames > 0 and fast_frames > 0
    ratio = normal_frames / fast_frames
    assert 1.48 < ratio < 1.52, ratio
    write_json(
        output / "speech-speed.json",
        {"normal_frames": normal_frames, "fast_frames": fast_frames, "ratio": ratio},
    )
    print(f"REAL_SPEECH_SPEED_PASS: native duration ratio={ratio:.5f}", flush=True)


def main():
    parser = argparse.ArgumentParser(
        description="설치된 모델의 음성 옵션과 캐시 재사용을 검증합니다."
    )
    parser.add_argument("--model", choices=VARIANTS, help="한 모델만 검증 (기본: 세 모델 모두)")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=ROOT / "output/options",
        help="결과 폴더. 실행마다 새로운 하위 폴더를 만듭니다.",
    )
    args = parser.parse_args()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

    from doc2audio.catalog import missing_files

    models = [args.model] if args.model else list(VARIANTS)
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            parser.error(f"{tool} 설치가 필요합니다.")
    for model_id in models:
        if missing_files(model_id):
            parser.error(
                f"{model_id} 모델이 없거나 불완전합니다. 이 검증은 모델을 다운로드하지 않습니다."
            )
    output = args.output_dir.expanduser().resolve() / uuid.uuid4().hex
    output.mkdir(parents=True)
    source = output / "source.txt"
    source.write_text(
        "안녕하세요. 설정을 확인합니다.\n\n저장한 음성은 다시 사용할 수 있습니다.", encoding="utf-8"
    )
    results = []
    for model_id in models:
        results.append(verify_model(model_id, source, output))
        write_json(output / "results.json", results)
    if "supertonic-3" in models:
        verify_speech_speed(output)
    print(f"REAL_OPTIONS_COMPLETE: {output}", flush=True)


if __name__ == "__main__":
    main()
