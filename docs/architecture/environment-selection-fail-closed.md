# Environment selection: fail-closed

**Status:** active · **Scope:** every operator entry point that can reach real business data
**Gate:** `functions/test/environmentSelectionFailClosed.test.mjs` — `npm run test:environmentSelection`
(`.github/workflows/environment-selection-fail-closed-tests.yml`)

---

## The rule

> **NO EXPLICIT ENVIRONMENT = REFUSE.**

Any operational, migration, reconciliation, seed, fixture, activation or verification command
capable of touching real business data must be told its target, per run, by the human who invoked
it. None of the following may ever choose it:

| Must not choose the target | Why it is dangerous here |
| --- | --- |
| the active gcloud project | machine state; changes under you, invisible in the command |
| the active firebase project | `.firebaserc` declares `"default": "taylor-parts"` — **production** |
| Application Default Credentials | an ADC's `quota_project_id` is adopted as the project by the Google client libraries |
| the working directory | nothing about `cd` states an intent |
| a default baked into a script | a default that reaches production is indistinguishable from an accident |

**Production requires explicit production selection *plus* the existing authorization fences.
Nonprod must explicitly identify itself as nonprod.** Credentials authenticate *who* is calling;
they must never decide *what* is called.

---

## The credential hazard, measured

The Application Default Credential on the program machine is an **`authorized_user`** whose
**`quota_project_id` is `taylor-parts` — production**. It lives at the Windows well-known ADC path
`%APPDATA%\gcloud\application_default_credentials.json`.

How a project id is resolved, read from the installed libraries rather than from memory:

**`google-auth-library` — `getProjectIdAsync`**
(`node_modules/google-auth-library/build/src/auth/googleauth.js:155-165`):

1. `GCLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT` (`getProductionProjectId`, line 583)
2. the **credential file's own project** (`getFileProjectId`, line 593)
3. the GCE metadata server (`getGCEProjectId`, line 638)
4. an external-account client (line 617)

**`firebase-admin` — `getExplicitProjectId`**
(`node_modules/firebase-admin/lib/utils/index.js:78-91`) is narrower: `app.options.projectId`, then
a **ServiceAccount** credential's project (a `RefreshTokenCredential` — which is what an
`authorized_user` ADC produces — is *not* consulted), then those same two env vars, then `null`.

So `initializeApp({ projectId })` binds where you say. A **bare `initializeApp()`** does not:
firebase-admin itself may resolve `null`, but every `@google-cloud/*` client constructed underneath
it falls back to the full google-auth-library chain, which reaches the credential file.

### VERIFIED, and a correction to the standing premise

Running `new GoogleAuth().getClient()` from this WSL shell, with no network calls:

```
getClient() FAILED : Could not load the default credentials.
env GOOGLE_APPLICATION_CREDENTIALS: null
env CLOUDSDK_CONFIG              : null
env GOOGLE_CLOUD_PROJECT         : null
env GCLOUD_PROJECT               : null
```

**From the Linux/WSL side there is no resolvable ADC at all.** `$HOME/.config/gcloud/` holds a
gcloud CLI credential (`legacy_credentials/`) and an active config
(`project = eos-platform-sandbox`) but **no `application_default_credentials.json`**. The
production-quota ADC is on the Windows side only.

This does not make the hazard theoretical. It is live for:

- a **Windows-side `node`** run — that path *is* the well-known ADC location on `win32`, and this
  repo ships Windows entry points (`sandbox-refresh.ps1`, `scripts/Invoke-SandboxRefresh.ps1`);
- any shell that exports `GOOGLE_APPLICATION_CREDENTIALS` or `CLOUDSDK_CONFIG` at that path;
- any future `gcloud auth application-default login` inside WSL.

It also means the honest answer to *"what would hit production from this shell right now with no
arguments?"* is **nothing — it would fail to authenticate first.** That is luck about credential
placement, not a fence, which is exactly why the fences below exist.

---

## Entry-point inventory

107 files under `functions/scripts/**` and `scripts/**` initialize `firebase-admin` or a Postgres
client. Classified by how the target is chosen **after** this lane's changes:

| Mechanism | Count | Notes |
| --- | ---: | --- |
| bespoke refusal guard (`--projectId` required + registry role / name refusal) | 45 | sound, but the same logic re-typed each time |
| emulator-host guarded (`FIRESTORE_EMULATOR_HOST` required) | 22 | fail-closed; target is the emulator by construction |
| shared helper — `environmentTargetShared.js` (`--projectId`, `--confirmProduction`) | 19 | the contract this lane consolidated |
| explicit confirm flag, bespoke spelling (`--confirm-project`, `PRODUCTION_DATA_AUTHORIZED`) | 9 | per-run confirmation present |
| registry `resolveEnvironment` (hardcoded nonprod id + resolved-project assert) | 2 | `seedTruckFleetFixtures.mjs`, `deployHosting.mjs` |
| **no environment named at all** | **1** | `inventoryCapabilityGrantMigrationCli.js` — see *Left alone*, below |

