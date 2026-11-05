import BonjourService from "bonjour-service";
import { makeLanaId, type LanaId } from "../ids/lanaId.js";
import { SILENT_LOG, type HandoffLog } from "./log.js";

/**
 * Bonjour (DNS-SD over mDNS) advertisement the iPhone's `NWBrowser` finds
 * (Swift `HandoffTransport.serviceType`, `HandoffGateway.serviceName`,
 * `PairingViewModel.pairingServiceName`). Uses `bonjour-service`, a pure JavaScript
 * responder on `multicast-dns`, so it runs the same on macOS and Windows with no
 * native add-on and no dependency on Apple's Bonjour service being installed.
 */
export const HANDOFF_SERVICE_TYPE = "_lananotes._tcp";

const SERVICE_SUFFIX_LENGTH = 6;

/** Gateway listener: "Lana-" plus the first six characters of the device id body. */
export function gatewayServiceName(deviceID: LanaId): string {
  const separator = deviceID.indexOf("_");
  const body = separator < 0 ? deviceID : deviceID.slice(separator + 1);
  return `Lana-${body.slice(0, SERVICE_SUFFIX_LENGTH)}`;
}

/** Pairing listener: "Lana-Pair-" plus the last six characters of a fresh device id. */
export function pairingServiceName(fresh: LanaId = makeLanaId("device")): string {
  return `Lana-Pair-${fresh.slice(-SERVICE_SUFFIX_LENGTH)}`;
}

/** `_lananotes._tcp` as bonjour-service wants it: type without the underscore, and the protocol. */
export function bonjourServiceParts(serviceType: string = HANDOFF_SERVICE_TYPE): { type: string; protocol: "tcp" | "udp" } {
  const match = /^_([a-z0-9-]+)\._(tcp|udp)$/.exec(serviceType);
  if (match === null) throw new Error("invalid service type");
  return { type: match[1] as string, protocol: match[2] as "tcp" | "udp" };
}

/** What the advertiser needs from an mDNS responder; injectable for tests. */
export interface MdnsResponder {
  publish(config: { name: string; type: string; protocol: "tcp" | "udp"; port: number; txt?: Record<string, string> }): BonjourService.Service;
  unpublishAll(callback?: () => void): void;
  destroy(callback?: () => void): void;
}

/** One live advertisement. */
export interface Advertisement {
  readonly name: string;
  readonly port: number;
  stop(): Promise<void>;
}

/** Advertises listeners under `_lananotes._tcp` until stopped. */
export class BonjourAdvertiser {
  private responder: MdnsResponder | undefined;
  private readonly log: HandoffLog;

  constructor(private readonly makeResponder: () => MdnsResponder = () => new BonjourService(), log: HandoffLog = SILENT_LOG) {
    this.log = log;
  }

  /** `txt` becomes the service's TXT record (for example the wake flags). */
  advertise(name: string, port: number, txt?: Record<string, string>): Advertisement {
    this.responder ??= this.makeResponder();
    const service = this.responder.publish({ name, ...bonjourServiceParts(), port, ...(txt === undefined || Object.keys(txt).length === 0 ? {} : { txt }) });
    service.on("error", (error: unknown) => this.log.notice("handoff.bonjour.error", { reason: error instanceof Error ? error.name : "unknown" }));
    this.log.info("handoff.bonjour.advertising", { port });
    return {
      name,
      port,
      stop: () =>
        new Promise<void>((resolve) => {
          if (typeof service.stop === "function") service.stop(() => resolve());
          else resolve();
        }),
    };
  }

  /** Withdraws every advertisement (sends goodbye packets) and closes the sockets. */
  stop(): Promise<void> {
    const responder = this.responder;
    this.responder = undefined;
    if (responder === undefined) return Promise.resolve();
    return new Promise((resolve) => responder.unpublishAll(() => responder.destroy(() => resolve())));
  }
}
