---
artifact_type: design
gate: C3 — delivery reliability & release visibility
status: D1 IMPLEMENTED 2026-08-06 (repo-only). D2-D4 remain design-only; no alerting, Hosting, Pages, or deployment change.
date: 2026-08-06
owner: Claude Code (Executive Architecture & Company Office)
base_commit: ab55c50
scope: Design only. Nothing implemented, nothing deployed.
---

# C3 — Delivery Reliability & Release Visibility

The question this must eventually answer automatically, without an architecture investigation:

> **"What version is production actually running?"**

Today that question took a multi-step forensic exercise: fetch both frontend surfaces, extract bundle fingerprints, list Hosting releases, and cross-reference CI run history. It should be a lookup.

---

## 1. Evidence — what the investigation actually found

| Finding | Evidence |
|---|---|
| **Two live production frontends serving different builds** | Pages `index-BsITcohF.js` vs Hosting `index-B7PB5BOc.js` |
| **Both stale** — Pages ~13h, Hosting ~5 days (last release 2026-08-01) | `u1-hosting-channels.txt` |
| **The publish path fails routinely** — last 40 Pages deploy runs: **32 success / 4 failure / 4 cancelled**; the four most recent `main` pushes all failed or were cancelled | `u2-pages-deploy-runs.txt` |
| Cause is **infrastructure, not code** — `The job was not acquired by Runner of type hosted`, build timing out ~21 min, deploy never starting | CI run annotations |
| `vite-build-check` shows the same pattern — 6 failure / 4 success in its last 10 | CI history |
| **No release record, no alert, no detection** when a publish fails | absence |

## 2. The actual defect

**It is not that deploys fail.** Runner capacity is outside this platform's control and a ~20% failure rate on a free-tier runner pool is unremarkable.

**The defect is that failure is silent and invisible.** A merge to `main` that does not publish produces:

- no release record,
- no alert,
- no difference the repository can observe,
- and no difference an operator would notice.

The platform therefore cannot distinguish "production is running current `main`" from "production has been frozen at a stale build for five days." Both look identical from inside the repository. **That is the same class of defect as the absent backup posture: the system cannot observe its own state.**

## 3. Target capability

Four properties, in dependency order. Each is independently useful; none requires the ones after it.

### D1 · Deployed-version identity (foundation) — ✅ IMPLEMENTED 2026-08-06

**Delivered, repo-only.** The build now emits a stable, unauthenticated `version.json` next to `index.html` in **both** output modes:

```json
{ "commit": "fef1ca3", "base": "/", "buildTime": "2026-08-06T23:12:49.495Z", "schema": 1 }
```

`vite.config.js` gained an `emit-version-manifest` plugin; `npm run verify:version` (9 checks) is wired into the `Vite Build Check` workflow. The manifest carries **build provenance only** — a test asserts the exact key set and scans for leaked `apikey`/`secret`/`token`/`password`/`projectid`/`authdomain`.

**A real bug was caught by that test during implementation:** the first version recomputed the asset base from `process.env.VITE_BASE`, but `npm run build:firebase` overrides it with a **CLI flag** applied *after* config evaluation — so the Firebase manifest recorded the GitHub Pages base, making the two surfaces indistinguishable from their manifests. That is exactly the discrimination D2 depends on. Fixed by reading Vite's **resolved** config in `configResolved`.

**What this changes:** answering "what version is production running?" was previously a forensic exercise (fetch both surfaces, extract bundle fingerprints, list Hosting releases, cross-reference CI history). It is now `GET /version.json` — **once a build carrying this change is actually deployed.** The currently-live surfaces predate it and still require the forensic method.



The running application must be able to state which revision it is. Concretely: stamp the build with its source SHA and build time, expose it at a stable path (a `version.json` emitted at build time, or a `<meta>` tag), and surface it in-app where support can read it.

**Why first:** every other property below reduces to comparing this value against something. Without it, "what version is production running?" has no cheap answer, only a forensic one.

**Cost:** trivial — a build-time constant. **Risk:** none; additive and inert.

### D2 · Expected-vs-deployed comparison

Given D1, a scheduled read-only check compares the deployed SHA against `origin/main` and against the Hosting release, and reports drift: *expected `abc123`, Pages serving `def456` (13h behind), Hosting serving `ghi789` (5d behind)*.

This is the check that would have surfaced today's finding automatically. It is read-only and can run entirely from public endpoints plus `gh`.

### D3 · Workflow execution health

Track publish-workflow outcomes over a window and surface the failure/cancellation rate. A single failure is noise; **four consecutive failures is an outage** and is currently indistinguishable from four successes.

Detection rule: alert on *consecutive* failures rather than any single failure, so runner flakiness does not train operators to ignore the signal — the same false-positive trap identified in the Rules-hash comparison.

### D4 · Release evidence

Every production release should leave a durable record: revision, artifact fingerprint, timestamp, actor, and outcome. Hosting deploys already produce release pins under `docs/audits/`; Pages produces nothing. **A release with no record is not auditable**, and P5's RTO measurement depends on knowing what was deployed when.

## 4. Sequencing

**D1 → D2 → D3 → D4.** D1 is repo-only, trivial, and unblocks the rest. D2 is a read-only check. D3 depends on CI history only. D4 is the governance layer over all three.

**Explicit dependency on R-2:** D2's usefulness is limited while *two* production surfaces exist with divergent contents. R-2's target state (Hosting as the sole production frontend) and D1/D2 are complementary — D1/D2 make the divergence *visible*; R-2 makes it *impossible*. Neither substitutes for the other, and **D1/D2 should land first** so R-2's migration can be verified rather than assumed. This reverses the naive order in which observability follows remediation.

## 5. What this design deliberately excludes

- **No third-party monitoring vendor.** That is a spend/vendor decision (Tier 3) and premature — D1–D3 need no external service.
- **No alerting channel chosen.** Where an alert goes is an operations decision, not an architecture one.
- **No application-performance or error monitoring.** The broader observability gap (no error reporting, tracing, or telemetry anywhere in the codebase) is real and separate; this design covers *delivery* reliability only, and conflating them would produce a vendor decision disguised as an architecture one.
- **No change to the Pages workflow.** That is R-2 and remains protected.

## 6. Relationship to the rest of C3

C3 Operational Readiness now has three recorded strands:

| Strand | State |
|---|---|
| **Data protection / recovery** | P1–P4 executed; P5 designed, awaiting authorization |
| **Identity / Auth recovery** | Deferred, required before C3 certification (decision package §10a) |
| **Delivery reliability / release visibility** | This document — designed, nothing implemented |

All three share one root cause: **the platform cannot currently observe its own state** — not its recoverability, not its identity estate, not what it is running.

## 7. Status

Design only. No workflow, alerting, Hosting, Pages, build, or deployment change was made. D1 is repo-only and could proceed under existing Tier-1 authority when scheduled; D2–D4 involve scheduled execution and release governance and should be scoped before implementation.
