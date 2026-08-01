"use strict";

// EI Truck Registry — GOVERNED production smoke verifier (Gate C). Repository-only tool; it is
// NOT run in CI and NOT run against production without separate Owner authorization.
//
// It (in order): asserts LIVE-EXTRACTED-SOURCE-EQUALS-GOVERNED (bb1492b9…07) BEFORE any fixture
// creation; seeds disposable, uniquely-prefixed fixtures (Admin SDK, absence-preflighted, recorded
// only after success); runs the governed 128-check matrix with real client REST + password-auth ID
// tokens; and, in a finally-style lifecycle, ALWAYS cleans up and independently verifies zero
// residuals. It emits smoke-results.json (the required recapture artifact) + production-matrix.json.
//
// The testable core (runVerification/interpretRow/buildSmokeResults/cleanup/residualCheck/
// assertRunSecretFree) takes INJECTED dependencies, so the full lifecycle is unit-tested with fakes
// — no live project. `main()` wires the real firebase-admin + fetch + gcloud-token dependencies.
const {
  PERSONAS,
  AUTHENTICATED_PERSONAS,
  COLLECTIONS,
  buildMatrix,
  buildCrosswalk,
} = require("./truckRegistryVerificationMatrix");
const { sha256, extractRulesSource, VerificationError } = require("./firestoreDeploymentVerificationShared");

const GOVERNED_RULES_SHA256 = "bb1492b98cba95cb30ac23f7078f0fdba24befa64fa604da27d84ddc9ebac907";

// ----- pure helpers -------------------------------------------------------------------------

function interpretRow(row, status) {
  const pass = row.expected.includes(status);
  const interpretation =
    status === 200 ? "ALLOW" : status === 403 ? "DENY" : status === 401 ? "DENY_UNAUTHENTICATED" : "UNEXPECTED";
  return { label: row.label, persona: row.persona, collection: row.collection, operation: row.operation, decision: row.decision, status, expected: [...row.expected], pass, interpretation };
}

// The required recapture artifact. Rows are sanitized to ONLY {label,status,expected,pass}.
function buildSmokeResults({ rows, governedCommit, governedRulesSha256, recaptureDate }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recaptureDate || "")) throw new VerificationError("recaptureDate must be YYYY-MM-DD.");
  if (!/^[0-9a-f]{64}$/.test(governedRulesSha256 || "")) throw new VerificationError("governedRulesSha256 must be a full SHA-256.");
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

// Safeguard #7: fail closed if any ACTUAL run-specific sensitive value (tokens, persona emails,
// created UIDs, the run prefix, absolute paths) reaches durable evidence — WITHOUT rejecting safe
// governed collection/persona/operation labels (which are plain identifiers). We test against the
// concrete secret VALUES for this run plus generic token/email/path shapes.
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

// ----- lifecycle: cleanup + residual (injected admin deps) ----------------------------------

// Idempotent cleanup over the run's manifest; safe when nothing was created. Operates ONLY on
// validated paths/uids belonging to this run (recorded in the manifest) plus a prefix re-sweep.
async function cleanup({ admin, manifest, prefix, log = () => {} }) {
  let docs = 0;
  let users = 0;
  for (const entry of manifest) {
    if (entry.kind === "DOC") { await admin.deleteDoc(entry.ref).catch(() => {}); docs += 1; }
    else if (entry.kind === "USER") { await admin.deleteUser(entry.ref).catch(() => {}); users += 1; }
  }
  // Prefix re-sweep (belt-and-suspenders): any residual prefixed user/doc the manifest missed.
  const sweepUsers = await admin.listUsersByPrefix(prefix).catch(() => []);
  for (const uid of sweepUsers) { await admin.deleteUser(uid).catch(() => {}); users += 1; }
  for (const col of COLLECTIONS) {
    const ids = await admin.listDocIdsByPrefix(col.name, prefix).catch(() => []);
    for (const id of ids) { await admin.deleteDoc(`${col.name}/${id}`).catch(() => {}); docs += 1; }
  }
  log(`CLEANUP-DONE for ${prefix}`);
  return { deletedDocs: docs, deletedUsers: users, marker: `CLEANUP-DONE for ${prefix}` };
}

// Safeguard #6: residual verification INDEPENDENT of the manifest — sweep the known fixture
// collections + Auth users for the current prefix. Fail unless both counts are zero.
async function residualCheck({ admin, prefix }) {
  let residualDocs = 0;
  for (const col of COLLECTIONS) {
    const ids = await admin.listDocIdsByPrefix(col.name, prefix).catch(() => { throw new VerificationError("residual doc sweep failed"); });
    residualDocs += ids.length;
  }
  const users = await admin.listUsersByPrefix(prefix).catch(() => { throw new VerificationError("residual user sweep failed"); });
  const residualUsers = users.length;
  return { residualDocs, residualUsers, ok: residualDocs === 0 && residualUsers === 0 };
}

// ----- orchestration (injected deps; unit-tested with fakes) ---------------------------------

