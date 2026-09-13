/** Supertonic inference adapted from Supertone's MIT-licensed web example.
 * See SUPERTONIC-NOTICE.md. Model weights have a separate OpenRAIL-M license.
 */
import * as ort from "onnxruntime-web/wasm";

import { encodeText, LANGUAGES } from "./speech-text";
export { encodeText, LANGUAGES, normalizeSpeechText } from "./speech-text";

export type ReadAsset = (name: string) => Promise<ArrayBuffer>;
export type SpeechResult = { samples: Float32Array; sampleRate: number };
type Config = {
  ae: { sample_rate: number; base_chunk_size: number };
  ttl: { chunk_compress_factor: number; latent_dim: number };
};
type StyleData = { data: number[][][]; dims: number[] };
type VoiceStyle = { style_ttl: StyleData; style_dp: StyleData };

export function speechOptions(options: Record<string, string | number>) {
  const speaker = String(options.speaker ?? "F1");
  const language = String(options.language ?? "ko");
  const steps = Number(options.total_steps ?? 8);
  const speed = Number(options.speech_speed ?? 1.05);
  if (!/^[FM][1-5]$/.test(speaker))
    throw new Error("지원하지 않는 목소리입니다.");
  if (!(LANGUAGES as readonly string[]).includes(language))
    throw new Error("지원하지 않는 언어입니다.");
  if (!Number.isInteger(steps) || steps < 2 || steps > 30)
    throw new Error("음성 생성 단계는 2~30 사이의 정수여야 합니다.");
  if (!Number.isFinite(speed) || speed < 0.7 || speed > 2)
    throw new Error("말하기 속도는 0.7~2 사이여야 합니다.");
  return { speaker, language, steps, speed };
}

/** Per-chunk RNG makes a resumed chunk independent of previous worker lifetime. */
export function seededRandom(seed: number): () => number {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error("시드는 0~4294967295 사이의 정수여야 합니다.");
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function noisyLatent(duration: number, config: Config, seed: number) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 300)
    throw new Error("모델이 올바르지 않은 음성 길이를 반환했습니다.");
  const frames = Math.floor(duration * config.ae.sample_rate);
  const chunk = config.ae.base_chunk_size * config.ttl.chunk_compress_factor;
  const length = Math.ceil(frames / chunk);
  const channels = config.ttl.latent_dim * config.ttl.chunk_compress_factor;
  if (
    !Number.isSafeInteger(length) ||
    length < 1 ||
    !Number.isSafeInteger(channels) ||
    channels < 1
  )
    throw new Error("모델의 잠재 공간 설정을 읽을 수 없습니다.");
  const random = seededRandom(seed);
  const samples = new Float32Array(channels * length);
  for (let index = 0; index < samples.length; index++) {
    const first = Math.max(0.0001, random());
    samples[index] =
      Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * random());
  }
  return {
    samples,
    mask: new Float32Array(length).fill(1),
    shape: [1, channels, length],
  };
}

export function trimWaveform(
  samples: Float32Array,
  duration: number,
  sampleRate: number,
): Float32Array {
  const length = Math.floor(duration * sampleRate);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isSafeInteger(length) ||
    length < 1 ||
    length > samples.length
  )
    throw new Error("모델이 불완전한 음성을 반환했습니다.");
  const result = samples.slice(0, length);
  if (result.some((value) => !Number.isFinite(value)))
    throw new Error("모델이 올바르지 않은 음성을 반환했습니다.");
  return result;
}

export class BrowserSpeechEngine {
  readonly sampleRate: number;
  private readonly styles = new Map<
    string,
    { ttl: ort.Tensor; dp: ort.Tensor }
  >();

  private constructor(
    private readonly config: Config,
    private readonly indexer: number[],
    private readonly sessions: ort.InferenceSession[],
    private readonly readAsset: ReadAsset,
  ) {
    this.sampleRate = config.ae.sample_rate;
  }

