# EOS — REAL NON-PRODUCTION INFRASTRUCTURE ACTIVATION

**Status: PARTIALLY ACTIVATED. The frontend is deployed; the EOS API and its database do not exist
yet.**

Three states, kept apart on purpose, because conflating them is how "it's merged" becomes "it's
working":

| | what it means | where this platform is |
|---|---|---|
| **MERGED** | the code is on `main` | ✅ policy foundation, activation tranche, merge record |
| **DEPLOYED NONPROD** | a real environment runs it | ⚠️ frontend only — no API, no database |
| **PRODUCTION** | customers touch it | ❌ untouched, and out of scope |

---

## 1. Source

| | |
|---|---|
| `main` at activation | `73baf382bee72458c192c86470982c1eec3e56b1` |
| policy foundation (#1822) | `51819f4763602220cb8feaa311acde3b46a4cbb5` |
| non-production activation (#1823) | `d84389f4570c8f55ef376024f60de44ede01e1f7` |
| merge record (#1824) | `73baf382bee72458c192c86470982c1eec3e56b1` |

## 2. What exists, measured

### Vercel — EXISTS

| | |
|---|---|
| project | `taylor-parts-preview` (team `verenward`) |
| domain | `https://taylor-parts-preview.vercel.app` |
| deployment | `taylor-parts-preview-5sukz11no-verenward.vercel.app` |
| source | `main` @ `73baf38` |
| runtime | Node 24.x · region `iad1` |
| deployed identity | `/version.json` → `commit 73baf38`, `environmentId platform-sandbox`, `environmentRole sandbox`, built `2026-09-09T04:47:07Z` |

Read from the running site, not from a dashboard screenshot: the build serves at `/`, and its own
`version.json` reports the commit — the platform's established way of proving deployed identity
rather than inferring it from an exit code.

**`VITE_EOS_API_BASE_URL` is NOT set in this build.** Every Administration policy panel therefore
reports NOT CONFIGURED, which is the honest state while no API exists.

> **A Vercel environment variable alone will not change this.** Vite inlines `VITE_*` values at
> BUILD time. Setting the variable and not redeploying leaves the old value — absent — compiled into
> the bundle, and the panels keep saying NOT CONFIGURED while the dashboard says otherwise. **The
> variable must be set and then the preview REDEPLOYED.**

### Render — DOES NOT EXIST

Neither the PostgreSQL database nor the API service has been created. This environment has no
Render CLI, no `RENDER_API_KEY`, and no Render credentials of any kind, so nothing could be created
from here. No credential was guessed and none was requested from a file.

## 3. What this branch adds so the Render side is one step, not a scavenger hunt

### `render.yaml` — the Blueprint

Declares both resources so the environment is reviewable and reproducible instead of a sequence of
dashboard clicks somebody has to remember:

- `eos-policy-nonprod` — PostgreSQL 16, smallest tier, `ipAllowList: []` so nothing reaches it from
  the public internet.
- `eos-api-nonprod` — web service, `rootDir: functions`, health check `/health`.

**No secret is in it, and none can be added by accident.** Every credential value carries
`sync: false`, so Render prompts for it in the dashboard and never reads it from the repository.
`DATABASE_URL` is wired `fromDatabase`, so Render substitutes the database's INTERNAL connection
string: the value never appears in the repository, in a build log, or in a browser.

### A real entry point

`functions/scripts/runEosApiLocal.mjs` → **`functions/scripts/serveEosApi.mjs`**, and
`functions/package.json` gains `"start": "node scripts/serveEosApi.mjs"`.

The old name and its header claimed the file was development-only. That was never true of its
behaviour — it reads configuration from the environment and starts the server, which is exactly what
a hosted process does. Writing a second, near-identical "production" entry would have been two
things to keep in step, and the one that drifts is always the one nobody runs locally.

### Migrations are not run by the build

A build that migrates would migrate on every deploy of every instance, concurrently, which is how a
schema change races itself. They are a deliberate release step:

```
cd functions && DATABASE_URL=<internal url> npm run migrate:up
```

The service fails closed if that step is skipped: `requirePolicyDatabaseReady` refuses to open the
socket when the database is reachable but unmigrated, so an unmigrated deploy reports unhealthy
rather than serving requests that all fail.

## 4. Proved locally against the exact hosted configuration

Not a substitute for the deployed proof — a demonstration that the Render configuration in this
branch is correct before anybody pays for a service to find out.

Run with `EOS_ENVIRONMENT=nonprod`, a Render-shaped `PORT`, the real Vercel origin, and a real
PostgreSQL carrying all three migrations:

```
$ npm start
> node scripts/serveEosApi.mjs
EOS API listening on 8795

$ curl /health
{"ok":true,"environment":"nonprod","reachable":true,"migrated":true,"latencyMs":2,"migrations":3}
```

| proof | result |
|---|---|
| `npm start` — the Blueprint's `startCommand` | starts, binds `PORT` |
| health separates PROCESS / REACHABLE / MIGRATED | `reachable: true`, `migrated: true`, `migrations: 3` |
| CORS, real Vercel origin `https://taylor-parts-preview.vercel.app` | echoed, with `Vary: Origin` and `Cache-Control: no-store` |
| CORS, unlisted origin `https://evil.example` | **no** `Access-Control-Allow-Origin` — refused |
| wildcard | never emitted; `readServiceConfig` refuses a `*` outright |
| unauthenticated `POST /admin/policy` | `401 UNAUTHENTICATED` before any policy read |

## 5. Blocked, and exactly why

Everything below needs a Render account action. None of it can be done from this environment.

| # | blocked item | what unblocks it |
|---|---|---|
| 1 | create `eos-policy-nonprod` PostgreSQL | Render account access, or a `RENDER_API_KEY` |
| 2 | create `eos-api-nonprod` web service | same |
| 3 | run migrations 001/002/003 against it | the database existing |
| 4 | bootstrap the `taylor-nonprod` tenant | the database existing |
| 5 | bootstrap the first administrator | **the exact non-production Firebase Auth subject/UID.** Not inferred from an email in a document, a git author, a username or a display name — the bootstrap is one-time and principal-bound, and guessing the principal is the one mistake it cannot undo |
| 6 | set `VITE_EOS_API_BASE_URL` + **redeploy** the preview | the API URL existing |
| 7 | cloud browser acceptance, restart proof, real tenant-isolation proof | all of the above |

The identity credential for the API (`GOOGLE_APPLICATION_CREDENTIALS_JSON`,
`GOOGLE_CLOUD_PROJECT`) must be a **non-production** Firebase service account, stored in Render's
secret facility. If it is unavailable the service still deploys and reports healthy; authenticated
Admin calls stay blocked, which is the correct failure.

## 6. The Firebase boundary, restated because deployment is when it gets blurred

Firebase answers exactly one question — *which subject authenticated* — and no claim it returns is
read as EOS authority. Not a custom claim, not `users/{uid}.role`, not `employees.securityRole`, not
a compatibility Role string.

Firestore policy reads and writes introduced by this work: **0** and **0**, enforced by a static
guard whose allowlist contains one read-only, uncalled migration parity harness.

**Firebase is not removed.** It still provides authentication, and the rest of the application still
uses Firestore for business data. Nothing here changes either.

## 7. Cost posture

Smallest tiers that exist, declared in the Blueprint: `basic-256mb` PostgreSQL and a `starter` web
service. No replicas, no HA topology, no workers, no cron. This environment holds one
non-production tenant's configuration — tens of thousands of rows — and is not a load test. Sizing
up to solve a slow query would be buying capacity to hide a missing index.

Note for testing: a `starter` service spins down when idle, so the first request after a quiet
period pays a cold start. That is a testing inconvenience, not a fault, and it is not a reason to
buy a larger tier.

## 8. Parts / Purchasing — readiness assessment ONLY

**Not started. No implementation, no migration, no Rules change.**

It remains the right first domain: the only one already measured, formalised and seeded — 9 states,
11 actions, each carrying the capability it is measured to require, with D-5 having settled which
authority owns what.

What must be resolved BEFORE any cutover begins, named rather than waved at:

- **Receiving is a second live source authority** over the same records (`purchase_orders` and the
  legacy `reorder_purchase_orders`), deployed and serving today.
- **`recordReorderPurchaseOrder` writes a request transition and a purchase order in ONE Admin-SDK
  transaction.** Whatever routes execution must preserve that atomicity, not re-implement it.
- **The acquisition-cost fact is written inside the receipt transaction and is immutable.** A
  cutover that replays receipts would either duplicate or orphan it.
- **Two record generations coexist and neither is migrated.** Rows predating the trusted command
  carry no warehouse/company keys.
- **`firestore.rules` currently denies the retired client-direct paths.** Cutover changes who
  writes, which is a Rules change and therefore **Tier 2**.
- **Rollback strategy is undefined.** Publishing a workflow version is currently inert; the moment
  execution routes through it, "roll back" means something and nobody has said what.
- **Ordering.** Nothing should route through the engine before this environment has run the
  Administration surfaces against a real database for long enough to trust them.
