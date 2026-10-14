// FINANCIAL POLICY ADMINISTRATION (DECISIONS #232 Phase 2) -- the PURE helpers behind
// Administration > Company Setup > Financial Policy.
//
// No React, no fetch, no clock. The server is the boundary: every answer this module words -- which companies, which
// actions, why not -- arrives already decided from /operations/finance (readMyFinancialPolicyAuthority, and the
// per-version `yourActions` on readFinancialPolicy / listFinancialPolicyVersions), computed there from the SAME rules the
// commands refuse with. This file only turns codes into words and keeps the editor's choices inside the vocabulary the
// server says it supports. Client-side validation here is a convenience; the server validates again and decides.
import { COGS_RECOGNITION_POINTS, INVENTORY_COST_METHODS, SERIALIZED_COST_METHODS } from "./financialPolicyView.js";

/** The five fields a version carries (functions/src/eosFinance/financialPolicy.ts FINANCIAL_POLICY_FIELDS). */
export const POLICY_FIELDS = Object.freeze([
  "inventoryCostMethod", "serializedInventoryCostMethod", "cogsRecognitionPointId", "freightTreatment", "landedCostTreatment",
]);

export const FIELD_LABELS = Object.freeze({
  inventoryCostMethod: "Interchangeable Inventory Costing",
  serializedInventoryCostMethod: "Serialized Inventory Costing",
  cogsRecognitionPointId: "COGS Recognition Event",
  freightTreatment: "Inbound Freight",
  landedCostTreatment: "Other Landed Costs",
});

const TREATMENT_LABELS = Object.freeze({ EXCLUDED: "Excluded from inventory cost" });

const labelFrom = (list, id) => list.find((x) => x.id === id)?.label ?? null;

/** A value's words, from the client vocabulary mirror (parity-tested against the server's domain module). */
export function choiceLabel(field, id) {
  if (id === null || id === undefined || id === "") return null;
  if (field === "inventoryCostMethod") return labelFrom(INVENTORY_COST_METHODS, id) ?? id;
  if (field === "serializedInventoryCostMethod") return labelFrom(SERIALIZED_COST_METHODS, id) ?? id;
  if (field === "cogsRecognitionPointId") return labelFrom(COGS_RECOGNITION_POINTS, id) ?? id;
  return TREATMENT_LABELS[id] ?? id;
}

/**
 * The editor's options for a field, from what the SERVER says it supports (`supported` on readFinancialPolicy). A
 * recognition point the server marks unavailable is listed DISABLED with its reason -- shown, never hidden.
 */
export function fieldOptions(field, supported) {
  const s = supported ?? {};
  const plain = (ids) => (Array.isArray(ids) ? ids : []).map((id) => ({ id, label: choiceLabel(field, id), available: true, blockedReason: null }));
  if (field === "inventoryCostMethod") return plain(s.inventoryCostMethods);
  if (field === "serializedInventoryCostMethod") return plain(s.serializedCostMethods);
  if (field === "freightTreatment") return plain(s.freightTreatments);
  if (field === "landedCostTreatment") return plain(s.landedCostTreatments);
  return (Array.isArray(s.cogsRecognitionPoints) ? s.cogsRecognitionPoints : []).map((p) => ({
    id: p.id, label: choiceLabel(field, p.id) ?? p.label ?? p.id, available: p.available === true, blockedReason: p.blockedReason ?? null,
  }));
}

/** An empty draft: no default method is ever chosen for anyone. */
export const EMPTY_POLICY = Object.freeze(Object.fromEntries(POLICY_FIELDS.map((f) => [f, ""])));

/** The policy to start an editor from: the draft being edited, else the policy in force (a revision), else empty. */
export function startingPolicy(read) {
  const source = read?.inFlight?.status === "DRAFT" ? read.inFlight.policy : read?.inForce?.policy ?? null;
  if (!source) return { ...EMPTY_POLICY };
  return Object.fromEntries(POLICY_FIELDS.map((f) => [f, typeof source[f] === "string" ? source[f] : ""]));
}

/**
 * CONVENIENCE checks only: every field chosen, and from the supported options. Returns { field: message }. The server
 * re-validates everything (supported methods, recognition availability, unknown fields) and its answer is the one shown.
 */
export function draftProblems(policy, supported) {
  const problems = {};
  for (const field of POLICY_FIELDS) {
    const value = policy?.[field];
    if (!value) { problems[field] = "Choose a value."; continue; }
    const option = fieldOptions(field, supported).find((o) => o.id === value);
    if (!option) problems[field] = "This choice is not supported.";
    else if (!option.available) problems[field] = option.blockedReason ?? "This choice is not available.";
  }
  return problems;
}

export const samePolicy = (a, b) => POLICY_FIELDS.every((f) => (a?.[f] ?? "") === (b?.[f] ?? ""));

export const STATUS_WORDS = Object.freeze({
  DRAFT: { label: "Draft", tone: "info" },
  SUBMITTED: { label: "Submitted for Approval", tone: "attention" },
  APPROVED: { label: "Approved, Awaiting Activation", tone: "attention" },
  REJECTED: { label: "Rejected", tone: "critical" },
  ACTIVE: { label: "Active Version", tone: "positive" },
  SUPERSEDED: { label: "Superseded", tone: "neutral" },
  // #232 Phase 3: final, kept in the history, never in force.
  WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
  CANCELLED: { label: "Approval Cancelled", tone: "neutral" },
});
export const statusWords = (status) => STATUS_WORDS[status] ?? { label: status ?? "Unknown", tone: "unknown" };

