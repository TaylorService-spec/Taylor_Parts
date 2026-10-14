---
artifact_type: specification
gate: Rough-Complete Build Blueprint (PROGRAM front gate)
status: Draft — PENDING Owner + ChatGPT approval before any execution
date: 2026-08-05
owner: Claude Code
inputs:
  - docs/reviews/design-code-legibility-and-docs-review.md
  - docs/reviews/what-would-perfect-look-like.md
  - docs/reviews/tooling-skill-marketplace-scan.md
approved_scope_decisions:
  - basis: complete the existing codebase (not clean-room)
  - first_pass: demoable end-to-end core
  - gate_model: approve this Blueprint once, then continuous sandboxed execution
---

# Rough-Complete Build Blueprint

> **This is the front-gate artifact.** Nothing gets built against the codebase
> until the Owner and ChatGPT approve this plan. It is a draft prepared from three
> read-only analyses; it does not itself change any code.

## 1. Purpose

Turn the existing Taylor_Parts platform into a **rough, fully-complete, professional,
world-class small-business CRM + inventory system** that runs end-to-end and can then
be refined and extended. Per Owner decisions: complete the existing codebase, target a
demoable end-to-end core first, and run under one front gate (this doc) then continuous
sandboxed execution.

## 2. Honest current-state synthesis (from the three inputs)

- **Code health (design review):** *Not slop.* Above-average legible, strong house
  style (module-intent headers, 84/90 files clean). Real debt is concentrated in the
  **Work Order Engine v1.2 migration** — finished in code, unfinished in docs/enums,
  with orphaned modules and one legacy `Jobs.jsx` screen. 5 High / 14 Med / 19 Low, 16
  mechanical safe-fixes queued.
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
| Placeholders indistinguishable from real; no real landings | New consolidation work — **not yet governed → needs ChatGPT architecture review** | W5 |
| Reporting/financial surfaces inert | Financial surfaces workstream (partially governed) | W6 |
| Equipment/serialized-asset custody | **Equipment Custody / Serialized Asset P0** (Rev 6 spec) | later |

## 5. Build waves (ordered by dependency)

Each wave: builds repo-only on the isolated branch, ships **code + governance doc +
user how-to**, applies the **non-slop design bar**, ends with a checkpoint. Waves that
depend on gated actions (Blaze/Functions deploy, `firestore.rules` changes = Tier 2,
production) build the code but **cannot be activated** without the separate gate — flagged 🔒.

- **W0 — Truth & cleanup foundation.** Verify actual deployment state (`firebase
  functions:list`, live rules) — *needs the parked Firestore ambient-auth green-light*;
  correct stale comments (the 16 safe-fixes); label every placeholder/demo surface
  honestly. Unblocks accurate prioritization of everything after.
- **W1 — Operating-company dimension (Taylor/Ventana).** Immutable `operatingCompanyId`
  at Account creation (separate from `isNationalAccount`); company scope switcher +
  badges. The organizing dimension. 🔒 rules touch → Tier 2.
- **W2 — In-product Identity & Access Management.** Employee/User admin over `employees`;
  least-privilege Inventory route (Issue #100); read-first Roles & Permissions mirror.
  🔒 rules/roles → Tier 2.
- **W3 — Close the inventory write-loop.** Receive→ledger, one scanner, ad-hoc parts.
  🔒 depends on Cloud Functions + Blaze (issue #15) — build repo-only, activation gated.
- **W4 — Reconcile to ONE work-order model + human-readable IDs.** Finish the v1.2
  migration; retire/reconcile `fieldops_jobs`; resolve customer/location names.
- **W5 — Real landings; placeholders → real or honestly-marked.** Every persona gets a
  real dashboard. **Needs ChatGPT architecture review (not yet governed).**
- **W6 — Analytical & financial surfaces.** Reporting, financial summary, forecasts.

## 6. Execution model (how "around the clock" actually works)

- **Isolation:** all waves build on a dedicated branch/worktree off a clean base;
  nothing merged, nothing deployed, fully reversible.
- **One Workflow per wave** (fan-out across the wave's files), with a design pass
  (impeccable/taste) and a docs pass (user-docs-writer + governance artifact) built in.
- **Continuous throughput:** waves chained; between waves I checkpoint findings. For
  genuinely unattended runs, a scheduled continuation can drive successive waves — set
  up only after this Blueprint is approved.
- **Standing bars every wave:** document everything (gov + user how-to); professional /
  non-slop design; Codex review on rules/security-sensitive changes.

## 7. Hard boundaries (unchanged, entire program)

No deploy · no production data mutation · no auth/identity changes against prod · no
`firestore.rules` deploy. All Tier-2/3 stays gated exactly as today. Owner is the sole
conduit to ChatGPT. Credentials never handled.

## 8. Open questions for ChatGPT (the real decisions)

1. **W4 model reconciliation:** confirm `fieldops_wos` is the single canonical model and
   `fieldops_jobs` is retired — and how to treat the legacy `Jobs.jsx`/`Dispatch.jsx`.
2. **W3 activation reality:** is Blaze/Functions deployment in scope for this program, or
   do we build the write-loop repo-only and leave activation to its own gate?
3. **W5 is ungoverned:** does the placeholder-consolidation + real-landings work get a
   proper Architecture Review before building, or is "honestly label + minimal real
   dashboard" small enough to proceed?
4. **Wave ordering:** is W1 (operating-company) or W2 (IAM/Issue #100, already on the
   current branch) the right first build wave?
5. **Depth vs breadth for "demoable":** how rough is acceptable for the first pass?

## 9. Tooling to adopt (from the scan — vet before install)

Official Firebase/Firestore plugins (emulator-only), `microsoft/playwright-mcp`,
official code-review/modernization/simplifier, `trailofbits/skills-curated`. Audit any
hook/MCP/script-shipping plugin before install (same as impeccable/taste).

---

**Approval block (to be completed):** ChatGPT architecture review — pending. Owner
authorization to begin continuous sandboxed execution — pending.
