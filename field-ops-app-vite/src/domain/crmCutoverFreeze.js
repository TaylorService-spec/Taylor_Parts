// NONPROD CRM CUTOVER SAFETY FUSE
//
// This is not business authorization and it is not a second CRM authority. The canonical
// writer-authority state lives server-side in functions/src/crm/crmWriterState.ts.
//
// During the platform-sandbox Firestore -> PostgreSQL CRM cutover, the currently deployed
// browser must stop originating Account / Contact / Location mutations before any Firestore
// SDK call. Firestore Rules are deliberately NOT used as the new freeze mechanism: the target
// architecture removes Firebase business authority rather than adding to it.
//
// The active environment is the same build-time registry value Vite already injects for the
// application. Keeping this fuse independent of the Firebase module matters: contact/account
// tests legitimately mock that module, and the freeze decision is an application-environment
// fact rather than a Firebase SDK fact.
//
// This client fuse is intentionally exact-environment and temporary. It protects the current
// deployed bundle while the source is frozen and measured. A stale older bundle is handled by
// source-quiescence proof immediately before export and copy; stale-client risk is never hidden
// by pretending this client-only fuse is a global source lock.
export const CRM_CUTOVER_FROZEN_ENVIRONMENT = "platform-sandbox";

const CRM_CLIENT_WRITERS = Object.freeze([
  "account.clientCreate",
  "account.clientUpdate",
  "contact.clientCreate",
  "contact.clientUpdate",
  "contact.clientImport",
  "location.clientCreate",
  "location.clientUpdate",
]);

export class CrmCutoverFrozenError extends Error {
  constructor(writer, environmentId) {
    super(`CRM writes are temporarily frozen for the ${environmentId} cutover; ${writer} did not write to Firestore.`);
    this.name = "CrmCutoverFrozenError";
    this.code = "CRM_CUTOVER_FROZEN";
    this.writer = writer;
    this.environmentId = environmentId;
  }
}

export function assertClientCrmWriterOpen(writer, environmentId = __APP_ENVIRONMENT__.id) {
  if (!CRM_CLIENT_WRITERS.includes(writer)) {
    throw new Error(`Unknown CRM client writer '${String(writer)}'`);
  }
  if (environmentId === CRM_CUTOVER_FROZEN_ENVIRONMENT) {
    throw new CrmCutoverFrozenError(writer, environmentId);
  }
}
