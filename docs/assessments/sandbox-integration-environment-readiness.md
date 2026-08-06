---
artifact_type: assessment
gate: Sandbox / Integration Environment — sequencing assessment + design readiness
status: Design/readiness complete — protected infrastructure + spend decision required before any provisioning
date: 2026-08-06
owner: Claude Code (Executive Architecture & Company Office)
base_commit: 8171f63
scope: Assessment and design only. NO infrastructure provisioned, NO project created, NO spend incurred, NO production change.
---

# Sandbox / Integration Environment — Readiness

---

## Part 1 — Evidence-based sequencing assessment

**Question:** has Sandbox/Integration become the strongest available architectural lever, ahead of continuing R-1 Rows 23/24?

**Answer: yes, on priority-2 grounds (blocking dependency), not priority-1.**

| Evidence | Weight |
|---|---|
| **Supplier Master RC is waiting** for integrated Owner experience review | Blocking — a *completed* capability cannot reach its acceptance gate |
| **More completed capabilities are accumulating on main** unreviewed (Receiving workspace, Transfers, Warehouses, Suppliers, Purchase Orders, PartsScanner) | Compounding — the queue grows faster than it drains |
| **Owner review currently requires manual localhost/emulator assembly** | Every review costs setup effort, so reviews are rationed |
| **Production is the only integrated environment** | Direct contradiction of `AI_ENGINEERING_OPERATING_MODEL.md` §7 ("production is never the exploratory test environment") |
| **D2 reports `platform-sandbox` and `platform-integration` as `NOT_OBSERVABLE`** | The gap is now machine-visible, not merely asserted |
| **D1/D2 exist** | The version-identity foundation a governed preview needs is already built |

**Why this now outranks R-1 Rows 23/24**, despite R-1 remaining the higher *risk*:

R-1 is still the most severe systemic risk (duplicate authorization model, live). But its **execution front is blocked**: Rows 23–26 cannot proceed until Rows 19/20/22 deploy the trusted access backend, which is Owner-gated and unauthorized. The remaining repo-only R-1 work is **bounded** — parity fixtures and permission specification — and every next step after that is Tier 2.

Sandbox is **priority 2 (blocking architectural/operational dependency)** and is *unblocked*. Per Operating Model §1a, *"a high-priority risk may remain the highest architectural priority while its protected step is blocked; advance the highest-value safe prerequisite work."*

**This is not a deprioritization of R-1.** R-1 repo-only preparation continues in parallel; the two do not compete for the same surfaces.

**Decisive framing:** the platform is now completing capabilities faster than it can review them. That is a *throughput* failure, and it is the only one of the current levers that gets worse with time.

---

## Part 2 — What must exist for the current product to be reviewable

Inventoried against `main` @ `8171f63`.

| Layer | Current state | Sandbox requirement |
|---|---|---|
| **Frontend** | Vite/React, ~299 source files; two build modes (Pages base, Firebase root) | Build with sandbox config + root base; D1 `version.json` already emitted |
| **Firestore** | 23 collections observed live | Schema is implicit (no migrations); created by writes + seeds |
| **Rules** | 1,718 lines, dual-mirrored | Deploy verbatim. **Rules are project-level, so the sandbox needs its own deploy** |
| **Indexes** | Repo declares **5**; live has **6** — see finding S-2 | Must be reconciled *before* a sandbox claims parity |
| **Functions** | 12 exports on main; **22 deployed** live | Deployable to sandbox; runtime config must not be production-pinned |
| **Auth** | Firebase Auth, governed test personas | Sandbox needs its own user pool + persona seeding |
| **Permission catalog / governed roles** | `permissionCatalog.ts`, `governedBusinessRoles.ts`, dual-mirrored | Portable — pure data, no project coupling |
| **Readiness flags** | `RECEIVING_TRANSPORT_READY=false`, `TRUCK_MANAGEMENT_WRITE_READY=true`, `TRUSTED_COMPLETION_ENABLED=true` | **Build-time constants.** Sandbox needs them independently settable — see finding S-3 |
| **Environment configuration** | **Hard-coded** in `firebase.js` — see finding S-1 | The single largest blocker |
| **Seed / reference data** | `seedOperationsDemoData.js`, `seedSupplierSandbox.mjs`, `bootstrapIssue100VerificationFixtures.js`, skill `seed.mjs` | Partial coverage; needs consolidation into scenario packs |
| **Synthetic operational data** | Emulator fixtures exist per-capability | No single "full platform" scenario pack exists |
| **Test personas** | `provisionEmployeeAccess.js` + governed onboarding skill | Reusable; needs a sandbox-scoped persona set |
| **Migrations** | None — no migration framework exists | Sandbox is built by seeding, not migrating |
| **External integrations** | **None** (Integration Platform is Level 1, no code) | Nothing to stub — a genuine simplification |

