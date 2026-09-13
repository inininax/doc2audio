"""Allow the documented UTF-8 text size before FastAPI binds form arguments."""

from fastapi import HTTPException, Request
from fastapi.routing import APIRoute

MAX_TEXT_BYTES = 4_000_000  # One million Unicode characters, up to four bytes each.


class DocumentRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def handle(request: Request):
            if self.path == "/api/jobs" and request.method == "POST":
                receive = request.receive
                limit = request.app.state.max_request_body_size
                received = 0

                async def bounded_receive():
                    nonlocal received
                    message = await receive()
                    if message["type"] == "http.request":
                        received += len(message.get("body", b""))
                        if received > limit:
                            # Stop before the multipart parser spools this chunk.
                            # Its error cleanup closes files opened by earlier chunks.
                            raise HTTPException(413, "파일은 100 MB 이하여야 합니다.")
                    return message

                request = Request(request.scope, receive=bounded_receive)
                # FormData is cached on this request. FastAPI's parameter parser
                # reuses it, while this scope closes uploads on validation failures too.
                async with request.form(max_files=1, max_fields=8, max_part_size=MAX_TEXT_BYTES):
                    return await handler(request)
            return await handler(request)

        return handle
