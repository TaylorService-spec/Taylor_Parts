# D-PROD-1A — Admin Password Reset: Read-Only Production Preflight Runbook

> **STATUS: PENDING / NOT AUTHORIZED FOR EXECUTION.**
> This is a **documentation-only** runbook. It is **not** an authorization to run anything against
> production. Preparing it performs **no** production access, secret operation, IAM change, configuration,
> deployment, fixture, email, or mutation. A **named operator** runs it out-of-band **only after** it passes
> Codex review and receives a separate Owner merge/run decision, and returns **only sanitized evidence**.
>
> **EVERY command in this runbook is READ-ONLY (describe/list/get-iam-policy).** No command creates, edits,
> deletes, deploys, activates, grants, binds, rotates, or reads a secret value. Prohibited operations are
> listed in §0 and must never be run under this runbook.

- **Gate:** D-PROD-1A (credentialed, read-only production preflight) — confirms posture before any
  D-NATIVE-SEND-CONFIG execution / D-PROD-1B / deployment / D-PROD-1C.
- **Governing:** [`DECISIONS.md`](../DECISIONS.md) #54/#55/#56; the merged admin-reset native-send workstream
  (PRE-2/target-parity/PRE-1/G-PRE1-IMPL/PRE-3/G-PRE3-IMPL/D-NATIVE-SEND-CONFIG package/outbound adapter).
- **Code baseline reconciled:** `main` `d6628a5`.
- **Operator role:** the credentialed inspection is performed by a named operator, NOT by the repository
  automation. The preparer of this runbook does not access production or handle credentials.

---

## 0. Hard prohibitions (never run under this runbook)

Do **NOT**: read any secret value (`gcloud secrets versions access`), fetch an API key string
(`gcloud services api-keys get-key-string`), create/update/delete/bind/rotate any secret, change any IAM
policy (`add-iam-policy-binding` / `set-iam-policy` / `remove-…`), create/assign/modify any service account,
deploy or redeploy any Function/Rules/Hosting, activate/grant any permission or role, create fixtures, send
email, or mutate Auth/Firestore. Any command with a mutating verb is out of scope. If a required read
appears to need a mutating step, **halt** (§4) — do not improvise.

## 0.1 Operator prerequisites

- `gcloud` + `firebase` CLIs authenticated as a **least-privilege reader** on the approved project (roles
  sufficient for describe/list/get-iam-policy only — e.g. Viewer + Secret Manager Viewer + Service Account
  Viewer; NOT accessor/admin). No owner/editor is required or should be used.
- The exact approved project id, region, and (for later gates, not created here) the intended sender-secret
  name + API-key id, provided out-of-band. Placeholders below: `<PROJECT>`, `<REGION>` (e.g. `us-central1`),
  `<SENDER_SECRET>`, `<API_KEY_ID>`.
- Run each command, capture output, and transcribe **only** the sanitized fields into §5's template.

---

## 1. Checks (each: command → expected → pass/fail → halt)

### C1 — Project identity
```
gcloud config get-value project
gcloud projects describe <PROJECT> --format="value(projectId,projectNumber,lifecycleState)"
firebase projects:list
```
- **Expected:** the active/described project id **exactly equals** the approved `<PROJECT>`; lifecycleState ACTIVE.
- **PASS:** ids match, ACTIVE. **FAIL/HALT:** any mismatch, wrong project, or non-ACTIVE → stop; do not proceed.

### C2 — Deployed Function versions + runtime service accounts
```
gcloud functions describe initiateAdminPasswordReset --project <PROJECT> --region <REGION> --gen2 \
  --format="value(name,state,updateTime,serviceConfig.revision,serviceConfig.service,serviceConfig.serviceAccountEmail)"
gcloud functions describe listResetEligibleUsers --project <PROJECT> --region <REGION> --gen2 \
  --format="value(name,state,updateTime,serviceConfig.revision,serviceConfig.service,serviceConfig.serviceAccountEmail)"
firebase functions:list --project <PROJECT>
```
(If gen1: drop `--gen2` and read `serviceAccountEmail`, `versionId`, `updateTime`.)
- **Expected (pre-AUTH-PROD-2/3):** either **NOT_FOUND** (the callables are exported but **not yet deployed**
  — `index.ts` exports ≠ deploy) — record "not deployed"; **or**, if a prior gate deployed them, an ACTIVE
  revision with a recorded runtime service account.
- **PASS:** state is unambiguous (clearly deployed with recorded revision+SA, or clearly NOT_FOUND). Record
  the revision/build id + runtime SA verdict per function (see §5). **FAIL/HALT:** an unexpected/partial
  deployment, an error other than NOT_FOUND, or an unrecognized runtime identity → stop.

### C3 — `initiateAdminPasswordReset` current posture (sender secret must NOT be bound yet)
```
gcloud functions describe initiateAdminPasswordReset --project <PROJECT> --region <REGION> --gen2 \
  --format="value(serviceConfig.secretEnvironmentVariables,serviceConfig.secretVolumes)"
```
- **Expected:** **empty** — no sender secret is bound (D-NATIVE-SEND-CONFIG execution has not run). Deployed
  behavior is the fail-closed sender (`buildNativeResetSender(null)`; code baseline
  `adminCredentialCallables.ts` `DEPLOYED_NATIVE_SENDER = buildNativeResetSender(null)`).
