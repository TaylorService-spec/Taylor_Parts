# What Binds a Person to a Capability

**Lane P2-N.** Resolves two claims the program carried as UNPROVEN, and which together decide
whether this system's authorization model is live authority or a declaration.

- **(A)** Does the governed read path resolve only against the three compatibility Roles — leaving
  the 45 governed business Roles as declarations?
- **(B)** Is a `roleAssignment` ever consulted in the live authorization path?

Method for every claim below is stated inline as **EXECUTED** or **READ**. Executed claims were
produced by running the shipped resolver and the shipped services, not by reading them.

Pinned by `functions/test/governedRoleBinding.test.mjs` (13 assertions, three verified negative
controls). Measured at integrated head `d104cf49`.

---

## 0. Headline answers

| Question | Answer |
|---|---|
| (A) Do the 45 governed business Roles reach the live resolution path? | **Yes.** They are live authority on ~18 of ~21 live resolution sites, and all 45 are grantable. |
| (B) Is `roleAssignment` read in the live path? | **Yes — it is the only thing that produces an ALLOW.** |
| Are the night's Role-level numbers meaningful? | **Yes, with one restatement.** They describe reachable authority, not just a model. |
| Is anything broken? | **Yes, one thing, and it is narrow.** Two live Admin services silently deny 11 governed Roles. |

**The reassuring result is the main result.** The binding is real. The layer that tonight's
capability measurements exercised does connect to a person. That is the opposite of what the
program's standing hypothesis predicted, and it is stated here with the same confidence a defect
would be.

---

## 1. The correction that has to come first

**`readGovernedList` does not exist at the integrated head, and the citation built on it does not
apply to this codebase.** (EXECUTED — `git grep` across all 400 reachable commits.)

- At `d104cf49`, `readGovernedList` appears in exactly two files, both prose:
  `docs/architecture/eos-admin-policy-workflow-reconciliation.md` and
  `docs/architecture/eos-policy-nonprod-activation.md`. It is in **no** TypeScript source file.
- The symbol is real, but it lives on the **divergent, unmerged branch
  `feat/rules-out-of-firebase`**, as
  `functions/src/access/governedListReadService.ts:387` (`export async function readGovernedList`),
  exported as a callable from `accessCommandCallables.ts:291` and `index.ts:187`. Verified by
  `git merge-base --is-ancestor bc4c626f HEAD` → **not an ancestor**; `git branch --contains` names
  only `feat/rules-out-of-firebase`.
- On **that** branch, the claim is accurate: `governedListReadService.ts:392` and `:535` both read
  `const roles = deps.roles ?? COMPATIBILITY_ROLES`, and its own inline comment at `:130` says so
  ("`actorHolds` above resolves against COMPATIBILITY_ROLES").

So the reconciliation document was correct about the branch it measured. **Lanes P3-A3 and P3-C
generalized a branch-local finding to the mainline.** The conclusion they drew — that the 45
governed Roles are declarations and `/administration/roles-permissions` rests on nothing — does not
follow at the integrated head, where the resolution path is different code.

Two further corrections to the brief, both minor:
- The reconciliation says **43** governed business Roles; the catalog at head declares **45**.
- `trustedWriterCommands.ts:185` claims its allowlist is "every id GOVERNED_BUSINESS_ROLES declares
  (all 15)". The **comment is stale**; the literal below it now contains all 45. Content is
  current, prose is not.

---

## 2. The complete resolution chain, principal to allow/deny

There are **three authorities**, and they do not share a role store. A principal's authority under
one says nothing about their authority under another.

### Authority 1 — Firestore Security Rules (direct client access)

```
Firebase Auth uid
  └─> get(/databases/$(db)/documents/users/$(uid)).data.role        firestore.rules:14-19
        └─> string compare: "admin" | "dispatcher" | "technician"   firestore.rules:22-37
              └─> (+ operationalRoles on the linked employee doc, Issue #100)
                    └─> ALLOW / DENY
```

- **The 45 governed business Roles are invisible here.** Rules read one string field. There is no
  Role catalog, no capability, no scope, no condition.
- **`roleAssignments` is unreadable by any client**: `firestore.rules:1684` is
  `allow read, write: if false`. So are `roles`, `accessRequests` and `auditEvents`.
- **Custom claims cannot carry the gap.** `compactClaims.ts:27` caps claims at exactly four keys —
  `companyId`, `platformAdmin`, `companyAdmin`, `accessVersion` — and the module throws on a fifth.
  No Role, capability or scope is ever in a token. (READ.)

