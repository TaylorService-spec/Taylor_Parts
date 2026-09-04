# Production Roster Reconciliation and Least-Privilege Verification

**Gate:** `C1-IDENTITY-01` — Production identities and roles (OPEN, launch-critical)
**Lane:** C — Admin / Identity / Security
**Status of this document:** a procedure measured against the repository. It is **not** production evidence and closes nothing.
**Verifier:** `node docs/customer-1/identity/verify-roster-reconciliation.mjs`

## What this document is

`C1-IDENTITY-01` closes when *"the production user roster is reconciled and each Day-1
persona is verified at least privilege against production authorities."*

That is two obligations and no procedures. This document supplies both procedures: how a
roster is reconciled (what stores must agree, what an exception is, who dispositions it),
and what "verified at least privilege" concretely means for one persona.

It reconciles nothing. No production store is read here, no Taylor person is named, and no
persona is designated — this lane must not invent Taylor personnel. What it does establish
is which parts of the reconciliation already have a committed instrument and which parts
have none, which is buildable work that needs no production access at all.

## The identity record chain (measured)

A production "user" is not one record. It is five, and least privilege is a property of
their agreement, not of any one of them.

| # | Store | What it owns | Who writes it |
| --- | --- | --- | --- |
| 1 | Firebase Auth account (`uid`) | Whether a human can sign in at all; credential and account email | Firebase Auth. `provisionEmployeeAccess.js` locates or creates the account from `--email`, which is an execution input only and is never written to `employees`. |
| 2 | `users/{uid}` | `.role` — the legacy `admin`/`dispatcher`/`technician` security role, which is what `firestore.rules` actually enforces. `.employeeId` — the **only** authoritative principal→employee join. Never email, never name. | Admin SDK only; `firestore.rules` has denied all client writes to `users/{uid}` since this project's earliest sprints. |
| 3 | `employees/{employeeId}` | `.userId` (the reciprocal back-link), `.employmentStatus`, `.operationalRoles[]`, `.assignedWarehouseIds[]`, `.securityRole` | `functions/scripts/provisionEmployeeAccess.js` — the only normal writer of the two-way link, and the collection's only writer at all. `firestore.rules` denies all client create/update/delete on `employees/{employeeId}` unconditionally, with no admin exception. |
| 4 | `roleAssignments/{id}` | The governed access model: `principalUid`, `roleId`, `status`, `scope{type,value}` | Trusted writer commands (`admin.roleAssignment.write`). |
| 5 | Custom claims on the Auth account | Exactly four permitted fields — `accessVersion`, `companyId`, `platformAdmin`, `companyAdmin` — and never detailed permissions | The grant path; asserted by `productionFoundationVerification.js` criterion S3. |

Two properties of this chain drive everything below.

**The join is `users/{uid}.employeeId`, in that direction.** Reconciling on email or name
is not a weaker procedure, it is a different and wrong one: Firebase Auth owns account
email and `employees` deliberately does not carry it, so an email match asserts a link the
system does not recognise.

**Store 3 is live authority, not just workforce data.** `employees.securityRole` is a
denormalized read-only mirror of `users/{uid}.role` and is never consulted by
`firestore.rules` — it is a display convenience. But `employees.operationalRoles[]` and
`employees.assignedWarehouseIds[]` *are* consulted: `isActiveOperationalRole()`
(`firestore.rules:112-121`) and `isAssignedToWarehouse()` (`firestore.rules:139-150`) both
resolve access through the reciprocal link, `employmentStatus == "ACTIVE"`, and those two
arrays. A roster reconciliation that looks only at `roleAssignments` therefore measures
part of a principal's real authority. So does a least-privilege review that does.

## Reconciliation procedure

Read-only throughout. Every step is an enumeration or a join; none of them repairs
anything, because a repair is a production write and a production write is Owner-authorized
per action.

| Step | Procedure | Instrument today |
| --- | --- | --- |
| R1 | Enumerate every Firebase Auth account in the production project. This is the denominator; every later step is a join onto it. | **NONE.** No committed procedure reads production Auth. The classifier below accepts the enumeration and reports its absence as a stated limit; it cannot produce it. |
| R2 | For each `uid`, resolve `users/{uid}`; record accounts with no `users` document. | Partial — `r32ProductionExposureCensus.js` reads the whole `users` collection, but only as a join map. |
| R3 | Verify the two-way link: `users/{uid}.employeeId` resolves, and that employee's `.userId` points back at the same `uid`. | Partial — the census resolves the forward direction and flags an unresolvable join; it does not assert the back-link. |
| R4 | Enumerate `roleAssignments` per principal; validate `status`, `roleId` against the Role catalog, and `scope` against `warehouses`. | `r32ProductionExposureCensus.js`. |
| R5 | Compare `employees.securityRole` against the linked `users/{uid}.role`. | `auditSecurityRoleMirror.js`, read-only by default. Its `--repair` path is a writer and is out of scope here. |
| R6 | Assert the account's custom claims carry only the four permitted fields. | `productionFoundationVerification.js` criterion S3, on a fixture principal rather than across the roster. |

