---
artifact_type: implementation-plan
unit: INV-CONVERGENCE-E — live shadow-read orchestration & consumer convergence
status: Draft — PLAN ONLY, awaiting Owner and ChatGPT review; authorizes no implementation
date: 2026-07-26
owner: Claude Code (Inventory)
baseline: 2aa9589f68e4201982673e2f3ef3b0088bf7a4fe (origin/main)
builds_on:
  - docs/architecture/inventory-parts-authority-contract.md
  - docs/implementation-plans/inv-convergence-d-compatibility-adapter.md
related_decisions: "DECISIONS.md #43, #44, #45"
authorizes: nothing — no runtime wiring, Rules changes, source switch, data writes, static-catalog removal, or deployment
---

# INV-CONVERGENCE-E — live shadow-read orchestration & consumer convergence (plan)

Implementation **plan only**. It sequences the path from the merged read-only adapter (INV-CONVERGENCE-D) to an eventual, separately-authorized consumer cutover, holding every risky action behind its own gate. Each stage below is a *future* unit; **this plan authorizes none of them.**

**This plan does NOT authorize:** runtime/consumer wiring · Firestore Rules changes · source switching · data writes · static-catalog removal · deployment. Preserved throughout: canonical `parts` identity authority; trusted-writer-only Parts mutations; all existing Inventory → Parts workflows; Decisions #43–#45. Per Decision #44, the **live** shadow-parity below is the evidence required before any switch — the merged offline parity is not a substitute.

## Stage sequencing (each a separate, Owner-gated unit)

```
A. Live shadow-read + parity evidence (non-authoritative, observable)
        │
        ▼   (A must be green before C)
   ┌──────────────┬──────────────┐
   ▼              ▼              (D and B may be prepared in PARALLEL after A;
D. Approved-ten   B. Operational-  both are HARD PREREQUISITES for C1)
   disposition       role Rules
   decision          authorization
   (D1/D2)           + deployed verification
   └──────────────┴──────────────┘
        │
        ▼
C1. PartsList cutover  →  C2. PartDetail cutover  (independent, rollback-guarded)
```

**Ordering rules (corrected):** A produces the live parity evidence. **Before any consumer source switch, BOTH D (approved-ten disposition) and B (operational-role Rules authorization + deployed verification) must be complete.** D and B may proceed in parallel after A, but both gate C1. Then C1 (PartsList) precedes C2 (PartDetail). D is **not** a post-cutover stage — the approved ten affect PartsList population, PartDetail route behavior, Global Search seeding, parity totals, and rollback expectations, so their treatment is decided **before** cutover.

---

## Stage A — Live shadow-read capability (non-authoritative)

**Goal:** produce observable, live parity between the adapter-composed model and the current operational workspace model, with **zero UI behavior change**.

**Scope (future unit):**
- Load canonical rows through the **existing read-only** query service `services/partMasterQueries.js` (`fetchPartMasterList()`) — no new query surface; admin/dispatcher only under current Rules.
- Compose them with the merged `buildPartsWorkspace()` adapter (`src/domain/partsCompatibilityAdapter.js`).
- Build the **current** operational workspace model exactly as PartsList/PartDetail derive it today (static catalog via `getCatalogItem` + `useInventoryLedger` overlay + reorder hooks) — read-only, unchanged.
- Compare the two from a single captured bundle (below) and emit **observable parity results** to a **diagnostic-only** surface (admin/dispatcher diagnostics view or logged report). Non-authoritative.

### A.1 Deterministic run boundary (no temporal skew)

A parity run must **not** compare two models assembled from independently-changing live reads — a reservation/release/reorder/purchasing/other workflow update between reads could create temporal skew. Each execution therefore **captures one immutable in-memory input bundle first**, and **both** models are built **only** from that bundle:

