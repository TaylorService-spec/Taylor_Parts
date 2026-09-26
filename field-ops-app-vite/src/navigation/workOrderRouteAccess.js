// WHICH WORK ORDER RECORD ROUTES EXIST FOR THIS SESSION -- /service/work-orders/:workOrderId (detail)
// and /service/work-orders/new (the create wizard). Pure: no React, no network, no Firebase.
//
// ════════════════════ THE DEFECT THIS REPLACES ════════════════════
//
// App.jsx emitted BOTH routes from one expression:
//
//     previewHasPermission("workOrder.create", navRole, { fallback: navRole === "admin" || navRole === "dispatcher" })
//
// Under the EOS navigation source `navRole` is null (Owner ruling F, option B -- the shell supplies no
// Firebase-era role to navigation), so that expression is false for EVERY principal and neither route
// existed for anybody, including a dispatcher whose governed experience grants the Work Orders surface.
// It was also the wrong SHAPE: reading a record was gated on the authority to CREATE one.
//
// ════════════════════ UNDER THE EOS SOURCE: SURFACES, NOTHING ELSE ════════════════════
//
// The EOS experience authority (functions/src/eosOps/experienceAuthority.ts, projected by
// access/experienceContext.js) answers in SURFACE KEYS composed server-side from
// eos_policy.role_capabilities. It carries no capability list and no role, and this module reads
// nothing else. `role` is NEVER read on this branch -- a Firebase role value cannot open, close or
// change either answer.
//
//   detail AND create <- `service.workOrders` AND `service.dispatch` (integration review: fix the
//              guard WITHOUT broadening). `service.dispatch` is earned only by
//              workOrder.lifecycle.dispatch, held by admin, dispatcher and fieldManager
//              (roleCapabilityAuthorityBaseline.json), every one of which also holds workOrder.create
//              and workOrder.record.read -- an invariant the tests pin against the baseline, so a grant
//              that breaks it fails a test instead of silently widening either route. This is the
//              admin/dispatcher-equivalent reach of the legacy gate expressed in EOS surfaces.
//              fieldManager (the service-manager persona) is the one difference: the legacy gate could
//              not name it at all (users/{uid}.role only knows admin/dispatcher/technician), so it is
//              reached here as a holder of the dispatch authority, not as a newly widened role.
//              `service.workOrders` alone is NOT enough: it is also earned by workOrder.transition,
//              which technician, parts and shop Roles hold -- Sprint 2.0.3 deliberately kept those
//              principals off these routes (WorkOrderActions is dispatcher-only in intent).
//
// ════════════════════ OWNER DECISIONS, DELIBERATELY NOT TAKEN HERE ════════════════════
//
//   (a) DETAIL FOR RECORD READERS. Technicians, parts and shop associates hold
//       workOrder.record.read in PostgreSQL. Opening the detail route to them would need a surface
//       earned by that read (the catalog has none) AND a detail page whose actions are not
//       dispatcher-only. Until the Owner rules, they get neither route.
//   (b) A CREATE-GRAINED SURFACE. officeManager, partsAssociate, partsManager, shopAssociate,
//       shopManager, generalManager, operationsManager and owner hold workOrder.create but not the
//       dispatch authority, so they do not get the wizard. A surface earned by workOrder.create
//       alone is a catalog/authorization decision outside this module.
//
// Every non-READY authority (LOADING / REFUSED / UNAVAILABLE) grants no surface, so both are false.
//
// ════════════════════ UNDER THE EOS SOURCE: THE BACKEND MUST ALSO BE USABLE ════════════════════
//
// A granted surface is necessary, not sufficient. A route is only worth emitting if the screen behind
// it can do its job for the principal who reaches it, and today BOTH screens are Firebase-backed and
// gated on the legacy `users/{uid}.role` string, not on anything the EOS experience authority knows:
//
//   detail  WorkOrderDetailPage -> useWorkOrder -> onSnapshot(fieldops_wos/{id}), firestore.rules
//           `match /fieldops_wos` : isAdminOrDispatcher() || own technician -- users/{uid}.role.
//   create  WorkOrderWizard -> accounts picker (rules: isAdminOrDispatcher) -> createWorkOrder callable,
//           which throws permission-denied unless users/{uid}.role is admin|dispatcher
//           (functions/src/createWorkOrder.ts).
//
// A canonical persona the EOS authority grants (e.g. the service manager, Security Role fieldManager)
// has no users/{uid}.role at all, so it would land on a screen that refuses it. That is an unusable
// route, and it is not emitted. The two readiness values below are COMMITTED CONSTANTS, not runtime
// inputs, and default to not-ready: merging this guard exposes NOTHING under the EOS source until the
// cutover change flips a value to WORK_ORDER_EOS_BACKEND.EOS_POSTGRES_ACTIVE in the same commit that
// points the screen at the PostgreSQL authority.
//
//   * Detail-read and create readiness are SEPARATE. They have different backends (a record read vs
//     the create command) and one is never inferred from the other.
//   * Only the exact value EOS_POSTGRES_ACTIVE is ready; any other value, including a typo, is not.
//   * Readiness only ever REMOVES a route. It cannot open one the surfaces do not already grant.
//   * The public guard ignores any caller-supplied readiness: a caller cannot switch the check off
//     (the "caller-controlled bypass" parity defect). Tests exercise the logic through
//     workOrderRouteAccessWithReadiness, which is the same function with the constants injected.
//   * The legacy source never reads readiness -- its answer is exactly the previous expression.
//
// Dependency map and deletion conditions: docs/engineering/work-order-eos-route-dependency-map-2026-09-25.md
//
// ════════════════════ UNDER THE LEGACY SOURCE: EXACTLY THE PREVIOUS EXPRESSION ════════════════════
//
// Both answers are the previous expression, evaluated once, with the caller's own previewer -- the
// same call, the same arguments, the same fallback. Nothing about a flag-false environment changes.

