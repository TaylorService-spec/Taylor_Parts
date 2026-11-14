# SaaS Commercial Capability Gaps

Issued: 2026-10-11 04:15:00 -0700 (America/Phoenix) · Baseline: `main @ c73ce647` · Status: ASSESSMENT ONLY. It does not choose a payment provider or implement billing.

## 1. Two kinds of billing

1. **EOS's business-domain invoicing** of the customer's own customers. This is **implemented**:
   - `functions/migrations/1758931200000_invoice-authority.sql` (`invoices`, `invoice_lines`);
   - `1759017600000_ar-cash-application-authority.sql`;
   - `1764450000000_operational-billing-packages.sql`;
   - `functions/src/eosFinance/*`.

   It is accepted (Finance Closure #206) and is **not** part of this gap analysis.
2. **Verenward billing its EOS tenants** (SaaS subscription). This is **absent**, and it is the subject of this document.

## 2. Capability inventory

| Capability | Status | Evidence |
|---|---|---|
| Plans / subscription tiers / pricing | Missing | No schema or code. C1-COMM-01 OPEN (`docs/customer-1/CUSTOMER_1_READINESS.md:12`). The lane mandate's `docs/customer-1/commercial/` does not exist. |
| Customer signup | Missing | — |
| Trials / demonstrations | Partial. Non-prod `platform-sandbox` plus synthetic seeding (`seedTaylorNonprodWorkforce.mjs`, `seedOperationsDemoData.js`). Demo mode is defined in `docs/DeploymentModeStrategy.md` §3. No trial-tenant mechanism. | |
| Product entitlements | Missing as a commercial concept. Capability activation is **per environment** (`config/environments.json` `capabilityActivationOverrides`; `access/environmentCapabilityOverrides.ts:467-670`, keyed by Firebase projectId). `eosOps/conditionalEntitlement.ts` is RBAC conditional access, not licensing. One UI copy line says "entitlement-gated" (`AdminEmailCommunications.jsx:515-518`). | |
| Add-on seam | Implemented. Inbound processing provider `EOS_NATIVE \| VDX \| EXTERNAL` (`inboundWork/inboundWorkModel.ts:67`). Base EOS works without VDX (`docs/architecture/email-connections-and-inbound-work.md:49-62`). VDX is not in this repo. | |
| Seat licensing | Missing. Seat count is derivable (active `tenant_memberships`, linked employees) but not enforced. | |
| Usage metering | Missing for EOS. AI usage records are built but never persisted (`assistant/assistantTelemetry.ts:102-117`). | |
| Billing integration / invoices / payment collection | Missing | — |
| Renewals / upgrades / downgrades | Missing | — |
| Suspension | Partial. `tenants.status` CHECK `active\|suspended\|retired`, and requests to a non-active tenant are refused (`principalContext.ts:210-211`). **No command changes status** (no `UPDATE eos_policy.tenants`). | |
| Cancellation / retention after cancellation | Missing (no export or purge; down migrations refuse data destruction) | |
| Customer account administration (Verenward side) | Missing. No platform-operator console; tenant creation is `bootstrapEosTenant.mjs` (non-prod only). | |
| Cost attribution by tenant | Missing (one environment = one customer today; no tagging) | |
| Support entitlements / SLA / contracts | Missing. `docs/PlatformOperatingModel.md:84-88` defers SLAs and support. C1-SUPPORT-01 and C1-CONTRACT-01 OPEN. | |
| Legal entity of record | UNKNOWN. `LICENSE` and `docs/OWNERSHIP.md` name Rudy DiGiorgio. Verenward LLC appears only as brand and hosting operator. Successor-company IP documentation is an Owner/counsel item (OWNERSHIP §1, §7). | |

## 3. What belongs in EOS and what belongs in a control plane

The principle: EOS enforces; the control plane decides commercially. EOS must keep running if the control plane is down. Entitlements are cached and enforced in EOS and fail closed only for **new** activations, never for existing operations.

| Concern | EOS (per deployment) | Verenward Commercial Control Plane (separate service) |
|---|---|---|
| Tenant record, status enforcement | ✔ `eos_policy.tenants` (exists) | Source of commercial status; pushes suspend/resume |
| Feature / module entitlements | Enforce: a per-tenant entitlement table consulted alongside capability activation | Plans → entitlement sets; push on change |
| Seats | Report active memberships; enforce cap at invite | Contracted seat count |
| Usage metering | Emit metered events (append-only, tenant-keyed) | Aggregate, rate, invoice |
| Customer/contract/plan/price | — | ✔ |
| Billing provider integration, invoices, dunning | — | ✔ (Owner selects provider) |
| Provisioning orchestration | Expose an idempotent, audited `provisionTenant` API | Calls it. For dedicated deployments, also runs IaC |
| Support entitlements, SLA tiers | Diagnostics, support-access audit | ✔ |
| Cost attribution | Tag logs/metrics with tenant | Join infrastructure cost to tenants |
| Data export / deletion | ✔ Execute (it owns the data) | Trigger per contract and retention policy |

**Why separate:**

- One commercial system has to span many dedicated EOS deployments (Scenario A/C).
- Commercial data, such as pricing and payment metadata, should not sit inside customer operating databases.
- EOS's governance (append-only audit, Owner protections) should not be bent around billing semantics.

This is a recommendation for Owner decision **OD-5**, not a new authority.

## 4. Recommended commercial architecture by segment

| Segment | Deployment | Commercial mechanics | Readiness prerequisites |
|---|---|---|---|
| **Small business, shared SaaS** | Scenario B: shared PostgreSQL environment, many tenants | Self-serve signup, plan tiers, seat-based, card billing | Firestore fully retired for in-scope modules, RLS/backstop, self-service provisioning and invites, EOS human login, per-tenant entitlements, rate limiting, observability. **Furthest away.** |
| **Mid-market, configurable SaaS** | Scenario C shared core (or a small pool), implementation package | Annual contract, seats plus modules, onboarding fee, invoice billing | All of the SMB list plus configuration (operating companies, LOB, calendars), PG data import, SSO optional |
| **Enterprise, dedicated/isolated** | Scenario A/C dedicated deployment, optionally customer region | Enterprise agreement, SLA, DPA, security review, optional customer-hosted data plane (ADR-015) | Production blueprint per customer (IaC), SSO/MFA, audit export, DR evidence, SOC 2 path. **Closest to today's architecture.** |

## 5. Minimum commercial capability for five managed customers

1. **Contracts and invoicing by Verenward outside EOS** (accounting system or billing provider; Owner choice). No code is required to *begin* billing.
2. **Customer register** in the control plane: customer, deployment, plan, modules, seats, SLA, contacts.
3. **Per-tenant entitlements in EOS** (roadmap P1-10), so modules can differ per customer without a code edit to `config/environments.json`.
4. **Tenant suspend/resume command** (P2-05), audited, Owner-protected.
5. **Tenant export** (P2-06), needed for contracts and offboarding.
6. **Support intake and severity model** (C1-SUPPORT-01, reused).
7. **Per-deployment cost tracking** (P2-10).

Full self-serve signup, card billing, metered usage and dunning wait until Scenario B is a goal.
