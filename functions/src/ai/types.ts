// AI REQUEST CONTRACT. What an AI call must carry before it is allowed to happen.
//
// ============================ WHY THIS EXISTS SEPARATELY FROM assistant/ ============================
//
// `functions/src/assistant/` owns TRANSPORT and PROVIDER POLICY: which vendor, which model, whether
// a private-only request may leave the building. It answers "who may run this inference".
//
// This module owns CAPABILITY and PURPOSE: which caller, holding which permissions, may ask which
// question of which classification of data. It answers "who may ask this at all".
//
// They are different questions and they fail differently. A provider policy that is correct still
// permits a technician to ask a question only an owner should be able to ask, because the provider
// has no idea who the caller is. Merging the two would mean a single "AI is allowed" flag, and a
// single flag is exactly how a capability boundary gets crossed by accident.
//
// ============================ NO PROVIDER IS TRUSTED FOR BEING AI ============================
//
// An AI provider is a caller like any other. It receives what the requesting user's capabilities
// already permit and nothing more. There is deliberately no "AI service account", no elevated
// context, and no path by which asking through a model returns data that asking directly would not.

/** What a request is for. Purpose is declared by the caller and checked, never inferred. */
export type AIPurpose =
  | "REPOSITORY_INTELLIGENCE"
  // Registered here so the seam is visibly incomplete rather than silently absent. Nothing
  // implements it, and enabling it is a governed decision about operational data.
  | "OPERATIONAL_ANSWER";

/**
 * The classification of the data a request will put in front of a model.
 *
 * `CUSTOMER_DATA` exists in this union so it can be REFUSED by name. Omitting it would make the
 * refusal an accident of the type system rather than a decision anybody wrote down.
 */
export type AIClassification =
  | "REPOSITORY"
  | "SYSTEM_METADATA"
  | "SYNTHETIC"
  | "CUSTOMER_DATA";

/** Classifications that may currently reach a model. Everything else fails closed. */
export const AI_PERMITTED_CLASSIFICATIONS: readonly AIClassification[] = [
  "REPOSITORY",
  "SYSTEM_METADATA",
  "SYNTHETIC",
];

/**
 * Who is asking, and what they already hold.
 *
 * `capabilities` is the set the caller ALREADY has, resolved by the existing access layer before
 * this contract is constructed. Nothing here may add to it. It is `readonly` for that reason: a
 * context that could be extended after authorization is a context that could be authorized as one
 * thing and used as another.
 */
export interface AIRequestContext {
  readonly userId: string;
  readonly tenantId?: string;
  readonly capabilities: readonly string[];
  readonly purpose: AIPurpose;
  readonly classification: AIClassification;
  readonly traceId: string;
}

/** A question about a registered repository source. */
export interface RepositoryAnswerRequest {
  readonly source: string;
  readonly question: string;
  readonly contextBudget?: number;
  readonly pathPrefix?: string;
  readonly pathContains?: string;
  /** Retrieval only: real citations, no generated prose. */
  readonly retrieveOnly?: boolean;
}

/** Where a claim came from. Without all five fields a citation cannot be checked by hand. */
export interface RepositoryCitation {
  readonly repository: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly commitSha: string;
  readonly authorityClass: string;
  readonly precedence: string;
}

/** Two retrieved sources at different precedence describing the same thing. */
export interface AuthorityConflict {
  readonly topic: string;
  readonly higher: Record<string, unknown>;
  readonly lower: Record<string, unknown>;
  readonly note: string;
}

export interface AIVerification {
  readonly passed: boolean;
  readonly checksRun: readonly string[];
  readonly failures: readonly { check: string; detail: string }[];
}

/**
 * `indexState` is not decoration. An answer produced from a STALE index is still useful, and
 * presenting it as current is not -- so the state travels with the answer and the caller decides.
 */
export type AIIndexState = "CURRENT" | "STALE" | "NOT_INDEXED" | "UNKNOWN";

export interface RepositoryAnswerResult {
  readonly answer: string;
  readonly model: string;
  readonly sourceCommit: string | null;
  readonly indexedCommit: string | null;
  readonly indexState: AIIndexState;
  readonly citations: readonly RepositoryCitation[];
  readonly retrievedChunks: number;
  readonly authorityConflicts: readonly AuthorityConflict[];
  readonly verification: AIVerification;
  readonly classification: string;
  readonly latencyMs: number;
}

export type AIErrorCode =
  | "AI_NOT_CONFIGURED"
  | "AI_CAPABILITY_DENIED"
  | "AI_CLASSIFICATION_DENIED"
  | "AI_PURPOSE_UNSUPPORTED"
  | "AI_PROVIDER_UNAVAILABLE"
  | "AI_PROVIDER_ERROR";

export class AIError extends Error {
  readonly code: AIErrorCode;

  constructor(code: AIErrorCode, message: string) {
    super(message);
    this.name = "AIError";
    this.code = code;
  }
}
