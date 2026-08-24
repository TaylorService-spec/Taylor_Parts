// PROVIDER DIAGNOSTIC. The first workload across the new boundary, chosen to be worth almost nothing.
//
// ============================ WHY A DIAGNOSTIC AND NOT A FEATURE ============================
//
// The thing being proven is the PATH:
//
//   trusted EOS server -> policy -> provider abstraction -> Private AI Gateway -> model -> normalised result
//
// Proving it with a real assistant answer would mean shipping a user-visible feature whose real
// purpose was plumbing, and would put governed customer data across a brand-new boundary on its
// first day. So the first workload reads nothing, writes nothing, and carries a fixed string an
// operator wrote -- which is also why it can be classified NON_BUSINESS_DIAGNOSTIC honestly rather
// than by asserting that some real query happened not to contain anything sensitive.
//
// It is server-only. There is no callable, no route and no client surface: it is invoked from an
// operator script. Adding an HTTP surface would be a deployment and authorization decision, and it
// is not one this diagnostic needs in order to prove what it proves.
//
// ============================ WHAT IT DOES NOT DO ============================
//
// No EOS read, no EOS write, no tool execution, no authority resolution, no retry, and no second
// provider. It runs the policy once and calls whatever the policy named, once.
import type { AiProvider, AiWorkloadClass } from "./aiProvider";
import { AiProviderError } from "./aiProvider";
import type { AiProviderId, AiProviderPolicyConfig, AiProviderSelectionReason } from "./aiProviderPolicy";
import { selectAiProvider } from "./aiProviderPolicy";

/**
 * The prompt. Fixed, operator-authored, and containing no EOS record of any kind.
 *
 * It asks for a short deterministic-ish reply so a human can tell "the model answered" from "the
 * gateway returned an empty string" at a glance.
 */
export const DIAGNOSTIC_SYSTEM_INSTRUCTION =
  "You are responding to an infrastructure connectivity check. Reply with one short sentence "
  + "confirming you received this message. Do not ask questions.";

export const DIAGNOSTIC_USER_MESSAGE =
  "Connectivity check from the EOS AI provider abstraction. Please confirm receipt.";

export interface AiProviderDiagnosticResult {
  readonly status: "OK" | "PROVIDER_UNAVAILABLE" | "NOT_PERMITTED";
  /** Why the policy chose what it chose. Safe for telemetry. */
  readonly selectionReason: AiProviderSelectionReason;
  readonly providerId: AiProviderId | null;
  readonly model: string | null;
  readonly workloadClass: AiWorkloadClass;
  readonly tenantId: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly queueWaitMs: number | null;
  readonly latencyMs: number | null;
  readonly providerRequestId: string | null;
  readonly errorClass: string | null;
  /**
   * Whether the provider returned non-empty text. NOT the text.
   *
   * A diagnostic that echoed the model's reply would be the one place in the system that writes a
   * model response to an operator log, and "it is only the diagnostic" is exactly how a transcript
   * store starts.
   */
  readonly receivedText: boolean;
}

export interface AiProviderDiagnosticDeps {
  readonly policyConfig: AiProviderPolicyConfig;
  /** Built from the id the policy returned. Never a list, never a fallback chain. */
  readonly buildProvider: (providerId: AiProviderId) => AiProvider;
  readonly workloadClass?: AiWorkloadClass;
  readonly tenantId?: string | null;
  readonly correlationId: string;
  readonly maxOutputTokens?: number;
  readonly timeoutMs?: number;
}

export async function runAiProviderDiagnostic(
  deps: AiProviderDiagnosticDeps,
): Promise<AiProviderDiagnosticResult> {
  const workloadClass: AiWorkloadClass = deps.workloadClass ?? "ROUTINE";
  const tenantId = deps.tenantId ?? null;

  // The decision, made once, from configuration only.
  const selection = selectAiProvider(deps.policyConfig, { dataClass: "NON_BUSINESS_DIAGNOSTIC" });
  if (selection.outcome === "UNAVAILABLE") {
    return {
      status: selection.reason === "EXTERNAL_USE_NOT_PERMITTED_FOR_DATA_CLASS"
        || selection.reason === "EXTERNAL_USE_PROHIBITED_BY_POLICY"
        ? "NOT_PERMITTED"
        : "PROVIDER_UNAVAILABLE",
      selectionReason: selection.reason,
      providerId: null, model: null, workloadClass, tenantId,
      inputTokens: null, outputTokens: null, queueWaitMs: null, latencyMs: null,
      providerRequestId: null, errorClass: null, receivedText: false,
    };
  }

  const provider = deps.buildProvider(selection.providerId);
  try {
    const result = await provider.respond({
      messages: [
        { role: "system", content: DIAGNOSTIC_SYSTEM_INSTRUCTION },
        { role: "user", content: DIAGNOSTIC_USER_MESSAGE },
      ],
      maxOutputTokens: deps.maxOutputTokens ?? 64,
      correlationId: deps.correlationId,
      workloadClass,
      ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
    });
    return {
      status: "OK",
      selectionReason: selection.reason,
      providerId: selection.providerId,
      model: result.metadata.model,
      workloadClass,
      tenantId,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      queueWaitMs: result.queueWaitMs ?? null,
      latencyMs: result.latencyMs,
      providerRequestId: result.providerRequestId ?? null,
      errorClass: null,
      receivedText: result.text.trim().length > 0,
    };
  } catch (err) {
    // The provider failed. The policy decision does not get revisited: there is no second attempt
    // and no second provider, which is the invariant this whole package exists to hold.
    return {
      status: "PROVIDER_UNAVAILABLE",
      selectionReason: selection.reason,
      providerId: selection.providerId,
      model: null,
      workloadClass,
      tenantId,
      inputTokens: null, outputTokens: null, queueWaitMs: null, latencyMs: null,
      providerRequestId: null,
      errorClass: err instanceof AiProviderError ? err.code : "UNKNOWN",
      receivedText: false,
    };
  }
}
