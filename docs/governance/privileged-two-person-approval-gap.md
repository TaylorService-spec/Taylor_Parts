# Privileged two-person approval — architecture gap

> **SUPERSEDED 2026-08-22 by Owner decision.** Taylor has **one** human security approver, operating
> the `admin` principal. Two-person approval is **not** required and was never Taylor policy — this
> document assumed it, and the assumption was wrong.
>
> **Current Taylor policy: `AUTHENTICATED ADMIN APPROVAL REQUIRED`, `requiredApprovals = 1`.**
>
> The *defect* this document identified was real and is now fixed: approval identity came from
> request-body data, and `someone supplied the Admin UID` is not `the authenticated Admin approved
> this`. That is corrected by `requestPrivilegedRole` + `decidePrivilegedRoleRequest`, where the
> approver is `request.auth.uid` and no parameter can assert one.
>
> §4's multi-approver design is retained below as **future enterprise policy**, clearly separated
> from what Taylor operates today. `requiredApprovals` is stored per request so raising it is a
> policy change, not an architecture change.

**Status:** `RESOLVED` — superseded by `AUTHENTICATED_ADMIN_APPROVAL` · **Date:** 2026-08-22
**Blocks:** `cw-emp-000 → owner` (the last of the 83 certification grants)

The instruction was to initiate a privileged request as one principal, stop, and let a second
authenticated principal approve it. **That flow does not exist in this platform**, and this document
records exactly what does exist, what does not, and what would have to be built.

I did not initiate anything, because there is nothing to initiate into.

---

## 1 — What the platform enforces today

`grantRole` is a **single authenticated call** that carries a second principal's UID as a parameter:

```
grantRole({ actorUid, principalUid, roleId, scope, approverUid, idempotencyKey })
```

For a privileged Role it refuses unless **all** of these hold
(`functions/src/access/trustedWriterCommands.ts`):

| Check | Enforced |
|---|---|
| actor holds `admin.roleAssignment.write` at global scope | yes |
| an `approverUid` is supplied at all | yes |
| `approverUid !== actorUid` (no self-approval) | yes |
| `approverUid !== principalUid` (target cannot approve own elevation) | yes |
| actor is not granting a privileged Role to themselves | yes |
| approver **currently** resolves `admin.roleAssignment.write` through the same fail-closed resolver | yes |
| approver's qualifying assignment is itself a **privileged** Role | yes |
| approver's assignment shape, scope and `accessVersion` are valid | yes |

That is a real control. It defeats a lone non-privileged actor, defeats self-approval, and defeats a
malformed or narrowly-scoped approver assignment. It is well covered by
`functions/test/trustedWriterCommands.test.mjs`, including the `owner`-specific case where the target
is named as its own approver.

## 2 — What it does not enforce

**The approver never authenticates.** `approverUid` arrives as a **string in the request body** of one
authenticated call. `verifyApproverIsPrivileged()` resolves that UID's *stored* permissions; nothing
verifies that the human behind it was present, consented, or did anything at all.

So the control today is:

> one authenticated principal, naming a second privileged principal

not:

> two distinct principals performing two distinct authenticated actions

The instruction was explicit that the difference matters — *"merely supplying a different UID string is
insufficient"* — and it is right. A single compromised or mistaken privileged session can currently
mint a privileged Role by naming any other privileged UID, without that person's involvement.

## 3 — Why the existing `accessRequests` collection is not the missing flow

There is an `accessRequests` collection with `approveAccessRequest` / `rejectAccessRequest`
callables, and it looks at first glance like the two-action flow. It is not, for two independent
reasons:

**There is no way to create a request.** No `createAccessRequest`, `requestAccess` or
`submitAccessRequest` exists anywhere in `functions/src`, and `firestore.rules` denies the collection
outright:

```
match /accessRequests/{requestId} {
  allow read, write: if false;
}
```

Nothing — no client, no trusted command — can put a request into `pending`.

**Approval grants nothing.** `approveAccessRequest` updates exactly three fields on the request
document:

```js
txn.update(requestRef, { status, decidedBy, decidedAt })
```

It writes no role assignment, bumps no `accessVersion`, syncs no claims. Approving a request — if one
could exist — would record a decision and confer no authority.

What the collection *does* have is the right **decision semantics**, already correct and tested: an
actor may not decide their own request, a decision may be made only once, and a non-pending request is
refused. That half is worth keeping.

## 4 — What would have to be built

A genuine two-action privileged grant, reusing what already works rather than replacing it:

**`requestPrivilegedRole`** — a new trusted command, callable by a principal holding
`admin.roleAssignment.write`. Writes an `accessRequests` document with `status: "pending"` carrying
target principal UID, `roleId`, `scope`, `requestedBy`, `requestedAt`, an idempotency key, and an
expiry. Grants nothing.

**`approveAccessRequest`** — extended so that on approval it performs the grant **inside the same
transaction**, through the existing `grantRole` authority, with `actorUid` = the approver and
`approverUid` = the original requester. The two-person rule is then satisfied by two real
authenticated sessions rather than by one caller naming the other.

**Rebind-proof approval.** The approval must re-verify that target, `roleId` and `scope` are
byte-identical to what was requested. Approving a request whose contents changed after review is
approving something nobody read.

**Fail-closed additions**, each mirroring a check that already exists elsewhere: request must still be
`pending`; must not be expired; approver must be distinct from both requester and target; approver's
privileged authority re-resolved **at approval time**, not at request time.

### MFA / step-up compatibility (required by the instruction)

The approval is a **separate authenticated action**, which is what makes step-up possible later. Two
things must be true of the design now so MFA can be added without redesign:

- authority is re-resolved **at approval time** from the approver's live session, never carried
  forward from the request;
- the approval record carries an **auth-context** field — sign-in time, and later AMR / ACR or an
  equivalent assurance claim — so a future rule of the form *"approval requires re-authentication
  within N minutes"* is a check added to existing data, not a schema migration.

Nothing here requires MFA to be implemented now. It requires only that approval is not modelled as a
flag the requester can set.

## 5 — What I did not do, and why

I did not initiate the request: there is no governed creation path, so any "request" I produced would
have been a direct Firestore write to a deny-all collection — precisely the bypass the instruction
forbids.

I did not call `grantRole` with `approverUid: admin@sandbox.invalid`: that is one authenticated action
supplying two UID strings. It would have produced a real, audited, correct-looking `owner` assignment
and **proved nothing about two-person control** — which is the one thing this exercise exists to test.

I did not authenticate as `admin@sandbox.invalid`. The credential is in the sandbox file and would
have worked, and using it would have been one agent simulating two humans.

## 6 — Current state

`cw-emp-000 → owner` remains **`PENDING_PRIVILEGED_APPROVAL`**, ungranted.

`ACCESS_ADMINISTRATION` remains owner-only and correctly reported as
`PENDING_PRIVILEGED_APPROVAL` rather than `NO_COVERAGE` — the difference between "nobody can" and
"one approval away" is the distinction that matters, and today it is neither: it is
"the approval mechanism does not exist yet".

---

## Owner decisions required

1. **Build the two-action flow** (`requestPrivilegedRole` + grant-on-approval), then complete this
   grant through it — the only path that proves the control.
2. **Or** accept the current single-call control for sandbox, stating explicitly that
   `approverUid`-as-parameter is the accepted standard for now — in which case the grant can proceed
   immediately, and the certification claim must say *"approver named, not authenticated"* rather
   than *"two-person approval proven"*.

I recommend (1). The exercise was designed to test the control architecture, and (2) certifies a
control the platform does not yet have.
