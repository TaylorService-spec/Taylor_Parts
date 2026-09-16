# EOS v2 Parallel Sandbox + Controlled Cutover Strategy

**Recorded:** 2026-09-16  
**Status:** OWNER-DIRECTED EXECUTION STRATEGY  
**Parent:** `2026-09-16-full-platform-roadmap-reconciliation.md`  
**Applies to:** Authorization v2, zero-Firebase convergence, PostgreSQL/Render migration, application-platform evolution.

## Decision

The current working EOS is **not** to be dismantled or materially altered while the replacement platform is being built.

EOS v2 will be built and proven in a **separate sandbox environment beside the current EOS**. The current application, current accepted business processes, and current operational authorities remain intact until each bounded replacement has passed parity, migration reconciliation, running-application acceptance, and explicit cutover gates.

Where practical, the v2 sandbox may begin from a **controlled duplicate/snapshot of the current sandbox's representative business state and configuration** so that the same real business scenarios can be executed in both environments. The duplicate is a migration/test fixture, not a second production authority.

This is a **parallel replacement / strangler migration**, not an in-place rewrite.

The destination remains one EOS platform with zero Firebase dependency. The side-by-side environment exists only to make the transition safe.

---

## 1. Governing rule

> **CURRENT EOS KEEPS RUNNING. EOS v2 IS BUILT AND PROVEN BESIDE IT.**

A technical migration does not reopen an accepted business process.

Until a domain is explicitly cut over:

- current EOS remains authoritative;
- the current business UI/process remains available and unchanged except for narrowly approved observability or migration seams;
- EOS v2 may read controlled copies, synthetic fixtures, or migration snapshots, but may not become an undeclared second live writer;
- no destructive data/schema migration is permitted merely to simplify v2;
- no current domain is considered retired because an equivalent v2 implementation exists.

After a domain is cut over, the old path is retained only for the bounded rollback/soak period, then retired after acceptance.

---

## 2. Separate v2 sandbox

The v2 program should have its own isolated nonproduction environment consisting of:

- separate Vercel preview/sandbox application surface;
- separate Render nonproduction service(s);
- separate PostgreSQL database/schema/environment boundary;
- separate external-identity callback/application configuration as needed for nonproduction;
- separate secrets and environment configuration;
- separate migration/cutover evidence;
- no production credentials or production write authority.

The exact infrastructure identifiers are implementation details and must be registered through the normal environment-governance process. This document does not require a specific project/service name.

### The v2 sandbox should contain

1. the current UI/business workflow behavior needed for parity testing;
2. Authorization v2 and EOS-owned sessions;
3. PostgreSQL/Render replacements for legacy Firebase authorities;
4. representative connected business data;
5. the same persona/role scenarios used to validate current EOS;
6. parity diagnostics capable of comparing current EOS and v2 results.

The v2 sandbox may duplicate code/components from current EOS where that is the safest way to preserve behavior. Duplication during migration is acceptable; premature refactoring is not a goal.

---

## 3. Data duplication / seeding rule

A v2 sandbox may be populated from:

- synthetic connected Sample Company data;
- sanitized nonproduction fixtures;
- a governed snapshot/export of current sandbox data;
- deterministic migration exports produced by existing cutover tooling.

The preferred order is synthetic/fixture data first, then governed snapshot evidence where needed for realistic parity.

Any copied dataset must preserve:

- stable business identifiers where parity depends on them;
- relationships;
- lifecycle state;
- ownership/accountability/assignment facts;
- inventory quantities and movement history;
- serialized custody;
- operating-company facts;
- audit/provenance needed to explain migrated state.

A copied sandbox dataset is read/test evidence. It must never cause writes back into the current EOS environment.

---

## 4. No broad dual-write strategy

**Default: do not dual-write user operations to current EOS and v2.**

Broad dual-write creates two authorities and makes drift harder to detect.

Preferred proof methods:

1. pure contract tests — same input -> same result;
2. replay against duplicated/synthetic data;
3. shadow reads/calculations;
4. deterministic snapshot + reconciliation;
5. bounded single-authority cutover;
6. soak + rollback window;
7. legacy retirement.

If a domain requires change capture during a migration window, one system must remain the sole business writer. The other receives migration/change evidence, not independent authority.

---

## 5. Cutover unit

Cutovers occur by **bounded business authority**, not by infrastructure label.

Examples:

- EOS identity/session;
- Employee directory/profile reads;
- Account/Customer authority;
- Part descriptive/catalog authority;
- Truck/Mobile registry;
- Work Order assignment;
- Work Order lifecycle;
- Inventory ledger/movement authority;
- Cycle Count authority.

