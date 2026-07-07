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

## "SPA routing"

The app does not use a client-side router (no `react-router` or equivalent) — `App.jsx` renders one of several view components based on in-memory `useState` tab selection, not distinct URL paths. There is exactly one HTML entry point (`index.html`) and no deep-linkable routes today. The Firebase Hosting rewrite rule (`** → /index.html`) is standard SPA boilerplate from `firebase init`, but isn't functionally load-bearing yet since there's nothing route-like for it to catch.

## Domain model

- **Jobs** (`fieldops_jobs`): the core execution unit. Status is `JOB_STATUS`: `OPEN → ASSIGNED → IN_PROGRESS → COMPLETE`, transitioned only through `domain/jobActions.js`'s `assignJob()`/`updateJobStatus()` (transactional, the sole sanctioned write path).
- **Technicians** (`fieldops_technicians`): `TECH_STATUS`: `available | on_job | off_shift`.
- **Work Orders**: a derived grouping of Jobs by `workOrderId` — not (yet) a populated real collection; Control Tower groups jobs client-side.
- **Inventory** (`fieldops_inventory`, Sprint 4): real, transactional part stock per location (warehouse/truck), separate from the Sprint 3.6 demo-only in-memory inventory layer.
- **Job events** (`fieldops_job_events`, Sprint 4): a persisted event log, distinct from Sprint 3.5's derived (non-persisted) activity timeline.

See `docs/PROJECT_ARCHITECTURE.md` for the full architectural ruleset (single-source-of-truth enforcement, forbidden patterns, Control Tower's read-only contract) built up across this project's sprints.
