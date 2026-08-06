---
artifact_type: specification
gate: Rough-Complete Build Blueprint (PROGRAM front gate)
status: Finalized 2026-08-05 — rulings R1–R5 + corrections C1–C4 applied and verified; HOLD before W0 for Owner go
date: 2026-08-05
finalized: 2026-08-05
owner: Claude Code
base_commit: 9d95871 (origin/main)
inputs:
  - docs/reviews/design-code-legibility-and-docs-review.md
  - docs/reviews/what-would-perfect-look-like.md
  - docs/reviews/tooling-skill-marketplace-scan.md
approved_scope_decisions:
  - basis: complete the existing codebase (not clean-room)
  - first_pass: demoable end-to-end core
  - gate_model: approve this Blueprint once, then section-based autonomous execution
---

# Rough-Complete Build Blueprint

> **This is the front-gate artifact.** It is now **finalized** — the §8 rulings
> block is resolved (R1–R5) and document corrections C1–C4 are applied. Per the
> section-based execution model, Claude builds each complete Blueprint section
> autonomously; Codex reviews and the Owner approves at each **section boundary**,
> not during routine work. Execution still **HOLDS before W0 for the Owner's go.**

## 1. Purpose

Turn the existing Taylor_Parts platform into a **rough, fully-complete, professional,
world-class small-business CRM + inventory system** that runs end-to-end and can then
be refined and extended. Per Owner decisions: complete the existing codebase, target a
demoable end-to-end core first, and run under one front gate (this doc) then
section-based autonomous execution.

## 2. Honest current-state synthesis (from the three inputs)

- **Code health (design review):** *Not slop.* Above-average legible, strong house
  style (module-intent headers, 84/90 files clean). Real debt is concentrated in the
  **Work Order Engine v1.2 migration** — finished in code, unfinished in docs/enums,
  with orphaned modules and one legacy `Jobs.jsx` screen. 5 High / 14 Med / 19 Low, and
  16 mechanical safe-fixes — **PROPOSED / QUEUED, NOT APPLIED** (see the safe-fix
  appendix in the design review; they are applied under W0, not before).
- **Product gaps (persona analysis):** *The spine of each persona's job is built, but
  surrounded by placeholders, demo props, and parallel data models.* 51 gaps (16 High).
  The defining gaps: operating-company dimension absent, IAM not in-product, two
  diverging data models, inventory write-loops that don't close, placeholders
  indistinguishable from real screens.
- **Tooling (marketplace scan):** the official `anthropics/claude-plugins-official`
  marketplace already covers Firebase/Firestore/code-review/frontend-design/docs; no
  trustworthy branded CRM or inventory skill exists (build those ourselves).

## 3. Target — what "demoable end-to-end complete" means

Every persona (Owner, Dispatcher, Technician, Parts Associate, Accounts/Sales incl.
Ventana, New User) can log in and complete their core journey against **one coherent
data model**, with **no screen that silently lies** (placeholders are labeled, demo
state is labeled, write-loops either close or are honestly marked "not yet live"), and
**every capability carries both governance docs and a user how-to**. Professional,
non-slop design on every screen (impeccable + taste-skill enforced).

**First-pass depth bar (R5): visual roughness is acceptable; operational dishonesty is
not.** The first pass must provide: one coherent **primary journey**; working
navigation; loading, empty, validation, and failure states; no fake buttons or silent
no-ops; no demo state represented as persistent; no conflicting Jobs-vs-Work-Orders
concepts; no direct client-write bypasses; and honest labels for deferred capabilities.

**Primary journey (R5):**
`customer need → governed work order → dispatch → technician execution → parts
verification/handling → completion`.

## 4. Mapping — persona gaps → EXISTING governed workstreams (advance, don't duplicate)

Critically, most "perfect" gaps are **already governed workstreams**. This program
*advances* them, it does not invent parallel ones. This mapping is the heart of the
Blueprint and the main thing for ChatGPT to validate.

