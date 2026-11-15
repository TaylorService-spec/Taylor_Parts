# SaaS Operations & Reliability

Issued: 2026-10-11 04:15:00 -0700 (America/Phoenix) · Baseline: `main @ c73ce647` · Status: ASSESSMENT ONLY

Classification: **Executable-tested** (enforced by code/CI), **Executed** (performed once with recorded evidence), **Documented procedure** (operator runbook, not automated), **Missing**, **UNKNOWN**. Managed hosting is **not** assumed to satisfy any availability or compliance control.

## 1. Environments and deployment repeatability

| Control | Class | Evidence |
|---|---|---|
| Environment registry, fail-closed build resolution (unknown env / missing readiness flag = build error) | Executable-tested | `config/environments.json`; ADR-011 §4; `scripts/environmentArchitecture.test.mjs`, `eosApiEnvironmentContract.test.mjs` (run locally: 127 pass / 0 fail / 13 skipped across four guard suites) |
| Render non-prod as code (Blueprint) | Executable (on deploy) | `render.yaml` |
| **Production EOS API / PostgreSQL** | **Missing.** No production Blueprint; service refuses production. | `render.yaml:30-32`; `server.ts:107-113` |
| Firebase production deploy fence | Executable-tested | `scripts/firebaseDeployGuard.mjs:24-32`; `.github/workflows/firebase-deploy-guard.yml` |
| GitHub Pages production publish | Documented procedure (manual `workflow_dispatch`, typed "PUBLISH PRODUCTION") | `.github/workflows/deploy-field-ops.yml` |
| Firebase production release | Documented procedure (`--confirm taylor-parts`, no `--force`, Rules excluded, rollback identity captured) | `scripts/_prodRelease.run.sh:12-30,121-205` |
| Per-customer environment creation | Documented by implication only (new Firebase project + registry entry + Render service + Vercel env). **No IaC or runbook for a new customer.** | ADR-011; `scripts/_sandboxRefresh.run.sh:215,299` hardcodes `eos-platform-sandbox` |

## 2. CI/CD protections

- **151 workflows**, almost all path-filtered test suites. On `c73ce647`, all 60 completed `main` runs succeeded.
- **Guards:**
  - `governance-guard-enforcement.yml` (unfiltered);
  - `gitleaks.yml`;
  - `operational-payload-guard.yml`;
  - `firebase-exit-guard.yml` (ratchet);
  - `deployment-drift-core-tests.yml`;
  - `release-tooling-validation.yml`.
- **Critical gap: `main` has no branch protection and no rulesets** (GitHub API 404). Required checks cannot be enforced, so every guard is advisory. `governance-guard-enforcement.yml:9` acknowledges path-filtered guards are "advisory by construction".
- **No CODEOWNERS.** No scheduled workflows (no `schedule:` trigger anywhere), so drift checks never run unattended.
- **Repository is public.** For a proprietary product (`LICENSE`: all rights reserved), public source is an IP and security-reconnaissance exposure. It is an Owner decision (OD-2).

## 3. Schema migration safety and rollback

| Control | Class | Evidence |
|---|---|---|
| Migrations in pre-deploy phase; service refuses to serve unmigrated DB | Executable | `render.yaml:36-44,73`; `requirePolicyDatabaseReady` |
| Down sections | 94/95 migrations carry `-- Down Migration`. Down paths refuse destructive data loss. **No CI test exercises down-migrations.** | `functions/migrations/*.sql` |
| `--no-check-order` on `migrate:up` | Risk: out-of-order migrations accepted | `functions/package.json:19` |
| Tenant-aware/zero-downtime migration discipline (expand/contract) | Missing as a documented standard | — |
| App rollback | Documented procedure (Firebase); Render rollback relies on platform deploy history (UNVERIFIED) | `_prodRelease.run.sh` |
| Rules rollback | Documented procedure | `docs/operations/authorization-cutover-rollback.md` |

## 4. Backup, restore and disaster recovery

| Control | Class | Evidence |
|---|---|---|
| Firestore PITR plus scheduled backups (daily ×4 weeks, weekly ×14 weeks), production | Executed, configuration recorded | `docs/audits/c3-p2-p4-protection-20260806/README.md:1-40,89-91` |
| Firestore restore rehearsal | Executed once (PITR clone, RTO-CLONE 559 s, data only) | `docs/audits/c3-p5a-pitr-rehearsal-20260806/README.md` |
| Firebase Auth backup | **Missing** ("Firebase Auth remains uncovered") | `c3-p2-p4.../README.md:102` |
| **Render PostgreSQL backup / restore** | **Missing / UNKNOWN.** No policy, no rehearsal, no plan-tier evidence. | — |
| Whole-platform RTO/RPO | Missing ("≤4h target — NOT YET PROVEN") | `c3-p2-p4.../README.md:93`; `docs/assessments/customer-operability-data-ownership-and-analytical-export.md:76` |
| Customer-data restore gate | OPEN (C1-RECOVERY-01, C1-CONTINUITY-01) | `docs/customer-1/CUSTOMER_1_READINESS.md:20-21` |
| Multi-region / HA | Missing ("No replicas, no HA topology, no workers, no cron") | `docs/architecture/eos-real-nonprod-activation.md:448-449` |

