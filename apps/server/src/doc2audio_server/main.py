import argparse
import os
from pathlib import Path

import uvicorn

from .app import create_app


def main():
    parser = argparse.ArgumentParser(description="DOC2AUDIO 로컬 웹 서버")
    parser.add_argument("--port", type=int, default=8010)
    parser.add_argument("--data-dir", type=Path)
    args = parser.parse_args()
    if args.data_dir:
        args.data_dir = args.data_dir.expanduser().resolve()
        os.environ["DOC2AUDIO_DATA_DIR"] = str(args.data_dir)
    uvicorn.run(create_app(args.data_dir), host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
