# EOS — REAL NON-PRODUCTION INFRASTRUCTURE ACTIVATION

**Status: ACCEPTANCE INCOMPLETE — every server-side, tenant, audit and persistence proof passed
against the live deployment, and the stored policy renders correctly at 1440; the interactive UI
proofs and the 1024/375 passes did not complete because the browser input channel failed (§15).**

Four states, kept apart on purpose, because conflating them is how "it's merged" becomes "it's
working":

| | what it means | where this platform is |
|---|---|---|
| **MERGED** | the code is on `main` | ✅ policy foundation, Administration editing, activation tranche, Blueprint, origin rename, no-op audit fix |
| **DEPLOYED NONPROD** | a real environment runs it | ✅ browser → `verenwardeos.vercel.app` → `eos-api-nonprod.onrender.com` → PostgreSQL, one commit end to end |
| **ACCEPTED NONPROD** | a person has driven it and it held | ⚠️ server semantics, isolation, audit and restart ACCEPTED (§12) · rendering at 1440 ACCEPTED (§15) · UI mutations and 1024/375 NOT YET |
| **PRODUCTION** | customers touch it | ❌ untouched, and out of scope |

---

## 0. Current authority

What is true **now**. Everything below this section that describes an earlier moment says so.

| | |
|---|---|
| canonical frontend | **`https://verenwardeos.vercel.app`** |
| old frontend domain | `https://taylor-parts-preview.vercel.app` — **REMOVED** from the Vercel project by the Owner |
| EOS API | **`https://eos-api-nonprod.onrender.com`** |
| PostgreSQL | `eos-policy-nonprod` — PostgreSQL 16, `basic_256mb`, 15 GB, HA false, 0 read replicas, disk autoscaling false · migrations `001` `002` `003` |
| Render API | `eos-api-nonprod` — `starter`, 1 instance · deploy `dep-dah5rnhsrm7s7395kgn0` at `c1d691337c8d87bcee1a0b8b692e13a6b0081c69` |
| deployed `main` | **`c1d691337c8d87bcee1a0b8b692e13a6b0081c69`** — frontend and API on the same commit |
| tenant | `taylor-nonprod` · `tenant-6ce59be1-1979-45cd-9d17-a4969037fb25` |
| first administrator | EOS principal `639c1970-dbdb-4bc0-af7c-118559151e2f` ← Firebase subject `ZVu3lHTP1NQhj0Am04zTAGou0dx1` |
| workflows | 5 state machines, **all DRAFT** |

`main` advanced from `8740bf11` to `c1d69133` **during this acceptance run**, legitimately: #1831
fixed a defect the run found (§13). No other commit is in between.

## 1. Source

