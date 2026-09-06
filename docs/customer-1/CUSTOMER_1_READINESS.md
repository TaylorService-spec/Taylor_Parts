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

Migration preparation has crossed two process milestones without pretending seeded or sandbox data is Taylor data. PR #1802 durably records the Lane B B-05 canary at `2f262d38`: deterministic SEEDED/SYNTHETIC source records, census/tiering/mapping fixtures, a repeatable dry-run harness, deterministic exception reporting, and passing targeted proofs. PR #1804 then merged and sandbox-deployed EOS Data Import P1 (`d558f39d`, deployed build `b533757a`) for Parts, Customers, Equipment, opening Inventory, and imported Service History; its live sandbox acceptance was 24/24 with zero fabricated Work Orders. Together these prove substantially more of the migration mechanism. `C1-DATA-01` remains `OPEN` because Taylor's actual source systems/volumes, accepted mappings, real exceptions, and customer acceptance are still required, and Data Import execution is deliberately sandbox-only.

Administration self-service also materially advanced. PR #1806 consolidated people administration into one Administration → Users destination with a governed record page, trusted employee-profile edit command, per-field immutable audit events, and Change History. PR #1807 verified the existing sandbox administrator RoleAssignment/effective-access path rather than inventing a grant. PR #1808 then deployed and live-verified the Users experience on platform-sandbox Hosting `8e90b41e`, including a reversible governed `preferredName` edit through the real UI and two immutable audit rows. This is real progress toward `C1-ADMIN-01`, but not closure: the full Day-1 admin action set is not yet frozen, Taylor administrators are not designated/trained, password-reset authority remains inactive, and production readiness is not established.

Inbound work now arrives without being retyped. PRs #1811 (`c051af0c`) and #1813 (`32bd8270`) built Email Connections + Inbound Work in base EOS: a governed email connection for Microsoft 365 and Google Workspace, mailboxes and first-match routing rules, an inbound queue and review workspace where Accept creates exactly one Work Order carrying what the message said, and duplicate/threading protection that holds under at-least-once delivery. Credentials are held per connection in Secret Manager and never as Firestore fields; attachment bytes are retrieved into a private bucket and reach a reviewer only through a governed callable. PR #1814 is the North Star pass over both surfaces, and on 2026-09-06 the Owner deployed `35ce3741` to `platform-sandbox`, where `Service ▸ Inbound Work` is fully operable against intake records. **No real mailbox is bound** — no non-production Microsoft or Google tenant credentials were available, so the delivery loop is proved against a scripted provider and the Firestore emulator — **and on 2026-09-06 the Owner accepted both surfaces against build `de90d6b0`** — an acceptance of the surfaces, not of the capability as operationally complete. In the sandbox the connection actions (Connect, Test connection, Check now, Retry) are not operable, because the eight provider-transport Functions bind OAuth secrets that environment does not have and remain governed exclusions from the deploy set. Outbound email and Work Order correspondence are not built.

That evidence remains authoritative in its original files and merged PR records. This ledger does not duplicate hundreds of proof lines; it points at them and asks the Customer 1 question: **is the evidence sufficient for Taylor to depend on this in production?**

The product and security gates therefore remain `IN_PROGRESS`; migration, administration, and training remain `OPEN` despite meaningful progress.

## Current Customer 1 blockers / cautions

- **Day-1 scope is still not frozen.** Until each family is explicitly Day 1, post-Day-1, pilot, or excluded, the product gate cannot honestly be declared complete even when individual families close.
- **Migration process is much more executable, but Taylor data is still missing.** Seeded B-05 evidence and sandbox Data Import P1 prove mechanism and governed import behavior, not Taylor's real source inventory, volume, accepted mappings, exception reconciliation, production execution path, or migrated-data acceptance.
- **Administration → Users is live in sandbox but the Customer 1 admin gate is broader.** The running sandbox now supports governed user-profile edits and audited history, but the complete ordinary Day-1 admin action list is not frozen, designated Taylor admins are not yet trained, password reset remains separately inactive, and no production admin proof is claimed.
- **New training-close gap:** `docs/training/README.md` requires user-impacting deployments to have current deployed-behavior training before they are `CLOSED`. PR #1804 deployed/live-verified the new Data Import workflow and PR #1808 deployed/live-verified Administration → Users, but the authoritative `docs/training/` directory currently has no Data Import or Taylor EOS Administrator/Administration Users guide. Those releases may be `DEPLOYED/VERIFIED`; they must not be treated as `CLOSED` until training is complete (or a valid no-user-impact receipt exists). Whether either workflow is Day 1 still depends on `C1-SCOPE-01`.
- **Email intake is deployed to sandbox but unbound.** The provider abstraction, OAuth seam, credential custody, delivery loop and both surfaces are complete, proved and now running on `platform-sandbox` — and none of it has met a real mailbox. Binding a non-production Microsoft 365 or Google Workspace tenant is an external configuration dependency owned outside this repository; until it is met, there is no evidence that Taylor's actual corporate and vendor mail routes correctly.
- **Legacy stock-location runtime authority is retired, but legacy data remains:** PR #1763 removed the final client reader and Rules read arm. The remaining `stock_locations` documents are inert and await separately authorized disposition; they are not an active read/write dependency.
- **Production governed-access adoption is sparse:** PR #1752 found zero principals exposed to the measured R-32 change, but also found production has only two RoleAssignments on one principal, no manager Roles, and no location scopes. That narrows one risk; it does not satisfy `C1-IDENTITY-01` or `C1-SECURITY-01`.
- **Reporting production adoption is representable, not live:** PRs #1768 and #1779 separated eligibility from activation/adoption and made the approved production set representable without widening the non-production override mechanism. That is architecture/governance progress, not production verification.
- **Financial policy is governed but Taylor's actual profile is still a deployment/customer choice:** PRs #1776 and #1778 provide multiple tested costing strategies, ruled configure/read authority, and an absolute lock. The specific Taylor profile is not inferred by this ledger.
- **CI cost gate remains open:** PR #1802 changed one `docs/customer-1/**` file and still triggered `Vite Build Check`, `Operational Payload Guard`, and `Secret scan`. GitHub Pages did not reappear and no Windows-hosted runner was observed, but broad application CI still needs tighter path isolation before `C1-COST-01` can close.

