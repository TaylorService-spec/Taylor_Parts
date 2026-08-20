# Inventory Scanner Program — source reconciliation

**Required by:** `docs/product/inventory-scanner-program.md` §18 step 2 ("Publish an evidence
table: `REUSE`, `EXTEND`, `MISSING`, or `PROTECTED DECISION`").
**Baseline reconciled:** `main` at `590f9437`.
**Method:** every row below was read from current source. Nothing here is inferred from the
program document, and nothing is asserted from memory.

---

## 0. Headline

Two facts decide the shape of this program, and both were only visible by reading the code.

**The good one.** The trusted receiving authority is **deployed and live**, its capability is
**active and granted**, and it already does far more than the program assumed it would need
built: one Firestore transaction, all-or-nothing, idempotent with replay, serialized-asset
registration with deterministic identity, a `RECEIVED` ledger event, and an immutable audit
event. Receiving is genuinely the right first slice.

**The blocking one.** That same authority accepts **exactly one line, for exactly one part, at
exactly the full ordered quantity.** The first slice as specified — scan many parts, aggregate
repeats, compare expected against observed, flag unexpected entries — is not a UX layer over the
existing command. It is a different command contract.

That is a §19 stop condition, and it is stated in §4 below with the exact source lines.

---

## 1. REUSE — verified, live, and sufficient as-is

| Component | Source | Verified state |
|---|---|---|
| Trusted receiving command | `functions/src/inventoryReceiving/receiveInventoryStockCommand.ts` | One transaction, all reads before any write, all-or-nothing |
| Receiving callables | `functions/src/inventoryReceiving/receivingCallables.ts:1-6` | **Deployed and live** in `eos-platform-sandbox` (2026-08-06, Decision #63) |
| `inventory.stock.receive` | `permissionCatalog.ts:881` | **ACTIVE** (not inert) and granted to admin, dispatcher, owner |
| Sandbox transport readiness | `config/environments.json` | `platform-sandbox` → `RECEIVING_TRANSPORT_READY: true` |
| Idempotency | `receiveInventoryStockCommand.ts`, `receivingRepository.ts` | `idempotencyKey` → deterministic `receivingId` + fingerprint; returns `applied` / `replayed` |
| Operational ledger | `functions/src/inventoryLedger/operationalMovementRepository.ts` | `stageOperationalMovement` into the single `inventory_transactions` ledger |
| Serialized asset registration | `functions/src/serializedAsset/serializedAssetRegistration.ts` | Deterministic identity on `(partId, serialNo)`; `create` **is** the uniqueness check |
| Serial↔quantity invariant | `receivingValidation.ts:107` | Exactly `orderedQuantity` distinct serials for a `SERIAL` line |
| Warehouse eligibility | `receivingLocationResolver.ts:31-45` | Reads through the transaction; requires governed status `ACTIVE` |
| Location option list | `listReceivingLocationOptionsCallable` | Deployed alongside the receive callable |
| Scan identity boundary | `field-ops-app-vite/src/domain/scannedIdentity.js` | Pure; resolves PART, SERIALIZED_ASSET, WORK_ORDER, INVENTORY_LOCATION, EQUIPMENT; states RESOLVED / NOT_FOUND / AMBIGUOUS / INVALID |
| Location reference contract | `field-ops-app-vite/src/domain/inventoryLocation.js` | Pure; `WAREHOUSE, BIN, MOBILE, VENDOR, CUSTOMER, VIRTUAL`; fails closed |
| Part alias commands | `functions/src/partMaster/partAliasCommands.ts` | `createPartAlias`, `deactivatePartAlias`, `resolvePartAlias`, `valueFingerprint` — written and unit-tested |
| Audit | `functions/src/access/auditEventWriter.ts` | Immutable audit event staged in the same transaction |

**The scanner's founding principle is already enforced in source**, and the program restates it:
`scannedIdentity.js` — *"Scanning resolves IDENTITY. Scanning does NOT determine AUTHORITY."*
Nothing in this program needs to introduce that separation; it needs to not break it.

---

## 2. EXTEND — exists, needs work, no new authority required

| Component | Current state | What extending means |
|---|---|---|
| `deriveScanActions` | `field-ops-app-vite/src/domain/scanActions.js` — one action, `RECORD_PART_USAGE`, hard-gated on `role !== "technician"` | Derive from effective capabilities + operational scope instead of a legacy role string. The mirror-the-server discipline is right and must be kept |
| Part Master → Barcodes & Identifiers | `field-ops-app-vite/src/shared/partMaster/PartIdentifiersSection.jsx` | The UI **already exists** and is honestly `UNAVAILABLE`, naming its three missing pieces. It needs the pieces, not a rewrite |
| Scanner surface | `PartsScanner.jsx` inside `FieldMode` | Program requires a shared, mobile-first **Scan** workspace. The resolution/candidate/action seams are reusable; the shell is not |
| Multi-scan queue | **Does not exist** | Pure client state. Buildable with no backend authority — but see §5 on why its shape is not yet decidable |

---

## 3. MISSING — no authority exists; repo-only work could create it

| Need | Evidence of absence |
|---|---|
| onCall adapter for any part-alias command | No alias export in `functions/src/index.ts`; `PartIdentifiersSection.jsx` names this as missing piece 1 |
| Client read path for `part_aliases` | `firestore.rules`: `allow read, write: if false` for every principal, admin included — missing piece 2 |
| Any data in `part_aliases` | Collection unpopulated; nothing seeds or migrates into it — missing piece 3 |
| A capability id for identifier administration | No `part.alias.*` or `inventory.identifier.*` id anywhere in the 110-id catalog |
| A Location **collection** | `inventoryLocation.js` is a *reference* contract only: *"The Location collection, its labels, and its custody remain their own authority."* Only `warehouses/{id}` documents exist |
| Bin / staging / dock / inspection / quarantine / returns / scrap locations | `BIN` and `VIRTUAL` exist as **types**; no registry of such locations exists, and receiving accepts `type === "WAREHOUSE"` only (`receivingLocationResolver.ts:36`) |

---

## 4. PROTECTED DECISION — Owner call required before the affected slice starts

### 4.1 — Multi-part receiving *(blocks the first slice)*

The program's first slice requires scanning many parts against one receiving document,
aggregating repeats, comparing expected against observed, and flagging unexpected entries.

The deployed authority forbids all four:

```
receivingValidation.ts:77   if (input.lines.length !== 1) return fail("line_count_invalid");
receivingValidation.ts:87   if (line.expectedQuantity !== orderedQuantity) return fail("expected_quantity_mismatch");
receivingValidation.ts:88   if (line.receivedQuantity !== orderedQuantity) return fail("received_quantity_mismatch");
receiveInventoryStockCommand.ts:153   const poPartId = str(po.partId);      // ONE part per purchase order
receiveInventoryStockCommand.ts:158   const orderedQuantity = po.orderedQuantity;
```

A `reorder_purchase_orders` document carries a single `partId` and a single `orderedQuantity`.
One purchase order is one part. There is no partial receipt, no over-receipt, and no variance —
observed must equal ordered exactly or the command rejects the batch.

A separate multi-line `PurchaseOrder` type does exist (`functions/src/types/procurement.ts:39`,
with `items: PurchaseOrderLineItem[]`), but **it is not the collection receiving reads**, and
wiring receiving to it would be a new source contract, not reuse.

**Options, none of which an implementer should pick alone:**

| | Option | Consequence |
|---|---|---|
| **A** | Build the scanner against the authority as it is | The "multi-scan queue" for receiving degrades to scanning one part until the count matches a fixed ordered quantity. Honest, small, and much less than the program describes |
| **B** | Extend `receiveInventoryStock` to accept multiple lines and variance | Not "a second receiving service" — it is the same one. But it changes a governed, deployed, live contract with existing idempotency records, and variance introduces business rules (over-receipt? short-receipt? unexpected part?) that do not exist anywhere today |
| **C** | Make multi-part purchase orders the source first | Larger, and upstream of the scanner entirely |

**The question that decides it:** when a Parts Associate receives a delivery containing three
different parts, is that **three purchase orders** (today's model, and the scanner queues across
them) or **one purchase order with three lines** (not today's model)?

Everything in the first slice follows from that answer.

### 4.2 — Put-away *(blocks the second slice)*

Receiving creates the receiving order **directly at `PUTAWAY_COMPLETE`**
(`receivingTypes.ts:20`, `receivingRepository.ts:177`). There is no separate put-away step, and:

- no `PUT_AWAY` movement type exists (§4.3);
- no staging or bin **locations** exist to move from and to (§3);
- receiving already writes stock to its final location.

Put-away as specified therefore requires a new ledger event **and** a location registry **and** a
new trusted command — three §19 stop conditions at once. It should not be started as "the second
slice" until §4.1 is settled and the location model is decided.

### 4.3 — Movement vocabulary (§15 reconciliation)

Authoritative operational set (`operationalMovementTypes.ts:12`):
`RECEIVED, ADJUSTED, TRANSFER_OUT, TRANSFER_IN, COUNTED, RETURNED, SCRAPPED`.

| Program event | Status |
|---|---|
| `RECEIVED` | **exists** |
| `RETURNED` | **exists** (source object `RMA`) |
| `COUNTED` | **exists** (source object `COUNT_SHEET`) |
| `ADJUSTED` | **exists** (source object `ADJUSTMENT`) |
| `SCRAPPED` | **exists** (source object `SCRAP`) |
| `IN_TRANSIT` | not an event — modelled as the `TRANSFER_OUT` / `TRANSFER_IN` pair |
| `RELEASED` | **name collision — do not reuse.** `RELEASED` exists only in the *disjoint legacy* Work-Order family and means "reservation released", not "released to a truck" |
| `CONSUMED` | same trap: legacy WO family only |
| `PUT_AWAY`, `PICKED`, `STAGED`, `ACCEPTED`, `ISSUED`, `QUARANTINED` | **missing** — registered here as architecture gaps, per §15 |

Seven of fourteen program events do not exist, and two more exist under the same names with
**different meanings**. Any slice needing one of those nine is a §19 stop.

### 4.4 — Capability activation

Of the inventory capabilities this program needs, most are registered `active: false`, which
denies for **everyone** regardless of grant:

| Capability | State |
|---|---|
| `inventory.stock.receive` | **ACTIVE** |
| `inventory.catalog.manage`, `.activate`, `inventory.action.*`, `inventory.transaction.read`, `inventory.analytics.read` | ACTIVE |
| `inventory.catalog.read` | **INERT** |
| `inventory.serializedAsset.read` | **INERT** |
| `inventory.location.display.read` | **INERT** |
| `inventory.transfer.create` / `.dispatch` / `.receive` / `.cancel` | **INERT**, granted to no role |
| `inventory.cycleCount.create` / `.submit` / `.reconcile` / `.cancel` | **INERT**, granted to no role |

A lookup-only Scan workspace would therefore **fail closed for every user today**: the reads it
needs (`catalog.read`, `serializedAsset.read`, `location.display.read`) are all inert. It is
still worth building — fail-closed and honest is the established posture — but it will not show
data until activation, which is an Owner action.

Of the 27 capability names proposed in program §9, **none exist**. The authoritative equivalents
above should be reused; new ids should be registered only where no equivalent exists, and
registering an id is not granting or activating it.

### 4.5 — Release posture

`RECEIVING_TRANSPORT_READY` is `true` only in `platform-sandbox`; it is `false` in production,
integration, and local-emulator. The constant's own header is explicit that flipping it **and**
releasing the resulting Hosting bundle requires separate Owner authorization, and that *"flipping
it alone is not activation."*

So any receiving slice built here lands as **RELEASE CANDIDATE — NOT USER-OPERABLE** in every
environment except sandbox, and in sandbox it is operable only after an authorized Hosting
release.

---

## 5. Revised plan

Program §18 sequences: reconcile → evidence table → identifier UX → Scan workspace → queue →
receiving end to end.

Steps 1 and 2 are this document. Steps 3–6 are **not blocked by §4.1** in principle — but the
queue's design *is*. A multi-scan queue exists to collect many different things before one
submission; if receiving stays one-part-per-document, the receiving queue has nothing to collect,
and building it first would mean designing the central abstraction of the program against a
contract that may be about to change.

**Recommended order given what the source actually says:**

1. **Settle §4.1.** It is one question and it determines the queue, the receipt, the validation
   states, and the whole first slice.
2. **Identifier administration** — genuinely independent of §4.1, and the scanner cannot resolve
   anything the identifier authority does not hold. Needs onCall adapters plus a capability id
   (repo-only, registered inert), and remains non-operable until Rules and deployment are
   authorized.
3. **Shared Scan workspace, lookup only** — buildable now, fail-closed on the three inert read
   capabilities, and it establishes the shell every later slice uses.
4. **Multi-scan queue** — once §4.1 tells us what a queue holds.
5. **Receiving end to end**, then re-verify before opening put-away.

Nothing in steps 2–5 was started. This document is step 2, and step 1 is not mine to answer.

---

## 5b. Phase A status — DELIVERED

Owner decision 2026-08-20 directed Phase A (identifier administration) to proceed immediately as
independent work. It is built.

**Classification: RELEASE CANDIDATE — NOT USER-OPERABLE.**

| Axis | State |
|---|---|
| Repository-complete behaviour | **Yes** — five callables, read projection, full UX, tests, CI |
| Capability definition required | **No.** `inventory.catalog.manage` already exists, is ACTIVE, and is what the alias commands already enforce. No synonym was created |
| Grant required | **No** — already granted to admin and two governed business roles |
| Activation required | **No** — the capability is not inert |
| Deployment required | **YES** — the five callables are exported but not deployed |
| Readiness flip required | **YES** — `PART_IDENTIFIER_TRANSPORT_READY` is false in all four environments |
| Data migration required | **No.** `part_aliases` is unpopulated, and that is the correct starting state — identifiers are entered, not backfilled |
| Owner decisions remaining | None for Phase A |

Two of the three blockers the surface itself named are now closed. The third —
`firestore.rules` deny-all on `part_aliases` — was **not** closed and did not need to be: a
callable runs on the Admin SDK, which Rules do not govern. Rules are unchanged.

**No index was added.** The list read is a single-field equality query with in-memory ordering,
specifically so it needs none.

## 6. Preserved by this reconciliation

The Owner decision recorded in `docs/governance/parts-scanner-access-decision.md` and in program
§3 is unchanged and unimplemented, as intended:

- the existing technician scanner journey is untouched;
- `ROLE_NAV_ACCESS` is unchanged — no Parts or warehouse role was added to it;
- no capability was created, granted, or activated;
- no Rules or index change was made;
- nothing was deployed.