“Move Firebase to PostgreSQL” is not a valid cutover unit because it spans multiple business authorities and can hide behavior changes.

Each cutover unit must identify:

- current source of truth;
- v2 source of truth;
- current read path;
- current write/command path;
- current authorization authority;
- v2 read/write/auth paths;
- data to migrate;
- parity invariants;
- deliberate behavior changes, if separately approved;
- rollback boundary.

---

## 6. Mandatory cutover gates

### Gate 0 — current-state census/freeze

Record exact current behavior and authority. Accepted current behavior is the parity oracle unless the Owner separately authorizes a business change.

### Gate 1 — isolated v2 replacement

The target schema/service/command works in the v2 sandbox without altering current EOS.

### Gate 2 — deterministic parity

Same actor + same facts + same requested action produces the same allowed/denied result, state transition, quantities, ownership/accountability consequences and audit outcome except for explicitly approved technical differences.

### Gate 3 — connected scenario proof

Run realistic happy-path, failure, retry, concurrency and unauthorized scenarios in both current EOS and v2.

### Gate 4 — migration reconciliation

Prove record counts, identifiers, relationships, balances, lifecycle state, ownership/accountability/assignment and domain-specific invariants.

### Gate 5 — one writer

At cutover, there is exactly one authoritative writer for each business fact. Legacy write authority is disabled/fenced before or atomically with enabling the replacement.

### Gate 6 — real application acceptance

Exercise the actual v2 application with the real role/persona matrix, not only repository tests.

### Gate 7 — bounded rollback/soak

Operate the new path with observability and a defined rollback procedure that does not require reconstructing lost facts.

### Gate 8 — retirement

Only after acceptance and soak may legacy Firebase paths, compatibility code, deployment machinery, or migration-only bridges be removed.

---

## 7. Migration sequence

### Lane A — build v2 platform beside current EOS

- Authorization v2 schema/evaluator;
- EOS sessions and external OIDC;
- Administration v2;
- API client boundary;
- v2 Vercel/Render/PostgreSQL sandbox;
- parity and migration diagnostics.

**No current operational-domain cutover is required to complete Lane A.**

### Lane B — low-coupling/already-started authorities

Use already advanced PostgreSQL work to prove the migration pattern on bounded domains before touching the most mature operational workflows.

Candidate families include Workforce reads and selected CRM/catalog authorities, subject to their own gates.

### Lane C — service/commercial authority migration

Move bounded authorities only after the foundation is proven and their domain parity gates pass.

### Lane D — protected Parts / Inventory / Truck family

Parts, Inventory, Warehouse, Bin, Truck/Mobile Location, Reorder, Purchasing, Receiving, Transfer, Cycle Count and Work Order inventory effects are a **protected mature operating family**.

They are not the proving ground for v2.

Before any runtime cutover, both this strategy and `2026-09-16-parts-inventory-truck-parity-fence.md` apply.

Where PostgreSQL target tables already exist, that does not authorize import or runtime routing.

### Lane E — Firebase retirement

Firebase Auth/Firestore/Functions/runtime residue is removed only after every dependent bounded authority has been cut over and accepted.

---

## 8. Parts / Inventory / Truck preservation

The v2 sandbox must reproduce, not reinterpret, the current accepted semantics for at least:

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

If v2 produces a different answer, that is a parity failure unless a separately authorized business-behavior decision explains the difference.

---

## 9. Practical isolation rules

- dedicated branches/worktrees for v2 foundation work;
- additive schemas/migrations until cutover;
- independently addressable v2 services/routes;
- plan/dry-run as default for migration tools;
- strict environment fences;
- no production credentials in v2 sandbox;
- no current-EOS mutation by v2 parity tests;
- runtime routing change is a separate authorized step from building/testing;
- rollback path remains until retirement.

The goal is not to create a permanently separate second product. The side-by-side implementation is temporary migration scaffolding whose purpose is to protect completed EOS work.

---

## 10. Definition of success

This strategy succeeds when:

1. current EOS remained usable while v2 was built;
2. v2 reproduced accepted business processes before replacing them;
3. every cutover had explicit parity and reconciliation evidence;
4. no mature domain was redesigned accidentally as part of infrastructure migration;
5. one writer existed at every authoritative point;
6. cutovers were reversible during the soak period;
7. Firebase dependencies disappeared only after their replacements were proven;
8. the final state is one EOS platform, not two competing systems.
