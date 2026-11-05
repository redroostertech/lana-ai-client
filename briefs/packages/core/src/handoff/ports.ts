import type { DevicePublicKeys } from "../crypto/devicePublicKeys.js";

// What the Mac sessions need from the app shell. The store ports (TrustStore, BundleSink,
// PairingSink, AttestationRecord) are defined once in `../store/interfaces.ts` and
// `../store/types.ts`; the store audits pairings and received bundles itself, inside
// `pairDevice` and `complete`, as the Swift store does.

export interface Clock {
  now(): Date;
}

export const SYSTEM_CLOCK: Clock = { now: () => new Date() };

/** The speaker. Resolves when playback has finished. */
export interface ToneOutput {
  play(samples: Float32Array, sampleRate: number): Promise<void>;
}

/** The Mac's screen and the person at it, during the proximity challenge (Swift `ChallengePresenter`). */
export interface ChallengePresenter {
  showQr(text: string): Promise<void>;
  /** Asks the person at the Mac to approve this phone. False on decline. */
  requestApproval(phone: DevicePublicKeys): Promise<boolean>;
  dismiss(): Promise<void>;
}

/** Shows the six-digit code on the Mac during pairing and returns the person's answer. */
export interface PairingPresenter {
  /** `signal` aborts when the pairing ends first (phone declined, timeout): close the prompt. */
  confirmCode(code: string, phone: DevicePublicKeys, signal: AbortSignal): Promise<boolean>;
}
