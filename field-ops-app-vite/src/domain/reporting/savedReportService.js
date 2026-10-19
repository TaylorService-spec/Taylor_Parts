// Issue #325 W-SAVE -- the CLIENT wrappers for Inventory's trusted saved-definition callables. This
// is the ONLY path the client uses to reach saved definitions -- it NEVER touches the
// `reportDefinitions` collection directly (firestore.rules denies that unconditionally). Every
// method invokes a callable and returns its confirmed `.data`; on rejection it throws (the caller
// maps the error with savedReportServiceOutcome.js). No optimistic success is ever synthesized here.
//
// The service authorizes each action server-side against the caller's REAL RoleAssignments, scopes
// every read/list to the caller's own definitions, and writes exactly one immutable audit event per
// mutation. The client sends only { name, definition, definitionId } -- never an ownerUid, role, or
// accessVersion (those are server-derived from request.auth.uid).
import { httpsCallable } from "firebase/functions";
import { functions } from "../../firebase/firebase";
import { EOS_SESSION_SOURCE } from "../../access/eosSessionSource.js";
import { createSavedReportClient } from "../../services/eosRecordsClients.js";

// FIREBASE EXIT B4 (DECISIONS #B4; F7e): WHICH SOURCE ANSWERS is decided once at BUILD time by the F1 flag. Where an EOS API is declared the six methods call the
// Operations transport (the *SavedReportDefinition(s) operations over eos_ops.report_definitions: the caller's OWN definitions, reportDefinition.read /
// report.definition.*) and the Firebase callables are never invoked; everywhere else they are the sole source, exactly as before. Both throw a Firebase-style coded
// error, which savedReportServiceOutcome.js maps unchanged.
const CALLABLES = Object.freeze({
  create: "createSavedDefinitionCallable",
  get: "getSavedDefinitionCallable",
  list: "listSavedDefinitionsCallable",
  rename: "renameSavedDefinitionCallable",
  duplicate: "duplicateSavedDefinitionCallable",
  del: "deleteSavedDefinitionCallable",
});

function call(name, payload) {
  return httpsCallable(functions, name)(payload).then((res) => res?.data);
}

const firebaseSavedReportService = Object.freeze({
  create: ({ name, definition }) => call(CALLABLES.create, { name, definition }),
  get: (definitionId) => call(CALLABLES.get, { definitionId }),
  list: () => call(CALLABLES.list, {}),
  rename: (definitionId, name) => call(CALLABLES.rename, { definitionId, name }),
  duplicate: (definitionId, name) => call(CALLABLES.duplicate, name === undefined ? { definitionId } : { definitionId, name }),
  remove: (definitionId) => call(CALLABLES.del, { definitionId }),
});

export const savedReportService = EOS_SESSION_SOURCE ? createSavedReportClient() : firebaseSavedReportService;