// deps: { config, rules:{fetchLiveSource}, auth:{authenticate(persona)->token}, probe(req)->status,
//         admin:{docExists, seedDoc, deleteDoc, createUser, deleteUser, listUsersByPrefix,
//         listDocIdsByPrefix}, evidence:{write(files, secrets)}, prefix, recaptureDate, log }
async function runVerification(deps) {
  const { config, rules, auth, probe, admin, evidence, prefix, recaptureDate, log = () => {} } = deps;
  if (!/^trc_[A-Za-z0-9]+_[0-9a-f]{8,}$/.test(prefix || "")) {
    throw new VerificationError("prefix must be high-entropy and run-unique (trc_<tag>_<hex>).");
  }
  const manifest = [];
  const secrets = [prefix];
  let outcome = null;
  let cleanupResult = null;
  let residual = null;
  try {
    // (4) HARD precondition BEFORE any creation: live extracted source == governed.
    const liveSource = extractRulesSource(await rules.fetchLiveSource());
    const liveSha = sha256(liveSource);
    if (liveSha !== config.governedRulesSha256) {
      throw new VerificationError(`LIVE-EXTRACTED-SOURCE != GOVERNED (live=${liveSha}); no fixtures created.`);
    }
    log(`LIVE-EQUALS-GOVERNED ${liveSha}`);

    // Provision one disposable, prefixed Auth user per authenticated persona and sign in. The uid
    // (recorded AFTER success) and the token are both secrets — never written to evidence. The
    // "unauthenticated" persona sends no token. Prefixed users let the residual sweep (6) find any
    // leftover independently of the manifest.
    const tokens = { unauthenticated: null };
    for (const persona of AUTHENTICATED_PERSONAS) {
      const provisioned = await auth.provisionPersona(persona, prefix);
      if (!provisioned || typeof provisioned.uid !== "string" || !provisioned.uid || typeof provisioned.token !== "string" || !provisioned.token) {
        throw new VerificationError(`persona provisioning for ${persona} returned no uid/token`);
      }
      manifest.push({ kind: "USER", ref: provisioned.uid });
      tokens[persona] = provisioned.token;
      secrets.push(provisioned.token, provisioned.uid);
    }

    // Seed one doc per collection (1): preflight absence -> create -> record AFTER success.
    const seededId = {};
    for (const col of COLLECTIONS) {
      const id = `${prefix}_seed_${col.name}`;
      const path = `${col.name}/${id}`;
      if (await admin.docExists(path)) throw new VerificationError(`fixture collision (seed): ${path}`);
      await admin.seedDoc(col.name, id);
      manifest.push({ kind: "DOC", ref: path });
      seededId[col.name] = id;
    }

    // Matrix probes.
    const rows = buildMatrix();
    const probed = [];
    for (const row of rows) {
      const seededPath = `${row.collection}/${seededId[row.collection]}`;
      let req;
      if (row.operation === "get") {
        req = { method: "GET", target: seededPath };
      } else if (row.operation === "create") {
        // (1) create-probe: preflight absence + record BEFORE the attempted client create, so an
        // unexpectedly-allowed write is still cleaned up.
        const cid = `${prefix}_create_${row.collection}_${row.persona}`;
        const cpath = `${row.collection}/${cid}`;
        if (await admin.docExists(cpath)) throw new VerificationError(`fixture collision (create-probe): ${cpath}`);
        manifest.push({ kind: "DOC", ref: cpath });
        req = { method: "POST", target: `${row.collection}?documentId=${cid}`, body: { fields: { probe: { booleanValue: true } } } };
      } else if (row.operation === "update") {
        req = { method: "PATCH", target: `${seededPath}?updateMask.fieldPaths=probe`, body: { fields: { probe: { booleanValue: true } } } };
      } else {
        req = { method: "DELETE", target: seededPath };
      }
      const status = await probe({ persona: row.persona, token: tokens[row.persona], ...req });
      const interpreted = interpretRow(row, status);
      probed.push(interpreted);
      // (2) any forbidden success or forbidden read fails the run immediately (cleanup still runs).
      if (!interpreted.pass) throw new VerificationError(`Matrix mismatch ${row.label}: ${status} not in ${JSON.stringify(row.expected)}`);
    }

    const smokeResults = buildSmokeResults({
      rows: probed,
      governedCommit: config.governedCommit,
      governedRulesSha256: config.governedRulesSha256,
      recaptureDate,
    });
    const productionMatrix = probed.map((r) => ({ label: r.label, status: r.status, expected: r.expected, pass: r.pass, interpretation: r.interpretation }));
    const files = {
      "smoke-results.json": smokeResults,
      "production-matrix.json": productionMatrix,
      "crosswalk.json": buildCrosswalk(),
    };
    // (7) sanitize every emitted file against this run's actual secrets before persisting.
    for (const v of Object.values(files)) assertRunSecretFree(v, secrets);
    await evidence.write(files, secrets);
    outcome = { smokeResults, matrixTotal: probed.length };
    return outcome;
  } finally {
    // (5) cleanup runs on success, failure, or partial creation. (6) residual verified independently.
    cleanupResult = await cleanup({ admin, manifest, prefix, log });
    residual = await residualCheck({ admin, prefix });
    log(`RESIDUAL-DOCS ${residual.residualDocs} ; RESIDUAL-AUTH-USERS ${residual.residualUsers}`);
    if (!residual.ok) {
      // Retain the manifest (do not clear) so recovery is possible; surface the failure.
      throw new VerificationError(`RESIDUAL NON-ZERO after cleanup: docs=${residual.residualDocs} users=${residual.residualUsers}`);
    }
    if (outcome) {
      outcome.cleanup = cleanupResult;
      outcome.residual = residual;
    }
  }
}

module.exports = {
  GOVERNED_RULES_SHA256,
  interpretRow,
  buildSmokeResults,
  assertRunSecretFree,
  cleanup,
  residualCheck,
  runVerification,
};

// A real-deps main() is intentionally NOT wired for autonomous execution here: production execution
// is a separately Owner-authorized action, and this repository gate authorizes NO production run.
// The recapture operator handoff invokes this module's runVerification with real firebase-admin +
// fetch + gcloud-token dependencies under that separate authorization (see
// docs/operations/truck-registry-smoke-verifier.md).
if (require.main === module) {
  // eslint-disable-next-line no-console
  console.error("This governed verifier does not self-execute. See docs/operations/truck-registry-smoke-verifier.md; production execution requires separate Owner authorization.");
  process.exit(2);
}