## 5. Observability and operations

| Control | Class | Evidence |
|---|---|---|
| Error reporting / tracing / APM | **Missing** ("no error reporting, tracing, or telemetry anywhere") | `docs/design/c3-delivery-reliability-and-release-visibility.md:115-117` |
| Alerting channel | **Missing** ("No alerting channel chosen") | same |
| Structured / centralized logging | Missing: `console.*` to platform stdout (56 files); `x-request-id` read but no tenant-tagged structured log | `functions/scripts/serveEosApi.mjs:15`; `adminPolicyHttp.ts:179` |
| Health check | Executable (`/health` → 503 when DB unreachable), non-prod | `adminPolicyHttp.ts:123-128` |
| SLOs / availability targets / SLA | Missing | `docs/PlatformOperatingModel.md:88` |
| Performance / load testing | Missing | — |
| Capacity planning / autoscaling | Missing (single `starter` instance; no `numInstances`/scaling keys) | `render.yaml:57-75` |
| Background workers / queues / scheduled jobs | Missing (in-process `setInterval` poller only; refuses production) | `eosOps/inboundProviderRuntime.ts:744-750` |
| Deployment drift detection | Core executable-tested; live check is a manual CLI. Rules drift once went five days undetected. | `scripts/deploymentDrift.mjs`, `checkDeployedVersions.mjs`; `docs/architecture/SYSTEM_AUTHORITIES.md:52` |
| Secrets management | Documented plus CI leak gate (Render-injected DB URL; Secret Manager for OAuth and OpenAI; gitleaks) | `render.yaml:11-25`; `docs/runbooks/openai-secret-setup.md` |
| Certificates / TLS | Platform-managed: UNVERIFIED | — |
| Incident response | **Missing** (no generic IR runbook; 32 task-specific operations docs exist) | `docs/operations/` |
| Release management | Strong evidence discipline (release records `docs/releases/*`, provenance guard `_releaseProvenanceGuard.mjs`), sandbox-centric | `docs/releases/` |
| Infrastructure cost visibility | Missing (no budgets/alerts; Firestore protection cost measured, see cost model) | `docs/assessments/blaze-governance-amendment.md:140-148` |
| Customer support diagnostics | Missing (no support-access mode, no per-tenant diagnostic bundle) | — |
| Audit-log retention | Audit is append-only and immutable; **no retention or archival policy** | `1762646400000:154-172` |

## 6. Security and compliance readiness (questionnaire view)

| Area | Technical controls present | Evidence gap / organizational work required |
|---|---|---|
| SOC 2 (CC series) | Change control discipline, append-only audit, least-privilege model, secret scanning | No policies, no control owner matrix, no evidence collection, no auditor, branch protection missing. **Not compliant; no claim possible.** |
| Security policies | `docs/security/` holds 2 documents (secret scanning; ownership bypass census) | InfoSec policy, acceptable use, access control policy, SDLC policy |
| Data encryption | Platform default at rest / TLS in transit (UNVERIFIED) | Written statement, key-management description |
| Access reviews | Effective-access explanation and role-holder lists exist | Periodic review procedure and evidence |
| Audit retention | Immutable audit tables | Retention period, export, archival |
| Vulnerability management | gitleaks only | Dependency scanning, SAST, patch SLA |
| Penetration testing | None | External test (vendor; Owner spend) |
| Incident response | None | IR plan, roles, customer notification terms |
| Vendor management | Vendors visible in code (Render, Vercel, Google/Firebase, Microsoft Graph, Google APIs, optional OpenAI/Anthropic) | Subprocessor list, vendor risk reviews |
| Business continuity | Firestore PITR evidence | BCP, PostgreSQL DR proof, RTO/RPO |
| DPA / privacy | None | DPA template, privacy policy, data map |
| Data retention / deletion | None (no tenant purge; immutable audit conflicts with deletion requests) | Retention schedule; deletion vs audit-preservation policy (Owner/counsel) |

## 7. Executable vs documented: summary

- **Strongest executable controls:**
  - environment fail-closed resolution;
  - production deploy fences;
  - Firebase-exit ratchet;
  - append-only audit triggers;
  - cross-tenant refusal tests;
  - gitleaks.
- **Documented-only:** production release, rollback, Rules deploy verification, Firestore restore (executed once).
- **Missing entirely:**
  - production target hosting;
  - PostgreSQL backup/restore;
  - observability and alerting;
  - IR;
  - SLOs;
  - dependency scanning;
  - branch protection;
  - scheduled drift checks;
  - support diagnostics.
