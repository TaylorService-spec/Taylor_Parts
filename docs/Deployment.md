# Deployment

There are three independent deployment surfaces for this project. They are not currently unified under one command — know which one you're touching.

## 1. Frontend hosting — current production path: GitHub Pages

`.github/workflows/deploy-field-ops.yml` runs on every push to `main`:

1. Builds `field-ops-app-vite` (`npm ci && npm run build`).
2. Assembles a combined Pages site: the repo-root legacy `index.html` at `site/index.html`, and the Vite build's `dist/` contents at `site/field-ops/`.
3. Publishes via GitHub's official Pages deploy action.

Live URL: `https://taylorservice-spec.github.io/Taylor_Parts/field-ops/`

No manual step is required for this path — merging to `main` is the deploy trigger. `.github/workflows/vite-build-check.yml` separately build/lint-checks every push and PR (not a deploy, just a gate).

## 2. Firebase Hosting — configured, not yet the active path

`firebase.json` (repo root) configures Hosting to serve `field-ops-app-vite/dist` with a SPA catch-all rewrite. `.firebaserc` points it at the `taylor-parts` project. As of this writing these two files are new and untracked in git, and nothing indicates a Hosting deploy has been run yet.

To deploy the same `dist/` build there:

```bash
cd field-ops-app-vite && npm run build
cd ..
firebase login          # interactive, once per machine
firebase deploy --only hosting
```

This would publish to `taylor-parts.web.app` (or `taylor-parts.firebaseapp.com`) independently of the GitHub Pages URL above — the two are not automatically kept in sync with each other; each requires its own deploy step.

## 3. Firestore rules and indexes

`field-ops-app-vite/firestore.rules` and `firebase.json`'s `firestore.indexes` are **not deployed by any CI workflow** — confirmed, no workflow in `.github/workflows/` references `firebase deploy` or Firestore rules at all. A rules change committed to the repo has **no effect on the live project** until manually deployed:

```bash
firebase login
firebase deploy --only firestore:rules
```

This is a real, live operational gap worth being deliberate about: as of Sprint 4, `firestore.rules` was updated in-repo to permit two new collections (`fieldops_inventory`, `fieldops_job_events`), but that change will not take effect against the real `taylor-parts` project until someone runs the command above. Any code that writes to those collections will fail with "Missing or insufficient permissions" until then.

## Practical checklist before assuming a change is "live"

- Frontend code change → merged to `main` → live on GitHub Pages automatically. No separate action needed.
- `firestore.rules` change → **requires a manual `firebase deploy --only firestore:rules`** — check whether this has actually been run before assuming new Firestore access rules are in effect.
- Firebase Hosting → not currently part of the deploy story; only relevant if/when the project explicitly migrates off GitHub Pages.
