# Taylor EOS Certification Program — Closeout

**Status: CLOSED**
**Closeout date: 2026-09-02 (America/Phoenix) — 2026-09-03 UTC for the final Cycle Count reconciliation**
**Environment: `eos-platform-certification`**

This document is the permanent record of the Certification program. It is documentation only: it
authorizes nothing, deploys nothing, and changes no live data. Everything below is **measured live
evidence already produced**, not a plan.

---

## 1. Certification world at closeout

| | |
|---|---|
| status | **COMPLETE** |
| datasetVersion | **1.8.0** |
| expected records | 1093 |
| installed records | 1093 |
| expected fingerprint | `1782e853` |
| recorded fingerprint | `1782e853` |
| observed fingerprint | `1782e853` |

Private-AI fail-closed verification: **19 / 19 PASS**,
`privateAiSyntheticOperationalInterpretation` **FALSE**, writes performed NONE.

All three fingerprints are measured independently — the repository builder's expectation, the
deployment record's claim, and a recomputation over the fetched documents. Agreement of all three
is the only state that counts as COMPLETE; two agreeing is what a drifted world looks like.

---

## 2. Execution provenance — repository SHAs are not execution SHAs

Each ceremony was executed from a specific reviewed, rebuilt artifact. Current `main` is **not** the
artifact that performed them, and this record does not claim otherwise.

| ceremony | executed from |
|---|---|
| Purchasing (five POs) | `6e1ab3cbdf0d8a95230468a5ccb34abb67058c2e` lineage, applier unchanged since |
| Receiving (partial Golden receipt) | `e8a6f1d02a37470f30a6a184c2f6107a8dd3ad46` |
| Cycle Count final recovery / reconciliation | `f544d7be73177a8abe895fa5fff4fd449340a47a` |
| repository `main` at closeout handoff | `94d6e9402e8254651058c0c3364655c6e79523b5` |

### The Cycle Count interruption, recorded truthfully

The first live Cycle Count invocation did not complete, and the sequence matters more than a clean
summary would:

1. **PHASE 1 OPEN** succeeded — count `cyc_d475d391…` created, expected quantity 48 snapshotted.
2. **PHASE 2 COUNTED** succeeded — counted 43, variance −5 recorded. **Inventory did not move**,
   which is exactly what counting is supposed to do.
3. The operator **stopped itself** before reconciliation, reporting `COUNTING MOVED STOCK`.
4. That report was **wrong**. Nothing had moved. The guard asserted that the part's
   ADJUSTMENT-sourced ledger rows numbered zero — but opening balances *are* `ADJUSTED` movements,
   so every stocked part in this world begins life with adjustment evidence. The assertion could
   never have passed **for any part**. It was not a subtle bug; it was unconditionally broken and
   guaranteed to fire on first live use.
5. **CERT-CYCLE-12** was recorded as an **operator verification defect, not a product defect.** The
   Cycle Count domain behaved correctly at every step.
6. The existing `COUNTED` record was **resumed, never restarted.** Restarting would have submitted a
   second observation of the same shelf and left two counts competing to explain one variance.
7. Final reconciliation ran from the reviewed, rebuilt, hash-confirmed `f544d7be` artifact.

**No duplicate count and no duplicate adjustment were created.** The finished record carries
`version 3` walking OPEN → COUNTED → RECONCILED, a single `ledgerEventIds` entry, and exactly one
reconciliation-sourced movement repository-wide.

The recovery is recorded rather than smoothed over because it is *stronger* evidence: the
interruption proved the phase separation is real, and the resume proved the ceremony could be
finished without fabricating state.

---

## 3. Purchasing

Five governed purchase orders, created through `procurementService` with live separation of duties
re-proven at the write boundary.

| PO id | status | part | qty | unit | total | note |
|---|---|---|---|---|---|---|
| `77YHk2Vb28UFh7oyL6yX` | SENT | CW-P-0304 | 18 | 67.50 | 1215.00 | |
| `mdvbcr3N3K2LMx3ALBmZ` | SENT | CW-P-0003 | 18 | 17.50 | 315.00 | |
| `80Ouc3U9Auk2Aet5tgXQ` | SENT | CW-P-0000 | 20 | 10.00 | 200.00 | **Golden inbound** |
| `m21te7hI0KccAZYjLduX` | SENT | CW-P-0102 | 12 | 32.50 | 390.00 | |
| `hdLJjlIEJhzjoii8o1Me` | APPROVED | CW-P-0001 | 15 | 12.50 | 187.50 | **APPROVED trap** |

PO count 5 · SENT 4 · APPROVED 1 · quantity 83 · total value 2307.50 · SENT value 2120.00 ·
APPROVED-trap value 187.50.

**Replay proof:** re-running the applier reports all five `ALREADY_PRESENT`, `created 0`, zero
duplicates.

---

## 4. Receiving — one partial receipt

