import { readAsset } from "./storage";
import { BrowserSpeechEngine } from "./tts";
import type { SpeechRequest, SpeechResponse } from "./speech-client";

// Inference runs in a dedicated worker. Closing/pausing terminates this worker;
// the queue checkpoints completed chunks separately in persistent storage.
const worker = self as unknown as {
  onmessage: ((event: MessageEvent<SpeechRequest>) => void) | null;
  postMessage: (message: SpeechResponse, transfer?: Transferable[]) => void;
};
let engine: Promise<BrowserSpeechEngine> | undefined;
let queue: Promise<void> = Promise.resolve();
worker.onmessage = (event) => {
  const request = event.data;
  queue = queue.then(async () => {
    try {
      if (!engine) {
        engine = BrowserSpeechEngine.create(
          readAsset,
          request.runtimeUrl,
        ).catch((error) => {
          engine = undefined;
          throw error;
        });
      }
      const runtime = await engine;
      const result = await runtime.synthesize(
        request.text,
        request.options,
        request.seed,
      );
      worker.postMessage({ id: request.id, result }, [
        result.samples.buffer as ArrayBuffer,
      ]);
    } catch (error) {
      worker.postMessage({
        id: request.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
};
