import argparse
import json
import platform
import shutil
import sys
import tempfile
from pathlib import Path

from . import __version__
from .audio import atomic_publish
from .documents import extract_document
from .errors import Doc2AudioError
from .model import (
    DEFAULT_INSTRUCT,
    DEFAULT_MODEL_DIR,
    MODEL_ID,
    MODEL_REVISION,
    ensure_model,
    missing_model_files,
)
from .pipeline import Options, convert_document
from .text import apply_pronunciations, load_pronunciations


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="doc2audio",
        description="PDF·DOCX·DOC 파일을 로컬 한국어 MP3로 읽습니다.",
        epilog='빠른 사용: doc2audio "/경로/문서.pdf"',
    )
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command", required=True)
    convert = sub.add_parser("convert", help="문서 → MP3 (기본 명령)")
    extract = sub.add_parser("extract", help="읽을 본문 미리 확인 (모델 불필요)")
    for command in (convert, extract):
        command.add_argument("source", type=Path, help="PDF / DOCX / DOC / UTF-8 TXT 파일 경로")
        command.add_argument("-o", "--output", type=Path, help="출력 파일 경로")
        command.add_argument("--pages", help="PDF 페이지 선택, 예: 1-3,5")
        command.add_argument("--ocr", choices=["auto", "always", "never"], default="auto")
        command.add_argument("--pronunciations", type=Path, help="원문→발음 JSON 사전")
        command.add_argument("--overwrite", action="store_true", help="기존 출력 파일 교체")
    convert.add_argument("--speaker", default="Sohee", help="화자 (한국어 기본: Sohee)")
    convert.add_argument("--style", default=DEFAULT_INSTRUCT, help="낭독 스타일 지시문")
    convert.add_argument("--speed", type=float, default=1.0, help="재생 속도 0.5~2.0 (기본 1.0)")
    convert.add_argument("--pause", type=float, default=0.3, help="구간 사이 쉼, 초 (기본 0.3)")
    convert.add_argument("--chunk-chars", type=int, default=240, help="구간당 최대 글자 수 40~600")
    convert.add_argument("--seed", type=int, default=42, help="음성 생성 난수 seed")
    convert.add_argument("--offline", action="store_true", help="모델 다운로드 없이 실행")
    convert.add_argument("--work-dir", type=Path, help="이어하기 저장 폴더")
    download = sub.add_parser("download", help="고정된 무료 모델을 미리 내려받기 (약 3.1 GB)")
    doctor = sub.add_parser("doctor", help="실행 환경 및 모델 파일 확인 (다운로드 없음)")
    for command in (convert, download, doctor):
        command.add_argument(
            "--model-dir", type=Path, default=DEFAULT_MODEL_DIR, help="모델 저장 위치"
        )
    return parser


def doctor(model_dir: Path) -> int:
    is_mac = platform.system() == "Darwin" and platform.machine() == "arm64"
    print(f"플랫폼: {platform.system()} {platform.machine()} · {'OK' if is_mac else '미지원'}")
    print(f"Python: {platform.python_version()}")
    ffmpeg = shutil.which("ffmpeg")
    print(f"ffmpeg: {ffmpeg or '없음 (brew install ffmpeg)'}")
    print(f"DOC 변환: {shutil.which('textutil') or '없음'}")
    ready = False
    if is_mac:
        import mlx.core as mx

        ready = mx.metal.is_available()
        print(f"Metal GPU: {'OK' if ready else '사용 불가'}")
    missing = missing_model_files(model_dir.expanduser())
    print(f"모델: {MODEL_ID}\n리비전: {MODEL_REVISION}")
    print(f"모델 파일: {'다운로드 필요 (' + str(len(missing)) + '개)' if missing else 'OK'}")
    return 0 if ready and ffmpeg and not missing else 1


def main(argv: list[str] | None = None) -> int:
    args_list = list(sys.argv[1:] if argv is None else argv)
    if (
        args_list
        and args_list[0] not in {"convert", "extract", "download", "doctor"}
        and not args_list[0].startswith("-")
    ):
        args_list.insert(0, "convert")
    args = make_parser().parse_args(args_list)
    try:
        match args.command:
            case "doctor":
                return doctor(args.model_dir)
            case "download":
                print(f"모델 준비 완료: {ensure_model(args.model_dir)}")
            case "extract":
                document = extract_document(args.source, pages=args.pages, ocr=args.ocr)
                for warning in document.warnings:
                    print(f"주의: {warning}", file=sys.stderr)
                text = apply_pronunciations(document.text, load_pronunciations(args.pronunciations))
                if args.output:
                    output = args.output.expanduser().absolute()
                    if output.resolve() == args.source.expanduser().resolve():
                        raise Doc2AudioError("입력 문서를 덮어쓸 수 없습니다.")
                    output.parent.mkdir(parents=True, exist_ok=True)
                    with tempfile.TemporaryDirectory(dir=output.parent) as folder:
                        temporary = Path(folder) / "text.txt"
                        temporary.write_text(text + "\n", encoding="utf-8")
                        atomic_publish(temporary, output, args.overwrite)
                    print(f"본문 저장: {output}", file=sys.stderr)
                else:
                    print(text)
            case "convert":
                result = convert_document(
                    args.source,
                    args.output or args.source.with_suffix(".mp3"),
                    options=Options(
                        speaker=args.speaker,
                        instruct=args.style,
                        chunk_chars=args.chunk_chars,
                        seed=args.seed,
                        speed=args.speed,
                        pause=args.pause,
                    ),
                    model_dir=args.model_dir,
                    pages=args.pages,
                    ocr=args.ocr,
                    pronunciations=args.pronunciations,
                    offline=args.offline,
                    overwrite=args.overwrite,
                    work_dir=args.work_dir,
                    progress=lambda message: print(message, file=sys.stderr, flush=True),
                )
                print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except KeyboardInterrupt:
        print("\n중단했습니다. 같은 명령을 실행하면 완료된 구간부터 이어갑니다.", file=sys.stderr)
        return 130
    except (Doc2AudioError, OSError) as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
