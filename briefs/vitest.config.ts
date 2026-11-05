import { defineConfig } from "vitest/config";

// LANA Briefs engine tests (TypeScript, vitest), kept apart from the client's Jest suites.
export default defineConfig({
  test: {
    projects: ["briefs/packages/*"],
  },
});
