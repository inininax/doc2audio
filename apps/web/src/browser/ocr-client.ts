export type OcrRequest =
  | { id: number; kind: "initialize"; runtimeUrl: string }
  | { id: number; kind: "recognize"; image: Blob };
export type OcrResponse =
  | { id: number; kind: "progress"; progress: number }
  | { id: number; kind: "result"; text: string }
  | { id: number; kind: "error"; error: string };

type Pending = {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  progress?: (fraction: number) => void;
};

/** Own the SDK's parent worker before initialization, so failures cannot orphan it. */
export class OcrClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  private closed = false;

  constructor() {
    this.worker = new Worker(new URL("./ocr.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (event: MessageEvent<OcrResponse>) => {
      const message = event.data;
      if (message.kind === "error") {
        this.close(new Error(message.error));
        return;
      }
      const entry = this.pending.get(message.id);
      if (!entry) return;
      if (message.kind === "progress") entry.progress?.(message.progress);
      else {
        this.pending.delete(message.id);
        entry.resolve(message.text);
      }
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.close(
        new Error(event.message || "OCR 실행기를 시작하지 못했습니다."),
      );
    };
    this.worker.onmessageerror = () =>
      this.close(new Error("OCR 결과를 전달받지 못했습니다."));
  }

  initialize(
    runtimeUrl: string,
    progress?: (fraction: number) => void,
  ): Promise<string> {
    return this.send(
      { id: ++this.nextId, kind: "initialize", runtimeUrl },
      progress,
    );
  }

  recognize(
    image: Blob,
    progress?: (fraction: number) => void,
  ): Promise<string> {
    return this.send({ id: ++this.nextId, kind: "recognize", image }, progress);
  }

  private send(
    request: OcrRequest,
    progress?: (fraction: number) => void,
  ): Promise<string> {
    if (this.closed)
      return Promise.reject(
        new DOMException("OCR 실행기가 종료되었습니다.", "AbortError"),
      );
    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject, progress });
      try {
        this.worker.postMessage(request);
      } catch (error) {
        this.close(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  close(
    error: Error = new DOMException("OCR 작업을 중단했습니다.", "AbortError"),
  ): void {
    if (this.closed) return;
    this.closed = true;
    // Terminating this owned worker also orphans its nested SDK worker. Neither
    // worker has a surviving document owner, including failed initialization.
    this.worker.terminate();
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }
}