### Authority 2 — the capability engine, in trusted Cloud Functions

**This is the layer every capability measurement tonight was measuring.**

```
Firebase Auth uid
  ├─> users/{uid}.accessVersion                       (freshness floor)
  └─> roleAssignments where principalUid == uid
                        and status == "active"        ← THE BINDING. A Firestore query.
        └─> resolveEffectivePermission({ permissionId, assignments, roles, currentAccessVersion,
                                         target, activationOverrides })
              ├─ 1. capability registered?                  else DENY unknownPermission
              ├─ 2. capability active, or environment-activated?
              │                                             else DENY inactivePermission
              ├─ 3. per assignment: well-formed? active? accessVersionAtGrant <= current?
              ├─ 4. roles[assignment.roleId] exists AND declares this permissionId?
              ├─ 5. scopeMatches(assignment.scope, target)?
              ├─ 6. bindingAllowsAssignmentScope(role, permissionId, scope.type)?   (R-32)
              ├─ 7. conditions satisfied? (operationalRoleActive / isOwnAssignment / status)
              └─ 8. survivors sorted narrowest-scope-first
                    └─> ALLOW { matchedRoleId, matchedAssignmentId }  |  DENY noQualifyingGrant
```

Steps 3-8 are `functions/src/access/resolveEffectivePermission.ts:240-322`.

### Authority 3 — the EOS policy store (PostgreSQL, non-production only)

```
Firebase ID token (verified; identity only)
  └─> principalContext.ts: subject lookup -> EOS principal id + tenant membership
        └─> PostgreSQL eos.user_role_assignments        postgresPolicyRepository.ts:462
              └─> held Role KEYS
                    └─> hasAdministrationAuthority(...)  administrationAuthority.ts
                    └─> Object/Field CRED via effectiveObjectAccess.ts
```

- Served by `functions/src/eosApi/server.ts` → `adminPolicyHttp.ts` → `adminPolicyApi.ts`, deployed
  by `render.yaml` as a **non-production** Render service that refuses to start if
  `EOS_ENVIRONMENT` is production. The Admin UI reaches it through
  `field-ops-app-vite/src/modules/administration/usePolicyStore.js`. (READ.)
- **It is not exported from `functions/src/index.ts`** — no Cloud Function serves it.
- Its assignment table is `eos.user_role_assignments` in PostgreSQL, **a different store from the
  Firestore `roleAssignments` collection Authority 2 reads.** `principalContext.ts` states the rule
  explicitly: "Not a Firebase custom claim. Not `users/{uid}.role`. Not a compatibility Role
  string."

**The binding question has three separate answers because there are three separate stores.** Any
statement of the form "principal X holds capability Y" is incomplete without naming the authority.

---

## 3. Answer to (A): the governed business Roles are live authority

**Method: EXECUTED.** The shipped resolver was run with no `node_modules`, using Node 22
type-stripping plus an extensionless-import resolver hook, against
`functions/src/access/*.ts` directly.

Measured at head:

| Quantity | Value |
|---|---|
| Compatibility Roles | 3 (`admin`, `dispatcher`, `technician`) |
| Governed business Roles | 45 |
| Total Roles | 48 |
| Registered capabilities | 147 |
| Capabilities registered `active: false` | 109 |
| Capabilities held by **no** Role | 0 |
| Capabilities held only by `admin` and/or `owner` | 21 |
| Governed Roles **not** grantable | **0** |
| Roles resolving at least one ALLOW (merged catalog) | **47 / 48** |

The one Role resolving nothing is **`generalEmployee`, which declares zero permissions** — a
position marker by construction, not an inert grant.

### What the live call sites actually pass as `roles`

Of the ~21 places that call `resolveEffectivePermission` outside tests:

