# Privileged role approvals: inventory and disposition (Firebase exit B2, Owner decision 3)

**Issued:** 2026-10-17 (America/Phoenix) · base `96f1f82d` · repo evidence only (no live system was read).
**Rule applied (Owner decision 3):** preserve and replace any approval mechanism a live workflow uses; retire it only with proof of **no reachable callers, no pending approvals and no required control**. Recent non-use alone is not proof.

## 1. The mechanism

A **privileged Role** (`admin`, `owner` in the Firebase catalog) cannot be granted by one call. The sequence is:

1. `requestPrivilegedRole` (callable) writes a `privilegedRoleRequests/{idempotencyKey}` document, status `PENDING_APPROVAL`, `requiredApprovals: 1`, and a request fingerprint. It grants nothing. The caller must hold `admin.roleAssignment.write` at global scope.
2. `decidePrivilegedRoleRequest` (callable) is called by the **authenticated** approver (`request.auth.uid`; no parameter can assert an approver). It re-verifies the fingerprint, refuses the target approving their own elevation, re-resolves `admin.roleAssignment.write` at decision time, decides once, and on APPROVE grants the Role into the Firestore `roleAssignments` store in the same command.
3. `listPrivilegedRoleRequests` (callable) reads the queue under the same authority.

Taylor policy is `requiredApprovals = 1` (Owner decision 2026-08-22, `privileged-two-person-approval-gap.md`): the control is "proposal is not the authenticated approval", not a headcount.

## 2. Every reachable caller (repository evidence)

| Caller | Where | Reached when |
|---|---|---|
| `ApprovalRequests.jsx` (`listAll`, `decide`) | Administration › Roles & Permissions | Firebase-sign-in builds. **In an EOS-only sign-in build it renders a "not available" state and calls nothing** (this PR). |
| `MyDashboard.jsx` `adminDecisions` card (`listPending`) | legacy My Dashboard | Only where the session source is Firebase. Not mounted where EOS is the session source (`EOS_SESSION_SOURCE`), so it is not reached on nonprod today and not in an EOS-only build. |
| `requestPrivilegedRole` | **no client, no script** | Only by a direct invocation of the deployed callable by an authorised Firebase caller. Nothing in the product creates a request. |
| `roleAssignmentCensusCli.js` | operator, read only | Counts requests by status (`privilegedRoleRequests.pendingApproval`). It is the instrument for the "no pending approvals" proof. |

The three server callables stay deployed and **untouched** by this PR (callable retirement is a separately gated, operator-run step).

## 3. The required business control, and where it lives on EOS

| Question | Finding |
|---|---|
| Is a two-person or approver step a **required** control on EOS (PostgreSQL) role assignment? | No. `adminPolicy/administrationAuthority.ts` and `policyCommands.ts#assignRole` record: *role ASSIGNMENT is Owner, General Manager or Admin; the old two-person privileged route is superseded by that Owner ruling.* |
| What controls privileged grants on EOS instead? | The protected Owner is never appointed or removed through ordinary role administration (`refuseProtectedOwnerMembership`, `LAST_PROTECTED_OWNER`); Owner and Administrator are distinct authority types (#223); Administrator appointment and removal need the Owner or the protected Administrator (ruling R1); an Owner holder may never reach an excluded capability (ruling A); every assignment is audited with a stated reason; the grant-impact preview can be mandatory. |
| Does the Firebase queue confer EOS authority? | No. It writes the Firestore `roleAssignments` store, which is not an EOS authority source; PostgreSQL is. |

## 4. Disposition

| Part | Disposition |
|---|---|
| The Firebase mechanism (callables, queue, screen) | **PRESERVED unchanged** in every Firebase-sign-in build, including production. Not retired. |
| EOS-only sign-in build | The screen states plainly that the queue is unavailable and that **nothing here means none are pending**. No empty list is ever shown. |
| An EOS replacement (a request/decide queue over PostgreSQL) | **Not built.** It would be an optional ceremony in front of an `assignRole` that does not require it, contradicting the recorded Owner ruling. Named below as decision PA-1. |
| Retirement of the callables, the screen and the store | **HELD** until all three proofs hold. The first two are met by section 2 once the cutover is done; the third needs the live census. |

## 5. The proof still owed before retirement (operator, read only)

1. **No pending approvals:** run `functions/scripts/roleAssignmentCensusCli.js` read-only against the sandbox Firebase project and record `privilegedRoleRequests.pendingApproval`. **The cutover runbook gates the sign-in switch on this number being 0**; any pending request is decided in a Firebase-sign-in build first (or rejected), then re-counted.
2. **No reachable callers:** after the cutover, the Firebase verifier on the EOS API is off and no EOS-only bundle can call the callables; direct invocation by a Firebase caller remains possible until the callables are undeployed (operator step, separately authorised).
3. **No required control:** section 3. If the Owner decides the approval step is a required control on EOS after all, PA-1 applies.

## 6. Named decision for the Owner

**PA-1.** Record the Firebase privileged-approval queue as **SUPERSEDED by the PostgreSQL assignment authority** once the census shows 0 pending (recommended), or require an EOS request/decide queue for granting `owner` / `admin`. Until decided, the mechanism is preserved and the cutover is gated on the census.
