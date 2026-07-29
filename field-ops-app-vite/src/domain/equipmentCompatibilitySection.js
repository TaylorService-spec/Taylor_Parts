// D6 (Part Detail "Used In Equipment") — PURE, fail-closed view-model for the compatibility section.
// Implements the Owner-approved package docs/implementation-plans/equipment-compatibility-d6-parts-
// catalog-ui.md (OD-A..OD-F). NO I/O, NO Firebase, NO fallback: this module imports nothing and NEVER
// substitutes static catalog names, free-text installed-asset model, Work Order history, reseller
// listings, or a duplicate Part Master for missing compatibility. It maps the D5 read CONTRACT
// (CompatibilityReadResponse) — or a data-source error — to an exhaustive, sanitized section view.
//
// Sanitization (OD-C): the projected view carries ONLY the display allowlist. It NEVER carries
// compatibilityId / equipmentModelId (not displayed), nor any raw provenance, sourceReference,
// capturedBy, contentFingerprint, raw serial values, notes, uniquenessKey, cursor internals, protected
// identifier, or internal error text.

export const VIEW_CAPABILITY = "equipment.compatibility.view";

// Section states — HIDDEN is decided by the capability gate (before any read); the rest are post-read.
export const SECTION_STATES = Object.freeze({
  HIDDEN: "HIDDEN",
  LOADING: "LOADING",
  DENIED: "DENIED",
  UNAVAILABLE: "UNAVAILABLE",
  EMPTY: "EMPTY",
  AVAILABLE: "AVAILABLE",
  DEGRADED: "DEGRADED",
});

// The single capability decision (package §1a). Renders ONLY on an exact
// hasCapability("equipment.compatibility.view") === true; missing / null / non-function / throwing /
// false / a true-for-another-id ALL fail closed to false (=> HIDDEN => zero reads).
export function canViewCompatibility(hasCapability) {
  if (typeof hasCapability !== "function") return false;
  try {
    return hasCapability(VIEW_CAPABILITY) === true;
  } catch {
    return false;
  }
}

const VERIFICATION_STATES = new Set(["UNVERIFIED", "IN_REVIEW", "VERIFIED", "REJECTED", "CONFLICT"]);
const COMPATIBILITY_TYPES = new Set(["DIRECT_FIT", "APPROVED_ALTERNATE", "OPTIONAL_ACCESSORY", "CONSUMABLE"]);
const str = (v) => (typeof v === "string" ? v : null);
const nonNegInt = (v) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);

function projectModel(model) {
  if (model === null || typeof model !== "object") return null;
  return {
    manufacturerName: str(model.manufacturerName) ?? "",
    modelNumber: str(model.modelNumber) ?? "",
    displayName: str(model.displayName) ?? "",
    family: str(model.family),
    subtype: str(model.subtype),
  };
}

// Sanitized, allowlisted projection of ONE relationship. Explicit field-by-field copy — an unknown or
// forbidden field on the input can never pass through. NO compatibilityId / equipmentModelId.
function projectItem(item) {
  const model = projectModel(item.model);
  const verificationStatus = VERIFICATION_STATES.has(item.verificationStatus) ? item.verificationStatus : "UNVERIFIED";
  const compatibilityType = COMPATIBILITY_TYPES.has(item.compatibilityType) ? item.compatibilityType : null;
  const ev = item.evidence && typeof item.evidence === "object" ? item.evidence : {};
  const evStatus = ev.status === "OK" || ev.status === "INCOMPLETE" || ev.status === "UNAVAILABLE" ? ev.status : "UNAVAILABLE";
  const windowComplete = ev.windowComplete === true && evStatus === "OK";
  const applicabilityResolved = item.applicabilityResolved === true;
  // operational is authoritative from the service and re-guarded here (defence in depth).
  const operational = item.operational === true && verificationStatus === "VERIFIED" && applicabilityResolved && model !== null && evStatus === "OK";

  // Why a record is NOT operational — used for visible caveats; never upgrades the record.
  const reasons = [];
  if (verificationStatus === "CONFLICT") reasons.push("conflict");
  else if (verificationStatus === "IN_REVIEW") reasons.push("in-review");
  else if (verificationStatus !== "VERIFIED") reasons.push("unverified");
  if (!applicabilityResolved) reasons.push("applicability-unresolved");
  if (model === null) reasons.push("model-unavailable");
  if (evStatus === "INCOMPLETE") reasons.push("evidence-incomplete");
  else if (evStatus === "UNAVAILABLE") reasons.push("evidence-unavailable");

  return {
    model,
    compatibilityType,
    assembly: str(item.assembly),
    installationPosition: str(item.installationPosition),
    quantityRequired: typeof item.quantityRequired === "number" ? item.quantityRequired : null,
    serialApplicabilitySummary: str(item.serialApplicabilitySummary) ?? "",
    verificationStatus,
    applicabilityResolved,
    confidenceLevel: str(item.confidenceLevel) ?? "",
    operational,
    reasons,
    evidence: {
      status: evStatus,
      // Counts are authoritative TOTALS only when the window was fully read; otherwise bounded-window.
      complete: windowComplete,
      supportsCount: nonNegInt(ev.boundedSupportsCount),
      contradictsCount: nonNegInt(ev.boundedContradictsCount),
      strongestSupportingAuthority: str(ev.strongestSupportingAuthority),
    },
  };
}

