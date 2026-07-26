# INV-CONVERGENCE-E Stage A — route authorization matrix (build `73d9e1b`)

Route: `/admin/diagnostics/inventory-parts-parity` (Firebase Hosting site root; operator-only, no navigation entry). Results below are the **Owner-confirmed live verification outcomes** for the build-`73d9e1b` Hosting deployment. Dispatcher credential readiness: **READY** — valid governed dispatcher test authentication confirmed by the Owner out-of-band; **no credential or identity value recorded**. No inference; unverified states are not marked PASS.

| # | State | Expected behavior | Result |
|---|---|---|---|
| A | Signed out | Login screen; diagnostics route/component **not mounted** (app auth, not the component No Access state) | **PASS** (Owner-confirmed) |
| B | Authenticated, no application access | Application-level standard **No access** screen; route/component **not mounted** | **PASS** (Owner-confirmed) |
| C | Authenticated, application access, role not admin/dispatcher | Route **resolves**; component shows its admin/dispatcher-only denial; **Run action unavailable**; **diagnostic data unavailable** | **PASS** (Owner-confirmed) |
| D | Authenticated admin | Diagnostic **renders**; **Run** action visible | **PASS** (Owner-confirmed) |
| E | Authenticated dispatcher | Diagnostic **renders**; **Run** action visible | **PASS** (Owner-confirmed) |

**Matrix status:** complete — A–E all PASS. Admin-only verification alone does not complete the matrix; state E was verified with the READY governed dispatcher test authentication. Firestore Rules unchanged; the involved collections (`parts`, `inventory_transactions`, `reorder_requests`, `reorder_purchase_orders`) are already admin/dispatcher-readable.
