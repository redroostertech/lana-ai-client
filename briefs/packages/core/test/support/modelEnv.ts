import { LanaRuntimeTextModel, type RuntimePurpose } from "../../src/model/index.js";

/**
 * Opt-in real model runs through LANA's runtime: `LANA_RUN_MODEL_TESTS=1
 * LANA_ENGINE_URL=<the local AI engine, for example http://127.0.0.1:8079> LANA_TOKEN=<a LANA session token>`.
 * LANA picks the model (this computer's, or Forge) under the matter's AI policy; set
 * `LANA_MATTER_REF` to run under a matter. The token is read from the environment only.
 */
export const RUN_MODEL_TESTS = process.env["LANA_RUN_MODEL_TESTS"] === "1";

export async function realModel(purpose: RuntimePurpose = "briefs.notes"): Promise<LanaRuntimeTextModel> {
  const base = process.env["LANA_ENGINE_URL"];
  const token = process.env["LANA_TOKEN"];
  if (base === undefined || token === undefined) throw new Error("set LANA_ENGINE_URL and LANA_TOKEN to run against LANA's runtime");
  const matter = process.env["LANA_MATTER_REF"] ?? null;
  return new LanaRuntimeTextModel({ engineBase: () => base, token: () => token, purpose, matterRef: () => matter, priority: "background" });
}
