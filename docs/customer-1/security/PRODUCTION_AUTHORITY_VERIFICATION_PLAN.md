# Production Authority Verification Plan

**Gate:** `C1-SECURITY-01` — Production security and authority verification (IN_PROGRESS, launch-critical)
**Lane:** C — Admin / Identity / Security
**Status of this document:** a plan measured against the repository. It is **not** production evidence and closes nothing.
**Verifier:** `node docs/customer-1/security/verify-authority-verification-plan.mjs`

## What this document is

`C1-SECURITY-01` closes when *"production Rules, Functions, capabilities, roles,
protected actions, tenant boundaries, and audit behavior are verified from the
production environment for Day-1 scope."*

That close condition names seven verification domains and no procedures. This plan
supplies the missing half: for each domain, what must be established from the production
environment, the **read-only** procedure that would establish it, the authority that
procedure requires, and — where no procedure exists — the gap stated plainly.

It deliberately does not run anything against production. Production access is
Owner-authorized per action and is never inferred (see the blockers at the end). The
value of this document is that it converts an unbounded "verify security in production"
obligation into a bounded, named list of seven procedures that an authorized operator
can execute, and it identifies which of those procedures **do not exist yet** — which is
build work this lane can scope without any production access at all.

## Read-only discipline

Every procedure named here is metadata- or data-**read** only, with one stated exception
(V5/V7, which exercise the system's own refusal paths and are gated behind an explicit
Owner-authorization phrase and a non-default `--execute` flag). This plan may not
introduce a production write, a deployment, an activation, or a role grant. Where the
only way to establish a fact is to mutate production, the correct outcome is a recorded
blocker, not a widened procedure.

## Verification domain vocabulary

| Coverage | Meaning |
| --- | --- |
| `PROCEDURE_EXISTS` | A committed, read-only procedure covers the domain for Day-1 scope. Remaining work is an authorized operator run, not engineering. |
| `PROCEDURE_PARTIAL` | A committed procedure exists but covers less than the domain's Day-1 scope. The residue is stated. |
| `PROCEDURE_MISSING` | No committed procedure establishes this domain from production. Engineering is required before any operator run is meaningful. |

`PROCEDURE_MISSING` is not a production finding. It is a statement that the gate cannot
be closed by running something we already have.

## The plan

### V1 — Firestore Rules

**Must be established from production:** that the ruleset actually enforcing production
is byte-identical to the `firestore.rules` committed at the deployed commit, and that the
Day-1 deny behaviors it encodes hold against real authenticated principals.

**Coverage:** `PROCEDURE_PARTIAL`

**What exists:** `functions/scripts/verifyIssue100ProductionRules.js` is an authenticated,
operator-run production Rules probe. It is real production evidence when run — but its
own header scopes it to the Issue #100 surfaces (PARTS_MANAGER / WAREHOUSE_MANAGER /
PARTS_ASSOCIATE queue, reorder and inventory-transaction paths), not to Day-1 scope.
`functions/test/firestoreRulesSourceHash.test.mjs` pins the committed source, which
establishes *what should be live*, never *what is live*.

**Residue:** two things. (a) No committed procedure fetches the **live** ruleset and
compares it to the committed source; merged is not deployed, and `firestore.rules` has no
CI deploy. (b) No Day-1-scoped behavioral probe exists — V1 today proves one initiative's
surfaces, not the Day-1 set.

**Authority required:** Owner-authorized production read. Rules **deploy** is Tier 2 and
is outside this harness entirely; this plan never proposes one.

### V2 — Functions

**Must be established from production:** which trusted Functions are actually deployed,
in what revision, and that the repository's exported command surface and the deployed
surface do not disagree in a way that changes authority.

**Coverage:** `PROCEDURE_EXISTS`

