# Capability graph — declaration, implementation, activation

**Generated. Do not edit by hand.** `node scripts/buildCapabilityGraph.mjs`

`repo-graph.json` maps *structure*. This reports *evidence* about capabilities: what the catalog
declares, what the code references, and what each environment activates. These are three separate
things and this document never fuses them into one verdict.

> **`active: false` does not mean unusable.** `functions/src/access/environmentCapabilityOverrides.ts`
> activates selected catalog-inactive capabilities in configured non-production environments. The
> repo's rule holds throughout: **eligibility != activation != authorization**.

> **Nothing in this document is authorization.** Enablement means the capability-level activation
> gate permits the capability to be considered in that environment. A principal still needs the
> applicable Role grant, which this graph never evaluates. Read every count below as a statement
> about gates, never about what any person can do.

## Dimensions reported

| Dimension | Source | What it does NOT tell you |
| --- | --- | --- |
| Catalog declaration + `active` flag | `permissionCatalog.ts` | Whether any environment activates it |
| Implementation evidence | literal id references; callables from `index.ts` | Whether it is deployed or reachable |
| Environment activation | `environmentCapabilityOverrides.ts` + `config/environments.json` | Whether a principal holds a qualifying grant |
| Capability enablement | computed **only** with `--environment` | **Whether any principal is granted it** |

## Counts

- **capabilities**: 146
- **catalogActive**: 0
- **catalogInactive**: 146
- **eligibleForEnvironmentActivation**: 91
- **activatedInSomeEnvironment**: 91
- **callableExports**: 46
- **destinations**: 92
- **destinationsHidden**: 19
- **guides**: 0
- **registerEntries**: 18
- **parityIssues**: 0

Catalog parse check: 146/146 entries (ok)

## Implementation evidence

Evidence of reference. **Not** proof that a callable exists, except where stated.

| Class | Count | Means |
| --- | ---: | --- |
| EXPORTED | 21 | An exported callable in `index.ts` names this capability |
| SERVER_REFERENCED | 119 | Referenced under `functions/src`; no callable matched |
| CLIENT_ONLY | 2 | Referenced only in the client app |
| NO_IMPLEMENTATION_EVIDENCE | 4 | No literal reference found — **may be a false negative** for ids assembled indirectly |

## Environment activation

Eligible for activation (allow-list in the resolver): **91**.
Activated by at least one environment: **91**.

Production is hard-blocked by role in the resolver and carries no override declaration.

## Capability enablement

**Not computed.** No environment was named, and enablement is not a fact that exists
environment-free. Run with `--environment <id|projectId>` to evaluate one.

## Flows — governance coverage per business chain

Chains transcribed from our own process docs. A step with no mapped capability is `UNMAPPED` and
**never closes a chain** — it may be ordinary UI, legacy role-gated authorization, non-capability
logic, or genuinely absent, and this evidence cannot distinguish those. Step enablement reports the
capability activation gate only; principal Role grants are not evaluated anywhere in this document.

### Service call → cash

Source: `docs/PlatformCapabilityModel.md (Work Order lifecycle); docs/assessments/completion-to-finance-and-billing-ar-assessment.md`

_Governance coverage only — no enablement computed without an environment._

| # | Step | Coverage | Capabilities |
| ---: | --- | --- | --- |
| 1 | Intake — customer reports a problem | UNMAPPED | — |
| 2 | Create work order | IMPLEMENTATION_EVIDENCE | `workOrder.create` |
| 3 | Plan parts | IMPLEMENTATION_EVIDENCE | `workOrder.parts.plan` |
| 4 | Schedule / dispatch | UNMAPPED | — |
| 5 | Field execution — parts and notes | IMPLEMENTATION_EVIDENCE | `inventory.action.create` |
| 6 | Complete / transition | IMPLEMENTATION_EVIDENCE | `workOrder.transition` |
| 7 | Invoice | IMPLEMENTATION_EVIDENCE | `finance.invoice.issue` |
| 8 | Payment | IMPLEMENTATION_EVIDENCE | `finance.payment.apply` |

### Equipment sale → serviceable asset

Source: `docs/design/inventory-sales-templates-and-lines-of-business-wireframe.md §1 (D2→D3→D4→invoice→asset→D1)`

