"""Opt-in real server recovery/cancellation check with installed Supertonic 3.

Run: uv run python scripts/verify_server_runtime.py
Uses isolated data, an ephemeral localhost port, and real speech (no mock).
"""

import json
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output/upgrade"


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    storage = OUTPUT / f"server-verification-{int(time.time())}"
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    process = None
    log = (OUTPUT / "server-verification.log").open("w")

    def request(path, data=None):
        body = urllib.parse.urlencode(data).encode() if data is not None else None
        req = urllib.request.Request(base + "/api" + path, data=body, headers={"X-Doc2Audio": "1"})
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.load(response)

    def wait_for(fn, timeout=180):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            result = fn()
            if result:
                return result
            time.sleep(0.25)
        raise AssertionError("Verification timed out")

    def start():
        nonlocal process
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "doc2audio_server.main",
                "--port",
                str(port),
                "--data-dir",
                str(storage),
            ],
            stdout=log,
            stderr=log,
        )

        def ready():
            if process.poll() is not None:
                raise RuntimeError("Server failed to start")
            try:
                return request("/health")
            except OSError:
                return None

        wait_for(ready, 20)

    try:
        start()
        job = request(
            "/jobs",
            {
                "model_id": "supertonic-3",
                "title": "서버 재시작 검증",
                "text": ("첫 문장을 읽습니다. 작업 기록은 서버에 남습니다.\n\n" * 6),
                "options": json.dumps({"total_steps": 5}),
            },
        )
        route = "/jobs/" + job["id"]
        wait_for(lambda: request(route)["progress"] > 0)
        process.terminate()
        process.wait(timeout=15)
        start()
        interrupted = request(route)
        assert interrupted["status"] == "interrupted", interrupted
        request(route + "/retry", {})

        def completed():
            current = request(route)
            assert current["status"] not in {"failed", "cancelled", "interrupted"}, current
            return current if current["status"] == "completed" else None

        done = wait_for(completed)
        assert done["result"]["reused_chunks"] >= 1, done
        assert done["attempt"] == 2
        cancel_job = request(
            "/jobs", {"model_id": "supertonic-3", "text": "취소할 작업입니다. " * 30}
        )
        cancel_route = "/jobs/" + cancel_job["id"]
        wait_for(lambda: request(cancel_route)["status"] == "running")
        request(cancel_route + "/cancel", {})
        wait_for(lambda: request(cancel_route)["status"] == "cancelled", 15)
        process.terminate()
        process.wait(timeout=15)
        start()
        assert request(route)["status"] == "completed"
        assert request(cancel_route)["status"] == "cancelled"
        assert request("/jobs")["total"] == 2
        evidence = {"completed": done, "cancelled": request(cancel_route), "storage": str(storage)}
        (OUTPUT / "server-recovery-results.json").write_text(
            json.dumps(evidence, ensure_ascii=False, indent=2)
        )
        print(
            "REAL_SERVER_PASS: recovery, cached resume, cancellation, persistent history",
            flush=True,
        )
    finally:
        if process and process.poll() is None:
            process.terminate()
            process.wait(timeout=15)
        log.close()


if __name__ == "__main__":
    main()
