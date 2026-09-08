import { techniciansStore } from "../firebase/collectionStore";
import { TECH_STATUS } from "./constants";

// What is left of the legacy `fieldops_jobs` surface: one function.
//
// ============================ WHAT WAS DELETED, AND WHY ============================
//
// This module used to export four functions. Three were DEAD CODE, measured 2026-09-07:
//
//   createJob()        no importer anywhere in src/ or test/
//   assignJob()        no importer. Dispatch.jsx's own header records why -- it "IS now the
//                      canonical Work Order dispatch surface", assigns through the governed
//                      `transitionWorkOrder` transition against fieldops_wos, and says in as many
//                      words that "the legacy assignJob() client transaction against fieldops_jobs
//                      is no longer used here".
//   updateJobStatus()  no importer. completionFlow.test.mjs already asserts that no legacy job
//                      write path remains in the completion flow.
//
// Those three carried the last two client-direct Firestore `runTransaction` calls in the
// application. They were DELETED rather than migrated: minting permanent trusted-command authority
// -- and the capability grants that go with it -- for a surface nothing calls would create
// authority for dead product, which is worse than the direct writes it replaced.
//
// The transitions they encoded are recorded in docs/governance/workflow-action-census.md as
// measurement, so the later Workflows workstream starts from what this code actually did rather
// than from memory of it.
//
// ============================ WHAT SURVIVES ============================
//
// createTechnician() has exactly one live caller (modules/technicians/Technicians.jsx). It writes
// through techniciansStore, which gates on lib/firebaseSafe.js's demo/panic write block, and is
// therefore still a CLIENT-DIRECT write to `fieldops_technicians`.
//
// It is the LAST direct client governed business write in the application, and it is NOT migrated
// here: no Contact-style `service.technician.create` capability exists, and minting one plus
// granting it to a Role is an authorization-definition decision rather than a migration step. The
// parity table is in docs/governance/capability-parity-proposals.md.
//
// `status: available` is not a default this file chose -- the retired Rule REQUIRED it
// (`allow create: if isAdminOrDispatcher() && request.resource.data.status == 'available'`), and a
// trusted command replacing this must keep enforcing it server-side.
export function createTechnician(name, phone) {
  return techniciansStore.add({ name, phone, status: TECH_STATUS.AVAILABLE });
}