| Persona gap (from analysis) | Existing governed workstream / doc | Wave |
|---|---|---|
| Operating-company dimension (Taylor/Ventana) absent in `src` | `docs/design/inventory-sales-templates-and-lines-of-business-wireframe.md` (LOB wireframe, Option A); Taylor/Ventana model | W1 |
| In-product IAM; Parts Associate locked out of Inventory | **Issue #100 per-role Inventory access (current branch)** + Auth Modernization lanes + `provisionEmployeeAccess.js` | W2 |
| Inventory write-loop doesn't close (receive→ledger) | **Enterprise Inventory Phase 2 Receiving** + INV-1 governance (Blaze/Functions gated) | W3 |
| Two data models diverging (`fieldops_jobs` vs `fieldops_wos`) | **Work Order Engine v1.2 migration** (design-review debt) | W4 |
| Opaque customer/location IDs; read-only dispatch board | WO Engine v1.2 + dispatch surfaces | W4 |
| Placeholders indistinguishable from real; no real landings | Consolidation work — W5 governance topics are **acceptance criteria (R3/C1)**, no separate architecture review | W5 |
| Reporting/financial surfaces inert | Financial surfaces workstream (partially governed) | W6 |
| Equipment/serialized-asset custody | **Equipment Custody / Serialized Asset P0** (Rev 6 spec) | later |

## 5. Build waves

**Build order (R4 / C3):** `W0 → W2 / Issue #100 → W1 → remaining reconciled waves
(W3 → W4 → W5 → W6)`. W0 first removes the contradictions blocking trustworthy
construction; W2 then finishes the already-active IAM/Admin foundation before W1 begins
the operating-company dimension. Wave **labels are stable** (W1 = operating-company,
W2 = IAM); only the execution sequence is W2-before-W1.

Each wave: builds repo-only on the isolated branch, ships **code + governance doc +
user how-to**, applies the **non-slop design bar**, ends at a **section boundary**
(Codex review + Owner approval). Waves that depend on gated actions (Blaze/Functions
deploy, `firestore.rules` changes = Tier 2, production) build the code but **cannot be
activated** without the separate gate — flagged 🔒.

Listed below in **execution order**:

- **W0 — Truth & cleanup foundation.** Correct stale comments and contradictions
  (the 16 safe-fixes — **PROPOSED / QUEUED, NOT APPLIED** until this wave); label every
  placeholder/demo surface honestly; begin relabeling legacy `Jobs.jsx` / `Dispatch.jsx`
  so they cannot masquerade as the canonical Work Order experience (R1). **Read-only
  environment verification** (`firebase functions:list`, live-Rules verification,
  ambient-auth/live-environment checks) is **separately authorized and NOT required to
  begin repository-only cleanup or W2 implementation** (C4) — it confirms deployment
  reality but does not gate the repo work. Unblocks accurate prioritization of
  everything after.
