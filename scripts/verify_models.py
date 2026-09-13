"""Opt-in real TTS checks with Python network sockets blocked during inference.

Run after model installation: uv run python scripts/verify_models.py
Each model runs in a fresh process. Results stay in output/upgrade/.
"""

import json
import socket
import subprocess
import sys
import uuid
from pathlib import Path

from doc2audio.catalog import CATALOG
from doc2audio.pipeline import convert_document

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output/upgrade"


def generate(model_id):
    original = socket.socket.connect

    def local_only(sock, address):
        if sock.family in (socket.AF_INET, socket.AF_INET6):
            raise RuntimeError(f"Inference attempted network access: {address}")
        return original(sock, address)

    socket.socket.connect = local_only
    source = OUTPUT / "network-blocked.txt"
    source.write_text("안녕하세요. 내 컴퓨터에서 문서를 목소리로 바꿉니다.", encoding="utf-8")
    result = convert_document(
        source,
        OUTPUT / f"{model_id}-offline.mp3",
        model_id=model_id,
        generation_options={"seed": 913},
        offline=True,
        overwrite=True,
        work_dir=OUTPUT / "offline-runs" / uuid.uuid4().hex,
    )
    assert result["reused_chunks"] == 0, "Actual inference was bypassed by the audio cache"
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration,size:stream=codec_name,sample_rate,channels",
            "-of",
            "json",
            result["output"],
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    result["ffprobe"] = json.loads(probe.stdout)
    assert result["ffprobe"]["streams"][0]["codec_name"] == "mp3"
    assert float(result["ffprobe"]["format"]["duration"]) > 1
    result["network_check"] = "Python AF_INET/AF_INET6 socket.connect blocked"
    (OUTPUT / f"{model_id}-verified.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2)
    )
    print(f"REAL_MODEL_PASS: {model_id}", flush=True)


if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    if len(sys.argv) > 1:
        generate(sys.argv[1])
    else:
        for model in CATALOG["models"]:
            subprocess.run([sys.executable, __file__, model["id"]], check=True)
