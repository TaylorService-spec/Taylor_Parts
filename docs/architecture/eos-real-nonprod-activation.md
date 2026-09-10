# EOS — REAL NON-PRODUCTION INFRASTRUCTURE ACTIVATION

**Status: THE EOS POLICY PLATFORM IS RUNNING IN NON-PRODUCTION.** PostgreSQL, the trusted API,
three migrations, the `taylor-nonprod` tenant and its first administrator all exist. The frontend is
not yet pointed at the API, so nobody can use it from a browser yet.

Three states, kept apart on purpose, because conflating them is how "it's merged" becomes "it's
working":

| | what it means | where this platform is |
|---|---|---|
| **MERGED** | the code is on `main` | ✅ policy foundation, Administration editing, activation tranche, Blueprint |
| **DEPLOYED NONPROD** | a real environment runs it | ✅ API + database + tenant + administrator · ⚠️ frontend not yet wired |
| **ACCEPTED NONPROD** | a person has driven it and it held | ❌ not yet — browser acceptance, isolation, audit and restart proofs all outstanding |
| **PRODUCTION** | customers touch it | ❌ untouched, and out of scope |

---

## 1. Source

| | |
|---|---|
| **`main` DEPLOYED to Render** | **`1433347a840c7c6392ecde93002886bf296be190`** |
| identity correction (#1828) | `1433347a840c7c6392ecde93002886bf296be190` |
| policy foundation (#1822) | `51819f4763602220cb8feaa311acde3b46a4cbb5` |
| non-production activation (#1823) | `d84389f4570c8f55ef376024f60de44ede01e1f7` |
| merge record (#1824) | `73baf382bee72458c192c86470982c1eec3e56b1` |
| Administration editing completion (#1827) | `4396844e7452643f9c1079702c71591940e89305` |
| real-nonprod activation tranche (#1825) | `056743d4aea134d1f39afd1686aaf3c9e7e113e9` |

The deployed commit is `056743d4` (#1825) plus two docs-only commits and the #1828 identity
correction. The docs-only advance was **measured, not assumed**: `226a3214` and `64a7f8c1` change
`docs/customer-1/CUSTOMER_1_LEDGER.json` and `docs/customer-1/CUSTOMER_1_READINESS.md` and nothing
else — 2 files, 18 insertions, 11 deletions.

## 2. What exists, measured

### Vercel — EXISTS, and redeploys itself from `main`

| | |
|---|---|
| project | `taylor-parts-preview` (team `verenward`) |
| domain | `https://taylor-parts-preview.vercel.app` |
| deployed identity | `/version.json` → `commit 226a321`, `environmentId platform-sandbox`, `environmentRole sandbox`, built `2026-09-10T02:09:52Z` |

Read from the running site, not from a dashboard screenshot. The build tracked `main` on its own:
nobody triggered it, and it is already carrying the docs-only advance described above. That matters
for the remaining work — a redeploy is not a thing anybody has to arrange, only a thing that has to
happen *after* the environment variable is set, because Vite inlines `VITE_*` at BUILD time.

**`VITE_EOS_API_BASE_URL` is still not set in this build**, so every Administration policy surface
reports NOT CONFIGURED. That was the honest state while no API existed; now that one does, it is
simply the last wire that has not been connected — §7 step 1.

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
- `EOS_ALLOWED_ORIGINS` — **declared with its value**, `https://taylor-parts-preview.vercel.app`,
  for the same reason. An origin is not a credential.

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

## 5. Proved against the DEPLOYED service, 2026-09-10

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
| CORS, real Vercel origin `https://taylor-parts-preview.vercel.app` | echoed, with `Vary: Origin` and `Cache-Control: no-store` |
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

## 7. What remains

**1 — Wire Vercel.** `VITE_EOS_API_BASE_URL=https://eos-api-nonprod.onrender.com`, on the
`taylor-parts-preview` project's **Production** environment — then **redeploy**.

> **"Production" here is the environment of the `taylor-parts-preview` project, which builds the
> stable `taylor-parts-preview.vercel.app` domain. It is NOT Taylor's production frontend, which is
> a different Vercel project and is not touched.** The stable domain is the target precisely because
> it is the origin `EOS_ALLOWED_ORIGINS` allows: a per-deployment preview URL is a different origin
> and the API would refuse it.
>
> **Setting the variable alone changes nothing.** Vite inlines `VITE_*` at BUILD time, so the
> existing bundle keeps reporting NOT CONFIGURED while the dashboard says otherwise. The variable
> must be set and then a new deployment built.

**2 — Cloud browser acceptance** at 1440 / 1024 / 375, against Vercel → Render → PostgreSQL, with no
localhost, no emulator and no in-memory adapter anywhere in the path: the completed #1827
Administration experience, object CRED persistence across a full reload, field Inherit → Deny → back
to Inherit with the override row *gone*, the doorway rendering as "Allow · blocked by object",
Delete unavailable where the server refuses it, custom Role and custom Field create and edit.

**3 — Users and assignments**: the principal projection carrying exactly `id`, `displayName`,
`status`, `identityProvider`, `externalSubject` and nothing else; an identical repeat assignment
returning the same canonical row with no second active row, no access-version bump and no false
audit event; revoke and re-grant leaving the revoked row in history.

**4 — Tenant isolation** against a second minimal tenant, including the database proof that the
composite foreign key refuses a cross-tenant assignment, captured as a SQLSTATE.

**5 — Audit**: one event for a successful mutation, none for a refusal, none for an idempotent
no-op, none for a rollback.

**6 — Hard restart.** Replace the running process and prove every record above survived it. This is
what separates "PostgreSQL is authoritative" from "the process remembered".

### 7.1 The first administrator — resolved 2026-09-10

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

The deployment bears this out in a way a static guard cannot. The running service holds no Firebase
credential — only `GOOGLE_CLOUD_PROJECT` — so it *could not* read or write Firestore if something
asked it to. The only Google call it can make is fetching public signing certificates, and the only
thing it does with a verified token is take `decoded.uid`. Every authority answer after that comes
from PostgreSQL: subject → principal (`639c1970-…`) → membership → Role assignment
(`a835defa-…`) → capability.

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

Both resources now exist on those plans. **Actual billed amounts are not recorded here**, because
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
