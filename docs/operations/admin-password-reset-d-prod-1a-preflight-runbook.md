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
  `<SENDER_SECRET>`, `<API_KEY_ID>`, the runtime service accounts `<INITIATE_RUNTIME_SA>` /
  `<LIST_RUNTIME_SA>` (read from each function's `describe` in C2), `<BUILD_ID>` (the deployed revision's
  build, from C9b), and `<ORG_ID>` — the governing **organization** id (or the highest required ancestor
  folder, `<FOLDER_ID>`) used as the Cloud Asset analysis **scope** so ancestor grants are covered.
  Effective-access + provenance analysis needs read roles at the **org/ancestor** scope where required:
  `roles/cloudasset.viewer` on the organization/folder (asset analyze-iam-policy must see ancestor grants),
  `roles/policytroubleshooter.viewer` (policy-troubleshoot iam), and `roles/cloudbuild.builds.viewer`
  (builds describe). If org/ancestor Cloud Asset visibility is unavailable, C4 is ERROR-HALT (§4).
- **Shell:** every command is a **single line** (no continuations) so it runs unchanged in the protected
  Windows/PowerShell operator environment (and any POSIX shell).
- Run each command, capture output, and transcribe **only** the sanitized fields into §5's template.

---

## 1. Checks (each: command → expected → pass/fail → halt)

### 1.0 Existence classification (branching convention — apply to C2/C3/C4/C5)

Each function and the sender secret may legitimately be **absent** before the later gates (functions:
export ≠ deploy, so pre-AUTH-PROD-2/3 they are NOT_FOUND; the sender secret is created only at the
authorized D-NATIVE-SEND-CONFIG execution). For each such object, classify the `describe` result into
exactly one branch and act accordingly:

- **PRESENT** — the object exists and `describe` returns it → run the object's inspection checks below.
- **CONFIRMED-ABSENT** — `describe` returns a clean **NOT_FOUND** (the resource does not exist; the call
  itself succeeded/authenticated) → the object's binding/access sub-checks are **N/A and PASS** (nothing can
  be bound/granted on a resource that does not exist); record "absent / not deployed".
- **ERROR-HALT** — any other outcome (PERMISSION_DENIED, quota/API error, ambiguous/partial state, a
  transport failure, or an unrecognized shape) → **HALT** (§4); posture cannot be established. A
  PERMISSION_DENIED is never treated as "absent".

