// HTTP
export { HTTPError, type HTTPErrorReason } from "./http/httpError.js";
export { fetchHTTPTransport, type HTTPExchange, type HTTPRequest, type HTTPTransport } from "./http/httpTransport.js";
export { HTTPResponse, parseRetryAfter } from "./http/httpResponse.js";
export { RetryPolicy, type RetryPolicyOptions } from "./http/retryPolicy.js";
export { timerSleeper, type Sleeper } from "./http/sleeper.js";
export { RateLimitConfiguration, TokenBucket } from "./http/tokenBucket.js";
export { RateLimitedClient, type RateLimitedClientOptions } from "./http/rateLimitedClient.js";
// OAuth
export { PKCE } from "./oauth/pkce.js";
export {
  CLIO_REDIRECT_URI, CONNECTOR_ACCOUNTS, MICROSOFT_REDIRECT_URI, OAUTH_CALLBACK_SCHEME, type ConnectorAccount, type OAuthConfiguration,
} from "./oauth/oauthConfiguration.js";
export { OAuthError, type OAuthErrorReason } from "./oauth/oauthError.js";
export { InMemoryTokenStore, vaultTokenStore, type AccessTokenProvider, type TokenStore } from "./oauth/tokenStore.js";
export { formEncode } from "./oauth/formEncoding.js";
export { OAuthClient, type AuthorizationPresenter, type OAuthClientOptions } from "./oauth/oauthClient.js";
// Execution
export {
  EXECUTOR_KINDS, decodeActionPlan, encodeActionPlan, makeActionPlan,
  type ActionPlan, type ActionPreview, type ExecutorKind, type FieldChange, type PreviewField,
} from "./execution/actionPlan.js";
export {
  decodePlannedRequest, encodePlannedRequest, jsonRequest, makePlannedRequest, plannedRequestHash, plannedToHTTP, type PlannedRequest,
} from "./execution/plannedRequest.js";
export {
  UNDO_WINDOW, decodeExecutionResult, decodeUndoToken, encodeExecutionResult, encodeUndoToken, type ExecutionResult, type UndoToken,
} from "./execution/executionResult.js";
export { ExecutorError, ResponseDecodingError, type ExecutorErrorReason } from "./execution/executorError.js";
export {
  InMemoryIdempotencyLedger, LedgerUnreadableResultError, StoreIdempotencyLedger, type IdempotencyLedger, type LedgerEntry, type LedgerState,
} from "./execution/idempotencyLedger.js";
export {
  RESOLVED_ENTITY_KINDS, decodeResolvedTarget, encodeResolvedTarget,
  type ResolvedEntity, type ResolvedEntityKind, type ResolvedRecipient, type ResolvedTarget,
} from "./execution/resolvedTarget.js";
export { AuthorizedHTTPClient } from "./execution/authorizedHTTPClient.js";
export { MarkerGuardedCreate, type CreatedRecord } from "./execution/markerGuardedCreate.js";
export type { ActionExecutor } from "./execution/actionExecutor.js";
// Clio
export { CLIO_REGIONS, clioBaseURL, clioHost, clioOAuthConfiguration, parseClioRegion, type ClioRegion } from "./clio/clioRegion.js";
export type { ClioContact, ClioMarkedRecord, ClioMatter, ClioUser } from "./clio/clioModels.js";
export { ClioClient, type ClioClientOptions } from "./clio/clioClient.js";
export { ClioMarker } from "./clio/clioMarker.js";
export { ClioCandidateSource } from "./clio/clioCandidateSource.js";
export { ClioNoteExecutor } from "./clio/clioNoteExecutor.js";
export { ClioTaskExecutor } from "./clio/clioTaskExecutor.js";
// Graph
export { GraphConfiguration } from "./graph/graphConfiguration.js";
export { GraphDraftExecutor } from "./graph/graphDraftExecutor.js";
// Resolver
export { CANDIDATE_KINDS, decodeCandidate, encodeCandidate, type Candidate, type CandidateKind, type CandidateSource } from "./resolver/candidate.js";
export { MATCH_REASONS, encodeScoredCandidate, type MatchReason, type Resolution, type ScoredCandidate } from "./resolver/resolution.js";
export { NameNormalizer } from "./resolver/nameNormalizer.js";
export { StringSimilarity, type Pairing } from "./resolver/stringSimilarity.js";
export { DEFAULT_THRESHOLDS, EntityResolver, type ResolverThresholds } from "./resolver/entityResolver.js";
