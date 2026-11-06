/**
 * One-time tool: bring the standalone LANA Briefs app's meetings and phone pairing into the
 * LANA client (Briefs integration plan, 1e). Never shipped; run by hand, once, on the one Mac
 * that ran the standalone app:
 *
 *   npm run briefs:import-standalone -- [--dry-run] [--source <folder> [--keychain-service <name>]] [--user-data <folder>]
 *
 * It runs as the LANA client (the client's app name, so the client's keystore entry and data
 * folder), reads who is signed in to the client, and imports into that person's Briefs folder
 * (`<userData>/briefs/people/<key>`) with every safety rule of `importStandalone`. Then it
 * writes `store.imported` to that store's audit log. Quit both apps first.
 *
 * - `--dry-run`: checks everything (the old app closed, its keys open, the same person) and
 *   writes nothing.
 * - `--source <folder>`: a copy of the standalone app's data folder, to try it on a copy
 *   first. Its keystore entry is still the standalone app's: `--keychain-service <name>`
 *   (default `@lana/app Safe Storage`, the app run from source; a packaged one is
 *   `LANA Briefs Safe Storage`).
 * - `--user-data <folder>`: a scratch folder in place of the client's data folder (the
 *   client's sign-in is still read from the client's own folder).
 *
 * Prints the outcome in plain words. Never prints a token, a key, an id or a name.
 */
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { app, safeStorage } from "electron";
import { createSealedFileKeyVault, safeStorageSealer } from "@lana/core/keys";
import { AUDIT_EVENTS, GatewayStore } from "@lana/core/store";
import { importStandalone, standaloneSources, type StandaloneImportOutcome, type StandaloneSource } from "./standaloneImport.js";
import { parseArgs } from "./importStandaloneArgs.js";

const MESSAGES: Record<StandaloneImportOutcome, string> = {
  imported: "Done. Your meetings and phone pairing are now in LANA. Open LANA and your phone will find it as the same computer.",
  ready: "Dry run: everything checks out. Run it again without --dry-run to import.",
  unsupported: "Nothing to do: the standalone Briefs app only ran on macOS.",
  notFound: "Nothing to do: no standalone Briefs data was found on this computer.",
  targetExists: "Nothing to do: this person already has Briefs data in LANA, and the import never overwrites it.",
  running: "The standalone Briefs app is still open. Quit it, then run this again.",
  keyUnavailable: "The standalone app's key was not allowed, or did not open its files. Run it again and choose Allow when macOS asks.",
  otherPerson: "The standalone app was signed in as someone else (or not at all), so nothing was imported.",
  failed: "The import did not finish. Nothing was changed; the standalone app's data is untouched.",
};

/** The password of a macOS keychain item, through the system's `security` tool (no shell). macOS asks the person. */
function readKeychainPassword(service: string): Promise<string | null> {
  return new Promise((done) => {
    execFile("/usr/bin/security", ["find-generic-password", "-s", service, "-w"], { timeout: 120_000 }, (error, stdout) => {
      done(error ? null : String(stdout).replace(/\n$/, "") || null);
    });
  });
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv);
  const root = resolve(__dirname, "..", "..");
  const load = createRequire(join(root, "package.json"));
  const pkg = load("./package.json") as { productName?: string };
  // The client's name: its keystore entry and its data folder.
  app.setName(pkg.productName ?? "Lana AI");
  await app.whenReady();

  const { createTokenStore } = load("./electron-token-store.js") as { createTokenStore(deps: unknown): { get(): string | null } };
  const { authTokenPersistence } = load("./electron-storage.js") as { authTokenPersistence: unknown };
  const { personOf, personKey } = load("./electron-briefs.js") as {
    personOf(token: string | null): { id: string; email: string } | null;
    personKey(token: string | null): string | null;
  };
  const token = createTokenStore({ safeStorage, persistence: authTokenPersistence }).get();
  const person = personOf(token);
  const key = personKey(token);
  if (person === null || key === null) {
    process.stdout.write("Sign in to LANA on this computer first, then run this again.\n");
    return 1;
  }

  const sealer = safeStorageSealer(safeStorage);
  const userData = args.userData ?? app.getPath("userData");
  const target = join(userData, "briefs", "people", key);
  const sources: StandaloneSource[] = args.source === null
    ? standaloneSources(app.getPath("appData"))
    : [{ directory: args.source, keychainService: args.keychainService }];

  const outcome = await importStandalone({
    sources,
    target,
    person,
    readOldKey: readKeychainPassword,
    sealer,
    dryRun: args.dryRun,
  });
  if (outcome === "imported") {
    // The audit log of the store that just arrived records the import (no ids, no names).
    const store = await GatewayStore.open({ directory: join(target, "Lana"), keys: createSealedFileKeyVault({ directory: join(target, "keys"), sealer }) });
    try {
      await store.appendAudit(AUDIT_EVENTS.storeImported, "standalone");
    } finally {
      store.close();
    }
  }
  process.stdout.write(`${MESSAGES[outcome]}\n`);
  return outcome === "imported" || outcome === "ready" || outcome === "notFound" || outcome === "targetExists" || outcome === "unsupported" ? 0 : 1;
}

void main().then(
  (code) => app.exit(code),
  () => {
    process.stdout.write(`${MESSAGES.failed}\n`);
    app.exit(1);
  },
);
