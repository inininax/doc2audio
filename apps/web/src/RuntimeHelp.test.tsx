// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RuntimeHelp from "./RuntimeHelp";

const mode = vi.hoisted(() => ({ browser: true }));
vi.mock("./api", () => ({
  get browserMode() {
    return mode.browser;
  },
}));
let root: Root;
let container: HTMLDivElement;
const fetcher = vi.fn();
beforeEach(() => {
  mode.browser = true;
  fetcher.mockReset();
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("offers an explicit local-server link without probing it or attaching document data", async () => {
  await act(async () => root.render(<RuntimeHelp />));
  const link = container.querySelector<HTMLAnchorElement>(
    'a[href^="http://127.0.0.1"]',
  )!;
  expect(link.href).toBe("http://127.0.0.1:8010/?runtime=local#new");
  expect(link.target).toBe("_blank");
  expect(link.rel.split(" ")).toEqual(
    expect.arrayContaining(["noopener", "noreferrer"]),
  );
  expect(link.getAttribute("aria-label")).toContain("새 탭");
  expect(container.textContent).toContain("Apple Silicon Mac");
  expect(container.textContent).toContain("uv run doc2audio-server");
  expect(container.textContent).toContain("서버를 실행한 뒤");
  expect(fetcher).not.toHaveBeenCalled();
});

it("expands setup instructions inside a job form without submitting the form", async () => {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  await act(async () =>
    root.render(
      <form onSubmit={submit}>
        <RuntimeHelp compact />
      </form>,
    ),
  );
  const toggle = container.querySelector<HTMLButtonElement>(
    "button[aria-expanded]",
  )!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelector('a[href^="http://127.0.0.1"]')).toBeNull();
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(
    document.getElementById(toggle.getAttribute("aria-controls")!),
  ).not.toBeNull();
  expect(container.textContent).toContain("uv run doc2audio-server");
  expect(submit).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});

it("does not offer a switch to the same local mode", async () => {
  mode.browser = false;
  await act(async () => root.render(<RuntimeHelp />));
  expect(container.textContent).toBe("");
  expect(fetcher).not.toHaveBeenCalled();
});