- **PASS:** no secret binding present (and, if deployed, matches the fail-closed code baseline).
  **FAIL/HALT:** any secret already bound to `initiateAdminPasswordReset` before the authorized config gate → stop.

### C4 — `listResetEligibleUsers` proof: NO sender-secret binding AND no secret-reading identity
```
# (a) no secret bound to the list function:
gcloud functions describe listResetEligibleUsers --project <PROJECT> --region <REGION> --gen2 \
  --format="value(serviceConfig.secretEnvironmentVariables,serviceConfig.secretVolumes,serviceConfig.serviceAccountEmail)"
# (b) the sender secret's access policy does NOT grant the list function's runtime SA:
gcloud secrets get-iam-policy <SENDER_SECRET> --project <PROJECT> \
  --flatten="bindings[]" --format="table(bindings.role, bindings.members)"
```
- **Expected:** (a) the list function has **no** `secretEnvironmentVariables`/`secretVolumes` for the sender
  secret; (b) the sender secret's IAM policy has **no** `roles/secretmanager.secretAccessor` member equal to
  the list function's runtime SA (nor `allUsers`/`allAuthenticatedUsers`).
- **PASS:** list has no secret binding AND its SA is absent from the secret accessor list. **FAIL/HALT:** the
  list function binds the sender secret, or its SA can read the secret, or the secret is world/broadly
  readable → stop (this is the P1 least-privilege boundary).

### C5 — Secret metadata + bindings WITHOUT reading values
```
gcloud secrets list --project <PROJECT> --format="table(name, createTime)"
gcloud secrets describe <SENDER_SECRET> --project <PROJECT> --format="value(name,createTime,replication)"   # if it exists yet
gcloud secrets versions list <SENDER_SECRET> --project <PROJECT> --format="table(name, state, createTime)"   # metadata only
gcloud secrets get-iam-policy <SENDER_SECRET> --project <PROJECT> --flatten="bindings[]" \
  --format="table(bindings.role, bindings.members)"
```
- **Expected (pre-config-gate):** the sender secret may **not exist yet** (created only at the authorized
  D-NATIVE-SEND-CONFIG execution) — record "absent". If it exists, its accessor list is limited to the
  dedicated `initiateAdminPasswordReset` runtime SA only.
- **PASS:** secret absent, or present with accessor == the dedicated initiate-only SA only. **FAIL/HALT:**
  the secret is readable by the list SA, the default Functions SA, a human/group, or `allUsers`/
  `allAuthenticatedUsers` → stop. **NEVER run `gcloud secrets versions access` (reads the value).**

### C6 — API-key metadata/restrictions WITHOUT exposing the key
```
gcloud services api-keys list --project <PROJECT> --format="table(uid, displayName, restrictions.apiTargets, restrictions.browserKeyRestrictions, restrictions.serverKeyRestrictions)"
gcloud services api-keys describe <API_KEY_ID> --project <PROJECT> \
  --format="value(uid,displayName,restrictions)"
```
- **Expected:** the intended key belongs to **`<PROJECT>`** (project-ownership); its restrictions permit the
  **Identity Toolkit API** and are appropriate for a server call (no HTTP-referrer restriction that blocks a
  server; ideally API-target-restricted to Identity Toolkit only). This corroborates the
  `apiKeyProject === project` attestation the later config gate supplies to `validateNativeSendConfig`.
- **PASS:** key is project-owned + Identity-Toolkit-appropriate restrictions. **FAIL/HALT:** the key belongs
  to another project, is unrestricted/over-broad, or blocks server use → stop. **NEVER run
  `gcloud services api-keys get-key-string` (exposes the key).**

### C7 — Required API availability
```
gcloud services list --enabled --project <PROJECT> \
  --format="table(config.name)" | grep -E "identitytoolkit.googleapis.com|secretmanager.googleapis.com"
```
- **Expected:** `identitytoolkit.googleapis.com` **enabled** (native send) and `secretmanager.googleapis.com`
  **enabled** (secret binding). **PASS:** both enabled. **FAIL/HALT:** either disabled → stop (do NOT enable
  here; enabling is a mutation for a later gate).

### C8 — Exact two-Function deployment boundary + rollback baseline
```
firebase functions:list --project <PROJECT>
gcloud functions list --project <PROJECT> --regions <REGION> --format="table(name,state,updateTime)"
```
- **Expected:** the admin-reset surface is **exactly** `initiateAdminPasswordReset` + `listResetEligibleUsers`
  (or both NOT_FOUND if not yet deployed); no other admin-reset-named Function exists. Record the current
  **rollback baseline**: for each of the two functions, the current deployed revision/build id (or
  "not deployed"), and the current sender posture = fail-closed / no secret bound. The eventual deploy uses
  `firebase deploy --only functions:initiateAdminPasswordReset,functions:listResetEligibleUsers` (exact list).
