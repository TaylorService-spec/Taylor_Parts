# ADR-009: Business Operations Through the Application

**Status:** Accepted (2026-07-23). A permanent platform architecture principle. It authorizes no implementation, Rules, or deployment by itself; it is the governing rule that existing and future work is measured against, and it records the current conformance gaps (below) as governance defects to be remediated through their own gates.

## Context

Business staff must never be required to open the Firebase Console, the Firestore Console, or any Google Cloud surface to do their jobs. Firestore is **infrastructure**, not a business workspace. The platform already enforces most of this — protected operational collections are client-write-closed and mutated only by trusted Cloud Functions/commands (Admin SDK) behind effective-permission checks and append-only audit — but the rule has not been written down as a first-class principle, and a small number of conformance gaps exist (an interim client-direct write to `accounts`; no site-facing Part-creation workflow yet). Recording the principle makes those gaps defects rather than accepted practice, and gives every future workflow a single bar to clear.

## Principle

**Business users operate through the application. Firestore is infrastructure and must never be a required business workspace.**

All normal business activity is completed through approved site workflows via the required flow:

> site UI → authenticated trusted command / Cloud Function → effective role/permission check → domain validation → Firestore write → append-only audit event

This applies to all business operations, including: Parts and catalog maintenance; inventory receipt, transfer, issue, reservation, adjustment, and reconciliation; purchasing and supplier activity; customers and locations; jobs and work orders; dispatch and technician assignment; warehouse operations; and approvals / operational administration.

## Decision

1. **No direct Firestore access for business users.** Business users must not require Firebase/Firestore Console access. Protected operational collections deny direct client writes (`firestore.rules` `if false`); the authoritative write path is the trusted backend service account (Admin SDK) inside a Cloud Function/command. Frontend code must not use raw Firestore write APIs for protected business records. No workflow, runbook, or instruction may tell business staff to edit Firestore documents manually.

2. **Application Roles are not infrastructure access.** Application Roles resolve **business permissions** (via `resolveEffectivePermission`), which gate what site actions a user can see and perform. An application Role must **never** grant Google Cloud or Firebase IAM. Application Owner/admin is **not** an infrastructure administrator. Infrastructure access (Console, IAM, service-account keys) is separately governed and restricted to designated technical operators.

3. **Trusted commands are the only protected-write authority.** No Role may bypass trusted commands. A capability grant (e.g. `inventory.catalog.manage`) authorizes invoking a trusted command that performs the write as the Functions service account — it does **not** grant the holder any direct Firestore write.

4. **Technical exceptions are controlled and non-routine.** Controlled technical paths (approved migrations, emergency recovery, governed maintenance, audited operator scripts) may use Admin-SDK / infrastructure access **only** when the use is explicitly authorized, narrowly scoped, time-bound where applicable, evidence-producing, rollback-protected, reconciled afterward, and **never available as a routine business workflow**. Running such a path requires designated-technical-operator infrastructure access, which is distinct from and additional to the application-layer permission.

## INV-1 application

The Part Master CREATE importer (`functions/scripts/executePartMasterCreate.js`) is a **temporary migration exception** under Decision 4: an audited, dry-run-defaulted, idempotent, rollback-protected, reconciled operator script that writes `parts/` only through the trusted `createPart` command. It requires designated-technical-operator infrastructure access to run against production and is **not** a routine business workflow.

After migration:

- routine Part creation and maintenance occurs **through the site**;
- the site uses the trusted `createPart` command (a site-facing Part-creation callable does not exist yet — see gap G2);
- inventory Roles control **site actions only**, never Firestore access;
- users must not access Firestore to manage Parts.

## Current conformance gaps (governance defects — remediate via their own gates; NOT fixed here)

- **G1 — `accounts` client-direct write (Customer domain).** `field-ops-app-vite/src/domain/accounts.js` `createAccount`/`updateAccount` write the protected `accounts` collection directly through the client SDK (Rules-gated), not a trusted command. The file documents this as an interim path pending a trusted server-side writer ("Customer PR 3b"), after which client mutation becomes Rules-denied. Remediate in the Customer workstream.
- **G2 — no site-facing Part-creation workflow.** `createPart` is an internal trusted service, not an exported callable; the Part Master UI is read-only (PR 1.9). Until a `createPart` callable + site workflow exists, routine site-based Part creation is not yet possible — only the migration-exception operator script. Remediate in a later Inventory gate.
- **G3 — governed Roles not yet assignable via trusted commands.** The trusted role-assignment commands resolve `roleId` against `COMPATIBILITY_ROLES` only, so `inventoryCreateExecutor` cannot yet be granted through the audited callable path. Remediate in "Trusted Governed-Role Assignment Wiring" (already reviewed).

Conformant today (no defect): `parts`/`users`/`employees` are client read-only; `fieldops_wos` and `reportDefinitions` are written only through trusted callables; `manufacturers`/`part_aliases`/`part_supplier_items`/`inventory_transactions`/`roleAssignments`/`auditEvents` have no client reference at all. No application Role is coupled to GCP/Firebase IAM (verified: no IAM APIs referenced in application code).

## Consequences

- Every future workflow that touches a protected business record must add a trusted command + permission check + audit, never a raw client write — this ADR is the acceptance bar.
- The application-role vs infrastructure-access boundary is explicit: capability grants never confer Console/IAM, and infrastructure access is a separate, restricted, technical-operator concern.
- The three gaps above are now tracked defects with named remediation gates, not accepted practice.

## Alternatives rejected

- **Leave the rule implicit** — the gaps would read as accepted practice; a written principle makes them defects.
- **Allow business staff limited Console edits for "operational" fixes** — rejected: manual Firestore edits bypass permission checks, domain validation, and audit; every operation must be an audited trusted-command workflow.
- **Grant application Owner/admin infrastructure (IAM) access for convenience** — rejected: conflates application authority with infrastructure administration; infrastructure access stays separately governed for designated technical operators.
