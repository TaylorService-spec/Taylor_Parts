// Inbound Work + Email Connections -- the CLIENT SOURCE SEAM. The one boundary between "where inbound work data
// comes from" and the screens above it: pure result mapping a node test can exercise, plus the governed wiring.
//
// THERE IS NO SYNTHETIC DEFAULT. Both surfaces are ordinary, visible product screens; a sample-data default on a real
// screen is how sample data gets read as real work. The default source is the governed one; a test injects its own.
//
// NO FIREBASE ANYWHERE IN THIS FILE (Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30). The provider boundary --
// connections, OAuth, mailboxes, routing, polling, delivery retry -- is the EOS provider runtime over PostgreSQL,
// reached through POST /operations/inbound-work (services/inboundWorkApiClient.js). The eighteen Firebase callables it
// used to call are retired.

export const INBOUND_WORK_READ = "service.inboundWork.read";
export const INBOUND_WORK_ACCEPT = "service.inboundWork.accept";
export const INBOUND_WORK_DECLINE = "service.inboundWork.decline";
export const INBOUND_WORK_ATTACH = "service.inboundWork.attachExisting";
// Intake administration is ONE governed PostgreSQL capability: reading the configuration and changing it are both
// inboundWork.intake.manage (readInboundIntakeConfiguration requires it). The Firebase ids are retired.
export const ADMIN_EMAIL_INTAKE_READ = "inboundWork.intake.manage";
export const ADMIN_EMAIL_INTAKE_MANAGE = "inboundWork.intake.manage";

/** Resolved in ONE feed request, so every control on a screen is decided under one accessVersion. */
export const INBOUND_WORK_CAPABILITY_REQUEST = Object.freeze([
  INBOUND_WORK_READ,
  INBOUND_WORK_ACCEPT,
  INBOUND_WORK_DECLINE,
  INBOUND_WORK_ATTACH,
]);

export const EMAIL_INTAKE_CAPABILITY_REQUEST = Object.freeze([ADMIN_EMAIL_INTAKE_MANAGE]);

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

/** An EOS read -> a source snapshot (NOT_ACTIVATED is its own honest state, never an empty result). */
async function governedRead(call, operation, payload) {
  const res = await call(operation, payload ?? {});
  if (res?.ok) return mapReadResult({ ok: true, payload: res.result });
  if (res?.code === "NOT_ACTIVATED") return { status: SOURCE_STATUS.UNAVAILABLE, payload: null, error: "NOT_ACTIVATED" };
  return mapReadResult({ ok: false, errorCode: res?.code === "FORBIDDEN" ? "denied" : res?.reason ?? res?.code ?? "unavailable" });
}

/**
 * A governed WRITE. Unlike a read it does NOT collapse failures into a snapshot: a decision that did not happen must
 * not look like an empty result, so the caller gets { ok, code, message, data } and the screen says what went wrong.
 */
async function governedWrite(call, operation, payload) {
  const res = await call(operation, payload ?? {});
  if (res?.ok) return { ok: true, data: res.result ?? null, code: null, message: null };
  return {
    ok: false,
    data: null,
    code: res?.reason ?? res?.code ?? "unavailable",
    message: typeof res?.message === "string" ? res.message : "That action could not be completed.",
  };
}

async function defaultCall(operation, input) {
  const { callInboundWorkApi } = await import("../services/inboundWorkApiClient.js");
  return callInboundWorkApi(operation, input);
}

// THE REVIEW QUEUE AND ITS DECISIONS ARE NOT HERE (Owner ruling W9): Service -> Inbound Work reads and decides through
// services/inboundWorkApiClient.js. WHAT IS HERE is Administration -> Email & Communications, now EOS end to end.
// The screen keeps its method names; each maps onto one EOS operation.
export function createEosEmailIntakeSource({ call = defaultCall } = {}) {
  return Object.freeze({
    // The caller's own intake authority, from EOS (canManageIntake) -- not the Firebase capability feed.
    readAccess: () => governedRead(call, "readInboundWorkAccess"),
    getConfiguration: () => governedRead(call, "readInboundIntakeConfiguration"),
    // What this runtime can actually offer: whether an OAuth client and a credential vault are configured at all.
    // Never a secret value, only whether one exists.
    getProviderReadiness: () => governedRead(call, "readInboundProviderReadiness"),
    // THE REAL CONNECTION LIFECYCLE. `startAuthorization` returns the provider URL; the provider brings the
    // administrator back to this screen with a code, and `completeAuthorization` does the exchange server-side.
    // The browser never holds a token.
    startAuthorization: (input) => governedWrite(call, "startInboundConnectionAuthorization", input),
    completeAuthorization: (input) => governedWrite(call, "completeInboundConnectionAuthorization", input),
    testConnection: (input) => governedWrite(call, "testInboundConnection", input),
    disconnect: (input) => governedWrite(call, "disconnectInboundConnection", input),
    pollNow: (input) => governedWrite(call, "pollInboundMailboxNow", input),
    retryDelivery: (input) => governedWrite(call, "retryInboundDelivery", input),
    saveConnection: ({ config = {} } = {}) => governedWrite(call, "saveInboundConnection", {
      connectionName: config.connectionName, provider: config.provider,
      tenantOrWorkspace: config.tenantOrWorkspace ?? "", connectedAccount: config.connectedAccount ?? "",
      ...(config.id ? { connectionId: config.id } : {}),
    }),
    saveMailbox: ({ config = {} } = {}) => governedWrite(call, "saveInboundMailbox", {
      ...(config.id ? { mailboxId: config.id } : {}),
      displayName: config.displayName, emailAddress: config.emailAddress || null, purpose: config.purpose,
      ...(config.connectionId ? { connectionId: config.connectionId } : {}),
      ...(config.defaultQueue ? { defaultQueue: config.defaultQueue } : {}),
      ...(config.operatingCompanyId ? { suggestedOperatingCompanyId: config.operatingCompanyId } : {}),
    }),
    saveRoutingRule: (input) => governedWrite(call, "saveInboundRoutingRule", input),
    // The non-production delivery seam. The EOS API refuses to start in production.
    deliverMessage: (input) => governedWrite(call, "deliverInboundMessage", input),
  });
}

export const governedEmailIntakeSource = createEosEmailIntakeSource();
export const DEFAULT_EMAIL_INTAKE_SOURCE = governedEmailIntakeSource;
