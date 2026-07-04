# Deployment

There are three independent deployment surfaces for this project. They are not currently unified under one command — know which one you're touching.

## 1. Frontend hosting — current production path: GitHub Pages

`.github/workflows/deploy-field-ops.yml` runs on every push to `main`:

1. Builds `field-ops-app-vite` (`npm ci && npm run build`).
2. Assembles a combined Pages site: the repo-root legacy `index.html` at `site/index.html`, and the Vite build's `dist/` contents at `site/field-ops/`.
3. Publishes via GitHub's official Pages deploy action.

Live URL: `https://taylorservice-spec.github.io/Taylor_Parts/field-ops/`

No manual step is required for this path — merging to `main` is the deploy trigger. `.github/workflows/vite-build-check.yml` separately build/lint-checks every push and PR (not a deploy, just a gate).

## 2. Firebase Hosting — live site disabled; preview channels are the supported path

**Preview Deployments**

- **Purpose:** PR review and stakeholder validation only.
- **Hosting:** Firebase Hosting Preview Channels.
- **Production:** GitHub Pages only.
- **Rule:** Preview channels must never be treated as production URLs.

Firebase Hosting was found live-but-broken in an earlier session: someone had deployed the GitHub-Pages-built `dist/` (baked with `base: "/Taylor_Parts/field-ops/"`) directly to Hosting's root, so every asset 404'd. The live site was deliberately disabled (`firebase hosting:disable`) rather than left broken, and re-enabling it requires explicit confirmation (see `docs/CLAUDE_CONTEXT.md`) since having two live frontends previously caused real drift.

That base-path mismatch is now fixed at the build level: `vite.config.js` has a second build mode, `firebase-preview`, that builds with `base: "/"` and outputs to `dist-firebase/` (kept entirely separate from `dist/`, which GitHub Pages still uses unchanged):

```bash
cd field-ops-app-vite && npm run build:firebase   # -> dist-firebase/, base "/"
```

`firebase.json`'s `hosting.public` points at `field-ops-app-vite/dist-firebase` — this is what both preview channels and a future `firebase deploy --only hosting` would serve.

**Preview channels (the supported, day-to-day path)** — a temporary, shareable, real-production-build URL that does NOT touch the live/disabled Hosting site:

```bash
scripts/deploy-preview.sh [channel-name] [expires]   # defaults: current branch name, 7d
```

This builds `dist-firebase/` and runs `firebase hosting:channel:deploy`, printing a stable `https://taylor-parts--<channel>-<hash>.web.app` URL that survives independently of your local machine (unlike a `localhost` tunnel) until it expires.

**Full Hosting deploy (`firebase deploy --only hosting`)** would re-enable the live site — do not run this without first confirming with the user, per the standing note above.

## 2b. Local dev tunnel — for testing against a running dev server directly

For quick external access to the *actual running dev server* (hot reload, not a built preview), rather than a deployed build:

```bash
cd field-ops-app-vite && npm run tunnel
```

Runs `scripts/dev-tunnel.sh`: starts Vite on a dedicated port (`5199` by default, freeing it first if a stale process is squatting on it — a real issue seen in practice, since this machine tends to accumulate leftover `vite` processes across sessions), then opens a `cloudflared` quick tunnel and prints the public URL. Ctrl+C stops both. Requires `cloudflared` (`$HOME/bin/cloudflared.exe` or on `PATH`) and relies on `vite.config.js`'s `server.allowedHosts` already permitting `.trycloudflare.com`/`.loca.lt`.

Prefer `scripts/deploy-preview.sh` (2. above) for anything beyond your own quick local check — a preview channel is stable, doesn't depend on your machine staying on, and serves an actual production build.

## 3. Firestore rules and indexes

`field-ops-app-vite/firestore.rules` and `firebase.json`'s `firestore.indexes` are **not deployed by any CI workflow** — confirmed, no workflow in `.github/workflows/` references `firebase deploy` or Firestore rules at all. A rules change committed to the repo has **no effect on the live project** until manually deployed:

```bash
firebase login
firebase deploy --only firestore:rules
```

This is a real, live operational gap worth being deliberate about: any `firestore.rules` change committed to the repo needs the command above before it's actually enforced. (An earlier draft of this note referenced rules for `fieldops_inventory`/`fieldops_job_events` — those collections were retired per `docs/architecture/ADR-001-retired-operational-core-branch.md` and never merged, so that specific example no longer applies, but the underlying gap — manual deploy required — is still real.)

## Practical checklist before assuming a change is "live"

- Frontend code change → merged to `main` → live on GitHub Pages automatically. No separate action needed.
- `firestore.rules` change → **requires a manual `firebase deploy --only firestore:rules`** — check whether this has actually been run before assuming new Firestore access rules are in effect.
- Firebase Hosting → not currently part of the deploy story; only relevant if/when the project explicitly migrates off GitHub Pages.
