"use strict";

// EI Truck Registry — GOVERNED production smoke verifier core (Gate C). Repository-only; this
// module NEVER self-executes and performs no production I/O itself — all effects are injected. The
// committed operator CLI (truckRegistryVerifierCli.js) wires the reviewed real dependencies; running
// it against production is a separately Owner-authorized action.
//
// Lifecycle (finally-style): (1) pin governed hash + authorized project BEFORE any effect; (2) assert
// LIVE-EXTRACTED-SOURCE-EQUALS-GOVERNED before any fixture; (3) provision prefixed personas + seed
// disposable prefixed fixtures (absence-preflighted; durable-manifest recorded at the required
// point); (4) probe the governed 136-check matrix (incl. collection-list), failing closed; (5) emit
// sanitized evidence; (6) ALWAYS clean up and independently verify zero residuals. The original
// matrix/probe error is preserved; the durable manifest is retained on any cleanup/residual failure
// and completed only when both succeed.
const {
  AUTHENTICATED_PERSONAS,
  COLLECTIONS,
  buildMatrix,
  buildCrosswalk,
} = require("./truckRegistryVerificationMatrix");
const { sha256, extractRulesSource, VerificationError } = require("./firestoreDeploymentVerificationShared");

// Compiled-in governed pins — the authoritative values a local config can NEVER weaken.
// This is the SHA-256 of the whole governed `firestore.rules` (Git/LF source). It is
// re-pinned whenever the governed rules legitimately change: bumped from
// bb1492b9... to ec1f0a9b... to track the merged Phase-D `receiving_orders` deny-all
// block (PR #537), then to 37593fc0... to track the WO Parts Planning Phase-3 additive
// `reorder_requests.workOrderId` back-link (Owner-authorized narrow schema change). The
// smoke-verifier's own test asserts this equals HEAD:firestore.rules.
const GOVERNED_RULES_SHA256 = "12a9afeabc9c247bccd5f364a87e5fe8d38ec66613ea00df312d74d1009eb90e";
const EXPECTED_PROJECT = "taylor-parts";

// ----- pure helpers -------------------------------------------------------------------------

function interpretRow(row, status) {
  const pass = row.expected.includes(status);
  const interpretation =
    status === 200 ? "ALLOW" : status === 403 ? "DENY" : status === 401 ? "DENY_UNAUTHENTICATED" : "UNEXPECTED";
  return { label: row.label, persona: row.persona, collection: row.collection, operation: row.operation, decision: row.decision, status, expected: [...row.expected], pass, interpretation };
}

// Interpret a collection-LIST outcome. `out` = { status, ids } (ids = doc ids the list returned) or
// { malformed: true }. A malformed response fails closed. An ALLOW list must be 200 AND contain the
// seeded run-specific record (proves presence). A DENY list must be a governed denial status AND
// return NO records (no unexpected record leakage to an unauthorized principal).
function interpretListRow(row, seededId, out) {
  const status = out && typeof out.status === "number" ? out.status : 0;
  const ids = out && Array.isArray(out.ids) ? out.ids : null;
  let pass;
  let interpretation;
  if (!out || out.malformed || (status === 200 && ids === null)) {
    pass = false; interpretation = "MALFORMED";
  } else if (row.decision === "ALLOW") {
    pass = status === 200 && ids !== null && ids.includes(seededId);
    interpretation = pass ? "ALLOW_LIST_SEEDED_PRESENT" : (status === 200 ? "ALLOW_LIST_SEEDED_MISSING" : "UNEXPECTED");
  } else {
    const noLeak = ids === null || ids.length === 0;
    pass = row.expected.includes(status) && noLeak;
    interpretation = !noLeak ? "DENY_LIST_LEAKED_RECORDS" : (row.expected.includes(status) ? "DENY" : "UNEXPECTED");
  }
  return { label: row.label, persona: row.persona, collection: row.collection, operation: row.operation, decision: row.decision, status, expected: [...row.expected], pass, interpretation };
}

