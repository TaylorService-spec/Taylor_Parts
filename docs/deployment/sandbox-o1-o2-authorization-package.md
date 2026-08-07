---
artifact_type: deployment
gate: O-1 / O-2 — Sandbox/Integration infrastructure + spend · AUTHORIZATION PACKAGE
status: Awaiting Owner authorization — NOTHING created, NO spend incurred
date: 2026-08-06
owner: Claude Code (Executive Architecture & Company Office)
base_commit: ae0441c
depends_on: docs/architecture/ADR-011-environment-configuration-architecture.md (O-3, complete)
scope: Proposal only. No project created, no service enabled, no deploy, no spend.
---

# Sandbox / Integration Environment — O-1 / O-2 Authorization Package

**Every repository-side blocker is closed.** ADR-011 made environment identity, readiness, and the project allow-list configuration rather than source. What remains is infrastructure: create a project (**O-1**) and accept its cost (**O-2**).

---

## 1. Proposed project identity

| | |
|---|---|
| **Project ID** | `eos-platform-sandbox` |
| **Display name** | Enterprise Operations OS — Platform Sandbox |
| **Registry environment id** | `platform-sandbox` (already declared, `status: not-provisioned`) |

## 2. Why platform-neutral

**`eos` = Enterprise Operations OS — the platform.** Not `taylor-parts-sandbox`, because this environment exists to exercise *the platform*, and Taylor Parts is the **first customer deployment**, not the platform's identity. Naming it after the first customer would encode exactly the conflation ADR-011's role/deployment split exists to prevent, and would read as wrong the moment a second customer exists.

It also does **not** encode a company name. Company/brand identity is a separate workstream; `eos` describes the product, which is already established and stable. **A Firebase project ID is permanent and cannot be renamed** — so it must not depend on a decision that hasn't been made.

**No existing production infrastructure is renamed.** `taylor-parts` stays exactly as it is.

## 3. Region

**`us-central1`** for Firestore, Functions, and the Firestore location — matching production.

Deliberate: region differences change latency characteristics and, for Firestore, are **immutable after creation**. A sandbox meant to represent production should not differ in a dimension that cannot later be corrected. Hosting is global CDN and needs no choice.

## 4. Firebase services required

| Service | Needed | Why |
|---|---|---|
| **Firestore** (Native, Standard) | Yes | The operational system of record |
| **Authentication** (Email/Password) | Yes | Governed test personas |
| **Cloud Functions** (Gen 2, Node 20) | Yes | 22 live callables must exist for the app to function |
| **Hosting** | Yes | The stable review URL |
| **Cloud Storage** | **No** | Nothing in the product writes to Storage today |
| **App Check / Analytics / Crashlytics** | **No** | Not used in production; adding them would make the sandbox *diverge* from production |

**Blaze is required** — Cloud Functions cannot deploy on Spark. Blaze is already active on the account.

## 5. Firestore database

`(default)`, Native mode, Standard edition, `us-central1`, **PITR disabled**, **delete protection disabled**, **no backup schedules**.

That is deliberate and is the opposite of production: a sandbox is *meant* to be disposable and rebuilt. Delete protection would block the rebuild cycle (exactly the friction found in the P5-A rehearsal, where an inherited protection blocked authorized cleanup). Backups of synthetic data have no value. **This asymmetry must be recorded so nobody later "fixes" the sandbox to match production.**

## 6. Auth

Email/Password only. No federated providers (production has none). Personas are seeded by script, never by hand, so the persona set is reproducible and reviewable.

## 7. Functions

All **22** production callables deployed from the exact reviewed revision. Gen 2, `nodejs20`, `us-central1`, 256 MiB — matching production configuration so behaviour matches.

**No production Functions are touched.** The sandbox deploy targets `eos-platform-sandbox` only.

## 8. Hosting

Single site, `live` channel: **`https://eos-platform-sandbox.web.app`** — this is the stable review URL. Built with `VITE_ENVIRONMENT_ID=platform-sandbox` and `--base=/` (Hosting serves at root).

## 9. Rules and indexes

- **Rules:** deploy `firestore.rules` verbatim from the reviewed revision. Rules are project-level, so the sandbox needs its own deploy. **The sandbox uses the same Rules as production** — different Rules would make the review meaningless.
- **Indexes:** deploy all **6** declared composite indexes. Note this is only correct *because* O-4 declared the previously-undeclared `fieldops_jobs` index — before that, a sandbox would have silently lacked it.
- Both deploys run through the **O-4 drift guard** (a first deploy is purely additive, so non-destructive).

## 10. Registry entry

`config/environments.json` already declares `platform-sandbox`. Provisioning is a **data change only** — fill in `firebase` identity and flip `status` to `live`. No code change; ADR-011's resolver picks it up.

**Readiness for sandbox (proposed):**

