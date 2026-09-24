# GitHub Pages auto-publish — protected decision package

**Status: DECIDED 2026-09-24 — OPTION A. Applied.** The Owner ruled that production GitHub Pages
publishing is `workflow_dispatch`-only: a merge to `main` must not automatically publish production
merely because `field-ops-app-vite` changed. The governed `platform-sandbox` Firebase Hosting
deployment remains the nonprod path.

This file previously asked a question that has now been answered; it is kept, rather than deleted,
because the analysis below is the reason for the ruling and the record of what was rejected. The
original status line read *"OWNER DECISION REQUIRED. No change has been made."* — it no longer does,
and nothing in this repository should still be asking.

## What was applied

| | |
|---|---|
| **Old trigger** | `push:` to `main`, filtered to `index.html`, `field-ops-app-vite/**`, `.github/workflows/deploy-field-ops.yml` |
| **New trigger** | `workflow_dispatch:` only — no `push`, no `pull_request`, no `schedule`, no path filter |
| **Deliberate friction** | a required `confirm` input that must be typed exactly `PUBLISH PRODUCTION`, checked fail-closed as the first step of the job, before checkout |
| **Enforcement** | `scripts/productionPublishTriggerFence.mjs` + `scripts/productionPublishTriggerFence.test.mjs`, run by `.github/workflows/governance-guard-enforcement.yml` on every PR and every push to `main` |
| **Build validation** | unchanged, and never lived here: `.github/workflows/vite-build-check.yml` builds `field-ops-app-vite` on `pull_request:` (unfiltered) and `push: [main]` |
| **Production change** | NONE. Nothing was published, deployed or republished. The URL keeps serving its last automatic publish until someone dispatches a run. |

**Why an input rather than bare `workflow_dispatch`.** Manual is not the same as deliberate: the
Run-workflow button is two clicks from anywhere in the Actions tab, and this is the only workflow in
the repository that writes to a production-identified surface. A phrase that has to be typed out
makes the publish an act rather than a click. It is deliberately **not** a `ref` input — the
dispatch already chooses the ref, and a second one could disagree with the commit
`actions/checkout` resolves, which would make provenance worse rather than better.

**What the fence asserts, so that prose is not the guarantee.** It derives the fenced set by
scanning for the GitHub Pages publishing actions rather than naming `deploy-field-ops.yml`, so a
publisher reintroduced under a different filename is caught too; and it allowlists
`workflow_dispatch` rather than blocklisting `push`, so an event nobody thought to list — including
a future one — is refused by default. Re-adding `push:` to the workflow fails the fence and three of
its contract tests; that was verified by doing it and reverting it, not assumed.

**Measured scale of what stopped.** On `main`'s first-parent history, **838 of 1990 merges (42%)**
touched the old trigger's paths — so a production-identified build of in-flight work was republished
roughly every other merge. The last such automatic publish was `6cac0423` (2026-09-19, PR #1955);
`main` head `aa033dad` (PR #1960) did not touch the paths and did not publish.

## Original analysis, as written before the ruling

The remainder of this document is unchanged. This surface is customer-reachable and
may be externally relied on, so it was documented rather than altered unilaterally.

## The finding, with live evidence

`.github/workflows/deploy-field-ops.yml` publishes to GitHub Pages on **every push to `main`**.

Read live at the time of writing:

```
https://taylorservice-spec.github.io/Taylor_Parts/field-ops/version.json
{
  "commit": "db1fd01",
  "environmentId": "taylor-parts-production",
  "environmentRole": "production",
  ...
}
```

Three facts, each independently significant:

1. **It is ahead of the governed environment.** Pages serves `db1fd01` — the current `main` head —
   while the governed sandbox serves `b09f3a13`. Ungoverned publication has outpaced the promotion
   lifecycle.
2. **It self-identifies as production.** The workflow runs a bare `npm run build` with no
   `VITE_ENVIRONMENT_ID`, so the registry's `defaultEnvironmentId` applies — and that is
   `taylor-parts-production`. This is precisely the misidentified-artifact defect
   `scripts/deployHosting.mjs` was built to prevent, happening automatically on every merge.
3. **The registry already records the gap.** `config/environments.json` attaches this surface to the
   **production** environment with `"governed": false` and the note: *"Auto-publishes on merge to
   main, outside the promotion lifecycle. Recorded as an open governance gap (R-2); this registry
   observes it and does not change it."*

**Consequence during Wave 7:** every merge in this program — roughly two dozen — auto-published to
this URL. Nothing production-*data* was touched (Pages is a static frontend and Firestore/Functions
authorization is unchanged), but a production-identified build of in-flight work has been continuously
publicly reachable, with no Owner acceptance gate anywhere in the path.

## Why this was not simply fixed

The package's own rule: *"Do NOT silently delete a live customer-visible surface."* Whether anyone
depends on this URL is a business fact the repository cannot answer. Disabling it is a one-line change
and trivially reversible; guessing wrong about who is using it is not.

## Options

**Option A — stop automatic product publication (recommended).** Remove the `push: main` trigger and
make the workflow `workflow_dispatch` only. Pages then publishes only when a human explicitly asks,
and Firebase Hosting remains the governed delivery path for both sandbox and production.

*Exact change:*

```yaml
on:
  workflow_dispatch:        # was: push: { branches: [main] }
```

*Impact:* the URL keeps serving its last published build until someone republishes; nothing 404s. New
merges stop appearing there automatically.

**Option B — keep publishing, but stop it lying about its environment.** Retain the trigger and give
the build a truthful identity, e.g. a dedicated non-production environment id, or invoke the governed
path. Reduces the misidentification but leaves an ungoverned surface ahead of the lifecycle.

**Option C — retire the surface.** Only if it is confirmed unused. Requires a communication plan and
a redirect decision; not reversible in the way A is.

## Recommendation

**Option A** — **this is the option the Owner took.** Plus a follow-up to update the registry note
from "observes and does not change it" to whatever becomes true; `config/environments.json` has been
updated accordingly, and the surface remains `"governed": false` because it is still outside the
promotion lifecycle — manual is not governed.

**Option B — NOT TAKEN.** Its analysis is left above deliberately. It was rejected because it keeps
an ungoverned surface running ahead of the promotion lifecycle and only makes that surface honest
about its identity; the ruling removes the automatic publish itself rather than relabelling it.
Correcting the environment identity was therefore not required, and the build below still resolves
`defaultEnvironmentId` — which is now correct, because the surface really is the production one and
publishing to it is now a deliberate act.

**Option C — NOT TAKEN, and not foreclosed.** Retiring the surface still requires the confirmation
that nobody depends on the URL, which the repository still cannot answer. Option A was chosen
precisely because it does not require that answer: nothing disappears. If Option C is taken later,
`EXPECTED_PRODUCTION_PUBLISHERS` in `scripts/productionPublishTriggerFence.mjs` must be emptied in
the same change — the fence fails on a stale expectation rather than silently scanning nothing. It removes the ungoverned production-identified publish immediately, is a
one-line revert if wrong, and leaves the existing URL serving exactly what it serves today.

## The single question for the Owner — ANSWERED

> Is `https://taylorservice-spec.github.io/Taylor_Parts/field-ops` relied on by anyone outside this
> program — and may automatic publication from `main` stop?

**Answered 2026-09-24: automatic publication from `main` may stop.** Option A was taken, on the
reading the document itself gave it: safe, because nothing disappears — the URL keeps serving its
last published build until a human dispatches a republish.

## Out of scope

Nothing here changes Firebase Hosting, the sandbox, production data, Rules, or any capability.
