import { createWorker } from "tesseract.js";
import type { OcrRequest, OcrResponse } from "./ocr-client";

const bridge = self as unknown as {
  onmessage: ((event: MessageEvent<OcrRequest>) => void) | null;
  postMessage: (message: OcrResponse) => void;
};
let engine: Awaited<ReturnType<typeof createWorker>> | undefined;
let currentId = 0;
let queue: Promise<void> = Promise.resolve();
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

bridge.onmessage = (event) => {
  const request = event.data;
  queue = queue.then(async () => {
    currentId = request.id;
    try {
      if (request.kind === "initialize") {
        engine = await createWorker(["kor", "eng"], 1, {
          workerPath: new URL("worker.min.js", request.runtimeUrl).href,
          corePath: request.runtimeUrl,
          langPath: new URL("lang/", request.runtimeUrl).href,
          workerBlobURL: false,
          logger: (event) =>
            bridge.postMessage({
              id: currentId,
              kind: "progress",
              progress: event.progress,
            }),
          // Tesseract 7 can leave createWorker pending on language/init failures.
          // Report immediately; the owner terminates this entire worker tree.
          errorHandler: (error: unknown) =>
            bridge.postMessage({
              id: currentId,
              kind: "error",
              error: errorMessage(error),
            }),
        });
        bridge.postMessage({ id: request.id, kind: "result", text: "" });
      } else {
        if (!engine) throw new Error("OCR 실행기가 준비되지 않았습니다.");
        const result = await engine.recognize(request.image);
        bridge.postMessage({
          id: request.id,
          kind: "result",
          text: result.data.text,
        });
      }
    } catch (error) {
      bridge.postMessage({
        id: request.id,
        kind: "error",
        error: errorMessage(error),
      });
    }
  });
};
