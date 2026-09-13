/** Queue regression tests use in-memory storage and synthetic PCM doubles only.
 * Real IndexedDB, model inference, and browser lifecycle are verified separately.
 */
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredJob } from "./storage";
import type { EncodeOptions } from "./encode";
import { manifest, PIPELINE_VERSION, validateOptions } from "./catalog";

type PCM = { samples: Float32Array; sampleRate: number };
type Expected = { statuses?: string[]; runToken?: string };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const state = vi.hoisted(() => ({
  jobs: new Map<string, StoredJob>(),
  chunks: new Map<string, PCM>(),
  events: [] as string[],
  createGate: undefined as Promise<void> | undefined,
  openGate: undefined as Promise<void> | undefined,
  synthesis:
    vi.fn<
      (
        text: string,
        options: Record<string, string | number>,
        seed: number,
      ) => Promise<PCM>
    >(),
  close: vi.fn(),
  extract: vi.fn(),
  encode: vi.fn(),
  read: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  save: vi.fn(),
  output: vi.fn(),
}));

vi.mock("./storage", () => {
  const matches = (
    job: StoredJob | undefined,
    expected?: Expected,
  ): job is StoredJob =>
    !!job &&
    (!expected?.statuses || expected.statuses.includes(job.status)) &&
    (expected?.runToken === undefined || expected.runToken === job.runToken);
  return {
    listJobs: async () => {
      await state.openGate;
      return [...state.jobs.values()].map((job) => ({ ...job }));
    },
    getJob: async (id: string) => {
      state.get(id);
      const job = state.jobs.get(id);
      return job && { ...job };
    },
    createJob: async (job: StoredJob) => {
      await state.createGate;
      state.jobs.set(job.id, { ...job });
      state.events.push("source-committed");
    },
    updateJob: async (
      id: string,
      patch: Partial<StoredJob>,
      expected?: Expected,
    ) => {
      state.update(id, patch);
      const job = state.jobs.get(id);
      if (!matches(job, expected)) return false;
      state.jobs.set(id, { ...job, ...patch });
      return true;
    },
    readChunk: async (id: string, index: number) => {
      state.read(id, index);
      return state.chunks.get(`${id}/${index}`);
    },
    saveChunk: async (
      id: string,
      index: number,
      samples: Float32Array,
      sampleRate: number,
      runToken: string,
    ) => {
      state.save(id, index, runToken);
      const job = state.jobs.get(id);
      if (!matches(job, { statuses: ["running"], runToken })) return false;
      state.chunks.set(`${id}/${index}`, { samples, sampleRate });
      state.jobs.set(id, { ...job, completedChunks: job.completedChunks + 1 });
      return true;
    },
    saveOutput: async (
      id: string,
      output: Blob,
      result: StoredJob["result"],
      runToken: string,
    ) => {
      state.output(id, runToken);
      const job = state.jobs.get(id);
      if (!matches(job, { statuses: ["running"], runToken })) return false;
      state.jobs.set(id, {
        ...job,
        output,
        result,
        status: "completed",
        progress: 1,
      });
      return true;
    },
    deleteJob: async (id: string) => state.jobs.delete(id),
    modelInstalled: async () => true,
    storageInfo: async () => ({ usage: 0, quota: 10000000, persistent: true }),
    requestPersistence: async () => true,
  };
});
vi.mock("./speech-client", () => ({
  SpeechClient: class {
    synthesize(
      text: string,
      options: Record<string, string | number>,
      seed: number,
    ) {
      state.events.push(`synthesize:${text}`);
      return state.synthesis(text, options, seed);
    }
    close() {
      state.close();
    }
  },
}));
vi.mock("./documents", () => ({
  extractDocument: (...args: unknown[]) => state.extract(...args),
  splitText: (text: string) => text.split("|").filter(Boolean),
}));
vi.mock("./encode", () => ({
  encodeMp3: (...args: unknown[]) => state.encode(...args),
}));
vi.mock("./download", () => ({ downloadModel: vi.fn(async () => {}) }));