  static async create(
    readAsset: ReadAsset,
    runtimeUrl: string,
  ): Promise<BrowserSpeechEngine> {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = runtimeUrl;
    const decoder = new TextDecoder();
    const config: Config = JSON.parse(
      decoder.decode(await readAsset("onnx/tts.json")),
    );
    const indexer: number[] = JSON.parse(
      decoder.decode(await readAsset("onnx/unicode_indexer.json")),
    );
    if (
      !Number.isFinite(config.ae?.sample_rate) ||
      config.ae.sample_rate < 8000 ||
      !Array.isArray(indexer)
    )
      throw new Error(
        "모델 설정이 손상되었습니다. 모델을 다시 다운로드해 주세요.",
      );
    const sessions: ort.InferenceSession[] = [];
    try {
      for (const filename of [
        "duration_predictor",
        "text_encoder",
        "vector_estimator",
        "vocoder",
      ]) {
        // Read one model at a time to bound peak JS memory. No remote model URLs.
        const bytes = await readAsset(`onnx/${filename}.onnx`);
        sessions.push(
          await ort.InferenceSession.create(bytes, {
            executionProviders: ["wasm"],
          }),
        );
      }
      return new BrowserSpeechEngine(config, indexer, sessions, readAsset);
    } catch (error) {
      await Promise.allSettled(sessions.map((session) => session.release()));
      throw error;
    }
  }

  private async style(speaker: string) {
    const existing = this.styles.get(speaker);
    if (existing) return existing;
    const data: VoiceStyle = JSON.parse(
      new TextDecoder().decode(
        await this.readAsset(`voice_styles/${speaker}.json`),
      ),
    );
    const style = {
      ttl: new ort.Tensor(
        "float32",
        Float32Array.from(data.style_ttl.data.flat(2)),
        data.style_ttl.dims,
      ),
      dp: new ort.Tensor(
        "float32",
        Float32Array.from(data.style_dp.data.flat(2)),
        data.style_dp.dims,
      ),
    };
    this.styles.set(speaker, style);
    return style;
  }

  async synthesize(
    text: string,
    options: Record<string, string | number>,
    seed: number,
  ): Promise<SpeechResult> {
    const { speaker, language, steps, speed } = speechOptions(options);
    const { ids, mask } = encodeText(text, language, this.indexer);
    const style = await this.style(speaker);
    const allocated = new Set<ort.Tensor>();
    const track = <T extends ort.Tensor>(tensor: T): T => {
      allocated.add(tensor);
      return tensor;
    };
    const outputs = (values: ort.InferenceSession.ReturnType) => {
      Object.values(values).forEach(track);
      return values;
    };
    const [durationModel, textModel, vectorModel, vocoder] = this.sessions;
    try {
      const textIds = track(new ort.Tensor("int64", ids, [1, ids.length]));
      const textMask = track(
        new ort.Tensor("float32", mask, [1, 1, mask.length]),
      );
      const prediction = outputs(
        await durationModel.run({
          text_ids: textIds,
          text_mask: textMask,
          style_dp: style.dp,
        }),
      );
      const duration = Number(prediction.duration.data[0]) / speed;
      const encoded = outputs(
        await textModel.run({
          text_ids: textIds,
          text_mask: textMask,
          style_ttl: style.ttl,
        }),
      );
      const noise = noisyLatent(duration, this.config, seed);
      const latentMask = track(
        new ort.Tensor("float32", noise.mask, [1, 1, noise.mask.length]),
      );
      const totalStep = track(
        new ort.Tensor("float32", Float32Array.of(steps), [1]),
      );
      let latent: ort.Tensor = track(
        new ort.Tensor("float32", noise.samples, noise.shape),
      );
      for (let step = 0; step < steps; step++) {
        const current = track(
          new ort.Tensor("float32", Float32Array.of(step), [1]),
        );
        const result = outputs(
          await vectorModel.run({
            noisy_latent: latent,
            text_emb: encoded.text_emb,
            style_ttl: style.ttl,
            latent_mask: latentMask,
            text_mask: textMask,
            current_step: current,
            total_step: totalStep,
          }),
        );
        const previous = latent;
        latent = result.denoised_latent;
        // Iterations can be numerous; release each previous tensor immediately.
        previous.dispose();
        allocated.delete(previous);
        current.dispose();
        allocated.delete(current);
      }
      const result = outputs(await vocoder.run({ latent }));
      if (!(result.wav_tts.data instanceof Float32Array))
        throw new Error("음성 출력 형식을 읽을 수 없습니다.");
      return {
        samples: trimWaveform(result.wav_tts.data, duration, this.sampleRate),
        sampleRate: this.sampleRate,
      };
    } finally {
      allocated.forEach((tensor) => tensor.dispose());
    }
  }
}
