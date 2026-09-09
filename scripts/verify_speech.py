"""Independent, local ASR transcription of the generated validation audio.

uv run python scripts/verify_speech.py --download  # optional 1.01 GB Qwen3-ASR
uv run python scripts/verify_speech.py             # offline QA afterwards
uv run python scripts/verify_speech.py --engine whisper --download  # 1.62 GB

ASR is evidence about intelligibility, not a human naturalness rating. The script
never passes the expected transcript as a recognition prompt.
"""

import argparse
import hashlib
import json
import os
import re
from pathlib import Path

ENGINES = {
    "qwen": (
        "mlx-community/Qwen3-ASR-0.6B-8bit",
        "89e96d92ba34aca20b3e29fb10cc284097d1219f",
        "qwen3-asr-0.6b-8bit",
    ),
    "whisper": (
        "mlx-community/whisper-large-v3-turbo-asr-fp16",
        "624c19c9af5603fa73b83bce14d4aeea96156d18",
        "whisper-large-v3-turbo",
    ),
}


def canonical(text):
    # Only equivalent written/spoken date forms present in our synthetic fixture.
    for spoken, written in (("이천이십육년", "2026년"), ("구월", "9월"), ("구일", "9일")):
        text = text.replace(spoken, written)
    return re.sub(r"[^가-힣a-zA-Z0-9]", "", text).lower()


def edit_distance(left, right):
    previous = list(range(len(right) + 1))
    for index, char in enumerate(left, 1):
        current = [index]
        for other, value in enumerate(right, 1):
            current.append(
                min(current[-1] + 1, previous[other] + 1, previous[other - 1] + (char != value))
            )
        previous = current
    return previous[-1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--engine", choices=ENGINES, default="qwen")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    model_id, revision, directory = ENGINES[args.engine]
    model_path = root / ".models" / directory
    if args.download:
        from huggingface_hub import snapshot_download

        snapshot_download(
            model_id,
            revision=revision,
            local_dir=model_path,
            token=False,
            max_workers=3,
            ignore_patterns=[".gitattributes"],
        )
    if not (model_path / "model.safetensors").is_file():
        parser.error("QA 모델이 없습니다. --download로 먼저 내려받으세요.")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    from mlx_audio.stt import load

    from doc2audio.documents import extract_document

    model = load(model_path)
    validation = root / "output" / "validation"
    runtime = json.loads((validation / "runtime-results.json").read_text(encoding="utf-8"))
    sources = [(root / "samples/korean.txt", root / "output/한국어-샘플.mp3")]
    sources.extend((Path(item["input"]), Path(item["output"])) for item in runtime)
    long_source = validation / "긴 문서.txt"
    if long_source.with_suffix(".mp3").is_file():
        sources.append((long_source, long_source.with_suffix(".mp3")))
    records = []
    for source, audio in sources:
        expected = extract_document(source).text
        if args.engine == "whisper":
            import soundfile as sf

            # In this MLX-Audio version, timestamp decoding can hallucinate on a
            # leftover <20 ms; no-timestamp decoding can skip words at 30s cuts.
            # Use it only as a second check for <=30s files. Qwen handles the rest.
            if sf.info(audio).duration > 30:
                print(f"SKIP {audio.name}: Whisper 구간 경계 영향; Qwen ASR 결과를 확인하세요.")
                records.append({"audio": str(audio), "skipped": "Whisper 30-second boundary"})
                continue
            result = model.generate(
                str(audio),
                language="ko",
                temperature=0.0,
                verbose=None,
                return_timestamps=False,
                condition_on_previous_text=False,
            )
        else:
            result = model.generate(str(audio), language="Korean", temperature=0.0)
        expected_norm, actual_norm = canonical(expected), canonical(result.text)
        distance = edit_distance(expected_norm, actual_norm)
        record = {
            "source": str(source),
            "audio": str(audio),
            "audio_sha256": hashlib.sha256(audio.read_bytes()).hexdigest(),
            "expected": expected,
            "recognized": result.text,
            "normalized_character_errors": distance,
            "normalized_reference_characters": len(expected_norm),
            "normalized_cer": round(distance / max(1, len(expected_norm)), 5),
        }
        records.append(record)
        print(f"{audio.name}: CER={record['normalized_cer']:.2%}\n{result.text}", flush=True)
    report = {
        "asr_model": model_id,
        "revision": revision,
        "normalization": ("ignore punctuation/whitespace/case; canonicalize fixture date spelling"),
        "expected_transcript_used_as_prompt": False,
        "results": records,
    }
    (validation / f"speech-verification-{args.engine}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
