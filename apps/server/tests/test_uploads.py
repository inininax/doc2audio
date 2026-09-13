"""Exercise actual ASGI request streaming and multipart temporary-file cleanup."""

import asyncio

import httpx
import pytest
from starlette import formparsers
from starlette.datastructures import UploadFile

from doc2audio_server.app import create_app


@pytest.mark.parametrize("oversized", [False, True])
def test_chunked_upload_is_bounded_and_closes_parser_files(tmp_path, monkeypatch, oversized):
    monkeypatch.setattr("doc2audio_server.app.MAX_UPLOAD", 1024)
    monkeypatch.setattr("doc2audio_server.app.missing_files", lambda _: [])
    monkeypatch.setattr("doc2audio_server.app.shutil.which", lambda _: "/test/ffmpeg")
    app = create_app(tmp_path, start_worker=False)
    files = []
    written = 0
    yielded = 0
    original_file = formparsers.SpooledTemporaryFile
    original_write = UploadFile.write

    def temporary(*args, **kwargs):
        file = original_file(*args, **kwargs)
        files.append(file)
        return file

    async def write(file, data):
        nonlocal written
        written += len(data)
        return await original_write(file, data)

    monkeypatch.setattr(formparsers, "SpooledTemporaryFile", temporary)
    monkeypatch.setattr(UploadFile, "write", write)
    boundary = "doc2audio-stream-test"
    prefix = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="model_id"\r\n\r\n'
        f'supertonic-3\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; '
        'filename="document.txt"\r\nContent-Type: text/plain\r\n\r\n'
    ).encode()
    total = 2 * 1024 * 1024 if oversized else 512

    async def body():
        nonlocal yielded
        yield prefix
        for offset in range(0, total, 65536):
            chunk = b"x" * min(65536, total - offset)
            yielded += len(chunk)
            yield chunk
        yield f"\r\n--{boundary}--\r\n".encode()

    async def submit():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:8010"
        ) as client:
            return await client.post(
                "/api/jobs",
                headers={
                    "X-Doc2Audio": "1",
                    "Content-Type": f"multipart/form-data; boundary={boundary}",
                },
                content=body(),
            )

    response = asyncio.run(submit())
    assert "content-length" not in response.request.headers
    assert response.request.headers["transfer-encoding"] == "chunked"
    assert files and all(file.closed for file in files)
    if oversized:
        assert response.status_code == 413, response.text
        # The request permits 1 MiB multipart overhead in addition to file bytes.
        assert written <= 1024 + 1024 * 1024
        assert yielded < total, "The entire oversized request was consumed before rejecting it"
        assert app.state.store.list() == []
        assert not (tmp_path / "jobs").exists()
    else:
        assert response.status_code == 202, response.text
        source = tmp_path / "jobs" / response.json()["id"] / "source.txt"
        assert source.read_bytes() == b"x" * total


def test_cancelled_upload_copy_removes_unregistered_source(tmp_path, monkeypatch):
    monkeypatch.setattr("doc2audio_server.app.missing_files", lambda _: [])
    monkeypatch.setattr("doc2audio_server.app.shutil.which", lambda _: "/test/ffmpeg")
    app = create_app(tmp_path, start_worker=False)
    original_read = UploadFile.read
    uploads = []

    async def cancel_during_copy():
        copying = asyncio.Event()
        reads = 0

        async def read(file, size=-1):
            nonlocal reads
            reads += 1
            if reads == 2:
                uploads.append(file)
                copying.set()
                await asyncio.Event().wait()
            return await original_read(file, size)

        monkeypatch.setattr(UploadFile, "read", read)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:8010"
        ) as client:
            task = asyncio.create_task(
                client.post(
                    "/api/jobs",
                    headers={"X-Doc2Audio": "1"},
                    data={"model_id": "supertonic-3"},
                    files={"file": ("source.txt", b"x" * (1024 * 1024 + 1))},
                )
            )
            await asyncio.wait_for(copying.wait(), timeout=3)
            partial = list((tmp_path / "jobs").glob("*/source.txt"))
            assert len(partial) == 1 and partial[0].stat().st_size == 1024 * 1024
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

    asyncio.run(cancel_during_copy())
    assert app.state.store.list() == []
    assert not list((tmp_path / "jobs").iterdir())
    assert uploads and all(file.file.closed for file in uploads)
