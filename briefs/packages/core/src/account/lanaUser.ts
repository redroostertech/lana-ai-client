/** The signed-in person, as LANA's login response describes them. Never logged. */
export interface LanaUser {
  readonly id: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly organizationID: string | null;
  readonly timezone: string | null;
  /** The firm asked this person to change their password. Done in LANA, not here. */
  readonly mustChangePassword: boolean;
}

/** "Alicia Reyes", or the email when LANA has no name on file. */
export function userDisplayName(user: LanaUser): string {
  const name = [user.firstName, user.lastName]
    .map((part) => (part ?? "").trim())
    .filter((part) => part !== "")
    .join(" ");
  return name === "" ? user.email : name;
}
