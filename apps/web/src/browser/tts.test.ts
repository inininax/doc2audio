import { afterEach, describe, expect, it, vi } from "vitest";
import {
  encodeText,
  LANGUAGES,
  noisyLatent,
  normalizeSpeechText,
  seededRandom,
  speechOptions,
  trimWaveform,
} from "./tts";
import { SpeechClient, type SpeechResponse } from "./speech-client";
import { hasSpeechContent } from "./speech-text";
import { extractDocument, splitText } from "./documents";

const config = {
  ae: { sample_rate: 44100, base_chunk_size: 512 },
  ttl: { chunk_compress_factor: 6, latent_dim: 24 },
};

describe("Supertonic text and inference boundaries", () => {
  it("keeps the final Korean sentence and applies the model's NFKD encoding", () => {
    const text = "앞부분입니다.  마지막 문장도 끝까지 읽습니다.";
    const normalized = normalizeSpeechText(text, "ko");
    expect(normalized).toBe(
      `<ko>${text.replace(/  /, " ").normalize("NFKD")}</ko>`,
    );
    const indexer = Array.from({ length: 65536 }, (_, index) => index);
    const result = encodeText(text, "ko", indexer);
    expect(result.ids.length).toBe(Array.from(normalized).length);
    expect(Array.from(result.ids).map(Number)).toEqual(
      Array.from(normalized).map((char) => char.codePointAt(0)),
    );
    expect(Array.from(result.mask)).toEqual(Array(result.ids.length).fill(1));
  });

  it("normalizes model-specific symbols without synthesizing empty emoji-only input", () => {
    expect(normalizeSpeechText('Hello — ""friend"" 😊', "en")).toBe(
      '<en>Hello - "friend"</en>',
    );
    expect(() => normalizeSpeechText("  😊 ", "ko")).toThrow("텍스트");
  });

  it("filters only non-speaking chunks after real document extraction and text splitting", async () => {
    const document = await extractDocument(
      new Blob(["안녕하세요.\n\n😊😊\n\n###\n\n이어서 읽습니다."]),
      "decorations.txt",
      {},
    );
    const spoken = splitText(document.text, 120).filter((text) =>
      hasSpeechContent(text, "ko"),
    );
    expect(spoken).toEqual(["안녕하세요.", "이어서 읽습니다."]);
    expect(() =>
      spoken.map((text) => normalizeSpeechText(text, "ko")),
    ).not.toThrow();
    expect(hasSpeechContent("@", "en")).toBe(true);
    expect(hasSpeechContent("42", "ko")).toBe(true);
    expect(hasSpeechContent("℃", "ko")).toBe(true);
    expect(hasSpeechContent("!!!", "ko")).toBe(false);
  });

  it("handles supplementary Unicode as one unknown token, without duplicate surrogate tokens", () => {
    const text = normalizeSpeechText("𠮷", "ja");
    const result = encodeText("𠮷", "ja", []);
    expect(result.ids.length).toBe(Array.from(text).length);
  });

  it("accepts all advertised languages and voices, and rejects invalid options before inference", () => {
    expect(LANGUAGES).toHaveLength(31);
    for (const language of LANGUAGES)
      expect(speechOptions({ language }).language).toBe(language);
    for (const prefix of ["F", "M"])
      for (let number = 1; number <= 5; number++)
        expect(speechOptions({ speaker: `${prefix}${number}` }).speaker).toBe(
          `${prefix}${number}`,
        );
    const invalidOptions: Record<string, string | number>[] = [
      { speaker: "../F1" },
      { language: "xx" },
      { total_steps: 1 },
      { total_steps: 2.5 },
      { total_steps: 31 },
      { speech_speed: NaN },
      { speech_speed: 0.69 },
      { speech_speed: 2.01 },
    ];
    for (const options of invalidOptions)
      expect(() => speechOptions(options)).toThrow();
  });

  it("recreates exactly the same latent after worker restart with a persisted chunk seed", () => {
    const first = noisyLatent(1.23, config, 0);
    const resumed = noisyLatent(1.23, config, 0);
    expect(resumed.samples).toEqual(first.samples);
    expect(first.samples).not.toEqual(noisyLatent(1.23, config, 1).samples);
    expect(first.shape).toEqual([
      1,
      144,
      Math.ceil(Math.floor(1.23 * 44100) / 3072),
    ]);
    expect(first.samples.every(Number.isFinite)).toBe(true);
    expect(Array.from(first.mask).every((value) => value === 1)).toBe(true);
    const random = seededRandom(0xffffffff);
    for (let count = 0; count < 100; count++)
      expect(random()).toBeGreaterThanOrEqual(0);
    for (const seed of [-1, NaN, 0x100000000, 1.5])
      expect(() => seededRandom(seed)).toThrow();
    for (const duration of [0, -1, Infinity, NaN, 301])
      expect(() => noisyLatent(duration, config, 1)).toThrow();
  });

  it("removes vocoder padding per chunk while preserving the last sample of each spoken segment", () => {
    const first = trimWaveform(
      Float32Array.of(0.1, 0.2, 0.8, 0, 0),
      0.003,
      1000,
    );
    const second = trimWaveform(Float32Array.of(0.4, 0.7, 0, 0), 0.002, 1000);
    expect([...first, ...second]).toEqual(
      Array.from(Float32Array.of(0.1, 0.2, 0.8, 0.4, 0.7)),
    );
    expect(() => trimWaveform(Float32Array.of(0.5), 1, 1000)).toThrow("불완전");
    expect(() => trimWaveform(Float32Array.of(NaN), 0.001, 1000)).toThrow(
      "올바르지",
    );
  });
});

