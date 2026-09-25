# Residual Firebase Surface Ledger

**Created 2026-09-25 under Owner instruction (Steps 6–9, RESIDUAL FIREBASE SURFACE).**

This file did not previously exist. `zero-Firebase runtime/repository proof` appears in
`docs/roadmaps/CURRENT.md` as a roadmap **stage**, and `legacyConsumerLedger.ts` is the
legacy `operationalRoles` retirement ledger — mechanically checked in both directions
against files that name the legacy fields, so a Firebase callable does not belong in it
and adding one there would fail its companion suite. No artifact held this record, so
this one was created rather than dropping the instruction.

Nothing in this ledger counts as evidence for governed Principal access.

## Classifications

`ACTIVE_CALLER` · `ORPHANED_COMPATIBILITY_SURFACE` · `TEST_ONLY` · `UNKNOWN`

## Entries

### `readPrincipalAccessState` — **ACTIVE_CALLER**

Measured 2026-09-25 against merge `11668e53`.

A Firebase Functions callable, defined at `functions/src/access/accessCommandCallables.ts:294`
(`onCall`) and exported from `functions/src/index.ts:166`. It is **not** one of the 13
`ADMIN_READ_OPERATIONS` on the Render EOS API; probed live, `POST /admin/policy` with this
operation returns `404 UNKNOWN_OPERATION`.

Reachable from the live frontend by a mounted route, not merely referenced:

| link | evidence |
|---|---|
| transport | `field-ops-app-vite/src/access/administrationUsersClient.js:37` — `PRINCIPAL_ACCESS_CALLABLE = "readPrincipalAccessState"`, invoked at `:161` via `httpsCallable(functions, …)` |
| caller | `field-ops-app-vite/src/modules/administration/UserAccessActions.jsx:183` — `.readPrincipalAccessState({ principalUid: targetUid })` |
| mount | `UserDetail.jsx:454` renders `<UserAccessActions …>` |
| route | `App.jsx:80` lazy-imports `UserDetail`; `App.jsx:1107` mounts it as a route `element` |

So the classification is `ACTIVE_CALLER`: Administration → Users → User detail → User access
actions reaches it in the current frontend. It is not orphaned and not test-only, though it is
also covered by `functions/test/readPrincipalAccessState.test.mjs` and three frontend suites.

**This is NOT Permission Preview.** Permission Preview's canonical authority is
`getPrincipalEffectiveAccess`, which IS one of the 13 governed Administration reads and answers
`401 UNAUTHENTICATED` unauthenticated. The two surfaces answer different questions: this callable
reports an **auth account's** existence, enabled/disabled status and role assignments, which is
why it takes a `principalUid` and why it still lives on Firebase — it reads Firebase Auth state
that PostgreSQL is not the authority for.

**Retiring it therefore requires Firebase Auth retirement, not just a capability registration.**
Per `CURRENT.md` that stage precedes the zero-Firebase runtime/repository proof. Not altered in
Step 6 by instruction.

Sibling callables on the same client seam, recorded here because they share its fate and were
observed while measuring: `setUserStatus`, `assignApprovedRole`, `revokeRole`,
`listRecordChangeHistory`. Their individual classification has not been measured and is
deliberately left `UNKNOWN` rather than assumed to match.
