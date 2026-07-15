---
artifact_type: implementation-plan
gate: Implementation Plan
status: Approved -- documentation only, no application code touched
date: 2026-07-15
owner: Claude Code (Inventory)
related_adrs: [docs/architecture/ADR-005-enterprise-authorization-migration-strategy.md]
depends_on: [docs/specifications/enterprise-access-and-administration-platform.md, docs/implementation-plans/enterprise-access-and-administration-platform.md]
implements: [docs/specifications/enterprise-access-and-administration-platform.md]
supersedes: []
superseded_by: []
related_pr:
target_release: TBD
---

# Prototype Reconciliation: Enterprise Access & Administration Platform

**Row 9 (Task 14) of the Issue #226 Implementation Plan.** Adopt/adapt/defer/reject mapping for every existing Administration-domain screen and navigation slot against ADR-005, the Specification, and the Implementation Plan -- so Rows 10-12 (Admin Portal foundation, read-only MVP, mutation UI) build on top of what already exists correctly, instead of silently duplicating or contradicting it.

**This record authorizes no implementation.** It is documentation only -- no route, component, Rule, Function, schema, or nav-config change is made by this PR. Rows 10-12 remain separately-authorized units of work that consume this mapping.

## 1. What "the prototype" actually is (verified against current `main`)