class TestWorker {
  static current: TestWorker;
  onmessage: ((event: MessageEvent<SpeechResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    TestWorker.current = this;
  }
}

afterEach(() => vi.unstubAllGlobals());

function client() {
  vi.stubGlobal("Worker", TestWorker);
  vi.stubGlobal("window", {
    location: { href: "https://example.test/doc2audio/" },
  });
  return new SpeechClient();
}

describe("speech worker lifecycle", () => {
  it("rejects every pending request on close, so a paused queue cannot hang", async () => {
    const speech = client();
    const one = speech.synthesize("첫 문장", {}, 42);
    const two = speech.synthesize("두 번째", {}, 43);
    const assertions = [
      expect(one).rejects.toMatchObject({ name: "AbortError" }),
      expect(two).rejects.toMatchObject({ name: "AbortError" }),
    ];
    speech.close();
    await Promise.all(assertions);
    expect(TestWorker.current.terminate).toHaveBeenCalled();
    await expect(speech.synthesize("다시", {}, 44)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("propagates a worker failure instead of leaving progress running", async () => {
    const speech = client();
    const pending = speech.synthesize("문장", {}, 42);
    const assertion = expect(pending).rejects.toThrow("memory failure");
    TestWorker.current.onerror?.({
      message: "memory failure",
      preventDefault() {},
    } as ErrorEvent);
    await assertion;
    expect(TestWorker.current.terminate).toHaveBeenCalled();
  });

  it("keeps a usable worker after an individual inference error", async () => {
    const speech = client();
    const failure = speech.synthesize("문장", {}, 42);
    const assertion = expect(failure).rejects.toThrow("missing asset");
    TestWorker.current.onmessage?.({
      data: { id: 1, error: "missing asset" },
    } as MessageEvent<SpeechResponse>);
    await assertion;
    const succeeding = speech.synthesize("다른 문장", {}, 43);
    const result = { samples: Float32Array.of(0.1), sampleRate: 44100 };
    TestWorker.current.onmessage?.({
      data: { id: 2, result },
    } as MessageEvent<SpeechResponse>);
    await expect(succeeding).resolves.toEqual(result);
    speech.close();
  });
});
