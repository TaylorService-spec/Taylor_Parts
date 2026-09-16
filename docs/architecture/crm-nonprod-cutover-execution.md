# CRM nonprod cutover execution

Tracking issue: #1925.

## Current gate: source freeze

This branch performs only the first irreversible-looking but still rollback-capable cutover move:

`Firestore OPEN / PostgreSQL INACTIVE -> Firestore FROZEN / PostgreSQL INACTIVE`

It does **not** export, copy, activate PostgreSQL writers, compose the CRM API/client transport, retire Firestore data, touch Certification, or touch production.

### Freeze implementation

- `functions/src/crm/crmWriterState.ts` is the canonical server-side writer authority and is committed `FROZEN / INACTIVE`.
- Existing server-side legacy CRM writers already call `assertFirestoreCrmWriterOpen(...)` before their first write; with the committed state now FROZEN they refuse.
- The platform-sandbox client uses `field-ops-app-vite/src/domain/crmCutoverFreeze.js` as a temporary **pre-Firestore safety fuse** for Account create/update, Contact create/update/import, and Location create/update.
- The client fuse is exact-environment (`platform-sandbox`) and is not a business-authorization model.
- **Firestore Rules are not changed and are not the cutover freeze authority.** No new Firebase business dependency is introduced.

### Stale-client boundary

A deployed client fuse cannot make an old cached bundle disappear. Therefore this freeze does not claim a global source lock. Before snapshot export and again immediately before copy, the migration lane must prove the Firestore source is unchanged. Any drift aborts the copy and restarts the snapshot sequence.

That quiescence proof is a required next gate before any data copy.

## Rollback boundary

Rollback to `OPEN / INACTIVE` remains legal only before PostgreSQL writers are activated and before any CRM data copy is accepted as cutover authority. No rollback is authorized by this document; it records the existing transition model only.

## Next gates

1. Deploy this freeze from merged `main` through the normal Vercel + Render integrations.
2. Prove deployed client/server mutation refusal.
3. Run source-quiescence proof + migration-only CRM snapshot export.
4. Run census and reconcile blockers.
5. Only a clean census may proceed to copy-once + verify.
