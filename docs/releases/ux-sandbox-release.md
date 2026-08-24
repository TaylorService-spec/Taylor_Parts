# UX Sandbox Release — `eos-platform-sandbox`

**2026-08-24.** Release of the accumulated UX / object-list work. A **runtime release**, not a data
rebuild.

| | |
|---|---|
| **release SHA** | `7297d263` |
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

### Indexes — the finding that matters

> **8 live · 37 declared · 29 pending.**

`firestore.indexes.json` gained only the two `accounts` composites in this release — but the sandbox
estate has **29 declared indexes that are not live**, including the three `parts` composites and five
`accounts` composites that this release's **new filter and sort UX depends on**.

This is exactly the distinction §6 warns about: *declared in the repo* is not *deployed and available
in sandbox*. `ADR-013`'s claim that the Part Master filters are "index-backed" is true of the
repository and **not yet true of this environment**.

**An index deploy is purely additive: 29 creates, 0 deletes.** Every live index is present in the
declared file (`declared − pending == live == 8`), so reconciliation removes nothing. That is the
§13 "no unexpected deletes" answer, computed rather than assumed.

`firebase deploy --only firestore:indexes` remains a **separate protected action** and is not part of
the runtime script.

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

*Remaining post-deploy sections are recorded below as the release completes.*
