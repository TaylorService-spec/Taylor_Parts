// Coordinated-operations SOURCE seam — the ONE boundary between "where coordinated Work-Order / field-signal
// data comes from" and the projections/hooks/UI above it. PRODUCTION MODULE (2026-08-15 fidelity fix): this
// file contains ONLY the governed (real) source and the explicit "no source wired" inert source. It does
// NOT import synthetic fixtures — that import was the fidelity bug: `Coordinated Visits` and
// `Coordinated Mission` are normal, visible product surfaces, but they defaulted to
// syntheticCoordinatedOperationsSource, presenting synthetic data as real product. The synthetic-data path
// now lives in a SEPARATE module, access/coordinatedOperationsSyntheticSource.js, that only test/story code
// imports — so "the production default is not synthetic" is a structural fact (this file literally has no
// import of that module or of ../data/coordinatedOperationsFixtures.js), not a naming convention.
//
// A source is a plain function (sync) or async function (Promise) returning a snapshot:
//   { status, workOrders, fieldSignalsByWorkOrderId, operationalContextByWorkOrderId,
//     accountNameById, locationNameById, salesOrderLabelById, error }.
//
// status: "ready" (data present, possibly empty) | "denied" (authenticated but not authorized) |
// "unavailable" (read failed / not connected). Kept distinct on purpose — see useCoordinatedOperations.js's
// `loading` handling for the fourth state (in flight).

// Explicitly-empty source for the "no governed source wired yet" state — lets the UI render an honest
// "not connected" surface instead of pretending there are zero coordinated visits. Also a legitimate
// test/story seam in its own right (distinct from the synthetic fixture source).
export function inertCoordinatedOperationsSource() {
  return {
    status: "unavailable",
    synthetic: false,
    workOrders: [],
    fieldSignalsByWorkOrderId: {},
    operationalContextByWorkOrderId: {},
    accountNameById: {},
    locationNameById: {},
    salesOrderLabelById: {},
    error: null,
  };
}

// Pure mapping of the trusted `listCoordinatedOperations` callable's outcome (functions/src/fulfillment/
// coordinatedVisitReadService.ts) into the source snapshot shape. Kept dependency-free/testable — no
// firebase import here; see governedCoordinatedOperationsSource below for the thin callable wiring.
//
// fieldSignalsByWorkOrderId / operationalContextByWorkOrderId / accountNameById / locationNameById /
// salesOrderLabelById are honestly EMPTY here: this governed read serves the two existing pure projections
// (coordinatedVisit.js / coordinatedFieldMission.js) from the real Work Order collection. Parts-readiness,
// scheduling/assignment, and Account/Location name resolution are SEPARATE governed reads not wired by this
// change — never fabricated. Every unit therefore renders with UNKNOWN parts/load readiness (the honest
// F1/F2 default already built into buildCoordinatedFieldMission) until those sources are connected in a
// later cycle, and every id renders via its raw value (the UI's own `nameOr` fallback) until name
// resolution is connected.
export function mapCoordinatedOperationsReadResult({ ok, payload, errorCode } = {}) {
  if (ok && payload && typeof payload === "object") {
    return {
      status: "ready",
      synthetic: false,
      workOrders: Array.isArray(payload.workOrders) ? payload.workOrders : [],
      fieldSignalsByWorkOrderId: {},
      operationalContextByWorkOrderId: {},
      accountNameById: {},
      locationNameById: {},
      salesOrderLabelById: {},
      error: null,
    };
  }
  const denied = errorCode === "permission-denied" || errorCode === "denied";
  return {
    status: denied ? "denied" : "unavailable",
    synthetic: false,
    workOrders: [],
    fieldSignalsByWorkOrderId: {},
    operationalContextByWorkOrderId: {},
    accountNameById: {},
    locationNameById: {},
    salesOrderLabelById: {},
    error: errorCode ?? "unavailable",
  };
}

// GOVERNED read source. Firebase is imported LAZILY (dynamic import) so this module carries no import-time
// initializeApp side effect, mirroring access/opportunitySource.js's governedOpportunitySource. Calls the
// trusted `listCoordinatedOperations` callable; the callable resolves the caller's own authorized scope
// server-side via the `fulfillment.coordinatedVisit.read` capability (registered active:false, granted to
// NO Role — every caller is denied today until a later, separately authorized grant + per-environment
// activation gate, matching inventory.serializedAsset.read's own introduction). Takes no request payload.
export async function governedCoordinatedOperationsSource() {
  try {
    const [{ httpsCallable }, { functions }] = await Promise.all([
      import("firebase/functions"),
      import("../firebase/firebase.js"),
    ]);
    const res = await httpsCallable(functions, "listCoordinatedOperations")({});
    return mapCoordinatedOperationsReadResult({ ok: true, payload: res?.data });
  } catch (err) {
    const raw = err && typeof err.code === "string" ? err.code : "";
    const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
    return mapCoordinatedOperationsReadResult({ ok: false, errorCode: code || "unavailable" });
  }
}

// The default the surfaces use when no source is explicitly injected. UNLIKE the Opportunity/Sales Order
// precedent (access/opportunitySource.js), which keeps a synthetic default and swaps to governed only at
// the App.jsx call site, this default is the GOVERNED source itself — the fidelity violation this change
// fixes was PRECISELY "the default is synthetic on a normal, visible surface," so the fix has to change
// what the default IS, not just what one call site passes. Production (`<CoordinatedVisitsWorkspace />` /
// `<CoordinatedMissionView />`, rendered with no `source` prop in App.jsx) gets the real governed read by
// construction. Tests and stories that want the sample data must explicitly import
// syntheticCoordinatedOperationsSource from coordinatedOperationsSyntheticSource.js and pass it as `source`.
export const DEFAULT_COORDINATED_OPERATIONS_SOURCE = governedCoordinatedOperationsSource;
