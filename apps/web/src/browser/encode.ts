import { Mp3Encoder } from "@breezystack/lamejs";
import { SimpleFilter, SoundTouch } from "soundtouchjs";

export type EncodeOptions = {
  speed: number;
  pause: number;
  signal?: AbortSignal;
  progress?: (chunks: number) => void;
  onDuration?: (seconds: number) => void;
};

const BLOCK_SIZE = 1152;

/** WSOLA changes duration without shifting voice pitch. Streaming blocks retain bounded RAM. */
export function* tempoBlocks(
  samples: Float32Array,
  sampleRate: number,
  speed: number,
): Generator<Float32Array> {
  if (speed === 1) {
    for (let offset = 0; offset < samples.length; offset += BLOCK_SIZE) {
      yield samples.subarray(offset, offset + BLOCK_SIZE);
    }
    return;
  }
  const soundTouch = new SoundTouch();
  soundTouch.stretch.setParameters(sampleRate, 0, 0, 8);
  soundTouch.tempo = speed;
  const filter = new SimpleFilter(
    {
      extract(target, frames, position) {
        // SimpleFilter requires 16,384 input frames before processing. Pad its final
        // read to flush the WSOLA tail. Actual tail latency is signal-dependent.
        const available = Math.max(
          0,
          Math.min(frames, samples.length + 32768 - position),
        );
        for (let i = 0; i < available; i++) {
          const value = samples[position + i] || 0;
          target[i * 2] = target[i * 2 + 1] = value;
        }
        return available;
      },
    },
    soundTouch,
  );
  const stereo = new Float32Array(BLOCK_SIZE * 2);
  const outputFrames = Math.ceil(samples.length / speed);
  for (let offset = 0; offset < outputFrames;) {
    const wanted = Math.min(BLOCK_SIZE, outputFrames - offset);
    const received = filter.extract(stereo, wanted);
    if (!received) throw new Error("음성 배속 변환을 끝내지 못했습니다.");
    const mono = new Float32Array(received);
    for (let i = 0; i < received; i++) mono[i] = stereo[i * 2];
    offset += received;
    yield mono;
  }
  // A nominal length cut can erase an entire final syllable: WSOLA may place its
  // last overlap after that boundary. Drain the padded pipeline and retain every
  // audible tail sample. Only this bounded flush region is buffered in memory.
  const tail: Float32Array[] = [];
  let tailFrames = 0;
  let lastAudible = -1;
  while (true) {
    const received = filter.extract(stereo, BLOCK_SIZE);
    if (!received) break;
    const mono = new Float32Array(received);
    for (let i = 0; i < received; i++) {
      mono[i] = stereo[i * 2];
      if (Math.abs(mono[i]) > 0.000001) lastAudible = tailFrames + i;
    }
    tail.push(mono);
    tailFrames += received;
  }
  let remaining = Math.min(tailFrames, lastAudible + 1);
  for (const block of tail) {
    if (remaining <= 0) break;
    const count = Math.min(block.length, remaining);
    yield block.subarray(0, count);
    remaining -= count;
  }
}

export async function encodeMp3(
  chunks: AsyncIterable<Float32Array> | Float32Array[],
  sampleRate: number,
  options: EncodeOptions,
): Promise<Blob> {
  if (
    ![8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000].includes(
      sampleRate,
    )
  ) {
    throw new Error("지원되지 않는 음성 샘플레이트입니다.");
  }
  if (
    !Number.isFinite(options.speed) ||
    options.speed < 0.5 ||
    options.speed > 2 ||
    !Number.isFinite(options.pause) ||
    options.pause < 0 ||
    options.pause > 3
  ) {
    throw new Error("속도는 0.5~2배, 구간 쉼은 0~3초여야 합니다.");
  }
  options.signal?.throwIfAborted();
  const encoder = new Mp3Encoder(1, sampleRate, 128);
  const parts: BlobPart[] = [];
  let processed = 0;
  let blocks = 0;
  let encodedFrames = 0;
  const encode = (samples: Float32Array) => {
    encodedFrames += samples.length;
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const sample = Math.max(-1, Math.min(1, samples[i]));
      pcm[i] = Math.round(sample * (sample < 0 ? 32768 : 32767));
    }
    const encoded = encoder.encodeBuffer(pcm);
    if (encoded.length) parts.push(new Uint8Array(encoded).buffer);
  };
  for await (const samples of chunks) {
    options.signal?.throwIfAborted();
    if (!samples.length) throw new Error("빈 음성 구간은 저장할 수 없습니다.");
    for (const sample of samples) {
      if (!Number.isFinite(sample))
        throw new Error("음성 구간에 올바르지 않은 값이 있습니다.");
    }
    if (processed > 0) {
      // Keep the CLI semantics: speed applies to pauses as well as speech.
      const pauseFrames = Math.round(
        (sampleRate * options.pause) / options.speed,
      );
      for (let offset = 0; offset < pauseFrames; offset += BLOCK_SIZE) {
        encode(new Float32Array(Math.min(BLOCK_SIZE, pauseFrames - offset)));
      }
    }
    for (const block of tempoBlocks(samples, sampleRate, options.speed)) {
      options.signal?.throwIfAborted();
      encode(block);
      if (++blocks % 64 === 0)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    processed++;
    options.progress?.(processed);
  }
  if (!processed) throw new Error("저장할 음성 구간이 없습니다.");
  options.signal?.throwIfAborted();
  const final = encoder.flush();
  if (final.length) parts.push(new Uint8Array(final).buffer);
  options.onDuration?.(encodedFrames / sampleRate);
  return new Blob(parts, { type: "audio/mpeg" });
}
