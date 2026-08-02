"use strict";

// EI Truck Registry — GATE D governed FUNCTIONS deployment verifier CORE. Repository-only; this
// module NEVER self-executes and performs NO production I/O — every effect is injected. The
// committed operator CLI (truckFunctionsVerifierCli.js) wires the reviewed real dependencies;
// running it against production is a separately Owner-authorized action (readiness stays false).
//
// Lifecycle (finally-style): (1) pin authorized project + region + governed commit BEFORE any
// effect; (2) discover the exact eight exports @ us-central1; (3) seed disposable prefixed
// warehouse/employee fixtures + provision disposable prefixed personas (recorded durably BEFORE
// sign-in); (4) prove authorization denial (unauthenticated + unauthorized) for all eight; (5) drive
// the governed authorized success sequence (7 applied, version 1..7) with deactivate returning the
// expected fail-closed INVENTORY_STATE_UNKNOWN; (6) emit ONE sanitized evidence object; (7) ALWAYS
// clean up and independently verify zero residual documents AND zero residual Auth users. The
// original assertion error is preserved; the durable manifest is retained on any cleanup/residual
// failure and completed only when both succeed. Fail-closed on malformed/partial/contradictory
// adapter results.
const {
  CALLABLES,
  REGION,
  AUTHENTICATED_PERSONAS,
  SEED_FIXTURES,
  PREFIX_SWEEP_COLLECTIONS,
  AUDIT_COLLECTION,
  buildDenialMatrix,
  SUCCESS_SEQUENCE,
  MATRIX_TOTAL,
  buildCrosswalk,
} = require("./truckFunctionsVerificationMatrix");
const { VerificationError } = require("./firestoreDeploymentVerificationShared");

// Compiled-in governed pins — values a local config can NEVER weaken.
const EXPECTED_PROJECT = "taylor-parts";
const EXPECTED_REGION = REGION;

// ----- pure helpers -------------------------------------------------------------------------

// Normalize an adapter invoke result to { ok, code, data }, failing closed on a malformed or
// CONTRADICTORY shape (ok:true with a code, ok:false with data, or neither).
function normalizeInvokeResult(result) {
  if (!result || typeof result !== "object") throw new VerificationError("callable result is malformed (not an object).");
  if (result.ok === true) {
    if (result.code !== undefined) throw new VerificationError("callable result is contradictory (ok:true with a code).");
    if (!result.data || typeof result.data !== "object") throw new VerificationError("callable success result has no data object.");
    return { ok: true, data: result.data };
  }
  if (result.ok === false) {
    if (result.data !== undefined) throw new VerificationError("callable result is contradictory (ok:false with data).");
    if (typeof result.code !== "string" || result.code.length === 0) throw new VerificationError("callable failure result has no code.");
    return { ok: false, code: result.code };
  }
  throw new VerificationError("callable result is malformed (missing ok boolean).");
}

// Export discovery: EVERY one of the eight callables must be present at us-central1. A missing
// callable, a wrong region, or a malformed listing fails closed.
function interpretDiscovery(functions) {
  if (!Array.isArray(functions)) throw new VerificationError("discovery returned a non-array.");
  const byName = new Map();
  for (const f of functions) {
    if (!f || typeof f.name !== "string") throw new VerificationError("discovery entry is malformed (no name).");
    byName.set(f.name, typeof f.region === "string" ? f.region : null);
  }
  const rows = CALLABLES.map((name) => {
    const region = byName.get(name);
    const present = byName.has(name);
    const pass = present && region === EXPECTED_REGION;
    return { label: `discovery:${name}`, callable: name, present, region, pass };
  });
  return rows;
}

function interpretDenial(row, result) {
  const norm = normalizeInvokeResult(result);
  if (norm.ok) return { label: row.label, persona: row.persona, callable: row.callable, expectedCode: row.expectedCode, code: null, pass: false, interpretation: "UNEXPECTED_SUCCESS" };
  const pass = norm.code === row.expectedCode;
  return { label: row.label, persona: row.persona, callable: row.callable, expectedCode: row.expectedCode, code: norm.code, pass, interpretation: pass ? "DENIED" : "WRONG_CODE" };
}

