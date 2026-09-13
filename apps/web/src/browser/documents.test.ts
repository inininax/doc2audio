import { describe, expect, it, vi } from "vitest";
import * as CFB from "cfb";
import {
  extractDocument,
  normalizeText,
  pageIndices,
  splitText,
} from "./documents";

function containerBlob(files: Record<string, Uint8Array>, type: "cfb" | "zip") {
  const file = CFB.utils.cfb_new();
  for (const [name, content] of Object.entries(files))
    CFB.utils.cfb_add(file, name, content);
  return new Blob([
    new Uint8Array(CFB.write(file, { type: "buffer", fileType: type })),
  ]);
}

function legacyDoc(encrypted = false, invalidOffset = false) {
  // The logical first piece is physically after the second one: byte-scanning
  // would return the wrong order and expose non-body document metadata.
  const first = "한글 본문.\r";
  const second = "Final paragraph.\r";
  const word = new Uint8Array(4096);
  const view = new DataView(word.buffer);
  view.setUint16(0, 0xa5ec, true);
  view.setUint16(2, 0xc1, true);
  view.setUint16(10, encrypted ? 0x300 : 0x200, true);
  view.setUint16(32, 14, true);
  view.setUint16(62, 22, true);
  view.setUint32(76, first.length + second.length, true);
  view.setUint16(152, 93, true);
  view.setUint32(418, 0, true);
  view.setUint32(422, 33, true);
  for (let i = 0; i < first.length; i++)
    view.setUint16(2048 + i * 2, first.charCodeAt(i), true);
  word.set(new TextEncoder().encode(second), 1024);
  const table = new Uint8Array(33);
  const t = new DataView(table.buffer);
  table[0] = 2;
  t.setUint32(1, 28, true);
  t.setUint32(5, 0, true);
  t.setUint32(9, first.length, true);
  t.setUint32(13, first.length + second.length, true);
  t.setUint32(19, invalidOffset ? 9000 : 2048, true);
  t.setUint32(27, 0x40000000 | 2048, true);
  return containerBlob({ WordDocument: word, "1Table": table }, "cfb");
}

describe("lossless document chunking", () => {
  it("retains every non-whitespace Unicode character, including long words and emoji", () => {
    const text =
      "첫 문장입니다. 두 번째 문장에는 3.14와 괄호(내용)가 있어요.\n\n" +
      "가".repeat(257) +
      "👨‍👩‍👧‍👦".repeat(12) +
      " 마지막 문장!";
    for (const length of [40, 120, 240, 600]) {
      const chunks = splitText(text, length);
      expect(chunks.join("").replace(/\s/gu, "")).toBe(
        text.replace(/\s/gu, ""),
      );
      expect(chunks.every((chunk) => Array.from(chunk).length <= length)).toBe(
        true,
      );
      expect(
        chunks.every(
          (chunk) => !/[\ud800-\udbff]$|^[\udc00-\udfff]/u.test(chunk),
        ),
      ).toBe(true);
    }
  });
  it("prefers a sentence boundary and does not split a decimal", () => {
    const chunks = splitText(
      "가격은 3.14입니다. " +
        "다음 문장은 긴 본문으로 이루어져 있습니다. ".repeat(5),
      40,
    );
    expect(chunks[0]).toBe(
      "가격은 3.14입니다. 다음 문장은 긴 본문으로 이루어져 있습니다.",
    );
  });
  it("preserves text separated only by tabs and handles whitespace", () => {
    const text = "하나\t둘\t셋".repeat(30);
    expect(splitText(text, 40).join("").replace(/\s/g, "")).toBe(
      text.replace(/\s/g, ""),
    );
    expect(splitText(" \n \t ", 120)).toEqual([]);
    expect(() => splitText("hello", 39)).toThrow();
    expect(() => splitText("hello", 120.5)).toThrow();
  });
  it("normalizes hard line breaks while retaining paragraphs and numbers", () => {
    expect(
      normalizeText("\ufeff첫 줄\r\n다음 줄.\r\n\r\n  12,500 원\t입니다. "),
    ).toBe("첫 줄 다음 줄.\n\n12,500 원 입니다.");
  });
});

