# Discovery — live sandbox sweep + object gap analysis, 2026-08-20

Against sandbox commit `969305e1` (`environmentId: platform-sandbox`, verified live).

Two methods: a deterministic persona sweep that signs in as each of the 13 sandbox
personas and walks all 38 nav destinations, and a 12-agent read-only object gap analysis
covering all 24 business objects from the CRUD matrix.

**Confidence is stated per item and is not decoration.** Three findings this round were
confidently wrong — in both directions — so each item below says who verified it and how.
Nothing marked `agent-only` should be acted on before it is checked.

---

## 0. What the deploy fixed (verified live, closed)

| | evidence |
|---|---|
| Customers page loads | 2 customers render; was failing for 9 of 13 personas |
| `/equipment` 403 for owner + admin | gone |
| `/inventory/receiving` | renders Receiving, not `Unknown part "receiving"` |
| admin holds full catalog | 6 previously-denied ids resolve `true` via `resolveEffectiveAccessCallable` |
| Rail leaf alignment | merged (#1339) |

Persona sweep went **73 → 36 findings**; owner and admin now clean across all 38
destinations. The 36 remaining are all HTTP 403s on capability-gated callables for
non-admin roles — expected under the role/permission split, not defects in themselves.

---

## 1. THE ROOT CAUSE — 47 legacy authorization sites (verified directly)

`functions/src/access/legacyAuthorizationSurface.ts` is a measured, CI-enforced inventory
of every place `firestore.rules` still resolves authorization from the legacy
`users/{uid}.role` field instead of the governed capability model.
`functions/test/legacyAuthorizationSurface.test.mjs` re-parses the real rules and fails if
the count drifts, so this surface cannot silently grow.

**47 call sites across 22 collections.**

| cutover row | sites | collections |
|---|---:|---|
| row23 — CRM | 9 | accounts (5), locations (2), contacts (2) |
| row24 — Inventory/Purchasing | 26 | reorder_requests (10), reorder_purchase_orders (2), purchase_order_voids (2), inventory_actions (2), inventory_transactions, parts, warehouses, stock_locations, transfer_orders, mobile_locations, trucks, suppliers, supplier_catalog, purchase_orders |
| row25 — Service | 11 | fieldops_jobs (3), fieldops_technicians (3), equipment (3), fieldops_wos (2) |
| unassigned | 1 | employees |

**15 of the 22 collections have NO capability id defined to take over**: locations,
contacts, parts, warehouses, stock_locations, transfer_orders, mobile_locations, trucks,
suppliers, supplier_catalog, purchase_orders, fieldops_jobs, fieldops_technicians,
equipment, employees. For those the cutover cannot even be scheduled until the ids exist.

### Why this is the headline

Nearly every "role X cannot reach its own screen" finding is one of these 47:

- Owner ruling *"they all should see accounts"* — granted in capabilities, **ignored by
  Rules and nav** → accounts, 5 sites, row23
- Owner ruling *"Purchasing falls under accounting"* — implemented correctly in the
  capability layer, **currently produces no observable effect** → reorder_requests, 10
  sites, row24
- `warehouseManager` / `warehouseAssociate` cannot do warehouse work → parts, warehouses,
  stock_locations, transfer_orders (all zero capability coverage)
- Locations and Contacts unreachable for any governed role → row23
- Equipment is Rules-only → row25

A capability grant today changes what a *callable* will do. It does not change what Rules
allow or what navigation shows, because those two still read a field that only knows
`admin`, `dispatcher`, and `technician`.

---

## 2. Test fixtures make the gap invisible (verified live)

Every sandbox persona's `users/{uid}.role` is one of three values:

| persona | legacy role |
|---|---|
| owner, admin | `admin` |
| dispatcher, salesManager, salesperson, accountingManager, fieldManager, operationsManager | `dispatcher` |
| technician, warehouseManager, partsManager, partsAssociate, restricted | `technician` |

So the 13 personas are **three identities wearing thirteen names** at the Rules/nav layer.

The capability layer is *not* affected — verified by a decisive test: `salesManager`
resolves `false` for `workOrder.create` (which `dispatcher` holds) and `true` for
`account.record.read` (which the governed salesManager role grants). The governed
assignment is real and correctly scoped.

**Consequence:** persona testing cannot detect a Rules/nav authorization gap, because
every persona already passes those checks as admin/dispatcher/technician. This is why the
sweep looked clean where the agents found real exclusions.

**`operationsManager` is the exception** — it resolves `false` for *every* capability
including `account.record.read`, which its role definition grants. Same grant as
salesManager, different outcome, so that persona has **no governed role assignment at
all**. Requires a granted assignment (protected action).

---

## 3. Independent items (not part of the cutover)

| # | item | severity | confidence |
|---|---|---|---|
| 3.1 | `inventory_actions.createdBy` is a client-supplied value never checked against `request.auth.uid`; the create rule has no field-level validation. An audit-trail object whose attribution is not trustworthy. | medium | agent-only — verify against live rules text |
| 3.2 | Finance **write** capabilities have no UI anywhere. `issueInvoice`, `applyPayment`, `recordInvoiceAdjustment`, `recordRefund` are deployed, granted to admin/owner, sandbox-activated — with nothing to click. The AR **read** surface is real and honest. | medium | agent-verified by grep; likely |
| 3.3 | Part Detail renders "Change Status" unconditionally, but `inventory.catalog.activate` is held only by `inventoryCatalogAdministrator`, which is granted to nobody. The action can never succeed for any user. Failure is at least labelled honestly. | high | agent-only — verify |
| 3.4 | An `admin` can submit **and** reconcile the same cycle count in sandbox. Direct consequence of the full-catalog ruling; flagged in-source when implemented. | medium | certain (self-documented) |
| 3.5 | `getInventoryAnalytics` is deployed and unconsumed; the dashboard computes the same numbers client-side from raw collections, bypassing the trusted projection. | low | verified (consumption analysis + agent) |
| 3.6 | 15 of 84 deployed callables have no client caller. 11 explainable (Supplier Master S3 unbuilt, Coverage deliberately deferred). Worth a decision: `createSalesOrder` **and** `createSalesOrderFromOpportunity` both unconsumed; `detectInventoryEffects` unreferenced anywhere. | low | verified directly |
| 3.7 | Stale comment: `DispatchQueuePanel.jsx:7` describes a write path (`assignJob()`) that no longer exists. | low | agent-verified |
| 3.8 | Stale comments: `permissionCatalog.ts` and two frontend files claim `inventory.transfer.*` is "granted to NO Role"; `inventoryTransferOperator` holds all four and sandbox activates them. | low | agent-verified |

---

## 4. Refuted — do not action

| claim | status |
|---|---|
| The four dispatch/scheduling screens are redundant | **Refuted.** Each is documented as additive and distinct: Dispatch Queue (assignment), Dispatcher Board (drag-drop + activity feed), Scheduling (weekly technician×day), Dispatch Board (technician-row × time-axis). This corrects an earlier read of the Owner's "too many tabs" concern. |
| Notifications have no capability and may leak across users | **Refuted.** The bell is a Reorder Request surface backed by `reorder.request.read.queue`; `firestore.rules` scopes reads by role and assignment. No cross-user exposure. |
| Widening admin risks audit integrity | **Refuted.** No `audit.event.write`/`delete` id exists in the catalog at all; `auditEvents` is `allow read, write: if false` for every principal; the only writer is server-side append-only. |
| Some governed roles are defined but ungrantable | **Refuted.** `GOVERNED_ASSIGNABLE_ROLES` is 24/24 in sync. |
| `inventory.serializedAsset.read` is granted to no role, admin included | **False positive.** Admin's permissions are *derived* from the catalog, so the literal id appears nowhere to grep. Live resolution returns `true`. |
| `salesManager`/`salesperson` cannot reach Customers or Sales Orders | **Partly false positive.** True of the code path; not observable through the personas, whose legacy role is `dispatcher`. See §2. |

---

## 5. Fixed this session, pending merge

- **Sales Orders rendered `PlaceholderPage` over a completed screen** — the generic subnav
  loop emits the route first, so a second `<Route>` at the same path never won. Dispatched
  through `renderSubnavItem`; regression test pins the class and was verified to fail
  against the shipped commit. PR #1341.

---

## 6. Decisions this needs from the Owner

1. **Schedule the row23/24/25 cutover**, or accept that capability grants stay invisible to
   Rules and navigation until it happens.
2. **Define capability ids for the 15 uncovered collections**, or accept they remain
   legacy-role governed indefinitely.
3. **Assign governed roles to the sandbox personas**, or persona testing keeps measuring
   three identities.
4. **`operationsManager` role assignment** — currently authorizes as nobody.
5. **Cycle-count segregation of duties for admin** (§3.4) — keep as ruled, or add an
   explicit exclusion.
