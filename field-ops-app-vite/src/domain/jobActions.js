import { isWriteBlocked } from "../config/env";
import { notifyTechnicianDirectoryChanged } from "./technicianDirectoryChanged.js";

// What is left of the legacy `fieldops_jobs` surface: one function, and it no longer writes
// Firestore.
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
// authority for dead product.
//
// The transitions they encoded are recorded in docs/governance/workflow-action-census.md as
// measurement, so the later Workflows workstream starts from what this code actually did.
//
// ============================ WHAT SURVIVES ============================
//
// createTechnician(), now a TRUSTED COMMAND. It was the last direct client governed business write
// in the application: `techniciansStore.add(...)` against `fieldops_technicians`, reached from the
// Technicians surface's New Technician modal.
//
// THE STATUS IS NO LONGER SENT. The retired rule was
// `isAdminOrDispatcher() && request.resource.data.status == 'available'`, and that second clause was
// part of the AUTHORITY rather than a client convention. The server now chooses `available` itself
// and accepts no status at all, so there is nothing here for a caller to get wrong.
//
// The demo/panic write gate still runs BEFORE the round trip, returning the same `{ blocked: true }`
// sentinel the store did -- Technicians.jsx checks for exactly that and keeps its modal open.

export async function createTechnician(name, phone) {
  if (isWriteBlocked()) {
    console.warn("WRITE BLOCKED (createTechnician)", name);
    return { blocked: true };
  }

  // Lazy, matching every other trusted-command client here: firebase/firebase.js runs initializeApp
  // on import, so a static import would give this module an import-time side effect.
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import("firebase/functions"),
    import("../firebase/firebase.js"),
  ]);

  try {
    const res = await httpsCallable(functions, "createTechnician")({ name, phone: phone ?? null });
    // `{ id, name, phone, status }` -- the caller closes its modal, focuses the new row by this id
    // and announces the name. The id is the one the SERVER minted.
    //
    // AFTER SUCCESS ONLY. Announced so the directory beside the modal re-reads immediately instead
    // of waiting out a poll interval -- a rejected create announces nothing, so a failed mutation
    // cannot make every listening surface re-read for a change that did not happen.
    notifyTechnicianDirectoryChanged();
    return res?.data ?? null;
  } catch (err) {
    // THROWS, as the store did. Technicians.jsx relies on that to keep the modal open with safe
    // copy and nothing persisted; swallowing it here would close the modal on a failed create.
    const raw = typeof err?.code === "string" ? err.code : "";
    const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
    const normalized = new Error(err?.message ?? "technician could not be created");
    normalized.code = code === "permission-denied" ? "permission-denied" : "unavailable";
    throw normalized;
  }
}
