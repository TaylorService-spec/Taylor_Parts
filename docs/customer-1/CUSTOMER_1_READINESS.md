# Taylor Customer 1 — Executive Readiness Ledger

**Current decision:** CONTINUE TOWARD CUSTOMER 1 — **PRODUCTION DEPENDENCY NOT AUTHORIZED**.

This page is the human-readable view of `CUSTOMER_1_LEDGER.json`. The JSON file is the structured gate record; this page explains the current program state and critical path.

## Current gate view

| Gate | Status | Launch critical | What closes it |
|---|---|---:|---|
| C1-SCOPE-01 — Day-1 scope and exclusions | OPEN | Yes | Classify all EOS families and accept exclusions. |
| C1-COMM-01 — Commercial model | OPEN | Yes | Price implementation, subscription, support, and custom work. |
| C1-CONTRACT-01 — Customer agreements | OPEN | Yes | Execute applicable service, implementation, data, support, and liability terms. |
| C1-DATA-01 — Migration scope and rehearsal | OPEN | Yes | Inventory source systems, approve mappings, rehearse migration, reconcile exceptions. |
| C1-INV-01 — Opening inventory reconciliation | OPEN | Yes | Taylor accepts opening warehouse/bin/truck/serialized inventory. |
| C1-IDENTITY-01 — Production identities and roles | OPEN | Yes | Reconcile users and prove least-privilege Day-1 personas in production. |
| C1-ADMIN-01 — Taylor administrative self-service | OPEN | Yes | Taylor admins can perform ordinary administration without engineering intervention. |
| C1-PRODUCT-01 — Day-1 workflow readiness | IN PROGRESS | Yes | All Day-1 workflows close their governed product/sandbox/acceptance gates. |
| C1-SECURITY-01 — Production authority verification | IN PROGRESS | Yes | Verify Rules, Functions, roles, capabilities, protected actions, and audit behavior in production. |
| C1-RECOVERY-01 — Backup and restore proof | OPEN | Yes | Define backup policy and prove a restore. |
| C1-CONTINUITY-01 — Interruption fallback | OPEN | Yes | Taylor has practical outage/fallback/reconciliation procedures. |
| C1-SUPPORT-01 — Support and escalation | OPEN | Yes | Operationalize support intake, severity, escalation, and bug-vs-enhancement boundaries. |
| C1-TRAINING-01 — Day-1 training | OPEN | Yes | Current role/workflow training exists and designated admins are trained. |
| C1-CUTOVER-01 — Cutover rehearsal | OPEN | Yes | Rehearse source freeze, final migration, reconciliation, activation, smoke test, and fallback. |
| C1-COST-01 — CI cost containment | IN PROGRESS | No | Pages no longer rebuilds for docs-only changes, but broad application CI still does; isolate ledger/training docs from those checks. |
| C1-OWNER-01 — Final production authorization | NOT AUTHORIZED | Yes | All critical gates READY plus explicit Owner authorization. |

## What is already materially advanced

EOS is not starting from zero. Existing repository evidence shows substantial work in governed authorization, Rules/Functions boundaries, sandbox personas, certification, North Star migration, service/work orders, dispatch/scheduling, sales, inventory/scanning, dashboards, financial-policy authority, and deployment controls.

Certification is formally closed in its bounded certification world: PR #1761 records world 1.8.0 at 1093/1093 with the final applied-inventory verifier 38/38 PASS and live Purchasing, Receiving, and Cycle Count ceremony evidence. That is strong product evidence, but the closeout explicitly does **not** claim production deployment or close transferred post-certification findings.

The physical-consumption Day-1 blocker that PR #1749 exposed is now closed in running sandbox behavior. PR #1775 implemented the governed source-selection path without granting technicians broad inventory visibility and proved receive 5 / consume 2 → on-hand 3 / Sales Order availability 3, including the truck double-subtraction guard. The applicable Functions estate was subsequently deployed to platform-sandbox. This removes that blocker from the Customer 1 critical path, but it is not production evidence.

Dashboard evidence has advanced beyond the first acceptance record. PR #1800 records `platform-sandbox` Hosting `6b281cd5` as the live build carrying the corrective chain. My Dashboard remains **CLOSED / OWNER ACCEPTED**, with its post-acceptance correctives live-verified, and Technician Dashboard Family 11 is now **CLOSED / OWNER ACCEPTED / LIVE VERIFIED**. The same closeout explicitly preserves the open technician self-goal-read authority question, the non-blocking inverted Work Order timestamp data-quality finding, and the fact that production remains untouched and unauthorized.

Migration preparation has also crossed an important process milestone without pretending seeded data is Taylor data. PR #1802 durably records the Lane B B-05 canary at `2f262d38`: deterministic SEEDED/SYNTHETIC source records, census/tiering/mapping fixtures, a repeatable dry-run harness, deterministic exception reporting, and passing targeted proofs. That establishes that the migration process can be rehearsed while Taylor exports are absent. `C1-DATA-01` remains `OPEN` because Taylor's actual source systems/volumes, accepted mappings, real exceptions, and customer acceptance are still required.

That evidence remains authoritative in its original files and merged PR records. This ledger does not duplicate hundreds of proof lines; it points at them and asks the Customer 1 question: **is the evidence sufficient for Taylor to depend on this in production?**

