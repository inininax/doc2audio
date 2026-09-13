"""Local-only HTTP interface for model downloads and persistent narration jobs."""

import json
import platform
import shutil
import sqlite3
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from anyio import CancelScope
from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from doc2audio.catalog import CATALOG, get_model, missing_files, public_models, validate_options
from doc2audio.errors import Doc2AudioError
from doc2audio.paths import data_dir, workspace_root

from .routes import DocumentRoute
from .runner import Runner
from .store import Store

MAX_UPLOAD = 100 * 1024 * 1024
SUFFIXES = {".txt", ".pdf", ".docx", ".doc"}


def create_app(root: Path | None = None, *, start_worker=True, web_dir: Path | None = None):
    store = Store(root or data_dir())
    runner = Runner(store)

    @asynccontextmanager
    async def lifespan(app):
        if start_worker:
            runner.start()
        try:
            yield
        finally:
            if start_worker:
                runner.close()

    app = FastAPI(title="doc2audio local API", version="0.2.0", lifespan=lifespan)
    app.router.route_class = DocumentRoute
    app.state.store = store
    app.state.runner = runner
    app.state.max_request_body_size = MAX_UPLOAD + 1024 * 1024
    app.add_middleware(
        TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "[::1]", "testserver"]
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-Doc2Audio"],
    )

    @app.middleware("http")
    async def local_mutations(request: Request, call_next):
        if request.method == "POST":
            if request.headers.get("x-doc2audio") != "1":
                return JSONResponse(
                    {"detail": "X-Doc2Audio 요청 헤더가 필요합니다."}, status_code=403
                )
            origin = request.headers.get("origin")
            allowed = {
                str(request.base_url).rstrip("/"),
                "http://localhost:5173",
                "http://127.0.0.1:5173",
            }
            if origin and origin not in allowed:
                return JSONResponse({"detail": "허용되지 않은 요청 출처입니다."}, status_code=403)
            length = request.headers.get("content-length")
            if length and (not length.isdecimal() or int(length) > app.state.max_request_body_size):
                return JSONResponse({"detail": "파일은 100 MB 이하여야 합니다."}, status_code=413)
        return await call_next(request)

    @app.exception_handler(sqlite3.IntegrityError)
    async def conflict(request, exc):
        return JSONResponse(
            {"detail": "동일한 모델 다운로드가 이미 대기 또는 진행 중입니다."}, status_code=409
        )

    @app.exception_handler(Doc2AudioError)
    async def domain_error(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    def find(job_id):
        job = store.get(job_id)
        if not job:
            raise HTTPException(404, "작업을 찾을 수 없습니다.")
        return job

    def public_job(job):
        value = {k: v for k, v in job.items() if k != "source"}
        if value["result"]:
            value["result"] = {
                k: v for k, v in value["result"].items() if k not in {"path", "output"}
            }
        value["audio_url"] = (
            f"/api/jobs/{job['id']}/audio"
            if job["kind"] == "conversion" and job["status"] == "completed"
            else None
        )
        return value

    @app.get("/api/health")
    def health():
        return {
            "status": "ok",
            "version": "0.2.0",
            "platform": platform.system(),
            "machine": platform.machine(),
            "ffmpeg": bool(shutil.which("ffmpeg")),
            "catalog_reviewed_at": CATALOG["reviewed_at"],
        }

    @app.get("/api/models")
    def models():
        return {"items": public_models(), "reviewed_at": CATALOG["reviewed_at"]}

    @app.post("/api/models/{model_id}/download", status_code=202)
    def download(model_id: str):
        model = get_model(model_id)
        with store.connection() as db:
            row = db.execute(
                "SELECT * FROM jobs WHERE kind='download' AND model_id=? "
                "AND status IN ('queued','running','cancelling')",
                (model_id,),
            ).fetchone()
        if row:
            return public_job(store.decode(row))
        return public_job(
            store.create(kind="download", model_id=model_id, title=f"{model['name']} 다운로드")
        )

    @app.get("/api/jobs")
    def jobs(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0)):
        with store.connection() as db:
            total = db.execute("SELECT count(*) FROM jobs").fetchone()[0]
        return {"items": [public_job(j) for j in store.list(limit, offset)], "total": total}

    @app.get("/api/jobs/{job_id}")
    def detail(job_id: str):
        return {**public_job(find(job_id)), "events": store.events(job_id)}

    @app.post("/api/jobs", status_code=202)
    async def submit(
        model_id: str = Form(...),
        options: str = Form("{}"),
        text: str = Form(""),
        title: str = Form(""),
        pages: str = Form(""),
        ocr: str = Form("auto"),
        file: Annotated[UploadFile | None, File()] = None,
    ):
        get_model(model_id)
        try:
            voice = validate_options(model_id, json.loads(options))
        except (ValueError, TypeError) as exc:
            raise HTTPException(422, "음성 설정 JSON이 올바르지 않습니다.") from exc
        if ocr not in {"auto", "always", "never"}:
            raise HTTPException(422, "OCR 설정이 올바르지 않습니다.")
        if len(pages) > 200 or len(title) > 200:
            raise HTTPException(422, "제목 또는 페이지 범위가 너무 깁니다.")
        if bool(file and file.filename) == bool(text.strip()):
            raise HTTPException(422, "문서 파일 또는 텍스트 중 하나를 입력하세요.")
        if missing_files(model_id):
            raise HTTPException(409, "먼저 선택한 모델을 다운로드하세요.")
        if not shutil.which("ffmpeg"):
            raise HTTPException(409, "ffmpeg를 설치한 뒤 서버를 다시 실행하세요.")
        job_id = uuid.uuid4().hex
        folder = store.root / "jobs" / job_id
        folder.mkdir(parents=True, mode=0o700)
        try:
            if file and file.filename:
                filename = Path(file.filename.replace("\\", "/")).name
                suffix = Path(filename).suffix.lower()
                if suffix not in SUFFIXES:
                    raise HTTPException(422, "PDF, DOCX, DOC, UTF-8 TXT 파일을 지원합니다.")
                source = folder / ("source" + suffix)
                size = 0
                with source.open("wb") as output:
                    while chunk := await file.read(1024 * 1024):
                        size += len(chunk)
                        if size > MAX_UPLOAD:
                            raise HTTPException(413, "파일은 100 MB 이하여야 합니다.")
                        output.write(chunk)
                if not size:
                    raise HTTPException(422, "빈 파일은 변환할 수 없습니다.")
            else:
                if len(text) > 1_000_000:
                    raise HTTPException(413, "텍스트는 백만 글자 이하여야 합니다.")
                filename = "직접 입력한 텍스트"
                source = folder / "source.txt"
                source.write_text(text, encoding="utf-8")
            job = store.create(
                kind="conversion",
                model_id=model_id,
                title=title.strip() or filename[:200],
                source=str(source),
                options={"voice": voice, "pages": pages.strip() or None, "ocr": ocr},
                job_id=job_id,
            )
        except BaseException:
            # Request cancellation also abandons this unregistered source copy.
            shutil.rmtree(folder)
            raise
        finally:
            if file:
                # Rolled uploads close in a worker thread; allow that cleanup to
                # finish even when the surrounding request scope is cancelled.
                with CancelScope(shield=True):
                    await file.close()
        return public_job(job)

    @app.post("/api/jobs/{job_id}/cancel")
    def cancel(job_id: str):
        find(job_id)
        if not store.update(
            job_id, expected=["queued"], status="cancelled", message="대기를 취소했습니다."
        ):
            store.update(
                job_id,
                expected=["running"],
                status="cancelling",
                message="작업을 중단하는 중입니다.",
            )
        return public_job(find(job_id))

    @app.post("/api/jobs/{job_id}/retry")
    def retry(job_id: str):
        job = find(job_id)
        if not store.update(
            job_id,
            expected=["failed", "cancelled", "interrupted"],
            status="queued",
            progress=0,
            error=None,
            result=None,
            attempt=job["attempt"] + 1,
            message="다시 대기열에 등록했습니다.",
        ):
            raise HTTPException(409, "실패하거나 중단된 작업만 재시도할 수 있습니다.")
        return public_job(find(job_id))

    @app.get("/api/jobs/{job_id}/audio")
    def audio(job_id: str):
        job = find(job_id)
        if job["kind"] != "conversion" or job["status"] != "completed":
            raise HTTPException(409, "완료된 음성이 없습니다.")
        path = store.root / "jobs" / job_id / "audio.mp3"
        if not path.is_file():
            raise HTTPException(404, "저장된 음성 파일을 찾을 수 없습니다.")
        return FileResponse(path, media_type="audio/mpeg", filename=f"{job['title'][:100]}.mp3")

    root_dir = workspace_root()
    web_dir = web_dir or (root_dir / "apps/web/dist" if root_dir else None)
    if web_dir and (web_dir / "index.html").is_file():
        app.mount("/", StaticFiles(directory=web_dir, html=True), name="web")
    else:

        @app.get("/")
        def setup():
            return {"message": "npm ci && npm run build 후 서버를 다시 실행하세요."}

    return app
