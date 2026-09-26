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
//   detail  <- `service.workOrders`. The surface the Work Orders list itself is on
//              (navConfig NAV_SURFACE_ACCESS["service/workOrders"]); the list's rows link to this
//              route, so a principal offered the list is offered the records on it. It is earned by
//              workOrder.create | workOrder.transition | workOrder.lifecycle.dispatch.
//
//   create  <- `service.workOrders` AND `service.dispatch`. NO SURFACE IN THE CATALOG IS EARNED BY
//              workOrder.create ALONE: `service.workOrders` is also earned by workOrder.transition,
//              which the technician Role holds WITHOUT workOrder.create, so gating the wizard on it
//              would open the wizard to principals who cannot create. `service.dispatch` is earned
//              only by workOrder.lifecycle.dispatch, and every Role holding that capability also holds
//              workOrder.create (roleCapabilityAuthorityBaseline.json: admin, dispatcher,
//              fieldManager) -- an invariant the tests pin against the baseline, so a grant that
//              breaks it fails a test instead of silently widening the wizard. This UNDER-grants
//              (office/parts/shop/general/operations roles hold workOrder.create and do not get the
//              wizard) and never over-grants. The complete answer is a create-grained EOS surface,
//              which is a catalog/authorization decision outside this module.
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
/** The additional surface required for the create wizard (see the header for why it is not create-grained). */
export const WORK_ORDER_CREATE_SURFACE = "service.dispatch";

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
    const detail = authority.grants(WORK_ORDER_DETAIL_SURFACE) === true;
    const create = detail && authority.grants(WORK_ORDER_CREATE_SURFACE) === true;
    return Object.freeze({ detail, create });
  }
  const legacy = previewHasPermission("workOrder.create", role, {
    fallback: role === "admin" || role === "dispatcher",
  });
  return Object.freeze({ detail: legacy, create: legacy });
}
