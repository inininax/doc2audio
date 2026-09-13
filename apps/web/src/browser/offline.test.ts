import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForInstallation } from "./offline";
class WorkerState extends EventTarget {
  state: ServiceWorkerState = "installing";
}
class Registration extends EventTarget {
  active: WorkerState | null = null;
  waiting = null;
  installing: WorkerState | null = new WorkerState();
}
afterEach(() => vi.useRealTimers());
describe("offline shell installation", () => {
  it("does not wait for a new update when an offline shell is active", async () => {
    const registration = new Registration();
    registration.active = new WorkerState();
    await expect(
      waitForInstallation(registration as unknown as ServiceWorkerRegistration),
    ).resolves.toBeUndefined();
  });
  it("reports a failed first installation instead of waiting forever", async () => {
    const registration = new Registration();
    const ready = waitForInstallation(
      registration as unknown as ServiceWorkerRegistration,
    );
    registration.installing!.state = "redundant";
    registration.installing!.dispatchEvent(new Event("statechange"));
    await expect(ready).rejects.toThrow("저장하지 못했습니다");
  });
  it("becomes ready only after the worker activates", async () => {
    const registration = new Registration();
    const ready = waitForInstallation(
      registration as unknown as ServiceWorkerRegistration,
    );
    registration.installing!.state = "activated";
    registration.installing!.dispatchEvent(new Event("statechange"));
    await expect(ready).resolves.toBeUndefined();
  });
  it("does not leave an unbounded wait when no installation event arrives", async () => {
    vi.useFakeTimers();
    const registration = new Registration();
    registration.installing = null;
    const ready = waitForInstallation(
      registration as unknown as ServiceWorkerRegistration,
    );
    const result = expect(ready).rejects.toThrow("초과");
    await vi.advanceTimersByTimeAsync(120000);
    await result;
  });
});
