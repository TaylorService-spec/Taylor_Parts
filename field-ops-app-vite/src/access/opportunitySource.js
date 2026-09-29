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
    // Synthetic records carry the governed edit version a real EOS record carries (edit_version starts at 1).
    opportunities: OPPORTUNITY_SCENARIO_FIXTURES.map((o) => ({ editVersion: 1, ...o })),
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
      // THE NAMES NOW ARRIVE, and this line is why they used to not.
      //
      // It read `accountNameById: {}` -- a hard-coded empty map with a comment explaining that names
      // "resolve separately from the canonical Account authority". The reasoning was right and the
      // resolution was never built, so the Customer column of the Sales pipeline rendered an em dash
      // for every Opportunity in the product. The comment described an intention as though it were a
      // mechanism.
      //
      // listOpportunityContext now resolves them server-side, under the server's authority, bounded
      // by DISTINCT accountId (opportunityReadService.ts). Still no Customer PII on the Opportunity
      // projection -- one display name per account, resolved beside it.
      //
      // Defaulted rather than assumed: an older backend that does not send the map yields {}, which
      // is exactly today's behaviour, so a client ahead of its functions degrades to the em dash
      // instead of throwing.
      accountNameById:
        payload.accountNameById && typeof payload.accountNameById === "object" ? payload.accountNameById : {},
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

// GOVERNED read source -- the PostgreSQL Commercial transport (Pass 11 Retail Sales journey). Was the Firebase
// `listOpportunityContext` callable; now POST /commercial/sales `listOpportunities`, the caller's own governed reach,
// bounded at 1000 like the callable it replaces, projected to the same envelope (services/commercialEosAdapters.js).
// No fallback: a refusal is "denied", any other failure "unavailable" -- never "zero opportunities".
export async function governedOpportunitySource({ client } = {}) {
  const [{ commercialApiClient }, { readCommercialList, toLegacyListPayload, legacyErrorStatus }] = await Promise.all([
    import("../services/commercialApiClient.js"),
    import("../services/commercialEosAdapters.js"),
  ]);
  const answer = await readCommercialList(client ?? commercialApiClient, "listOpportunities", { cap: 1000 });
  if (answer.ok) return mapOpportunityReadResult({ ok: true, payload: toLegacyListPayload("opportunity", answer.items, answer.truncated) });
  return mapOpportunityReadResult({ ok: false, errorCode: legacyErrorStatus(answer) });
}

// The default the app uses when no source is explicitly injected -- stays synthetic (test call
// sites and any other `<SalesWorkspace />` mount with no `source` prop keep rendering fixtures
// unchanged). The real production mount (App.jsx) now passes `source={governedOpportunitySource}`
// explicitly, so the synthetic→governed swap happens at the ONE call site that should carry it,
// not by silently changing what every caller (including tests) gets by default.
export const DEFAULT_OPPORTUNITY_SOURCE = syntheticOpportunitySource;