function interpretSequenceStep(step, result) {
  const norm = normalizeInvokeResult(result);
  if (step.expectFailClosed) {
    if (norm.ok) return { label: `seq:${step.key}:${step.callable}`, key: step.key, callable: step.callable, pass: false, interpretation: "UNEXPECTED_SUCCESS", version: norm.data.version };
    const pass = norm.code === step.expectFailClosed;
    return { label: `seq:${step.key}:${step.callable}`, key: step.key, callable: step.callable, code: norm.code, pass, interpretation: pass ? "FAIL_CLOSED_AS_EXPECTED" : "WRONG_FAILURE_CODE" };
  }
  if (!norm.ok) return { label: `seq:${step.key}:${step.callable}`, key: step.key, callable: step.callable, code: norm.code, pass: false, interpretation: "UNEXPECTED_FAILURE" };
  const version = norm.data.version;
  const pass = norm.data.outcome === "applied" && version === step.expectVersion;
  return { label: `seq:${step.key}:${step.callable}`, key: step.key, callable: step.callable, version, expectVersion: step.expectVersion, pass, interpretation: pass ? "APPLIED" : "WRONG_OUTCOME_OR_VERSION" };
}

// Well-formed denial payload — valid idempotencyKey/ids/expectedVersion so ONLY authorization can
// cause the failure (never invalid-argument masking).
function denialPayload(callable, idempotencyKey, truckId) {
  const base = { idempotencyKey, truckId, expectedVersion: 1 };
  switch (callable) {
    case "createTruckCallable":
      return { idempotencyKey, truckId, locationId: `${truckId}_loc`, homeWarehouseId: `${truckId}_wh`, status: "ACTIVE", assignedDriverEmployeeId: null, displayLabel: "denial-probe", vehicleNumber: "DP-1" };
    case "assignTruckDriverCallable":
    case "reassignTruckDriverCallable":
      return { ...base, employeeId: `${truckId}_emp` };
    case "unassignTruckDriverCallable":
      return base;
    case "changeTruckStatusCallable":
      return { ...base, status: "IDLE" };
    case "changeTruckHomeWarehouseCallable":
      return { ...base, homeWarehouseId: `${truckId}_wh` };
    case "deactivateTruckCallable":
      return base;
    case "reactivateTruckCallable":
      return { ...base, targetStatus: "ACTIVE" };
    default:
      throw new VerificationError(`unknown callable: ${callable}`);
  }
}

// Governed success-sequence payload for a step (uses the running version for CAS).
function sequencePayload(step, ctx) {
  const { idempotencyKey, truckId, locationId, fixtures, version } = ctx;
  switch (step.key) {
    case "create":
      return { idempotencyKey, truckId, locationId, homeWarehouseId: fixtures.wh1, status: "ACTIVE", assignedDriverEmployeeId: null, displayLabel: `GateD ${truckId}`, vehicleNumber: "GD-1" };
    case "assign":
      return { idempotencyKey, truckId, employeeId: fixtures.emp1, expectedVersion: version };
    case "reassign":
      return { idempotencyKey, truckId, employeeId: fixtures.emp2, expectedVersion: version };
    case "unassign":
      return { idempotencyKey, truckId, expectedVersion: version };
    case "status":
      return { idempotencyKey, truckId, status: step.status, expectedVersion: version };
    case "warehouse":
      return { idempotencyKey, truckId, homeWarehouseId: fixtures.wh2, expectedVersion: version };
    case "deactivate":
      return { idempotencyKey, truckId, expectedVersion: version };
    case "reactivate":
      return { idempotencyKey, truckId, targetStatus: step.targetStatus, expectedVersion: version };
    default:
      throw new VerificationError(`unknown sequence step: ${step.key}`);
  }
}

// Fail closed if any ACTUAL run-specific sensitive value (tokens, persona emails, created UIDs, the
// run prefix, absolute paths) reaches SANITIZED evidence — while permitting governed
// callable/persona/label identifiers (plain names).
function assertRunSecretFree(value, secrets = []) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const s of secrets) {
    if (s && typeof s === "string" && s.length >= 3 && text.includes(s)) {
      throw new VerificationError("Evidence contains a run-specific sensitive value.");
    }
  }
  const shapes = [
    /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT / ID token
    /AIza[0-9A-Za-z_-]{20,}/, // Google API key
    /\bBearer\s+[A-Za-z0-9._-]{10,}/i, // bearer token
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, // email address
    /(?:\/home\/|\/Users\/|[A-Za-z]:\\)/, // absolute/local path
    /\bsecret\b/i,
  ];
  for (const re of shapes) {
    if (re.test(text)) throw new VerificationError("Evidence matches a sensitive-value shape.");
  }
}

