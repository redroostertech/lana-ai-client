import { AAC_SAMPLES_PER_FRAME, muxM4a } from "./m4a.js";

/**
 * Set-aside parts taken out of meeting audio that leaves the computer (contract: exports always
 * leave set-aside parts out). Stored audio is never changed, so Restore keeps working.
 *
 * - Export (`cutSetAsideAudio`): the AAC frames inside a part are dropped and each stored part is
 *   written again as M4A; a part left with no frames is dropped. The file gets shorter.
 * - Sending to a paired phone (`silenceSetAsideAudio`): the frames inside a part become silent
 *   frames, so every later moment keeps its time and replay stays in step with the transcript.
 *
 * Stored parts follow each other in meeting time; a frame is inside a part when its middle is
 * at or after the part's start and before its end. Audio that cannot be read is never handed
 * out while anything is set aside (it throws).
 */

/** A silent AAC LC frame for one channel (a single channel element with zero spectral data). */
export const SILENT_AAC_MONO_FRAME = new Uint8Array([0x01, 0x18, 0x20, 0x07]);

export interface AudioPartData {
  readonly name: string;
  readonly data: Uint8Array;
}

export interface TimeRange {
  readonly start: number;
  readonly end: number;
}

export interface ParsedM4a {
  readonly sampleRate: number;
  readonly channels: number;
  readonly audioSpecificConfig: Uint8Array | undefined;
  readonly frames: Uint8Array[];
  /** Samples in each frame (from `stts`). */
  readonly frameSamples: number[];
  /** Seconds. */
  readonly duration: number;
}

class M4aError extends Error {
  constructor(what: string) {
    super(`m4a: ${what}`);
    this.name = "M4aError";
  }
}

interface Box {
  readonly type: string;
  readonly start: number;
  readonly body: number;
  readonly end: number;
}

function children(view: DataView, start: number, end: number): Box[] {
  const out: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at);
    const type = String.fromCharCode(view.getUint8(at + 4), view.getUint8(at + 5), view.getUint8(at + 6), view.getUint8(at + 7));
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) throw new M4aError("box");
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) throw new M4aError("box");
    out.push({ type, start: at, body: at + header, end: at + size });
    at += size;
  }
  return out;
}

function child(view: DataView, parent: Box, type: string): Box {
  const found = children(view, parent.body, parent.end).find((item) => item.type === type);
  if (found === undefined) throw new M4aError(`no ${type}`);
  return found;
}

/** The AudioSpecificConfig inside an `esds` box (descriptor tag 5), if present. */
function decoderConfig(bytes: Uint8Array, start: number, end: number): Uint8Array | undefined {
  let at = start + 4; // version and flags
  const readLength = (): number => {
    let length = 0;
    for (let index = 0; index < 4 && at < end; index += 1) {
      const byte = bytes[at++]!;
      length = (length << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) break;
    }
    return length;
  };
  while (at < end) {
    const tag = bytes[at++]!;
    const length = readLength();
    if (tag === 0x03) {
      at += 3; // ES_ID and flags (no optional fields in audio files we read)
      continue;
    }
    if (tag === 0x04) {
      at += 13; // object type, stream type, buffer size, bit rates
      continue;
    }
    if (tag === 0x05) return bytes.slice(at, at + length);
    at += length;
  }
  return undefined;
}

