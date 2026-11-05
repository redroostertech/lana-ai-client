/**
 * Physical layer of the acoustic proximity check (Swift `ToneConfiguration`).
 *
 * 16-FSK between 18.5 and 19.4375 kHz at 48 kHz sampling. Each symbol carries 4 bits
 * and lasts 20 ms: a 2 ms raised-cosine ramp each side around a 16 ms analysis window,
 * which gives exactly 62.5 Hz bin spacing for the phone's Goertzel decoder.
 */
export interface ToneConfiguration {
  readonly sampleRate: number;
  readonly baseFrequency: number;
  readonly toneSpacing: number;
  readonly toneCount: number;
  readonly symbolSamples: number;
  readonly guardSamples: number;
  /** Stored as a Float32 in Swift; 0.5 is exact. */
  readonly amplitude: number;
  readonly preamble: readonly number[];
}

export const STANDARD_TONE: ToneConfiguration = Object.freeze({
  sampleRate: 48_000,
  baseFrequency: 18_500,
  toneSpacing: 62.5,
  toneCount: 16,
  symbolSamples: 960,
  guardSamples: 96,
  amplitude: 0.5,
  preamble: Object.freeze([0, 15, 0, 15, 5, 10]),
});

/** Silence on each side of a burst, so the audio device's start-up and tail never clip a symbol. */
export const TONE_PAD_SECONDS = 0.05;

export function toneFrequency(config: ToneConfiguration, symbol: number): number {
  return config.baseFrequency + symbol * config.toneSpacing;
}

export function toneHighestFrequency(config: ToneConfiguration): number {
  return toneFrequency(config, config.toneCount - 1);
}

/** Symbols carrying `payloadBytes` bytes plus the CRC-16 trailer, two per byte. */
export function toneSymbolCount(payloadBytes: number): number {
  return (payloadBytes + 2) * 2;
}

/** Seconds of tone (preamble and data, without padding) for a payload. */
export function toneBurstDuration(config: ToneConfiguration, payloadBytes: number): number {
  return ((config.preamble.length + toneSymbolCount(payloadBytes)) * config.symbolSamples) / config.sampleRate;
}