### Named entry points and their selection mechanism

| Entry point | Target chosen by | Cited |
| --- | --- | --- |
| `functions/scripts/provisionEmployeeAccess.js` | `--projectId` + `--confirmProduction` (shared) | `provisionEmployeeAccess.js:765` |
| `functions/scripts/operatorAccessCommand.js` | same, shared | `operatorAccessCommand.js:108` |
| `functions/scripts/productionFoundationVerification.js` | same, shared | `productionFoundationVerification.js:84` |
| `functions/scripts/auditLegacyJobTechnicianData.js` | same, private copy (own error class) | `auditLegacyJobTechnicianData.js:254` |
| `functions/scripts/authPr4RecoveryEmailMigration.js` | same, private copy (own example text) | `authPr4RecoveryEmailMigration.js:191` |
| `functions/scripts/seedSandboxBaseline.js` | `--projectId` + registry-role nonprod refusal | `seedSandboxBaseline.js:42-63` |
| `functions/scripts/warehouseBackupRestoreCli.js` | `--project` pinned to `taylor-parts` + 40-hex commit + owner authorization + **resolved-project assert** | `warehouseBackupRestoreCli.js:43,108-125` |
| `functions/scripts/receivingE2VerifierCli.js` | `--confirm-project taylor-parts`; **was** a bare `initializeApp()` | `receivingE2VerifierCli.js:38,131` |
| `functions/scripts/assignTechnicianToUser.js` | **was** hardcoded `projectId: "taylor-parts"` | `assignTechnicianToUser.js:39` (pre-change) |
| `functions/scripts/generatePasswordResetLink.js` | **was** hardcoded `projectId: "taylor-parts"` | `generatePasswordResetLink.js:41` (pre-change) |
| `functions/scripts/d1SmokeCompleteAssignedJob.js` | **was** `const PROJECT_ID = "taylor-parts"`, module scope | `d1SmokeCompleteAssignedJob.js:28,51` (pre-change) |
| `functions/scripts/d2SmokeRulesVerification.js` | same shape | `d2SmokeRulesVerification.js:28,47` (pre-change) |
| `functions/scripts/d3SmokeUiVerification.js` | same shape | `d3SmokeUiVerification.js:28,32` (pre-change) |
| `functions/scripts/inventoryCapabilityParityHarness.js` | **nothing** — `getFirestore()` on whatever app existed; activation from `GCLOUD_PROJECT` | `inventoryCapabilityParityHarness.js:192,108` (pre-change) |
| `functions/scripts/inventoryCapabilityGrantMigrationCli.js` | `DATABASE_URL` only; no environment is ever named | `inventoryCapabilityGrantMigrationCli.js:29-30,39` |
| `functions/scripts/seedSupplierSandbox.mjs` | `FIRESTORE_EMULATOR_HOST` required; label `projectId: "taylor-parts"` | `seedSupplierSandbox.mjs:16-21` |
| `functions/scripts/migrateWorkOrderComplaintReferences.mjs` | `--project` defaulting to `eos-platform-sandbox`, + production refusal + connected-project assert | `migrateWorkOrderComplaintReferences.mjs:37,43,60` |
| `functions/scripts/seedTruckFleetFixtures.mjs` | hardcoded `platform-sandbox` via registry + resolved-project assert | `seedTruckFleetFixtures.mjs:31-40,50` |
| `scripts/deployHosting.mjs` | `--environment` **required**, no default | `deployHosting.mjs:72-77` |
| `functions/src/index.ts` | deployed Cloud Functions runtime supplies `GCLOUD_PROJECT` | `functions/src/index.ts:5` |
| `functions/src/eosApi/server.ts` | `GOOGLE_CLOUD_PROJECT=eos-platform-sandbox`, set explicitly in `render.yaml` | `render.yaml:122-123` |
| `field-ops-app-vite/vite.config.js` | `VITE_ENVIRONMENT_ID` or **the registry default — production** | `vite.config.js:23`, `config/environments.json` `defaultEnvironmentId` |
| `.firebaserc` | `"default": "taylor-parts"` — every un-`--project`'d `firebase` command | `.firebaserc:3` |

---

## Blast-radius ranking