Before mapping anything, the actual current state was verified directly (not assumed from an earlier, less precise description): the `Administration` nav domain (`field-ops-app-vite/src/navigation/navConfig.js`) declares eight sub-items. Two are real, built screens; the other six render the shared generic `PlaceholderPage` component (`field-ops-app-vite/src/App.jsx`'s `renderSubnavItem()`). There is no separate, richer "Admin dashboard prototype" with its own mock data store beyond this -- the Administration domain's real content today is exactly these eight nav slots and the two built screens behind two of them.

| Nav slot (`navConfig.js` key) | Label | Current implementation |
|---|---|---|
| `employees` | Employees | Real, built screen (pre-existing Technicians/Employee directory feature, `legacyKey: "technicians"`) |
| `users` | Users | Generic `PlaceholderPage` |
| `rolesPermissions` | Roles & Permissions | Generic `PlaceholderPage` |
| `vehicles` | Vehicles | Generic `PlaceholderPage` |
| `regions` | Regions | Generic `PlaceholderPage` |
| `companySettings` | Company Settings | Generic `PlaceholderPage` |
| `integrations` | Integrations | Real, built screen (`IntegrationsFaq.jsx` -- an informational FAQ/readiness-checklist page for connecting Field Ops to external company infrastructure, e.g. ERP/CRM/BI; unrelated to Role/Permission administration) |
| `auditLogs` | Audit Logs | Generic `PlaceholderPage` |

No mock data, no fixture store, and no prototype-only schema exist behind any of the six placeholder slots today -- `PlaceholderPage` renders only a title and a static note. This significantly narrows Row 9's actual scope relative to a hypothetical richer prototype: there is nothing to extract mock data FROM for `users`/`rolesPermissions`/`auditLogs`, because none exists yet.

## 2. Adopt / Adapt / Defer / Reject mapping

| Nav slot | Disposition | Reasoning |
|---|---|---|
| **`employees`** | **Reject (out of scope for #226)** | A pre-existing, already-governed Employee/workforce-identity feature (Issue #100's own operational-role model, `docs/BusinessEntityModel.md` Section 8a). Not part of the Enterprise Access & Administration Platform's Permission/Role/Scope/Audit model. #226 must never touch this screen or its route. |
| **`integrations`** | **Reject (out of scope for #226)** | `IntegrationsFaq.jsx` is a real, complete, already-shipped feature about connecting Field Ops to *external* company systems (ERP/CRM/BI) -- a different capability domain entirely from *internal* Role/Permission administration. #226 must never touch this screen, its route, or its content. |
| **`vehicles`** | **Reject (out of scope for #226)** | Fleet/asset administration -- unrelated to authorization. Stays a `PlaceholderPage` until some other, separate initiative builds it. |
| **`regions`** | **Reject (out of scope for #226)** | Organizational/territory configuration -- unrelated to authorization (and, notably, adjacent to but NOT the same as the Scope `region`/`location`/`tenant` concepts Spec sec5.4/sec10 define; this nav slot is a business-data screen, not a Scope-administration UI). Stays a `PlaceholderPage`. |
| **`companySettings`** | **Reject (out of scope for #226)** | General company configuration -- unrelated to authorization. Stays a `PlaceholderPage`. |
| **`users`** | **Adopt the nav slot; defer all content** | Maps directly to Spec sec16's Admin Portal MVP surface "view/set user status." Row 10 (Admin portal foundation) claims this existing nav slot for its real content; Row 11 (read-only MVP) implements user/account status display; Row 12 (mutation UI) wires enable/disable to the already-merged `setUserStatus` trusted-writer command (Row 7/PR #284) via the operator path until Issue #15, then via a deployed Function after. No content exists to adopt/adapt today -- the PlaceholderPage is replaced outright, not migrated from mock data (there is none). |
| **`rolesPermissions`** | **Adopt the nav slot; defer all content** | Maps directly to Spec sec16's "assign already-approved Roles" and "permission preview/explanation." Row 10 claims this nav slot; Row 11 implements the read-only current-Role display + effective-permission preview (using the already-merged, already-tested `resolveEffectivePermission()` from Row 2/PR #275); Row 12 wires Role assignment to `grantRole`/`revokeRole`/`assignApprovedRole` (Row 7/PR #284). |
| **`auditLogs`** | **Adopt the nav slot; defer all content** | Maps directly to Spec sec16's "read-only immutable audit history," backed by the already-merged Row 5 Audit Service (`auditEventWriter.ts`'s `listRecentAuditEvents()`, PR #278). Row 10 claims this nav slot; Row 11 implements the read-only history view. Filtered/sorted queries beyond the unfiltered `orderBy(at desc)+limit` Row 5 already supports remain deferred to Row 11's own index/query design (documented in Row 5's own PR #278 as an explicit, intentional limit). |

## 3. Hard prohibitions carried forward into Rows 10-12 (Task 14's own explicit list)

Restated here as binding constraints on the rows that consume this reconciliation, not merely as this PR's own scope:

- **Do NOT copy mock data into production.** There is none to copy (sec1 above) -- Rows 10-12 build real, Rules/Function-backed content from the start, never a hardcoded fixture masquerading as live data.
- **Do NOT replace `App.jsx`/nav/shared CSS/components wholesale.** Rows 10-12 add three new `renderSubnavItem()` cases (`users`, `rolesPermissions`, `auditLogs`) to the SAME generic dispatch pattern every other Administration/Inventory-role nav item already uses (see Issue #100's own precedent: PR #227/#238/#240 each added exactly one new case, never touching the shared routing/shell logic). No wholesale rewrite of `App.jsx`, `navConfig.js`'s structure, `index.css`, or any shared shell component.
- **Do NOT weaken route/permission gates.** The Administration domain's existing `PLACEHOLDER_DEFAULT_ROLES` visibility gate (`isNavItemVisible()`, `navConfig.js`) stays the authoritative UI-visibility gate unless and until a later, separately-authorized row explicitly cuts a domain over to the new Permission-preview helpers (Implementation Plan Row 16/21) -- Rows 10-12 must not weaken or bypass it in the meantime.
- **Do NOT introduce prototype-only schemas.** Every object Rows 10-12 read or write must be one of the seven governed objects already fixed by Spec sec5 and already implemented by Rows 1-8 (Permission/Role/RoleAssignment/Scope/Condition/AccessRequest/AuditEvent) -- no new, parallel "admin UI" data shape invented for convenience.
- **Do NOT imply unavailable capabilities work.** Per ADR-005 sec2.5/Spec sec16, the MVP is read/status/assignment-only -- permission/Role-definition builders, custom Scope/Condition builders, direct permission overrides, approval-policy editor, claims administration, break-glass administration, bulk migration, access requests, AI administration, and impersonation are ALL explicitly out of scope for Rows 10-12 and must never be implied as working (e.g. no dimmed-but-clickable button that silently no-ops, no UI copy suggesting a capability exists before its trusted-writer/claims/deployment prerequisite is verified).

## 4. Scope honored

Exactly one new file: `docs/implementation-plans/enterprise-access-prototype-reconciliation.md`. No application code, Rules, Functions, schemas, routes, `navConfig.js`, `App.jsx`, or deployment change. Issue #226 stays OPEN/In Progress. Row 10 (Admin portal foundation) is the next eligible unit of independent work once this record merges.