### The denominator problem

R1 is not a missing convenience. It is the reason the roster is currently unmeasurable.

`r32ProductionExposureCensus.js` builds its principal set from the `roleAssignments`
collection — `byPrincipal` is populated by iterating assignment documents, and a principal
appears in the report only if it holds at least one. It never calls Firebase Auth. So two
populations are structurally invisible to the only production identity instrument that has
actually been run:

- an Auth account with no `users` document — a human who can sign in, unjoined to anything;
- a `users` document with no `roleAssignments` — a principal whose authority comes entirely
  from `users.role` and `employees.operationalRoles`, which is exactly how this system
  worked before the governed model existed.

`PR #1752` measured **two RoleAssignments on one principal** in production. Read together
with the paragraph above, that measurement says the census could only ever have reported
one principal, whatever the true roster size is. It is a correct result for the exposure
question it was built for, and it is not a roster.

**Consequence:** `C1-IDENTITY-01` cannot be closed by running what exists. The first
missing piece is the smallest one — an Auth-side enumeration that gives the reconciliation
a denominator.

### Exception classes

Reconciliation output is a list of exceptions, each dispositioned by a named owner. An
exception is never resolved by granting access.

| Class | Meaning | Detected today by | Disposition owner |
| --- | --- | --- | --- |
| `ORPHAN_AUTH_ACCOUNT` | Auth account with no `users/{uid}` document | **nothing** (R1 gap) | Taylor + Owner |
| `PRINCIPAL_HAS_NO_EMPLOYEE_LINK` | `users/{uid}` with no `.employeeId` | census anomaly of the same name | Taylor |
| `PRINCIPAL_JOIN_UNRESOLVED` | `.employeeId` points at a missing employee | census classification | Verenward |
| `BACK_LINK_MISMATCH` | `employees.userId` does not point back at the joined `uid` | **nothing** (R3 residue) | Verenward |
| `UNGOVERNED_PRINCIPAL` | Principal with zero `roleAssignments` whose access is entirely `users.role` + `operationalRoles` | **nothing** (denominator problem) | Verenward + Taylor |
| `ASSIGNMENT_REFERENCES_MISSING_ROLE` | `roleId` not in the Role catalog | census anomaly | Verenward |
| `ASSIGNMENT_MALFORMED_SCOPE` | `scope` absent or malformed | census anomaly | Verenward |
| `ASSIGNMENT_UNKNOWN_STATUS` | `status` neither `active` nor `disabled` | census anomaly (`ASSIGNMENT_UNKNOWN_STATUS` / `ASSIGNMENT_MALFORMED`) | Verenward |
| `ACCESS_ON_TERMINATED_EMPLOYEE` | Active assignment or Auth account on a non-`ACTIVE` employee | partial — the census discounts operational roles on non-`ACTIVE` employees but does not report the Auth account | Taylor |
| `SECURITY_ROLE_MIRROR_DRIFT` | `employees.securityRole` ≠ `users.role` | `auditSecurityRoleMirror.js` | Verenward |
| `CONTRADICTORY_LOCATION_SCOPE` | `assignedWarehouseIds` and governed location scopes disagree | census `assignedWarehouseComparison: CONTRADICTORY` | Verenward + Taylor |

### The committed classifier

`docs/customer-1/identity/rosterReconciliation.mjs` is the exception table above made
executable: `reconcileRoster(state)` takes already-read state for the five stores and returns the
exception list a reconciliation run would report, plus the denominator it was computed from.
Tested by `node --test docs/customer-1/identity/rosterReconciliation.test.mjs` against synthetic
fixtures only — no Taylor person, production uid or role assignment appears in that file, and none
may be added to it.

Three properties are deliberate.

**It is pure.** It opens no connection, holds no credential and imports no Firebase SDK, so the
classification rules are reviewable and provable before any production authorization is requested.

**It refuses to imply a roster it did not read.** Omitting `authAccounts` is legitimate — R1 has no
instrument — and produces the limit `AUTH_NOT_READ` and a null `authAccountsRead` rather than a
clean orphan result. An absent denominator is reported, never assumed empty.

**It reuses the census.** `assignmentState` and `compareAssignedWarehouseIds` are imported from
`functions/scripts/r32ProductionExposureCensus.js` rather than restated. A second definition of
"what counts as an active assignment" would be a second answer, and the census is the one that has
already been run against production.