Ordered by *what a plausible invocation does*, assuming a resolvable credential (i.e. the Windows
side, or WSL after an ADC login). "No arguments" is a weaker test than it sounds: most of these
print usage and exit, then do the damage on the very next line of the runbook.

| # | Entry point | With no arguments | One documented invocation away | Severity |
| ---: | --- | --- | --- | --- |
| 1 | `generatePasswordResetLink.js` | usage, exit 1 | `<email>` → **mints a working production password-reset link**. Credential-equivalent output, zero confirmation. | **Critical** |
| 2 | `assignTechnicianToUser.js` | usage, exit 1 | `<uid> <technicianId>` → **production Firestore write** to `users/{uid}`, zero confirmation | **Critical** |
| 3 | `d1SmokeCompleteAssignedJob.js` | `initializeApp` runs, usage, exit 2 | `seed` / `run` → **production writes** plus append-only audit events | **High** |
| 4 | `d2SmokeRulesVerification.js`, `d3SmokeUiVerification.js` | as above | as above | **High** |
| 5 | `.firebaserc` default | — | any `firebase deploy` / `firestore:delete` without `--project` targets **production** | **High** (deploy surface, outside this lane) |
| 6 | `receivingE2VerifierCli.js` | refuses (missing flags) | full flag set → claims to verify `taylor-parts` but the **Admin SDK read whatever the ADC named**. Read-only, so the damage is a *false evidence record*, not data loss. | **Medium** |
| 7 | `vite.config.js` with `VITE_ENVIRONMENT_ID` unset | builds the **production** client bundle | — | **Medium** (build artifact; `scripts/_sandboxDeployGuard.mjs` fences the deploy) |
| 8 | `inventoryCapabilityParityHarness.js` | `--tenant` required | `--tenant x --subject y` → **crashes**: `getFirestore()` throws *"The default Firebase app does not exist"* (verified). Its documented invocation never worked. The live risk was its **verdicts**, not its reach — see the trap below. | **Medium** |
| 9 | `inventoryCapabilityGrantMigrationCli.js --apply` | `--tenant` required | writes `eos_policy.role_capabilities` at whatever `DATABASE_URL` points to. **No production policy database exists** (`render.yaml` provisions `eos-policy-nonprod` only), so the reachable blast radius is nonprod today. | **Medium, latent** |

**Direct answer — what would touch production today, from this machine, with no arguments: nothing.**
Two independent reasons, and only the second is a fence: (a) from WSL the ADC does not resolve at
all; (b) every script above prints usage before acting. The commands at ranks 1–4 were one ordinary,
*documented* argument list away from production with **no per-run confirmation of any kind** — that
is the gap this lane closed.

---

## What was made fail-closed

### The shared helper: `functions/scripts/environmentTargetShared.js`

Not a new framework. `assertProjectTarget(args)` is the contract five scripts already carried
privately — three of them **byte-identical** — promoted to one home with the same checks, the same
order and the same error text. `assertNonProductionTarget(projectId)` is `seedSandboxBaseline.js`'s
registry-backed nonprod guard, likewise promoted unchanged in behaviour.

