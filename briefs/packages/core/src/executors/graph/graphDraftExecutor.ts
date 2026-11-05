import { SILENT_LOG, type HandoffLog } from "../../handoff/log.js";
import { SYSTEM_CLOCK, type Clock } from "../../handoff/ports.js";
import type { Intent } from "../../intent/intent.js";
import { containsWhitespace } from "../../text/whitespace.js";
import type { ActionExecutor } from "../execution/actionExecutor.js";
import { makeActionPlan, type ActionPlan } from "../execution/actionPlan.js";
import { AuthorizedHTTPClient } from "../execution/authorizedHTTPClient.js";
import type { ExecutionResult, UndoToken } from "../execution/executionResult.js";
import { ExecutorError } from "../execution/executorError.js";
import type { IdempotencyLedger } from "../execution/idempotencyLedger.js";
import { MarkerGuardedCreate, type CreatedRecord } from "../execution/markerGuardedCreate.js";
import { jsonRequest } from "../execution/plannedRequest.js";
import type { ResolvedTarget } from "../execution/resolvedTarget.js";
import { arr, obj, optStr, parseResponse, str, type Json } from "../execution/responseJson.js";
import type { RateLimitedClient } from "../http/rateLimitedClient.js";
import type { AccessTokenProvider } from "../oauth/tokenStore.js";
import { parseURL, PATH_SEGMENT_ALLOWED, percentEncode, withQuery } from "../url.js";
import { GraphConfiguration } from "./graphConfiguration.js";

/**
 * email.draft to an Outlook draft via POST /me/messages (Swift `GraphDraftExecutor`).
 * Never sends. Messages do not support transactionId, so the intent id is written to a
 * single-value extended property and a retry filters on it before creating.
 */
export class GraphDraftExecutor implements ActionExecutor {
  readonly kind = "graph.draft" as const;
  private readonly http: AuthorizedHTTPClient;
  private readonly engine: MarkerGuardedCreate;

  constructor(client: RateLimitedClient, tokens: AccessTokenProvider, clock: Clock = SYSTEM_CLOCK, log: HandoffLog = SILENT_LOG) {
    this.http = new AuthorizedHTTPClient(client, tokens, GraphConfiguration.host);
    this.engine = new MarkerGuardedCreate("graph.draft", this.http, clock, (id) => GraphDraftExecutor.messageURL(id), log);
  }

  async plan(intent: Intent, target: ResolvedTarget): Promise<ActionPlan> {
    if (intent.params.type !== "email.draft") throw ExecutorError.unsupportedIntent(intent.type);
    const params = intent.params.email;
    const recipients = target.recipients ?? [];
    if (recipients.length !== params.to.length) throw ExecutorError.unresolvedRecipients(Math.abs(params.to.length - recipients.length));
    const unresolved = recipients.filter((recipient) => !isAddress(recipient.address)).length;
    if (unresolved !== 0) throw ExecutorError.unresolvedRecipients(unresolved);

    const marker: string = intent.id;
    const body = {
      subject: params.subject,
      body: { contentType: "Text", content: params.body },
      toRecipients: recipients.map((recipient) => ({ emailAddress: { address: recipient.address ?? "", name: recipient.displayName } })),
      singleValueExtendedProperties: [{ id: GraphConfiguration.intentPropertyID, value: marker }],
    };
    const to = recipients.map((recipient) => `${recipient.displayName} <${recipient.address ?? ""}>`).join(", ");
    return makeActionPlan({
      executor: this.kind,
      intentID: intent.id,
      idempotencyKey: intent.idempotencyKey,
      marker,
      request: jsonRequest("POST", `${GraphConfiguration.baseURL}/me/messages`, body),
      preview: {
        title: "Save Outlook draft (not sent)",
        fields: [
          { label: "To", value: to.length === 0 ? "No recipients" : to },
          { label: "Subject", value: params.subject },
          { label: "Body", value: params.body },
        ],
      },
    });
  }

  execute(plan: ActionPlan, ledger: IdempotencyLedger): Promise<ExecutionResult> {
    return this.engine.run(
      plan,
      ledger,
      async () => {
        const response = await this.http.get(GraphDraftExecutor.searchURL(plan.marker));
        response.requireSuccess(this.http.client.clock.now());
        const first = arr(obj(parseResponse(response.body), "$")["value"], "$.value").map((item, i) => messageRef(item, `$.value[${i}]`))[0];
        return first;
      },
      (response) => messageRef(parseResponse(response.body), "$"),
    );
  }

  undo(token: UndoToken): Promise<void> {
    return this.engine.undo(token);
  }

  static searchURL(intentID: string): string {
    const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${GraphConfiguration.intentPropertyID}' and ep/value eq '${intentID}')`;
    return withQuery(`${GraphConfiguration.baseURL}/me/messages`, [
      ["$filter", filter],
      ["$select", "id,webLink"],
    ]);
  }

  static messageURL(id: string): string | undefined {
    const escaped = percentEncode(id, PATH_SEGMENT_ALLOWED);
    if (escaped.length === 0) return undefined;
    return `${GraphConfiguration.baseURL}/me/messages/${escaped}`;
  }
}

function messageRef(value: Json, path: string): CreatedRecord {
  const object = obj(value, path);
  return { id: str(object, "id", path), webURL: parseURL(optStr(object, "webLink", path)) };
}

/** One `@` with a non-empty local part, a dot in the domain, and no whitespace character. */
function isAddress(address: string | undefined): boolean {
  if (address === undefined) return false;
  const parts = address.split("@");
  if (parts.length !== 2 || (parts[0] ?? "").length === 0 || !(parts[1] ?? "").includes(".")) return false;
  return !containsWhitespace(address);
}
