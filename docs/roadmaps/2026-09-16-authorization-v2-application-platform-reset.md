# Authorization v2 + EOS Application Platform Reset

**Recorded:** 2026-09-16  
**Status:** OWNER-DIRECTED FOUNDATIONAL WORKSTREAM  
**Parent roadmap:** `2026-09-16-full-platform-roadmap-reconciliation.md`  
**Target:** one client-agnostic identity/authorization/control plane on Render + PostgreSQL, with zero Firebase dependency.

## Decision

The current EOS identity/access/roles/permissions implementation is to be **replaced rather than incrementally repaired**.

This does **not** authorize deletion of business data or business modules. Customer, Employee, Sales, Service, Inventory, Purchasing, Equipment, Financial, Reporting and other domain records/workflows are retained and migrated as appropriate.

What is condemned is the fragmented control plane: overlapping role concepts, compatibility role logic, page/domain-specific authorization interpretation, Firebase-era business authority, and any path where authentication, Job Role, record responsibility and security permission are implicitly treated as the same thing.

## Canonical model

### Identity

`External Identity -> EOS Principal -> Employee`

Purpose: establish who the person is.

- Employee is the business/workforce person.
- Principal is the EOS security identity.
- External IdP identity proves identity only.
- An Employee may exist without application access.
- A Principal may be disabled/revoked independently of employment record retention.

### Authorization

`Principal -> Security Role(s) -> Permissions`

Purpose: establish what the Principal may do.

- Job Role is NOT Security Role.
- Security Role is a named package of permissions.
- A Principal may hold multiple Security Roles.
- Explicit Principal-level overrides may exist only through governed Administration and must be auditable.
- No page/domain/client has its own interpretation of Role.

### Business responsibility

`Record -> Owner / Accountable / Assignee / Approver / Operating Company`

Purpose: establish who owns the outcome, who is accountable, who performs work, who approves, and which operating company has authority.

- Owner is not Accountable.
- Accountable is not Assignee.
- Assignee is not Approver.
- Assignment does not silently transfer ownership.
- Ownership does not silently grant a Security Role.
- Responsibility fields may affect permission scope only where a permission explicitly uses them.

## Example

Jane Smith may simultaneously be:

- Employee: Jane Smith
- Job Role: Retail Sales
- Security Role: Salesperson
- Customer Owner: Jane Smith
- Opportunity Assignee: Jane Smith

Retail Sales and National Accounts Sales remain distinct Job Roles even when both intentionally use the same Salesperson Security Role.

Changing Job Role must not silently alter security access. Assigning work must not silently transfer ownership. Assigning Salesperson must not make the Principal owner of all sales records.

## Permission contract

The normal permission shape is:

`RESOURCE + ACTION + SCOPE + FIELD ACCESS`

Examples:

- `customers | read | company | *`
- `customers | update | owned | phone,email,address`
- `employees | read | company | name,jobRole,manager,status`

Workflow authority remains explicit where CRUD is not expressive enough, for example:

- `sales.quote.create`
- `sales.discount.approve`
- `sales.ownership.transfer`
- `service.inbound.accept`
- `service.workorder.assign`
- `purchasing.po.approve`
- `inventory.adjustment.approve`

Object access does not imply every field. Object edit does not imply every workflow transition. A workflow capability does not silently widen record scope.

## One server authorization engine

All clients and server commands converge on one conceptual decision:

```ts
authorize({
  principal,
  resource,
  action,
  record,
  fields,
  capability
})
```

The browser/mobile client may use effective-access results to hide or disable unavailable experiences, but the Render/EOS API independently enforces every protected action.

**Acceptance invariant:** Principal X + Action Y + Resource/Record Z must produce the same authorization result regardless of page, entry point, web/PWA/native client or workflow path.

## Target architecture

### Vercel

- web/PWA presentation and delivery;
- static/client assets;
- applicable edge/security protections;
- no privileged EOS business secrets in browser bundles;
- no business authorization authority.

### Render / EOS API

- OIDC identity-provider integration;
- EOS session issuance/validation/revocation;
- Authorization v2 evaluator;
- business reads/commands;
- workflow enforcement;
- server-side audit.

### PostgreSQL

System of record for:

- Employee;
- Principal;
- external identity binding;
- tenant membership;
- Security Role;
- Permission;
- Principal-to-Role assignment;
- Role-to-Permission assignment;
- explicit Principal override;
- EOS session/revocation facts;
- authorization/audit evidence;
- Owner/Accountable/Assignee/Approver relationships as governed by their domain;
- business data as object-by-object migration completes.

### External IdPs

Initial target: Microsoft Entra / Microsoft 365 OIDC and Google Workspace OIDC.

They answer: **who authenticated?**

EOS answers: **does that identity map to an active Principal and what may that Principal do?**

Future OIDC/SAML providers must not require a redesign of the business authorization model.

## EOS sessions

Vercel does not own EOS session authority.

Target behavior:

1. external IdP authenticates;
2. Render validates the identity callback/token;
3. EOS resolves the external identity to Principal + tenant context;
4. EOS creates/refreshes its governed session;
5. Render validates the EOS session on protected API calls;
6. access changes, Principal disablement, Employee offboarding or administrator session revocation can invalidate/re-evaluate access;
7. clients carry only safe session/token material; privileged secrets never enter the client.

## Administration target

### Employees

Business/workforce record:

- name and employee identity;
- employment/status;
- Job Role;
- manager/reporting relationship;
- operating company;
- business responsibilities/proficiencies as governed.

### Users & Access

Application/security record:

- linked Employee;
- EOS access enabled/disabled;
- linked external identities;
- Security Roles;
- explicit overrides;
- current/effective permissions;
- last login;
- sessions and revocation where appropriate;
- audit history.