**Captured bundle (frozen for the run):**
- canonical `parts` rows returned by the existing read-only service;
- static catalog version + content hash;
- ledger transaction snapshot used by the current availability calculation;
- reorder-request / workflow snapshot;
- purchasing / PO workflow snapshot (where included);
- adapter version / commit SHA;
- run ID;
- capture timestamps (start/end of capture);
- source record counts (per input).

**Rule:** neither the current operational workspace model nor the adapter-composed shadow model may independently subscribe, refetch, or read a later state during the comparison. Both are pure functions of the one frozen bundle. (The adapter is already pure and takes injected inputs; the current-model builder must be given the same snapshots, not live subscriptions.)

### A.2 Result states

Each diagnostic run yields exactly one status:
- `PASS`
- `FAIL_PARITY`
- `BLOCKED_PERMISSION`
- `BLOCKED_UNAVAILABLE`
- `BLOCKED_INCOMPLETE_INPUT`

**A permission-denied or unavailable canonical read MUST become the appropriate `BLOCKED_*` result — never an empty canonical list, never "190 missing", never a parity failure.** `BLOCKED_INCOMPLETE_INPUT` covers any bundle input that failed to capture. Only a fully-captured bundle with a real divergence yields `FAIL_PARITY`.

### A.3 Live parity evidence (Stage A output)

The diagnostic result records:
- run ID; application/adapter commit; static catalog hash; capture timestamps; source counts;
- `190` CANONICAL_MATCH count; `10` STATIC_ONLY_EXCLUDED count;
- unexpected-unmatched count; name-divergence count; normalized-unit-divergence count; provenance-issue count;
- blocked/failure reason when not `PASS`.

**Sensitivity:** the diagnostic output must avoid credentials, tokens, UIDs, emails, or unrelated production data, and **must not log full production records merely to be observable** — counts, hashes, and per-field divergence *summaries* only.

**Guardrails:** no consumer switches; no write; no Rules change; the diagnostic surface is additive and gated (admin/dispatcher), ideally behind a diagnostic flag. Output is evidence, not a data source.

**Exit / evidence:** a `PASS` run reproducing the offline totals (200 source / 190 CANONICAL_MATCH / 10 STATIC_ONLY_EXCLUDED / 0 name / 0 unit divergence) against live production `parts` — the Decision #44 live shadow-parity that must be green before C1.

---

## Stage D — Approved-ten disposition decision (before cutover; explicit, never silent)

**Goal:** decide, explicitly and **before any consumer source switch**, how the approved ten (`TST-1047, 1070, 1074, 1080, 1112, 1136, 1143, 1175, 1189, 1193`) behave through canonical cutover. They affect PartsList population, PartDetail route behavior, Global Search seeding, parity totals, and rollback expectations — so this cannot wait until cutover.

**Options (Owner decision):**
- **D1 — remain visible** as `STATIC_ONLY_EXCLUDED` compatibility rows (flagged non-canonical), preserving current PartsList/PartDetail visibility and routes; or
- **D2 — retire** them through lifecycle governance (a separate, deliberate step), never as a silent side effect of cutover.

**Default until the Owner decides D1/D2 (recorded now):**
- all ten **remain visible**;
- `identityState` remains `STATIC_ONLY_EXCLUDED`;
- static compatibility continues to provide their current fields and routes;
- **no search or detail route silently disappears.**

**Guardrail:** the ten **must not be silently removed** during canonical cutover. Their exclusion reason stays Decision #42 policy attribution (INV-CONVERGENCE-B).

---

## Stage B — Operational-role access (Rules broadening; design here, deploy separately)

**Goal:** define — and, in its own separately-reviewed action, authorize + deploy + verify — the *exact* Firestore Rules broadening that lets authorized Issue #100 operational roles read `parts`, so the operational workspace can source canonical identity after cutover.

