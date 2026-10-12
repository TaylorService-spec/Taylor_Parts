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

// The governed Catalog OPERATION names, mirrored from the server. Kept under the frozen export name
// so existing callers and tests are unaffected; the values are operations now, not callables.
export const CALLABLE_NAMES = Object.freeze({
  create: "createPartAlias",
  deactivate: "deactivatePartAlias",
  reactivate: "reactivatePartAlias",
  list: "listPartAliases",
  probe: "probePartAlias",
  // The scanner's ONE governed Part read (Lookup + Move stock). Gated server-side on
  // inventory.catalog.read; the alias half additionally on inventory.catalog.alias.read.
  lookupScanned: "lookupScannedPart",
});

// The status returned when the transport is switched off. Deliberately its OWN status rather than a
// permission denial: "not switched on here" and "you may not do this" are different facts, and
// telling an authorized administrator they lack permission would send them to request access they
// already have.
export const NOT_READY_STATUS = "transport-not-ready";

// Private, non-exported. THE GOVERNED RENDER CATALOG TRANSPORT.
//
// This used to invoke the Firebase alias callables, which were removed from the repository in Firebase
// retirement F3b (#2056). There is NO fallback: a refusal or an unreachable service is returned as a
// value, never retried against Firestore.
//
// THIS MODULE IS THE ADAPTER between the Catalog API's answers and the vocabulary the identifier screens
// render ({ result } | { errorStatus, errorDetail }). It used to relay the Catalog answers VERBATIM on the
// assumption that their shapes matched the retired callables'. They did not (finding CAT-2,
// docs/audits/firebase-retirement-equivalence-2026-10-11): listPartAliases answers a bare array whose
// identifier is `originalValue`, so every Part showed NO identifiers and Deactivate/Reactivate were
// unreachable; writes answer `replayed: true|false`, not `outcome`; and refusals arrive as Catalog
// CATEGORIES, which the screens' rule-keyed outcome table never matched. The mapping below is pinned
// against the real server by functions/test/catalogPartIdentifierEmployeeContractPostgres.test.mjs and
// test/partIdentifierEmployeeWorkflow.test.jsx.
async function invoke(operation, payload) {
  if (!PART_IDENTIFIER_TRANSPORT_READY) {
    return { errorStatus: NOT_READY_STATUS, errorDetail: null };
  }
  const { catalogApiClient } = await import("./catalogApiClient.js");
  const res = await catalogApiClient.call(operation, payload);
  if (res.ok) return { result: res.result };
  return { errorStatus: mapCatalogFailure(res.code), errorDetail: refusalDetail(operation, res) };
}

// The Catalog sends the refusal CATEGORY, not the rule; within one operation each category has one meaning
// (postgresPartAliasWriter.ts), so the rule the screen words is recovered per operation. The DQ-034 hold keeps
// its own code, which the hook recognizes before anything else.
const DETAIL_BY_OPERATION = Object.freeze({
  createPartAlias: Object.freeze({ CONFLICT: "ALIAS_CONFLICT", FORBIDDEN: "DENIED", INVALID_INPUT: "INVALID" }),
  deactivatePartAlias: Object.freeze({ CONFLICT: "VERSION_CONFLICT", PRECONDITION_FAILED: "ALREADY_IN_STATE", NOT_FOUND: "NOT_FOUND", FORBIDDEN: "DENIED" }),
  reactivatePartAlias: Object.freeze({ CONFLICT: "VERSION_CONFLICT", PRECONDITION_FAILED: "ALREADY_IN_STATE", NOT_FOUND: "NOT_FOUND", FORBIDDEN: "DENIED" }),
  listPartAliases: Object.freeze({ FORBIDDEN: "DENIED" }),
  probePartAlias: Object.freeze({ FORBIDDEN: "DENIED", INVALID_INPUT: "INVALID" }),
});
function refusalDetail(operation, res) {
  if (res.reason === "CATALOG_MUTATION_HELD") return res.reason;
  return DETAIL_BY_OPERATION[operation]?.[res.code] ?? res.reason ?? null;
}

