/**
 * A minimal MPEG-4 audio file (`.m4a`) writer for AAC frames, so audio recorded on this
 * computer is stored in the same format as the phone's segments (AAC LC in M4A, 48 kHz
 * mono, `SegmentWriter.swift`) and plays on the phone with AVFoundation. One track, one
 * chunk, `moov` before `mdat` (fast start). The frames come from WebCodecs' AAC encoder
 * (raw access units, no ADTS headers).
 */

export const AAC_SAMPLES_PER_FRAME = 1024;

export interface M4aInput {
  readonly sampleRate: number;
  readonly channels: number;
  /** Raw AAC access units in decode order. */
  readonly frames: readonly Uint8Array[];
  /** The decoder's AudioSpecificConfig; built for AAC LC when absent. */
  readonly audioSpecificConfig?: Uint8Array | undefined;
  /** Bits per second, recorded in the decoder configuration. */
  readonly bitRate?: number | undefined;
}

const SAMPLE_RATE_INDEX = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
const AAC_LC = 2;
const DEFAULT_BIT_RATE = 64_000;

/** AudioSpecificConfig for AAC LC (ISO 14496-3 1.6.2.1): 5 bits object type, 4 bits rate index, 4 bits channels. */
export function aacLcConfig(sampleRate: number, channels: number): Uint8Array {
  const index = SAMPLE_RATE_INDEX.indexOf(sampleRate);
  if (index < 0) throw new RangeError("unsupported sample rate");
  const bits = (AAC_LC << 11) | (index << 7) | (channels << 3);
  return new Uint8Array([bits >> 8, bits & 0xff]);
}

/** Seconds of audio in `frameCount` AAC frames. */
export function aacDuration(frameCount: number, sampleRate: number): number {
  return (frameCount * AAC_SAMPLES_PER_FRAME) / sampleRate;
}

export function muxM4a(input: M4aInput): Uint8Array {
  const { sampleRate, channels, frames } = input;
  const config = input.audioSpecificConfig ?? aacLcConfig(sampleRate, channels);
  const duration = frames.length * AAC_SAMPLES_PER_FRAME;
  const mdatSize = 8 + frames.reduce((sum, frame) => sum + frame.length, 0);
  const ftyp = box("ftyp", ascii("M4A "), u32(0), ascii("M4A "), ascii("mp42"), ascii("isom"));
  // The chunk offset depends on the size of moov, which holds it: build once, measure, rebuild.
  const build = (offset: number) => moov(sampleRate, channels, duration, frames, config, input.bitRate ?? DEFAULT_BIT_RATE, offset);
  const offset = ftyp.length + build(0).length + 8;
  const head = concat([ftyp, build(offset), u32(mdatSize), ascii("mdat")]);
  const out = new Uint8Array(head.length + mdatSize - 8);
  out.set(head);
  let at = head.length;
  for (const frame of frames) {
    out.set(frame, at);
    at += frame.length;
  }
  return out;
}

// MARK: - Boxes

