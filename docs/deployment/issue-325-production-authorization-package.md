# Issue #325 — Production Authorization Package

**Status: SUPERSEDED; CORRECTED AFTER THE 2026-07-20 PRODUCTION TEST AND ROLLBACK.**
The authorized deployment was attempted from later commit `d5f2172`, then rolled
back in full after scenario 3 exposed the verification-contract error corrected
below. Production currently has none of the package's Functions and its prior
Rules were restored. See `docs/DECISIONS.md` entry #35.
No production write, credential access, role assignment, or claims change has been
performed to produce this document. Every command below is presented for Owner
review and is not to be executed by an AI session under this package alone — each
deploy step requires its own explicit, scoped Owner Deployment Authorization,
matching this repo's established pattern (`docs/DECISIONS.md` entries #26, #28, #30).

| | |
|---|---|
| Firebase project | `taylor-parts` |
| Region | `us-central1` |
| Target commit | `cd81cdd2579e78f3acc21637029d5086e85e0062` (`origin/main`, confirmed current HEAD at package preparation time) |
| Prepared | 2026-07-20 |
| Prepared by | INVENTORY workstream, this session |

---

## 1. Read-only inventory of what is live now

| Surface | Live state | How confirmed |
|---|---|---|
| Cloud Functions | **Zero functions deployed** to `taylor-parts` | `firebase functions:list --project taylor-parts` → `No functions found in project taylor-parts.` (read-only CLI call, already-authenticated developer session, no deploy) |
| Firestore database | Exists, `FIRESTORE_NATIVE`, `us-central1`, created `2026-07-02T07:41:03Z` | `firebase firestore:databases:get --project taylor-parts` (read-only) |
| Firestore Rules content | **Cannot be read by this session.** No safe, read-only path exists in this environment — `firebase-tools` has no `firestore:rules:get`-style command, and this environment has no Application Default Credentials for a read-only Admin SDK call (`getSecurityRules().getFirestoreRuleset()`). This is a pre-existing, repeatedly-documented environment limitation (`docs/DECISIONS.md` entries #9, #10, #20, #200), not something skipped for this package. | See §2 for the best-available substitute: the repo's own deployment decision log. |
| Frontend (Hosting/GitHub Pages) | Live, out of scope for this package — deploys automatically on every push to `main` via `.github/workflows/deploy-field-ops.yml`, independent of Rules/Functions | `docs/Deployment.md` §1; not part of this authorization request |

**Consequence for this package:** every statement below about "what Rules are live"
is derived from the repo's own deployment decision log (`docs/DECISIONS.md`), not
from an independent live read. §7's verification matrix and §9's stop conditions
exist specifically to catch any drift between that record and actual live behavior
before this deploys.

---

## 2. Last known deployed Rules commit (from the repo's own decision log)

The most recent Firestore Rules deploy recorded anywhere in this repository
(`docs/DECISIONS.md`, `docs/SPRINT_STATUS.md`, `docs/CLAUDE_CONTEXT.md` — all three
searched, entries through `DECISIONS.md` #34 / 2026-07-12) is:

> **`docs/DECISIONS.md` entry #30** — "PR #142's Void Purchase Order Rules deployed
> to production," dated 2026-07-11, deployed at exact commit
> **`393f054883a970af2c39f1f193aff7dec8b12c11`**, verified live by the double-deploy
> content-fingerprint method (`firestore: latest version of firestore.rules already
> up to date, skipping upload...`).

No later Rules deploy is recorded anywhere. Entry #34 (2026-07-12) is a data-only
`securityRole` mirror backfill, explicitly "no `firestore.rules` change... no
deployment of any kind [besides the script]." Nothing after entry #34 touches
deployment at all.

**Working assumption for this package: production Firestore Rules are still at
commit `393f054883a970af2c39f1f193aff7dec8b12c11`, or reflect no rules deploy since.**
This assumption is unverified against live state (see §1) and **must be confirmed
by the Owner before deployment proceeds** — see §9's stop conditions.

---

## 3. Captured live Rules rollback target and hash — REQUIRED OWNER ACTION

This package cannot itself capture the live rollback target (§1). Before any
deploy, the Owner (or an operator with an authorized, credentialed session) must
capture the actual live ruleset text and its hash, and store both **outside this
repository** (e.g. a password manager, an encrypted note, an internal ops vault —
never a repo file, never a PR, never pasted into this session).

**Option A — Firebase Console (no scripting, no credentials handled by any AI session):**
1. Firebase Console → `taylor-parts` → Firestore Database → Rules tab.
2. Copy the full text of the currently active ruleset.
3. Compute and record its hash locally: `shasum -a 256 captured-live-rules.txt` (or `sha256sum`).
4. Store the text + hash outside the repo, per above.

**Option B — Read-only Admin SDK call, from an already-credentialed environment
(Cloud Shell or a machine with real ADC — the same method `docs/CLAUDE_CONTEXT.md`
documents as previously used for this exact purpose):**
```js
const { getSecurityRules } = require("firebase-admin/security-rules");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "taylor-parts" });
getSecurityRules().getFirestoreRuleset().then((rs) => {
  console.log(rs.source[0].content);
});
```
Pipe the output to a file, hash it the same way, store both outside the repo.

**If the captured live text's hash matches the hash of
`git show 393f054883a970af2c39f1f193aff7dec8b12c11:firestore.rules`**, §2's working
assumption is confirmed and this package's delta (§4) is accurate. **If it does not
match, stop — do not proceed with §5's deploy commands until the actual live
baseline is reconciled with a corrected delta.**

For quick reference, the assumed-baseline commit's own content hash (computable by
anyone with this repo, no credentials required):
```bash
git show 393f054883a970af2c39f1f193aff7dec8b12c11:firestore.rules | shasum -a 256
```

---

## 4. Full monolithic Rules delta from production — not only #325

Deploying `firestore.rules` today deploys **everything accumulated since the last
confirmed deploy (2026-07-11)**, not a narrow #325-only change. This is the single
most important fact in this package for the Owner's authorization decision.

| | Baseline (`393f054`, 2026-07-11) | Target (`cd81cdd`, this package) |
|---|---|---|
| `firestore.rules` line count | 841 | 1,473 (+632 net) |
| Root vs. client-mirror copy | — | byte-identical (`diff firestore.rules field-ops-app-vite/firestore.rules` — confirmed, part of every CI run) |

**New top-level collections since the baseline (7):**

| Collection | Posture | Client-facing impact |
|---|---|---|
| `equipment` | `isAdminOrDispatcher()` read; governed create/update; delete always denied | **Real.** Live client code (`field-ops-app-vite/src/hooks/useEquipment.js`) already calls this collection directly and its own header comment already anticipates the current state: reads "will surface as 'You do not have permission to view this equipment'" **until these Rules deploy.** See §9 — this is very likely a currently-broken-in-production feature that this deploy *fixes*, not one it puts at risk, but must be confirmed, not assumed. |
| `reportDefinitions` | `allow read, write: if false` (unconditional, no admin override) | None — no client code writes here directly (Issue #325's trusted service is the only path; not yet deployed itself, see §5/§6). |
| `roleAssignments` | `allow read, write: if false` | None — Admin-SDK/trusted-Function-only, no client reads it directly. |
| `roles` | `allow read, write: if false` | None — same as above. |
| `permissions` | `allow read, write: if false` | None — same as above. |
| `accessRequests` | `allow read, write: if false` | None — same as above. |
| `auditEvents` | `allow read, write: if false` | None — same as above. |

**Collections removed since the baseline: none** (confirmed — every collection
present in the baseline ruleset is still present in the target ruleset; nothing
was accidentally dropped).

**Collections present in both, whose internal rules may still have changed
(22 — not individually re-audited line-by-line in this package):** `accounts`,
`contacts`, `counters`, `employees`, `fieldops_jobs`, `fieldops_technicians`,
`fieldops_wos`, `inventory_actions`, `inventory_sync_status`,
`inventory_transactions`, `locations`, `purchase_orders`,
`reorder_purchase_order_voids`, `reorder_purchase_orders`, `reorder_requests`,
`stock_locations`, `supplier_catalog`, `suppliers`, `transfer_orders`, `users`,
`warehouses`. Known initiatives bundled into this delta, by commit history: Issue
#100's PARTS_MANAGER / WAREHOUSE_MANAGER / PARTS_ASSOCIATE Inventory role rows
(scoped warehouse access, reorder/purchase-order operational grants), the
Enterprise Access & Administration Platform (Issue #226) foundation, and the
`equipment` governed-fields Rules referenced above.

**Recommendation:** per this repo's own established practice for every prior Rules
deploy (`docs/DECISIONS.md` entries #22, #28, #29 — a dedicated Rules-focused
review preceding every deploy authorization), the Owner should treat this as a
full Rules-focused review of the entire delta, not a #325-scoped review, before
authorizing §5.

Regenerate the full line-level diff at any time:
```bash
git diff 393f054883a970af2c39f1f193aff7dec8b12c11..cd81cdd2579e78f3acc21637029d5086e85e0062 -- firestore.rules
```

---

## 5. Exact selective deployment commands

**Never run `firebase deploy` (all-surfaces) or `firebase deploy --only functions`
(all-functions) for this authorization.** Two commands only, in this order:

```bash
# 1. Rules first — the deny-by-default posture for roleAssignments/auditEvents/
#    permissions/roles/accessRequests/reportDefinitions must be live BEFORE any
#    Function that depends on it is reachable.
firebase deploy --only firestore:rules --project taylor-parts

# 2. Exactly these eight functions, by name — never a bare `--only functions`,
#    which would also deploy createWorkOrder/transitionWorkOrder/
#    updateWorkOrderExecutionData and the six Row-7 access commands
#    (grantRole/revokeRole/assignApprovedRole/setUserStatus/approveAccessRequest/
#    rejectAccessRequest), none of which are authorized by this package.
firebase deploy --project taylor-parts --only \
  functions:resolveEffectiveAccessCallable,\
functions:runReportDefinitionCallable,\
functions:createSavedDefinitionCallable,\
functions:getSavedDefinitionCallable,\
functions:listSavedDefinitionsCallable,\
functions:renameSavedDefinitionCallable,\
functions:duplicateSavedDefinitionCallable,\
functions:deleteSavedDefinitionCallable
```

All eight functions are confirmed `onCall({ region: "us-central1" }, ...)` in
`functions/src/index.ts` at the target commit — matches the requested region
exactly; no region flag override needed.

**Pre-flight, immediately before either command:**
```bash
git rev-parse HEAD    # must read cd81cdd2579e78f3acc21637029d5086e85e0062
git status --porcelain   # must be empty (clean tree)
diff firestore.rules field-ops-app-vite/firestore.rules   # must produce no output
```
Matches the exact pre-deploy evidence pattern used for every prior Rules deploy in
`docs/DECISIONS.md` (entries #26, #28, #30).

---

## 6. Function rollback / delete commands and Rules restoration procedure

**Functions rollback.** Since zero functions are live today (§1), "rollback" for
this package is deletion, not a version revert:
```bash
firebase functions:delete \
  resolveEffectiveAccessCallable \
  runReportDefinitionCallable \
  createSavedDefinitionCallable \
  getSavedDefinitionCallable \
  listSavedDefinitionsCallable \
  renameSavedDefinitionCallable \
  duplicateSavedDefinitionCallable \
  deleteSavedDefinitionCallable \
  --project taylor-parts --region us-central1 --force
```

**Rules restoration.** From a clean scratch checkout (never the working tree of an
in-progress branch):
```bash
git worktree add /tmp/rules-rollback 393f054883a970af2c39f1f193aff7dec8b12c11
cd /tmp/rules-rollback
shasum -a 256 firestore.rules   # must match the hash captured in §3 before proceeding
firebase deploy --only firestore:rules --project taylor-parts
git worktree remove /tmp/rules-rollback
```
If §3's captured live hash did **not** equal `393f054`'s hash (i.e. the working
assumption in §2 was wrong), restore to the ACTUAL captured live text instead of
this commit — reconstructed from the text saved in §3, not from any commit in this
repo.

**Rollback triggers** (any one is sufficient to invoke the above): see §7's
verification matrix "Rollback triggers" row, and §9's stop conditions.

---

## 7. Pre-deploy test totals and CI links

All at target commit `cd81cdd2579e78f3acc21637029d5086e85e0062` (`firestore.rules`
and `functions/src` unchanged since merge commit `cd12393` — PR #354 — confirmed via
`git diff cd12393..cd81cdd --stat`, which touches only `field-ops-app-vite/*` client
files for PR #355's UI wiring).

| Suite | Result | Run locally at target commit |
|---|---|---|
| Firestore Rules Regression (pinned, 11 suites, fresh emulator per suite) | **423 passed, 0 failed** | `node functions/scripts/rulesRegressionRunner.mjs` |
| `test:access` (6 files: permission catalog, resolver, governed roles, shadow parity, compact claims, mirror integrity) | **121 passed, 0 failed** (20+39+30+6+25+1) | `npm run test:access` |
| `test:audit` (Audit Event trusted writer) | **54 passed, 0 failed** | `npm run test:audit` |
| `test:trustedWriter` (Row 7 access commands) | **37 passed, 0 failed** | `npm run test:trustedWriter` |
| `test:effectiveAccess` (trusted effective-access feed) | **23 passed, 0 failed** | `npm run test:effectiveAccess` |
| `test:claims` | **5 passed, 0 failed** | `npm run test:claims` |
| `test:reporting` (catalog parity 10 + D-FN execution service 27 + saved-definition commands 22) | **59 passed, 0 failed** | `npm run test:reporting` |
| **Total** | **722 passed, 0 failed** | — |

**CI (GitHub Actions), merge commit `cd1239397a160899263c2f44a1c0651275e32e90`
— PR #354, the commit that produced this exact `firestore.rules`/`functions/src`
state — 12/12 checks green:**
- Firestore Rules Regression — https://github.com/TaylorService-spec/Taylor_Parts/actions/runs/29793791925
- Report Execution Service Tests — https://github.com/TaylorService-spec/Taylor_Parts/actions/runs/29793791882
- Effective Access Feed Tests — https://github.com/TaylorService-spec/Taylor_Parts/actions/runs/29793791942
- Access Audit Service Tests — https://github.com/TaylorService-spec/Taylor_Parts/actions/runs/29793791900
- Access Trusted-Writer Command Tests — https://github.com/TaylorService-spec/Taylor_Parts/actions/runs/29793791902
- Access Catalog & Resolver Unit Tests — https://github.com/TaylorService-spec/Taylor_Parts/actions/runs/29793791903
- Access Claims Tests — https://github.com/TaylorService-spec/Taylor_Parts/actions/runs/29793791899
- Access Operator Script Tests — https://github.com/TaylorService-spec/Taylor_Parts/actions/runs/29793791918
- Work Order Engine Functions Tests — https://github.com/TaylorService-spec/Taylor_Parts/actions/runs/29793791914
- Work Order Transition Engine Tests — https://github.com/TaylorService-spec/Taylor_Parts/actions/runs/29793791898
- Vite Build Check — https://github.com/TaylorService-spec/Taylor_Parts/actions/runs/29793791921
- Deploy Field Ops (Vite) to GitHub Pages — https://github.com/TaylorService-spec/Taylor_Parts/actions/runs/29793792001

PR #355 (client-only Saved Reports UI wiring, squash commit `ebe62a6` on `main`)
added no backend delta; its own CI, triggered on merge commit `cd81cdd` (this
repo's Actions workflows trigger on the merge commit, not the pre-merge PR head
SHA — `gh run list --commit ebe62a6` returns no runs; `cd81cdd` is the correct,
already-verified target commit either way), is also green:
https://github.com/TaylorService-spec/Taylor_Parts/actions/runs/29795250454 /
https://github.com/TaylorService-spec/Taylor_Parts/actions/runs/29795250482

---

## 8. Required test RoleAssignment plan — NO ASSIGNMENT PERFORMED

Production verification (§9) requires at least one real principal holding the
governed `owner` Role, since every `report.definition.*` and wave-1 `report.*`
capability this package activates is currently granted to `owner` only
(`functions/src/access/governedBusinessRoles.ts`). **No such assignment exists in
production today** (unverifiable directly per §1, but no code path in this
repository has ever written to `roleAssignments` in production — Row 7's trusted
writer commands are exported but not yet deployed, and this collection has no
client-direct write path at any point in its history).

**This package does not create this assignment.** It specifies the exact,
reviewable shape it would take, for a **separate, explicit Owner Production Data
Authorization** (matching the precedent in `docs/DECISIONS.md` entry #34 — an
Owner-operated action, not an AI-session action):

```json
// Collection: roleAssignments, doc id: any fresh, unused id
{
  "id": "<same as doc id>",
  "principalUid": "<the approved test/verification principal's real Firebase Auth uid>",
  "roleId": "owner",
  "scope": { "type": "global" },
  "grantedBy": "<Owner's own uid, or an explicit manual-grant marker>",
  "grantedAt": "<Firestore server timestamp at time of write>",
  "status": "active",
  "accessVersionAtGrant": "<the same value as the principal's users/{uid}.accessVersion at grant time>"
}
```

And, on `users/{uid}` for that same principal, `accessVersion` must be a
non-negative integer (existing value if already set; `0` if this is the
principal's first-ever access grant).

**Approved principals:** none nominated in this package — the Owner must name the
specific uid(s) to grant before this step can be scoped further. Recommended: one
dedicated verification principal (not a real end-user's production account),
distinct from any principal already used for prior manual production
verification (e.g. the account used in `docs/DECISIONS.md` entry #32's smoke
check).

**Revocation, for symmetry with §9's verification rows:** flip the assignment's
`status` to `"disabled"`; the trusted writer also bumps `users/{uid}.accessVersion`
so cached decisions/tokens fail freshness checks and refresh. A version bump by
itself is **not** assignment revocation: an active assignment remains consistent
when `accessVersionAtGrant <= users/{uid}.accessVersion`. Only an impossible
future-dated assignment (`accessVersionAtGrant > current accessVersion`) is
excluded as malformed/stale.

---

## 9. Blast radius, stop conditions, and Owner authorization request

### Blast radius

- **Firestore Rules deploy is instantaneous and global** — the moment
  `firebase deploy --only firestore:rules` completes, every live client session,
  for every collection listed in §4, is affected. There is no gradual rollout, no
  per-user flag, no client-version gate.
- **Client code already live** (GitHub Pages, PR #355 merged and auto-deployed)
  already contains: (a) `useEquipment.js`'s direct client-SDK reads of `equipment`
  — currently most likely failing `permission-denied` in production (§4), this
  deploy is expected to *fix*, not break, that path; (b) the Saved Reports UI
  calling `resolveEffectiveAccessCallable` / the six saved-definition callables —
  **these calls will fail (function not found) until §5's second command also
  runs**, so deploying Rules alone, without Functions, leaves the already-live
  Saved Reports UI in a broken (not merely inert) state until both steps complete.
  Recommend deploying both steps of §5 within the same maintenance window, not
  Rules today and Functions later.
- **`roleAssignments`/`auditEvents`/`permissions`/`roles`/`accessRequests`/
  `reportDefinitions`** are all newly-added and unconditionally deny-all — zero
  client code anywhere calls them directly, so their activation has no client-
  facing blast radius by construction.
- **The 22 shared, pre-existing collections in §4** carry unaudited-in-this-package
  internal changes (Issue #100 role rows, prior sprints) — their blast radius is
  "whatever those already-merged, already-CI-tested PRs individually specified,"
  not re-derived here; the Owner's own review of those PRs' Final Reviews is the
  relevant record, not this package.
- **No production data is read, written, or migrated by this package or by either
  §5 command.** Functions deploy uploads code; Rules deploy uploads a ruleset.
  Neither touches a single document.

### Stop conditions — do not proceed with §5 if any of these hold

1. §3's captured live Rules hash does not match `393f054883a970af2c39f1f193aff7dec8b12c11`'s hash (§2's working assumption is wrong — reconcile first).
2. `git rev-parse HEAD` at deploy time is not exactly `cd81cdd2579e78f3acc21637029d5086e85e0062`, or `git status --porcelain` is non-empty.
3. `diff firestore.rules field-ops-app-vite/firestore.rules` produces any output (the two copies have drifted).
4. Any suite in §7 does not reproduce green when re-run immediately before deploy.
5. The Owner has not separately authorized §8's RoleAssignment write (verification cannot complete without it, and this package does not treat "Rules/Functions deployed" as equivalent to "verified").
6. Any step of §10's verification matrix fails, or cannot be completed, after Functions deploy.

### Owner authorization request

This package requests **two separate, explicit Owner Deployment Authorizations**,
scoped exactly as written, matching this repo's established pattern:

1. **Firestore Rules deploy authorization** — scoped to exactly
   `firebase deploy --only firestore:rules --project taylor-parts` at exactly
   commit `cd81cdd2579e78f3acc21637029d5086e85e0062`, contingent on §3's hash
   reconciliation.
2. **Functions deploy authorization** — scoped to exactly the eight named
   functions in §5's second command, at the same commit, to run in the same
   maintenance window as (1).

Plus, separately (§8), an **Owner Production Data Authorization** for the single
test `roleAssignments` write needed to run §10's verification matrix.

No other production action is requested or in scope.

---

## 10. Production verification matrix

To be executed **after** both §5 deploys and **after** §8's single test
RoleAssignment write, by whichever principal(s) the Owner names in §8. Every row
uses only the already-approved test principal and the already-deployed
functions/Rules — no additional writes beyond §8's single grant.

| # | Scenario | Method | Expected result |
|---|---|---|---|
| 1 | Denied / unassigned principal | Call `resolveEffectiveAccessCallable` or any saved-definition callable as an authenticated user with **no** `roleAssignments` doc at all | `permission-denied` (saved-definition callables) or an all-`false` decisions map (effective-access feed) — never a silent allow |
| 2 | Valid Owner | Call `createSavedDefinitionCallable` → `listSavedDefinitionsCallable` → `getSavedDefinitionCallable` as the §8 test principal (active `owner` assignment, fresh `accessVersion`) | Create succeeds, returns a real document id; list includes it; get returns it, `ownerUid` equal to the caller's own uid |
| 3 | Assignment-version consistency | Temporarily set the test assignment's `accessVersionAtGrant` **above** `users/{uid}.accessVersion` | Every subsequent trusted resolver/callable decision denies because a future-dated assignment is malformed/stale; restore the original assignment value immediately after the check |
| 4 | Revoked assignment and client freshness | Flip the test assignment's `status` to `"disabled"` and bump `users/{uid}.accessVersion`; first confirm the trusted callable denies, then confirm a client holding the prior version denies while refreshing and accepts no cached `true` decision | Server authorization denies immediately from the disabled assignment; the client clears the old decision before its refreshed feed returns. The version bump alone is not expected to invalidate another still-active, older assignment |
| 5 | Field omission | Call `runReportDefinitionCallable` with a definition selecting a field the test principal's Role does not grant (any non-Owner-adjacent field, or omit a required field entirely) | Result either drops the field from the projected output (never silently returns it) or denies outright — never returns unauthorized field data |
| 6 | Saved-definition CRUD | Full cycle: create → rename → duplicate → delete, all as the same owning principal | Each step succeeds exactly once; `list` reflects the current state after each step; the deleted id 404s afterward |
| 7 | Cross-principal denial | As a second authenticated principal with **no** ownership of the first principal's saved definition (capability held or not — both sub-cases), attempt `get`/`rename`/`duplicate`/`delete` on the first principal's definition id | Denied identically whether or not the second principal holds the capability at all, and identically whether or not the target id exists (the existence-oracle fix from PR #354's review round 1 — re-verify this holds against REAL production state, not only the emulator) |
| 8 | Immutable audit | After scenario 6's full CRUD cycle, read `auditEvents` via the Admin SDK (Owner-operated, read-only, matching entry #32's precedent) filtered by the test definition's id | Exactly one `applied` Audit Event per mutating action (create/rename/duplicate/delete), none for get/list, none overwritten or missing |
| 9 | Rollback triggers | Any of: scenario 1 unexpectedly allows; scenario 3 or 4 unexpectedly allows; scenario 7 leaks existence or behaves inconsistently; scenario 8 shows zero or duplicate audit events for an applied mutation; any client-facing error the Owner did not expect | **Stop.** Run §6's Function delete + Rules restoration procedure. Do not attempt a partial fix live in production. |

Verification is complete only when rows 1–8 all pass exactly as specified. Row 9
is the abort path, not an optional scenario.
