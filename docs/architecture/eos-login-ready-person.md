# Make a person login-ready — design note (Owner decision D5)

Status: DESIGN ONLY. Written under lane A13, 2026-11-14, at base `8e7c798a`. No code, no capability, no grant, no migration and no
deploy comes with this note. Tier: protected (identity and authorization model); building it needs its own authorization.

Owner ruling D5 (2026-11-13), verbatim: "Design and build a governed, audited, Administrator-only operation that makes a person
login-ready (Principal, membership, login account). Hand-over is by setup code until D6 (email provider) is decided. Exact
capability and grant holders need Owner confirmation before activation. No grant is implied." Related: D7 (two-step verification
required for every new account, shipped in #2235), D8 (real employees get a fresh Administrator-issued EOS enrollment; no Firebase
Auth migration).

## 1. The gap (measured at this head)

- `EosLoginService.provisionLoginAccount` (`functions/src/eosAuth/eosLoginService.ts`) needs a Principal that already exists, is
  active, is an active member of the actor's tenant, has exactly one linked Employee (`requireEmployeeLink`, via
  `getLinkedEmployeeAccessFact`) and holds no active `eos` identity binding. It creates the binding, the `login_accounts` row
  (`pending_enrollment`, `mfa_required = TRUE`) and a one-time enrollment ticket (`issueTicket`), all in one `this.tx`.
- Nothing governed creates the Principal, its membership and the Employee link together with the login. The pieces exist separately:
  `createEmployee` (`eosWorkforce/commands/employeeCreationCommand.ts`: creates the Employee only, and says so), `linkEmployeePrincipal`
  (`eosWorkforce/commands/employeePrincipalLinkCommands.ts`: links an existing Principal), `ensureTenantPrincipal`
  (`adminPolicy/tenantBootstrap.ts`: creates a Principal and membership, but opens its OWN transaction through `repo.transact`, so it
  cannot join a caller's), and `establishLink` (`employeeIdentity/employeePrincipalLinkRepository.ts`: accepts a caller's `PoolClient`).
- The only path that strings them together is operator tooling: `functions/scripts/enrollPersonaLogins.js --employees` ->
  `enrollEmployeeLogin`, nonprod, `np-taylor-*` / `synthetic-np-emp-*` Employees only, `.invalid` addresses, operator-supplied password
  and authenticator secret. A new hire cannot be made able to sign in from the application.
- The Employee page already shows the state: `describeUserAccessRelationship` (`field-ops-app-vite/src/domain/employeeOperatingProfile.js`)
  returns "No User Access" for an unlinked Employee, rendered by `EmployeeProfileSections.jsx`; `UserDetail.jsx` mounts
  `EmployeeLoginAccount.jsx`, which holds the existing "Create sign-in" control.

## 2. The operation

**Name: `makePersonLoginReady`.** An Administration operation in the closed table `LOGIN_ADMINISTRATION_OPERATIONS`, served on
`/admin/policy` and dispatched in `createLoginAdministration` (mutation = true). It is the existing "Create sign-in" extended backward over
the Principal / membership / link steps. It is NOT a second provisioning path.

### Input options

| Option | Input | Verdict |
|---|---|---|
| A | An EXISTING Employee with no active link (`employeeId`, `loginIdentifier`, `reason`) | **Recommended** |
| B | Create the Employee too (A plus `employmentStatus`, `operatingCompanyId`, profile) | Rejected |
| C | Principal-first (an existing Principal with no Employee) | Rejected |

Why A: `createEmployee` already exists, is gated on `admin.employeeProfile.write`, requires the two facts nobody may infer
(`employment_status`, `operating_company_id`) and states that creating an Employee creates no authority. Folding it in (B) would let one new
capability invent an Employee, bundle two authorities and copy the Employee validation. The Employee record is the business fact that comes
first; this operation only adds "can sign in". The UI chains the two steps on one page (Employee created, then "Make login-ready").
C is what `provisionLoginAccount` already does, and it cannot reach a person with no Principal.

Input: `{ employeeId, loginIdentifier, reason }`. Never `principalId` (it is in `workforceHttp.AUTHORITY_BEARING_FIELDS` for a reason, and this
operation mints the Principal). `mfaRequired: false` is refused before any I/O, as `provisionLoginAccount` does (D7). `loginIdentifier` goes
through `normalizeLoginIdentifier`; when the Employee has a `work_email` it must equal it (as `enrollEmployeeLogin` requires); otherwise the
Administrator states it (decision 4).

### Output

