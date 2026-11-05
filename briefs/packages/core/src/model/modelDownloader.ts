import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";
import { once } from "node:events";

export class ModelDownloadError extends Error {
  constructor(readonly code: "http_status" | "incomplete" | "checksum" | "no_body", readonly status?: number) {
    super(status === undefined ? code : `${code}(${status})`);
    this.name = "ModelDownloadError";
  }
}

export interface DownloadTarget {
  readonly url: string;
  readonly path: string;
  readonly bytes: number;
  /** Checked when given. Archives have no published hash: their unpacked files are checked instead. */
  readonly sha256?: string | undefined;
}

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal | undefined }) => Promise<{
  readonly status: number;
  readonly body: ReadableStream<Uint8Array> | null;
}>;

async function sizeOf(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).size;
  } catch {
    return undefined;
  }
}

/** SHA-256 of a file, streamed. */
export async function fileSha256(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** True when the file is there with the exact size and hash (size only when there is no hash). */
export async function isCompleteFile(target: Pick<DownloadTarget, "path" | "bytes" | "sha256">, signal?: AbortSignal): Promise<boolean> {
  if ((await sizeOf(target.path)) !== target.bytes) return false;
  return target.sha256 === undefined || (await fileSha256(target.path, signal)) === target.sha256;
}

/**
 * Downloads one file to `<path>.part`, resuming a partial download with a range request,
 * reports progress from 0 to 1, and moves it into place only when its size and SHA-256
 * (when given) match. A file already in place and complete is kept without any network call.
 */
export async function downloadFile(
  target: DownloadTarget,
  options: { readonly fetch?: FetchLike; readonly progress?: (fraction: number) => void; readonly signal?: AbortSignal } = {},
): Promise<void> {
  const report = options.progress ?? (() => {});
  if (await isCompleteFile(target, options.signal)) {
    report(1);
    return;
  }
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, { headers: init.headers, signal: init.signal ?? null }) as ReturnType<FetchLike>);
  const part = `${target.path}.part`;
  let have = (await sizeOf(part)) ?? 0;
  if (have > target.bytes) {
    await rm(part, { force: true });
    have = 0;
  }
  report(Math.min(have / target.bytes, 0.99));
  const headers: Record<string, string> = have > 0 ? { Range: `bytes=${have}-` } : {};
  const response = await doFetch(target.url, { headers, signal: options.signal });
  if (response.status !== 200 && response.status !== 206) throw new ModelDownloadError("http_status", response.status);
  if (response.body === null) throw new ModelDownloadError("no_body");
  // A server that ignores the range sends the whole file again.
  if (response.status === 200) have = 0;
  const hash = createHash("sha256");
  if (have > 0) for await (const chunk of createReadStream(part, { end: have - 1 })) hash.update(chunk as Buffer);
  const out = createWriteStream(part, { flags: have > 0 ? "a" : "w" });
  let written = have;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      written += value.byteLength;
      if (!out.write(value)) await once(out, "drain");
      report(Math.min(written / target.bytes, 0.99));
    }
  } finally {
    out.end();
    await once(out, "close");
  }
  if (written !== target.bytes) throw new ModelDownloadError("incomplete");
  if (target.sha256 !== undefined && hash.digest("hex") !== target.sha256) {
    await rm(part, { force: true });
    throw new ModelDownloadError("checksum");
  }
  await rename(part, target.path);
  report(1);
}
