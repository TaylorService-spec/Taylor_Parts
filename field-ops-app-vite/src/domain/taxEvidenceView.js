// TAX EVIDENCE, IN WORDS A SALESPERSON USES (DECISIONS #197; Owner ruling 2026-10-02: unknown tax is not zero tax).
//
// The Agreement records whether its tax was DETERMINED (with an amount -- zero included) or not. This file turns the
// server's evidence state into what a screen says, and turns a person's choice back into the one governed input
// (`taxEvidence`) the bounded draft command accepts. It never computes tax, never names a rate, jurisdiction or provider,
// and never shows the server's vocabulary: a person sees "Tax not yet determined", never a status code.
//
// THREE SENTENCES, AND WHY THE THIRD IS NEUTRAL. An Agreement recorded before evidence existed stored an omitted tax as
// 0, so its number is not a determination. It reads "Tax needs confirmation" -- never "No tax", never "Tax exempt",
// either of which would assert a tax fact nobody established. A view with no evidence at all (an older backend) is
// treated the same way: absence of evidence is not a determination.

import { formatMoneyDisplay } from "./moneyDisplay.js";

export const TAX_CHOICE = Object.freeze({ NOT_DETERMINED: "notDetermined", DETERMINED: "determined" });

export const TAX_EVIDENCE_WORDS = Object.freeze({
  notDetermined: "Tax not yet determined",
  determined: "Tax determined",
  needsConfirmation: "Tax needs confirmation",
});

const NOTE = Object.freeze({
  notDetermined: "This sale cannot be billed until its tax is determined.",
  determinedZero: "Zero tax was determined for this sale — it was not assumed.",
  needsConfirmation: "This agreement was recorded before tax determination was tracked. Confirm its tax before it is billed.",
});

/**
 * What the screen says about the Agreement's tax.
 * @returns {{ kind: "notDetermined"|"determined"|"needsConfirmation", label: string, amountText: string|null, note: string|null, isDetermined: boolean }}
 */
export function taxEvidenceDisplay(view) {
  const status = view?.taxEvidenceStatus ?? null;
  if (status === "DETERMINED" && Number.isSafeInteger(view?.taxMinor) && view.taxMinor >= 0) {
    return {
      kind: "determined",
      label: TAX_EVIDENCE_WORDS.determined,
      amountText: formatMoneyDisplay(view.taxMinor, view.currency),
      note: view.taxMinor === 0 ? NOTE.determinedZero : null,
      isDetermined: true,
    };
  }
  if (status === "NOT_DETERMINED") {
    return { kind: "notDetermined", label: TAX_EVIDENCE_WORDS.notDetermined, amountText: null, note: NOTE.notDetermined, isDetermined: false };
  }
  return { kind: "needsConfirmation", label: TAX_EVIDENCE_WORDS.needsConfirmation, amountText: null, note: NOTE.needsConfirmation, isDetermined: false };
}

/** The control's starting point: the current determination, or NO choice for an Agreement that needs confirmation. */
export function taxEvidenceSeed(view, toMajorText) {
  const shown = taxEvidenceDisplay(view);
  if (shown.kind === "determined") return { choice: TAX_CHOICE.DETERMINED, amount: toMajorText(view.taxMinor) };
  if (shown.kind === "notDetermined") return { choice: TAX_CHOICE.NOT_DETERMINED, amount: "" };
  return { choice: null, amount: "" };
}

/**
 * The person's choice -> the governed `taxEvidence` input, or nothing to send.
 *  - no choice (an Agreement that needs confirmation, left alone) -> nothing: it stays exactly as recorded;
 *  - the same determination the Agreement already carries -> nothing: re-saving terms does not re-record evidence;
 *  - "Tax determined" requires an amount; an empty box is NOT zero -- zero is typed as 0.
 * @returns {{ taxEvidence?: object, error?: string }}
 */
export function taxEvidencePatch(view, { choice, amount }, toMinor) {
  if (choice === null || choice === undefined) return {};
  const current = taxEvidenceDisplay(view);
  if (choice === TAX_CHOICE.NOT_DETERMINED) {
    return current.kind === "notDetermined" ? {} : { taxEvidence: { status: "NOT_DETERMINED" } };
  }
  if (choice !== TAX_CHOICE.DETERMINED) return { error: "Choose whether the tax has been determined." };
  const text = String(amount ?? "").trim();
  if (text === "") return { error: "Enter the determined tax amount. Enter 0 if none is due." };
  const minor = toMinor(text);
  if (minor === null || Number.isNaN(minor) || minor < 0) return { error: "The tax amount must look like 18.50, or 0." };
  if (current.kind === "determined" && view.taxMinor === minor) return {};
  return { taxEvidence: { status: "DETERMINED", amountMinor: minor, currency: view?.currency ?? "USD" } };
}
