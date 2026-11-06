/**
 * The one-time import from the standalone LANA Briefs app (Briefs integration plan, 1e).
 *
 * Before Briefs moved into the LANA client it ran as its own desktop app. This brings that
 * app's meetings and its phone pairing into the person's Briefs folder in the client, so the
 * client is the same computer the person's phone already knows and their meetings carry over.
 *
 * What moves:
 * - this computer's identity (`identity.mac`): the phone's pairing is with it;
 * - the store's data key (`datakey.gateway`) and the store itself (`Lana/`: the database,
 *   audio and recordings, all sealed with that key);
 * - the speech models (`Models/speech`), linked where the disk allows, copied otherwise.
 * What does not: the old app's sign-in, entitlement answer, logs and caches. There is one
 * session now, the client's.
 *
 * The two key files are sealed with the old app's keystore entry (Electron safeStorage),
 * which the client's own entry cannot open. On macOS the client asks the OS for the old
 * entry's password (`readOldKey`; macOS asks the person to allow it), opens the two files
 * with it, and seals them again with the client's own keystore entry.
 *
 * Safety:
 * - the old app's folder is only read, never changed or removed;
 * - it imports only into a person folder that does not exist yet, so it never overwrites;
 * - it refuses while the old app is running (its database could be mid-write);
 * - it imports only the person the old app was signed in as (user id or email), so on a
 *   shared computer nobody receives someone else's meetings;
 * - everything is written to a staging folder first and moved into place in one step;
 * - nothing is logged but the outcome and ids-free states.
 */
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { cpSync, existsSync, linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join, relative } from "node:path";
import { fromBase64 } from "@lana/core/bytes";
import { SealedFileSecretBackend, VAULT_ITEMS, type SecretSealer } from "@lana/core/keys";

/** Where the standalone app kept its data, and its keystore entry. */
export interface StandaloneSource {
  /** Its userData folder. */
  readonly directory: string;
  /** Its macOS keychain item (`<app name> Safe Storage`). */
  readonly keychainService: string;
}

/** The standalone app as it was installed (packaged) or run from source (development). */
export function standaloneSources(appSupport: string): StandaloneSource[] {
  return [
    { directory: join(appSupport, "LANA Briefs"), keychainService: "LANA Briefs Safe Storage" },
    { directory: join(appSupport, "@lana", "app"), keychainService: "@lana/app Safe Storage" },
  ];
}

export interface StandaloneImportOptions {
  readonly sources: readonly StandaloneSource[];
  /** The person's Briefs folder in the client. Imported into only when it does not exist yet. */
  readonly target: string;
  /** The person signed in to the client: the old app must have been signed in as them. */
  readonly person: { readonly id: string; readonly email: string };
  /** The old keystore entry's password, or null when the person did not allow it (or there is none). */
  readonly readOldKey: (keychainService: string) => Promise<string | null>;
  /** The client's own sealer (its safeStorage). */
  readonly sealer: SecretSealer;
  readonly platform?: NodeJS.Platform;
  /** Tests: whether a process id is alive. */
  readonly isAlive?: (pid: number) => boolean;
}

export type StandaloneImportOutcome =
  | "imported"
  /** Not macOS: the standalone app shipped only there. */
  | "unsupported"
  | "notFound"
  /** The person's folder already exists: nothing is overwritten. */
  | "targetExists"
  /** The old app is open; try again after it quits. */
  | "running"
  /** The person did not allow the old keystore entry, it is gone, or it does not open the old files. */
  | "keyUnavailable"
  /** The old app was signed in as someone else, or not at all. */
  | "otherPerson"
  | "failed";

/** The marker an import leaves in the person's folder (no ids, no names). */
export const IMPORT_MARKER = ".imported-from-standalone.json";

const STORE_FOLDER = "Lana";
const SPEECH_FOLDER = join("Models", "speech");