// (1) Governed pins — enforced BEFORE any effect. Binds the authorized project on the config AND the
// real dependency target, and requires the reviewed governed commit to equal the checkout the
// operator actually runs from (targetCommit).
function assertGovernedPins(config, targetProject, targetCommit) {
  if (!config || typeof config !== "object") throw new VerificationError("config must be an object.");
  if (config.projectId !== EXPECTED_PROJECT) throw new VerificationError(`config.projectId must be ${EXPECTED_PROJECT}.`);
  if (config.confirmProject !== config.projectId) throw new VerificationError("config.confirmProject must equal config.projectId.");
  if (targetProject !== EXPECTED_PROJECT) throw new VerificationError("dependency target project must equal the authorized project.");
  if (!/^[0-9a-f]{40}$/.test(config.governedCommit || "")) throw new VerificationError("config.governedCommit must be a 40-hex commit SHA.");
  if (typeof targetCommit !== "string" || targetCommit !== config.governedCommit) {
    throw new VerificationError("checkout HEAD must equal the reviewed config.governedCommit (clean exact-head).");
  }
}

// ----- lifecycle: cleanup + residual (injected admin deps) ----------------------------------

// Idempotent cleanup over the manifest + a documentId-prefix re-sweep of the fixture/created
// collections + an actor-scoped sweep of auditEvents (the ONLY run docs not prefix-addressable) +
// an Auth-prefix sweep. Per-entry failures are COLLECTED and surfaced; sweeps are not swallowed.
async function cleanup({ admin, manifest, prefix, actorUids, log = () => {} }) {
  const errors = [];
  let deletedDocs = 0;
  let deletedUsers = 0;
  for (const entry of manifest) {
    try {
      if (entry.kind === "DOC") { await admin.deleteDoc(entry.ref); deletedDocs += 1; }
      else if (entry.kind === "USER") { await admin.deleteUser(entry.ref); deletedUsers += 1; }
    } catch (e) { errors.push(`${entry.kind} ${entry.ref}: ${e && e.code ? e.code : "delete-failed"}`); }
  }
  const sweepUsers = await admin.listUsersByPrefix(prefix); // not swallowed
  for (const uid of sweepUsers) { try { await admin.deleteUser(uid); deletedUsers += 1; } catch { errors.push(`sweep USER ${uid}: delete-failed`); } }
  for (const col of PREFIX_SWEEP_COLLECTIONS) {
    const ids = await admin.listDocIdsByPrefix(col, prefix); // not swallowed
    for (const id of ids) { try { await admin.deleteDoc(`${col}/${id}`); deletedDocs += 1; } catch { errors.push(`sweep DOC ${col}/${id}: delete-failed`); } }
  }
  // auditEvents created by the disposable personas (applied + denied events) — keyed by a
  // non-prefixed deterministic id, so swept by actorUid instead of prefix.
  for (const uid of actorUids) {
    const ids = await admin.listAuditIdsByActor(uid); // not swallowed
    for (const id of ids) { try { await admin.deleteDoc(`${AUDIT_COLLECTION}/${id}`); deletedDocs += 1; } catch { errors.push(`sweep AUDIT ${id}: delete-failed`); } }
  }
  log(`CLEANUP-DONE for ${prefix}`);
  return { deletedDocs, deletedUsers, errors, ok: errors.length === 0, marker: `CLEANUP-DONE for ${prefix}` };
}

// Residual verification: (a) EVERY manifest entry is gone (catches uid-keyed users/{uid} role docs a
// prefix sweep cannot find); (b) prefix-sweep every fixture/created collection; (c) actor-sweep
// auditEvents for every disposable persona; (d) Auth-prefix sweep. Fail unless all are zero.
async function residualCheck({ admin, manifest = [], prefix, actorUids }) {
  let residualDocs = 0;
  let residualUsers = 0;
  for (const e of manifest) {
    if (e.kind === "DOC" && (await admin.docExists(e.ref))) residualDocs += 1;
    if (e.kind === "USER" && (await admin.userExists(e.ref))) residualUsers += 1;
  }
  for (const col of PREFIX_SWEEP_COLLECTIONS) {
    residualDocs += (await admin.listDocIdsByPrefix(col, prefix)).length;
  }
  for (const uid of actorUids) {
    residualDocs += (await admin.listAuditIdsByActor(uid)).length;
  }
  residualUsers += (await admin.listUsersByPrefix(prefix)).length;
  return { residualDocs, residualUsers, ok: residualDocs === 0 && residualUsers === 0 };
}

// ----- orchestration (injected deps; unit-tested with fakes) ---------------------------------

