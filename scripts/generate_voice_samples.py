"""Generate the product's synthetic voice previews with installed local models.

Run: uv run python scripts/generate_voice_samples.py
Use --overwrite to explicitly replace existing product assets. No user documents
or remote inference are used. Each model loads once in its own child process.
"""

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import soundfile as sf

from doc2audio.audio import encode_audio, prepare_audio
from doc2audio.catalog import get_model, missing_files, option_schema, validate_options
from doc2audio.engines import create_narrator
from doc2audio.pipeline import file_hash, write_json

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "apps/web/public/voice-samples"
MODEL_IDS = ("supertonic-3", "qwen3-1.7b", "qwen3-0.6b")
SAMPLE_TEXT = "안녕하세요. 오늘도 당신의 문서를 자연스러운 목소리로 읽어 드릴게요."
SEED = 42


def prepare_preview_audio(audio: np.ndarray, rate: int) -> tuple[np.ndarray, float]:
    audio = prepare_audio(audio, rate)
    active = np.flatnonzero(np.abs(audio) >= max(0.0001, float(np.max(np.abs(audio))) * 0.01))
    start, end = 0, len(audio)
    # Some voices leave a quiet breath/noise tail beyond the engine's conservative
    # trim. Short product previews retain 200 ms around speech if an edge exceeds 1 s.
    if active[0] / rate > 1:
        start = max(0, int(active[0]) - round(rate * 0.2))
    if (len(audio) - 1 - active[-1]) / rate > 1:
        end = min(len(audio), int(active[-1]) + round(rate * 0.2) + 1)
    trimmed_seconds = (len(audio) - (end - start)) / rate
    return audio[start:end], round(trimmed_seconds, 3)


def inspect_audio(path: Path) -> dict:
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration,size:stream=codec_name,sample_rate,channels",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    metadata = json.loads(probe.stdout)
    stream = metadata["streams"][0]
    if stream != {"codec_name": "mp3", "sample_rate": "24000", "channels": 1}:
        raise RuntimeError(f"Unexpected preview format: {path.name}: {stream}")
    seconds = float(metadata["format"]["duration"])
    if not 1 <= seconds <= 20:
        raise RuntimeError(f"Unexpected preview duration: {path.name}: {seconds:.3f}s")
    # Decode every frame; a valid MP3 header alone cannot pass this check.
    decoded = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"],
        capture_output=True,
        text=True,
        check=True,
    )
    if decoded.stderr.strip():
        raise RuntimeError(f"Preview decoding failed: {path.name}: {decoded.stderr}")
    pcm, rate = sf.read(path, dtype="float32")
    peak = float(np.max(np.abs(pcm)))
    rms_db = float(20 * np.log10(max(float(np.sqrt(np.mean(pcm.astype(np.float64) ** 2))), 1e-12)))
    active = np.flatnonzero(np.abs(pcm) >= max(0.0001, peak * 0.01))
    if not np.isfinite(pcm).all() or not len(active) or rms_db < -40:
        raise RuntimeError(f"Preview is silent or invalid: {path.name}")
    leading = float(active[0] / rate)
    trailing = float((len(pcm) - 1 - active[-1]) / rate)
    if leading > 1 or trailing > 1:
        raise RuntimeError(f"Preview has excessive edge silence: {path.name}")
    return {
        "seconds": round(seconds, 3),
        "bytes": path.stat().st_size,
        "sha256": file_hash(path),
        "sample_rate": 24000,
        "channels": 1,
        "rms_dbfs": round(rms_db, 2),
        "peak": round(peak, 5),
        "leading_silence_seconds": round(leading, 3),
        "trailing_silence_seconds": round(trailing, 3),
    }


