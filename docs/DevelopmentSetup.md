# Development Setup

## Prerequisites

- Node.js (the CI workflow uses Node 22 — match that locally if possible).
- A Firebase project you have access to (this repo points at project `taylor-parts` — see `field-ops-app-vite/src/firebase/firebase.js`).

## Install dependencies

```bash
cd field-ops-app-vite
npm install
```

All app code lives under `field-ops-app-vite/` — the repo root also contains an unrelated legacy static site (`index.html` at the root, "Parts Control Center"), not part of this app.

## Run locally

```bash
cd field-ops-app-vite
npm run dev
```

Starts the Vite dev server (default `http://localhost:5173`, auto-incrementing if that port's busy). The app talks to the **real, live Firestore project** (`taylor-parts`) even in local dev — there is no local Firestore emulator configured in this repo. Be aware that testing locally reads/writes real data.

Sign-in on first load uses a pre-filled demo login button (`fieldops@test.com` / hardcoded password in `App.jsx`) — no separate credential setup needed to get into the app.

## Lint

```bash
npm run lint
```

Runs `oxlint`. CI (`.github/workflows/vite-build-check.yml`) runs this and the build on every push/PR.

## Build

```bash
npm run build
```

Produces a production build in `field-ops-app-vite/dist/`. Preview it locally with:

```bash
npm run preview
```

## Deploy

Two independent deployment paths exist right now — see `docs/Deployment.md` for the full picture:

1. **Frontend (current production path)**: automatic via GitHub Actions on every push to `main` (`.github/workflows/deploy-field-ops.yml`) — no manual `firebase deploy` needed for the live site today.
2. **Firestore rules**: manual — `firebase deploy --only firestore:rules`, run from a machine with the Firebase CLI installed and authenticated (`firebase login`). Not automated by any CI step.
3. **Firebase Hosting**: configured (`firebase.json`/`.firebaserc` at the repo root) but not the active production path yet — `firebase deploy --only hosting` would publish `field-ops-app-vite/dist` there if/when adopted.
