import type { Job, Health } from "../api";
import {
  manifest,
  PIPELINE_VERSION,
  browserModel,
  validateOptions,
} from "./catalog";
import {
  createJob,
  getJob,
  listJobs,
  updateJob,
  saveChunk,
  readChunk,
  saveOutput,
  deleteJob,
  modelInstalled,
  storageInfo,
  requestPersistence,
  type StoredJob,
} from "./storage";
import { downloadModel } from "./download";
import { extractDocument, splitText } from "./documents";
import { encodeMp3 } from "./encode";
import { SpeechClient } from "./speech-client";
import { hasSpeechContent } from "./speech-text";

const ACTIVE = ["queued", "running"];
const urls = new Map<string, { blob: Blob; url: string; stamp: string }>();
const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("doc2audio-browser-events")
    : null;
let started = false;
let startPromise: Promise<void> | undefined;
let trying = false;
let pageHidden = false;
let activeController: AbortController | undefined;
const canRun = () => !pageHidden && document.visibilityState !== "hidden";
const now = () => new Date().toISOString();
const abortError = () =>
  new DOMException("작업이 중단되었습니다.", "AbortError");
function notify() {
  channel?.postMessage("changed");
  window.dispatchEvent(new Event("doc2audio-changed"));
}
export function checkBrowser() {
  if (!isSecureContext || !crypto.subtle || !navigator.locks || !indexedDB)
    throw new Error(
      "이 브라우저에서는 안전한 로컬 저장·이어하기를 사용할 수 없습니다. 최신 Chrome·Edge·Safari에서 HTTPS 주소로 접속하세요.",
    );
}
async function fingerprint(job: StoredJob) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      version: job.pipelineVersion,
      revision: job.modelRevision,
      texts: job.texts,
      options: job.options,
    }),
  );
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
async function recover() {
  for (const job of await listJobs()) {
    if (job.status === "running")
      await updateJob(
        job.id,
        {
          status: "queued",
          runToken: "",
          message: "다시 접속했습니다. 저장된 지점부터 자동으로 이어갑니다.",
        },
        { statuses: ["running"] },
      );
  }
}
async function execute(initial: StoredJob) {
  const token = crypto.randomUUID();
  const accepted = await updateJob(
    initial.id,
    {
      status: "running",
      runToken: token,
      attempt: initial.attempt + 1,
      error: null,
      message: initial.completedChunks
        ? `저장된 ${initial.completedChunks}개 구간을 확인하고 이어갑니다.`
        : "작업을 시작합니다.",
    },
    { statuses: ["queued"] },
  );
  if (!accepted) return;
  notify();
  // The page may have left while the status transaction was committing.
  // Leave that running record recoverable without creating new workers.
  if (!canRun()) return;
  const controller = new AbortController();
  activeController = controller;
  let client: SpeechClient | undefined;
  let backgroundFailure: Error | undefined;
  const stop = () => {
    controller.abort();
    client?.close();
  };
  controller.signal.addEventListener("abort", () => client?.close(), {
    once: true,
  });
  const failBackground = (error: unknown) => {
    // Keep genuine cancellation (pause, ownership change, pagehide) recoverable.
    // Internal I/O failures also stop workers, but must retain their cause.
    if (controller.signal.aborted) return;
    backgroundFailure =
      error instanceof Error ? error : new Error(String(error));
    stop();
  };
  const check = async () => {
    const current = await getJob(initial.id);
    if (!current || current.status !== "running" || current.runToken !== token)
      stop();
    controller.signal.throwIfAborted();
  };
  const watch = setInterval(() => {
    void check().catch(failBackground);
  }, 300);
  const progress = async (message: string, fraction?: number) => {
    controller.signal.throwIfAborted();
    if (
      !(await updateJob(
        initial.id,
        { message, ...(fraction === undefined ? {} : { progress: fraction }) },
        { statuses: ["running"], runToken: token },
      ))
    ) {
      stop();
      throw abortError();
    }
    notify();
  };
  try {
    if (
      initial.modelRevision !== manifest.revision ||
      initial.pipelineVersion !== PIPELINE_VERSION
    )
      throw new Error(
        "이 작업은 다른 모델 또는 앱 버전에서 만들어졌습니다. 원문을 새 작업으로 등록해 주세요.",
      );
    if (initial.kind === "download") {
      await downloadModel(controller.signal, progress);
      await check();
      await updateJob(
        initial.id,
        {
          status: "completed",
          progress: 1,
          message: "모델을 이 브라우저에 저장했습니다.",
        },
        { statuses: ["running"], runToken: token },
      );
      return;
    }
    let job = (await getJob(initial.id))!;
    if (!job.texts) {
      if (!job.source)
        throw new Error(
          "저장한 원문을 찾을 수 없습니다. 새 작업으로 등록해 주세요.",
        );
      await progress("문서를 이 브라우저에서 읽고 있습니다.");
      const extracted = await extractDocument(
        job.source,
        job.filename || "source.txt",
        {
          pages: job.options.pages,
          ocr: job.options.ocr,
          signal: controller.signal,
        },
        (message) => {
          void progress(message).catch(failBackground);
        },
      );
      await check();
      job = {
        ...job,
        texts: splitText(
          extracted.text,
          Number(job.options.voice!.chunk_chars),
        ).filter((text) =>
          hasSpeechContent(text, String(job.options.voice!.language)),
        ),
      };
      if (!job.texts!.length)
        throw new Error("문서에서 읽을 본문을 찾을 수 없습니다.");
      job.fingerprint = await fingerprint(job);
      if (
        !(await updateJob(
          job.id,
          {
            texts: job.texts,
            fingerprint: job.fingerprint,
            message: `본문을 ${job.texts!.length}개 구간으로 나누었습니다.${extracted.warnings.length ? " " + extracted.warnings.join(" ") : ""}`,
          },
          { statuses: ["running"], runToken: token },
        ))
      )
        throw abortError();
    }
    if (job.fingerprint !== (await fingerprint(job)))
      throw new Error(
        "저장된 본문 또는 설정이 변경되어 이어갈 수 없습니다. 원문을 새 작업으로 등록해 주세요.",
      );
    const texts = job.texts!;
    // Older saved plans may contain decorative paragraphs. Keep original indexes
    // and seeds so valid PCM checkpoints survive this normalization fix.
    const spokenIndexes = texts.flatMap((text, index) =>
      hasSpeechContent(text, String(job.options.voice!.language))
        ? [index]
        : [],
    );
    if (!spokenIndexes.length)
      throw new Error("문서에서 읽을 본문을 찾을 수 없습니다.");
    if (
      !(await updateJob(
        job.id,
        { spokenIndexes },
        {
          statuses: ["running"],
          runToken: token,
        },
      ))
    )
      throw abortError();
    let reused = 0,
      rate = 44100;
    for (const [position, index] of spokenIndexes.entries()) {
      await check();
      let chunk = await readChunk(job.id, index);
      if (chunk) {
        reused++;
      } else {
        if (!client) {
          if (!(await modelInstalled()))
            throw new Error(
              "모델 파일이 없습니다. 모델 보관함에서 다시 다운로드한 뒤 이 작업을 이어가세요.",
            );
          client = new SpeechClient();
        }
        await progress(
          `[${position + 1}/${spokenIndexes.length}] 음성을 생성하고 있습니다.`,
          (position / spokenIndexes.length) * 0.95,
        );
        chunk = await client.synthesize(
          texts[index],
          job.options.voice!,
          (Number(job.options.voice!.seed) + index) >>> 0,
        );
        await check();
        if (
          !(await saveChunk(
            job.id,
            index,
            chunk.samples,
            chunk.sampleRate,
            token,
          ))
        )
          throw abortError();
        notify();
      }
      if (position && rate !== chunk.sampleRate)
        throw new Error("저장된 음성의 샘플링 주파수가 서로 다릅니다.");
      rate = chunk.sampleRate;
    }
    client?.close();
    client = undefined;
    await check();
    await progress(
      `저장된 음성 ${spokenIndexes.length}개 구간을 MP3로 변환합니다. (기존 구간 ${reused}개 재사용)`,
      0.96,
    );
    async function* chunks() {
      for (const index of spokenIndexes) {
        await check();
        const chunk = await readChunk(job.id, index);
        if (!chunk)
          throw new Error(
            "저장된 구간을 읽을 수 없습니다. 다시 시도하면 해당 구간을 복구합니다.",
          );
        yield chunk.samples;
      }
    }
    const voice = job.options.voice!;
    let seconds = 0;
    const output = await encodeMp3(chunks(), rate, {
      speed: Number(voice.speed),
      pause: Number(voice.pause),
      signal: controller.signal,
      onDuration: (value) => {
        seconds = value;
      },
    });
    await check();
    if (!output.size) throw new Error("MP3 파일이 비어 있습니다.");
    const result = {
      seconds,
      chunks: spokenIndexes.length,
      reused_chunks: reused,
    };
    await saveOutput(job.id, output, result, token);
  } catch (error) {
    // Storage can raise AbortError independently of our cancellation controller.
    // Such failures must stay failed until explicitly retried, not be recovered
    // every second as apparently orphaned running work.
    if (backgroundFailure || !controller.signal.aborted) {
      error = backgroundFailure ?? error;
      let message = error instanceof Error ? error.message : String(error);
      if (error instanceof DOMException && error.name === "QuotaExceededError")
        message =
          "브라우저 저장 공간이 부족합니다. 저장한 구간은 유지됩니다. 불필요한 작업을 삭제하거나 디스크 공간을 확보한 뒤 다시 시도하세요.";
      await updateJob(
        initial.id,
        {
          status: "failed",
          error: message,
          message:
            "작업을 완료하지 못했습니다. 저장된 구간부터 다시 시도할 수 있습니다.",
        },
        { statuses: ["running"], runToken: token },
      );
    }
  } finally {
    clearInterval(watch);
    client?.close();
    activeController = undefined;
    notify();
  }
}
async function kick() {
  if (trying || !canRun()) return;
  trying = true;
  try {
    await navigator.locks.request(
      "doc2audio-browser-runner",
      { ifAvailable: true },
      async (lock) => {
        if (!lock || !canRun()) return;
        await recover();
        while (canRun()) {
          const next = (await listJobs())
            .filter((j) => j.status === "queued")
            .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
          if (!next || !canRun()) break;
          await execute(next);
        }
      },
    );
  } catch (error) {
    console.error("Browser queue:", error);
  } finally {
    trying = false;
  }
}
export async function initialize() {
  checkBrowser();
  if (started) return;
  if (startPromise) return startPromise;
  startPromise = boot().catch((error) => {
    startPromise = undefined;
    throw error;
  });
  return startPromise;
}
async function boot() {
  // Prove storage can open before advertising readiness.
  await listJobs();
  started = true;
  channel?.addEventListener("message", () => {
    void kick();
  });
  window.addEventListener("online", () => {
    void kick();
  });
  document.addEventListener("visibilitychange", () => {
    void kick();
  });
  window.addEventListener("pagehide", () => {
    pageHidden = true;
    activeController?.abort();
  });
  window.addEventListener("pageshow", () => {
    pageHidden = false;
    void kick();
  });
  setInterval(() => {
    void kick();
  }, 1000);
  void kick();
}
function releaseAudioUrl(id: string) {
  const entry = urls.get(id);
  if (entry) URL.revokeObjectURL(entry.url);
  urls.delete(id);
}

