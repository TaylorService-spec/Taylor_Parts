# GitHub Pages auto-publish — protected decision package

**Status: OWNER DECISION REQUIRED. No change has been made.** This surface is customer-reachable and
may be externally relied on, so it is documented rather than altered unilaterally.

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

**Option A**, plus a follow-up to update the registry note from "observes and does not change it" to
whatever becomes true. It removes the ungoverned production-identified publish immediately, is a
one-line revert if wrong, and leaves the existing URL serving exactly what it serves today.

## The single question for the Owner

> Is `https://taylorservice-spec.github.io/Taylor_Parts/field-ops` relied on by anyone outside this
> program — and may automatic publication from `main` stop?

**Yes / don't know →** Option A now (safe: nothing disappears).
**It must keep auto-updating →** Option B, and the environment identity must be corrected regardless.

## Out of scope

Nothing here changes Firebase Hosting, the sandbox, production data, Rules, or any capability.
