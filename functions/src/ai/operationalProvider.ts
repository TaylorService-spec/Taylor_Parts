// EOS NORTH STAR OPERATIONAL PROVIDER — SERVER ONLY.
//
// This transport has no EOS read authority and no write authority. A trusted domain assembler must
// establish the governed fact/evidence/action envelope before this code is called. Keystone returns
// an UNTRUSTED model candidate; the domain-specific EOS verifier remains the final authority on what
// may speak or be recommended.
//
// Current rollout is SYNTHETIC-only because Keystone's central operational data policy is still
// SYNTHETIC-only. There is no external-model fallback here. The configured Keystone endpoint routes
// operational interpretation through the user's private/local model service.

import {
  KeystoneProviderConfig,
  keystoneConfigFromEnvironment,
} from "./provider";

export type OperationalAIErrorCode =
  | "AI_NOT_CONFIGURED"
  | "AI_CLASSIFICATION_DENIED"
  | "AI_OPERATIONAL_ENVELOPE_INVALID"
  | "AI_OPERATIONAL_DOMAIN_UNSUPPORTED"
  | "AI_OPERATIONAL_ACTION_DENIED"
  | "AI_PROVIDER_UNAVAILABLE"
  | "AI_PROVIDER_ERROR";

export class OperationalAIError extends Error {
  readonly code: OperationalAIErrorCode;

  constructor(code: OperationalAIErrorCode, message: string) {
    super(message);
    this.name = "OperationalAIError";
    this.code = code;
  }
}

export type OperationalDomain =
  | "WORK_ORDER"
  | "SALES_ORDER"
  | "ACCOUNT"
  | "PARTS"
  | "DISPATCH"
  | "OPPORTUNITY"
  | "SALES_AGREEMENT";

export interface OperationalEvidenceItem {
  readonly key: string;
  readonly kind: string;
  readonly summary: string;
}

export interface OperationalAllowedRecommendation {
  readonly actionId: string;
  readonly label: string;
  /** DENIED actions never cross this transport. */
  readonly authority: "ALLOWED";
}

export interface OperationalInterpretationRequest {
  readonly schemaVersion: 1;
  readonly classification: "SYNTHETIC";
  readonly synthetic: true;
  readonly source: string;
  readonly domain: OperationalDomain;
  readonly subjectReference?: string | null;
  readonly observedFact: string;
  readonly deterministicInterpretation?: string | null;
  readonly deterministicBusinessConsequence?: string | null;
  readonly evidence: readonly OperationalEvidenceItem[];
  readonly allowedRecommendation?: OperationalAllowedRecommendation | null;
  readonly mode?: "fast" | "deep";
  readonly maxOutputTokens?: number;
}

/** Exactly the untrusted object Keystone may return. Domain verifiers accept/reject it separately. */
export interface OperationalModelCandidate {
  readonly interpretation: string;
  readonly businessConsequence: string;
  readonly confidence: "HIGH" | "MEDIUM" | "LOW";
  readonly confidenceBasis: string;
  readonly evidenceRefs: readonly string[];
  readonly recommendedActionId: string | null;
}

export interface OperationalProvider {
  readonly name: string;
  interpret(request: OperationalInterpretationRequest): Promise<OperationalModelCandidate>;
}

const DOMAINS = new Set<OperationalDomain>([
  "WORK_ORDER",
  "SALES_ORDER",
  "ACCOUNT",
  "PARTS",
  "DISPATCH",
  "OPPORTUNITY",
  "SALES_AGREEMENT",
]);

/**
 * Validate the transport boundary before any network call.
 * This is deliberately NOT a business-authority check: the provider has no authority to establish
 * which facts/actions a caller may see. It only refuses malformed/non-synthetic envelopes and any
 * action that was not already marked ALLOWED by EOS.
 */
export function assertOperationalEnvelope(request: OperationalInterpretationRequest): void {
  if (!request || request.schemaVersion !== 1) {
    throw new OperationalAIError("AI_OPERATIONAL_ENVELOPE_INVALID", "Operational AI envelope is invalid.");
  }
  if (request.classification !== "SYNTHETIC" || request.synthetic !== true) {
    throw new OperationalAIError(
      "AI_CLASSIFICATION_DENIED",
      "Operational model interpretation is currently limited to synthetic context.",
    );
  }
  if (!DOMAINS.has(request.domain)) {
    throw new OperationalAIError("AI_OPERATIONAL_DOMAIN_UNSUPPORTED", "Operational AI domain is unsupported.");
  }
  if (typeof request.source !== "string" || request.source.trim().length === 0 ||
      typeof request.observedFact !== "string" || request.observedFact.trim().length === 0 ||
      !Array.isArray(request.evidence) || request.evidence.length === 0) {
    throw new OperationalAIError("AI_OPERATIONAL_ENVELOPE_INVALID", "Operational AI envelope is incomplete.");
  }
  for (const item of request.evidence) {
    if (!item || typeof item.key !== "string" || !item.key.trim() ||
        typeof item.kind !== "string" || !item.kind.trim() ||
        typeof item.summary !== "string" || !item.summary.trim()) {
      throw new OperationalAIError("AI_OPERATIONAL_ENVELOPE_INVALID", "Operational AI evidence is invalid.");
    }
  }
  const recommendation = request.allowedRecommendation;
  if (recommendation && recommendation.authority !== "ALLOWED") {
    throw new OperationalAIError(
      "AI_OPERATIONAL_ACTION_DENIED",
      "A non-authorized action may not cross the model boundary.",
    );
  }
}

export class KeystoneOperationalProvider implements OperationalProvider {
  readonly name = "keystone-operational-private-first";

  private readonly config: KeystoneProviderConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: KeystoneProviderConfig, fetchImpl: typeof fetch = fetch) {
    if (!config?.endpoint) {
      throw new OperationalAIError("AI_NOT_CONFIGURED", "No Keystone gateway endpoint is configured.");
    }
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async interpret(request: OperationalInterpretationRequest): Promise<OperationalModelCandidate> {
    assertOperationalEnvelope(request);

    const url = `${this.config.endpoint.replace(/\/+$/, "")}/v1/operational/interpret`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.config.apiKey,
          "X-Tenant-ID": this.config.tenantId,
        },
        body: JSON.stringify(request),
      });
    } catch {
      throw new OperationalAIError("AI_PROVIDER_UNAVAILABLE", "The Keystone operational service could not be reached.");
    }

    if (!response.ok) {
      throw new OperationalAIError("AI_PROVIDER_ERROR", `The Keystone operational service returned ${response.status}.`);
    }

    return (await response.json()) as OperationalModelCandidate;
  }
}

/** No endpoint default and no alternate/external provider fallback. */
export function operationalProviderFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): OperationalProvider | null {
  const config = keystoneConfigFromEnvironment(environment);
  return config ? new KeystoneOperationalProvider(config, fetchImpl) : null;
}