function buildSmokeResults({ rows, governedCommit, governedRulesSha256, recaptureDate }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recaptureDate || "")) throw new VerificationError("recaptureDate must be YYYY-MM-DD.");
  if (governedRulesSha256 !== GOVERNED_RULES_SHA256) throw new VerificationError("governed_rules_sha256 must equal the compiled governed pin.");
  const results = rows.map((r) => ({ label: r.label, status: r.status, expected: [...r.expected], pass: r.pass }));
  return {
    recaptured: true,
    recapture_date: recaptureDate,
    note: "Post-deployment recapture using the governed truck-registry smoke verifier. NOT original deployment-time output.",
    governedCommit,
    governed_rules_sha256: governedRulesSha256,
    matrix_total: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    results,
  };
}

// Fail closed if any ACTUAL run-specific sensitive value (tokens, persona emails, created UIDs, the
// run prefix, absolute paths) reaches SANITIZED evidence — while permitting governed
// collection/persona/operation labels (plain identifiers).
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
    /\bpassword\b/i,
  ];
  for (const re of shapes) {
    if (re.test(text)) throw new VerificationError("Evidence matches a sensitive-value shape.");
  }
}

// (1) Governed pins — enforced BEFORE any effect. A local config can point the precondition at a
// LATER live value only by also changing the compiled pin (impossible without a reviewed code
// change). Also binds the authorized project on both the config and the real dependencies.
function assertGovernedPins(config, targetProject) {
  if (!config || typeof config !== "object") throw new VerificationError("config must be an object.");
  if (config.governedRulesSha256 !== GOVERNED_RULES_SHA256) {
    throw new VerificationError("config.governedRulesSha256 does not equal the compiled governed pin.");
  }
  if (config.projectId !== EXPECTED_PROJECT) throw new VerificationError(`config.projectId must be ${EXPECTED_PROJECT}.`);
  if (config.confirmProject !== config.projectId) throw new VerificationError("config.confirmProject must equal config.projectId.");
  if (targetProject !== EXPECTED_PROJECT) throw new VerificationError("dependency target project must equal the authorized project.");
}

// ----- lifecycle: cleanup + residual (injected admin deps) ----------------------------------

// Idempotent cleanup over the run's manifest + a prefix re-sweep. Per-entry delete failures are
// COLLECTED and surfaced (never silently treated as success). The list sweeps are NOT swallowed —
// a sweep failure propagates so cleanup cannot falsely report success.
async function cleanup({ admin, manifest, prefix, log = () => {} }) {
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
  for (const uid of sweepUsers) { try { await admin.deleteUser(uid); deletedUsers += 1; } catch (e) { errors.push(`sweep USER ${uid}: delete-failed`); } }
  for (const col of COLLECTIONS) {
    const ids = await admin.listDocIdsByPrefix(col.name, prefix); // not swallowed
    for (const id of ids) { try { await admin.deleteDoc(`${col.name}/${id}`); deletedDocs += 1; } catch (e) { errors.push(`sweep DOC ${col.name}/${id}: delete-failed`); } }
  }
  log(`CLEANUP-DONE for ${prefix}`);
  return { deletedDocs, deletedUsers, errors, ok: errors.length === 0, marker: `CLEANUP-DONE for ${prefix}` };
}

// Residual verification: (a) check EVERY manifest entry is gone — this catches uid-keyed role docs
// (users/{uid}) that a prefix sweep cannot find — AND (b) sweep every fixture collection + the Auth
// directory for the run prefix, INDEPENDENT of the manifest. Fail unless both counts are zero. A
// sweep/existence failure throws.
async function residualCheck({ admin, manifest = [], prefix }) {
  let residualDocs = 0;
  let residualUsers = 0;
  for (const e of manifest) {
    if (e.kind === "DOC" && (await admin.docExists(e.ref))) residualDocs += 1;
    if (e.kind === "USER" && (await admin.userExists(e.ref))) residualUsers += 1;
  }
  for (const col of COLLECTIONS) {
    const ids = await admin.listDocIdsByPrefix(col.name, prefix);
    residualDocs += ids.length;
  }
  residualUsers += (await admin.listUsersByPrefix(prefix)).length;
  return { residualDocs, residualUsers, ok: residualDocs === 0 && residualUsers === 0 };
}

// ----- orchestration (injected deps; unit-tested with fakes) ---------------------------------

