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
