# EAO Read-Only Evidence — 2026-08-06

**Run type:** READ-ONLY production observation. No mutation of any kind.
**Project:** `taylor-parts` · **Executed by:** AI agent session under Owner delegation (2026-08-06, "read-only production observation ≠ production mutation").
**Repository baseline:** `origin/main` @ `61150b7`.
**Resolves:** U-1, U-2, U-3, U-4, U-5 from [`../../operations/eao-readonly-evidence-package.md`](../../operations/eao-readonly-evidence-package.md). **U-6 remains BLOCKED** — see below.

Authenticated as the Owner's own already-active `firebase` (15.22.4) and `gcloud` (577.0.0) CLI sessions. **No credential was searched for, requested, created, or stored.** No deploy, write, grant, IAM, backup, index, Rules, Hosting, or configuration change was performed. No customer or business document data was read — every command returns project/service metadata or public HTTP responses only.

Evidence files are immutable per [`../../governance/audit-artifact-standard.md`](../../governance/audit-artifact-standard.md). `SHA256SUMS.txt` covers the set. A secret scan (bearer tokens, private keys, client secrets, refresh tokens) returned no matches.

## Commands executed

| Evidence | Command | Mutating? |
|---|---|---|
| `u5-functions.json`, `u5-function-names.txt` | `firebase functions:list --project taylor-parts --json` | no |
| `u4-indexes.json` | `firebase firestore:indexes --project taylor-parts` | no |
| `u1-hosting-sites.txt` | `firebase hosting:sites:list --project taylor-parts` | no |
| `u1-hosting-channels.txt` | `firebase hosting:channel:list --project taylor-parts` | no |
| `u1-pages-index.html` | `curl https://taylorservice-spec.github.io/Taylor_Parts/field-ops/` | no (public, unauthenticated) |
| `u1-hosting-index.html` | `curl https://taylor-parts.web.app/` | no (public, unauthenticated) |
| `u2-*-assets.txt` | derived locally from the two responses above | no |
| `u3-database.txt` | `gcloud firestore databases describe --database="(default)"` | no |
| `u3-backups.txt` | `gcloud firestore backups list --location=us-central1` | no |
| `u3-schedules.txt` | `gcloud firestore backups schedules list --database="(default)"` | no |

## Findings

### U-3 — Backup / recovery posture: **NONE EXISTS** (highest-severity finding)

From `u3-database.txt`:

```
pointInTimeRecoveryEnablement: POINT_IN_TIME_RECOVERY_DISABLED
deleteProtectionState:         DELETE_PROTECTION_DISABLED
versionRetentionPeriod:        3600s
earliestVersionTime:           2026-08-06T20:07:31.928528Z
freeTier:                      true
```

`u3-backups.txt` → `Listed 0 items.` · `u3-schedules.txt` → `Listed 0 items.`

The production Firestore database of the flagship deployment has **no backups, no backup schedule, no point-in-time recovery, and no delete protection.** Recoverable history is **one hour** (`versionRetentionPeriod: 3600s`). Effective RPO is up to one hour for recoverable classes of loss and **unbounded — total, unrecoverable — for a deletion or corruption older than that window**. RTO is undefined because no restore path exists.

The empty results are the answer, not a command failure. Per the evidence package, no API was enabled and no configuration was changed to make them return differently.

### U-1 / U-2 — **Two live production frontends, serving different builds**

Both surfaces return HTTP 200:

| Surface | URL | Bundle | Last release |
|---|---|---|---|
| GitHub Pages | `taylorservice-spec.github.io/Taylor_Parts/field-ops/` | `index-BsITcohF.js` / `index-CnbGLWW3.css` | auto, every merge to `main` |
| Firebase Hosting | `taylor-parts.web.app` | `index-B7PB5BOc.js` / `index-DrpQU08L.css` | **2026-08-01 21:15:56** (`live` channel, never expires) |

**The two production surfaces have diverged.** Pages tracks `main` continuously; Hosting has not been released in five days and is many merges behind. Only one Hosting site and only the `live` channel exist — there is no preview/staging channel.

**This inverts a working assumption in [`../../design/pages-production-promotion-target-state.md`](../../design/pages-production-promotion-target-state.md):** that design treated Hosting as the current production surface and Pages as the ungoverned risk. In fact Pages is the *current* build and Hosting is the *stale* one. The R-2 sequencing constraint ("verify Hosting parity before gating Pages") was therefore load-bearing and is now proven necessary — gating Pages today would leave every user on a five-day-old build.

### U-5 — Live Function estate: **22, exactly matching the repository record**

Confirms `DECISIONS.md` #63. All 22 are Gen 2, `us-central1`. Two further observations:

1. **Eight truck-registry callables are deployed** (`createTruck`, `assignTruckDriver`, `reassignTruckDriver`, `unassignTruckDriver`, `changeTruckStatus`, `changeTruckHomeWarehouse`, `deactivateTruck`, `reactivateTruck`). Any statement that the truck callables are undeployed is stale.
2. **No Enterprise Access mutation callables are present** — no grant/role/approval mutation Functions exist in the estate. Only `resolveEffectiveAccessCallable` (a read) is deployed. This is direct production confirmation that **Issue #226 Rows 19/20 remain unexecuted**, and therefore that R-1's ADR-005 §2.7 criteria 4 and 5 are genuinely blocked rather than merely unverified.

### U-4 — Live indexes captured

`u4-indexes.json` records the live composite indexes. No drift analysis is asserted here; the file is the baseline a future comparison against `firestore.indexes.json` can use.

### U-6 — **BLOCKED: live Firestore Rules text**

Not retrievable with the installed tooling: `firebase firestore:rules:get` is not a command in CLI 15.22.4, and `gcloud firebaserules` is not a valid command group in SDK 577.0.0.

