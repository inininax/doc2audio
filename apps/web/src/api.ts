export type Option = {
  key: string;
  label: string;
  type: "select" | "text" | "number" | "integer";
  default: string | number;
  choices?: string[];
  min?: number;
  max?: number;
  step?: number;
  help?: string;
};
export type VoiceOptions = Record<string, string | number>;
export type Model = {
  id: string;
  name: string;
  engine: string;
  description: string;
  installed: boolean;
  size_bytes: number;
  license: string;
  license_url: string;
  source_url: string;
  revision: string;
  reviewed_at: string;
  options: Option[];
  storage?: {
    kind: "indexeddb" | "filesystem";
    location: string;
    used_bytes: number;
    has_data: boolean;
    can_delete: boolean;
    delete_blocked_reason?: string;
  };
};
export type Job = {
  id: string;
  kind: "download" | "conversion";
  model_id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  progress: number;
  message: string;
  error: string | null;
  audio_url: string | null;
  attempt: number;
  options: { voice?: VoiceOptions; pages?: string; ocr?: string };
  result: { seconds?: number; chunks?: number; reused_chunks?: number } | null;
  events?: { id: number; created_at: string; message: string }[];
};
export type Health = {
  status: string;
  version: string;
  ffmpeg: boolean;
  platform: string;
  machine: string;
  catalog_reviewed_at: string;
  runtime?: "browser" | "local";
  storage?: { usage: number; quota: number; persistent: boolean };
};
export const browserMode =
  new URLSearchParams(location.search).get("runtime") !== "local";
export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (browserMode) {
    const { browserRequest } = await import("./browser/service");
    return browserRequest<T>(path, init);
  }
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { "X-Doc2Audio": "1", ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : `요청 실패 (${response.status})`,
    );
  }
  return response.json() as Promise<T>;
}
export const defaults = (model: Model): VoiceOptions =>
  Object.fromEntries(model.options.map((o) => [o.key, o.default]));
export const active = (job: Job) =>
  ["queued", "running", "cancelling"].includes(job.status);
