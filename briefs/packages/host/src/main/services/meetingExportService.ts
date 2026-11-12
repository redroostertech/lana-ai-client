import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { parseLanaId, type LanaId } from "@lana/core/ids";
import type { AudioPart } from "@lana/core/store";
import type { MeetingExportApi, MeetingExportKind, MeetingExportRequest, MeetingExportSaved, Result } from "../../shared/api.js";
import type { MainLog } from "../log.js";

/** What the export needs from Electron: the save dialog, printing to PDF and the file manager. */
export interface ExportFiles {
  /** The native save dialog; null when the person cancelled. */
  pickPath(suggestedName: string, filter: { name: string; extensions: string[] }): Promise<string | null>;
  /** Prints an export's HTML body to PDF bytes (pdfRenderer.ts). */
  renderPdf(document: { body: string; title: string }): Promise<Uint8Array>;
  showItemInFolder(path: string): void;
}

/** The stored audio, read from the encrypted store. */
export interface ExportAudioSource {
  audioParts(id: LanaId): AudioPart[];
  audioData(id: LanaId, index: number): Uint8Array;
}

type Writer = (path: string, data: Uint8Array | string) => Promise<void>;

const KINDS: readonly MeetingExportKind[] = ["transcriptPdf", "transcriptText", "notesPdf", "meetingPdf", "audio"];
const PDF_FILTER = { name: "PDF", extensions: ["pdf"] };
const TEXT_FILTER = { name: "Plain text", extensions: ["txt"] };
const AUDIO_EXTENSIONS = ["m4a", "mp3", "wav", "caf", "aac"];
/** Far above any real meeting; stops a runaway page from handing main gigabytes. */
const CONTENT_LIMIT = 32 * 1024 * 1024;
const NAME_LIMIT = 120;
/** Saved exports the toast can still show; older ones fall off. */
const REMEMBERED = 20;
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f<>:"/\\|?*]+/g;

const FAILED = { ok: false as const, error: { code: "io", message: "LANA could not save the export. Try again." } };
const INVALID = { ok: false as const, error: { code: "invalid", message: "LANA could not export this meeting." } };
const NO_AUDIO = { ok: false as const, error: { code: "noAudio", message: "The audio for this meeting is no longer on this computer." } };

/** A file name without separators, reserved characters, or leading and trailing dots; "Meeting" when nothing is left. */
export function safeFileName(name: string): string {
  const cleaned = String(name ?? "").replace(UNSAFE, " ").replace(/\s+/g, " ").replace(/^[.\s]+|[.\s]+$/g, "");
  return cleaned.slice(0, NAME_LIMIT).replace(/[.\s]+$/, "") || "Meeting";
}

/** The extension a stored audio part keeps ("m4a" when it is not one we know). */
export function audioExtension(partName: string): string {
  const extension = extname(partName).slice(1).toLowerCase();
  return AUDIO_EXTENSIONS.includes(extension) ? extension : "m4a";
}

/** "Annapolis Audio part 2 of 3.m4a" beside the path the person picked. */
export function audioPartPath(picked: string, part: number, parts: number, extension: string): string {
  if (parts === 1) return picked;
  const stem = basename(picked, extname(picked));
  return join(dirname(picked), `${stem} part ${part} of ${parts}.${extension}`);
}

/**
 * Export on the meeting page: asks where to save in the native dialog, then writes the PDF,
 * text or audio on this computer. Nothing leaves the computer. Logs carry the meeting id,
 * the kind and sizes only: never transcript text, names or paths.
 */
export class MeetingExportService implements MeetingExportApi {
  private readonly saved = new Map<string, string>();

  constructor(
    private readonly audio: ExportAudioSource,
    private readonly files: ExportFiles,
    private readonly log: MainLog,
    private readonly write: Writer = (path, data) => writeFile(path, data, { mode: 0o600 }),
  ) {}

  async save(request: MeetingExportRequest): Promise<Result<MeetingExportSaved | null>> {
    const kind = request?.kind;
    const meetingID = parseLanaId(String(request?.meetingID ?? ""), "meeting");
    if (meetingID === null || !KINDS.includes(kind)) return INVALID;
    const name = safeFileName(String(request.fileName ?? ""));
    if (kind === "audio") return this.saveAudio(meetingID, name);
    const content = request.content;
    if (typeof content !== "string" || content.length > CONTENT_LIMIT) return INVALID;

    const isText = kind === "transcriptText";
    const path = await this.files.pickPath(`${name}.${isText ? "txt" : "pdf"}`, isText ? TEXT_FILTER : PDF_FILTER);
    if (path === null) {
      this.log.info("export.cancelled", { meeting: meetingID, kind });
      return { ok: true, value: null };
    }
    let data: Uint8Array | string;
    if (isText) {
      data = content;
    } else {
      try {
        data = await this.files.renderPdf({ body: content, title: String(request.title ?? "").slice(0, NAME_LIMIT) });
      } catch {
        this.log.error("export.render_failed", { meeting: meetingID, kind });
        return FAILED;
      }
    }
    try {
      await this.write(path, data);
    } catch {
      this.log.error("export.write_failed", { meeting: meetingID, kind });
      return FAILED;
    }
    this.log.info("export.saved", { meeting: meetingID, kind, bytes: typeof data === "string" ? Buffer.byteLength(data) : data.byteLength });
    return { ok: true, value: { fileID: this.remember(path), files: 1 } };
  }

  async showInFolder(fileID: string): Promise<void> {
    const path = this.saved.get(String(fileID));
    if (path !== undefined) this.files.showItemInFolder(path);
  }

  private async saveAudio(meetingID: LanaId, name: string): Promise<Result<MeetingExportSaved | null>> {
    let parts: AudioPart[];
    try {
      parts = this.audio.audioParts(meetingID);
    } catch {
      this.log.error("export.audio_read_failed", { meeting: meetingID });
      return FAILED;
    }
    if (parts.length === 0) return NO_AUDIO;
    const extension = audioExtension(parts[0]!.name);
    const picked = await this.files.pickPath(`${name}.${extension}`, { name: "Audio", extensions: [extension] });
    if (picked === null) {
      this.log.info("export.cancelled", { meeting: meetingID, kind: "audio" });
      return { ok: true, value: null };
    }
    const paths: string[] = [];
    let bytes = 0;
    try {
      for (const [offset, part] of parts.entries()) {
        const data = this.audio.audioData(meetingID, part.index);
        const path = audioPartPath(picked, offset + 1, parts.length, audioExtension(part.name));
        await this.write(path, data);
        paths.push(path);
        bytes += data.byteLength;
      }
    } catch {
      this.log.error("export.write_failed", { meeting: meetingID, kind: "audio", written: paths.length });
      return FAILED;
    }
    this.log.info("export.saved", { meeting: meetingID, kind: "audio", files: paths.length, bytes });
    return { ok: true, value: { fileID: this.remember(paths[0]!), files: paths.length } };
  }

  private remember(path: string): string {
    const id = randomBytes(12).toString("hex");
    this.saved.set(id, path);
    while (this.saved.size > REMEMBERED) this.saved.delete(this.saved.keys().next().value!);
    return id;
  }
}
