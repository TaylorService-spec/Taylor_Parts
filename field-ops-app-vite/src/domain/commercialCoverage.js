// Commercial Coverage & Territory — PURE authority model + resolver (capability #15). No I/O, no persistence,
// no React — the canonical SHAPES + a resolver that returns MULTIPLE coverage assignments. This is design-first
// / authority-first: it defines what commercial coverage IS, independent of any surface, and is deliberately
// INERT (injected assignments; nothing here reads Firestore or decides a "winner").
//
// RATIFIED PRINCIPLES (do not collapse):
//  • A TERRITORY is a durable commercial-coverage OBJECT, independent of any salesperson. People are ASSIGNED
//    to coverage; a territory is never "a salesperson".
//  • Coverage resolves to MULTIPLE assignments: resolveCommercialCoverage(...) → coverageAssignments[], never
//    resolveSalesperson(...) → one. Overlapping / split coverage coexists; one assignment never overwrites
//    another.
//  • CHANNEL is configurable reference data (seed RETAIL / NATIONAL_ACCOUNTS / STRATEGIC_ACCOUNTS), NOT a
//    frozen 3-value enum; extra dimensions may exist but stay admin-hidden until enabled.
//  • Coverage can be GEOGRAPHIC (state / state-group / zip-group / future geospatial) OR ACCOUNT / CORPORATE-
//    relationship based, and the two COEXIST (a corporate relationship owner + a local territory salesperson).
//  • Commercial coverage ≠ record owner ≠ sales credit ≠ commission ≠ security permission ≠ Service Territory.
//    This module resolves COVERAGE ONLY. It never returns an owner, a credit split, a commission, or an
//    authorization, and it never picks a single primary — precedence / credit / commission are DEFERRED (a
//    later formal assessment) and must NOT be silently implemented here.
//  • Coverage assignments are EFFECTIVE-DATED: a reassignment tomorrow must not rewrite who covered a context
//    yesterday. The resolver takes an explicit `now` and returns only assignments effective at that instant.

// ── Channel (configurable reference data) ───────────────────────────────────────────────────────────────
// Seed channels for Taylor. Modeled as ref-data objects (id/label/active/hidden), NOT a hardcoded triad, so
// the capability widens by configuration. `hidden` dimensions exist in the model but are not surfaced until an
// authorized Admin enables them (hidden ≠ security).
export const SEED_COMMERCIAL_CHANNELS = Object.freeze([
  { id: "RETAIL", label: "Retail", active: true, hidden: false },
  { id: "NATIONAL_ACCOUNTS", label: "National Accounts", active: true, hidden: false },
  { id: "STRATEGIC_ACCOUNTS", label: "Strategic Accounts", active: true, hidden: false },
]);
export function isConfiguredChannel(channelId, channels = SEED_COMMERCIAL_CHANNELS) {
  return Array.isArray(channels) && channels.some((c) => c && c.active !== false && c.id === channelId);
}

// ── Territory (durable coverage object, independent of salesperson) ──────────────────────────────────────
// Geographic abstraction — capable of state / state-group / zip-group / future geospatial WITHOUT selecting a
// map vendor or building a polygon editor. `kind` drives which `geo` fields apply:
//   STATE / STATE_GROUP → geo.states: ["AZ", "NV", ...]
//   ZIP_GROUP           → geo.zips: exact zips; geo.zipPrefixes: leading-digit micro-territories ("850")
//   GEOSPATIAL          → geo.polygonRef: an opaque reference to a future geometry authority (never resolved here)
export const TERRITORY_KINDS = Object.freeze(["STATE", "STATE_GROUP", "ZIP_GROUP", "GEOSPATIAL"]);

const norm = (v) => (typeof v === "string" ? v.trim().toUpperCase() : null);

// Does a territory cover a location's geography? Pure over the abstraction. GEOSPATIAL is UNRESOLVED here (no
// geometry engine) — it returns false (fail-closed: a geospatial territory cannot be asserted to cover a point
// until a geometry authority exists), never a fabricated hit.
export function territoryCoversLocation(territory, location = {}) {
  if (!territory || typeof territory !== "object") return false;
  const geo = territory.geo ?? {};
  const state = norm(location.state);
  const zip = typeof location.zip === "string" ? location.zip.trim() : (typeof location.zip === "number" ? String(location.zip) : null);
  switch (territory.kind) {
    case "STATE":
    case "STATE_GROUP":
      return Array.isArray(geo.states) && state != null && geo.states.map(norm).includes(state);
    case "ZIP_GROUP": {
      if (zip == null) return false;
      const exact = Array.isArray(geo.zips) && geo.zips.includes(zip);
      const prefixed = Array.isArray(geo.zipPrefixes) && geo.zipPrefixes.some((p) => typeof p === "string" && zip.startsWith(p));
      return exact || prefixed;
    }
    case "GEOSPATIAL":
      return false; // unresolved until a governed geometry authority exists — never fabricate a hit
    default:
      return false;
  }
}

