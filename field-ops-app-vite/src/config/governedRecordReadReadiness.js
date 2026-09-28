// PASS 11 FIX WAVE 1 -- governed record reads (config/environments.json readiness.GOVERNED_RECORD_READ_READY).
//
// True only in an environment whose Functions runtime answers from PostgreSQL Administration
// (functions/src/access/governedRuntimeAuthority.ts, `governedRuntimeAuthority: true`). There, the list reads of
// the Rules-gated collections go through the `readGovernedRecords` callable -- every row authorized by the caller's
// governed capability, condition, scope and record relationship -- instead of a direct Firestore query whose Rules
// can only see legacy `users/{uid}.role`. Everywhere else this is false and the direct reads are unchanged.
//
// Registry-resolved at build time like every other readiness flag; an absent flag is a build error, never a default.
export const GOVERNED_RECORD_READ_READY = __APP_READINESS__.GOVERNED_RECORD_READ_READY === true;
