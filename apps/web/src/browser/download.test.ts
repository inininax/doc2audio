import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DOWNLOAD_SEGMENT_BYTES, downloadModel } from "./download";
import {
  DATABASE_NAME,
  closeStorage,
  modelInstalled,
  readAsset,
  readAssetParts,
  saveAssetPart,
  sha256,
} from "./storage";

const { fixture } = vi.hoisted(() => ({
  fixture: {
    id: "fixture-model",
    revision: "pinned-revision",
    repo_id: "test/model",
    size_bytes: 0,
    assets: [{ name: "fixture.onnx", size: 0, sha256: "" }],
  },
}));
vi.mock("./model-manifest.json", () => ({ default: fixture }));

let bytes: Uint8Array<ArrayBuffer>;
beforeEach(async () => {
  await closeStorage();
  await deleteDB(DATABASE_NAME);
  bytes = new Uint8Array(DOWNLOAD_SEGMENT_BYTES + 19);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  fixture.size_bytes = bytes.length;
  fixture.assets[0] = {
    name: "fixture.onnx",
    size: bytes.length,
    sha256: await sha256(bytes.buffer),
  };
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await closeStorage();
  await deleteDB(DATABASE_NAME);
});

const progress = async () => {};
function response(start: number, end: number) {
  return new Response(bytes.slice(start, end + 1), {
    status: 206,
    headers: { "Content-Range": `bytes ${start}-${end}/${bytes.length}` },
  });
}

it("resumes from the committed segment and never downloads an installed model again", async () => {
  await saveAssetPart(
    "fixture.onnx",
    0,
    new Blob([bytes.subarray(0, DOWNLOAD_SEGMENT_BYTES)]),
  );
  await closeStorage();
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    expect(init.headers).toEqual({
      Range: `bytes=${DOWNLOAD_SEGMENT_BYTES}-${bytes.length - 1}`,
    });
    return response(DOWNLOAD_SEGMENT_BYTES, bytes.length - 1);
  });
  vi.stubGlobal("fetch", fetcher);
  await downloadModel(new AbortController().signal, progress);
  expect(await modelInstalled()).toBe(true);
  const downloaded = new Uint8Array(await readAsset("fixture.onnx"));
  expect(downloaded.length).toBe(bytes.length);
  expect(downloaded.every((value, index) => value === bytes[index])).toBe(true);
  await downloadModel(new AbortController().signal, progress);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("retains committed bytes on cancellation and resumes rather than restarting", async () => {
  const controller = new AbortController();
  const fetcher = vi.fn(async () => response(0, DOWNLOAD_SEGMENT_BYTES - 1));
  vi.stubGlobal("fetch", fetcher);
  await expect(
    downloadModel(controller.signal, async (_message, fraction) => {
      if (fraction > 0) controller.abort();
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await readAssetParts("fixture.onnx"))[0].blob.size).toBe(
    DOWNLOAD_SEGMENT_BYTES,
  );
  expect(await modelInstalled()).toBe(false);
  fetcher.mockImplementation(async () =>
    response(DOWNLOAD_SEGMENT_BYTES, bytes.length - 1),
  );
  await downloadModel(new AbortController().signal, progress);
  expect(await modelInstalled()).toBe(true);
});

it("rejects an incorrect Content-Range without overwriting a valid checkpoint", async () => {
  await saveAssetPart(
    "fixture.onnx",
    0,
    new Blob([bytes.subarray(0, DOWNLOAD_SEGMENT_BYTES)]),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(0, 18)),
  );
  await expect(
    downloadModel(new AbortController().signal, progress),
  ).rejects.toThrow("응답 범위");
  expect(await modelInstalled()).toBe(false);
  expect((await readAssetParts("fixture.onnx"))[0].blob.size).toBe(
    DOWNLOAD_SEGMENT_BYTES,
  );
});

it("restarts correctly when the server ignores Range and returns the full file", async () => {
  await saveAssetPart(
    "fixture.onnx",
    0,
    new Blob([bytes.subarray(0, DOWNLOAD_SEGMENT_BYTES)]),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(bytes, { status: 200 })),
  );
  await downloadModel(new AbortController().signal, progress);
  expect(await modelInstalled()).toBe(true);
  const downloaded = new Uint8Array(await readAsset("fixture.onnx"));
  expect(downloaded.length).toBe(bytes.length);
  expect(downloaded.every((value, index) => value === bytes[index])).toBe(true);
});

it("does not checkpoint a truncated response or install bytes that fail the pinned hash", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(bytes.slice(0, 20), {
          status: 206,
          headers: {
            "Content-Range": `bytes 0-${DOWNLOAD_SEGMENT_BYTES - 1}/${bytes.length}`,
          },
        }),
    ),
  );
  await expect(
    downloadModel(new AbortController().signal, progress),
  ).rejects.toThrow("연결이 중단");
  expect(await readAssetParts("fixture.onnx")).toHaveLength(0);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(new Uint8Array(bytes.length), { status: 200 }),
    ),
  );
  await expect(
    downloadModel(new AbortController().signal, progress),
  ).rejects.toThrow("파일 검증");
  expect(await modelInstalled()).toBe(false);
  expect(await readAssetParts("fixture.onnx")).toHaveLength(0);
});
