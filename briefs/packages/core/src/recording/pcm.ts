/**
 * The 16 kHz transcription audio of a recording: the microphone (the person at this
 * computer) and the system audio (everyone else in the call) side by side, so the channel
 * a line came from can hint at who said it. Stored as interleaved 16-bit little-endian.
 */
export const TRANSCRIPTION_SAMPLE_RATE = 16_000;

/** Above this the mix is bent smoothly toward 1 instead of clipping. */
const KNEE = 0.8;

export interface TwoChannels {
  readonly mic: Float32Array;
  readonly system: Float32Array;
}

export function softClip(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= KNEE) return value;
  const bent = KNEE + (1 - KNEE) * Math.tanh((magnitude - KNEE) / (1 - KNEE));
  return Math.sign(value) * bent;
}

/** The two channels mixed to one track for the recognizer. The shorter channel is padded with silence. */
export function mixChannels(channels: TwoChannels): Float32Array {
  const length = Math.max(channels.mic.length, channels.system.length);
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1) out[index] = softClip((channels.mic[index] ?? 0) + (channels.system[index] ?? 0));
  return out;
}

function toInt16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value));
  return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
}

/** One journal record: mic and system interleaved, 16-bit. Both must be the same length. */
export function packPcm(channels: TwoChannels): Uint8Array {
  if (channels.mic.length !== channels.system.length) throw new RangeError("channels differ in length");
  const out = new Uint8Array(channels.mic.length * 4);
  const view = new DataView(out.buffer);
  for (let index = 0; index < channels.mic.length; index += 1) {
    view.setInt16(index * 4, toInt16(channels.mic[index]!), true);
    view.setInt16(index * 4 + 2, toInt16(channels.system[index]!), true);
  }
  return out;
}

/** Joins journal records back into the two channels. */
export function unpackPcm(records: readonly Uint8Array[]): TwoChannels {
  const frames = records.reduce((sum, record) => sum + Math.floor(record.length / 4), 0);
  const mic = new Float32Array(frames);
  const system = new Float32Array(frames);
  let at = 0;
  for (const record of records) {
    const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
    for (let offset = 0; offset + 4 <= record.length; offset += 4) {
      mic[at] = view.getInt16(offset, true) / 0x8000;
      system[at] = view.getInt16(offset + 2, true) / 0x8000;
      at += 1;
    }
  }
  return { mic, system };
}

/** Root mean square of `samples[from..<to]`. */
export function rms(samples: Float32Array, from = 0, to = samples.length): number {
  const start = Math.max(0, Math.floor(from));
  const end = Math.min(samples.length, Math.ceil(to));
  if (end <= start) return 0;
  let sum = 0;
  for (let index = start; index < end; index += 1) sum += samples[index]! * samples[index]!;
  return Math.sqrt(sum / (end - start));
}

/** Loudness of each channel over `[start, end)` seconds. */
export function channelEnergy(channels: TwoChannels, start: number, end: number): { mic: number; system: number } {
  const from = start * TRANSCRIPTION_SAMPLE_RATE;
  const to = end * TRANSCRIPTION_SAMPLE_RATE;
  return { mic: rms(channels.mic, from, to), system: rms(channels.system, from, to) };
}
