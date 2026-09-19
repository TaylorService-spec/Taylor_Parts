# Current EOS Roadmap

**Current as of 2026-09-16:** [`2026-09-16-full-platform-roadmap-reconciliation.md`](2026-09-16-full-platform-roadmap-reconciliation.md)

That reconciliation is the current program-level authority for:

- where EOS is now;
- business-object completion and remaining work;
- end-to-end business-process completion and remaining work;
- PostgreSQL migration/cutover state;
- Firebase retirement;
- Authorization v2 / identity / roles / permissions;
- Administration and application-platform direction;
- current open-PR disposition;
- sequenced remaining program work.

The dedicated foundation workstream is [`2026-09-16-authorization-v2-application-platform-reset.md`](2026-09-16-authorization-v2-application-platform-reset.md).

## Current execution state — controller refresh against `main @ 2e17a7a2`

This section is the concise live status view. It is updated by small roadmap PRs when a gate changes; it is not a tracking subsystem.

### Controlling delivery order

```text
CRM → Catalog / Supplier / Registry → Commercial → Employee / Workforce tails
    → Work Orders / Service / operational tails → Authorization v2 + EOS session final cutover
    → Firebase Auth retirement → zero-Firebase runtime/repository proof → Administration convergence
    → final North Star / persona / browser acceptance → PWA packaging
    → production cutover planning/authorization (separate Owner gate) → training LAST
```

Where the static Wave ordering in the reconciliation (§12) differs, **this order controls**. Safe Authorization v2 and Employee foundation work may proceed in parallel only when it does not conflict with the active migration lane. Neither Authorization v2 nor Firebase exit reopens accepted business semantics (see the parity fence below).

### Lane state

