# Owner Control Center — hosting, access, and publication design (Delivery Phase)

**Status: Design (Tier-1). Repo-safe.** Design owns hosting architecture, the security boundary, the
auth/authz model, the hosted data contract, publication authority, and freshness semantics (§15). This document
is the design; the repo-safe foundation (launcher, config skeleton, freshness/publication code) follows it. The
**actual hosting deploy, Firebase site creation, auth configuration, and any credential/billing are Owner/
operator-gated** (§7, §20) and are surfaced as explicit decisions at the end.

Preserves the established boundary (§4): Taylor = project truth; `controlCenterAdapter` = governed envelope;
keystone = renderer. Hosted keystone consumes **only the governed envelope** — never Taylor internals (§9).

## 1. Firebase assessment (§7 — assess Firebase first)

EOS already uses Firebase (`taylor-parts`): Firestore, Functions, Auth, and **Hosting already hosts
`field-ops-app-vite/dist`** (the Field Ops app) with a no-cache HTML / immutable-assets policy. So Firebase is
the natural provider — but the Control Center is a **separate app** and must not share the Field Ops site.

- **Firebase Hosting (static), separate site.** Firebase supports multiple sites per project
  (`firebase hosting:sites:create eos-control-center`). The Control Center is a zero-dependency static app
  (no build), so static hosting fits the shell directly. **Chosen for the shell.**
- **Firebase App Hosting.** Newer, for SSR/dynamic backends. Overkill for a static renderer; only needed if we
  put auth/data behind a server. Considered for the *data path* (below), not the shell.

**The security crux:** static Hosting serves files **publicly**. The shell (HTML/JS/CSS) being public is fine —
it renders nothing without data. But the **envelope data must NOT be a public static file** (`data/*.json`),
or anyone with the URL reads the full roadmap/agent/network state. So the design's real decision is **how the
envelope data is gated**, not where the shell lives.

## 2. Access-gating options for the envelope data (the security-policy choice — Owner-ratified)

| Option | Shell | Envelope data path | Auth | Trade-off |
|---|---|---|---|---|
| **A. Firestore-gated envelope (recommended)** | static Hosting site | envelope stored in a Firestore doc (e.g. `control_center_envelopes/{projectId}`); client fetches after Firebase Auth sign-in | Firebase Auth + a Firestore **rule** allowing read only to authorized Owner uid(s) | Reuses existing Auth + Firestore + Rules discipline; **needs a Rules change (Tier-2) + a governed publish write** |
| **B. Authenticated Cloud Function** | static Hosting site | an HTTPS Callable/Function returns the envelope after verifying the caller's Auth token + authorization | Firebase Auth + Function-side authz | No Firestore rule for the data, but **needs a deployed Function** (protected) and a place to store the envelope |
| **C. App Hosting + server middleware** | App Hosting (SSR) | server renders/serves behind auth middleware | Firebase Auth / IAP | Strongest gate, but the heaviest infra for a read-only board; abandons the zero-dep local-first shape |

**Recommendation: Option A.** It reuses exactly what EOS already governs (Auth + Firestore + the dual-mirror
Rules discipline), keeps the shell a zero-dep static file, and gates the data with a single fail-closed read
rule scoped to the authorized Owner uid. Options B/C remain valid if the Owner prefers a Function/SSR gate.

**All three require Owner authority** (site creation + Hosting deploy + Auth config, and for A a Firestore
Rules change + deploy). None is done in this repo-safe phase.

## 3. Auth / authz model (§8) — smallest v1, forward-compatible

- **v1:** one Owner. Firebase Auth sign-in on the Control Center; access allowed only to the authorized Owner
  uid(s). Unauthorized → **fail closed** (no shell data, an explicit "not authorized" state — never a blank or
  a silent public board).
- **Forward-compatible seams (built as concepts now, no tenant infra):** the envelope already carries
  `source.projectId`. Model **project ownership** (`projectId → authorized owner uid(s)`) and **portfolio
  visibility** (a portfolio-owner uid that may read all projects) as an explicit authorization map — so a future
  Project B can have a different Owner while an authorized Portfolio Owner sees consolidated state (§14). v1
  populates it with one project + one Owner. **No multi-tenant routing/registry is built now.**

## 4. Hosted data contract (§9) — only governed envelopes

Hosted keystone consumes ONLY the envelope `buildControlCenterPayload()` emits. It preserves at minimum
`projectId · schemaVersion · commit · generatedAt · origin · compatibility result · provenance`. The hosted
store carries **exactly** that envelope (Option A: one Firestore doc per project). **Never published:**
credentials, secrets, raw local network logs, household traffic, agent scratchpads, or local filesystem paths.
Only the **already-sanitized** orchestration/network state (the same `networkHealth`/`agentOperations` the
envelope already carries) may enter the hosted envelope — raw telemetry stays machine-local (§19).

## 5. Freshness / staleness (§10) — a stale board must announce it

The Owner must immediately see: `source.commit` · `generatedAt` · **last successful refresh/publish time** ·
**compatibility state** · and whether the displayed state is **CURRENT / STALE / UNKNOWN / INCOMPATIBLE**.

- **CURRENT** — the published envelope's `commit` matches the latest known governed publish and `generatedAt`
  is within a freshness window.
- **STALE** — the envelope loaded, but `generatedAt` is older than the window (or a newer commit exists). The
  board renders with a visible STALE banner; **loading successfully is never treated as CURRENT** (§10).
- **UNKNOWN** — no `generatedAt`/publish record available; shown as UNKNOWN, not guessed.
- **INCOMPATIBLE** — `checkPayloadCompatibility()` fails; the board refuses to render the payload as understood.

A repo-safe pure `freshnessState(envelope, nowMs, publishRecord)` helper computes this (keystone renders it);
`model reconciliation point` is exposed **where it exists** (the roadmap's `lastVerifiedRepoState`), not invented.

## 6. Publication mechanism (§9) — smallest reliable update

Governed publish = `import-envelope` (build the envelope from the project's adapter) → **write the envelope +
a publish record (commit, generatedAt, publishedAt) to the gated store** (Option A: the Firestore doc). This is
the same governed adapter path already proven locally; publishing is an explicit, authorized step (not
automatic on every commit), and the publish record is what freshness reads. **The write to the gated store is
Owner/operator-gated** (it needs the deployed site + Rules + credential).

## 7. Owner-gated boundaries in this design (return for decision)

Repo-safe here: this design, the freshness/publication **code**, the launcher, and the hosting **config
skeleton**. Requiring Owner/operator authority (§7, §20): **(a)** the access-gating security model (A/B/C
above) · **(b)** creating the Firebase Hosting site + **deploying** it · **(c)** Auth configuration + the
authorized-Owner uid(s) · **(d)** for Option A, a **Firestore Rules change (Tier-2) + deploy** for the envelope
doc · **(e)** any credential/billing. These are surfaced explicitly; none is performed autonomously.
