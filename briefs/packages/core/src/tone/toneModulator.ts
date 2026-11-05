import { STANDARD_TONE, TONE_PAD_SECONDS, toneFrequency, type ToneConfiguration } from "./toneConfiguration.js";
import { toneSymbols } from "./toneFrame.js";

const TWO_PI = 2 * Math.PI;

/**
 * Mono Float32 PCM for a payload (Swift `ToneModulator.samples(for:)`), sample for sample.
 * Arithmetic follows Swift's order and types: phase in double precision, gains and
 * samples rounded to Float32 where Swift stores a `Float`.
 */
export function modulateTone(payload: Uint8Array, config: ToneConfiguration = STANDARD_TONE): Float32Array {
  const symbols = [...config.preamble, ...toneSymbols(payload)];
  const pad = Math.trunc(config.sampleRate * TONE_PAD_SECONDS);
  const output = new Float32Array(pad * 2 + symbols.length * config.symbolSamples);
  const ramp = new Float32Array(config.guardSamples);
  for (let index = 0; index < config.guardSamples; index += 1) {
    ramp[index] = 0.5 - 0.5 * Math.cos((Math.PI * index) / config.guardSamples);
  }
  const amplitude = Math.fround(config.amplitude);
  let offset = pad;
  let phase = 0;
  for (const symbol of symbols) {
    const step = (TWO_PI * toneFrequency(config, symbol)) / config.sampleRate;
    for (let index = 0; index < config.symbolSamples; index += 1) {
      let gain = amplitude;
      if (index < config.guardSamples) {
        gain = Math.fround(gain * (ramp[index] as number));
      } else if (index >= config.symbolSamples - config.guardSamples) {
        gain = Math.fround(gain * (ramp[config.symbolSamples - 1 - index] as number));
      }
      output[offset] = gain * Math.fround(Math.sin(phase));
      offset += 1;
      phase += step;
      if (phase > TWO_PI) phase -= TWO_PI;
    }
  }
  return output;
}

/** Little-endian Float32 bytes, the layout the golden hashes cover. */
export function toneSamplesLittleEndian(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 4);
  const view = new DataView(out.buffer);
  samples.forEach((sample, index) => view.setFloat32(index * 4, sample, true));
  return out;
}