| Flag | Production | Sandbox | Why |
|---|---|---|---|
| `RECEIVING_TRANSPORT_READY` | `false` | **`true`** | The whole point — exercise the governed receive loop that production has not activated |
| `TRUCK_MANAGEMENT_WRITE_READY` | `true` | `true` | match |
| `TRUSTED_COMPLETION_ENABLED` | `true` | `true` | match |

This is the first real use of ADR-011's readiness-as-environment-configuration decision, and it is why that decision mattered.

## 11. Required changes to production guards — **now that a real second project exists**

O-3 deliberately left the guards hard because there was no second project to test against. That changes with O-1. **Minimal, surgical, still fail-closed:**

| Guard | Change | Rationale |
|---|---|---|
| `warehouseBackupCodec` — `projectId must be taylor-parts` | Accept **`isKnownProjectId()`** membership instead of equality | A sandbox must exercise warehouse governance. An unknown project **still fails closed**; the allow-list has exactly two members. |
| `BOOTSTRAP_ADMIN_PROJECT = "taylor-parts"` | **NO CHANGE** | Legacy-admin break-glass is a production migration artifact. The sandbox seeds personas directly and never needs it. Leaving it pinned keeps a genuinely production-only path production-only. |
| ~8 operator scripts guarding on `taylor-parts` | **NO CHANGE in this package** | Each is a production-data tool; whether any needs sandbox use should be decided per-script when a real need appears, not pre-emptively widened. |

**Principle: widen only what the sandbox provably needs, and never to a wildcard.** The invariant tests are updated in the same change so a future weakening still fails CI.

## 12. Persona model

Seeded via the existing governed path (`provisionEmployeeAccess.js` — the only writer of the Employee↔User link), never by hand:

| Persona | Security role | Operational role | Exercises |
|---|---|---|---|
| `owner@sandbox.invalid` | owner | — | Full oversight, Owner review |
| `admin@sandbox.invalid` | admin | — | Administration, governed-field writes |
| `dispatcher@sandbox.invalid` | dispatcher | — | Dispatch, work orders, #175 withholding |
| `tech@sandbox.invalid` | technician | — | FieldMode, PartsScanner, assigned work |
| `partsmgr@sandbox.invalid` | technician | PARTS_MANAGER | Reorder queue |
| `partsassoc@sandbox.invalid` | technician | PARTS_ASSOCIATE | Purchasing execution |
| `whmgr@sandbox.invalid` | technician | WAREHOUSE_MANAGER | Warehouse-scoped access |

`.invalid` is a reserved TLD (RFC 2606) — these addresses **cannot** receive mail or collide with a real person. Credentials are generated at seed time and never committed.

## 13. Reference-data seed plan

Synthetic only, from the existing seeds consolidated: parts catalog, warehouses/stock locations, suppliers, employees/personas, trucks.

**Production data is never copied.** It would move real customer and employee information into a lower-trust environment for no benefit — synthetic data exercises the same code paths.

## 14. Scenario packs

Named, versioned, independently loadable:

- **`baseline`** — reference data only; the empty-but-valid platform.
- **`operational`** — work orders across all 11 lifecycle states, reorder requests at each of the 6 statuses, an ORDERED PO awaiting receipt (**the Supplier Master / Receiving review path**).
- **`edge`** — zero-history parts, inactive employees, broken Employee↔User links, malformed-but-stored records: the fail-closed paths that are hardest to reach by hand and most valuable to review.

## 15. Deployment / rebuild automation

One idempotent script, `scripts/sandbox/rebuild.mjs`, running ADR-011's pipeline: resolve environment → deploy Rules + indexes (through the drift guard) → deploy Functions → seed Auth/personas → seed reference data → seed scenario pack → build + deploy frontend → verify → publish expected SHA → **D2 verify deployed == expected** → print the review URL.

**Guarded:** refuses any `projectId` whose registry `role` is `production`. A rebuild must be structurally incapable of targeting a customer.

## 16. Stable review URL

`https://eos-platform-sandbox.web.app` — stable across rebuilds, so a bookmark stays valid. `GET /version.json` states the exact revision and environment.

## 17. D1 / D2 verification

D1 already emits `version.json` with `commit`, `environmentId`, `environmentRole`. D2 already models `platform-sandbox`. **On provisioning, `platform-sandbox` moves from `NOT_OBSERVABLE` to a real verdict with no code change** — the drift checker starts covering it automatically. This is the payoff for having sequenced D1/D2 first.

## 18. Supplier Master integration

Supplier Master is the **first capability to use this environment**, and its RC review is the immediate justification. Its callables exist on `main`; the `operational` pack seeds suppliers and an ORDERED PO so the Supplier → `supplierId` → `reorder_purchase_orders` → receiving path can be exercised end to end. **No Supplier-specific infrastructure** — it is the first tenant of a reusable platform environment, not the reason for its shape.

## 19. Deploying all of current `main`

The sandbox represents the **complete** product: 22 Functions, full Rules, all 6 indexes, the entire frontend, all personas, all scenario packs. Nothing is selectively omitted — a partial sandbox would produce reviews that do not transfer.