function moov(rate: number, channels: number, duration: number, frames: readonly Uint8Array[], config: Uint8Array, bitRate: number, offset: number): Uint8Array {
  const matrix = concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);
  const mvhd = fullBox("mvhd", 0, 0, u32(0), u32(0), u32(rate), u32(duration), u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0), matrix, zeros(24), u32(2));
  const tkhd = fullBox("tkhd", 0, 7, u32(0), u32(0), u32(1), u32(0), u32(duration), u32(0), u32(0), u16(0), u16(0), u16(0x0100), u16(0), matrix, u32(0), u32(0));
  const mdhd = fullBox("mdhd", 0, 0, u32(0), u32(0), u32(rate), u32(duration), u16(0x55c4), u16(0));
  const hdlr = fullBox("hdlr", 0, 0, u32(0), ascii("soun"), u32(0), u32(0), u32(0), ascii("SoundHandler"), new Uint8Array([0]));
  const smhd = fullBox("smhd", 0, 0, u16(0), u16(0));
  const dinf = box("dinf", fullBox("dref", 0, 0, u32(1), fullBox("url ", 0, 1)));
  const maxFrame = frames.reduce((max, frame) => Math.max(max, frame.length), 0);
  const mp4a = box("mp4a", zeros(6), u16(1), u32(0), u32(0), u16(channels), u16(16), u16(0), u16(0), u32(rate * 65536), esds(config, bitRate, maxFrame));
  const stsd = fullBox("stsd", 0, 0, u32(1), mp4a);
  const stts = fullBox("stts", 0, 0, u32(frames.length > 0 ? 1 : 0), ...(frames.length > 0 ? [u32(frames.length), u32(AAC_SAMPLES_PER_FRAME)] : []));
  const stsc = fullBox("stsc", 0, 0, u32(frames.length > 0 ? 1 : 0), ...(frames.length > 0 ? [u32(1), u32(frames.length), u32(1)] : []));
  const stsz = fullBox("stsz", 0, 0, u32(0), u32(frames.length), ...frames.map((frame) => u32(frame.length)));
  const stco = fullBox("stco", 0, 0, u32(frames.length > 0 ? 1 : 0), ...(frames.length > 0 ? [u32(offset)] : []));
  const stbl = box("stbl", stsd, stts, stsc, stsz, stco);
  const minf = box("minf", smhd, dinf, stbl);
  const mdia = box("mdia", mdhd, hdlr, minf);
  return box("moov", mvhd, box("trak", tkhd, mdia));
}

/** Elementary stream descriptor (ISO 14496-1): ES, decoder config (AAC, audio stream), the AudioSpecificConfig, SL config. */
function esds(config: Uint8Array, bitRate: number, maxFrame: number): Uint8Array {
  const specific = descriptor(0x05, config);
  const decoder = descriptor(0x04, concat([new Uint8Array([0x40, 0x15]), u24(Math.max(maxFrame, 1536)), u32(bitRate), u32(bitRate), specific]));
  const sl = descriptor(0x06, new Uint8Array([0x02]));
  return fullBox("esds", 0, 0, descriptor(0x03, concat([u16(1), new Uint8Array([0]), decoder, sl])));
}

function descriptor(tag: number, body: Uint8Array): Uint8Array {
  const length = body.length;
  return concat([new Uint8Array([tag, 0x80 | ((length >> 21) & 0x7f), 0x80 | ((length >> 14) & 0x7f), 0x80 | ((length >> 7) & 0x7f), length & 0x7f]), body]);
}

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = concat(parts);
  return concat([u32(body.length + 8), ascii(type), body]);
}

function fullBox(type: string, version: number, flags: number, ...parts: Uint8Array[]): Uint8Array {
  return box(type, new Uint8Array([version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]), ...parts);
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0);
  return out;
}

function u24(value: number): Uint8Array {
  return new Uint8Array([(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
}

function u16(value: number): Uint8Array {
  return new Uint8Array([(value >> 8) & 0xff, value & 0xff]);
}

function zeros(count: number): Uint8Array {
  return new Uint8Array(count);
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// MARK: - ADTS (tests and recovery tools)

/** Splits an ADTS stream into raw access units (headers removed). */
export function adtsFrames(stream: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = [];
  let at = 0;
  while (at + 7 <= stream.length) {
    if (stream[at] !== 0xff || (stream[at + 1]! & 0xf0) !== 0xf0) throw new RangeError("not an ADTS stream");
    const protectionAbsent = stream[at + 1]! & 0x01;
    const length = ((stream[at + 3]! & 0x03) << 11) | (stream[at + 4]! << 3) | (stream[at + 5]! >> 5);
    const header = protectionAbsent === 1 ? 7 : 9;
    if (length < header || at + length > stream.length) break;
    frames.push(stream.slice(at + header, at + length));
    at += length;
  }
  return frames;
}
