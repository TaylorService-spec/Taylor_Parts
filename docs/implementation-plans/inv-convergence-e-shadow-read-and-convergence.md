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
A. Live shadow-read (non-authoritative, observable)  →  provides live parity evidence
        │
        ▼
B. Operational-role Rules broadening (design → separate deploy gate)
        │
        ▼
C. Consumer cutover (PartsList and PartDetail, independent; rollback-guarded)
        │
        ▼
D. Static-only exclusions disposition (explicit; never silent)
```
A must produce green live parity before C. B is a prerequisite for C's *operational-role* reach but is itself a separately reviewed Rules+deploy action. D is decided before/at C so the ten are never silently dropped.

---

## Stage A — Live shadow-read capability (non-authoritative)

**Goal:** produce observable, live parity between the adapter-composed model and the current operational workspace model, with **zero UI behavior change**.

**Scope (future unit):**
- Load canonical rows through the **existing read-only** query service `services/partMasterQueries.js` (`fetchPartMasterList()`) — no new query surface; admin/dispatcher only under current Rules.
- Compose them with the merged `buildPartsWorkspace()` adapter (`src/domain/partsCompatibilityAdapter.js`).
- Build the **current** operational workspace model exactly as PartsList/PartDetail derive it today (static catalog via `getCatalogItem` + `useInventoryLedger` overlay + reorder hooks) — read-only, unchanged.
- Compare the two and emit **observable parity results** (counts; `CANONICAL_MATCH`/`STATIC_ONLY_EXCLUDED` totals; name/normalized-unit divergences; unexpected unmatched; provenance issues) to a **diagnostic-only** surface (e.g. an admin/dispatcher diagnostics view or logged report). Non-authoritative.

**Guardrails:** no consumer switches; no write; no Rules change; diagnostic surface is additive and gated (admin/dispatcher), ideally behind a diagnostic flag. Output is evidence, not a data source.

**Exit / evidence:** live parity report reproducing the offline totals (200/190/10, 0 name, 0 unit divergence) against live production `parts` — this is the Decision #44 live shadow-parity that must be green before Stage C.

---

## Stage B — Operational-role access (Rules broadening; design here, deploy separately)

**Goal:** define the *exact* Firestore Rules broadening that lets authorized Issue #100 operational roles read `parts`, so the operational workspace can source canonical identity after cutover.

**Scope (future unit — design/assessment only in-plan):**
- Current posture: `firestore.rules` `match /parts/{partId} { allow read: if isAdminOrDispatcher(); allow create, update, delete: if false; }`.
- Proposed read broadening: extend the read predicate to **ACTIVE** PARTS_MANAGER / PARTS_ASSOCIATE / WAREHOUSE_MANAGER per the Issue #100 governed matrix (reusing the same active-employment/operational-role helpers already used for `inventory_transactions` reads). **Writes remain `create, update, delete: if false`** — trusted-writer-only Parts mutations are preserved (ADR-008/-009).
- Produce a verification matrix (each role: `parts` read allowed/denied; all clients incl. admin: write denied; sibling `manufacturers`/`part_aliases`/`part_supplier_items` unchanged).

**Guardrails / gating:** **Rules implementation and deployment are SEPARATELY reviewed actions** (Tier 2; authorize → deploy → verify, per the F-RULES-1 / D2 precedent). This plan changes **no** `firestore.rules` file and authorizes **no** deploy. Cross-session Rules-lock discipline applies.

---

## Stage C — Consumer cutover (independent per consumer; rollback-guarded)

**Goal:** migrate the operational workspace to read canonical identity via the adapter, **preserving every current behavior**, only after live parity (A) and role access (B) are in place.

**Scope (future units — PartsList and PartDetail migrated INDEPENDENTLY, separate PRs):**
- **PartsList** — swap the identity source from static `PARTS_CATALOG` to the adapter output; keep `useInventoryLedger` health overlay, reorder hooks, and Global Search seeding intact (search → route → detail id continuity preserved).
- **PartDetail** (highest risk — its own gate) — re-point `getCatalogItem` metadata and the `t.partId === partId` ledger filter **together**; preserve the full reorder/PO/receive/cancel/void/inventory-action write surface unchanged.
- **Preserve:** ledger behavior, reorder + purchasing workflows, global search, routing, and detail behavior — all unchanged in outcome.
- **Rollback:** each cutover ships behind a revertable flag/commit that restores the current static-backed implementation; no data migration is involved, so rollback is switch-only.
- **Precondition:** **live parity evidence (Stage A) must be green** before any switch; each consumer verifies parity for its own surface first.

**Guardrails:** no ledger/reorder/purchasing/snapshot behavior change; no historical rewrite; commercial and availability fields continue via `STATIC_FALLBACK` until their UD-3/UD-4 authorities ship (authority contract §1–§2).

---

## Stage D — Static-only exclusions disposition (explicit, never silent)

**Goal:** decide, explicitly, how the approved ten (`TST-1047, 1070, 1074, 1080, 1112, 1136, 1143, 1175, 1189, 1193`) behave through canonical cutover.

**Options (Owner decision, before/at Stage C):**
- **D1 — remain visible** as `STATIC_ONLY_EXCLUDED` compatibility rows (flagged non-canonical), preserving current PartsList/PartDetail visibility; or
- **D2 — retire** them through lifecycle governance (separate, deliberate step), never as a silent side effect of cutover.

**Guardrail:** the ten **must not be silently removed** during canonical cutover; until D1/D2 is decided they remain visible via static compatibility exactly as today. Their exclusion reason stays Decision #42 policy attribution (INV-CONVERGENCE-B).

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
