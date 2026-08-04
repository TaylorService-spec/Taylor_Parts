"use strict";

// EI Phase-2 Receiving -- Gate E2-V production verifier: PURE, fail-closed core. Given injected adapters
// (Firestore REST for the receiving_orders client-denial probes, gcloud functions discovery, the callable
// HTTPS protocol, and an Admin-SDK receiving_orders baseline read), it proves -- WITHOUT executing any
// receipt and with ZERO writes:
//   (1) discovery: both callables present @ us-central1 (exact names);
//   (2) receiving_orders client-denial: unauth + authenticated read/write all HTTP 403;
//   (3) callable denial: each callable rejects an unauthenticated call with UNAUTHENTICATED;
//   (4) receiving_orders unchanged: identity-set + count identical to the pre-probe baseline.
// It NEVER emits raw tokens/keys/PII: only a sanitized report of labels + pass flags + bounded counts.
// runVerification exits fail-closed -- any missing/extra/malformed/unexpected result flips pass=false and
// (in the CLI) a non-zero exit; sanitized evidence is published atomically only by the operator CLI.

const {
  CALLABLES, REGION, RECEIVING_ORDERS_DOC, RULES_DENIAL_CASES, CALLABLE_DENIAL_CASES, MATRIX_TOTAL,
} = require("./receivingE2VerificationMatrix");
const { VerificationError, sha256, canonicalJson, assertEvidenceSecretFree } = require("./firestoreDeploymentVerificationShared");

const EXPECTED_PROJECT = "taylor-parts";
const EXPECTED_REGION = REGION;

// ---- config -------------------------------------------------------------
function assertConfig(config) {
  if (!config || typeof config !== "object") throw new VerificationError("config must be an object");
  if (config.projectId !== EXPECTED_PROJECT) throw new VerificationError(`config.projectId must be ${EXPECTED_PROJECT}`);
  if (config.confirmProject !== config.projectId) throw new VerificationError("confirmProject must equal projectId");
  if (!/^[0-9a-f]{40}$/.test(config.governedCommit || "")) throw new VerificationError("governedCommit must be a full 40-hex SHA");
  if (!/^[A-Z][A-Z0-9_]*$/.test(config.webApiKeyEnv || "")) throw new VerificationError("webApiKeyEnv must name an env var");
  if (!/^[A-Z][A-Z0-9_]*$/.test(config.testEmailEnv || "")) throw new VerificationError("testEmailEnv must name an env var");
  if (!/^[A-Z][A-Z0-9_]*$/.test(config.testPasswordEnv || "")) throw new VerificationError("testPasswordEnv must name an env var");
  return config;
}

// ---- pure interpreters --------------------------------------------------

// Strict live-Rules source extraction (P1-3): REQUIRE a file whose name ends with firestore.rules; never
// silently fall back to files[0].
function extractRulesSourceStrict(apiPayload) {
  const files = apiPayload && apiPayload.source && apiPayload.source.files;
  if (!Array.isArray(files) || files.length === 0) throw new VerificationError("live Rules API response has no source files");
  const named = files.filter((f) => String(f && f.name || "").endsWith("firestore.rules"));
  if (named.length !== 1) throw new VerificationError(`expected exactly one firestore.rules source file, found ${named.length}`);
  const content = named[0].content;
  if (typeof content !== "string" || !content.startsWith("rules_version")) throw new VerificationError("live Rules source is empty or malformed");
  return content;
}

function interpretDiscovery(discovered) {
  // discovered: array of { name, region } from the adapter. Require BOTH callables present @ region, exact names.
  const byName = new Map((Array.isArray(discovered) ? discovered : []).map((d) => [String(d && d.name || ""), d]));
  return CALLABLES.map((name) => {
    const hit = byName.get(name);
    const region = hit ? String(hit.region || "") : "";
    const pass = Boolean(hit) && region === EXPECTED_REGION;
    return { label: `discovery:${name}`, name, region, pass };
  });
}

function interpretRulesDenial(row, status) {
  const pass = status === row.expectedStatus; // exactly 403
  return { label: row.label, principal: row.principal, method: row.method, expectedStatus: row.expectedStatus, status: typeof status === "number" ? status : null, pass };
}

