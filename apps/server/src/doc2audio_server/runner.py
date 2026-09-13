"""Single local worker lane, isolated processes, and graceful cancellation."""

import contextlib
import fcntl
import logging
import os
import signal
import subprocess
import sys
import threading

from .store import Store

logger = logging.getLogger(__name__)


class Runner:
    def __init__(self, store: Store):
        self.store = store
        self.stop_event = threading.Event()
        self.child = None
        self.thread = None
        self.lock_file = None

    def start(self):
        self.lock_file = (self.store.root / "server.lock").open("a")
        try:
            fcntl.flock(self.lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.lock_file.close()
            raise RuntimeError(
                "이 데이터 폴더를 사용하는 서버 또는 작업이 이미 실행 중입니다."
            ) from None
        try:
            self.store.recover()
            self.thread = threading.Thread(target=self.run, name="doc2audio-queue", daemon=True)
            self.thread.start()
        except Exception:
            self.lock_file.close()
            raise

    def _update(self, job_id, **fields):
        """Do not lose terminal status on a temporary ledger failure."""
        while True:
            try:
                return self.store.update(job_id, **fields)
            except Exception:
                logger.exception("작업 %s 상태 저장 실패; 1초 후 다시 시도합니다.", job_id)
                if self.stop_event.wait(1):
                    return False

    def _terminate_child(self):
        """Reap the owned process before releasing the lane, including error paths."""
        child = self.child
        if child is None:
            return True
        try:
            if child.poll() is None:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    with contextlib.suppress(ProcessLookupError):
                        os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
        except Exception:
            # Keep ownership and stop claiming work if the OS cannot confirm exit.
            logger.exception("작업 프로세스를 종료하지 못했습니다. 대기열을 중단합니다.")
            return False
        self.child = None
        return True

    def run(self):
        while not self.stop_event.is_set():
            try:
                job = self.store.claim()
            except Exception:
                logger.exception("대기열을 읽지 못했습니다. 1초 후 다시 시도합니다.")
                self.stop_event.wait(1)
                continue
            if job is None:
                self.stop_event.wait(0.3)
                continue
            folder = self.store.root / "jobs" / job["id"]
            error = None
            stopped = None
            returncode = None
            try:
                folder.mkdir(parents=True, exist_ok=True, mode=0o700)
                with (folder / "worker.log").open("a") as log:
                    # Inherit the lock: a second server cannot recover a live orphan worker.
                    child = self.child = subprocess.Popen(
                        [
                            sys.executable,
                            "-m",
                            "doc2audio_server.worker",
                            str(self.store.root),
                            job["id"],
                        ],
                        stdout=log,
                        stderr=log,
                        start_new_session=True,
                        pass_fds=(self.lock_file.fileno(),),
                    )
                    while child.poll() is None:
                        current = self.store.get(job["id"])
                        if not current:
                            raise RuntimeError("실행 중인 작업 기록을 찾을 수 없습니다.")
                        if self.stop_event.is_set() or current["status"] == "cancelling":
                            stopped = "interrupted" if self.stop_event.is_set() else "cancelled"
                            break
                        self.stop_event.wait(0.2)
                    returncode = child.returncode
            except Exception as exc:
                error = str(exc)
            finally:
                # Even a subsequent database update can fail or block. End inference
                # first, then persist its status; never abandon a still-live child.
                if not self._terminate_child():
                    self.stop_event.set()
                    error = error or "작업 프로세스를 종료하지 못했습니다. 서버를 확인하세요."
            if error is not None:
                self._update(
                    job["id"],
                    expected=["running", "cancelling"],
                    status="failed",
                    error=error,
                    message="작업을 실행하지 못했습니다.",
                )
            elif stopped:
                self._update(
                    job["id"],
                    expected=["running", "cancelling"],
                    status=stopped,
                    message="작업이 중단되었습니다. 재시도할 수 있습니다.",
                )
            else:
                self._update(
                    job["id"],
                    expected=["cancelling"],
                    status="cancelled",
                    message="작업을 취소했습니다.",
                )
                self._update(
                    job["id"],
                    expected=["running"],
                    status="failed",
                    error=f"작업 프로세스 종료 코드: {returncode}",
                    message="작업 프로세스가 완료 결과 없이 종료되었습니다.",
                )

    def close(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=10)
            if self.thread.is_alive():
                logger.error("대기열 종료가 지연되고 있어 서버 잠금을 유지합니다.")
                return
        if not self._terminate_child():
            return
        if self.lock_file:
            self.lock_file.close()
