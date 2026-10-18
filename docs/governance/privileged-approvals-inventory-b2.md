# Privileged role approvals: reachability proof and disposition (Firebase exit B2, PA-1)

**Issued:** 2026-10-18 (America/Phoenix) · base `f6d96048` · repository evidence only (no live system was read; what only a live read can answer is named as the cutover blocker).
**Rules applied.** Owner decision 3 (preserve and replace any mechanism a live workflow uses; retire only on proof) and the Owner's PA-1 ruling: *"Zero pending approvals is necessary but not sufficient for retirement. Supersede the legacy mechanism only after proving no reachable workflow or required control still depends on it. Replace any live dependency. If unresolved, preserve it and report the specific cutover blocker."*
**Approval behaviour is unchanged by this document or its PR.** Nothing here replaces a dependency, because the proof below finds no live product dependency to replace.

## 1. The mechanism (Firebase)

Two Roles are **privileged** in the Firebase role store: `admin` (`functions/src/access/compatibilityRoles.ts:256`) and `owner` (`functions/src/access/governedBusinessRoles.ts:1272`). Changing who holds them (grant or revoke) needs approval:

| Server path | Rule (file:line in `functions/src/access/trustedWriterCommands.ts`) |
|---|---|
| `grantRole` | a privileged Role needs `approverUid`, distinct from actor and target; no self-grant; the approver must currently hold `admin.roleAssignment.write` through a privileged Role (`:801-815`, `verifyApproverIsPrivileged` `:455-470`) |
| `revokeRole` | same, for removal; no self-revocation (`:1783-1790`) |
| `assignApprovedRole` | refuses a privileged Role outright (`:1853-1856`) |
| `requestPrivilegedRole` → `decidePrivilegedRoleRequest` | the request/approve queue: the approver is the authenticated caller; target cannot approve; fingerprint tamper check; decided once; authority re-resolved at decision (`:1315-1400`, `:1573-1700`); `requiredApprovals = 1` (Owner decision 2026-08-22) |
| `listPrivilegedRoleRequests` | reads the queue under the same authority (`:1505`) |

Every other Role is single-actor (`assignApprovedRole`). The store these write is Firestore `roleAssignments`, which is **not** an EOS authority source: PostgreSQL is.

## 2. Every caller (exhaustive search of `field-ops-app-vite`, `functions/src`, `functions/scripts`, `scripts`, `integrations`, `.github`)

| Caller | Evidence | Reached when |
|---|---|---|
| Roles & Permissions › Approval requests (`list`, `decide`) | `modules/administration/ApprovalRequests.jsx:96,118`, mounted at `AdminRolesPermissions.jsx:430` | Firebase-sign-in builds. In the EOS-only build it renders a "not available" state and calls nothing (B2). |
| My Dashboard `adminDecisions` card (`listPending`) | `modules/dashboard/MyDashboard.jsx:432` | Only where the session source is Firebase. Where EOS is the session source the landing is `MyWorkspace` (`App.jsx:270-274`), so it is not mounted on nonprod today. |
| `requestPrivilegedRole` (create) | **no client, no script, no test fixture outside `trustedWriterCommands.test.mjs`** | Only by a direct invocation of the deployed callable. Nothing in the product creates a request. |
| `grantRole` / `revokeRole` with `approverUid` | no browser caller (the client wrappers were unused and are removed); operator CLI `functions/scripts/operatorAccessCommand.js:171-186` (Owner-confirmation phrase, dry-run default, `--projectId` named); Certification world `functions/scripts/certificationWorld/applyRoleGrants.mjs` (frozen world) | Operator-run, against the Firebase project they name. Unaffected by the EOS-only build. |
| `roleAssignmentCensusCli.js` | read only | The instrument for the pending count. |

No other reference exists (the tests, the equivalence record and the audit-action union only name them).

## 3. Which changes REQUIRE approval, and whether the EOS-only build enforces an equivalent control

The changes that need approval in Firebase are exactly: **grant `owner`**, **grant `admin`**, **revoke `owner`**, **revoke `admin`**. On EOS (PostgreSQL), in `functions/src/adminPolicy/policyCommands.ts` (`assignRole` `:993`, `revokeRole` `:1409`):