- **W2 — In-product Identity & Access Management.** Employee/User admin over `employees`;
  least-privilege Inventory route (Issue #100); read-first Roles & Permissions mirror.
  Finishes the already-active IAM/Admin foundation. 🔒 rules/roles → Tier 2.
- **W1 — Operating-company dimension (Taylor/Ventana).** Immutable `operatingCompanyId`
  at Account creation (separate from `isNationalAccount`); company scope switcher +
  badges. The organizing dimension. 🔒 rules touch → Tier 2.
- **W3 — Close the inventory write-loop.** Receive→ledger, one scanner, ad-hoc parts.
  Built and tested **repository-only** (implementation + unit/emulator tests + docs +
  deployment/runbook prep, R2). 🔒 Blaze activation, Functions deployment, production
  data/mutation, identity, Rules changes/deploy, and ambient-auth use are **separately
  gated** (issue #15).
- **W4 — Reconcile to ONE work-order model + human-readable IDs.** `fieldops_wos` is the
  single canonical model; `fieldops_jobs` is legacy compatibility data only (R1). Add no
  new functionality to `fieldops_jobs`; migrate remaining UI/routing/scoring/analytics/
  other consumers to `fieldops_wos`; retire legacy components/routes/imports/deep-links/
  `workOrdersStore` **only after verified zero-consumer/parity checks**. **No destructive
  data migration under W4 without separate escalation** (R1). Resolve customer/location
  names.
- **W5 — Real landings; placeholders → real or honestly-marked.** Every persona gets a
  real dashboard. W5's data ownership, write authority, failure handling, idempotency,
  auditing, migration/rollback, and honest placeholder retirement are **acceptance
  criteria, not a gate or pre-build checkpoint** (R3 / C1) — Claude resolves and
  documents them while autonomously completing W5; Codex reviews them with the completed
  W5 section; the Owner approves at the section boundary.
- **W6 — Analytical & financial surfaces.** Reporting, financial summary, forecasts.

## 6. Execution model (how "around the clock" actually works)

- **Isolation:** all waves build on a dedicated branch/worktree off a clean base;
  nothing merged, nothing deployed, fully reversible.
- **Section-based authority:** Claude builds each complete Blueprint section (wave)
  autonomously on routine Tier-1 calls; Codex reviews and the Owner approves **at the
  end of each section**, not during routine work. Escalation *inside* a section is
  limited to protected boundaries (Tier-2/3, security/trust, prod/deploy, identity/
  Rules/Blaze), material Blueprint departures, destructive actions, or a materially
  different business outcome.
- **One Workflow per wave** (fan-out across the wave's files), with a design pass
  (impeccable/taste) and a docs pass (user-docs-writer + governance artifact) built in.
- **Continuous throughput:** waves chained in the R4/C3 order (`W0 → W2 → W1 → …`);
  between waves I checkpoint findings. For genuinely unattended runs, a scheduled
  continuation can drive successive waves — set up only after this Blueprint is approved.
- **Standing bars every wave:** document everything (gov + user how-to); professional /
  non-slop design; Codex review on rules/security-sensitive changes.

## 7. Hard boundaries (unchanged, entire program)

No deploy · no production data mutation · no auth/identity changes against prod · no
`firestore.rules` deploy. All Tier-2/3 stays gated exactly as today. Owner is the sole
conduit to ChatGPT. Credentials never handled.

## 8. Resolved rulings (R1–R5)

The prior open questions are resolved by the Owner (relaying ChatGPT). These rulings are
binding for the program.

1. **R1 — W4 model reconciliation.** `fieldops_wos` is the **single canonical**
   work-order model. `fieldops_jobs` is **legacy compatibility data only** — add no new
   functionality to it. Migrate remaining UI/routing/scoring/analytics/other consumers to
   `fieldops_wos`; **immediately relabel** legacy `Jobs.jsx` / `Dispatch.jsx` so they
   cannot masquerade as the canonical Work Order experience; retire legacy components,
   routes, imports, deep links, and `workOrdersStore` **only after verified
   zero-consumer/parity checks**. **No destructive data migration under W4 without
   separate escalation.**
2. **R2 — W3 activation reality.** Build and test the inventory write-loop
   **repository-only**. In scope: implementation, unit/emulator tests, documentation,
   deployment/runbook preparation. **Separately gated:** Blaze activation, Functions
   deployment, production data or mutation, identity changes, Firestore Rules changes or
   deployment, ambient-auth/live-environment use.
3. **R3 — W5 governance.** **No separate Architecture Review** or pre-build checkpoint.
   W5's data ownership, write authority, failure handling, idempotency, auditing,
   migration/rollback, and honest placeholder retirement are **acceptance criteria**;
   Claude resolves and documents them while autonomously completing W5; Codex reviews
   with the completed section; the Owner approves at the section boundary.
4. **R4 — Wave order.** Confirmed **`W0 → W2 / Issue #100 → W1 → remaining reconciled
   waves`**. W0 first removes contradictions blocking trustworthy construction; W2 then
   finishes the already-active IAM/Admin foundation before W1 begins.
5. **R5 — First-demo depth vs breadth.** **Visual roughness is acceptable; operational
   dishonesty is not.** First pass requires one coherent primary journey, working
   navigation, loading/empty/validation/failure states, no fake buttons or silent
   no-ops, no demo state shown as persistent, no conflicting Jobs-vs-Work-Orders
   concepts, no direct client-write bypasses, and honest labels for deferred
   capabilities. Primary journey: `customer need → governed work order → dispatch →
   technician execution → parts verification/handling → completion`.

## 9. Tooling to adopt (from the scan — vet before install)

Official Firebase/Firestore plugins (emulator-only), `microsoft/playwright-mcp`,
official code-review/modernization/simplifier, `trailofbits/skills-curated`. Audit any
hook/MCP/script-shipping plugin before install (same as impeccable/taste).

---

## Finalization record

- **Rulings applied:** R1 (W4 canonical `fieldops_wos`, non-destructive), R2 (W3
  repo-only build, activation gated), R3 (W5 acceptance criteria, no architecture
  review), R4 (order `W0 → W2 → W1 → …`), R5 (demoable = operationally honest).
- **Corrections applied:** C1 (W5 = acceptance criteria, not a gate — §4, §5, §8);
  C2 (safe-fix appendix relabeled PROPOSED / QUEUED, NOT APPLIED — §2 and the design
  review appendix); C3 (wave order `W0 → W2 / Issue #100 → W1 → remaining` — §5, §6);
  C4 (W0 live-environment checks reclassified as read-only, separately authorized, not
  required to begin repo-only cleanup or W2 — §5).
- **Base:** current `origin/main` @ `9d95871`, fresh branch, non-destructive (the
  `docs/aug5-analysis-and-blueprint` branch is left intact).

**Status:** Blueprint **finalized subject to applying and verifying these edits** (done).
**Next:** Owner's explicit go to begin **W0**. Execution HOLDS until then.
