import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const core = fileURLToPath(new URL("../core/src/", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@lana\/core$/, replacement: `${core}index.ts` },
      { find: /^@lana\/core\/(.+)$/, replacement: `${core}$1/index.ts` },
    ],
  },
  test: {
    name: "tools",
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
