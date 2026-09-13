---
artifact_type: operating-model-engineering
lane: OWN-ENGINEERING-GAP
baseline: 64008d5ae0bdd9532909671b15a91122400accf1
date: 2026-09-13
implementation_status: NOT AUTHORIZED
reassessed: 2026-09-13 — PART II reassesses all 29 items against DECISIONS #180/#181/#182 + MI-N/MI-P/MI-Q/MI-R (ref int/a-correctness-register). Part I is UNCHANGED.
extends: docs/operating-model/EMPLOYEE-ENGINEERING-IMPLICATIONS.md (EI-01 … EI-45)
---

# OWNERSHIP IMPLEMENTATION DECOMPOSITION

**OBSERVED AT: `64008d5a`.** Every claim below carries a `file:line` read at that commit.

> ## EVERY ITEM BELOW CARRIES `IMPLEMENTATION STATUS = NOT AUTHORIZED`.
>
> **This is not an implementation and not a design.** It is the smallest decomposition of work that
> becomes *possible* **after** the named Owner decision is answered. **No schema is proposed. No
> field, collection, index, command or migration is named as a thing to create. No generic `ownerId`
> is invented. Ownership handoff is NOT activated.**
>
> Where the honest content of an item is *"this cannot be decomposed further until `OD-n` is
> ruled"*, that is what the item says, and the item stops there.

