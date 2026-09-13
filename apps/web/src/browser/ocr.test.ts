import { afterEach, describe, expect, it, vi } from "vitest";
import type { OcrRequest, OcrResponse } from "./ocr-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("tesseract.js");
  vi.resetModules();
});

describe("owned OCR worker lifecycle", () => {
  it("terminates the bridge when actual SDK-style initialization rejects without resolving createWorker", async () => {
    // The bridge runs the real module; only the SDK transport is substituted.
    // In Tesseract 7 loadLanguage failure invokes errorHandler but never settles
    // createWorker. There is deliberately no finishCreation escape hatch here.
    const forever = new Promise<never>(() => {});
    const createWorker = vi.fn(
      (
        _langs: unknown,
        _oem: unknown,
        options: { errorHandler(error: Error): void },
      ) => {
        queueMicrotask(() =>
          options.errorHandler(new Error("language data unavailable")),
        );
        return forever;
      },
    );
    vi.doMock("tesseract.js", () => ({ createWorker }));
    const scope: {
      onmessage: ((event: MessageEvent<OcrRequest>) => void) | null;
      postMessage(message: OcrResponse): void;
    } = {
      onmessage: null,
      postMessage: (message) =>
        transport.onmessage?.({ data: message } as MessageEvent<OcrResponse>),
    };
    const transport = {
      onmessage: null as ((event: MessageEvent<OcrResponse>) => void) | null,
      onerror: null,
      onmessageerror: null,
      terminate: vi.fn(),
      postMessage: (request: OcrRequest) =>
        scope.onmessage?.({ data: request } as MessageEvent<OcrRequest>),
    };
    vi.stubGlobal("self", scope);
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          return transport;
        }
      },
    );
    await import("./ocr.worker");
    const { OcrClient } = await import("./ocr-client");
    const client = new OcrClient();
    await expect(
      client.initialize("https://example.test/runtime/tesseract/"),
    ).rejects.toThrow("language data unavailable");
    expect(createWorker).toHaveBeenCalledOnce();
    expect(transport.terminate).toHaveBeenCalledOnce();
    await expect(client.recognize(new Blob(["image"]))).rejects.toThrow("종료");
  });

  it("terminates immediately on cancellation before any initialization reply", async () => {
    const transport = {
      terminate: vi.fn(),
      postMessage: vi.fn(),
      onmessage: null,
      onerror: null,
      onmessageerror: null,
    };
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          return transport;
        }
      },
    );
    const { OcrClient } = await import("./ocr-client");
    const client = new OcrClient();
    const pending = client.initialize(
      "https://example.test/runtime/tesseract/",
    );
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    client.close();
    await rejected;
    expect(transport.terminate).toHaveBeenCalledOnce();
    client.close();
    expect(transport.terminate).toHaveBeenCalledOnce();
  });
});