describe("PDF/OCR cancellation releases the caller", () => {
  it.each(["creating", "rendering", "recognizing", "teardown error"])(
    "rejects and closes the owned client while %s stays pending",
    async (phase) => {
      vi.resetModules();
      let ready!: () => void;
      const reached = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const never = new Promise<never>(() => {});
      const close = vi.fn();
      const cancel = vi.fn();
      const page = {
        getTextContent: async () => ({ items: [] }),
        getOperatorList: async () => ({ fnArray: [1] }),
        getViewport: () => ({ width: 100, height: 100 }),
        render: () => {
          if (phase === "rendering") ready();
          return {
            promise: phase === "rendering" ? never : Promise.resolve(),
            cancel,
          };
        },
        cleanup: vi.fn(),
      };
      let destroyed = 0;
      const destroy = async () => {
        destroyed++;
        if (phase === "teardown error")
          throw new Error("PDF transport cleanup failed");
      };
      vi.doMock("pdfjs-dist", () => ({
        GlobalWorkerOptions: {},
        OPS: {
          paintImageXObject: 1,
          paintInlineImageXObject: 2,
          paintImageMaskXObject: 3,
        },
        getDocument: () => ({
          promise: Promise.resolve({ numPages: 1, getPage: async () => page }),
          destroy,
        }),
      }));
      vi.doMock("./ocr-client", () => ({
        OcrClient: class {
          close = close;
          initialize() {
            if (phase === "creating") {
              ready();
              return never;
            }
            return Promise.resolve("");
          }
          recognize() {
            ready();
            return never;
          }
        },
      }));
      vi.stubGlobal("document", {
        createElement: () => ({
          width: 0,
          height: 0,
          toBlob: (callback: (blob: Blob) => void) =>
            callback(new Blob(["fixture"])),
        }),
      });
      vi.stubGlobal("window", { location: { href: "https://example.test/" } });
      const controller = new AbortController();
      try {
        const result = extractDocument(
          new Blob(["test PDF fixture"]),
          "scan.pdf",
          { signal: controller.signal },
        );
        const settled = result.then(
          () => "completed",
          (error: Error) => error.name,
        );
        await reached;
        controller.abort();
        expect(
          await Promise.race([
            settled,
            new Promise<string>((resolve) =>
              setTimeout(() => resolve("still pending"), 100),
            ),
          ]),
        ).toBe("AbortError");
        expect(close).toHaveBeenCalled();
        expect(destroyed).toBeGreaterThan(0);
        // Let native rejected-promise reporting run before the test environment
        // is disposed, so teardown errors cannot hide behind the AbortError.
        if (phase === "teardown error")
          await new Promise((resolve) => setTimeout(resolve, 20));
        if (phase === "rendering") expect(cancel).toHaveBeenCalled();
      } finally {
        controller.abort();
        vi.doUnmock("pdfjs-dist");
        vi.doUnmock("./ocr-client");
        vi.unstubAllGlobals();
      }
    },
  );
});

describe("browser document extraction", () => {
  it("reads UTF-8 BOM and rejects invalid bytes rather than corrupting Korean", async () => {
    await expect(
      extractDocument(new Blob(["\ufeff한글 문서입니다."]), "문서.TXT", {}),
    ).resolves.toEqual({ text: "한글 문서입니다.", warnings: [] });
    await expect(
      extractDocument(
        new Blob([new Uint8Array([0xff, 0xfe, 0xab])]),
        "wrong.txt",
        {},
      ),
    ).rejects.toThrow("UTF-8");
  });
  it("validates page ranges and source/settings before extraction", async () => {
    expect(pageIndices("3,1-2,2", 4)).toEqual([1, 2, 3]);
    expect(pageIndices(undefined, 2)).toEqual([1, 2]);
    for (const spec of ["0", "2-1", "1-9", "1,", "abc", "1.5"])
      expect(() => pageIndices(spec, 4)).toThrow();
    await expect(
      extractDocument(new Blob(["text"]), "a.txt", { pages: "1" }),
    ).rejects.toThrow("PDF");
    await expect(
      extractDocument(new Blob(["text"]), "a.txt", { ocr: "bad" }),
    ).rejects.toThrow("OCR");
    await expect(extractDocument(new Blob(), "a.txt", {})).rejects.toThrow(
      "빈 문서",
    );
    await expect(
      extractDocument(new Blob(["---"]), "a.txt", {}),
    ).rejects.toThrow("글자");
  });
  it("reads Word97 Unicode/ANSI pieces in document order", async () => {
    const result = await extractDocument(legacyDoc(), "legacy.doc", {});
    expect(result.text).toBe("한글 본문.\n\nFinal paragraph.");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it("rejects encrypted and corrupt DOC piece offsets", async () => {
    await expect(
      extractDocument(legacyDoc(true), "encrypted.doc", {}),
    ).rejects.toThrow("암호화");
    await expect(
      extractDocument(legacyDoc(false, true), "corrupt.doc", {}),
    ).rejects.toThrow("손상");
  });
  it("reads DOCX body and table cells in their original order", async () => {
    const xml = (value: string) => new TextEncoder().encode(value);
    const docx = containerBlob(
      {
        "[Content_Types].xml": xml(
          '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        ),
        "_rels/.rels": xml(
          '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        ),
        "word/document.xml": xml(
          '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>첫 본문</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>표 내용</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>마지막 본문</w:t></w:r></w:p></w:body></w:document>',
        ),
      },
      "zip",
    );
    const result = await extractDocument(docx, "sample.docx", {});
    expect(result.text).toBe("첫 본문\n\n표 내용\n\n마지막 본문");
  });
  it("honors an aborted extraction", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      extractDocument(new Blob(["hello"]), "a.txt", {
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});
