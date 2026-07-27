# AUTH-PR-4 — Governed operator workflow (build/test gate)

> **STATUS: repository build + emulator/non-production test ONLY.** This workflow
> **cannot** mutate production identities: a write against the `taylor-parts`
> project is refused by the script itself. Production execution is a **separate,
> not-yet-granted** Owner Production Identity-Mutation Authorization gate — see
> [`docs/deployment/auth-pr-4-readiness-authorization-package.md`](../deployment/auth-pr-4-readiness-authorization-package.md)
> §11/§12. This document authorizes no production action.

## What it is

[`functions/scripts/authPr4RecoveryEmailMigration.js`](../../functions/scripts/authPr4RecoveryEmailMigration.js)
— a single, guard-railed operator command that migrates **one** test persona's
Firebase Auth recovery/auth email to an Owner-supplied Gmail `+alias`, one
identity at a time, with exact rollback. It implements the "governed operator
workflow" the readiness package §4 (Execution model) requires.

It only ever calls `auth.getUser` / `auth.getUserByEmail` (reads) and a single
`auth.updateUser({ email, emailVerified })` (the migration write). It **never**
calls `sendPasswordResetEmail`, `generatePasswordResetLink`, or
`revokeRefreshTokens`, and never touches Firestore, roles, claims, `accessVersion`,
passwords, or UIDs.

## Guards (all enforced before any SDK write)

| Guard | Behavior |
|---|---|
| Dry-run default | No write unless `--execute` (forward) or `--rollback` is passed. |
| Exact project guard | `--projectId` required; `taylor-parts` additionally requires matching `--confirmProduction taylor-parts`. |
| Production-write block | `--execute`/`--rollback` against `taylor-parts` **throws** — this build is dry-run-only against production, execute-only against non-production. |
| Ordered-persona guard | Target must equal the persona at `--position` in the fixed order; excluded personas (`emp-rudy-sales-manager`, break-glass) rejected; `emp-rudy-owner` (last) requires `--breakGlassVerified` + `--confirmLowerRiskComplete`. |
| Protected out-of-band input | Persona→`{uid,newAlias}` read from `--mappingFile` (Owner-supplied, never committed). |
| One at a time | Exactly one persona per invocation. |
| Fail closed | Disabled / missing / UID-mismatch / alias-collision → **halt** (never skip, never enable). |
| Exact rollback | Preflight captures the exact prior address + prior `emailVerified`; forward always writes `emailVerified=false`; rollback restores the captured exact address + boolean; a prior `true` is never applied to the new alias; if the exact prior address is no longer unclaimed, rollback halts. |
| Sanitized evidence | Booleans / patterns / salted-hash refs only — never a real address, UID, or address-linked prior-verified value. |
| Secret cleanup | The captured-prior temp file (for rollback) is written under the OS temp dir (`0600`) and unlinked in `finally` and on `SIGINT`. |

Migration order (readiness §4): `emp-rudy-driver` (1) → `emp-rudy-parts-associate`
(2) → `emp-rudy-warehouse-manager` (3) → `emp-rudy-parts-manager` (4) →
`emp-rudy-owner` (5, primary admin, last).

## Running the tests

Pure-helper layer (no emulator — guards, plans, sanitization):

```bash
cd functions && npm run test:authPr4Migration
```

Pure + Auth-emulator layer (forward execute, exact rollback, disabled/collision
halts, dry-run no-write — all against a `demo-*` non-production project):

```bash
cd functions && firebase emulators:exec --only auth --project demo-authpr4 "node test/authPr4RecoveryEmailMigration.test.mjs"
```

## Example (dry-run plan, emulator project — no write)

```bash
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  node functions/scripts/authPr4RecoveryEmailMigration.js \
  --projectId demo-authpr4 --employeeId emp-rudy-driver --position 1 \
  --mappingFile /secure/out-of-band/mapping.json
```

`--execute` performs the write **only** against a non-production project. There is
no runnable production path in this build.

## Not authorized by this build

Production execution · Firebase Auth email/identity mutation · reset/verification
email delivery · explicit session revocation · AUTH-PR-3 deployment · email-provider
configuration · Firestore/role/claim/`accessVersion` mutation · use or commitment of
real emails, UIDs, tokens, passwords, or credentials. Enabling production execution
is a separate PR under a separate Owner authorization (readiness §11).