| | |
|---|---|
| purchase order | `80Ouc3U9Auk2Aet5tgXQ` |
| part | CW-P-0000 |
| ordered / received / remaining | 20 / 10 / 10 |
| stored PO status | SENT |
| derived receiving state | PARTIALLY_RECEIVED |
| destination | WAREHOUSE `wh-main` |
| receipt | `rcvc_b3dad0a0a8c2433383998bfb41e86f8f608e3d1f` |
| movement | `imv_f7b3379e2a91139325a73b2aa14cb20c2dba6a77` |

Proven effect:

- CW-P-0000 **UNKNOWN → KNOWN**; `wh-main` on-hand 10, available 10; on-order 20 → 10
- warehouse 571 → 581 · trucks 164 → 164 · company 735 → 745

**One receipt, one `RECEIVED` movement, and only +10 moved — never the ordered +20.** The stored PO
status deliberately stayed `SENT`: progress is derived from receipts, not stamped onto the order.

---

## 5. Preserved evidence — do not "finish" it

Two live states are **intentional Certification evidence** and must remain exactly as they are.

**The Golden partial receipt — CW-P-0000**

```
onHand 10 · onOrder 10 · stored PO status SENT · derived PARTIALLY_RECEIVED
received 10 · remaining 10
```

Do **not** complete the remaining 10 to make the purchase order look finished. The half-received
state is the proof that knowability arrives with the *first* receipt rather than with sufficiency,
and that a partial receipt leaves real inbound supply outstanding.

**The APPROVED trap — CW-P-0001**

```
onHand 6 · onOrder UNKNOWN · stored status APPROVED · derived NOT_RECEIVED
received 0 · remaining 15
```

`APPROVED` is genuinely *receivable* and deliberately *not inbound*. Its `onOrder` is `UNKNOWN`, not
zero — the order never enters the inbound projection at all, so nothing can later sum it by
accident. Receiving it would destroy the trap.

Both parts are additionally protected by construction: the Cycle Count applier refuses any part
referenced by a live purchase order, receipt, or work-order snapshot.

---

## 6. Cycle Count — the final ceremony

**Count `cyc_d475d391eac69831d67e6d097bd91e09ff089ddc`**

| | |
|---|---|
| status / version / schemaVersion | RECONCILED / 3 / 1 |
| part / location | CW-P-0501 / WAREHOUSE `wh-main` |
| expected / counted / variance | 48 / 43 / −5 |
| trackingMode | NONE |
| idempotencyKey | `cw_cycle_CW-P-0501_wh-main_43` |
| reviewDecision | APPROVE |
| reconciliation reason | "Independent recount confirms the shortfall; adjusting the books to the shelf." |

**Counter** — `cw-emp-026` / `Wx3MuDOIO5VFRNJCJ9SQv01vntI2` — recorded as `createdBy` **and**
`submittedBy`.
**Reconciler** — `cw-emp-024` / `CDAkY1tsFgQwntEaL6DsjBof9n12` — recorded as `reconciledBy` and
`updatedBy`.

**Exactly one reconciliation ledger event:** `imv_84ea2ce8a3de539b0c9a3eeb2038834d94962596`

```
type ADJUSTED · quantity -5 · location WAREHOUSE wh-main
sourceObject { ADJUSTMENT, cyc_d475d391eac69831d67e6d097bd91e09ff089ddc }
actor USER CDAkY1tsFgQwntEaL6DsjBof9n12   (the reconciler, not the counter)
recordedAt 2026-09-03T00:55:06.265Z
```

No second reconciliation movement exists. The part's three historical opening-balance `ADJUSTED`
rows are unchanged, still stamped at the fixture epoch `2025-12-06T09:00:00Z` and still attributed
to the seeder.

---

## 7. The load-bearing inventory invariant

**COUNTED midpoint**

```
books 48 · observed shelf 43 · warehouse remained 48 · inventory movement ZERO
```

**RECONCILED endpoint**

```
warehouse 48 -> 43 · CW-P-0501 company 51 -> 46
```

**Aggregate**

| | before | after |
|---|---|---|
| warehouse | 581 | 576 |
| trucks | 164 | 164 |
| company | 745 | 740 |
| inventory_transactions | 88 | 89 |

> **COUNTING OBSERVES. RECONCILIATION CORRECTS.**
> **A TRANSFER CONSERVES THE COMPANY TOTAL. A RECONCILED CYCLE COUNT MAY CHANGE IT.**

Both halves were proven on the same part, an hour apart. That distinction is the result the whole
inventory program exists to establish.

**Separation of duties, from stored evidence rather than Role names:**

- counter self-approval — **REFUSED, `PERMISSION_DENIED`**
- independent reconciler — **APPROVED**
- `Wx3MuDOI…` ≠ `CDAkY1ts…` — two different principals, recorded on the count document *and* on the
  ledger row that moved the stock

---

## 8. Final inventory verification

**38 / 38 PASS · 0 failures.** The first fully-green applied Inventory Certification run in the
program.