| Change | EOS control (file:line) | Compared with the Firebase rule |
|---|---|---|
| Grant `owner` | **Refused for every ordinary actor, whoever the target:** `refuseProtectedOwnerMembership(role, "assign")` `:1010` → `:2003-2009` ("the protected Owner is not appointed through ordinary role administration; admin.roleAssignment.write, admin.securityPolicy.write and admin.administratorRole.assign are all insufficient") | **Stricter** than a second approver: no approver can make it happen. |
| Revoke `owner` | `refuseProtectedOwnerMembership(…, "revoke")` `:1433`; last-Owner invariant `refuseIfLastProtectedOwner` `:1432`, `:2016-2020` (`LAST_PROTECTED_OWNER`) | **Stricter.** |
| Grant `admin` | (1) caller needs `admin.roleAssignment.write` (`requireSecurityAdministrationCapability` `:998`; holders Owner, General Manager, Admin: `administrationAuthority.ts:41-45`). (2) **Staffing authority** for a Role carrying `admin.securityPolicy.write`: only the Owner (R1), an Administrator with standing (DECISIONS #223), or a holder of `admin.securityPolicy.write` (`authorizeSecurityPolicyStaffing` `:1337-1388`, re-decided under the governance lock `:1053`). (3) **No self-assignment**: `:1019-1021` and `:1350-1353`, `:1377-1380`. (4) Owner and Administrator distinct: `refuseProtectedRoleConflict` `:1031`, `:1055`, `:1313-1319`. (5) Stated reason (Administration API sets `requireStatedReason`, `:999`), one audit event recording the staffing authority (`:1081-1083`). (6) The grant-impact preview, mandatory when `ADMIN_PREVIEW_MANDATORY` is on. | **Different in kind, ruled by the Owner.** EOS has **no second approving act**; it has a narrow, named, audited staffing authority that cannot be the grantee. DECISIONS #223 (Owner, final, 2026-10-09): *"Owner appoints and revokes Administrators. … An Administrator with standing appoints and revokes OTHER Administrators … one tier."* `administrationAuthority.ts:15-24` records the earlier Owner ruling that the old two-person route for privileged assignment is superseded. |
| Revoke `admin` | `:1442` (`authorizeSecurityPolicyStaffing(…, "revoke")`), self-removal refused `:1350-1353`, last-administering-assignment guard `:1445-1450` (`LAST_ADMINISTERING_ASSIGNMENT`) | Same as grant. |

Tests that pin these: `protectedOwnerInvariantPostgres`, `administratorStaffingPostgres`, `protectedAdministratorManagementPostgres`, `adminAdministrabilityProofPostgres`, `ownerExclusionLockPostgres`, `authorityPreviewMandatoryPostgres`.

**Does any EOS server path refuse a privileged change for lack of an approval?** No: EOS refuses by authority (above), never by a missing approver. **Does any Firebase server path refuse without one?** Yes, the four rows in section 1 (`:801-815`, `:1783-1790`, `:1853-1856`, `:1648`) — and they remain in force wherever the Firebase role store is the authority (production, and any Firebase-sign-in build).

## 4. Conclusion, per item

| # | Item | Conclusion |
|---|---|---|
| 1 | Two-person rule for **granting `owner`** | **Superseded by** `policyCommands.ts:1010` + `:2003-2009` (the protected Owner is not appointed through ordinary administration: stricter than approval). |
| 2 | Two-person rule for **revoking `owner`** | **Superseded by** `policyCommands.ts:1432-1433` + `:2016-2020` (stricter; last-Owner invariant). |
| 3 | Two-person rule for **granting / revoking `admin`** | **Superseded by** the Owner's ruling (DECISIONS #223; `administrationAuthority.ts:15-24`) enforced at `policyCommands.ts:1027,1053` (`authorizeSecurityPolicyStaffing` `:1337-1388`), `:1019-1021` (no self-assignment), `:1031` (Owner/Admin distinct). **Stated plainly: this is not a second-approver act.** If the Owner wants a second approving act on EOS after all, that is a build, not a retirement (see item 9). |
| 4 | `requestPrivilegedRole` (creating a request) | **Superseded — nothing to replace.** No product caller or script creates requests (section 2); it is reachable only by direct callable invocation. |
| 5 | `listPrivilegedRoleRequests` / `decidePrivilegedRoleRequest` and the Approval requests screen | **Preserved in every Firebase-sign-in build (including production); unreachable in the EOS-only build.** No workflow *requires* the queue: the grant paths in rows 1-3 do not depend on it. Not retired. |
| 6 | My Dashboard `adminDecisions` card | **Not mounted where EOS is the session source** (`App.jsx:270-274`). Preserved with the Firebase-source dashboard. Not retired. |
| 7 | Operator CLI `operatorAccessCommand.js` (`grantRole`/`revokeRole` with `approverUid`) and the Certification world applier | **Preserved, outside the cutover.** Operator-run against the Firebase project they name; unchanged. |
| 8 | **Pending and historical requests in Firestore `privilegedRoleRequests`** | **Unresolved: cutover blocker (exact):** the repository cannot show how many requests are `PENDING_APPROVAL`. The operator's read-only census (`functions/scripts/roleAssignmentCensusCli.js`, `privilegedRoleRequests.pendingApproval`) must read **0** before the sign-in switch (runbook step 1). Zero is necessary, not sufficient: sufficiency is rows 1-7 (above). Decided requests are history and are **kept** (nothing is deleted or migrated). |
| 9 | Whether the Owner requires a second approving act for granting `admin` on EOS | **Not a blocker for this cutover** (item 3 is ruled by #223). It is the one open choice that would change behaviour: *build an EOS request/decide queue*, or leave item 3 as ruled. Until the Owner says otherwise, behaviour is unchanged. |
| 10 | Whether the approval callables are deployed in the production Firebase project | **Unprovable from the repository** (`accessCommandCallables.ts` header says "NOT deployed to the production project"; no deploy record is in the tree). Operator confirms with a functions list. Not a blocker for the nonprod cutover; it decides whether the production Approval requests screen can work at all. |

**The cutover blocker, exactly: row 8 — the census must show `privilegedRoleRequests.pendingApproval = 0`.** Nothing else in the inventory blocks the nonprod EOS-only sign-in.

## 5. What B2 changed about this mechanism

Only the browser surface in the EOS-only build: the Approval requests screen states that the queue is unavailable and that "nothing here means none are pending". The server callables, the Firestore store, the operator CLI, every Firebase-sign-in build and production are untouched.