Same shape as `provisionLoginAccount`, plus the ids: `{ accountId, principalId, employeeId, loginIdentifier, status: "pending_enrollment",
subject, mfaRequired: true, enrollmentTicket, enrollmentTicketExpiresAt }`. The ticket is shown ONCE, never stored readably, never logged,
never in audit. Reissue stays `reissueLoginEnrollment`. The holder then follows the existing enrollment flow (set a password, enroll an
authenticator).

## 3. Server steps (one transaction)

A new method on `EosLoginService` next to `provisionLoginAccount`. The shared tail of `provisionLoginAccount` (binding, `bumpAccessVersion`,
`login_accounts` insert, `issueTicket`, audit) is extracted into one private helper that both methods call, so there is a single provisioning
path. Writes go through `makeTransaction(c, ...)` (`policyTx`) and `establishLink(c, ...)` on the same `PoolClient`.

Pre-checks (no lock, fail fast; every one is repeated under the lock):

1. Capability gate (section 4), then reason (1-500 characters) and `employeeId` shape.
2. Environment: any environment the login service runs in. `enrollEmployeeLogin`'s nonprod and `.invalid` fences do NOT apply (this is the
   real-person path), but the operation is dark everywhere until the key is granted.

Transaction (`this.tx`):

3. Locks, in this fixed order: (a) `SELECT ... FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2 FOR UPDATE` (the pattern in
   `employeeCommandKernel.ts`); (b) `pg_advisory_xact_lock(hashtext('eos-login-ready:<tenantId>:<employeeId>'))`. Login-identifier races
   are settled by the existing unique indexes on `login_accounts` (23505 -> CONFLICT), as in `provisionLoginAccount`.
4. Re-read and refuse by name (all `LoginRefusal`, nothing written yet):
   - `NOT_FOUND`: no such Employee in the actor's tenant (a foreign Employee looks identical to a missing one).
   - `EMPLOYEE_NOT_ELIGIBLE`: status not in `ACCESS_ELIGIBLE_EMPLOYMENT_STATUSES` (`employmentAccessEligibility.ts`: ACTIVE, CONTRACTOR).
     Deliberately narrower than `ENROLLABLE_EMPLOYMENT_STATUSES` (which admits ON_LEAVE): a new login for someone who resolves no context is no use.
   - `EMPLOYEE_SEPARATED`: `separation_date` is not null.
   - `ALREADY_LINKED`: an active `employee_principal_links` row exists for the Employee (`readActiveLinkForEmployee`). A linked Employee is the
     business of `provisionLoginAccount`; the UI routes there. This also covers "already has an identity".
   - `LOGIN_RETIRED`: a retired login exists for the identifier (the guard `enrollEmployeeLogin` applies); a retired login is never silently re-created.
   - `CONFLICT`: identifier in use (`accountByIdentifier`).
   - Owner / Administrator targets and multi-tenant Principals: not reachable for a brand-new Principal (it holds no Role and one membership). They are
     proved by assertion in tests (section 8), not by runtime branches. If an implementation ever lets a Role ride along, `holdsProtectedAdministeringRoleIn`
     must refuse with `PROTECTED_TARGET`.
5. Writes, using existing calls:
   - Principal: `policyTx.createPrincipal({ identityProvider, externalSubject, displayName: null })`. The Principal needs a primary
     `(identity_provider, external_subject)` that is unique and can never authenticate. THIS DOES NOT EXIST TODAY for real people (the operator tool
     only uses the synthetic `eos-synthetic-nonprod` alias). Proposal: provider `eos-provisioned`, subject `principal.<uuid>`; to be confirmed that no
     resolver or CHECK treats an unknown provider specially (decision 6). The additional `eos` identity (`user.<hex>`) is the one that signs in, bound by
     `createPrincipalIdentityBinding`, exactly as `provisionLoginAccount` does. The display name stays null (`setPrincipalDisplayName` rule: never email,
     never Employee).
   - Membership: `policyTx.createTenantMembership(principalId)` (active).
   - Link: `establishLink(c, { tenantId, principalId, employeeId, operatingCompanyId (read from the Employee row), linkSource: "OPERATOR_ASSERTED",
     assertedBy: actor.uid, assertionReason: reason })`. `OPERATOR_ASSERTED` is the existing term for "a named human stated it, with a reason".
     `EmployeePrincipalLinkConflict` maps to `CONFLICT`.
   - Then the shared tail: binding, `bumpAccessVersion`, `login_accounts` insert (`pending_enrollment`, `mfa_required = TRUE`),
     `issueTicket(c, accountId, "enrollment", actor.uid, reason)`.
