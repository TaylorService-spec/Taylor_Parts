// Inbound Work + Email Connections -- the CLIENT SOURCE SEAM. The one boundary between "where inbound
// work data comes from" and the screens above it, in the same shape as access/coordinatedOperationsSource.js:
// pure result mapping that a node test can exercise, plus a thin governed wiring that imports firebase
// lazily so this module carries no import-time side effect.
//
// THERE IS NO SYNTHETIC DEFAULT. Both surfaces are ordinary, visible product screens, and the fidelity
// lesson already recorded in coordinatedOperationsSource.js applies: a sample-data default on a real screen
// is how sample data gets read as real work. The default source is the governed one; a test injects its own.
//
// NO DIRECT FIRESTORE ACCESS ANYWHERE IN THIS FILE. All four collections behind this feature are denied to
// every client by Rules default, and every read and write below goes through a trusted callable.

export const INBOUND_WORK_READ = "service.inboundWork.read";
export const INBOUND_WORK_ACCEPT = "service.inboundWork.accept";
export const INBOUND_WORK_DECLINE = "service.inboundWork.decline";
export const INBOUND_WORK_ATTACH = "service.inboundWork.attachExisting";
export const ADMIN_EMAIL_INTAKE_READ = "administration.emailIntake.read";
export const ADMIN_EMAIL_INTAKE_MANAGE = "administration.emailIntake.manage";

/** Resolved in ONE feed request, so every control on a screen is decided under one accessVersion. */
export const INBOUND_WORK_CAPABILITY_REQUEST = Object.freeze([
  INBOUND_WORK_READ,
  INBOUND_WORK_ACCEPT,
  INBOUND_WORK_DECLINE,
  INBOUND_WORK_ATTACH,
]);

export const EMAIL_INTAKE_CAPABILITY_REQUEST = Object.freeze([ADMIN_EMAIL_INTAKE_READ, ADMIN_EMAIL_INTAKE_MANAGE]);

/** The three states a governed read can be in, kept distinct so the UI can say which one it is. */
export const SOURCE_STATUS = Object.freeze({ READY: "ready", DENIED: "denied", UNAVAILABLE: "unavailable" });

/** Strip the "functions/" prefix Firebase puts on callable error codes. */
export function normalizeCallableErrorCode(err) {
  const raw = err && typeof err.code === "string" ? err.code : "";
  return raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
}

/** Pure mapping of a callable outcome to a source snapshot. Dependency-free so tests need no firebase. */
export function mapReadResult({ ok, payload, errorCode } = {}) {
  if (ok && payload && typeof payload === "object") {
    return { status: SOURCE_STATUS.READY, payload, error: null };
  }
  const denied = errorCode === "permission-denied" || errorCode === "denied";
  return {
    status: denied ? SOURCE_STATUS.DENIED : SOURCE_STATUS.UNAVAILABLE,
    payload: null,
    error: errorCode || SOURCE_STATUS.UNAVAILABLE,
  };
}

async function callable(name, payload) {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import("firebase/functions"),
    import("../firebase/firebase.js"),
  ]);
  return httpsCallable(functions, name)(payload ?? {});
}

async function governedRead(name, payload) {
  try {
    const res = await callable(name, payload);
    return mapReadResult({ ok: true, payload: res?.data });
  } catch (err) {
    return mapReadResult({ ok: false, errorCode: normalizeCallableErrorCode(err) });
  }
}

/**
 * A governed WRITE. Unlike a read it does NOT collapse failures into a snapshot: a decision that did not
 * happen must not look like an empty result, so the caller gets { ok, code, message, data } and the screen
 * says what went wrong.
 */
async function governedWrite(name, payload) {
  try {
    const res = await callable(name, payload);
    return { ok: true, data: res?.data ?? null, code: null, message: null };
  } catch (err) {
    return {
      ok: false,
      data: null,
      code: normalizeCallableErrorCode(err) || "unavailable",
      message: typeof err?.message === "string" ? err.message : "That action could not be completed.",
    };
  }
}

export const governedInboundWorkSource = Object.freeze({
  listQueue: (options = {}) => governedRead("listInboundWork", options),
  getRequest: (requestId) => governedRead("getInboundWorkRequest", { requestId }),
  accept: (input) => governedWrite("acceptInboundWork", input),
  decline: (input) => governedWrite("declineInboundWork", input),
  attach: (input) => governedWrite("attachInboundWorkToWorkOrder", input),
});

export const governedEmailIntakeSource = Object.freeze({
  getConfiguration: () => governedRead("getEmailIntakeConfiguration"),
  saveConnection: (input) => governedWrite("saveEmailConnection", input),
  saveMailbox: (input) => governedWrite("saveEmailMailbox", input),
  saveRoutingRule: (input) => governedWrite("saveEmailRoutingRule", input),
  // The non-production delivery seam. Refused by the backend in any production-role environment, so this
  // being callable from the client is not what makes it safe -- the environment guard is.
  deliverMessage: (input) => governedWrite("deliverInboundEmailMessage", input),
});

export const DEFAULT_INBOUND_WORK_SOURCE = governedInboundWorkSource;
export const DEFAULT_EMAIL_INTAKE_SOURCE = governedEmailIntakeSource;
