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

## Protected completed-domain guardrail

Parts / Inventory / Warehouse / Bin / Truck / Mobile Location / Purchasing / Receiving / Transfer / Cycle Count and Work-Order inventory-effect convergence is additionally governed by [`2026-09-16-parts-inventory-truck-parity-fence.md`](2026-09-16-parts-inventory-truck-parity-fence.md).

That fence is mandatory for Authorization v2, PostgreSQL, Render, zero-Firebase, migration, mobile/PWA, and Administration work that touches those domains. The platform reset is a **semantics-preserving migration by default**, not authorization to redesign already-completed business behavior. Any material business-behavior change requires separate explicit review/Owner authorization.

Older dated roadmaps/reconciliations remain historical evidence. They must not override this current pointer when they describe an earlier architecture or implementation state.

## Maintenance rule

When a merge changes a major object's canonical authority, database/source of truth, runtime read/write path, migration/cutover status, or a business process's material maturity, update the current reconciliation (or replace it with a newer dated reconciliation and update this pointer).

Do not report:

- code merged as data cut over;
- migration tooling as migration executed;
- a UI as a completed business process when its governed backend action is unavailable;
- a legacy path as retired until it is actually unreachable/removed;
- a technical cutover as permission to redesign protected Parts/Inventory/Truck business semantics.
