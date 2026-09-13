// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request, type Health, type Job } from "./api";
import { browserModel } from "./browser/catalog";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  browserMode: true,
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