export async function importStandalone(options: StandaloneImportOptions): Promise<StandaloneImportOutcome> {
  if ((options.platform ?? process.platform) !== "darwin") return "unsupported";
  if (existsSync(options.target)) return "targetExists";
  const source = options.sources.find((candidate) => existsSync(join(candidate.directory, "keys", `${VAULT_ITEMS.macIdentity}.sealed`)) && existsSync(join(candidate.directory, STORE_FOLDER)));
  if (source === undefined) return "notFound";
  if (isRunning(source.directory, options.isAlive ?? processAlive)) return "running";

  const password = await options.readOldKey(source.keychainService).catch(() => null);
  if (password === null || password === "") return "keyUnavailable";
  const oldSealer = chromiumMacSealer(password);

  const keys = join(source.directory, "keys");
  const identity = readSealed(join(keys, `${VAULT_ITEMS.macIdentity}.sealed`), oldSealer);
  // The identity is always there: when it does not open, the password is not the old app's.
  if (identity === null) return "keyUnavailable";
  const session = readSealed(join(keys, "secret.lana.session.sealed"), oldSealer);
  if (session === null || !samePerson(session, options.person)) return "otherPerson";
  const dataKey = readSealed(join(keys, `${VAULT_ITEMS.dataKey}.sealed`), oldSealer);
  if (dataKey === null) return "failed";

  const staging = `${options.target}.importing`;
  rmSync(staging, { recursive: true, force: true });
  try {
    mkdirSync(staging, { recursive: true, mode: 0o700 });
    const vault = new SealedFileSecretBackend(join(staging, "keys"), options.sealer);
    await vault.write(VAULT_ITEMS.macIdentity, identity);
    await vault.write(VAULT_ITEMS.dataKey, dataKey);
    cpSync(join(source.directory, STORE_FOLDER), join(staging, STORE_FOLDER), { recursive: true, errorOnExist: true, verbatimSymlinks: false });
    const speech = join(source.directory, SPEECH_FOLDER);
    if (existsSync(speech)) linkOrCopyTree(speech, join(staging, SPEECH_FOLDER));
    writeFileSync(join(staging, IMPORT_MARKER), JSON.stringify({ importedAt: new Date().toISOString(), from: "standalone", audited: false }), { mode: 0o600 });
    mkdirSync(dirname(options.target), { recursive: true });
    renameSync(staging, options.target);
    return "imported";
  } catch {
    rmSync(staging, { recursive: true, force: true });
    return "failed";
  }
}

/**
 * Chromium's safeStorage on macOS (OSCrypt): `v10` then AES-128-CBC with a key derived from
 * the keychain password (PBKDF2-SHA1, salt `saltysalt`, 1003 rounds), IV of 16 spaces. The
 * Briefs vault puts base64 inside it (safeStorageSealer). Opens only; it never seals.
 */
export function chromiumMacSealer(password: string): Pick<SecretSealer, "unseal"> {
  const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  return {
    unseal(sealed: Uint8Array): Uint8Array {
      const bytes = Buffer.from(sealed);
      if (bytes.subarray(0, 3).toString("latin1") !== "v10") throw new Error("not_v10");
      const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
      const text = Buffer.concat([decipher.update(bytes.subarray(3)), decipher.final()]).toString("utf8");
      const plain = fromBase64(text);
      if (plain === null) throw new Error("not_base64");
      return plain;
    },
  };
}

function readSealed(path: string, sealer: Pick<SecretSealer, "unseal">): Uint8Array | null {
  if (!existsSync(path)) return null;
  try {
    return sealer.unseal(new Uint8Array(readFileSync(path)));
  } catch {
    return null;
  }
}

/** The old app's saved session names the same person: the same LANA user id, or the same email. */
function samePerson(sealedSession: Uint8Array, person: { readonly id: string; readonly email: string }): boolean {
  try {
    const session = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(sealedSession)) as { user?: { id?: unknown; email?: unknown } };
    const id = typeof session.user?.id === "string" || typeof session.user?.id === "number" ? String(session.user.id) : "";
    const email = typeof session.user?.email === "string" ? session.user.email.trim().toLowerCase() : "";
    if (id !== "" && id === person.id) return true;
    return email !== "" && email === person.email.trim().toLowerCase();
  } catch {
    return false;
  }
}

/** Chromium's single-instance lock (`SingletonLock` -> `<host>-<pid>`) names a live process on this computer. */
function isRunning(directory: string, isAlive: (pid: number) => boolean): boolean {
  const lock = join(directory, "SingletonLock");
  let target: string;
  try {
    if (!lstatSync(lock).isSymbolicLink()) return false;
    target = readlinkSync(lock);
  } catch {
    return false;
  }
  const dash = target.lastIndexOf("-");
  const host = target.slice(0, dash);
  const pid = Number(target.slice(dash + 1));
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const here = hostname();
  if (host !== here && host !== here.replace(/\.local$/i, "") && `${host}.local` !== here) return true;
  return isAlive(pid);
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Hard links every file (no extra disk, the old folder untouched); copies when linking is not possible. */
function linkOrCopyTree(from: string, to: string): void {
  for (const entry of readdirSync(from, { withFileTypes: true, recursive: true })) {
    const path = join(entry.parentPath, entry.name);
    const destination = join(to, relative(from, path));
    if (entry.isDirectory()) {
      mkdirSync(destination, { recursive: true });
    } else if (entry.isFile()) {
      mkdirSync(dirname(destination), { recursive: true });
      try {
        linkSync(path, destination);
      } catch {
        cpSync(path, destination);
      }
    }
  }
}
