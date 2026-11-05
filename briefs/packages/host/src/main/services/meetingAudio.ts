import { randomBytes } from "node:crypto";
import { parseLanaId, type LanaId } from "@lana/core/ids";
import type { GatewayStore } from "@lana/core/store";
import type { MeetingAudio, Result } from "../../shared/api.js";
import type { MainLog } from "../log.js";

/** The privileged scheme the renderer plays meeting audio from (registered in main before ready). */
export const AUDIO_SCHEME = "lana-audio";
const AUDIO_HOST = "meeting";
/** A grant lasts as long as a long meeting review. A new `audio(id)` call issues a fresh one. */
const GRANT_LIFETIME_MS = 6 * 3_600_000;
/** Decrypted parts kept in memory, so range requests while seeking do not decrypt again. */
const CACHE_PARTS = 4;

interface Grant {
  readonly meetingID: LanaId;
  readonly expiresAt: number;
}

/**
 * Replay audio for the renderer (Swift `ReplayAudioPlayer` reading `audioData`): main
 * decrypts each stored part from the store when the renderer reads it through the
 * `lana-audio:` scheme. URLs carry a random grant that only the app's own page receives
 * (over the trusted IPC bridge), bound to one meeting, with an expiry; sign-out revokes
 * every grant. Decrypted audio stays in memory and is never written to disk.
 */
export class MeetingAudioService {
  private readonly grants = new Map<string, Grant>();
  private readonly cache: Array<{ key: string; data: Uint8Array }> = [];

  constructor(
    private readonly store: GatewayStore,
    private readonly log: MainLog,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** `meetings.audio`: one URL per stored part, or `noAudio` when retention removed it. */
  async audio(id: string): Promise<Result<MeetingAudio>> {
    const meetingID = parseLanaId(String(id), "meeting");
    const noAudio = { ok: false as const, error: { code: "noAudio", message: "The audio for this meeting is no longer on this computer." } };
    if (meetingID === null) return noAudio;
    try {
      const parts = this.store.meetings.audioParts(meetingID);
      if (parts.length === 0) return noAudio;
      this.prune();
      const token = randomBytes(24).toString("hex");
      this.grants.set(token, { meetingID, expiresAt: this.now() + GRANT_LIFETIME_MS });
      this.log.info("replay.granted", { meeting: meetingID, parts: parts.length });
      return { ok: true, value: { parts: parts.map((part) => ({ url: `${AUDIO_SCHEME}://${AUDIO_HOST}/${token}/${part.index}`, byteCount: part.byteCount })) } };
    } catch {
      this.log.error("replay.grant_failed", { meeting: meetingID });
      return { ok: false, error: { code: "store", message: "LANA could not read this meeting's audio from its encrypted store." } };
    }
  }

  /** Signing out ends every playback grant and drops decrypted audio. */
  revokeAll(): void {
    this.grants.clear();
    this.cache.length = 0;
  }

  /** The protocol handler: `lana-audio://meeting/<grant>/<part>`, with byte ranges for seeking. */
  async handle(url: string, rangeHeader: string | null): Promise<Response> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return status(400);
    }
    const [, token, index] = parsed.pathname.split("/");
    const grant = token === undefined ? undefined : this.grants.get(token);
    if (parsed.host !== AUDIO_HOST || grant === undefined || grant.expiresAt < this.now() || index === undefined || !/^\d+$/.test(index)) return status(403);
    let data: Uint8Array;
    let name: string;
    try {
      const part = this.store.meetings.audioParts(grant.meetingID).find((item) => item.index === Number(index));
      if (part === undefined) return status(404);
      name = part.name;
      data = this.decrypted(grant.meetingID, part.index);
    } catch {
      this.log.error("replay.part_failed", { meeting: grant.meetingID });
      return status(404);
    }
    const headers: Record<string, string> = { "Content-Type": contentType(name), "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
    const range = parseRange(rangeHeader, data.length);
    if (range === "invalid") return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${data.length}` } });
    if (range === null) return new Response(data.slice(), { status: 200, headers: { ...headers, "Content-Length": String(data.length) } });
    const body = data.slice(range.start, range.end + 1);
    return new Response(body, {
      status: 206,
      headers: { ...headers, "Content-Length": String(body.length), "Content-Range": `bytes ${range.start}-${range.end}/${data.length}` },
    });
  }

  private decrypted(meetingID: LanaId, index: number): Uint8Array {
    const key = `${meetingID}#${index}`;
    const hit = this.cache.find((entry) => entry.key === key);
    if (hit !== undefined) return hit.data;
    const data = this.store.meetings.audioData(meetingID, index);
    this.cache.unshift({ key, data });
    this.cache.length = Math.min(this.cache.length, CACHE_PARTS);
    return data;
  }

  private prune(): void {
    const now = this.now();
    for (const [token, grant] of this.grants) if (grant.expiresAt < now) this.grants.delete(token);
  }
}

/** `bytes=a-b`, `bytes=a-` or `bytes=-n`; null for none, "invalid" for unsatisfiable. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (header === null || header.trim() === "") return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) return null;
  const [, from = "", to = ""] = match;
  if (from === "" && to === "") return "invalid";
  let start: number;
  let end: number;
  if (from === "") {
    const suffix = Number(to);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(from);
    end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}

function contentType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".caf")) return "audio/x-caf";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  return "audio/mp4";
}

function status(code: number): Response {
  return new Response(null, { status: code });
}