| | |
|---|---|
| **`main` DEPLOYED** | **`c1d691337c8d87bcee1a0b8b692e13a6b0081c69`** |
| no-op audit fix (#1831) — found by this acceptance run | `c1d691337c8d87bcee1a0b8b692e13a6b0081c69` |
| origin rename (#1830) | `8740bf1110512488b7044c992796beab45319333` |
| identity correction (#1828) | `1433347a840c7c6392ecde93002886bf296be190` |
| real-nonprod activation tranche (#1825) | `056743d4aea134d1f39afd1686aaf3c9e7e113e9` |
| Administration editing completion (#1827) | `4396844e7452643f9c1079702c71591940e89305` |
| merge record (#1824) | `73baf382bee72458c192c86470982c1eec3e56b1` |
| non-production activation (#1823) | `d84389f4570c8f55ef376024f60de44ede01e1f7` |
| policy foundation (#1822) | `51819f4763602220cb8feaa311acde3b46a4cbb5` |

## 2. What exists, measured

### Vercel

| | |
|---|---|
| canonical domain | `https://verenwardeos.vercel.app` |
| deployed identity | `/version.json` → `commit c1d6913`, `environmentId platform-sandbox`, `environmentRole sandbox`, built `2026-09-10T07:36:25.570Z` |
| API base URL | **compiled into the deployed bundle** — `assets/usePolicyStore-Dzqwa4VK.js` contains `function c(){let e=\`https://eos-api-nonprod.onrender.com\`…`: `policyApiBaseUrl()` with the value constant-folded in |

Read from the running site, not from a dashboard. Two cautions from measuring it, kept because each
would have produced a wrong answer:

- **The API URL is not in the entry chunk.** Scanning only the 25 chunks `index.html` references finds
  nothing; the policy client is lazily imported. Finding it took walking all 159 chunk names the entry
  bundle can import. A shallow scan would have reported "Vercel redeploy required" — falsely.
- **Setting a `VITE_*` variable is not the same as shipping it.** Vite inlines it at build time; the
  proof is the literal in the served file, not the dashboard.

### Old domain — removal measured

```
https://taylor-parts-preview.vercel.app/              404  X-Vercel-Error: DEPLOYMENT_NOT_FOUND
https://taylor-parts-preview.vercel.app/version.json  404  DEPLOYMENT_NOT_FOUND
```

Vercel answers for the hostname but serves no deployment: it is no longer an EOS application
hostname. Separately, the API refuses it: `Origin: https://taylor-parts-preview.vercel.app` receives
no `Access-Control-Allow-Origin` (§11).

### Render — EXISTS. Deployed 2026-09-10 by the Owner from the Blueprint on `main`.

| | |
|---|---|
| deployed `main` | `1433347a840c7c6392ecde93002886bf296be190` |
| PostgreSQL | `eos-policy-nonprod` — AVAILABLE |
| web service | `eos-api-nonprod` — LIVE |
| API URL | `https://eos-api-nonprod.onrender.com` |
| migrations | `001`, `002`, `003` applied in `preDeployCommand`, not in the build |

Created by the Owner in the Render dashboard. This environment still has no Render credential of any
kind — no CLI, no `RENDER_*` variable, no `~/.render`, no browser session — so everything recorded
below about the *running* service was measured over HTTPS against the public URL, and everything
about resource creation, seeding and bootstrap is the Owner's report, marked as such. The two are
kept apart on purpose.

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

## 5. Proved against the DEPLOYED service, 2026-09-10 — BEFORE the rename

> **Historical.** Measured while `https://taylor-parts-preview.vercel.app` was the only frontend
> origin. The current, post-rename measurements are in §11. Nothing here was re-run or relabelled to
> look as though it was tested against `verenwardeos`.

Measured here, over HTTPS, against `https://eos-api-nonprod.onrender.com`. Nothing in this section
is a report; every line is a response.

### Health separates three questions, and answers all three

```
$ curl https://eos-api-nonprod.onrender.com/health
{"ok":true,"environment":"nonprod","reachable":true,"migrated":true,"latencyMs":2,"migrations":3}
HTTP 200
```

An HTTP 200 alone would say only that a process is alive. This says three things: the process is
serving, the database **answered** (`reachable`, 2 ms), and the schema is **current**
(`migrated`, `migrations: 3` — 001, 002 and 003). A deploy where the process is up and either of
the other two is false is not accepted, and would not have reached this state anyway:
`requirePolicyDatabaseReady` refuses to open the socket.

### CORS, against the real deployment

| request | result |
|---|---|
| `Origin: https://taylor-parts-preview.vercel.app` | `access-control-allow-origin` echoes it · `vary: Origin` · `Cache-Control: no-store` |
| `Origin: https://evil.example` | **no** `access-control-allow-origin` header at all — the browser refuses it |
| wildcard | never emitted |
| `OPTIONS` preflight from the allowed origin | `204` · methods `POST, GET, OPTIONS` · headers `authorization, content-type, x-eos-tenant` · `max-age 600` |

`/health` answers `200` to any caller, including the unlisted origin — it is a public liveness
endpoint and carries no tenant data. What the unlisted origin does not get is authorization for the
browser to read the response.

### The authorization boundary

```
POST /admin/policy                                    → 401
{"ok":false,"code":"UNAUTHENTICATED","message":"a bearer token is required"}
```

Refused before any policy read. And the identity fix from #1828 is proved in the deployed service,
not merely locally:

```
POST /admin/policy   Authorization: Bearer <structurally valid, unsigned JWT>   → 401
{"ok":false,"code":"UNAUTHENTICATED","message":"the token could not be verified"}
```

"Could not be verified" — not a 500, not a missing-credential error. **The deployed service ran real
Firebase token verification with no service-account key present**, which is exactly what §3
predicted and the reason no such key was ever pasted into Render.

## 5.1 Proved locally beforehand, against the same configuration

A demonstration that the configuration was correct before anybody paid for a service to find out.
Superseded by §5, and kept because it is what made §5 uneventful.

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

## 6. What the Owner ran, and what it produced

Reported by the Owner from the Render environment, recorded here as their report rather than as
something measured from this session. What *was* measured from here is §5.

### The tenant

| | |
|---|---|
| key | `taylor-nonprod` |
| bootstrap | canonical command, no manual SQL |

Seed v1:

| | |
|---|---|
| objects | 37 |
| fields | 394 |
| roles | 46 |
| object permissions | 253 |
| workflows | 5 |
| workflow versions | 5 |
| steps | 36 |
| actions | 48 |
| role bindings | 112 |

**All five workflow state machines remain DRAFT.** Publishing one is currently inert, and nothing
routes business execution through the engine.

Re-running the tenant bootstrap produced **zero new seed rows** — the same tenant, no duplicated
objects, fields, roles or workflows, and no configuration reset. That is the idempotence the tenant
bootstrap is supposed to have.

### The first administrator

| | |
|---|---|
| external subject | `ZVu3lHTP1NQhj0Am04zTAGou0dx1` (`admin@sandbox.invalid`, `eos-platform-sandbox` — §7.1) |
| EOS principal | `639c1970-dbdb-4bc0-af7c-118559151e2f` |
| Admin Role assignment | `a835defa-239b-43c9-8ee4-f1376a8c1c23` |
| access version | 1 |

Note the shape: the Firebase subject and the EOS principal are **different identifiers**. Firebase
said who authenticated; EOS minted its own principal and hung the authority off that. Nothing in the
token became authority.

### The administrator bootstrap is ONE-TIME, and that is not the same as idempotent

An earlier draft of this document said to run it twice and confirm it "neither duplicates nor
overwrites". That framing was wrong, and it mattered enough to correct rather than quietly reword:
it invites the reader to expect a second run to *succeed harmlessly*. It does not. It is **refused**:

```
this tenant has already been bootstrapped; assign Roles through the trusted Admin API
```

The two bootstraps are deliberately different, and the difference is the point:

- **Tenant bootstrap is idempotent** — it describes a desired configuration, so running it again
  converging on the same rows is correct.
- **Administrator bootstrap is one-time** — it is the act of granting the first authority in a
  tenant, in the one moment before any authority exists to check it against. A second run cannot be
  "harmless": either it would re-grant (a privileged mutation with no authorized actor behind it) or
  it would silently do nothing (indistinguishable, to whoever ran it, from having succeeded). A
  refusal is the only answer that is honest about which of those happened.

After that moment the tenant has an administrator, so every further grant goes through the trusted
Admin API with a real authenticated actor — which is exactly what the refusal message says to do.

## 7. The first administrator — resolved 2026-09-10

| | |
|---|---|
| Firebase project | `eos-platform-sandbox` |
| account | `admin@sandbox.invalid` — **named by the Owner**, not chosen here |
| Auth UID | `ZVu3lHTP1NQhj0Am04zTAGou0dx1` |
| how it was established | **read by the Owner from the Firebase console** and confirmed back |

The repository already carried that UID in three independent places — the 2026-08-06 provisioning
log recording the `createUser` result, a 2026-08-14 sandbox bootstrap keyed
`bootstrap-admin-ZVu3lHTP1NQhj0Am04zTAGou0dx1`, and a 2026-08-18 read of the live
`employees`/`users` link — and all three agreed. **None of them was treated as the answer.** A
document records what was true when it was written; an account deleted and recreated carries a new
UID, and the EOS bootstrap is one-time and principal-bound, so a stale value is the one mistake it
cannot undo. The console reading is the fact; the documents are corroboration that turned out to be
correct.

The project itself was determined the same way — from the running bundle rather than from a name:
`assets/firebase-*.js` on the deployed preview carries `eos-platform-sandbox.firebaseapp.com`.

`admin@sandbox.invalid` is a shared sandbox persona rather than a personal identity, which is
appropriate here and is not a trap: the first administrator can assign the Administrator Role to any
other principal afterwards, so this decides who bootstraps, not who governs.

## 8. The Firebase boundary, restated because deployment is when it gets blurred

Firebase answers exactly one question — *which subject authenticated* — and no claim it returns is
read as EOS authority. Not a custom claim, not `users/{uid}.role`, not `employees.securityRole`,
not a compatibility Role string. `createFirebaseTokenVerifier` takes `decoded.uid` and discards the
rest of the token deliberately.

Firestore policy reads and writes introduced by this work: **0** and **0**, enforced by a static
guard whose allowlist contains one read-only, uncalled migration parity harness.

The deployment bears this out in a way a static guard cannot — with one distinction kept honest.
**Declared, not measured:** `render.yaml` on `main` gives the service no Firebase credential, only
`GOOGLE_CLOUD_PROJECT`; this session cannot read the live Render environment to confirm nobody added
one by hand. **Measured:** a structurally valid, unsigned token is answered `401 "the token could not
be verified"` — real Firebase verification, running, with no key needed. Given the declared
configuration, the service *could not* read or write Firestore if something asked it to. The only Google call it can make is fetching public signing certificates, and the only
thing it does with a verified token is take `decoded.uid`. Every authority answer after that comes
from PostgreSQL: subject → principal (`639c1970-…`) → membership → Role assignment
(`a835defa-…`) → capability.

### Where Firebase stands at the end of acceptance

| | Firebase used? | evidence |
|---|---|---|
| authentication — who signed in | **YES** | measured: token verification running (401 on an unsigned token); the session token came from Firebase Identity Toolkit |
| tenant authority | no | measured: stated tenants refused against PostgreSQL membership (§12.5) |
| Role authority | no | measured: assignments, revoke, re-grant, access versions all in PostgreSQL (§12.4) |
| Object permissions | no | measured (§12.2) |
| Field permissions | no | measured — including a deleted override row (§12.2 R5) |
| workflow authority | no | measured: 5 versions read from PostgreSQL, all DRAFT; static: no Firebase import under `src/adminPolicy` |
| policy persistence | no | measured: survived process replacement, which a Firestore-backed path would not have had to (§12.7) |

Static, re-checked at the end of acceptance: the only Firestore reference under `src/adminPolicy`
is the allowlisted read-only parity harness, and **nothing references it** — it is unreachable from
the served entry. `adminPolicyHttp.ts` mentions Firebase only in a comment; it takes `verifyToken`
as a parameter.

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

Both resources exist, and their live configuration was **reported by the Owner from Render** on
2026-09-10 (this session's Render MCP could not be used without a confirmed workspace, so these are
recorded as reported, not independently read):

| | live |
|---|---|
| PostgreSQL `eos-policy-nonprod` | PostgreSQL 16 · `basic_256mb` · **15 GB** · HA **false** · read replicas **0** · disk autoscaling **false** |
| API `eos-api-nonprod` | `starter` · **1 instance** |
| current deploy | `dep-dah5rnhsrm7s7395kgn0` at `c1d691337c8d87bcee1a0b8b692e13a6b0081c69` |
| workers / cron | **0** / **0** |

These match the Blueprint's declarations exactly; the 15 GB disk is the one value the Blueprint does
not state. **Actual billed amounts are not recorded here**, because
this session cannot read the Render account and quoting a price nobody has shown me would be a
guess. What is recorded is the shape, which is what the Blueprint controls and what a later bill
has to be explained by: one database, one web service, **zero** workers, **zero** cron jobs,
**zero** replicas, no HA.

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

## 11. The rename, in the order it happened

History, not current state — kept because the evidence in §5 was measured against the old domain
and must stay legible as such. Nothing above or below has been rewritten to look as though it was
tested against `verenwardeos` before the rename.

| when (2026-09-10) | measured |
|---|---|
| before the rename | §5's CORS proofs run against `https://taylor-parts-preview.vercel.app`, then the only frontend origin |
| #1830 opened | `verenwardeos.vercel.app` → `404 DEPLOYMENT_NOT_FOUND`; old domain → `200`. The configuration moved; the hostname had not |
| first cutover attempt | still `404` on the new hostname — **stopped, not merged**, per the cutover gate |
| second attempt | both domains `200`, **one deployment behind two aliases** (identical commit and `buildTime`) → #1830 squash-merged `8740bf11` |
| Render Blueprint sync | API allowlist flips: new origin echoed, old origin refused |
| Owner removes the old domain | `taylor-parts-preview.vercel.app` → `404 DEPLOYMENT_NOT_FOUND` |

### Final health and CORS — measured on the deployment serving `c1d69133`

```
GET /health
{"ok":true,"environment":"nonprod","reachable":true,"migrated":true,"latencyMs":3,"migrations":3}   200
```

| request | result |
|---|---|
| `Origin: https://verenwardeos.vercel.app` | `access-control-allow-origin: https://verenwardeos.vercel.app` · `vary: Origin` · `Cache-Control: no-store` |
| `Origin: https://taylor-parts-preview.vercel.app` | **no** `access-control-allow-origin` · `Cache-Control: no-store` |
| `Origin: https://evil.example` | **no** `access-control-allow-origin` · `Cache-Control: no-store` |
| wildcard | never emitted on any request |
| `OPTIONS` from the canonical origin | `204` · `POST, GET, OPTIONS` · `authorization, content-type, x-eos-tenant` · `max-age 600` · `vary: Origin` |

## 12. Acceptance — what was proved, and how

**Every result in this section was measured against the deployed API** at
`https://eos-api-nonprod.onrender.com`, through the governed `POST /admin/policy` path, authenticated
as the sandbox administrator. No SQL touched the Render database from this session. **Direct Render
MCP SQL inspection currently fails because the query connector does not negotiate the TLS the
database requires; the EOS API itself reaches PostgreSQL successfully** (`/health`: `reachable true`,
and every result below). An earlier draft of this record called the database "unreachable by
design" — that overstated it and is corrected. Where a proof needed a database directly, it was run
on an isolated PostgreSQL 16 carrying the **same three migration files**, and says so.

**How the session was obtained.** A real Firebase ID token for `admin@sandbox.invalid` was minted
server-side through the repository's governed persona loader (`scripts/sandboxCredentials.mjs`) and
the real Identity Toolkit endpoint. The password was never printed. The token's subject came back as
`ZVu3lHTP1NQhj0Am04zTAGou0dx1` — independently re-confirming §7's console reading. That token is
the same credential a browser sign-in produces; the EOS API authorized it the ordinary way. An
attempt to restore that session *inside the browser* by writing it into IndexedDB was refused by the
tooling's safety layer, correctly — it is session forgery even with a legitimate credential — and it
was not worked around. That is why §14 needs a human sign-in.

### 12.1 Authority census

| | expected | measured through the API |
|---|---|---|
| tenant id | `tenant-6ce59be1-…` | echoed by the server on every response |
| objects | 37 | **37** |
| fields | 394 | **394** (sum of `readObjectWithFields` over all 37) |
| roles | 46 | **46** |
| object permissions | 253 | **253** (sum of `readRolePolicy` over all 46) |
| workflows / versions | 5 / 5 | **5 / 5** |
| steps / actions | 36 / 48 | **36 / 48** |
| role bindings | 112 | **not measurable through the API** — no read operation returns them (§14) |
| workflow state | all DRAFT | **all 5 DRAFT** — `partsPurchasing`, `salesAgreement`, `salesOpportunity`, `salesOrder`, `workOrder`, each `v1` |
| first admin assignment | `a835defa-…` | `a835defa-239b-43c9-8ee4-f1376a8c1c23`, `admin`, `global`, `active`, `accessVersionAtGrant 1` |

After acceptance the tenant holds 47 roles and 395 fields: the one custom Role and one custom Field
this run created, both prefixed `ZZ NONPROD`.

### 12.2 Roles & permissions — server semantics

| # | proof | result |
|---|---|---|
| R1 | create custom Role `zz_nonprod_acceptance` | ✅ one audit event · actor = EOS principal · `x-request-id` carried into the audit reason |
| R2 | edit Role name/description | ✅ persists |
| R2b | attempt to change the Role **key** | ✅ refused `400` · key unchanged |
| R3 | Object CRED on `salesTerritory` → `C✗ R✓ E✓ D✗` | ✅ persists |
| R4 | Field Inherit → **Deny** | ✅ an override row exists, `{R:false}` |
| R5 | Field Deny → **Inherit** | ✅ **the row is gone** — 0 rows for the field, not a stored `false` |
| R6 | explicit Field **Allow** under an open doorway | ✅ stored |
| R7 | close the Object doorway while the Field says Allow | ✅ accepted; the Allow override **stays stored** |
| R7b | write a *new* Field Allow under a closed doorway | accepted (`200`) — see note |
| R8 | Delete on a non-deletable Object | ✅ refused `400 "salesTerritory" does not support Delete` · **0** audit events |

**R7 / R7b, stated exactly.** The server stores a Field Allow whether or not the Object doorway is
open; the doorway invariant is enforced where access is *resolved*, not where overrides are
*stored*. That is consistent with the Administration UI's design — it renders exactly this state as
"Allow · blocked by object", which could not exist if the server refused it. The header of
`AdminPolicySurfaces.jsx` says "the server refuses the impossible grant"; measured, it does not
refuse the grant, it refuses to let the grant open the object. The wording is imprecise; the
behaviour is the designed one. The effective-access consequence is not exposed by any read operation
and is covered by the resolver's registered tests rather than measured here.

**Every one of the 37 objects has `supportsDelete: false`** in this seed, so Delete is the
unavailable verb on every object and every field.

### 12.3 Objects & fields

| # | proof | result |
|---|---|---|
| O1 | create custom Field `zzNonprodAcceptanceNote` (STRING, INTERNAL, searchable, reportable) | ✅ `origin: CUSTOM` |
| O2 | edit its label, description, sensitivity → CONFIDENTIAL | ✅ persists |
| O3 | attempt to change its **key** and **dataType** | key and dataType unchanged — but see §13: before the fix this answered `200` and audited an "update" |
| O4 | edit a **SYSTEM** field definition directly through the API | ✅ refused `400 "a SYSTEM field's definition is protected…"` · label unchanged · **0** audit events |
| O5 | Object metadata: label / labelPlural / description | ✅ persists — `labelPlural` is now "Sales Territories (ZZ NONPROD)" |
| O6 | attempt to change Object `key`, `supportsDelete`, `origin` | ✅ refused `400` · all three unchanged |

### 12.4 Users and assignments

| # | proof | result |
|---|---|---|
| U1 | principal projection | ✅ exactly `displayName, externalSubject, id, identityProvider, status` — nothing else, no token claims |
| U2 | assign the custom Role | ✅ one active row · access version `1 → 2` · one audit event |
| U3 | **identical** repeat | ✅ **same canonical id** · still one active row · access version unchanged · **0** audit events |
| U4 | revoke | ✅ row kept, status `disabled` · access version `2 → 3` · one audit event |
| U5 | re-grant | ✅ a **new** row · exactly one active · the revoked row still present |

The administrator's access version is **6**, not 4. The extra two are the defect in §13, measured
in the deployed data: two no-op permission probes each bumped every holder.

### 12.5 Tenant isolation

| # | proof | result | evidence |
|---|---|---|---|
| I1 | state the caller's own tenant | ✅ `200`, tenant echoed | live API |
| I2 | state a foreign tenant id | ✅ `403 FORBIDDEN` · **no fallback** to the caller's tenant | live API |
| I3 | state the second tenant's key `eos-isolation-proof` | ✅ `403 FORBIDDEN` · no fallback | live API |
| I4 | a **mutation** with a spoofed tenant | ✅ `403` · **0** audit events · nothing created in the caller's own tenant | live API |
| I5 | cross-tenant assignment straight at the database | ✅ refused **SQLSTATE `23503`** on `user_role_assignments_member_fk` | isolated PG 16, same migrations |
| I5c | the **identical row** for the principal's own tenant | ✅ accepted (then rolled back) — the FK is the only variable | isolated PG 16 |

Both tenants in I5 were created by the canonical `bootstrapTenant`; raw SQL was used for the one
negative-path insert only. A first attempt was refused with `23502` (a missing `id`), which proves
nothing about the foreign key and was **not counted**. The constraint on the deployed schema's
migration: `FOREIGN KEY (tenant_id, principal_id) REFERENCES eos_policy.tenant_memberships(tenant_id,
principal_id)`; the one-active index: `(tenant_id, principal_id, role_id, scope_type,
COALESCE(scope_value, ''))` `WHERE status = 'active'`.

**The second tenant was not created on Render**: tenant bootstrap is a database-side command, not an
API operation, and direct SQL against the Render database is not currently available (the Render MCP
query connector does not negotiate the required TLS — §14). I2–I4 prove the
isolation property that matters through the live API — a stated tenant the caller is not a member of
is refused, whether or not it exists — and the registered PostgreSQL suite proves it again with two
real tenants.

### 12.6 Audit

| case | proof | result |
|---|---|---|
| A — success | R1, U2, U4 | ✅ exactly one event each |
| B — refusal | R8, O4, I4 | ✅ **0** events each |
| C — idempotent no-op | U3 | ✅ **0** events — and **every other command after #1831** (§13) |
| D — rollback | duplicate custom-field key, live | ✅ `409 CONFLICT` · **0** events · still one field with that key |
| actor | latest event | ✅ `actorUid` = the EOS principal `639c1970-…`, never the Firebase subject |
| correlation | R1 | ✅ `x-request-id` folded into the event's `reason` |

`readPolicyAuditHistory` caps at 500; the tenant holds 32 events, so every delta above is exact.

D is stated precisely: the duplicate fails at the database's unique index inside the transaction,
before the audit append, and the transaction rolls back. It proves "a rolled-back transaction records
no success event", which is Step 7D. The registered PostgreSQL suite holds the same proof.

### 12.7 Hard restart — process replaced, data survived

Render replaced the API process when #1831 deployed. **This was a code-change deploy, not the
no-code restart the acceptance plan asked for**, and it is recorded as what it was — a
no-code restart needs Render access this session does not have (§14). As a persistence proof it is
not weaker: the new process was built and started from scratch and holds no memory of the old.

The new process was identified by behaviour, not by dashboard: a probe the old code answered `200`
began answering `400 nothing to update` about 91 seconds after the merge. The old process wrote **2**
false events while being polled — counted, not hidden.

A snapshot of every persistence target was taken **before** the merge and compared **after**:

| target | result |
|---|---|
| tenant id | survived |
| principals | survived |
| first admin assignment | survived |
| access version | survived (6) |
| custom Role | survived |
| Object CRED change | survived |
| Field override | survived |
| Object metadata change | survived |
| custom Field | survived |
| counts — 37 / 47 / 395 / 5 | survived |
| workflow states — all DRAFT | survived |
| assignment history (revoked + active) | survived |
| audit | **0 lost** · 2 added = exactly the 2 marker probes |

`/health` on the replacement process: `reachable true · migrated true · migrations 3`.

## 13. Defect found and fixed during acceptance

**#1831 — "A change that changes nothing is not a mutation"** · head `8e2d88b0` · squash
**`c1d691337c8d87bcee1a0b8b692e13a6b0081c69`** · 102/102 checks.

Measured on the deployed API at `8740bf11`: an **identical** `updateRole`, `updateObjectMetadata`,
`updateCustomFieldMetadata`, `setObjectPermission` and `setFieldPermissionOverride` each wrote an
audit event whose only change was `updatedAt`, and the two permission commands also bumped the
access version of every holder of the Role. Worse: `updateCustomFieldMetadata` naming only `key` and
`dataType` answered `200` and audited an "update" — the caller was told an identity change had
succeeded.

**Why it was allowed under the acceptance charter:** a defect against already-decided authority —
Ruling C made an identical assignment idempotent, and Step 7C requires that an identical no-op write
no mutation event. It narrows what the platform writes; it grants nothing, broadens no permission,
changes no governance, and touches no production, Certification, Rules or business data.

**Re-measured live on the replacement process:** all five identical probes → `200`, **0** audit
events, access version unchanged; the `key`/`dataType`-only request → `400 nothing to update`; a
real change still writes exactly one event.

Gates: `test:adminPolicy` 161/161 with a database (0 skipped) · `test:adminPolicyPostgres` 78/78 on
isolated PostgreSQL 16 · `test:governance` 667/667. Of the 9 new tests, **7 fail on `8740bf11`**; the
other 2 are over-reach guards that pass both before and after by design.

## 14. What is not done, and exactly why

| # | item | status | what unblocks it |
|---|---|---|---|
| 1 | **rendered UI acceptance** — the interactive half (mutations through the UI, reload persistence, 1024 and 375) | **PARTIAL — see §15** | the Claude window brought to the front: the Browser pane's clicks time out while it is covered |
| 2 | second tenant `eos-isolation-proof` **on Render** | not created | a working SQL/shell path to the Render database — tenant bootstrap is not an API operation, and the Render MCP query connector does not negotiate the required TLS |
| 3 | composite-FK SQLSTATE **on the Render database** | proved on isolated PG 16 with the same migrations instead | same |
| 4 | a **no-code** Render restart | **deferred by the Owner** — a code-change deploy replaced the process instead (§12.7) | Owner authorization |
| 5 | role bindings = 112 | not measurable | no read operation returns bindings — a read-surface gap, not a data finding |
| 6 | actual Render tiers, disk, HA, instance count | **recorded** from the Owner's Render report (§9) | — |
| 7 | deep links on the Vercel frontend | **FINDING** — `/administration/roles-permissions` returns HTTP 404; no `vercel.json` SPA rewrite exists (Firebase Hosting has `** → /index.html`). Any full reload on a route other than `/` 404s | a one-file `vercel.json` rewrite — not made, out of this run's scope |

Everything the server does has been accepted. What remains is the part only a rendered screen can
show, and the parts only the Render account can reach.


## 15. Rendered browser acceptance — 2026-09-10

Against `https://verenwardeos.vercel.app` → `https://eos-api-nonprod.onrender.com` → Render
PostgreSQL, signed in by the Owner. Read from the live page, not from source.

### Identity and wiring — measured in the page

| | |
|---|---|
| signed-in subject | `admin@sandbox.invalid` · uid `ZVu3lHTP1NQhj0Am04zTAGou0dx1` · the `eos-platform-sandbox` API key (read from the browser's own Firebase session store, read-only) |
| hosts the page talked to | `verenwardeos.vercel.app`, `identitytoolkit.googleapis.com`, `eos-api-nonprod.onrender.com`, plus `firestore.googleapis.com` and `us-central1-eos-platform-sandbox.cloudfunctions.net` for the rest of the app shell (dashboard and business surfaces, not the policy panel) |
| localhost / emulator | **none** — no such request, no `?emulator` flag |

### What rendered correctly at 1440

| proof | observed |
|---|---|
| the surface is the stored policy, not the measured reference | heading "Roles & permissions · this tenant's stored policy"; the measured model sits below it, labelled as reference |
| roles | 47 role selectors, including **ZZ NONPROD Acceptance Role (post-fix)** — the name the API run left |
| every Object | selecting the ZZ role renders **37** object rows under `Object / field · Create · Read · Edit · Delete` |
| Object CRED matches the database | Sales Territory: Create ☐ · Read ☑ · Edit ☑ · Delete **—** — exactly the stored `C✗ R✓ E✓` |
| unavailable verb | Delete renders **"—"** with no control on all 37 objects, and on every field beneath them |
| Object expands into Fields | Sales Territory expands to **7** field rows: its 6 SYSTEM fields and the custom **ZZ NONPROD Acceptance Note (edited)** |
| the four field facts | Created · Create → **Inherited · Deny** (object C ✗) · Created · Read → **Allow** (the stored explicit override) · Created · Edit → **Inherited · Allow** (object E ✓) · every field · Delete → **—** |
| three-state control | every governable field cell is an Inherit / Allow / Deny select, not a checkbox |

### What did NOT run, and exactly why

**The interactive half — changing a value through the UI, reloading, and re-reading it — and the
1024 and 375 passes did not complete.** Two separate things stopped it, and neither is an EOS
defect:

- **The Browser pane stopped delivering input.** Clicks timed out three times in a row with the
  pane reporting that Claude's window may be covered by another window, and before that the
  click-coordinate scale changed between consecutive clicks with nothing resized (×13.7, then ×1.25,
  then ×1.0). Keyboard input (`Enter`, `Space` on a focused control) did not reach the page at all.
  Evidence gathered through an input channel that unreliable would not be evidence.
- **`form_input` does not reach React on a checkbox.** It set the Sales Territory Create box to
  checked in the DOM but fired no request, because React's checkbox `onChange` is driven by the
  click event. That was a desync caused by the tool, not a save; the page was fully reloaded
  immediately afterwards and the stored value never changed (still `C✗`).

The server-side semantics behind every one of those interactive proofs were accepted against the
live API in §12. What remains unproven is specifically that the **rendered controls** issue those
calls — and that the layout holds at 1024 and 375.

### A finding from the attempt

**Deep links 404 on the Vercel frontend.** `GET /administration/roles-permissions` → HTTP **404**.
There is no `vercel.json`; Firebase Hosting carries an SPA rewrite (`** → /index.html`) and the
Vercel project has no equivalent, so a full browser reload on any route other than `/` fails, and
bookmarked or shared links do not open. In-app navigation is unaffected. Not fixed here: it is a
frontend deployment-config change outside this run's scope.
