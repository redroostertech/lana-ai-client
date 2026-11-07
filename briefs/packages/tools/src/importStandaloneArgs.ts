import { resolve } from "node:path";

/** The import tool's options (see importStandaloneMain.ts). */
export interface Args {
  readonly dryRun: boolean;
  readonly source: string | null;
  readonly keychainService: string;
  readonly userData: string | null;
}

export function parseArgs(argv: readonly string[]): Args {
  const raw = (flag: string): string | null => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1]! : null;
  };
  const folder = (flag: string): string | null => {
    const found = raw(flag);
    return found === null ? null : resolve(found);
  };
  return {
    dryRun: argv.includes("--dry-run"),
    source: folder("--source"),
    keychainService: raw("--keychain-service") ?? "@lana/app Safe Storage",
    userData: folder("--user-data"),
  };
}
