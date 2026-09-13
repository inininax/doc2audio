import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Job, Model } from "../api";
import manifest from "./model-manifest.json";

export type StoredJob = Job & {
  source?: Blob;
  filename?: string;
  texts?: string[];
  /** Original text indexes eligible for speech; preserves legacy PCM and seeds. */
  spokenIndexes?: number[];
  pipelineVersion: number;
  modelRevision: string;
  fingerprint?: string;
  runToken?: string;
  completedChunks: number;
  sampleRate?: number;
  output?: Blob;
};

type Chunk = {
  jobId: string;
  index: number;
  samples: Float32Array<ArrayBuffer>;
  sampleRate: number;
  sha256: string;
  fingerprint?: string;
  pipelineVersion: number;
  modelRevision: string;
};
type Asset = {
  key: string;
  size: number;
  sha256: string;
  verified: true;
  blob: Blob;
};
export type AssetPart = { key: string; offset: number; blob: Blob };
interface Library extends DBSchema {
  jobs: { key: string; value: StoredJob };
  chunks: {
    key: [string, number];
    value: Chunk;
    indexes: { "by-job": string };
  };
  assets: { key: string; value: Asset };
  assetParts: {
    key: [string, number];
    value: AssetPart;
    indexes: { "by-asset": string };
  };
}

export const DATABASE_NAME = "doc2audio-browser";
let connection: Promise<IDBPDatabase<Library>> | undefined;

function database() {
  if (!connection) {
    connection = openDB<Library>(DATABASE_NAME, 1, {
      upgrade(db) {
        db.createObjectStore("jobs", { keyPath: "id" });
        db.createObjectStore("chunks", {
          keyPath: ["jobId", "index"],
        }).createIndex("by-job", "jobId");
        db.createObjectStore("assets", { keyPath: "key" });
        db.createObjectStore("assetParts", {
          keyPath: ["key", "offset"],
        }).createIndex("by-asset", "key");
      },
      blocking() {
        // A new app version must be able to upgrade without an idle tab blocking it.
        void closeStorage();
      },
      terminated() {
        connection = undefined;
      },
    }).catch((error: unknown) => {
      connection = undefined;
      throw error;
    });
  }
  return connection;
}

/** Release this tab's connection; does not remove the user's data. */
export async function closeStorage() {
  const pending = connection;
  connection = undefined;
  if (pending) (await pending).close();
}

export async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}

function changed(job: StoredJob, patch: Partial<StoredJob>): StoredJob {
  const updated_at = new Date().toISOString();
  const events = [...(job.events || [])];
  if (patch.message) {
    events.push({
      id: (events.at(-1)?.id || 0) + 1,
      created_at: updated_at,
      message: patch.message,
    });
  }
  return {
    ...job,
    ...patch,
    id: job.id,
    created_at: job.created_at,
    updated_at,
    events: events.slice(-200),
  };
}

type Expected = { statuses?: string[]; runToken?: string };
function matches(
  job: StoredJob | undefined,
  expected?: Expected,
): job is StoredJob {
  return (
    !!job &&
    (!expected?.statuses || expected.statuses.includes(job.status)) &&
    (expected?.runToken === undefined || job.runToken === expected.runToken)
  );
}

export async function listJobs(): Promise<StoredJob[]> {
  return (await (await database()).getAll("jobs")).sort(
    (a, b) =>
      b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
  );
}

export async function getJob(id: string): Promise<StoredJob | undefined> {
  return (await database()).get("jobs", id);
}

export async function createJob(job: StoredJob): Promise<void> {
  const db = await database();
  const tx = db.transaction("jobs", "readwrite");
  await Promise.all([
    tx.store.add(changed(job, { message: job.message })),
    tx.done,
  ]);
}

export async function updateJob(
  id: string,
  patch: Partial<StoredJob>,
  expected?: Expected,
): Promise<boolean> {
  const db = await database();
  const tx = db.transaction("jobs", "readwrite");
  // Observe abort rejection even when an individual request fails first.
  void tx.done.catch(() => {});
  const job = await tx.store.get(id);
  if (!matches(job, expected)) {
    await tx.done;
    return false;
  }
  await tx.store.put(changed(job, patch));
  await tx.done;
  return true;
}

function validPCM(samples: Float32Array, sampleRate: number): boolean {
  return (
    samples instanceof Float32Array &&
    samples.length > 0 &&
    Number.isInteger(sampleRate) &&
    sampleRate >= 8000 &&
    sampleRate <= 192000 &&
    samples.every(Number.isFinite)
  );
}