// deps: { config, targetProject, rules:{fetchLiveSource}, auth:{provisionPersona(persona,prefix)->{uid,token}},
//         probe(req)->status, admin:{docExists,seedDoc,deleteDoc,deleteUser,listUsersByPrefix,listDocIdsByPrefix},
//         evidence:{write(files,secrets)}, manifestStore:{append(entry),retain(),complete()},
//         prefix, recaptureDate, log }
async function runVerification(deps) {
  const { config, targetProject, rules, auth, probe, listProbe, admin, evidence, manifestStore, prefix, recaptureDate, log = () => {} } = deps;
  if (typeof listProbe !== "function") throw new VerificationError("a listProbe dependency is required.");
  if (!/^trc_[A-Za-z0-9]+_[0-9a-f]{8,}$/.test(prefix || "")) {
    throw new VerificationError("prefix must be high-entropy and run-unique (trc_<tag>_<hex>).");
  }
  if (!manifestStore || typeof manifestStore.append !== "function" || typeof manifestStore.retain !== "function" || typeof manifestStore.complete !== "function") {
    throw new VerificationError("a durable manifestStore { append, retain, complete } is required.");
  }
  // (1) Pins BEFORE any effect — no token, no user, no doc is created before this passes.
  assertGovernedPins(config, targetProject);

  const manifest = [];
  const secrets = [prefix];
  const record = async (entry) => { manifest.push(entry); await manifestStore.append(entry); }; // durable at the required point

  let result = null;
  let primaryError = null;
  try {
    // (2) live == governed BEFORE any fixture.
    const liveSource = extractRulesSource(await rules.fetchLiveSource());
    const liveSha = sha256(liveSource);
    if (liveSha !== GOVERNED_RULES_SHA256) {
      throw new VerificationError(`LIVE-EXTRACTED-SOURCE != GOVERNED (live=${liveSha}); no fixtures created.`);
    }
    log(`LIVE-EQUALS-GOVERNED ${liveSha}`);

    // Provision disposable prefixed personas. The adapter is handed `record` and MUST durably
    // record the Auth USER immediately after creating it and the uid-keyed users/{uid} role DOC
    // immediately after creating it — BEFORE sign-in — so a later sub-step failure (e.g. sign-in)
    // can never leave an unrecorded production resource. uid + token are secrets.
    const tokens = { unauthenticated: null };
    for (const persona of AUTHENTICATED_PERSONAS) {
      const provisioned = await auth.provisionPersona(persona, prefix, record);
      if (!provisioned || typeof provisioned.uid !== "string" || !provisioned.uid || typeof provisioned.token !== "string" || !provisioned.token) {
        throw new VerificationError(`persona provisioning for ${persona} returned no uid/token`);
      }
      tokens[persona] = provisioned.token;
      secrets.push(provisioned.token, provisioned.uid);
    }

    // Seed one doc per collection (preflight absence; record AFTER success).
    const seededId = {};
    for (const col of COLLECTIONS) {
      const id = `${prefix}_seed_${col.name}`;
      const path = `${col.name}/${id}`;
      if (await admin.docExists(path)) throw new VerificationError(`fixture collision (seed): ${path}`);
      await admin.seedDoc(col.name, id);
      await record({ kind: "DOC", ref: path });
      seededId[col.name] = id;
    }

    // Matrix probes.
    const rows = buildMatrix();
    const probed = [];
    for (const row of rows) {
      const seededPath = `${row.collection}/${seededId[row.collection]}`;
      let interpreted;
      if (row.operation === "list") {
        // Collection-list read (getDocs(collection(...))). listProbe returns { status, ids } (ids =
        // the doc ids the list returned) or { malformed:true }. ALLOW must be 200 AND contain the
        // seeded record; DENY must be a governed denial with NO records (no leakage).
        const out = await listProbe({ persona: row.persona, token: tokens[row.persona], collection: row.collection });
        interpreted = interpretListRow(row, seededId[row.collection], out);
      } else {
        let req;
        if (row.operation === "get") {
          req = { method: "GET", target: seededPath };
        } else if (row.operation === "create") {
          const cid = `${prefix}_create_${row.collection}_${row.persona}`;
          const cpath = `${row.collection}/${cid}`;
          if (await admin.docExists(cpath)) throw new VerificationError(`fixture collision (create-probe): ${cpath}`);
          await record({ kind: "DOC", ref: cpath }); // record BEFORE the attempt (record-before-attempt)
          req = { method: "POST", target: `${row.collection}?documentId=${cid}`, body: { fields: { probe: { booleanValue: true } } } };
        } else if (row.operation === "update") {
          req = { method: "PATCH", target: `${seededPath}?updateMask.fieldPaths=probe`, body: { fields: { probe: { booleanValue: true } } } };
        } else {
          req = { method: "DELETE", target: seededPath };
        }
        const status = await probe({ persona: row.persona, token: tokens[row.persona], ...req });
        interpreted = interpretRow(row, status);
      }
      probed.push(interpreted);
      if (!interpreted.pass) throw new VerificationError(`Matrix mismatch ${row.label}: ${interpreted.interpretation} status=${interpreted.status}`);
    }

    const smokeResults = buildSmokeResults({ rows: probed, governedCommit: config.governedCommit, governedRulesSha256: config.governedRulesSha256, recaptureDate });
    const productionMatrix = probed.map((r) => ({ label: r.label, status: r.status, expected: r.expected, pass: r.pass, interpretation: r.interpretation }));
    const files = { "smoke-results.json": smokeResults, "production-matrix.json": productionMatrix, "crosswalk.json": buildCrosswalk() };
    for (const v of Object.values(files)) assertRunSecretFree(v, secrets); // (7) never write a run secret
    await evidence.write(files, secrets);
    result = { smokeResults, matrixTotal: probed.length };
  } catch (e) {
    primaryError = e; // preserve the ORIGINAL matrix/probe/precondition error
  }

  // Attach lifecycle diagnostics to an error so the operator ALWAYS sees the cleanup outcome,
  // residual counts, and where the durable recovery manifest is — even when the primary error is
  // preserved. Never masks the primary error's type/message.
  const attachLifecycle = (err, info) => {
    err.lifecycleFailure = info;
    err.recoveryRetained = true;
    err.recoveryLocation = (manifestStore && manifestStore.file) || "operator recovery manifest (see --recovery-dir)";
    return err;
  };

  // Cleanup + independent residual — ALWAYS run. Cleanup infra failure is surfaced, never silent.
  let cleanupOutcome;
  let residual;
  try {
    cleanupOutcome = await cleanup({ admin, manifest, prefix, log });
    residual = await residualCheck({ admin, manifest, prefix });
    log(`RESIDUAL-DOCS ${residual.residualDocs} ; RESIDUAL-AUTH-USERS ${residual.residualUsers}`);
  } catch (lifecycleInfraError) {
    await manifestStore.retain(); // durable recovery state retained
    const info = { stage: "cleanup-or-residual-infra", message: lifecycleInfraError && lifecycleInfraError.message };
    if (primaryError) throw attachLifecycle(primaryError, info); // preserve original + surface lifecycle
    throw attachLifecycle(lifecycleInfraError, info);
  }

  const lifecycleFailed = !cleanupOutcome.ok || !residual.ok;
  if (lifecycleFailed) {
    await manifestStore.retain(); // retain for recovery; DO NOT complete
    const info = { cleanupOk: cleanupOutcome.ok, cleanupErrors: cleanupOutcome.errors, residualDocs: residual.residualDocs, residualUsers: residual.residualUsers };
    if (primaryError) throw attachLifecycle(primaryError, info); // preserve original error AND surface the lifecycle failure
    throw attachLifecycle(new VerificationError(`LIFECYCLE FAILURE — cleanup.ok=${cleanupOutcome.ok} residual docs=${residual.residualDocs} users=${residual.residualUsers} errors=${JSON.stringify(cleanupOutcome.errors)}`), info);
  }

  // Cleanup + residual both succeeded → fixtures verified gone → the manifest can be completed.
  await manifestStore.complete();
  if (primaryError) throw primaryError; // matrix/probe error preserved even though cleanup succeeded
  result.cleanup = cleanupOutcome;
  result.residual = residual;
  return result;
}

module.exports = {
  GOVERNED_RULES_SHA256,
  EXPECTED_PROJECT,
  interpretRow,
  interpretListRow,
  buildSmokeResults,
  assertRunSecretFree,
  assertGovernedPins,
  cleanup,
  residualCheck,
  runVerification,
};

// This core module never self-executes and does no production I/O. The operator entry point is
// functions/scripts/truckRegistryVerifierCli.js (a separate, committed CLI); production execution
// requires separate Owner authorization. See docs/operations/truck-registry-smoke-verifier.md.
