# EOS policy — NON-PRODUCTION ACTIVATION

**Status: MERGED TO `main`. NOT DEPLOYED.**
No Render service exists. No Vercel environment is configured. Production, Certification and every
Firebase project are untouched. Nothing routes business execution through the workflow engine.

Merged code is not running code. What follows describes what is now on `main` and what an
environment would need before any of it does anything.

| | |
|---|---|
| policy foundation (#1822) | squash `51819f4763602220cb8feaa311acde3b46a4cbb5` |
| non-production activation (#1823) | squash `d84389f4570c8f55ef376024f60de44ede01e1f7` |
| #1823 pre-merge head | `1aed2823105b54a516f666dfe0aa09e1e84be5f3` — reconciled onto the #1822 squash by rebasing its four activation commits |
| `main` after both | `d84389f4570c8f55ef376024f60de44ede01e1f7` |

On `main`: migrations 001 (policy), 002 (tenant/identity) and 003 (assignment integrity); the
PostgreSQL `PolicyRepository`; tenant bootstrap and the one-time administrator bootstrap;
EOS-native principals and tenant memberships; the composite membership foreign key and the
one-active-assignment index; the trusted Admin API and its HTTP transport; and the Objects,
Roles & Permissions, Users and Workflows write surfaces.

**Still nothing is deployed.** No environment holds a policy database, the Render and Vercel
resources in §5 do not exist, and the five workflow machines remain DRAFTS measured from the code
that runs today.

This document is the companion to `eos-admin-policy-workflow-reconciliation.md`. That one records
what the policy MODEL is and how the decisions behind it were ruled. This one records what became
OPERATIONAL, what stayed inert, and what is deliberately out of scope.

---

## 1. What existed before this tranche

PR #1822 built a correct policy model that nothing could use:

| | |
|---|---|
| schema | 16 tables, migrated by `node-pg-migrate` |
| adapters | in-memory reference + PostgreSQL, behind one `PolicyRepository` port |
| resolver | object/field CRED with the doorway invariant, additive multi-role union |
| commands | governed mutations, each authority-checked, transactional, audited |
| seed | 37 objects · 394 fields · the governed Roles · 5 workflow machines, idempotent |
| Admin UI | four screens rendering the MEASURED model, read-only |

And the gap, stated plainly: **nothing created a tenant.** The tests inserted one with raw SQL.
There was no principal, no membership, no administrator, and no request path — the commands existed
and nothing could call them.

## 2. What becomes operational in this tranche

### 2.1 Tenant and identity — migration 002

`functions/migrations/1757548800000_tenant-and-identity.sql` adds three tables and four columns.

**Tenant lifecycle.** `tenants` gains `key` (unique), `status`, `configuration_version`,
`updated_at`. A bootstrap must be idempotent and idempotence needs a natural key to resolve on: `id`
is opaque and generated, `name` is a display string somebody will edit.

**`principals` — provider-neutral by construction.** `principals.id` is the EOS-native identifier;
`(identity_provider, external_subject)` is the MAPPING to whatever proved the identity. Firebase
proves who somebody is today and the platform's direction replaces that provider. Had the
authorization model's identity been the Firebase UID, replacing the provider would mean rewriting
every assignment, every access-version row and every audit event — which is how a "temporary"
provider becomes permanent.

**`tenant_memberships` — which tenant, and it is not a request parameter.** A client MAY state a
tenant; the server checks that statement against these rows and never adopts it.

**`tenant_admin_bootstraps` — the first administrator, once.** The tenant is the PRIMARY KEY, so a
second bootstrap is refused by the database rather than by a check a caller could race.

**That omission is CLOSED — migration 003 (Owner ruling B).** Migration 002 left
`user_role_assignments` with no foreign key onto the identity model and enforced membership only at
the API. The Owner ruled that is not the permanent design, and it is not: an API check protects the
path that goes through the API, and a migration, a repair script, a future service or a mistake at a
psql prompt does not.

The constraint is the COMPOSITE one, not the simpler `REFERENCES principals(id)`:

```
user_role_assignments (tenant_id, principal_id)
    REFERENCES tenant_memberships (tenant_id, principal_id)
```

A key onto `principals` alone proves the principal EXISTS. It does not stop tenant A granting a Role
to somebody who belongs only to tenant B — which is a cross-tenant authority leak rather than a
dangling row. `principal_access_versions.principal_id` also gains a key onto `principals`.

**Both layers stay.** The database has no opinion about membership `status`; the API refuses a
membership that is not ACTIVE. Different questions, and the API cannot defend a path that does not
call it.

The column is renamed `principal_uid` → `principal_id` in both tables. It has held an EOS principal
id since migration 002, and a column named after a system the platform is leaving is a comment that
will be believed.

**Ruling C — one active row per effective assignment.** A partial unique index on
`(tenant_id, principal_id, role_id, scope_type, COALESCE(scope_value, ''))` `WHERE status = 'active'`.
Multi-role union stays additive: a different Role, or the same Role at a different governed scope,
is still a separate assignment. What is refused is a SECOND ACTIVE row saying exactly the same
thing — it confers no more authority and leaves an administrator with two things to revoke before
the first stops applying. `COALESCE` because NULL is not distinct from NULL in a unique index, so
without it the commonest case — two global assignments — would slip through.

`assignRole` is correspondingly IDEMPOTENT: an identical active assignment returns the existing
canonical row, creates nothing, bumps no access version and writes no audit event, because nothing
changed. A revoked assignment does not block a re-grant — the index is partial on `active` — and
that re-grant is a real change with its own row and its own event. The Users panel stops offering a
Role already held at that scope, so the screen does not suggest a no-op.

### 2.2 Database runtime

`policyDatabase.ts` gains a server-enforced `statement_timeout` (and its client-side twin),
`checkPolicyDatabaseHealth`, `requirePolicyDatabaseReady` and `redactConnectionString`.

REACHABLE AND MIGRATED ARE DIFFERENT ANSWERS. Conflating them is how a service starts, reports
healthy, and then fails every request with "relation does not exist". Readiness is bounded — a
managed database can take seconds to accept connections, and crashing on the first attempt turns a
cold start into a restart loop; waiting for ever looks identical to working.

Still one pool per process, still standard PostgreSQL, still no Render-specific API.

### 2.3 Server-side identity resolution

`principalContext.ts` is the single answer to *who is this, in which tenant, holding what*. It reads
only the policy database. Not a Firebase custom claim, not `users/{uid}.role`, not
`employees.securityRole`, not a compatibility Role string, not a request body.

Tenant resolution has four outcomes and no fifth:

| the caller | the answer |
|---|---|
| states a tenant they belong to | that tenant |
| states one they do not | **REFUSED** — never narrowed back to their own |
| states none, belongs to one | that tenant |
| states none, belongs to several | **REFUSED as ambiguous** |

Falling back would make a spoofed id indistinguishable from a correct one in every log and every
response. Guessing is how one tenant's administrator edits another tenant's policy.

### 2.4 Tenant bootstrap and the first administrator

`tenantBootstrap.ts`, and it is deliberately TWO operations rather than one convenient one, because
they are separately dangerous:

- `bootstrapTenant` — creates the tenant and applies the seed. Ordinary provisioning. Idempotent:
  rerunning changes nothing. That means *a second run creates nothing*, NOT *the tenant is reset* —
  a bootstrap that reset policy on every deploy would silently undo configuration.
- `bootstrapAdministrator` — gives ONE principal the Admin Role, ONCE.

A new tenant has no administrator, and Roles can only be granted by one. Something has to break that
circle; the danger is that the thing which breaks it remains available afterwards as a permanent way
to mint authority. Every property closes it again: explicitly invoked, tenant-bound,
principal-bound, one-time (enforced by a primary key), non-overwriting, audited, and reachable only
from an operator-run script — it appears in no API operation list.

**Recovery, which is a different thing.** If a tenant loses every administrator, this function does
not help: it refuses once a bootstrap is recorded. Recovery is deliberately manual — an operator
with database access inspects `tenant_admin_bootstraps` and `user_role_assignments` and decides. A
recovery path that runs itself is the backdoor the bootstrap avoids being. The engine-level
protection against reaching that state is `revokeRole`'s refusal to remove the last active
administering assignment.

### 2.5 The trusted Admin API

`adminPolicyApi.ts` — a CLOSED list of **9 reads** and **14 mutations**.

There is no `runSQL`, no `mutatePolicy(table, id, patch)`, no generic patch. Each would be a single
endpoint that can express every possible policy change, making authorization a property of the
ARGUMENTS — and a check that has to parse its own arguments to know what it permits eventually gets
it wrong.

Reads: `listTenantPrincipals` · `listObjects` · `readObjectWithFields` · `listRoles` ·
`readRolePolicy` · `listPrincipalRoleAssignments` · `listWorkflows` · `readWorkflowVersion` ·
`readPolicyAuditHistory`.

`listTenantPrincipals` is **one read beyond the Owner's named list**, and the reason is that the list
could not be used without it: `listPrincipalRoleAssignments` takes a principal id and nothing else
returns one. It returns identity and never authority.

Mutations: `createCustomField` · `updateCustomFieldMetadata` · `createRole` · `updateRole` ·
`setObjectPermission` · `setFieldPermissionOverride` · `removeFieldPermissionOverride` ·
`assignRole` · `revokeRole` · `createWorkflowDraft` · `createWorkflowVersion` ·
`updateWorkflowDefinition` · `setWorkflowRoleBinding` · `publishWorkflowVersion`.

Authority is enforced in the COMMANDS, next to the transaction — not in the dispatcher instead — so
a future caller that bypasses the dispatcher is still refused.

| what | who |
|---|---|
| Objects, Fields, Role definitions, permissions, Workflow definitions | **Admin only** |
| Role assignment | **Owner, General Manager or Admin** |

### 2.6 Transport, and where Firebase lives

`adminPolicyHttp.ts` is a `node:http` handler with three routes: `GET /health`,
`POST /admin/policy`, `OPTIONS`. Reads are POSTs too — a GET with a query string invites caching, a
browser history entry and a proxy log for something that must have none.

Token verification is INJECTED. `src/eosApi/server.ts` holds the only concrete verifier and lives
OUTSIDE `src/adminPolicy` so the policy subsystem's static no-Firestore guard stays absolute rather
than acquiring its first allowlist entry. Firebase is asked exactly one question — *does this token
belong to subject X* — and its answer to anything else would not be believed.

The service **refuses to start when `EOS_ENVIRONMENT` names production**, and refuses a `*` browser
origin.

### 2.7 The Administration screens

The four screens still render the MEASURED model. The new panels
(`PolicyStorePanels.jsx`) render the tenant's STORED configuration alongside it, and they are
separate on purpose: merging them would make it impossible to tell "this is what the code does" from
"this is what your tenant has configured".

**Every mutation is followed by a re-read.** No optimistic update anywhere. The browser is not the
source of truth and its grid state is not authority; a UI that reported success for a change the
server refused would send an administrator away believing access was granted, or revoked.

**NOT CONFIGURED is said out loud.** No EOS API is deployed, so every panel renders that state
rather than an empty table — an empty table reads as "your tenant has no Roles", which is a lie about
the tenant rather than a statement about the connection.

## 3. What is still inert

- **No business execution is routed through the workflow engine.** The five machines are DRAFTS
  measured from the code that runs today. Publishing one changes no record's path.
- **No business data is migrated.** Reorder requests, purchase orders, work orders, sales,
  inventory, customers, equipment and financials all still live where they lived.
- **`readGovernedList` and `COMPATIBILITY_ROLES` remain transitional**, to be retired domain by
  domain. Nothing was widened (D-4).
- **The Firestore parity harness** is still read-only, still unreferenced by running code, and still
  deleted at cutover.
- **No environment holds a policy database.** The proofs run against a throwaway local cluster and
  a CI service container.

## 4. What is out of scope, deliberately

Business-data migration, execution cutover, production deployment, Certification, Firestore Rules,
identity-provider replacement, end-user training. Training is the last item at deployment and
sign-off, and this tranche is neither.

## 5. Environment — what a Render/Vercel deployment would need

**Nothing here has been created.** Recorded so the Owner can decide.

### EOS API (Render Web Service, Node)

| variable | value |
|---|---|
| `DATABASE_URL` | the Render PostgreSQL connection string. TLS is decided by the URL's own `sslmode`. |
| `EOS_ENVIRONMENT` | `nonprod`. The service refuses `production`/`prod`. |
| `PORT` | supplied by Render; `EOS_API_PORT` overrides locally. |
| `EOS_ALLOWED_ORIGINS` | the frontend origin, comma-separated. `*` is refused. |
| `EOS_IDENTITY_PROVIDER` | `firebase` (default). |
| `GOOGLE_APPLICATION_CREDENTIALS` / service-account config | so `firebase-admin` can verify ID tokens. |

Build `npm --prefix functions ci && npm --prefix functions run build`; start
`node functions/scripts/runEosApiLocal.mjs` (or an equivalent entry). Migrations run as a release
step: `npm --prefix functions run migrate:up`.

### Frontend (Vercel)

| variable | value |
|---|---|
| `VITE_EOS_API_BASE_URL` | the EOS API origin. Absent means the panels report NOT CONFIGURED, which is the current state everywhere. |

### Actions that require the Owner

1. Create the Render PostgreSQL instance and supply `DATABASE_URL` to the service. **No credential
   is guessed, none is committed, and no developer's existing database is used.**
2. Create the Render Web Service and set the variables above.
3. Provide service-account credentials for token verification.
4. Set `VITE_EOS_API_BASE_URL` in the Vercel environment.
5. Run the bootstrap, naming the first administrator's subject:
   ```
   node functions/scripts/bootstrapEosTenant.mjs \
     --key taylor-nonprod --name "Taylor Freezer of Arizona" \
     --admin-subject <firebase uid> --performed-by <operator>
   ```

## 6. What was proved, and how

Against a **real PostgreSQL database** (a local unprivileged cluster on port 55432, and a CI
`postgres:16` service container):

| | |
|---|---|
| `npm run test:adminPolicyPostgres` | **78** — schema, migrations up/down, constraints, tenancy, and 38 activation proofs |
| `npm run test:adminPolicy` (offline) | **131** |
| `npm run test:governance` | **667** |
| client `vitest` | **3,282** |
| client registered suites | **285** |

The activation proofs cover bootstrap idempotence, tenant isolation in both directions, a spoofed
tenant refused, one-time administrator bootstrap, the Objects/Roles/Users/Workflows write paths,
published-version immutability, an audit event for every mutation and none for a rollback, and a
RESTART proof that discards every pool and in-process object and finds the state still there.

Migration 003 adds seven more, each going STRAIGHT AT THE STORE as well as through the API, because
a rule that only the API enforces is not the rule the Owner asked for: an assignment to a principal
who does not exist is refused by the database; a principal who is a member of another tenant is
refused both ways; a valid member is assignable and the bootstrap still succeeds; a violation rolls
the whole unit of work back including its audit event; an identical assignment returns the existing
row with no second row, no access-version movement and no audit event; a different Role and the same
Role at a different scope both remain separate; and a revoked assignment does not block a re-grant
while staying in the table as history. That
last one exists because the most likely way for this tranche to be wrong is for the in-memory
adapter to quietly remain the operational source — everything would pass and nothing would persist.

### Browser acceptance

Driven against a live EOS API on `:8791`, a real PostgreSQL database, the Firebase auth emulator on
`:9099` and a dev server on `:5183` (ports chosen to avoid another session's; `firebase.json` was
edited locally and reverted).

| surface | observed |
|---|---|
| Objects | 37 objects from the store; custom field created; **present again after a full page reload** |
| Roles & Permissions | 111 grantable cells, 37 ungoverned dashes; a CRED toggle persisted |
| Users | assignments listed additively; Add Role moved the count; 46 assignable roles |
| Workflows | 5 stored machines, DRAFT status, states/actions and Role bindings |

Every browser action was then confirmed in the database directly: the custom field row, the
assignment rows and one audit event per mutation.

## 7. Defects this tranche found

Recorded because each was invisible to a passing test suite.

1. **The last-administrator guard would have been bypassed.** `policyCommands` derived "every
   principal who could hold a Role" by walking audit events for an `after.principalUid` — true of
   `assignRole`, NOT true of the bootstrap. The initial administrator was therefore invisible to the
   guard, which would have counted zero and allowed the tenant to be left unadministrable.
   Membership is now the answer, unioned with the audit-derived set.
2. **Every token failed to verify.** A dynamic `import("firebase-admin")` lands a CJS module's
   exports under `.default`, so `admin.initializeApp` was `undefined` — surfacing as an
   authentication failure whose message said nothing about the cause. Found by driving a real token
   through the API.
3. **A panel loaded for ever.** A component-lifetime "is this still mounted" ref is set false by an
   unmount cleanup and stays false; React StrictMode mounts, unmounts and remounts every component
   in development, so the second — real — mount discarded its own response. Found only by looking at
   the browser: no error appeared anywhere.
4. **An invented CSS class**, caught by the repository's own class-coverage guard, and **panel copy
   that collided** with the Objects screen's existing read-only notice, caught by an existing test.

## 8. The next business domain — recommendation, not a start

**Parts / Purchasing**, and the reason is that it is the only domain whose state machine is already
measured, formalised and seeded: 9 states, 11 actions, each carrying the capability it is measured
to require, with D-5 having settled which authority owns what.

Its dependencies must be inspected before anything starts. Named, not resolved:

- Receiving is a SECOND source authority over the same records (`purchase_orders` and the legacy
  `reorder_purchase_orders`), and it is deployed and live.
- `recordReorderPurchaseOrder` writes a request transition and a purchase order in one Admin-SDK
  transaction. Whatever routes execution has to preserve that atomicity, not re-implement it.
- The acquisition-cost fact is written inside the receipt transaction and is immutable.
- Two record generations coexist and neither is migrated.
- `firestore.rules` currently denies the retired client-direct paths. Cutover changes who writes,
  which is a Rules question and therefore Tier 2.

The alternative — starting where the workflow is NOT yet measured — would mean measuring and
migrating at the same time, which is how a cutover acquires two unproven halves.
