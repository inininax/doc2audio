import "fake-indexeddb/auto";
import { deleteDB, openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadModel } from "./download";
import {
  DATABASE_NAME,
  closeStorage,
  commitAsset,
  createJob,
  deleteJob,
  deleteModelAssets,
  getJob,
  listJobs,
  modelInstalled,
  modelStorageInfo,
  readAsset,
  readAssetParts,
  readChunk,
  saveAssetPart,
  saveChunk,
  saveOutput,
  sha256,
  updateJob,
  type StoredJob,
} from "./storage";

const { fixture } = vi.hoisted(() => ({
  fixture: {
    id: "fixture-model",
    revision: "pinned-revision",
    repo_id: "test/model",
    size_bytes: 4,
    assets: [{ name: "fixture.onnx", size: 4, sha256: "" }],
  },
}));
vi.mock("./model-manifest.json", () => ({ default: fixture }));

const assetBytes = new Uint8Array([1, 2, 3, 4]);
function job(id = "job-1"): StoredJob {
  return {
    id,
    kind: "conversion",
    model_id: "fixture-model",
    title: "테스트 문서",
    status: "running",
    created_at: "2026-09-13T00:00:00Z",
    updated_at: "2026-09-13T00:00:00Z",
    progress: 0,
    message: "대기열에 등록했습니다.",
    error: null,
    audio_url: null,
    attempt: 1,
    options: { voice: { speaker: "F1" } },
    result: null,
    source: new Blob(["문서 원본"]),
    filename: "source.txt",
    texts: ["첫 문장", "끝 문장"],
    pipelineVersion: 1,
    modelRevision: "pinned-revision",
    fingerprint: "input-v1",
    runToken: "run-a",
    completedChunks: 0,
  };
}
const pcm = () => new Float32Array([0.1, -0.2, 0.3, -0.1]);

beforeEach(async () => {
  await closeStorage();
  await deleteDB(DATABASE_NAME);
  fixture.assets[0].sha256 = await sha256(assetBytes.buffer);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await closeStorage();
  await deleteDB(DATABASE_NAME);
});