### Finding S-1 — the frontend is hard-wired to the production project ⚠️ **the blocker**

`field-ops-app-vite/src/firebase/firebase.js` hard-codes `projectId: "taylor-parts"`, `authDomain`, `storageBucket`, `appId`, and `us-central1`. There is **no build-time environment injection** — the Pages workflow passes no `VITE_*` and consumes no secrets.

**Consequence: the application as built today cannot point anywhere except production.** A sandbox is impossible without changing this. This is the same coupling flagged in the R-2 design as blocking option B (non-production preview), and it overlaps the **Configuration** Tier-2 ADR already on the roadmap — so it should be solved **once**, deliberately, not twice piecemeal.

### Finding S-2 — index drift: live has 6 composite indexes, the repo declares 5 ⚠️

`firestore.indexes.json` declares 5 (`employees` ×2, `fieldops_wos` ×2, `reorder_requests` ×1). Live has **6** — an additional index on **`fieldops_jobs`** that the repository does not declare.

Two consequences, the second more serious than the sandbox question:

1. **A sandbox built from the repo would not have that index**, so queries that work in production could fail or behave differently — silently breaking the premise that the sandbox represents the product.
2. **A repo-driven `firebase deploy --only firestore:indexes` could DELETE the live `fieldops_jobs` index**, because a deploy reconciles live state to the declared set. This is a latent production risk that exists *today*, independent of any sandbox work.

**Recorded, not remediated** — reconciling indexes touches production and is protected.

### Finding S-3 — readiness flags are build-time constants, not environment configuration

`RECEIVING_TRANSPORT_READY`, `TRUCK_MANAGEMENT_WRITE_READY`, and `TRUSTED_COMPLETION_ENABLED` are compiled-in booleans. A sandbox that wants receiving *enabled* while production keeps it *disabled* cannot express that without a second build — which would mean the reviewed artifact is not the production artifact, defeating the purpose of an RC.

This makes readiness flags part of the **same configuration problem as S-1**, not a separate one.

### Finding S-4 — production project guards are protective and must be preserved

Several trusted paths and operator scripts hard-guard on `taylor-parts` (`BOOTSTRAP_ADMIN_PROJECT`, `warehouseBackupCodec` rejecting any other `projectId`, and ~8 operator scripts). These are **deliberate fail-closed safety controls**, not accidental coupling.

**They must not be loosened to accommodate a sandbox.** The correct shape is an explicit allow-list of *known* project identities with the guard intact, so a sandbox is permitted **by name** and an unknown project is still refused. Weakening the guard to a wildcard would trade a real safety property for convenience.

---

## Part 3 — Do SANDBOX and INTEGRATION need separate infrastructure?

Assessed rather than assumed.

| | Shared infrastructure | Separate infrastructure |
|---|---|---|
| Cost | One project | Two projects |
| Isolation | Sandbox churn can disturb an RC under review | RC is stable while sandbox is rebuilt |
| Data lifecycle | One dataset serves both — conflicting needs (mutable vs frozen) | Independent |
| Promotion evidence | RC identity is harder to pin if data shifts underneath | Clean |
| Operational burden | Lower | Two of everything to deploy and verify |