**What exists:** `scripts/audit/verify-production-functions-live-state.sh` — read-only by
construction (every `gcloud`/`firebase` call is a `list`/`describe`/`get` form), pinned to
an expected project by an explicit `--confirm-project` argument, and it captures
timestamped artifacts so repository exports can be correlated against deployed state. It
reads no secret values and invokes no callable.

**Residue:** none for the domain as stated. The correlation it enables is only as good as
the Day-1 command list it is correlated against — that list is a `C1-SCOPE-01` input this
lane consumes rather than authors.

**Authority required:** Owner-authorized operator environment with production read
(the script's own header states it does not run from the repository workstation).

### V3 — Capabilities

**Must be established from production:** which capabilities are actually active in the
production environment, and what capability set a real production principal actually
resolves to.

**Coverage:** `PROCEDURE_MISSING`

**What exists:** activation state is representable in repository configuration
(`field-ops-app-vite/src/access/permissionCatalog.ts` plus the environment activation
overrides), and the ledger already records for `C1-SECURITY-01` that the Reporting
activation work "explicitly records it as not live production evidence." Repository
configuration is an intent, not a production reading.

**Residue:** the whole domain. No committed read-only procedure answers *"for production
principal P, what is the resolved effective capability set today?"* The nearest thing,
`functions/scripts/productionFoundationVerification.js` (S3), verifies that custom claims
carry **only** the four permitted fields — a necessary negative property, not an
enumeration of effective capability.

**Note on scope:** this gap is engineering, not access. It can be closed by building the
read-only resolver probe before any production authorization is requested.

### V4 — Roles

**Must be established from production:** the live `roleAssignments` population — which
principals hold which governed Roles, with which scopes — reconciled against the Day-1
persona set.

**Coverage:** `PROCEDURE_PARTIAL`

**What exists:** `functions/scripts/r32ProductionExposureCensus.js` is read-only and
structurally so — it imports no writer and reaches only `.get()` and `.count()`, is inert
on import, and refuses to resolve its target from `.firebaserc` (which defaults to
production). It has already been run: `PR #1752` measured two RoleAssignments on one
principal, no manager Roles, no location scopes.
`functions/scripts/auditSecurityRoleMirror.js` covers an adjacent and Day-1-relevant
drift: `employees/{id}.securityRole` against the linked `users/{uid}.role`. Its default
mode is read-only; its `--repair` path is a writer and is **out of scope for this plan**.

**Residue:** the R-32 census answers one narrow exposure question by design, not "who
holds what." Full roster reconciliation is the `C1-IDENTITY-01` obligation and depends on
Taylor designating its personas — see blocker T1. This is the same missing governed
principal/role-assignment read that `docs/customer-1/admin/DAY1_ADMIN_ACTION_CENSUS.md`
isolates as the root cause of five separate `MISSING` administrative actions.

**Authority required:** Owner-authorized production read; Taylor for the persona roster.

### V5 — Protected actions

**Must be established from production:** that server-side separation of duty holds —
self-approval is rejected, a single actor cannot complete a privileged grant — and that an
unauthenticated network call to a trusted Function is refused.

**Coverage:** `PROCEDURE_EXISTS`

**What exists:** `functions/scripts/productionFoundationVerification.js`, criteria S4
(separation of duty) and V1 (deployed-Functions presence plus refusal of an
unauthenticated raw HTTPS call). It is dry-run by default, requires an explicit
`--projectId` with no default, an exact-match `--confirmProduction` gate, an exact-phrase
`--ownerAuthorization` gate, and `--execute` before it exercises anything. Its only writes
are to its own `verify-`-prefixed fixtures, deleted in a `finally` block.

**Residue:** none for the domain as stated. Note this is the one procedure in this plan
that is not purely read-only — proving a refusal requires attempting the refused thing.
That is why it carries the strongest gate of anything named here.

**Authority required:** explicit Owner production authorization, per run. The script
enforces this itself and this lane must not weaken it.

### V6 — Tenant boundaries

**Must be established from production:** that the operating-company boundary actually
holds for real production principals — a principal scoped to one operating company cannot
read or transfer another's records.

**Coverage:** `PROCEDURE_MISSING`

**What exists:** repository-side enforcement is real and specific. `firestore.rules` keeps
`warehouseId` and `operatingCompanyId` out of every retained client update branch's
`diff(resource.data).affectedKeys().hasOnly([...])` list, so a retained client update
cannot become a company transfer; `operatingCompanyId` is derived server-side from the
warehouse on create and inherited by the purchase order. This is committed-source
evidence, not production evidence.

**Residue:** the whole domain. No committed procedure verifies a cross-company **denial**
from production against a real principal. Building it requires knowing which production
principals belong to which operating company, which is V4 and blocker T1.

**Standing caution:** `operatingCompanyId` is not `isNationalAccount`; a probe that
conflates them will report a boundary that was never tested.

### V7 — Audit behavior

**Must be established from production:** that Audit Events are append-only and immutable
in production, that they are secret-free, and that audit reads are confined to authorized
readers.

**Coverage:** `PROCEDURE_PARTIAL`

**What exists:** `functions/scripts/productionFoundationVerification.js`, criterion S5 —
a client-direct write to an existing Audit Event is denied by `firestore.rules`, and no
raw token or credential appears in an Audit Event. Notably, the verification run's own
Audit Events are deliberately **left in place**: a verification run does not get an
exemption from the immutability guarantee it is verifying. Read confinement has repository
proof in `functions/test/auditReadConfinement.test.mjs`.

**Residue:** read confinement is proven in the repository, not from production. Separately,
the administrator-facing Audit Logs surface routes to `AdministrationUnavailable` (census
A10), so audit behavior cannot be verified *through the product* by a Taylor administrator
— only by an authorized operator running the script.

**Authority required:** same gates as V5; it is the same script.

## Measured summary

| Coverage | Count | Domains |
| --- | --- | --- |
| `PROCEDURE_EXISTS` | 2 | V2, V5 |
| `PROCEDURE_PARTIAL` | 3 | V1, V4, V7 |
| `PROCEDURE_MISSING` | 2 | V3, V6 |

**Seven domains. Two have a procedure that covers Day-1 scope; none has been run against
production for Day-1 scope.**

Two consequences follow, and they matter for sequencing:

1. **Five of seven domains need engineering before an operator run is worth requesting.**
   V3 and V6 have no procedure at all; V1, V4 and V7 each have a stated residue. Asking
   the Owner for production authorization today would buy evidence for two domains.
2. **The V3/V4/V6 residues share one dependency** — knowing which production principals
   exist and what they are scoped to. That is the same governed principal/role-assignment
   read the admin census isolated. It is now the root cause of gaps on **both** lane-C
   gates, which is the strongest available argument for building it first.

## Blockers

Recorded, not decided. This lane implements authority; it does not create it.

- **O1 (OWNER).** Every production run named above requires explicit, per-action Owner
  authorization. None is claimed, inferred, or in progress. This blocks all production
  evidence for `C1-SECURITY-01` and cannot be resolved from inside the repository.
- **T1 (TAYLOR).** V4 and V6 require Taylor's designated Day-1 personas and their
  operating-company assignments. This lane must not invent Taylor personnel. Same
  designation the admin census asks for in its open question 3.

Neither blocker prevents closing the V3 and V6 procedure gaps, which is repository work.

## What this plan does not establish

- No production Rules, Function, capability, Role, protected action, tenant boundary, or
  audit behavior is claimed to have been verified.
- `PROCEDURE_EXISTS` means a procedure is committed and read-only, never that it has run.
- No Taylor acceptance is claimed or implied.

## Next work in this lane

Build the V3 read-only effective-capability probe and the V6 cross-company denial probe,
in that order — both are pure repository work, both are provable against the emulator
before any production credential is requested, and both are prerequisites for an operator
run that would otherwise return two domains out of seven.
