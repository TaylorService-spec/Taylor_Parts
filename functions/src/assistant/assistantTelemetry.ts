// AUDIT AND USAGE. What is recorded about an assistant request, and what deliberately is not.
//
// ============================ THE RETENTION DECISION ============================
//
// This does NOT capture full prompts or full responses by default.
//
// A permanent transcript store would accumulate, in one collection, every customer detail, balance
// and work-order note any user ever asked about -- assembled from many authorization decisions,
// retained under none of them, and readable by whoever can read that collection. It would become
// the highest-value and least-governed dataset in the platform, created as a side effect of logging.
//
// What IS recorded answers the questions an operator actually has: who asked, on which surface,
// which tools ran, what was allowed or refused, which records were touched, what it cost, and
// whether it worked. That supports audit, cost control and debugging without building the store.
//
// Turning transcripts on is a separate, explicit privacy/retention decision with its own governance
// -- not a default, and not a flag someone flips to debug an issue.
import type { AiUsage } from "./aiProvider";
import type { ToolAuthorizationResult } from "./assistantAuthorization";

export interface AssistantAuditRecord {
  readonly correlationId: string;
  readonly actorUid: string;
  readonly companyId: string;
  readonly timestampMs: number;
  readonly surface: string;
  readonly route: string;
  /** Type + id of the record in view. NOT its contents. */
  readonly recordRef: { readonly type: string; readonly id: string } | null;
  readonly toolsRequested: readonly string[];
  readonly toolsAllowed: readonly string[];
  readonly toolsDenied: readonly string[];
  readonly recordsAccessed: readonly { readonly type: string; readonly id: string }[];
  readonly provider: string | null;
  readonly model: string | null;
  readonly usage: AiUsage | null;
  readonly latencyMs: number;
  readonly outcome: "ANSWERED" | "NO_PERMITTED_DATA" | "ASSISTANT_UNAVAILABLE";
  readonly errorClass: string | null;
}

export function buildAuditRecord(args: {
  readonly correlationId: string;
  readonly actorUid: string;
  readonly companyId: string;
  readonly timestampMs: number;
  readonly surface: string;
  readonly route: string;
  readonly recordRef: { readonly type: string; readonly id: string } | null;
  readonly decisions: readonly ToolAuthorizationResult[];
  readonly recordsAccessed: readonly { readonly type: string; readonly id: string }[];
  readonly provider: string | null;
  readonly model: string | null;
  readonly usage: AiUsage | null;
  readonly latencyMs: number;
  readonly outcome: AssistantAuditRecord["outcome"];
  readonly errorClass: string | null;
}): AssistantAuditRecord {
  return {
    correlationId: args.correlationId,
    actorUid: args.actorUid,
    companyId: args.companyId,
    timestampMs: args.timestampMs,
    surface: args.surface,
    route: args.route,
    recordRef: args.recordRef,
    toolsRequested: args.decisions.map((d) => d.toolId),
    toolsAllowed: args.decisions.filter((d) => d.decision === "ALLOW").map((d) => d.toolId),
    toolsDenied: args.decisions.filter((d) => d.decision === "DENY").map((d) => d.toolId),
    recordsAccessed: args.recordsAccessed,
    provider: args.provider,
    model: args.model,
    usage: args.usage,
    latencyMs: args.latencyMs,
    outcome: args.outcome,
    errorClass: args.errorClass,
  };
}

/**
 * Usage telemetry, provider-neutral.
 *
 * NO PRICES IN DOMAIN CODE. `estimatedCostUsd` is carried through if an adapter supplied it and is
 * otherwise absent. Embedding a per-1k-token rate here would make a vendor price change a domain
 * code change, and would silently produce wrong cost reports the moment a contract rate differed
 * from a published one.
 */
export interface AssistantUsageRecord {
  readonly provider: string;
  readonly model: string;
  readonly tenantId: string;
  readonly actorUid: string;
  readonly surface: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly requestCount: number;
  readonly latencyMs: number;
  readonly errorClass: string | null;
  readonly estimatedCostUsd?: number;
}

export function buildUsageRecord(audit: AssistantAuditRecord): AssistantUsageRecord | null {
  if (!audit.provider || !audit.model) return null; // nothing was called; nothing to bill
  return {
    provider: audit.provider,
    model: audit.model,
    tenantId: audit.companyId,
    actorUid: audit.actorUid,
    surface: audit.surface,
    inputTokens: audit.usage?.inputTokens ?? 0,
    outputTokens: audit.usage?.outputTokens ?? 0,
    requestCount: 1,
    latencyMs: audit.latencyMs,
    errorClass: audit.errorClass,
    ...(audit.usage?.estimatedCostUsd !== undefined ? { estimatedCostUsd: audit.usage.estimatedCostUsd } : {}),
  };
}

/**
 * Fields that must never appear in an audit or usage record.
 *
 * Asserted by test rather than trusted to review: this is the list that quietly grows when someone
 * adds "just the question" to help with debugging, and each addition is individually defensible.
 */
export const FORBIDDEN_TELEMETRY_FIELDS = Object.freeze([
  "question", "prompt", "messages", "answer", "response", "text",
  "toolResults", "data", "apiKey", "authorization",
] as const);
