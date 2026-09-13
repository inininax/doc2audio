import type { Model, Option, VoiceOptions } from "../api";
import manifest from "./model-manifest.json";
export { manifest };
export const PIPELINE_VERSION = 1;
const field = (
  key: string,
  label: string,
  type: Option["type"],
  value: string | number,
  extra: Partial<Option> = {},
): Option => ({ key, label, type, default: value, ...extra });
export const options: Option[] = [
  field("speaker", "목소리", "select", "F1", {
    choices: ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"],
  }),
  field("language", "언어", "select", "ko", { choices: manifest.languages }),
  field("total_steps", "음성 생성 단계", "integer", 8, {
    min: 2,
    max: 30,
    step: 1,
    help: "단계를 높이면 생성 시간이 늘어납니다.",
  }),
  field("speech_speed", "모델 발화 속도", "number", 1.05, {
    min: 0.7,
    max: 2,
    step: 0.05,
  }),
  field("speed", "출력 배속", "number", 1, { min: 0.5, max: 2, step: 0.05 }),
  field("pause", "구간 사이 쉼 (초)", "number", 0.3, {
    min: 0,
    max: 3,
    step: 0.1,
  }),
  field("seed", "랜덤 시드", "integer", 42, {
    min: 0,
    max: 4294967295,
    step: 1,
  }),
  field("chunk_chars", "구간 최대 글자 수", "integer", 120, {
    min: 40,
    max: 120,
    step: 1,
    help: "완료한 구간마다 저장합니다. 다시 열면 남은 구간부터 이어갑니다.",
  }),
];
export function browserModel(installed: boolean): Model {
  return {
    ...manifest,
    installed,
    options,
    description:
      "설치 프로그램 없이 이 브라우저에서 실행하는 한국어·다국어 음성",
  };
}
export function validateOptions(value: unknown): VoiceOptions {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("음성 설정이 올바르지 않습니다.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !options.some((o) => o.key === key)))
    throw new Error("지원하지 않는 음성 설정입니다.");
  return Object.fromEntries(
    options.map((o) => {
      const v = input[o.key] ?? o.default;
      const valid =
        o.type === "select"
          ? typeof v === "string" && o.choices!.includes(v)
          : typeof v === "number" &&
            Number.isFinite(v) &&
            v >= o.min! &&
            v <= o.max! &&
            (o.type !== "integer" || Number.isInteger(v));
      if (!valid) throw new Error(`${o.label} 값이 올바르지 않습니다.`);
      return [o.key, v as string | number];
    }),
  );
}