| Lane | Current authority | Last completed gate | Next gate | Blocker |
|---|---|---|---|---|
| **CRM** (#1925) — Accounts / Contacts / Locations | Firestore (writer state `FROZEN / INACTIVE`); PostgreSQL authority built, **inactive** | #1929 write-grant retirement merged. Behind the activation gate (inert until `ACTIVATE_POSTGRES`): **#1932** Render transport `/crm/customer`; **#1936** governed Account ownership history (`INITIAL_OWNER_ASSIGNMENT` / `OWNER_HANDOFF`, never ownerless) + atomic ≤200-row Contact import; **#1939** expected-current-owner precondition. #1934 reconciled suites left red by #1926/#1929. **CRM-8** client cutover built and held locally (build-time routed: `platform-sandbox` → EOS API, production unchanged) | Operator: deploy #1929 Rules to `eos-platform-sandbox` (explicit `--project`) → verify live → quiescence → export/census → blockers → COPY ONCE → verify → activate → open/merge CRM-8 → nonprod deploy → browser E2E → retire Firestore CRM → CRM COMPLETE → Catalog | **External operator credentials:** Firebase login + nonprod ADC (Rules deploy, snapshot export), Render Shell / nonprod `DATABASE_URL` (census/copy/verify). Ownerless legacy Accounts are advisory (post-cutover remediation set), not COPY blockers. |
| **Employee / Workforce** (#1930) | **PostgreSQL** for Employee profile, manager, lifecycle, Job Role, change history, Work Eligibility and Operational Scope | **#1933**/**#1935**/**#1937** W1A-W1C profile + manager (combined Save is one transaction; client Firestore profile writer retired); **#1938** EMP-RT-W2 lifecycle; **#1941**/**#1942** EMP-RT-08 Job Role authority + Administration UI (tenant catalog, one current role + history, assignments start empty); **#1943** governed change history; **#1944** Workforce PG capability gating; **#1946** Work Eligibility authority (decomposition step A); **#1947** Operational Scope authority (step B) | In flight: **#1948** step C governed Administration commands/reads for both authorities; **#1949** steps D/E legacy evidence census + dry-run plan (stacked on #1948). Then F/G live command and assignable-Employee cutover, H display/persona, I-L legacy removal | Operator (nonprod): `tenantOperatingCompanyReconcileCli.js --tenantKey taylor-nonprod` dry run then `--apply`; Job Role catalog seed; Workforce capability reconciliation. Operating-company changes fail closed in nonprod until the reconcile run. |
| **Catalog / Supplier / Registry** | Firestore `OPEN / INACTIVE`; PG writers / copy-once / verify merged | tooling merged | starts after CRM COMPLETE (freezing earlier would halt nonprod Parts editing under the parity fence) | CRM |
| **Commercial** (C5) | Firestore-era Opportunity/Agreement/Order; C5 tooling merged **NOT RUN** | tooling merged | after Catalog | CRM + Catalog |
| **Work Orders / Service** | Firestore / Firebase Functions | #1915 assignment census (design input) | PG Work Order + assignment authority | — |
| **Authorization v2 / session** | Principal/Membership/policy in PG; Firebase Auth proves identity | **#1945** read-only Security Role assignment census (scoped and conditioned assignments flagged `MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY`) | In flight: **#1950** live ConditionKind inventory and dispositions. Then a PostgreSQL evaluator for `isOwnAssignment` and assignment-scope consumption, before any assignment migrates | The PG evaluator ignores assignment scope and evaluates no Condition, so migrating a scoped or conditioned grant would widen it. |
| **Zero-Firebase closure** | — | — | after domain + identity cutovers | — |
| **Training** | — | — | **last**, after production cutover and Owner signoff | — |

### Six-state accounting

These six states are independent and are never equated. A domain may be BUILT and have MIGRATION TOOLING READY while
no data has moved, and code merged is never reported as data cut over.

| Area | BUILT | MIGRATION TOOLING READY | RECONCILED | CUT OVER / ACTIVE | LEGACY RETIRED | ACCEPTED |
|---|---|---|---|---|---|---|
| CRM | yes | yes | no | no | no | no |
| Catalog / Supplier / Registry | yes | yes | no | no | no | no |
| Commercial / Sales | yes | yes (C5, not run) | no | no | no | no |
| Workforce — profile / manager / lifecycle | yes | yes | partial (nonprod operator runs outstanding) | **yes** | partial (server Firestore profile callable remains) | no |
| Workforce — Job Role | yes | seed tooling merged, not run | no | **yes** | n/a (no legacy Job Role authority existed) | no |
| Workforce — Work Eligibility / Operational Scope | authorities yes; commands in #1948 | #1949 (evidence + dry-run only) | no | no | no | no |
| Security Role / Authorization v2 | partial | census merged (#1945) | no | no | no | no |
| Work Orders / Service | no | no | no | no | no | no |
| Firebase Exit / identity | no | no | no | no | no | no |
| Administration convergence | partial | n/a | no | no | no | no |
| PWA / packaging | no | n/a | n/a | no | n/a | no |
| Production cutover | no | n/a | n/a | no | n/a | no |
| Training | no | n/a | n/a | no | n/a | **last** |

**Production Firebase fence (Owner ruling):** do **not** deploy `firestore.rules` from `main` to the production Firebase project — #1929 denies Account/Contact/Location client writes for the **nonprod** cutover only. No production Rules deploy until the production CRM cutover reaches that gate, and no new production Rules business logic. Firebase Functions deploys are manual; the CRM writer-state constant is global, so a manual production Functions deploy from `main` would also freeze production customer import.

Environment fences: Production and Certification untouched; no dual write; no Firebase fallback; `.firebaserc` default project is never relied upon.

## Execution strategy — owner-approved hybrid migration

The platform reset is executed through [`2026-09-16-parallel-v2-sandbox-cutover-strategy.md`](2026-09-16-parallel-v2-sandbox-cutover-strategy.md).

**Current EOS remains running and authoritative while the new identity/session/authorization/PostgreSQL/Render control plane is built beside it.** The default is to reuse the current application code and accepted business behavior rather than maintain a second independent EOS product.

Bounded modules may be routed to independently addressable v2 APIs in nonproduction after their replacement authority is proven. A full cloned v2 UI/application is permitted only when shared-code isolation cannot reliably prove parity; if used, it is temporary migration scaffolding with an explicit convergence/removal gate.

No domain moves merely because v2 code exists. Each bounded authority must pass current-state census, isolated replacement, shared-code compatibility where applicable, deterministic parity, connected scenarios, data reconciliation, one-writer cutover, running-application acceptance, and rollback/soak gates before the old path can be retired.

Broad dual-write is not the default. One system remains the business writer until a controlled cutover.

## Protected completed-domain guardrail

Parts / Inventory / Warehouse / Bin / Truck / Mobile Location / Purchasing / Receiving / Transfer / Cycle Count and Work-Order inventory-effect convergence is additionally governed by [`2026-09-16-parts-inventory-truck-parity-fence.md`](2026-09-16-parts-inventory-truck-parity-fence.md).

That fence is mandatory for Authorization v2, PostgreSQL, Render, zero-Firebase, migration, mobile/PWA, and Administration work that touches those domains. The platform reset is a **semantics-preserving migration by default**, not authorization to redesign already-completed business behavior. Any material business-behavior change requires separate explicit review/Owner authorization.

Parts/Inventory/Truck is a protected mature operating family and is **not the proving ground for v2**. It should be cut over only after the new platform pattern has already been proven on lower-coupling domains.

Older dated roadmaps/reconciliations remain historical evidence. They must not override this current pointer when they describe an earlier architecture or implementation state.

## Maintenance rule

When a merge changes a major object's canonical authority, database/source of truth, runtime read/write path, migration/cutover status, or a business process's material maturity, update the current reconciliation (or replace it with a newer dated reconciliation and update this pointer).

Do not report:

- code merged as data cut over;
- migration tooling as migration executed;
- a UI as a completed business process when its governed backend action is unavailable;
- a legacy path as retired until it is actually unreachable/removed;
- a technical cutover as permission to redesign protected Parts/Inventory/Truck business semantics;
- EOS v2 existence as permission to alter current EOS before parity and cutover gates pass;
- a full duplicate application as the default v2 strategy when shared application code can be safely reused.
