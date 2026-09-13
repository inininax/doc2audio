"""One job per process keeps MLX memory and offline environment isolated."""

import re
import sys
from pathlib import Path

from doc2audio.engines import install_model
from doc2audio.pipeline import convert_document

from .store import Store


def execute(store: Store, job_id: str):
    job = store.get(job_id)
    if not job or job["status"] != "running":
        return
    try:
        if job["kind"] == "download":
            path = install_model(
                job["model_id"],
                lambda message, fraction: store.update(
                    job_id, expected=["running"], message=message, progress=min(0.99, fraction)
                ),
            )
            result = {"model_id": job["model_id"], "path": str(path)}
        else:

            def progress(message):
                if message.startswith("이어하기 저장 위치:"):
                    message = "작업용 음성 구간을 준비합니다."
                fields = {"message": message}
                match = re.search(r"\[(\d+)/(\d+)\]", message)
                if match:
                    current, total = map(int, match.groups())
                    completed = (
                        current if ("완료" in message or "재사용" in message) else current - 1
                    )
                    fields["progress"] = min(0.95, completed / total * 0.95)
                store.update(job_id, expected=["running"], **fields)

            folder = store.root / "jobs" / job_id
            result = convert_document(
                Path(job["source"]),
                folder / "audio.mp3",
                model_id=job["model_id"],
                generation_options=job["options"]["voice"],
                offline=True,
                overwrite=True,
                pages=job["options"].get("pages"),
                ocr=job["options"].get("ocr", "auto"),
                work_dir=folder / "chunks",
                progress=progress,
            )
        store.update(
            job_id,
            expected=["running"],
            status="completed",
            progress=1,
            message="완료했습니다.",
            result=result,
            error=None,
        )
    except Exception as exc:
        store.update(
            job_id,
            expected=["running"],
            status="failed",
            error=str(exc)[:4000],
            message="작업에 실패했습니다. 오류를 확인하고 재시도할 수 있습니다.",
        )
        raise


if __name__ == "__main__":
    execute(Store(Path(sys.argv[1])), sys.argv[2])