> ## ⚠ READ PART II FIRST IF YOU ARE ACTING ON THIS DOCUMENT.
>
> **Part I below was written while `OD-1` and `OD-6` were both OPEN. Both are now RULED**
> (`docs/DECISIONS.md` **#180**, **#181**, **#182**, ref **`int/a-correctness-register`** — *not* on this
> branch, which ends at **#179**), along with `MI-N`, `MI-P`, `MI-Q`, `MI-R`. **PART II (§12 onward)
> reassesses all 29 items, re-derives the Area A boundary from 6 to 9, splits Area B into two
> references, and adds `OI-30`…`OI-42`.** Part I is retained **verbatim** and carries forward markers.
> **One Part I ARGUMENT is CONTRADICTED — see §12.2a and correction X-10.**

**Relationship to the 45 existing entries.** `EMPLOYEE-ENGINEERING-IMPLICATIONS.md` records **what is
missing** (EI-01 … EI-45). This document records, for five of those areas only, **what the work
decomposes into and in what order**, plus the **behaviour contracts** and **acceptance proofs** that
register does not carry. Each item names its EI parent. **No EI row is restated and no EI row is
renumbered.** Items are `OI-nn` to keep the two registers joinable without collision.

---

## 0. MEASURED BASELINE — the arithmetic every area below rests on

All re-derived from source at `64008d5a`, not carried forward.

| Fact | Measured value | Method / evidence |
|---|---|---|
| Matrix families, total | **51** | `ownershipMatrix.ts` — 21 explicit rows (`family: "` × 21) + 30 rows from 4 spread blocks (`:170-196` financial ×5, `:300-320` roots ×2, `:470-490` reference ×6, `:527-551` excluded ×17) |
| OWNABLE families | **27** | `ownableFamilies()` `:574-578` = PERSON ∪ COMPANY ∪ PARTICIPATING_COMPANIES |
| — PERSON | **6** | account `:119`, contact `:127`, location `:134`, opportunity `:142`, salesAgreement `:155`, salesOrder `:163`. **All six are commercial.** |
| — COMPANY | **20** | 13 explicit + 7 spread (invoice/payment/paymentApplication/invoiceAdjustment/refund `:180-185`; warehouse/mobileLocation `:310-311`) |
| — PARTICIPATING_COMPANIES | **1** | transferOrder `:447-448` |
| REFERENCE / EXCLUDED | **7 / 17** | `:470-490` + supplier `:500`; `:527-551` |
| Ownable families with `ownerFields: []` | **6** | workOrder `:249`, reorderRequest `:288`, supplierCompanyTerms, inventoryAction, purchaseOrder, reorderPurchaseOrder + the 5 financial + 2 roots carry `[]` in their spread bodies — **see §0a** |
| `functions/src/index.ts` ownership references | **0** | `grep -c "ownership\|Ownership" functions/src/index.ts` → `0` |
| Live modules importing `stageAuditEvent*` | **41** | `grep -rln "stageAuditEvent" --include=*.ts functions/src \| wc -l` → `41`. **This is the reachability surface of the unvalidated `OWNERSHIP_HANDOFF` action.** |
| Matrix accessors with zero references anywhere (src, scripts **and** tests) | **3** | `participatingCompanyFamilies` `:565`, `transferableFamilies` `:570`, `familiesWithoutBackfillSource` `:581` |
| Matrix accessors dead in the product but test-exercised | **1** | `crossCompanyFamilies` `:575` — referenced only at `functions/test/ownershipModel.test.mjs:31,212` |

### 0a. Contested counts, carried both ways per the lane contract

| Claim | Reading A | Reading B | This lane's position |
|---|---|---|---|
| "11 of 13 stored company fields are write-only" | **OWN-E2E**: 11/13 | **OWN-DESIGN** contests the denominator (conflict `E-4`) | **Not re-measured here** — outside the five areas. Carried as an input, both readings intact. It does not load-bear on any `OI-nn` item. |
| "four matrix accessors are dead exports" | Dead in the **product**: 4 | Dead **everywhere**: 3 | **Both true of different questions.** Product reachability = 4; absolute = 3 (`crossCompanyFamilies` is asserted by a test). Recorded as a correction, §9. |
| `reorder_requests.currentOwner` is an ownership field | **Client** says yes: `field-ops-app-vite/src/domain/inventoryReorderRequests.js:225` — *"ownership field -- `currentOwner` stays role-level"* | **Matrix** says no: `ownershipMatrix.ts:286` — *"`currentOwner` the role queue. Untouched, and still not ownership"*, and `:288` declares `ownerFields: []` | **The matrix is the authority** (`ownershipCensus.ts:12-14` makes it the census's own family declaration), **and a third witness settles it independently**: in R1's own `allow update`, `firestore.rules:768` moves the baton to `PARTS_MANAGER` in a write naming **no person**, and `:796`/`:812`/`:852`/`:903`/`:956` pin it unchanged. A field that moves between roles with nobody present is a **queue position**. So this is a **vocabulary collision between two shipped authorities**, not an ownership transfer. It changes the *gap class* of `OI-12` — §9 **X-1**, **X-2a**; detail at §3.1a. |

---

## 1. AREA A — ACCOUNTABLE PERSON: the minimum-domain boundary

**Parent: EI-01.** EI-01 establishes that no accountability axis exists. This section answers only the
question EI-01 does not: **for how many domains must it exist before the invariant holds for
actionable work?**

### 1.1 The test, stated before it is applied

A family is in the minimum set **iff all three hold**. Each clause is decidable from shipped code, so
the boundary is measured rather than judged.

| | Clause | Why it is the right cut | Discriminator in code |
|---|---|---|---|
| **T1** | The family is **OWNABLE** in the matrix | REFERENCE and EXCLUDED are *"excluded from the invariant by classification, not by omission"* (`ownershipMatrix.ts:109`). Putting an accountable person on a part number would be the invented convention ruling D-8 forbids. | `ownableFamilies()` `:574-578` → 27 |
| **T2** | The family stores a **non-terminal lifecycle state** — the record can be *open*, meaning the business carries an outstanding obligation on it | This is what "**actionable** operational item" means, and it is the clause that does the real narrowing. A ledger posting, a balance, a place, and a set of terms have nothing outstanding; asking who is accountable for an `inventory_transactions` row is asking who is accountable for a fact. | a declared status vocabulary with ≥1 non-terminal member |
| **T3** | Discharging that obligation requires a **person** act, and **no person-valued field on the record already names that person** | If a person-valued owner already exists, the invariant is satisfiable by making that owner *resolvable and able to act* (Area B) rather than by adding a third axis. Adding an axis where one already answers would be the collapse `OD-1` option (c) warns about, arriving by the back door. | presence of a matrix `ownerType: USER` field |

### 1.2 T2 applied to the 20 COMPANY families

| Family | Status vocabulary | Evidence | Non-terminal states exist? |
|---|---|---|---|
| workOrder | 11 statuses, 8 non-terminal | `transitionEngine.ts:39-51`, `TERMINAL_STATUSES` `:53-57` | **YES** |
| workOrderLegacy | `open / assigned / in_progress / complete` | `firestore.rules:367,381,384` | **YES** (legacy domain) |
| reorderRequest | 10 statuses; 6 non-terminal | `eosOps/purchasingRepository.ts:67-71` | **YES** |
| receivingOrder | `EXPECTED / CHECKED_IN / PUTAWAY_COMPLETE / CANCELLED` | `inventoryReceiving/receivingTypes.ts:22` | **YES** |
| cycleCount | `OPEN / COUNTED / RECONCILED / REJECTED / CANCELLED` | `cycleCount/cycleCountTypes.ts:39` | **YES** |
| purchaseOrder | `DRAFT / APPROVED / SENT / RECEIVED / CANCELLED`; the repo names the open set explicitly | `types/procurement.ts:24`; `inventory/partBalanceReadService.ts:269` `OPEN_PURCHASE_ORDER_STATUSES` | **YES** |
| reorderPurchaseOrder | shares the reorder chain | `purchasingRepository.ts:67-71` | **YES** |
| invoice | `ISSUED / PARTIALLY_PAID / PAID / VOID` | `finance/paymentCommands.ts:66,81-87` | **YES** |
| payment · paymentApplication · invoiceAdjustment · refund | postings, no lifecycle | `ownershipMatrix.ts:180-185` `transfer: IMMUTABLE`; `finance/adjustmentCommands.ts:88-101` treats them as events on an invoice | **NO** |
| inventoryTransaction | append-only ledger | `firestore.rules:530-535` `create, update, delete: if false` | **NO** |
| inventoryAction | create-only record | `access/permissionCatalog.ts:579` *"Create an inventory_actions record"*; no status vocabulary found | **NO** |
| stockLocation | a warehouse+part **balance**, not a place or a task | `ownershipMatrix.ts:82` (derivation note), `:328` | **NO** |
| truck · equipment · warehouse · mobileLocation | asset / place registries with an ACTIVE-INACTIVE-RETIRED style status, not an obligation | `firestore.rules:1404` `equipmentStatusValid`; `warehouseStatusWriter.ts:202` | **NO** |
| supplierCompanyTerms | terms | `ownershipMatrix.ts:376-377` | **NO** |

**8 of 20 COMPANY families pass T2.** `transferOrder` also passes (`REQUESTED / IN_TRANSIT /
COMPLETED / CANCELLED`, `inventoryTransfer/transferOrderTypes.ts:22`). **12 of 20 fail.**

### 1.3 T3 applied — and why the 6 PERSON families are OUT

| Family group | T3 verdict | Consequence |
|---|---|---|
| opportunity, salesAgreement, salesOrder | **FAILS T3** — `ownerEmployeeId` already names one employee, and `ownershipMatrix.ts:88` states its meaning as *"sales ownership, who is responsible commercially"* | These three are **actionable** and **already have a named person**. The invariant fails for them **only because that person may not exist or may not be able to act** — which is Area B, not a new axis. |
| account, contact, location | **FAILS T2 as well** — master records, no lifecycle. `accounts` has an ordinary editable `status` (`AccountDetail.jsx:806`) but no outstanding-obligation state | Out on both clauses. |

**This is the boundary's sharpest edge, and it must be argued rather than asserted:** adding an
accountability axis to the commercial chain would create a **second** person-valued field beside one
that already claims the same meaning, on records where `ownershipMatrix.ts:88-93` has already ruled
that two independent facts on one record is legitimate **only when the two facts are of different
kinds** (person ownership vs company scope). Two person facts of the same kind is exactly the
ambiguity `combineOwnerDerivations` `typedOwner.ts:151-159` exists to refuse. **So the commercial
chain is satisfied by Area B and must not be satisfied by Area A.**

> **⚠ POST-RULING MARKER (added 2026-09-13).** **THIS PARAGRAPH IS CONTRADICTED — by `#181` (which rules the accountable person a SEPARATELY
> CARRIED fact on these three families, so the two facts are of DIFFERENT kinds) and by code
> (`combineOwnerDerivations` refuses CONFLICTING IDENTITY, not "two facts of one kind", and its only
> production caller is fed exclusively from `family.ownerFields`). Original text retained; see
> **PART II §12.2a** and correction **X-10**. The three commercial families are IN the minimum set.**

### 1.4 The minimum set

| Tier | Families | Count | Why this tier |
|---|---|---|---|
| **IRREDUCIBLE CORE** | `workOrder` · `reorderRequest` · `receivingOrder` · `cycleCount` · `invoice` | **5** | Pass T1+T2+T3. Each is open work that a counterparty (customer, supplier, auditor) is waiting on, and none carries any person-valued field. `workOrder` is measured `0/30` with `ownerFields: []` (`ownershipMatrix.ts:249,253`). `reorderRequest` already carries a **role-valued** baton (`currentOwner`) — *an accountability slot with no person in it*, which is the clearest statement of the gap in the repository. |
| **+ THE PAIR-OWNED FAMILY** | `transferOrder` | **1** | Passes T1+T2+T3 and is the family that **proves** accountability must be orthogonal: its ownership shape *is* two participants (`ownershipMatrix.ts:448`, `classifyDocument` `ownershipCensus.ts:106-124`), so no owner field can ever be made to carry an accountable person here, in any modelling. If the axis is not orthogonal, this family cannot be represented at all. |
| **MINIMUM SET** | | **6** | |
| CONTESTED ADJACENT — *not* in the minimum, and each for a stated reason | `purchaseOrder` (liveness contested — run item `MI-14`, *"is `purchase_orders` live or superseded"*) · `reorderPurchaseOrder` (`ownershipMatrix.ts:425` — *"Reaches a root only through its Reorder Request… A two-hop derivation over a broken first hop is not a derivation"*; accountability plausibly inherits from `reorderRequest`) · `workOrderLegacy` (`ownershipMatrix.ts:256` — *"THE LEGACY SERVICE DOMAIN"*; whether legacy jobs are still worked is not established by any lane) | **3** | Would raise the operational envelope to **9**. Each needs one factual answer, not a model decision. |

**6 of 27 ownable families — 6 of 51 total.** Not all 27, and **not** the 20 COMPANY-owned families
that EI-01 names as the need's source: **12 of those 20 fail T2** and one of the 6 is not COMPANY-owned
at all.

> **⚠ POST-RULING MARKER (added 2026-09-13).** **SUPERSEDED: the re-derived minimum is 9 of 27 / 9 of 51, envelope 12, and FOUR of the 9 are not
> COMPANY-owned. T3 is a NULL CLAUSE at this baseline. → PART II §12.2c.** Original retained.

### 1.5 The boundary's own precondition

The set says **where** the axis must exist. It does not make it **populatable**:

| Precondition | State at `64008d5a` | Consequence for A |
|---|---|---|
| Someone occupies a governed Role | **ZERO** holders of any of 45 governed Roles (committed census `be1e5579`, ancestor of main) | An accountable person could be declared and never named |
| A job-role vocabulary exists | **NONE** — five disjoint vocabularies, `jobTitle` free text, `SERVICE_MANAGER` has no consumer under **any** of the four contested readings | The axis cannot be *resolved to a job* even once occupied |

**These are independent prerequisites; the grant closes only half the gap.** So the 6-family boundary
is a **design boundary that cannot be delivered against today**, and saying so is part of the answer.

---

## 2. AREA B — the person resolution contract

**Parent: EI-02. Gated by `OD-6`.** A **behaviour specification**. No field, no collection, no shape.

### 2.1 The measured defect, restated precisely enough to contract against

| Resolver | Reads the person authority? | Evidence |
|---|---|---|
| `deriveAccountOwner` | **NO** — reads `accountDoc.accountOwner.assignedToEmployeeId`, checks non-empty string, returns `RESOLVED` | `typedOwner.ts:95-109` |
| `deriveEmployeeRefOwner` | **NO** — reads one field, checks non-empty string, returns `RESOLVED` | `typedOwner.ts:112-125` |
| `deriveCompanyOwner` | **EXISTENCE only** — calls `resolveOperatingCompany(value)` and returns `UNRESOLVED/UNKNOWN` when the id *"names no seeded company"*. **It does NOT report standing** — see §2.1a | `typedOwner.ts:131-144`, esp. `:139` |
| `deriveStoredOwner` | **COMPANY existence half only** — *"storage does not confer governance"* for a COMPANY owner; a `USER` owner is shape-checked and returned | `typedOwner.ts:196-209`, esp. `:205-208` |

**The asymmetry is documented, deliberate, and load-bearing.** `typedOwner.ts:45-48` states it:
*"Producing UNKNOWN for an employee id would require a cross-collection existence lookup, which Owner
ruling O-1 explicitly excluded… So a USER family's UNKNOWN count is structurally zero, not merely
empty."* Any contract here **revisits ruling O-1 and must say so out loud.**

**And the blindness is provable at the gate arithmetic, not only at the derivation.** A person orphan
returns `RESOLVED` (`typedOwner.ts:108`, `:124`); `censusBucket` maps `RESOLVED` → `"resolved"`
(`ownershipCensus.ts:81-82`); `censusGate` computes
`blocking = ownerless + invalid + unknown + ambiguous` (`:231`) and
`assessable = blocking === 0 && unreadable.length === 0 && truncated.length === 0` (`:240`).
**A person orphan increments none of the four terms, so it cannot make `assessable` false by any
quantity.** The gate is not merely under-informed — **it is arithmetically incapable of being blocked
by a person orphan**, and that is a stronger and separately-testable statement than "the derivation is
shape-only".

### 2.1a The COMPANY axis is a WEAKER precedent than it appears — do not model the person contract on it

This must be stated before the contract, because getting it wrong would import a defect.

| Fact | Evidence |
|---|---|
| The company authority **does** model inactivity: `OperatingCompanyResolutionState = "INVALID" \| "UNKNOWN" \| "INACTIVE" \| "RESOLVED"`, and `resolveOperatingCompany` **returns** `INACTIVE` for a seeded-but-inactive company | `operatingCompanyAuthority.ts:54`, `:80` |
| `deriveCompanyOwner` handles **only** `INVALID` and `UNKNOWN`. `INACTIVE` **falls through to the `RESOLVED` return** and is **discarded** — it never becomes an `OwnershipResolution`, never becomes a `code`, and never becomes a distinguishing `reason` | `typedOwner.ts:137-143` |
| So the fact is **computed by one module and thrown away by the next**, and the census therefore cannot report an inactive company owner either | `ownershipCensus.ts:165-173` passes `deriveCompanyOwner`'s output straight to `combineOwnerDerivations` |
| The discard is currently **invisible**, because both seeded companies are `active: true` | `operatingCompanyAuthority.ts:42`, `:48` |

**Therefore:** the COMPANY axis is a precedent for the **resolution rule** (an owner who cannot act
still *has* an owner — `typedOwner.ts:128-130` argues it explicitly and correctly) but it is **NOT** a
precedent for **reporting** that fact. It has **existence** integrity, not **active-status** integrity.
**Specifying the person contract as "match what COMPANY already does" would copy the discard**, and the
person axis is exactly where the discard cannot be tolerated, because a terminated employee is the
common case whereas an inactive operating company is currently unreachable. **The four person states
are therefore specified below on their own terms.** *(This also surfaces a defect on the company axis
itself — recorded as correction **X-8**, §9.)*

### 2.2 The contract

Expressed as obligations on a resolution *behaviour*, not on a resolver *implementation*.

**C-B1 — It must consult the person authority.** The authority is the one the matrix already names:
`employees`, classified EXCLUDED as *"person authority -- a subject of ownership, not an object"*
(`ownershipMatrix.ts:533`). Consulting it is the entire change; everything else below is about what it
must then *say*.

**C-B2 — It must verify it is asking about the same namespace.** `typedOwner.ts:4-5` records that the
`USER` id namespace being the canonical Employee id is **open item O-1**, not a settled fact. So the
contract requires: **if the stored owner id's namespace cannot be shown to be the authority's key
namespace, the outcome must be a distinct "cannot ask" outcome — never a lookup miss.** A namespace
mismatch reported as "employee does not exist" would manufacture orphans at exactly the scale of the
mismatch, and it would look like a data problem.

> **⚠ POST-RULING MARKER (added 2026-09-13).** **`C-B3` is REFINED AND SPLIT ACROSS `#182`'s TWO LAYERS: A-vs-C in the resolver, A-vs-B in the
> census/gate. TERMINATED's reason (2) (the backfill proxy) is DISCHARGED BY RULING. Part I's
> "nowhere to live in `OwnerDerivation`" obstruction is DISCHARGED. Three readings of the TERMINATED
> row are carried, none resolved. → PART II §12.3.** Original retained below.

**C-B3 — The four states, and what each must return.** Stated **on their own terms**, not by analogy to
the company axis (§2.1a). The column headings are the existing ones (`OwnerDerivation` = resolution +
reason + code, `typedOwner.ts:52-57`), so no new *reporting* vocabulary is created — but the fifth row
requires something the existing shape cannot express, and that is said rather than hidden.

| Person state | Required resolution | Required code | Required reason distinctness | Why this, on its own terms |
|---|---|---|---|---|
| **ACTIVE** | `RESOLVED` | `null` | — | The ownership fact is true and the owner can act. The only case today's behaviour gets right. |
| **NON-EXISTENT** (well-formed id, authority knows nothing) | `UNRESOLVED` | **`UNKNOWN`** | *"names no employee"* | The record claims an owner that does not exist, so there **is no ownership fact** — which is what `UNRESOLVED` means. `UNKNOWN` rather than `INVALID` because nothing is malformed (`typedOwner.ts:38-41` defines the split). **This is the clause that reverses `O-1`'s "structurally zero".** |
| **DELETED** (existed, no longer does) | `UNRESOLVED` | **`UNKNOWN`**, **unless** the authority retains a tombstone, in which case a distinct reason | separate reason **only when the authority can actually distinguish it**; **otherwise the census must not claim to have** | Honest absence. If the authority cannot tell "deleted" from "never existed", a resolver reporting two states is reporting a fact it does not have. **Whether a tombstone exists is `U-10` — unproven here.** |
| **TERMINATED** (exists, employment ended) | **`RESOLVED`, and separately reported as not actionable** | `null` | *"owner is terminated"* | Two independent reasons, neither borrowed: **(1)** the ownership fact is *true* — this record **is** owned by that person, and history does not change because employment ended; **(2)** `UNRESOLVED` is the input a backfill acts on, so classifying a terminated owner as unresolved would **invite a reassignment**, and **reassignment is not a handoff** (preserved invariant). `typedOwner.ts:128-130` reaches the same conclusion for companies and its *reasoning* is sound; **its implementation discards the fact (§2.1a) and must not be copied.** |
| **INACTIVE** (exists, currently cannot act — leave, suspended, not yet started) | same resolution as TERMINATED | `null` | *"owner is inactive"*, **distinct from terminated** | Same resolution because the ownership fact is identical; **different reason because the remediation is opposite** — one owner returns, one never does. Folding them would tell an administrator to hand off a record whose owner is back on Monday. |
| **AUTHORITY UNREADABLE** (the lookup failed) | **a distinct outcome that is neither `RESOLVED` nor any person state** | — | *"person authority unreadable"* | The **answer to ruling `O-1`'s stated objection** — `O-1` objected to *"a fallible cross-collection lookup into otherwise deterministic ownership resolution"*. Making the failure an **outcome** rather than an exception preserves determinism and totality for the price of one state, not for the price of correctness. **It must never degrade to `RESOLVED`, which is today's effective behaviour.** |

**Note the shape consequence, stated because it is the one place the existing vocabulary is
insufficient:** TERMINATED and INACTIVE both require `RESOLVED` **plus** a not-actionable fact.
`OwnerDerivation` (`typedOwner.ts:52-57`) has no place to put that — `code` is documented as `null` on a
`RESOLVED` outcome (`:42-43`). **How it is carried is a shape question and `OD-6` gates it.** What the
contract fixes is that it must be carried *somewhere a census column can read*, and must **not** be
smuggled into the free-text `reason`, which is tallied but never branched on
(`ownershipCensus.ts:191-195`).

**C-B4 — It must not write, and must not choose.** A measurement change, not a backfill (`OD-6`'s own
recommendation). It may never fall back to a manager, a creator, an actor, a territory, coverage,
activity, sales history, or an auth uid — the proxies ruling D-6/D-11/D-12 forbid and
`ownershipMatrix.ts:44-47` enumerates.

**C-B5 — It must be total and deterministic.** Every input yields exactly one outcome. No throw, no
`undefined`. Because it now reads a second collection, it must either read both within one
snapshot/transaction or **declare the read non-atomic in what it reports** — a resolution that mixes a
record from time *t* with an authority from time *t+1* is not deterministic and must not be presented
as such.

**C-B6 — What the census must report.** Per family, using the existing shapes
(`CensusCounts`/`ReasonTally`/`samples`, `ownershipCensus.ts:43-67`):
1. the **new outcomes as their own counts**, never folded into `resolved`;
2. **owner-cannot-act** as a reported quantity distinct from every existing bucket;
3. `AUTHORITY UNREADABLE` must **block the gate**, by the precedent already in the file: *"A family
   that could not be READ blocks the gate too… would let enforcement be enabled over records nobody
   managed to look at"* (`ownershipCensus.ts:213-216`);
4. whether **owner-cannot-act** blocks the gate must be a **declared constant with a stated
   rationale**, not an emergent property of the `blocking` sum at `:231`. The lane's reading is that it
   must block — the gate's own purpose is *"enforcement may be assessed only when NOTHING is
   outstanding"* (`:212`) and an owner who cannot act is outstanding — **but this is `OD-6`'s call, and
   the contract's requirement is that the choice be visible in one named place rather than implicit in
   an addition.**

**C-B7 — Parity.** `typedOwner.ts:1-8` declares itself the *"trusted-side mirror of the client
authority `field-ops-app-vite/src/domain/typedOwner.js`"*, with parity *"asserted by
`test/typedOwner.test.mjs` against the same canonical case table"*. **Any contract change that lands on
one side and not the other breaks a shipped invariant.** The client cannot perform a trusted
cross-collection read, so the contract must say which side owns the new outcomes and what the other
side is then required to render — and it must NOT be resolved by having the client guess.

---

## 3. AREA C — the complete reassignment-touches-ownership census

**Parents: EI-04, EI-44.** *Every shipped location where reassignment changes, or can change,
ownership.* "Can change" is included deliberately: an unconstrained write path is a defect before
anybody builds a surface for it.

### 3.1 The census

`OWNER FIELD?` = is the field a matrix-declared `ownerFields` entry.

| # | Site | `file:line` | Field(s) moved in one write | OWNER FIELD? | Path | Recorded in the audit trail as | Class | Tier |
|---|---|---|---|---|---|---|---|---|
| **R1** | `reorder_requests` **Assign** branch — **and only that branch** (see §3.1a) | `firestore.rules:776-789`, `hasOnly` at `:789` = `["status","currentOwner","assignedToUserId","assignedBy","assignedAt"]`; client writer `field-ops-app-vite/src/domain/inventoryReorderRequests.js:227-239` | `currentOwner` (**role-valued**: `"PARTS_ASSOCIATE"`, `:779`) **+** `assignedToUserId` (**person**, `:780-781`) | **NO** — `ownershipMatrix.ts:288` `ownerFields: []`; `:286` *"`currentOwner` the role queue. Untouched, and still not ownership"* | client-direct, Rules-enforced | **nothing** — no audit event on this path at all | **AUTHORITY GAP + vocabulary collision.** A responsibility baton and a person assignment move in one write with no separate authority and no trail. **Not** an ownership transfer under the matrix — see §9 **X-1** | **TIER-2** |
| **R2** | `fieldops_jobs` admin/dispatcher update | `firestore.rules:381-384` — constrained **only** by `isValidJobTransition(before, after)`; **no `affectedKeys().hasOnly(...)` on this branch** (the `hasOnly(['status'])` allowlist at `:377` applies to the *technician* branch only) | `operatingCompanyId`, in the **same write** as any valid status/assignment transition | **YES** — `ownershipMatrix.ts:268`, `transfer: "HANDOFF"`, measured **41/45 RESOLVED** (`:271`) | client-direct | **nothing** | **AUTHORITY GAP — a genuine "a lifecycle/assignment change can carry an ownership change" site, on a family whose owner field is real and populated** | **TIER-2** |
| **R3** | `accounts` update | `firestore.rules:1335-1337` (guards `paymentTerms`/`taxStatus` only); writer `field-ops-app-vite/src/domain/accounts.js:82-89` (arbitrary patch); **shipped owner-picker** `modules/accounts/AccountForm.jsx:470` submitting `accountOwner` at `:226`, reached from `AccountDetail.jsx:463` | `accountOwner` | **YES** — `ownershipMatrix.ts:120`, `transfer: "HANDOFF"`, *"The root of the person-owned inheritance chain"* `:124` | client-direct | **nothing** | **AUTHORITY GAP — the only shipped surface in EOS that reassigns a matrix-declared owner, and it does so with no handoff vocabulary, no `previousOwner`, and no event** | **TIER-2** |
| **R4** | `contacts` update | `firestore.rules:1557` (`create, update: if isAdminOrDispatcher()`, no field guard); writer `field-ops-app-vite/src/domain/contacts.js:40-45` spreads `...data` | `owner` | **YES** — `ownershipMatrix.ts:128` | client-direct | **nothing**; and `domain/contacts.js:14-22` states the actor/timestamp are *"CLIENT-SUPPLIED CLAIMS, not server-verified provenance"* | **AUTHORITY GAP — *can* change. No shipped surface writes `owner` today** (EI-44: written only in Postgres) | **TIER-2** |
| **R5** | `locations` update | `firestore.rules:1343` (`create, update: if isAdminOrDispatcher()`, no field guard); writer `field-ops-app-vite/src/domain/locations.js:22-24` spreads `...data` | `owner` | **YES** — `ownershipMatrix.ts:134` | client-direct | **nothing** | as R4 | **TIER-2** |
| **R6** | `updateOpportunity` | `opportunityCommands.ts:244` (`ownerEmployeeId` ∈ `EDITABLE_OPPORTUNITY_FIELDS`), applied `:312-318` through the **generic `record()`** helper; audited `opportunityCallables.ts:337-350` | `ownerEmployeeId` | **YES** — `ownershipMatrix.ts:142`, `transfer: "HANDOFF"` | **governed callable**, version-checked, Rules-closed (`firestore.rules:1740-1741` `read, write: if false`) | `action: "updateOpportunity"` with a `summary` of **changed field NAMES only** (`:343-349` states the contract limit). **No `previousOwner`, no `newOwner`, no `handoffSource`** — and `auditEventWriter.ts:571-581` **actively refuses** those four fields on any non-handoff action, while `:532-535` refuses `objectId` too | **CORRECTNESS GAP.** Authority is correct; the **trail cannot answer "who owned this before"** for the one family whose ownership the product can actually move through a governed path | normal |
| **R7** | `assignAccountOwner` | `functions/src/crm/customerRepository.ts:182-202` — *"the ONLY way one is ever set after creation"* (`:176`) | `owner_employee_id` (**PostgreSQL**, `eos_crm`) | the PG mirror of R3 | **unreachable**: no callable, no UI; only caller is `functions/test/crmCustomerPostgres.test.mjs:328` | **nothing** — no `stageAuditEvent` call in the function | **ENGINEERING GAP.** The correct setter exists, writes a different datastore from the one R3 mutates, is exposed by nothing, and emits no event. **EI-44's datastore-target question is a precondition to touching it.** | normal |
| **R8** | `stageOwnershipHandoff` via the offline CLI | `functions/scripts/assignWarehouseRootCompany.js:72` (require) and `:234` (invoke); input built by `ownership/warehouseRootCompanyAssignment.ts:373-391` | `warehouse` first company assignment (`previousOwner: null`) | **YES** | offline Node CLI over compiled `lib/` | **`OWNERSHIP_HANDOFF`, correctly, through the builder** | **The only correct path in the repository.** It is the existence proof that the builder-mediated path works — and the reason *"nothing calls the handoff"* is **false** while *"no product path calls it"* is **true** | n/a |

**Census totals: 8 sites. 5 TIER-2 (R1–R5). 1 correctness (R6). 1 unreachable-correct-setter (R7).
1 correct (R8).** Of the 5 Tier-2 sites, **4 move a matrix-declared owner field** (R2–R5) and **1 does
not** (R1).

### 3.1a The adjacent branch is a COUNTER-EXAMPLE, not part of R1 — verified line by line

A received citation of `firestore.rules:765-790` sweeps two branches of one `allow update` into one
finding. **They are opposites, and conflating them overstates the defect's breadth.** Read at
`64008d5a`:

| Lines | Branch | Moves `currentOwner`? | Moves an assignee? | What it is |
|---|---|---|---|---|
| `763` | `allow update: if` | — | — | the statement head |
| **`764-775`** | **Approve/Reject** — `isAdminOrDispatcher()` only (`:764`) | **YES** — to `"PARTS_MANAGER"` on approve (`:768`), or held equal on reject (`:771`); in the `hasOnly` at `:773` | **NO** — the `hasOnly` at `:773` is `["status","reviewDecision","reviewedBy","reviewedAt","reviewNotes","currentOwner"]`, which contains **no assignee field of any kind** | **THE COUNTER-EXAMPLE.** The baton moves with **no person named at all** |
| **`776-789`** | **Assign** — `isAdminOrDispatcher() \|\| isActiveOperationalRole("PARTS_MANAGER")` (`:776`) | **YES** — to `"PARTS_ASSOCIATE"` (`:779`) | **YES** — `assignedToUserId`, `assignedBy`, `assignedAt` (`:780-783`), all in the `hasOnly` at `:789` | **R1. The coupling site, and the only one.** |
| `790+` | Start Purchasing, and every later branch | **NO** — each pins `request.resource.data.currentOwner == resource.data.currentOwner` (`:796`, `:812`, `:852`, `:903`, `:956`) | — | further counter-examples: the baton is **explicitly frozen** |

**My reading agrees with the sibling lane, with one refinement it should carry:** the counter-example
branch begins at **`764`**, not `765`. Line `763` is `allow update: if` and `764` is
`( ( isAdminOrDispatcher() // Approve/Reject` — `765` is that branch's *second* clause
(`resource.data.status == "PENDING_REVIEW"`). So the accurate pair is **`764-775` (counter-example)** and
**`776-789` (defect)**. Neither `765-790` nor `765-775` names a branch boundary.

**And the counter-example strengthens X-1 rather than merely narrowing R1.** At `:768` the baton moves
to `PARTS_MANAGER` in a write that names **no person**, and at `:796`ff it is frozen by identity. A
field that moves between **roles** with no person present, and is pinned unchanged across five later
transitions, is **a workflow queue position** — which is exactly what `ownershipMatrix.ts:286` calls it.
**The Rules file demonstrates, in its own adjacent branches, that `currentOwner` is not person
ownership.** So R1 is a coupling defect on a baton, not an ownership-transfer defect, and the site where
that ruling **is** violated is **R2** (`fieldops_jobs`).

### 3.2 Negative controls — reassignment that provably does **not** move ownership

These are not commentary. Each is a **shipped pattern the fixes must copy**, which is what makes R1–R6
decomposable without new design.

| # | Site | `file:line` | What it proves |
|---|---|---|---|
| **N1** | `equipment` client edit | `firestore.rules:1396-1401` (`equipmentEditableKeys()` — **`operatingCompanyId` is absent**) enforced at `:1543` `affectedKeys().hasOnly(equipmentEditableKeys())` | A COMPANY-owned `HANDOFF` family **already has** its owner field made structurally unwritable by a client edit, in Rules, in this file. **R2–R5 are mechanically closable by the pattern next to them.** |
| **N2** | Dispatch reassignment | `transitionWorkOrder.ts:302-303` (refuses without `reassignReason`), `:381-384` (writes `reassignedFromTechId`/`At`/`Reason`/`ByUid`), `:387-391` (stages its **own** `reassignWorkOrderTechnician` audit event in the same transaction) | The **assignment-reassignment exemplar**: reason required, prior holder recorded, its own event, and **it touches no owner field.** |
| **N3** | `rescheduleWorkOrder` | `scheduling/schedulingCommands.ts:225-240` (moves `scheduledTechId`, records `rescheduledFromTechId`), `:242-256` (audit event carries the prior technician and window, *"without this line nothing anywhere would remember the old ones"*), `:239` (*"status is deliberately NOT written"*) | A person-reassignment already ships with the exact discipline R3/R6 lack. |
| **N4** | Warehouse governance migration | `warehouseGovernanceMigration.ts:178-188` (ruling R-18) — a whole-document replace that **explicitly preserves** `operatingCompanyId`, with the failure it prevents written out | Ownership-preservation through a destructive rewrite, done right. |
| **N5** | `salesAgreement` draft edit | `salesAgreementCommands.ts:456-478` — the editable set **omits** `ownerEmployeeId` **and** `operatingCompanyId`, with `:460-463` stating why | **The decisive contrast to R6.** Three sibling PERSON commercial families: `salesAgreement` forbids the owner edit, `salesOrder` has no update command at all, and **only `opportunity` permits it** — through the generic helper. The inconsistency is internal to one chain. |
| **N6** | `warehouseStatusWriter` | `warehouseStatusWriter.ts:202` — `{ ...current, status, version, updatedAt, updatedBy }` | A status change that carries the company through untouched. |
| **N7** | `reorder_requests` **Approve/Reject** and the five later branches | `firestore.rules:764-775` (baton moves, **no assignee in the `hasOnly` at `:773`**); `:796`, `:812`, `:852`, `:903`, `:956` (baton **pinned** `== resource.data.currentOwner`) | **In the same `allow update` as R1**: `currentOwner` moves between roles with **no person named**, then is frozen across five transitions. **The Rules file proves `currentOwner` is a queue position, not person ownership** — §3.1a, and the basis of **X-1**. |

### 3.3 Why every R1–R5 fix is TIER-2 and must not ride along

`firestore.rules` is **hash-anchored to the live deploy** and its change procedure is a separate
authority (`verify-rules-deploy`: Tier-2 authorization, dual-copy parity, deploy-and-verify). A
Rules narrowing **cannot** be smuggled into a correctness change: the correctness change would merge
and the narrowing would sit undeployed while the register claimed it was closed. **R6 (normal tier)
must therefore be separable from R1–R5 and must not be bundled with them.**

---

## 4. AREA D — the handoff wiring sequence

**Parent: EI-03. Gated by `OD-7`.** The requirement is that **no intermediate step can produce the
corruption the matrix exists to prevent.** That constrains the *order*, and the order is the
deliverable.

### 4.1 The gap, measured

| Fact | Evidence |
|---|---|
| All five family-level refusals live in the builder | `ownershipHandoffCommand.ts:90-95` `FAMILY_UNKNOWN`, `:101-106` `FAMILY_PARTICIPATING_COMPANIES`, `:110-115` `FAMILY_NOT_OWNABLE`, `:116-121` `FAMILY_IMMUTABLE`, `:129-134` `OWNER_TYPE_MISMATCH` |
| The builder is not exported from `index.ts` | `grep -c "ownership" functions/src/index.ts` → **0**; and `ownershipHandoffCommand.ts:9-11` says so itself |
| The **live** writer never imports the matrix | `auditEventWriter.ts:58` imports `isTypedOwner` from `../ownership/typedOwner` **only**; no `ownershipMatrix` import anywhere in the file |
| The live writer validates the handoff's **owner shape** but not its **family** | `auditEventWriter.ts:540-570` checks `isTypedOwner(newOwner)`, `previousOwner !== undefined`, no-op equality, `handoffSource` membership. **`targetType` is checked only for `!input.targetType \|\| typeof !== "string"` at `:470-472`.** |
| So the action is reachable, unvalidated, from every live audit caller | `OWNERSHIP_HANDOFF` ∈ `AUDIT_ACTIONS` (`auditEventWriter.ts:256`) and ∈ the `AuditAction` union (`types/access.ts:510`); **41 modules under `functions/src` import `stageAuditEvent*`** |
| A **second** family-validation authority already exists | `eosCommercial/commercialOwnershipAuthority.ts:33` imports `ownershipFamily`; `assertFamilyIsGovernedHere` at `:115-120` re-checks `ownerClass`/`ownerType` against the matrix. It is imported by `commercialOwnershipRepository.ts:35`, which is imported **only by tests** (`functions/test/commercialOwnershipPostgres.test.mjs:37`) |

### 4.1a A builder-mediated caller already exists and is exercised — this changes the prerequisite analysis

*"Nothing calls the handoff"* is **false**; *"no product path reaches it"* is **true**. The distinction is
not pedantry — it changes what W1 costs and how it is proved.

| Fact | Evidence |
|---|---|
| `stageOwnershipHandoff` has exactly **one** live caller | `functions/scripts/assignWarehouseRootCompany.js:72` (require), `:234` (invoke) |
| That caller routes through the **builder**, so it already passes all five family refusals | `:234` calls `stageOwnershipHandoff(txn, assignmentHandoffInput(d), { actorUid })`; `assignmentHandoffInput` is `ownership/warehouseRootCompanyAssignment.ts:373-391` |
| It **derives** `previousOwner` rather than accepting it — `null` for a first assignment (`:371-372`) | `warehouseRootCompanyAssignment.ts:371-391` |
| It already refuses the no-op case **before** reaching the handoff authority, because *"a handoff that moves nothing is not an event"* | `warehouseRootCompanyAssignment.ts:34-36`; `assignWarehouseRootCompany.js:205` |
| It is an **operator CLI over compiled `lib/`**, not a deployed function — so the matrix remains offline governance tooling | `assignWarehouseRootCompany.js:66-72` requires `../lib/...` |

**Three consequences for the sequence:**

1. **W1 has a positive control that exists today.** Its acceptance proof does not need a reference
   caller to be built first: the CLI is a working end-to-end example of a *correct* handoff, so W1 can
   be proven to refuse the bad cases **without** also proving it still admits the good ones in the
   abstract. *(Recorded in OI-19's proof.)*
2. **W1 can break a real caller, so the regression risk is real rather than theoretical.** Under both
   `OD-7` shapes the CLI should be unaffected — under (a) because `warehouse` is a governed
   `HANDOFF` family, under (b) because it routes through the builder. **That "should" is the thing W1's
   test must assert, not assume.**
3. **W4's "never accept `previousOwner` from a caller" is already satisfied by the one caller that
   exists**, and `assignmentHandoffInput` is the shape to generalise from. W4 is therefore a constraint
   on *future* callers, not a repair of the present one — which moves it later in risk order than the
   step numbering alone suggests.

### 4.2 The sequence, with the invariant each step establishes

Each step's invariant must hold **at the end of that step**, with nothing downstream assumed.

> **⚠ POST-RULING MARKER (added 2026-09-13).** **The ORDER below still holds and W5 does NOT move. `#180` invariant 7 ADDS a step (`W3′` →
> `OI-37`) and WIDENS W3, W4 and W6. → PART II §12.6.**

| Step | Action | Invariant it establishes | Gated by | Tier | Why it cannot be later |
|---|---|---|---|---|---|
| **W1** | Make the **live writer refuse** an `OWNERSHIP_HANDOFF` it cannot validate. `OD-7` chooses the shape: **(a)** the writer consults the matrix (`targetType` is a governed family, `ownerClass ∈ {PERSON, COMPANY}`, `transfer ≠ IMMUTABLE`, `newOwner.type === family.ownerType`), or **(b)** `OWNERSHIP_HANDOFF` is rejected at the writer unless the input demonstrably came from the builder | **No handoff event can exist in the trail naming a family the matrix does not govern.** | `OD-7` (shape only; **both shapes add refusals and neither enables a write**, so W1 does not depend on `OD-1`) | normal | Every later step *adds a caller*. Adding a caller before the writer refuses means the corruption window is open for the duration of the work — and the corruption is **written into an immutable store** (audit events are client-deny-all and append-only), so it cannot be cleaned up afterwards. **And W1 is not greenfield** — see §4.1a. |
| **W2** | Pin the chokepoint with a **ratchet test**: every module that can emit `action: "OWNERSHIP_HANDOFF"` routes through the single validated path, and the count of such modules is asserted | **The W1 refusal cannot be silently regained and then lost by a later change.** | — | normal | A refusal with no ratchet is a refusal until the next PR. Precedent: the ENG-B shim/bypass ratchet, and `ownershipMatrix.ts:97-100`'s existing R-1 source guard in `ownershipModel.test.mjs`. |
| **W3** | Land the **Area B** resolution contract | **A handoff can never move ownership to a person the system cannot prove exists and can act.** | `OD-6` | normal | Without B, a handoff **to a terminated employee validates cleanly** — the builder's `isTypedOwner` check (`:126-128`) is shape-only. Wiring a handoff before B makes the handoff a **mechanism for creating orphans under audit**, which is worse than no mechanism. |
| **W4** | If a server authority is exposed: `previousOwner` must be **read from the record inside the same transaction that writes the owner field**, never accepted from a caller | **`previousOwner` in the trail equals the record's value at commit.** | `OD-7` + `OD-1` | normal | The builder takes `previousOwner` from its caller (`ownershipHandoffCommand.ts:56-57`). For the offline CLI that is correct — `assignmentHandoffInput` derives it (`warehouseRootCompanyAssignment.ts:371-391`). For a **callable** it is a forgery surface: a client could file a truthful-looking handoff from an owner the record never had. |
| **W5** | Close the Area C client-direct owner-write paths (**R1–R5**) **before** any handoff authority is exposed | **There is exactly one path that changes ownership.** | `OD-8` | **TIER-2** | **This is the step that makes the sequence non-reorderable.** If the handoff ships while `updateAccount` still rewrites `accountOwner` client-direct, EOS has two ownership paths — one audited, one not — and that is **strictly worse than today**, because the audited path creates the false impression that the trail is complete. A reader would reconstruct ownership history from a trail that is silently partial. |
| **W6** | Activate: export from `index.ts`, expose a control | the model's own gate | `OD-7` + `OD-1` + `OD-8` + the census gate (`ownershipCensus.ts:218-241`, `assessable === true`) | mixed | **NOT AUTHORIZED. DO NOT ACTIVATE.** |
| **W0′** *(parallel, any time)* | Reconcile the **second** family-validation authority (`commercialOwnershipAuthority.assertFamilyIsGovernedHere`) with whichever W1 shape is chosen | **There is one family-validation authority, not three.** | `OD-7` | normal | `commercialOwnershipAuthority.ts:15-24` states the principle it would otherwise violate: *"the only thing two authorities can do that one cannot is disagree."* A W1 that ignores this file creates the third. |

### 4.3 The orderings that are unsafe, stated so they cannot be chosen by accident

| Unsafe order | The corruption it produces |
|---|---|
| W6 before W1 | The `"notAFamilyAtAll"` acceptance becomes a production write path. **This is the shortest path and it is the one the matrix was written to prevent.** |
| W4/W6 before W3 | Handoffs to non-existent or terminated employees, filed as valid, immutable audit events. |
| W6 before W5 | Two ownership paths; the audited one makes the unaudited one invisible. |
| W2 omitted | W1 holds for one commit. |

---

## 5. AREA E — the Work Order workflow gap

**Parents: EI-14, EI-15. Gated by `OD-13`.** *State what is missing and what a safe path would have to
guarantee.* **The state machine is not redesigned here and no transition is proposed.**

### 5.1 What is missing — measured

| # | Missing thing | Evidence |
|---|---|---|
| **E1** | **No non-technician exit** from the five committed states other than `CANCELLED`. `DISPATCHED: ["ACCEPTED","CANCELLED"]`, `ACCEPTED: ["EN_ROUTE","CANCELLED"]`, `EN_ROUTE: ["ARRIVED","CANCELLED"]`, `ARRIVED: ["WORK_IN_PROGRESS","CANCELLED"]`, `WORK_IN_PROGRESS: ["COMPLETED","CANCELLED"]` — and **every forward action from those states is `roles: ["technician"], requiresOwnAssignment: true`** | `transitionEngine.ts:43-47`; `ACTION_PERMISSIONS` `:138-142`; `Cancel` is admin/dispatcher `:137` |
| **E2** | The closure is **deliberate and stated**: *"Once a technician has been dispatched the job is committed, so DISPATCHED / ACCEPTED / EN_ROUTE / ARRIVED / WORK_IN_PROGRESS have no way back. Any future reverse edge is its own decision and may not appeal to this one."* | `transitionEngine.ts:36-38` |
| **E3** | **No post-`Dispatch` assignment change exists, by two independent closures.** (i) `rescheduleWorkOrder` — which *can* move a Work Order to a different technician — refuses any status ≠ `SCHEDULED`: *"they cannot be used to re-time a job a technician is already driving to (that is committed)"*. (ii) `Dispatch` is not re-enterable: `TRANSITIONS.DISPATCHED` does not contain `DISPATCHED`, so `canTransition` fails. | `scheduling/schedulingCommands.ts:190-198`; `transitionEngine.ts:43`, `canTransition` `:59-61` |
| **E4** | Corroborated independently by corpus `P3B1-S21-A09`: *"None of the four can be reassigned. All four must be cancelled and recreated."* | run verdict C4 / `OD-13` |
| **E5** | **A committed Work Order occupies its technician until it reaches a terminal status** — and the five occupying statuses are **exactly** the five with no way back | `workOrderAvailability.ts:11-17` `OCCUPYING_STATUSES`; `:9-10` *"terminal statuses (COMPLETED / CLOSED / CANCELLED) free the technician"*; `findDoubleBookingConflict` `:31-42` |
| **E6** | So the only expressible response to an unavailable technician **also cancels the record of a live customer commitment** — and the execution timestamps (`arrivedAt`, `workStartedAt`) survive on a document every metric then excludes, because `Cancel` reuses `closedAt` (`ACTION_TIMESTAMP_FIELD` `:100`) and `CANCELLED` is terminal (`:53-57`) | `transitionEngine.ts:92-101`, `:53-57` |

**A refinement to the received framing:** it is stated elsewhere that an orphaned Work Order
*permanently* consumes its technician's dispatch capacity. Measured, cancelling **does** free the
capacity (`workOrderAvailability.ts:9-10`). The capacity is consumed **for as long as nobody
cancels** — so the cost is not permanent capacity loss but a forced choice between **holding a
technician** and **destroying a customer commitment**. The gap is no smaller; it is a different gap.

### 5.2 What a safe path would have to guarantee

Guarantees, not a design. Each is stated so that a proposal can be tested against it.

> **⚠ POST-RULING MARKER (added 2026-09-13).** **AREA E's CONCLUSION STANDS. `#180` invariant 2 PROMOTES G1 to a ruled invariant and `MI-R`
> ratifies the premise; `#182`'s gate does not reach Area E. ONE guarantee is added — `G8`
> (`OI-42`). → PART II §12.7.**

| # | Guarantee | Why, and what already ships that satisfies it |
|---|---|---|
| **G1** | **It must move ASSIGNMENT only, and must provably not write any owner field.** | `workOrder` is COMPANY-owned (`ownershipMatrix.ts:248`) and `assignedTechId` is **deliberately excluded** from `ownerFields` (`:200-201`). So a post-`Dispatch` reassignment **does not need `OD-1`, `OD-6` or `OD-7` at all** — it satisfies *reassignment ≠ ownership transfer* by construction. **This is the reason Area E is separable from Areas A–D, and it is the most useful structural fact in this section.** |
| **G2** | **Execution facts already recorded must survive, and no reader may attribute the first technician's execution to the second.** | `arrivedAt`/`workStartedAt` are immutable execution timestamps (`transitionEngine.ts:92-99`). The pre-`Dispatch` path already records the displaced holder (`reassignedFromTechId`, `transitionWorkOrder.ts:381`) — but **only once, as the latest change, not as a history** (`schedulingCommands.ts:229-231` states this limit explicitly for its own analogue). A mid-execution reassignment makes the trail, not the document, the only sound reader. |
| **G3** | **A reason must be required, and the change must produce its own audit event naming the prior technician.** | Already shipped twice: `transitionWorkOrder.ts:303` refuses a reassignment without `reassignReason` and `:387-391` stages a dedicated `reassignWorkOrderTechnician` event; `schedulingCommands.ts:242-256` does the same with the prior technician and window, *"without this line nothing anywhere would remember the old ones"*. **Reuse, do not reinvent.** |
| **G4** | **It must take the same per-technician lock and the same conflict engine, or it will double-book.** | `work_order_tech_locks` (`schedulingCommands.ts:50-54`, `transitionWorkOrder.ts:248`) and `findDoubleBookingConflict`/`findScheduleConflict` (`workOrderAvailability.ts:31,44`). A new path that takes a *different* lock *"would serialize against nothing, which is worse than taking none at all because it would look like it was protected"* (`schedulingCommands.ts:52-53`). |
| **G5** | **It must not create a second way to un-schedule or to complete.** | `transitionEngine.ts:111-122` documents this exact hazard from ND-18: adding an edge *"would silently make `MarkReady` legal from SCHEDULED as well -- a second, unaudited, reason-free way to un-schedule a job, created as a side effect of allowing the first one."* Any new edge therefore **obliges** a matching `ACTION_ALLOWED_FROM` entry (`:123-126`), or the edge is granted to every action targeting that status. |
| **G6** | **It must be classified as a TRANSITION, not a plan change — and that is a product decision.** | ND-19 drew the line: re-timing/moving technician is a plan change *while `SCHEDULED`* (`schedulingCommands.ts:5-10`). Past `Dispatch`, ND-19's own reasoning (*"that is committed"*, `:191-192`) forbids treating it as a plan change. So it is a transition, and `transitionEngine.ts:38` reserves that: *"Any future reverse edge is its own decision."* **→ Owner product approval required. Do not silently redesign the state machine.** |
| **G7** | **A governed non-completion outcome (E-shaped, EI-15) is a separate decision from a reassignment edge, and must not be delivered as one change.** | They differ in what they assert: a reassignment says *someone else will do this*; a non-completion says *this could not be done*. Collapsing them would make "reassigned" the system's word for "failed", and every completion metric would inherit the confusion. |

**Tier:** **normal**, not Tier-2. `firestore.rules:509` closes `fieldops_wos` to all client writes
(`allow create, update, delete: if false`), so every transition is already trusted-writer-only and
**no Rules change is required**. A reassignment does change *which* technician Rules admit on read
(`:508` `isOwnTechnician(resource.data.assignedTechId)`, cited at
`getWorkOrderFieldContext.ts:5`) — a **behaviour** consequence to test, not a Rules edit.
`fieldops_jobs` is a different story and is **R2**, above.

---

## 6. THE DECOMPOSITION REGISTER — Table A: what is missing, and the contract

> **⚠ POST-RULING MARKER (added 2026-09-13).** **Every row below is reassessed in **PART II §13**, and `OI-30`…`OI-42` are added in **§14**. Rows
> here are UNCHANGED from the pre-ruling state.**

| ID | AREA | EI PARENT | WHAT IS MISSING | REQUIRED CONTRACT OR SEQUENCE | GAP CLASS |
|---|---|---|---|---|---|
| **OI-01** | A | EI-01 | A **declared scope** for the accountability axis. EI-01 names the need for "20 COMPANY-owned families"; **12 of those 20 fail T2** and one required family is not COMPANY-owned | Adopt or reject the **T1∧T2∧T3** test of §1.1 as the scope rule, and with it the **6-family minimum** of §1.4. The test must be recorded as the rule, not the list, so a new family is classified rather than argued | **MODEL GAP** |
| **OI-02** | A | EI-01 | A place where a family **declares** whether it carries an accountable person | The declaration must be **per family** and **orthogonal** — it may not be an `ownerFields` entry, may not reuse `ownerType`, and may not be satisfied by `assignedTechId`. `ownershipMatrix.ts:82-94`'s `companyScopeField` note is the **precedent for a second true fact on one record** and the only precedent that may be cited. **No column, field or shape is proposed here; `OD-1` decides whether an axis exists at all** | **MODEL GAP** |
| **OI-03** | A | EI-01 | The census cannot tell an **open** record from a closed one, so it cannot report the invariant for actionable work even once the axis exists | The "open" discriminator must become **code the census reads**, not prose in a document. It must be per-family and derived from each family's own declared status vocabulary (§1.2 lists all nine), never from a generic `status != "CLOSED"` | **ENGINEERING GAP** |
| **OI-04** | A | EI-01 | Nothing can **name** an accountable person: zero governed-Role occupancy, and no job-role vocabulary | Record both as **independent** prerequisites. A grant closes occupancy only; `SERVICE_MANAGER` has no consumer under any of the four contested readings. Any accountability surface must render an **honest-absence state**, not an empty one, until both are closed | **AUTHORITY GAP** |
| **OI-05** | A | EI-01, EI-24 | `transferOrder` has **no owner field to overload** — its ownership shape *is* a pair | This family is the **test case** for orthogonality: if the axis is defined so that it cannot be expressed on a `PARTICIPATING_COMPANIES` family, the axis is wrong. `ownershipCensus.ts:106-124` shows the pair already resolves with `owner: null` and *"the shape IS the pair"* (`:122`) | **MODEL GAP** |
| **OI-06** | B | EI-02 | Person-owner derivation never reads the person authority | **C-B1** + **C-B2** (§2.2): consult the authority `ownershipMatrix.ts:533` names, and **refuse to guess across namespaces** — open item `O-1` (`typedOwner.ts:4-5`) is unresolved | **ENGINEERING GAP** |
| **OI-07** | B | EI-02 | No return value for TERMINATED / INACTIVE / DELETED / NON-EXISTENT | **C-B3** (§2.2), complete table, **stated on its own terms — not by analogy to the COMPANY axis, which discards the equivalent fact (§2.1a, X-8)**. Load-bearing clauses: NON-EXISTENT → `UNRESOLVED/UNKNOWN` (**reverses `O-1`**); TERMINATED and INACTIVE → **`RESOLVED` + a separately-reported not-actionable fact**, for two independent reasons (the ownership fact is true; `UNRESOLVED` is what a backfill acts on, and **reassignment is not a handoff**), with **distinct reasons**; DELETED → **not** distinguished unless the authority can distinguish it (**`U-10`**). **The not-actionable fact has nowhere to live in `OwnerDerivation` today — that shape question is `OD-6`'s, and it must not be smuggled into the free-text `reason`** | **ENGINEERING GAP** |
| **OI-08** | B | EI-02 | Nothing verifies that the stored owner id and the authority's key are the same namespace | **C-B2.** A namespace mismatch must produce a distinct outcome, never a lookup miss — otherwise the resolver **manufactures orphans at the scale of the mismatch** and it looks like a data problem | **ENGINEERING GAP** |
| **OI-09** | B | EI-02 | A failed authority read has nowhere to go but `RESOLVED` | **C-B3** last row + **C-B5**: make the failure an **outcome**, not an exception. This is the answer to `O-1`'s stated objection — determinism is preserved for the price of one state | **ENGINEERING GAP** |
| **OI-10** | B | EI-02 | **The gate is arithmetically incapable of being blocked by a person orphan.** Orphan → `RESOLVED` (`typedOwner.ts:108`, `:124`) → bucket `"resolved"` (`ownershipCensus.ts:81-82`) → increments **none** of the four terms of `blocking` (`:231`), so `assessable` (`:240`) cannot go false **at any quantity**. Any new state's gate treatment would be equally accidental | **C-B6.** New outcomes get their **own counts**; unreadable-authority **blocks** by the `:213-216` precedent; whether owner-cannot-act blocks is a **declared constant with a rationale in one named place**, `OD-6`'s call. **The blindness is provable at the gate arithmetic, not only at the derivation — so it is testable with no employee data at all** | **ENGINEERING GAP** + **AUDIT/OBSERVABILITY** |
| **OI-11** | B | EI-02 | `typedOwner.ts` declares itself a parity mirror of a **client** authority that cannot perform a trusted read | **C-B7.** Name which side owns the new outcomes and what the other side must then render. **The client may not guess**, and the parity table (`test/typedOwner.test.mjs`) must be extended or its invariant is broken silently | **ENGINEERING GAP** |
| **OI-12** | C | EI-04 | `reorder_requests`: **one** Rules branch (`:776-789`) moves the **role baton** and the **person assignment** together, unaudited. **Scoped to that branch only** — the adjacent Approve/Reject branch (`:764-775`) and the five later branches are **counter-examples** (§3.1a / **N7**) | Separate the two authorities, **and** resolve the vocabulary collision first: `domain/inventoryReorderRequests.js:225` calls `currentOwner` an *"ownership field"*; `ownershipMatrix.ts:286` says it is not, **and the Rules file's own adjacent branches prove the matrix right**. **One of the two must change words before either changes behaviour** | **AUTHORITY GAP** (**not** an ownership-transfer violation — §9 **X-1**, **X-2a**) |
| **OI-13** | C | EI-04 | `fieldops_jobs`: an admin/dispatcher lifecycle or assignment transition can rewrite `operatingCompanyId` in the same write; no `hasOnly` on that branch | Add a field allowlist to the admin/dispatcher branch that **omits the owner field**, exactly as `equipmentEditableKeys()` does (**N1**). This is the site where *reassignment carries ownership* is literally true, on a family measured **41/45 RESOLVED** | **AUTHORITY GAP** |
| **OI-14** | C | EI-04, EI-44 | `accounts`: `accountOwner` rewritable by a generic client patch through a **shipped owner-picker**, unaudited | Route owner change off the client-direct patch, or allowlist `accounts` fields omitting `accountOwner` (**N1** pattern). **And the governed alternative must be reachable first** — see `OI-17`: today closing R3 would remove the only working path | **AUTHORITY GAP** |
| **OI-15** | C | EI-04, EI-44 | `contacts` / `locations`: unconstrained `...data` patches can write `owner`; no surface does yet | Allowlist both collections' client-writable fields. **Cheapest of the five and the only two with no shipped surface to preserve**, so they are the safe first Tier-2 exercise of the pattern | **AUTHORITY GAP** |
| **OI-16** | C | EI-03 | `updateOpportunity` moves a matrix-declared owner and files it through the generic `record()` helper under `action: "updateOpportunity"` | The trail must be able to answer *"who owned this before"*. Note the **structural obstruction**: `auditEventWriter.ts:571-581` **refuses** `previousOwner`/`newOwner`/`handoffSource` on any non-handoff action and `:532-535` refuses `objectId` — so this cannot be fixed by enriching the existing event. **It is `OD-7`'s question in miniature**, and the three-family inconsistency (**N5**) should be resolved with it | **CORRECTNESS GAP** |
| **OI-17** | C | EI-44 | The governed setter `assignAccountOwner` calls itself *"the ONLY way one is ever set after creation"* and is reachable by nothing, writes a different datastore from R3, and emits no audit event | Three separable facts, in order: **(1)** confirm the datastore target (**EI-44's precondition — a wrong target writes rows into the wrong store**); **(2)** it must emit an event; **(3)** whether it is exposed is `OD-8`. **Do not run any backfill against it** | **ENGINEERING GAP** |
| **OI-18** | C | EI-45 | Nothing prevents a **new** owner-field write path being added unguarded; this census was assembled by hand | A standing guard that enumerates client-writable collections against the matrix's `ownerFields` and **fails when an owner field is reachable by a client write without a field allowlist**. The positive control is `equipment` (**N1**); the negative controls are R2–R5 today | **ENGINEERING GAP** + **TESTABILITY** |
| **OI-19** | D | EI-03 | The live writer accepts `OWNERSHIP_HANDOFF` for any `targetType` string; it never imports the matrix; **41** live modules can reach it | **W1** (§4.2). Either shape refuses only — **neither enables a write**, which is what makes W1 safe before `OD-1` | **AUTHORITY GAP** |
| **OI-20** | D | EI-03 | A W1 refusal with no ratchet lasts one commit | **W2.** Assert the single chokepoint and **pin the count** of emitting modules. Precedents: the ENG-B ratchet; `ownershipMatrix.ts:97-100`'s existing R-1 source guard | **ENGINEERING GAP** + **TESTABILITY** |
| **OI-21** | D | EI-02, EI-03 | Area B is a **hard prerequisite** of any handoff, not a follow-up | **W3.** Without it a handoff **to a terminated employee validates cleanly** (`ownershipHandoffCommand.ts:126-128` is shape-only), making the handoff a mechanism for creating orphans under audit | **MODEL GAP** (ordering) |
| **OI-22** | D | EI-03 | `previousOwner` is caller-supplied | **W4.** Read transactionally from the record at commit. Correct for the offline CLI (`warehouseRootCompanyAssignment.ts:371-391` derives it); a **forgery surface** for a callable | **CORRECTNESS GAP** |
| **OI-23** | D | EI-04 | Exposing a handoff while R1–R5 stay open creates **two** ownership paths, one audited | **W5**, and it is the **non-reorderable** step. An audited path beside an unaudited one is **worse than today**: it makes a partial trail look complete | **AUTHORITY GAP** |
| **OI-24** | D | EI-03 | — | **W6. NOT AUTHORIZED. DO NOT ACTIVATE OWNERSHIP HANDOFF.** Recorded so the end state is visible and the gates are named | — |
| **OI-25** | D | EI-45 | A **second** matrix-consulting family authority already exists (`commercialOwnershipAuthority.ts:115-120`), reachable only from tests | **W0′.** Reconcile it with W1's chosen shape, on that file's own stated principle: *"the only thing two authorities can do that one cannot is disagree"* (`:19-20`). Ignoring it creates a third | **ENGINEERING GAP** |
| **OI-26** | E | EI-14 | No non-technician exit from the five committed states except `CANCELLED`; no post-`Dispatch` assignment change (two independent closures) | **G1–G6** (§5.2). **G1 is the key**: it moves assignment only and therefore needs **none** of `OD-1`/`OD-6`/`OD-7`. **G6 makes it a transition, so Owner product approval is required** | **WORKFLOW GAP** |
| **OI-27** | E | EI-15 | No governed *"I could not do this"* outcome | **G7.** It is a **separate** decision from `OI-26` and must not be delivered as one change: collapsing them makes "reassigned" the system's word for "failed" | **WORKFLOW GAP** |
| **OI-28** | E | EI-14 | Nothing prevents the second technician inheriting the first's execution facts | **G2.** The displaced-holder fields that ship today are *"the LATEST change, not the history"* (`schedulingCommands.ts:229-231`); mid-execution, the **audit trail** is the only sound reader | **ENGINEERING GAP** |
| **OI-29** | E | EI-14 | A new edge silently legalises every action targeting that status | **G5.** Any new edge **obliges** an `ACTION_ALLOWED_FROM` entry (`transitionEngine.ts:111-126`). This is not advice: the file documents the defect this prevented once already | **ENGINEERING GAP** |

## 6a. THE DECOMPOSITION REGISTER — Table B: authority, order and proof

> **⚠ POST-RULING MARKER (added 2026-09-13).** **UNBLOCKED BY / DEPENDENCIES / ACCEPTANCE PROOF are REVISED in **PART II §13** wherever a ruling
> moved them. `OD-1` and `OD-6` below are now RULED (#180, #182).**

Join on **ID**.

| ID | UNBLOCKED BY | AUTHORITY TIER | DEPENDENCIES | ACCEPTANCE PROOF (what would demonstrate it) | IMPL. STATUS |
|---|---|---|---|---|---|
| **OI-01** | **`OD-1`** | normal | none — **it is the root** | The test, applied by code to the matrix, reproduces the 6-family set and the 12 T2 failures; a **negative control** family added to the matrix lands in the expected tier without the test being edited | **NOT AUTHORIZED** |
| **OI-02** | **`OD-1`** | normal | OI-01 | A family declaring accountability and a family declining it both census correctly, and **no assertion anywhere reads an `ownerFields` entry to answer it** | **NOT AUTHORIZED** |
| **OI-03** | **`OD-1`** | normal | OI-01, OI-02 | For each of the nine families in §1.2 with open states, a fixture in an open state and one in a terminal state are counted differently, **driven by that family's own status vocabulary** — asserted against the nine constants cited, not a copy | **NOT AUTHORIZED** |
| **OI-04** | **`OD-1`** + a role grant (occupancy) + a job-role ruling | **AUTHORITY** (a grant) | independent of OI-01..03 | Occupancy re-measured non-zero in a named environment **and** a vocabulary named; until both, an accountability surface renders an honest-absence state and a test asserts it does **not** render zero | **NOT AUTHORIZED** |
| **OI-05** | **`OD-1`** + **`OD-16`** | normal | OI-02 | A `transferOrder` fixture carries an accountable person **without** acquiring a scalar owner, and `classifyDocument` still returns the pair outcome (`ownershipCensus.ts:106-124`) unchanged | **NOT AUTHORIZED** |
| **OI-06** | **`OD-6`** (and it **revisits ruling `O-1`**) | normal | none | Pure test over a **fake** person authority (the pattern `ownershipCensus.test.mjs` already uses — *"a fake document source, with no emulator and no credentials"*, `ownershipCensus.ts:5-7`) | **NOT AUTHORIZED** |
| **OI-07** | **`OD-6`** | normal | OI-06 | 6 person states × 2 owner-field shapes (`accountOwner`, `ownerEmployeeId`) = **12 asserted outcomes**, plus a **negative control proving today's resolvers return `RESOLVED` for all six** (the defect, pinned), plus a **mutation check**: deleting the authority read must fail ≥1 case | **NOT AUTHORIZED** |
| **OI-08** | **`OD-6`** + open item **`O-1`** | normal | OI-06 | An id in the wrong namespace produces the "cannot ask" outcome, **not** a miss; asserted in both directions | **NOT AUTHORIZED** |
| **OI-09** | **`OD-6`** | normal | OI-06 | A throwing/empty authority yields the unreadable outcome and **blocks the gate**; a **poisoned-getter** control proves the read was actually attempted (the technique RPT-FIX used for the audit-context defect) | **NOT AUTHORIZED** |
| **OI-10** | **`OD-6`** | normal | OI-07, OI-09 | `censusGate` over a fixture containing one of each new state returns `assessable === false` **and** the declared constant is asserted by name, so flipping it is a visible diff | **NOT AUTHORIZED** |
| **OI-11** | **`OD-6`** | normal | OI-07 | The existing parity suite extended with the new cases passes on **both** mirrors, **or** the asymmetry is asserted as intentional with the client's required rendering named | **NOT AUTHORIZED** |
| **OI-12** | **`OD-8`** (+ **`OD-16`** for the family's classification) | **TIER-2** | the vocabulary decision precedes the Rules change | Emulator Rules test: the Assign write (`:776-789`) is refused when it moves both; **and the Approve/Reject branch (`:764-775`) plus the five baton-pinning branches remain allowed unchanged** — they are the counter-examples and a fix that breaks them has over-reached; the existing 82-subtest `functions/test/reorderRequestsRules.test.js` still passes. **BLOCKED HERE — no emulator** (§10) | **NOT AUTHORIZED** |
| **OI-13** | **`OD-8`** | **TIER-2** | — | Emulator: a valid status transition that also changes `operatingCompanyId` is **denied**; the same transition without it is **allowed** (both directions, plus a typo control). **BLOCKED — no emulator** | **NOT AUTHORIZED** |
| **OI-14** | **`OD-8`** | **TIER-2** | **OI-17** must land first, or the only working path is removed | Emulator: `accountOwner` in an ordinary patch is denied; every other `accounts` field still writable by a dispatcher. **BLOCKED — no emulator** | **NOT AUTHORIZED** |
| **OI-15** | **`OD-8`** | **TIER-2** | none | Emulator: `owner` denied on `contacts` and `locations`; all currently-written fields unaffected. **BLOCKED — no emulator** | **NOT AUTHORIZED** |
| **OI-16** | **`OD-7`** (it is the same question at one call site) | normal | OI-19 (the writer must be able to accept a correct handoff before this one can emit one) | An owner change through `updateOpportunity` yields a trail from which the prior owner is recoverable; a **negative control** shows today's event does not; and `salesAgreement`/`salesOrder` behaviour is asserted unchanged (**N5**) | **NOT AUTHORIZED** |
| **OI-17** | **`OD-8`** + **EI-44**'s datastore confirmation | normal | **datastore target confirmed first** | One `accounts`/`contacts` document read per environment establishes which store holds `owner`; then the setter's event is asserted. **No backfill runs** | **NOT AUTHORIZED** |
| **OI-18** | none (it only measures) | normal | the matrix as-is | The guard **fails today** naming R2–R5 and **passes** for `equipment`; a fabricated unguarded owner-field collection is detected (positive control) | **NOT AUTHORIZED** |
| **OI-19** | **`OD-7`** (shape only) | normal | none — **first step** | Direct execution of the live writer: an `OWNERSHIP_HANDOFF` for `"notAFamilyAtAll"`, an invoice, a payment, a part, an `auditEvent`, a `roleAssignment` and a `transferOrder` are each **refused**; a governed family is **accepted**. **The positive control already exists and must be asserted, not assumed** — the one live caller (`assignWarehouseRootCompany.js:72`, `:234`) routes through the builder and must still stage successfully under whichever `OD-7` shape is chosen (**`U-11`**, §4.1a) | **NOT AUTHORIZED** |
| **OI-20** | — | normal | OI-19 | The ratchet fails when a second emitting module is added, and the pinned count is asserted literally | **NOT AUTHORIZED** |
| **OI-21** | **`OD-6`** | normal | OI-06..OI-11 | A handoff naming a terminated employee as `newOwner` is **refused**; a **negative control proves it is accepted today** | **NOT AUTHORIZED** |
| **OI-22** | **`OD-7`** + **`OD-1`** | normal | OI-19 | A caller supplying a `previousOwner` that differs from the record's value at commit is refused; the CLI's `previousOwner: null` first-assignment case still passes | **NOT AUTHORIZED** |
| **OI-23** | **`OD-8`** | **TIER-2** | **OI-12..OI-15 all closed and deployed** | The OI-18 guard reports **zero** unguarded owner-field write paths **before** any activation step is taken. This is the gate on W6 | **NOT AUTHORIZED** |
| **OI-24** | **`OD-7`** + **`OD-1`** + **`OD-8`** + the census gate `assessable === true` | mixed | all of the above | — | **NOT AUTHORIZED — DO NOT ACTIVATE** |
| **OI-25** | **`OD-7`** | normal | OI-19 | The two authorities agree on every family in the matrix, asserted by iterating the matrix rather than a hand-written list | **NOT AUTHORIZED** |
| **OI-26** | **`OD-13`** — **and it requires Owner PRODUCT approval, not engineering approval** (`transitionEngine.ts:38`, `:36-37`) | normal (**no Rules change**: `firestore.rules:509` closes `fieldops_wos` to clients) | OI-29 must land with it, not after | Reassignment from each of the five committed states: assignment moves · **no owner field is written** (asserted by diff, satisfying G1) · a reason is required · a dedicated audit event names the prior technician · the technician lock is taken · double-booking is refused · **`MarkReady`/`Unschedule`/`Complete` do not become legal from any new state** (G5) | **NOT AUTHORIZED** |
| **OI-27** | **`OD-13`** — **Owner product approval** | normal | must be a **separate** change from OI-26 | A non-completion is distinguishable from a completion **and** from a reassignment in every metric population that reads status | **NOT AUTHORIZED** |
| **OI-28** | **`OD-13`** | normal | OI-26 | After a mid-execution reassignment, the first technician's `arrivedAt`/`workStartedAt` are attributable to that technician from the trail; a **negative control** shows a document-only reader attributes them to the second | **NOT AUTHORIZED** |
| **OI-29** | **`OD-13`** | normal | — | Adding the edge **without** an `ACTION_ALLOWED_FROM` entry makes an existing action legal from a new state, and a test **catches it** — the exact ND-18 regression the table was built to prevent | **NOT AUTHORIZED** |

---

## 7. TIER-2 REGISTER — every item requiring a `firestore.rules` change

**`firestore.rules` is hash-anchored to the live deploy.** A Tier-2 change carries its own
authorization, dual-copy parity check, and an explicit deploy-and-verify step. **None of these may
ride along inside a normal correctness change** — the correctness change would merge while the
narrowing sat undeployed, and the register would read as closed.

| ID | Rules site | What changes | Pattern to copy | Blocked here by |
|---|---|---|---|---|
| **OI-12** | `firestore.rules:776-789` | decouple `currentOwner` from `assignedToUserId` in the Assign branch | — (needs the vocabulary decision first) | no emulator |
| **OI-13** | `firestore.rules:381-384` | add a field allowlist to the `fieldops_jobs` admin/dispatcher branch, omitting `operatingCompanyId` | **N1** `equipmentEditableKeys()` `:1396-1401` / `:1543` | no emulator |
| **OI-14** | `firestore.rules:1335-1337` | allowlist `accounts` client-writable fields, omitting `accountOwner` | **N1** | no emulator; **and OI-17 must precede it** |
| **OI-15** | `firestore.rules:1343`, `:1557` | allowlist `locations` and `contacts` client-writable fields, omitting `owner` | **N1** | no emulator |
| **OI-23** | — | the **ordering gate**: no activation until OI-12..15 are closed **and deployed** | — | depends on all four |

**5 TIER-2 items. All five are in Area C or gate on Area C. Areas A, B, D(W1–W4) and E require no
Rules change** — `fieldops_wos` is already client-closed (`:509`) and the commercial collections are
`if false` (`:1740-1741`, `:1749-1750`, `:1794-1795`).

---

## 8. PRESERVED-INVARIANT CHECK

Each standing invariant, against every item that could violate it.

| Invariant | Where it could have been violated | How this decomposition preserves it |
|---|---|---|
| **creator ≠ owner** | OI-06..OI-11 (a resolver tempted to fall back) | **C-B4** forbids every D-6/D-11/D-12 proxy, creator included, by name |
| **reassignment ≠ ownership transfer** | Area C entirely; OI-26 | OI-13..OI-15 **restore** the distinction in Rules; **G1** makes OI-26 satisfy it by construction (`assignedTechId` is excluded from `ownerFields`, `ownershipMatrix.ts:200-201`) |
| **manager intervention ≠ ownership transfer** | OI-04, OI-07 | No item routes a manager into an owner field. `OD-6b`'s manager-authority question is referenced, never consumed |
| **no implicit historical cascade** | OI-24 | The builder's no-cascade contract (`ownershipHandoffCommand.ts:26-30`) is untouched; nothing here introduces a list input or an "and its children" flag |
| **accountability must be able to move; ownership must not** | OI-01, OI-02, OI-07 | The two are satisfied by **different mechanisms**: accountability by an orthogonal axis (OI-02), ownership by the handoff authority. **The synthesis found these are not in tension, and this decomposition depends on that**: OI-07's TERMINATED rule keeps ownership in place precisely so that accountability, not ownership, is what moves |
| **`ownershipMatrix` is DESCRIPTIVE of existing storage** | OI-02, OI-03 | OI-02 proposes **no column**; OI-03 reads each family's **existing** status vocabulary. The matrix's own column contract (`:29` *"Empty = no storage yet"*) and the `workOrder` correction at `:230-247` are the governing precedent |
| **no generic `ownerId`** | all | None proposed anywhere |
| **accountable / assignee / owner not collapsed** | OI-12, OI-26 | OI-12 keeps the role baton and the person assignment as **two** authorities; OI-26 moves **assignment only** |

---

## 9. CORRECTIONS — things in the brief or the run verdict that this lane found wrong

> **⚠ POST-RULING MARKER (added 2026-09-13).** **`X-10`…`X-15` are added in **PART II §18**, and two of them correct PART I ITSELF (`X-10` the T3
> argument, `X-13` a mis-cited line). `X-7` is revised by §12.2c; `X-8` becomes item `OI-33`.**

| # | Claim as received | Measured at `64008d5a` | Correction |
|---|---|---|---|
| **X-1** | *"`firestore.rules:765-790` moves `currentOwner` **and** `assignedToUserId` in one Rules-enforced write"* → cited as violating *reassignment ≠ ownership transfer* **in shipped Rules** (run finding C7) | The write is real and the coupling is real. **But `currentOwner` is not an ownership field under the matrix**: `ownershipMatrix.ts:288` declares `reorderRequest.ownerFields: []`, and `:286` says in terms — *"`currentOwner` the role queue. Untouched, and still not ownership."* | **The gap class changes.** It is an **AUTHORITY GAP plus a vocabulary collision between two shipped authorities** (`domain/inventoryReorderRequests.js:225` calls it an *"ownership field"*; the matrix says it is not), **not** an ownership-transfer violation. Still TIER-2, still real, and the vocabulary must be settled before the Rules change. **And the site the ruling is actually violated at is a different one — `fieldops_jobs`, R2/OI-13, which the run did not connect to C7.** |
| **X-2** | Exact line range `765-790` | **Two branches of one `allow update`, and they are opposites.** `763` = `allow update: if`; **`764-775`** = Approve/Reject, which moves `currentOwner` (`:768`) with an `affectedKeys().hasOnly` at `:773` containing **no assignee field at all**; **`776-789`** = Assign, the coupling site. `790+` **pins** the baton unchanged (`:796`, `:812`, `:852`, `:903`, `:956`) | Cite **`firestore.rules:776-789`** for the defect and **`764-775`** as the **counter-example**. A sibling lane reached the same split and gave the counter-example as `765-775`; **my reading refines the head by one line** — `764` is the branch opening, `765` is its second clause. Full line-by-line at **§3.1a**. **Neither `765-790` nor `765-775` names a branch boundary.** |
| **X-2a** | The counter-example merely *narrows* R1 | It does more: at `:768` the baton moves to `PARTS_MANAGER` in a write naming **no person**, and `:796`ff freeze it by identity across five transitions | **The Rules file proves `currentOwner` is a queue position, not person ownership, in R1's own adjacent branches.** This is independent corroboration of **X-1** from a second authority, and it is why R1's gap class changes rather than merely its line range |
| **X-3** | *"four accessors are dead exports"* | **Three** have zero references anywhere — `participatingCompanyFamilies` `:565`, `transferableFamilies` `:570`, `familiesWithoutBackfillSource` `:581`. `crossCompanyFamilies` `:575` is referenced by `functions/test/ownershipModel.test.mjs:31,212` | Both readings are true of different questions: **product-dead = 4, absolutely dead = 3.** Say which |
| **X-4** | *"the ownership matrix is offline governance tooling"* / *"the live `auditEventWriter` never imports `ownershipMatrix`"* | Both hold (`index.ts` → 0 ownership refs; `auditEventWriter.ts:58` imports `typedOwner` only). **But the matrix has a non-test importer chain the framing hides**: `eosCommercial/commercialOwnershipAuthority.ts:33` imports `ownershipFamily` and re-validates families at `:115-120`; it is imported by `commercialOwnershipRepository.ts:35`, which is imported **only by tests** | A **second family-validation authority already exists** and terminates just outside the product. A wiring plan that ignores it creates a **third** — recorded as **OI-25 / W0′** |
| **X-5** | *"an orphaned Work Order permanently consumes its technician's dispatch capacity"* | `workOrderAvailability.ts:9-10`: *"terminal statuses (COMPLETED / CLOSED / CANCELLED) **free** the technician."* Cancelling releases it | The capacity is consumed **for as long as nobody cancels**. The real cost is a **forced choice** between holding a technician and destroying a live customer commitment — **not permanent capacity loss.** The gap is not smaller; it is a different gap |
| **X-6** | *"27 families"* used loosely for the matrix | **27 is the OWNABLE count. The matrix holds 51 families** (21 explicit + 30 spread). PERSON 6 / COMPANY 20 / PARTICIPATING 1 / REFERENCE 7 / EXCLUDED 17 | Both numbers are needed and they answer different questions. `inbound_work_requests` being *"absent from all 51"* (OD-16) uses the 51 |
| **X-7** | Area A framed as *"not all 27 families"* | Correct — **and the reduction is larger than the framing implies.** EI-01 sources the need to *"20 COMPANY-owned families"*; **12 of those 20 fail T2**, and **one of the 6 required families is not COMPANY-owned at all** (`transferOrder`) | The minimum is **6 of 27 / 6 of 51**, and the set is **not a subset of the 20** |
| **X-8** | *"`deriveCompanyOwner` **does** resolve against its authority"* — offered as the model for the person contract | True but **weaker than it reads, and a new defect falls out of it.** `resolveOperatingCompany` returns a four-state result **including `INACTIVE`** (`operatingCompanyAuthority.ts:54`, `:80`), and `deriveCompanyOwner` handles **only** `INVALID` and `UNKNOWN` — **`INACTIVE` falls through to `RESOLVED` and the fact is discarded** (`typedOwner.ts:137-143`). So the census cannot report an inactive company owner either. The discard is **currently invisible** because both seeded companies are `active: true` (`:42`, `:48`) | **The COMPANY axis has EXISTENCE integrity, not ACTIVE-STATUS integrity.** Specifying the person contract as *"match what COMPANY already does"* **would copy the discard** — so §2.2's four states are stated on their own terms (§2.1a). **And this is a finding in its own right: the company axis computes a standing fact in one module and throws it away in the next.** Not in this lane's five areas to fix; recorded for the controller |
| **X-9** | *"handoff is inert as a callable but *is* invoked by `assignWarehouseRootCompany.js`, so 'nothing calls it' is false"* | **Confirmed** — `:72` and `:234`. **And it matters more than as a pedantic correction**: the caller routes through the **builder**, derives `previousOwner` rather than accepting it (`warehouseRootCompanyAssignment.ts:371-391`), and pre-empts the no-op case (`:34-36`) | **W1 is not greenfield: a correct builder-mediated path already exists and is exercised.** That supplies W1's positive control, makes its regression risk real rather than theoretical, and **moves W4 later in risk order** than the step numbering implies — §4.1a |

---

## 10. UNPROVEN

Stated as unproven rather than omitted.

> **⚠ POST-RULING MARKER (added 2026-09-13).** **`U-9` is NARROWED (its Rules half is now proven closed — PART II V-11) and `U-12`…`U-17` are
> added in **PART II §16**.**

| # | Unproven | Why it could not be proven here | What would prove it |
|---|---|---|---|
| **U-1** | Every Tier-2 refusal in **OI-12..OI-15** behaves as intended | **The Firestore emulator cannot run in this environment** — no JRE, and port 8080 is held by an unrelated `uvicorn` (pid 187). The entire C census is a **STATIC READ of `firestore.rules`** | An emulator run of the existing `*Rules.test.js` suites plus new both-direction cases. **`OD-8`'s own note already requires this (`U-9`) before the finding is acted on** |
| **U-2** | The **live** writer's acceptance of `"notAFamilyAtAll"` and the six governed-but-wrong families | Reported as EXECUTED by OWN-E2E; **this lane read the code path and did not re-execute it.** The static reading fully supports it: `assertValid` `auditEventWriter.ts:460-582` checks `targetType` only for string-ness (`:470-472`) and never consults the matrix | Re-execution against the compiled `lib/` |
| **U-3** | That `accounts`/`contacts`/`locations` documents actually carry `owner` in **Firestore** | The matrix declares the fields; EI-44 records that `contacts.owner`/`locations.owner` are written **only in Postgres**. **No document was read** (no Firestore reads permitted) | One document read per environment — **EI-44's stated precondition**, and a precondition of OI-14/OI-17 |
| **U-4** | Whether `purchase_orders` is live or superseded (`MI-14`), which decides whether the operational envelope is **6** or **9** | Not resolvable from the matrix; `types/procurement.ts:24` and `partBalanceReadService.ts:269` prove a status vocabulary exists, not that the collection is in use | A runtime census of `purchase_orders` |
| **U-5** | Whether `fieldops_jobs` (legacy) is still worked | `firestore.rules:353-395` keeps a full live lifecycle for it and the matrix measures **41/45 RESOLVED** — so it is **populated**, which is not the same as **active** | A runtime census |
| **U-6** | `inventoryAction` has no status vocabulary | Searched; none found. `permissionCatalog.ts:579` describes only *"Create an inventory_actions record"*. **Absence of a found constant is weaker than a proven absence** | An exhaustive read of the `inventory_actions` writers |
| **U-7** | That the 6-family minimum is **minimal** rather than merely small | The T2 clause is measured; the T3 argument for excluding the commercial chain is a **reasoned claim about the model**, not a measurement | `OD-1`'s ruling. If `OD-1` chooses option (b) — reclassify operational families back to PERSON — **the whole boundary is void**, because T3 would then exclude everything |
| **U-8** | "11 of 13 stored company fields are write-only" | **Not re-measured** — outside this lane's five areas. Contested (OWN-E2E vs OWN-DESIGN conflict `E-4`) | Carried with both readings; **load-bears on no item here** |
| **U-9** | That closing R3 (`accounts`) would not remove the **only** working owner-assignment path | `assignAccountOwner` is unreachable and writes a different datastore (OI-17). Whether any *other* path exists was not exhaustively proven | The OI-18 guard, run as a census rather than as a test |
| **U-10** | Whether the person authority retains a **tombstone**, i.e. whether DELETED is distinguishable from NON-EXISTENT at all | No `employees` document was read (no Firestore reads permitted) and no deletion path was traced. **C-B3's DELETED row is therefore conditional by construction** | Read the `employees` writers for a soft-delete or status-history field. **If none exists, the contract's honest answer is that the two states are one**, and the census must say so rather than report a distinction it cannot make |
| **U-11** | That W1 leaves the one live handoff caller working | Argued from the code (`warehouse` is a governed `HANDOFF` family; the CLI routes through the builder) — **not executed**. §4.1a flags this as the thing W1's test must assert rather than assume | Run the CLI's staging path against a W1-modified writer, in a sandbox, with no commit |

---

## 11. WHAT THIS DOCUMENT DELIBERATELY DOES NOT CONTAIN

> **⚠ POST-RULING MARKER (added 2026-09-13).** **Still true of PART I, and restated for PART II at **§19**. `#182` withholds enum and schema names
> explicitly, so PART II proposes none either.**

- **No schema.** No field, collection, index or column is proposed. `OD-6` gates B's storage question
  and `OD-1` gates A's; both are unanswered.
- **No state-machine change.** §5 names what is missing and what a path would have to guarantee.
  `transitionEngine.ts` is unmodified and `TRANSITIONS` is quoted, never amended.
- **No activation.** Ownership handoff remains inert. `functions/src/index.ts` is unmodified.
- **No generic `ownerId`**, and no collapse of accountable / assignee / owner.
- **No production contact, no deploy, no database mutation, no Firestore read or write.** Every fact
  above comes from a file read in a git worktree at `64008d5a`.

---
---

# PART II — POST-RULING REASSESSMENT

**Added 2026-09-13, after Part I was written.** **Nothing in Part I has been deleted or rewritten.**
Part I is the analysis as it stood when `OD-1` and `OD-6` were both **open**. Both are now ruled.
Where a ruling displaces a Part I argument, Part I keeps its original words and carries a forward
marker (`→ PART II §nn`); the correction lives here. **Where a ruling CONTRADICTS a Part I
conclusion, that is said loudly in §12.2 and §12.14 rather than edited away.**

> ## EVERY ITEM, OLD AND NEW, CARRIES `IMPLEMENTATION STATUS = NOT AUTHORIZED`.
>
> The Owner reconfirmed this explicitly when issuing the rulings below. **Nothing in Part II
> authorizes code, schema, a field name, an enum name, a migration, a backfill, or handoff
> activation.** `#182` withholds enum and schema names by name; no name is proposed here.

**OBSERVED AT: `64008d5a`** for every measurement in Part II, re-read at that commit and not carried
forward from Part I. `git diff 64008d5a HEAD -- . ':!docs'` is **empty**, so this worktree's code is
byte-identical to the baseline.

---

## 12. THE FIVE RULINGS, AND WHAT THEY BEAR ON

### 12.0 What landed, and how it is cited here

Recorded as `docs/DECISIONS.md` **#180**, **#181**, **#182** on ref **`int/a-correctness-register`**.
**They are not on this branch**, whose `docs/DECISIONS.md` ends at **#179**
(`docs/DECISIONS.md:6410`, verified). Cited below by number and ref only — never by a relative link,
which would not resolve from here.

| Ruling | Subject | Disposition |
|---|---|---|
| **#180** (ref `int/a-correctness-register`) | `OD-1` — ACCOUNTABLE PERSON is a distinct first-class axis, independent of 8 named axes; exactly one per ACTIONABLE item at every point in time; **ten invariants** | **APPROVED** |
| **#181** (ref `int/a-correctness-register`) | `MI-N` — Opportunity / Sales Agreement / Sales Order: accountable person is a **separately carried fact**; creation rule EXPLICIT VALID → GOVERNED DERIVATION FROM CURRENT COMMERCIAL RECORD OWNER → REFUSE, **initialization only**; `accountablePerson = ownerEmployeeId` as a permanent computed identity **forbidden**; no silent cascade either way; history not rewritten | **CLOSED** |
| **#182** (ref `int/a-correctness-register`) | `OD-6` — a **TWO-LAYER PERSON-REFERENCE CONTRACT**; four required states (semantic only, **names withheld**); historical ≠ non-existent; creation EXPLICIT → INHERITED → REFUSE *with the inherited reference held to the CURRENT eligibility contract*; the gate may not close on a structurally incapable census; **no backfill authorized**; **13 required acceptance proofs** | **RULED** |
| **`MI-P`** | Accountability **is** measured — but **not** by adding a field to `ownershipMatrix.ownerFields`. Two acceptable architectures. Four eventual axes | **CLOSED** |
| **`MI-Q`** | Sales Agreement gets the same creation shape; **do not change `creditedSalespersonId` semantics** | **CLOSED** |
| **`MI-R`** | **Eligibility ≠ execution authority.** An accountable person **may delegate execution**. Minimum: governed employment/person status; further constraints **per family, never global** | **CLOSED** |

**`OD-7` remains OPEN.** `OD-8`, `OD-13`, `OD-16` and open item `O-1` are unaddressed by these five
rulings and remain as Part I records them.

### 12.1 New measurements Part II rests on — all re-read at `64008d5a`

Part I did not contain these. Each was named in the reassessment brief and is **re-measured here
rather than accepted**.

| # | Claim as received | Measured at `64008d5a` | Verdict |
|---|---|---|---|
| **V-1** | `combineOwnerDerivations` (`typedOwner.ts:151-159`) *"takes only `family.ownerFields` as inputs"*, so it could never have supported Part I's T3 argument | **TWO independent confirmations.** (a) Its signature takes arbitrary outcomes (`:151`), but its **only production caller** is `ownershipCensus.ts:173`, fed exclusively by `family.ownerFields.map(...)` at **`:165`**; every other reference is a test. (b) Its AMBIGUOUS branch fires **only** when two `RESOLVED` outcomes name **different owner identities** — `distinct` is a `Set` of `` `${type}:${id}` `` and the guard is `distinct.size > 1` (`:156-159`). Two person facts naming the **same** person return `RESOLVED`, asserted at `functions/test/ownershipModel.test.mjs:140-141` (*"Agreement is not ambiguity"*) | **CONFIRMED — and stronger than received.** It refuses **conflicting identity**, not *"two person facts of the same kind"*. Part I §1.3's citation of it is **wrong on both counts**. → **§12.2**, **X-10** |
| **V-2** | The census maps **only** `family.ownerFields` | `ownershipCensus.ts:165` `family.ownerFields.map((field) => …)`; and `:157-163` returns `OWNERLESS` / *"family has no ownership storage yet"* when `ownerFields.length === 0` | **CONFIRMED.** The census is **structurally single-axis**. A fact outside `ownerFields` is invisible to it and unreachable by `combineOwnerDerivations` |
| **V-3** | `creditedSalespersonId` is written by all three commercial creation paths at `opportunityCommands.ts:178`, `salesAgreementCommands.ts:307-308`, `salesOrderCommands.ts:291` | **CONFIRMED at exactly those lines**, all three via `resolveCreditedSalesperson` (`financialAttribution.ts:321-330`) | **CONFIRMED** |
| **V-4** | `responsibleEmployeeId` at `financialAttribution.ts:164` is a person fact outside the matrix, on a non-empty-string floor | **CONFIRMED and sharper.** `:164` declares it; `:229` builds it; **both** it and `creditedSalespersonId` (`:228`) pass through `person()` at **`:205-209`**, whose **only** check is `nonEmpty` → `trim()`. In the **same function**, `operatingCompanyId` is REQUIRED and throws `COMPANY_REQUIRED`/`COMPANY_INVALID` (`:212-224`). And `resolveCreditedSalesperson` `:326-328` gates all three of explicit / inherited / commercial-owner on `nonEmpty` alone. **Zero** occurrences of either field name in `ownershipMatrix.ts` or `ownershipCensus.ts` | **CONFIRMED.** Company references are **required and validated**; person references are **optional and shape-only** — in a second module the rulings do not name. → **§12.5**, **OI-38** |
| **V-5** | `grep -ci accountable` = **0** across all 12 ownership modules | `functions/src/ownership` holds exactly **12** `.ts` files; `git grep -ci accountable` over that path returns **no hits**. Across all of `functions/src`, only `access/governedBusinessRoles.ts` (3) and `workOrderLabor/workOrderLaborCommand.ts` (1) | **CONFIRMED.** The accountable reference **does not exist** at `64008d5a` → **§12.4** |
| **V-6** | `ownershipBackfillRules.ts:70-78` propagates an unvalidated upstream USER owner (`:74-77` onto every child; `:71` never overwrites, so no repair path) | **CONFIRMED verbatim.** `:71` `if (doc.data.owner !== undefined) return { kind: "ALREADY_SET" }` — **no repair path exists**. `:74` reads `ctx.accountOwnerByAccountId.get(accountId)`; `:77` writes `{ owner: { type: "USER", id: employeeId } }`. **Nothing between `:74` and `:77` validates the employee id** | **CONFIRMED.** **This is NOT in Part I** — Part I contains **zero** references to `ownershipBackfillRules`. The ruling attributes the finding to this lane; the honest record is that **Part I did not make it**. → **X-11**, **OI-41** |
| **V-7** | `firestore.rules:381-384` (`fieldops_jobs`, no `hasOnly`, rewritable `operatingCompanyId`) is a live TIER-2 defect no branch fixes | **CONFIRMED.** `:381` `allow update: if resource.data.status != 'complete' && ( (isAdminOrDispatcher() && isValidJobTransition(...)) || <technician branch> )`. The admin/dispatcher branch (`:383-384`) carries **no** `affectedKeys().hasOnly`. The file's **own comment** at `:377-380` scopes the `hasOnly(['status'])` allowlist to the technician transition — *"in this transition"* — and `:350` confirms `jobStatusOnlyChange()` is that branch's guard | **CONFIRMED — independent agreement with the controller.** This is Part I's **R2 / OI-13** |
| **V-8** | `operatingCompanyId` is **0/12 in production** on `fieldops_jobs` | **NOT VERIFIABLE HERE** — no production contact (hard constraint). **NOT a contradiction of Part I's 41/45**: `ownershipMatrix.ts:262-265` attributes 41/45 to the *authorized **sandbox** backfill* and `:271` to *"41 **sandbox** jobs … certification fixtures"*. Two environments, two populations | **BOTH CARRIED.** Part I's 41/45 never claimed production. → **U-12** |
| **V-9** | `operatingCompanyId` is **not read for authority** on that family | **CONFIRMED.** The entire `fieldops_jobs` block (`firestore.rules:353-395`) references only `status` and `technicianId`. `operatingCompanyId` appears **nowhere** in it — not in `read` (`:360-363`), `create` (`:366-368`), `update` (`:381-391`) or `delete` (`:394`) | **CONFIRMED.** → **§12.8**, and it cuts **both ways** for OI-13 |
| **V-10** | **5 of 30** `allow update` statements lack a `hasOnly` allowlist | **NUMERATOR RIGHT, DENOMINATOR WRONG.** `^\s*allow [a-z, ]*update` matches **25** statements in `firestore.rules` — **there is no 30**. **18 of the 25 are `if false`** (deny-all: `:497,509,514,534,539,549,1079,1129,1157,1178,1203,1231,1236,1247,1257,1262,1267,1636`). Only **7** permit a client update: `:381`, `:418`, `:763`, `:1335`, `:1343`, `:1542`, `:1557`. **2 of the 7 carry an allowlist** — `:1542` `hasOnly(equipmentEditableKeys())` and `:763`'s **per-branch** allowlists (`:773,789,805,823,871,919,975`). So **5 of 7 lack one**: `:381`, `:418`, `:1335`, `:1343`, `:1557` | **CORRECTED.** The honest statement is **5 of 7 client-writable**, or 5 of 25 overall. *"5 of 30"* **understates the defect rate roughly fourfold** and cites a count the file does not contain. → **X-12** |
| **V-11** | *(derived from V-10 — not in the brief)* Does the Part I Area C census, *"assembled by hand"* (OI-18), **miss** a site? | **NO.** Of the 5 unallowlisted client-writable update statements, **4 expose a matrix-declared `ownerFields` entry** — `:381` `operatingCompanyId` (`workOrderLegacy`, `ownershipMatrix.ts:268`), `:1335` `accountOwner` (`:120`), `:1343` `owner` (`:134`), `:1557` `owner` (`:128`) — and those are **exactly** Part I's **R2, R3, R5, R4**. The fifth, `:418` `fieldops_technicians`, is classified **EXCLUDED / person authority** with `ownerFields: []` (`ownershipMatrix.ts:515`, `:533`), so it exposes no owner field and was correctly out of scope | **§3.1's census is now EXHAUSTIVELY VERIFIED for the Rules surface**, not hand-assembled. **This closes half of `U-9`** → **U-9 (revised)** |
| **V-12** | *(not in the brief)* `accounts`: is `accountOwner` really unguarded? | **CONFIRMED, and the file says so.** `:1335-1337` guards only `accountGovernedFieldsValid` (= `accountPaymentTermsValid && accountTaxStatusValid`, `:1298-1300`) and `accountGovernedFieldsUnchanged` (= `paymentTerms` and `taxStatus` byte-identical, `:1306-1309`). The comment at **`:1303-1305`** states outright that a non-admin *"may freely edit every OTHER field"* | **CONFIRMED — Part I's R3 is stronger than Part I claimed.** The Rules file **documents** that the owner field is freely client-editable |
| **V-13** | *(not in the brief)* Is the shipped `EXPLICIT → INHERITED → REFUSE` rule that `#182` qualifies actually shape-only? | **YES, and this is the exact target of `#182`'s *"The word VALID is load-bearing"*.** `creationOwnerResolution.ts:5-7` states the rule. `:63-64` EXPLICIT branch: **`nonEmpty` only**, no validity check of any kind. `:67-74` INHERITED branch: admits an upstream owner iff `resolution === RESOLVED && owner.type === USER` — and `deriveAccountOwner` / `deriveEmployeeRefOwner` (`typedOwner.ts:95-125`) return `RESOLVED` for **any** non-empty string. `:52-54` even documents the intent as *"Only a RESOLVED, USER-typed owner may be inherited"* | **`#182`'s inherited-reference clause lands precisely on `creationOwnerResolution.ts:63-74`.** → **§12.3**, **OI-35** |
| **V-14** | *(not in the brief)* Do all three commercial families share the creation shape? | **NO.** `resolveCreationOwner` is called by **`opportunityCommands.ts:159`** and **`salesOrderCommands.ts:261`** — and **NOT by `salesAgreementCommands.ts`**, which does not import `creationOwnerResolution` at all (`:1-16`). It instead **requires** an explicit owner (`:280` `OWNER_REQUIRED`, `nonEmpty` only) with **no inheritance branch** (`:301` `input.ownerEmployeeId.trim()`) | **This is what `MI-Q` closes, and NO Part I item covers it.** → **NEW `OI-34`** |
| **V-15** | *(not in the brief)* Which collection is *the* person authority? | **AMBIGUOUS IN THE MATRIX ITSELF.** The EXCLUDED block declares **three**: `:513` `["user","users","identity authority"]`, `:514` `["employee","employees","person authority -- a subject of ownership, not an object"]`, `:515` `["technician","fieldops_technicians","person authority"]`. **Two rows literally say "person authority."** | **`#182` Layer 1 cannot name *"the"* authority until this is settled.** It **compounds** open item `O-1`'s namespace question. → **WIDENS OI-08**, **NEW `OI-39`**. **And Part I mis-cited this: §2.2 C-B1 cites `ownershipMatrix.ts:533` for the `employees` row; `:533` is the spread mapper's `ownerFields: []` line and the row is at `:514`.** → **X-13** |

---

## 12.2 AREA A — THE MINIMUM-DOMAIN BOUNDARY, RE-DERIVED

> **→ Part I §1.3 and §1.4 are SUPERSEDED as to the commercial chain. Their text is retained above.**

### 12.2a Part I's T3 justification is CONTRADICTED — stated loudly, as required

**PART I SAID** (§1.3, retained verbatim above):

> *"Two person facts of the same kind is exactly the ambiguity `combineOwnerDerivations`
> `typedOwner.ts:151-159` exists to refuse. **So the commercial chain is satisfied by Area B and must
> not be satisfied by Area A.**"*

**THAT IS WRONG, AND IT IS WRONG TWICE OVER — once by ruling and once by code.**

| | Contradiction | Authority |
|---|---|---|
| **1. By RULING** | `#181` rules that for `opportunity` / `salesAgreement` / `salesOrder` the ACCOUNTABLE PERSON is a **separately carried fact**, and that `accountablePerson = ownerEmployeeId` as a permanent computed identity is **forbidden**. So `ownerEmployeeId` **does not name the accountable person**. The two facts are therefore of **DIFFERENT kinds** — which is the very condition Part I §1.3 itself said makes two facts on one record legitimate (`ownershipMatrix.ts:88-93`). **T3's premise is false for these three families as a matter of ruling.** | `docs/DECISIONS.md` **#181** (ref `int/a-correctness-register`) |
| **2. By CODE** | The cited mechanism **could never have adjudicated it.** (a) `combineOwnerDerivations`' AMBIGUOUS branch fires only on **conflicting owner identity** (`typedOwner.ts:156-159`, `distinct.size > 1`), not on "two facts of one kind" — two fields naming the **same** person return `RESOLVED` (`ownershipModel.test.mjs:140-141`). (b) Its only production caller is fed **exclusively** from `family.ownerFields` (`ownershipCensus.ts:165`, `:173`), so a fact carried outside `ownerFields` **never becomes an input to it under any modelling**. | **V-1**, OBSERVED AT `64008d5a` |

**The sibling lane is right.** Part I's *mechanism* claim in T3 — *"don't add a third axis where a
person-valued field already answers the question"* — survives as a **principle**. Its **application to
the commercial chain is void**, and the code it leaned on was never capable of enforcing it.
Recorded as **X-10**.

### 12.2b What T3 becomes

T3 can only be restated as: *"…and no person-valued field on the record is **the governed accountable
person** for it."* At `64008d5a` that clause **excludes nothing**, because `grep -ci accountable` = **0**
across all 12 ownership modules (**V-5**): **no family carries a governed accountable person.**

> **T3 IS A NULL CLAUSE AT THIS BASELINE.** The boundary is governed by **T1 ∧ T2** alone.
> T3 is retained only as a *future* guard against a second accountable fact being added to a family
> that already has one.

### 12.2c The re-derived boundary

T1 and T2 are **unchanged and now RATIFIED by ruling**: `#180` invariant **9** (*"reference/master-data
objects don't automatically need one"*) ratifies **T1** (excluding REFERENCE/EXCLUDED) and **T2**
(excluding `account`/`contact`/`location` as master records with no outstanding obligation).
`#180` invariant **8** (*"COMPANY ownership may coexist with a PERSON accountable"*) ratifies the whole
COMPANY-owned portion of the set and Part I's **OI-02** orthogonality requirement.

| Class | T1 ∧ T2 members | Count | Change from Part I |
|---|---|---|---|
| COMPANY, liveness settled | `workOrder` · `reorderRequest` · `receivingOrder` · `cycleCount` · `invoice` | **5** | unchanged |
| PARTICIPATING_COMPANIES | `transferOrder` | **1** | unchanged |
| **PERSON — commercial chain** | **`opportunity` · `salesAgreement` · `salesOrder`** | **+3** | **ADDED.** Part I excluded them on T3; `#181` puts them in **directly**, and corrected-T3 also admits them. **Both routes agree** |
| **RE-DERIVED MINIMUM SET** | | **9** | **was 6** |
| CONTESTED ADJACENT — excluded for a **factual liveness** question, never for T3 | `purchaseOrder` (`MI-14` / `U-4`) · `reorderPurchaseOrder` (two-hop, `ownershipMatrix.ts:425`) · `workOrderLegacy` (`U-5`) | **3** | unchanged — these exclusions were **never** T3-based, so the ruling does not disturb them |
| **OPERATIONAL ENVELOPE if all three liveness questions resolve live** | | **12** | **was 9** |

**Does the boundary stay 6, grow to 9, or change shape? It grows to 9, and its SHAPE changes.**

| Part I statement | Revised |
|---|---|
| *"6 of 27 ownable families — 6 of 51 total"* | **9 of 27 ownable — 9 of 51 total** |
| *"one of the 6 is not COMPANY-owned at all"* (X-7) | **FOUR of the 9 are not COMPANY-owned**: `transferOrder` (PARTICIPATING) + the three PERSON commercial families |
| *"the set is not a subset of the 20"* | Still true, and **much further from being one**: 4 of 9 sit outside the 20 COMPANY families EI-01 names as the need's source |
| *"the commercial chain is satisfied by Area B and must not be satisfied by Area A"* | **CONTRADICTED.** The commercial chain requires **both**: Area B for its **owner** reference and Area A for its **accountable** reference, which `#182` requires to be **independently validated** |

**The one Part I conclusion that survives intact and is worth restating:** §1.5's precondition. The
9-family boundary is still *"a design boundary that cannot be delivered against today"* — **ZERO**
holders of any of 45 governed Roles, and no job-role vocabulary. `MI-R` narrows what eligibility
*means* (governed employment/person status as a **minimum**, not *"has the capability to perform the
assigned command"*) but supplies **no occupant**. **Widening the set from 6 to 9 widens a gap that
cannot yet be populated at any size.**

---

## 12.3 AREA B — `C-B3` AGAINST THE FOUR RULED STATES

> **→ Part I §2.2 `C-B3` is REFINED AND SPLIT ACROSS TWO LAYERS. Its text is retained above.**

### 12.3a Row-by-row mapping

`#182`'s four states are **semantic only — exact enum/schema names are NOT authorized**, so no naming
is attempted or implied below.

| `C-B3` row | `#182` state | Layer | Verdict |
|---|---|---|---|
| **ACTIVE** → `RESOLVED` | **A** `VALID_CURRENT` | 1 + 2 | **RATIFIED** |
| **NON-EXISTENT** → `UNRESOLVED` / `UNKNOWN`, *"reverses `O-1`'s structurally zero"* | **C** `MISSING / INVALID_REFERENCE` | **1** | **RATIFIED AND STRENGTHENED.** `#182` Layer 1: *"NON-EXISTENT and DELETED/UNRESOLVABLE must not yield the same authoritative `RESOLVED` as a real Employee"* — and *"Non-empty string, type `USER`, successful parse are **each insufficient**"*, which names `typedOwner.ts:95-125`'s exact behaviour. **`C-B3`'s most contested clause is now the ruling** |
| **DELETED** → `UNRESOLVED` / `UNKNOWN` unless a tombstone (`U-10`) | **C** — `#182` names *DELETED/UNRESOLVABLE* inside state C | **1** | **NARROWED.** `#182` settles **which state** DELETED lands in. `U-10` shrinks from *"which state"* to *"can a distinct **reason** be given inside state C"* — a reporting question, not a classification one |
| **TERMINATED** → **`RESOLVED`** + separately reported not-actionable | **B** `VALID_HISTORICAL / NOT_CURRENTLY_ELIGIBLE` | **2** | **THREE READINGS — ALL CARRIED, NONE RESOLVED TO TIDY. §12.3b** |
| **INACTIVE** → same resolution as TERMINATED, **distinct reason** | **B** | **2** | As TERMINATED. **`#182` explicitly groups INACTIVE / TERMINATED / FORMER** — so Part I's insistence on *distinct reasons* inside one state is **compatible but not ratified**; the ruling neither requires nor forbids the distinction. → **MISSING INPUT MI-S** |
| **AUTHORITY UNREADABLE** → a distinct outcome that is neither `RESOLVED` nor any person state | **NONE of the four** | — | **NEW GAP EXPOSED.** `#182`'s four states classify the **reference**; an unreadable authority is a property of the **lookup**. The ruling does not provide for it. **`C-B3`'s sixth row survives as an addition the ruling neither ratifies nor forbids** — and `C-B6.3`'s argument that it must block the gate (`ownershipCensus.ts:213-216`) is untouched. → **MISSING INPUT MI-T** |

### 12.3b The TERMINATED question — three readings, carried

| Reading | Position | Strength |
|---|---|---|
| **R-I — the ruling RATIFIES `C-B3`** | `#182` says, in terms: *"Historical: INACTIVE / TERMINATED / FORMER ≠ NON-EXISTENT/INVALID. **Preserve the reference.** `UNRESOLVED` must **NOT** be the automatic representation for inactive or terminated employees."* That is `C-B3`'s TERMINATED conclusion verbatim. State **B**'s own name — **VALID**_HISTORICAL — asserts the reference is valid, which is the substance of `C-B3`'s `RESOLVED`. `#182`'s proof requirement *"Historical cases prove HISTORY PRESERVED"* is `C-B3`'s reason (1) | **Strong on substance.** The only divergence is the **label**, and `#182` withholds labels, so nobody is licensed to settle it here |
| **R-II — the ruling REMOVES `C-B3`'s consequential proxy** *(the sibling lane's reading)* | `C-B3` gave **two** reasons for `RESOLVED`. Reason (1): the ownership fact is true. Reason (2): *"`UNRESOLVED` is the input a backfill acts on, so classifying a terminated owner as unresolved would **invite a reassignment**."* **`#182` forbids the backfill DIRECTLY** — *"Backfill: **not** the mechanism for fixing historical inactive/terminated references… **No backfill authorized.**"* Once the hazard is prohibited by name, `C-B3` no longer needs to bend the **resolution state** to keep a backfill away from it. **Reason (2) is therefore DISCHARGED BY RULING**, and it was the only reason `C-B3` had for reusing the *existing* `RESOLVED` label rather than accepting a distinct fourth state | **Correct, and this lane agrees.** The sibling lane is **right that reason (2) is discharged** and right that this is not a confirmation of `C-B3`'s *mechanism*. It would be **wrong** to read it as the ruling *contradicting* `C-B3` — the ruling's own sentence is `C-B3`'s conclusion |
| **R-III — the acceptance contract's case 2 on `ext/census-acceptance` says the ruling CONFIRMS `C-B3`** | Reported in the reassessment brief as stating **the opposite of R-II** | **NOT VERIFIED BY THIS LANE.** That branch was not read. Recorded, attributed, and marked **`U-13`**. **Carried as a live disagreement between two lanes, not resolved here** |

**This lane's position, stated without collapsing the three:** `C-B3`'s TERMINATED row is **REFINED,
not ratified and not replaced.** Reason (1) is **RATIFIED**. Reason (2) is **DISCHARGED BY RULING**.
What is left is a **four-state vocabulary** whose names the Owner withholds — which is nearer to
"replaced in form, ratified in substance" than to either pole. **R-I, R-II and R-III all stand in the
record.**

### 12.3c The structural discharge — `#182`'s two layers dissolve Part I's flagged obstruction

This is the largest single change to Area B, and it is a **discharge**, not a defect.

**PART I FLAGGED** (§2.2, retained above):

> *"TERMINATED and INACTIVE both require `RESOLVED` **plus** a not-actionable fact. `OwnerDerivation`
> (`typedOwner.ts:52-57`) has **no place to put that** — `code` is documented as `null` on a `RESOLVED`
> outcome (`:42-43`). **How it is carried is a shape question and `OD-6` gates it.**"*

**`#182` answers it by splitting the contract in two, and the answer is that the fact does not belong
in `OwnerDerivation` at all:**

| Layer | Question it answers | Where `#182` puts it | States it distinguishes |
|---|---|---|---|
| **Layer 1 — REFERENTIAL INTEGRITY** | *Does this reference resolve to a real Employee?* | **in authoritative resolution / derivation** | **A** vs **C** |
| **Layer 2 — CURRENT ACCOUNTABILITY ELIGIBILITY** | *Is that Employee currently eligible?* | **in the accountability census and the enforcement gate** | **A** vs **B** |

**Consequences, each a real change to a Part I item:**

1. **`OI-07` NARROWS to Layer 1.** The resolver's obligation is A-vs-C. TERMINATED/INACTIVE is **not
   the resolver's job** under `#182`.
2. **Part I's shape obstruction is DISCHARGED.** The not-actionable fact lives in the **census layer**,
   so `OwnerDerivation`'s inability to carry it (`typedOwner.ts:42-43`, `:52-57`) stops being a
   blocker. **`OD-6`'s residual shape question shrinks accordingly.**
3. **A NEW item is required for Layer 2**, because Part I has no item that owns eligibility as
   distinct from resolution — `C-B6` came closest and is a **reporting** contract, not an eligibility
   one. → **`OI-31`**, and its architecture is `MI-P`'s (**`OI-32`**).
4. **`C-B4` ("must not write, must not choose") is RATIFIED and now over-determined**: `#182`'s
   *"No backfill authorized"* forbids the write from a second direction.
5. **`C-B7` (parity) gets a PARTIAL ANSWER.** Layer 1 requires a trusted cross-collection read, which
   `typedOwner.ts:1-8`'s client mirror cannot perform. So **Layer 1 is trusted-side-only by
   construction** and the client's obligation is to *render* it, never to compute it. **`C-B7`'s "which
   side owns the new outcomes" is answered for Layer 1 and still open for Layer 2.**

### 12.3d A divergence between `C-B3` and the ruled state set, flagged not resolved

`#182` state **C** is `MISSING / **INVALID_REFERENCE**` — it **FUSES** *missing* and *invalid* into one
state. `C-B3` **splits** them across two existing code paths:

| Condition | Today's behaviour at `64008d5a` | Gate effect |
|---|---|---|
| field **absent** ("missing") | `OWNERLESS` (`typedOwner.ts:201` / `ownershipCensus.ts:157-163`) | **BLOCKS** — `totals.ownerless` is a term of `blocking` (`ownershipCensus.ts:231`) |
| field present, names no employee ("invalid reference") | **`RESOLVED`** — the defect | **CANNOT BLOCK AT ANY QUANTITY** (Part I §2.1, `:231`, `:240`) |

**If `#182`'s state C is one state, these two must receive the SAME gate treatment — and today they
receive OPPOSITE treatment.** That is a **sharpening of `OI-10`**, and it is testable with no employee
data at all. **Whether C is genuinely one state or two is a naming question `#182` withholds.** →
**MISSING INPUT MI-U**.

---

## 12.4 TWO REFERENCES, NOT ONE — the split, and the specification/proof asymmetry

`#182` Layer 1 applies to **RECORD OWNER (PERSON/USER)**, **ACCOUNTABLE PERSON**, and future governed
person references, and requires them **independently validated — never substitute one's validity for
the other's.** **Every Part I Area B item was scoped to the OWNER reference only.**

**The accountable reference does not exist at `64008d5a`** (**V-5**: 0 hits across 12 ownership
modules). That produces a hard asymmetry, which is the organizing fact of this section:

> **An item about the accountable reference can acquire a SPECIFICATION obligation now. It CANNOT
> acquire a PROOF obligation**, because there is no code, no field and no state vocabulary to assert
> against — and `#182` **withholds the names** that would let one be created. Writing a proof
> obligation for it today would be writing a schema, which is forbidden.

| Part I item | Disposition | Owner-reference half | Accountable-reference half |
|---|---|---|---|
| **OI-06** consult the authority | **SPLITS IN TWO** | **OI-06** — proof possible today (fake authority, the `ownershipCensus.ts:5-7` pattern) | **NEW OI-30** — **specification only** |
| **OI-07** the state table | **SPLITS IN TWO, and NARROWS to Layer 1** (§12.3c) | **OI-07** — proof possible today | **NEW OI-30** (Layer 1) + **NEW OI-31** (Layer 2) — **specification only** |
| **OI-08** namespace identity | **WIDENED, does NOT split** | one item, **two obligations**: the question must be answered **independently for each reference**, since `#182` forbids substituting one's validity for the other's | and **V-15**: the matrix declares **three** authority rows, two of them *"person authority"* (`ownershipMatrix.ts:513-515`) → **NEW OI-39** |
| **OI-09** unreadable authority | **CONFIRMED, UNCHANGED** | one authority read ⇒ **one** failure outcome serves **both** references. Nothing splits. Statement widened only | — |
| **OI-10** gate arithmetic | **WIDENED, hard new dependency** | unchanged | `#182`: *"Gate may not close on a census structurally incapable of detecting non-existent/invalid person owner **or missing/invalid accountable person**."* The second input **does not exist** and requires `MI-P`'s architecture → **OI-10 now depends on OI-32** |
| **OI-11** parity | **WIDENED, partially answered** | Layer 1 is **trusted-side-only by construction** (§12.3c.5) | Layer 2's side-ownership is open |

---

## 12.5 `MI-P` — THE ARCHITECTURE CONSEQUENCE

`MI-P` **CLOSED**: accountability **is** measured, but **NOT** by adding `accountablePerson` to
`ownershipMatrix.ownerFields`. Acceptable: **(i)** extend the census into a **multi-axis responsibility
census**, or **(ii)** a **dedicated accountability census composed into the gate**. Eventual axes:
**RECORD OWNERSHIP · ACCOUNTABILITY · ASSIGNMENT where governed · ESCALATION where governed.**
*"Prepare the smallest design consistent with this ruling"* — **not the final architecture.**

### 12.5a Does `MI-P` invalidate any Part I item that assumed the existing census would carry accountability?

**No item is invalidated. One is ratified with unusual exactness; three are relocated or widened.**

| Item | Effect of `MI-P` |
|---|---|
| **OI-02** | **RATIFIED, EXACTLY.** OI-02 already required the declaration to be *"per family and orthogonal — it **may not be an `ownerFields` entry**, may not reuse `ownerType`, and may not be satisfied by `assignedTechId`."* **That is precisely what `MI-P` closed.** An unchanged conclusion, stated confidently: **Part I got this right before the ruling.** `MI-P` then **WIDENS** it — OI-02 spoke of a *declaration*; `MI-P` names the **measurement architecture** and **four axes**. OI-02 keeps the declaration; the architecture becomes **OI-32** |
| **OI-03** | **NARROWED AND RELOCATED.** The open/actionable discriminator is still required — `#180` invariant 1 (*"never NONE on actionable work"*) makes it load-bearing, and `#182` proof 10 cannot exist without it. But its **home moves**: under `MI-P` it belongs to the **accountability axis** of a responsibility census, not to the single-axis ownership census. Acquires a dependency on **OI-32** |
| **OI-05** | **RATIFIED AND PROMOTED.** `#180` invariant 8 (*"COMPANY ownership may coexist with a PERSON accountable"*) plus `MI-P`'s multi-axis census are together what make a `PARTICIPATING_COMPANIES` family expressible. `transferOrder` stops being a thought experiment and becomes the **architecture's acceptance case** |
| **OI-10** | **WIDENED** — see §12.4 |
| **every Area A item** | None assumed the `ownerFields` route. **Part I proposed no column anywhere** (§8, §11). `MI-P` invalidates **nothing** in Part I |

### 12.5b What the verified evidence predicts for the accountability axis

**This is the most useful new fact in Part II, and it is a natural experiment EOS has already run —
twice.**

| Fact | Evidence (**V-3**, **V-4**) |
|---|---|
| `creditedSalespersonId` is a **governed person fact** written by **all three** commercial creation paths | `opportunityCommands.ts:178`, `salesAgreementCommands.ts:307-308`, `salesOrderCommands.ts:291` |
| It has a **derivation chain of exactly `#181`'s shape** — explicit → inherited → the commercial owner | `financialAttribution.ts:321-330`, and `:328` falls back to `commercialOwnerEmployeeId` |
| Its **entire** validation is `nonEmpty` | `financialAttribution.ts:326-328`; and `person()` at **`:205-209`** for the frozen snapshot |
| `responsibleEmployeeId` is a **second** such fact, on the same floor | `financialAttribution.ts:164`, built at `:229` through the same `person()` |
| In the **same function**, the COMPANY reference is **required and validated** and throws | `financialAttribution.ts:212-224` `COMPANY_REQUIRED` / `COMPANY_INVALID` |
| **Neither person field appears in `ownershipMatrix.ts` or `ownershipCensus.ts`** | zero occurrences |

**What it predicts — three things:**

1. **`MI-P`'s ruling is load-bearing engineering, not architectural taste.** EOS has **already** shipped
   governed person facts outside the matrix and outside the census, **twice**, and the outcome each
   time was the same: *governed at creation, never measured afterwards, validated only for
   non-emptiness.* **Without a census axis, an accountability field will land exactly where
   `creditedSalespersonId` landed.** The two acceptable architectures `MI-P` names are the difference
   between a measured axis and a third unmeasured person fact.
2. **`#182`'s *"Do not implement it using today's shape-only USER resolution"* has a SECOND, UNNAMED
   INSTANCE.** The ruling names `typedOwner`'s shape-only resolution. **The identical floor exists in
   `financialAttribution.ts:205-209`, on two person fields, and no ruling reaches it.** →
   **NEW OI-38**.
3. **`MI-Q`'s protection is correct but INCOMPLETE.** *"Do not change `creditedSalespersonId`
   semantics"* protects the **meaning** (credit ≠ accountability) and says **nothing about the
   validation floor**. A future accountable person derived from the commercial owner (`#181` rule 2)
   will sit beside a credit field derived from **the same owner** (`financialAttribution.ts:328`) —
   one validated, one not. **A reader will not be able to tell which of the two the system stands
   behind.** `MI-Q` is **CLOSED**; this is not a reopening, it is the adjacent gap it does not cover.

---

## 12.6 AREA D AND INVARIANT 7

`#180` invariant **7**: *"handoff must guarantee NO RESPONSIBILITY GAP"* — now **binding**. `OD-7`
**still OPEN**.

**Does the 6-step sequence + `W0′` still hold? YES — the ORDER is unchanged. Invariant 7 ADDS an
obligation and ADDS one step; it REORDERS nothing.**

| Step | Constrained by invariant 7? | Verdict |
|---|---|---|
| **W1** — live writer refuses what it cannot validate | **NO** | **CONFIRMED, UNCHANGED.** Still first. Both `OD-7` shapes **add refusals and neither enables a write**, so Part I §4.2's safety argument is untouched by all five rulings. §4.1a's positive control (`assignWarehouseRootCompany.js:72`, `:234`) is unaffected |
| **W2** — ratchet | **NO** | **CONFIRMED, UNCHANGED** |
| **W3** — land Area B | **INDIRECTLY** | **WIDENED.** W3's invariant was *"a handoff can never move ownership to a person the system cannot prove exists **and can act**."* `#182` **splits** that: *exists* = **Layer 1**, *can act* = **Layer 2**. And `#180` invariants **3** and **5** mean an **ownership** handoff satisfying W3 **can still leave an accountability gap**. **W3 as written is necessary and NO LONGER SUFFICIENT** |
| **NEW `W3′`** — no handoff may commit that leaves the record's accountable person in state **D** (`NONE`, prohibited for actionable work by `#180` invariant 1) or in state **B**/**C** | **THIS IS THE STEP INVARIANT 7 CREATES** | **NEW → OI-37.** Gated on `#180` (ruled), **and** on `MI-P`'s architecture (**OI-32**) and the accountable-reference specification (**OI-30**/**OI-31**) — **i.e. on things that do not exist.** It must precede **W6** and must precede **any step that exposes a handoff**. Whether it precedes **W4** is a **sequencing preference, not a safety constraint**: W3′ (accountable axis) and W4 (owner axis) are **independent**, and saying otherwise would overstate the finding |
| **W4** — `previousOwner` read transactionally, never caller-supplied | **YES** | **WIDENED by `#181` and invariant 6.** `#181`: an action intending **both** an owner change and an accountability change is *"**one explicit governed operation recording both**"*, and `#180` invariant **6** makes *"historical accountability must remain auditable"* mandatory. So W4 widens from **one** derived fact to a **governed pair**. §4.1a's note that W4 is *"later in risk order than the step numbering suggests"* **still holds for the owner half** — `assignmentHandoffInput` already derives `previousOwner` (`warehouseRootCompanyAssignment.ts:371-391`) — and **does NOT hold for the accountable half**, because **no existing caller derives an accountable person at all** → **OI-36** |
| **W5** — close R1–R5 **before** any handoff authority is exposed | **YES** | **DOES NOT MOVE. Position 5 confirmed, justification WIDENED. Both directions argued below** |
| **W6** — activate | — | **UNCHANGED. NOT AUTHORIZED. DO NOT ACTIVATE.** Its gate list **WIDENS**: `assessable === true` now additionally requires a census `#182` says must be *structurally capable* of detecting an invalid accountable person. The `64008d5a` census **is not** (`ownershipCensus.ts:165` maps only `ownerFields`, **V-2**). **W6's gate is now unreachable by a strictly larger margin than Part I recorded** |
| **W0′** — reconcile the second family-validation authority | **NO** | **CONFIRMED, UNCHANGED**, with a **mild widening**: `#182` Layer 1 covers *"future governed person references"*, and `commercialOwnershipAuthority.ts` governs the three families `#181` just ruled on, so W0′ acquires a **second** reconciliation surface |

### 12.6a Does W5 move? — argued both ways, answer NO

| Direction | Argument | Weight |
|---|---|---|
| **Move EARLIER?** | `ownershipBackfillRules.ts:74-77` propagates the Account's owner to **every child** (**V-6**), and `accountOwner` is client-rewritable through a shipped picker with the Rules file itself documenting that a non-admin *"may freely edit every OTHER field"* (`firestore.rules:1303-1305`, **V-12**). So **R3 is an INPUT to a propagation the ruling has now declared unsafe** | **Defeated.** `#182`: *"**No backfill authorized**."* The propagation **cannot run**, so R3's being an input to it is currently **inert**. And OI-14's dependency is unchanged: **OI-17 must land first, or closing R3 removes the only working owner-assignment path** |
| **Move LATER?** | Nothing in the five rulings weakens W5 | **Defeated.** Invariant 7 gives W5 a **second independent justification**: an unaudited client-direct owner rewrite (R3 `accountOwner`, R2 `operatingCompanyId`) can move the record's owner **without** the single governed operation `#181` requires to record both facts — so it can **create a responsibility gap invisibly**, which is exactly what invariant 7 forbids |
| **VERDICT** | **W5 STAYS AT POSITION 5.** *"There is exactly one path that changes ownership"* now also means *"exactly one path that can open a responsibility gap"* | |

---

## 12.7 AREA E — the conclusion STANDS, plus exactly one added guarantee

**Part I found Area E needs none of `OD-1` / `OD-6` / `OD-7`, no Rules change, and only Owner
**product** approval. Does `#180` invariant 7 or `#182`'s gate ruling change that?**

> ## NO. THAT CONCLUSION STANDS, AND TWO OF THE FIVE RULINGS STRENGTHEN IT.

| Ruling | Reach into Area E |
|---|---|
| **`#180` invariant 7** (*handoff must guarantee no responsibility gap*) | **DOES NOT REACH IT.** Invariant 7 governs **handoff**. A post-`Dispatch` reassignment performs **no handoff**: `assignedTechId` is deliberately excluded from `workOrder.ownerFields` (`ownershipMatrix.ts:200-201`, `:249` `ownerFields: []`), which is Part I's **G1** |
| **`#180` invariant 2** (*"reassigning execution doesn't change accountability"*) | **PROMOTES G1 FROM AN OBSERVATION TO A RULED INVARIANT.** Part I argued separability from code structure. `#180` now **rules** it. **G1's premise is no longer this lane's reasoning; it is the Owner's** |
| **`MI-R`** (*eligibility ≠ execution authority; an accountable person **may delegate execution***) | **RATIFIES AREA E'S ENTIRE PREMISE and FORECLOSES A BLOCKER.** It removes any reading under which a post-`Dispatch` reassignment would have needed an accountability decision. **`MI-R` is CLOSED** |
| **`#182`'s gate ruling** | **DOES NOT REACH IT.** The census gate governs **enforcement activation** (W6). Area E is a state-machine/assignment change on a **client-closed** collection — `firestore.rules:509` `allow create, update, delete: if false`, re-verified in the exhaustive enumeration at **V-10**. **No Rules change; tier stays normal** |
| **`#181` / `MI-P` / `MI-Q`** | No reach. Area E touches no commercial family and no census |

**The one change — a new guarantee `G8`:** `workOrder` is in the accountability **IRREDUCIBLE CORE**
both before and after §12.2c. Under `#180` invariant 1, an actionable Work Order must eventually carry
**exactly one** accountable person. **G1 today proves *"no owner field is written."* Under `#180` it
must also prove *"no ACCOUNTABILITY field is written"*** — which is **trivially true at `64008d5a`**
(no such field exists, **V-5**) and therefore a **vacuous** assertion that will **silently decay the
moment the axis lands** unless it is written as an asserted diff now. → **NEW OI-42.**

**Cross-link worth recording:** `#180` invariant **6** (*"historical accountability must remain
auditable"*) is the **same shape of requirement** as Part I's **G2**, and G2's shipped precedent
(`schedulingCommands.ts:242-256`, *"without this line nothing anywhere would remember the old ones"*)
is the pattern invariant 6 will need. **`OI-28` becomes a cited precedent for Area A and Area D work.**

**OI-26, OI-27, OI-28, OI-29: CONFIRMED, UNCHANGED.** `OD-13` and Owner **product** approval remain
the only gates, exactly as Part I recorded.

---

## 12.8 AREA C — tier and ordering

| Question | Verdict |
|---|---|
| **Does any ruling change the TIER of the 5 TIER-2 items?** | **NO.** Tier is set by `firestore.rules` being **hash-anchored to the live deploy** with its own authorization, dual-copy parity and deploy-and-verify procedure (§3.3, §7). **None of the five rulings touches the Rules change procedure.** All five stay **TIER-2**, and all five stay **UNPROVEN for want of an emulator** (`U-1`) |
| **Does any ruling change the ORDERING?** | **ONE change, and it is a REMOVAL of pressure, not a reordering.** `#182`'s *"No backfill authorized"* + **V-6** mean the `ownershipBackfillRules.ts:74-77` propagation **cannot run**, so R3's role as its input creates **no urgency** to close R3 early (§12.6a). Ordering therefore stands as Part I implies, now with an explicit reason: **OI-15 → OI-13 → OI-14 (after OI-17) → OI-12 (after the vocabulary decision)**. OI-15 remains the safe first exercise — *"the only two with no shipped surface to preserve"* |

### 12.8a The controller's findings, each re-measured

| Finding | Verdict |
|---|---|
| `firestore.rules:381-384` (`fieldops_jobs`, no `hasOnly`, rewritable `operatingCompanyId`) is a live TIER-2 defect **no branch fixes** | **CONFIRMED independently (V-7).** This is Part I's **R2 / OI-13**. The file's own comment at `:377-380` scopes the `hasOnly(['status'])` allowlist to the technician branch — *"in this transition"* |
| `operatingCompanyId` is **0/12 in production** | **NOT VERIFIABLE HERE** (no production contact — hard constraint). **NOT A CONTRADICTION** of Part I's 41/45, which `ownershipMatrix.ts:262-265`, `:271` attributes explicitly to the **sandbox** certification fixtures. **Two environments, two populations. BOTH CARRIED** → **`U-12`** |
| `operatingCompanyId` is **not read for authority** on that family | **CONFIRMED (V-9).** It appears **nowhere** in `firestore.rules:353-395`. **This cuts BOTH ways for OI-13, and both must be recorded:** it **NARROWS** the defect's blast radius from privilege escalation to *silent corruption of a measured-but-unread governance fact*; and it **WIDENS** the argument for fixing it, because **a field nobody reads for authority is a field nobody will notice being wrong.** **Tier does not change** — the fix is still in Rules |
| **5 of 30** `allow update` statements lack a `hasOnly` allowlist | **NUMERATOR CORRECT, DENOMINATOR WRONG — corrected at V-10 and X-12.** **25** statements grant update, **18 are `if false`**, **7** permit a client update, **2 of the 7 are allowlisted**, so **5 of 7 lack one**. *"5 of 30"* **understates the defect rate roughly fourfold** and cites a count the file does not contain. **5 of 7 is a structural finding; 5 of 30 reads like a rounding error** |
| *(new, derived)* Did Part I's hand-assembled census **miss** a site? | **NO (V-11).** Of the 5 unallowlisted client-writable statements, **4 expose a matrix-declared owner field** and they are **exactly** R2, R3, R4, R5. The fifth (`:418` `fieldops_technicians`) is **EXCLUDED / person authority** with `ownerFields: []` (`ownershipMatrix.ts:515`), so it exposes none. **§3.1 is now exhaustively verified for the Rules surface** — which **closes half of `U-9`** and validates **OI-18**'s design |

---

## 13. STATUS TABLE — ALL 29 ITEMS REASSESSED

`IMPLEMENTATION STATUS = NOT AUTHORIZED` for **every row**. Revised fields shown only where a ruling
moved them; otherwise Part I §6/§6a stand.

| ID | STATUS NOW | UNBLOCKED BY (revised) | TIER | DEPENDENCIES (revised) | ACCEPTANCE PROOF (revised) |
|---|---|---|---|---|---|
| **OI-01** | **WIDENED** | **`#180` (`OD-1` RULED)** — was open | normal | root; T3 is a **null clause** at this baseline (§12.2b) | The test must now reproduce the **9**-family set and the **12** T2 failures, **and** classify the three commercial families **IN** (`#181`). The negative-control requirement stands and gains `#182` proof 13 |
| **OI-02** | **CONFIRMED, UNCHANGED — then WIDENED** | **`#180`** | normal | OI-01; architecture split to **OI-32** | **`MI-P` RATIFIED OI-02's `ownerFields` prohibition exactly.** Proof unchanged; the *"no assertion reads an `ownerFields` entry"* clause is now a ruling, not a preference |
| **OI-03** | **NARROWED AND RELOCATED** | **`#180`** + **`MI-P`** | normal | OI-01, OI-02, **+OI-32** | Unchanged in substance; its **home** moves to the accountability axis of the responsibility census. Becomes an input to `#182` **proof 10** |
| **OI-04** | **CONFIRMED, UNCHANGED** | `#180` + a role grant + a job-role ruling | **AUTHORITY** | independent | Unchanged. **`MI-R` narrows what eligibility MEANS** (governed employment/person status minimum; **not** *"has the capability to perform the assigned command"*; further constraints **per family, never global**) **and supplies no occupant.** Zero holders of 45 governed Roles stands |
| **OI-05** | **WIDENED (promoted)** | **`#180` (invariant 8)** + `OD-16` | normal | OI-02, **+OI-32** | Unchanged, and now the **acceptance case for `MI-P`'s architecture** rather than a thought experiment |
| **OI-06** | **NARROWED + SPLIT** | **`#182` (`OD-6` RULED)**; still **revisits `O-1`** | normal | none | **Owner reference only.** Accountable half → **OI-30**. Proof unchanged and still achievable today (fake authority, `ownershipCensus.ts:5-7` pattern) |
| **OI-07** | **NARROWED to Layer 1 + SPLIT + one obstruction DISCHARGED** | **`#182`** | normal | OI-06 | **Layer 1 (A vs C) only.** TERMINATED/INACTIVE moves to **Layer 2 / OI-31**. Part I's *"nowhere to live in `OwnerDerivation`"* obstruction is **DISCHARGED** (§12.3c). **WIDENED by one required case:** `#182` **proof 5** (missing-reference) has **no `C-B3` row** (§12.3d). The 6×2=12 proof becomes **Layer-1 cases × 2 owner-field shapes**, plus the negative control, plus the mutation check |
| **OI-08** | **WIDENED** | `#182` + open item **`O-1`** | normal | OI-06, **+OI-39** | Must be answered **independently for each reference** (`#182`: never substitute one's validity for the other's). **And V-15: the matrix declares THREE authority rows, two of them *"person authority"* (`ownershipMatrix.ts:513-515`) — Layer 1 cannot name *"the"* authority until that is settled** |
| **OI-09** | **CONFIRMED, UNCHANGED** | `#182` | normal | OI-06 | Unchanged. **Does not split** — one authority read, one failure outcome, serving both references. **`#182` does NOT provide for this state** (§12.3a, **MI-T**), so `C-B3`'s sixth row survives as an unratified, unforbidden addition |
| **OI-10** | **WIDENED, + a hard new dependency** | `#182` | normal | OI-07, OI-09, **+OI-32** | `#182`: *"Gate may not close on a census structurally incapable of detecting … **or missing/invalid accountable person**."* **Second input does not exist.** **Sharpened by §12.3d:** if state C is one state, *missing* (blocks via `ownerless`, `:231`) and *invalid reference* (cannot block at any quantity) must receive the **same** gate treatment and today receive **opposite** treatment — **testable with no employee data** |
| **OI-11** | **WIDENED, partially answered** | `#182` | normal | OI-07 | **Layer 1 is trusted-side-only by construction** — the client mirror cannot perform a cross-collection read (`typedOwner.ts:1-8`). `C-B7`'s side-ownership question is **answered for Layer 1**, **open for Layer 2** |
| **OI-12** | **CONFIRMED, UNCHANGED** | `OD-8` (+ `OD-16`) | **TIER-2** | vocabulary decision first | Unchanged. **No ruling touches the `currentOwner` vocabulary collision.** **BLOCKED — no emulator** (`U-1`) |
| **OI-13** | **CONFIRMED, UNCHANGED (tier); NARROWED and WIDENED (character)** | `OD-8` | **TIER-2** | — | Proof unchanged. **V-7 independently confirms the defect; V-9 confirms `operatingCompanyId` is never read for authority on that family** — which narrows the blast radius to silent corruption of a measured-but-unread fact **and** widens the case for fixing it. **BLOCKED — no emulator** |
| **OI-14** | **CONFIRMED, UNCHANGED** | `OD-8` | **TIER-2** | **OI-17 first** — unchanged | Unchanged. **V-12 strengthens the finding**: `firestore.rules:1303-1305` **documents** that a non-admin may freely edit `accountOwner`. **`#182`'s no-backfill ruling REMOVES the pressure to move this earlier** (§12.6a). **BLOCKED — no emulator** |
| **OI-15** | **CONFIRMED, UNCHANGED** | `OD-8` | **TIER-2** | none | Unchanged. Still the safe first Tier-2 exercise. **BLOCKED — no emulator** |
| **OI-16** | **CONFIRMED, UNCHANGED — and WIDENED by `#181`** | `OD-7` (still **OPEN**) | normal | OI-19 | Unchanged, **plus**: `#181` rules that owner and accountable changes *"never cascade silently into each other"* and an action intending both is **one explicit governed operation recording both**. `updateOpportunity` applies `ownerEmployeeId` through the **generic `record()` helper** (`opportunityCommands.ts:312-318`) — **the opposite of an explicit governed operation.** The three-family inconsistency (**N5**) is now joined by **V-14** (`salesAgreement` does not use `resolveCreationOwner` at all) → **OI-34** |
| **OI-17** | **CONFIRMED, UNCHANGED** | `OD-8` + EI-44's datastore confirmation | normal | datastore target first | Unchanged. *"**Do not run any backfill against it**"* is now **doubly binding** — `#182`: **No backfill authorized** |
| **OI-18** | **CONFIRMED, UNCHANGED — and its design is now VALIDATED** | none (it only measures) | normal | the matrix as-is | Unchanged, **and V-10/V-11 are a hand-run of exactly this guard**: 25 update-granting statements → 7 client-writable → 4 owner-field exposures = **exactly R2–R5**. **This closes half of `U-9`** and demonstrates the guard's positive control (`equipment` `:1542`) and negative controls (`:381`, `:1335`, `:1343`, `:1557`) |
| **OI-19** | **CONFIRMED, UNCHANGED** | **`OD-7` — STILL OPEN** | normal | none — **still first** | Unchanged. **All five rulings leave W1 untouched**: both shapes add refusals only and neither enables a write. Positive control (`assignWarehouseRootCompany.js:72`, `:234`) stands; `U-11` stands |
| **OI-20** | **CONFIRMED, UNCHANGED** | — | normal | OI-19 | Unchanged |
| **OI-21** | **WIDENED** | **`#182`** | normal | OI-06..OI-11, **+OI-30/OI-31/OI-37** | Part I: *"a handoff to a terminated employee validates cleanly."* Under `#182` that splits — **Layer 1** must refuse a **non-existent** newOwner; a **terminated** newOwner is **state B**, a **Layer 2 eligibility** refusal, and `#182` says the reference must be **preserved, not invalidated**. **So OI-21's single refusal becomes two refusals of different kinds in different layers.** The negative control (*"proves it is accepted today"*) stands for both |
| **OI-22** | **WIDENED** | `OD-7` + **`#180`** (was `OD-1`, now ruled) | normal | OI-19 | **`#181`** + **`#180` invariant 6**: an action intending both changes is **one explicit governed operation recording both**, and historical accountability **must remain auditable**. So the proof widens from `previousOwner` to a **governed pair**. The CLI's `previousOwner: null` first-assignment case still passes → detail at **OI-36** |
| **OI-23** | **WIDENED** | `OD-8` | **TIER-2** | OI-12..OI-15 closed **and deployed** | Unchanged in form; **invariant 7 gives it a second justification** — an unaudited owner path can open a **responsibility gap** invisibly, not merely an audit gap |
| **OI-24** | **CONFIRMED, UNCHANGED — gate list WIDENED** | `OD-7` + **`#180`** + `OD-8` + `assessable === true` | mixed | all of the above, **+OI-30..OI-32, OI-37** | **NOT AUTHORIZED — DO NOT ACTIVATE.** `assessable === true` now additionally requires a census `#182` says must be structurally capable of detecting an invalid **accountable** person; `ownershipCensus.ts:165` **is not**. **The gate is further from closable than Part I recorded** |
| **OI-25** | **CONFIRMED, UNCHANGED — mildly WIDENED** | `OD-7` | normal | OI-19 | Unchanged, plus a **second** reconciliation surface: `#182` Layer 1 covers *"future governed person references"* and `commercialOwnershipAuthority.ts` governs the three families `#181` ruled on |
| **OI-26** | **CONFIRMED, UNCHANGED** | `OD-13` + Owner **PRODUCT** approval | normal (**no Rules change**) | OI-29 with it, **+OI-42** | Unchanged. **`#180` invariant 2 PROMOTES G1 from this lane's structural observation to a ruled invariant; `MI-R` ratifies the premise and forecloses a blocker.** `firestore.rules:509` `if false` re-verified (V-10). **+G8** (**OI-42**): the diff assertion must cover accountability fields, not only owner fields |
| **OI-27** | **CONFIRMED, UNCHANGED** | `OD-13` + Owner **product** approval | normal | separate change from OI-26 | Unchanged. **`MI-R`'s eligibility ≠ execution-authority distinction independently supports G7's separation**: *"someone else will do this"* is a delegation; *"this could not be done"* is an outcome |
| **OI-28** | **CONFIRMED, UNCHANGED — and PROMOTED to a cited precedent** | `OD-13` | normal | OI-26 | Unchanged. **`#180` invariant 6** (*historical accountability must remain auditable*) is the **same shape** of requirement, and G2's shipped precedent (`schedulingCommands.ts:242-256`) is the pattern it will need |
| **OI-29** | **CONFIRMED, UNCHANGED** | `OD-13` | normal | — | Unchanged. No ruling touches `transitionEngine.ts` |

**Tally: 29 reassessed — 0 `DISCHARGED BY RULING` at item level · 14 `CONFIRMED, UNCHANGED` · 11
`WIDENED` · 4 `NARROWED` (OI-03, OI-06, OI-07, OI-13 in part) · 0 `SUPERSEDED` · 0 `CONTRADICTED BY
RULING`.**

> **The one CONTRADICTION is not an item — it is an ARGUMENT.** Part I §1.3's **T3 justification** for
> excluding the commercial chain is **CONTRADICTED BY RULING (`#181`) AND BY CODE (V-1)**, and §1.4's
> **6-family minimum is SUPERSEDED by 9**. Recorded as **X-10** and stated loudly at §12.2a rather than
> edited away. **No `OI-nn` is contradicted, because no item asserted the boundary count — OI-01 asks
> for the test to be adopted, and the test survives with T3 nulled.**
>
> **Two Part I positions are DISCHARGED BY RULING** at sub-item level: `C-B3` TERMINATED's **reason
> (2)** (the backfill proxy — `#182` forbids the backfill directly), and Part I §2.2's **shape
> obstruction** (`#182`'s two layers move the fact out of `OwnerDerivation`).

---

## 14. NEW ITEMS — `OI-30` … `OI-42`

Created **only** where a ruling or a required proof has no Part I home. **Every one is
`IMPLEMENTATION STATUS = NOT AUTHORIZED`.** **No field, enum, collection or schema is named** — `#182`
withholds them.

| ID | AREA | WHAT IS MISSING | REQUIRED CONTRACT | UNBLOCKED BY | TIER | DEPENDENCIES | OBLIGATION TYPE |
|---|---|---|---|---|---|---|---|
| **OI-30** | B | **The ACCOUNTABLE PERSON reference has no Layer-1 contract** — it does not exist at all (**V-5**: 0 hits / 12 modules) | `#182` Layer 1, applied **independently** of the owner reference: non-empty string, type `USER` and successful parse are **each insufficient**; NON-EXISTENT and DELETED/UNRESOLVABLE must not yield the same authoritative result as a real Employee. **Never substitute the owner's validity for it** | **`#182`** | normal | OI-06 (the authority read), **OI-39** (which authority) | **SPECIFICATION ONLY.** No proof obligation can attach at `64008d5a`: there is no code, no field, and `#182` withholds the names |
| **OI-31** | B | **Layer 2 — CURRENT ACCOUNTABILITY ELIGIBILITY has no owner in Part I.** `C-B6` is a *reporting* contract, not an eligibility one | `#182` Layer 2, in the **accountability census and the enforcement gate** (not the resolver). Must distinguish state **A** from state **B** while **preserving** the reference — `UNRESOLVED` must **not** be the automatic representation for inactive/terminated. **`MI-R`: minimum is governed employment/person status; NOT *"has the capability to perform the assigned command"*; further company/domain constraints per family, never global** | **`#182`** + **`MI-R`** (CLOSED) | normal | OI-30, **OI-32** | **SPECIFICATION ONLY** |
| **OI-32** | A/B | **`MI-P`'s measurement architecture has no item.** The census is **structurally single-axis** (**V-2**: `ownershipCensus.ts:165` maps only `family.ownerFields`; `:157-163` returns OWNERLESS when it is empty) | **`MI-P`'s two acceptable shapes, and only those**: **(i)** extend the census into a **multi-axis responsibility census**, or **(ii)** a **dedicated accountability census composed into the gate**. **NOT** an `ownerFields` entry. Eventual axes: **RECORD OWNERSHIP · ACCOUNTABILITY · ASSIGNMENT where governed · ESCALATION where governed.** *"Prepare the smallest design consistent with this ruling"* — **not the final architecture** | **`MI-P`** (CLOSED) | normal | OI-02, OI-03 | **SPECIFICATION ONLY** (a design, and only the smallest one) |
| **OI-33** | B | **COMPANY-owner ACTIVE-STATUS integrity.** Part I's **X-8** found `resolveOperatingCompany` returns `INACTIVE` (`operatingCompanyAuthority.ts:54`, `:80`) and `deriveCompanyOwner` handles **only** `INVALID`/`UNKNOWN` — `INACTIVE` **falls through to `RESOLVED` and is discarded** (`typedOwner.ts:137-143`); currently invisible because both seeded companies are `active: true` (`:42`, `:48`) | `#182`: *"**Record-owner validity must also be closed**."* Proofs **11**/**12** require COMPANY OWNER valid **and** invalid. `INVALID`/`UNKNOWN` are satisfiable today; **an inactive company owner is not detectable** | **`#182`** | normal | none — pure unit test over the existing resolver | **PROOF POSSIBLE TODAY.** **Part I explicitly declined to own X-8** (*"Not in this lane's five areas to fix; recorded for the controller"*). **`#182` pulls it back in by ruling** |
| **OI-34** | C | **Sales Agreement does not share the commercial creation shape.** `salesAgreementCommands.ts` **does not import `creationOwnerResolution`** (`:1-16`); it **requires** an explicit owner (`:280` `OWNER_REQUIRED`, `nonEmpty` only) with **no inheritance branch** (`:301`). `resolveCreationOwner` is called only at `opportunityCommands.ts:159` and `salesOrderCommands.ts:261` (**V-14**) | **`MI-Q`**: Sales Agreement gets **the same creation shape**. **And `MI-Q` is CLOSED**, so this is execution of a ruling, not a question | **`MI-Q`** (CLOSED) + `#182` (the inherited reference must satisfy the **CURRENT eligibility** contract) | normal | OI-30, OI-31 | **SPECIFICATION** now; **PROOF POSSIBLE** for the shape-parity half alone (that all three paths route through one resolver), **not** for the validity half |
| **OI-35** | A | **No creation rule for the ACCOUNTABLE PERSON on the three commercial families** | **`#181`**: **EXPLICIT VALID ACCOUNTABLE PERSON → GOVERNED DERIVATION FROM CURRENT COMMERCIAL RECORD OWNER → REFUSE**, **initialization only**. **`accountablePerson = ownerEmployeeId` as a permanent computed identity is FORBIDDEN.** **`#182`**: the derived reference must satisfy the **CURRENT eligibility** contract — *"The word VALID is load-bearing. Do not implement it using today's shape-only USER resolution."* **V-13 identifies the exact target**: `creationOwnerResolution.ts:63-64` (EXPLICIT, `nonEmpty` only) and `:67-74` (INHERITED, gated on a shape-only `RESOLVED`) | **`#181`** (CLOSED) + **`#182`** | normal | OI-30, OI-31, OI-01 | **SPECIFICATION ONLY** |
| **OI-36** | D | **No governed operation can record an owner change and an accountability change together** | **`#181`**: owner and accountable changes **never cascade silently into each other**; an action intending both is **ONE EXPLICIT GOVERNED OPERATION RECORDING BOTH**; **historical facts are not rewritten**. **`#180` invariant 6**: historical accountability **must remain auditable**. **This is W4's widened half** | `OD-7` (**OPEN**) + **`#180`** + **`#181`** | normal | OI-19, OI-22, OI-30 | **SPECIFICATION.** Note `auditEventWriter.ts:571-581` **refuses** `previousOwner`/`newOwner`/`handoffSource` on any non-handoff action and `:532-535` refuses `objectId` — **the same structural obstruction OI-16 records** |
| **OI-37** | D | **`W3′` — invariant 7 has no step.** No mechanism can guarantee a handoff leaves **no responsibility gap** | **`#180` invariant 7**, binding: no handoff may commit that leaves the record's accountable person in state **D** (`NONE`, prohibited on actionable work by invariant 1) or in state **B**/**C**. Must precede **W6** and any step that **exposes** a handoff. **Independent of W4** — sequencing between them is preference, not safety | **`#180`** + `OD-7` (**OPEN**) | normal | OI-30, OI-31, OI-32 | **SPECIFICATION ONLY** |
| **OI-38** | B | **A second unvalidated governed person-fact floor, outside the matrix and outside the census, that no ruling reaches.** `person()` at `financialAttribution.ts:205-209` checks **only** `nonEmpty`, and carries **both** `creditedSalespersonId` (`:228`) and `responsibleEmployeeId` (`:229`, declared `:164`). In the **same function** `operatingCompanyId` is required and throws (`:212-224`). **Zero** occurrences of either field in `ownershipMatrix.ts` or `ownershipCensus.ts` (**V-4**) | `#182`'s *"Do not implement it using today's shape-only USER resolution"* applies **by analogy and not by ruling** — it names `typedOwner`, not `financialAttribution`. **`MI-Q` is CLOSED and protects `creditedSalespersonId`'s SEMANTICS, not its validation floor.** This item records the gap and asks **whether Layer 1 extends to these two references** | **MISSING INPUT `MI-V`** — Owner only | normal | OI-30 | **SPECIFICATION, pending an Owner answer.** `MI-Q` is CLOSED; **this is the adjacent gap, not a reopening** |
| **OI-39** | B | **The matrix does not name ONE person authority.** Its EXCLUDED block declares **three** rows: `:513` `users` *"identity authority"*, `:514` `employees` *"person authority"*, `:515` `fieldops_technicians` *"person authority"* — **two say "person authority"** (**V-15**) | `#182` Layer 1 requires *authoritative* resolution. **It cannot name *"the"* authority until this is settled**, and this **compounds** open item `O-1` (`typedOwner.ts:4-5`), which asks whether the `USER` id namespace is the canonical Employee id. `C-B2`/**OI-08**'s *"cannot ask"* outcome is the mechanism; **this is the prior question** | **`#182`** + open item **`O-1`** | normal | precedes OI-06, OI-08, OI-30 | **SPECIFICATION.** **Part I mis-cited this**: §2.2 `C-B1` cites `ownershipMatrix.ts:533` for the `employees` row; `:533` is the spread mapper's `ownerFields: []` line and the row is `:514` → **X-13** |
| **OI-40** | A+B | **`#182` proof 10 — ACCOUNTABLE PERSON missing on an ACTIONABLE item — spans two areas and has no home.** It cannot exist without **both** the actionable discriminator (OI-01/OI-03) **and** the accountable reference (OI-30) | `#180` invariant 1: **never NONE on actionable work**. `#182`: *"Actionable work must eventually prove **exactly one** current accountable person, authoritative reference, currently eligible."* **This is the proof that welds Area A to Area B**, and the one that tests the 9-family boundary of §12.2c end to end | **`#180`** + **`#182`** + **`MI-P`** | normal | OI-01, OI-03, OI-30, OI-31, OI-32 | **SPECIFICATION ONLY.** Its **proof** obligation is blocked on the `MI-P` architecture |
| **OI-41** | C | **The backfill prohibition and the absent repair path have no item.** `ownershipBackfillRules.ts:71` `ALREADY_SET` means the propagation **never overwrites**, so **no repair path exists**; `:74-77` writes an **unvalidated** upstream USER owner onto **every child** (**V-6**) | **`#182`, verbatim**: backfill is **not** the mechanism for fixing historical inactive/terminated references; this propagation is **unsafe for future enforcement until person-reference validation exists**; **NO BACKFILL AUTHORIZED.** The item is the **standing prohibition and its guard** — **never a repair** | **`#182`** | normal | OI-06, OI-07, OI-30 | **PROOF POSSIBLE TODAY** for the prohibition half: a guard asserting the propagation is **not invoked**, and a unit test pinning that `:71` has no repair path. **NOT-IN-PART-I: Part I contains zero references to `ownershipBackfillRules`** → **X-11** |
| **OI-42** | E | **`G8`.** OI-26's G1 proof asserts *"no owner field is written."* It does **not** assert *"no accountability field is written"* — trivially true at `64008d5a` (**V-5**) and therefore a **vacuous assertion that will silently decay the moment the axis lands** | **`#180` invariant 2**: *"reassigning execution doesn't change accountability."* The OI-26 diff assertion must be written to cover the accountability axis **now**, so it becomes a real assertion rather than a decayed one | **`#180`** + `OD-13` | normal | OI-26, OI-01 (which families) | **PROOF POSSIBLE TODAY** as a diff assertion over the **absence**; becomes substantive when the axis lands |

**13 new items. 3 carry a proof obligation achievable at `64008d5a` (OI-33, OI-41, OI-42). 10 are
SPECIFICATION ONLY**, because `#182` withholds the names that a proof would have to assert against.

---

## 15. THE 13 REQUIRED ACCEPTANCE PROOFS — COVERAGE MAP

`#182`'s required proofs. **Historical cases prove HISTORY PRESERVED; current cases prove INVALID
CURRENT RESPONSIBILITY DOES NOT PASS THE GATE.**

| # | Required proof | Kind | Covered by | Coverage |
|---|---|---|---|---|
| **P1** | PERSON OWNER **valid-current** | current | **OI-07** (+OI-06) | **FULL** — `C-B3` ACTIVE row, state **A** |
| **P2** | PERSON OWNER **inactive** | historical | **OI-07** (Layer 1) + **OI-31** (Layer 2) | **SPLIT ACROSS LAYERS.** Layer-1 half provable today; Layer-2 half **spec only** |
| **P3** | PERSON OWNER **terminated** | historical | **OI-07** (Layer 1) + **OI-31** (Layer 2) | as P2 |
| **P4** | PERSON OWNER **non-existent** | current | **OI-07** + **OI-06** | **FULL** — the clause that reverses `O-1`'s *"structurally zero"* |
| **P5** | PERSON OWNER **missing-reference** | current | **OI-07 (WIDENED)** + **OI-10** | **PARTIAL — and a divergence.** **`C-B3` has NO missing-reference row.** Today handled by the `OWNERLESS` path (`typedOwner.ts:201`, `ownershipCensus.ts:157-163`), which **does** block the gate (`:231`) — whereas an *invalid* reference **cannot block at any quantity**. `#182` state **C** appears to **FUSE** missing and invalid; today they get **opposite** gate treatment (§12.3d) |
| **P6** | ACCOUNTABLE PERSON **valid-current** | current | **OI-30** | **NOT COVERED BY ANY PART I ITEM.** Spec only |
| **P7** | ACCOUNTABLE PERSON **inactive** | historical | **OI-30** + **OI-31** | **NOT COVERED.** Spec only |
| **P8** | ACCOUNTABLE PERSON **terminated** | historical | **OI-30** + **OI-31** | **NOT COVERED.** Spec only |
| **P9** | ACCOUNTABLE PERSON **non-existent** | current | **OI-30** | **NOT COVERED.** Spec only |
| **P10** | ACCOUNTABLE PERSON **missing on an ACTIONABLE item** | current | **OI-40** (new; spans A **and** B) | **NOT COVERED, and it is the weld proof.** Needs OI-01/OI-03 (which families, which records are actionable) **and** OI-30 (the reference) **and** OI-32 (the census axis) |
| **P11** | COMPANY OWNER **valid** | current | **OI-33** | **NEARLY SATISFIED by shipped behaviour** (`deriveCompanyOwner`, `typedOwner.ts:131-144`); **no Part I item asserts it** |
| **P12** | COMPANY OWNER **invalid** | current | **OI-33** | **PARTIAL — and Part I's own X-8 is the gap.** `INVALID`/`UNKNOWN` are satisfiable; **`INACTIVE` falls through to `RESOLVED` and is discarded** (`typedOwner.ts:137-143`), so a company owner that cannot act is undetectable. **Part I declined to own X-8; `#182` pulls it in** |
| **P13** | **NON-OWNABLE-REFERENCE family** | — | **OI-01** (classification half) + **OI-32** (gate half) | **PARTIAL.** OI-01's negative control and the existing `ownershipModel.test.mjs` classification tests cover the **classification** (`#180` invariant 9 is what it proves). The **gate** half is uncovered: `ownershipCensus.ts:244-245`ff censuses only the OWNABLE families, so the proof that the **exclusion is deliberate rather than an omission** has no asserting item |

### 15a Coverage summary — the headline

| | Count |
|---|---|
| **FULL coverage by an existing Part I item** | **2** (P1, P4) |
| **SPLIT across the two ruled layers, Layer-1 half provable today** | **2** (P2, P3) |
| **PARTIAL — an existing item exists but does not assert the required case** | **3** (P5, P12, P13) |
| **NOT COVERED BY ANY EXISTING ITEM → new items** | **6** (P6, P7, P8, P9, P10, P11) |

> **`#182`'s 13 required acceptance proofs are fully covered by the existing 29 items in TWO cases.**
> **Six are not covered at all**, and all six concern the **accountable** reference or the **company**
> axis — the two surfaces every Part I Area B item was scoped away from. **This is the single largest
> measurable consequence of the five rulings for this decomposition.**

---

## 16. UNPROVEN — Part II additions and revisions

Part I's `U-1` … `U-11` stand unchanged except where noted.

| # | Unproven | Why it could not be proven here | What would prove it |
|---|---|---|---|
| **U-9** *(REVISED — narrowed)* | Whether any **other** unguarded owner-write path exists | **The RULES half is now PROVEN CLOSED (V-11):** exhaustive enumeration of all **25** update-granting statements in `firestore.rules` finds exactly **4** owner-field exposures, and they are **exactly R2–R5**. **`U-9` narrows to the NON-RULES surfaces** — callables and trusted writers, which Rules do not constrain | The **OI-18** guard run as a census over callables and trusted writers, not only over Rules |
| **U-12** *(NEW)* | `operatingCompanyId` is **0/12 in production** on `fieldops_jobs` | **No production contact** (hard constraint). **Not a contradiction of the matrix's 41/45**, which `ownershipMatrix.ts:262-265`, `:271` attributes explicitly to the **sandbox** certification fixtures. **Two environments, two populations — both carried** | A production census, under whatever authority governs production reads |
| **U-13** *(NEW)* | Whether the acceptance contract's **case 2** on `ext/census-acceptance` states that `#182` **confirms** `C-B3`, as the reassessment brief reports | **That branch was not read by this lane.** Reported, attributed, and carried as **reading R-III** at §12.3b, in live disagreement with reading R-II | Read `ext/census-acceptance`'s acceptance contract case 2 and reconcile against §12.3b |
| **U-14** *(NEW)* | Whether `#182`'s state **C** (`MISSING / INVALID_REFERENCE`) is genuinely **ONE** state or two | `#182` fuses them in its own prose and **withholds the names**, so the question cannot be settled from the ruling text. It is load-bearing: today *missing* **blocks** the gate (`ownershipCensus.ts:231` includes `totals.ownerless`) and *invalid reference* **cannot block at any quantity** (Part I §2.1) — **opposite treatment for one ruled state** | An Owner answer → **MISSING INPUT MI-U** |
| **U-15** *(NEW)* | Whether `#182` Layer 1 extends to `creditedSalespersonId` and `responsibleEmployeeId` | The ruling names RECORD OWNER, ACCOUNTABLE PERSON and *"future governed person references."* **These two are EXISTING governed person references on a `nonEmpty`-only floor (V-4)** — neither future nor named. `MI-Q` is CLOSED and protects only the **semantics** | An Owner answer → **MISSING INPUT MI-V**, item **OI-38** |
| **U-16** *(NEW)* | Whether `#182`'s **state B** is a distinct resolution outcome or `RESOLVED` plus a separately carried eligibility fact | `#182` withholds enum names explicitly, and the three readings at §12.3b turn on exactly this. **It cannot be resolved by any lane** | An Owner answer → **MISSING INPUT MI-S** |
| **U-17** *(NEW)* | That widening Area A from **6** to **9** is **complete** rather than merely larger | §12.2c's T1∧T2 derivation is measured, and `#181` places the three commercial families in **by ruling**. But the **liveness** exclusions (`U-4` `purchaseOrder`, `U-5` `workOrderLegacy`, and `reorderPurchaseOrder`'s two-hop) are **unchanged and still unproven**, so the envelope is **9 or 12** and no ruling decides which. `#180` also permits *"an Owner-approved exception"* per item, which no lane can enumerate | Resolving `MI-14` / `U-4` / `U-5`, plus any Owner exception list |

---

## 17. MISSING INPUT — Owner only

**`MI-N`, `MI-P`, `MI-Q` and `MI-R` are CLOSED** and are marked so wherever they appear above. They
are **not** reopened here. The items below are **new** questions the five rulings create or leave.

| # | Question only the Owner can answer | Why it blocks | Raised by |
|---|---|---|---|
| **MI-S** | Is `#182`'s state **B** a distinct resolution outcome, or `RESOLVED` plus a separately carried eligibility fact? **And must INACTIVE be distinguishable from TERMINATED inside it?** `#182` groups *"INACTIVE / TERMINATED / FORMER"*; `C-B3` insisted on **distinct reasons** *"because the remediation is opposite — one owner returns, one never does"* | The three readings at §12.3b turn on it, and `#182` **withholds enum names**, so no lane may settle it. **OI-07 and OI-31 cannot pass specification without it** | §12.3a, §12.3b, `U-16` |
| **MI-T** | `#182` names **four** states and **does not provide for AUTHORITY UNREADABLE.** Is `C-B3`'s sixth row a **fifth state**, an orthogonal outcome, or out of scope? | `C-B6.3` argues it must **block the gate** by the `ownershipCensus.ts:213-216` precedent. Without an answer, **OI-09**'s gate treatment is a lane's choice, and `#182` says gate treatment must be visible in one named place | §12.3a |
| **MI-U** | Is state **C** (`MISSING / INVALID_REFERENCE`) **one** state or **two**? | If one, *missing* and *invalid reference* must get the **same** gate treatment; today they get **opposite** treatment (§12.3d). **Sharpens OI-10** and decides `#182` **proof 5** | §12.3d, `U-14` |
| **MI-V** | Does Layer 1 extend to `creditedSalespersonId` (`financialAttribution.ts:228`) and `responsibleEmployeeId` (`:229`), both on the `nonEmpty`-only floor of `person()` at **`:205-209`**? | **`MI-Q` is CLOSED** and protects `creditedSalespersonId`'s **semantics**, not its **validation floor**. Without an answer these are two governed person references the contract does not reach, and §12.5b predicts a future accountability field will land beside them | §12.5b, **OI-38**, `U-15` |
| **MI-W** | `#180` permits *"an Owner-approved exception"* to the exactly-one-accountable-person rule. **Is there an exception list, and does any of the 9 families hold one?** | **OI-01**'s test must classify rather than argue; an unenumerated exception makes the 9-family set indeterminate at the edges | §12.2c, `U-17` |
| **MI-X** | Which of `MI-P`'s **two** acceptable architectures? *"Prepare the smallest design consistent with this ruling"* does not choose between *(i)* a multi-axis responsibility census and *(ii)* a dedicated accountability census composed into the gate | **OI-32** is the smallest design **for one of them**, and **OI-03**, **OI-10**, **OI-37**, **OI-40** all hang off which. A lane choosing would be designing the architecture the ruling reserved | §12.5a |

---

## 18. CORRECTIONS — Part II. Things this lane found wrong, including in its OWN Part I

Part I's **X-1 … X-9** stand unchanged. Additions:

| # | Claim | Measured at `64008d5a` | Correction |
|---|---|---|---|
| **X-10** | **PART I'S OWN §1.3**: *"Two person facts of the same kind is exactly the ambiguity `combineOwnerDerivations` `typedOwner.ts:151-159` exists to refuse. So the commercial chain is satisfied by Area B and must not be satisfied by Area A."* | **WRONG TWICE.** (1) **By ruling**: `#181` makes the accountable person a **separately carried fact** on those three families and **forbids** `accountablePerson = ownerEmployeeId` as a permanent computed identity — so the two facts are of **different kinds**, which is the condition §1.3 itself said makes two facts legitimate. (2) **By code**: the AMBIGUOUS branch fires only on **conflicting owner identity** (`typedOwner.ts:156-159`, `distinct.size > 1`), not on *"two facts of one kind"* — agreement returns `RESOLVED` (`ownershipModel.test.mjs:140-141`); and its only production caller is fed **exclusively** from `family.ownerFields` (`ownershipCensus.ts:165`, `:173`), so a fact outside `ownerFields` **never becomes an input** | **THE SIBLING LANE IS RIGHT. T3's MECHANISM SURVIVES AS A PRINCIPLE; ITS APPLICATION TO THE COMMERCIAL CHAIN IS VOID, and the code it leaned on could never have enforced it.** The minimum set is **9, not 6** (§12.2c); the envelope is **12, not 9**. **X-7 is revised: FOUR of the 9 are not COMPANY-owned, not one of 6** |
| **X-11** | The reassessment brief: *"**Your own finding** is cited in the ruling: `ownershipBackfillRules.ts:70-78`…"* | The **substance is CONFIRMED verbatim (V-6)**: `:71` `ALREADY_SET` ⇒ **no repair path**; `:74-77` writes an unvalidated upstream USER owner onto every child. **But Part I contains ZERO references to `ownershipBackfillRules`** — `grep -c` over the 609 lines returns **0** | **THE ATTRIBUTION IS WRONG, and correcting the brief is in scope.** The finding is **true and now independently verified by this lane**, but **Part I did not make it** — it came from another lane or from the Owner's own reading. **Recording it as this lane's would be a false provenance in a ruling.** Now carried as **OI-41** |
| **X-12** | The controller: *"**5 of 30** `allow update` statements lack a `hasOnly` allowlist"* | **NUMERATOR RIGHT, DENOMINATOR WRONG (V-10).** `^\s*allow [a-z, ]*update` matches **25** statements — **there is no 30 in the file**. **18 are `if false`**. Only **7** permit a client update (`:381`, `:418`, `:763`, `:1335`, `:1343`, `:1542`, `:1557`); **2** are allowlisted (`:1542` `equipmentEditableKeys()`; `:763` **per branch** at `:773,789,805,823,871,919,975`); **5 lack one**: `:381`, `:418`, `:1335`, `:1343`, `:1557` | **Say "5 of 7 client-writable", or "5 of 25 overall".** *"5 of 30"* **understates the defect rate roughly fourfold and cites a count that does not exist.** **5 of 7 is a structural finding; 5 of 30 reads like a rounding error.** And of the 5, **4 expose a matrix-declared owner field and are exactly R2–R5** — the fifth (`:418`) is EXCLUDED/person-authority with `ownerFields: []` (`ownershipMatrix.ts:515`), so **Part I's census missed nothing (V-11)** |
| **X-13** | **PART I'S OWN §2.2 `C-B1`**: *"The authority is the one the matrix already names: `employees`, classified EXCLUDED as 'person authority — a subject of ownership, not an object' (`ownershipMatrix.ts:533`)"* | **The QUOTE is exact; the CITATION is off by 19 lines.** The `employees` row is at **`:514`**. `:533` is the spread mapper's `ownerFields: [] as readonly string[]` line, which applies to all **17** EXCLUDED rows | **Cite `ownershipMatrix.ts:514`.** **And the substantive error is larger than the line number**: the matrix declares **THREE** authority rows — `:513` `users` *"identity authority"*, `:514` `employees` *"person authority"*, `:515` `fieldops_technicians` *"person authority"*. **Two rows say "person authority", so the matrix does NOT name *"the"* person authority at all**, and `C-B1`'s definite article is unearned → **OI-39** |
| **X-14** | The reassessment brief: *"Area A's minimum-domain boundary **(6 of 27)**"* | Correct **as Part I stood**; **superseded by §12.2c** | **9 of 27 / 9 of 51**, envelope **12**. Recording it here so the brief's own figure is not carried forward unmarked |
| **X-15** | The reassessment brief frames the task as *"reassess the **29** accountability implementation items"* | Part I's `OI-01 … OI-29` are **29 ownership-and-accountability items across five areas**, of which only **Area A (OI-01..OI-05)** is accountability-specific; Areas B/C/D are **ownership** and Area E is **workflow/assignment** | **Minor, but it matters for scope**: `#180`/`#182` reach **all five** areas, whereas *"the 29 accountability items"* would suggest the axis is the only subject. **It is not — 24 of the 29 are about the OWNER reference, Rules exposure, handoff sequencing, or the Work Order state machine** |

---

## 19. WHAT PART II DELIBERATELY DOES NOT CONTAIN

- **No schema, no field name, no enum name, no collection, no index, no column.** `#182` withholds
  enum/schema names **explicitly** — *"exact enum/schema names NOT authorized"* — and §12.3, §12.4 and
  every `OI-30`+ row are written in **semantic terms only**, for that reason.
- **No choice between `MI-P`'s two architectures.** `MI-X` records it as the Owner's. Choosing would be
  designing the architecture the ruling reserved.
- **No resolution of the three `C-B3` readings** (§12.3b), the `ext/census-acceptance` disagreement
  (`U-13`), or the state-C fusion question (`MI-U`). **All are carried with every reading intact.**
- **No backfill, no migration, no repair path.** `#182`: **NO BACKFILL AUTHORIZED.** **OI-41** is a
  **prohibition and a guard**, never a repair.
- **No handoff activation.** `OI-24` / `W6` remain **NOT AUTHORIZED**, and §12.6 records that their
  gate is now **further** from closable than Part I found.
- **No state-machine change.** `transitionEngine.ts` is unmodified and unquoted beyond Part I.
- **No production contact, no deploy, no data mutation, no Firestore read or write, no emulator run.**
  Every Part II measurement is a **file read in a git worktree at `64008d5a`**, and every claim that
  could not be made that way is recorded in §16 as **UNPROVEN**.
