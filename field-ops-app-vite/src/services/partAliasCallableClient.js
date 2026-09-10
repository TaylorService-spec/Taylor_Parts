// Part identifier administration and lookup — the readiness-gated transport over the six alias
// callables. Five administer identifiers; the sixth (Phase G) resolves a scanned one.
// Structure mirrors services/receivingCallableClient.js.
//
// GOVERNED ACTIVATION BOUNDARY. This module exports only the five public methods. They take NO
// readiness override and NO injectable invoker, and read ONLY the governed
// PART_IDENTIFIER_TRANSPORT_READY constant. There is no production-importable un-gated seam, so no
// caller, preview path, or extra option can invoke the callables while readiness is false.
// Activation requires flipping the governed constant AND releasing the resulting bundle — a
// separate authorized gate, never a runtime flag. Tests exercise the ready branch by mocking this
// module's dependencies at build time, which introduces no production bypass.
//
// FAIL CLOSED. While readiness is false the callables are never invoked and firebase is never even
// loaded. Every method returns the same shaped result either way, so callers have one code path.
//
// Never throws. Each method returns { result } on success or { errorStatus, errorDetail } on
// failure. domain/partIdentifiers.js turns those into human words — this file performs transport
// only, and maps no messages of its own.
import { PART_IDENTIFIER_TRANSPORT_READY } from "../config/partIdentifierReadiness.js";
import { toPartListView } from "../domain/partMasterView.js";
import { normalizeScanToken } from "../domain/scannedIdentity.js";

export const CALLABLE_NAMES = Object.freeze({
  create: "createPartAlias",
  deactivate: "deactivatePartAlias",
  reactivate: "reactivatePartAlias",
  list: "listPartAliases",
  probe: "probePartAlias",
  // Phase G. Gated SERVER-SIDE on `inventory.catalog.alias.read`, a narrower capability than the
  // five administration callables use -- alias lookup and alias administration have different
  // audiences. It ships and deploys with them, so it shares this transport and this readiness
  // constant rather than introducing a second seam.
  resolveScanned: "resolveScannedPartIdentifier",
  // The scanner's ONE governed Part read (Lookup + Move stock). Gated server-side on
  // inventory.catalog.read; the alias half additionally on inventory.catalog.alias.read.
  lookupScanned: "lookupScannedPart",
});

// The status returned when the transport is switched off. Deliberately its OWN status rather than a
// permission denial: "not switched on here" and "you may not do this" are different facts, and
// telling an authorized administrator they lack permission would send them to request access they
// already have.
export const NOT_READY_STATUS = "transport-not-ready";

function mapErrorToStatus(err) {
  const raw = err && typeof err.code === "string" ? err.code : "";
  const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
  return code || "internal";
}

// The DOMAIN code the adapter put in `details`. Only ever a string; anything else is absent.
function mapErrorDetail(err) {
  return typeof err?.details === "string" && err.details.length > 0 ? err.details : null;
}

// Private, non-exported. Firebase is imported LAZILY so this module has no import-time side effect
// (firebase/firebase.js runs initializeApp on import) and stays test-safe.
async function invoke(name, payload) {
  if (!PART_IDENTIFIER_TRANSPORT_READY) {
    return { errorStatus: NOT_READY_STATUS, errorDetail: null };
  }
  try {
    const [{ httpsCallable }, { functions }] = await Promise.all([
      import("firebase/functions"),
      import("../firebase/firebase.js"),
    ]);
    const res = await httpsCallable(functions, name)(payload);
    return { result: res?.data };
  } catch (err) {
    return { errorStatus: mapErrorToStatus(err), errorDetail: mapErrorDetail(err) };
  }
}

export const listPartAliases = ({ partId }) => invoke(CALLABLE_NAMES.list, { partId });

// idempotencyKey is carried through VERBATIM and never regenerated here: the caller owns generating
// it once per user intent and reusing it across a retry of that same intent, which is what makes a
// double-send safe.
export const createPartAlias = ({ partId, aliasType, rawValue, manufacturerId, source, idempotencyKey }) =>
  invoke(CALLABLE_NAMES.create, {
    partId,
    aliasType,
    rawValue,
    idempotencyKey,
    ...(manufacturerId ? { manufacturerId } : {}),
    ...(source ? { source } : {}),
  });

export const deactivatePartAlias = ({ aliasId, expectedVersion, idempotencyKey }) =>
  invoke(CALLABLE_NAMES.deactivate, { aliasId, expectedVersion, idempotencyKey });

export const reactivatePartAlias = ({ aliasId, expectedVersion, idempotencyKey }) =>
  invoke(CALLABLE_NAMES.reactivate, { aliasId, expectedVersion, idempotencyKey });

export const probePartAlias = ({ aliasType, rawValue, manufacturerId }) =>
  invoke(CALLABLE_NAMES.probe, {
    aliasType,
    rawValue,
    ...(manufacturerId ? { manufacturerId } : {}),
  });

/**
 * Resolve one scanned or typed identifier to the Part it points to.
 *
 * Returns the server's own vocabulary unchanged — FOUND / INACTIVE / AMBIGUOUS / NOT_FOUND /
 * MALFORMED — or { errorStatus } when denied, unreachable or switched off. It deliberately does NOT
 * return the Part record: reading the Part is separately governed by firestore.rules and the caller
 * performs that read under its own authority.
 */
export const resolveScannedIdentifier = ({ rawValue, manufacturerId }) =>
  invoke(CALLABLE_NAMES.resolveScanned, {
    rawValue,
    ...(manufacturerId !== undefined ? { manufacturerId } : {}),
  });

export const partAliasCallableClient = Object.freeze({
  listPartAliases,
  createPartAlias,
  deactivatePartAlias,
  reactivatePartAlias,
  probePartAlias,
  resolveScannedIdentifier,
});

/**
 * THE SCANNER'S PART LOOKUP -- one governed server read answering both questions a scan asks: is this a
 * Part's own code, and is it a registered identifier. Replaces the client-direct `parts` reads that
 * firestore.rules refused to a Parts Associate.
 *
 * Returns { catalogResult, aliasOutcome } in EXACTLY the shapes domain/partLookup.js buildPartLookup
 * already takes, so Lookup and Move stock keep one identity state machine. The catalogue half holds only
 * the <=3 Parts the scan names; a refusal stays a refusal (never an empty catalogue).
 */
export async function lookupScannedPart(rawValue) {
  const partCode = normalizeScanToken(rawValue);
  const out = await invoke(CALLABLE_NAMES.lookupScanned, { rawValue, ...(partCode ? { partCode } : {}) });
  if (out.errorStatus) {
    return {
      catalogResult: { ok: false, code: out.errorStatus === "permission-denied" ? "permission-denied" : "unavailable" },
      aliasOutcome: null,
    };
  }
  const r = out.result ?? {};
  return {
    catalogResult: { ok: true, ...toPartListView((Array.isArray(r.parts) ? r.parts : []).map((p) => ({ id: p?.id, data: p?.data }))) },
    aliasOutcome: r.aliasDenied ? { errorStatus: "permission-denied", errorDetail: null } : (r.alias ? { result: r.alias } : null),
  };
}
