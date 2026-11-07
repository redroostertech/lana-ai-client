import type { LanaMatter } from "./lanaClient.js";

/** A matter as the picker shows it (the shared `MatterHit`). */
export interface LanaMatterHit {
  readonly id: string;
  /** Number and client, "00042 Acme Logistics"; client and name, or the name, when LANA has no number. */
  readonly label: string;
  /** The matter name and client, or null when LANA has neither beyond the label. */
  readonly detail: string | null;
}

/** The picker's words for a matter from LANA's search. */
export function matterHitOf(matter: LanaMatter): LanaMatterHit {
  const code = present(matter.code);
  const client = present(matter.clientName);
  const name = present(matter.name);
  const label = code !== null
    ? `${code} ${client ?? name ?? ""}`.trim()
    : client !== null && name !== null ? `${client}: ${name}` : (client ?? name ?? matter.id);
  const parts = [name, client === null ? null : `Client: ${client}`].filter((part): part is string => part !== null);
  return { id: matter.id, label, detail: parts.length === 0 ? null : parts.join(". ") };
}

function present(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}