**Scope (future unit — design/assessment only in-plan):**
- Current posture: `firestore.rules` `match /parts/{partId} { allow read: if isAdminOrDispatcher(); allow create, update, delete: if false; }`.
- Proposed read broadening: extend the read predicate to **ACTIVE** PARTS_MANAGER / PARTS_ASSOCIATE / WAREHOUSE_MANAGER per the Issue #100 governed matrix (reusing the same active-employment/operational-role helpers already used for `inventory_transactions` reads). **Writes remain `create, update, delete: if false`** — trusted-writer-only Parts mutations are preserved (ADR-008/-009).
- Produce a verification matrix (each role: `parts` read allowed/denied; all clients incl. admin: write denied; sibling `manufacturers`/`part_aliases`/`part_supplier_items` unchanged).

**Guardrails / gating:** **Rules implementation AND deployment AND deployed verification are SEPARATELY reviewed actions** (Tier 2; authorize → deploy → verify, per the F-RULES-1 / D2 precedent). **B is a hard prerequisite for C1** — its Rules broadening must be *deployed and verified*, not merely designed, before an operational-role consumer reads canonical `parts`. This plan changes **no** `firestore.rules` file and authorizes **no** deploy. Cross-session Rules-lock discipline applies.

---

## Stage C — Consumer cutover (independent per consumer; rollback-guarded)

**Goal:** migrate the operational workspace to read canonical identity via the adapter, **preserving every current behavior**, only after **A is green** and **both D and B are complete** (D decided; B deployed + verified).

**Scope (future units — C1 then C2, migrated INDEPENDENTLY, separate PRs):**
- **C1 — PartsList** — swap the identity source from static `PARTS_CATALOG` to the adapter output; keep `useInventoryLedger` health overlay, reorder hooks, and Global Search seeding intact (search → route → detail id continuity preserved). Honors the Stage D disposition for the ten.
- **C2 — PartDetail** (highest risk — its own gate, after C1) — re-point `getCatalogItem` metadata and the `t.partId === partId` ledger filter **together**; preserve the full reorder/PO/receive/cancel/void/inventory-action write surface unchanged.
- **Preserve:** ledger behavior, reorder + purchasing workflows, global search, routing, and detail behavior — all unchanged in outcome.
- **Rollback:** each cutover ships behind a revertable flag/commit that restores the current static-backed implementation; no data migration is involved, so rollback is switch-only.
- **Preconditions (hard):** A `PASS` (live parity) for the surface being switched **and** D decided **and** B deployed+verified — all before any switch.

**Guardrails:** no ledger/reorder/purchasing/snapshot behavior change; no historical rewrite; commercial and availability fields continue via `STATIC_FALLBACK` until their UD-3/UD-4 authorities ship (authority contract §1–§2).

---

## Dependencies and non-authorities

- **Depends on:** merged INV-CONVERGENCE-D adapter; live `parts` read (admin/dispatcher today; operational roles via Stage B).
- **Separate future gates (not authorized here):** Stage B Rules deploy; each Stage C consumer cutover; UD-3 on-hand implementation and UD-4 commercial/pricing/reorder-policy homes (authority contract §6) before their static fallbacks retire; UD-5 Part Master nav disposition (Phase E); static-catalog + Functions-mirror retirement (Phase F).
- **Non-authorities (unchanged):** static catalog is not stock truth or identity; `part_supplier_items` is not selling-price home; the current ledger taxonomy is not a complete physical on-hand authority; JOIN_CLEAN does not authorize a switch and offline parity does not replace live parity.

## Safeguards

- No runtime wiring, Rules change, source switch, data write, static-catalog edit, or deployment is authorized by this plan.
- All existing Inventory → Parts workflows (PartsList, PartDetail, role homes, reorder/purchasing, search, routing) are preserved; trusted-writer-only Parts mutations preserved.
- No historical ledger, reorder, or Work Order snapshot is rewritten at any stage.
- Decisions #43–#45 are unchanged; any contradiction surfaced during a future stage is reported, not silently reconciled.