| Export | Refuses when |
| --- | --- |
| `assertProjectTarget(args)` | `--projectId` absent (or the parser's valueless `"true"`); production without a matching `--confirmProduction taylor-parts` |
| `assertNonProductionTarget(projectId)` | no project; `taylor-parts` by name; a project the registry does not know; any environment whose **registry role** is `production` |
| `assertResolvedProjectId(resolved, confirmed)` | the SDK bound to a different project than the operator confirmed |
| `assertCapabilityActivationProject(env, expected)` | neither `GCLOUD_PROJECT` nor `GOOGLE_CLOUD_PROJECT` is set; or it names a different environment than the data target |

Role, never name, is the authority — the same key `scripts/resolveEnvironment.mjs` uses, so a future
production project under a different id is refused too.

`provisionEmployeeAccess.js`, `operatorAccessCommand.js` and `productionFoundationVerification.js`
now delegate to it and keep re-exporting `assertProjectTarget`, so the three scripts that import it
from `provisionEmployeeAccess.js` are untouched. One behaviour change, and it is a *strengthening*:
all three now reject a valueless `--projectId` (the stricter `auditLegacyJobTechnicianData.js`
spelling), instead of treating `"true"` as a project name.

### Converted entry points

| Entry point | Now refuses unless | Also |
| --- | --- | --- |
| `assignTechnicianToUser.js` | `--projectId` given; production needs `--confirmProduction` | binds `initializeApp({ projectId })` and asserts the resolved id; positional `<uid> <technicianId>` unchanged |
| `generatePasswordResetLink.js` | same | same; positional `<email>` unchanged |
| `d1/d2/d3Smoke*.js` | `--confirm-project taylor-parts` present and matching | asserts the SDK bound to that project; the `<seed\|run\|cleanup>` modes are unchanged |
| `receivingE2VerifierCli.js` | (unchanged gates) | `initializeApp({ projectId: config.projectId })` + resolved-id assert, closing the bare-`initializeApp()` hole its sibling `warehouseBackupRestoreCli.js` had already documented |
| `inventoryCapabilityParityHarness.js` | `--projectId` given **and** `GCLOUD_PROJECT`/`GOOGLE_CLOUD_PROJECT` set **and** the two agree | binds Firestore to the confirmed project and passes it in as `deps.db`, instead of reaching for an ambient default app |

No command's *behaviour* changed — only whether it agrees to run. Every refusal happens **before**
any SDK client is constructed.

---

## The `GOOGLE_CLOUD_PROJECT` override trap

**Read this before acting on any `EXTRA_POSTGRES_GRANT` finding.**

`functions/src/access/environmentCapabilityOverrides.ts:763`:

```ts
const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? null;
```

Per-environment capability activation is keyed on that variable. A deployed Cloud Function always
has `GCLOUD_PROJECT` set by the runtime, and the deployed nonprod API sets
`GOOGLE_CLOUD_PROJECT=eos-platform-sandbox` explicitly (`render.yaml:122`). **An operator laptop and
a CI runner usually have neither.** With neither set the override set is empty, and every capability
registered `active: false` in the catalog resolves `DENY` — which is *not* what that environment's
live authorization does.

Measured against the compiled modules (`resolveRuntimeCapabilityOverrides` + `findPermission` +
`WRITER_CAPABILITY_CENSUS`):

| `GCLOUD_PROJECT` | override set size |
| --- | ---: |
| unset | **0** |
| `eos-platform-sandbox` | 92 |
| `taylor-parts` | 25 (the production-adoption Reporting set) |

**12 of the census's 18 operations** have a legacy decision that depends entirely on that variable:

```
transfer.create · transfer.dispatch · transfer.receive · transfer.cancel
relocation.relocate · relocation.recordPlacement
cycleCount.create · cycleCount.submit · cycleCount.cancel · cycleCount.reconcile
serializedInstall.install · dataImport.openingBalance
```

> The figure circulating in this program was "8 of 18". **It is 12 of 18.** The list above is
> asserted exactly by the regression suite, so it cannot drift silently.

### Why the obvious remedy is exactly wrong

With the variable unset, `inventoryCapabilityParityHarness.js` reports, for a principal whose
sandbox grants are entirely legitimate:

```
FAIL <uid> / transfer.create: EXTRA_POSTGRES_GRANT (legacy=false eos_policy=true)
```

`legacy=false` is an **artifact of the missing variable**, not a fact about that environment.
"eos_policy grants something legacy does not" reads as *remove the extra grant* — and removing those
`role_capabilities` rows would strip real, working authority from real roles
(`inventoryTransferOperator`, `inventoryCycleCountCounter`, `equipmentInstaller`, …) and, once the
cutover re-points the writers at eos_policy, would break those operations outright.

**Correct handling**

1. Never run the harness without stating the environment. The CLI now refuses:
   `GCLOUD_PROJECT=eos-platform-sandbox node scripts/inventoryCapabilityParityHarness.js --projectId eos-platform-sandbox --tenant … --subject …`
2. The activation environment and the data environment must be the **same**. The CLI refuses a
   mismatch: comparing production's activation rules against sandbox data produces a verdict about
   neither.
3. An `EXTRA_POSTGRES_GRANT` on one of the 12 ids above, produced by a run that did not set the
   variable, is **void**. Re-run it correctly before drawing any conclusion.
4. `EXTRA_POSTGRES_GRANT` against a correctly-set **production** target on those same 12 ids is
   *not* a false positive — it is a true statement that eos_policy grants what production's legacy
   path denies. That is the migration's subject matter, and the remedy is still not "remove grants".

### A separate, permanent false positive

`cycleCount.close` / `inventory.cycleCount.close` is **not in the permission catalog at all**
(`findPermission` returns `undefined`), so its legacy decision is a hard `DENY` in every environment
regardless of the variable. It will report `EXTRA_POSTGRES_GRANT` whenever eos_policy grants it.
That is a missing catalog entry, not an extra grant, and it is unaffected by anything in this lane.

---

## Deliberately left alone, and why

| Thing | Why not fenced here |
| --- | --- |
| `.firebaserc` `"default": "taylor-parts"` | Removing the default makes every `firebase` invocation in every runbook fail until `--project` is added everywhere. That is a real, worthwhile change — and a **deploy-surface** change that belongs to a lane that can sweep the runbooks with it, not a side effect of this one. Flagged as the highest-value remaining gap. |
| `config/environments.json` `defaultEnvironmentId: taylor-parts-production` + `vite.config.js:23` | An unset `VITE_ENVIRONMENT_ID` builds the production bundle. The comment at `vite.config.js:12` says this preserves existing behaviour deliberately. Changing it breaks every plain `npm run build`; `scripts/_sandboxDeployGuard.mjs` already fences the sandbox deploy that would misuse such a bundle. Documented, not changed. |
| `inventoryCapabilityGrantMigrationCli.js` | Its target is a `DATABASE_URL`, not a GCP project, and it already refuses when that is absent. Requiring it to *name* the environment is the right follow-up, but it would break the documented `--apply` runbook, and there is **no production `eos_policy` database to reach** (`render.yaml` provisions `eos-policy-nonprod` only). Revisit when a production policy database is provisioned. |
| `seedSupplierSandbox.mjs` (`projectId: "taylor-parts"`) | Fail-closed already: it exits unless `FIRESTORE_EMULATOR_HOST` is set, so the id is an emulator label. Left as-is, noted as a latent trap: if that guard were ever removed, the literal points at production. |
| `auditLegacyJobTechnicianData.js`, `authPr4RecoveryEmailMigration.js` private `assertProjectTarget` copies | Each diverges from the canonical contract deliberately — one throws its own `InvalidInvocationError` (its exit-code mapping depends on it), the other names a script-specific nonprod example. Normalising them would change behaviour for no safety gain. The ratchet allow-lists exactly these two, so a *new* copy fails. |
| The 45 bespoke refusal guards | They already fail closed. Rewriting 45 working guards to import the shared helper is churn with a non-zero chance of weakening one. The ratchet treats any of their refusal spellings as a valid fence. |

---

## Regression tests and their registration

**File:** `functions/test/environmentSelectionFailClosed.test.mjs` — 25 tests, three layers.

1. **Unit** — the shared helper's refusals are exactly what they claim (absent flag, valueless flag,
   case-sensitive production confirmation, registry-role refusal, unknown-project refusal,
   resolved-id mismatch, unstated/mismatched activation environment).