function plannedIndexes(job: StoredJob): number[] {
  const indexes =
    job.spokenIndexes ?? job.texts?.map((_, index) => index) ?? [];
  if (
    !indexes.length ||
    indexes.some(
      (index, position) =>
        !Number.isInteger(index) ||
        index < 0 ||
        index >= (job.texts?.length ?? 0) ||
        (position > 0 && indexes[position - 1] >= index),
    )
  )
    throw new Error("저장된 음성 구간 계획이 올바르지 않습니다.");
  return indexes;
}

function sameInput(chunk: Chunk, job: StoredJob) {
  return (
    chunk.fingerprint === job.fingerprint &&
    chunk.pipelineVersion === job.pipelineVersion &&
    chunk.modelRevision === job.modelRevision
  );
}

export async function saveChunk(
  jobId: string,
  index: number,
  samples: Float32Array,
  sampleRate: number,
  runToken: string,
): Promise<boolean> {
  if (!Number.isInteger(index) || index < 0 || !validPCM(samples, sampleRate)) {
    throw new Error("저장할 음성 구간이 올바르지 않습니다.");
  }
  // Copy before hashing: caller transfers or reuses its worker buffer after this call.
  const pcm = new Float32Array(samples);
  const digest = await sha256(pcm.buffer);
  const db = await database();
  const tx = db.transaction(["jobs", "chunks"], "readwrite");
  void tx.done.catch(() => {});
  const jobs = tx.objectStore("jobs");
  const chunks = tx.objectStore("chunks");
  try {
    const job = await jobs.get(jobId);
    if (!matches(job, { statuses: ["running"], runToken })) {
      await tx.done;
      return false;
    }
    const indexes = plannedIndexes(job);
    if (
      !indexes.includes(index) ||
      (job.sampleRate !== undefined && job.sampleRate !== sampleRate)
    ) {
      throw new Error(
        "음성 구간이 현재 작업의 본문 또는 샘플레이트와 다릅니다.",
      );
    }
    await chunks.put({
      jobId,
      index,
      samples: pcm,
      sampleRate,
      sha256: digest,
      fingerprint: job.fingerprint,
      pipelineVersion: job.pipelineVersion,
      modelRevision: job.modelRevision,
    });
    let completedChunks: number;
    if (indexes.length === job.texts!.length) {
      completedChunks = await chunks.index("by-job").count(jobId);
    } else {
      const selected = new Set(indexes);
      const keys = await chunks.index("by-job").getAllKeys(jobId);
      completedChunks = keys.filter((key) => selected.has(key[1])).length;
    }
    await jobs.put(
      changed(job, {
        completedChunks,
        sampleRate,
        progress: Math.min(0.95, (completedChunks / indexes.length) * 0.95),
        message: `[${completedChunks}/${indexes.length}] 음성 구간을 저장했습니다.`,
      }),
    );
    await tx.done;
    return true;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* A failed transaction may already be aborted. */
    }
    await tx.done.catch(() => {});
    throw error;
  }
}

export async function readChunk(
  jobId: string,
  index: number,
): Promise<{ samples: Float32Array; sampleRate: number } | undefined> {
  const db = await database();
  const tx = db.transaction(["jobs", "chunks"]);
  const [job, chunk] = await Promise.all([
    tx.objectStore("jobs").get(jobId),
    tx.objectStore("chunks").get([jobId, index]),
  ]);
  await tx.done;
  if (
    !job ||
    !chunk ||
    !sameInput(chunk, job) ||
    chunk.sampleRate !== job.sampleRate ||
    !validPCM(chunk.samples, chunk.sampleRate) ||
    chunk.sha256 !== (await sha256(new Float32Array(chunk.samples).buffer))
  )
    return undefined;
  return { samples: chunk.samples, sampleRate: chunk.sampleRate };
}

export async function deleteJob(id: string): Promise<void> {
  const db = await database();
  const tx = db.transaction(["jobs", "chunks"], "readwrite");
  void tx.done.catch(() => {});
  const job = await tx.objectStore("jobs").get(id);
  if (job && ["queued", "running", "cancelling"].includes(job.status)) {
    await tx.done;
    throw new Error("실행 중인 작업은 먼저 일시정지하거나 취소하세요.");
  }
  await tx.objectStore("jobs").delete(id);
  const keys = await tx.objectStore("chunks").index("by-job").getAllKeys(id);
  for (const key of keys) await tx.objectStore("chunks").delete(key);
  await tx.done;
}

