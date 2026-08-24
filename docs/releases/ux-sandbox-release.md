# UX Sandbox Release — `eos-platform-sandbox`

**2026-08-24.** Release of the accumulated UX / object-list work. A **runtime release**, not a data
rebuild.

| | |
|---|---|
| **release SHA (code)** | `7297d263` |
| **deployed / stamped SHA** | `eaaabead` — identical code, +3 non-shipping files (see §12) |
| **previously deployed** | `d116d381` (built 2026-08-23T16:13:20Z) ← **rollback artifact** |
| commits released | **18** |
| `firestore.rules` | **UNCHANGED** — no Rules deploy |
| `firestore.indexes.json` | changed (+2 `accounts` composites) |

---

## §2 — Source check

```
branch      release-check @ origin/main
HEAD        7297d263c4fa555f835d0cadd676bd6bedc8fc2f
origin/main 7297d263c4fa555f835d0cadd676bd6bedc8fc2f   MATCH
tree        clean, no untracked deployment-affecting files
```

All 18 commits between `d116d381` and `7297d263` are merged `main`. No topic branch.

---

## §8 — The deploy path, re-read at current main

`scripts/_sandboxRefresh.run.sh` was read again rather than trusted from memory. **Proven
runtime-only:**

| it does NOT | evidence |
|---|---|
| reset Certification World | no `certificationWorld` invocation anywhere in the script |
| seed / reseed | no seed call |
| delete collections | no delete of any kind |
| revoke or reapply grants | no `roleAssignments` write |
| rewrite operational data | no Firestore write at all |

What it **does**: structural guard → build functions → deploy Functions in **named batches** →
verify build base → build frontend for `platform-sandbox` → verify the artifact belongs to this
project → deploy Hosting → verify the deployed revision → verify callables → **compute** whether
Rules/indexes changed and report.

Two safety properties worth naming: batches use no `|| true`, so a failed batch **stops** the script
rather than shipping a frontend that calls callables which are not there; and the Rules/index check
is *computed* against the commit the sandbox is actually serving, because an earlier version carried
a hardcoded "unchanged vs …" note — the kind of claim that silently stops being true.

> The script's own header says it is *"intentionally NOT run by any agent session — deploy is a
> human-triggered action."* That general policy is superseded here by the Owner's explicit, current
> authorization to release this work to sandbox. Recorded rather than quietly overridden.

---

## §5 / §6 — Components

| component | required | why |
|---|---|---|
| **Hosting** | **YES** | the entire UX release |
| **Functions** | **YES** | 4 new callables |
| **Rules** | **NO** | `firestore.rules` byte-identical to the deployed commit |
| **Indexes** | **YES, separately** | see below |

**New callables:** `recordWorkOrderLabor` · `correctWorkOrderLabor` · `getWorkOrderLabor` ·
`getPartBalances`. No callable removed.

### Indexes — the finding that matters, after being wrong about it twice

**Measured against the live estate, not the repository.**

| | |
|---|---|
| live composite indexes | **38** |
| declared in `firestore.indexes.json` | **37** |
| a reconciling deploy would CREATE | **2** |
| a reconciling deploy would **DELETE** | **3** |

```
WOULD BE CREATED
  + accounts | lineOfBusiness:CONTAINS, updatedAt:DESC
  + accounts | status:ASC, lineOfBusiness:CONTAINS, updatedAt:DESC

WOULD BE DELETED          <-- the reason no index deploy was run
  ! equipment_models | manufacturerId:ASC, displayName:ASC
  ! equipment_models | status:ASC, displayName:ASC
  ! equipment_models | status:ASC, manufacturerId:ASC, displayName:ASC
```

Three `equipment_models` indexes are **live and undeclared**. `firebase deploy --only
firestore:indexes` reconciles live state to the declared set, so running it would delete them —
precisely the destruction `indexDriftGuard.mjs` exists to prevent.

**No index deploy was performed.** That is this release's one deliberate omission.

#### What I got wrong on the way here, and why it matters

I first reported *"8 live, 37 declared, 29 pending — an index deploy is purely additive: 29 creates,
0 deletes."* Every number in that sentence was wrong, and the final clause was wrong **in the
dangerous direction**: acting on it would have deleted three live indexes.

