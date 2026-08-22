// THE ANSWER CONTRACT. What a claim is allowed to rest on.
//
// ============================ WHY ANSWERS ARE CLASSIFIED ============================
//
// A confident sentence about a stock balance and a confident sentence about how put-away generally
// works are indistinguishable in prose and completely different in trustworthiness. One is a fact
// EOS retrieved under authorization; the other is the model talking about warehouses.
//
// Operational answers therefore carry a basis, and the honest fourth option is always available:
//
//   KNOWN_FROM_EOS      a governed tool returned it. Traceable to a specific read.
//   DERIVED_FROM_EOS    deterministic inference over permitted tool results ("3 of 5 lines are
//                       short, so the job cannot be completed"). No new facts, only arithmetic.
//   GENERAL_GUIDANCE    explanation not specific to this company's data.
//   UNKNOWN             insufficient PERMITTED data. Not "no data" -- the distinction matters,
//                       because the data may exist and this actor may not see it.
//
// "I don't have enough permitted EOS data to determine that" is a CORRECT answer and is always
// preferable to a plausible one. A fabricated balance is worse than a refusal in every way that
// matters: it is actionable, it is wrong, and nothing downstream will catch it.

export type AnswerBasis = "KNOWN_FROM_EOS" | "DERIVED_FROM_EOS" | "GENERAL_GUIDANCE" | "UNKNOWN";

/**
 * Fact families the model must NEVER produce without a tool result behind them.
 *
 * Chosen by consequence, not by topic: each is something a person would act on immediately. Someone
 * told a part is in stock stops looking for it; someone told an invoice is paid stops chasing it.
 */
export const NEVER_FABRICATE = Object.freeze([
  "inventory balances and availability",
  "work order assignments and schedule",
  "customer history and prior contact",
  "equipment ownership and installed base",
  "order, fulfillment and shipment state",
  "payment, invoice and AR state",
  "who holds what authority",
  "part locations and truck stock",
] as const);

export interface AnswerClaim {
  readonly text: string;
  readonly basis: AnswerBasis;
  /** Tool ids whose results support this claim. Required for KNOWN/DERIVED, empty otherwise. */
  readonly supportingToolIds: readonly string[];
}

export interface AssistantAnswer {
  readonly claims: readonly AnswerClaim[];
  /** Navigation targets the actor is permitted to reach. */
  readonly links: readonly { readonly label: string; readonly route: string }[];
  /** Business-language notes about what was refused. Never names capability ids. */
  readonly refusals: readonly string[];
}

export interface AnswerContractViolation {
  readonly claimText: string;
  readonly reason: string;
}

/**
 * Structural check that an answer respects its own contract.
 *
 * This is NOT hallucination detection -- nothing here can tell whether a number is right. It
 * enforces the weaker, checkable property: a claim asserting EOS fact must NAME the tool it came
 * from, and a tool that was never executed cannot support anything. That turns "the model made it
 * up" from an invisible failure into a structural one.
 */
export function validateAnswerContract(
  answer: AssistantAnswer,
  executedToolIds: readonly string[],
): readonly AnswerContractViolation[] {
  const executed = new Set(executedToolIds);
  const violations: AnswerContractViolation[] = [];

  for (const claim of answer.claims) {
    const needsSupport = claim.basis === "KNOWN_FROM_EOS" || claim.basis === "DERIVED_FROM_EOS";
    if (needsSupport && claim.supportingToolIds.length === 0) {
      violations.push({
        claimText: claim.text,
        reason: `basis ${claim.basis} asserts EOS fact but names no supporting tool`,
      });
      continue;
    }
    for (const toolId of claim.supportingToolIds) {
      if (!executed.has(toolId)) {
        violations.push({
          claimText: claim.text,
          reason: `cites tool "${toolId}", which was not executed for this request`,
        });
      }
    }
    if (!needsSupport && claim.supportingToolIds.length > 0) {
      violations.push({
        claimText: claim.text,
        reason: `basis ${claim.basis} must not cite EOS tools -- it would read as an EOS fact`,
      });
    }
  }
  return violations;
}

/** The refusal used when no permitted data supports an answer. Stated once, used everywhere. */
export const INSUFFICIENT_PERMITTED_DATA =
  "I don't have enough permitted EOS data to determine that.";