const millis = (iso) => {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** One governed alias row (CanonicalPartAlias) -> the row the identifier screens render. */
export function toScreenAlias(row) {
  return {
    aliasId: row.aliasId,
    partId: row.partId,
    aliasType: row.aliasType,
    value: row.originalValue,
    normalizedValue: row.normalizedValue ?? null,
    status: row.status,
    source: row.source ?? null,
    manufacturerId: row.manufacturerId ?? null,
    effectiveFrom: row.effectiveFrom ?? null,
    effectiveTo: row.effectiveTo ?? null,
    version: row.version,
    createdAtMillis: millis(row.createdAt),
    updatedAtMillis: millis(row.updatedAt),
  };
}

/** A governed alias write answer ({ aliasId, partId, version, status, replayed }) -> the screens' outcome. */
function toWriteResult(out) {
  if (!out.result) return out;
  const r = out.result;
  if (typeof r !== "object" || typeof r.replayed !== "boolean" || !Number.isInteger(r.version)) {
    return { errorStatus: "internal", errorDetail: null };
  }
  return { result: { ...r, outcome: r.replayed ? "replayed" : "applied" } };
}

/** The Catalog API's categories, in the status vocabulary the screens already render. */
function mapCatalogFailure(code) {
  if (code === "FORBIDDEN" || code === "NOT_SIGNED_IN") return "permission-denied";
  if (code === "NOT_FOUND") return "not-found";
  if (code === "INVALID_INPUT") return "invalid-argument";
  if (code === "CONFLICT" || code === "PRECONDITION_FAILED") return "failed-precondition";
  if (code === "NOT_CONFIGURED" || code === "UNREACHABLE" || code === "UNAVAILABLE") return "unavailable";
  return "internal";
}

// The Catalog answers the bare list (no row cap); the screens read { partId, aliases, truncated, limit }.
// Anything that is not that governed list is an error, never an empty list.
export const listPartAliases = async ({ partId }) => {
  const out = await invoke(CALLABLE_NAMES.list, { partId });
  if (!out.result) return out;
  if (!Array.isArray(out.result)) return { errorStatus: "internal", errorDetail: null };
  return { result: { partId, aliases: out.result.map(toScreenAlias), truncated: false, limit: null } };
};

// idempotencyKey is carried through VERBATIM and never regenerated here: the caller owns generating
// it once per user intent and reusing it across a retry of that same intent, which is what makes a
// double-send safe.
export const createPartAlias = async ({ partId, aliasType, rawValue, manufacturerId, source, idempotencyKey }) =>
  toWriteResult(await invoke(CALLABLE_NAMES.create, {
    partId,
    aliasType,
    rawValue,
    idempotencyKey,
    ...(manufacturerId ? { manufacturerId } : {}),
    ...(source ? { source } : {}),
  }));

export const deactivatePartAlias = async ({ aliasId, expectedVersion, idempotencyKey }) =>
  toWriteResult(await invoke(CALLABLE_NAMES.deactivate, { aliasId, expectedVersion, idempotencyKey }));

export const reactivatePartAlias = async ({ aliasId, expectedVersion, idempotencyKey }) =>
  toWriteResult(await invoke(CALLABLE_NAMES.reactivate, { aliasId, expectedVersion, idempotencyKey }));

export const probePartAlias = ({ aliasType, rawValue, manufacturerId }) =>
  invoke(CALLABLE_NAMES.probe, {
    aliasType,
    rawValue,
    ...(manufacturerId ? { manufacturerId } : {}),
  });

// resolveScannedIdentifier was removed (CAT-2): it named resolveScannedPartIdentifier, an operation EOS never
// exposed -- the retired callable is SUPERSEDED by lookupScannedPart's alias half (Firebase retirement F3b). It had
// no caller; had one appeared, the Catalog client would have refused it as UNKNOWN_OPERATION.
export const partAliasCallableClient = Object.freeze({
  listPartAliases,
  createPartAlias,
  deactivatePartAlias,
  reactivatePartAlias,
  probePartAlias,
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