const fixtureEncodedSeconds = 0.125;
const fixtureAudio = (): PCM => ({
  samples: Float32Array.of(0.1, -0.1, 0.2),
  sampleRate: 44100,
});
let windowSurface: EventTarget;
let documentSurface: EventTarget & { visibilityState: string };
let channelListeners: Array<() => void>;
let intervals: ReturnType<typeof setInterval>[];
let heldLocks: Set<string>;
let queueLocks: Map<string, Promise<unknown>>;
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;

beforeEach(() => {
  vi.resetModules();
  state.jobs.clear();
  state.chunks.clear();
  state.events.length = 0;
  state.createGate = undefined;
  state.openGate = undefined;
  state.synthesis.mockReset().mockImplementation(async () => fixtureAudio());
  state.close.mockReset();
  state.read.mockReset();
  state.get.mockReset();
  state.update.mockReset();
  state.save.mockReset();
  state.output.mockReset();
  state.extract.mockReset().mockImplementation(async (source: Blob) => ({
    text: await source.text(),
    warnings: [],
  }));
  state.encode
    .mockReset()
    .mockImplementation(
      async (
        chunks: AsyncIterable<Float32Array>,
        _sampleRate: number,
        options: EncodeOptions,
      ) => {
        for await (const chunk of chunks)
          expect(chunk.length).toBeGreaterThan(0);
        expect(options.onDuration).toBeTypeOf("function");
        options.onDuration?.(fixtureEncodedSeconds);
        return new Blob(["fixture MP3"], { type: "audio/mpeg" });
      },
    );
  windowSurface = new EventTarget();
  documentSurface = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  channelListeners = [];
  intervals = [];
  heldLocks = new Set();
  queueLocks = new Map();
  vi.stubGlobal("window", windowSurface);
  vi.stubGlobal("document", documentSurface);
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("indexedDB", {});
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      addEventListener(_type: string, listener: () => void) {
        channelListeners.push(listener);
      }
    },
  );
  vi.stubGlobal("navigator", {
    locks: {
      request: async (
        name: string,
        optionsOrCallback:
          { ifAvailable: boolean } | ((lock: object) => Promise<unknown>),
        callback?: (lock: object | null) => Promise<unknown>,
      ) => {
        if (typeof optionsOrCallback !== "function") {
          if (heldLocks.has(name)) return callback!(null);
          heldLocks.add(name);
          try {
            return await callback!({ name });
          } finally {
            heldLocks.delete(name);
          }
        }
        const previous = queueLocks.get(name) || Promise.resolve();
        const next = previous.then(() => optionsOrCallback({ name }));
        queueLocks.set(
          name,
          next.catch(() => {}),
        );
        return next;
      },
    },
  });
  vi.stubGlobal("setInterval", ((...args: Parameters<typeof setInterval>) => {
    const handle = originalSetInterval(...args);
    intervals.push(handle);
    return handle;
  }) as typeof setInterval);
});

afterEach(async () => {
  windowSurface.dispatchEvent(new Event("pagehide"));
  for (const interval of intervals) originalClearInterval(interval);
  vi.unstubAllGlobals();
});

function job(
  id: string,
  status: StoredJob["status"] = "queued",
  text = "첫 문장|마지막 문장",
): StoredJob {
  return {
    id,
    kind: "conversion",
    model_id: manifest.id,
    title: id,
    status,
    created_at: "2026-09-13T00:00:00.000Z",
    updated_at: "2026-09-13T00:00:00.000Z",
    progress: 0,
    message: "fixture",
    error: null,
    audio_url: null,
    attempt: 0,
    options: { voice: validateOptions({}), ocr: "never", pages: "" },
    result: null,
    events: [],
    pipelineVersion: PIPELINE_VERSION,
    modelRevision: manifest.revision,
    completedChunks: 0,
    source: new Blob([text], { type: "text/plain" }),
    filename: "fixture.txt",
  };
}
async function waitFor(predicate: () => boolean) {
  await vi.waitFor(() => expect(predicate()).toBe(true), {
    timeout: 2000,
    interval: 10,
  });
}
async function waitIdle() {
  await waitFor(() => !heldLocks.has("doc2audio-browser-runner"));
}

