// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Models from "./Models";
import { type Model } from "./api";
import { browserModel } from "./browser/catalog";

vi.mock("./RuntimeHelp", () => ({ default: () => null }));

let root: Root;
let container: HTMLDivElement;
const onDelete = vi.fn();
const onDownload = vi.fn();
const writeText = vi.fn();
const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const storage: NonNullable<Model["storage"]> = {
  kind: "indexeddb",
  location:
    "https://doc2audio.test\nIndexedDB: doc2audio-browser\nassets, assetParts",
  used_bytes: 250_000_000,
  has_data: true,
  can_delete: true,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onDelete.mockReset();
  onDownload.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  if (clipboardDescriptor)
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else Reflect.deleteProperty(navigator, "clipboard");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const model = (overrides: Partial<Model> = {}): Model => ({
  ...browserModel(true),
  name: "테스트 모델",
  storage,
  ...overrides,
});
async function render(value = model(), busy = false) {
  await act(async () =>
    root.render(
      <Models
        models={[value]}
        jobs={[]}
        busy={busy}
        onDownload={onDownload}
        onDelete={onDelete}
      />,
    ),
  );
}
function button(name: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find(
    (item) =>
      (item.getAttribute("aria-label") || item.textContent?.trim()) === name,
  );
  if (!found) throw new Error(`버튼이 없습니다: ${name}`);
  return found;
}
async function click(name: string) {
  await act(async () => button(name).click());
}

it("requires confirmation, describes preserved files, and cancels without deleting", async () => {
  await render();
  await click("테스트 모델 모델 삭제");
  expect(onDelete).not.toHaveBeenCalled();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("250.0 MB");
  expect(dialog.textContent).toContain(
    "원문, 작업 기록, 완성된 MP3는 그대로 남습니다",
  );
  expect(dialog.textContent).toContain("다시 변환하려면 다운로드가 필요합니다");
  await click("취소");
  await act(async () => vi.advanceTimersByTimeAsync(400));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(onDelete).not.toHaveBeenCalled();
});

it("deletes only the confirmed model, including an incomplete download", async () => {
  await render(model({ installed: false }));
  expect(container.textContent).toContain("일부 다운로드됨");
  expect(button("테스트 모델 모델 삭제").disabled).toBe(false);
  await click("테스트 모델 모델 삭제");
  await click("삭제하기");
  expect(onDelete).toHaveBeenCalledExactlyOnceWith("supertonic-3");
  expect(onDownload).not.toHaveBeenCalled();
});

it("uses the backend deletion guard even when no active job is visible on this page", async () => {
  await render(
    model({
      storage: {
        ...storage,
        can_delete: false,
        delete_blocked_reason:
          "다른 작업에서 사용 중입니다. 작업이 끝난 뒤 삭제하세요.",
      },
    }),
  );
  expect(button("테스트 모델 모델 삭제").disabled).toBe(true);
  expect(container.textContent).toContain("다른 작업에서 사용 중입니다");
  await click("테스트 모델 모델 삭제");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(onDelete).not.toHaveBeenCalled();
});

it("rechecks updated storage guards while the confirmation is open", async () => {
  await render();
  await click("테스트 모델 모델 삭제");
  await render(
    model({
      storage: {
        ...storage,
        can_delete: false,
        delete_blocked_reason: "작업이 시작됐습니다.",
      },
    }),
  );
  expect(button("삭제하기").disabled).toBe(true);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "작업이 시작됐습니다",
  );
  await click("삭제하기");
  expect(onDelete).not.toHaveBeenCalled();
});

it("has no delete action for absent data or unavailable storage metadata", async () => {
  await render(
    model({
      installed: false,
      storage: {
        ...storage,
        used_bytes: 0,
        has_data: false,
        can_delete: false,
      },
    }),
  );
  expect(container.textContent).toContain("저장 용량 0 B");
  expect(container.textContent).toContain("저장된 모델 데이터가 없습니다");
  expect(
    container.querySelector('[aria-label="테스트 모델 모델 삭제"]'),
  ).toBeNull();
  await render(model({ storage: undefined }));
  expect(
    container.querySelector('[aria-label="테스트 모델 모델 삭제"]'),
  ).toBeNull();
});

it("disables deletion while another action is busy", async () => {
  await render(model(), true);
  expect(button("테스트 모델 모델 삭제").disabled).toBe(true);
  await click("테스트 모델 모델 삭제");
  expect(onDelete).not.toHaveBeenCalled();
});

it("keeps technical storage details collapsed and copies the logical browser location", async () => {
  await render();
  expect(container.querySelector("code")).toBeNull();
  expect(
    button("테스트 모델 저장 위치 보기").getAttribute("aria-expanded"),
  ).toBe("false");
  await click("테스트 모델 저장 위치 보기");
  expect(
    button("테스트 모델 저장 위치 접기").getAttribute("aria-expanded"),
  ).toBe("true");
  expect(container.querySelector("code")?.textContent).toBe(storage.location);
  expect(container.textContent).toContain(
    "실제 폴더 경로는 브라우저가 공개하지 않습니다",
  );
  await click("테스트 모델 저장 위치 복사");
  expect(writeText).toHaveBeenCalledExactlyOnceWith(storage.location);
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "복사했습니다",
  );
  await click("테스트 모델 저장 위치 접기");
  expect(container.querySelector("code")).toBeNull();
});

it("shows and copies the exact filesystem model path", async () => {
  const location = "/Users/example/내 모델 폴더/qwen3-1.7b";
  await render(
    model({
      storage: {
        ...storage,
        kind: "filesystem",
        location,
        used_bytes: 3_080_000_000,
      },
    }),
  );
  expect(container.textContent).toContain("저장 용량 3.08 GB");
  await click("테스트 모델 저장 위치 보기");
  expect(container.textContent).toContain(
    "이 컴퓨터에 저장되는 모델 폴더입니다",
  );
  expect(container.textContent).not.toContain("브라우저 내부 저장 위치");
  await click("테스트 모델 저장 위치 복사");
  expect(writeText).toHaveBeenCalledExactlyOnceWith(location);
});

it.each(["denied", "unavailable"])(
  "reports %s clipboard access and leaves the path selectable",
  async (failure) => {
    if (failure === "denied")
      writeText.mockRejectedValueOnce(
        new DOMException("blocked", "NotAllowedError"),
      );
    else Reflect.deleteProperty(navigator, "clipboard");
    await render();
    await click("테스트 모델 저장 위치 보기");
    await click("테스트 모델 저장 위치 복사");
    expect(
      Array.from(container.querySelectorAll('[role="alert"]')).some((alert) =>
        alert.textContent?.includes("복사하지 못했습니다"),
      ),
    ).toBe(true);
    expect(container.querySelector("code")?.textContent).toBe(storage.location);
    expect(container.querySelector('[role="status"]')).toBeNull();
  },
);
