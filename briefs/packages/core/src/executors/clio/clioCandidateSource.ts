import type { EntityHint } from "../../intent/entityHint.js";
import type { Candidate, CandidateSource } from "../resolver/candidate.js";
import { NameNormalizer } from "../resolver/nameNormalizer.js";
import type { ClioClient } from "./clioClient.js";

/** Live Clio search as a resolver candidate source (Swift `ClioCandidateSource`). */
export class ClioCandidateSource implements CandidateSource {
  readonly name = "clio";

  constructor(private readonly clio: ClioClient) {}

  async search(hint: EntityHint): Promise<Candidate[]> {
    const query = NameNormalizer.searchQuery(hint.name);
    if (hint.kind === "matter") {
      return (await this.clio.searchMatters(query)).map((matter) => ({
        id: matter.id,
        kind: "matter",
        name: matter.description ?? "",
        displayNumber: matter.displayNumber,
        clientName: matter.client?.name,
        source: this.name,
      }));
    }
    const contacts = await this.clio.searchContacts(query);
    if (hint.email !== undefined && hint.email.length > 0) {
      const byEmail = await this.clio.searchContacts(hint.email);
      contacts.push(...byEmail.filter((found) => !contacts.some((contact) => contact.id === found.id)));
    }
    return contacts.map((contact) => ({
      id: contact.id,
      kind: contact.type === "Company" ? "company" : "person",
      name: contact.name ?? "",
      email: contact.primaryEmailAddress,
      source: this.name,
    }));
  }
}
