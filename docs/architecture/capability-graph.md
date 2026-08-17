# Capability graph — what this platform can actually do

**Generated. Do not edit by hand.** `node scripts/buildCapabilityGraph.mjs`

`repo-graph.json` maps *structure* — who imports whom. This maps *capability* — what a person can
actually finish. It exists because "do we already have X?" was being answered by grep, and grep
cannot tell a capability that was never built from one that was built and deliberately switched off.

## The four layers

| Layer | Source | Question it answers |
| --- | --- | --- |
| Governance | `permissionCatalog.ts` | Is there a capability entry, and is it `active`? |
| Backend | `functions/src/index.ts` | Is there an exported callable behind it? |
| UI | `navConfig.js` | Is there a destination — hidden, placeholder, or real? |
| User truth | `docs/user-guide/README.md` | Do our own guides say a person can finish the job? |

## Counts

- **capabilities**: 109
- **active**: 36
- **inactive**: 73
- **callableExports**: 30
- **destinations**: 58
- **destinationsHidden**: 20
- **guides**: 42
- **registerEntries**: 15
- **parityIssues**: 0

## Capability states

| State | Count | Meaning |
| --- | ---: | --- |
| ACTIVE | 5 | Granted and backed by an exported callable |
| BUILT_INERT | 68 | **Callable exists; capability is `active:false`.** Built and hard-denied — not missing |
| DECLARED_ONLY | 31 | Registered, no exported callable found |
| ACTIVE_NO_CALLABLE | 0 | Active but no callable matched — read-side or a parse miss; check before trusting |

## Guide statuses (user-visible truth)

- **live**: 35
- **not-yet-available**: 4
- **demo (except Receive)**: 2
- **real, fail-closed until activated**: 1

## Permission-catalog parity

Server and client mirrors agree.

## Flows — where each business chain stops

A chain is only as usable as its first non-active link. Steps marked `UNGOVERNED` have no capability
behind them at all — that may be ordinary UI, or genuinely nothing; the graph does not guess.

### Service call → cash

Source: `docs/PlatformCapabilityModel.md (Work Order lifecycle); docs/assessments/completion-to-finance-and-billing-ar-assessment.md`

**Stops at step 1 of 8: Intake — customer reports a problem**

| # | Step | State | Capabilities |
| ---: | --- | --- | --- |
| 1 | Intake — customer reports a problem | UNGOVERNED | — |
| 2 | Create work order | BUILT_INERT | `workOrder.create` |
| 3 | Plan parts | BUILT_INERT | `workOrder.parts.plan` |
| 4 | Schedule / dispatch | LEGACY_ROLE_GATED | — |
| 5 | Field execution — parts and notes | BUILT_INERT | `inventory.action.create` |
| 6 | Complete / transition | BUILT_INERT | `workOrder.transition` |
| 7 | Invoice | BUILT_INERT | `finance.invoice.issue` |
| 8 | Payment | BUILT_INERT | `finance.payment.apply` |

### Equipment sale → serviceable asset

Source: `docs/design/inventory-sales-templates-and-lines-of-business-wireframe.md §1 (D2→D3→D4→invoice→asset→D1)`

**Stops at step 1 of 8: Opportunity**

| # | Step | State | Capabilities |
| ---: | --- | --- | --- |
| 1 | Opportunity | BUILT_INERT | `opportunity.write` |
| 2 | Sales & Security Agreement (D2) | UNGOVERNED | — |
| 3 | Convert to Sales Order (D3) | BUILT_INERT | `opportunity.createSalesOrder`, `salesOrder.write` |
| 4 | Allocate stock | BUILT_INERT | `salesOrder.fulfill` |
| 5 | Pick ticket (D4) | UNGOVERNED | — |
| 6 | Deliver / install | BUILT_INERT | `salesOrder.service` |
| 7 | Invoice | BUILT_INERT | `finance.invoice.issue` |
| 8 | Becomes serviceable asset | BUILT_INERT | `inventory.serializedAsset.read` |

### Ventana ice machine — inventory control lifecycle

Source: `docs/business-processes/ventana-ice-machine-commercial-inventory-lifecycle.md §3 (two-condition exit: install complete AND sale closed)`

**Stops at step 1 of 7: Customer demand / sale**

| # | Step | State | Capabilities |
| ---: | --- | --- | --- |
| 1 | Customer demand / sale | BUILT_INERT | `opportunity.write`, `salesOrder.write` |
| 2 | Taylor purchases from Ventana | BUILT_INERT | `reorder.purchaseOrder.create` |
| 3 | Receive — inventory control BEGINS | BUILT_INERT | `inventory.stock.receive` |
| 4 | Serialized identity & custody | BUILT_INERT | `inventory.serializedAsset.read` |
| 5 | Allocation / staging | BUILT_INERT | `salesOrder.fulfill` |
| 6 | Delivery / installation | BUILT_INERT | `salesOrder.service` |
| 7 | Install complete AND sale closed — control ENDS | BUILT_INERT | `inventory.serializedAsset.read` |

### Parts reorder → stock on hand

Source: `docs/user-guide/inventory/*.md — guides tag every step through 'Place the order' as **live**`

**Stops at step 1 of 6: Request a reorder**

| # | Step | State | Capabilities |
| ---: | --- | --- | --- |
| 1 | Request a reorder | BUILT_INERT | `reorder.request.create.manual` |
| 2 | Review / approve | BUILT_INERT | `reorder.request.approve`, `reorder.request.reject` |
| 3 | Assign to Parts Associate | BUILT_INERT | `reorder.request.assign` |
| 4 | Place the order (PO) | BUILT_INERT | `reorder.request.recordPurchaseOrder`, `reorder.purchaseOrder.create` |
| 5 | Receive into warehouse | BUILT_INERT | `inventory.stock.receive` |
| 6 | Stock on hand updated | BUILT_INERT | `inventory.transaction.read` |

## How to use it

Before claiming a capability is missing, query this graph. Specifically:

1. Search `capabilities[]` for the resource — a `BUILT_INERT` hit means **built and switched off**,
   which is an activation decision, not a gap.
2. Search `destinations[]` — a `navHidden` entry with a `placeholderExplanation` states in its own
   words why it is not reachable.
3. Search `guides[]` — a `not-yet-available` tag names what is missing underneath a screen that exists.
4. Only if all four layers are silent is something genuinely absent.

Structural questions (who imports whom, is a cited path real) belong to `repo-graph.json` instead.