```
baseline warehouse 571 · net operational change +5 · final warehouse 576
final warehouse 576 + mobile 164 = final company 740
all 34 quantity-tracked parts reconcile against readPartBalance — exact
```

The verifier states the invariant in its own words, and it now passes:

> *CYCLE RECONCILIATION changed the company total — a correction, not a relocation — −5 units.
> A transfer may never do this; a reconciliation must be able to.*

**Condition coverage — all six conditions represented:**

| HEALTHY | WATCH | REORDER | ON_ORDER | UNOBSERVED | FALSE_COMFORT |
|---|---|---|---|---|---|
| 18 | 7 | 4 | 2 | 1 | 2 |

CW-P-0501 was selected precisely so the −5 would leave it **HEALTHY → HEALTHY**, and it did. No
required condition disappeared.

---

## 9. Findings disposition

**CLOSED**

- **CERT-CYCLE-11** — Certification Cycle Count capability activation proven and closed.
  `eos-platform-certification` activates `create` / `submit` / `reconcile` and deliberately not
  `cancel`; `permissionCatalog` keeps all four `active: false` and the per-environment override is
  the governed seam.

**FIXED / PROVEN**

- **CERT-CYCLE-12** — operator verification defect. Fixed, regression-tested, CI-exercised
  (27/27 on Node 22 in the cycle-count lane), live recovery successful. **The product's Cycle Count
  behaviour was correct throughout.**

**TRANSFERRED TO POST-CERTIFICATION BACKLOG — OPEN / NON-BLOCKING**

| finding | subject |
|---|---|
| CERT-RECV-09 | `executeG03Receipt.mjs` declares "EMULATOR ONLY" and enforces nothing |
| CERT-RECV-10 | the receipt's ledger movement carries no `operatingCompanyId` or classification |
| CERT-FIN-01 | no procurement-side financial authority exists (`FINANCIAL_SOURCE_TYPES` is revenue-only) |
| CERT-FIN-02 | no inventory valuation measure exists anywhere |
| CERT-FIN-03 | the reporting catalog's "Purchase Order" object is bound to `reorder_purchase_orders`, not `purchase_orders` |
| CERT-PURCH-SIG-01 | `orderSignature` excludes unitPrice, buyer, intent and target status |
| CERT-PURCH-DOCDRIFT-01 | stale sandbox comments in `applyPurchasingPlan.mjs` |
| CERT-GRANT-DRYRUN-01 | `applyRoleGrants` dry run classifies without consulting live state |
| CERT-LEDGER-COUNTED-08 | the `COUNTED` movement type is declared, never written, and ignored by every balance aggregation |

**These findings do not block the Certification result. They remain governed product/backlog work
after Certification, and they are not closed merely because Certification closes.**

---

## 10. Execution-process controls to carry forward

Two operator preflight requirements, learned during the ceremonies. Recorded here as closeout
controls, not as new blocking findings.

### A. Compiled dependency integrity

Certification operator scripts import **compiled** `functions/lib` access code. After any change of
checkout, and before any live operator run:

```bash
npm run build
```

`HEAD` alone does not prove the compiled `lib` matches source. This program has already produced one
false authority result from a stale `lib`.

### B. Direct script integrity

Certification operator `.mjs` files execute **directly** and are **not** regenerated by the
TypeScript build, so a stale working-tree copy can run even when `HEAD` points at the reviewed
commit — which was observed during this program. Before a governed live operator run, verify the
executed file's blob against the reviewed commit:

```bash
git rev-parse <reviewed-sha>:<path>
git hash-object <path>
```

These must match. Verified at closeout for all three live appliers
(`applyCycleVariance.mjs`, `applyGoldenReceipt.mjs`, `applyPurchasingPlan.mjs`) — all **MATCH**.

---

## 11. Certification freeze

After this closeout, **no additional live Certification ceremony is authorized.** Without a new
explicit Owner ruling, do not:

- reset or reseed `eos-platform-certification`
- complete the remaining CW-P-0000 receipt
- touch the CW-P-0001 APPROVED trap
- rerun the Cycle Count applier or create another Certification Cycle Count
- manually edit Certification Firestore
- use Certification as an ordinary development sandbox

The Certification project is now **retained as evidence**. Normal product development belongs in the
normal development/sandbox process.

---

## 12. Scope — what this closeout does and does not claim

Certification proves **the governed scenarios that were actually exercised**: purchasing through the
real command with live separation of duties, a partial receipt converting an unobserved part into a
known one, and a cycle count whose observation moved nothing and whose independent reconciliation
moved the company total.

It does **not** claim:

- that every future feature is certified
- that every open finding is closed — nine remain open and non-blocking
- that production deployment occurred — none did
- that a Financials procurement/AP authority exists — it does not (CERT-FIN-01)
- that an inventory valuation authority exists — it does not (CERT-FIN-02)
- that production exposure was measured where it remains explicitly open

The result is precise and bounded. Reading it as broader than the scenarios listed here would be the
same inflation this program spent its effort eliminating.
