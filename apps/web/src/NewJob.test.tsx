// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NewJob from "./NewJob";
import JobDetail from "./JobDetail";
import {
  defaults,
  request,
  type Job,
  type Model,
  type VoiceOptions,
} from "./api";
import { browserModel } from "./browser/catalog";

const mode = vi.hoisted(() => ({ browser: true }));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  get browserMode() {
    return mode.browser;
  },
  request: vi.fn(),
}));
vi.mock("./VoiceSample", () => ({ default: () => null }));
vi.mock("./RuntimeHelp", () => ({ default: () => null }));

// A server schema fixture exercises fields that are absent from the browser model.
const qwen: Model = {
  ...browserModel(true),
  id: "qwen3-1.7b",
  name: "Qwen3-TTS · 1.7B",
  engine: "qwen",
  options: [
    {
      key: "speaker",
      label: "목소리",
      type: "select",
      default: "Sohee",
      choices: ["Sohee", "Ryan"],
    },
    {
      key: "language",
      label: "언어",
      type: "select",
      default: "Korean",
      choices: ["Korean", "English", "auto"],
    },
    {
      key: "instruct",
      label: "말투 지시",
      type: "text",
      default: "차분하게 읽어 주세요.",
    },
    {
      key: "temperature",
      label: "표현 다양성",
      type: "number",
      default: 0.7,
      min: 0.1,
      max: 1.5,
      step: 0.05,
    },
    {
      key: "top_p",
      label: "샘플링 범위 (top-p)",
      type: "number",
      default: 0.9,
      min: 0.1,
      max: 1,
      step: 0.05,
    },
    {
      key: "top_k",
      label: "음성 토큰 후보 수 (top-k)",
      type: "integer",
      default: 50,
      min: 0,
      max: 1000,
      step: 1,
    },
    {
      key: "repetition_penalty",
      label: "반복 억제",
      type: "number",
      default: 1.05,
      min: 1,
      max: 2,
      step: 0.05,
    },
    ...browserModel(true)
      .options.filter((option) =>
        ["speed", "pause", "seed", "chunk_chars"].includes(option.key),
      )
      .map((option) =>
        option.key === "chunk_chars"
          ? { ...option, default: 240, max: 600 }
          : option,
      ),
  ],
};

let root: Root;
let container: HTMLDivElement;
const onCreated = vi.fn();
beforeEach(() => {
  mode.browser = true;
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 200, 50),
  );
  onCreated.mockReset();
  vi.mocked(request)
    .mockReset()
    .mockImplementation(async (path, init) => {
      if (
        path !== "/jobs" ||
        init?.method !== "POST" ||
        !(init.body instanceof FormData)
      )
        throw new Error(`예상하지 못한 요청: ${path}`);
      return {
        id: "submitted",
        kind: "conversion",
        model_id: init.body.get("model_id"),
        title: "설정 확인용 작업",
        status: "queued",
        created_at: "2026-09-14T00:00:00Z",
        updated_at: "2026-09-14T00:00:00Z",
        progress: 0,
        message: "대기 중",
        error: null,
        audio_url: null,
        attempt: 0,
        options: {
          voice: JSON.parse(String(init.body.get("options"))),
          pages: init.body.get("pages"),
          ocr: init.body.get("ocr"),
        },
        result: null,
      } as never;
    });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function render(models = [browserModel(true)]) {
  await act(async () =>
    root.render(
      <NewJob
        models={models}
        onCreated={onCreated}
        onModels={() => {}}
        onHelp={() => {}}
      />,
    ),
  );
}
function button(name: string) {
  const found = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  ).find(
    (element) =>
      (element.getAttribute("aria-label") || element.textContent?.trim()) ===
      name,
  );
  if (!found) throw new Error(`버튼이 없습니다: ${name}`);
  return found;
}
async function click(name: string) {
  await act(async () => button(name).click());
}
function input(key: string): HTMLInputElement | HTMLTextAreaElement {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `input[id$="-${key}"], textarea[id$="-${key}"]`,
  );
  if (!field) throw new Error(`입력이 없습니다: ${key}`);
  return field;
}
async function edit(key: string, value: string | number) {
  const field = input(key);
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      field,
      String(value),
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function select(key: string, value: string) {
  const field = container.querySelector<HTMLElement>(
    `[role="combobox"][id$="-${key}"]`,
  )!;
  if (!field) throw new Error(`선택 입력이 없습니다: ${key}`);
  await act(async () =>
    field.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    ),
  );
  const option = Array.from(
    document.querySelectorAll<HTMLElement>('[role="option"]'),
  ).find((element) => element.dataset.value === value);
  if (!option) throw new Error(`선택지가 없습니다: ${key}=${value}`);
  await act(async () => option.click());
  await act(async () => vi.advanceTimersByTimeAsync(300));
}
async function textDraft() {
  await click("텍스트 입력");
  await edit("text", "설정에 따라 읽을 문장입니다.");
}
function submitted() {
  const body = vi.mocked(request).mock.calls.at(-1)?.[1]?.body;
  if (!(body instanceof FormData)) throw new Error("전송한 작업이 없습니다.");
  return body;
}
async function expectDetail(model: Model, values: VoiceOptions) {
  const job = onCreated.mock.calls.at(-1)![0] as Job;
  await act(async () =>
    root.render(
      <JobDetail
        job={job}
        model={model}
        onClose={() => {}}
        onAction={() => {}}
        busy={false}
      />,
    ),
  );
  const dialog = document.querySelector('[role="dialog"]')!;
  for (const option of model.options) {
    const label = Array.from(dialog.querySelectorAll("dt")).find(
      (element) => element.textContent === option.label,
    );
    expect(label, `상세 옵션: ${option.key}`).toBeDefined();
    expect(label?.nextElementSibling?.textContent).toBe(
      String(values[option.key]),
    );
  }
}

