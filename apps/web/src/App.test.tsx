// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request, type Health, type Job } from "./api";
import { browserModel } from "./browser/catalog";

const mode = vi.hoisted(() => ({ browser: true }));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  get browserMode() {
    return mode.browser;
  },
  request: vi.fn(),
}));

const health: Health = {
  status: "ok",
  version: "UI-TEST",
  ffmpeg: true,
  platform: "test",
  machine: "test",
  catalog_reviewed_at: "2026-09-13",
};
function job(id: string, title = id): Job {
  return {
    id,
    title,
    kind: "conversion",
    model_id: "supertonic-3",
    status: "running",
    created_at: "2026-09-13T00:00:00Z",
    updated_at: "2026-09-13T00:00:00Z",
    progress: 0.2,
    message: "테스트 작업",
    error: null,
    audio_url: null,
    attempt: 1,
    options: {},
    result: null,
    events: [],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function visibleText(selector: string) {
  return Array.from(document.querySelectorAll(selector))
    .filter((element) => !element.closest("[hidden]"))
    .map((element) => element.textContent?.trim());
}
function button(name: string): HTMLButtonElement {
  const result = Array.from(document.querySelectorAll("button")).find(
    (element) =>
      !element.closest("[hidden]") &&
      (element.getAttribute("aria-label") || element.textContent?.trim()) ===
        name,
  );
  if (!result) throw new Error(`버튼을 찾을 수 없습니다: ${name}`);
  return result;
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  mode.browser = true;
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  window.history.replaceState(null, "", "/#history");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function render() {
  await act(async () => root.render(<App />));
}
async function click(name: string) {
  await act(async () => button(name).click());
}
function api(handler: (path: string, init?: RequestInit) => unknown) {
  vi.mocked(request).mockImplementation(async (path, init) => {
    if (path === "/models") return { items: [browserModel(true)] } as never;
    if (path === "/health") return health as never;
    return (await handler(path, init)) as never;
  });
}

describe("job detail request ordering", () => {
  it.each(["resolve", "reject"] as const)(
    "keeps the action result when an earlier poll later %ss",
    async (settle) => {
      const oldPoll = deferred<Job>();
      const initial = job("selected", "선택한 작업");
      let latest = initial;
      let reads = 0;
      api((path, init) => {
        if (path.startsWith("/jobs?")) return { items: [latest], total: 1 };
        if (path === "/jobs/selected/pause" && init?.method === "POST") {
          latest = { ...initial, status: "paused", message: "일시정지 완료" };
          return latest;
        }
        if (path === "/jobs/selected") {
          reads++;
          return reads === 1 ? oldPoll.promise : latest;
        }
        throw new Error(`예상하지 못한 요청: ${path}`);
      });
      await render();
      await click("선택한 작업 작업 상세 보기");
      await click("일시정지");
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        "일시정지 완료",
      );
      await act(async () => {
        if (settle === "resolve") oldPoll.resolve(initial);
        else oldPoll.reject(new Error("오래된 조회 실패"));
      });
      const detail = document.querySelector('[role="dialog"]')?.textContent;
      expect(detail).toContain("일시정지 완료");
      expect(detail).not.toContain("오래된 조회 실패");
    },
  );
});

describe("history loading states", () => {
  it("does not show the previous page's jobs under the next page number", async () => {
    const next = deferred<{ items: Job[]; total: number }>();
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      job(`first-${index}`, `첫째 페이지 작업 ${index}`),
    );
    api((path) => {
      if (path === "/jobs?limit=50&offset=0")
        return { items: firstPage, total: 51 };
      if (path === "/jobs?limit=50&offset=50") return next.promise;
      throw new Error(`예상하지 못한 요청: ${path}`);
    });
    await render();
    expect(visibleText("h3")).toContain("첫째 페이지 작업 0");
    await click("다음");
    expect(visibleText("h3")).not.toContain("첫째 페이지 작업 0");
    expect(visibleText("h3")).not.toContain("아직 작업이 없습니다");
    expect(
      document.querySelector('[aria-label="작업 기록 불러오는 중"]'),
    ).not.toBeNull();
    await act(async () =>
      next.resolve({ items: [job("last", "둘째 페이지 작업")], total: 51 }),
    );
    expect(visibleText("h3")).toContain("둘째 페이지 작업");
  });

  it("shows the empty state only after a successful empty response", async () => {
    let failing = true;
    api((path) => {
      if (path.startsWith("/jobs?")) {
        if (failing) throw new Error("저장소를 읽지 못했습니다");
        return { items: [], total: 0 };
      }
      throw new Error(`예상하지 못한 요청: ${path}`);
    });
    await render();
    expect(visibleText('[role="alert"]')).toContain("저장소를 읽지 못했습니다");
    expect(visibleText("h3")).not.toContain("아직 작업이 없습니다");
    failing = false;
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(visibleText("h3")).toContain("아직 작업이 없습니다");
  });
});

describe("help navigation", () => {
  it("opens a direct help link when storage or server initialization fails", async () => {
    window.history.replaceState(null, "", "/#help");
    vi.mocked(request).mockRejectedValue(new Error("저장소를 열 수 없습니다"));
    await render();
    expect(visibleText("h1")).toEqual(["도움말"]);
    expect(button("도움말").getAttribute("aria-current")).toBe("page");
    expect(visibleText("h2")).toContain("접속부터 MP3까지, 7단계");
    expect(visibleText('[role="alert"]')).toContain("저장소를 열 수 없습니다");
  });

  it("keeps the selected file and text draft while visiting help from the form and menu", async () => {
    window.history.replaceState(null, "", "/#new");
    api((path) => {
      if (path.startsWith("/jobs?")) return { items: [], total: 0 };
      throw new Error(`예상하지 못한 요청: ${path}`);
    });
    await render();
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["테스트 문서"], "이어갈 문서.txt", {
      type: "text/plain",
    });
    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [file],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      button("텍스트 입력").click();
    });
    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea:not([aria-hidden="true"])',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(textarea, "도움말을 읽고 돌아와도 유지할 문장입니다.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      container.querySelector<HTMLAnchorElement>('a[href="#help"]')!.click(),
    );
    expect(visibleText("h1")).toEqual(["도움말"]);
    expect(location.hash).toBe("#help");
    await click("새 음성 만들기");
    expect(textarea.value).toBe("도움말을 읽고 돌아와도 유지할 문장입니다.");
    await click("파일 선택");
    expect(button("파일 바꾸기").textContent).toContain("이어갈 문서.txt");
    await click("도움말");
    await click("새 음성 만들기");
    expect(button("파일 바꾸기").textContent).toContain("이어갈 문서.txt");
    expect(
      vi.mocked(request).mock.calls.every(([, init]) => !init?.method),
    ).toBe(true);
  });

  it.each([true, false])(
    "describes the actual processing boundary for browser mode = %s",
    async (browser) => {
      mode.browser = browser;
      window.history.replaceState(null, "", "/#new");
      api((path) => {
        if (path.startsWith("/jobs?")) return { items: [], total: 0 };
        throw new Error(`예상하지 못한 요청: ${path}`);
      });
      await render();
      const form = container.querySelector('form[aria-label="새 음성 작업"]')!;
      expect(form.textContent).toContain(
        browser
          ? "이 PC의 브라우저 안에서 처리"
          : "이 PC의 Python 서버로 문서를 전달",
      );
      expect(form.textContent).not.toContain(
        browser
          ? "이 PC의 Python 서버로 문서를 전달"
          : "이 PC의 브라우저 안에서 처리",
      );
      await click("도움말");
      const steps = container.querySelector("ol")!;
      expect(steps.textContent).toContain(
        browser ? "내 PC · 브라우저 저장소" : "프로젝트 · .models/",
      );
      expect(steps.textContent).not.toContain(
        browser ? "프로젝트 · .models/" : "내 PC · 브라우저 저장소",
      );
    },
  );
});
