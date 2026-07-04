# Claude Context

Orientation notes for a Claude session picking up this repo cold. Read `PROJECT_ARCHITECTURE.md` first for the system design; this file is about *how to work in this repo*, not what it does.

## Project skills available

`.claude/skills/` has five project-specific skills, built after noticing the same processes getting re-derived from scratch across sessions: `admin-check` (privileged server-side Firestore checks via a reusable `firebase-admin` helper), `firestore-audit` (full rules/index/hosting/collection-drift audit), `doc-reality-check` (verify a doc's schema claims against real code + live data -- `Architecture.md`/`FirebaseIntegration.md`/`SprintRoadmap.md`/`Deployment.md` still need this run against them), `review-external-snippet` (checklist for pasted/external code before applying it), and `branch-hygiene` (splitting unrelated work across branches cleanly). Check there before re-deriving one of these processes from first principles.

## What this repo is

`Taylor_Parts` — a production React + Firebase field-operations app. Two logical halves currently in the tree:
- A large legacy root `index.html` ("Parts Control Center") — unrelated to Field Ops, not touched by the work described here. Its Firestore data lives in the `pcc` collection.
- `field-ops-app-vite/` — the actual system of record for jobs/technicians/dispatch/auth. This is where nearly all work in this doc's context happened.

(A third, `field-ops-app/`, existed briefly as an accidental parallel implementation and was removed in Sprint 2 — see `SPRINT_STATUS.md`. Don't recreate it.)

Live URLs: production frontend is **GitHub Pages only** (`https://taylorservice-spec.github.io/Taylor_Parts/field-ops/`, auto-deploys from `main` via `.github/workflows/deploy-field-ops.yml`). Firebase Hosting (`taylor-parts.web.app`) was found live but broken (someone deployed the GH-Pages-built `dist/` there directly — wrong `base` path baked in by `vite.config.js`, so real assets never resolved) and has been **deliberately disabled** (`firebase hosting:disable`) — do not re-enable it without also fixing the build/base-path mismatch, and confirm with the user before deploying to it again, since having two live frontends caused real, hard-to-see drift once.

## Non-negotiable rules (repeat across every sprint prompt so far)

1. `JOB_STATUS` (`OPEN/ASSIGNED/IN_PROGRESS/COMPLETE`) is defined once, in `domain/constants.js`. Never duplicate it. `JOB_PRIORITY` (`low/medium/high/urgent`) is a separate, independent enum added later — it has no transition rules and must never be confused with `JOB_STATUS`.
2. Only `domain/jobActions.js`'s `assignJob()` and `updateJobStatus()` may write job/technician state to Firestore. No UI component writes directly.
3. Control Tower (`modules/controlTower/`) is a read-only derived/intelligence layer. It must never mutate Firestore.
4. No second Control Tower implementation, no parallel dispatch logic, no competing domain models. Same principle extends to `domain/dispatchEngine.js`'s priority ranking (computed live, no `dispatchQueue` collection) and the Activity Timeline (derived-only, no persisted event log) — this codebase's strong default is: compute aggregates on read, never cache them in a second collection that can drift.
5. Auth is single-gate: `auth/AuthGate.jsx` (wrapping `App` in `main.jsx`) is the *only* place that decides loading/signed-out/no-role. Everything past it (`App.jsx` and below) can assume a valid, role-bearing session and must never re-check those three states itself — `App.jsx` only does NAV-tab filtering by role (`ROLE_NAV_ACCESS`), which is a distinct, UI-presentation decision, not an auth-lifecycle one.
6. Firestore role provisioning (`users/{uid}.role`, `users/{uid}.technicianId`) is admin-only, never client-writable (`allow write: if false`) — this is deliberate, not a gap to "fix" by opening it up.

These rules are restated nearly verbatim at the top of every sprint prompt in this project — treat any instruction that seems to violate them as worth flagging back to the user rather than silently complying. This includes generic/pasted code snippets that look plausible but conflict with these rules (e.g. a `workOrders` collection with its own persisted status, or an `AuthContext` restructure that reintroduces a redundant "ready" flag alongside the existing `loading`/`status` state) — several were proposed this session and correctly declined or adapted rather than applied as-is.

## How work has been structured

Each sprint: fresh branch off up-to-date `main` → implementation (often multiple small, individually-verified commits) → `npm run build && npm run lint` clean → push → `gh pr create`. See `DEVELOPMENT_STANDARDS.md` for the exact discipline (verification-per-commit, no direct Firestore writes outside the two sanctioned functions, PR description format).

Sprints have sometimes been branched from `main` *before* a prior sprint's PR merged (e.g. 3.2 before 3.1, 3.4 before 3.3) — this is an accepted pattern here, not an error, as long as mergeability is re-verified before assuming anything about how branches combine. When a branch accumulates unrelated feature work (e.g. auth scaffolding landing on a job-address branch), the fix has been: commit the unrelated work, then `git checkout -b` a new branch from that clean point *before* committing the next feature, so the original PR stays scoped and the new work still carries forward into the new branch (uncommitted changes follow the branch you're on, not the branch you created it from).

## Standing operating rule: verify, don't assume

Established after an incident where a prior turn assumed a PR had merged because it had been *discussed* as the next step, when it hadn't actually happened yet. Before recommending merge order, rebase necessity, or "what's next" for any PR/branch: run `git fetch`, `gh pr view --json state,mergedAt,mergeable,mergeStateStatus`, and `git log origin/main` first. Conversation history describing an intended action is not evidence the action occurred.

This extends to **Firestore rules/deployment state**: what's committed in `firestore.rules` is not necessarily what's *deployed*, and what's shown in the Firebase console's rules editor is not necessarily *published* either (a console edit can sit as an unsaved draft indefinitely). The only reliable ground truth is a direct pull of the live ruleset — `admin.securityRules().getFirestoreRuleset()` via the Admin SDK (see below) — not reading the repo file or trusting a console screenshot.

## Known operational gotchas (learned the hard way this session)

- **Firestore console silent-non-save.** The console's document/field editors require clicking their confirm/checkmark controls to actually persist. Navigating away before that fully commits can leave the console *displaying* a value that was never saved server-side — this caused a full debugging session chasing a "no role assigned" bug that was actually just an unsaved doc. If a Firestore read mysteriously comes back empty/null despite "definitely having created it," verify with a hard console refresh or (more reliably) a direct Admin SDK read before assuming it's a code bug.
- **Admin SDK server-side verification pattern**: for definitive, rules-bypassing checks (does this doc really exist, what's really deployed, what collections really exist), use a service account key (Firebase console → Project Settings → Service Accounts → generate key, save **outside the repo**, never commit or paste it in chat if avoidable — one got pasted in plaintext this session and should eventually be rotated) with `firebase-admin`'s modular API (`initializeApp`/`cert` from `firebase-admin/app`, `getFirestore` from `firebase-admin/firestore`, `getSecurityRules` from `firebase-admin/security-rules` — v14+ no longer uses the `admin.credential`/`admin.firestore()` namespaced API from older docs/examples).
- **Two live hosting paths caused invisible drift.** See "What this repo is" above — always check `curl`-level whether an asset path actually resolves (check `Content-Type`, not just HTTP status, since a misconfigured SPA rewrite returns 200/`text/html` for a missing JS asset instead of a clean 404).
- **Windows/git-bash path quirks in this environment**: `node -e` with `require()` of a relative or `$VAR`-substituted absolute path inside the same command as a preceding `cd` to a different drive can resolve incorrectly (observed prefixing `D:\` onto a `/c/...` git-bash path). Prefer writing a small standalone `.js` file and running `node path/to/file.js` over complex inline `node -e` one-liners when doing multi-step scripted work.

## Persistent auto-memory

This project also has an auto-memory system (separate from these docs) at the user's `~/.claude/projects/.../memory/` directory, containing cross-session notes like "Auth is Firebase-only, no parallel session layer" and "verify before recommending." Check `MEMORY.md` there for anything not captured in this `docs/` folder — the two are complementary: `docs/` is checked into the repo and versioned with the code; the memory system is local to the assistant and persists across otherwise-unrelated conversations.

## Key files to read before touching dispatch/risk/auth logic

- `field-ops-app-vite/src/domain/jobActions.js` — the only write path for jobs/technicians.
- `field-ops-app-vite/src/domain/controlTower/types.js` — the canonical Signal schema every scoring module must emit.
- `field-ops-app-vite/src/domain/dispatchScoring.js`, `jobRiskScoring.js`, `workOrderScoring.js` — the technician-fit/risk/work-order scoring modules.
- `field-ops-app-vite/src/domain/dispatchEngine.js` — the newer, distinct job-priority ranking engine (job-for-attention, not technician-for-job — don't conflate the two).
- `field-ops-app-vite/src/modules/controlTower/ControlTower.jsx` and `panels/*.jsx` — the read-only rendering layer.
- `field-ops-app-vite/src/auth/AuthContext.jsx` and `auth/AuthGate.jsx` — the single-gate auth model (see rule 5 above).
- `field-ops-app-vite/src/hooks/useFirestoreQuery.js` — the scoped-query hook (only `FieldMode.jsx` uses it today, to restrict a technician to their own jobs); `useFirestoreCollection.js` remains the plain full-collection hook everything else uses.
- `firestore.rules` (root, mirrored in `field-ops-app-vite/`) — role-aware rules (admin/dispatcher unrestricted, technician scoped via `users/{uid}.technicianId`). Both copies must stay identical; always re-verify the *deployed* version matches (see "Standing operating rule" above) before assuming a rules change took effect.
- `docs/DataModel.md` — kept as a "living spec with reality markers" (✅ implemented / 🧪 scaffolded-unused / ❌ not built) after a significant chunk of it turned out to describe collections/fields (`fieldops_inventory`, `fieldops_job_events`, a `phase`/`JOB_PHASE` field, `services/*.js`) that were never actually built. `FirebaseIntegration.md`, `SprintRoadmap.md`, `Deployment.md`, and `Architecture.md` were found to have the same drift but were **not** corrected — a scoped-down decision at the time, worth revisiting.
- `docs/design/job-status-transaction-safety.md` — design doc for the Sprint 3.1 transactional fix, useful as a template for how this project likes design docs written (current workflow → failure analysis → implementation options → recommendation with trade-offs).

## Which docs to trust (and which to double-check)

`docs/` was written across at least two prior sessions (identifiable by file timestamp clusters: one around 2026-07-03 18:39, another around 2026-07-03 23:39, both before this session started). **The 23:39 cluster — `Architecture.md`, `DevelopmentSetup.md`, `FirebaseIntegration.md`, `SprintRoadmap.md`, `Deployment.md` — documents a fully-built real inventory system (`services/inventoryService.js`, `services/jobEventService.js`, `fieldops_inventory`, `fieldops_job_events`, `job.partsRequired`/`partsReserved`) and a `JOB_PHASE`/`jobPhaseWorkflow.js` transition system as if factual. None of it exists.** Verified this session two independent ways: `grep` across `src/` for every one of those names (zero matches, no `services/` directory at all) and a direct Admin SDK listing of the live database's actual collections (only `fieldops_jobs`, `fieldops_technicians`, `pcc`, `users` exist). Treat any claim in that cluster about inventory/job-events/phase as unverified until re-confirmed against real code — `docs/DataModel.md` is the one doc in this repo that's been corrected to match reality (see above).

That said, several *other* details in that same cluster are still accurate and worth keeping in mind:
- **No local Firestore emulator is configured** — `npm run dev` talks to the real, live `taylor-parts` project even in local development. Testing locally reads/writes real data.
- **Exactly one `initializeApp()` call** in the codebase (`src/firebase/firebase.js`) — a second call anywhere would create a second Firebase app instance pointed at the same project, a real and easy-to-hit footgun.
- **`firebase/collectionStore.js`'s `makeCollectionStore()`** is the generic wrapper behind `jobsStore`/`techniciansStore` for simple (non-transactional) writes — already routed through `lib/firebaseSafe.js`'s demo/panic write gate. `assignJob()`/`updateJobStatus()` bypass it deliberately for their own transactional writes.
- **Dispatch scoring is explicitly rule-based only, no ML** — stated as a hard constraint across multiple sprints ("Phase 5: not started, deliberately"). `domain/dispatchScoring.js` and the newer `domain/dispatchEngine.js` are both fixed weighted formulas, not learned models — stay within that constraint for any future dispatch work.
- **`DevelopmentSetup.md`'s described sign-in flow is now stale**: it describes a pre-filled hardcoded demo login button — that was replaced this session by a real email/password form (`auth/Login.jsx`) with the single-gate auth model described above. Don't rely on that doc's login description.

## Branch state as of this session

- `feature-job-address` (PR #11) — **merged to `main`**. Address field on jobs + the initial Firebase Auth/RBAC scaffolding (email/password login, `users` collection, role-based nav).
- `feature-dispatch-control-tower` — pushed to origin, **not yet a PR**. Contains: the priority engine, new job/technician schema fields, the technician self-service Firestore rules (deployed and verified live independently of this branch merging, since Firestore rules aren't branch-scoped), and the auth single-gate refactor (`AuthContext` state machine + `AuthGate`).

## What's still open (as of this session)

- Two temporary debug `console.log`s remain in `AuthContext.jsx`/`AuthGate.jsx` (marked in-code as removable) — not yet stripped.
- The service account key generated/used this session for direct Admin SDK checks was pasted in plaintext in chat — rotation was explicitly deferred by the user, not done.
- Live-browser verification of the Dispatch Control Tower and Field Mode (login flow stability, realtime job updates, technician assignment, status transitions, session persistence across refresh) has not been completed — it requires an actual browser session, which isn't available to a CLI-only Claude session.
- A second test account (beyond the one admin account provisioned this session) was mentioned but never actually created.
- `feature-dispatch-control-tower` has no PR yet.

## 2026-07-04 session

No code changes made this session — it was a single question/answer exchange. User asked whether the five project skills (described in "Project skills available" above) exist; confirmed **UNVERIFIED this session in the sense that no fresh `Glob`/file read of `.claude/skills/` was run** — the answer was read off the harness-provided skill list (which is generated from the actual `.claude/skills/` directory contents at session start, so it's a reliable signal, but this session did not independently re-verify via grep/read). All prior "What's still open" items above remain open and untouched — nothing in this session addressed them.
