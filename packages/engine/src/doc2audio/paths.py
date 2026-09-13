"""Stable storage paths shared by the CLI and the local server."""

import os
from pathlib import Path


def workspace_root() -> Path | None:
    for parent in Path(__file__).resolve().parents:
        if (parent / "apps").is_dir() and (parent / "packages").is_dir():
            return parent
    return None


def data_dir() -> Path:
    default = (workspace_root() or Path.home() / ".local/share") / ".doc2audio"
    return Path(os.environ.get("DOC2AUDIO_DATA_DIR", str(default))).expanduser().resolve()


def models_dir() -> Path:
    root = workspace_root()
    default = root / ".models" if root else data_dir() / "models"
    return Path(os.environ.get("DOC2AUDIO_MODELS_DIR", str(default))).expanduser().resolve()
