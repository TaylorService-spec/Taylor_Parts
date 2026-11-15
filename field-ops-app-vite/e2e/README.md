# Parts browser network test (test infrastructure)

**This directory is test infrastructure, not an application change, and it is not a required CI check.** It needs a running
governed stack, which CI does not start.

## What it proves that the unit tests cannot

The vitest + jsdom suites render a Parts page with its hooks, its service clients, its session (`AuthContext`,
`sessionAccess`) and often its shell mocked or stubbed. They prove what a component does with an answer it is *handed*. They
cannot see what the real shell asks the real API, under a real governed session, when a real person opens the page.

`partsNetworkGraph.spec.mjs` signs in through the real login form (password, then TOTP), walks Parts Catalog, Part detail,
Part detail with `?requestId=`, and Receiving (direct loads and in-app transitions), waits for network idle plus a settle
window of at least 5 s, and records **every** request to the API origin: method, path, JSON `operation`, status, and the step
that fired it. **Any 4xx other than the pre-login `POST /auth/refresh` 401 fails the test**, whatever the operation is called.
It also asserts positive visibility (holders see what their grants allow) and, optionally, that the capabilities the
browser's own `resolveMyCapabilities` call returns equal a supplied live read.

Outputs (`EOS_NET_OUT_DIR`, default `field-ops-app-vite/e2e-output/`, git-ignored):

- `network-inventory.json` - machine-readable: per persona the steps, every request, the per-page matrix, violations, capabilities.
- `network-matrix.md` - persona x page x operation x status.

## Run it locally (Windows or Linux, Node 22)

Prerequisites: a loopback Postgres 16 you own (`EOS_NET_PG_URL`, default `postgres://eos@127.0.0.1:55499`; the user needs
CREATEDB), `npm ci` in `functions/` and `field-ops-app-vite/`, `npm run build` in `functions/`, and a Playwright Chromium
(`npx playwright install chromium`).

```bash
export EOS_NET_STATE_DIR=/path/outside/the/repo     # keys, credentials, pids, logs - never inside the repository
export EOS_NET_DB_NAME=pra_browser_1                # created if absent
cd field-ops-app-vite
node e2e/localStack/run.mjs                         # seed -> start API + Vite -> run the spec -> stop what it started
```

Pieces, if you want them separately: `node e2e/localStack/seedWorld.mjs [--reset]`, `node e2e/localStack/stack.mjs build|start|stop|status`,
then `npx playwright test -c playwright.network.config.mjs` with the `EOS_NET_*` variables below.

### What the local seed builds (all through the repository's governed paths)

Migrated database; bootstrapped tenant, administrator and owner; the Sample Company v2 world (Employees, Principals, Security
Roles, warehouses, suppliers, reorder/PO rows, Role -> capability grants reconciled from the Role catalog); the persona Roles
nonprod holds beyond the manifest (`docs/uat/data/personas.csv`); persona Operational Scopes via
`assignEmployeeOperationalScope`; a minimal Parts catalog including `PRT-1001`, its supplier terms, a Reorder request with a
recorded purchase order; and one EOS human login per persona (password + TOTP + recovery codes) through
`functions/scripts/enrollPersonaLogins.js --employees`. No capability row is inserted by hand. Every key and password is a
local test value generated on first run and written (mode 0600) to `EOS_NET_STATE_DIR`; nothing is printed.

The persona Roles and live Role-grant differences (the seven SUP-1 supplier-terms/cost grants live on `purchasingManager`; the
removed `finance.payment.read` on the parts Roles) are applied through the Administration API's own grant/revoke operations,
driven by `docs/uat/data/role-capability-grants.csv`. The browser's own `resolveMyCapabilities` answer is compared to a live
read when `EOS_NET_EXPECTED_CAPS_FILE` is set (parity is part of the spec's verdict).

The app is served as a **production build** (`stack.mjs` runs `vite build` then `vite preview`), as deployed. The dev server
runs React StrictMode's double effect, which defeats the one-shot cookie session restore on every reload (direct page loads
would look signed out); `EOS_NET_SERVE=dev` forces it anyway.

The seed refuses a non-loopback database. The API runs with `EOS_ENVIRONMENT=nonprod` and an ephemeral signing/factor
keyring, exactly like `.cursor/start.sh`.

## Run the same spec against a remote non-production target

The spec is target-configurable. Codex (or anyone with governed credentials for the persona accounts) can run it against a
non-production deployment:

```bash
EOS_NET_ALLOW_REMOTE=1 \
EOS_NET_APP_URL=https://<nonprod app origin> \
EOS_NET_API_ORIGIN=https://<nonprod EOS API origin> \
EOS_NET_CREDENTIALS_FILE=/abs/path/outside/repo/credentials.json \
EOS_NET_PART_ID=PRT-1001 EOS_NET_REQUEST_ID=<a real reorder request id on that target> \
EOS_NET_EXPECTED_CAPS_FILE=/abs/path/INV-PERSONA-LIVE-GRANTS.json \
npx playwright test -c playwright.network.config.mjs
```

- `EOS_NET_CREDENTIALS_FILE` is JSON `{ "entries": [ { "personaKey": "<employee id>", "loginIdentifier": "...", "password": "...", "totpSecretBase32": "..." } ] }`
  (the shape `enrollPersonaLogins.js` writes). Persona keys are the Employee ids, e.g. `synthetic-np-emp-parts-manager`.
- The spec **refuses** a production host, and refuses any non-loopback target unless `EOS_NET_ALLOW_REMOTE=1`.
- It is read-only: it navigates and observes, and never clicks a control that writes.
- `EOS_NET_PERSONAS=partsManager,partsAssociate` narrows the run.

## Reading a failure

A failing run is the evidence, not a flake: the matrix names the persona, page, operation and the server's refusal code. A
page that fires a read the server is certain to refuse is a defect in the page (see `src/access/partsReadGates.js`), not in
the test.
