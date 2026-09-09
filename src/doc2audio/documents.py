"""PDF / DOCX / legacy DOC extraction. No remote document services."""

import io
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from .errors import Doc2AudioError
from .text import normalize_text


@dataclass
class DocumentText:
    text: str
    pages: int | None = None
    ocr_pages: list[int] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def page_indices(spec: str | None, count: int) -> list[int]:
    if not spec:
        return list(range(count))
    selected = set()
    for part in spec.split(","):
        match = re.fullmatch(r"\s*(\d+)(?:-(\d+))?\s*", part)
        if not match:
            raise Doc2AudioError("페이지는 1부터 시작합니다. 예: --pages 1-3,5")
        first = int(match[1])
        last = int(match[2] or first)
        if not 1 <= first <= last <= count:
            raise Doc2AudioError(f"페이지 범위를 확인하세요. 이 PDF는 {count}쪽입니다.")
        selected.update(range(first - 1, last))
    return sorted(selected)


def recognize_image(png: bytes) -> str:
    """Use Apple's on-device Vision OCR, with Korean and English recognition."""
    try:
        import Vision
        from Foundation import NSData
    except ImportError as exc:
        raise Doc2AudioError(
            "스캔 PDF의 OCR에는 macOS와 pyobjc-framework-Vision이 필요합니다."
        ) from exc
    request = Vision.VNRecognizeTextRequest.alloc().init()
    request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    supported, error = request.supportedRecognitionLanguagesAndReturnError_(None)
    if error or "ko-KR" not in supported:
        raise Doc2AudioError("이 macOS의 Vision OCR은 한국어 인식을 지원하지 않습니다.")
    request.setRecognitionLanguages_(["ko-KR", "en-US"])
    request.setUsesLanguageCorrection_(True)
    data = NSData.dataWithBytes_length_(png, len(png))
    handler = Vision.VNImageRequestHandler.alloc().initWithData_options_(data, {})
    ok, error = handler.performRequests_error_([request], None)
    if not ok or error:
        raise Doc2AudioError(f"로컬 OCR에 실패했습니다: {error}")
    fragments = []
    for observation in request.results() or []:
        candidates = observation.topCandidates_(1)
        if candidates:
            rect = observation.boundingBox()
            fragments.append(
                (
                    rect.origin.x,
                    rect.origin.y + rect.size.height / 2,
                    rect.size.height,
                    str(candidates[0].string()),
                )
            )
    return order_ocr_fragments(fragments)


def order_ocr_fragments(fragments: list[tuple[float, float, float, str]]) -> str:
    # Vision can return the right-hand end of one line AFTER the next line.
    # Rebuild baseline bands, then read left-to-right within each band.
    bands = []
    for fragment in sorted(fragments, key=lambda item: (-item[1], item[0])):
        if bands and abs(bands[-1][0][1] - fragment[1]) <= max(bands[-1][0][2], fragment[2]) * 0.6:
            bands[-1].append(fragment)
        else:
            bands.append([fragment])
    text = ""
    previous = None
    for band in bands:
        center = sum(item[1] for item in band) / len(band)
        height = max(item[2] for item in band)
        if previous:
            text += "\n\n" if previous[0] - center > max(previous[1], height) * 1.8 else "\n"
        text += normalize_ocr_numbers(" ".join(item[3] for item in sorted(band)))
        previous = (center, height)
    return text


def normalize_ocr_numbers(text: str) -> str:
    # Vision can separate glyphs in scanned numbers ("1 2, 5 0 0 원").
    # Restrict joining to a number immediately followed by a Korean unit;
    # bare numbered lists such as "1 2 3" retain their original separation.
    return re.sub(
        r"\d[\d, \t]*(?=(?:년|월|일|시|분|초|원|개|명|쪽|퍼센트)(?:\b|[가-힣]))",
        lambda match: re.sub(r"[ \t]", "", match[0]),
        text,
    )


