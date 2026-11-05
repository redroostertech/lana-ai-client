#!/usr/bin/env node
// The phone app (lana-notes) owns the shared protocol fixtures: the golden
// vectors and the runtime workflow definitions both sides must read the same
// way. The client keeps copies under briefs/fixtures so its tests run on their
// own; this check fails when a copy differs from the phone app's.
//
// Usage: node briefs/scripts/check-shared-fixtures.mjs [path to lana-notes]
// (default: LANA_NOTES_DIR, else ../lana-notes next to this repo).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const briefs = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const notes = resolve(process.argv[2] ?? process.env.LANA_NOTES_DIR ?? join(briefs, "..", "..", "lana-notes"));
if (!existsSync(notes)) {
  console.error(`lana-notes not found at ${notes}. Pass its path or set LANA_NOTES_DIR.`);
  process.exit(2);
}

const pairs = [
  [join(briefs, "fixtures", "golden"), join(notes, "desktop", "fixtures", "golden")],
  [join(briefs, "fixtures", "workflows"), join(notes, "Packages", "LanaNotesKit", "Sources", "LanaRuntime", "Workflows")],
];

function files(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(root, path));
    }
  };
  walk(root);
  return out.sort();
}

const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const problems = [];
for (const [ours, theirs] of pairs) {
  for (const name of new Set([...files(ours), ...files(theirs)])) {
    const left = join(ours, name);
    const right = join(theirs, name);
    if (!existsSync(left)) problems.push(`missing here: ${relative(briefs, left)}`);
    else if (!existsSync(right)) problems.push(`not in lana-notes: ${relative(briefs, left)}`);
    else if (hash(left) !== hash(right)) problems.push(`differs: ${relative(briefs, left)}`);
  }
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("Shared fixtures match lana-notes.");
