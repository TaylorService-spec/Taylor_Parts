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
| C1-COST-01 — CI cost containment | READY | No | Pages path filter merged; ledger automation forbids Windows-hosted Actions. |
| C1-OWNER-01 — Final production authorization | NOT AUTHORIZED | Yes | All critical gates READY plus explicit Owner authorization. |

## What is already materially advanced

EOS is not starting from zero. Existing repository evidence shows substantial work in governed authorization, Rules/Functions boundaries, sandbox personas, certification, North Star migration, service/work orders, dispatch/scheduling, sales, inventory/scanning, and deployment controls.

That evidence remains authoritative in its original files. This ledger does not duplicate hundreds of proof lines; it points at them and asks the Customer 1 question: **is the evidence sufficient for Taylor to depend on this in production?**

The product and security gates are therefore `IN_PROGRESS`, not `OPEN`.

## What is still mostly unbuilt as a Customer 1 operating system

The largest remaining gaps are not simply more screens. They are:

1. exact Day-1 scope and exclusions;
2. measured Taylor data migration scope;
3. opening inventory reconciliation;
4. Taylor administrator self-service;
5. backup/restore and interruption procedures;
6. support and escalation;
7. training;
8. implementation/subscription pricing;
9. contracts and responsibility boundaries;
10. cutover rehearsal and final production authorization.

## Near-term critical path

The next work should be prioritized in this order unless a dependency forces a change:

1. **C1-SCOPE-01** — freeze proposed Day-1 and exclusions.
2. **C1-DATA-01** — obtain real source-system/data facts and define migration tiers.
3. **C1-ADMIN-01** — identify ordinary admin actions Taylor must perform without Verenward engineering.
4. **C1-COMM-01 / C1-SUPPORT-01** — convert platform/support scope into sustainable pricing and operating boundaries.
5. **C1-RECOVERY-01** — establish and prove recovery before customer dependency.
6. **C1-TRAINING-01** — build role-based training as Day-1 workflows stabilize.
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
