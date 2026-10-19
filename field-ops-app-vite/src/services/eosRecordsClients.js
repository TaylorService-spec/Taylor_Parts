// RECORDS AND REPORTING ON EOS -- the browser's clients for Firebase exit B4 (DECISIONS #B4).
//
//   browser -> THESE -> POST /operations/inventory (EOS trusted API, functions/src/eosOps/eosOpsHttp.ts)
//   -> verified bearer -> EOS Principal + tenant + the operation's own capability + the caller's operating companies -> PostgreSQL
//
// Five seams, one transport. Each replaces ONE Firebase callable client with the SAME function names and result shapes, so no screen changes; which of
// the two answers is decided ONCE at BUILD time by the F1 flag in the Firebase client's own file (there is no runtime fallback in either direction):
//
//   imported service history   access/importedServiceHistorySource.js   fetchImportedServiceHistory      -> listImportedServiceHistory
//   Data Import                access/dataImportClient.js               stage / execute / list            -> stageDataImport / executeDataImport / listDataImportJobs
//   Report Builder             domain/reporting/reportExecutionSeam.js  runReport                         -> runReportDefinition
//   Saved Reports              domain/reporting/savedReportService.js   create/get/list/rename/...        -> *SavedReportDefinition(s)
//   performance goals          services/performanceGoalClient.js        three reads                       -> listCurrentPerformanceGoals / ...Versions / listGoalSubjects
//
// NONE OF THEM DECIDES ANYTHING. A refusal is the server's answer, mapped to the SAME bounded vocabulary the screen already renders for the Firebase
// client (an error code the existing pure mappers key on) -- never a raw message, never an empty-looking success. A malformed answer is an error,
// never an empty list. The transport is imported LAZILY on the first real call: reorderApiClient.js reaches the Administration client for the user's
// token, and this module must stay importable (and unit-testable) without initializing anything.
const callReorderApi = async (...args) => (await import("./reorderApiClient.js")).callReorderApi(...args);

export const RECORDS_OPERATIONS = Object.freeze({
  importedHistory: "listImportedServiceHistory",
  stageImport: "stageDataImport",
  executeImport: "executeDataImport",
  listImports: "listDataImportJobs",
  runReport: "runReportDefinition",
  createDefinition: "createSavedReportDefinition",
  getDefinition: "readSavedReportDefinition",
  listDefinitions: "listSavedReportDefinitions",
  renameDefinition: "renameSavedReportDefinition",
  duplicateDefinition: "duplicateSavedReportDefinition",
  deleteDefinition: "deleteSavedReportDefinition",
  currentGoals: "listCurrentPerformanceGoals",
  goalVersions: "listPerformanceGoalVersions",
  goalSubjects: "listGoalSubjects",
});

/** One call that never throws: a transport that throws is an UNREACHABLE failure value. */
async function callOp(call, operation, input) {
  try {
    return await call(operation, input);
  } catch {
    return { ok: false, code: "UNREACHABLE", reason: null, message: "the service could not be reached" };
  }
}

/** The server's failure -> the Firebase-style code the existing pure mappers (reportRunOutcome, savedReportServiceOutcome) already key on. */
export function firebaseStyleCode(res) {
  const reason = res?.reason ?? null;
  // The two scan-bound refusals are a distinct, ACTIONABLE answer ("narrow the report"); they are the Firebase "resource-exhausted".
  if (reason === "SCAN_INCOMPLETE" || reason === "ABSENCE_UNPROVEN") return "resource-exhausted";
  switch (res?.code) {
    case "NOT_SIGNED_IN":
    case "UNAUTHENTICATED": return "unauthenticated";
    case "FORBIDDEN": return "permission-denied";
    case "NOT_FOUND": return "not-found";
    case "INVALID_INPUT": return "invalid-argument";
    case "PRECONDITION_FAILED": return "failed-precondition";
    case "CONFLICT": return "aborted";
    case "UNREACHABLE":
    case "NOT_CONFIGURED":
    case "UNKNOWN_OPERATION": return "unavailable";
    default: return "internal";
  }
}

// The message is FIXED: the pure mappers print their own copy and a server's sentence is never what a person reads here.
const failureError = (res) => Object.assign(new Error("The request could not be completed."), { code: firebaseStyleCode(res), reason: res?.reason ?? null });

// ════════════════════ imported service history ════════════════════

/** @param {{ call?: typeof callReorderApi }} [deps] injectable transport (tests) */
export function createImportedHistoryClient({ call = callReorderApi } = {}) {
  /** Resolves `{ ok, rows, truncated }` or `{ ok: false, code }`. `denied` stays DISTINCT from a general failure. */
  return async function fetchImportedServiceHistory(accountId, limit) {
    const res = await callOp(call, RECORDS_OPERATIONS.importedHistory, { accountId, ...(limit === undefined ? {} : { limit }) });
    if (res?.ok === true && Array.isArray(res.result?.rows)) return { ok: true, rows: res.result.rows, truncated: res.result.truncated === true };
    // A malformed answer is an error, never an empty history.
    return { ok: false, code: res?.ok !== true && res?.code === "FORBIDDEN" ? "denied" : "error", rows: [], truncated: false };
  };
}

// ════════════════════ Data Import ════════════════════