The source was `PENDING_DEPLOY_INDEX_KEYS` in `scripts/indexDriftGuard.test.mjs` — a hand-maintained
list whose companion assertion states the live estate is 8. It is 38. The guard still **passes**,
because it compares `declared − pending` against its own hardcoded 8: internally consistent, externally
false, and therefore unable to catch the very drift it was written for.

The correction came from asking the environment — `firebase firestore:indexes`. Which is the standing
rule this release kept relearning: **environment state comes from the environment**, never from a
repository record of what the environment is believed to contain.

*(Recorded, not fixed — §21 keeps release and development separate. The stale guard is a follow-up.)*

#### What this actually costs

Far less than the wrong version implied:

| capability | index | status |
|---|---|---|
| Part Master — Status filter | `parts: status, internalPartNumber` | **LIVE** ✓ |
| Part Master — Stocking Class filter | `parts: stockingClass, internalPartNumber` | **LIVE** ✓ |
| Part Master — both together | `parts: status, stockingClass, internalPartNumber` | **LIVE** ✓ |
| Accounts — Status filter | `accounts: status, updatedAt` | **LIVE** ✓ |
| Accounts — Relationship filter | `accounts: relationshipTypes, updatedAt` | **LIVE** ✓ |
| Accounts — Status + Relationship | `accounts: status, relationshipTypes, updatedAt` | **LIVE** ✓ |
| **Accounts — Line of Business filter** | `accounts: lineOfBusiness, updatedAt` | **NOT LIVE** |

So **every filter and sort in this release works in sandbox except the Account Line of Business
filter** — the one capability this release added indexes for. Selecting it will fail at read time
until those two indexes exist.

Unfiltered lists and default sorts are unaffected: they run on the single-field indexes Firestore
maintains automatically.

---

## §3 — Pre-release state snapshot (read-only)

Captured with `functions/scripts/_releaseStateSnapshot.mjs`, which writes nothing, refuses any
project named production, and is **marker-aware** so certification records are never confused with
legitimate sandbox records.

**Certification World** — `verify` mode, writes nothing:

```
COMPLETE
expected version : 1.6.0
versions found   : 1.6.0
deployment record: 1.6.0 from 07350ba3 at 2026-08-23T10:05:39.386Z
expected records : 1092
installed records: 1092
```

**Everything else**, at `2026-08-24T17:48:02Z`:

| | |
|---|---|
| Accounts | **103** total · 1 Prospect · 97 Active · 100 certification-marked |
| Equipment (installed) | **288** — Taylor 157 · Ventana 121 · unrecorded 10 · 278 marked |
| Serialized assets | **34** — available pool **32** · installed 2 |
| Inventory | warehouse **575** · mobile **165** · company-owned **740** · **0** negative positions · 103 ledger rows |
| Governed access | **113** roleAssignments — **110 active**, 3 disabled |
| Purchasing | certification POs **0** ✓ · certification receipts **0** ✓ · legitimate receipts 2 |
| Parts | 52 |

### Two measurement bugs found and fixed before trusting the numbers

The first draft of the snapshot reported **`0 active grants`** and **`288 of 288 equipment
available`**. Both were wrong, and both were *my predicates*, not the sandbox:

1. `roleAssignments.status` is lowercase `"active"`; the check compared against `"ACTIVE"`. That is
   the most alarming possible false alarm — a healthy sandbox reported as having lost every grant.
2. `currentEquipmentId` does not exist on `equipment` at all; it lives on `serialized_assets`. Every
   row matched `== null`, so the entire installed base was reported as "available".

Both now measure the right field, and the raw status breakdown is printed rather than a single
derived count. **A snapshot that reports a false alarm is worse than none**, because the next real
change gets read as noise.

One honest gap: the available serialized pool's line of business is **unrecorded** — those assets'
parts carry no `lineOfBusiness`, so the Taylor/Ventana split §3 asks for is not derivable. Reported
as unrecorded rather than split by inference.

---

## §4 — Preservation manifest

These must be **identical** after the deploy. Anything that moves stops the release (§13).