**Recommendation: start with ONE physical environment, two logical roles — and design so splitting later costs nothing.**

Rationale: the environments differ mainly in *data lifecycle discipline* (sandbox is freely rebuilt; integration is frozen at an RC), not in *infrastructure shape*. With D1/D2 in place, an RC is identified by its **SHA**, not by which project hosts it — so a single environment can serve an RC review provided the rebuild is disciplined. The registry already models them as **separate logical entries** (`platform-sandbox`, `platform-integration`), so splitting later is a registry and deploy-target change, not a redesign.

**The one condition that forces a split:** concurrent need — an RC under Owner review at the same time as active sandbox rebuilding. Given the review queue is already backed up, **this will occur**, so the split should be treated as *expected within the first few cycles*, not hypothetical.

---

## Part 4 — Reproducibility pipeline (target)

```
verified baseline / RC (known SHA)
  → initialize environment            (project + config, idempotent)
  → deploy Rules + indexes            (governed, from the exact SHA)
  → deploy Functions                  (from the exact SHA)
  → seed Auth + governed personas     (synthetic identities only)
  → seed reference data               (parts, warehouses, suppliers)
  → seed operational scenarios        (scenario packs — see below)
  → build + deploy frontend           (sandbox config, D1 manifest)
  → run automated verification        (smoke + role gating)
  → publish expected SHA
  → D2 verify deployed == expected    (already built)
  → return stable review URL
```

**Scenario packs, not production copies.** Production data is **never** copied to sandbox by default — it carries real customer and employee information into a lower-trust environment. Instead, reproducible synthetic packs, each a named, versioned fixture set: *baseline reference* (parts/warehouses/suppliers), *operational* (work orders across lifecycle states, reorder requests at each status), *edge* (zero-history parts, malformed-but-stored records, inactive employees). Existing seeds (`seedOperationsDemoData.js`, `seedSupplierSandbox.mjs`, `bootstrapIssue100VerificationFixtures.js`) are the raw material and should be consolidated rather than replaced.

**D2 already closes the loop**, which is why this is worth doing now and not earlier: the pipeline ends with a machine-checkable assertion that the review URL is serving the intended SHA.

---

## Part 5 — Identity and naming

- **Platform:** Enterprise Operations OS. **Taylor Parts:** the first customer deployment. **Company identity:** a separate workstream — not decided here.
- New sandbox/integration infrastructure **must not inherit `taylor-parts` as the platform identity**. Neutral placeholders (registry `operator: platform-operator`, environment ids `platform-sandbox` / `platform-integration`) are already in use and are sufficient until permanent naming is settled.
- **No existing production infrastructure is renamed by this program.** Project ids, collections, environment variables, and package identifiers stay exactly as they are.

---

## Part 6 — What requires Owner decision

| # | Item | Type |
|---|---|---|
| **O-1** | Create a new Firebase project for the sandbox | **Infrastructure + spend** (Tier 3 vendor/spend) |
| **O-2** | Accept the ongoing cost of a second Firebase project (Firestore, Functions, Hosting, Auth) | **Spend** |
| **O-3** | Approve the configuration architecture that resolves S-1/S-3 | **Tier-2 material architecture** — overlaps the Configuration ADR; should be decided *once* |
| **O-4** | Reconcile the index drift in S-2 | **Protected** (touches production) |
| **O-5** | Confirm one-environment-first vs two immediately | Architecture sequencing |

**Nothing in O-1…O-5 has been executed.** No project created, no infrastructure provisioned, no spend incurred, no production change.

## Part 7 — Recommended next step

**O-3 first, and alone.** The configuration architecture (S-1 + S-3) is the true blocker: it is repo-only, it is required by the sandbox *and* by R-2 option B *and* by the Configuration Tier-2 ADR already on the roadmap, and it can be designed and even implemented **without provisioning anything or spending anything**.

Deciding O-3 once, deliberately, avoids solving the same coupling three times in three programs. O-1/O-2 (project + spend) only become worth deciding after the application can actually target a non-production project.