// deps: { config, targetProject, targetCommit, discovery:{listFunctions()}, auth:{provisionPersona},
//         callable:{invoke({name,token,data})}, admin:{seedDoc,docExists,deleteDoc,deleteUser,
//         userExists,listUsersByPrefix,listDocIdsByPrefix,listAuditIdsByActor}, evidence:{write},
//         manifestStore:{append,retain,complete}, prefix, verifyDate, log }
async function runVerification(deps) {
  const { config, targetProject, targetCommit, discovery, auth, callable, admin, evidence, manifestStore, prefix, verifyDate, log = () => {} } = deps;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(verifyDate || "")) throw new VerificationError("verifyDate must be YYYY-MM-DD.");
  if (!/^trf_[A-Za-z0-9]+_[0-9a-f]{8,}$/.test(prefix || "")) throw new VerificationError("prefix must be high-entropy and run-unique (trf_<tag>_<hex>).");
  if (!manifestStore || typeof manifestStore.append !== "function" || typeof manifestStore.retain !== "function" || typeof manifestStore.complete !== "function") {
    throw new VerificationError("a durable manifestStore { append, retain, complete } is required.");
  }
  if (!callable || typeof callable.invoke !== "function") throw new VerificationError("a callable.invoke dependency is required.");

  // (1) Pins BEFORE any effect — no fixture, no token is created before this passes.
  assertGovernedPins(config, targetProject, targetCommit);

  const manifest = [];
  const secrets = [prefix];
  const actorUids = [];
  const record = async (entry) => { manifest.push(entry); await manifestStore.append(entry); };

  let result = null;
  let primaryError = null;
  try {
    // (2) Export discovery @ us-central1 — read-only; no fixtures created yet.
    const discovered = interpretDiscovery(await discovery.listFunctions());
    for (const d of discovered) {
      if (!d.pass) throw new VerificationError(`discovery mismatch ${d.callable}: present=${d.present} region=${d.region}`);
    }
    log(`DISCOVERY-OK ${CALLABLES.length} callables @ ${EXPECTED_REGION}`);

    // (3a) Seed disposable prefixed fixtures (preflight absence; record AFTER success).
    const fixtures = {};
    for (const f of SEED_FIXTURES) {
      const id = `${prefix}_${f.key}`;
      const path = `${f.collection}/${id}`;
      if (await admin.docExists(path)) throw new VerificationError(`fixture collision (seed): ${path}`);
      await admin.seedDoc(f.collection, id, f.fields);
      await record({ kind: "DOC", ref: path });
      fixtures[f.key] = id;
    }

    // (3b) Provision disposable prefixed personas (records USER + role DOC BEFORE sign-in).
    const tokens = { unauthenticated: null };
    for (const persona of AUTHENTICATED_PERSONAS) {
      const provisioned = await auth.provisionPersona(persona, prefix, record);
      if (!provisioned || typeof provisioned.uid !== "string" || !provisioned.uid || typeof provisioned.token !== "string" || !provisioned.token) {
        throw new VerificationError(`persona provisioning for ${persona} returned no uid/token`);
      }
      tokens[persona] = provisioned.token;
      actorUids.push(provisioned.uid);
      secrets.push(provisioned.token, provisioned.uid);
    }

    // (4) Authorization-denial matrix — all eight deny unauthenticated + unauthorized.
    const denialRows = [];
    let denialIdx = 0;
    for (const row of buildDenialMatrix()) {
      const idempotencyKey = `${prefix}_deny_${denialIdx}`;
      const denialTruckId = `${prefix}_deny_${denialIdx}`; // never created (denied before any write)
      denialIdx += 1;
      const out = await callable.invoke({ name: row.callable, token: tokens[row.persona], data: denialPayload(row.callable, idempotencyKey, denialTruckId) });
      const interpreted = interpretDenial(row, out);
      denialRows.push(interpreted);
      if (!interpreted.pass) throw new VerificationError(`Denial mismatch ${row.label}: ${interpreted.interpretation} code=${interpreted.code}`);
    }
    log(`DENIAL-OK ${denialRows.length} rows`);

    // (5) Governed authorized success sequence (admin). Record the docs createTruck WILL create
    // BEFORE the attempt (record-before-attempt), then drive version 1..7 with deactivate fail-closed.
    const truckId = `${prefix}_truck`;
    const locationId = `${prefix}_loc`;
    let version = 0;
    const seqRows = [];
    for (const step of SUCCESS_SEQUENCE) {
      if (step.key === "create") {
        await record({ kind: "DOC", ref: `trucks/${truckId}` });
        await record({ kind: "DOC", ref: `mobile_locations/${locationId}` });
        await record({ kind: "DOC", ref: `location_truck_claims/${locationId}` });
      }
      const idempotencyKey = `${prefix}_seq_${step.key}`;
      const data = sequencePayload(step, { idempotencyKey, truckId, locationId, fixtures, version });
      const out = await callable.invoke({ name: step.callable, token: tokens.admin, data });
      const interpreted = interpretSequenceStep(step, out);
      seqRows.push(interpreted);
      if (!interpreted.pass) throw new VerificationError(`Sequence mismatch ${step.key}: ${interpreted.interpretation}`);
      if (!step.expectFailClosed) version = interpreted.version; // deactivate does not advance version
    }
    log(`SEQUENCE-OK applied through v${version}`);

    // (6) ONE sanitized evidence object.
    const report = {
      verified: true,
      verify_date: verifyDate,
      note: "Gate D governed post-deployment verification of the eight trusted truck callables. Sanitized; no run-specific values.",
      governedCommit: config.governedCommit,
      project: EXPECTED_PROJECT,
      region: EXPECTED_REGION,
      matrix_total: MATRIX_TOTAL,
      discovery: { total: discovered.length, passed: discovered.filter((d) => d.pass).length, results: discovered.map((d) => ({ label: d.label, region: d.region, pass: d.pass })) },
      denial: { total: denialRows.length, passed: denialRows.filter((r) => r.pass).length, results: denialRows.map((r) => ({ label: r.label, expectedCode: r.expectedCode, pass: r.pass })) },
      sequence: { total: seqRows.length, passed: seqRows.filter((r) => r.pass).length, results: seqRows.map((r) => ({ label: r.label, interpretation: r.interpretation, pass: r.pass })) },
      passed: discovered.filter((d) => d.pass).length + denialRows.filter((r) => r.pass).length + seqRows.filter((r) => r.pass).length,
      crosswalk: buildCrosswalk(),
    };
    assertRunSecretFree(report, secrets); // (7) never write a run secret
    await evidence.write({ "verification-report.json": report }, secrets);
    result = { report, matrixTotal: MATRIX_TOTAL };
  } catch (e) {
    primaryError = e; // preserve the ORIGINAL assertion/precondition error
  }

  const attachLifecycle = (err, info) => {
    err.lifecycleFailure = info;
    err.recoveryRetained = true;
    err.recoveryLocation = (manifestStore && manifestStore.file) || "operator recovery manifest (see --recovery-dir)";
    return err;
  };

  // Cleanup + independent residual — ALWAYS run. Infra failure is surfaced, never silent.
  let cleanupOutcome;
  let residual;
  try {
    cleanupOutcome = await cleanup({ admin, manifest, prefix, actorUids, log });
    residual = await residualCheck({ admin, manifest, prefix, actorUids });
    log(`RESIDUAL-DOCS ${residual.residualDocs} ; RESIDUAL-AUTH-USERS ${residual.residualUsers}`);
  } catch (lifecycleInfraError) {
    await manifestStore.retain();
    const info = { stage: "cleanup-or-residual-infra", message: lifecycleInfraError && lifecycleInfraError.message };
    if (primaryError) throw attachLifecycle(primaryError, info);
    throw attachLifecycle(lifecycleInfraError, info);
  }

  const lifecycleFailed = !cleanupOutcome.ok || !residual.ok;
  if (lifecycleFailed) {
    await manifestStore.retain();
    const info = { cleanupOk: cleanupOutcome.ok, cleanupErrors: cleanupOutcome.errors, residualDocs: residual.residualDocs, residualUsers: residual.residualUsers };
    if (primaryError) throw attachLifecycle(primaryError, info);
    throw attachLifecycle(new VerificationError(`LIFECYCLE FAILURE — cleanup.ok=${cleanupOutcome.ok} residual docs=${residual.residualDocs} users=${residual.residualUsers} errors=${JSON.stringify(cleanupOutcome.errors)}`), info);
  }

  await manifestStore.complete();
  if (primaryError) throw primaryError; // assertion error preserved even though cleanup succeeded
  result.cleanup = cleanupOutcome;
  result.residual = residual;
  return result;
}

module.exports = {
  EXPECTED_PROJECT,
  EXPECTED_REGION,
  normalizeInvokeResult,
  interpretDiscovery,
  interpretDenial,
  interpretSequenceStep,
  denialPayload,
  sequencePayload,
  assertRunSecretFree,
  assertGovernedPins,
  cleanup,
  residualCheck,
  runVerification,
};

// This core module never self-executes and does no production I/O. The operator entry point is
// functions/scripts/truckFunctionsVerifierCli.js; production execution requires separate Owner
// authorization. See docs/operations/truck-registry-functions-deploy-handoff.md.
