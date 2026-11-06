/**
 * Pure audio math for recording in the window: the mix that is AAC encoded (what everyone
 * said, the phone's single track), the 16 kHz copies main transcribes, and the meter levels.
 */

/** Above this the mix bends smoothly toward 1 instead of clipping. */
const KNEE = 0.8;
/** The meter's floor: quieter than this shows as silence. */
const METER_FLOOR_DB = -60;

export function softClip(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= KNEE) return value;
  return Math.sign(value) * (KNEE + (1 - KNEE) * Math.tanh((magnitude - KNEE) / (1 - KNEE)));
}

/** Mic and meeting audio summed into one track. `system` may be absent (meeting audio off). */
export function mix(mic: Float32Array, system: Float32Array | null): Float32Array<ArrayBuffer> {
  const out = new Float32Array(mic.length);
  for (let index = 0; index < mic.length; index += 1) out[index] = softClip(mic[index]! + (system?.[index] ?? 0));
  return out;
}

/** 0 to 1 for a meter: RMS on a decibel scale from -60 dB. */
export function meterLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / samples.length);
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / -METER_FLOOR_DB));
}

/**
 * Turns audio at the context's rate into 16 kHz by averaging each output sample's window of
 * input (a box filter, enough for speech). Keeps the remainder between calls so frames join
 * without gaps; two of these fed the same lengths give the same output lengths.
 */
export class Downsampler {
  private readonly ratio: number;
  private carry = new Float32Array(0);
  private position = 0;

  constructor(from: number, to = 16_000) {
    this.ratio = from / to;
  }

  push(input: Float32Array): Float32Array {
    if (this.ratio === 1) return input.slice();
    const data = new Float32Array(this.carry.length + input.length);
    data.set(this.carry);
    data.set(input, this.carry.length);
    const out: number[] = [];
    while (this.position + this.ratio <= data.length) {
      const start = Math.floor(this.position);
      const end = Math.max(start + 1, Math.floor(this.position + this.ratio));
      let sum = 0;
      for (let index = start; index < end; index += 1) sum += data[index]!;
      out.push(sum / (end - start));
      this.position += this.ratio;
    }
    const consumed = Math.floor(this.position);
    this.carry = data.slice(consumed);
    this.position -= consumed;
    return Float32Array.from(out);
  }
}

/** "12:34" or "1:02:03". */
export function clockText(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}
