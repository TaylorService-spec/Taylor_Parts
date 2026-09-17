# EOS Roadmap

**Current roadmap authority:** [`roadmaps/CURRENT.md`](roadmaps/CURRENT.md)

**Current full platform reconciliation (2026-09-16):**  
[`roadmaps/2026-09-16-full-platform-roadmap-reconciliation.md`](roadmaps/2026-09-16-full-platform-roadmap-reconciliation.md)

**Current foundation reset:**  
[`roadmaps/2026-09-16-authorization-v2-application-platform-reset.md`](roadmaps/2026-09-16-authorization-v2-application-platform-reset.md)

The September reconciliation is the current program-level answer to:

- where EOS is now;
- what has been completed;
- what is implemented but not migrated/cut over;
- what remains across the business-object model;
- what remains across end-to-end business processes;
- PostgreSQL / Render / Vercel convergence;
- Firebase retirement;
- identity, roles, permissions and Authorization v2;
- Administration and application-platform direction;
- open PR/issue program disposition;
- sequencing and completion criteria.

## Supporting authorities

- Shipped/history evidence: [`SPRINT_STATUS.md`](SPRINT_STATUS.md)
- Architecture: [`PROJECT_ARCHITECTURE.md`](PROJECT_ARCHITECTURE.md)
- Current code-authority map: [`architecture/SYSTEM_AUTHORITIES.md`](architecture/SYSTEM_AUTHORITIES.md)
- Product direction: [`ProductVision.md`](ProductVision.md)
- Capability model: [`PlatformCapabilityModel.md`](PlatformCapabilityModel.md)
- Future business capability memory: [`roadmaps/business-capability-register.md`](roadmaps/business-capability-register.md)
- Active multi-agent assignments: [`engineering/ACTIVE_WORKSTREAMS.md`](engineering/ACTIVE_WORKSTREAMS.md)
- Durable decisions: [`DECISIONS.md`](DECISIONS.md)

## Historical roadmaps

Older roadmap documents remain historical evidence. In particular, the July reconciliation is retained at [`roadmaps/roadmap-reconciliation-2026-07.md`](roadmaps/roadmap-reconciliation-2026-07.md). It must not be used as current status when it conflicts with the September reconciliation, later decisions, or current executable repository state.

Git history preserves the pre-2026-09-16 contents of this file; they were intentionally removed from the canonical entry point because they described a stale Firebase-era program state while still appearing under the undated name `ROADMAP.md`.

## Maintenance rule

When a change materially alters a major object's canonical authority, storage/source of truth, runtime read/write path, migration/cutover state, or an end-to-end business process's maturity, update the current dated reconciliation or replace it with a newer dated reconciliation and update `roadmaps/CURRENT.md`.

Do not equate:

- **code merged** with **data cut over**;
- **migration tooling exists** with **migration executed**;
- **UI exists** with **business process operational**;
- **legacy path unused** with **legacy path retired**.