**Merged catalog — `{ ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES }` (governed Roles bind):**
`access/effectiveAccessFeed.ts` (the Admin UI's own effective-access feed),
`inventoryTransfer/transferCallableWiring.ts`, `cycleCount/cycleCountCallableWiring.ts`,
`inventoryReceiving/receivingCallableWiring.ts`, `equipmentInstall/installCallableWiring.ts`,
`serializedAsset/acquireCallableWiring.ts`, `workOrderLabor/laborCallables.ts`,
`dataImport/dataImportCallables.ts`, `dataImport/importedServiceHistoryReadService.ts`,
`account/accountImportCommand.ts`, `equipmentInstall/equipmentImportCommand.ts`,
`partMaster/partMasterCommands.ts`, `performance/performanceGoalAuthority.ts`,
`performance/performanceGoalReadService.ts`, `performance/performanceGoalCommands.ts`,
`reporting/reportExecutionService.ts`, `reporting/savedDefinitionCommands.ts`,
`finance/financeReadCallables.ts`, `reorderRequest/reorderWarehouseAuthority.ts`.

**Compatibility-only — `COMPATIBILITY_ROLES` (governed Roles do NOT bind):**
`access/trustedWriterCommands.ts:415`, `access/employeeProfileCommands.ts:454`,
`access/recordChangeHistoryReadService.ts:284`.

**So (A) is answered: no. The resolution path does not resolve only against the three
compatibility Roles.** The 45 governed business Roles are declared, grantable, and dispositive on
the overwhelming majority of live resolution sites. The claim was true of a specific function on an
unmerged branch and is false of the integrated head.

---

## 4. Answer to (B): `roleAssignment` is read, and it is the only thing that grants

**Method: EXECUTED.**

`roleAssignment` is not merely read in the live path — **it is the sole source of an ALLOW.**
`resolveEffectivePermission` has no branch that grants anything without a qualifying assignment.
Its only ALLOW return is at the end of the assignment loop, and it carries `matchedAssignmentId`.

Measured:

| Input | Result |
|---|---|
| `admin` holds `customer.record.read`, assignments `[]` | **DENY `noQualifyingGrant`** |
| Same capability, one active global assignment to `admin` | **ALLOW**, `matchedAssignmentId` set |
| Assignment present but `status: "disabled"` | **DENY** |
| Assignment with `accessVersionAtGrant` ahead of the principal's `accessVersion` | **DENY** |

**Where and when it is read.** Every live site performs the same Firestore query before resolving:

```ts
db.collection("roleAssignments")
  .where("principalUid", "==", uid)
  .where("status", "==", "active")
  .get()
```

read together with `users/{uid}.accessVersion` in a single `Promise.all`, per request, with no
cache. It appears at `trustedWriterCommands.ts:385`, `effectiveAccessFeed.ts:49`,
`employeeProfileCommands.ts:421`, `recordChangeHistoryReadService.ts:98`,
`financeReadCallables.ts:66`, `partMasterCommands.ts:116`, `performanceGoalReadService.ts:90`,
`performanceGoalCommands.ts:114`, `hierarchicalVisibility.ts:115`, and in the
`ROLE_ASSIGNMENTS_COLLECTION` constant of every callable-wiring module.

`roleAssignments` is also **written** — by the governed, audited, idempotent trusted-writer commands
`grantRole` / `revokeRole` / `assignApprovedRole` / `decidePrivilegedRoleRequest`. So it is both
read and written; the brief's either/or framing does not hold.

**Lane P3-B2's gate is real and it is enforced.** "ACTIVATION IS NOT A GRANT… a principal holds it
only via a governed, audited `roleAssignment`" is an accurate description of shipped behavior, not
an aspiration.

### Can a governed Role actually be given to someone?

This is the question that would have made the Roles inert even with the resolver wired, and it is
the one nobody had checked. **Method: EXECUTED.**

`trustedWriterCommands.ts` gates every grant through `ASSIGNABLE_ROLES` — a **hand-enumerated**
allowlist, deliberately *not* an alias of `GOVERNED_BUSINESS_ROLES`, so declaring a Role does not
make it grantable. An id absent from it fails closed with `UnknownRoleError`.

Executing `GOVERNED_ASSIGNABLE_ROLE_IDS` against the catalog:

```
declared governed Roles:              45
assignable governed Roles:            45
declared but NOT assignable:          []
assignable but NOT declared:          []
```

**All 45 are grantable.** The "declared but unassignable" defect class this registry exists to
prevent has, at head, zero instances.

### Is anyone actually assigned one?

**This is the one thing this lane cannot measure, and it must not be guessed.** Answering it
requires reading the Firestore `roleAssignments` collection in a live project, which this lane is
forbidden to do and which no emulator here can substitute for.

The only source-side evidence is a comment in `functions/src/index.ts:236-240`, which records a
correction made 2026-09-06:

> "This said both 'DENY today in every environment for the standing platform reason — no principal
> holds a roleAssignments document'. That was true when written and is now false:
> eos-platform-sandbox's admin persona has held `roleAssignments/bootstrap-admin-<uid>` (active,
> roleId admin, global) since the 2026-08-14 compatibility-admin bootstrap, and
> resolveEffectivePermission returns ALLOW there."

