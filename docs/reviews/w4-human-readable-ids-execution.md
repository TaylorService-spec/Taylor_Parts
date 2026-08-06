---
artifact_type: review
gate: W4 — Human-readable IDs (customer names) slice
wave: W4
status: Dispatcher surfaces DONE (self-merged, low-risk); technician surface is a protected-boundary finding
date: 2026-08-05
owner: Claude Code
base_commit: b70b6b2 (origin/main)
---

# W4 — Human-readable customer IDs

The `fieldops_wos` Work Order doc carries an **opaque `customerId` and no `customerName`**
(confirmed in-code). Several surfaces rendered `Customer: {customerId}` raw. This slice
replaces that with the customer name (with the id as a fallback — never a blank) **where it
can be resolved repository-only**.

## Done (self-merged — low-risk, behavior-preserving, dispatcher-permitted)

A new reusable hook `hooks/useAccountNames(accountIds) → Map<accountId, name>` (chunked
`documentId() in` getDocs; re-fetches only when the id set changes; denied/unavailable →
unresolved, caller falls back to the id). Wired into the surfaces whose viewers **can** read
`accounts` (admin/dispatcher — `firestore.rules` `accounts` read is `isAdminOrDispatcher()`):

- `modules/dispatcherBoard/DispatcherBoard.jsx` resolves the name map and passes
  `customerNames` into the presentational `WorkOrderQueue` (which stays Firestore-free),
  rendered as `customerNames?.get(wo.customerId) ?? wo.customerId`.
- `modules/workOrders/WorkOrdersList.jsx` resolves inline and renders
  `customerNames.get(wo.customerId) ?? wo.customerId`.

Verified: lint 0 · typecheck 0 · build 0 (393 ms) · node tests 0-fail · component 485/33.
No `firestore.rules`, no migration; fallback preserves prior behavior when a name is
unavailable. This was **self-merged as low-risk Tier-1** (Owner "reduce stops" direction).

## Protected-boundary finding — technician surface (NOT self-fixable)

`modules/technicianDashboard/TechnicianWorkOrderCard.jsx` (and `TechnicianWorkOrderDetail.jsx`)
render the same opaque `Customer: {customerId}`, but the fix is **blocked at a protected
boundary**: technicians are **deliberately denied `accounts` read** (`firestore.rules:1304`,
`isAdminOrDispatcher()` only), and the WO doc has no `customerName`. So `useAccountNames`
cannot be used there — a technician read would be permission-denied.

**The two real options (each a protected boundary, Owner decision):**
1. **Backend denormalization (recommended):** have `createWorkOrder` store `customerName` on
   the `fieldops_wos` doc, so *every* consumer (technician included) shows the name with no
   accounts read. This is the clean, uniform fix — but it's a Cloud Function change +
   backfill/migration for existing docs (Blaze/Functions-gated, issue #15; migration is
   Tier-2/escalation).
2. **Scoped technician `accounts` read (Tier-2 rules):** grant technicians a narrow
   accounts read for their assigned WOs' customers. More rules surface area; less clean than
   (1); still a Tier-2 change.

Left unbuilt pending your decision. The technician card still shows the id (unchanged), which
is honest, just opaque.