/** The single audio track of an M4A file: its AAC frames in decode order. */
export function parseM4a(data: Uint8Array): ParsedM4a {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const top = children(view, 0, data.byteLength);
  const moov = top.find((item) => item.type === "moov");
  if (moov === undefined) throw new M4aError("no moov");
  const trak = children(view, moov.body, moov.end).find((item) => item.type === "trak");
  if (trak === undefined) throw new M4aError("no trak");
  const mdia = child(view, trak, "mdia");
  const mdhd = child(view, mdia, "mdhd");
  const timescale = view.getUint8(mdhd.body) === 1 ? view.getUint32(mdhd.body + 20) : view.getUint32(mdhd.body + 12);
  const stbl = child(view, child(view, mdia, "minf"), "stbl");
  const stsd = child(view, stbl, "stsd");
  const entry = children(view, stsd.body + 8, stsd.end)[0];
  if (entry === undefined || entry.type !== "mp4a") throw new M4aError("not AAC audio");
  const channels = view.getUint16(entry.body + 16);
  const sampleRate = view.getUint32(entry.body + 24) >>> 16;
  // QuickTime sound description versions 1 and 2 carry 16 and 36 more bytes before child boxes.
  const version = view.getUint16(entry.body + 8);
  const childStart = entry.body + 28 + (version === 1 ? 16 : version === 2 ? 36 : 0);
  const esds = children(view, childStart, entry.end).find((item) => item.type === "esds");
  const audioSpecificConfig = esds === undefined ? undefined : decoderConfig(data, esds.body, esds.end);

  const stsz = child(view, stbl, "stsz");
  const uniform = view.getUint32(stsz.body + 4);
  const count = view.getUint32(stsz.body + 8);
  const sizes = Array.from({ length: count }, (_, index) => (uniform !== 0 ? uniform : view.getUint32(stsz.body + 12 + index * 4)));

  const boxes = children(view, stbl.body, stbl.end);
  const stco = boxes.find((item) => item.type === "stco" || item.type === "co64");
  if (stco === undefined) throw new M4aError("no chunk offsets");
  const chunkCount = view.getUint32(stco.body + 4);
  const offsets = Array.from({ length: chunkCount }, (_, index) => (stco.type === "co64" ? Number(view.getBigUint64(stco.body + 8 + index * 8)) : view.getUint32(stco.body + 8 + index * 4)));

  const stsc = child(view, stbl, "stsc");
  const runs = Array.from({ length: view.getUint32(stsc.body + 4) }, (_, index) => ({
    firstChunk: view.getUint32(stsc.body + 8 + index * 12),
    perChunk: view.getUint32(stsc.body + 12 + index * 12),
  }));

  const frames: Uint8Array[] = [];
  let sample = 0;
  for (let chunk = 1; chunk <= chunkCount && sample < count; chunk += 1) {
    const run = [...runs].reverse().find((item) => item.firstChunk <= chunk);
    if (run === undefined) throw new M4aError("stsc");
    let at = offsets[chunk - 1]!;
    for (let index = 0; index < run.perChunk && sample < count; index += 1) {
      const size = sizes[sample]!;
      if (at + size > data.byteLength) throw new M4aError("frame outside file");
      frames.push(data.slice(at, at + size));
      at += size;
      sample += 1;
    }
  }
  if (frames.length !== count) throw new M4aError("frame count");

  const stts = child(view, stbl, "stts");
  const frameSamples: number[] = [];
  const entries = view.getUint32(stts.body + 4);
  for (let index = 0; index < entries; index += 1) {
    const repeat = view.getUint32(stts.body + 8 + index * 8);
    const delta = view.getUint32(stts.body + 12 + index * 8);
    // Deltas are in the track's timescale; frames are counted in samples at the audio rate.
    const samples = timescale === sampleRate ? delta : Math.round((delta * sampleRate) / timescale);
    for (let repeatIndex = 0; repeatIndex < repeat; repeatIndex += 1) frameSamples.push(samples);
  }
  while (frameSamples.length < frames.length) frameSamples.push(AAC_SAMPLES_PER_FRAME);
  frameSamples.length = frames.length;
  const duration = frameSamples.reduce((sum, value) => sum + value, 0) / sampleRate;
  return { sampleRate, channels, audioSpecificConfig, frames, frameSamples, duration };
}

function inside(time: number, ranges: readonly TimeRange[]): boolean {
  return ranges.some((range) => time >= range.start && time < range.end);
}

/** Each stored part with its frames and the meeting time of every frame's middle. */
function timed(parts: readonly AudioPartData[]): Array<{ part: AudioPartData; parsed: ParsedM4a; middles: number[] }> {
  let offset = 0;
  return parts.map((part) => {
    const parsed = parseM4a(part.data);
    let at = offset;
    const middles = parsed.frameSamples.map((samples) => {
      const length = samples / parsed.sampleRate;
      const middle = at + length / 2;
      at += length;
      return middle;
    });
    offset += parsed.duration;
    return { part, parsed, middles };
  });
}

function remux(parsed: ParsedM4a, frames: Uint8Array[]): Uint8Array {
  return muxM4a({ sampleRate: parsed.sampleRate, channels: parsed.channels, frames, audioSpecificConfig: parsed.audioSpecificConfig });
}

/** The audio for an export: frames inside set-aside parts dropped; parts left empty dropped. */
export function cutSetAsideAudio(parts: readonly AudioPartData[], ranges: readonly TimeRange[]): AudioPartData[] {
  if (ranges.length === 0) return [...parts];
  return timed(parts).flatMap(({ part, parsed, middles }) => {
    const kept = parsed.frames.filter((_, index) => !inside(middles[index]!, ranges));
    if (kept.length === parsed.frames.length) return [part];
    return kept.length === 0 ? [] : [{ name: part.name, data: remux(parsed, kept) }];
  });
}

/**
 * The audio for a paired phone: frames inside set-aside parts replaced by silent frames, every
 * time kept. Audio with more than one channel is cut instead (no silent frame is known for it).
 */
export function silenceSetAsideAudio(parts: readonly AudioPartData[], ranges: readonly TimeRange[]): AudioPartData[] {
  if (ranges.length === 0) return [...parts];
  return timed(parts).flatMap(({ part, parsed, middles }) => {
    if (!parsed.frames.some((_, index) => inside(middles[index]!, ranges))) return [part];
    if (parsed.channels !== 1) {
      const kept = parsed.frames.filter((_, index) => !inside(middles[index]!, ranges));
      return kept.length === 0 ? [] : [{ name: part.name, data: remux(parsed, kept) }];
    }
    const frames = parsed.frames.map((frame, index) => (inside(middles[index]!, ranges) ? SILENT_AAC_MONO_FRAME : frame));
    return [{ name: part.name, data: remux(parsed, frames) }];
  });
}
