export type SpeechResult = { samples: Float32Array; sampleRate: number };
export type SpeechRequest = {
  id: number;
  text: string;
  options: Record<string, string | number>;
  seed: number;
  runtimeUrl: string;
};
export type SpeechResponse =
  { id: number; result: SpeechResult } | { id: number; error: string };

type Pending = {
  resolve: (result: SpeechResult) => void;
  reject: (error: Error) => void;
};

export class SpeechClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  private closed = false;
  private readonly runtimeUrl = new URL(
    `${import.meta.env.BASE_URL}runtime/`,
    window.location.href,
  ).href;

  constructor() {
    this.worker = new Worker(new URL("./tts.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (event: MessageEvent<SpeechResponse>) => {
      const message = event.data;
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if ("error" in message) entry.reject(new Error(message.error));
      else entry.resolve(message.result);
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.fail(
        new Error(
          event.message ||
            "브라우저 음성 실행기가 종료되었습니다. 작업을 다시 시도해 주세요.",
        ),
      );
    };
    this.worker.onmessageerror = () =>
      this.fail(new Error("브라우저 음성 결과를 전달받지 못했습니다."));
  }

  synthesize(
    text: string,
    options: Record<string, string | number>,
    seed: number,
  ): Promise<SpeechResult> {
    if (this.closed)
      return Promise.reject(
        new DOMException("음성 실행기가 종료되었습니다.", "AbortError"),
      );
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({
          id,
          text,
          options,
          seed,
          runtimeUrl: this.runtimeUrl,
        } satisfies SpeechRequest);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private fail(error: Error) {
    this.closed = true;
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  close(): void {
    this.fail(new DOMException("음성 생성을 중단했습니다.", "AbortError"));
  }
}