const importFailure = (res) => ({
  ok: false,
  // A refusal on authority keeps the Firebase code the screen already branches on ("permission-denied" is its DENIED state); anything else carries the
  // server's own specific code (ENTITY_NOT_WIRED, COMPANY_REQUIRED, FILE_TOO_LARGE, ...) so the screen can say WHY.
  code: res?.code === "FORBIDDEN" ? "permission-denied" : (res?.reason ?? res?.code ?? "unknown"),
  message: typeof res?.message === "string" && res.message.trim().length > 0 ? res.message : "The request could not be completed.",
  details: null,
});

/** @param {{ call?: typeof callReorderApi }} [deps] injectable transport (tests) */
export function createDataImportClient({ call = callReorderApi } = {}) {
  const run = async (operation, input) => {
    const res = await callOp(call, operation, input);
    return res?.ok === true ? { ok: true, data: res.result ?? null } : importFailure(res);
  };
  return Object.freeze({
    /** Stage a file. `operatingCompanyKey` is one of the companies the history read offered (required when the caller reaches more than one). */
    stage: ({ fileName, fileText = null, fileBase64 = null, entityType = null, mapping = null, operatingCompanyKey = null }) =>
      run(RECORDS_OPERATIONS.stageImport, {
        fileName,
        ...(fileText ? { fileText } : {}), ...(fileBase64 ? { fileBase64 } : {}),
        ...(entityType ? { entityType } : {}), ...(mapping ? { mapping } : {}),
        ...(operatingCompanyKey ? { operatingCompanyKey } : {}),
      }),
    /** `approved: true` is sent explicitly and is required by the server: naming a job is not an approval of it. */
    execute: (jobId) => run(RECORDS_OPERATIONS.executeImport, { jobId, approved: true }),
    list: () => run(RECORDS_OPERATIONS.listImports, {}),
  });
}

// ════════════════════ Report Builder / Saved Reports ════════════════════

/**
 * The run seam: resolves the server's outcome PAYLOAD (the shape reportRunOutcome.mapServiceOutcome maps) or throws an Error carrying a Firebase-style
 * `code`, so the unchanged pure mappers (mapServiceOutcome / mapCallableError) decide every user-facing state. The caller (reportExecutionSeam.js) maps.
 */
export function createReportRunClient({ call = callReorderApi } = {}) {
  return async function runReportPayload(definition, options) {
    const res = await callOp(call, RECORDS_OPERATIONS.runReport, { definition, ...(options?.definitionId ? { definitionId: options.definitionId } : {}) });
    if (res?.ok === true) return res.result;
    throw failureError(res);
  };
}

/** The saved-definition service: the same six methods as domain/reporting/savedReportService.js; each returns the confirmed data or throws a coded Error. */
export function createSavedReportClient({ call = callReorderApi } = {}) {
  const run = async (operation, input) => {
    const res = await callOp(call, operation, input);
    if (res?.ok === true) return res.result;
    throw failureError(res);
  };
  return Object.freeze({
    create: ({ name, definition }) => run(RECORDS_OPERATIONS.createDefinition, { name, definition }),
    get: (definitionId) => run(RECORDS_OPERATIONS.getDefinition, { definitionId }),
    // The server answers { items }; the Firebase callable answered the bare array the screen's normalizer reads.
    list: async () => {
      const out = await run(RECORDS_OPERATIONS.listDefinitions, {});
      if (!Array.isArray(out?.items)) throw Object.assign(new Error("malformed answer"), { code: "internal" });
      return out.items;
    },
    rename: (definitionId, name) => run(RECORDS_OPERATIONS.renameDefinition, { definitionId, name }),
    duplicate: (definitionId, name) => run(RECORDS_OPERATIONS.duplicateDefinition, name === undefined ? { definitionId } : { definitionId, name }),
    remove: (definitionId) => run(RECORDS_OPERATIONS.deleteDefinition, { definitionId }),
  });
}

// ════════════════════ performance goals ════════════════════

const goalStatus = (res) => (res?.code === "FORBIDDEN" ? "denied" : "unavailable");

/** The three goal reads, with the Firebase client's `{ result } | { errorStatus }` shapes. Never throws. */
export function createPerformanceGoalClient({ call = callReorderApi } = {}) {
  const read = async (operation, input, valid) => {
    const res = await callOp(call, operation, input);
    if (res?.ok === true && valid(res.result)) return { result: res.result };
    return { errorStatus: res?.ok === true ? "unavailable" : goalStatus(res) };
  };
  return Object.freeze({
    // An empty target list short-circuits without a round trip (as the Firebase client does).
    fetchCurrentPerformanceGoals: async (targets, onDate) => {
      if (!Array.isArray(targets) || targets.length === 0) return { result: { results: [], onDate } };
      return read(RECORDS_OPERATIONS.currentGoals, { targets, onDate }, (r) => Array.isArray(r?.results));
    },
    fetchPerformanceGoalVersions: (target) => read(RECORDS_OPERATIONS.goalVersions, { target }, (r) => Array.isArray(r?.versions)),
    fetchGoalSubjects: () => read(RECORDS_OPERATIONS.goalSubjects, {}, (r) => Array.isArray(r?.employeeIds)),
  });
}
