import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { utf8, fromUtf8 } from "../bytes/utf8.js";
import { toHex } from "../bytes/hex.js";
import { randomBytes } from "../crypto/random.js";

/**
 * Seals with the store's data key, the way stored audio is sealed (AES-256-GCM, AAD
 * `lana.gateway|<context>`). `GatewayStore.seal` and `open` implement it.
 */
export interface RecordingSealer {
  seal(data: Uint8Array, context: string): Uint8Array;
  open(data: Uint8Array, context: string): Uint8Array;
}

/** The two streams a recording writes: encoded audio (AAC frames) and 16 kHz PCM for transcription. */
export type JournalStream = "aac" | "pcm";

const RECORD_HEADER = 4;
const META_FILE = "meta.sealed";
const NOTES_FILE = "notes.sealed";

/**
 * A recording in progress, kept on disk so a crash never loses everything. Each stream is
 * an append-only file of records `[u32 big-endian length][sealed bytes]`, every record sealed
 * on its own with the context `recording|<id>|<stream>|<sequence>` (so records cannot be
 * reordered or moved between recordings). A record cut short by a crash, or one that does
 * not open, ends the readable stream there; everything before it is kept. Metadata and the
 * scratch pad are small sealed files replaced atomically. Nothing here is ever in clear.
 */
export class RecordingJournal {
  private readonly next: Record<JournalStream, number> = { aac: 0, pcm: 0 };
  private readonly handles: Partial<Record<JournalStream, number>> = {};

  private constructor(readonly directory: string, readonly id: string, private readonly sealer: RecordingSealer) {}

  /** A new journal in `parent/<id>`. */
  static create(parent: string, id: string, sealer: RecordingSealer): RecordingJournal {
    const directory = join(parent, id);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    return new RecordingJournal(directory, id, sealer);
  }

  /** Reopens a journal left on disk (after a crash), appending after its last whole record. */
  static reopen(parent: string, id: string, sealer: RecordingSealer): RecordingJournal {
    const journal = new RecordingJournal(join(parent, id), id, sealer);
    for (const stream of ["aac", "pcm"] as const) {
      const { records, validBytes } = journal.scan(stream);
      journal.next[stream] = records.length;
      journal.truncateTo(stream, validBytes);
    }
    return journal;
  }

  /** Recording ids with a journal under `parent`. */
  static list(parent: string): string[] {
    try {
      return readdirSync(parent, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    } catch {
      return [];
    }
  }

  /** Seals `data` as the stream's next record and syncs it to disk. */
  append(stream: JournalStream, data: Uint8Array): void {
    if (data.length === 0) return;
    const sealed = this.sealer.seal(data, this.context(stream, this.next[stream]));
    const record = new Uint8Array(RECORD_HEADER + sealed.length);
    new DataView(record.buffer).setUint32(0, sealed.length);
    record.set(sealed, RECORD_HEADER);
    const handle = this.handle(stream);
    writeSync(handle, record);
    fsyncSync(handle);
    this.next[stream] += 1;
  }

  /** Every readable record of the stream, in order. */
  read(stream: JournalStream): Uint8Array[] {
    return this.scan(stream).records;
  }

  writeMeta(value: unknown): void {
    this.writeSealed(META_FILE, "meta", utf8(JSON.stringify(value)));
  }

  readMeta(): unknown {
    const data = this.readSealed(META_FILE, "meta");
    return data === null ? null : (JSON.parse(fromUtf8(data)) as unknown);
  }

  writeNotes(value: unknown): void {
    this.writeSealed(NOTES_FILE, "notes", utf8(JSON.stringify(value)));
  }

  readNotes(): unknown {
    const data = this.readSealed(NOTES_FILE, "notes");
    return data === null ? null : (JSON.parse(fromUtf8(data)) as unknown);
  }

  close(): void {
    for (const stream of ["aac", "pcm"] as const) {
      const handle = this.handles[stream];
      if (handle !== undefined) closeSync(handle);
      delete this.handles[stream];
    }
  }

  /** Deletes the journal: only after the meeting is safely in the store. */
  remove(): void {
    this.close();
    rmSync(this.directory, { recursive: true, force: true });
  }

  // MARK: - Private

  private context(stream: JournalStream, sequence: number): string {
    return `recording|${this.id}|${stream}|${sequence}`;
  }

  private path(stream: JournalStream): string {
    return join(this.directory, `${stream}.journal`);
  }

  private handle(stream: JournalStream): number {
    const existing = this.handles[stream];
    if (existing !== undefined) return existing;
    const opened = openSync(this.path(stream), "a", 0o600);
    this.handles[stream] = opened;
    return opened;
  }

  private scan(stream: JournalStream): { records: Uint8Array[]; validBytes: number } {
    let file: Uint8Array;
    try {
      file = new Uint8Array(readFileSync(this.path(stream)));
    } catch {
      return { records: [], validBytes: 0 };
    }
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    const records: Uint8Array[] = [];
    let at = 0;
    while (at + RECORD_HEADER <= file.length) {
      const length = view.getUint32(at);
      if (length === 0 || at + RECORD_HEADER + length > file.length) break;
      try {
        records.push(this.sealer.open(file.subarray(at + RECORD_HEADER, at + RECORD_HEADER + length), this.context(stream, records.length)));
      } catch {
        break;
      }
      at += RECORD_HEADER + length;
    }
    return { records, validBytes: at };
  }

  /** Drops a torn record at the end, so later appends follow the last whole one. */
  private truncateTo(stream: JournalStream, bytes: number): void {
    let file: Uint8Array;
    try {
      file = new Uint8Array(readFileSync(this.path(stream)));
    } catch {
      return;
    }
    if (file.length === bytes) return;
    this.replace(this.path(stream), file.subarray(0, bytes));
  }

  private writeSealed(name: string, label: string, data: Uint8Array): void {
    this.replace(join(this.directory, name), this.sealer.seal(data, `recording|${this.id}|${label}`));
  }

  private readSealed(name: string, label: string): Uint8Array | null {
    let sealed: Uint8Array;
    try {
      sealed = new Uint8Array(readFileSync(join(this.directory, name)));
    } catch {
      return null;
    }
    try {
      return this.sealer.open(sealed, `recording|${this.id}|${label}`);
    } catch {
      return null;
    }
  }

  private replace(path: string, data: Uint8Array): void {
    const temporary = `${path}.${toHex(randomBytes(6))}.tmp`;
    const handle = openSync(temporary, "w", 0o600);
    try {
      writeSync(handle, data);
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSync(temporary, path);
  }
}

// MARK: - Record payloads

/** Packs AAC frames into one record: `[u32 length][frame]...`. */
export function packFrames(frames: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(frames.reduce((sum, frame) => sum + 4 + frame.length, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const frame of frames) {
    view.setUint32(at, frame.length);
    out.set(frame, at + 4);
    at += 4 + frame.length;
  }
  return out;
}

export function unpackFrames(record: Uint8Array): Uint8Array[] {
  const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
  const frames: Uint8Array[] = [];
  for (let at = 0; at + 4 <= record.length;) {
    const length = view.getUint32(at);
    if (at + 4 + length > record.length) break;
    frames.push(record.slice(at + 4, at + 4 + length));
    at += 4 + length;
  }
  return frames;
}
