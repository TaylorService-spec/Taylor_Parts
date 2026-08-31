# Receiving North Star P1 — composition map

**Reconciliation of the frozen Design source against repository authority, produced BEFORE any UI
code changed.** Family 9. The practice this repeats is the one that has now paid twice: Parts P1
found nine of fifteen drawn elements unbuildable as drawn, and Parts P1v2 found two elements the
handoff had explicitly certified as needing no new authority.

---

## I. The frozen source

| | |
|---|---|
| **Visual authority** | `docs/north-star/receiving/North Star - Receiving P1.dc.html` |
| **SHA-256** | `fe72fe5fa588380a9e06069250e6fb478783ca9a23a275d783d1ad8a3ff23e8d` |
| **Frozen at** | `b83a8bd6` — *docs(receiving): open Family 9 — North Star P1 design source committed* (#1641) |
| **Handoff** | `DESIGN-HANDOFF-RECEIVING-P1.md` (same folder) |
| **Binding brief** | `RECEIVING-NORTH-STAR-DESIGN-START.md` — the Owner design-start document |
| **Frames** | 1a workspace · 1b supplier multi-scan · 1c add existing unit · 1d reorder journey · 1e truth states · 1f handheld 390 |
| **Posture** | Presentation/composition only. No platform or authority change. |

The hash is recorded so that "the design changed" and "the reconciliation was wrong" can never be
confused later. Parts spent a round on that exact ambiguity when a P1v3 zip arrived that turned out
to be byte-identical to P1v2.

---

## II. Verdict on the handoff

**This handoff is materially better than the one Parts received.** It ships a composition map with a
named authority source per element, declares two authority gaps and one named decision up front, and
corrects itself against the repository where its own source zip was stale (RCV-G2). It does not
claim "no new authority required" as a blanket.

**Every COMPOSE claim in it was checked against the named file. All ten hold.** No drawn element was
found to require authority the repository lacks.

That is a genuinely different starting position from Parts, and it is worth saying plainly rather
than manufacturing symmetry with the previous family.

**One claim is overstated and one repository governance comment is false.** Both are in §IV. Neither
blocks implementation; both would mislead a future reader, and one carries a real hazard.

---

## III. Element-by-element classification

Every displayed fact and action in the frames, classified per the Owner's discipline.

| # | Element | Classification | Authority, verified |
|---|---|---|---|
| R1 | Awaiting-receipt queue | **DERIVABLE FROM EXISTING AUTHORITY** | `fetchReceivablePurchaseOrders()` (`src/services/receivingCallableClient.js:113`) ∪ `buildPurchaseOrdersView()` (`src/domain/purchaseOrdersView.js:118`). The union is client-side composition of two existing governed reads. |
| R2 | Journey column (Reorder / Supplier) | **PRESENTATION ONLY** | The two journeys exist today as a `JOURNEY` toggle in `Receiving.jsx:56`, rendered as two buttons. P1 turns a mode switch into a row attribute. No read changes. |
| R3 | Receipt progress vs order status | **EXISTING AUTHORITY** | `readPurchaseOrderProgress` returns `storedStatus` AND `derivedState` as two separate fields (`purchaseOrderProgressRead.ts:123-128`). The frame showing them as two facts matches what the callable already distinguishes. |
| R4 | Multi-scan session (reconcile / blocked / submittable) | **EXISTING AUTHORITY** | `receivingScanQueue.js` exports `ENTRY_STATE`, `BLOCKING_STATES`, `reconcile()`, `buildSubmissionLines()`, `ENTRY_STATE_REASON`. The blocked-scan attention block has a governed reason vocabulary to speak from. |
| R5 | Reorder journey steps | **EXISTING AUTHORITY** | `RECEIVE_STEP` (`receiveAgainstPurchaseOrder.js:31`), and the v1 contract is explicit in its own header: "a confirmation of the full ordered quantity, not an editable field". |
| R6 | Serial capture, duplicate shown | **EXISTING AUTHORITY** | The pure diagnostic at `receiveAgainstPurchaseOrder.js:118-133` already reports blank slots and exact duplicates by index. The frame renders a diagnostic that exists. |
| R7 | Receiving location picker | **EXISTING AUTHORITY** | `receivingLocationOptionAdapter.js` over `receivingLocationOptionsService.ts` (I-LA4), ACTIVE warehouses only, shape proved fail-closed before the frontend sees it. |
| R8 | Add existing unit — form, 3 reasons, read-back | **EXISTING AUTHORITY** | `ACQUIRE_REASON` is a closed vocabulary of exactly three (`serializedAssetAcquireVocabulary.js:20`), each with a label AND a hint, over the `acquireSerializedAsset` trusted writer. |
| R9 | Two-stage Review → Confirm | **PRESENTATION ONLY** | One command, two screens. `AcquireExistingUnit.jsx` already composed to this standard in #1639; 1c re-hosts it in a side sheet. |
| R10 | Held-not-received notice | **EXISTING AUTHORITY** | `useWarehouseSubmit.js` returns `SENT / QUEUED / REFUSED / QUEUED_NOT_DURABLE`, and its header states the rule the frame depends on: **"A CLEAR SERVER 'NO' IS NEVER QUEUED."** |
| R11 | Recent receipts list | **NEW AUTHORITY REQUIRED — RCV-G1** | No governed read returns receipt records. The frame preserves the slot in an honest unavailable state; it must not be populated. |
| R12 | `RO-YYYY-######` labels | **EXISTING AUTHORITY, NOT REACHABLE — RCV-G2** | The allocator is real: `receivingOrderNumbering.ts:60` builds `RO-${year}-${padStart(6,"0")}`. No governed read exposes it to a client, and pre-#1259 documents have none. |

**Nothing is classified INVALID / MUST NOT IMPLEMENT.** The one element that would be — a receipts
list read off the raw collection — the handoff itself already forbids.

---

## IV. Where the certification does not survive inspection

### RCV-G1's wording is too strong, and contradicts the handoff's own composition map

The gap states:

> No client or callable read of `receiving_orders` exists anywhere in the repo.

**Four functions read it, and one of them is client-reachable:**

| Reader | What it does |
|---|---|
| `purchaseOrderProgressRead.ts:95` | `.collection(receiving_orders).where("source.purchaseOrderId","==",id).get()` — **reached by a callable** (`receivingCallables.ts:238`) |
| `partBalanceReadService.ts:308` | same query shape, per purchase order |
| `partBalanceBatchReadService.ts:137` | same, batched |
| `receivingRepository.ts:318` | `db.collection(RECEIVING_ORDERS_COLLECTION)` |

The handoff cites `purchaseOrderProgressRead.ts` two rows above the gap, as the authority for R3. So
the composition map and the gap statement disagree with each other about the same file.

**The gap's SUBSTANCE is correct and R11 stands.** The distinction that makes it correct is not "no
read exists" but **no read returns a receipt record to a client**: the progress callable maps each
receipt to `{receivingId, lines[]}` internally, aggregates it into per-line `receivedQuantity`, and
**discards `receivingId` before responding** (`purchaseOrderProgressRead.ts:123-139`). The client
receives derived quantities, never a receiving order.

**Corrected wording for RCV-G1:** *no governed read returns `receiving_orders` records to a client;
the collection is read server-side only, and only in aggregate.*

### The metadata register states a falsehood, and it carries a hazard

`src/metadata/definitions/receivingOrder.js:18-19`:

> No function anywhere in this repository reads back a `receiving_orders` document by id, by query,
> or in bulk.

This is **false** — see the table above; two of those are by query and one is in bulk. It is the
stated justification for `readVia: UNKNOWN` / `readCallable: null`.

**The conclusion survives; the justification does not.** `readVia: UNKNOWN` is right, because no
callable returns the entity. But the sentence a future reader will actually rely on says the
collection is unread — and someone who believes that is free to change the stored document shape.
Doing so would silently break part balances and purchase-order progress, because
`source.purchaseOrderId`, `lines[].lineId` and `lines[].receivedQuantity` are load-bearing to three
server-side readers. **That is the hazard, and it is why this is worth correcting rather than
noting.**

Recorded as **RCV-G3**. It is a documentation defect in an existing file, not a Design question, and
it is not a blocker for the composition.

---

## V. The live baseline (step 4)

Measured, not remembered. `src/modules/inventory/Receiving.jsx`, 156 lines.

| | |
|---|---|
| **Page root** | `<div className="fo-panel">` — **a card as the page model**, which is exactly what the North Star grammar names as the drift `RuledSection` exists to reverse |
| **Identity** | `<WorkspaceHeader title="Receiving" />` — one h1, via `PageHeader`. No nested shell today. |
| **Journey** | Two `<Button>`s in a `fo-chip-row`, primary/secondary by state — a mode toggle, not a queue |
| **Awaiting receipt** | **No queue exists.** Candidates are selected inside each journey component, not listed on the page |
| **Exceptional path** | `<section className="fo-receiving-exception">` with an h3, below both journeys — already set apart, and **ABSENT without capability** rather than disabled |
| **Recent receipts** | No slot exists at all |
| **Handheld** | Not composed for 390 |

**What the acceptance checklist already passes today:** singular page identity, no duplicate H1s, the
exceptional path discoverable but clearly exceptional and absent without capability, and the two-stage
Review → Confirm with its consequence copy (#1639).

**What P1 actually adds:** the awaiting-receipt queue (R1/R2 — the largest new composition), the
North Star page shell in place of the card root, the honest Recent-receipts slot, and the handheld
posture.

---

## VI. Consequences for the gate (steps 5–7)

Recorded now so the gate is designed against structure rather than retrofitted to wording — the
mistake that cost Parts two rounds.

1. **Anchor on stable ids and data hooks, never on heading text or copy.** Parts' gate selected
   `h2 "Stock forecast"` and `h2 "Where it is"`; the approved composition renamed both, and three
   checks then measured a page that no longer existed. Receiving's gate gets
   `data-*` / `id` contracts from the first commit.
2. **Assert the gate's own anchors in a CI test**, and make the gate script a **trigger path** for
   the workflow that runs it. Parts shipped three re-anchored checks that never landed because
   nothing in CI was looking at the file that changed.
3. **Non-vacuous state assertions.** RCV-G1 means the Recent-receipts slot is *permanently* in an
   unavailable state, so a check that merely finds the slot proves nothing. It must assert the slot
   states its reason AND renders no list — the shape check 10 ended up as on Parts.
4. **The queue is the family's real risk.** R1 unions two reads; a check must prove BOTH journeys can
   appear and that each row routes to its own workflow, or a regression that drops one source
   silently passes.
5. **Height budgets print the Design target alongside the accepted ceiling**, from the first run.

---

## VII. Open, before implementation

| | |
|---|---|
| **RCV-D1** | One queue with a Journey column, replacing the chip toggle. The handoff flags that if the Owner prefers the two-entry presentation, only frame 1a changes. **This is a product decision and is the Owner's.** |
| **RCV-G1** | Recent receipts — needs a governed read service ruling. P1 renders the honest slot and stops. |
| **RCV-G2** | `RO-YYYY-######` unreachable client-side. Renderers show an honest placeholder, **never the document id**. |
| **RCV-G3** | The metadata register's false "nothing reads this collection" sentence. Documentation fix, hazard described above. |

**No code has been written against this composition.**