export const LOCKED_MESSAGE =
  "An activated version is locked and is never edited. A change is a new draft, submitted, approved and activated. A version scheduled but not yet in effect can still be cancelled.";

/**
 * Words for every refusal code the server can give -- a `reason` on an action the server says is unavailable, or the
 * code of a refused command. The server's own message is always shown beside these words, verbatim.
 */
export const REFUSAL_WORDS = Object.freeze({
  CAPABILITY_REQUIRED: "Your Security Roles do not include this Financial Policy action.",
  RESERVED_CAPABILITY: "Only the Owner Role, or the Administrator, approves and activates financial policy.",
  OUTSIDE_OPERATING_COMPANY_SCOPE: "Your Financial Policy access does not cover this operating company.",
  SEPARATION_OF_DUTIES: "You prepared, edited or submitted this version, so someone else must approve, reject, activate or cancel it.",
  NOT_YOUR_VERSION: "Only someone who prepared, edited or submitted this version can withdraw it.",
  FINANCIAL_POLICY_REPLAY_CONFLICT: "This action is already recorded with a different note or reason. The recorded one stands.",
  FINANCIAL_POLICY_IN_FLIGHT_EXISTS: "This company already has a version in progress. Edit, submit or decide that one first.",
  FINANCIAL_POLICY_NOT_EDITABLE: "This version has left Draft; its content is frozen. A change is a new version.",
  FINANCIAL_POLICY_LOCKED: LOCKED_MESSAGE,
  FINANCIAL_POLICY_NOT_SUBMITTED: "Only a version submitted for approval can be approved or rejected.",
  FINANCIAL_POLICY_NOT_APPROVED: "Only an approved version can be activated.",
  FINANCIAL_POLICY_NOT_WITHDRAWABLE: "Only a draft or a version submitted for approval can be withdrawn. A withdrawn, rejected or cancelled version is final.",
  FINANCIAL_POLICY_NOT_CANCELLABLE: "Only an approved version, or one scheduled but not yet in effect, can be cancelled.",
  FINANCIAL_POLICY_VERSION_NOT_FOUND: "That version no longer exists for this company. Refresh and try again.",
  FINANCIAL_POLICY_INVALID: "The database refused this change as inconsistent with the policy rules.",
  EFFECTIVE_DATE_REQUIRED: "Enter the effective date as a calendar date.",
  EFFECTIVE_DATE_PAST: "The effective date cannot be before the company's business date.",
  EFFECTIVE_DATE_NOT_AFTER_PRIOR: "The effective date must be after the current active version's effective date.",
  REASON_REQUIRED: "A reason is required.",
  METHOD_UNSUPPORTED: "That costing method is not supported.",
  RECOGNITION_UNSUPPORTED: "That COGS recognition event is not supported.",
  RECOGNITION_UNAVAILABLE: "That COGS recognition event is not available yet.",
  TREATMENT_UNSUPPORTED: "That cost treatment is not supported.",
  PROFILE_MALFORMED: "The policy contained a field EOS does not accept.",
  FIELD_NOT_ACCEPTED: "The request contained a field EOS does not accept.",
  INVALID_INPUT: "A required value is missing.",
  CONSOLIDATED_NOT_A_COMPANY: "Consolidated is a reporting view, not an operating company.",
  OPERATING_COMPANY_UNKNOWN: "That is not an active operating company.",
  NOT_CONFIGURED: "The EOS API is not configured for this environment.",
  NOT_SIGNED_IN: "Sign in to reach Financial Policy.",
  UNREACHABLE: "Financial Policy could not be reached. Nothing was changed.",
});

/** The friendly words for one code (an unknown code says so rather than guessing). */
export const refusalWords = (code) => REFUSAL_WORDS[code] ?? "The request could not be completed.";

/** A failed API answer ({ ok: false, code, reason, message }) as { code, words, message } -- the server's code preferred. */
export function describeFailure(res) {
  const code = (res && (res.reason || res.code)) || "INTERNAL";
  return Object.freeze({ code, words: refusalWords(code), message: typeof res?.message === "string" ? res.message : null });
}

export const AUDIT_ACTION_WORDS = Object.freeze({
  "finance.policy.draft.create": "Draft created",
  "finance.policy.draft.edit": "Draft edited",
  "finance.policy.submit": "Submitted for approval",
  "finance.policy.approve": "Approved",
  "finance.policy.reject": "Rejected",
  "finance.policy.activate": "Activated",
  "finance.policy.supersede": "Superseded",
  "finance.policy.withdraw": "Withdrawn",
  "finance.policy.cancel": "Approval cancelled",
});
export const auditActionWords = (action) => AUDIT_ACTION_WORDS[action] ?? action;

/** A Principal in words: "You", its display name, or a short id -- never a guess. */
export function actorWords(principalId, { names = {}, me = null } = {}) {
  if (!principalId) return "—";
  if (me && principalId === me) return "You";
  const name = names?.[principalId];
  return typeof name === "string" && name.trim() !== "" ? name : `Principal ${String(principalId).slice(0, 12)}`;
}

/** An ISO timestamp as a short, stable local date-time (en-US). */
export function when(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isCalendarDate = (v) => typeof v === "string" && ISO_DATE.test(v);
