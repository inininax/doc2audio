"""Shared model leases for CLI/server readers and exclusive model removal."""

import fcntl
import hashlib
import os
import stat
import weakref
from contextlib import contextmanager
from functools import wraps
from pathlib import Path

from .errors import Doc2AudioError


class ModelBusyError(Doc2AudioError):
    pass


def lock_path(path: Path) -> Path:
    path = path.expanduser().resolve()
    key = hashlib.sha256(os.fsencode(path)).hexdigest()
    return path.parent / ".doc2audio-model-locks" / f"{key}.lock"


def acquire_model_lock(path: Path, *, exclusive=False, create=True):
    """The lock lives outside the model and is never removed with model files."""
    target = lock_path(path)
    if create:
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    elif not target.parent.exists():
        return None
    if target.parent.is_symlink() or not target.parent.is_dir():
        raise ModelBusyError("모델 잠금 폴더를 안전하게 열 수 없습니다.")
    flags = os.O_RDWR | os.O_NOFOLLOW | (os.O_CREAT if create else 0)
    try:
        fd = os.open(target, flags, 0o600)
    except FileNotFoundError:
        if not create:
            return None
        raise
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ModelBusyError("모델 잠금 파일이 올바르지 않습니다.")
        fcntl.flock(fd, (fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH) | fcntl.LOCK_NB)
    except BlockingIOError as exc:
        os.close(fd)
        raise ModelBusyError("이 모델을 사용하는 변환·다운로드 또는 삭제가 진행 중입니다.") from exc
    except BaseException:
        os.close(fd)
        raise
    return os.fdopen(fd, "a")


@contextmanager
def model_lock(path: Path, *, exclusive=False, create=True):
    lease = acquire_model_lock(path, exclusive=exclusive, create=create)
    try:
        yield
    finally:
        if lease is not None:
            lease.close()


def model_instance_lock(initialize):
    """Hold the shared lease for the narrator's entire lifetime, including direct use."""

    @wraps(initialize)
    def guarded(self, path, *args, **kwargs):
        lease = acquire_model_lock(Path(path))
        try:
            initialize(self, path, *args, **kwargs)
        except BaseException:
            lease.close()
            raise
        weakref.finalize(self, lease.close)

    return guarded