function projectCounts(windowCounts) {
  const c = windowCounts && typeof windowCounts === "object" ? windowCounts : {};
  return {
    returned: nonNegInt(c.returned),
    operational: nonNegInt(c.operational),
    excludedRejected: nonNegInt(c.excludedRejected),
    malformedOmitted: nonNegInt(c.malformedOmitted),
    evidenceIncomplete: nonNegInt(c.evidenceIncomplete),
  };
}

const emptyPageView = (state) => ({ state, items: [], counts: projectCounts(null), nextCursor: null, hasMore: false });

// Map a SINGLE data-source result to a page view.
//   sourceResult == null            => LOADING
//   { ok:false, code }              => DENIED (permission-denied) | UNAVAILABLE (anything else)
//   { ok:true, response }           => map response.pageDisposition (fail-closed on any unknown shape)
export function buildCompatibilitySectionPage(sourceResult) {
  if (sourceResult === null || sourceResult === undefined) return emptyPageView(SECTION_STATES.LOADING);
  if (typeof sourceResult !== "object") return emptyPageView(SECTION_STATES.UNAVAILABLE);
  if (sourceResult.ok === false) {
    return emptyPageView(sourceResult.code === "permission-denied" ? SECTION_STATES.DENIED : SECTION_STATES.UNAVAILABLE);
  }
  if (sourceResult.ok !== true) return emptyPageView(SECTION_STATES.UNAVAILABLE);
  const r = sourceResult.response;
  if (!r || typeof r !== "object" || !Array.isArray(r.items)) return emptyPageView(SECTION_STATES.UNAVAILABLE);

  const disposition = r.pageDisposition;
  if (disposition === "DENIED") return emptyPageView(SECTION_STATES.DENIED);
  if (disposition === "UNAVAILABLE") return emptyPageView(SECTION_STATES.UNAVAILABLE);
  if (disposition === "EMPTY") return { ...emptyPageView(SECTION_STATES.EMPTY), counts: projectCounts(r.windowCounts) };
  if (disposition !== "AVAILABLE" && disposition !== "DEGRADED") {
    return emptyPageView(SECTION_STATES.UNAVAILABLE); // unknown disposition => fail closed
  }

  const items = r.items.map(projectItem);
  const hasMore = typeof r.nextCursor === "string" && r.nextCursor.length > 0;
  return {
    state: disposition === "DEGRADED" ? SECTION_STATES.DEGRADED : SECTION_STATES.AVAILABLE,
    items,
    counts: projectCounts(r.windowCounts),
    nextCursor: hasMore ? r.nextCursor : null,
    hasMore,
  };
}

// Accumulate pages across "Show more" (OD-A/OD-D). Later-page degradation is STICKY — a clean first page
// followed by a DEGRADED page yields DEGRADED overall; a failed "load more" keeps the prior items and
// surfaces an inline loadMoreError WITHOUT discarding what was shown and WITHOUT claiming completeness.
export function accumulateCompatibilityPages(prev, page) {
  const isListState = page.state === SECTION_STATES.AVAILABLE || page.state === SECTION_STATES.DEGRADED || page.state === SECTION_STATES.EMPTY;

  if (!prev) {
    // First page (or a fresh (re)load).
    return {
      state: page.state,
      items: page.items,
      counts: page.counts,
      degraded: page.state === SECTION_STATES.DEGRADED,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      loadMoreError: null,
    };
  }

  // Subsequent page ("Show more").
  if (!isListState) {
    // The additional fetch failed (LOADING should not reach here; DENIED/UNAVAILABLE do): keep prior
    // items + cursor so the user can retry; never discard, never claim complete.
    return { ...prev, loadMoreError: page.state, hasMore: prev.hasMore };
  }
  const degraded = prev.degraded || page.state === SECTION_STATES.DEGRADED;
  const items = prev.items.concat(page.items);
  return {
    state: degraded ? SECTION_STATES.DEGRADED : (items.length > 0 ? SECTION_STATES.AVAILABLE : SECTION_STATES.EMPTY),
    items,
    counts: page.counts, // latest window's counts (window-scoped, never a global aggregate)
    degraded,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    loadMoreError: null,
  };
}

// A caller may conclude the whole set is shown ONLY when there is no next page.
export function isWholeQueryComplete(accumulated) {
  return !!accumulated && accumulated.hasMore === false && accumulated.loadMoreError === null;
}

// The READ GATE (package §1a): a read is attempted ONLY when the capability is exactly granted AND a
// Part is selected. Every fail-closed capability input (missing / null / non-function / throwing /
// false / true-for-another-id) makes this false ⇒ ZERO reads.
export function shouldAttemptRead(hasCapability, partId) {
  return canViewCompatibility(hasCapability) && typeof partId === "string" && partId.length > 0;
}

// Load one page THROUGH the gate. When the gate is closed it returns { skipped:true } WITHOUT ever
// touching the source — this is the single function the component uses, so the component's zero-read
// guarantee is exactly what these tests exercise. A thrown/rejected source is a fail-closed UNAVAILABLE.
export async function loadCompatibilityPage(source, { hasCapability, partId, cursor = null, limit }) {
  if (!shouldAttemptRead(hasCapability, partId)) return { skipped: true, page: null };
  let res;
  try {
    res = await source.readForPart({ partId, cursor, limit });
  } catch {
    res = { ok: false, code: "unavailable" };
  }
  return { skipped: false, page: buildCompatibilitySectionPage(res) };
}
