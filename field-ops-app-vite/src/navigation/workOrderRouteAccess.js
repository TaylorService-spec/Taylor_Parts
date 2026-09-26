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
// ════════════════════ UNDER THE LEGACY SOURCE: EXACTLY THE PREVIOUS EXPRESSION ════════════════════
//
// Both answers are the previous expression, evaluated once, with the caller's own previewer -- the
// same call, the same arguments, the same fallback. Nothing about a flag-false environment changes.

import { eosNavigationAuthorityFor } from "./navConfig.js";

/** The surface whose holders are offered Work Order records. */
export const WORK_ORDER_DETAIL_SURFACE = "service.workOrders";
/** The additional surface BOTH routes require (see the header: the dispatch authority, never broader). */
export const WORK_ORDER_DISPATCH_SURFACE = "service.dispatch";

/**
 * @param {object}   args
 * @param {object}   args.operationalContext   the shell's context; its `eosNavigationAuthority` decides the source.
 * @param {string?}  args.role                 users/{uid}.role -- read ONLY under the legacy source.
 * @param {Function} args.previewHasPermission App.jsx's previewer -- called ONLY under the legacy source.
 * @returns {{ detail: boolean, create: boolean }}
 */
export function workOrderRouteAccess({ operationalContext, role, previewHasPermission }) {
  const authority = eosNavigationAuthorityFor(operationalContext);
  if (authority) {
    const reach = authority.grants(WORK_ORDER_DETAIL_SURFACE) === true
      && authority.grants(WORK_ORDER_DISPATCH_SURFACE) === true;
    return Object.freeze({ detail: reach, create: reach });
  }
  const legacy = previewHasPermission("workOrder.create", role, {
    fallback: role === "admin" || role === "dispatcher",
  });
  return Object.freeze({ detail: legacy, create: legacy });
}
