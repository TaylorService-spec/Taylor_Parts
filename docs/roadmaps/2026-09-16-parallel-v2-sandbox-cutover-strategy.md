# EOS v2 Parallel Control Plane + Controlled Cutover Strategy

**Recorded:** 2026-09-16  
**Status:** OWNER-APPROVED EXECUTION STRATEGY  
**Parent:** `2026-09-16-full-platform-roadmap-reconciliation.md`  
**Applies to:** Authorization v2, zero-Firebase convergence, PostgreSQL/Render migration, application-platform evolution.

## Decision

EOS v2 will be built **beside** the current working EOS, but the default is **not** to create and maintain a second independent EOS product.

The approved strategy is:

> **PARALLEL BACKEND / CONTROL-PLANE REBUILD + SHARED APPLICATION CODE + BOUNDED DOMAIN CUTOVERS.**

Current EOS remains authoritative while the new identity, session, authorization, PostgreSQL and Render control plane is built and proven in an isolated nonproduction environment.

Where the current UI or business-process implementation is already correct, reuse the same application code and behavior. Redirect bounded modules to the new v2 APIs only after their replacement authority is proven. Do not fork the entire React/application surface merely because the backend is changing.

A fully duplicated v2 UI/application remains an available **fallback isolation technique** only when shared-code routing cannot provide a reliable test boundary for a particular domain. It is not the default architecture.

This is a **parallel replacement / strangler migration**, not an in-place rewrite and not a permanent two-product strategy.

The destination remains one EOS platform with zero Firebase dependency.

---

## 1. Governing rule

> **BUILD THE NEW CONTROL PLANE BESIDE CURRENT EOS. REUSE WORKING APPLICATION BEHAVIOR. CUT OVER ONE BOUNDED AUTHORITY AT A TIME.**

A technical migration does not reopen an accepted business process.

Until a domain is explicitly cut over:

- current EOS remains the business authority;
- the current accepted workflow remains available;
- shared frontend/business code may be exercised against either current or v2 backend seams in controlled nonproduction routing;
- EOS v2 may use synthetic fixtures, governed snapshots or migration exports for parity proof;
- EOS v2 may not become an undeclared second live writer;
- no destructive schema/data change is permitted merely to simplify v2;
- no domain is considered retired because equivalent v2 code exists.

After a domain is cut over, the old path remains only for the bounded rollback/soak period, then is retired after acceptance.

---

## 2. What is parallel and what is shared

### Built in parallel

These foundations should have their own isolated nonproduction v2 implementation:

- External Identity binding;
- EOS Principal/session authority;
- Security Roles and Permissions;
- Authorization v2 evaluator;
- access/admin APIs;
- PostgreSQL control-plane schema;
- Render API/service boundary;
- migration and parity diagnostics;
- explicit domain API replacements as they are developed.

### Shared by default

Reuse current code/behavior where it is already accepted:

- application shell and navigation primitives;
- North Star visual system;
- mature domain screens;
- validated workflow state machines and pure domain logic;
- existing business validators/contracts where architecture permits;
- established test scenarios and fixtures;
- Parts / Inventory / Truck workflow behavior;
- other mature current-domain behavior that does not itself depend on the legacy data-access implementation.

Shared application code does **not** mean shared business authority. The backend/data source selected for a given environment/domain must remain explicit and fenced.

### Duplicated only when necessary

A complete copied UI/module/application is allowed when needed to prove isolation or parity, but it must be treated as temporary migration scaffolding with a convergence/removal plan.

Do not maintain two long-lived independent implementations of the same feature unless a separately approved product requirement demands it.

---

## 3. V2 nonproduction boundary

The v2 foundation should have an isolated environment including:

- separate Render nonproduction service(s) or independently addressable v2 routes;
- separate PostgreSQL database/schema/environment boundary;
- separate external-identity callback/application configuration where needed;
- separate secrets/environment configuration;
- independently addressable Vercel preview/sandbox routing where required to exercise v2;
- separate migration/cutover evidence;
- no production credentials or production write authority.