describe("persistent job checkpoints", () => {
  it("restores input, options and committed PCM after opening a new connection", async () => {
    await createJob(job());
    expect(await saveChunk("job-1", 0, pcm(), 24000, "run-a")).toBe(true);
    await closeStorage();
    expect((await listJobs())[0].completedChunks).toBe(1);
    expect(await (await getJob("job-1"))!.source!.text()).toBe("문서 원본");
    expect((await readChunk("job-1", 0))!.samples).toEqual(pcm());
    expect(await readChunk("job-1", 1)).toBeUndefined();
  });

  it("rejects late chunk and final output after pause or a new execution token", async () => {
    await createJob(job());
    await updateJob(
      "job-1",
      { status: "paused" },
      { statuses: ["running"], runToken: "run-a" },
    );
    expect(await saveChunk("job-1", 0, pcm(), 24000, "run-a")).toBe(false);
    await updateJob("job-1", { status: "running", runToken: "run-b" });
    expect(await saveChunk("job-1", 0, pcm(), 24000, "run-a")).toBe(false);
    expect(await saveOutput("job-1", new Blob(["mp3"]), {}, "run-a")).toBe(
      false,
    );
    expect((await getJob("job-1"))!.completedChunks).toBe(0);
    expect(await readChunk("job-1", 0)).toBeUndefined();
  });

  it("rolls back the chunk when updating its progress fails", async () => {
    await createJob(job());
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === "jobs")
        throw new DOMException("Simulated quota failure", "QuotaExceededError");
      return original.call(this, value, key);
    });
    await expect(saveChunk("job-1", 0, pcm(), 24000, "run-a")).rejects.toThrow(
      "quota",
    );
    expect(await readChunk("job-1", 0)).toBeUndefined();
    expect((await getJob("job-1"))!.completedChunks).toBe(0);
  });

  it("never duplicates a chunk count and completes only after all indexes exist", async () => {
    await createJob(job());
    await saveChunk("job-1", 0, pcm(), 24000, "run-a");
    await saveChunk("job-1", 0, pcm(), 24000, "run-a");
    expect((await getJob("job-1"))!.completedChunks).toBe(1);
    await expect(
      saveOutput("job-1", new Blob(["mp3"]), {}, "run-a"),
    ).rejects.toThrow("완료되지");
    await saveChunk("job-1", 1, pcm(), 24000, "run-a");
    expect(
      await saveOutput(
        "job-1",
        new Blob(["mp3"], { type: "audio/mpeg" }),
        { chunks: 2 },
        "run-a",
      ),
    ).toBe(true);
    await closeStorage();
    const complete = (await getJob("job-1"))!;
    expect(complete.status).toBe("completed");
    expect(await complete.output!.text()).toBe("mp3");
  });

  it("detects PCM corruption and refuses chunks from changed inputs", async () => {
    await createJob(job());
    await saveChunk("job-1", 0, pcm(), 24000, "run-a");
    const db = await openDB(DATABASE_NAME);
    const record = await db.get("chunks", ["job-1", 0]);
    record.samples[0] = 0.9;
    await db.put("chunks", record);
    db.close();
    expect(await readChunk("job-1", 0)).toBeUndefined();
    await saveChunk("job-1", 0, pcm(), 24000, "run-a");
    await updateJob("job-1", { fingerprint: "changed-input" });
    expect(await readChunk("job-1", 0)).toBeUndefined();
    await expect(
      saveChunk("job-1", 1, new Float32Array([NaN]), 24000, "run-a"),
    ).rejects.toThrow("올바르지");
  });

  it("deletes only the selected job and limits events to the latest 200", async () => {
    await createJob(job("remove"));
    await createJob(job("keep"));
    await saveChunk("remove", 0, pcm(), 24000, "run-a");
    await saveChunk("keep", 0, pcm(), 24000, "run-a");
    await commitAsset("fixture.onnx", new Blob([assetBytes]));
    for (let index = 0; index < 205; index++)
      await updateJob("keep", { message: `진행 ${index}` });
    await updateJob("remove", { status: "cancelled" });
    await deleteJob("remove");
    expect(await getJob("remove")).toBeUndefined();
    expect(await readChunk("remove", 0)).toBeUndefined();
    expect(await readChunk("keep", 0)).toBeDefined();
    expect((await getJob("keep"))!.events).toHaveLength(200);
    expect((await getJob("keep"))!.events!.at(-1)!.message).toBe("진행 204");
    expect(await modelInstalled()).toBe(true);
  });

  it.each(["queued", "running", "cancelling"])(
    "checks %s status again inside the deletion transaction",
    async (status) => {
      await createJob(job());
      await saveChunk("job-1", 0, pcm(), 24000, "run-a");
      // A UI can observe paused, then another tab can resume before delete runs.
      await updateJob("job-1", { status: "paused" });
      expect((await getJob("job-1"))!.status).toBe("paused");
      await updateJob("job-1", { status });
      await expect(deleteJob("job-1")).rejects.toThrow("먼저 일시정지");
      expect((await getJob("job-1"))!.status).toBe(status);
      expect(await readChunk("job-1", 0)).toBeDefined();
    },
  );

  it("keeps original legacy chunk indexes and completes only the selected spoken plan", async () => {
    const initial = job();
    initial.texts = ["첫 문장", "###", "끝 문장"];
    await createJob(initial);
    await saveChunk(initial.id, 0, pcm(), 24000, "run-a");
    await saveChunk(initial.id, 1, pcm(), 24000, "run-a");
    await updateJob(initial.id, { spokenIndexes: [0, 2] });
    await expect(
      saveOutput(initial.id, new Blob(["mp3"]), {}, "run-a"),
    ).rejects.toThrow("완료되지");
    await saveChunk(initial.id, 2, pcm(), 24000, "run-a");
    expect((await getJob(initial.id))?.completedChunks).toBe(2);
    expect((await getJob(initial.id))?.progress).toBe(0.95);
    expect(await readChunk(initial.id, 0)).toBeDefined();
    expect(await readChunk(initial.id, 2)).toBeDefined();
    await expect(
      saveChunk(initial.id, 1, pcm(), 24000, "run-a"),
    ).rejects.toThrow("본문");
    expect(
      await saveOutput(initial.id, new Blob(["mp3"]), { chunks: 2 }, "run-a"),
    ).toBe(true);
    expect((await getJob(initial.id))?.completedChunks).toBe(2);
  });

  it.each([[2, 0], [0, 0], [0, 3], []])(
    "rejects a corrupt spoken index plan %j",
    async (...indexes) => {
      const initial = job();
      initial.spokenIndexes = indexes;
      await createJob(initial);
      await expect(
        saveChunk(initial.id, 0, pcm(), 24000, "run-a"),
      ).rejects.toThrow("계획");
      expect(await readChunk(initial.id, 0)).toBeUndefined();
    },
  );
});