function toPublic(job: StoredJob): Job {
  let audio: string | null = null;
  if (job.status === "completed" && job.output) {
    let entry = urls.get(job.id);
    if (!entry || entry.stamp !== job.updated_at) {
      if (entry) URL.revokeObjectURL(entry.url);
      entry = {
        blob: job.output,
        url: URL.createObjectURL(job.output),
        stamp: job.updated_at,
      };
      urls.set(job.id, entry);
    }
    audio = entry.url;
  }
  const { source: _source, output: _output, texts: _texts, ...rest } = job;
  return { ...rest, audio_url: audio };
}
export async function browserRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  await initialize();
  const url = new URL(path, "https://browser.invalid");
  const parts = url.pathname.split("/").filter(Boolean);
  const post = init.method === "POST";
  let value: unknown;
  if (!post && parts[0] === "health") {
    value = {
      status: "ok",
      version: "0.3.0",
      ffmpeg: true,
      runtime: "browser",
      platform: "Browser",
      machine: "WebAssembly",
      catalog_reviewed_at: manifest.reviewed_at,
      storage: await storageInfo(),
    } satisfies Health;
  } else if (!post && parts[0] === "models") {
    value = {
      items: [browserModel(await modelInstalled())],
      reviewed_at: manifest.reviewed_at,
    };
  } else if (!post && parts[0] === "jobs") {
    if (parts[1]) {
      const job = await getJob(parts[1]);
      if (!job) {
        releaseAudioUrl(parts[1]);
        throw new Error("작업을 찾을 수 없습니다.");
      }
      value = toPublic(job);
    } else {
      const jobs = (await listJobs()).sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      );
      // Another tab may delete a job. Reconcile against the complete ledger,
      // before pagination, so off-page audio keeps its valid playback URL.
      const remaining = new Set(jobs.map((job) => job.id));
      for (const id of urls.keys()) {
        if (!remaining.has(id)) releaseAudioUrl(id);
      }
      const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
      const limit = Math.min(
        100,
        Math.max(1, Number(url.searchParams.get("limit") || 50)),
      );
      value = {
        items: jobs.slice(offset, offset + limit).map(toPublic),
        total: jobs.length,
      };
    }
  } else if (post && parts[0] === "storage" && parts[1] === "persist") {
    value = { persistent: await requestPersistence() };
  } else if (post && parts[0] === "models" && parts[2] === "download") {
    if (parts[1] !== manifest.id)
      throw new Error("이 브라우저에서 지원하지 않는 모델입니다.");
    await navigator.locks.request("doc2audio-job-submit", async () => {
      const existing = (await listJobs()).find(
        (j) => j.kind === "download" && ACTIVE.includes(j.status),
      );
      if (existing) {
        value = toPublic(existing);
        return;
      }
      const job = baseJob("download", `${manifest.name} 다운로드`);
      await createJob(job);
      value = toPublic(job);
    });
    notify();
    void kick();
  } else if (post && parts[0] === "jobs" && !parts[1]) {
    if (!(init.body instanceof FormData))
      throw new Error("작업 입력이 올바르지 않습니다.");
    const body = init.body;
    if (body.get("model_id") !== manifest.id)
      throw new Error("이 브라우저에서 지원하지 않는 모델입니다.");
    if (!(await modelInstalled()))
      throw new Error("모델 보관함에서 모델을 먼저 다운로드하세요.");
    const voice = validateOptions(
      JSON.parse(String(body.get("options") || "{}")),
    );
    const file = body.get("file");
    const text = String(body.get("text") || "");
    if (file instanceof Blob === !!text.trim())
      throw new Error("문서 파일 또는 텍스트 중 하나를 입력하세요.");
    if (text.length > 1000000)
      throw new Error("텍스트는 백만 글자 이하여야 합니다.");
    const source =
      file instanceof Blob ? file : new Blob([text], { type: "text/plain" });
    if (!source.size || source.size > 100 * 1024 * 1024)
      throw new Error("문서는 0바이트보다 크고 100 MB 이하여야 합니다.");
    const filename =
      file instanceof File ? file.name : "직접 입력한 텍스트.txt";
    if (!/\.(pdf|docx?|txt)$/i.test(filename))
      throw new Error("PDF, DOCX, DOC, UTF-8 TXT 파일을 지원합니다.");
    const title = String(body.get("title") || "").trim() || filename;
    const pages = String(body.get("pages") || "");
    const ocr = String(body.get("ocr") || "auto");
    if (
      title.length > 200 ||
      pages.length > 200 ||
      !["auto", "always", "never"].includes(ocr)
    )
      throw new Error("제목 또는 문서 설정이 올바르지 않습니다.");
    const job = {
      ...baseJob("conversion", title),
      source,
      filename,
      options: { voice, pages, ocr },
    };
    await createJob(job);
    value = toPublic(job);
    notify();
    void kick();
  } else if (post && parts[0] === "jobs" && parts[1]) {
    const id = parts[1],
      command = parts[2];
    const job = await getJob(id);
    if (!job) {
      releaseAudioUrl(id);
      throw new Error("작업을 찾을 수 없습니다.");
    }
    if (command === "pause" || command === "cancel") {
      await updateJob(
        id,
        {
          status: command === "pause" ? "paused" : "cancelled",
          runToken: "",
          message:
            command === "pause"
              ? "일시정지했습니다. 완료한 구간은 보관됩니다."
              : "취소했습니다. 저장된 구간은 다시 시도할 때 재사용됩니다.",
        },
        { statuses: ACTIVE },
      );
    } else if (command === "retry" || command === "resume") {
      if (
        !(await updateJob(
          id,
          {
            status: "queued",
            runToken: "",
            error: null,
            message: "저장된 지점부터 이어서 실행합니다.",
          },
          { statuses: ["paused", "failed", "cancelled", "interrupted"] },
        ))
      )
        throw new Error("일시정지 또는 중단된 작업만 이어갈 수 있습니다.");
    } else if (command === "delete") {
      if (ACTIVE.includes(job.status))
        throw new Error("작업을 먼저 일시정지하거나 취소하세요.");
      await deleteJob(id);
      releaseAudioUrl(id);
      value = { deleted: true };
    } else throw new Error("지원하지 않는 작업입니다.");
    if (command !== "delete") {
      const current = await getJob(id);
      if (!current) {
        releaseAudioUrl(id);
        throw new Error("작업을 찾을 수 없습니다.");
      }
      value = toPublic(current);
    }
    notify();
    void kick();
  } else throw new Error("지원하지 않는 브라우저 요청입니다.");
  return value as T;
}
function baseJob(kind: Job["kind"], title: string): StoredJob {
  return {
    id: crypto.randomUUID(),
    kind,
    model_id: manifest.id,
    title,
    status: "queued",
    created_at: now(),
    updated_at: now(),
    progress: 0,
    message: "대기 중입니다.",
    error: null,
    audio_url: null,
    attempt: 0,
    options: {},
    result: null,
    events: [],
    pipelineVersion: PIPELINE_VERSION,
    modelRevision: manifest.revision,
    completedChunks: 0,
  };
}
