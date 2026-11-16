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
 * Stored parts follow each other in meeting time, each as long as its real audio: the encoder's
 * priming and padding samples (iTunSMPB, or an edit list) are not meeting time. A frame is
 * taken out when any of it overlaps a part, so nothing at the edges leaks. Audio that cannot
 * be read is never handed out while anything is set aside (it throws).
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
  /** Encoder delay at the start, in samples (not meeting time). */
  readonly priming: number;
  /** Samples of real audio (frames less priming and end padding). */
  readonly playSamples: number;
  /** Seconds of real audio. */
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
      const flags = bytes[at + 2]!;
      at += 3; // ES_ID and flags
      if ((flags & 0x80) !== 0) at += 2; // streamDependenceFlag: dependsOn_ES_ID
      if ((flags & 0x40) !== 0) at += 1 + (bytes[at] ?? 0); // URL_Flag: URLlength and URL
      if ((flags & 0x20) !== 0) at += 2; // OCRstreamFlag: OCR_ES_Id
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

/** Rate and channels from an AudioSpecificConfig (ISO 14496-3 1.6.2.1); undefined when unreadable. */
function configLayout(config: Uint8Array | undefined): { sampleRate: number; channels: number } | undefined {
  if (config === undefined || config.length < 2) return undefined;
  let bit = 0;
  const read = (count: number): number => {
    let value = 0;
    for (let index = 0; index < count; index += 1, bit += 1) value = (value << 1) | ((config[bit >> 3]! >> (7 - (bit & 7))) & 1);
    return value;
  };
  const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  if (read(5) === 31) read(6);
  const index = read(4);
  if (index === 15 && config.length < 5) return undefined;
  const sampleRate = index === 15 ? read(24) : RATES[index];
  const channels = read(4);
  if (sampleRate === undefined || sampleRate <= 0 || channels < 1 || channels > 7) return undefined;
  return { sampleRate, channels };
}