Never infer absence from a non-NOT_FOUND error, and never run an object's downstream inspection while it is
CONFIRMED-ABSENT (there is nothing to inspect) or ERROR-HALT (posture is unknown).

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
gcloud functions describe initiateAdminPasswordReset --project <PROJECT> --region <REGION> --gen2 --format="value(name,state,updateTime,serviceConfig.revision,serviceConfig.service,serviceConfig.serviceAccountEmail)"
gcloud functions describe listResetEligibleUsers --project <PROJECT> --region <REGION> --gen2 --format="value(name,state,updateTime,serviceConfig.revision,serviceConfig.service,serviceConfig.serviceAccountEmail)"
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
gcloud functions describe initiateAdminPasswordReset --project <PROJECT> --region <REGION> --gen2 --format="value(serviceConfig.secretEnvironmentVariables,serviceConfig.secretVolumes)"
```
- **Branch (per §1.0):** if `initiateAdminPasswordReset` is CONFIRMED-ABSENT → no secret can be bound → PASS
  (record "not deployed"); ERROR-HALT → stop. If PRESENT, evaluate the output below.
- **Expected (PRESENT):** **empty** — no sender secret is bound (D-NATIVE-SEND-CONFIG execution has not run).
  Deployed behavior is the fail-closed sender (`buildNativeResetSender(null)`; code baseline
  `adminCredentialCallables.ts` `DEPLOYED_NATIVE_SENDER = buildNativeResetSender(null)`).
- **PASS:** no secret binding present (and, if deployed, matches the fail-closed code baseline).
  **FAIL/HALT:** any secret already bound to `initiateAdminPasswordReset` before the authorized config gate → stop.

### C4 — Effective secret-access: SOLE accessor is the initiate SA; list SA has no effective access/impersonation
Resource-level IAM alone is insufficient — inherited project/folder/org grants, group memberships,
conditional bindings, and service-account **impersonation** can still yield access. The **authoritative**
check is a **full effective-accessor enumeration** (Cloud Asset IAM analysis), plus a **direct
impersonation-permission** troubleshoot. All read-only; each command is one line (PowerShell-safe).
```
# (a) no secret bound to the list function (branch per §1.0 if the function is absent):
gcloud functions describe listResetEligibleUsers --project <PROJECT> --region <REGION> --gen2 --format="value(serviceConfig.secretEnvironmentVariables,serviceConfig.secretVolumes,serviceConfig.serviceAccountEmail)"
# (b) resource-level policy on the sender secret (context only; NOT sufficient by itself):
gcloud secrets get-iam-policy <SENDER_SECRET> --project <PROJECT> --flatten="bindings[]" --format="table(bindings.role, bindings.members)"
# (c) AUTHORITATIVE: the FULL set of identities with EFFECTIVE secretmanager.versions.access on the secret.
#     SCOPE = the governing ORGANIZATION (or the highest required ancestor folder), NOT the project --
#     `--project` covers only policies at/below the project and MISSES ancestor folder/org grants. Retain the
#     secret's full resource name. Expand GROUPS, ROLES (resolve roles -> the permission), and service-account
#     IMPERSONATION; request the raw response so `fullyExplored` completeness fields are inspectable. Every
#     `fullyExplored` MUST be true; an incomplete/permission-limited result (or missing ancestor-scope
#     visibility) is ERROR-HALT, never a "clean set":
gcloud asset analyze-iam-policy --organization=<ORG_ID> --full-resource-name="//secretmanager.googleapis.com/projects/<PROJECT>/secrets/<SENDER_SECRET>" --permissions="secretmanager.versions.access" --expand-groups --expand-roles --analyze-service-account-impersonation --show-response --format="json"
# (d) DIRECT impersonation permission for the list SA over the initiate SA (captures inherited grants,
#     unlike reading the resource policy) -- expect NOT GRANTED:
gcloud policy-troubleshoot iam "//iam.googleapis.com/projects/<PROJECT>/serviceAccounts/<INITIATE_RUNTIME_SA>" --principal-email="<LIST_RUNTIME_SA>" --permission="iam.serviceAccounts.getAccessToken"
# (e) targeted confirmation that the list SA cannot read the secret value (belt-and-suspenders):
gcloud policy-troubleshoot iam "//secretmanager.googleapis.com/projects/<PROJECT>/secrets/<SENDER_SECRET>" --principal-email="<LIST_RUNTIME_SA>" --permission="secretmanager.versions.access"
```
- **Branch (per §1.0):** if the sender secret is CONFIRMED-ABSENT → (b)/(c)/(e) are N/A PASS (nothing to
  access). If `listResetEligibleUsers` is CONFIRMED-ABSENT → (a) PASSes; run (c) regardless (it enumerates
  the secret's whole accessor set); run (d)/(e) only if the list SA is known, else record "list not deployed;
  list-SA effective-access re-checked at the deploy gate". ERROR-HALT on any command → stop.
- **Expected (all applicable):** (a) list has **no** sender secret binding; (c) the org/ancestor-scoped
  analysis is **fully explored** (all `fullyExplored` true in the raw `--show-response` output) AND the
  **entire** effective-accessor set for `secretmanager.versions.access` — after group + role + impersonation
  expansion, including ancestor folder/org grants — is **exactly** `{<INITIATE_RUNTIME_SA>}`: no list SA, no
  default Functions SA, no human/group, no `allUsers`/`allAuthenticatedUsers`, no conditional grant, no
  ancestor-inherited or impersonation-derived accessor; (d) NOT GRANTED (list SA cannot impersonate the
  initiate SA); (e) NOT GRANTED (list SA cannot read the secret). **An incomplete/permission-limited analysis
  (any `fullyExplored` false, a partial/denied result, or the operator lacking org/ancestor-scope
  visibility) is ERROR-HALT — never read as a clean set.**
- **PASS:** the initiate SA is the **sole** effective accessor AND the list SA has no effective access or
  impersonation path. **FAIL/HALT:** any additional effective accessor, any GRANTED/CONDITIONAL verdict, a
  binding on the list function, broad readability, or a list→initiate impersonation path → stop (the P1
  least-privilege boundary).

### C5 — Secret metadata + bindings WITHOUT reading values
```
gcloud secrets list --project <PROJECT> --format="table(name, createTime)"
gcloud secrets describe <SENDER_SECRET> --project <PROJECT> --format="value(name,createTime,replication)"   # if it exists yet
gcloud secrets versions list <SENDER_SECRET> --project <PROJECT> --format="table(name, state, createTime)"   # metadata only
gcloud secrets get-iam-policy <SENDER_SECRET> --project <PROJECT> --flatten="bindings[]" --format="table(bindings.role, bindings.members)"
```
- **Branch (per §1.0):** if the sender secret is CONFIRMED-ABSENT → PASS (record "absent"; created only at
  the config gate); ERROR-HALT → stop. If PRESENT, evaluate below.
- **Expected (PRESENT):** its EFFECTIVE accessor set — the authoritative source is **C4(c)'s
  `asset analyze-iam-policy` full enumeration** — is **exactly** the dedicated `initiateAdminPasswordReset`
  runtime SA. (This resource-policy read is context only.)
- **PASS:** secret absent, or present with the effective accessor == the dedicated initiate-only SA only.
  **FAIL/HALT:** the secret is effectively readable by the list SA, the default Functions SA, a human/group,
  or `allUsers`/`allAuthenticatedUsers` → stop. **NEVER run `gcloud secrets versions access` (reads the value).**

### C6 — API-key metadata/restrictions WITHOUT exposing the key
```
gcloud services api-keys list --project <PROJECT> --format="table(uid, displayName, restrictions.apiTargets, restrictions.browserKeyRestrictions, restrictions.serverKeyRestrictions)"
gcloud services api-keys describe <API_KEY_ID> --project <PROJECT> --format="value(uid,displayName,restrictions)"
```
- **Expected:** the intended key belongs to **`<PROJECT>`** (project-ownership); its restrictions permit the
  **Identity Toolkit API** and are appropriate for a server call (no HTTP-referrer restriction that blocks a
  server; ideally API-target-restricted to Identity Toolkit only). This corroborates the
  `apiKeyProject === project` attestation the later config gate supplies to `validateNativeSendConfig`.
- **PASS:** key is project-owned + Identity-Toolkit-appropriate restrictions. **FAIL/HALT:** the key belongs
  to another project, is unrestricted/over-broad, or blocks server use → stop. **NEVER run
  `gcloud services api-keys get-key-string` (exposes the key).**

### C7 — Required API availability
Use `gcloud --filter` (portable; no shell `grep`/pipe — suitable for the protected Windows/PowerShell
operator environment):
```
gcloud services list --enabled --project <PROJECT> --filter="config.name=(identitytoolkit.googleapis.com secretmanager.googleapis.com)" --format="value(config.name)"
```
- **Expected:** the output lists **both** `identitytoolkit.googleapis.com` (native send) and
  `secretmanager.googleapis.com` (secret binding). **PASS:** both present. **FAIL/HALT:** either missing →
  stop (do NOT enable here; enabling is a mutation for a later gate).

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

### C9 — Permission posture (three separable claims; each proves only what its method covers)

**C9a — inactive (repository attestation).** On `main` `d6628a5`, `permissionCatalog.ts` registers
`admin.credentialReset.initiate` with `active:false` and no code path activates it. This is an in-app (not
IAM) permission, so there is no live GCP role to inspect. **PASS (inactive):** the code attestation holds.

**C9b — deployed-code provenance (real method, not inferred from a revision id alone).** A `describe`
revision id does **not** tie the deployed code to a git commit. Establish provenance by resolving the
deployed revision's build source commit and comparing it to the merge baseline:
```
gcloud functions describe initiateAdminPasswordReset --project <PROJECT> --region <REGION> --gen2 --format="value(buildConfig.build)"
```
`buildConfig.build` is a **full resource name** `projects/<PROJECT>/locations/<REGION>/builds/<BUILD_ID>`.
Extract `<BUILD_ID>` and its `<REGION>` from it, then describe the build **with `--region`** (required for
regional Gen2 builds):
```
gcloud builds describe <BUILD_ID> --project <PROJECT> --region=<REGION> --format="value(substitutions.COMMIT_SHA,sourceProvenance.resolvedRepoSource.commitSha,source.repoSource.commitSha)"
```
- **Established:** the build's source commit equals the merged baseline (the admin-reset code is at
  `d6628a5`; the operator compares against the release SHA the deploy actually used). **Not establishable:**
  if the deploy uploaded a source archive with **no** recorded commit (no repo-source/substitution), or no
  deploy-time git-SHA stamp exists → record **deployed-code provenance NOT established (limitation)** and do
  **not** claim deployed-code equivalence. (Recommendation for the deploy gate: stamp the git SHA as a build
  substitution / function label so provenance is verifiable.) If the function is CONFIRMED-ABSENT → N/A
  (nothing deployed).

**C9c — ungranted (requires the stored-grant probe; not assumed).** "Ungranted" is claimed **only** if a
read-only probe of the governed role/permission store confirms no active grant:
```
# read-only: any ACTIVE role whose permissions include the id, and any active assignment of such a role
# (exact collection/query per the deployed access model; NO write, NO mutation)
```
enumerate active role definitions whose permissions include `admin.credentialReset.initiate` and any active
`roleAssignments` of them. **If the probe is NOT performed** (no read access), the conclusion is **narrowed
to "inactive / fail-closed posture only" and "ungranted" is recorded as NOT ESTABLISHED** — the gate does
**not** claim ungranted.

- **PASS (scoped):** C9a holds; C9b is established **or** explicitly recorded as a limitation (not claimed);
  C9c is either "no active grant found" (then ungranted is claimed) **or** "not established" (then only
  inactive/fail-closed posture is claimed). **FAIL/HALT:** the permission is active; any active role/
  assignment grants it; or deployed-code provenance is **contradicted** (a build source commit that does not
  match the baseline).

---

## 2. Aggregate verdict

D-PROD-1A **passes** only if C1–C9 all PASS under the §1.0 branching: correct project; the two callables
cleanly deployed-or-CONFIRMED-ABSENT with recorded revisions + runtime SAs (any non-NOT_FOUND error halts);
`initiateAdminPasswordReset` has no sender secret bound; the sender secret's **full effective-accessor set**
(C4(c) `asset analyze-iam-policy`) is **exactly** the dedicated initiate SA, `listResetEligibleUsers` has no
binding and no effective access or impersonation path (C4(d)/(e) NOT GRANTED); the API key is project-owned
with Identity-Toolkit-appropriate restrictions; Identity Toolkit + Secret Manager APIs enabled; the
deployment boundary is exactly the two callables with a recorded rollback baseline. For the permission: C9a
(inactive) holds; C9b (deployed-code provenance) is established or explicitly recorded as a limitation; and
"ungranted" (C9c) is claimed **only** if the stored-grant probe ran and found none — otherwise the verdict
is narrowed to "inactive / fail-closed posture" with ungranted marked NOT ESTABLISHED. **Any FAIL or
ERROR-HALT halts the gate** — report the sanitized blocker; do not repair or proceed to D-NATIVE-SEND-CONFIG
execution / D-PROD-1B/C.

---

## 3. Sanitized-evidence template (record ONLY these fields)

> **Exclude:** secret values, API-key strings, credentials, tokens, emails (including raw service-account
> emails — record a non-reversible label/verdict, not the literal), UIDs, and local/protected paths. Record
> verdicts + non-secret identifiers only. Full raw identities, if ever needed, stay in an access-controlled
> evidence store, never in this template.

```
D-PROD-1A EVIDENCE (sanitized) — operator: <role, not name/email> — date: <UTC>
C1 project identity            : projectId=<PROJECT> matches approved=? [PASS/FAIL]
C2 initiate function           : [PRESENT rev=<id> | CONFIRMED-ABSENT | ERROR-HALT]  runtimeSA=<dedicated? yes/no; default? yes/no> [PASS/FAIL]
C2 list function               : [PRESENT rev=<id> | CONFIRMED-ABSENT | ERROR-HALT]  runtimeSA=<dedicated? yes/no; default? yes/no> [PASS/FAIL]
C3 initiate secret bound       : [initiate PRESENT: bound? no=PASS/yes=FAIL | initiate ABSENT: N/A=PASS]
C4 effective secret access     : list binding? [no=PASS/yes=FAIL]; FULL effective accessor set (analyze-iam-policy) == {initiate SA} only? [yes=PASS/no=FAIL]; list->initiate impersonation getAccessToken=[NOT_GRANTED=PASS/GRANTED|COND=FAIL]; list versions.access=[NOT_GRANTED=PASS/GRANTED|COND=FAIL]
C5 sender secret               : [CONFIRMED-ABSENT=PASS | PRESENT]; (accessor scoping is proven by C4(c), not this resource read)
C6 API key                     : owned by <PROJECT>? [yes/no]; Identity-Toolkit-appropriate restrictions? [yes/no] [PASS/FAIL]  (key string NOT recorded)
C7 APIs enabled                : identitytoolkit=? secretmanager=? [PASS/FAIL]
C8 deploy boundary + rollback  : surface == {initiate,list} only? [yes/no]; rollback baseline=<per-fn rev or not-deployed; sender fail-closed> [PASS/FAIL]
C9a inactive (code d6628a5)    : active:false? [yes=PASS/no=FAIL]
C9b deployed-code provenance   : build source commit == baseline? [established | NOT-established(limitation) | contradicted=FAIL | N/A not-deployed]
C9c ungranted                  : stored-grant probe=[none-active => ungranted-CLAIMED | not-performed => ungranted NOT-ESTABLISHED (posture narrowed) | active=FAIL]
AGGREGATE                      : [PASS / HALT: <sanitized reason>]
```

---

## 4. Halt conditions (stop without repair or mutation; report sanitized)

Halt immediately (do not repair, mutate, or continue) if: any object resolves to **ERROR-HALT** (a
non-NOT_FOUND error — e.g. PERMISSION_DENIED — is never treated as absent); the project id does not match the
approved project; a Function is partially/unexpectedly deployed or has an unrecognized runtime identity; a
sender secret is already bound to either callable before the authorized config gate; the effective-accessor
analysis is incomplete (any `fullyExplored` false) or the operator lacks org/ancestor-scope Cloud Asset
visibility (cannot enumerate ancestor folder/org grants); `listResetEligibleUsers` has any **effective** path
to the sender secret (binding, resource/ancestor/group/role/conditional accessor, or impersonation of the
initiate SA) or the secret is broadly readable; the API key belongs to another project
or is over-broad/blocks server use; a required API is disabled; the deployment boundary is not exactly the
two callables; the deployed code does not match the `d6628a5` baseline or a stored role/assignment grants the
permission; or any check requires a prohibited (mutating / value-reading) command to complete. Report the
**sanitized** blocker only.

---

## 5. Boundary (unchanged by this runbook)

D-PROD-1A is **read-only**. It authorizes NO Secret Manager creation or value access, NO IAM mutation, NO
service-account creation/assignment, NO configuration change, NO deployment, NO fixture creation, NO email
send, NO permission activation/grant, NO cross-key reconciliation, and NO D-PROD-1B/C action. It is a
precondition for — never a substitute for — those separately authorized gates. `admin.credentialReset.initiate`
remains **inactive** (code attestation, C9a) and **fail-closed**; "ungranted" is asserted only where C9c's
stored-grant probe was performed (otherwise it is recorded as NOT ESTABLISHED, not claimed). The deployed
sender remains fail-closed.

_This runbook is a documentation deliverable only. It remains **PENDING / NOT AUTHORIZED FOR EXECUTION**
until Codex review and a separate Owner merge/run decision; then a named operator runs it out-of-band and
returns only the sanitized evidence in §3._
