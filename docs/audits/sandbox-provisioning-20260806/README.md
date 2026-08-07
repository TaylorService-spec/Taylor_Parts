# Sandbox provisioning — execution record (2026-08-06)

**Authorization:** Owner, A-1 through A-8. **A-9 explicitly HELD** and not performed.
**Package:** [`../../deployment/sandbox-o1-o2-authorization-package.md`](../../deployment/sandbox-o1-o2-authorization-package.md)
**Deployed revision:** `5dcd574`

## Result

| Action | Result |
|---|---|
| **A-1** create project | ✅ `eos-platform-sandbox`, number `33669510651`, ACTIVE |
| **A-2** link billing | ✅ `014857-036ECF-0FB27E` — the **same** account as production, so cost stays in one view |
| **A-3** enable services | ✅ Firestore, Functions, Firebase, Identity Toolkit, Hosting, Cloud Build, Artifact Registry, Run, Eventarc — **plus** `projects:addfirebase` (see finding F-1) |
| **A-4** Firestore database | ✅ `(default)`, Native, STANDARD, `us-central1` |
| **A-5** Rules + indexes | ✅ Rules released; **6/6** indexes deployed. O-4 drift guard: `NON_DESTRUCTIVE` |
| **A-6** Functions | ✅ **35** deployed |
| **A-7** personas | ❌ **BLOCKED** — see finding F-3 |
| **A-8** frontend | ✅ live at **https://eos-platform-sandbox.web.app** |
| **A-9** guard widening | ⛔ **HELD** — not performed |

## Verification

**D1:** `https://eos-platform-sandbox.web.app/version.json` →
`{"commit":"5dcd574","base":"/","environmentId":"platform-sandbox","environmentRole":"sandbox","schema":2}`

**D2:** `platform-sandbox` → **MATCH** (`5dcd574 == expected`). It moved from `NOT_OBSERVABLE` to a real verdict **with no code change**, which is the payoff for sequencing D1/D2 before the environment.

## Isolation proof

- **Bundle level:** the sandbox build contains **1** occurrence of `eos-platform-sandbox` and **0** occurrences of `taylor-parts`.
- **Estate level:** production remained at **22** Functions throughout.
- **Database level:** production `describe` is unchanged — delete protection ENABLED, PITR ENABLED — verified before and after every step.
- **Deliberate asymmetry confirmed on sandbox:** `DELETE_PROTECTION_DISABLED`, `POINT_IN_TIME_RECOVERY_DISABLED`, `versionRetentionPeriod: 3600s`, no backup schedules. The sandbox is meant to be disposable.

## Findings

### F-1 — enabling the Firebase API is not the same as adding Firebase to the project
A-6 first failed with `HTTP 404 ... /adminSdkConfig ... Requested entity was not found`. Enabling `firebase.googleapis.com` does **not** make a GCP project a *Firebase* project; `firebase projects:addfirebase` is a separate step. Treated as completing A-3 (enable required services), not as working around a failure. **Add it to the rebuild automation.**

### F-2 — the sandbox has 13 Functions production has never had
Sandbox **35** vs production **22**. The extra 13 are exactly the estate that Issue #226 Rows 19/20 never deployed:

`grantRole` · `revokeRole` · `setUserStatus` · `approveAccessRequest` · `rejectAccessRequest` · `assignApprovedRole` · `initiateAdminPasswordReset` · `listResetEligibleUsers` · `createSupplier` · `updateSupplier` · `activateSupplier` · `deactivateSupplier` · `deleteTruckCreatedInErrorCallable`

Production-only functions: **none** — the sandbox is a strict superset.

**This is significant for R-1.** The Enterprise Access mutation backend that Rows 23–26 are blocked behind now *exists somewhere it can be exercised*. It does **not** unblock the production cutover (still Owner-gated), but domain-cutover work can now be validated against a real deployed trusted backend instead of only an emulator.

It also means **sandbox ≠ production in estate**, which must be stated in any review conducted there.

### F-3 — A-7 BLOCKED: Firebase Authentication is not initialized
`getAuth().listUsers()` against the sandbox returns **`auth/configuration-not-found`**. Enabling the `identitytoolkit.googleapis.com` **API** (done in A-3) does not *initialize* Authentication or enable a sign-in provider.

**Minimal next action:** initialize Firebase Auth on `eos-platform-sandbox` and enable the **Email/Password** provider (Firebase Console → Authentication → Get started, or the Identity Toolkit admin config API). Persona seeding then proceeds via the governed `provisionEmployeeAccess.js` path.

Per the standing instruction, this dependency chain was **stopped rather than worked around**. No service-account key was created; ADC was used for the probe only.

### F-4 — Artifact Registry cleanup policy set
The predicted non-zero cost line item. A 1-day image-retention policy is now active on `gcf-artifacts`, so container images cannot accumulate.

## Not performed

No production mutation of any kind. No `warehouseBackupCodec` change (A-9 held). No service-account key created. No production data copied.
