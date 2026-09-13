export type OfflineStatus = "preparing" | "ready" | "failed" | "development";
let currentStatus: OfflineStatus = import.meta.env.DEV
  ? "development"
  : "preparing";
export const getOfflineStatus = () => currentStatus;
function status(value: OfflineStatus) {
  currentStatus = value;
  window.dispatchEvent(new Event("doc2audio-offline-status"));
}
/** Installation can become redundant instead of rejecting serviceWorker.ready. */
export function waitForInstallation(
  registration: ServiceWorkerRegistration,
): Promise<void> {
  if (registration.active) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let worker: ServiceWorker | null = null;
    const timeout = setTimeout(
      () => finish(new Error("오프라인 화면 저장 시간이 초과되었습니다.")),
      120000,
    );
    function finish(error?: Error) {
      clearTimeout(timeout);
      worker?.removeEventListener("statechange", state);
      registration.removeEventListener("updatefound", watch);
      if (error) reject(error);
      else resolve();
    }
    function state() {
      if (worker?.state === "activated") finish();
      else if (worker?.state === "redundant")
        finish(
          new Error(
            "오프라인 화면을 저장하지 못했습니다. 네트워크와 저장 공간을 확인하세요.",
          ),
        );
    }
    function watch() {
      worker?.removeEventListener("statechange", state);
      worker =
        registration.installing || registration.waiting || registration.active;
      worker?.addEventListener("statechange", state);
      state();
    }
    registration.addEventListener("updatefound", watch);
    watch();
  });
}
export async function registerOffline() {
  if (import.meta.env.DEV) return;
  if (!("serviceWorker" in navigator)) {
    status("failed");
    return;
  }
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (navigator.serviceWorker.controller) status("ready");
  });
  try {
    const registration = await navigator.serviceWorker.register(
      `${import.meta.env.BASE_URL}sw.js`,
      { scope: import.meta.env.BASE_URL },
    );
    await waitForInstallation(registration);
    status("ready");
  } catch (error) {
    console.error("오프라인 화면 저장 실패:", error);
    status("failed");
  }
}