| invariant | pre-release value |
|---|---|
| Certification World version | `1.6.0`, COMPLETE, 1092/1092 |
| Certification World reset | **must not occur** |
| Accounts total / Prospect | 103 / 1 |
| Equipment installed | 288 (Taylor 157, Ventana 121) |
| Serialized available pool | 32 |
| Inventory warehouse / mobile / company | 575 / 165 / 740 |
| Negative part positions | **0** |
| roleAssignments active / disabled | 110 / 3 |
| Certification POs | **0** |
| Certification receipts | **0** |
| Legitimate receipts | 2 — **not a cleanup target** |
| Parts | 52 |

A runtime deploy touches none of these. If one moves, the cause is explained before anything else
proceeds.

---

## §22 — Rollback

| | |
|---|---|
| prior Hosting | commit `d116d381`, built 2026-08-23T16:13:20Z |
| rollback method | redeploy Hosting from `d116d381`; Firebase Hosting also keeps prior versions for release rollback |
| Functions | 4 callables are **additive**; rolling back removes them. No existing callable was modified or removed, so unchanged functions need no rollback |
| Indexes | index creation is **not reversible by redeploy** — a created index must be deleted deliberately. Additive-only, so rollback is "leave them" |
| data | **no data rollback**, because the release mutates no data |

---

## §11 — Deploy, as it actually ran

Functions deployed in the script's five named batches. **103 function operations: 99 updates, 4 creates.**

The four creates are exactly the four new callables: `recordWorkOrderLabor`, `correctWorkOrderLabor`,
`getWorkOrderLabor`, `getPartBalances`.

### A near-miss worth recording

The estate batch emitted a run of `Quota Exceeded` / `failed to update function` lines — twelve of
them — and an early count of mine showed **0 successes against 12 failures**. That reads as a
wholesale batch failure, and it is what this release was about to be escalated as.

It was wrong twice over. The `failed to update function` lines are **intermediate retry states**,
not outcomes: the CLI prints `Waiting to retry...` and then succeeds. And my success grep matched a
line prefix the CLI does not emit, so it counted zero of ninety-nine real successes.

The lesson is the same one this release already hit in the snapshot, twice: **a measurement bug
looks exactly like the failure it fabricates.** Both times the fix was to check the actual field or
format before raising the alarm. A release that cries wolf on its own instrumentation trains its
operator to ignore the next real failure.


---

## §12 — Deployed version verification

| | |
|---|---|
| Hosting | live, `https://eos-platform-sandbox.web.app` |
| deployed commit | **`eaaabead`** |
| buildTime | 2026-08-24T18:01:35Z |
| environmentId / role | `platform-sandbox` / `sandbox` |
| Rules | **not deployed** — unchanged, as classified |
| indexes | **not deployed** — see the finding above |

### The stamped SHA is not the release SHA, and here is why

The artifact is stamped `eaaabead`, not `7297d263`. I committed the release documentation to the
release branch **while the script was running**, and step 3b stamps `HEAD` at build time.

Verified rather than assumed: `git diff 7297d263 eaaabead` touches **three files — `.gitignore`, this
document, and the snapshot script — and zero files under `field-ops-app-vite/src`, `functions/src` or
`firestore*`**. The deployed application code is byte-identical to `7297d263`.

Harmless here, and a real lesson: *don't change `HEAD` during a build that stamps it.* I had noted not
to touch the working tree mid-build and then moved `HEAD` underneath it, which is the same mistake
one level up.

### Callables

All 18 script-verified callables `ACTIVE / nodejs22`. The four **new** ones are not in that list, so
they were verified separately:

```
PASS  getPartBalances:        ACTIVE / nodejs22
PASS  recordWorkOrderLabor:   ACTIVE / nodejs22
PASS  correctWorkOrderLabor:  ACTIVE / nodejs22
PASS  getWorkOrderLabor:      ACTIVE / nodejs22
```

**116 function operations: 112 updates, 4 creates.** The creates are exactly the four new callables.

---

## §13 — Data preservation: PASS, zero drift

Post-deploy snapshot compared to the manifest, from the same script:

