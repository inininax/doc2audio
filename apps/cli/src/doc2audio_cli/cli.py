import argparse
import json
import platform
import shutil
import sys
import tempfile
from pathlib import Path

from doc2audio import __version__
from doc2audio.audio import atomic_publish
from doc2audio.catalog import DEFAULT_MODEL, get_model, missing_files, model_path, public_models
from doc2audio.documents import extract_document
from doc2audio.engines import install_model
from doc2audio.errors import Doc2AudioError
from doc2audio.pipeline import convert_document
from doc2audio.text import apply_pronunciations, load_pronunciations


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
    convert.add_argument("--speaker", help="화자 (한국어 기본: Sohee)")
    convert.add_argument("--style", help="낭독 스타일 지시문")
    convert.add_argument("--speed", type=float, help="재생 속도 0.5~2.0 (기본 1.0)")
    convert.add_argument("--pause", type=float, help="구간 사이 쉼, 초 (기본 0.3)")
    convert.add_argument("--chunk-chars", type=int, help="구간당 최대 글자 수 40~600")
    convert.add_argument("--seed", type=int, help="음성 생성 난수 seed (기본 42)")
    convert.add_argument("--offline", action="store_true", help="모델 다운로드 없이 실행")
    convert.add_argument("--work-dir", type=Path, help="이어하기 저장 폴더")
    convert.add_argument("--language", help="모델별 언어 코드")
    convert.add_argument(
        "--model-options", default="{}", help="추가 모델 옵션 JSON (models 명령 참고)"
    )
    sub.add_parser("models", help="모델 목록, 설치 상태와 조절 가능한 옵션")
    download = sub.add_parser("download", help="선택한 무료 모델을 미리 내려받기")
    doctor = sub.add_parser("doctor", help="실행 환경 및 모델 파일 확인 (다운로드 없음)")
    for command in (convert, download, doctor):
        command.add_argument("--model-dir", type=Path, help="모델 저장 위치")
        command.add_argument("--model", default=DEFAULT_MODEL, help="모델 ID (models 명령 참고)")
    return parser


def doctor(model_dir: Path, model_id: str = DEFAULT_MODEL) -> int:
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
    missing = missing_files(model_id, model_dir.expanduser())
    spec = get_model(model_id)
    if spec["engine"] == "supertonic":
        ready = True
    print(f"모델: {spec['repo_id']}\n리비전: {spec['revision']}")
    print(f"모델 파일: {'다운로드 필요 (' + str(len(missing)) + '개)' if missing else 'OK'}")
    return 0 if ready and ffmpeg and not missing else 1


def main(argv: list[str] | None = None) -> int:
    args_list = list(sys.argv[1:] if argv is None else argv)
    if (
        args_list
        and args_list[0] not in {"convert", "extract", "download", "doctor", "models"}
        and not args_list[0].startswith("-")
    ):
        args_list.insert(0, "convert")
    args = make_parser().parse_args(args_list)
    try:
        match args.command:
            case "doctor":
                return doctor(args.model_dir or model_path(args.model), args.model)
            case "download":
                print(f"모델 준비 완료: {install_model(args.model, path=args.model_dir)}")
            case "models":
                print(json.dumps(public_models(), ensure_ascii=False, indent=2))
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
                try:
                    voice = json.loads(args.model_options)
                except ValueError as exc:
                    raise Doc2AudioError(
                        "--model-options에는 올바른 JSON 객체를 입력하세요."
                    ) from exc
                if not isinstance(voice, dict):
                    raise Doc2AudioError("--model-options는 JSON 객체여야 합니다.")
                for key, value in {
                    "speaker": args.speaker,
                    "instruct": args.style,
                    "language": args.language,
                    "chunk_chars": args.chunk_chars,
                    "seed": args.seed,
                    "speed": args.speed,
                    "pause": args.pause,
                }.items():
                    if value is not None:
                        voice[key] = value
                result = convert_document(
                    args.source,
                    args.output or args.source.with_suffix(".mp3"),
                    model_id=args.model,
                    generation_options=voice,
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