function submittedText(text: string) {
  const body = new FormData();
  body.set("model_id", manifest.id);
  body.set("text", text);
  body.set("options", "{}");
  return body;
}

describe("persistent browser queue lifecycle", () => {
  it("commits the source before extraction or synthesis starts", async () => {
    const gate = deferred<void>();
    state.createGate = gate.promise;
    const service = await import("./service");
    const submission = service.browserRequest("jobs", {
      method: "POST",
      body: submittedText("모든 본문"),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(state.jobs.size).toBe(0);
    expect(state.extract).not.toHaveBeenCalled();
    expect(state.synthesis).not.toHaveBeenCalled();
    gate.resolve();
    await submission;
    await waitFor(() => [...state.jobs.values()][0]?.status === "completed");
    expect(await [...state.jobs.values()][0].source!.text()).toBe("모든 본문");
    expect(state.events[0]).toBe("source-committed");
    await waitIdle();
  });

  it("stores duration reported by the encoder after tempo processing instead of estimating from input PCM", async () => {
    const initial = job("encoded-duration");
    initial.options.voice = validateOptions({ speed: 1.5, pause: 0.2 });
    state.jobs.set(initial.id, initial);
    const service = await import("./service");
    await service.initialize();
    await waitFor(() => state.jobs.get(initial.id)?.status === "completed");
    const [, rate, options] = state.encode.mock.calls[0];
    expect(rate).toBe(44100);
    expect(options).toMatchObject({ speed: 1.5, pause: 0.2 });
    expect(state.jobs.get(initial.id)?.result).toEqual({
      seconds: fixtureEncodedSeconds,
      chunks: 2,
      reused_chunks: 0,
    });
    const nominalSeconds =
      ((fixtureAudio().samples.length * 2) / 44100 + 0.2) / 1.5;
    expect(state.jobs.get(initial.id)?.result?.seconds).not.toBeCloseTo(
      nominalSeconds,
      5,
    );
    await waitIdle();
  });

  it("does not save or complete a late worker result after manual pause", async () => {
    const late = deferred<PCM>();
    state.synthesis.mockReturnValueOnce(late.promise);
    state.jobs.set("paused-late", job("paused-late"));
    const service = await import("./service");
    await service.initialize();
    await waitFor(() => state.synthesis.mock.calls.length === 1);
    await service.browserRequest("jobs/paused-late/pause", { method: "POST" });
    late.resolve(fixtureAudio());
    await waitIdle();
    expect(state.jobs.get("paused-late")?.status).toBe("paused");
    expect(state.save).not.toHaveBeenCalled();
    expect(state.output).not.toHaveBeenCalled();
    expect(state.close).toHaveBeenCalled();
  });

  it("closes the speech worker immediately on pagehide and leaves work recoverable", async () => {
    const late = deferred<PCM>();
    state.synthesis.mockReturnValueOnce(late.promise);
    state.jobs.set("closing", job("closing", "queued", "남은 문장"));
    const service = await import("./service");
    await service.initialize();
    await waitFor(() => state.synthesis.mock.calls.length === 1);
    documentSurface.visibilityState = "hidden";
    windowSurface.dispatchEvent(new Event("pagehide"));
    expect(state.close).toHaveBeenCalled();
    late.resolve(fixtureAudio());
    await waitIdle();
    expect(state.jobs.get("closing")?.status).toBe("running");
    expect(state.save).not.toHaveBeenCalled();
    expect(state.output).not.toHaveBeenCalled();
  });

  it("a cancelled job cannot be completed by late MP3 encoding", async () => {
    const late = deferred<Blob>();
    state.encode.mockImplementationOnce(async () => late.promise);
    state.jobs.set("encoding-late", job("encoding-late", "queued", "한 문장"));
    const service = await import("./service");
    await service.initialize();
    await waitFor(() => state.encode.mock.calls.length === 1);
    await service.browserRequest("jobs/encoding-late/cancel", {
      method: "POST",
    });
    late.resolve(new Blob(["late fixture MP3"]));
    await waitIdle();
    expect(state.jobs.get("encoding-late")?.status).toBe("cancelled");
    expect(state.chunks.size).toBe(1);
    expect(state.output).not.toHaveBeenCalled();
  });

  it("automatically resumes an orphaned running job when reopened, but preserves manual pause", async () => {
    const orphan = job("orphan", "running", "남은 문장");
    orphan.runToken = "old-tab";
    orphan.attempt = 1;
    state.jobs.set(orphan.id, orphan);
    state.jobs.set("manual", job("manual", "paused", "보류한 문장"));
    const service = await import("./service");
    await service.initialize();
    await waitFor(() => state.jobs.get("orphan")?.status === "completed");
    expect(state.jobs.get("orphan")?.attempt).toBe(2);
    expect(state.jobs.get("orphan")?.runToken).not.toBe("old-tab");
    expect(state.jobs.get("manual")?.status).toBe("paused");
    expect(state.synthesis.mock.calls.map((call) => call[0])).toEqual([
      "남은 문장",
    ]);
    await waitIdle();
  });

  it("reuses committed chunks after reopening without regenerating the beginning", async () => {
    const orphan = job("cached", "running");
    orphan.runToken = "old-tab";
    orphan.texts = ["첫 문장", "마지막 문장"];
    const data = new TextEncoder().encode(
      JSON.stringify({
        version: orphan.pipelineVersion,
        revision: orphan.modelRevision,
        texts: orphan.texts,
        options: orphan.options,
      }),
    );
    orphan.fingerprint = [
      ...new Uint8Array(await webcrypto.subtle.digest("SHA-256", data)),
    ]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    orphan.completedChunks = 1;
    state.chunks.set(`${orphan.id}/0`, fixtureAudio());
    state.jobs.set(orphan.id, orphan);
    const service = await import("./service");
    await service.initialize();
    await waitFor(() => state.jobs.get(orphan.id)?.status === "completed");
    expect(state.extract).not.toHaveBeenCalled();
    expect(
      state.synthesis.mock.calls.map((call) => [call[0], call[2]]),
    ).toEqual([["마지막 문장", 43]]);
    expect(state.jobs.get(orphan.id)?.result?.reused_chunks).toBe(1);
    await waitIdle();
  });

  it("a second tab cannot recover or generate a job while the first tab owns the runner lock", async () => {
    const late = deferred<PCM>();
    state.synthesis.mockReturnValueOnce(late.promise);
    state.jobs.set("shared", job("shared", "queued", "공유 문장"));
    const firstTab = await import("./service");
    await firstTab.initialize();
    await waitFor(() => state.synthesis.mock.calls.length === 1);
    const originalToken = state.jobs.get("shared")!.runToken;
    vi.resetModules();
    const secondTab = await import("./service");
    await secondTab.initialize();
    expect(state.jobs.get("shared")!.runToken).toBe(originalToken);
    expect(state.jobs.get("shared")!.attempt).toBe(1);
    expect(state.synthesis).toHaveBeenCalledTimes(1);
    late.resolve(fixtureAudio());
    await waitFor(() => state.jobs.get("shared")?.status === "completed");
    await waitIdle();
  });

  it("concurrent initialization registers a single runner and one event subscription", async () => {
    const gate = deferred<void>();
    state.openGate = gate.promise;
    const service = await import("./service");
    const pending = [
      service.initialize(),
      service.initialize(),
      service.initialize(),
    ];
    gate.resolve();
    await Promise.all(pending);
    await waitIdle();
    expect(channelListeners).toHaveLength(1);
    expect(intervals).toHaveLength(1);
  });

  it("skips decorative-only paragraphs while preserving all spoken input", async () => {
    state.jobs.set(
      "decoration",
      job("decoration", "queued", "첫 문장|😊😊|###|마지막 문장"),
    );
    const service = await import("./service");
    await service.initialize();
    await waitFor(() => state.jobs.get("decoration")?.status === "completed");
    expect(state.jobs.get("decoration")?.texts).toEqual([
      "첫 문장",
      "마지막 문장",
    ]);
    expect(state.synthesis.mock.calls.map((call) => call[0])).toEqual([
      "첫 문장",
      "마지막 문장",
    ]);
    expect(state.jobs.get("decoration")?.result?.chunks).toBe(2);
    await waitIdle();
  });

  it("reports a document containing no spoken content without starting inference", async () => {
    state.jobs.set(
      "decoration-only",
      job("decoration-only", "queued", "😊😊|###"),
    );
    const service = await import("./service");
    await service.initialize();
    await waitFor(() => state.jobs.get("decoration-only")?.status === "failed");
    expect(state.jobs.get("decoration-only")?.error).toContain("본문");
    expect(state.synthesis).not.toHaveBeenCalled();
    await waitIdle();
  });

  it("resumes old decorative plans using original PCM indexes, input fingerprint, and seeds", async () => {
    const initial = job("legacy-decoration", "running");
    initial.texts = ["첫 문장", "😊", "마지막 문장"];
    const digest = await webcrypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify({
          version: initial.pipelineVersion,
          revision: initial.modelRevision,
          texts: initial.texts,
          options: initial.options,
        }),
      ),
    );
    initial.fingerprint = [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    initial.completedChunks = 1;
    const saved = fixtureAudio();
    state.chunks.set(`${initial.id}/0`, saved);
    state.jobs.set(initial.id, initial);
    const service = await import("./service");
    await service.initialize();
    await waitFor(() => state.jobs.get(initial.id)?.status === "completed");
    expect(state.jobs.get(initial.id)?.texts).toEqual(initial.texts);
    expect(state.jobs.get(initial.id)?.fingerprint).toBe(initial.fingerprint);
    expect(state.jobs.get(initial.id)?.spokenIndexes).toEqual([0, 2]);
    expect(state.chunks.get(`${initial.id}/0`)).toBe(saved);
    expect(
      state.synthesis.mock.calls.map((call) => [call[0], call[2]]),
    ).toEqual([["마지막 문장", 44]]);
    expect(state.chunks.has(`${initial.id}/1`)).toBe(false);
    expect(state.chunks.has(`${initial.id}/2`)).toBe(true);
    expect(state.jobs.get(initial.id)?.result).toMatchObject({
      chunks: 2,
      reused_chunks: 1,
    });
    await waitIdle();
  });

  it("marks a storage AbortError as failed instead of automatically restarting forever", async () => {
    state.save.mockImplementation(() => {
      throw new DOMException("IndexedDB transaction aborted", "AbortError");
    });
    state.jobs.set("storage-abort", job("storage-abort", "queued", "본문"));
    const service = await import("./service");
    await service.initialize();
    await waitFor(() => state.jobs.get("storage-abort")?.status === "failed");
    await waitIdle();
    expect(state.jobs.get("storage-abort")?.error).toBe(
      "IndexedDB transaction aborted",
    );
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(state.jobs.get("storage-abort")?.attempt).toBe(1);
    expect(state.synthesis).toHaveBeenCalledTimes(1);
  });

  it.each(["AbortError", "QuotaExceededError"])(
    "preserves an extraction progress %s as a failure when aborting its workers",
    async (name) => {
      state.update.mockImplementation((_id, patch: Partial<StoredJob>) => {
        if (patch.message === "OCR fixture progress")
          throw new DOMException("Progress transaction failed", name);
      });
      state.extract.mockImplementation(
        async (
          _source: Blob,
          _filename: string,
          settings: { signal: AbortSignal },
          progress: (message: string) => void,
        ) => {
          progress("OCR fixture progress");
          // Like the real extraction, wait until cancellation rejects the SDK call.
          await new Promise<void>((_resolve, reject) => {
            settings.signal.addEventListener(
              "abort",
              () => reject(settings.signal.reason),
              { once: true },
            );
          });
        },
      );
      state.jobs.set("progress-error", job("progress-error"));
      const service = await import("./service");
      await service.initialize();
      await waitFor(() => state.extract.mock.calls.length > 0);
      await waitIdle();
      expect(state.jobs.get("progress-error")?.status).toBe("failed");
      expect(state.jobs.get("progress-error")?.error).toContain(
        name === "QuotaExceededError"
          ? "저장 공간"
          : "Progress transaction failed",
      );
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(state.jobs.get("progress-error")?.attempt).toBe(1);
      expect(state.extract).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves a watchdog read error and terminates the pending speech worker", async () => {
    const late = deferred<PCM>();
    state.synthesis.mockReturnValueOnce(late.promise);
    state.close.mockImplementation(() =>
      late.reject(new DOMException("worker terminated", "AbortError")),
    );
    state.jobs.set("watch-error", job("watch-error"));
    const service = await import("./service");
    await service.initialize();
    await waitFor(() => state.synthesis.mock.calls.length > 0);
    state.get.mockImplementationOnce(() => {
      throw new DOMException("Watch transaction failed", "AbortError");
    });
    await waitFor(() => state.close.mock.calls.length > 0);
    await waitIdle();
    expect(state.jobs.get("watch-error")?.status).toBe("failed");
    expect(state.jobs.get("watch-error")?.error).toBe(
      "Watch transaction failed",
    );
    expect(state.save).not.toHaveBeenCalled();
    expect(state.output).not.toHaveBeenCalled();
  });
});

describe("cross-tab audio URL ownership", () => {
  it("releases the Blob URL after another tab deletes its job", async () => {
    documentSurface.visibilityState = "hidden";
    const initial = job("deleted-elsewhere", "completed");
    initial.output = new Blob(["fixture MP3"]);
    state.jobs.set(initial.id, initial);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    try {
      const service = await import("./service");
      const first = await service.browserRequest<{ items: StoredJob[] }>(
        "jobs",
      );
      const audio = first.items[0].audio_url!;
      state.jobs.delete(initial.id);
      const latest = await service.browserRequest<{ items: StoredJob[] }>(
        "jobs",
      );
      expect(latest.items).toEqual([]);
      expect(revoke).toHaveBeenCalledExactlyOnceWith(audio);
    } finally {
      revoke.mockRestore();
    }
  });

  it("keeps off-page audio URLs alive while their jobs still exist", async () => {
    documentSurface.visibilityState = "hidden";
    for (const id of ["first-page", "other-page"]) {
      const initial = job(id, "completed");
      initial.output = new Blob([`fixture MP3 ${id}`]);
      state.jobs.set(id, initial);
    }
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    try {
      const service = await import("./service");
      const all = await service.browserRequest<{ items: StoredJob[] }>("jobs");
      const paged = await service.browserRequest<{ items: StoredJob[] }>(
        "jobs?limit=1&offset=1",
      );
      expect(paged.items).toHaveLength(1);
      const detail = await service.browserRequest<StoredJob>(
        `jobs/${all.items[0].id}`,
      );
      expect(detail.audio_url).toBe(all.items[0].audio_url);
      expect(revoke).not.toHaveBeenCalled();
    } finally {
      revoke.mockRestore();
    }
  });

  it("releases a deleted detail URL even before the history refresh", async () => {
    documentSurface.visibilityState = "hidden";
    const initial = job("deleted-detail", "completed");
    initial.output = new Blob(["fixture MP3"]);
    state.jobs.set(initial.id, initial);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    try {
      const service = await import("./service");
      const first = await service.browserRequest<StoredJob>(
        `jobs/${initial.id}`,
      );
      state.jobs.delete(initial.id);
      await expect(
        service.browserRequest(`jobs/${initial.id}`),
      ).rejects.toThrow("작업을 찾을 수 없습니다");
      expect(revoke).toHaveBeenCalledExactlyOnceWith(first.audio_url);
    } finally {
      revoke.mockRestore();
    }
  });
});