function interpretCallableDenial(row, result) {
  // result: { code } extracted from the callable-protocol error, or { ok:true } if the call was accepted.
  const code = result && typeof result.code === "string" ? result.code : null;
  const pass = code === row.expectedCode; // UNAUTHENTICATED
  return { label: row.label, callable: row.callable, expectedCode: row.expectedCode, code, pass, interpretation: (result && result.ok) ? "UNEXPECTED_SUCCESS" : (pass ? "DENIED" : "UNEXPECTED_CODE") };
}

// Bounded, sanitized fingerprint of the receiving_orders identity set (sorted doc ids) + count.
function receivingOrdersFingerprint(ids) {
  const sorted = [...(Array.isArray(ids) ? ids : [])].map(String).sort();
  return { count: sorted.length, idSetHash: sha256(canonicalJson(sorted)) };
}
function interpretReceivingOrdersUnchanged(before, after) {
  const b = receivingOrdersFingerprint(before), a = receivingOrdersFingerprint(after);
  const pass = b.count === a.count && b.idSetHash === a.idSetHash;
  return { label: "receiving_orders:unchanged", before: b, after: a, pass };
}

// ---- orchestration (fail-closed) ----------------------------------------
// deps: { config, discover, probeRules, invokeCallable, readReceivingOrderIds, log? }
//  - discover(): Promise<[{name, region}]>
//  - probeRules(row): Promise<number>   // HTTP status for the receiving_orders probe
//  - invokeCallable(callable): Promise<{ ok?: true, code?: string }>   // unauthenticated call
//  - readReceivingOrderIds(): Promise<string[]>  // Admin-SDK doc ids
async function runVerification(deps) {
  const { config, discover, probeRules, invokeCallable, readReceivingOrderIds, log = () => {} } = deps;
  assertConfig(config);

  // Baseline BEFORE any probe (proves the probes wrote nothing).
  const beforeIds = await readReceivingOrderIds();

  const discovered = interpretDiscovery(await discover());
  log(`discovery: ${discovered.filter((d) => d.pass).length}/${CALLABLES.length} present@${EXPECTED_REGION}`);

  const rulesRows = [];
  for (const row of RULES_DENIAL_CASES) rulesRows.push(interpretRulesDenial(row, await probeRules(row)));

  const callableRows = [];
  for (const row of CALLABLE_DENIAL_CASES) callableRows.push(interpretCallableDenial(row, await invokeCallable(row.callable)));

  const afterIds = await readReceivingOrderIds();
  const unchanged = interpretReceivingOrdersUnchanged(beforeIds, afterIds);

  const passedCount =
    discovered.filter((d) => d.pass).length +
    rulesRows.filter((r) => r.pass).length +
    callableRows.filter((r) => r.pass).length +
    (unchanged.pass ? 1 : 0);
  const pass = passedCount === MATRIX_TOTAL;

  const report = {
    kind: "receiving-e2-verification",
    project: EXPECTED_PROJECT,
    region: EXPECTED_REGION,
    governedCommit: config.governedCommit,
    matrix_total: MATRIX_TOTAL,
    passed: passedCount,
    pass,
    discovery: { total: discovered.length, passed: discovered.filter((d) => d.pass).length, results: discovered.map((d) => ({ label: d.label, region: d.region, pass: d.pass })) },
    rulesDenial: { total: rulesRows.length, passed: rulesRows.filter((r) => r.pass).length, results: rulesRows.map((r) => ({ label: r.label, expectedStatus: r.expectedStatus, status: r.status, pass: r.pass })) },
    callableDenial: { total: callableRows.length, passed: callableRows.filter((r) => r.pass).length, results: callableRows.map((r) => ({ label: r.label, expectedCode: r.expectedCode, code: r.code, interpretation: r.interpretation, pass: r.pass })) },
    receivingOrdersUnchanged: unchanged,
  };
  // Sanitized-by-construction, but assert it (defense in depth) before returning.
  assertEvidenceSecretFree(report);
  return { report, pass, matrixTotal: MATRIX_TOTAL };
}

module.exports = {
  EXPECTED_PROJECT,
  EXPECTED_REGION,
  assertConfig,
  extractRulesSourceStrict,
  interpretDiscovery,
  interpretRulesDenial,
  interpretCallableDenial,
  interpretReceivingOrdersUnchanged,
  receivingOrdersFingerprint,
  runVerification,
};
