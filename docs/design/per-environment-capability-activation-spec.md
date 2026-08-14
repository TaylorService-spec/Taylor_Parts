# Per-Environment Capability Activation — Spec (Owner-directed 2026-08-14)

**Goal:** let the sales/fulfillment/finance spine (11 capabilities, globally `active:false`) resolve as grantable in the sandbox (`platform-sandbox`) while remaining hard-DENY everywhere else — **zero production exposure**, so the full Opportunity→SO→Fulfillment→Billing flow is testable in the sandbox.

**Status:** AUTH-CORE / security-sensitive change → REVIEW BEFORE MERGE (not routine self-merge). Repo-only; deploys/grants stay gated.

## Hard invariant
Production must NEVER be activatable via this path. Fail-closed by default: unknown/misconfigured environment → no override → deny (today's behavior).

## Design
1. **`config/environments.json`** — new per-environment key `capabilityActivationOverrides` (array of PermissionId). `platform-sandbox` lists the 11 spine ids; `taylor-parts-production` (and any `role:"production"` env) has **no such key** (absence, not empty array).
2. **`resolveEffectivePermission` (both mirrors, identical, stays PURE)** — add optional `activationOverrides?: ReadonlySet<PermissionId>` to `ResolveInput`; change the gate at the `permission.active === false` line to `if (permission.active === false && !input.activationOverrides?.has(input.permissionId)) DENY`. Nothing else changes; Role/Scope/Condition checks below still required.
3. **Backend injection** — new pure `functions/src/access/environmentCapabilityOverrides.ts`: `resolveCapabilityOverrides(registry, projectId)` reads `process.env.GCLOUD_PROJECT` (auto-populated by the Functions runtime) → finds the env by `firebase.projectId`; returns empty Set if projectId missing/unknown, **empty Set unconditionally if `env.role === "production"`**, else the env's overrides ∩ `SPINE_OVERRIDE_ELIGIBLE_IDS`. Threaded through `effectiveAccessFeed.ts`'s `resolveEffectiveAccess` (the choke point every spine callable uses) into each `resolveEffectivePermission` call. Cache at cold start.
4. **Frontend injection** — reuse the existing `receivingReadiness.js` build-time pattern: inject `capabilityActivationOverrides` via `vite.config.js` `define` (like `__APP_READINESS__`), expose a frozen constant `field-ops-app-vite/src/config/capabilityActivationOverrides.js`, pass into the frontend resolver's `activationOverrides`. A production build's key is absent → empty set baked in at build time (can't exist in a prod bundle). Needed so a human tester can drive the spine through the UI (else the UI stays fail-closed even though the backend would authorize).

## Triple production-hard-block (defense in depth)
- **Data:** prod entry has no `capabilityActivationOverrides`; a test asserts EVERY `role:"production"` env lacks the key.
- **Code (role-keyed, the real block):** `role === "production"` → empty Set unconditionally, ignoring registry data (mirrors `resolveEnvironment.mjs:135` `isProductionEnvironment`, keyed on role not project name).
- **Resolver (fail-closed default):** optional param; omitted/undefined/empty → today's deny. No path where omission widens access.
- **Eligible-set intersection:** overrides ∩ a hardcoded `SPINE_OVERRIDE_ELIGIBLE_IDS` (the 11 spine ids), so a careless `environments.json` edit can't sweep in an unrelated `active:false` capability.

## Required tests
- production role never overridable — even with a doubled registry fixture that (wrongly) puts overrides on the prod entry, `resolveCapabilityOverrides` returns empty.
- unknown environment (unlisted projectId) → empty Set.
- sandbox override lifts the active gate BUT still requires a qualifying Role (override alone → still `noQualifyingGrant` DENY without a grant).
- dual-mirror parity: override-bearing inputs yield identical results in both resolver copies (extend `resolveEffectivePermissionParity.test.mjs`).

## firestore.rules
**Not needed for this slice.** The 11 spine collections are Admin-SDK-only server writes (deny-all client Rules already); callables bypass Rules, so the callable-layer resolver is the entire gate. (A future client-direct read would need its own Rules review.)

## Spine capability list (activate in platform-sandbox)
opportunity.write, opportunity.read, opportunity.createSalesOrder, salesOrder.write, salesOrder.fulfill, salesOrder.service, finance.invoice.issue, finance.payment.apply, finance.adjustment.record, finance.read, finance.refund.record.
**Excluded (stay active:false even in sandbox):** workOrder.parts.plan, admin.credentialReset.initiate, report.*, coverage.*, equipment.compatibility.*/equipment.model.manage — separate workstreams.

## Completeness — what ELSE is needed to actually test (beyond this build)
The override only lifts the blanket `active:false` deny. To exercise the spine you also need:
1. **Grant the spine capabilities to a role** (compatibilityRoles/governedBusinessRoles) — safe to do globally because production still hard-denies via `active:false` (override inactive there). Fold into this build or a sibling PR.
2. **Assign that role to sandbox test personas** (`role_assignments`) — a governed data write against the sandbox (onboard-employee/role-assignment tooling). Gated/operational, done against sandbox data.
3. **Deploy** Functions + frontend to the sandbox (gated). No rules deploy needed per above.

## Material choices (architect recommendations, accepted)
A. Backend env id from `GCLOUD_PROJECT` (structurally tied to the deployed project; no hand-set var to drift). B. Duplicate the ~10-line project→env pure lookup into `functions/src/access/` (matches the repo's mirror convention; smallest blast radius). C. Wire the frontend too (needed for UI-driven testing). D. Per-capability-id list (not a coarse flag). E. Cache overrides at cold start.
