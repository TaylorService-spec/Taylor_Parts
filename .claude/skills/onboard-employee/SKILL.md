---
name: onboard-employee
description: Guide governed Employee creation and application-access linkage through functions/scripts/provisionEmployeeAccess.js -- collect and validate one or more Employees, produce a reviewable onboarding plan, require separate Owner Production Data Authorization, execute sequentially with stop-on-failure, and verify results read-only. Use when asked to onboard, provision, or link a new Employee/test persona/production account, or to plan a batch of Employee onboardings.
---

# Onboarding Employees (governed)

This is developer/operator tooling that guides a human operator (or an
agent acting on the Owner's explicit authorization) through this
repository's existing governed provisioning workflow. **It is not a new
production UI and not an autonomous bot with stored credentials.** It
never creates, manages, stores, or displays a password, token, or other
credential -- see `functions/scripts/provisionEmployeeAccess.js`'s own
header comment for why that script is passwordless by design; this
skill inherits that constraint completely, it does not add a new write
path around it.

**Everything below wraps `functions/scripts/provisionEmployeeAccess.js`.
This skill never writes to `employees/{employeeId}` or `users/{uid}`
directly, and never edits a production Firestore document as a
substitute for running that script.** The two helper scripts in
`functions/scripts/` (`onboardEmployeePreflight.js` /
`onboardEmployeeVerify.js`) are read-only -- they call `getUserByEmail()`
and Firestore `.get()` only, never a write, a Firestore transaction, or
`auth.createUser()`.

## Identity model -- do not blur these

Per `docs/BusinessEntityModel.md` Section 8a and
`docs/PROJECT_ARCHITECTURE.md`'s Person Assignment Platform Service
Standard, four things are structurally separate and must stay that way
in every plan this skill produces:

1. **Employee identity** (`employees/{employeeId}.displayName`,
   `employmentStatus`) -- the workforce/business identity. Exists
   whether or not the person ever gets application access.
2. **Employee operational responsibilities**
   (`employees/{employeeId}.operationalRoles[]`) -- assignment
   eligibility markers (e.g. `PARTS_ASSOCIATE`). Never a security
   permission.
3. **Firebase Authentication identity** (email, uid, password) -- the
   credential/session authority only. This skill never touches a
   password. An Auth account must already exist before this skill links
   to it (see "Linked vs Employee-only" below) -- created by the Owner
   privately in the Firebase Console or their own tooling, never by
   this skill.
4. **User security role** (`users/{uid}.role`) -- application
   permission level (`admin`/`dispatcher`/`technician` --
   `provisionEmployeeAccess.js`'s `VALID_SECURITY_ROLES`, the only
   valid values; do not invent others).

Valid `operationalRoles` values are exactly
`provisionEmployeeAccess.js`'s exported `VALID_OPERATIONAL_ROLES` --
read that export at runtime (`require("../../functions/scripts/
provisionEmployeeAccess.js").VALID_OPERATIONAL_ROLES` or equivalent),
never a hand-maintained copy in this file, so this skill can never
drift from the script's own governance-approved list. Separately, check
`field-ops-app-vite/src/domain/constants.js`'s `OPERATIONAL_ROLE`
export for which of those values are actually **activated** on the
client today (gate something in the UI) versus merely **reserved** for
future use -- `docs/CLAUDE_CONTEXT.md`'s "`OPERATIONAL_ROLE` values
actually activated on the client" paragraph is the authority on this
distinction. Assigning a reserved-but-not-activated role (e.g.
`SALES_MANAGER` as of this writing) is not wrong, but the plan must say
so explicitly so the operator isn't surprised when it gates nothing yet.

## Step 1 -- Collect and validate

For each Employee to onboard, collect:

| Field | Required? | Notes |
|---|---|---|
| Employee ID | always | Technical, immutable, never a name (matches every existing Employee ID convention in this repo, e.g. `emp-rudy-owner`). |
| Display name | always (for a new Employee) | |
| Gets application access? | always | Determines Employee-only vs linked (see below). |
| Existing Firebase Auth email | only if linked | Must be an **already-existing** account -- this skill never creates one. Never guess or infer an email; if the operator doesn't supply one, stop and ask. |
| Security role | only if linked | One of `admin`/`dispatcher`/`technician`. Never invent a new one. |
| Approved operational roles | if applicable | Zero or more of `VALID_OPERATIONAL_ROLES` (see above), comma-separated. Never invent one not in that list. |
| Employment status | optional | `provisionEmployeeAccess.js` always sets `ACTIVE` on create and does not currently accept an override -- if the operator needs a different status, that's a script limitation to flag, not something to work around by hand-editing Firestore. |

**Refuse and stop, do not guess, if:** an Employee ID, email, security
role, or operational role is missing, ambiguous, or not independently
supplied by the operator. This skill does not infer or default any of
these from context, prior sessions, or pattern-matching against
similar-looking personas.

## Step 2 -- Classify: Employee-only vs linked

- **Employee-only**: no email, no security role, no operational roles
  unless the operator explicitly wants operational eligibility without
  application access (a real, supported case -- see the six-persona
  precedent's Sales Manager entry in `docs/DECISIONS.md` entry #11,
  though that entry left `operationalRoles` empty too since
  `SALES_MANAGER` was reserved, not activated, at the time).
- **Linked**: an existing Auth email is supplied. Every linked command
  in the plan defaults to `--requireExistingAuthUser` (see PR #114 /
  `docs/DECISIONS.md` entries #10-#11) -- this is not optional unless
  the operator explicitly authorizes the passwordless-create fallback
  for a specific, named entry (a genuinely new hire with no pre-created
  account), which itself still requires the same Production Data
  Authorization gate below, called out explicitly in the plan as a
  deviation from the default.

## Step 3 -- Multiple Employees in one batch

A batch is a list of independent entries, always executed **one at a
time, sequentially, never in parallel, never as a single multi-document
transaction.** This is intentional, not a limitation to work around:

- Each `provisionEmployeeAccess.js` invocation is already atomic for
  *that one* Employee/User pair (its own `db.runTransaction()` re-reads
  and re-validates before writing -- see that script's Phase E header
  comment). There is no cross-persona transaction, and this skill does
  not add one.
- Sequential stop-on-first-failure means a failure never leaves a
  "partially onboarded batch": every entry that already completed is
  fully committed and entirely unaffected by a later entry's failure,
  and the failing entry itself made zero mutation (per
  `--requireExistingAuthUser`'s phase-C guard, or the script's other
  existing conflict-detection throws).
- Batching into one bigger operation would require inventing a new
  multi-document transaction this script doesn't have and this task
  didn't ask for -- out of scope, and exactly the kind of unrequested
  abstraction to avoid.

## Step 4 -- Produce a reviewable onboarding plan (before touching anything)

Present a plan table, one row per Employee, containing exactly:

- Employee ID
- Employee-only or linked-access classification
- Security role (or "none -- Employee-only")
- Operational roles (or "none"), flagging any reserved-but-not-activated
  role explicitly
- The exact command that would run (see Step 6 for the template)
- Execution order (1, 2, 3, ... -- the sequential order above)
- Expected verification (what `onboardEmployeeVerify.js` will check for
  this entry -- see Step 9)
- Explicit exclusions -- what this plan does **not** do (e.g. "does not
  create an Auth account," "does not set employmentStatus to anything
  other than ACTIVE," "does not modify any Employee/User outside this
  list")

Do not proceed past this plan without the operator reviewing it.

## Step 5 -- Require separate, explicit Owner Production Data Authorization

Presenting the plan is not authorization to run it. Per
`docs/DelegationCharter.md` and this repository's established pattern
(every persona-provisioning operation this session went through this
exact gate), production execution requires the Owner's explicit,
separate authorization *after* reviewing the plan -- naming the
authorized repository commit, the authorized project (`taylor-parts` or
otherwise), and the exact entries approved. Do not run anything before
this is given, no matter how routine the plan looks.

## Step 6 -- Preflight verification (after authorization, before execution)

Before running any command for real, verify all of the following. Do
not proceed if any check fails or cannot be performed; do not silently
skip a check because credentials are missing -- report it as a blocker
instead.

1. **Correct repository** -- `git remote get-url origin` matches
   `TaylorService-spec/Taylor_Parts`.
2. **Clean working tree** -- `git status --porcelain` is empty.
3. **Local `main` matches `origin/main`** -- `git fetch origin` then
   `git rev-parse main origin/main` are identical.
4. **Expected reviewed commit** -- that shared value matches the
   commit the Owner's authorization named.
5. **Correct Google Cloud project** -- the `--projectId`/
   `--confirmProduction` values in every planned command match the
   authorized project exactly (`provisionEmployeeAccess.js`'s
   `assertProjectTarget()` already enforces the production-confirmation
   half of this; this check confirms the *plan* itself targets the
   right project before any command runs).
6. **Required Admin SDK credentials are available** -- confirm
   `GOOGLE_APPLICATION_CREDENTIALS` is set, or that
   `gcloud auth application-default login` has been run, **by checking
   for presence only** (e.g. `[ -n "$GOOGLE_APPLICATION_CREDENTIALS" ]`,
   or that the ADC file exists at its default path) -- never read,
   print, or expose the credential file's contents, and never go
   looking for a credential file elsewhere in the filesystem as a
   workaround if this check fails. If no credential is available, stop
   and report that production execution is blocked on credentials the
   operator must supply themselves -- do not ask the Owner to paste one
   into chat, per this repository's standing boundary (see
   `docs/DECISIONS.md` entries #9-#10 for the same limitation recorded
   previously).
7. **Existing Auth account is present for every linked Employee** --
   run `onboardEmployeePreflight.js` (below) against a `--plan` file
   built from the reviewed plan. It is read-only; it never creates an
   account. Do not proceed with any linked entry it reports as "NOT
   FOUND."

```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=<path> node scripts/onboardEmployeePreflight.js \
  --projectId <project> --confirmProduction <project> \
  --plan <path-to-plan.json>
```

`--plan` is a JSON array of `{ "employeeId": "...", "email": "..." }`
(email omitted for Employee-only entries) -- do not commit this file to
the repository; it's a transient working file for this run only.

## Step 7 -- Execute authorized entries sequentially

Run the exact commands from the reviewed plan, one at a time, in the
listed order, using `functions/scripts/provisionEmployeeAccess.js`
directly -- never a substitute, never a direct Firestore write. **Stop
immediately on the first non-zero exit** -- do not run any subsequent
command, do not retry with changed inputs, and do not omit
`--requireExistingAuthUser` to work around a failure without a new,
separate authorization for that specific change.

Command template (linked):
```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=<path> node scripts/provisionEmployeeAccess.js \
  --projectId <project> --confirmProduction <project> \
  --employeeId <id> --displayName "<name>" \
  --email <existing-account-email> --securityRole <role> \
  [--operationalRoles ROLE1,ROLE2] --requireExistingAuthUser
```

Command template (Employee-only):
```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=<path> node scripts/provisionEmployeeAccess.js \
  --projectId <project> --confirmProduction <project> \
  --employeeId <id> --displayName "<name>"
```

## Step 8 -- Read-only post-execution verification

Run `onboardEmployeeVerify.js` against a `--plan` file that now also
carries `linked`/`securityRole`/`operationalRoles` per entry (see that
script's header comment for the exact shape). It performs read-only
checks only -- Firestore `.get()` and `auth.getUserByEmail()`, no writes:

```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=<path> node scripts/onboardEmployeeVerify.js \
  --projectId <project> --confirmProduction <project> \
  --plan <path-to-verify-plan.json>
```

For each entry it confirms: Employee document exists;
`employmentStatus == ACTIVE`; the expected `userId` linkage (or `null`
for Employee-only); the reciprocal `users/{uid}.employeeId` link where
applicable; `securityRole`; `operationalRoles` (exact set match); and
that an Employee-only entry has **no** `users/` document.

## Step 9 -- Report results

Return, per Employee: **PASS** or **FAIL**, and on failure, the point
in the sequence where execution stopped. Do not include raw uids unless
one is specifically needed to explain a mismatch (e.g. "found uid ending
in a different account than expected" -- describe the discrepancy, don't
dump full account detail). Never include an email, password, token, or
credential path in the result.

## Step 10 -- Docs-only record, not auto-merged

After a fully verified run, prepare a docs-only PR (matching this
repository's established pattern -- see `docs/DECISIONS.md` entries #9,
#10, #11 for the exact structure: decision, evidence, what's not
recorded/why) recording the operation. **Do not merge it automatically**
-- merge requires the same Owner Merge Authorization gate as every other
PR in this repository, per `docs/ai/workflow.md` and
`docs/DelegationCharter.md`. Never include a uid, email, password, or
credential path in that record, matching entry #11's own precedent.

## Explicit refusals (do not do these, ever)

- Create or manage a password of any kind.
- Display a credential, token, reset link, or secret in any output,
  plan, or docs record.
- Guess an email, security role, operational role, or Employee ID that
  wasn't independently supplied.
- Invent an operational role or security role outside
  `VALID_OPERATIONAL_ROLES` / `VALID_SECURITY_ROLES`.
- Provision anything against a real project without a separate,
  explicit Owner Production Data Authorization naming the exact plan.
- Continue a batch after any command fails.
- Work around a missing credential (searching the filesystem for a key
  file, asking the Owner to paste one into chat, using a different
  auth mechanism not already established in this repo).
- Edit `employees/{employeeId}` or `users/{uid}` directly in production
  Firestore as a substitute for running
  `functions/scripts/provisionEmployeeAccess.js`.

## Architectural note

This skill was built as bounded developer tooling wrapping an already
governance-approved script (`provisionEmployeeAccess.js`, PR #83 +
PR #114) -- it introduces no new production write path, no new
Firestore schema, and no new Rules. It reuses that script's exported
pure functions (`assertProjectTarget`) rather than duplicating its
logic. Per `docs/ai/workflow.md`, work of this shape has, in this
session's own precedent (PR #111, #113, #114, #115), proceeded directly
to implementation with the Owner's explicit instruction standing in for
a separate ChatGPT Architecture Review round; if a fuller review is
wanted before this skill is relied on for real production onboarding, request
one before the first authorized production run, not before this file exists.
