// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import VoiceSample from "./VoiceSample";
import OptionsForm from "./OptionsForm";
import { defaults } from "./api";
import { browserModel } from "./browser/catalog";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let root: Root | null;
let container: HTMLDivElement;
const media: HTMLMediaElement[] = [];
let play: MockInstance<HTMLMediaElement["play"]>;
let pause: MockInstance<HTMLMediaElement["pause"]>;
let visibility = "visible";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  media.length = 0;
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility as DocumentVisibilityState,
  );
  play = vi
    .spyOn(HTMLMediaElement.prototype, "play")
    .mockImplementation(function (this: HTMLMediaElement) {
      media.push(this);
      return Promise.resolve();
    });
  pause = vi
    .spyOn(HTMLMediaElement.prototype, "pause")
    .mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(speaker = "F1", active = true, modelId = "supertonic-3") {
  await act(async () =>
    root!.render(
      <VoiceSample
        modelId={modelId}
        modelName={modelId}
        speaker={speaker}
        active={active}
      />,
    ),
  );
}
async function click() {
  const button = container.querySelector("button");
  if (!button) throw new Error("샘플 버튼이 없습니다.");
  await act(async () => button.click());
}
function pendingPlay() {
  const pending = deferred();
  play.mockImplementationOnce(function (this: HTMLMediaElement) {
    media.push(this);
    return pending.promise;
  });
  return pending;
}

describe("voice samples", () => {
  it("plays the selected static sample without requiring an installed model or input", async () => {
    const model = browserModel(false);
    await act(async () =>
      root!.render(
        <OptionsForm
          model={model}
          value={{ ...defaults(model), speaker: "M4", speed: 1.5 }}
          onChange={() => {}}
        />,
      ),
    );
    const sample = Array.from(container.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label")?.endsWith("M4 샘플 듣기"),
    );
    expect(sample?.disabled).toBe(false);
    expect(play).not.toHaveBeenCalled();
    await act(async () => sample!.click());
    expect(media[0].getAttribute("src")).toBe(
      "/voice-samples/supertonic-3/M4.mp3",
    );
    expect(media[0].playbackRate).toBe(1);
    expect(container.textContent).toContain("샘플 재생 중");
    expect(container.textContent).toContain(
      "배속·말투 설정은 반영하지 않습니다",
    );
  });

  it.each(["speaker", "model"])(
    "stops the prior sample and ignores its delayed play result after a %s change",
    async (change) => {
      const oldPlay = pendingPlay();
      await render();
      await click();
      const previous = media[0];
      await render(
        change === "speaker" ? "F2" : "Sohee",
        true,
        change === "speaker" ? "supertonic-3" : "qwen3-1.7b",
      );
      expect(previous.getAttribute("src")).toBeNull();
      expect(pause.mock.instances).toContain(previous);
      await click();
      const current = media[1];
      await act(async () => oldPlay.resolve());
      expect(pause.mock.instances).not.toContain(current);
      expect(container.textContent).toContain("샘플 재생 중");
      expect(container.querySelector('[role="alert"]')).toBeNull();
    },
  );

  it("can cancel a pending load and replay without an old promise stopping the new attempt", async () => {
    const pending = pendingPlay();
    await render();
    await click();
    expect(container.querySelector("button")?.textContent).toContain(
      "불러오기 취소",
    );
    await click();
    expect(media[0].getAttribute("src")).toBeNull();
    await click();
    await act(async () => pending.resolve());
    expect(media).toHaveLength(2);
    expect(pause.mock.instances).not.toContain(media[1]);
    expect(container.textContent).toContain("샘플 재생 중");
  });

  it.each(["inactive", "hidden", "pagehide", "unmount"])(
    "stops playback on %s and ignores a late rejection",
    async (reason) => {
      const pending = pendingPlay();
      await render();
      await click();
      const current = media[0];
      if (reason === "inactive") await render("F1", false);
      else if (reason === "unmount") {
        await act(async () => root!.unmount());
        root = null;
      } else
        await act(async () => {
          if (reason === "hidden") {
            visibility = "hidden";
            document.dispatchEvent(new Event("visibilitychange"));
          } else window.dispatchEvent(new Event("pagehide"));
        });
      await act(async () =>
        pending.reject(new DOMException("cancelled", "AbortError")),
      );
      expect(current.getAttribute("src")).toBeNull();
      expect(pause.mock.instances).toContain(current);
      expect(container.querySelector('[role="alert"]')).toBeNull();
      if (reason === "inactive")
        expect(container.querySelector("button")?.disabled).toBe(true);
      visibility = "visible";
      await act(async () =>
        document.dispatchEvent(new Event("visibilitychange")),
      );
      expect(media).toHaveLength(1);
    },
  );

  it("stops when the containing form becomes disabled", async () => {
    const model = browserModel(false);
    const draw = (disabled: boolean) =>
      act(async () =>
        root!.render(
          <OptionsForm
            model={model}
            value={defaults(model)}
            onChange={() => {}}
            disabled={disabled}
          />,
        ),
      );
    await draw(false);
    await click();
    await draw(true);
    expect(pause.mock.instances).toContain(media[0]);
    expect(media[0].getAttribute("src")).toBeNull();
    expect(
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.getAttribute("aria-label")?.endsWith("F1 샘플 듣기"),
      )?.disabled,
    ).toBe(true);
  });

  it("reports file loading failures and allows retry", async () => {
    await render();
    await click();
    await act(async () => media[0].dispatchEvent(new Event("error")));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "샘플 파일을 불러오지 못했습니다",
    );
    await click();
    expect(media).toHaveLength(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("샘플 재생 중");
  });

  it("reports blocked playback instead of claiming playback started", async () => {
    play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    await render();
    await click();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "브라우저가 재생을 허용하지 않았습니다",
    );
    expect(container.textContent).not.toContain("샘플 재생 중");
    expect(container.querySelector("button")?.textContent).toContain(
      "샘플 듣기",
    );
  });

  it("returns to the play action after natural completion", async () => {
    await render();
    await click();
    await act(async () => media[0].dispatchEvent(new Event("ended")));
    expect(container.textContent).toContain("샘플 재생이 끝났습니다");
    expect(container.querySelector("button")?.textContent).toContain(
      "샘플 듣기",
    );
  });
});