6. Audit and security event in the same transaction (section 5). Any throw rolls back every row: no Principal without a login, no link without a
   membership, no ticket without an account.

Idempotency: NOT idempotent by design, like `createEmployee` and `provisionLoginAccount`. A repeat call refuses `ALREADY_LINKED` (the first call linked
the Employee). A mid-way failure leaves nothing. A lost setup code is recovered with `reissueLoginEnrollment` on the created account; the UI says so.

What it never does: assign a Role, scope, Job Role or capability; set a password; derive a display name from the Employee; touch Firebase; reset or
replace an existing login.

## 4. Authority

New capability key: **`admin.loginReadyPerson.provision`** (proposed name; the Owner may rename before registration).

"Inactive until confirmed" uses the pattern already proven by `commercial.recordCompany.assign` (migration
`1764719000000_commercial-record-company-assign.sql`, DECISIONS #CLC): register the key as a `BUSINESS_ACTION` and grant it to nobody.
`protectedAdministrator.ts` implies only `ADMIN_ACTION` and `READ` keys plus nine named management actions, so a `BUSINESS_ACTION` is held by NO ONE,
the protected Administrator and Owner included, until the Owner grants it through the existing Administration grant paths (previewed and committed like
any authority change). That is the enforcement: not a server flag, not a role default. Until then the operation exists in the table but every call is
`FORBIDDEN`. The registering migration is a separate controller-written file; this lane writes none. A server switch is not proposed: a second
off-switch beside the grant would be two truths.

The call is double-gated: the new key AND the existing `admin.roleAssignment.write` check that `requireSecurityAdministrationCapability(repo, actor,
"assignRole")` applies (it binds an identity, like `provisionLoginAccount`). A holder of the new key alone can do nothing. The actor must be an active
Principal in the tenant; the new Principal is created in the ACTOR's tenant only. The honest consequence of the double gate: "Administrator-only" is met
today because only admin and owner hold `admin.roleAssignment.write`, and the new key then narrows further.

Candidate holders (an Owner decision, NOT a grant; nothing is written by this work):
1. Administrator Role only (matches D5 "Administrator-only"; recommended starting point).
2. Administrator and Owner Roles.
3. A named person (direct Principal grant) rather than a Role.
4. A new narrow "Onboarding Administrator" Role (more rows and more review; not recommended for the first release).

## 5. Audit

All in the same transaction. None contains the setup code, a password, an authenticator secret or any token.
- `makePersonLoginReady` (one `appendAudit`, `targetKind: "loginAccount"`, `targetId: accountId`): `before: null`, `after: { employeeId, principalId,
  membershipCreated: true, linkId, linkSource: "OPERATOR_ASSERTED", loginIdentifier, bindingId, subject, mfaRequired: true, enrollmentTicketId,
  ticketExpiresAt }`, plus `reason`, `actorUid`, `occurredAt`.
- `tenant.addPrincipal` (as `ensureTenantPrincipal` writes it, with the reason) and the link's own assertion fields (`asserted_by`,
  `assertion_reason`), so existing reads of those facts stay true. Whether to also write a `provisionLoginAccount` row for existing audit queries is
  decision 7.
- A security event `makePersonLoginReady` (success, or refused with the `LoginRefusal` reason code) through `this.event`.

## 6. UI

- Where: the Employee record (`/administration/users/:employeeId`), in the User Access section that renders `describeUserAccessRelationship`. Today an
  unlinked Employee shows "No User Access" and an explanatory sentence only.
- Control: a "Make login-ready" button there, shown only when the Employee is unlinked AND the server's per-operation access map (the #MAP pattern: the
  browser asks the server's own requirement and decides nothing) says the caller may. While the key is ungranted the control is absent for everyone.
