// EOS NORTH STAR OPERATIONAL PROVIDER — SERVER ONLY.
//
// This transport has no EOS read authority and no write authority. A trusted domain assembler must
// establish the governed fact/evidence/action envelope before this code is called. Keystone returns
// an UNTRUSTED model candidate; the domain-specific EOS verifier remains the final authority on what
// may speak or be recommended.
//
// Current rollout is SYNTHETIC-only because Keystone's central operational data policy is still
// SYNTHETIC-only. There is no external-model fallback here. Remote Keystone ingress is permitted
// only over HTTPS and only with Cloudflare Access machine credentials in addition to Keystone's own
// API-key + tenant authentication. Loopback development remains local and needs no Access token.

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
  | "AI_REMOTE_INGRESS_DENIED"
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

interface OperationalProviderConfig extends KeystoneProviderConfig {
  readonly accessClientId?: string;
  readonly accessClientSecret?: string;
}

const DOMAINS = new Set<OperationalDomain>([
  "WORK_ORDER", "SALES_ORDER", "ACCOUNT", "PARTS", "DISPATCH", "OPPORTUNITY", "SALES_AGREEMENT",
]);

export function assertOperationalEnvelope(request: OperationalInterpretationRequest): void {
  if (!request || request.schemaVersion !== 1) {
    throw new OperationalAIError("AI_OPERATIONAL_ENVELOPE_INVALID", "Operational AI envelope is invalid.");
  }
  if (request.classification !== "SYNTHETIC" || request.synthetic !== true) {
    throw new OperationalAIError("AI_CLASSIFICATION_DENIED", "Operational model interpretation is currently limited to synthetic context.");
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
    throw new OperationalAIError("AI_OPERATIONAL_ACTION_DENIED", "A non-authorized action may not cross the model boundary.");
  }
}

function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1");
  } catch {
    return false;
  }
}

function assertIngressConfig(config: OperationalProviderConfig): void {
  if (isLoopbackEndpoint(config.endpoint)) return;

  let url: URL;
  try {
    url = new URL(config.endpoint);
  } catch {
    throw new OperationalAIError("AI_REMOTE_INGRESS_DENIED", "Remote Keystone ingress configuration is invalid.");
  }
  if (url.protocol !== "https:") {
    throw new OperationalAIError("AI_REMOTE_INGRESS_DENIED", "Remote Keystone ingress requires HTTPS.");
  }
  if (!config.accessClientId || !config.accessClientSecret) {
    throw new OperationalAIError(
      "AI_REMOTE_INGRESS_DENIED",
      "Remote Keystone ingress requires machine-to-machine Access credentials.",
    );
  }
}

export class KeystoneOperationalProvider implements OperationalProvider {
  readonly name = "keystone-operational-private-first";
  private readonly config: OperationalProviderConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OperationalProviderConfig, fetchImpl: typeof fetch = fetch) {
    if (!config?.endpoint) {
      throw new OperationalAIError("AI_NOT_CONFIGURED", "No Keystone gateway endpoint is configured.");
    }
    assertIngressConfig(config);
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async interpret(request: OperationalInterpretationRequest): Promise<OperationalModelCandidate> {
    assertOperationalEnvelope(request);
    const url = `${this.config.endpoint.replace(/\/+$/, "")}/v1/operational/interpret`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-API-Key": this.config.apiKey,
      "X-Tenant-ID": this.config.tenantId,
    };
    if (this.config.accessClientId && this.config.accessClientSecret) {
      headers["CF-Access-Client-Id"] = this.config.accessClientId;
      headers["CF-Access-Client-Secret"] = this.config.accessClientSecret;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, { method: "POST", headers, body: JSON.stringify(request) });
    } catch {
      throw new OperationalAIError("AI_PROVIDER_UNAVAILABLE", "The Keystone operational service could not be reached.");
    }
    if (!response.ok) {
      throw new OperationalAIError("AI_PROVIDER_ERROR", `The Keystone operational service returned ${response.status}.`);
    }
    return (await response.json()) as OperationalModelCandidate;
  }
}

export function operationalProviderFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): OperationalProvider | null {
  const base = keystoneConfigFromEnvironment(environment);
  if (!base) return null;
  const config: OperationalProviderConfig = {
    ...base,
    accessClientId: environment.KEYSTONE_ACCESS_CLIENT_ID,
    accessClientSecret: environment.KEYSTONE_ACCESS_CLIENT_SECRET,
  };
  return new KeystoneOperationalProvider(config, fetchImpl);
}