- **PASS:** boundary is exactly the two callables (or cleanly not-deployed) and the rollback baseline is
  recorded. **FAIL/HALT:** any extra/unexpected admin-reset Function, or an indeterminate baseline → stop.

### C9 — Permission remains inactive/ungranted (code + live)
- **Code baseline (already true on `main` d6628a5):** `permissionCatalog.ts` registers
  `admin.credentialReset.initiate` with `active:false`; no code grants it. (No live IAM role represents this
  application permission; it is enforced in-app, so there is no production role to inspect — record the code
  attestation.)
- **PASS:** code shows `active:false` and no grant; the runbook asserts no activation/grant step is run.
  **FAIL/HALT:** any evidence the permission was activated or granted → stop.

---

## 2. Aggregate verdict

D-PROD-1A **passes** only if C1–C9 all PASS: correct project; the two callables cleanly deployed-or-not with
recorded revisions + runtime SAs; `initiateAdminPasswordReset` has no sender secret bound; `listResetEligibleUsers`
has no sender-secret binding and no secret-reading identity; the sender secret (if present) is accessor-scoped
to the dedicated initiate-only SA; the API key is project-owned with Identity-Toolkit-appropriate restrictions;
Identity Toolkit + Secret Manager APIs enabled; the deployment boundary is exactly the two callables with a
recorded rollback baseline; and the permission stays inactive/ungranted. **Any FAIL halts the gate** — report
the sanitized blocker; do not repair or proceed to D-NATIVE-SEND-CONFIG execution / D-PROD-1B/C.

---

## 3. Sanitized-evidence template (record ONLY these fields)

> **Exclude:** secret values, API-key strings, credentials, tokens, emails (including raw service-account
> emails — record a non-reversible label/verdict, not the literal), UIDs, and local/protected paths. Record
> verdicts + non-secret identifiers only. Full raw identities, if ever needed, stay in an access-controlled
> evidence store, never in this template.

```
D-PROD-1A EVIDENCE (sanitized) — operator: <role, not name/email> — date: <UTC>
C1 project identity            : projectId=<PROJECT> matches approved=? [PASS/FAIL]
C2 initiate deployed           : [deployed rev=<id> | NOT_FOUND]  runtimeSA=<dedicated? yes/no; default? yes/no> [PASS/FAIL]
C2 list deployed               : [deployed rev=<id> | NOT_FOUND]  runtimeSA=<dedicated? yes/no; default? yes/no> [PASS/FAIL]
C3 initiate secret bound       : sender secret bound? [no=PASS / yes=FAIL]
C4 list secret binding         : list has sender secret? [no=PASS/yes=FAIL]; list SA is secret accessor? [no=PASS/yes=FAIL]
C5 sender secret               : [absent | present]; accessors == dedicated initiate-only SA only? [yes=PASS/no=FAIL]; broad/allUsers? [no=PASS/yes=FAIL]
C6 API key                     : owned by <PROJECT>? [yes/no]; Identity-Toolkit-appropriate restrictions? [yes/no] [PASS/FAIL]  (key string NOT recorded)
C7 APIs enabled                : identitytoolkit=? secretmanager=? [PASS/FAIL]
C8 deploy boundary + rollback  : surface == {initiate,list} only? [yes/no]; rollback baseline=<per-fn rev or not-deployed; sender fail-closed> [PASS/FAIL]
C9 permission posture          : admin.credentialReset.initiate active:false + ungranted? [yes=PASS/no=FAIL]
AGGREGATE                      : [PASS / HALT: <sanitized reason>]
```

---

## 4. Halt conditions (stop without repair or mutation; report sanitized)

Halt immediately (do not repair, mutate, or continue) if: the project id does not match the approved
project; a Function is partially/unexpectedly deployed or has an unrecognized runtime identity; a sender
secret is already bound to either callable before the authorized config gate; `listResetEligibleUsers` can
read the sender secret (binding or SA accessor) or the secret is broadly readable; the API key belongs to
another project or is over-broad/blocks server use; a required API is disabled; the deployment boundary is
not exactly the two callables; the permission appears active or granted; or any check requires a prohibited
(mutating / value-reading) command to complete. Report the **sanitized** blocker only.

---

## 5. Boundary (unchanged by this runbook)

D-PROD-1A is **read-only**. It authorizes NO Secret Manager creation or value access, NO IAM mutation, NO
service-account creation/assignment, NO configuration change, NO deployment, NO fixture creation, NO email
send, NO permission activation/grant, NO cross-key reconciliation, and NO D-PROD-1B/C action. It is a
precondition for — never a substitute for — those separately authorized gates. `admin.credentialReset.initiate`
remains inactive/ungranted; the deployed sender remains fail-closed.

_This runbook is a documentation deliverable only. It remains **PENDING / NOT AUTHORIZED FOR EXECUTION**
until Codex review and a separate Owner merge/run decision; then a named operator runs it out-of-band and
returns only the sanitized evidence in §3._
