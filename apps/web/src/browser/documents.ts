export type ExtractionSettings = {
  pages?: string;
  ocr?: string;
  signal?: AbortSignal;
};
export type ExtractedDocument = { text: string; warnings: string[] };

const runtime = (path: string) => `${import.meta.env.BASE_URL}runtime/${path}`;
const hasLetters = (text: string) => /[\p{L}\p{N}]/u.test(text);

/** Some worker SDKs terminate without rejecting their outstanding requests. */
function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(
        signal.reason ??
          new DOMException("작업이 중단되었습니다.", "AbortError"),
      );
    };
    // Always observe the operation, including its late rejection after cancellation.
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

export function normalizeText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/\f/g, "\n\n")
    .replace(/[\p{Cc}\p{Cf}]/gu, (char) => (/[\n\t]/.test(char) ? char : ""))
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.replace(/[\t \u00a0]+/g, " ").trim())
        .filter(Boolean)
        .join(" "),
    )
    .filter(Boolean)
    .join("\n\n");
}

/** Cuts on punctuation/word boundaries without dropping any non-whitespace code point. */
export function splitText(text: string, maxChars: number): string[] {
  if (!Number.isInteger(maxChars) || maxChars < 40 || maxChars > 600) {
    throw new Error("구간 길이는 40~600자의 정수여야 합니다.");
  }
  const chunks: string[] = [];
  for (const paragraph of text.split(/\n\s*\n/)) {
    const points = Array.from(paragraph.trim());
    let start = 0;
    while (start < points.length) {
      let end = Math.min(start + maxChars, points.length);
      if (end < points.length) {
        let sentence = 0;
        let clause = 0;
        let space = 0;
        for (let i = start + 1; i <= end; i++) {
          if (/\s/u.test(points[i])) {
            space = i;
            let previous = i - 1;
            while (previous >= start && /[”’"')\]]/u.test(points[previous]))
              previous--;
            if (/[.!?。！？]/u.test(points[previous] || "")) sentence = i;
            else if (/[,;:，；]/u.test(points[previous] || "")) clause = i;
          }
        }
        end = sentence || clause || space || end;
      }
      const chunk = points.slice(start, end).join("").trim();
      if (chunk) chunks.push(chunk);
      start = end;
      while (start < points.length && /\s/u.test(points[start])) start++;
    }
  }
  return chunks;
}

export function pageIndices(spec: string | undefined, count: number): number[] {
  if (!spec?.trim()) return Array.from({ length: count }, (_, i) => i + 1);
  const pages = new Set<number>();
  for (const part of spec.split(",")) {
    const match = /^\s*(\d+)(?:-(\d+))?\s*$/.exec(part);
    if (!match) throw new Error("페이지는 1부터 시작합니다. 예: 1-3,5");
    const first = Number(match[1]);
    const last = Number(match[2] || first);
    if (!(first >= 1 && first <= last && last <= count)) {
      throw new Error(`페이지 범위를 확인하세요. 이 PDF는 ${count}쪽입니다.`);
    }
    for (let page = first; page <= last; page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

async function extractPdf(
  source: Blob,
  settings: ExtractionSettings,
  progress?: (message: string) => void,
): Promise<ExtractedDocument> {
  const signal = settings.signal;
  const pdfjs = await abortable(import("pdfjs-dist"), signal);
  pdfjs.GlobalWorkerOptions.workerSrc = runtime("pdf.worker.min.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(await abortable(source.arrayBuffer(), signal)),
    cMapUrl: runtime("pdfjs/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: runtime("pdfjs/standard_fonts/"),
    wasmUrl: runtime("pdfjs/wasm/"),
  });
  let ocrWorker: import("./ocr-client").OcrClient | undefined;
  let rendering: { cancel(): void } | undefined;
  const abort = () => {
    rendering?.cancel();
    void task.destroy().catch(() => undefined);
    ocrWorker?.close();
  };
  settings.signal?.addEventListener("abort", abort, { once: true });
  const warnings: string[] = [];
  const texts: string[] = [];
  try {
    const pdf = await abortable(task.promise, signal);
    settings.signal?.throwIfAborted();
    const selected = pageIndices(settings.pages, pdf.numPages);
    for (const [index, pageNumber] of selected.entries()) {
      settings.signal?.throwIfAborted();
      progress?.(`문서 읽기 ${index + 1}/${selected.length}쪽`);
      const page = await abortable(pdf.getPage(pageNumber), signal);
      try {
        const content = await abortable(page.getTextContent(), signal);
        let text = content.items
          .map((item) =>
            "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
          )
          .join("");
        const operators = await abortable(page.getOperatorList(), signal);
        const imageOps = new Set([
          pdfjs.OPS.paintImageXObject,
          pdfjs.OPS.paintInlineImageXObject,
          pdfjs.OPS.paintImageMaskXObject,
        ]);
        const hasImages = operators.fnArray.some((op) => imageOps.has(op));
        const letters = text.match(/[\p{L}\p{N}]/gu)?.length || 0;
        const broken =
          !hasLetters(text) ||
          (text.match(/\ufffd/g)?.length || 0) > text.length / 10;
        const scan = hasImages && letters < 30;
        const needsOcr =
          settings.ocr === "always" ||
          (settings.ocr !== "never" && (broken || scan));
        if (needsOcr) {
          progress?.(`${pageNumber}쪽 한국어·영어 OCR 준비`);
          const ocrProgress = (fraction: number) =>
            progress?.(`${pageNumber}쪽 OCR · ${Math.round(fraction * 100)}%`);
          if (!ocrWorker) {
            const { OcrClient } = await abortable(
              import("./ocr-client"),
              signal,
            );
            ocrWorker = new OcrClient();
            await abortable(
              ocrWorker.initialize(
                new URL(runtime("tesseract/"), window.location.href).href,
                ocrProgress,
              ),
              signal,
            );
          }
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = Math.min(
            2.5,
            3500 / Math.max(baseViewport.width, baseViewport.height),
          );
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          try {
            const renderTask = page.render({ canvas, viewport });
            rendering = renderTask;
            await abortable(renderTask.promise, signal);
            rendering = undefined;
            const image = await abortable(
              new Promise<Blob>((resolve, reject) => {
                canvas.toBlob(
                  (blob) =>
                    blob
                      ? resolve(blob)
                      : reject(new Error("OCR 이미지를 준비하지 못했습니다.")),
                  "image/png",
                );
              }),
              signal,
            );
            text = await abortable(
              ocrWorker.recognize(image, ocrProgress),
              signal,
            );
          } finally {
            rendering = undefined;
            canvas.width = canvas.height = 0;
          }
          warnings.push(
            `${pageNumber}쪽은 OCR로 읽었습니다. 숫자·고유명사와 복잡한 표의 인식 결과를 확인하세요.`,
          );
        } else if (hasImages && (broken || scan)) {
          throw new Error(
            `${pageNumber}쪽은 스캔으로 보입니다. OCR을 자동 또는 항상으로 설정하세요.`,
          );
        } else if (hasImages) {
          warnings.push(
            `${pageNumber}쪽 이미지 안의 글자는 기본 추출에 포함되지 않습니다. 필요하면 OCR을 항상으로 설정하세요.`,
          );
        }
        if (!hasLetters(text))
          warnings.push(`${pageNumber}쪽에서 읽을 글자를 찾지 못했습니다.`);
        texts.push(text);
      } finally {
        page.cleanup();
      }
    }
    return { text: texts.join("\n\n"), warnings };
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") {
      throw new Error("암호화된 PDF입니다. 암호를 해제한 사본을 사용하세요.");
    }
    throw error;
  } finally {
    settings.signal?.removeEventListener("abort", abort);
    ocrWorker?.close();
    const cleanup = Promise.allSettled([task.destroy()]);
    // Do not retain the queue lock if a terminated SDK leaves teardown pending.
    if (!signal?.aborted) await abortable(cleanup, signal);
  }
}

async function extractDocx(source: Blob): Promise<ExtractedDocument> {
  const { default: mammoth } = await import("mammoth/mammoth.browser");
  const result = await mammoth.extractRawText({
    arrayBuffer: await source.arrayBuffer(),
  });
  return {
    text: result.value,
    warnings: [
      ...result.messages.map((message) => message.message),
      "Word 본문과 표를 문서 순서대로 읽습니다. 이미지 속 글자와 일부 머리말·각주·도형은 포함되지 않을 수 있습니다.",
    ],
  };
}

/** MS-DOC 2.4.1: FIB → CLX → PlcPcd. Parse the main story, never arbitrary printable file bytes. */
async function extractLegacyDoc(source: Blob): Promise<ExtractedDocument> {
  const CFB = await import("cfb");
  const container = CFB.read(new Uint8Array(await source.arrayBuffer()), {
    type: "buffer",
  });
  const wordEntry = CFB.find(container, "WordDocument");
  if (!wordEntry)
    throw new Error(
      "Word 97~2007 DOC 파일이 아닙니다. DOCX 또는 PDF 사본을 사용하세요.",
    );
  const word = new Uint8Array(wordEntry.content as Uint8Array);
  const view = new DataView(word.buffer, word.byteOffset, word.byteLength);
  const corrupt = () =>
    new Error(
      "DOC의 본문 구조가 손상되었거나 지원되지 않습니다. DOCX 또는 PDF 사본을 사용하세요.",
    );
  const requireRange = (offset: number, length: number, size = word.length) => {
    if (offset < 0 || length < 0 || offset + length > size) throw corrupt();
  };
  requireRange(0, 34);
  if (view.getUint16(0, true) !== 0xa5ec || view.getUint16(2, true) < 0xc1)
    throw corrupt();
  const flags = view.getUint16(10, true);
  if (flags & 0x100)
    throw new Error("암호화된 DOC입니다. 암호를 해제한 사본을 사용하세요.");
  const tableEntry = CFB.find(container, flags & 0x200 ? "1Table" : "0Table");
  if (!tableEntry) throw corrupt();
  const table = new Uint8Array(tableEntry.content as Uint8Array);
  const tableView = new DataView(
    table.buffer,
    table.byteOffset,
    table.byteLength,
  );
  let position = 34 + view.getUint16(32, true) * 2;
  requireRange(position, 2);
  const longCount = view.getUint16(position, true);
  position += 2;
  requireRange(position, longCount * 4 + 2);
  if (longCount < 11) throw corrupt();
  const textLength = view.getUint32(position + 12, true);
  position += longCount * 4;
  const pairCount = view.getUint16(position, true);
  position += 2;
  if (pairCount <= 33) throw corrupt();
  requireRange(position, pairCount * 8);
  const clxStart = view.getUint32(position + 33 * 8, true);
  const clxLength = view.getUint32(position + 33 * 8 + 4, true);
  requireRange(clxStart, clxLength, table.length);
  const clxEnd = clxStart + clxLength;
  position = clxStart;
  while (position < clxEnd && table[position] === 1) {
    requireRange(position, 3, clxEnd);
    const bytes = tableView.getUint16(position + 1, true);
    requireRange(position, bytes + 3, clxEnd);
    position += bytes + 3;
  }
  requireRange(position, 5, clxEnd);
  if (table[position] !== 2) throw corrupt();
  const plcSize = tableView.getUint32(position + 1, true);
  position += 5;
  requireRange(position, plcSize, clxEnd);
  if (plcSize < 4 || (plcSize - 4) % 12) throw corrupt();
  const pieceCount = (plcSize - 4) / 12;
  const descriptors = position + (pieceCount + 1) * 4;
  const texts: string[] = [];
  let previous = 0;
  for (let i = 0; i < pieceCount; i++) {
    const start = tableView.getUint32(position + i * 4, true);
    const end = tableView.getUint32(position + (i + 1) * 4, true);
    if (start !== previous || end < start) throw corrupt();
    previous = end;
    if (start >= textLength) break;
    const encodedOffset = tableView.getUint32(descriptors + i * 8 + 2, true);
    const compressed = Boolean(encodedOffset & 0x40000000);
    const offset = (encodedOffset & 0x3fffffff) / (compressed ? 2 : 1);
    const bytes = (Math.min(end, textLength) - start) * (compressed ? 1 : 2);
    requireRange(offset, bytes);
    texts.push(
      new TextDecoder(compressed ? "windows-1252" : "utf-16le", {
        fatal: true,
      }).decode(word.subarray(offset, offset + bytes)),
    );
  }
  if (previous < textLength) throw corrupt();
  // Field instructions (e.g. HYPERLINK) are metadata; retain only their displayed results.
  const fields: boolean[] = [];
  let text = "";
  for (const char of texts.join("")) {
    if (char === "\x13") fields.push(false);
    else if (char === "\x14" && fields.length) fields[fields.length - 1] = true;
    else if (char === "\x15") fields.pop();
    else if (fields.every(Boolean))
      text += /[\x07\x0b\x0c\x0d]/.test(char) ? "\n\n" : char;
  }
  return {
    text,
    warnings: [
      "구형 DOC의 본문과 표 텍스트를 읽었습니다. 각주·머리말·도형·이미지·변경 추적 서식은 반영하지 않으므로 복잡한 문서는 PDF나 DOCX 사본을 권장합니다.",
    ],
  };
}

export async function extractDocument(
  source: Blob,
  filename: string,
  settings: ExtractionSettings,
  progress?: (message: string) => void,
): Promise<ExtractedDocument> {
  settings.signal?.throwIfAborted();
  const extension = filename.toLowerCase().split(".").pop();
  if (settings.pages?.trim() && extension !== "pdf")
    throw new Error("페이지 범위는 PDF에서만 사용할 수 있습니다.");
  if (settings.ocr && !["auto", "always", "never"].includes(settings.ocr))
    throw new Error("OCR 설정을 확인하세요.");
  if (!source.size) throw new Error("빈 문서입니다.");
  progress?.("이 PC에서 문서를 읽고 있습니다.");
  let result: ExtractedDocument;
  switch (extension) {
    case "txt":
      try {
        result = {
          text: new TextDecoder("utf-8", { fatal: true }).decode(
            await source.arrayBuffer(),
          ),
          warnings: [],
        };
      } catch {
        throw new Error("TXT는 UTF-8 인코딩으로 저장한 파일을 사용하세요.");
      }
      break;
    case "pdf":
      result = await extractPdf(source, settings, progress);
      break;
    case "docx":
      result = await extractDocx(source);
      break;
    case "doc":
      result = await extractLegacyDoc(source);
      break;
    default:
      throw new Error("PDF, DOCX, DOC, UTF-8 TXT 파일을 선택하세요.");
  }
  result.text = normalizeText(result.text);
  settings.signal?.throwIfAborted();
  if (!hasLetters(result.text))
    throw new Error(
      "문서에서 읽을 글자를 찾지 못했습니다. 스캔 PDF라면 OCR을 사용하세요.",
    );
  return result;
}