- Form: login name (prefilled with the Employee's work email when present) and a required reason. Copy: "Creates this person's sign-in. They set a
  password and an authenticator the first time they sign in. Roles are not given by this step."
- Result: the same one-time setup code panel `EmployeeLoginAccount.jsx` uses for "Create sign-in": shown once, copy button, expiry time, "cannot be shown
  again; issue a new one from Sign-in if it is lost". After closing, the page re-reads and shows "Waiting for first sign-in setup" (`STATUS_WORDS`).
- Refusals appear as the server worded them. Roles stay in the separate Roles panel under its own capability.
- One new call in `field-ops-app-vite/src/services/adminPolicyApiClient.js` and one entry in `LOGIN_ACTION_DONE_WORDS` ("Sign-in created. Assign Roles
  separately.").

## 7. SYSTEM_AUTHORITIES.md once built

In the login-account / EOS identity row: creation of a real person's Principal, membership and Employee link in the same act as the login belongs to
`makePersonLoginReady` (`EosLoginService`) under `admin.loginReadyPerson.provision` plus `admin.roleAssignment.write`; the new Principal's primary alias
provider is `eos-provisioned`; the key is a BUSINESS_ACTION registered with no grant. Operator tooling `enrollEmployeeLogin` stays nonprod / sample only,
unchanged. Also one row in the `docs/architecture/eos-native-identity.md` 3(d) table, and a DECISIONS entry.

## 8. Test plan (when built)

Postgres suites (the `*Postgres.test.mjs` convention), registered in `functions/test/adminPolicySuites.json` and `.github/ci/eos-admin-policy-paths.txt`:
- Happy path: new Principal (active, alias `eos-provisioned`), active membership, active `OPERATOR_ASSERTED` link, `eos` binding, `login_accounts`
  `pending_enrollment` with `mfa_required`, ticket redeemable once, audit and event rows present and secret-free (the ticket string is absent from every row).
- Gate: FORBIDDEN with `admin.roleAssignment.write` but not the new key; FORBIDDEN with the key but not `roleAssignment.write`; FORBIDDEN for the protected
  Administrator and Owner while the key is ungranted (the "inactive" proof); allowed after a test-only grant.
- Refusals, each leaving ZERO rows in principals, memberships, links, bindings, accounts and tickets: unknown or foreign-tenant Employee; INACTIVE /
  TERMINATED / ON_LEAVE / RETIRED; separation date set; already linked (including revoked-then-relinked history); Employee whose linked Principal already
  has an `eos` identity; identifier in use; retired login for the identifier; `mfaRequired: false`; missing or over-long reason; `principalId` in the body.
- Authority: the new Principal has no `user_role_assignments`, no direct grants, no scope; principal resolution yields no capability until a Role is assigned.
- Atomicity: inject a failure at each write (membership, link, binding, account, ticket, audit) and assert full rollback.
- Concurrency: two simultaneous calls for one Employee give one success and one refusal; two Employees racing one login identifier give one success and one
  CONFLICT; a concurrent `linkEmployeePrincipal` on the same Employee cannot produce two links.
- Session: first login after enrollment completes through the existing paths with the MFA-required behaviour from #2235.
- Unit: operation-table pin (count and mutation flag), access-map entry, client panel test (control hidden without the key, code shown once).

## 9. Open decisions for the Owner

1. **Input shape.** Existing Employee only (A), or one combined "create the person" act (B)? Recommend A: Employee first through `createEmployee`, then this.
2. **Capability name and kind.** `admin.loginReadyPerson.provision` as a `BUSINESS_ACTION` registered with no grants (the #CLC pattern). Recommend yes.
3. **Holders.** Administrator only, Administrator and Owner, a named person, or a new Role (section 4). Recommend Administrator only, granted separately after build.
4. **Login name.** Must equal the Employee's `work_email` (recommended, as the operator path requires), or free text the Administrator types when the
   Employee has no work email.
5. **Eligible statuses.** ACTIVE and CONTRACTOR (recommended), or also ON_LEAVE (the operator path allows it, but that person cannot sign in yet).
6. **Primary alias for a new Principal.** Provider `eos-provisioned`, subject `principal.<uuid>`, non-authenticating (recommended; verify no resolver
   special-cases providers), versus reusing the `user.<hex>` subject as the primary identity with provider `eos`.
7. **Audit shape.** One `makePersonLoginReady` event (recommended), versus also writing a separate `provisionLoginAccount` row for existing audit queries.
8. **Hand-over.** Setup code shown once on screen and handed over in person or by phone until D6 is decided (as ruled). Confirm the Administrator is the
   only party who ever sees it.
9. **First real use.** Whether production use waits for a nonprod exercise with a synthetic Employee and the normal operator-run promotion (recommended:
   yes; this note authorizes no deploy).

## 10. Out of scope

Email invitations and any provider (D6); bulk or CSV onboarding; Firebase Authentication migration or import (D8); assigning Roles, scopes, Job Roles or
Work Eligibility; creating the Employee record; changing `enrollEmployeeLogin` or the persona tooling; moving an existing link; registering or granting the
capability (a separate controller-written migration and an Owner-confirmed grant).