## Training progress

Training is no longer merely a future requirement. The permanent close rule is active, and individual guides are beginning to close against running behavior.

- `docs/training/MY_DASHBOARD.md` — **COMPLETE — LIVE VERIFIED** against `platform-sandbox` commit `6b281cd5`; it explicitly covers both My Dashboard and Technician Dashboard and the corrective chain accepted on 2026-09-04.
- `docs/training/PURCHASING_RECORD_PURCHASE_ORDER.md` — guide exists for the governed purchasing price-entry workflow; its final completion remains tied to live deployment verification.
- `docs/training/email-connections-and-inbound-work.md` — **COMPLETE** against `platform-sandbox` `de90d6b0`. Covers both Roles: Email Intake Administrator (connections, mailboxes, routing rules) and Service Inbound Work Reviewer (queue, Accept, Decline, Attach). It states plainly which four actions are inoperable in that environment and why, rather than teaching a procedure a user cannot perform.
- **Closed:** Email Connections + Inbound Work was deployed to `platform-sandbox` on 2026-09-06 (`de90d6b0`), Owner-accepted the same day, and now carries [`docs/training/email-connections-and-inbound-work.md`](../training/email-connections-and-inbound-work.md) representing that build. The permanent close rule is satisfied for this release: `TRAINING: COMPLETE`. Closing the deployment does not close the capability — no real mailbox is bound and no provider application is registered against the environment, so four administration actions remain inoperable there and the guide names them as such.
- **Missing for newly deployed sandbox workflows:** no `docs/training/**` guide currently covers Administration → Data Import or Administration → Users / User Detail. Under the permanent close rule, those deployments cannot be treated as `CLOSED` until applicable training is created/updated and live-verified (or explicitly proven not applicable, which these user-facing workflows are not).

`C1-TRAINING-01` remains `OPEN` because its close condition is broader: every agreed Day-1 role/workflow must have current training and designated Taylor administrators must be trained.

## What is still mostly unbuilt as a Customer 1 operating system

The largest remaining gaps are not simply more screens. They are:

1. exact Day-1 scope and exclusions;
2. Taylor-specific data migration facts, accepted mappings, and real exception reconciliation;
3. opening inventory reconciliation;
4. complete Taylor administrator self-service plus administrator training;
5. backup/restore and interruption procedures;
6. support and escalation;
7. complete role-based Day-1 training;
8. implementation/subscription pricing;
9. contracts and responsibility boundaries;
10. cutover rehearsal and final production authorization.

## Near-term critical path

The next work should be prioritized in this order unless a dependency forces a change:

1. **C1-SCOPE-01** — freeze proposed Day-1 and exclusions.
2. **C1-DATA-01** — replace seeded/sandbox assumptions with real Taylor exports/source facts, then reconcile and obtain acceptance of the migration tiers/mappings.
3. **C1-ADMIN-01** — finish the ordinary admin-action census against the now-running Users surface and identify what Taylor still cannot do without Verenward engineering.
4. **C1-TRAINING-01** — close the newly visible Administration training gap and continue role/workflow coverage as Day-1 scope stabilizes.
5. **C1-COMM-01 / C1-SUPPORT-01** — convert platform/support scope into sustainable pricing and operating boundaries.
6. **C1-RECOVERY-01** — establish and prove customer backup/restore recovery before production dependency. The Customer 1 orchestration-harness recovery tests in PR #1803 are framework durability evidence and do **not** satisfy this customer-data restore gate.
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