| invariant | before | after | |
|---|---|---|---|
| Certification World | 1.6.0 COMPLETE 1092/1092 | 1.6.0 COMPLETE 1092/1092 | ✓ |
| Accounts total / Prospect | 103 / 1 | 103 / 1 | ✓ |
| Equipment installed | 288 (T157 / V121) | 288 (T157 / V121) | ✓ |
| Serialized available pool | 32 | 32 | ✓ |
| Inventory warehouse / mobile / company | 575 / 165 / 740 | 575 / 165 / 740 | ✓ |
| Negative part positions | 0 | 0 | ✓ |
| roleAssignments active / disabled | 110 / 3 | 110 / 3 | ✓ |
| Certification POs / receipts | 0 / 0 | 0 / 0 | ✓ |
| Legitimate receipts | 2 | 2 | ✓ |
| Parts | 52 | 52 | ✓ |

**No reset, no reseed, no deletion, no grant loss, no quantity drift, no fixture creation.**

---

## §14 — UX smoke: what was verified, and what was not

### Verified — the release is genuinely in the deployed artifact

All 96 lazy chunks plus the entry bundle were downloaded from the live host and searched for
strings unique to this release:

| string | deployed chunk |
|---|---|
| `+ Add Filter` · `grouped A to Z` · `Criteria not applied` · `No records match these filters` | `useListCriteria-*.js` |
| `Only one of these can be used at a time` (the two-array refusal) | `useListCriteria-*.js` |
| `broader than requested` | `useListCriteria-*.js`, `account-*.js` |
| `Not known` (the UNKNOWN availability ruling) | `PartsList-*.js` |
| `Line of Business` | `account-*.js` |
| `Back to Customers` | `AccountDetail-*.js` |
| `Load more parts` | `PartMasterList-*.js` |
| `fo-table--stack` (phone cards) | `MetadataListGrid-*.js`, others |

The app shell loads with **no console errors**, renders the redesigned sign-in with its environment
badge (`TAYLOR PARTS · SANDBOX`), and its footer reads **Build eaaabead** — matching `version.json`.

### NOT verified — authenticated UX

Everything behind sign-in — list interaction, filters, sort, URL state, phone cards in situ, the
raw-id sweep on live data, mobile widths on real screens — **was not exercised**.

Entering a password into a login form is something I do not do, in any environment. That is a fixed
boundary, not a sandbox judgement, so the authenticated portion of §14–§18 needs an operator session.

What CI already proves for those same surfaces: filters/sorts against real metadata, URL state
round-trips, dropped-criteria reporting, the raw-id guard with mutation proofs, and phone-card
structure. The deployment evidence above shows that exact code is what shipped. What remains unproven
is only the live-data behaviour of it.

---

## §20 — Release matrix

| Surface | Deploy | Data preserved | Smoke | Result |
|---|---|---|---|---|
| Work Orders | ✓ | ✓ | code verified in bundle; UI unauthenticated | **shipped** |
| Accounts | ✓ | ✓ | code verified; **LoB filter blocked on index** | **shipped, one filter unavailable** |
| Part Master | ✓ | ✓ | code verified; all filters index-live | **shipped** |
| Inventory | ✓ | ✓ | `Not known` verified in bundle | **shipped** |
| Purchase Orders | ✓ | ✓ | code verified | **shipped** |
| Equipment | ✓ | ✓ | code verified | **shipped** |
| Technician | ✓ | ✓ | chunks present | **shipped** |
| Warehouse / Parts | ✓ | ✓ | chunks present | **shipped** |

---

## §21 — Findings recorded, not fixed

1. **`indexDriftGuard.test.mjs` measures against a stale hardcoded live count (8 vs 38).** It passes
   while unable to detect real drift — and it is what produced this release's most dangerous wrong
   claim. Highest-value follow-up here.
2. **Three `equipment_models` indexes are live and undeclared.** Whether they should be declared, or
   deleted, is the D4 governance boundary that removed them from the file in the first place.
3. **The script's closing Rules/index check is a tautology after a Hosting deploy** — it diffs the
   file between the deployed commit and `HEAD`, which are the same commit by then. It answers "did
   the file change", never "are the declared indexes live". Both useful; only the second decides
   whether a filter works.

---

## §23 — Result

Everything in the success criteria is met **except** the index deploy, which was deliberately not
performed because it would have been destructive.
