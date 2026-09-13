declare module "mammoth/mammoth.browser" {
  const mammoth: {
    extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{
      value: string;
      messages: Array<{ type: string; message: string }>;
    }>;
  };
  export default mammoth;
}

declare module "soundtouchjs" {
  export class SoundTouch {
    tempo: number;
    stretch: {
      setParameters(
        sampleRate: number,
        sequenceMs: number,
        seekWindowMs: number,
        overlapMs: number,
      ): void;
    };
  }
  export class SimpleFilter {
    constructor(
      source: {
        extract(target: Float32Array, frames: number, position: number): number;
      },
      pipe: SoundTouch,
    );
    extract(target: Float32Array, frames: number): number;
  }
}
