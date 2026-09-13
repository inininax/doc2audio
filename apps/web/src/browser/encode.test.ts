import { describe, expect, it } from "vitest";
import { encodeMp3, tempoBlocks } from "./encode";

const sampleRate = 44100;
function tone(seconds: number, hz = 440) {
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < samples.length; i++)
    samples[i] = Math.sin((i / sampleRate) * Math.PI * 2 * hz) * 0.4;
  return samples;
}
function concat(chunks: Float32Array[]) {
  const result = new Float32Array(
    chunks.reduce((total, chunk) => total + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

describe("offline MP3 encoder", () => {
  it.each([0.5, 0.75, 1.5, 2])(
    "preserves an isolated last 20 ms signal at %sx instead of truncating WSOLA latency",
    (speed) => {
      const samples = new Float32Array(sampleRate * 2);
      for (
        let i = samples.length - sampleRate * 0.02;
        i < samples.length;
        i++
      ) {
        samples[i] = Math.sin((i / sampleRate) * Math.PI * 2 * 1000) * 0.8;
      }
      const output = concat([...tempoBlocks(samples, sampleRate, speed)]);
      expect(output.some((sample) => Math.abs(sample) > 0.3)).toBe(true);
      const tail = output.subarray(-Math.ceil(sampleRate * 0.3));
      expect(tail.some((sample) => Math.abs(sample) > 0.3)).toBe(true);
    },
  );
  it("retains distinguishable beginning and ending signals through WSOLA", () => {
    const samples = new Float32Array(sampleRate * 2);
    samples.set(tone(0.2, 440));
    samples.set(tone(0.02, 1000), samples.length - 882);
    const output = concat([...tempoBlocks(samples, sampleRate, 1.5)]);
    expect(
      output
        .subarray(0, sampleRate / 5)
        .some((sample) => Math.abs(sample) > 0.2),
    ).toBe(true);
    expect(
      output.subarray(-sampleRate / 4).some((sample) => Math.abs(sample) > 0.2),
    ).toBe(true);
  });
  it.each([0.5, 0.75, 1.5, 2])(
    "changes duration at %s speed while retaining tone pitch and the ending",
    (speed) => {
      const original = tone(1.2);
      const samples = concat([...tempoBlocks(original, sampleRate, speed)]);
      expect(samples.length).toBeGreaterThanOrEqual(
        Math.ceil(original.length / speed),
      );
      expect(samples.length).toBeLessThan(
        Math.ceil(original.length / speed) + sampleRate * 0.2,
      );
      // Count positive crossings in the middle, avoiding WSOLA boundary transitions.
      const first = Math.round(sampleRate * 0.15);
      const last = samples.length - first;
      let crossings = 0;
      for (let i = first + 1; i < last; i++)
        if (samples[i - 1] < 0 && samples[i] >= 0) crossings++;
      const frequency = (crossings * sampleRate) / (last - first);
      expect(frequency).toBeGreaterThan(425);
      expect(frequency).toBeLessThan(455);
      expect(
        samples
          .subarray(-sampleRate / 10)
          .some((sample) => Math.abs(sample) > 0.1),
      ).toBe(true);
    },
  );
  it("retains a very short waveform even below SimpleFilter's minimum read size", () => {
    for (const speed of [0.5, 1.5, 2]) {
      const samples = concat([...tempoBlocks(tone(0.05), sampleRate, speed)]);
      expect(samples.length).toBeGreaterThanOrEqual(Math.ceil(2205 / speed));
      expect(samples.length).toBeLessThan(
        Math.ceil(2205 / speed) + sampleRate * 0.2,
      );
      expect(samples.some((sample) => Math.abs(sample) > 0.1)).toBe(true);
    }
  });
  it("encodes genuine MP3 frame headers from sequential asynchronous chunks", async () => {
    const progress: number[] = [];
    async function* chunks() {
      yield tone(0.2);
      yield tone(0.2, 880);
    }
    const blob = await encodeMp3(chunks(), sampleRate, {
      speed: 1,
      pause: 0.1,
      progress: (count) => progress.push(count),
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(blob.type).toBe("audio/mpeg");
    expect(bytes.length).toBeGreaterThan(7000);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1] & 0xe0).toBe(0xe0);
    expect(progress).toEqual([1, 2]);
  });
  it("rejects invalid PCM, absent chunks, and cancelled work", async () => {
    await expect(
      encodeMp3([], sampleRate, { speed: 1, pause: 0 }),
    ).rejects.toThrow("구간");
    await expect(
      encodeMp3([new Float32Array([NaN])], sampleRate, { speed: 1, pause: 0 }),
    ).rejects.toThrow("올바르지");
    await expect(
      encodeMp3([tone(0.1)], sampleRate, { speed: 3, pause: 0 }),
    ).rejects.toThrow("속도");
    const controller = new AbortController();
    controller.abort();
    await expect(
      encodeMp3([tone(0.1)], sampleRate, {
        speed: 1,
        pause: 0,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });
  it("encodes successfully when the optional progress callback is omitted", async () => {
    const blob = await encodeMp3([tone(0.1), tone(0.1)], sampleRate, {
      speed: 1,
      pause: 0.1,
    });
    expect(blob.size).toBeGreaterThan(4000);
  });
});
