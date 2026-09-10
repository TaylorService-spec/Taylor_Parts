# EOS — REAL NON-PRODUCTION INFRASTRUCTURE ACTIVATION

**Status: BLOCKED ON RENDER ACCOUNT ACCESS. The frontend is deployed and the Blueprint is now
self-contained; the EOS API and its database still do not exist.**

Three states, kept apart on purpose, because conflating them is how "it's merged" becomes "it's
working":

| | what it means | where this platform is |
|---|---|---|
| **MERGED** | the code is on `main` | ✅ policy foundation, Administration editing, activation tranche |
| **DEPLOYED NONPROD** | a real environment runs it | ⚠️ frontend only — no API, no database |
| **PRODUCTION** | customers touch it | ❌ untouched, and out of scope |

---

## 1. Source

| | |
|---|---|
| `main` at this deployment attempt | `64a7f8c11efebb1815a25083c54262be7a7d7dab` |
| policy foundation (#1822) | `51819f4763602220cb8feaa311acde3b46a4cbb5` |
| non-production activation (#1823) | `d84389f4570c8f55ef376024f60de44ede01e1f7` |
| merge record (#1824) | `73baf382bee72458c192c86470982c1eec3e56b1` |
| Administration editing completion (#1827) | `4396844e7452643f9c1079702c71591940e89305` |
| real-nonprod activation tranche (#1825) | `056743d4aea134d1f39afd1686aaf3c9e7e113e9` |

`main` is two commits above `056743d4`, and the advance was **measured, not assumed**: `226a3214`
and `64a7f8c1` change `docs/customer-1/CUSTOMER_1_LEDGER.json` and
`docs/customer-1/CUSTOMER_1_READINESS.md` and nothing else — 2 files, 18 insertions, 11 deletions.
No deployable content differs from `056743d4`.

## 2. What exists, measured

### Vercel — EXISTS, and redeploys itself from `main`

| | |
|---|---|
| project | team `verenward` |
| domain | `https://verenwardeos.vercel.app` — **renamed 2026-09-10** from `taylor-parts-preview.vercel.app` |
| deployed identity | `/version.json` → `commit 226a321`, `environmentId platform-sandbox`, `environmentRole sandbox`, built `2026-09-10T02:09:52Z` |

Read from the running site, not from a dashboard screenshot. The build tracked `main` on its own:
nobody triggered it, and it is already carrying the docs-only advance described above. That matters
for the remaining work — a redeploy is not a thing anybody has to arrange, only a thing that has to
happen *after* the environment variable is set, because Vite inlines `VITE_*` at BUILD time.

**`VITE_EOS_API_BASE_URL` is still not set in this build.** Every Administration policy surface
therefore reports NOT CONFIGURED, which is the honest state while no API exists.

> **The renamed hostname does not serve the application yet.** Measured 2026-09-10:
> `https://verenwardeos.vercel.app` answers `404` with `DEPLOYMENT_NOT_FOUND`, while
> `https://taylor-parts-preview.vercel.app` still answers `200`. The governed configuration in this
> repository has been moved to the new name because that is the declared intent, and the allowlist
> is the one place a stale origin causes a total, silent failure rather than a partial one — but
> **until the new hostname is attached to a deployment, an application served from the old domain
> will be refused by CORS.** The two must cut over together. `EOS_ALLOWED_ORIGINS` is
> comma-separated and could carry both across the transition; that widens a security boundary, so
> it is not done here without being asked for.

### Render — DOES NOT EXIST, and could not be created from here

Checked rather than assumed, and all four ways came back empty:

| checked | result |
|---|---|
| `render` CLI on PATH | absent |
| `RENDER_*` environment variables | none set |
| `~/.render`, `~/.config/render` | do not exist |
| a signed-in browser session to drive the dashboard | no Chrome extension is connected (`list_connected_browsers` → `[]`) |

No credential was guessed, and none was searched for in a file.

### Firebase — the non-production project is now determined, not assumed

`eos-platform-sandbox`.

Not inferred from a name. The deployed preview reports `environmentId: platform-sandbox`, and
`config/environments.json` — the one registry the Vite build injects Firebase identity from — maps
that environment to project `eos-platform-sandbox`, `authDomain
eos-platform-sandbox.firebaseapp.com`. The same registry names `taylor-parts` as production and
`eos-platform-certification` as Certification, so the two projects this work must never touch are
identified from the same source as the one it must.

## 3. The identity defect this attempt found before anybody paid for it

`render.yaml` declared `GOOGLE_APPLICATION_CREDENTIALS_JSON` as a prompted secret.

**Nothing reads it.** `firebase-admin` reads `GOOGLE_APPLICATION_CREDENTIALS` — a FILE PATH — and
has no inline `_JSON` variant. A search of the repository finds that key in `render.yaml` and in
the one sentence of documentation describing `render.yaml`, and nowhere else. The first deploy
would have started healthy, served `/health` happily, and then failed every authenticated Admin
call, with a dashboard full of correctly-entered configuration insisting otherwise.

The fix is not to wire the key up. It is to notice that **token verification needs no credential at
all**:

```
$ GOOGLE_CLOUD_PROJECT=eos-platform-sandbox node -e '<verifyIdToken on an unsigned JWT>'
Firebase ID token has "kid" claim which does not correspond to a known public key.

$ node -e '<the same, with the variable unset>'
Must initialize app with a cert credential or set your Firebase project ID as the
GOOGLE_CLOUD_PROJECT environment variable to call verifyIdToken().
```

With no credential present, `initializeApp()` succeeds and verification proceeds all the way to
checking the token's `kid` against Google's live public certificates. What it cannot do without is
the **project id**. So:

- `GOOGLE_APPLICATION_CREDENTIALS_JSON` — **removed.** Keeping it would have had a service-account
  private key pasted into an environment that never opens it: a real credential, with a real blast
  radius, in exchange for nothing.
- `GOOGLE_CLOUD_PROJECT` — **declared with its value**, `eos-platform-sandbox`, rather than
  prompted. A Firebase project id is public, and this is the one value identity cannot run without;
  leaving it to be typed into a dashboard invites a typo in exactly the wrong place.
- `EOS_ALLOWED_ORIGINS` — **declared with its value**, `https://verenwardeos.vercel.app`, for the
  same reason. An origin is not a credential.

The Blueprint now declares **no `sync: false` value at all**. The environment stands up from the
file alone: nothing to paste, nothing to remember to rotate. The one genuinely secret value — the
database connection string — is still never written by anybody, because Render injects it
`fromDatabase`.

`functions/test/eosApiBlueprint.test.mjs` holds all of this as assertions, including the
credential-free verification measurement re-run against the real `firebase-admin`, and is
registered in `npm run test:adminPolicy`, which CI runs on any change to `render.yaml`.

## 4. What is on `main` so the Render side is one sitting, not a scavenger hunt

### `render.yaml` — the Blueprint

- `eos-policy-nonprod` — PostgreSQL 16, `basic-256mb`, `ipAllowList: []` so nothing reaches it from
  the public internet.
- `eos-api-nonprod` — `starter` web service, `rootDir: functions`, health check `/health`.
- four environment variables, no prompted secret, no workers, no cron, no replicas.

### A real entry point

`functions/scripts/serveEosApi.mjs`, with `functions/package.json` carrying
`"start": "node scripts/serveEosApi.mjs"` — the Blueprint's `startCommand` is the same command a
developer runs, so the one that drifts is not the one nobody runs locally.

### Migrations are not run by the build

A build that migrates ties schema mutation to artifact construction. The Blueprint uses Render's
`preDeployCommand`, which runs after `buildCommand` and before `startCommand`, from the service's
`functions` root:

```
build
  ↓
preDeployCommand: npm run migrate:up
  ↓
start EOS API
  ↓
/health verifies reachable + migrated
```

The service fails closed if the database is unreachable or unmigrated: `requirePolicyDatabaseReady`
refuses to open the socket, so an invalid deploy reports unhealthy rather than serving requests
that all fail.

### One build flag that would otherwise fail the first deploy

`buildCommand` carries `--include=dev`. Render sets `NODE_ENV=production` for a Node service; under
that npm omits devDependencies, which is where `typescript` correctly lives. Measured rather than
assumed: `npm ls typescript --omit=dev` resolves to `(empty)` in this package, while
`npm ls typescript` resolves to `typescript@5.9.3`.

`node-pg-migrate` and `pg` are runtime **dependencies**, so `preDeployCommand` and the service keep
working whatever the install flags are.

## 5. Proved locally against the exact hosted configuration

Not a substitute for the deployed proof — a demonstration that the configuration is correct before
anybody pays for a service to find out.

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
| CORS, the then-current Vercel origin `https://taylor-parts-preview.vercel.app` | echoed, with `Vary: Origin` and `Cache-Control: no-store` |
| CORS, unlisted origin `https://evil.example` | **no** `Access-Control-Allow-Origin` — refused |
| wildcard | never emitted; `readServiceConfig` refuses a `*` outright |
| unauthenticated `POST /admin/policy` | `401 UNAUTHENTICATED` before any policy read |
| token verification with no service-account credential | reaches public-key checking (§3) |

## 6. The remaining work, in order, with every value already decided

Everything below needs a Render account action. None of it can be done from this environment.

**1 — Create the Blueprint.** Render → New → Blueprint → repository
`TaylorService-spec/Taylor_Parts`, branch `main`, file `render.yaml`. It creates both resources and
asks for nothing: there is no `sync: false` value left to fill in. Do not create either resource by
hand as well.

**2 — Watch the first deploy do three things in order.** `npm ci --include=dev … && npm run build`,
then `npm run migrate:up`, then `npm start`. The migration phase must report migrations `001`
(`1757462400000_admin-policy.sql`), `002` (`1757548800000_tenant-and-identity.sql`) and `003`
(`1757635200000_assignment-integrity.sql`) applied. If a table is missing afterwards, the answer is
never to create it by hand.

**3 — Read `/health`, and do not accept an HTTP 200 as the answer.** It reports three separate
facts, and only all three green is a deploy: `reachable: true` (the database answered),
`migrated: true` with `migrations: 3` (the schema is current), and the process being up at all.

**4 — Bootstrap the tenant** with the canonical command, never manual SQL: key `taylor-nonprod`,
display "Taylor Freezer of Arizona — Non-Production". Expect 37 Objects, 394 Fields, 46 Roles, 3
workflow business areas, 5 workflow state machines, **all five DRAFT**. Run it a second time and
confirm the same tenant id, no duplicate rows and no reset configuration.

**5 — Bootstrap the first administrator** — *blocked, see §7*.

**6 — Set `VITE_EOS_API_BASE_URL`** on the Vercel project's **Preview** environment only, to the
`eos-api-nonprod` HTTPS URL, then **redeploy**. Setting the variable alone changes nothing: Vite
inlines `VITE_*` at build time, so the old bundle keeps saying NOT CONFIGURED while the dashboard
says otherwise. Do not touch the Production environment.

**7 — Then, and only then,** the cloud browser acceptance at 1440/1024/375, the tenant-isolation
proof against a second minimal tenant, the audit assertions, and the hard restart proof.

## 7. Blocked, and exactly why

| # | blocked item | what unblocks it |
|---|---|---|
| 1 | create `eos-policy-nonprod` PostgreSQL | Render account access, or a `RENDER_API_KEY` |
| 2 | create `eos-api-nonprod` web service | same; its deploy runs migrations through `preDeployCommand` |
| 3 | bootstrap the `taylor-nonprod` tenant | the database and API existing with migrations applied |
| 4 | bootstrap the first administrator | **the exact `eos-platform-sandbox` Firebase Auth UID.** Not inferred from an email in a document, a git author, a username or a display name — the bootstrap is one-time and principal-bound, and guessing the principal is the one mistake it cannot undo |
| 5 | set `VITE_EOS_API_BASE_URL` + **redeploy** the preview | the API URL existing, and Vercel access |
| 6 | cloud browser acceptance, restart proof, tenant-isolation proof | all of the above |

Blocker 4 is now narrower than it was: the *project* is determined (`eos-platform-sandbox`), so
what remains is one value, readable at
`https://console.firebase.google.com/project/eos-platform-sandbox/authentication/users` — the User
UID column, for whichever account is to be the first administrator.

## 8. The Firebase boundary, restated because deployment is when it gets blurred

Firebase answers exactly one question — *which subject authenticated* — and no claim it returns is
read as EOS authority. Not a custom claim, not `users/{uid}.role`, not `employees.securityRole`,
not a compatibility Role string. `createFirebaseTokenVerifier` takes `decoded.uid` and discards the
rest of the token deliberately.

Firestore policy reads and writes introduced by this work: **0** and **0**, enforced by a static
guard whose allowlist contains one read-only, uncalled migration parity harness.

**Firebase is not removed.** It still provides authentication, and the rest of the application still
uses Firestore for business data. Nothing here changes either. What §3 removed is not Firebase — it
is a service-account key that was never being read.

## 9. Cost posture

`basic-256mb` PostgreSQL and the `starter` web-service plan (`0.5c-512mb` under Render's current
compute-plan naming). No replicas, no HA topology, no workers, no cron. This environment holds one
non-production tenant's configuration — tens of thousands of rows — and is not a load test. Sizing
up to solve a slow query would be buying capacity to hide a missing index.

The paid `starter` service must not be described as having the Free web-service idle spin-down
behaviour. Render's idle spin-down limitation applies to Free web services; this Blueprint does not
select the Free plan.

Actual billed amounts are not recorded here, because nothing has been created and quoting a price
nobody has been charged would be a guess.

## 10. Parts / Purchasing — readiness assessment ONLY

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
