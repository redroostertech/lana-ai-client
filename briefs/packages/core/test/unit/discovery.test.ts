import BonjourService from "bonjour-service";
import { describe, expect, it } from "vitest";
import { BonjourAdvertiser, bonjourServiceParts, gatewayServiceName, HANDOFF_SERVICE_TYPE, pairingServiceName, type MdnsResponder } from "../../src/handoff/index.js";
import { makeLanaId, type LanaId } from "../../src/ids/index.js";

describe("Bonjour discovery", () => {
  it("uses the Swift service type and name schemes", () => {
    expect(HANDOFF_SERVICE_TYPE).toBe("_lananotes._tcp");
    expect(bonjourServiceParts()).toEqual({ type: "lananotes", protocol: "tcp" });
    expect(gatewayServiceName("dev_01JCQ8ABCDEFGHJKMNPQRSTVWX" as LanaId)).toBe("Lana-01JCQ8");
    expect(pairingServiceName("dev_01JCQ8ABCDEFGHJKMNPQRSTVWX" as LanaId)).toBe("Lana-Pair-RSTVWX");
    expect(pairingServiceName()).toMatch(/^Lana-Pair-[0-9A-Z]{6}$/);
  });

  it("publishes through the injected responder and withdraws on stop", async () => {
    const published: unknown[] = [];
    let destroyed = false;
    const fake: MdnsResponder = {
      publish: (config) => {
        published.push(config);
        return { on: () => undefined, stop: (callback: () => void) => callback() } as never;
      },
      unpublishAll: (callback) => callback?.(),
      destroy: (callback) => {
        destroyed = true;
        callback?.();
      },
    };
    const advertiser = new BonjourAdvertiser(() => fake);
    const advertisement = advertiser.advertise("Lana-01JCQ8", 52_000);
    expect(published).toEqual([{ name: "Lana-01JCQ8", type: "lananotes", protocol: "tcp", port: 52_000 }]);
    await advertisement.stop();
    await advertiser.stop();
    expect(destroyed).toBe(true);
  });

  // Real multicast on this machine's interfaces. Opt in: some CI sandboxes block mDNS.
  it.runIf(process.env["LANA_TEST_MDNS"] === "1")("is found by an mDNS browser", async () => {
    const name = `Lana-Test-${makeLanaId("device").slice(-6)}`;
    const advertiser = new BonjourAdvertiser();
    advertiser.advertise(name, 52_123);
    const browser = new BonjourService();
    try {
      const found = await new Promise<{ name: string; port: number }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("not found")), 8_000);
        browser.find({ type: "lananotes", protocol: "tcp" }, (service) => {
          if (service.name === name) {
            clearTimeout(timer);
            resolve({ name: service.name, port: service.port });
          }
        });
      });
      expect(found).toEqual({ name, port: 52_123 });
    } finally {
      browser.destroy();
      await advertiser.stop();
    }
  }, 15_000);
});
