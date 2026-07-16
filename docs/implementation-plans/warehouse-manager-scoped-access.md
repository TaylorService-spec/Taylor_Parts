---
artifact_type: implementation-plan
gate: Implementation Plan
status: Draft
date: 2026-07-16
owner: Claude Code (Inventory)
related_adrs: [docs/architecture/ADR-005-enterprise-authorization-migration-strategy.md]
depends_on: [docs/specifications/warehouse-manager-scoped-access.md, docs/assessments/warehouse-manager-scoped-access.md]
implements: [docs/specifications/warehouse-manager-scoped-access.md]
supersedes: []
superseded_by: []
related_pr: 332
related_issue: 226
target_release: TBD
---

# Implementation Plan: `WAREHOUSE_MANAGER` Scoped Warehouse Access

Sequences the Specification's two representations (Issue #100-scale Rules, Issue #226-scale governed model) into bounded, separately-gated rows. **No row in this table is implemented, merged, deployed, or authorized by this document itself** — each requires its own review and its own Owner authorization before work begins, per this series' established discipline.

## 1. Bounded row sequence

| Row | Task | Deliverable | Spec section(s) | Gate |
|---|---|---|---|---|
| A | Employee schema field | `assignedWarehouseIds?: string[]` added to the Employee-document contract (documentation + `provisionEmployeeAccess.js` support for reading/writing it) | §2 | **Schema — Owner authorization required before starting** |
| B | Issue #100-scale Rules | `isAssignedToWarehouse()` helper + additive `\|\|` arms on `warehouses`/`stock_locations`/`transfer_orders` (§3's exact illustrative shape or an Owner/reviewer-adjusted equivalent) | §3 | **Rules — Owner authorization required; depends on Row A merged** |
| C | Issue #100-scale Rules Regression | New emulator test coverage (assigned warehouse allowed; unassigned denied; empty/absent list denied; malformed list denied; admin/dispatcher unaffected; `PARTS_MANAGER`/`PARTS_ASSOCIATE` unaffected) added to the existing `issue100WarehouseManagerRules.test.js` suite, full 184-assertion regression still green | §3, §5 | Docs/tests only once Row B exists — self-mergeable after review, same posture as every prior Rules-regression-extension PR in this series |
| D | `WarehouseManagerHome.jsx` UI | Read-only Warehouse/Stock Location/Transfer Order surfacing on the existing `/inventory-role/warehouse` route, reusing this Specification's fail-closed table for empty/loading/denied states | §5 | App-code, depends on Row B live — **not self-mergeable until Row B is deployed and confirmed live** (same "merge is not deploy is not confirmed-live" discipline as every Issue #100 UI PR) |
| E | Governed `ConditionKind` | `"assignedToWarehouse"` added to `types/access.ts`'s `ConditionKind` union, `ConditionContext.assignedToWarehouse`, and the resolver's `evaluateConditions()` switch arm — resolves Specification §7's first open question before this row can be scoped precisely | §4.1, §4.2 | **Schema/pure-resolver — inert, but touches a shared, security-relevant type; independent review required; Owner sign-off recommended before merge given its cross-cutting nature** |
| F | Governed `TECHNICIAN_ROLE` grant | `warehouse.*.read` ids + the two-Condition (`operationalRoleActive` AND `assignedToWarehouse`) grant added to `compatibilityRoles.ts`'s `TECHNICIAN_ROLE` — **only after Row E's open question (§4.3) and the two-field-OR question (§4.4) are resolved by the Owner** | §4.3, §4.4, §7 | Inert, additive — self-mergeable after review once Row E is settled |
| G | Governed parity fixtures | Parity fixtures proving the governed-model decision matches Row B's live Rules decision exactly, once both exist | §4 | Depends on Rows B and F both existing; **not applicable until then** (mirrors PR #329's own "no parity fixture exists for an inert role" reasoning) |

## 2. Dependency graph

```
Row A (schema) -> Row B (Issue #100 Rules) -> Row C (Rules regression) -> Row D (UI)
                                            \-> Row G (parity, once F also exists)
Row E (ConditionKind) -> Row F (TECHNICIAN_ROLE grant) -> Row G
```

Rows A/B/C/D (the Issue #100-scale track) and Rows E/F (the Issue #226 governed-model track) are **independent of each other** — per the Specification's own §3 reasoning for adopting Option A specifically so the real, Owner-flagged product gap does not wait on the full Enterprise Access rollout. Row G is the only row requiring both tracks.

## 3. Non-negotiable invariants (carried from the Specification, binding on every row above)

- Every `allow read` change is **additive-only** (`isAdminOrDispatcher() || ...`) — no existing admin/dispatcher/`PARTS_MANAGER`/`PARTS_ASSOCIATE` behaviour narrows or widens.
- An absent or empty `assignedWarehouseIds` **always** denies, for every warehouse — never treated as "all warehouses" by any row's implementation.
- No write capability is introduced for `warehouses`/`stock_locations`/`transfer_orders` by any row in this table.
- Rows B/C/D require their own full Firestore Rules Regression run (184+ assertions, whatever the count is at that time) passing clean before merge, matching every prior Rules PR in this series.
- No row deploys anything to production; Rows B and (transitively) D require their own, later, separate Owner Deployment Authorization and live-verification step, identical to every other Issue #100 Rules track.

## 4. Explicitly out of scope

Equipment/Reporting (Customer-owned); Epic 5 Procurement; the real-world process for deciding *which* warehouses a given manager is assigned to (a business-process question, not an engineering one, out of scope for every row above).

## 5. Approval

Implementation-Plan-Draft, pending independent review and merge under this session's established docs-only merge authority. Merging this Plan authorizes only the row sequence and dependency ordering above — it does not itself implement, deploy, or activate anything. Row A is the next eligible unit of work once this Plan merges **and** the Owner separately authorizes starting it (Schema tier, per §1's own gate column). Issue #226 remains OPEN/In Progress. **AI plans; it never grants, revokes, or approves access.**
