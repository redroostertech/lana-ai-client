/**
 * The organization a person signed in to, as they know it: its name, then its Organization
 * ID. Shown on sign-in, in Settings, on the phone and on the access screen. Never the
 * server's host or domain.
 */
export interface OrganizationLabel {
  readonly name: string;
  /** The Organization ID shown beside the name; null when there is no separate id to show. */
  readonly id: string | null;
}

export const UNNAMED_ORGANIZATION = "Your firm's LANA server";

export function organizationLabel(server: { readonly organizationID: string | null; readonly organizationName: string | null }): OrganizationLabel {
  const name = (server.organizationName ?? "").trim();
  const id = (server.organizationID ?? "").trim();
  if (name !== "" && id !== "" && name !== id) return { name, id };
  if (name !== "") return { name, id: null };
  if (id !== "") return { name: id, id: null };
  return { name: UNNAMED_ORGANIZATION, id: null };
}

/** "Michael Westbrooks (mwestbrooks)", or the id alone when LANA gave no name. */
export function organizationText(server: { readonly organizationID: string | null; readonly organizationName: string | null }): string {
  const label = organizationLabel(server);
  return label.id === null ? label.name : `${label.name} (${label.id})`;
}
