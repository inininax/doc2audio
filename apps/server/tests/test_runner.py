"""Queue recovery tests use synthetic owned processes, never fake narration outputs."""

import signal
import sqlite3
import subprocess
import sys
import threading

import pytest

from doc2audio_server.runner import Runner
from doc2audio_server.store import Store


class CompletedChild:
    returncode = 0

    def poll(self):
        return self.returncode


@pytest.mark.parametrize("fail_terminal_update", [False, True])
def test_read_failure_reaps_real_child_before_next_job(
    tmp_path, monkeypatch, caplog, fail_terminal_update
):
    store = Store(tmp_path)
    first = store.create(kind="download", model_id="supertonic-3", title="First")
    second = store.create(kind="download", model_id="qwen3-0.6b", title="Second")
    original_get = store.get
    original_update = store.update
    original_popen = subprocess.Popen
    child = None
    started = []
    second_started = threading.Event()
    read_failed = False
    update_failed = False

    def get(job_id):
        nonlocal read_failed
        if job_id == first["id"] and started and not read_failed:
            read_failed = True
            raise sqlite3.OperationalError("Injected database read failure")
        return original_get(job_id)

    def update(job_id, **fields):
        nonlocal update_failed
        if job_id == first["id"] and fields.get("status") == "failed":
            assert child.poll() is not None, "Status persistence must not delay process cleanup"
            if fail_terminal_update and not update_failed:
                update_failed = True
                raise sqlite3.OperationalError("Injected terminal status write failure")
        return original_update(job_id, **fields)

    def spawn(command, **kwargs):
        nonlocal child
        started.append(command[-1])
        if len(started) == 1:
            # Exercise real process-group termination and wait/reaping. This
            # synthetic sleeper has no model/network activity or output artifact.
            child = original_popen([sys.executable, "-c", "import time; time.sleep(30)"], **kwargs)
            return child
        assert child.poll() is not None, "Two inference workers must never share the lane"
        assert original_get(first["id"])["status"] == "failed"
        original_update(second["id"], expected=["running"], status="completed")
        second_started.set()
        return CompletedChild()

    monkeypatch.setattr(store, "get", get)
    monkeypatch.setattr(store, "update", update)
    monkeypatch.setattr("doc2audio_server.runner.subprocess.Popen", spawn)
    runner = Runner(store)
    runner.start()
    try:
        assert second_started.wait(4)
        assert started == [first["id"], second["id"]]
        assert child.returncode == -signal.SIGTERM
        assert original_get(first["id"])["error"] == "Injected database read failure"
        assert runner.thread.is_alive()
        if fail_terminal_update:
            assert update_failed
            assert "상태 저장 실패" in caplog.text
    finally:
        runner.close()
        if child and child.poll() is None:
            child.kill()
            child.wait()


def test_transient_claim_failure_keeps_queue_alive_and_retries(tmp_path, monkeypatch, caplog):
    store = Store(tmp_path)
    job = store.create(kind="download", model_id="supertonic-3", title="Claim recovery")
    original_claim = store.claim
    calls = 0
    completed = threading.Event()

    def claim():
        nonlocal calls
        calls += 1
        if calls == 1:
            raise sqlite3.OperationalError("Injected temporary ledger lock")
        return original_claim()

    def spawn(command, **kwargs):
        store.update(job["id"], expected=["running"], status="completed")
        completed.set()
        return CompletedChild()

    monkeypatch.setattr(store, "claim", claim)
    monkeypatch.setattr("doc2audio_server.runner.subprocess.Popen", spawn)
    runner = Runner(store)
    runner.start()
    try:
        assert completed.wait(3)
        assert calls >= 2
        assert store.get(job["id"])["status"] == "completed"
        assert runner.thread.is_alive()
        assert "대기열을 읽지 못했습니다" in caplog.text
    finally:
        runner.close()


def test_error_cleanup_escalates_to_kill_before_releasing_child(tmp_path, monkeypatch):
    runner = Runner(Store(tmp_path))
    signals = []

    class StubbornChild:
        pid = 424242
        returncode = None
        waits = 0

        def poll(self):
            return self.returncode

        def wait(self, timeout=None):
            self.waits += 1
            if self.waits == 1:
                raise subprocess.TimeoutExpired("synthetic-child", timeout)
            self.returncode = -signal.SIGKILL
            return self.returncode

    child = runner.child = StubbornChild()
    monkeypatch.setattr(
        "doc2audio_server.runner.os.killpg", lambda pid, sig: signals.append((pid, sig))
    )
    assert runner._terminate_child()
    assert signals == [(child.pid, signal.SIGTERM), (child.pid, signal.SIGKILL)]
    assert child.returncode == -signal.SIGKILL
    assert runner.child is None


def test_startup_failure_releases_process_lock(tmp_path, monkeypatch):
    store = Store(tmp_path)

    def fail():
        raise sqlite3.OperationalError("Injected startup ledger failure")

    monkeypatch.setattr(store, "recover", fail)
    with pytest.raises(sqlite3.OperationalError):
        Runner(store).start()
    replacement = Runner(Store(tmp_path))
    replacement.start()
    replacement.close()