import { eosNavigationAuthorityFor } from "./navConfig.js";

/** The surface whose holders are offered Work Order records. */
export const WORK_ORDER_DETAIL_SURFACE = "service.workOrders";
/** The additional surface BOTH routes require (see the header: the dispatch authority, never broader). */
export const WORK_ORDER_DISPATCH_SURFACE = "service.dispatch";

/** The backing data path a Work Order record route would use for an EOS persona. */
export const WORK_ORDER_EOS_BACKEND = Object.freeze({
  /** Firebase-backed and gated on users/{uid}.role -- NOT usable by an EOS persona. */
  FIREBASE_ROLE_GATED: "FIREBASE_ROLE_GATED",
  /** Served by the governed PostgreSQL Work Order authority -- usable. */
  EOS_POSTGRES_ACTIVE: "EOS_POSTGRES_ACTIVE",
});

/** Detail-read backend. Flip ONLY when the screen reads eos_ops.work_orders through an EOS transport. */
export const WORK_ORDER_RECORD_READ_EOS_BACKEND = WORK_ORDER_EOS_BACKEND.FIREBASE_ROLE_GATED;
/** Create backend. Flip ONLY when the wizard submits to the PostgreSQL create command through an EOS transport. */
export const WORK_ORDER_CREATE_EOS_BACKEND = WORK_ORDER_EOS_BACKEND.FIREBASE_ROLE_GATED;

/** The committed readiness, frozen. Never a runtime input to the public guard. */
export const WORK_ORDER_EOS_BACKEND_READINESS = Object.freeze({
  detail: WORK_ORDER_RECORD_READ_EOS_BACKEND,
  create: WORK_ORDER_CREATE_EOS_BACKEND,
});

const isUsable = (backend) => backend === WORK_ORDER_EOS_BACKEND.EOS_POSTGRES_ACTIVE;

/**
 * @param {object}   args
 * @param {object}   args.operationalContext   the shell's context; its `eosNavigationAuthority` decides the source.
 * @param {string?}  args.role                 users/{uid}.role -- read ONLY under the legacy source.
 * @param {Function} args.previewHasPermission App.jsx's previewer -- called ONLY under the legacy source.
 * @returns {{ detail: boolean, create: boolean }}
 */
export function workOrderRouteAccess({ operationalContext, role, previewHasPermission }) {
  // Deliberately destructures only these three: a `readiness` (or anything else) a caller passes is
  // not read. The committed constants are the only readiness the shell can reach.
  return workOrderRouteAccessWithReadiness({
    operationalContext, role, previewHasPermission, readiness: WORK_ORDER_EOS_BACKEND_READINESS,
  });
}

/**
 * The guard with the backend readiness INJECTED. Exported for tests and for the cutover change to
 * prove the flipped state before flipping it; App.jsx calls workOrderRouteAccess above.
 *
 * @param {object} args  as workOrderRouteAccess, plus
 * @param {{ detail: string, create: string }} args.readiness  WORK_ORDER_EOS_BACKEND values.
 * @returns {{ detail: boolean, create: boolean }}
 */
export function workOrderRouteAccessWithReadiness({ operationalContext, role, previewHasPermission, readiness }) {
  const authority = eosNavigationAuthorityFor(operationalContext);
  if (authority) {
    const reach = authority.grants(WORK_ORDER_DETAIL_SURFACE) === true
      && authority.grants(WORK_ORDER_DISPATCH_SURFACE) === true;
    return Object.freeze({
      detail: reach && isUsable(readiness?.detail),
      create: reach && isUsable(readiness?.create),
    });
  }
  const legacy = previewHasPermission("workOrder.create", role, {
    fallback: role === "admin" || role === "dispatcher",
  });
  return Object.freeze({ detail: legacy, create: legacy });
}