The residue is the read adapter: the R1 Auth enumeration and the four collection reads that feed
this function belong in `functions/scripts/`, where `firebase-admin` and the
`--projectId`/`assertProjectTarget` production-pinning contract already live. That path is outside
this lane's owned paths, so it is named here rather than built.

## Least-privilege verification per persona

"Verified at least privilege" is not a review of a screenshot. Each designated Day-1
persona passes six checks — one positive and five negative. **The negatives are the
verification.** A persona that only passes LP1 and LP2 has been shown to work, not shown
to be least-privileged.

| # | Check | Kind | Establishable today |
| --- | --- | --- | --- |
| LP1 | The persona's account resolves to exactly one employee, in both directions, with `employmentStatus == "ACTIVE"`. | positive | R2/R3 — back-link residue |
| LP2 | The persona's governed Roles confer every capability its designated Day-1 workflows require. | positive | Role catalog is in the repository; the workflow→capability mapping is a `C1-SCOPE-01` input |
| LP3 | The persona holds **no** capability outside its Day-1 workflow set. Computed against the resolved capability set, not the granted one. | negative | **NO** — this is the `C1-SECURITY-01` V3 gap: no procedure answers "what does production principal P actually resolve to?" |
| LP4 | The persona derives no capability from the compatibility carrier `technician` Role that its governed Roles do not also confer. | negative | census `capabilityMatrix`, for the six R-32 capabilities only |
| LP5 | Every Role that should be warehouse-limited is actually scoped. `PR #1752` found **no location scopes at all** in production — so today the presumption for every persona is that it fails LP5 until measured otherwise. | negative | census location grants; requires the persona designation |
| LP6 | The persona cannot read or transfer another operating company's records. | negative | **NO** — the `C1-SECURITY-01` V6 gap |

Two notes that change the shape of a persona review.

**LP3 must be computed from resolved access, not from `roleAssignments`.** A principal's
effective authority is the union of its governed Roles, its `users.role`, and the Rules
branches that read `employees.operationalRoles` / `assignedWarehouseIds`. Reviewing
assignments alone under-reports.

**LP5 is currently a standing negative finding, not an open question.** No location scopes
exist in production, so every governed grant that ought to be warehouse-limited is
unrestricted. Whether that matters for a given persona depends on which Roles Taylor
assigns it, which is blocker T1.

## Measured summary

| | Count | Items |
| --- | --- | --- |
| Reconciliation steps with an instrument | 3 | R4, R5, R6 |
| Reconciliation steps partially covered | 2 | R2, R3 |
| Reconciliation steps with no instrument | 1 | R1 |
| Least-privilege checks establishable in principle | 4 | LP1, LP2, LP4, LP5 |
| Least-privilege checks with no procedure | 2 | LP3, LP6 |

**Six reconciliation steps and six least-privilege checks. None has been run against
production for Day-1 scope, and the one step that would give the roster a denominator has
no instrument at all.**

The two least-privilege gaps, LP3 and LP6, are the *same two gaps* the
`C1-SECURITY-01` plan records as `PROCEDURE_MISSING` (V3, V6). This is now the third lane-C
document to land on the same root cause — the admin census isolated it as the cause of five
`MISSING` administrative actions, the authority verification plan as the shared dependency
of three domains. One governed read of live principals and their resolved access converts
more of this lane than any other single piece of work.

## Blockers

Recorded, not decided. This lane implements authority; it does not create it.

- **T1 (TAYLOR).** No Day-1 persona designation exists. Least-privilege verification is
  per-persona by definition and cannot begin without it. Same designation the admin census
  asks for in its open question 3 and the authority verification plan records as its T1.
- **O1 (OWNER).** Every step R1–R6 reads production and requires explicit, per-action Owner
  authorization. None is claimed or inferred. Same blocker as the authority plan's O1.

Neither blocker prevents building the R1 Auth enumeration or the LP3 resolver, which are
repository work provable against the emulator.

## What this document does not establish

- No production roster is reconciled, and no count of production identities is claimed.
- No persona is designated, verified, or accepted; no Taylor person is named.
- "Instrument today" means a committed read-only procedure exists, never that it has run.
- The classifier has never been fed production state. A tested classifier is not a reconciliation.
- The `PR #1752` figures are quoted as that PR measured them and are not re-measured here.

## Next work in this lane

The classification half of R1–R5 is now committed and tested. What remains is the read adapter:
a read-only, `--projectId`-pinned entry point carrying the same refusal-to-consult-`.firebaserc`
contract the R-32 census already enforces, which enumerates Firebase Auth, reads the four
collections, and hands the joined state to `reconcileRoster`. It belongs in
`functions/scripts/`, which is outside this lane's owned paths — so the next lane-C item is
either an authority to place it there, or the `C1-SECURITY-01` V3 effective-capability
resolver, which has the same pure-classifier shape and the same LP3 dependency.