export async function saveOutput(
  id: string,
  blob: Blob,
  result: Job["result"],
  runToken: string,
): Promise<boolean> {
  if (!blob.size) throw new Error("완성된 오디오가 비어 있습니다.");
  const db = await database();
  const tx = db.transaction(["jobs", "chunks"], "readwrite");
  void tx.done.catch(() => {});
  const jobs = tx.objectStore("jobs");
  const job = await jobs.get(id);
  if (!matches(job, { statuses: ["running"], runToken })) {
    await tx.done;
    return false;
  }
  // Do not clone every PCM buffer into memory just to verify completeness.
  const keys = await tx.objectStore("chunks").index("by-job").getAllKeys(id);
  const indexes = plannedIndexes(job);
  const existing = new Set(keys.map((key) => key[1]));
  if (indexes.some((index) => !existing.has(index))) {
    throw new Error(
      "완료되지 않은 음성 구간이 있어 최종 파일을 저장할 수 없습니다.",
    );
  }
  await jobs.put(
    changed(job, {
      output: blob,
      result,
      status: "completed",
      progress: 1,
      completedChunks: indexes.length,
      error: null,
      message: "완료했습니다.",
    }),
  );
  await tx.done;
  return true;
}

export function assetSpec(name: string) {
  const spec = manifest.assets.find((item) => item.name === name);
  if (!spec) throw new Error(`등록되지 않은 모델 파일입니다: ${name}`);
  return spec;
}

function assetKey(name: string) {
  assetSpec(name);
  return `${manifest.id}/${manifest.revision}/${name}`;
}

function verifiedAsset(asset: Asset | undefined, name: string): asset is Asset {
  const spec = assetSpec(name);
  return (
    !!asset &&
    asset.verified === true &&
    asset.sha256 === spec.sha256 &&
    asset.size === spec.size &&
    asset.blob.size === spec.size
  );
}

export async function hasAsset(name: string): Promise<boolean> {
  return verifiedAsset(
    await (await database()).get("assets", assetKey(name)),
    name,
  );
}

export async function readAsset(name: string): Promise<ArrayBuffer> {
  const asset = await (await database()).get("assets", assetKey(name));
  if (!verifiedAsset(asset, name))
    throw new Error(`모델 파일을 먼저 다운로드하세요: ${name}`);
  const buffer = await asset.blob.arrayBuffer();
  if ((await sha256(buffer)) !== assetSpec(name).sha256) {
    await (await database()).delete("assets", assetKey(name));
    throw new Error(`모델 파일이 손상되었습니다. 다시 다운로드하세요: ${name}`);
  }
  return buffer;
}

export async function modelInstalled(): Promise<boolean> {
  const db = await database();
  const tx = db.transaction("assets");
  const assets = await Promise.all(
    manifest.assets.map((item) => tx.store.get(assetKey(item.name))),
  );
  await tx.done;
  return assets.every((item, index) =>
    verifiedAsset(item, manifest.assets[index].name),
  );
}

const MODEL_IN_USE =
  "이 모델의 다운로드 또는 변환 작업을 먼저 일시정지하거나 취소하세요.";
const modelRange = () =>
  IDBKeyRange.bound(`${manifest.id}/`, `${manifest.id}/\uffff`);
const usesModel = (job: StoredJob) =>
  job.model_id === manifest.id &&
  ["queued", "running", "cancelling"].includes(job.status);

/** Count stored Blob bytes, including interrupted downloads and older revisions. */
export async function modelStorageInfo(origin: string): Promise<{
  installed: boolean;
  storage: NonNullable<Model["storage"]>;
}> {
  const db = await database();
  const tx = db.transaction(["jobs", "assets", "assetParts"]);
  void tx.done.catch(() => {});
  const assets = tx.objectStore("assets");
  let used_bytes = 0;
  let has_data = false;
  let cursor = await assets.openCursor(modelRange());
  while (cursor) {
    used_bytes += cursor.value.blob.size;
    has_data = true;
    cursor = await cursor.continue();
  }
  let part = await tx
    .objectStore("assetParts")
    .index("by-asset")
    .openCursor(modelRange());
  while (part) {
    used_bytes += part.value.blob.size;
    has_data = true;
    part = await part.continue();
  }
  const current = await Promise.all(
    manifest.assets.map((item) => assets.get(assetKey(item.name))),
  );
  const busy = (await tx.objectStore("jobs").getAll()).some(usesModel);
  await tx.done;
  return {
    installed: current.every((item, index) =>
      verifiedAsset(item, manifest.assets[index].name),
    ),
    storage: {
      kind: "indexeddb",
      location: `${origin} → IndexedDB → ${DATABASE_NAME} → assets / assetParts → ${manifest.id}`,
      used_bytes,
      has_data,
      can_delete: has_data && !busy,
      ...(busy ? { delete_blocked_reason: MODEL_IN_USE } : {}),
    },
  };
}

