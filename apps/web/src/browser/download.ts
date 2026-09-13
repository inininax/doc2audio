import manifest from "./model-manifest.json";
import {
  assetSpec,
  clearAssetParts,
  commitAsset,
  hasAsset,
  readAssetParts,
  saveAssetPart,
} from "./storage";

export const DOWNLOAD_SEGMENT_BYTES = 4 * 1024 * 1024;
type Progress = (message: string, fraction: number) => Promise<void>;

async function checkpointBody(
  response: Response,
  name: string,
  offset: number,
  expectedBytes: number,
  signal: AbortSignal,
  checkpoint: (bytes: number) => Promise<void>,
) {
  if (!response.body) throw new Error("모델 다운로드 응답이 비어 있습니다.");
  const reader = response.body.getReader();
  let buffer = new Uint8Array(DOWNLOAD_SEGMENT_BYTES);
  let buffered = 0;
  let received = 0;
  let saved = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      received += value.byteLength;
      if (received > expectedBytes)
        throw new Error("모델 다운로드 응답 길이가 예상 범위를 넘었습니다.");
      let cursor = 0;
      while (cursor < value.byteLength) {
        const count = Math.min(
          buffer.length - buffered,
          value.byteLength - cursor,
        );
        buffer.set(value.subarray(cursor, cursor + count), buffered);
        buffered += count;
        cursor += count;
        if (buffered === buffer.length) {
          await saveAssetPart(name, offset + saved, new Blob([buffer]), signal);
          saved += buffered;
          await checkpoint(saved);
          buffer = new Uint8Array(DOWNLOAD_SEGMENT_BYTES);
          buffered = 0;
        }
      }
    }
    if (received !== expectedBytes)
      throw new Error("모델 다운로드가 끝나기 전에 연결이 중단되었습니다.");
    if (buffered) {
      await saveAssetPart(
        name,
        offset + saved,
        new Blob([buffer.subarray(0, buffered)]),
        signal,
      );
      saved += buffered;
      await checkpoint(saved);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function partialSize(name: string) {
  let size = 0;
  for (const part of await readAssetParts(name)) {
    if (
      part.offset !== size ||
      !part.blob.size ||
      part.blob.size > DOWNLOAD_SEGMENT_BYTES ||
      size + part.blob.size > assetSpec(name).size
    ) {
      await clearAssetParts(name);
      return 0;
    }
    size += part.blob.size;
  }
  return size;
}

/** Only immutable, catalog-pinned Hugging Face model URLs are requested. */
export async function downloadModel(
  signal: AbortSignal,
  progress: Progress,
): Promise<void> {
  let completed = 0;
  for (const asset of manifest.assets) {
    signal.throwIfAborted();
    if (await hasAsset(asset.name)) {
      completed += asset.size;
      await progress(
        `확인 완료: ${asset.name}`,
        completed / manifest.size_bytes,
      );
      continue;
    }
    let offset = await partialSize(asset.name);
    const report = (bytes: number) =>
      progress(
        `다운로드 중: ${asset.name}`,
        Math.min(0.99, (completed + bytes) / manifest.size_bytes),
      );
    await report(offset);
    while (offset < asset.size) {
      signal.throwIfAborted();
      const end = Math.min(asset.size - 1, offset + DOWNLOAD_SEGMENT_BYTES - 1);
      const path = asset.name.split("/").map(encodeURIComponent).join("/");
      const url = `https://huggingface.co/${manifest.repo_id}/resolve/${manifest.revision}/${path}`;
      const response = await fetch(url, {
        signal,
        headers: { Range: `bytes=${offset}-${end}` },
        credentials: "omit",
        cache: "no-store",
      });
      signal.throwIfAborted();
      let expectedBytes: number;
      if (response.status === 206) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
          response.headers.get("Content-Range") || "",
        );
        if (
          !range ||
          Number(range[1]) !== offset ||
          Number(range[2]) < offset ||
          Number(range[2]) > end ||
          Number(range[3]) !== asset.size
        ) {
          await response.body?.cancel();
          throw new Error(
            `모델 다운로드 응답 범위가 올바르지 않습니다: ${asset.name}`,
          );
        }
        expectedBytes = Number(range[2]) - offset + 1;
      } else if (response.status === 200) {
        // Servers/CDNs may ignore Range. A full response always starts at zero.
        await clearAssetParts(asset.name);
        offset = 0;
        expectedBytes = asset.size;
      } else {
        await response.body?.cancel();
        throw new Error(
          `모델 다운로드 실패 (${response.status}): ${asset.name}`,
        );
      }
      const declaredLength = response.headers.get("Content-Length");
      if (declaredLength !== null && Number(declaredLength) !== expectedBytes) {
        await response.body?.cancel();
        throw new Error(
          `모델 다운로드 응답 크기가 올바르지 않습니다: ${asset.name}`,
        );
      }
      const start = offset;
      await checkpointBody(
        response,
        asset.name,
        start,
        expectedBytes,
        signal,
        (bytes) => report(start + bytes),
      );
      offset += expectedBytes;
    }
    signal.throwIfAborted();
    const parts = await readAssetParts(asset.name);
    await progress(
      `파일 검증 중: ${asset.name}`,
      Math.min(0.99, (completed + asset.size) / manifest.size_bytes),
    );
    await commitAsset(
      asset.name,
      new Blob(parts.map((part) => part.blob)),
      signal,
    );
    completed += asset.size;
    await progress(
      `다운로드 완료: ${asset.name}`,
      completed / manifest.size_bytes,
    );
  }
}