it("submits every current browser catalog default without editing and reports them in job details", async () => {
  const model = browserModel(true);
  await render([model]);
  await textDraft();
  await click("음성 변환 시작");
  expect(JSON.parse(String(submitted().get("options")))).toEqual(
    defaults(model),
  );
  expect(submitted().get("model_id")).toBe(model.id);
  await expectDetail(model, defaults(model));
});

it("preserves all edited browser options, including a zero seed and zero pause", async () => {
  const model = browserModel(true);
  const values = {
    speaker: "M4",
    language: "en",
    total_steps: 12,
    speech_speed: 0.85,
    speed: 1.2,
    pause: 0,
    seed: 0,
    chunk_chars: 80,
  };
  await render([model]);
  await textDraft();
  await click("고급 음성 설정");
  await select("speaker", values.speaker);
  await select("language", values.language);
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "number") await edit(key, value);
  }
  await click("음성 변환 시작");
  expect(JSON.parse(String(submitted().get("options")))).toEqual(values);
  await expectDetail(model, values);
});

it("renders and submits server-specific options such as style, auto language, and top-k", async () => {
  mode.browser = false;
  const values: VoiceOptions = {
    ...defaults(qwen),
    speaker: "Ryan",
    language: "auto",
    instruct: "밝고 또렷하게\n영어 이름은 자연스럽게 읽어 주세요.",
    temperature: 1.1,
    top_p: 0.8,
    top_k: 25,
    repetition_penalty: 1.2,
    speed: 0.9,
    pause: 0.5,
    seed: 77,
    chunk_chars: 320,
  };
  await render([qwen]);
  await textDraft();
  await click("고급 음성 설정");
  await select("speaker", "Ryan");
  await select("language", "auto");
  expect(
    container.querySelector('[role="combobox"][id$="-language"]')?.textContent,
  ).toBe("자동 감지");
  for (const [key, value] of Object.entries(values)) {
    if (!["speaker", "language"].includes(key)) await edit(key, value);
  }
  expect(input("instruct").maxLength).toBe(1000);
  await click("음성 변환 시작");
  expect(JSON.parse(String(submitted().get("options")))).toEqual(values);
  expect(submitted().get("model_id")).toBe(qwen.id);
  await expectDetail(qwen, values);
});

it("resets options on a model switch without losing the document draft or leaking incompatible keys", async () => {
  mode.browser = false;
  const supertonic = browserModel(true);
  await render([qwen, supertonic]);
  await textDraft();
  await click("고급 음성 설정");
  await edit("instruct", "이 모델에서만 사용할 말투");
  await edit("speed", 1.5);
  await select("model", supertonic.id);
  expect(input("text").value).toBe("설정에 따라 읽을 문장입니다.");
  expect(container.querySelector('textarea[id$="-instruct"]')).toBeNull();
  expect(input("speed").value).toBe(String(defaults(supertonic).speed));
  await click("음성 변환 시작");
  expect(JSON.parse(String(submitted().get("options")))).toEqual(
    defaults(supertonic),
  );
  expect(submitted().get("model_id")).toBe(supertonic.id);
});

it.each([
  ["seed", "", "숫자를 입력하세요."],
  ["total_steps", "2.5", "정수를 입력하세요."],
  ["pause", "4", "3 이하로 입력하세요."],
])(
  "rejects invalid %s input before submission and exposes the advanced-field error",
  async (key, value, error) => {
    await render();
    await textDraft();
    await edit(key, value);
    expect(container.textContent).toContain(error);
    expect(button("고급 음성 설정").getAttribute("aria-expanded")).toBe("true");
    expect(input(key).validity.valid).toBe(false);
    await click("음성 변환 시작");
    expect(request).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  },
);