The product and security gates therefore remain `IN_PROGRESS`, and the migration gate remains `OPEN` despite meaningful process progress.

## Current Customer 1 blockers / cautions

- **Day-1 scope is still not frozen.** Until each family is explicitly Day 1, post-Day-1, pilot, or excluded, the product gate cannot honestly be declared complete even when individual families close.
- **Migration process is rehearsable, but Taylor data is still missing.** Seeded B-05 evidence proves the mechanism, not Taylor's real source inventory, volume, accepted mappings, exception reconciliation, or migrated-data acceptance.
- **Legacy stock-location runtime authority is retired, but legacy data remains:** PR #1763 removed the final client reader and Rules read arm. The remaining `stock_locations` documents are inert and await separately authorized disposition; they are not an active read/write dependency.
- **Production governed-access adoption is sparse:** PR #1752 found zero principals exposed to the measured R-32 change, but also found production has only two RoleAssignments on one principal, no manager Roles, and no location scopes. That narrows one risk; it does not satisfy `C1-IDENTITY-01` or `C1-SECURITY-01`.
- **Reporting production adoption is representable, not live:** PRs #1768 and #1779 separated eligibility from activation/adoption and made the approved production set representable without widening the non-production override mechanism. That is architecture/governance progress, not production verification.
- **Financial policy is governed but Taylor's actual profile is still a deployment/customer choice:** PRs #1776 and #1778 provide multiple tested costing strategies, ruled configure/read authority, and an absolute lock. The specific Taylor profile is not inferred by this ledger.
- **CI cost gate remains open:** PR #1802 changed one `docs/customer-1/**` file and still triggered `Vite Build Check`, `Operational Payload Guard`, and `Secret scan`. GitHub Pages did not reappear and no Windows-hosted runner was observed, but broad application CI still needs tighter path isolation before `C1-COST-01` can close.

## Training progress

Training is no longer merely a future requirement. The permanent close rule is active, and individual guides are beginning to close against running behavior.

- `docs/training/MY_DASHBOARD.md` — **COMPLETE — LIVE VERIFIED** against `platform-sandbox` commit `6b281cd5`; it explicitly covers both My Dashboard and Technician Dashboard and the corrective chain accepted on 2026-09-04.
- `docs/training/PURCHASING_RECORD_PURCHASE_ORDER.md` — guide exists for the governed purchasing price-entry workflow; its final completion remains tied to live deployment verification.

`C1-TRAINING-01` remains `OPEN` because its close condition is broader: every agreed Day-1 role/workflow must have current training and designated Taylor administrators must be trained.

## What is still mostly unbuilt as a Customer 1 operating system

The largest remaining gaps are not simply more screens. They are:

1. exact Day-1 scope and exclusions;
2. Taylor-specific data migration facts, accepted mappings, and real exception reconciliation;
3. opening inventory reconciliation;
4. Taylor administrator self-service;
5. backup/restore and interruption procedures;
6. support and escalation;
7. complete role-based Day-1 training;
8. implementation/subscription pricing;
9. contracts and responsibility boundaries;
10. cutover rehearsal and final production authorization.

## Near-term critical path

The next work should be prioritized in this order unless a dependency forces a change:

1. **C1-SCOPE-01** — freeze proposed Day-1 and exclusions.
2. **C1-DATA-01** — replace seeded assumptions with real Taylor exports/source facts, then reconcile and obtain acceptance of the migration tiers/mappings.
3. **C1-ADMIN-01** — identify ordinary admin actions Taylor must perform without Verenward engineering.
4. **C1-COMM-01 / C1-SUPPORT-01** — convert platform/support scope into sustainable pricing and operating boundaries.
5. **C1-RECOVERY-01** — establish and prove customer backup/restore recovery before production dependency. The Customer 1 orchestration-harness recovery tests in PR #1803 are framework durability evidence and do **not** satisfy this customer-data restore gate.
6. **C1-TRAINING-01** — continue closing role-based training as Day-1 workflows stabilize.
7. **C1-CUTOVER-01** — rehearse the actual launch procedure.

## Permanent deployment-close rule

A user-impacting release may become `DEPLOYED` before training is complete, but it may not become `CLOSED` until the applicable training documentation is created or updated and verified against the deployed behavior.

The authoritative rule is `docs/training/README.md`.

## Red lines

Production remains NO-GO if any of the following is true:

- no agreed migration scope;
- opening inventory is unreconciled;
- ordinary Taylor administration needs source code, CLI, or direct database editing;
- no tested recovery path;
- no support intake or bug-vs-enhancement boundary;
- no signed commercial/customer responsibility boundary;
- production roles/authority are unverified;
- critical workflow depends on undocumented manual intervention;
- material security concern remains unresolved;
- Taylor and Verenward disagree about the authoritative system for a critical fact;
- subscription economics depend on treating founder labor as free;
- final cutover cannot be repeated and reconciled;
- launch is being approved primarily because of schedule pressure;
- required user training is absent or stale.

## Success standard

Customer 1 does not require EOS to be complete for every future customer. Taylor Arizona is ready when the agreed Day-1 workflows are reliable, required data is reconciled, access is correct, normal administration is self-service, recovery/support/training are operational, responsibilities are explicit, economics are sustainable, deferred items are visible, and the Owner authorizes the exact production dependency package.
