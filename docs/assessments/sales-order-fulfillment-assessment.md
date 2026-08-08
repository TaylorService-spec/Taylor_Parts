# Assessment — Sales Order + WON → Fulfillment (Cycles 4–9)

Design-first assessment for the commercial→operational runway. Establishes the smallest coherent **Sales
Order** authority and the seams from WON Opportunity through fulfillment, warehouse, dispatch, execution, and
the finance boundary. Repo-only, fail-closed; each cycle is a vertical increment.

## Authority map (reuse, do NOT fork)
| Concept | Canonical authority (reused) |
|---------|------------------------------|
| Customer / commercial profile | `accounts` (ADR customer foundation) |
| Contact / Location | `contacts` / `locations` |
| Product / model / part | `parts` (partId==SKU, ADR-008), `equipment_models` |
| Serialized asset | `equipment` (ADR-006/010) — assigned at **fulfillment**, never at Opportunity/SO |
| Salesperson / owner | Employee (`ownerEmployeeId`) |
| Field execution | Work Order lifecycle (`fieldops_wos`) via trusted commands (ADR-009) |
| Inventory state | `stock_locations` / `inventory_transactions` / `warehouses` |
| Scheduling | existing Scheduling/Dispatch surfaces |

**New authority introduced (Owner-directed, greenfield): `sales_orders`** — the committed commercial order.
Admin-SDK-only (client deny-all Rules), written only through a trusted command. This is the single new
canonical authority this runway requires; everything else reuses the above.

## Commercial vs physical cardinality (the core invariant)
`C713 × 5` = **ONE Sales Order · ONE line · quantity 5** (commercial) → eventually **five serialized
`equipment` assets** (physical, assigned at fulfillment). A Sales Order line tracks four quantities so partial
fulfillment is first-class and honest:

```
orderedQty ≥ allocatedQty ≥ fulfilledQty      remainingQty = orderedQty − fulfilledQty
```

Do not turn each physical machine into another SO line unless there is a real commercial distinction.

## Sales Order shape (smallest coherent — Cycle 4)
- Identity: server-assigned id; optional human order number later.
- Commercial refs (reused authorities): `accountId`, delivery/service `locationId?`, `ownerEmployeeId`,
  `salesChannel` (NATIONAL_ACCOUNTS|RETAIL), optional `sourceOpportunityId`, optional `customerPO`, `notes?`.
- Lines: `{ kind: EQUIPMENT_MODEL|PART|SERVICE, ref, orderedQty, allocatedQty, fulfilledQty, unitPrice? }`
  — product-level only; **no serialized asset ref**. `unitPrice` is an optional **pricing snapshot** field:
  Cycle 4 invents **no** pricing/discount/tax authority (those are greenfield; the snapshot is a passive
  captured value, not a computed one).
- Lifecycle: `DRAFT → CONFIRMED → IN_FULFILLMENT → FULFILLED → CLOSED`, plus `CANCELLED`. Partial fulfillment
  is represented by line quantities, not a separate status. Change/cancel behavior fail-closed via the command.
- Money concepts kept distinct (never interchangeable): order amount ≠ invoice amount ≠ payment ≠ revenue ≠
  technician cost ≠ commission. Cycle 4 stores only the order-side snapshot; the rest are later domains.

## Fulfillment seam (Cycle 5, design)
A CONFIRMED Sales Order creates **operational demand** without Sales becoming the authority over Inventory/
Service. Sales **requests/observes**; Inventory owns inventory state; Equipment owns serialized assets;
Service owns field execution. Allocation (availability → reserve → serialized-equipment selection → partial/
backorder/unavailable states → readiness → release) is produced by a trusted command that reads canonical
inventory/equipment and records allocation against SO lines. No second inventory model.

## Downstream cycles (seams, built when the increment reaches them)
- **C6 Warehouse:** committed allocation → pick requirement → prep/pull → readiness → handoff, over canonical
  Inventory/Equipment; no parallel inventory system.
- **C7 SO → Service/Dispatch:** SO does **not** write Work Orders directly — it creates Service demand through
  the existing governed Work Order command (ADR-009). Reuse the existing Scheduling surface.
- **C8 Multi-Equipment (register #14):** preserve per-equipment execution/completion/exception/history while
  offering ONE coordinated visit (shared schedule/tech/truck/customer/location/materials). **Assess whether
  existing Work Order relationships (a parent/coordination link) suffice before inventing any Job/Visit
  authority — do not invent one until evidence requires it.**
- **C9 Field execution:** connect F1/F2 (governed scanning/entity resolution) into fulfillment (load
  verification → en route → arrive → work → per-equipment completion → exceptions). No demo-inventory behavior.
- **Completion→Finance seam:** operational completion → billing eligibility → Accounting authority. Work Order
  does not own accounting. Finance is greenfield → design-first; do not fabricate invoice authority.

## Preserved roadmap seams (do not foreclose)
- **#12 Temporary Equipment / Loaners:** once a temporary-equipment decision is made, reuse allocation/
  warehouse/dispatch/technician/truck/delivery/return machinery; persistence shape stays UNRESOLVED — keep the
  seam open.
- **#13 Technician Labor/Cost:** execution architecture must not foreclose the paid/job/travel/onsite/non-job/
  unaccounted + cost/billable/revenue model; no comp/rates on Work Orders; not built in these cycles.

## Protected boundaries (STOP → Owner/operator)
Capability GRANT · callable DEPLOY/activation · Firestore Rules DEPLOY/widening beyond a fail-closed deny-all
block · production · destructive migration · a genuinely new authority beyond `sales_orders` · a material
business interpretation with multiple legitimate readings. Everything else in this runway is repo-only
fail-closed groundwork and proceeds autonomously.