// ── Coverage assignment ─────────────────────────────────────────────────────────────────────────────────
// A person is assigned to a coverage SCOPE with a responsibility label + optional priority + effective dates.
//   assignee       — a Person Assignment (reuses the account-owner shape: assignedToEmployeeId/assignedToUserId
//                    + display snapshot). Coverage assigns PEOPLE; identity resolution is separate.
//   scope.kind     — TERRITORY | ACCOUNT | NAMED_ACCOUNT | CORPORATE | CHANNEL (extensible). A scope may combine
//                    a channel with a geographic/account scope.
//   responsibility — a CONFIGURABLE label (SALESPERSON / AE / TERRITORY_MGR / NATIONAL / STRATEGIC /
//                    RELATIONSHIP_MGR / OVERLAY …) — a display/role label, NOT a new identity and NOT security.
//   priority       — PRIMARY | SECONDARY | OVERLAY: recorded, but the resolver NEVER uses it to drop other
//                    assignments (precedence is deferred). It is preserved evidence, not a winner-picker.
//   effectiveFrom / effectiveTo — ms epoch; effectiveTo null ⇒ open-ended.
export const COVERAGE_SCOPE_KINDS = Object.freeze(["TERRITORY", "ACCOUNT", "NAMED_ACCOUNT", "CORPORATE", "CHANNEL"]);

// Is an assignment effective at `now`? Inclusive from, exclusive to; open-ended when effectiveTo is null.
export function isEffective(assignment, now) {
  if (!assignment || typeof now !== "number") return false;
  const from = typeof assignment.effectiveFrom === "number" ? assignment.effectiveFrom : -Infinity;
  const to = typeof assignment.effectiveTo === "number" ? assignment.effectiveTo : Infinity;
  return from <= now && now < to;
}

// Does one assignment's scope match the commercial context? Pure. Context carries the facts a scope can match:
//   { accountId, corporateAccountIds:[], namedAccountIds:[], channelId, location:{state,zip} } + injected
//   territories (id→Territory) so a TERRITORY scope can test geographic coverage.
function scopeMatches(assignment, context, territoriesById) {
  const scope = assignment?.scope ?? {};
  // A channel constraint on the scope, when present, must match the context channel (AND with the rest).
  if (scope.channelId != null && scope.channelId !== context.channelId) return false;
  switch (scope.kind) {
    case "ACCOUNT":
      return scope.accountId != null && scope.accountId === context.accountId;
    case "NAMED_ACCOUNT":
      return scope.namedAccountId != null && Array.isArray(context.namedAccountIds) && context.namedAccountIds.includes(scope.namedAccountId);
    case "CORPORATE":
      // Corporate relationship coverage: matches when the context's account rolls up to the scoped corporate
      // account (coverage propagates across the relationship even into other geographic territories).
      return scope.corporateAccountId != null && (
        scope.corporateAccountId === context.accountId ||
        (Array.isArray(context.corporateAccountIds) && context.corporateAccountIds.includes(scope.corporateAccountId))
      );
    case "CHANNEL":
      // Pure channel coverage (no geo/account) — the channelId gate above already enforced the match.
      return scope.channelId != null;
    case "TERRITORY": {
      const territory = territoriesById?.[scope.territoryId];
      return territory ? territoryCoversLocation(territory, context.location ?? {}) : false;
    }
    default:
      return false;
  }
}

// THE resolver. Returns ALL coverage assignments that are effective at `now` AND whose scope matches the
// context — geographic AND account/corporate AND channel coverage COEXIST; nothing is dropped. It does NOT
// choose a primary, compute credit/commission, or return an owner. Fail-closed: bad input ⇒ [].
export function resolveCommercialCoverage(context = {}, assignments = [], { now = null, territoriesById = {} } = {}) {
  if (typeof now !== "number" || !Array.isArray(assignments)) return [];
  return assignments.filter((a) => isEffective(a, now) && scopeMatches(a, context, territoriesById));
}

// A convenience projection over the resolved set — HONEST counts by responsibility/priority for a UI, still
// with NO winner. (A surface may show "3 coverage assignments" without any of them being "the" salesperson.)
export function summarizeCoverage(coverageAssignments) {
  const list = Array.isArray(coverageAssignments) ? coverageAssignments : [];
  const byResponsibility = {};
  for (const a of list) {
    const r = a?.responsibility ?? "UNSPECIFIED";
    byResponsibility[r] = (byResponsibility[r] ?? 0) + 1;
  }
  return {
    total: list.length,
    byResponsibility,
    hasPrimary: list.some((a) => a?.priority === "PRIMARY"),
    // deliberately NO single "owner"/"salesperson"/"credit" — those are separate concepts (see header).
  };
}
