import { STANDARD_TONE, TONE_PAD_SECONDS, toneFrequency, tonePayload, toneSymbolCount } from "../../src/tone/index.js";

/**
 * Test-only decoder for a clean, aligned burst straight from `modulateTone` (the real,
 * searching decoder is the phone's Swift `ToneDemodulator`). Goertzel per symbol window.
 */
export function decodeAlignedBurst(samples: Float32Array, payloadBytes: number): Uint8Array | undefined {
  const config = STANDARD_TONE;
  const pad = Math.trunc(config.sampleRate * TONE_PAD_SECONDS);
  const window = config.symbolSamples - 2 * config.guardSamples;
  const symbols: number[] = [];
  const total = config.preamble.length + toneSymbolCount(payloadBytes);
  for (let symbol = config.preamble.length; symbol < total; symbol += 1) {
    const start = pad + symbol * config.symbolSamples + config.guardSamples;
    let best = 0;
    let bestEnergy = -1;
    for (let tone = 0; tone < config.toneCount; tone += 1) {
      const coefficient = 2 * Math.cos((2 * Math.PI * toneFrequency(config, tone)) / config.sampleRate);
      let previous = 0;
      let previous2 = 0;
      for (let index = start; index < start + window; index += 1) {
        const current = (samples[index] ?? 0) + coefficient * previous - previous2;
        previous2 = previous;
        previous = current;
      }
      const energy = previous * previous + previous2 * previous2 - coefficient * previous * previous2;
      if (energy > bestEnergy) {
        bestEnergy = energy;
        best = tone;
      }
    }
    symbols.push(best);
  }
  return tonePayload(symbols);
}
