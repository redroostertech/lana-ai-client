import { fromHex } from "../../src/bytes/index.js";
import { p256PrivateKeyFromRaw, SoftwareIdentity } from "../../src/crypto/index.js";
import { parseLanaId, type LanaId } from "../../src/ids/index.js";
import { golden } from "../golden/fixtures.js";

interface IdentityFixture {
  device_id: string;
  display_name: string;
  signing_private: string;
  agreement_private: string;
}

function build(fixture: IdentityFixture): SoftwareIdentity {
  return new SoftwareIdentity(
    parseLanaId(fixture.device_id) as LanaId,
    fixture.display_name,
    p256PrivateKeyFromRaw(fromHex(fixture.signing_private)),
    p256PrivateKeyFromRaw(fromHex(fixture.agreement_private)),
  );
}

/** The fixed Mac and phone identities the Swift export used. */
export function goldenIdentities(): { mac: SoftwareIdentity; phone: SoftwareIdentity } {
  const identity = golden<{ mac: IdentityFixture; phone: IdentityFixture }>("identity");
  return { mac: build(identity.mac), phone: build(identity.phone) };
}