def generate_model(model_id: str, staging: Path) -> None:
    spec = get_model(model_id)
    options = validate_options(model_id, {"seed": SEED})
    speakers = next(
        field["choices"] for field in option_schema(model_id) if field["key"] == "speaker"
    )
    narrator = create_narrator(model_id, options, offline=True)
    attempt_seeds = []
    if spec["engine"] == "qwen":
        # Record the production engine's bounded retry without changing it or
        # presenting an alternate retry seed as a successful initial seed.
        generate_once = narrator._generate_once

        def traced_generate_once(text, seed):
            attempt_seeds.append(seed)
            return generate_once(text, seed)

        narrator._generate_once = traced_generate_once
    folder = staging / model_id
    folder.mkdir(parents=True, exist_ok=True)
    records = []
    with tempfile.TemporaryDirectory(prefix="doc2audio-preview-pcm-") as temporary:
        wav = Path(temporary) / "sample.wav"
        for speaker in speakers:
            started = time.monotonic()
            attempt_seeds.clear()
            voice_options = {**options, "speaker": speaker}
            if spec["engine"] == "supertonic":
                narrator.options = voice_options
                narrator.style = narrator.model.get_voice_style(speaker)
                attempt_seeds.append(SEED)
            else:
                if speaker.lower() not in [
                    name.lower() for name in narrator.model.supported_speakers
                ]:
                    raise RuntimeError(f"Installed model does not support speaker: {speaker}")
                narrator.speaker = speaker
            audio, rate = narrator.generate(SAMPLE_TEXT, SEED)
            if rate != 24000:
                raise RuntimeError(f"Unexpected synthesis sample rate: {rate}")
            audio, trimmed_seconds = prepare_preview_audio(audio, rate)
            sf.write(wav, audio, rate, subtype="PCM_16")
            destination = folder / f"{speaker}.mp3"
            encode_audio([wav], destination, speed=options["speed"], pause=options["pause"])
            record = {
                "model_id": model_id,
                "speaker": speaker,
                "url": f"voice-samples/{model_id}/{speaker}.mp3",
                "revision": spec["revision"],
                "options": voice_options,
                "attempt_seeds": list(attempt_seeds),
                "trimmed_edge_seconds": trimmed_seconds,
                **inspect_audio(destination),
            }
            records.append(record)
            print(
                f"VOICE_SAMPLE_PASS {model_id}/{speaker}: {record['seconds']:.3f}s, "
                f"{record['bytes']} bytes; generated in {time.monotonic() - started:.2f}s",
                flush=True,
            )
    write_json(staging / f"{model_id}.json", {"samples": records})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--model", choices=MODEL_IDS, help=argparse.SUPPRESS)
    parser.add_argument("--staging", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.model:
        if args.staging is None:
            parser.error("--model requires --staging")
        generate_model(args.model, args.staging)
        return
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        parser.error("ffmpeg and ffprobe must be installed")
    for model_id in MODEL_IDS:
        missing = missing_files(model_id)
        if missing:
            parser.error(f"Install {model_id} first: uv run doc2audio download --model {model_id}")
    if DESTINATION.exists() and not args.overwrite:
        parser.error("Voice samples already exist; use --overwrite to regenerate them")
    # Only publish after every real sample has been generated and fully decoded.
    with tempfile.TemporaryDirectory(prefix="doc2audio-voice-samples-") as temporary:
        staging = Path(temporary)
        samples = []
        for model_id in MODEL_IDS:
            subprocess.run(
                [sys.executable, __file__, "--model", model_id, "--staging", str(staging)],
                check=True,
            )
            samples.extend(json.loads((staging / f"{model_id}.json").read_text())["samples"])
        DESTINATION.mkdir(parents=True, exist_ok=True)
        for sample in samples:
            relative = Path(sample["model_id"]) / f"{sample['speaker']}.mp3"
            target = DESTINATION / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(staging / relative, target)
        write_json(
            DESTINATION / "manifest.json",
            {
                "version": 1,
                "synthetic": True,
                "text": SAMPLE_TEXT,
                "seed": SEED,
                "samples": samples,
            },
        )
        print(
            f"VOICE_SAMPLES_COMPLETE: {len(samples)} samples, "
            f"{sum(sample['bytes'] for sample in samples)} bytes; {DESTINATION}",
            flush=True,
        )


if __name__ == "__main__":
    main()
