---
artifact_type: current-state-census
gate: n/a (analysis-only; not a decision or architecture-review gate)
status: Draft
date: 2026-09-16
owner: Claude (Lane 0, Authorization v2 program)
related_adrs: []
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr: 1922 (docs(roadmap): full EOS platform reconciliation + Authorization v2 reset -- OPEN, not merged)
target_release: Authorization v2 -- Wave 0 (Freeze and reconcile current truth)
---

# Authorization v2 -- Current-State Census (Lane 0)

**Repository baseline:** `main @ 8f09db50961dbc27a64016f6aef87510f12aaeee` (2026-09-16), worktree
`D:\Taylor_Parts\.claude\worktrees\north-star-ux-design-d88452`.
**Purpose:** raw inventory for Authorization v2 Phase A ("Current authority census + freeze",
`2026-09-16-authorization-v2-application-platform-reset.md` §5.3). This is a READ-ONLY finding
document. It does not resolve any conflict it finds; conflicts and unresolved business meaning are
recorded as **UNKNOWN / NEEDS DECISION** rather than guessed.

This document is a companion to `docs/reviews/authorization-v2-authority-map.md`, which turns the
same findings into one row per authority with current/target paths and cutover requirements.

**Classification legend** (exactly one per finding):

- **BUSINESS FACT TO PRESERVE** -- a durable fact about the business (who owns/is accountable for a
  record, which company, etc.) that must survive the migration regardless of storage/transport.
- **CURRENT SECURITY AUTHORITY** -- the thing actually enforcing access today.
- **COMPATIBILITY LAYER** -- code built to bridge two authorization generations; not itself an
  authority, and a retirement candidate once its bridged sides converge.
- **PAGE-LOCAL AUTHORITY** -- a UI-only interpretation of role/access with no independent server
  enforcement; the exact anti-pattern Authorization v2 condemns (`application-platform-reset.md`
  "What is condemned").
- **FIREBASE-SPECIFIC** -- exists only because the runtime is Firebase; not portable as-is.
- **TARGET POSTGRESQL FOUNDATION** -- already-built PostgreSQL/Render work usable as-is or with
  minor extension as part of Authorization v2 v1.
- **LEGACY TO RETIRE** -- superseded, kept only until a replacement is proven.
- **UNKNOWN / NEEDS DECISION** -- ambiguous ownership, conflicting authority, or a decision this
  pass is not authorized to make.

---

## 1. Identity

### 1.1 Firebase Auth (client + admin)

- **What:** `firebase/auth` client SDK (`onAuthStateChanged`, `signInWithEmailAndPassword`,
  `signOut`, `sendPasswordResetEmail`) drives the browser's sign-in state.
  `field-ops-app-vite/src/auth/AuthContext.jsx:1-151` is the single consumer of the client SDK in
  the frontend (`grep firebase/auth` under `field-ops-app-vite/src` returns exactly this file).
- **Where:** `field-ops-app-vite/src/auth/AuthContext.jsx`; underlying init at
  `field-ops-app-vite/src/firebase/firebase.js` (not read in full this pass).
- **Server side:** `firebase-admin` is imported in 186 files under `functions/src` (`grep -rl
  "firebase-admin" functions/src | wc -l` = 186) -- this is the single largest concentration of
  active Firebase surface area in the repo, spanning far more than identity (Firestore reads/writes,
  Functions triggers, etc.).
- **Classification:** FIREBASE-SPECIFIC (current identity provider) / CURRENT SECURITY AUTHORITY
  (it is what "signed in" means today).
- **Roadmap alignment:** matches `full-platform-roadmap-reconciliation.md` §4 "Firebase Auth --
  LEGACY / 35% exit" and §9 Firebase exit inventory ("current Firebase authentication verifier...
  keep temporarily only until replacement is proven").

### 1.2 EOS Principal (PostgreSQL) -- already built

