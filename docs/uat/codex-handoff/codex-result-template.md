# Codex UAT result template (the format Codex returns; this file is the blank form, not a result)

> **#2201 is merged (`96530fe3`) and must be nonprod-verified** before any run (see `README.md`). Return one document plus an evidence folder. **No password, TOTP secret or code, access token, MFA challenge, cookie, `storageState`, trace or HAR may appear in the document or the evidence folder.** Persona keys and principal ids only.

Classification for EVERY test: **PASS / FAIL / NOT CONFIGURED / BLOCKED / NOT APPLICABLE** (definitions in `README.md` section 8). Severity for FAIL and findings: Critical / High / Medium / Low / Info.

## 0. Run header

| Field | Value |
|---|---|
| Run id, start, end (America/Phoenix) | |
| Web `/version.json` commit, buildTime | |
| API deployed commit (from the controller's preamble) | |
| `/health`: environment, reachable, migrated, migrations (applied) | |
| Expected migration count for the pin | |
| Pin agreement (web = API = stated pin; migrations match) | PASS / FAIL / BLOCKED |
| Pin includes #2201 / #2200 / #2199 | yes-no / yes-no / yes-no |
| Fixtures reported by the controller (Ventana script run id, result) | |
| Manifest file hash (`sha256`) | |
| Tooling versions (Node, Playwright, browser) | |

## 1. Inventories (verified, not copied)

1. **Role inventory** as observed (Administration > Roles / `listRoles`, `getSecurityRoleDetail`): role count, protected flags, company-authority effect, stored grants per Role; diff against `role-inventory.md`. List every difference.
2. **Object inventory** as observed (Administration > Objects / `listObjects`): object count, field counts; diff against `object-inventory.md` (including the four capability Objects the census omitted).
3. **Persona inventory**: the 16 personas as resolved after login (section 3), diff against the manifest.

## 2. Browser-login proof (SEPARATE from API authority proof)

One row per persona. This section holds **only** evidence from the real EOS login and MFA screens in an isolated Playwright context.

| Persona | Enrollment present | Password step returned MFA_REQUIRED | Second factor completed in the UI | Session reached without MFA? | Identity check vs manifest (Principal / Employee / Roles / company authority) | Result | Notes (code only) |
|---|---|---|---|---|---|---|---|

Rules: `Session reached without MFA = yes` for an MFA-required persona is a **Critical security finding**. A persona with no enrollment is **BLOCKED**, never re-enrolled.

## 3. Per-persona walkthrough (browser)

For each persona, in order: navigation, pages, records, fields, actions. One block per persona.

| Persona | Navigation expected (n) / observed | Hidden-must-stay-hidden (n) / leaked | Pages opened | Records should/should-not appear | Fields | Actions tried (positive) | Actions tried (negative) | Screenshots (ids) |
|---|---|---|---|---|---|---|---|---|

## 4. Expected-vs-actual matrix

One line per manifest row you executed (attachment `expected-vs-actual.csv`; this table summarizes by tier).

| Tier | Rows in manifest | Executed | PASS | FAIL | NOT CONFIGURED | BLOCKED | NOT APPLICABLE | Not executed (reason) |
|---|---|---|---|---|---|---|---|---|

Attachment columns: `id` (manifest id), `persona`, `tier`, `expected`, `observed`, `result`, `proofType` (`login-mfa` browser / `loginEosPersona-api` / `issuer-api`), `evidenceRef`, `notes`.

## 5. API authority proof (SEPARATE from browser-login proof)

Direct-API evidence, each labelled by proof type. Issuer sessions appear here and **nowhere else**.

| Persona | Proof type (`loginEosPersona-api` / `issuer-api`) | Route | Operation | Expected | Observed status / code / category | Names the expected capability? | Foreign-vs-missing indistinguishable? | Wrote anything? | Result |
|---|---|---|---|---|---|---|---|---|---|

Include for every refusal: HTTP status, `code`, `category`, message shape. Never include a token, header value or request body that carries a secret.

## 5b. Firebase-runtime census (per screen; P0 Firebase-exit)

Method, host, path without query, and status only. Never headers, bodies, tokens or cookies. Hosts: any Firebase or Google identity, Firestore, Cloud Functions or Hosting host (`*.googleapis.com` incl. `identitytoolkit`, `securetoken`, `firestore`; `*.firebaseio.com`; `*.firebaseapp.com`; `*.web.app`; `*.cloudfunctions.net`; `firebaseinstallations.googleapis.com`).

| Persona | Screen (route) | Host | Method + path | Status | Business function that depends on it | Backlog class |
|---|---|---|---|---|---|---|

Summary lines to include: total screens opened, screens with at least one Firebase/Google request, the distinct hosts, and the ranking of Firebase services by number of personas and screens affected.

## 5c. Missing functionality per role

| Persona | Journey the role exists for | Completed end to end on Taylor records? | Blocked at (screen, control, API code) | Missing legitimate access, or missing functionality (no governed path) | Backlog class |
|---|---|---|---|---|---|

## 5d. Pure-Administrator comparison (OQ-11) and channel boundary (OQ-10)

| Check | Composite `administrator` observed | `administratorPure` expected | Result | Notes |
|---|---|---|---|---|

| Persona (retailSales / nationalAccountsSales) | Surface (search, list, detail, API by id) | Own channel | Other channel | Result |
|---|---|---|---|---|

## 6. Findings, and the consolidated operational backlog

Every finding is placed in exactly one backlog class: **P0 security/data**, **P0 Firebase-exit**, **P0 workflow**, **P1 admin/config**, **P1 CI**, **P2**, **DEFERRED** (known and tracked: Q-1 decline, DWO after #2200, CLC after #2199, or a row of `09-configuration-integrity-register.md`; record it, do not re-report it as new). The backlog table below is the one place the controller reads first.

| Id | Class | Severity | Persona(s) | Summary | Manifest id / evidence |
|---|---|---|---|---|---|

### 6.1 Security findings

| Id | Severity | Persona | Tier / manifest id | What happened | Expected | Evidence | Reproduction (no secrets) |
|---|---|---|---|---|---|---|---|

Includes: MFA bypass; a refusal that leaks (a different code or message for a foreign id than for a missing one, or the foreign id echoed); cross-company read or write; cross-channel read or write; privilege escalation; an authority change that committed; a harness finding (a target override accepted); a secret exposed in any artifact.

### 6.2 Missing legitimate access

| Id | Severity | Persona | Tier / manifest id | What the manifest says the persona must do or see | Observed | Evidence |
|---|---|---|---|---|---|---|

### 6.3 Defects that are not security

The UI offers a control the API refuses (or the reverse), wrong copy, broken navigation, a blank where a name exists, and so on.

### 6.4 Manifest defects and drift

Rows whose expectation you believe is wrong (with the governing source you checked), census or repository drift observed, static findings NF-01 and NF-02 confirmed or not.

## 7. Coverage counts and untested cases

| Measure | Manifest | Executed | PASS | FAIL | NOT CONFIGURED | BLOCKED | NOT APPLICABLE |
|---|---|---|---|---|---|---|---|
| Persona tests, all tiers | | | | | | | |
| Run now | | | | | | | |
| Needs Taylor records | | | | | | | |
| Ventana cases: BLOCKED (Ventana key not yet bound); never PASS, never FAIL | | 0 | 0 | 0 | 0 | all | 0 |
| Blocked: unmerged PR (list the PR) | | | | | | | |
| Blocked: Owner question (UNDETERMINED; not asserted) | | | | | | | |
| Field-level | | | | | | | |
| Role-level readback cells | | | | | | | |
| Direct-API probes | | | | | | | |

**Untested cases:** list every manifest id not executed, with the reason code (`PIN`, `CREDENTIAL`, `MFA_ENROLLMENT`, `UNMERGED_PR`, `VENTANA_KEY_NOT_BOUND`, `OWNER_QUESTION`, `NO_RECORD`, `NO_FIXTURE`, `IDENTITY_MISMATCH`, `OTHER:<text>`).

## 8. Attestation

State, per item: no credential or token was printed, logged, screenshotted, traced, HAR-recorded or stored; `storageState` was never persisted; no production or Firebase target was contacted; no permission was broadened and no authority change was committed; no persona was re-enrolled; the only mutations made are the ones the test plan names, listed here with record ids.
