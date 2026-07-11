---
name: run-field-ops-app-vite
description: Launch, sign in to, and drive the Field Ops web app (field-ops-app-vite) in a real browser -- start the dev server, start the Firestore/Auth emulator, seed test accounts, and use the Playwright driver to log in, navigate, submit forms, and screenshot. Use when asked to run, test, verify, or screenshot the field-ops-app-vite app, or to confirm a UI change works end-to-end (e.g. the Inventory Reorder Request flow).
---

# Running field-ops-app-vite

All paths below are relative to `field-ops-app-vite/` (this skill's
unit), not to this skill directory.

This is a Vite + React + Firebase web app. It is driven with
**Playwright** (a devDependency added specifically for this skill --
this environment is native Windows, not the Linux container most
run-skills assume, so `chromium-cli`/`xvfb-run`/`apt-get` don't apply
here; see Gotchas). The driver script is
`.claude/skills/run-field-ops-app-vite/driver.mjs`.

**The app always points at the live production Firebase project
("taylor-parts") by default.** `src/firebase/firebase.js` now has an
opt-in emulator connection, gated behind `?emulator=1` in the URL --
absent that param, behavior is byte-identical to before this skill
existed. Never drive this app against production; always use the
emulator path below.

## Prerequisites

Already installed as devDependencies (`npm install` in
`field-ops-app-vite/` picks these up):
- `@playwright/test` (added for this skill)
- `firebase-admin` (added for this skill -- see Gotchas for why it's
  needed even though this is a client app)

Chromium browser binary (one-time, ~150MB):
```bash
npx playwright install chromium
```

The Firebase CLI (`firebase`) must be installed and on PATH -- it's
already used elsewhere in this repo for `firestore:rules` deploys.

## Run (agent path)

Three things need to be running, in order, then the driver:

**1. Start the Firestore + Auth emulator** (from the repo root, not
`field-ops-app-vite/` -- `firebase.json` lives at the root):
```bash
firebase emulators:start --only firestore,auth --project taylor-parts
```
Wait for both to respond before continuing:
```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080   # expect 200
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:9099   # expect 200
```

**2. Seed test accounts** (from `field-ops-app-vite/`):
```bash
node .claude/skills/run-field-ops-app-vite/seed.mjs
```
Creates three accounts (see `seed.mjs`'s `DRIVER_ACCOUNTS` for current
emails/passwords -- uids are assigned by the emulator, not fixed):
- `admin` -- `users/{uid}.role: "admin"`.
- `eligiblePartsManager` -- `role: "dispatcher"` (has Inventory nav
  access) whose linked Employee has `operationalRoles: ["PARTS_MANAGER"]`
  (grants NEEDS_PLANNING manual-entry eligibility, independent of the
  security role -- see Gotchas).
- `ineligibleDispatcher` -- plain `dispatcher`, no Employee link.

Also seeds: one part (`TST-1001`) with `RESERVED`-only ledger activity
(zero usage history -- the `NEEDS_PLANNING` state), one part
(`TST-1002`) with `CONSUMED` history (the `READY` state), and one
legacy-shape `reorder_requests` document (no `requestedQty` field --
proves the display fallback).

**3. Start the dev server** (from `field-ops-app-vite/`):
```bash
npm run dev
```
Note the port it actually binds -- if `5173` is already in use it
picks the next free one (`5174`, ...) and logs it. Confirm it's up:
```bash
curl -s -o /dev/null -w "%{http_code}" "http://localhost:<port>/Taylor_Parts/field-ops/"   # expect 200
```
Use `localhost`, not `127.0.0.1` -- `127.0.0.1` did not resolve in
this environment even though `localhost` did (see Gotchas).

**4. Drive it** (from `field-ops-app-vite/`; edit `BASE_URL`'s port in
`driver.mjs` first if the dev server picked something other than 5173):
```bash
node .claude/skills/run-field-ops-app-vite/driver.mjs <command> [args]
```