This is a **tooling** limitation, not an authorization one, and it is the only unresolved item. Owner action required — see [`../../operations/eao-readonly-evidence-package.md`](../../operations/eao-readonly-evidence-package.md) §U-6 for the Console path. Until captured, ADR-005 §2.7 criterion 6 (immutable auditing production-verified) stays **UNKNOWN**.

---

## Correction to U-1/U-2 — 2026-08-06, same run

The finding above stated that Pages "tracks `main` continuously." **That is the workflow's design intent, not its observed behaviour, and the distinction matters.**

CI history (`u2-pages-deploy-runs.txt`, via `gh run list --workflow=deploy-field-ops.yml --branch main`):

- **Last SUCCESSFUL Pages deploy: `6f25e13`, 2026-08-06T07:40:46Z.**
- The four most recent `main` pushes produced `failure`, `failure`, `cancelled`, `cancelled`.
- Last 40 runs: **32 success · 4 failure · 4 cancelled**.
- Failure cause is **infrastructure, not code**: `The job was not acquired by Runner of type hosted even after multiple attempts` — GitHub-hosted runner capacity, with the `build` job timing out after ~21 minutes and `deploy` never starting.
- `vite-build-check.yml` shows the same pattern (6 failure / 4 success in the last 10).

### Revised conclusion

**Both production frontends are stale; they differ only in degree.**

| Surface | Serving build from | Staleness |
|---|---|---|
| GitHub Pages | `6f25e13` @ 2026-08-06 07:40 UTC | ~13 hours, several merges |
| Firebase Hosting | released 2026-08-01 21:15 UTC | ~5 days, many merges |

This **strengthens** rather than weakens the R-2 case. The ungoverned auto-publish path is not only ungoverned — it is **unreliable**, and its failures are silent: a merge to `main` that fails to publish produces no release record, no alert, and no difference the repository can observe. The platform currently has **no mechanism that would notice** that production is serving a build nobody chose.

### New finding — release-pipeline reliability (C3 input)

A ~20% failure/cancellation rate on the production publish path, invisible to everyone, is an operational-readiness defect independent of R-2's authorization gap. It belongs to **C3 Operational Readiness** alongside the absent backup posture: both are cases where the platform cannot detect its own state. Recorded here; not remediated.

### Effect on the R-2 acceptance criteria

Criterion **C-1** (Hosting released to current `main`) is unchanged and remains first. **C-2** (parity verified) must compare against a *known* SHA rather than "current `main`", since neither surface reliably equals `main`. No other criterion changes.

---

## U-6 — RESOLVED (2026-08-06, same day) — no Owner action required

The earlier "BLOCKED" status was a **tooling** conclusion drawn too early. Before defaulting to Owner console work, the supported authenticated read-only API path was exhausted, and it works.

**Method.** Firebase Rules REST API (`firebaserules.googleapis.com`), authenticated with the already-active `gcloud` ADC session. The first attempt returned HTTP 403 (`quota project not set`); adding the standard `x-goog-user-project: taylor-parts` header returned HTTP 200. **Read-only throughout** — `GET` on releases and rulesets only. No release was created, nothing was deployed, no project setting was changed, and **no API was enabled** to make a call succeed. The access token was used transiently in a request header and **never written to any file**; it does not appear in this evidence set.

```
GET /v1/projects/taylor-parts/releases
GET /v1/projects/taylor-parts/rulesets/6316db98-9fce-4123-9391-9919e6dd70bd
```

**Result.** One active release: `cloud.firestore` → ruleset `6316db98-9fce-4123-9391-9919e6dd70bd`, `updateTime` 2026-08-04T21:32:00Z, ruleset `createTime` 2026-08-04T21:31:58Z. Source captured to `u6-live-firestore.rules` (104,130 bytes, 1,719 lines, sha256 `f0d4a5c2…`).

### Finding — the live ruleset is functionally identical to the repository, but not byte-identical

| Comparison | Result |
|---|---|
| Full-file | **differs** — 20 lines |
| Non-comment (code) lines | **0 differences** |
| Code-only sha256 (comments stripped) | **`124589e7078c5cb6…` on both sides — identical** |

All 20 differing lines are comments, and every difference is the same one: the **live** ruleset contains `Â§` (U+00C2 U+00A7) where the repository correctly contains `§` (U+00A7). This is classic **UTF-8 double-encoding introduced at deploy time** — the file was read as Latin-1 and re-encoded as UTF-8 by whatever performed the deploy.

**Impact assessment:**

- **Functionally: none.** The difference is confined to comment text; the enforced rule logic is byte-identical. No authorization behaviour differs.
- **Operationally: real.** `skills/verify-rules-deploy` hashes the deploy for parity. **A full-file live-vs-repo hash comparison will always report a mismatch**, regardless of whether a deploy was correct. That is a false positive that trains operators to ignore the signal — the worst failure mode for a verification control. Rules-deploy verification should compare **code-only (comment-stripped) content**, or the deploy path should be fixed to preserve UTF-8.

Recorded as an operational finding. **Not remediated** — changing the deploy path or redeploying Rules is a protected Tier-2 action.

### Criterion 6 (ADR-005 §2.7) — UNKNOWN → PARTIAL

The **live** ruleset contains:

```
match /auditEvents/{eventId} {
  allow read, write: if false;
}
```

The audit collection is **client-closed in production** — confirmed against deployed Rules, not repository intent. Immutability is therefore Rules-verified. It remains **PARTIAL** rather than MET because append-only enforcement lives in the trusted writer (`access/auditEventWriter.ts`), and that behaviour has not been production-verified; Rules alone prove only that no client can read or write the collection.
