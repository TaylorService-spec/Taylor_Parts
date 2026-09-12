# Firebase Business-Runtime Census — post-Wave-1

**Baseline:** `64008d5ae0bdd9532909671b15a91122400accf1` (`main`, merge of PR #1898 `integration/wave-1`).
**Prior census baseline:** `d104cf49` (pre-merge base).
**Mode:** evidence only. This document changes no runtime code, test, config or schema.

Every count below is re-derived at `64008d5a`. Where a figure was executed rather than read, the
command is named. Where it could not be executed here, it is listed under **UNPROVEN** and is not
asserted.

## Two rules applied throughout

1. **Identity/session use is not business authority.** Firebase Auth sign-in and Firebase-UID
   correlation to an EOS Principal/Employee are permitted transitional use. They are excluded from
   every business count. The identity carve-outs are named in §6.
2. **Nothing was deleted to reduce a count.** This lane changed no code. Proven-dead runtime is the
   *last* retirement priority, not the first.

---

## 1. Method

The classifier is `scripts/firebaseExitGuard.mjs` at `64008d5a`, used as a library (`scanTree`,
`evaluateGuard`) — not modified, not re-baselined. It fences four dependency classes crossed with
three roots (`field-ops-app-vite/src`, `functions/src`, `integrations`) = twelve categories, eight
of which are empty and pinned at zero.

A **business-runtime file** is a file under a fenced root whose import specifiers match one of the
four fenced classes. A file is **type-only** if every such import is an `import type` statement; it
is **value-using** otherwise.

Both commits were scanned with the *same* classifier — the pre-merge tree was materialised with
`git archive d104cf49 | tar -x` into a scratch directory — so every delta below isolates tree
movement from classifier movement.

---

## 2. Before (`d104cf49`) → after (`64008d5a`) delta

| # | Metric | `d104cf49` (prior census as briefed) | `d104cf49` (re-derived) | `64008d5a` (re-derived) | Δ | Reason for movement |
|---|---|---|---|---|---|---|
| 1 | BUSINESS_RUNTIME files (unique, 4 fenced classes) | 295 | **296** | **296** | **0** | No movement. The prior 295 was an **off-by-one undercount** — see §2.1. |
| 2 | …of which import-type-only | 60 | **60** | **60** | 0 | Reproduces exactly. |
| 3 | …real (value-using) surface | 235 | **236** | **236** | 0 | 296 − 60. Prior arithmetic was right on a wrong total. |
| 4 | DEAD_RETIREABLE files | 4 | **4** | **4** | 0 | Reproduces — the frozen Cycle Count v1 family (Decision #179), but only under one definition. 28-30 files are unreachable from any entrypoint. See §5.7. |
| 5 | `frontend.firestore_client` | — | 55 | 55 | 0 | |
| 6 | `frontend.firebase_functions_client` | — | 55 | 55 | 0 | |
| 7 | `server.firebase_admin_firestore` | — | 184 | 184 | 0 | |
| 8 | `server.firebase_functions_server` | — | 72 | 72 | 0 | |
| 9 | `integrations.*` (4 categories) | — | 0 | 0 | 0 | Pinned at zero; still zero. |
| 10 | Guard violations / stale entries | — | 0 / 0 | 0 / 0 | 0 | `evaluateGuard` executed at both commits. |
| 11 | Deployed Functions endpoints (`functions/src/index.ts` exports) | 179 | **179** | **179** | 0 | Reproduces exactly. |
| 12 | LIVE_BUSINESS_TRANSPORT endpoints | 128 | **152** | **152** | 0 | Method-dependent — see §2.2. |
| 13 | Exported-but-unreachable endpoints | 42 | **27** | **27** | 0 | Same cause as #12. |
| 14 | "Inert-registered" endpoints | 9 | **0** | **0** | −9 | **The prior 9 was a parser artifact** — see §2.3. |
| 15 | DEAD_RETIREABLE endpoints | 0 | **0** | **0** | 0 | Confirmed: all 179 are really registered. |
| 16 | Endpoints with a named Render replacement | 1 | **1** | **1** | 0 | Reproduces. Now named: `revokeRole` — §5.4. |
| 17 | `firestore.rules` total `allow` statements | — | 95 | 95 | 0 | `firestore.rules` is **byte-identical** across the merge. |
| 18 | Rules business-authorization sites | 69 | **69** | **69** | 0 | Reproduces exactly. |
| 19 | …tracked by the convergence gate | 43 | **43** | **43** | 0 | Executed: `totalLegacySites()` = 43. |
| 20 | …**untracked** by the gate | 26 | **26** | **26** | 0 | Employee operational-role + technician actor-binding grants. |
| 21 | Client-writable collections | 9 | **9** | **9** | 0 | Reproduces exactly. |
| 22 | State machines in Rules | 2 | **3** | **3** | +1 | **Prior census missed one** — §5.1. |
| 23 | `functions/src` files reaching Firestore only transitively | 50 of 406 | **48 of 428** | **48 of 428** | 0 | Denominator and numerator both corrected — §4. |
| 24 | `roleAssignments` per-request reader modules (`functions/src`) | — | 23 | 23 | 0 | |
| 25 | Bare `firebase-admin` importers (the latent guard gap) | — | 1 | 1 | 0 | `eosApi/server.ts`, identity-only — §3. |

**Net Firebase delta across Wave 1: zero on every metric.**

### 2.1 The 295 → 296 correction

`field-ops-app-vite/src/services/reorderCallableClient.js` loads its transport with

```js
const [{ httpsCallable }, { functions }] = await Promise.all([
  import("firebase/functions"),
  import("../firebase/firebase.js"),
]);
```

`firebase/functions` is a **dynamic import nested inside a `Promise.all` array element**, so it is
not at the head of a statement. The guard catches it (its specifier regex is position-independent);
a statement-anchored classifier does not. The prior census's 295 and my first pass both missed this
one file for the same reason. The correct figures are **296 total / 60 type-only / 236 value-using**.
The 60 and the 235→236 arithmetic are otherwise exactly as briefed.

Reconciliation, executed: frontend union `|55 ∪ 55| = 99` (11 files in both classes); server union
`|184 ∪ 72| = 197` (59 files in both); `99 + 197 = 296`.

### 2.2 Why 152 live, not 128

There is no published prior-census artifact in the repository, so its reachability method cannot be
re-run. Endpoint names are **not** resolvable by grep: the frontend routes callables through generic
invokers (`httpsCallable(functions, name)` in eight client modules), and the names themselves live in
separate imported name tables — e.g. `field-ops-app-vite/src/domain/receivingTransport.js:11`
`receive: "receiveInventoryStock"`. A name-literal search restricted to `firebase/functions`
importers therefore *undercounts*, and a binding-based parse undercounts worse (30 direct + 63
indirect).

The method used here: **an endpoint is LIVE_BUSINESS_TRANSPORT if its exported name appears as a
string literal anywhere in `field-ops-app-vite/src` after comment stripping.** Block comments and
`//` lines are removed first, so prose like `App.jsx:698` ("receiveInventoryStock action; performs no
receipt/write itself") does not count. That yields **152 live / 27 with no browser reference**.

Both figures are method-dependent and neither is a ground truth about the deployed project. What is
*not* method-dependent: **0 of 179 are DEAD_RETIREABLE**, and all 179 are genuinely registered.

### 2.3 The "9 inert-registered" endpoints do not exist

All nine resolve to real, registered `onCall` handlers. Seven are declared through a local
`adapt()` wrapper in `functions/src/scheduling/schedulingCallables.ts:31-49`, which returns
`onCall({ region: "us-central1" }, …)`; two (`relocateStock`, `listStockMovementLocations`) are
aliased re-exports at `functions/src/index.ts:516`. A classifier that looks for `onCall(` adjacent to
the exported identifier's declaration finds neither form. Trigger-kind census at `64008d5a`:
**178 `onCall` + 1 `onSchedule` (`pollEmailMailboxes`) + 0 Firestore triggers.**

`grep -rn "onDocumentWritten|onDocumentCreated|onDocumentUpdated|onDocumentDeleted|firestore\.document(" functions/src | wc -l` → **0**. There is no Firestore-trigger business runtime at all.

---

## 3. Did Wave 1 add any Firebase business dependency? **No.**

The standing rule is *no new Firebase business dependency*, so this was checked four independent
ways. All four agree.

| Check | Result |
|---|---|
| `git diff --shortstat d104cf49 HEAD` | 39 files, 1271 insertions, 979 deletions |
| Changed files ∩ the 296 business-runtime files | **exactly 1**: `functions/src/scheduling/schedulingCommands.ts` |
| Fenced import lines added or removed anywhere under the three roots | **0** (`git diff … \| grep -E "^[+-].*(firebase-admin\|firebase-functions\|firebase/firestore\|firebase/functions\|firebase/auth)"` → empty) |
| Comment-stripped Firestore call sites in `schedulingCommands.ts` | **31 → 31** |
| Firestore collections touched by `schedulingCommands.ts` | **unchanged** (set diff empty) |
| `docs/architecture/firebase-exit-baseline.json` | **byte-identical** at both commits |
| `firestore.rules`, `scripts/firebaseExitGuard.mjs`, `firebase-exit-manifest.json`, `.github/workflows/firebase-exit-guard.yml` | **all byte-identical** at both commits |

A raw `grep -c` on the changed file appears to show 31 → 32. **That +1 is a comment**, added by the
blocked-time-UNION ruling:

```
+    // Reset per ATTEMPT. runTransaction retries this callback on contention, and a replay detected
```

Counting it would have been a false finding. **Verdict: Wave 1 added no Firebase business dependency,
deepened none, and retired none.**

### 3.1 What the guard would not have caught

Wave 1 is clean, but the check above is stronger than the guard's. The ratchet is **file-granular**:
a file already in the baseline may add unlimited Firestore reads, writes, collections and
transactions without tripping anything. `schedulingCommands.ts` was the one changed business file,
and confirming it added nothing required a call-site diff the guard does not perform. **Any future
wave that touches a baselined file needs the same manual check**, because a green guard does not
mean a flat Firebase surface.

---

## 4. The guard's coverage boundary

Three gaps, measured. None is a criticism of the fence's design; all three bound what a green run
means.

### 4.1 The `firebase_admin_firestore` subpath gap — real, but empty

`BUSINESS_RUNTIME_CLASSES` matches `firebase-admin/firestore` only on the `/firestore` subpath
(`scripts/firebaseExitGuard.mjs:113-118`), so bare `firebase-admin` + `admin.firestore()` evades it.

**Census impact at `64008d5a`: the exploitable set is empty.** The only bare `firebase-admin`
importer under any fenced root is `functions/src/eosApi/server.ts:105-106`, and it makes **zero**
`.firestore()` / `getFirestore()` calls. It does exactly one thing — `app.auth().verifyIdToken()`,
taking only the `uid` (`server.ts:108-112`), with custom claims deliberately not read.

**Consequence for ENG-B, who owns the fix:** adding a bare-`firebase-admin` category would add
exactly **one** file to `server.firebase_admin_firestore`, and that file is the **identity carve-out**.
Baselining it would record a business dependency that does not exist and would inflate the census by
one. A correct fix needs to match the bare specifier *and* require a Firestore accessor in the same
file, or exclude this file explicitly. I did not change the guard, its test, its baseline, or its
workflow.

### 4.2 The local-shim gap — much larger, and this is the one that matters

The fence is on the **import specifier**. A module that reaches Firestore through a local shim
imports no fenced specifier and is invisible to the guard. Measured by building the local import
graph over each root:

| Root | Files | Direct fenced import (guard-visible) | Reaches Firebase only transitively (guard-**invisible**) | Never reaches Firebase |
|---|---|---|---|---|
| `functions/src` | 428 | 197 | **48** | 183 |
| `field-ops-app-vite/src` | 825 | 99 | **228** | 498 |
| `integrations` | 16 | 0 | 0 | 16 |

The **48 of 428** on the server is the brief's "50 of 406" — both numerator and denominator were
slightly off; the substance is right.

The frontend's **228** is the larger and previously unreported figure. The shim is
`field-ops-app-vite/src/firebase/firebase.js`, which exports `db`, `auth` and `functions`
(lines 36-41) and is imported by **95** frontend modules — against only 99 that import a fenced
specifier directly. Two further write shims sit on top of it:
`field-ops-app-vite/src/lib/firebaseSafe.js` (the demo/panic write gate, 5 importers) and
`field-ops-app-vite/src/firebase/collectionStore.js` (13 importers).

Per the Owner ruling, **approved transitional shims may remain and existing shim consumers are not
violations**; the fence is at the shim and what needs governing is *consumer growth*. Nothing in this
repository governs that today: the guard counts neither the 48 nor the 228, so consumer growth
through a shim is unfenced in both directions.

### 4.3 A bare local guard run is not a green ratchet

Correcting the brief on a detail: a bare `node scripts/firebaseExitGuard.mjs` does **not** bootstrap
or write a baseline. Nothing is written. It runs `evaluateGuard` (exact match against the committed
baseline) in full and **skips `evaluateRatchet`**, printing
`no previous baseline found -- bootstrap accepted`. So a bare run proves the committed baseline
matches the tree; it proves nothing about whether the baseline grew. The real ratchet needs
`--previous-baseline=<path>`.

CI does supply it. `.github/workflows/firebase-exit-guard.yml` resolves the previous accepted commit
per event type (PR base sha / push `before` / `HEAD^`), fails closed if a sha it expects to resolve
does not, materialises that commit's baseline to a temp file, and passes
`--previous-baseline=`. Bootstrap survives only for a branch-creation push or a root commit. **The CI
ratchet is genuine.** I did not run it (it needs GitHub event context); I read it.

### 4.4 The baseline's own unenforced metadata

`docs/architecture/firebase-exit-baseline.json` carries `targets`, `rulesFiles`,
`firebase_business_authorization_rules: 0` and `firebase_operational_data_authority: 0`.
`baselinePathsFor` only ever reads `baseline.<section>.<name>` for the twelve fenced category keys,
so **none of that metadata is enforced by anything**, and it has drifted: `rulesFiles` records
`firestore.rules` with `allowStatements: 105`, while the file at `64008d5a` has **95**. The
`firebase_auth` / `firebase_admin_app` sections (7 entries) are likewise inert documentation — correct
by design, since they are the identity carve-out, but worth stating so nobody reads them as fenced.
`baseSha` is `1fdef0b7`, neither `d104cf49` nor `64008d5a`.

---

## 5. The seven-class classification at `64008d5a`

| Class | Count | Unit | Basis |
|---|---|---|---|
| 1 · Firestore Rules business authorization | **69** sites / **9** client-writable collections / **3** state machines | Rules predicate invocations | `firestore.rules` (1876 lines, 95 `allow`) |
| 2 · Browser business writes | **6** modules (2 of them generic shims) | frontend files | `frontend.firestore_client` with a mutating API |
| 3 · Browser business reads | **44** modules | frontend files | `frontend.firestore_client` with a read API |
| 4 · Firebase Functions business transport | **179** endpoints · **55** browser client modules · **72** server runtime modules | endpoints + files | `index.ts` exports; `frontend.firebase_functions_client`; `server.firebase_functions_server` |
| 5 · `roleAssignments` compatibility authority | **23** server reader modules; **1** collection; **147** permissions; **45** governed + **3** compatibility roles | modules | per-request Firestore read |
| 6 · Config / reference authority in Firebase | **33** authorities (**22** Firebase-only) of 74 runtime collections | authorities | runtime collection reads |
| 7 · Dead-retireable runtime | **4** (self-declared + graph-confirmed); 28-30 unreachable | files | import-graph reachability over 3 entrypoints |

Totals do not sum to 296: a file can be in several classes, and the 296 is a file count while
classes 1, 4, 5 and 6 are counted in their own natural units.

### 5.1 Class 1 — Rules business authorization (69 sites)

`firestore.rules` and `field-ops-app-vite/firestore.rules` are **byte-identical** (md5
`e10bc046d30e337ef8e95f3d5f96ee0f`), asserted by test D4 of the convergence gate.

| Authority mechanism | Sites | Source consulted | Tracked by the gate? |
|---|---|---|---|
| `isAdminOrDispatcher()` | 40 | `get(users/{uid}).role` | yes |
| `isAdmin()` | 2 | `get(users/{uid}).role` | yes |
| `isTechnician()` | 1 | `get(users/{uid}).role` | yes |
| **subtotal — the 43 the gate tracks** | **43** | legacy `users/{uid}.role` document | **yes** |
| `isActiveOperationalRole("PARTS_MANAGER")` | 7 | `get(employees/{id})` reciprocal link + ACTIVE + `operationalRoles` | **no** |
| `isActiveOperationalRole("PARTS_ASSOCIATE")` | 6 | same | **no** |
| `isActiveOperationalRole("WAREHOUSE_MANAGER")` | 3 | same | **no** |
| `isAssignedToWarehouse(…)` | 3 | same + `assignedWarehouseIds.hasAny` | **no** |
| `callerTechnicianId()` | 6 | `get(users/{uid}).technicianId` (actor binding) | **no** |
| `isOwnTechnician(…)` | 1 | `get(users/{uid}).technicianId` | **no** |
| **subtotal — untracked** | **26** | Employee operational-role + technician actor binding | **no** |
| **Total** | **69** | | 43 of 69 |

**The brief's central Rules finding is confirmed: the convergence gate could reach zero with
operational-role authorization untouched.** `functions/src/access/legacyAuthorizationSurface.ts`
scopes itself to exactly three helper names (`LEGACY_ROLE_HELPERS`), so the 26 Employee-document and
technician-actor-binding grants are outside it by construction. Retiring the legacy `users/{uid}.role`
surface would take the gate to 0 and leave 26 live Rules authorization decisions in place.

There are **zero** pure-identity authorization sites: all five in-match `isSignedIn()` uses (lines
361, 386, 402, 428, 492) are ANDed with an ownership or actor binding. There is **no custom-claim
check anywhere** — zero occurrences of `request.auth.token`; all role authority is a `users/{uid}`
document read and all operational-role authority an `employees/{id}` document read.

`roleAssignments` appears in Rules at line 1684 as `allow read, write: if false` and is **never
consulted by any rule** — its authority is entirely server-side (class 5).

Nine client-writable collections, confirmed:

| # | Path | Match line | Authorization |
|---|---|---|---|
| 1 | `fieldops_jobs` | 353 | `isAdminOrDispatcher()` + status/technician shape; technician may do `assigned→in_progress` on own job |
| 2 | `fieldops_technicians` | 397 | `isAdminOrDispatcher()` + `isTechnicianStatus()` |
| 3 | `reorder_requests` | 638 | 8 OR'd branches; `create` is `if false` (line 706) |
| 4 | `reorder_purchase_order_voids` | 1098 | `isAdminOrDispatcher()` + assignee binding + `existsAfter`/`getAfter` cross-doc pin |
| 5 | `inventory_actions` | 1154 | **`isAdminOrDispatcher()` and nothing else** |
| 6 | `accounts` | 1319 | `isAdminOrDispatcher()` + governed-field validation |
| 7 | `locations` | 1341 | `isAdminOrDispatcher()` — **no validation** |
| 8 | `equipment` | 1505 | `isAdminOrDispatcher()` + shape + transition + location-belongs-to-account |
| 9 | `contacts` | 1555 | `isAdminOrDispatcher()` — **no validation** |

`delete` is `if false` on all nine; 60 of the 95 `allow` statements are `if false`. No path is
writable by a merely-signed-in client.

**`inventory_actions` — the brief is exactly right.** Lines 1154-1158:

```
1154:    match /inventory_actions/{actionId} {
1155:      allow read: if isAdminOrDispatcher() || isActiveOperationalRole("WAREHOUSE_MANAGER");
1156:      allow create: if isAdminOrDispatcher();
1157:      allow update, delete: if false;
1158:    }
```

Line 1156 is the whole create rule. No `request.resource.data` reference, no `keys().hasOnly`, no
actor binding (nothing pins `createdBy`/`performedBy` to `request.auth.uid`), no quantity/type/part
validation. Any admin-or-dispatcher client may write an arbitrary document attributed to anyone. The
file's own justification at lines 1141-1143 cites `reorder_requests`' create rule as precedent — but
that rule has since been hardened to `allow create: if false` (line 706), **so the cited precedent no
longer exists.** Alongside `locations` (1343) and `contacts` (1557), this is one of only three
unvalidated client creates left in the file.

**Three state machines in Rules, not two** — this corrects the brief:

| # | Machine | Lines | Transitions enforced |
|---|---|---|---|
| 1 | `fieldops_jobs` lifecycle | helpers 329-345; enforced 366-368, 381-393 | create must be `open`+unassigned; `open→assigned`, `assigned→in_progress`, `assigned→open`, `in_progress→complete`; technician limited to `assigned→in_progress` status-only on own job; `complete` terminal for all clients |
| 2 | **`reorder_requests` workflow** | **`allow update` spans exactly 763-1001** | 8 branches: Approve/Reject, Assign, Start Purchasing, Post Purchasing Update, Mark Received, Cancel, Void, plus a global immutability tail (997-1001) pinning `partId`, `urgency`, `recommendedQty`, `requestedBy`, `createdAt` |
| 3 | **equipment lifecycle** — *missed by the prior census* | `equipmentTransitionAllowed` 1419-1426; enforced 1546; create forced `ACTIVE` at 1500 | `ACTIVE↔INACTIVE`, `X→X`; every `→RETIRED` and every `RETIRED→ACTIVE/INACTIVE` denied by omission |

The brief's `firestore.rules:763-1001` citation for the reorder workflow is **exactly correct** —
`allow update: if` begins at 763 and its terminating `;` is at 1001. Line 706 is
`allow create: if false;`, 1002 is `allow delete: if false;`, and `match /reorder_purchase_orders`
begins at 1049.

One state in machine 2 is already unreachable from Rules: the `PURCHASING_IN_PROGRESS → ORDERED`
(Record PO) branch was removed and moved to the `recordReorderPurchaseOrder` Admin-SDK transaction
(comment 814-829). Branches 846 (`ORDERED → RECEIVED`) and 948 (`ORDERED → VOIDED`) are therefore
only satisfiable on documents a trusted writer already advanced.

### 5.1.1 The convergence gate is not a tautology — but two of its assertions are

The brief asks me to verify the claim that the convergence guard "cannot fail". **That claim is
wrong for the gate as a whole and right for two individual assertions.**

Executed. `functions/lib` is absent here (no `node_modules`, nothing compiled), so the gate was run
against its shipped TypeScript source using Node 22 type stripping plus a loader hook mapping
`functions/lib/**/*.js` → `functions/src/**/*.ts`:

```
node --experimental-strip-types --import <register loader hook> \
     --test functions/test/legacyAuthorizationSurface.test.mjs
```

→ **7/7 pass, exit 0.** `totalLegacySites()` resolves to **43** across **21** collections;
`collectionsWithoutPermissionCoverage()` returns **14**; per-row burn-down is row23 = 3 collections/9
sites, row24 = 13/22, row25 = 4/11, row26 = 0/0, unassigned = 1/1.

Mutation-tested against **scratchpad copies** of `firestore.rules` (the repository file was not
touched):

| Mutation | Parsed result | Gate assertion that fails |
|---|---|---|
| extra `isAdmin()` inside the existing `accounts` block | `accounts` becomes `{isAdminOrDispatcher:3, isAdmin:3}`; total 43→44 | **D1** (`deepEqual` per collection) |
| new `match /brand_new_thing` with `isAdminOrDispatcher()` | 21→22 collections; total 43→44 | **D2** (undocumented collection) |

So D1, D2 and D4 are real and can fail. **D3 is the tautology**: it compares the corpus total to the
parsed total, which is entailed by D1 (per-collection equality for all 21 recorded collections) plus
D2 (no unrecorded collection). Given D1 and D2 pass, D3 cannot fail. D7's closing assertion
(`gaps.length <= corpus.length`) is likewise trivially true. Two redundant assertions in an otherwise
load-bearing gate — **not** a gate that cannot fail.

The gate's real limitation is the one in §5.1: its **scope**, not its logic. It tracks 43 of 69.

### 5.2 Class 2 — browser business writes (6 modules)

The smallest and most tractable retirement target in the whole census.

| Module | Role |
|---|---|
| `field-ops-app-vite/src/domain/contactImport.js` | domain writes |
| `field-ops-app-vite/src/domain/inventoryReorderRequests.js` | domain writes |
| `field-ops-app-vite/src/domain/jobActions.js` | domain writes |
| `field-ops-app-vite/src/domain/reorderPurchaseOrders.js` | domain writes |
| `field-ops-app-vite/src/firebase/collectionStore.js` | **generic write shim** — 13 consumers |
| `field-ops-app-vite/src/lib/firebaseSafe.js` | **generic write gate** (demo/panic mode) — 5 consumers |

Four domain modules plus two shims. The two shims are where the leverage is: they are the funnel
through which the 13 + 5 guard-invisible consumers write, so re-pointing them is a
bounded-blast-radius change, and the four domain modules are the only direct client writes left.

Cross-check against Rules: nine collections are client-writable, and only six browser modules can
write. Rules therefore permits more client write surface than the app currently uses.

### 5.3 Class 3 — browser business reads (44 modules)

Of 55 `frontend.firestore_client` files: 43 read-only, 1 both read and write, 5 write-only, 6 with
neither a read nor a write API detected (type-only imports, re-exports, query-builder helpers).
Read surface **44**, write surface **6**.

Whether these are *authoritative* reads or convenience caches over a callable result was not
determined per module and is listed under UNPROVEN.

### 5.4 Class 4 — Functions business transport (179 endpoints)

| | Count |
|---|---|
| Endpoints exported from `functions/src/index.ts` | **179** |
| `onCall` | 178 |
| `onSchedule` (`pollEmailMailboxes`) | 1 |
| Firestore triggers | **0** |
| LIVE_BUSINESS_TRANSPORT (browser string-literal reference, comments stripped) | **152** |
| No browser reference | **27** |
| DEAD_RETIREABLE | **0** |
| Frontend callable-client modules | **55** |
| Server `firebase-functions` runtime modules | **72** |

**Exactly 1 of 179 has a name-matched Render replacement: `revokeRole`.** Derived by intersecting the
179 exported names with the Render EOS API's closed operation lists — `ADMIN_READ_OPERATIONS` (9,
`functions/src/adminPolicy/adminPolicyApi.ts:73-87`), `ADMIN_MUTATION_OPERATIONS` (15, lines 89-108)
and `OPERATIONS_READ_OPERATIONS` (1, `functions/src/eosOps/eosOpsHttp.ts:37`). 25 named Render
operations against 179 Firebase endpoints; intersection = `{revokeRole}`.

Two more are near-matches that are *not* name-identical and so are not counted: Render `assignRole`
against Firebase `assignApprovedRole`/`grantRole`, and Render `resolveMyCapabilities` against
Firebase `resolveEffectiveAccessCallable`.

**The 27 endpoints with no browser reference are not retirement candidates.** They are deployed,
registered, invocable with a valid ID token, and several are write commands
(`createSupplier`, `issueInvoice`, `recordRefund`, `grantRole`, `receiveInventoryStock`,
`setTechnicianWorkingAvailabilityCallable`). An endpoint no UI calls is still reachable transport.

### 5.5 Class 5 — `roleAssignments` compatibility authority

**Transitional runtime compatibility authority. Not dead. Not the future authority — PostgreSQL is.
Not removable while the shipped resolver depends on it.**

Resolved by execution, not grepped, per the brief's warning. Same type-stripping + loader-hook
technique, zero `node_modules`:

| Executed fact | Value |
|---|---|
| `PERMISSION_CATALOG` size | **147** |
| `COMPATIBILITY_ROLES.admin.permissions` | **147** — the whole catalogue, spread |
| `COMPATIBILITY_ROLES.dispatcher` | 42 |
| `COMPATIBILITY_ROLES.technician` | 8 |
| `GOVERNED_BUSINESS_ROLES` | **45** roles |
| `GOVERNED_BUSINESS_ROLES.owner` | **147** — derives from `ADMIN_ROLE` |
| `GOVERNED_BUSINESS_ROLES.generalEmployee` | 0 |

Both `admin` and `owner` hold the entire 147-permission catalogue. This is exactly the trap the brief
names: grepping a role name against a permission id finds nothing, because the grant is a spread and
a derivation, not a literal.

**`roleAssignments` is the sole source of an ALLOW — proven by execution.** Driving the shipped
`resolveEffectivePermission` directly:

| Input | Decision |
|---|---|
| `assignments: []` | `DENY / noQualifyingGrant` |
| one `status:"active"` admin assignment, global scope | **`ALLOW / qualifyingGrant`** |
| same document, `status:"disabled"` | `DENY / noQualifyingGrant` |
| same document, `roleId:"technician"` | `DENY / noQualifyingGrant` |
| same document, `roleId:"owner"` | `ALLOW` |
| unknown `roleId` | `DENY / noQualifyingGrant` |
| `assignments: null` | `DENY / malformedAssignments` |
| unknown `permissionId` | `DENY / unknownPermission` |

Swept **all 147 catalogue permissions** with `assignments: []`: **zero ALLOWs.** An active
`roleAssignments` document is a necessary condition for every ALLOW in the system. The collection is
read per request in **23** `functions/src` modules, and the resolver is called at **20** call sites
across **20** modules.

**A stale comment worth correcting:** `functions/src/access/resolveEffectivePermission.ts:8-11` says
*"This function decides nothing on its own; no Rule or Function calls it yet (that is a later,
separately-authorized row)."* It is wired into 20 live call sites including
`trustedWriterCommands.ts`, `financeReadCallables.ts`, `partMasterCommands.ts`,
`reportExecutionService.ts`, `dataImportCallables.ts` and six `*CallableWiring.ts` modules. The
comment is wrong and has been for some time.

### 5.6 Class 6 — config / reference authority held in Firebase: **33 authorities, 22 Firebase-only**

**74** distinct Firestore collection names are referenced from runtime code (29 declared centrally in
`functions/src/constants/collections.ts`, the rest as local `*_COLLECTION` constants; almost nothing
uses a bare `collection("…")` literal). Of those, **33** hold configuration or reference authority
rather than transactional business records. **11 already have an equivalent PostgreSQL table**, so
they are duplicate authorities awaiting cutover; **22 are Firebase-only**.

**First, the good news, which corrects an implication in the brief.** Every *major* config authority
is a **committed repository file, not a Firestore document**:

| Candidate authority | Where it actually lives |
|---|---|
| Firebase Remote Config | **does not exist** — zero references anywhere |
| `firebase-functions/params` (`defineString`/`defineSecret`) | **never used**; the guard explicitly exempts the module (`firebaseExitGuard.mjs:128`) and the three mentions are comments explaining why secrets are names, not params |
| Feature flags / readiness | `config/environments.json` → `scripts/resolveEnvironment.mjs:278-283` → `vite.config.js:113` (`__APP_READINESS__`) |
| Firebase Web project config | `config/environments.json` → `resolveEnvironment.mjs:260-268` → `vite.config.js:109` → `firebase/firebase.js:22-41`. Public Web config only. |
| Admin-policy seed | `policySeedSnapshot.json`, **generated** by `scripts/buildAdminPolicySeedSnapshot.mjs:184` from the client metadata registry, consumed at `adminPolicy/seed/policySeed.ts:44` and written to **Postgres** via `PostgresPolicyRepository`. **No Firestore document is involved.** |
| Object/field metadata (28 entities / 389 fields) | `field-ops-app-vite/src/metadata/definitions/*.js`, mirrored into Postgres `objects`/`object_fields` |
| Reporting object/field catalog | `functions/src/reporting/reportCatalog.ts` + parity-proven client twin |
| Operating-company registry | hardcoded constant, `ownership/operatingCompanyAuthority.ts:30-52`; the `operating_companies` collection constant is declared and **never read** (`warehouseRootCompanyAssignment.ts:52` literally `void`s it) |

`functions/src/adminPolicy/` contains exactly **one** file importing Firestore at all
(`migration/firestorePolicyParityHarness.ts`), and that is a migration parity harness — the policy
subsystem is genuinely Firebase-free.

**What is actually Firebase-held:**

| Group | n | Collections | Postgres equivalent today |
|---|---|---|---|
| Numbering sequence state | 1 | `counters` (WO, SO, opportunity, transfer, receiving, reorder, agreement, invoice) | none |
| Email transport / routing config | 3 | `email_connections`, `email_mailboxes`, `email_routing_rules` | none |
| Financial policy | 1 | `financial_policy_profiles` (per-company accounting policy + LOCK state) | none — **and its only command module is unreachable**, see §5.7 |
| Scheduling availability config | 2 | `technician_working_availability`, `technician_blocked_time` | none |
| Part / procurement reference masters | 5 | `parts`, `part_aliases`, `part_supplier_items`, `manufacturers`, `supplier_catalog` | `supplier_catalog_items` only |
| Equipment reference masters | 4 | `equipment_models`, `equipment_model_aliases`, `equipment_part_compatibility`, `equipment_compatibility_sources` | `equipment_models` only |
| Supplier master | 1 | `suppliers` | `suppliers` |
| Location / custody reference | 5 | `warehouses`, `bins`, `trucks`, `mobile_locations`, `fieldops_technicians` | all but `fieldops_technicians` |
| Access / identity configuration | 3 | `users`, `roleAssignments`, `employees` | `principals`, `tenant_memberships`, `user_role_assignments`, `roles`, `role_capabilities`, `employee_principal_links` |
| Targets / coverage / saved definitions | 4 | `performance_goals`, `sales_territories`, `commercial_coverage_assignments`, `reportDefinitions` | none |
| Uniqueness / claim registries | 4 | `employee_number_registry`, `usernames`, `bin_code_claims`, `location_truck_claims` | `bin_code_claims` only |
| **Total** | **33** | | **11 have a Postgres equivalent; 22 are Firebase-only** |

Two collections are **Rules-declared ghosts** with zero runtime reads: `permissions`
(`firestore.rules:1676`) and `roles` (`firestore.rules:1680`), both superseded by the Postgres
`capabilities` / `roles` / `role_object_permissions` tables. `supplier_catalog` is nearly a third —
declared at `firestore.rules:1260` with no `functions/src` read path.

One orphaned authority worth recording: `field-ops-app-vite/src/services/operationsQueries.ts:182,193`
names the Firestore `purchase_orders` collection **dormant** and routes the live UI at
`reorder_purchase_orders` instead — and its only server writer, `functions/src/procurementService.ts`,
is in the unreachable set (§5.7). A live Postgres `purchase_orders` table sits beside it.

### 5.7 Class 7 — dead-retireable runtime: **4 files, reproduced exactly**

Retirement priority **7 of 7** — last, per Owner ruling. Not a place to spend effort now, and
explicitly not a lever for reducing counts.

**The prior census's figure of 4 is confirmed.** All four are the frozen Cycle Count v1 family, and
each declares its own status in its first line: `FROZEN -- CERTIFICATION HISTORY ONLY (Decision #179)`.

| # | File | In the 296? | Exported from `index.ts`? | Fenced imports |
|---|---|---|---|---|
| 1 | `functions/src/cycleCount/cycleCountCallables.ts` | yes | **no** | `firebase-functions/v2/https`, `firebase-admin/firestore` |
| 2 | `functions/src/cycleCount/cycleCountCommand.ts` | yes | **no** | `firebase-admin/firestore` |
| 3 | `functions/src/cycleCount/cycleCountCommandComposition.ts` | yes | **no** | `firebase-admin/firestore` |
| 4 | `functions/src/cycleCount/cycleCountRepository.ts` | yes | **no** | `firebase-admin/firestore` |

`cycleCountCallables.ts:1-5` states it directly: *"No deployed function reaches it: index.ts exports
only the A1 sheet/line callables (`cycleCountSheetCallables.ts`). It remains solely because the frozen
Certification tooling (`functions/scripts/certificationWorld/*`) and its tests drive it."* Verified:
`grep -cE "[\"']\./cycleCount/cycleCountCallables(\.js)?[\"']" functions/src/index.ts` → 0 for all four.
Every capability id in the family is registered `active: false`, so the resolver denies for every
principal regardless of grant.

They are **retireable, not urgent**: deleting them would break the frozen Certification tooling that
is their only caller, and per the Owner ruling this class moves last.

**Confirmed twice, independently.** A second pass built the reachability graph with the
`functions/lib/**.js → functions/src/**.ts` remap applied (tests and operator CLIs import the
*compiled* output, which is absent from this worktree — without the remap the naive graph reports 14
false zero-importer files, and my own first pass reported 15 for exactly that reason). It also added
the **second server entrypoint** that `functions/src/index.ts` alone misses:
`render.yaml:57-75` → `functions/package.json:10` → `functions/scripts/serveEosApi.mjs`. That
entrypoint reaches **0 of the 296** — it is the pure-Postgres Admin Policy API, which is itself a
useful confirmation.

With all three entrypoints (`functions/src/index.ts`, `field-ops-app-vite/src/main.jsx`,
`functions/scripts/serveEosApi.mjs`), the same four files fall out as the set where the code's own
declaration and the graph **agree**: `cycleCountCallables.ts` has zero importers anywhere;
`cycleCountCommandComposition.ts` is in a dead subgraph; and `cycleCountCommand.ts` and
`cycleCountRepository.ts` are reached only through `import type` at
`cycleCount/cycleCountCallableWiring.ts:21` — type-only imports are erased at compile, so no deployed
function reaches their Firebase code at runtime.

**The figure depends entirely on the definition, and only one definition yields 4.** All of these are
measured, not estimated:

| Definition | Count |
|---|---|
| Literally zero importers anywhere in the repository | **2** |
| **Self-declares non-liveness AND the graph confirms it is unreachable at runtime** | **4** ← the prior census's figure |
| Unreachable from any of the three entrypoints | **28** |
| …plus runtime-dead through `import type` erasure | **30** |
| Zero local `src` importers, without the `lib/→src/` remap (the naive graph) | 14-15 |

So **4 is reproducible, but only under the self-declaration-plus-graph definition.** Anyone re-running
this with a different definition will get 2, 28 or 30 and should not read that as drift. The likely
origin of a naive "4" would be a graph stopping at `functions/src/index.ts` with test and CLI
importers counted as liveness — which would collapse the `equipmentCompatibility`,
`warehouseGovernance` and `supplierMaster` clusters into "live".

The 28-unreachable breakdown: 2 zero-importer, 10 test-only, 3 test-plus-operator-CLI, 13 in dead
subgraphs (imported only by other unreachable files). One clean worked example of a superseded
subgraph: `accountPageComponents.js:145-150` records the opportunities/salesOrders related lists as
SUPERSEDED and re-wired through `metadata/callableListSource.js`, which
(`callableListSource.js:29-38`) deliberately re-implements the invocation rather than importing the old
clients — leaving `accountOpportunitiesReadCallableClient.js` and
`accountSalesOrdersReadCallableClient.js` fully dead.

**A trap to record: self-declared inertness is not evidence of death.** 27 of the 296 self-declare
non-liveness in their first fifteen lines, but most are **inert-by-deployment** — exported from
`index.ts`, capability-gated, simply not activated. Eleven are self-declared inert yet **provably
live-reachable**, so their headers are stale prose: `inventoryReceiving/receivingRepository.ts:1-2`,
`receiveInventoryStockCommand.ts:7`, `receiveInventoryStockComposition.ts:6`,
`receivingLocationResolver.ts:7`, `inventoryLedger/operationalMovementRepository.ts:1-2`,
`warehouseGovernance/receivingLocationOptionsService.ts:1-4`, `governedWarehouseValidation.ts:7`,
`supplierMaster/supplierMasterValidation.ts:6` (says "nothing imports it at runtime yet" — it is
reachable from `index.ts`), `reporting/runReportDefinitionCallable.ts:9`,
`savedDefinitionCallables.ts:10`, `partMaster/partSupplierItems.ts:5`. Retiring on a header comment
alone would have deleted live code.

| Dead-runtime measure | Value |
|---|---|
| **DEAD_RETIREABLE (self-declared + graph-confirmed)** | **4** |
| Literally zero importers anywhere | 2 |
| Unreachable from any entrypoint | 28 |
| …plus `import type`-erasure runtime-dead | 30 |
| Self-declared non-live but provably live-reachable (stale headers) | 11 |
| DEAD_RETIREABLE **endpoints** (of 179) | **0** |

## 6. Identity vs business — the carve-outs, named

The baseline records 7 identity entries across three sections. They are **not** fenced:
`baselinePathsFor` is only ever called for the twelve business category keys, so these sections are
inert documentation. Six distinct files:

| File | Identity category | Also a business-runtime file? |
|---|---|---|
| `field-ops-app-vite/src/auth/AuthContext.jsx` | `frontend.firebase_auth` | **no — identity-only** |
| `field-ops-app-vite/src/firebase/firebase.js` | `frontend.firebase_auth` | yes (also the `db`/`functions` shim) |
| `functions/src/access/adminCredentialCallables.ts` | `server.firebase_auth` | yes |
| `functions/src/access/claimsWriter.ts` | `server.firebase_auth` | **no — identity-only** |
| `functions/src/access/trustedWriterCommands.ts` | `server.firebase_auth`, `server.firebase_admin_app` | yes |
| `functions/src/index.ts` | `server.firebase_admin_app` | **no** by import signature (`firebase-admin/app` only, line 3) — but it is the deployment manifest for all 179 endpoints |
| `functions/src/eosApi/server.ts` | **not in the baseline at all** — bare `firebase-admin`, lines 105-106 | **no — identity-only**, zero Firestore calls |

`eosApi/server.ts` is the known identity-only bare-`firebase-admin` importer and is **not** a business
dependency, confirmed by inspection: `app.auth().verifyIdToken(bearerToken)`, `uid` only, custom
claims deliberately unread (`server.ts:111-112`).

Three of the seven identity-carve-out files are *also* business-runtime files. Identity and business
are separable as *import classes*, but not as *files* — a point that matters for any future
identity-migration lane.

---

## 7. Retirement priority picture (Owner ruling order)

| Priority | Class | Size at `64008d5a` | What blocks it | Named replacement? |
|---|---|---|---|---|
| **1** | Rules business authorization | 69 sites · 9 client-writable collections · 3 state machines | The 26 untracked Employee/technician sites are outside the convergence gate and outside the capability engine; 14 of 21 corpus collections have **no governed permission defined at all** | No. `firebase_business_authorization_rules: 0` is a target with no enforcement mechanism. |
| **2** | Browser business writes | **6 modules** (4 domain + 2 shims), 13+5 shim consumers | Nine collections stay client-writable in Rules regardless; retiring the modules without hardening Rules leaves the hole open | No |
| **3** | Browser authoritative business reads | 44 modules (95 import the `db` shim) | Which reads are *authoritative* vs cache is undetermined — see UNPROVEN | No |
| **4** | Functions-only business transport | 179 endpoints (178 `onCall` + 1 `onSchedule`), 55 browser clients, 72 server modules | The Render API exposes **25** named operations against 179 endpoints, and **`VITE_EOS_API_BASE_URL` is set in no committed environment** | **1** — `revokeRole` |
| **5** | `roleAssignments` authority | 1 collection · 23 reader modules · 20 resolver call sites · 147 permissions | It is the **sole source of an ALLOW** (proven). Removing it denies everything. PostgreSQL is the future authority; the cutover is not built. | Partial — Render `assignRole`/`revokeRole`/`resolveMyCapabilities` |
| **6** | Firebase-held config / reference authority | **33** authorities, **22** Firebase-only, of 74 runtime collections | 11 are duplicate authorities already mirrored in Postgres with no cutover built; the 22 Firebase-only include all numbering sequence state, email transport/routing config and financial policy profiles | Partial — 11 of 33 have a Postgres table |
| **7** | Proven-dead runtime | **4** self-declared+graph-confirmed; **28-30** unreachable from any entrypoint; **0** dead endpoints | Its only callers are the frozen Certification tooling and its tests. Nothing else blocks it. | n/a |

**The ordering is not the ordering the mechanisms encourage.** The only enforced mechanism in the
repository (the firebaseExitGuard ratchet) counts *files with fenced imports*, which is priority 2/3/4
territory. Priority 1 — Rules business authorization, the Owner's first priority — has a stated
target of zero and **no enforcement at all**; the one gate that touches it covers 43 of 69 sites and
would read zero with 26 live authorization decisions still in Rules.

### 7.1 The Render reachability finding — the brief is right, and it is worse than stated

Four prior lanes tripped on stale "NOT DEPLOYED" comments. **Both stale comments named in the brief
are still present and still wrong, and I found a third and a fourth.**

| Location | Text | Status |
|---|---|---|
| `functions/src/eosApi/server.ts:19-23` | `════ NOT DEPLOYED ════ … there is no Render service, and creating one needs Owner action.` | **Still present. Contradicted by `render.yaml`**, which declares the `eos-api-nonprod` web service and the `eos-policy-nonprod` database, and which was edited as recently as 2026-09-10 (origin rename to `verenwardeos.vercel.app`). |
| `field-ops-app-vite/src/services/adminPolicyApiClient.js:26` | "`VITE_EOS_API_BASE_URL` is absent in every environment today, because no EOS API is deployed." | **Still present.** The premise ("no EOS API is deployed") is wrong for the same reason. The *conclusion* happens to hold — see below. |
| `functions/src/access/resolveEffectivePermission.ts:8-11` | "no Rule or Function calls it yet" | **Wrong** — 20 live call sites (§5.5). |
| `firestore.rules:1141-1143` | cites `reorder_requests` create as precedent for unvalidated create | **Wrong** — that rule is now `if false` (§5.1). |

On browser reachability, the repository evidence is stronger than "most Postgres authorities are
unreachable":

- Exactly **one** frontend module talks to the Render API at all:
  `field-ops-app-vite/src/services/adminPolicyApiClient.js`, consumed by 4 administration modules.
  It is the only `fetch()`-based service client in `field-ops-app-vite/src/services/`.
- The Render surface is **25 named operations** (9 admin reads + 15 admin mutations + 1 operations
  read) plus `/health`. `/operations/*` exposes exactly one operation, `resolveMyCapabilities`
  (`eosOpsHttp.ts:37`), described in-file as a P0 proof of the identity → principal → Postgres path.
- `VITE_EOS_API_BASE_URL` is set in **no** committed environment. It appears only in
  `adminPolicyApiClient.js` (lines 26, 75, 116) and in
  `docs/architecture/eos-policy-nonprod-activation.md:275`, which states plainly that absent means
  "the panels report NOT CONFIGURED, which is the current state everywhere."

So *by repository evidence*, **zero** Postgres authorities are reachable from a browser at this
baseline — not "most are unreachable" — because the one client that could reach them has no base URL.
Whether the Vercel environment sets that variable out-of-band, and whether the blueprint is actually
deployed, are outside the repository and are listed under UNPROVEN. Neither was contacted.

---

## 8. Executed vs read

**Executed** (exit code captured directly from the process, never read from a log tail):

| Claim | How |
|---|---|
| 296 business-runtime files; 0 violations; 0 stale — at **both** commits | `scanTree` + `evaluateGuard` from `scripts/firebaseExitGuard.mjs`, run against the live tree and against `git archive d104cf49` materialised to scratch |
| 60 type-only / 236 value-using | statement-level import classifier over the 296 |
| 179 endpoints; 178 `onCall` + 1 `onSchedule` + 0 triggers | parser over `functions/src/index.ts` + declaration-form probe |
| 152 live / 27 no-browser-reference | comment-stripped string-literal scan of `field-ops-app-vite/src` |
| 1 of 179 name-matched Render replacement (`revokeRole`) | set intersection with the three Render closed operation lists |
| `totalLegacySites()` = 43; 21 collections; 14 coverage gaps; per-row burn-down | shipped TS executed with `--experimental-strip-types` + `lib`→`src` loader hook, zero `node_modules` |
| Convergence gate **7/7 pass, exit 0** | `node --test functions/test/legacyAuthorizationSurface.test.mjs` via the same hook |
| Gate D1/D2 **can** fail; D3 is entailed | mutation of scratchpad copies of `firestore.rules` + re-parse |
| 147 permissions; `admin` and `owner` = all 147; 45 governed roles | shipped `permissionCatalog.ts`, `compatibilityRoles.ts`, `governedBusinessRoles.ts` executed |
| `roleAssignments` is the sole source of an ALLOW | shipped `resolveEffectivePermission` driven over 8 input shapes + a 147-permission sweep with `assignments: []` |
| Wave-1 Firebase delta = 0 (imports, call sites, collections, baseline, Rules) | `git diff` + comment-stripped call-site counts at both commits |
| 48 / 228 / 0 guard-invisible transitive reach | local import graph built per root |
| 95 `allow`; 69 authorization sites; 9 client-writable; 3 state machines; byte-identical Rules mirror | `firestore.rules` parse + `diff` + `md5sum` |
| Only bare-`firebase-admin` importer has 0 Firestore calls | grep over the three roots |

**Read, not executed:**

| Claim | Why not executed |
|---|---|
| CI supplies `--previous-baseline`, so the ratchet is genuine in CI | `.github/workflows/firebase-exit-guard.yml` needs GitHub event context |
| `render.yaml` declares `eos-api-nonprod` + `eos-policy-nonprod` | No production or platform contact permitted |
| `adapt()` returns `onCall({region:"us-central1"}, …)` | Read at `schedulingCallables.ts:31-49` |
| Identity verifier takes only `uid` | Read at `eosApi/server.ts:105-118` |
| The 27 no-browser-reference endpoints are deployed and invocable | Deployment state is outside the repository |

**Not run, and why:** the Firestore emulator (no JRE; port 8080 held by an unrelated `uvicorn`,
pid 187), so no Rules unit test, no emulator e2e, and no `functions/test/e2e/*` suite. No Firestore
read or write of any kind was performed. `functions/lib` is absent and was **not** built — building it
would have modified the worktree.

---

## 9. UNPROVEN

1. **Whether the 4 DEAD_RETIREABLE files could be deleted without breaking the frozen Certification
   suite.** They are confirmed absent from the deployment manifest, but the Certification tooling that
   drives them was not run (`functions/lib` is absent and was not built).
2. **Whether the Render EOS API is actually deployed for nonprod.** `render.yaml` declares the
   blueprint; deployment state is outside the repository and no platform was contacted.
3. **Whether `VITE_EOS_API_BASE_URL` is set in the Vercel environment.** Absent from every committed
   file. If set out-of-band, the admin policy panels reach Render; if not, zero Postgres authorities
   are browser-reachable.
4. **Which of the 44 browser reads are *authoritative*** versus caches/projections over a callable
   result. Determines whether class 3 is 44 modules or materially fewer.
5. **The prior census's 128/42/9 endpoint partition.** No prior census artifact exists in the
   repository, so its method cannot be re-run. My 152/27/0 uses a stated and reproducible method;
   the two are not reconcilable without the original.
6. **Live Firestore behaviour of any rule.** No emulator available. Every Rules claim is a static
   read of `firestore.rules` at `64008d5a`.
7. **Whether the 27 no-browser-reference endpoints are invoked by anything other than the browser**
   (operator scripts, the scheduled function, integrations, or Postman). Not determinable statically.
8. **Runtime collection inventory completeness.** The 74 names come from `constants/collections.ts`
   plus every local `*_COLLECTION` constant plus static literals; a dynamically composed path would be
   missed.
9. **Which of the 33 Firebase-held config authorities are still WRITTEN vs only read.** Read paths
   were traced; write paths were not enumerated per authority.

---

## 10. Corrections to the brief

| Brief statement | Verdict |
|---|---|
| 295 BUSINESS_RUNTIME files → 235 real surface | **Off by one.** 296 / 60 / **236**. The missed file is `reorderCallableClient.js` (dynamic import nested in `Promise.all`). |
| 9 inert-registered endpoints | **Do not exist.** All 9 are real `onCall` handlers behind an `adapt()` wrapper or an aliased re-export. Parser artifact. |
| 128 LIVE / 42 unreachable | **Not reproducible** — no prior artifact. My method gives 152 / 27. |
| "The convergence guard is a tautology that cannot fail" | **Wrong for the gate; right for two assertions.** D1/D2/D4 fail under mutation (demonstrated). D3 is entailed by D1+D2; D7's closing assertion is trivially true. The gate's real defect is **scope** (43 of 69), not logic. |
| Two state machines in Rules | **Three.** The equipment lifecycle machine (`equipmentTransitionAllowed`, 1419-1426, enforced 1546) was missed. |
| A bare `node scripts/firebaseExitGuard.mjs` "BOOTSTRAPS a baseline" | **Imprecise.** Nothing is written. It runs the exact-match check in full and *skips* the ratchet. The operational conclusion — a bare run is not a green ratchet — is correct. |
| The `firebase_admin_firestore` subpath gap lets bare `firebase-admin` evade the fence | **Correct, and currently unexploited.** The only bare importer makes zero Firestore calls. Closing it naively would add exactly 1 file — the identity carve-out — as a false business dependency. |
| 50 of 406 `functions/src` files reach Firestore only through a shim | **48 of 428.** Substance correct. The frontend's equivalent, **228 of 825**, is larger and was not previously reported. |
| `eosApi/server.ts:19-23` carries a stale "NOT DEPLOYED" comment | **Confirmed, still present, still wrong.** Plus three more stale/incorrect comments found: `adminPolicyApiClient.js:26`, `resolveEffectivePermission.ts:8-11`, `firestore.rules:1141-1143`. |
| "Most Postgres authorities are unreachable from a browser" | **Understated.** By repository evidence **none** are: the single Render client has no configured base URL in any committed environment. |
| 69 Rules sites, 43 tracked; the gate could reach zero with operational-role authorization untouched | **Confirmed exactly.** 43 = 40+2+1 legacy-role predicates; 26 untracked = 16 operational-role + 3 warehouse-scoping + 7 technician actor-binding. |
| 9 client-writable collections | **Confirmed.** |
| Only 4 DEAD_RETIREABLE | **Confirmed, definition-dependent.** 4 = self-declared frozen AND graph-confirmed unreachable (the Cycle Count v1 family, Decision #179). Zero-importers-anywhere = 2; unreachable from any entrypoint = 28; with `import type` erasure = 30. |
| `inventory_actions` create is Rules-only, no validation, no actor binding | **Confirmed** (line 1156). Its in-file justification cites a precedent that no longer exists. |
| reorder workflow at `firestore.rules:763-1001` | **Confirmed exactly.** |
| `roleAssignments` is transitional authority and the sole source of an ALLOW | **Confirmed by execution** — 147-permission sweep, zero ALLOWs without an active assignment. |
| `compatibilityRoles.ts` spreads the catalogue onto `admin`; `owner` derives from `ADMIN_ROLE` | **Confirmed by execution** — both hold all 147. |
| *(not in the brief)* Firebase holds the major config authorities | **No** — the policy seed, object/field metadata, reporting catalog, feature flags, Firebase project config and operating-company registry are all **committed repo files**; `adminPolicy/` has exactly one Firestore importer, a migration parity harness. Remote Config and `firebase-functions/params` are used nowhere. |
| *(not in the brief)* A single `functions/src/index.ts` entrypoint bounds server reachability | **No** — `render.yaml:57-75` → `functions/package.json:10` → `functions/scripts/serveEosApi.mjs` is a **second** server entrypoint. It reaches **0 of the 296**, which is itself the cleanest evidence that the Render API is Firebase-free. |
| *(not in the brief)* Self-declared inertness can be used to retire code | **No** — 11 of the 296 self-declare non-liveness yet are provably reachable from `index.ts`. Retiring on a header comment would delete live code. |
