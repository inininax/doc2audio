"""Inspect and remove only catalog-owned model files without following links."""

import base64
import hashlib
import os
import stat
from pathlib import Path

from doc2audio.catalog import get_model, model_path
from doc2audio.errors import Doc2AudioError
from doc2audio.model_lock import model_lock
from doc2audio.paths import models_dir, workspace_root

ACTIVE_MODEL_REASON = "이 모델을 사용하는 대기·실행·중단 처리 중인 작업이 있습니다."


class UnsafeModelPath(Doc2AudioError):
    pass


def checked_path(model_id: str, protected_root: Path) -> Path:
    get_model(model_id)
    root = models_dir()
    path = model_path(model_id)
    if root in {Path(root.anchor), Path.home(), workspace_root()} or path.parent != root:
        raise UnsafeModelPath("모델 전용 저장 폴더가 아니어서 자동 삭제할 수 없습니다.")
    if path.is_symlink() or path.resolve() != path:
        raise UnsafeModelPath("심볼릭 링크 또는 모델 저장소 밖의 폴더는 삭제할 수 없습니다.")
    for protected in (protected_root / "jobs", protected_root / "jobs.sqlite3", protected_root):
        if path == protected or protected.is_relative_to(path):
            raise UnsafeModelPath("작업 기록·원문 저장 위치와 겹쳐 삭제할 수 없습니다.")
    if path.is_relative_to(protected_root / "jobs"):
        raise UnsafeModelPath("작업 기록·원문 저장 위치와 겹쳐 삭제할 수 없습니다.")
    return path


def allowed_file(relative: str, names: set[str]) -> bool:
    if relative in names or relative in {
        ".cache/huggingface/.gitignore",
        ".cache/huggingface/CACHEDIR.TAG",
    }:
        return True
    prefix = ".cache/huggingface/download/"
    if not relative.startswith(prefix):
        return False
    cached = relative.removeprefix(prefix)
    if cached.endswith((".metadata", ".lock")):
        return cached.rsplit(".", 1)[0] in names
    for name in names:
        source = Path(name)
        digest = base64.urlsafe_b64encode(
            hashlib.sha1(f"{source.name}.metadata".encode()).digest()
        ).decode()
        partial = Path(cached)
        if (
            partial.parent == source.parent
            and partial.name.startswith((f"{digest}.", f"{source.name}."))
            and partial.name.endswith(".incomplete")
        ):
            return True
    return False


def scan_files(fd: int, names: set[str]):
    """Return a no-follow snapshot; keep unknown files visible but block removal."""
    files, directories = [], []
    reason = None
    device = os.fstat(fd).st_dev

    def visit(current: int, prefix: str):
        nonlocal reason
        with os.scandir(current) as entries:
            for entry in entries:
                relative = f"{prefix}{entry.name}"
                info = entry.stat(follow_symlinks=False)
                if stat.S_ISLNK(info.st_mode) or info.st_dev != device:
                    reason = "심볼릭 링크 또는 다른 파일시스템이 포함되어 삭제할 수 없습니다."
                elif stat.S_ISDIR(info.st_mode):
                    directories.append(relative)
                    child = os.open(
                        entry.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current
                    )
                    try:
                        visit(child, f"{relative}/")
                    finally:
                        os.close(child)
                elif stat.S_ISREG(info.st_mode):
                    files.append((relative, info))
                    if not allowed_file(relative, names):
                        reason = "모델 파일 이외의 파일이 들어 있어 자동 삭제할 수 없습니다."
                else:
                    reason = "일반 모델 파일이 아닌 항목이 있어 삭제할 수 없습니다."

    visit(fd, "")
    return files, directories, reason


def open_folder(path: Path):
    return os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)


def storage_info(model_id: str, protected_root: Path, *, active=False) -> dict:
    path = model_path(model_id)
    result = {
        "kind": "filesystem",
        "location": str(path),
        "used_bytes": 0,
        "has_data": False,
        "can_delete": False,
    }
    reason = None
    try:
        path = checked_path(model_id, protected_root)
        try:
            fd = open_folder(path)
        except FileNotFoundError:
            with model_lock(path, exclusive=True, create=False):
                pass
            if active:
                result["delete_blocked_reason"] = ACTIVE_MODEL_REASON
            return result
        try:
            files, directories, reason = scan_files(fd, set(get_model(model_id)["files"]))
            result["used_bytes"] = sum(info.st_size for _, info in files)
            result["has_data"] = bool(files or directories)
        finally:
            os.close(fd)
        if not reason:
            # A read-only probe must not create a model directory or lock file.
            with model_lock(path, exclusive=True, create=False):
                pass
    except (Doc2AudioError, OSError, RuntimeError) as exc:
        reason = (
            str(exc)
            if isinstance(exc, Doc2AudioError)
            else "모델 폴더를 안전하게 읽을 수 없습니다."
        )
        result["has_data"] = path.exists() or path.is_symlink()
    if active:
        reason = ACTIVE_MODEL_REASON
    if reason:
        result["delete_blocked_reason"] = reason
    result["can_delete"] = result["has_data"] and not reason
    return result


def remove_model_files(model_id: str, protected_root: Path) -> int:
    """Caller holds the database writer transaction and exclusive model lease."""
    path = checked_path(model_id, protected_root)
    try:
        fd = open_folder(path)
    except FileNotFoundError:
        return 0
    try:
        folder_stat = os.fstat(fd)
        files, directories, reason = scan_files(fd, set(get_model(model_id)["files"]))
        if reason:
            raise UnsafeModelPath(reason)
        freed = 0
        for relative, original in files:
            parent = os.dup(fd)
            try:
                parts = Path(relative).parts
                for part in parts[:-1]:
                    child = os.open(
                        part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent
                    )
                    os.close(parent)
                    parent = child
                current = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
                if (current.st_dev, current.st_ino, current.st_mode, current.st_size) != (
                    original.st_dev,
                    original.st_ino,
                    original.st_mode,
                    original.st_size,
                ):
                    raise UnsafeModelPath(
                        "모델 폴더가 변경되었습니다. 상태를 확인한 뒤 재시도하세요."
                    )
                os.unlink(parts[-1], dir_fd=parent)
                freed += current.st_size
            finally:
                os.close(parent)
        # Only empty directories are removed. New/unrecognized user files survive.
        for relative in sorted(directories, key=lambda name: name.count("/"), reverse=True):
            parent = os.dup(fd)
            try:
                parts = Path(relative).parts
                for part in parts[:-1]:
                    child = os.open(
                        part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent
                    )
                    os.close(parent)
                    parent = child
                os.rmdir(parts[-1], dir_fd=parent)
            except OSError:
                pass
            finally:
                os.close(parent)
    finally:
        os.close(fd)
    try:
        current = path.lstat()
        if (current.st_dev, current.st_ino) == (folder_stat.st_dev, folder_stat.st_ino):
            path.rmdir()
    except OSError:
        pass
    return freed