/** Caller also holds the submission and runner locks, fencing late worker writes. */
export async function deleteModelAssets(): Promise<number> {
  const db = await database();
  // Sharing the jobs scope makes the active check and deletion one transaction.
  const tx = db.transaction(["jobs", "assets", "assetParts"], "readwrite");
  void tx.done.catch(() => {});
  try {
    if ((await tx.objectStore("jobs").getAll()).some(usesModel))
      throw new Error(MODEL_IN_USE);
    let freed = 0;
    let asset = await tx.objectStore("assets").openCursor(modelRange());
    while (asset) {
      freed += asset.value.blob.size;
      await asset.delete();
      asset = await asset.continue();
    }
    let part = await tx
      .objectStore("assetParts")
      .index("by-asset")
      .openCursor(modelRange());
    while (part) {
      freed += part.value.blob.size;
      await part.delete();
      part = await part.continue();
    }
    await tx.done;
    return freed;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* A failed transaction may already be aborted. */
    }
    await tx.done.catch(() => {});
    throw error;
  }
}

export async function readAssetParts(name: string): Promise<AssetPart[]> {
  return (await database()).getAllFromIndex(
    "assetParts",
    "by-asset",
    assetKey(name),
  );
}

export async function clearAssetParts(name: string): Promise<void> {
  const db = await database();
  const tx = db.transaction("assetParts", "readwrite");
  void tx.done.catch(() => {});
  const keys = await tx.store.index("by-asset").getAllKeys(assetKey(name));
  for (const key of keys) await tx.store.delete(key);
  await tx.done;
}

export async function saveAssetPart(
  name: string,
  offset: number,
  blob: Blob,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !blob.size ||
    offset + blob.size > assetSpec(name).size
  )
    throw new Error("모델 다운로드 구간이 올바르지 않습니다.");
  const db = await database();
  signal?.throwIfAborted();
  const tx = db.transaction("assetParts", "readwrite");
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Transaction already ended. */
    }
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await Promise.all([
      tx.store.put({ key: assetKey(name), offset, blob }),
      tx.done,
    ]);
  } finally {
    signal?.removeEventListener("abort", abort);
  }
  signal?.throwIfAborted();
}

export async function commitAsset(
  name: string,
  blob: Blob,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const spec = assetSpec(name);
  if (
    blob.size !== spec.size ||
    (await sha256(await blob.arrayBuffer())) !== spec.sha256
  ) {
    await clearAssetParts(name);
    throw new Error(
      `모델 파일 검증에 실패했습니다. 다시 다운로드하세요: ${name}`,
    );
  }
  signal?.throwIfAborted();
  const db = await database();
  signal?.throwIfAborted();
  const tx = db.transaction(["assets", "assetParts"], "readwrite");
  void tx.done.catch(() => {});
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Transaction already ended. */
    }
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const key = assetKey(name);
    await tx.objectStore("assets").put({
      key,
      size: spec.size,
      sha256: spec.sha256,
      verified: true,
      blob,
    });
    const keys = await tx
      .objectStore("assetParts")
      .index("by-asset")
      .getAllKeys(key);
    for (const part of keys) await tx.objectStore("assetParts").delete(part);
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* A failed transaction may already be aborted. */
    }
    await tx.done.catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
  signal?.throwIfAborted();
}

export async function storageInfo(): Promise<{
  usage: number;
  quota: number;
  persistent: boolean;
}> {
  const storage =
    typeof navigator === "undefined" ? undefined : navigator.storage;
  const estimate = await storage?.estimate?.();
  const persistent = (await storage?.persisted?.()) || false;
  return {
    usage: estimate?.usage || 0,
    quota: estimate?.quota || 0,
    persistent,
  };
}

export async function requestPersistence(): Promise<boolean> {
  return (
    typeof navigator !== "undefined" && !!(await navigator.storage?.persist?.())
  );
}