describe("verified model assets", () => {
  it("reports and deletes only this model's blobs across revisions, preserving documents and audio", async () => {
    await createJob(job());
    await saveChunk("job-1", 0, pcm(), 24000, "run-a");
    await saveChunk("job-1", 1, pcm(), 24000, "run-a");
    await saveOutput("job-1", new Blob(["finished MP3"]), {}, "run-a");
    await commitAsset("fixture.onnx", new Blob([assetBytes]));
    await saveAssetPart(
      "fixture.onnx",
      0,
      new Blob([assetBytes.subarray(0, 2)]),
    );
    const db = await openDB(DATABASE_NAME);
    const original = await db.get(
      "assets",
      `${fixture.id}/${fixture.revision}/fixture.onnx`,
    );
    const oldKey = `${fixture.id}/old-revision/legacy.onnx`;
    const otherKey = `${fixture.id}-other/revision/other.onnx`;
    await db.put("assets", {
      ...original,
      key: oldKey,
      size: 999,
      blob: new Blob(["old"]),
    });
    await db.put("assets", {
      ...original,
      key: otherKey,
      blob: new Blob(["other"]),
    });
    await db.put("assetParts", {
      key: oldKey,
      offset: 0,
      blob: new Blob(["old part"]),
    });
    await db.put("assetParts", {
      key: otherKey,
      offset: 0,
      blob: new Blob(["keep part"]),
    });
    const before = await modelStorageInfo("https://doc2audio.test");
    expect(before).toMatchObject({
      installed: true,
      storage: {
        kind: "indexeddb",
        used_bytes: 17,
        has_data: true,
        can_delete: true,
      },
    });
    expect(before.storage.location).toContain(
      "https://doc2audio.test → IndexedDB → doc2audio-browser → assets / assetParts",
    );
    expect(await deleteModelAssets()).toBe(17);
    expect(await modelStorageInfo("https://doc2audio.test")).toMatchObject({
      installed: false,
      storage: { used_bytes: 0, has_data: false, can_delete: false },
    });
    expect(await db.getAllKeys("assets")).toEqual([otherKey]);
    expect(await db.getAllKeys("assetParts")).toEqual([[otherKey, 0]]);
    db.close();
    await closeStorage();
    const retained = (await getJob("job-1"))!;
    expect(await retained.source!.text()).toBe("문서 원본");
    expect(await retained.output!.text()).toBe("finished MP3");
    expect((await readChunk("job-1", 0))!.samples).toEqual(pcm());
    expect(await deleteModelAssets()).toBe(0);
    const fetchFixture = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(assetBytes, {
        status: 206,
        headers: { "Content-Range": "bytes 0-3/4", "Content-Length": "4" },
      }),
    );
    await downloadModel(new AbortController().signal, async () => {});
    expect(fetchFixture).toHaveBeenCalledTimes(1);
    expect(await modelInstalled()).toBe(true);
    expect(new Uint8Array(await readAsset("fixture.onnx"))).toEqual(assetBytes);
  });

  it("can free an interrupted download that has no installed model", async () => {
    await saveAssetPart(
      "fixture.onnx",
      0,
      new Blob([assetBytes.subarray(0, 2)]),
    );
    expect(await modelStorageInfo("https://doc2audio.test")).toMatchObject({
      installed: false,
      storage: { used_bytes: 2, has_data: true, can_delete: true },
    });
    expect(await deleteModelAssets()).toBe(2);
    expect(await readAssetParts("fixture.onnx")).toEqual([]);
  });

  it.each(["queued", "running", "cancelling"])(
    "protects assets from a %s job outside the first history page, including another connection's resume",
    async (status) => {
      await commitAsset("fixture.onnx", new Blob([assetBytes]));
      await saveAssetPart("fixture.onnx", 0, new Blob([assetBytes]));
      for (let index = 0; index < 55; index++)
        await createJob({ ...job(`history-${index}`), status: "completed" });
      await createJob({
        ...job("older-off-page"),
        status: "paused",
        created_at: "2020-01-01T00:00:00Z",
      });
      const otherTab = await openDB(DATABASE_NAME);
      const resumed = await otherTab.get("jobs", "older-off-page");
      await otherTab.put("jobs", { ...resumed, status });
      otherTab.close();
      const info = await modelStorageInfo("https://doc2audio.test");
      expect(info.storage.can_delete).toBe(false);
      expect(info.storage.delete_blocked_reason).toContain("일시정지");
      await expect(deleteModelAssets()).rejects.toThrow("일시정지");
      expect(await modelInstalled()).toBe(true);
      expect(await readAssetParts("fixture.onnx")).toHaveLength(1);
      expect(await listJobs()).toHaveLength(56);
    },
  );

  it("rolls back complete-asset removal if deleting a partial blob fails", async () => {
    await commitAsset("fixture.onnx", new Blob([assetBytes]));
    await saveAssetPart("fixture.onnx", 0, new Blob([assetBytes]));
    const original = IDBCursor.prototype.delete;
    let deletions = 0;
    vi.spyOn(IDBCursor.prototype, "delete").mockImplementation(function (
      this: IDBCursor,
    ) {
      if (++deletions === 2)
        throw new DOMException("Simulated delete failure", "UnknownError");
      return original.call(this);
    });
    await expect(deleteModelAssets()).rejects.toThrow("delete failure");
    expect(await modelInstalled()).toBe(true);
    expect(await readAssetParts("fixture.onnx")).toHaveLength(1);
  });

  it("retains download checkpoints when final publication cannot commit", async () => {
    await saveAssetPart("fixture.onnx", 0, new Blob([assetBytes]));
    const original = IDBObjectStore.prototype.delete;
    vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
      this: IDBObjectStore,
      key: IDBValidKey | IDBKeyRange,
    ) {
      if (this.name === "assetParts")
        throw new DOMException("Simulated storage failure", "UnknownError");
      return original.call(this, key);
    });
    await expect(
      commitAsset("fixture.onnx", new Blob([assetBytes])),
    ).rejects.toThrow("storage failure");
    expect(await modelInstalled()).toBe(false);
    expect(await readAssetParts("fixture.onnx")).toHaveLength(1);
  });

  it("detects a stored model blob corrupted without changing its length", async () => {
    await commitAsset("fixture.onnx", new Blob([assetBytes]));
    const db = await openDB(DATABASE_NAME);
    const [record] = await db.getAll("assets");
    record.blob = new Blob([new Uint8Array(4)]);
    await db.put("assets", record);
    db.close();
    await expect(readAsset("fixture.onnx")).rejects.toThrow("손상");
    expect(await modelInstalled()).toBe(false);
  });

  it("keeps partial files uninstalled and publishes verified files with cleanup", async () => {
    await saveAssetPart(
      "fixture.onnx",
      0,
      new Blob([assetBytes.subarray(0, 2)]),
    );
    expect(await modelInstalled()).toBe(false);
    await closeStorage();
    expect(await readAssetParts("fixture.onnx")).toHaveLength(1);
    await commitAsset("fixture.onnx", new Blob([assetBytes]));
    expect(await modelInstalled()).toBe(true);
    expect(await readAssetParts("fixture.onnx")).toHaveLength(0);
    expect(new Uint8Array(await readAsset("fixture.onnx"))).toEqual(assetBytes);
  });

  it("rejects a hash mismatch and abort without marking the model installed", async () => {
    await saveAssetPart("fixture.onnx", 0, new Blob([assetBytes]));
    await expect(
      commitAsset("fixture.onnx", new Blob([new Uint8Array(4)])),
    ).rejects.toThrow("검증");
    expect(await modelInstalled()).toBe(false);
    expect(await readAssetParts("fixture.onnx")).toHaveLength(0);
    const controller = new AbortController();
    controller.abort();
    await expect(
      commitAsset("fixture.onnx", new Blob([assetBytes]), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await modelInstalled()).toBe(false);
  });
});