/** Priming and padding from an `iTunSMPB` comment (" 00000000 00000840 000001D1 ..."), if present. */
function itunesGapless(data: Uint8Array): { priming: number; padding: number } | undefined {
  const marker = [0x69, 0x54, 0x75, 0x6e, 0x53, 0x4d, 0x50, 0x42]; // "iTunSMPB"
  for (let at = 0; at + marker.length < data.length; at += 1) {
    if (!marker.every((byte, index) => data[at + index] === byte)) continue;
    const text = new TextDecoder("latin1").decode(data.subarray(at + marker.length, Math.min(data.length, at + marker.length + 160)));
    const fields = text.match(/[0-9A-Fa-f]{8,16}/gu);
    if (fields === null || fields.length < 3) return undefined;
    return { priming: parseInt(fields[1]!, 16), padding: parseInt(fields[2]!, 16) };
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
  const entryChannels = view.getUint16(entry.body + 16);
  const entryRate = view.getUint32(entry.body + 24) >>> 16;
  // QuickTime sound description versions 1 and 2 carry 16 and 36 more bytes before child boxes.
  const version = view.getUint16(entry.body + 8);
  const childStart = entry.body + 28 + (version === 1 ? 16 : version === 2 ? 36 : 0);
  const esds = children(view, childStart, entry.end).find((item) => item.type === "esds");
  const audioSpecificConfig = esds === undefined ? undefined : decoderConfig(data, esds.body, esds.end);
  // The decoder config is the truth: Core Audio writes 2 channels in the sample entry for mono.
  const layout = configLayout(audioSpecificConfig);
  if (layout === undefined) throw new M4aError("no decoder config");
  const { sampleRate, channels } = layout;
  void entryChannels;
  void entryRate;

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
  const total = frameSamples.reduce((sum, value) => sum + value, 0);
  // Real audio: an edit list (media time, segment duration in the movie timescale) or iTunSMPB.
  let priming = 0;
  let playSamples = total;
  const edts = children(view, trak.body, trak.end).find((item) => item.type === "edts");
  const elst = edts === undefined ? undefined : children(view, edts.body, edts.end).find((item) => item.type === "elst");
  const mvhd = children(view, moov.body, moov.end).find((item) => item.type === "mvhd");
  if (elst !== undefined && mvhd !== undefined && view.getUint32(elst.body + 4) >= 1) {
    const v1 = view.getUint8(elst.body) === 1;
    const movieScale = view.getUint8(mvhd.body) === 1 ? view.getUint32(mvhd.body + 20) : view.getUint32(mvhd.body + 12);
    const segment = v1 ? Number(view.getBigUint64(elst.body + 8)) : view.getUint32(elst.body + 8);
    const media = v1 ? Number(view.getBigInt64(elst.body + 16)) : view.getInt32(elst.body + 12);
    if (media >= 0) {
      priming = Math.round((media * sampleRate) / timescale);
      playSamples = Math.min(total - priming, Math.round((segment * sampleRate) / movieScale));
    }
  } else {
    const gapless = itunesGapless(data);
    if (gapless !== undefined && gapless.priming + gapless.padding < total) {
      priming = gapless.priming;
      playSamples = total - gapless.priming - gapless.padding;
    }
  }
  return { sampleRate, channels, audioSpecificConfig, frames, frameSamples, priming, playSamples, duration: playSamples / sampleRate };
}

/** Whether a frame spanning `[start, end)` meeting seconds overlaps any range. */
function overlaps(span: { start: number; end: number }, ranges: readonly TimeRange[]): boolean {
  return ranges.some((range) => span.start < range.end && span.end > range.start);
}

/** Each stored part with its frames and the meeting time each frame covers (priming is not meeting time). */
function timed(parts: readonly AudioPartData[]): Array<{ part: AudioPartData; parsed: ParsedM4a; spans: Array<{ start: number; end: number }> }> {
  let offset = 0;
  return parts.map((part) => {
    const parsed = parseM4a(part.data);
    let sample = -parsed.priming;
    const spans = parsed.frameSamples.map((samples) => {
      const span = { start: offset + sample / parsed.sampleRate, end: offset + (sample + samples) / parsed.sampleRate };
      sample += samples;
      return span;
    });
    offset += parsed.duration;
    return { part, parsed, spans };
  });
}

/** The kept frames as M4A, with an edit list so the file keeps its real length. */
function remux(parsed: ParsedM4a, keep: readonly boolean[], frames: readonly Uint8Array[]): Uint8Array {
  const kept = frames.filter((_, index) => keep[index]);
  const keptSamples = parsed.frameSamples.reduce((sum, samples, index) => sum + (keep[index] ? samples : 0), 0);
  const total = parsed.frameSamples.reduce((sum, samples) => sum + samples, 0);
  const priming = keep[0] ? parsed.priming : 0;
  const padding = keep[keep.length - 1] ? total - parsed.priming - parsed.playSamples : 0;
  return muxM4a({
    sampleRate: parsed.sampleRate, channels: parsed.channels, frames: kept, audioSpecificConfig: parsed.audioSpecificConfig,
    edit: { priming, playSamples: Math.max(0, keptSamples - priming - padding) },
  });
}

/** The audio for an export: frames inside set-aside parts dropped; parts left empty dropped. */
export function cutSetAsideAudio(parts: readonly AudioPartData[], ranges: readonly TimeRange[]): AudioPartData[] {
  if (ranges.length === 0) return [...parts];
  return timed(parts).flatMap(({ part, parsed, spans }) => {
    const keep = spans.map((span) => !overlaps(span, ranges));
    if (keep.every(Boolean)) return [part];
    return keep.some(Boolean) ? [{ name: part.name, data: remux(parsed, keep, parsed.frames) }] : [];
  });
}

/**
 * The audio for a paired phone: frames inside set-aside parts replaced by silent frames, every
 * time kept. Audio with more than one channel is cut instead (no silent frame is known for it).
 */
export function silenceSetAsideAudio(parts: readonly AudioPartData[], ranges: readonly TimeRange[]): AudioPartData[] {
  if (ranges.length === 0) return [...parts];
  return timed(parts).flatMap(({ part, parsed, spans }) => {
    const aside = spans.map((span) => overlaps(span, ranges));
    if (!aside.some(Boolean)) return [part];
    if (parsed.channels !== 1) {
      const keep = aside.map((value) => !value);
      return keep.some(Boolean) ? [{ name: part.name, data: remux(parsed, keep, parsed.frames) }] : [];
    }
    const frames = parsed.frames.map((frame, index) => (aside[index] ? SILENT_AAC_MONO_FRAME : frame));
    return [{ name: part.name, data: remux(parsed, aside.map(() => true), frames) }];
  });
}