Commands (full reference in `driver.mjs`'s header comment):
| Command | What it does |
|---|---|
| `login <accountKey> [outPng]` | Sign in via the real `Login.jsx` form, screenshot the authenticated shell. |
| `inventory <accountKey> [outPng]` | Login, navigate to Inventory > Parts, screenshot the queue. |
| `needs-planning <accountKey> [outPng]` | Login, navigate to Inventory, switch to the "Needs Planning" filter, screenshot. |
| `submit-manual-qty <accountKey> <qty> [outPng]` | Login, switch to "Needs Planning", enter `<qty>`, click "Request Reorder", screenshot the result. |
| `submit-ready <accountKey> [outPng]` | Login, "Show All" filter, one-click "Request Reorder" on a `READY` part, screenshot. |

`accountKey` is one of `admin` / `eligiblePartsManager` /
`ineligibleDispatcher` (from `seed.mjs`). Screenshots land in
`.claude/skills/run-field-ops-app-vite/screenshots/`.

Example session actually run in this environment (all four true
outcomes observed and screenshotted):
```bash
node .claude/skills/run-field-ops-app-vite/driver.mjs login admin
node .claude/skills/run-field-ops-app-vite/driver.mjs inventory admin
node .claude/skills/run-field-ops-app-vite/driver.mjs needs-planning admin
node .claude/skills/run-field-ops-app-vite/driver.mjs needs-planning ineligibleDispatcher ineligible.png
node .claude/skills/run-field-ops-app-vite/driver.mjs submit-manual-qty eligiblePartsManager 5 submit-eligible.png
node .claude/skills/run-field-ops-app-vite/driver.mjs submit-ready admin
```

**5. Tear down** when done. The dev server and emulator are both plain
background processes (`node`/`java`) -- on Windows, find and stop them
by command line (this is what actually worked in this environment):
```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'vite' -or $_.CommandLine -match 'firebase emulators' -or $_.CommandLine -match 'cloud-firestore-emulator' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
```
On Linux/macOS, `pkill -f "firebase emulators"` and `pkill -f vite`
are the equivalent (not verified in this environment -- it's Windows,
see Gotchas).

The emulator holds no persistent state by default -- next
`emulators:start` begins empty, so `seed.mjs` must re-run each
session.

## Direct invocation (no browser needed)

Most PRs in this sprint touched pure domain logic
(`src/domain/inventoryAnalyticsEngine.ts`,
`src/domain/inventoryReorderRequests.js`) with no Firebase
side-effecting import at module scope for the *engine* file
specifically. For that file, a standalone Node script with the logic
inline-replicated (not imported -- `inventoryReorderRequests.js` does
import `firebase/firebase.js`, which now throws without a project
context unless run in a browser) is this repo's own established
pattern for verifying domain logic without a browser -- see any
`docs/implementation-plans/*.md`'s "Testing strategy" sections from
this sprint for real examples. Prefer that path when the change is
domain-logic-only and doesn't touch UI wiring or Firebase Rules.

For Firestore Rules changes specifically, this repo already has a
dedicated emulator-based Rules test pattern -- see
`functions/test/employeesRules.test.js` and
`functions/test/reorderRequestsRules.test.js`. Not this skill's
concern; use those directly for Rules-only changes.

## Run (human path)

```bash
npm run dev
```
Opens on `http://localhost:5173/Taylor_Parts/field-ops/` (or the next
free port). Sign in with a real Firebase account against the live
project, or append `?emulator=1` and use `seed.mjs`'s accounts against
a locally running emulator. Useless headless -- this path is for a
human with a browser.

## Gotchas

- **This environment is native Windows, not a Linux container.**
  `chromium-cli`, `apt-get`, `xvfb-run` -- none of it applies. The
  `run`/`run-skill-generator` skills' own guidance is written assuming
  Linux; the adaptation here is Playwright's Node API directly
  (`chromium.launch()`), which works identically cross-platform.
- **The app always talks to live production Firebase by default.**
  There was no emulator-mode toggle before this skill --
  `src/firebase/firebase.js` had `initializeApp(firebaseConfig)` with
  no `connectFirestoreEmulator`/`connectAuthEmulator` calls anywhere.
  Patched behind `?emulator=1` (URL-param mode-switching, matching
  `src/config/env.js`'s existing `?env=demo` convention) -- absent
  that param, behavior is unchanged. **Never drive this app without
  the param**, or you will be reading/writing the real project.
- **`users/{userId}` denies all client writes unconditionally**
  (`firestore.rules`: `allow write: if false` -- "Role docs are
  provisioned by an admin... never by the client"). An unauthenticated
  REST `PATCH` from the seed script hit `403 PERMISSION_DENIED` even
  against the *emulator* -- Firestore Rules are enforced in the
  emulator too, and a plain REST call has no privileged context.
  `firebase-admin`'s Admin SDK bypasses rules entirely by design (same
  reason `functions/test/employeesRules.test.js` already uses it) --
  that's why it's a devDependency here despite this being a client app
  that otherwise never needs it.
- **The Auth emulator's public `accounts:signUp` endpoint rejects a
  custom `localId`** (`UNEXPECTED_PARAMETER`), even though `firebase-admin`'s
  privileged `createUser({ uid, ... })` can set one. `seed.mjs` uses
  `firebase-admin`'s Admin Auth API for exactly this reason -- lets a
  fixed uid be planned in advance and referenced by the Firestore docs
  written in the same script.
- **A naive ESM "run only when executed directly" guard breaks on
  Windows.** `import.meta.url === \`file://${process.argv[1]}\`` never
  matches on Windows -- `file://` URLs there have a third slash before
  the drive letter (`file:///D:/...`), so the plain template-literal
  comparison silently fails and the guarded code never runs (confirmed
  live: `node seed.mjs` printed nothing, seeded nothing, no error).
  Fixed with `fileURLToPath(import.meta.url) === process.argv[1]`
  instead (see `seed.mjs`).
- **`ROLES.TECHNICIAN` has zero Inventory nav access**
  (`src/navigation/navConfig.js`'s `ROLE_NAV_ACCESS`), independent of
  Employee `operationalRoles`. A pure technician granted
  `operationalRoles: ["PARTS_MANAGER"]` (this sprint's NEEDS_PLANNING
  eligibility model) can pass every server-side and client-side
  eligibility check and still never reach the screen, because the
  "Inventory" top-nav link itself doesn't render for that security
  role. Discovered live while building this driver -- worked around by
  seeding the eligible test account as `dispatcher` (which does have
  nav access) instead of `technician`, since `RequestReorderControl`'s
  own eligibility logic is blind to `isAdminOrDispatcher()` either way.
  **This is a real product gap, not fixed by this skill** -- worth a
  follow-up if a pure technician Parts Manager is ever a real scenario.
- **Seeded "high consumption" didn't reliably land a part in
  `CRITICAL`/`HIGH`.** `TST-1002`'s seeded usage came out `LOW`
  urgency in practice -- still a fully valid `READY`/analytics-backed
  case, just not in the default "Critical & High" queue filter. The
  `submit-ready` driver command uses "Show All" for this reason, not
  the default filter.
- **Use `localhost`, not `127.0.0.1`, for the dev server.**
  `127.0.0.1:5173`/`5174` returned connection-refused in this
  environment (`curl` exit 7) even while the same port responded fine
  on `localhost`. Not fully root-caused (likely an IPv6/hosts
  resolution quirk); just use `localhost` and it works.
- **Stray/duplicate dev-server processes accumulate across a long
  session.** Branch-switching + repeated `npm run dev` calls left two
  Vite processes running on different ports at once mid-session.
  Check `Get-CimInstance Win32_Process | Where CommandLine -match
  'vite'` (PowerShell) before assuming a fresh port means a fresh
  server.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `admin.firestore is not a function` (or `admin.auth is not a function`) | Using the default `import admin from "firebase-admin"` in an `.mjs` file doesn't expose the namespaced methods the way CommonJS `require()` does. Use the submodule imports instead: `import { initializeApp } from "firebase-admin/app"`, `import { getFirestore } from "firebase-admin/firestore"`, `import { getAuth } from "firebase-admin/auth"`. |
| `seed.mjs` runs silently, prints nothing, seeds nothing | The Windows `file://` triple-slash guard bug above -- check the self-invocation guard uses `fileURLToPath()`, not a raw template-literal comparison. |
| Driver hangs / times out waiting for `getByRole('link', { name: 'Inventory' })` | The signed-in account's `role` doesn't have Inventory nav access (see the `ROLES.TECHNICIAN` Gotcha) -- use `dispatcher` or `admin` for any flow that needs to reach Inventory. |
| `403 PERMISSION_DENIED` writing to `users/{uid}` via plain REST, even against the emulator | Firestore Rules apply in the emulator too. Use `firebase-admin` (bypasses rules) for any seeding write to a client-denied collection, not raw `fetch()`. |
| `npx playwright install chromium` warns about missing project dependencies | Harmless if `@playwright/test` is already a devDependency and `npm install` has run -- the warning fires because `npx` resolves a fresh, un-installed Playwright first. Re-run after `npm install`. |