**Known limitation, stated plainly:** capabilities gated by production-only readiness or by ungranted capabilities behave per their sandbox readiness flags, which is a *deliberate* difference and must be visible in the review, not silently assumed identical.

## 20. Cost

**One-time: $0.** Project creation, service enablement, and Rules/index/Functions deploys are free.

**Recurring, against Blaze no-cost quotas** ([Firebase pricing](https://firebase.google.com/pricing)):

| Service | No-cost quota | Expected sandbox usage | Expected charge |
|---|---|---|---|
| Firestore storage | 1 GiB | production is **1.57 MiB**; synthetic will be smaller | **$0** |
| Firestore reads | 50K/day | a handful of reviewers | **$0** |
| Firestore writes/deletes | 20K/day each | seeding is thousands, not tens of thousands | **$0** |
| Functions invocations | 2M/month | manual review traffic | **$0** |
| Functions GB-sec / CPU-sec | 400K / 200K per month | 22 idle callables cost nothing at rest | **$0** |
| Hosting storage | 10 GB | a single SPA bundle | **$0** |
| Hosting transfer | 360 MB/day | a few reviewers | **$0** |
| Auth MAU | 50K | 7 personas | **$0** |

**Expected recurring cost: $0/month — the environment fits entirely within Blaze's no-cost quotas.**

Realistic overrun risks, all small: a runaway seed loop (bounded by scenario packs being finite and idempotent), Cloud Build minutes on Functions deploys (pennies per deploy), and Artifact Registry storage for Function containers (cents/month, and the one line item likely to be non-zero).

**Honest ceiling: single-digit dollars per month**, dominated by container storage rather than usage. This is not a spend decision on the merits of cost; it is a decision about whether to run a second project at all.

## 21. Security and blast radius

**Complete separation.** A distinct GCP project means separate Firestore, Auth, Functions, Hosting, IAM, and quotas. There is **no code path** from sandbox to production: the sandbox client is built with sandbox identity, and production guards (§11) keep unknown projects failing closed.

- No production data, ever.
- Personas use a reserved TLD and cannot be real people.
- Sandbox credentials are generated, never committed.
- Sandbox has **no** delete protection, PITR, or backups — losing it is a rebuild, not an incident.
- **The sandbox is not a lower-security production.** It holds nothing of value, which is the point.

**One residual risk to state:** the same Rules run in both, so a Rules defect discovered in sandbox is also live in production. That is a feature (it is how you find it), but it means a sandbox Rules finding is a **production** finding.

## 22. Cleanup and rebuild

Rebuild is the normal operation, not recovery: wipe collections → reseed → redeploy → reverify. Because no delete protection exists, the database can be deleted and recreated outright when a schema-level reset is wanted. Rebuild is expected to be routine and cheap; anything requiring a manual repair step is a defect in the automation.

## 23. Future physical split

When an RC review must not be disturbed by a sandbox rebuild — **expected within the first few cycles** given the backlog:

1. Create `eos-platform-integration`.
2. Fill in the registry entry already declared for `platform-integration`.
3. Point the rebuild script at it for RC promotion.

**No application configuration is remodelled** — ADR-011 already separates role from deployment, and the registry already declares both. That is the design cost paid up front so the split is a data change.

## 24. Exact protected actions requiring authorization

| # | Action | Type |
|---|---|---|
| **A-1** | Create GCP/Firebase project `eos-platform-sandbox` | Infrastructure |
| **A-2** | Link it to the billing account (Blaze) | **Spend** |
| **A-3** | Enable Firestore, Auth, Functions, Hosting | Infrastructure |
| **A-4** | Create the Firestore database in `us-central1` | Infrastructure |
| **A-5** | Deploy Rules + 6 indexes to sandbox | Deployment (sandbox only) |
| **A-6** | Deploy 22 Functions to sandbox | Deployment (sandbox only) |
| **A-7** | Seed Auth personas | Identity (sandbox only) |
| **A-8** | Deploy frontend to sandbox Hosting | Deployment (sandbox only) |
| **A-9** | Widen `warehouseBackupCodec` to allow-list membership | **Guard change — Tier 2** |

**A-9 is the only change that touches production code paths** and deserves separate consideration from A-1…A-8. Everything else is confined to a new, empty project.

**Nothing in A-1…A-9 has been executed.** No project created, no service enabled, no billing linked, no deploy, no spend.

## Recommendation

**Authorize A-1 through A-8.** Expected cost is $0/month within Blaze no-cost quotas, with a single-digit-dollar ceiling. It unblocks the Supplier Master RC and the accumulating review queue — the throughput failure identified as the strongest current lever.

**Consider A-9 separately.** It is a real (if minimal and still fail-closed) change to a production guard, and it can follow once the sandbox exists and the need is demonstrated rather than predicted — the same reasoning that deliberately left the guards untouched in O-3.
