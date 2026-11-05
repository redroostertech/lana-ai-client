export const FAILURE_CODES = ["unknown_device", "protocol_version", "attestation_failed", "bundle_rejected", "pairing_rejected", "internal"] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];

export type HandoffErrorCode =
  | "frame_too_large"
  | "malformed_frame"
  | "timed_out"
  | "channel_closed"
  | "unexpected_message"
  | "peer_failed"
  | "unknown_device"
  | "protocol_version"
  | "attestation_failed"
  | "bundle_rejected"
  | "receipt_invalid"
  | "pairing_rejected"
  | "transport";

/** Protocol errors. `detail` carries ids, kinds and reasons only, never content. */
export class HandoffError extends Error {
  override readonly name = "HandoffError";
  /** For `peer_failed`: the failure code the peer sent. */
  readonly peerCode: FailureCode | undefined;

  constructor(readonly code: HandoffErrorCode, readonly detail?: string, peerCode?: FailureCode) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.peerCode = peerCode;
  }
}