def _pdf(path: Path, pages: str | None, ocr: str) -> DocumentText:
    import pymupdf

    texts, ocr_pages, warnings = [], [], []
    with pymupdf.open(path) as doc:
        if not doc.is_pdf:
            raise Doc2AudioError("PDF 확장자와 실제 파일 형식이 다릅니다.")
        if doc.needs_pass:
            raise Doc2AudioError("암호화된 PDF입니다. 암호를 해제한 사본을 전달해 주세요.")
        selected = page_indices(pages, len(doc))
        for index in selected:
            page = doc[index]
            text = page.get_text("text", sort=True)
            images = page.get_images()
            # Scans may have a page number or a broken/empty text layer.
            bad_text = not any(c.isalnum() for c in text) or text.count("\ufffd") > len(text) / 10
            image_only = bool(images) and sum(c.isalnum() for c in text) < 30
            if ocr == "always" or (ocr == "auto" and (bad_text or image_only)):
                scale = min(2.5, 3500 / max(page.rect.width, page.rect.height))
                png = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False).tobytes(
                    "png"
                )
                text = recognize_image(png)
                ocr_pages.append(index + 1)
            elif (bad_text or image_only) and images:
                raise Doc2AudioError(f"{index + 1}쪽은 스캔으로 보입니다. --ocr auto로 실행하세요.")
            if not any(c.isalnum() for c in text):
                warnings.append(
                    f"{index + 1}쪽에서 읽을 글자를 찾지 못했습니다(빈 페이지/그림 확인)."
                )
            if images and text.strip() and index + 1 not in ocr_pages:
                warnings.append(
                    f"{index + 1}쪽의 이미지 속 글자는 기본 추출 대상이 아닙니다. "
                    "필요하면 --ocr always를 사용하세요."
                )
            texts.append(text)
    return DocumentText("\n\n".join(texts), len(selected), ocr_pages, warnings)


def _word_blocks(container):
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    for block in container.iter_inner_content():
        if isinstance(block, Paragraph):
            if block.text.strip():
                yield block.text
        elif isinstance(block, Table):
            seen = set()
            for row in block.rows:
                # Horizontal AND vertical merges repeat the same cell object.
                cells = []
                for cell in row.cells:
                    if cell._tc in seen:
                        continue
                    seen.add(cell._tc)
                    value = ". ".join(_word_blocks(cell))
                    if value:
                        cells.append(value)
                if cells:
                    yield ", ".join(cells) + "."


def _docx(source) -> DocumentText:
    from docx import Document

    doc = Document(source)
    warnings = []
    xml = doc.element.xml
    if "<w:txbxContent" in xml or "<w:footnoteReference" in xml or "<w:endnoteReference" in xml:
        warnings.append(
            "Word 텍스트 상자·각주·미주는 본문 추출에 포함되지 않습니다. 필요하면 PDF로 내보내세요."
        )
    if "<w:ins " in xml or "<w:del " in xml:
        raise Doc2AudioError(
            "변경 내용 추적이 있는 Word 문서입니다. 변경을 수락한 사본을 사용하세요."
        )
    if len(doc.inline_shapes):
        warnings.append("Word의 이미지 속 글자는 추출하지 않습니다. 스캔 문서는 PDF로 내보내세요.")
    return DocumentText("\n\n".join(_word_blocks(doc)), warnings=warnings)


def extract_document(path: Path, *, pages: str | None = None, ocr: str = "auto") -> DocumentText:
    path = path.expanduser().resolve()
    if not path.is_file():
        raise Doc2AudioError(f"파일을 찾을 수 없습니다: {path}")
    if pages and path.suffix.lower() != ".pdf":
        raise Doc2AudioError("--pages는 PDF에서만 사용할 수 있습니다.")
    if ocr not in {"auto", "always", "never"}:
        raise Doc2AudioError("OCR 설정은 auto, always, never 중 하나여야 합니다.")
    try:
        match path.suffix.lower():
            case ".pdf":
                result = _pdf(path, pages, ocr)
            case ".docx":
                result = _docx(path)
            case ".doc":
                tool = shutil.which("textutil")
                if not tool:
                    raise Doc2AudioError(
                        ".doc 변환에는 macOS의 textutil이 필요합니다. "
                        ".docx 사본도 사용할 수 있습니다."
                    )
                converted = subprocess.run(
                    [tool, "-convert", "docx", "-stdout", "-noload", "-nostore", "--", str(path)],
                    capture_output=True,
                    timeout=120,
                    check=False,
                )
                if converted.returncode or not converted.stdout.startswith(b"PK"):
                    raise Doc2AudioError(".doc 변환에 실패했습니다. 손상/암호화 여부를 확인하세요.")
                result = _docx(io.BytesIO(converted.stdout))
            case ".txt":
                result = DocumentText(path.read_text(encoding="utf-8-sig"))
            case _:
                raise Doc2AudioError("지원 형식: .pdf, .docx, .doc, .txt")
    except Doc2AudioError:
        raise
    except Exception as exc:
        raise Doc2AudioError(
            f"문서를 읽지 못했습니다: {path.name} ({type(exc).__name__}: {exc})"
        ) from exc
    result.text = normalize_text(result.text)
    if not any(c.isalnum() for c in result.text):
        raise Doc2AudioError(
            "문서에서 읽을 본문을 찾지 못했습니다. 스캔 PDF는 --ocr always를 시도하세요."
        )
    return result
