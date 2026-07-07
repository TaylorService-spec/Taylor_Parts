# Architecture

Taylor Parts / Field Ops is a Firebase-backed field service application: a Vite + React single-page app (`field-ops-app-vite/`) talking directly to Firestore, with Firebase Authentication gating access.

Architecture documents (this one, `PROJECT_ARCHITECTURE.md`, and the `architecture/` ADRs) describe **how** the platform is implemented. Product documents (`ProductVision.md`, `PlatformConstitution.md`, `ProductBlueprint.md`, `GuidingPrinciples.md`, `MobileStrategy.md`) describe **why** it exists and **how users interact with it**. See `PROJECT_ARCHITECTURE.md`'s "Relationship to Product Governance" section for how the two are meant to work together.

## Stack

- **Frontend**: React, built with Vite (`field-ops-app-vite/`).
- **Backend**: Firestore — there is no separate application server; the frontend reads/writes Firestore directly through the Firebase JS SDK (`src/firebase/firebase.js`).
- **Auth**: Firebase Authentication (email/password). The app is fully auth-gated — `App.jsx` shows a sign-in screen until a user is authenticated, then renders the tabbed app shell.
- **Hosting**: see the note below — this is not as simple as "Firebase Hosting serves the frontend."

## Hosting reality check

As of this writing:
- **The live production site is served by GitHub Pages**, not Firebase Hosting. `.github/workflows/deploy-field-ops.yml` builds the Vite app on every push to `main` and publishes it via GitHub Actions' Pages deployment, at `https://taylorservice-spec.github.io/Taylor_Parts/field-ops/`.
- **A `firebase.json`/`.firebaserc` now exist at the repo root** (added recently, currently untracked in git), configuring Firebase Hosting to serve `field-ops-app-vite/dist` with a catch-all SPA rewrite (`** → /index.html`). This is *prepared* configuration, not yet an active deployment — nothing indicates `firebase deploy --only hosting` has been run. If/when it is, `taylor-parts.web.app` (or the custom domain, if configured) would start serving the same build GitHub Pages already serves.
- Firestore rules (`field-ops-app-vite/firestore.rules`) are managed separately from hosting and must be deployed with `firebase deploy --only firestore:rules` — also not automated by any CI step in this repo (confirmed: no workflow deploys rules).

## SPA routing

**As of Sprint 2.0.1 (Release 2.0, Navigation Foundation), the app uses `react-router-dom`.** This section previously said the opposite -- true through Release 1.0, no longer true. `App.jsx` now wraps the app in `BrowserRouter` (`basename="/Taylor_Parts/field-ops/"`, matching `vite.config`'s `base`) with real URL routes per business domain/sub-nav item (see `navigation/navConfig.js`), so browser back/forward and deep links work. There is still exactly one HTML entry point (`index.html`); routing is entirely client-side.

This reintroduces a dependency (`react-router-dom`) that PR #22 previously added, then removed on the same PR -- that removal was a scope-convergence decision (the scaffold was "structural only, not wired in," per PR #22's own body), not a permanent architectural ban on client-side routing. See Sprint 2.0.1's PR description for the full before/after rationale.

GitHub Pages has no server-side rewrite rules (unlike the Firebase Hosting config below, which does), so a deep link or refresh on a non-root path needs the standard SPA-on-static-host fallback: `field-ops-app-vite/public/404.html` re-encodes the path into a query string, and a matching restore script in `index.html` decodes it back via `history.replaceState` before React Router reads the URL. `.github/workflows/deploy-field-ops.yml` stages that `404.html` at the site root (not just nested under `field-ops/`), since GitHub Pages only honors one site-wide 404 page.

## Domain model

- **Jobs** (`fieldops_jobs`): the core execution unit. Status is `JOB_STATUS`: `OPEN → ASSIGNED → IN_PROGRESS → COMPLETE`, transitioned only through `domain/jobActions.js`'s `assignJob()`/`updateJobStatus()` (transactional, the sole sanctioned write path).
- **Technicians** (`fieldops_technicians`): `TECH_STATUS`: `available | on_job | off_shift`.
- **Work Orders**: a derived grouping of Jobs by `workOrderId` — not (yet) a populated real collection; Control Tower groups jobs client-side.
- **Inventory** (`fieldops_inventory`, Sprint 4): real, transactional part stock per location (warehouse/truck), separate from the Sprint 3.6 demo-only in-memory inventory layer.
- **Job events** (`fieldops_job_events`, Sprint 4): a persisted event log, distinct from Sprint 3.5's derived (non-persisted) activity timeline.

See `docs/PROJECT_ARCHITECTURE.md` for the full architectural ruleset (single-source-of-truth enforcement, forbidden patterns, Control Tower's read-only contract) built up across this project's sprints.