- **What:** a server-side Principal model already exists and is already the authority the trusted
  Render API (`eos-api-nonprod`) uses for every protected read, independent of any Firebase claim.
  `functions/src/adminPolicy/principalContext.ts:1-151` -- `resolvePrincipalContext()` resolves a
  verified external subject (today, a Firebase UID injected as a `TokenVerifier`, but the function
  signature and comments are explicit that this is "transitional identity only") to a
  `PrincipalContext { principal, tenant, tenantId, uid (= EOS principal id, NOT Firebase UID),
  heldRoleKeys, accessVersion, hadStaleAssignment }`.
- **Key design fact (verbatim from source, line 58-60):** "`uid` is the EOS principal id, NOT the
  Firebase UID -- that is what makes the authorization model survive replacing the identity
  provider." This is precisely the seam Authorization v2's `External Identity -> EOS Principal ->
  Employee` chain wants; it already exists in code, not just in the roadmap doc.
- **Refusal categories are explicit and fail closed:** `UNKNOWN_PRINCIPAL`, `PRINCIPAL_DISABLED`,
  `NO_TENANT_MEMBERSHIP`, `TENANT_NOT_A_MEMBERSHIP`, `AMBIGUOUS_TENANT`, `TENANT_NOT_ACTIVE` -- no
  code path downgrades to a reduced-but-usable context; every failure throws.
- **Reused by:** `functions/src/eosOps/capabilityAuthority.ts` (`resolveOperationalContext`, used
  identically by Operations, Commercial and Workforce transports per
  `functions/src/eosWorkforce/workforceHttp.ts:8-9` comment "the SAME resolver the Operations and
  Commercial transports use").
- **Classification:** TARGET POSTGRESQL FOUNDATION.

### 1.3 Employee record (Firestore, legacy Phase-3 foundation)

- **What:** an older (2026-07-10) Employee foundation lives at `employees/{employeeId}` in
  Firestore, with `employmentStatus` as authoritative lifecycle field, documented in
  `docs/reviews/employee-foundation-architecture-review.md`. This predates and is distinct from the
  PostgreSQL Employee authority in §1.4/§6 below.
- **Where:** Firestore Rules for `employees/{employeeId}` (still present in `firestore.rules`, see
  §4); `functions/scripts/provisionEmployeeAccess.js` (trusted provisioning writer, not read this
  pass in full).
- **Classification:** FIREBASE-SPECIFIC / LEGACY TO RETIRE once the PostgreSQL Employee authority
  (§1.4) is the sole writer and reader for Employee identity.
- **UNKNOWN / NEEDS DECISION:** whether `employees/{employeeId}` Firestore documents remain the
  writer for any Employee field not yet covered by the PostgreSQL migrations in §6, or whether
  every Employee field now has a PostgreSQL equivalent. Not determined this pass -- needs an
  explicit field-by-field reconciliation before Firestore Employee write paths are retired.

### 1.4 Employee/Principal linkage (PostgreSQL) -- already built

- **What:** `functions/migrations/1758412800000_employee-principal-linkage.sql` establishes the
  Employee<->Principal link in PostgreSQL, ahead of Authorization v2 being scoped. Read at the
  server via `functions/src/eosWorkforce/reads/employeePrincipalLinkRead.ts` (EMP-RT-02,
  `admin.principalAccess.read`).
- **Classification:** TARGET POSTGRESQL FOUNDATION. See §6 for the full Employee/Workforce
  inventory.

---

## 2. Session

### 2.1 Firebase ID token as the transitional bearer

- **What:** every trusted-API call (Admin Policy, Operations, Commercial, Workforce) is
  authenticated by a bearer ID token, verified server-side by an injected `TokenVerifier`
  (`functions/src/eosWorkforce/workforceHttp.ts:48`, `VerifiedIdentity { externalSubject,
  identityProvider }`). The concrete verifier composed in `server.ts` today verifies a Firebase ID
  token (not read this pass to confirm the exact verifier wiring file -- flagged for a follow-up
  read, not asserted here).
- **What is NOT session state:** there is no separate EOS-owned session record, expiry, or
  revocation table found this pass. `principalContext.ts` resolves fresh from PostgreSQL on every
  call (Principal status + tenant membership + Role assignments), so a *disabling* action (disable
  Principal, remove membership) takes effect on the next call without any session-invalidation step
  -- there is no session to invalidate because there is no session, only a per-request token
  verification. This is stronger than a cached session in one sense (no stale grant) and weaker in
  another (no `EOS Session` record for administrators to list/revoke, no "log this device out").
- **Classification:** FIREBASE-SPECIFIC (the token itself) wrapping a CURRENT SECURITY AUTHORITY
  (`resolvePrincipalContext` / `resolveOperationalContext`, which is already PostgreSQL-backed).
- **Roadmap alignment:** matches `full-platform-roadmap-reconciliation.md` §6.1 "**EOS Session** |
  TARGET / GAP | Current authentication tokens can enter system. | First-class EOS server session,
  expiry/revocation, session admin... | 20%".

### 2.2 Client-side `AuthContext` state

- **What:** `field-ops-app-vite/src/auth/AuthContext.jsx` holds `{ user, role, employeeId,
  displayName, operationalRoles, employmentStatus }` in React state, re-resolved on every
  `onAuthStateChanged` event via `resolveEmployeeSession()` (in the sibling `employeeSession.js`,
  not read this pass). This is the ONLY place the client interprets "who am I / what role" from
  Firestore documents (`users/{uid}` + linked Employee) -- explicit in the file's own comments (line
  12-22) that this design is deliberate ("AuthContext's existing one-shot `users/{uid}` role-loading
  read is preserved unchanged").
- **What it explicitly does NOT do:** on any read failure it clears role/employeeId/displayName/
  operationalRoles/employmentStatus to their empty defaults rather than falling back to a default
  role (line 100-120) -- a defensible current pattern, but it means client-side "am I signed in with
  a role" and server-side "does this Principal have this capability" are two independently
  maintained interpretations of the same underlying Firestore/PostgreSQL facts.
- **Classification:** FIREBASE-SPECIFIC / PAGE-LOCAL AUTHORITY in the sense that this state gates
  what the UI shows, but per Authorization v2's rule 8 ("UI visibility is user experience, never the
  security boundary") it must not be read as proof that the server enforces the same thing --
  confirmed true today (see §3 -- server-side enforcement is a separate, PostgreSQL-backed path).

---

## 3. Authorization / Roles / Permissions

This is the area with the most volume and the most overlapping generations. Three materially
different mechanisms coexist on `main` today.

### 3.1 Firestore Rules `userRole()` (oldest generation)

- **What:** `firestore.rules` (both copies, see §7) defines `userRole()` (line 18) reading
  `users/{uid}.role`, and gates most collections with `isAdmin()` (line 32-33: `userRole() ==
  "admin"`), `isTechnician()` (line 36-37), `isAdminOrDispatcher()` (line 22-23: `role == "admin" ||
  role == "dispatcher"`), `isOwnTechnician(technicianId)` (line 40-41), plus more granular
  predicates further down the file (`isActiveOperationalRole`, `isAssignedToWarehouse`,
  `reciprocallyLinkedEmployee`, `linkedEmployeeId`/`linkedEmployeeData`, etc. -- 60+ named
  `function`s total; `grep -c "^    function" firestore.rules` = 60).
- **Classification:** CURRENT SECURITY AUTHORITY (this is what actually runs at the database layer
  for every remaining Firestore-authoritative collection) and FIREBASE-SPECIFIC. Explicitly named as
  the thing to remove in `2026-09-16-authorization-v2-application-platform-reset.md` Firebase exit
  list ("`firestore.rules` business authority and legacy role predicates").
- **Important nuance found this pass:** this file mixes two different jobs that Authorization v2
  wants to separate -- coarse role gating (`isAdmin`, `isTechnician`) AND fine-grained *business
  validation* (`accountGovernedFieldsValid`, `equipmentTransitionAllowed`,
  `equipmentLocationBelongsToAccount`, `hasCanonicalReorderRequestKeys`,
  `isValidJobTransition`/`isTechnicianJobTransition`, line ~222-1500). The business-validation half
  is largely **BUSINESS FACT TO PRESERVE** semantics (state-machine and shape rules that must not be
  silently dropped), while the role-gating half is **CURRENT SECURITY AUTHORITY / FIREBASE-SPECIFIC**
  slated for replacement. A migration that treats the whole file as "just auth, delete it" would lose
  real business rules -- flagged here, not resolved.

### 3.2 PostgreSQL Admin Policy / capability engine (already built, parallel generation)

- **What:** `functions/src/adminPolicy/` contains a substantial, already-governed PostgreSQL
  authorization engine: `principalContext.ts` (§1.2), `effectiveObjectAccess.ts`
  (`loadPrincipalPolicy` -- qualifying Role resolution), `policyRepository.ts` /
  `postgresPolicyRepository.ts` (the PolicyReader abstraction over PostgreSQL),
  `administrationAuthority.ts`, `policyCommands.ts`, `workflowEngine.ts` /
  `workflowCommands.ts` / `workflowSeeds.ts`, `tenantBootstrap.ts`, `adminPolicyApi.ts` /
  `adminPolicyHttp.ts` (the HTTP transport, modeled identically to `workforceHttp.ts`).
- **What it is:** a working `Principal -> Role(s) -> capabilities` evaluator against PostgreSQL,
  reused verbatim by Operations (`eosOps/capabilityAuthority.ts`), Commercial, and Workforce
  (`eosWorkforce/workforceHttp.ts`) transports (confirmed: workforceHttp.ts imports
  `resolveOperationalContext` from `../eosOps/capabilityAuthority` and `PrincipalContextError` from
  `../adminPolicy/principalContext`). This is real, exercised, multi-domain infrastructure -- not a
  design document.
- **Classification:** TARGET POSTGRESQL FOUNDATION -- this is very likely the single largest
  head-start Authorization v2 has, because it already implements Identity->Principal,
  Principal->Role->capability, tenant/membership boundary, and a shared evaluator reused by 3+
  domain transports. It does not yet implement the full RESOURCE+ACTION+SCOPE+FIELD contract the
  roadmap specifies (`policy-reset.md` §"Permission contract") -- that gap is real and is Authorization
  v2's remaining work, not a finding that this foundation is wrong.
- **Roadmap alignment:** matches `full-platform-roadmap-reconciliation.md` §4 "Authorization |
  Existing Admin Policy/capability architecture + compatibility layers | ... | 45%" -- this census
  confirms that description at the code level.

### 3.3 Frontend `access/` compatibility + capability layer (9,500+ lines, multiple generations)

- **What:** `field-ops-app-vite/src/access/` is a large (9,524 total lines across 38 files)
  client-side access-interpretation layer, including:
  - `compatibilityRoles.ts` (360 lines) -- explicitly a **GENERATED FILE** ("GENERATED FILE -- DO
    NOT EDIT... mechanically synchronized by `scripts/syncAccessContracts.mjs`") encoding the
    admin/dispatcher/technician compatibility Roles from Issue #226 (Enterprise Access &
    Administration). Its own header states current effect precisely: "`admin`/`dispatcher`/
    `technician` keep authorizing exactly as they do today via `users/{uid}.role` until a later,
    separately-authorized row activates the Permission engine" -- i.e. this file is a *parity
    oracle*, not yet a live authority.
  - `governedBusinessRoles.ts` (1,738 lines), `permissionCatalog.ts` (1,719 lines) -- large
    Permission/Role catalogs.
  - `resolveEffectivePermission.ts` (329 lines), `legacyAuthorizationSurface.ts` (281 lines),
    `parityFixtures.ts` (931 lines), `shadowParityHarness.ts` (95 lines) -- names that describe a
    shadow-mode comparison/parity-proving apparatus between the legacy Firestore-role authority and
    a newer capability model, run entirely client-side.
  - Dozens of narrower per-domain "capability access" modules (`opportunityCapabilityAccess.js`,
    `salesOrderCapabilityAccess.js`, `reportCapabilityAccess.js`, `equipmentInstallCapabilityAccess.js`,
    `serializedAssetAcquireCapabilityAccess.js`, `workOrderPartsPlanCapabilityAccess.js`, etc.) --
    each one is a page/domain-specific interpretation of access, which is the exact "page/domain
    interprets Role" pattern the Authorization v2 doc condemns by name ("What is condemned...
    page/domain-specific authorization interpretation").
- **Classification:** COMPATIBILITY LAYER (the bulk of this directory, by design and by its own
  header comments) with a PAGE-LOCAL AUTHORITY sub-pattern (the many per-domain capability-access
  modules) still present. This is not read as a defect of past work -- it is exactly the kind of
  shadow-parity scaffolding a careful incremental migration produces -- but it is a large surface
  that Authorization v2's "one server authorization engine" principle will supersede, and per the
  roadmap's Firebase-exit list it should be removed only after the v2 evaluator is proven, not
  deleted pre-emptively.
- **UNKNOWN / NEEDS DECISION:** this pass did not fully trace which of the 38 files in `access/` are
  (a) still live and consulted by rendered pages today vs. (b) parity/shadow-mode-only and already
  dead weight. That determination needs a per-file "who imports this" pass before any deletion
  decision, and is out of scope for Lane 0.

### 3.4 `ROLES` constant + raw role checks in application code

- **What:** `field-ops-app-vite/src/App.jsx` still branches directly on the raw
  `role`/`ROLES.ADMIN`/`ROLES.DISPATCHER` string from `AuthContext` in several places (e.g. line
  226-252: `DashboardIndex({ role, ... })`, `role === "technician"`; `TruckInventoryConnected`,
  `canManage = role === ROLES.ADMIN || role === ROLES.DISPATCHER`). A comment at App.jsx:158
  explicitly documents the intended discipline: "a raw role must never confer a governed capability
  (the W1 correction)" -- i.e. the codebase already has an internal rule that raw-role checks are for
  UI branching only, capability checks are supposed to go through the governed layer in §3.2/§3.3.
  Whether every such usage in `App.jsx` and elsewhere actually honors that rule, versus a raw role
  check silently gating something that should be server-enforced, was not exhaustively verified this
  pass.
- **Classification:** PAGE-LOCAL AUTHORITY (by construction -- it is UI branching), explicitly
  self-documented in-repo as *not* a security boundary. Real risk is only where a raw role check
  substitutes for a missing server-side enforcement; not confirmed present or absent this pass.

---

## 4. Route / API Guards

- **No dedicated `ProtectedRoute`/`RequireAuth`/route-guard component was found.** Search for
  `route|guard` filenames under `field-ops-app-vite/src` returned only
  `domain/reorderRequestCancelGuard.js` (a business-rule guard, not an auth guard),
  `navigation/objectRoutes.js`, and `routerBasename.js` -- none of these are access-control route
  guards. Route-level gating appears to live inline in `App.jsx`'s render functions (role-conditioned
  component selection, §3.4) rather than as a wrapping guard component.
- **API-side guard pattern:** every trusted-API transport (`adminPolicyHttp.ts`, `eosOpsHttp.ts`,
  `workforceHttp.ts`, presumably a Commercial equivalent) follows one shared shape: parse envelope ->
  verify bearer -> `resolveOperationalContext`/`resolvePrincipalContext` -> dispatch to a closed
  operation list -> map errors to HTTP status by category (`STATUS_BY_CATEGORY` in
  `workforceHttp.ts:96-103`). This is a real, consistent, already-governed API-middleware pattern --
  arguably the strongest asset for Authorization v2's "one server authorization engine" (§5.4
  below repeats this as target foundation).
- **Classification:** the API-transport pattern is TARGET POSTGRESQL FOUNDATION. The absence of a
  client route guard is UNKNOWN / NEEDS DECISION -- not itself a security gap (server independently
  enforces per the pattern above, consistent with Authorization v2 rule 8), but worth an explicit
  design decision for Authorization v2's client architecture rather than silently continuing "no
  route guard, inline role branching in render functions."

---

## 5. Business Responsibility fields (owner / accountable / assignedTo / operatingCompany)

### 5.1 PostgreSQL Ownership Matrix -- already governed

- **What:** `functions/src/ownership/ownershipMatrix.ts` (not fully read this pass; header read in
  full) declares, per business-record family, an explicit `ownerClass` (PERSON / COMPANY / REFERENCE
  / EXCLUDED), `ownerFields`, `inheritanceSource`, `transfer` (HANDOFF / IMMUTABLE / N_A), and
  `companyScope` (SINGLE_COMPANY / CROSS_COMPANY_CAPABLE / COMPANY_NEUTRAL). This is reconciled
  against a measured sandbox census with named Owner rulings D-8...D-16 (2026-08-30).
- **Backing migration:** `functions/migrations/1758844800000_commercial-ownership-authority.sql`
  establishes `owner_employee_id` (NOT NULL, no default -- "every record has an owner" is ruling
  D-1/D-8, deliberately not nullable and deliberately not defaulted so an owner is never fabricated)
  for the Opportunity/Sales Agreement/Sales Order families, and distinguishes `owner_employee_id`
  from `created_by` (owner may be reassigned/inherited from the Account; creator is immutable
  provenance).
- **`operatingCompanyId` / `isNationalAccount`:** per user's own standing memory note, these are
  explicitly NOT the same axis (`operatingCompanyId` = Taylor vs. Ventana; `isNationalAccount` =
  national-account commercial classification). 153 files reference `operatingCompanyId` repo-wide;
  the ownership migration's `companyScopeField: operatingCompanyId` confirms it is a governed,
  named field on these commercial families, not an inferred value -- consistent with the parity
  fence's rule "operating company... is an authored/governed fact and must not be inferred."
- **Territory is explicitly excluded from ownership** by the same migration's own commentary
  (`ownershipMatrix.ts:452`, "coverage is not ownership, credit, commission or security") -- matches
  the user's existing memory note on Commercial Coverage & Territory.
- **Classification:** BUSINESS FACT TO PRESERVE, and simultaneously TARGET POSTGRESQL FOUNDATION --
  this is exactly the "Record -> Owner / Accountable / Assignee / Approver / Operating Company"
  model Authorization v2 specifies as a *separate* axis from security authorization, and it already
  exists, governed, in PostgreSQL for the Commercial families. Per the roadmap (§6.1 "Owner /
  Accountable Person -- OPERATIONAL / PARTIAL -- 70%"), it is not yet applied to every major record
  family (Work Order assignment, in particular, is still Firestore-era -- see §5.2).

### 5.2 Work Order assignment -- still Firestore-era, explicitly unserved in PostgreSQL

- **What:** `functions/src/eosWorkforce/workforceHttp.ts` header explicitly documents: "EMP-RT-05
  `listAssignedWorkForEmployee` NOT SERVED -- `ASSIGNMENT_AUTHORITY_NOT_IN_POSTGRES` (held, Owner
  ruling H)." This matches `full-platform-roadmap-reconciliation.md` §6.1 ("Employee Work Assignment
  -- DESIGNED / GAP -- 20%") and §8.3 ("Work Order assignment authority and Employee-keyed assignment
  history" listed under "Major domains still blocked on new canonical PostgreSQL authority").
- **Classification:** BUSINESS FACT TO PRESERVE (assignedTechId / scheduled-tech semantics as they
  exist today in Firestore) currently living entirely in FIREBASE-SPECIFIC storage, with an
  explicit, already-recorded Owner ruling (ruling H) that it is held pending PostgreSQL authority.
  Not a new finding -- confirms PR #1915 (Work Order assignment census, referenced in the
  reconciliation doc) as the correct input, not something this Lane 0 pass should re-derive.

---

## 6. Existing PostgreSQL foundations -- Employee / Workforce directory (the PR #1919/#1920 asset)

This is the single most relevant existing asset for "prove the Authorization v2 pattern on a
lower-coupling domain first" (parallel-cutover-strategy.md Lane B: "Workforce reads... Principal/
Employee/User-access administration").

- **Migrations:**
  - `functions/migrations/1758412800000_employee-principal-linkage.sql` -- Employee<->Principal link.
  - `functions/migrations/1759104000000_employee-business-authority.sql` -- Employee business fields.
  - `functions/migrations/1759838400000_employee-profile-and-reporting-authority.sql` -- profile +
    manager/reporting-relationship authority.
  - `functions/migrations/deferred/1759190400000_employee-principal-link-employee-fk.sql` --
    deferred (not yet applied); a foreign-key hardening step held back deliberately, not an
    oversight (name and `deferred/` location both signal this).
- **Server-side (Render/EOS API), `functions/src/eosWorkforce/`:**
  - `workforceHttp.ts` (transport, read in full -- §1.2/§3.2/§5.2 above).
  - `reads/employeeReadKernel.ts`, `employeeDirectoryReads.ts` (`readEmployee`, `listEmployees`),
    `employeePrincipalLinkRead.ts` (EMP-RT-02), `employeeResponsibilityReads.ts`
    (`listRecordsOwnedByEmployee`, `listAccountabilitiesForEmployee` -- gated per-family by that
    family's own read capability, i.e. composes with §5.1's ownership authority rather than
    duplicating it), `myEmployeeProfile.ts` (EMP-RT-07, self-read), `employeeRecordProjection.ts`.
  - `commands/reportingRelationshipCommands.ts` -- the one writer found in this domain (internal,
    not exposed over the read-only HTTP surface).
  - `migration/employeeCapabilityGrants.ts`, `employeeProfileCutover.ts`,
    `employeeProfileSnapshot.ts` -- one-time cutover/migration tooling, distinct from runtime code
    (consistent with the roadmap's repeated warning not to conflate "migration tooling exists" with
    "migration executed").
- **Client-side (Vercel), `field-ops-app-vite/src/`:**
  - `services/workforceApiClient.js` -- the browser's only route to Employee data (read in full;
    §browser comment: "and never browser -> Firestore for Employee business data, with no fallback
    of any kind"). Reuses the existing Admin Policy API client's base URL and ID-token plumbing
    (`services/adminPolicyApiClient.js`) rather than inventing a second auth scheme.
  - `hooks/useWorkforceEmployeeDirectory.js`, `hooks/useWorkforceRead.js`.
  - `domain/employeeOperatingProfile.js` -- `employeeDirectoryPresentation`, a pure projection to
    (name, Employee ID, employment status, job title, operating company); commit `d0eb725c`'s own
    message is explicit that the read "returns none of" account status, Security Role, Job Role, or
    uid -- i.e. the current directory read is intentionally narrow and does NOT yet expose
    Authorization v2's Security Role / Job Role axes.
  - `modules/administration/AdminUsers.jsx` -- now sourced from this governed read (PR #1919/#1920,
    commit `d0eb725c`), replacing a prior `employee.index` Firestore metadata-list read. The
    `employee.index` entity registry definition itself is explicitly retained ("stays: the entity
    registry and several suites still reference it") -- i.e. not yet fully retired, still referenced
    elsewhere.
- **What is NOT yet built here (explicit gaps, not assumptions):** governed Employee
  create/update writer (roadmap §6.1: "Governed Employee create/update writer" remains), Job Role
  authority (EMP-RT-08 "NOT IMPLEMENTED -- no governed Job Role authority (standing ruling)"),
  assigned-work read (EMP-RT-05, §5.2 above).
- **Classification:** TARGET POSTGRESQL FOUNDATION -- and, per the mission brief and the roadmap's
  own Lane B guidance, the strongest existing candidate to prove the Authorization v2 pattern on
  before touching Work Order/Parts/Inventory/Truck.

---

## 7. Firebase surface area still active

- **`firestore.rules`:** two copies, `firestore.rules` (repo root) and
  `field-ops-app-vite/firestore.rules`, confirmed byte-identical this pass (`diff` -- no output),
  1,876 lines each. Per the user's own standing memory note ("Emulator rules-source gotcha"), the
  emulator reads whichever copy is in the CWD's branch, so dual-copy parity is a known operational
  hazard, not a new finding -- flagged here as still true on this baseline.
- **`firebase-admin` imports:** 186 files under `functions/src` (see §1.1). This is far broader than
  identity/session -- it includes ordinary Firestore business reads/writes across most domains not
  yet cut over to PostgreSQL/Render, per the roadmap's business-object inventory (§6 of the
  reconciliation doc).
- **`firebase/auth` (client) imports:** exactly 1 file, `AuthContext.jsx` (see §1.1/§2.2) -- the
  client-side Firebase Auth surface is small and centralized, which is favorable for the identity
  cutover (Phase C of the Authorization v2 sequence) relative to the much larger Firestore
  business-data surface.
- **Render already exists as infrastructure, non-production only:** `render.yaml` (repo root)
  declares `eos-policy-nonprod` (PostgreSQL, `basic-256mb`, `postgresMajorVersion: "16"`) and
  `eos-api-nonprod` (Node web service). The file's own comments state it is enforced in-process
  ("the service REFUSES TO START if [`EOS_ENVIRONMENT`] is ever set to production") and that there
  is deliberately no production blueprint in this repository. This is infrastructure Authorization
  v2's Lane A/Lane B work can extend rather than create from nothing.
- **Classification:** the Firestore business-data surface (186-file `firebase-admin` footprint) is
  FIREBASE-SPECIFIC / LEGACY TO RETIRE at the pace each owning domain is cut over; it is explicitly
  NOT something this Lane 0 census recommends touching (per the mission brief's protected-domain and
  no-code-edit constraints). The Render/PostgreSQL policy infrastructure is TARGET POSTGRESQL
  FOUNDATION, already deployed to nonprod.

---

## 8. Items not traced to a confident classification this pass

Recorded rather than guessed, per the mission's stop-condition instruction.

1. **Exact `TokenVerifier` composition for the trusted APIs** (which file wires a concrete Firebase
   ID-token verifier into `adminPolicyHttp`/`eosOpsHttp`/`workforceHttp`) was not located and read
   this pass. Needed to confirm precisely where the Firebase Auth dependency enters the Render API
   boundary, for Phase C (identity gateway) planning.
2. **Whether the Firestore `employees/{employeeId}` write path (§1.3) and the PostgreSQL Employee
   migrations (§6) currently disagree on which fields are authoritative** was not exhaustively
   reconciled field-by-field. Flagged as UNKNOWN / NEEDS DECISION in §1.3.
3. **Live/dead status of the 38 files under `field-ops-app-vite/src/access/`** (§3.3) -- which are
   still imported by rendered pages vs. parity-harness-only -- was not traced file-by-file. Flagged
   as UNKNOWN / NEEDS DECISION in §3.3.
4. **Commercial transport equivalent of `workforceHttp.ts`/`eosOpsHttp.ts`** was referenced by name
   (`commercialHttp.ts`, cited in `workforceHttp.ts`'s own header comment as the model it was built
   from) but not located/read this pass; it almost certainly exists under `functions/src/` and
   should be included in a Lane-1 authority census, not assumed identical to Workforce/Operations
   without reading it.