That is a claim in a comment, not a measurement. It attests to **one** assignment, to the
**compatibility** `admin` Role, in **sandbox**. It is evidence that the collection is populated at
all. It is **not** evidence that any principal holds any of the 45 governed business Roles.

---

## 5. What "granted to 17 Roles" actually means

Given the above, a statement of the form *"capability C is granted to N Roles"* means:

> Of the 48 Roles in the repository-declared catalog, N declare C. Each of those N is grantable
> through the audited trusted-writer path. A principal acquires C if and only if they hold an
> active, non-stale `roleAssignment` to one of those N Roles, at a scope that reaches the target,
> whose binding policy permits that scope, whose conditions are satisfied — **and** C is either
> registered active or activated in that environment.

It is a statement about **reachable authority**, not about a model on paper, and not about staffing.
Concretely:

- ✅ **The Role layer binds.** It is not a declaration. (A) is answered in the affirmative and the
  night's Role-level arithmetic is arithmetic about real, reachable authority.
- ✅ **147 capabilities, 48 Roles, 21 held only by `admin`/`owner`** all reproduce exactly under
  execution. `admin` and `owner` between them are the only holders of 21 of 147 capabilities.
- ⚠️ **"Granted" is two gates short of "exercisable."** 109 of 147 capabilities are registered
  `active: false`. Production carries no activation overrides. So for most of the catalog, N is the
  count of Roles that *would* confer it where it is switched on — and in production it is switched
  off regardless of N.
- ⚠️ **N counts Roles, never people.** A capability granted to 17 Roles and a capability granted to
  2 are equally dead if nobody holds those Roles. **Nothing in this repository can tell you how many
  principals hold any governed Role.** That requires reading `roleAssignments` in a live project.
- ❗ **For six capabilities, N over-counts the Roles that actually resolve it.** See below.

**The honest summary: the numbers describe a system, not a model — but they describe its
*capacity*, not its *occupancy*.** The wiring is real and carries current. Whether anyone is
standing at the other end of it is a question only live data answers.

For exactly one capability, N = 17.

---

## 6. The one defect found: two Admin services silently deny 11 governed Roles

**Method: EXECUTED**, through the shipped service with an injected `db` stub.

`recordChangeHistoryReadService.ts:284` and `employeeProfileCommands.ts:454` both default their Role
catalog:

```ts
const roles = deps.roles ?? COMPATIBILITY_ROLES;
```

and their only caller — `administrationUsersCallables.ts:93,115`, wiring the deployed
`updateEmployeeProfile` and `listRecordChangeHistory` callables — **never passes `deps.roles`.** So
the default stands in production code paths.

Resolved consequence:

| Capability | Governed Roles declaring it | ALLOW via merged catalog | ALLOW via the shipped default | Silently lost |
|---|---|---|---|---|
| `audit.event.read` | 11 | 12 | 1 (`admin`) | `salesManager`, `shopManager`, `generalManager`, `warehouseManager`, `partsManager`, `controller`, `accountingManager`, `financeManager`, `fieldManager`, `operationsManager`, `owner` |
| `admin.employeeProfile.write` | 1 | 2 | 1 (`admin`) | `owner` |

A principal holding `controller` — a Role the catalog says carries `audit.event.read`, which the
resolver confirms carries it, which the trusted-writer path will happily grant — is refused by
`listRecordChangeHistory` with `UnauthorizedActorError`. Nothing in either file records this as a
decision.

**Contrast with `trustedWriterCommands.ts`, where the same narrowing IS deliberate and documented.**
Its lines 1099-1110 state the ruling explicitly: `owner` is a *business* authority from
`GOVERNED_BUSINESS_ROLES`, while the Admin Portal writer resolves *administration* authority against
`COMPATIBILITY_ROLES` "and ONLY those… the catalog simply does not contain its roleId." That is a
recorded choice with reasoning attached, and it is left alone here.

The two services in the table have no such record. **This is not adjudicated by this lane** — it is
measured, pinned by test, and handed over. Note that Authority 3 takes the opposite view:
`administrationAuthority.ts` puts `owner` and `generalManager` *ahead* of `admin` for role
assignment.

---

## 7. What was pinned, and the negative controls

`functions/test/governedRoleBinding.test.mjs` — 13 assertions, registered in `functions`
`package.json` under `test:access`. Pure: no emulator, no network, no credentials. Exercises the
compiled `lib/` output per repo convention, so **`npm run build` is a prerequisite** — without it
the suite does not run at all.

`node test/governedRoleBinding.test.mjs` → **`13 passed, 0 failed`, exit 0** (captured directly).