_Governance coverage only — no enablement computed without an environment._

| # | Step | Coverage | Capabilities |
| ---: | --- | --- | --- |
| 1 | Opportunity | IMPLEMENTATION_EVIDENCE | `opportunity.write` |
| 2 | Sales & Security Agreement (D2) | UNMAPPED | — |
| 3 | Convert to Sales Order (D3) | IMPLEMENTATION_EVIDENCE | `opportunity.createSalesOrder`, `salesOrder.write` |
| 4 | Allocate stock | IMPLEMENTATION_EVIDENCE | `salesOrder.fulfill` |
| 5 | Pick ticket (D4) | UNMAPPED | — |
| 6 | Deliver / install | IMPLEMENTATION_EVIDENCE | `salesOrder.service` |
| 7 | Invoice | IMPLEMENTATION_EVIDENCE | `finance.invoice.issue` |
| 8 | Becomes serviceable asset | IMPLEMENTATION_EVIDENCE | `inventory.serializedAsset.read` |

### Ventana ice machine — inventory control lifecycle

Source: `docs/business-processes/ventana-ice-machine-commercial-inventory-lifecycle.md §3 (two-condition exit: install complete AND sale closed)`

_Governance coverage only — no enablement computed without an environment._

| # | Step | Coverage | Capabilities |
| ---: | --- | --- | --- |
| 1 | Customer demand / sale | IMPLEMENTATION_EVIDENCE | `opportunity.write`, `salesOrder.write` |
| 2 | Taylor purchases from Ventana | IMPLEMENTATION_EVIDENCE | `reorder.purchaseOrder.create` |
| 3 | Receive — inventory control BEGINS | IMPLEMENTATION_EVIDENCE | `inventory.stock.receive` |
| 4 | Serialized identity & custody | IMPLEMENTATION_EVIDENCE | `inventory.serializedAsset.read` |
| 5 | Allocation / staging | IMPLEMENTATION_EVIDENCE | `salesOrder.fulfill` |
| 6 | Delivery / installation | IMPLEMENTATION_EVIDENCE | `salesOrder.service` |
| 7 | Install complete AND sale closed — control ENDS | IMPLEMENTATION_EVIDENCE | `inventory.serializedAsset.read` |

### Parts reorder → stock on hand

Source: `docs/user-guide/inventory/*.md — guides tag every step through 'Place the order' as live`

_Governance coverage only — no enablement computed without an environment._

| # | Step | Coverage | Capabilities |
| ---: | --- | --- | --- |
| 1 | Request a reorder | IMPLEMENTATION_EVIDENCE | `reorder.request.create.manual` |
| 2 | Review / approve | IMPLEMENTATION_EVIDENCE | `reorder.request.approve`, `reorder.request.reject` |
| 3 | Assign to Parts Associate | IMPLEMENTATION_EVIDENCE | `reorder.request.assign` |
| 4 | Place the order (PO) | IMPLEMENTATION_EVIDENCE | `reorder.purchaseOrder.create`, `reorder.request.recordPurchaseOrder` |
| 5 | Receive into warehouse | IMPLEMENTATION_EVIDENCE | `inventory.stock.receive` |
| 6 | Stock on hand updated | IMPLEMENTATION_EVIDENCE | `inventory.transaction.read` |

## Permission-catalog parity

Server and client mirrors agree.

## How to use it

Before claiming a capability is missing:

1. Find it in `capabilities[]`. Read `catalogActive`, `implementation.evidence`, and
   `environmentActivation` as **three separate facts**.
2. `catalogActive: false` with a non-empty `environmentActivation.environments` means the activation
   gate is **open in those environments** — not missing, and not inert. It does not mean any
   principal holds a grant for it.
3. `NO_IMPLEMENTATION_EVIDENCE` is a lead, not a verdict — indirect references are invisible here.
4. Check `destinations[]` for a `navHidden` entry whose `placeholderExplanation` states, in its own
   words, why it is unreachable; and `guides[]` for a status tag naming what is missing beneath a
   screen that exists.
5. Only when all of those are silent is something plausibly absent — and confirm by reading.

Structural questions (who imports whom, is a cited path real) belong to `repo-graph.json`.