### Security Roles

Human-readable administration by business resource/action/scope, for example:

**Customers** — View / Create / Edit / Delete; Scope = Company  
**Opportunities** — View / Create / Edit / Delete; Scope = Owned + Assigned  
**Financials** — No access  
**Reporting** — View; Scope = Company  
**Workflow** — Create Quote / Approve Discount / Transfer Ownership / Export Data

Administrators should not need to understand database IDs or internal capability implementation names to administer ordinary access.

### Effective Access Simulator

A read-only explanation tool must answer:

- what the Principal may do;
- what is denied;
- which Security Role/override contributed;
- which scope applied;
- which fields are allowed/denied;
- which workflow capability is missing;
- whether Owner/Accountable/Assignee relationship affected scope;
- whether a tenant/company boundary caused refusal.

## Firebase exit

**Target state: zero Firebase dependency.**

Do not add new Firebase dependencies.

After replacement is proven, remove:

- Firebase Auth runtime dependency;
- Firebase SDK auth initialization;
- Firebase Admin authentication dependencies used for EOS identity/session authority;
- Firestore business read/write paths superseded by PostgreSQL/Render;
- Firebase Functions/callables superseded by EOS API commands;
- Firebase Rules as application/business authorization;
- compatibility role/permission logic that exists only to bridge Firebase-era behavior;
- obsolete environment configuration, emulator setup and deployment/runbooks whose only purpose is the retired architecture.

Migration preserves **facts**, not accidental architecture.

Preserve where valid:

- Employees;
- external identity identifiers needed for safe rebinding;
- business records;
- ownership/accountability/assignment facts;
- manager/reporting relationships;
- accepted business decisions and state machines;
- audit/evidence retention required for history;
- approved role/access intentions after they are re-expressed and verified under v2.

Do not copy a legacy permission rule merely because it exists.

## Multi-client application requirement

Authorization v2 is not a web-only design.

All current/future clients use the same platform boundary:

`Web / PWA / Desktop / iOS / Android -> EOS API / Render -> PostgreSQL`

The app never becomes the authorization authority.

This supports later differentiated experiences—technician, warehouse/scanning, sales, management, administration—without creating separate security systems.

## Delivery plan

### A — Census + freeze

- Inventory every current authentication, Principal, Employee, Role, capability, scope, ownership/accountability/assignment and session source.
- Freeze creation of new parallel authorization/Firebase mechanisms.
- Classify each current mechanism: retain as business fact, migrate, supersede, or delete after cutover.

### B — PostgreSQL v2 schema

- identity bindings;
- Principals/memberships;
- Security Roles;
- permissions;
- role assignments;
- permission assignments;
- overrides;
- sessions/revocation;
- audit.

### C — Identity gateway

- Microsoft/Google OIDC;
- safe existing-user rebinding;
- EOS session issuance/refresh/logout/revocation;
- no Firebase requirement.

### D — Authorization evaluator

- one effective-access service;
- resource/action/scope/field/workflow evaluation;
- tenant/operating-company boundaries;
- responsibility-aware scopes where explicitly configured;
- deny by default.

### E — Administration

- Employees;
- Users & Access;
- Security Roles;
- overrides;
- sessions;
- effective-access simulator;
- audit.

### F — Domain cutover census

For every route/API/object/action/field/export/report/upload/workflow:

- map required authority;
- make UI consume effective-access result;
- make Render independently enforce;
- remove domain-specific/compatibility interpretation;
- test denial directly at command/API level.

### G — Persona acceptance

Maintain a deterministic acceptance world including at least:

- Administrator;
- Retail Sales;
- National Accounts Sales;
- Service Manager/Dispatcher;
- Service Technician;
- Parts/Warehouse;
- Accounting/Controller.

For each persona, define expected navigation, objects, record populations, fields and actions before testing. The running application must match the declared matrix.

### H — Firebase removal

- migrate last required records/commands;
- prove no normal runtime business read/write/auth/session depends on Firebase;
- remove SDK/config/functions/rules/deployment residue;
- keep only historical migration evidence where retention is useful.

### I — Training + closure

Training is the final signoff artifact:

- Administrator: Employees, Users, roles, permissions, access troubleshooting, session revocation, audit.
- End users: what access means, request/escalation process, denied/read-only states.

## Effort planning range

Working planning estimate from the current platform state:

- functional Authorization v2 replacement: roughly **10–15 concentrated engineering days**;
- enterprise-hardened convergence including domain census, negative tests, migration/cutover proof and administration: roughly **20–30 engineering days total**;
- expected calendar shape when treated as a focused foundation program: approximately **3–5 weeks**, with usable cuts delivered before final cleanup.

The largest variable is not the evaluator itself. The largest variable is proving that every EOS page, endpoint, action, workflow, report, export and sensitive field uses it and that no parallel legacy authority remains.

## Completion criteria

This workstream is complete only when:

1. non-Firebase authentication works for accepted personas;
2. EOS owns sessions/revocation;
3. Employee, Principal and external identity are distinct and linked explicitly;
4. Job Role and Security Role are distinct;
5. one v2 evaluator is authoritative;
6. every domain maps to v2 permissions and protected commands enforce server-side;
7. Owner/Accountable/Assignee/Approver remain separate business facts;
8. Admin can manage ordinary access without source-code changes;
9. the effective-access simulator explains allows/denials;
10. negative tests prove unauthorized direct API calls fail;
11. web/PWA/mobile client architecture requires no authorization redesign;
12. normal runtime has zero Firebase dependency;
13. legacy authorization/Firebase paths are removed rather than merely unused;
14. migration/audit evidence is retained;
15. administrator/end-user training is complete and Owner acceptance is recorded.