Three negative controls, each injected into source, rebuilt, run, then reverted and re-verified
green:

| # | Injection | Expected | Observed |
|---|---|---|---|
| NC-1 | `resolveEffectivePermission`: return ALLOW when no assignment qualifies | binding assertions fail | **8 passed, 5 failed**, exit 1 (B1, B4, B5, A5, G2) |
| NC-2 | remove `owner` from `GOVERNED_ASSIGNABLE_ROLES` | grantability assertion fails | **12 passed, 1 failed**, exit 1 (A2: "governed Roles nobody can be given: owner") |
| NC-3 | widen `recordChangeHistoryReadService`'s default catalog | gap assertion fails | **12 passed, 1 failed**, exit 1 (G2) |

After reverting all three: `git status --porcelain src/` empty, build exit 0, suite exit **0**.

NC-1 is the control that matters most: it proves the suite detects a resolver that grants authority
without a `roleAssignment` — the exact failure mode (B) asks about.

**G2 is a characterization test.** It pins current, defective behavior so the defect is visible and
cannot regress silently. If §6 is fixed, G2 *should* fail — update it, do not delete it. NC-3 is its
proof of sensitivity.

Also re-run green (exit codes captured directly, after `npm run build`):
`resolveEffectivePermission.test.mjs` **0**, `governedBusinessRoles.test.mjs` **0**,
`permissionCatalog.test.mjs` **0**, `roleHierarchy.test.mjs` **0**.

**Not run:** `trustedWriterCommands.test.mjs` and every other emulator-backed suite. They require
live Firestore + Auth emulators, which cannot start in this environment (no JRE; port 8080 held).
No conclusion here rests on them.

---

## 8. UNPROVEN — what this lane did not establish

1. **Whether any principal holds any of the 45 governed business Roles, in any environment.**
   Requires reading `roleAssignments` in a live project. **The single most consequential open
   question remaining, and the one the night's numbers most depend on.** Until it is answered,
   every "granted to N Roles" figure is a statement about capacity, not occupancy.
2. **Whether `roleAssignments` documents in the wild are well-formed.** A document missing
   `accessVersionAtGrant`, or carrying an unknown scope type, is silently skipped — fail-closed, but
   invisible. Un-auditable without live data. (Worth noting: this lane's own first fixture was
   malformed in exactly this way and the resolver correctly denied it.)
3. **Whether the deployed `firestore.rules` matches this repository's.** Not measured; out of scope.
4. **Whether PostgreSQL `eos.user_role_assignments` is populated**, and whether it agrees with
   Firestore `roleAssignments`. Two stores, no reconciliation measured. Non-production only.
5. **Whether §6's compatibility-only default is intentional.** Measured as behavior; the intent is
   unrecorded in source and is an Owner question.
6. **Whether `feat/rules-out-of-firebase` will reintroduce `readGovernedList`'s compatibility-only
   resolution on merge.** If that branch merges as-is, the P3-A3 finding **becomes true** for
   whatever reads route through it. Worth a gate on that merge.
7. **Runtime behavior of the callable wirings.** Their `roles` catalogs were resolved by execution;
   the surrounding callables were read, not invoked (they need emulators).

---

## 9. Corrections to the record

| Claim | Source | Status |
|---|---|---|
| "`readGovernedList` resolves capabilities against `COMPATIBILITY_ROLES` only" | reconciliation §1.2 | **True for `feat/rules-out-of-firebase`. Does not apply to `d104cf49` — the symbol is absent from all source there.** |
| "The 43/45 governed Roles are declarations, not live authority" | reconciliation §1.2; P3-A3; P3-C | **False at head.** All 45 are grantable; 44 of 45 resolve ALLOW; ~18 of ~21 live sites use the merged catalog. |
| "43 governed business Roles" | reconciliation §1.2, D-4 | **45** at head. |
| "`readGovernedList` does not appear anywhere in `functions/src`" | P2-N brief | **Correct**, and the brief was right to flag it. It is on an unmerged branch. |
| "Is `roleAssignment` ever consulted, or only written/administered?" | P2-N brief | **Both.** Read on every live authorization, and it is the sole source of an ALLOW. |
| "This registry is now EVERY id `GOVERNED_BUSINESS_ROLES` declares (all 15)" | `trustedWriterCommands.ts:185` | **Stale comment.** The literal contains all 45. Content correct, prose wrong. |
| "`readGovernedList` + `COMPATIBILITY_ROLES` are transitional infrastructure to be retired" | D-4 | **Still sound as direction**, but at head there is nothing named `readGovernedList` to retire. |
