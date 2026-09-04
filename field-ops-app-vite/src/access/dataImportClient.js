// EOS Data Import -- the client SEAM for the three trusted callables.
//
// Deliberately THIN, mirroring adminPasswordResetClient.js: `firebase` stays out of the
// screen and out of the unit tests, and every function resolves rather than rejects so the
// UI renders an honest state instead of an unhandled rejection.
//
// THE CLIENT NEVER IMPORTS ANYTHING. It sends a file's text and, later, a job id; the
// parse, the validation, the preview and the write all happen in the trusted backend. That
// is not an architectural preference -- a preview computed in the browser would be a
// different preview from the one the backend executes, and the approval would then apply to
// a document nobody had checked.
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

const STAGE_CALLABLE = "stageDataImport";
const EXECUTE_CALLABLE = "executeDataImport";
const LIST_CALLABLE = "listDataImportJobs";

/**
 * Map a rejected callable into the shape the screen renders.
 *
 * The backend already sanitizes its messages, with ONE deliberate exception it marks as
 * such: intake failures describe the caller's own file and are surfaced verbatim. Anything
 * without a message collapses to a generic line rather than the SDK's internal text.
 */
function mapError(err) {
  const code = err?.details?.code ?? err?.code ?? "unknown";
  const message =
    typeof err?.message === "string" && err.message.trim().length > 0
      ? err.message
      : "The request could not be completed.";
  return { ok: false, code, message, details: err?.details ?? null };
}

async function call(name, payload) {
  try {
    const res = await httpsCallable(functions, name)(payload);
    return { ok: true, data: res?.data ?? null };
  } catch (err) {
    return mapError(err);
  }
}

/** Stage a file. Returns either a staged job or an unstaged mapping-validation result. */
export function stageDataImport({ fileName, fileText = null, fileBase64 = null, entityType = null, mapping = null }) {
  return call(STAGE_CALLABLE, { fileName, fileText, fileBase64, entityType, mapping });
}

/**
 * Execute a staged job. `approved: true` is sent explicitly and is required by the backend:
 * an execute request that merely names a job is not an approval of it.
 */
export function executeDataImport(jobId) {
  return call(EXECUTE_CALLABLE, { jobId, approved: true });
}

export function listDataImportJobs() {
  return call(LIST_CALLABLE, {});
}

/** True for a file this release reads as a binary workbook rather than as text. */
export function isWorkbookFile(fileName) {
  return /\.xlsx$/i.test(String(fileName ?? ""));
}

/**
 * Read a File as base64.
 *
 * An .xlsx is a ZIP: reading it as text would corrupt it before it ever left the browser,
 * and the corruption would surface as "this file is damaged" from a backend looking at
 * bytes the user's file never contained.
 */
export function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The file could not be read."));
    // readAsDataURL yields "data:<type>;base64,<payload>"; only the payload is sent.
    reader.onload = () => resolve(String(reader.result ?? "").split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

/** Read a File as text. Separated so the screen's logic is testable without the DOM. */
export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file);
  });
}
