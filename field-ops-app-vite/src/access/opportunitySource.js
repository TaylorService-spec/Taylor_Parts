// Opportunity SOURCE seam — the ONE boundary between "where opportunities come from" and everything above
// it (hooks/projections/UI). Cycle 2 is READ-FIRST on SYNTHETIC fixtures; a governed read model (Firestore
// listener over an `opportunities` collection, or a `listOpportunities` callable) will replace the default
// source later WITHOUT touching the projection or the workspace. A source is a plain function returning a
// snapshot: { status, opportunities, accountNameById, error }. No React here — the hook adapts it.
//
// status: "ready" (data present) | "unavailable" (no source wired / disabled) | "error".
// The synthetic source is the default so the workspace renders today; swapping to governed = pass a
// different source into useOpportunities (or change DEFAULT_OPPORTUNITY_SOURCE) — nothing else changes.

import { OPPORTUNITY_SCENARIO_FIXTURES, OPPORTUNITY_ACCOUNT_NAMES } from "../data/opportunityScenarioFixtures.js";

// Synthetic, in-memory source. Read-only by construction: it returns copies and exposes no writer. Writes
// (Cycle 3+) go through a TRUSTED COMMAND service + governed callable, never through this source.
export function syntheticOpportunitySource() {
  return {
    status: "ready",
    synthetic: true,
    opportunities: OPPORTUNITY_SCENARIO_FIXTURES.map((o) => ({ ...o })),
    accountNameById: { ...OPPORTUNITY_ACCOUNT_NAMES },
    error: null,
  };
}

// An explicitly-empty source for the "no governed source wired yet" state — lets the UI render an honest
// "not connected" surface instead of pretending zero opportunities exist.
export function inertOpportunitySource() {
  return { status: "unavailable", synthetic: false, opportunities: [], accountNameById: {}, error: null };
}

// GOVERNED read seam (Cycle 3c) — pure mapping of the trusted `listOpportunityContext` callable's outcome
// into the source snapshot shape, WITHOUT importing firebase here (kept pure + testable; the thin callable
// wiring lands with activation, since the callable is undeployed today). The trusted backend already returns
// the minimal projection (accountId, no Customer PII, no raw UID), so this maps the four honest states the UI
// must tell apart:
//   • success payload {status:"ready"|"degraded", opportunities} → that status (empty list stays "ready");
//   • a permission-denied error → "denied" (authorized principal lacks the ungranted opportunity.read);
//   • any other error → "unavailable" (read failed / not connected — NOT "zero opportunities").
// accountNameById is intentionally empty: names resolve separately from the canonical Account authority, not
// by copying Customer data into the Opportunity projection.
export function mapOpportunityReadResult({ ok, payload, errorCode } = {}) {
  if (ok && payload && typeof payload === "object") {
    const status = payload.status === "degraded" ? "degraded" : "ready";
    return {
      status,
      synthetic: false,
      opportunities: Array.isArray(payload.opportunities) ? payload.opportunities : [],
      accountNameById: {},
      error: status === "degraded" ? "degraded" : null,
    };
  }
  const denied = errorCode === "permission-denied" || errorCode === "denied";
  return {
    status: denied ? "denied" : "unavailable",
    synthetic: false,
    opportunities: [],
    accountNameById: {},
    error: errorCode ?? "unavailable",
  };
}

// The default the app uses today. Centralized here so the synthetic→governed swap is a one-line change.
// (Governed swap: a thin source that calls `listOpportunityContext` and returns mapOpportunityReadResult(...).
// Deferred to activation because the callable is undeployed and the capability ungranted.)
export const DEFAULT_OPPORTUNITY_SOURCE = syntheticOpportunitySource;