2. **Ratchet** (the part that survives everyone forgetting this document):
   - **zero** bare `initializeApp()` under `functions/scripts/**` and `scripts/**` — currently zero,
     and it must stay zero;
   - every script that names the production project *and* initializes firebase-admin must carry some
     per-run target fence;
   - no **new** private copy of `assertProjectTarget` (the two intentional divergences are listed
     explicitly).
3. **Behaviour** — the converted CLIs are actually spawned with no arguments, and with
   `GCLOUD_PROJECT`/`GOOGLE_CLOUD_PROJECT` stripped, and must exit non-zero with the expected
   refusal. A guard present in source but never reached proves nothing.
4. **Trap invariants** — that the override set really is empty when the variable is unset, that the
   sandbox set really is non-empty, and that the affected census operations are **exactly** the 12
   listed above.

**Registration — an unrun gate proves nothing:**

| What | Where |
| --- | --- |
| npm script | `functions/package.json` → **`test:environmentSelection`** = `npm run build && node --test test/environmentSelectionFailClosed.test.mjs` |
| workflow | **`.github/workflows/environment-selection-fail-closed-tests.yml`**, job `environment-selection-fail-closed-tests`, running `npm run test:environmentSelection` in `functions/` |
| triggers | PR + push-to-`main` on `functions/scripts/**`, `scripts/**`, `environmentCapabilityOverrides.ts`, `inventoryWriterCapabilityCensus.ts`, the test file, `config/environments.json`, `.firebaserc`, `functions/package*.json`, this document, and the workflow itself |

The workflow runs with **no credentials, no emulator, no network and no `GCLOUD_PROJECT`** — the
exact laptop-shaped environment in which an ambiently-targeted command would have picked production.

---

## For the next person

Adding an operator command that can reach real business data:

```js
const { assertProjectTarget, assertResolvedProjectId } = require("./environmentTargetShared.js");

const projectId = assertProjectTarget(args);        // refuses before any SDK call
initializeApp({ projectId });                       // bind explicitly, never bare
assertResolvedProjectId(getApp().options.projectId, projectId);  // and verify the SDK agreed
```

For a tool that must never see production at all, use `assertNonProductionTarget(projectId)` — it
refuses production by name *and* by registry role, and refuses anything the registry does not know.

Do not add a private copy of either. The ratchet will fail, and it is right to.