The environment does **not** require a permanent duplicate application deployment for every development change. A shared application build may point bounded modules to v2 endpoints in the dedicated test environment when that gives a cleaner and lower-drift proof.

Exact infrastructure identifiers are implementation details and remain subject to normal environment governance.

---

## 4. Test data and snapshots

The v2 environment may use:

- connected synthetic Sample Company data;
- sanitized nonproduction fixtures;
- governed snapshots/exports from the current sandbox;
- deterministic migration exports produced by cutover tooling.

The preferred order is synthetic/fixture data first, then snapshots where realistic legacy shape is necessary.

Copied data must preserve any facts needed to prove parity, including:

- stable business identifiers;
- relationships;
- lifecycle states;
- ownership/accountability/assignment;
- inventory quantities and movement history;
- serialized custody;
- operating-company facts;
- audit/provenance.

Copied data is migration/test evidence. It must never create a write-back path into current EOS.

---

## 5. No broad dual-write strategy

**Default: never have a user action independently mutate both legacy and v2 authorities.**

Do not normalize a migration design such as:

`Receive Stock -> write Firestore + write PostgreSQL`

as an extended operating mode.

That creates two competing truths.

Preferred proof methods are:

1. shared pure-contract tests;
2. same-input/same-result evaluation;
3. replay against synthetic/copied state;
4. shadow reads/calculations;
5. deterministic snapshot/reconciliation;
6. bounded single-authority cutover;
7. soak + rollback;
8. legacy retirement.

If change capture is required during a migration window, one system remains the sole writer and the other receives migration/change evidence rather than independent business authority.

---

## 6. Cutover unit

Cutovers happen by **bounded business authority**, not by infrastructure product.

Examples:

- EOS identity/session;
- Employee directory/profile read authority;
- Customer/Account authority;
- Part descriptive/catalog authority;
- Truck/Mobile registry;
- Work Order assignment;
- Work Order lifecycle;
- Inventory ledger/movement authority;
- Cycle Count authority.

“Move Firebase to PostgreSQL” is not a valid cutover unit because it can hide multiple unrelated business changes.

Each cutover unit must identify:

- current source of truth;
- v2 source of truth;
- current read path;
- current write/command path;
- current authorization authority;
- v2 read/write/auth paths;
- shared application components involved;
- any temporary adapter/routing seam;
- data to migrate;
- parity invariants;
- deliberate behavior changes, if separately approved;
- rollback boundary;
- legacy code to remove after soak.

---

## 7. Mandatory cutover gates

### Gate 0 — current-state census/freeze

Record exact current behavior and authority. Accepted current behavior is the parity oracle unless the Owner separately authorizes a business change.

### Gate 1 — isolated replacement

The target schema/service/command works against the v2 nonproduction control plane without changing current EOS authority.

### Gate 2 — shared-code compatibility

Where a current application component is being retained, prove that it can consume the new API/contract without embedding a second business interpretation or breaking current behavior.

### Gate 3 — deterministic parity

Same actor + same facts + same requested action produces the same allowed/denied result, transition, quantities, ownership/accountability effects and audit outcome except for explicitly approved differences.

### Gate 4 — connected scenario proof

Run realistic happy path, failure, retry, concurrency and unauthorized scenarios.

### Gate 5 — migration reconciliation

Prove record counts, identifiers, relationships, balances, lifecycle state, ownership/accountability/assignment and domain-specific invariants.

### Gate 6 — one writer

At cutover, there is exactly one authoritative writer for each business fact. Legacy write authority is fenced before or atomically with enabling the replacement.

### Gate 7 — real application acceptance

Exercise the actual shared/v2-routed application with the real persona matrix, not only repository tests.

### Gate 8 — bounded rollback/soak

Operate the new path with observability and a defined rollback procedure that does not require reconstructing lost facts.

### Gate 9 — retirement

Only after acceptance and soak may legacy Firebase paths, compatibility code, temporary adapters, duplicated migration UI, or obsolete deployment machinery be removed.

---

## 8. Migration sequence

### Lane A — v2 control plane

Build beside current EOS:

- Authorization v2 schema/evaluator;
- EOS sessions and external OIDC;
- Administration v2;
- API client boundary;
- v2 Render/PostgreSQL nonproduction environment;
- parity and migration diagnostics.

No operational-domain cutover is required to complete Lane A.

### Lane B — prove the pattern on lower-coupling authorities

Use already advanced PostgreSQL work to prove the migration method before touching the most mature operational domains.

Candidate families include:

- Workforce reads;
- Principal/Employee/User-access administration;
- selected CRM authorities;
- selected descriptive catalog authorities.

The purpose is not speed alone. It is to prove identity, session, authorization, API, shared-frontend routing, migration reconciliation and rollback on bounded domains first.

### Lane C — broader commercial/service authorities

Move bounded authorities only after the control plane and shared-app pattern are proven.

### Lane D — protected Parts / Inventory / Truck family

Parts, Inventory, Warehouse, Bin, Truck/Mobile Location, Reorder, Purchasing, Receiving, Transfer, Cycle Count and Work Order inventory effects are a **protected mature operating family**.

They are not the proving ground for v2.

Before any runtime cutover, both this strategy and `2026-09-16-parts-inventory-truck-parity-fence.md` apply.

Existing PostgreSQL target tables do not themselves authorize import or routing.

### Lane E — Firebase retirement

Firebase Auth/Firestore/Functions/runtime residue is removed only after every dependent bounded authority has been cut over and accepted.

---

## 9. Parts / Inventory / Truck preservation

The shared application and v2 backend must reproduce, not reinterpret, current accepted semantics for at least:

- Part identity and alias resolution;
- supplier-item relationships and commercial-term meaning;
- append-only inventory movement history;
- the one movement-sign/on-hand authority;
- exact-location sufficiency;
- Warehouse/Bin custody semantics;
- relocation vs Transfer distinction;
- Truck vs MOBILE Location distinction;
- authored operating-company authority;
- reservation/release/consumption semantics;
- Work Order inventory effects and idempotency/replay protection;
- reorder lifecycle and 1:1 reorder Purchase Order behavior;
- receiving source/progress semantics;
- Cycle Count blind-count/variance/reconciliation/separation-of-duties semantics;
- scanner identifier/location behavior;
- historical custody and audit evidence.

A different v2 answer is a parity failure unless a separately approved business-behavior decision explains it.

---

## 10. Practical isolation rules

- dedicated v2 branches/worktrees where useful;
- additive schemas/migrations until cutover;
- independently addressable v2 services/routes;
- explicit environment/domain routing, never hidden automatic fallback;
- plan/dry-run default for migrations;
- strict environment fences;
- no production credentials in v2 nonprod;
- no current-EOS mutation by parity tests;
- runtime routing changes are separately authorized from building/testing;
- temporary duplicated UI must declare its convergence/removal gate;
- rollback remains until retirement.

---

## 11. When a full cloned application is justified

A full duplicated v2 UI/application may be used for a bounded period if one or more of these are true:

1. shared routing cannot reliably isolate legacy and v2 backend behavior;
2. the legacy client data-access code is too intertwined to test the replacement safely;
3. application-level session/auth changes cannot coexist cleanly during the transition;
4. a domain requires destructive UI changes that would otherwise destabilize current EOS;
5. parity testing requires two independently runnable full experiences.

If used, the clone must have:

- a specific reason;
- a bounded scope/time horizon;
- an explicit synchronization policy;
- a convergence/removal gate.

“Feels safer” alone is not enough reason to maintain two products.

---

## 12. Definition of success

This strategy succeeds when:

1. current EOS remained usable while v2 foundations were built;
2. working application behavior was reused instead of unnecessarily rewritten;
3. the new control plane was independently proven;
4. every cutover had explicit parity and reconciliation evidence;
5. mature domains were not accidentally redesigned during infrastructure work;
6. exactly one writer existed for each authoritative fact;
7. cutovers were reversible during soak;
8. temporary duplicate code/environments were removed after convergence;
9. Firebase dependencies disappeared only after replacements were proven;
10. the final state is one EOS application platform, not two drifting products.
