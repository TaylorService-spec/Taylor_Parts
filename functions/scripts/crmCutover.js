// THE GOVERNED CRM CUTOVER -- CENSUS, COPY ONCE, VERIFY -- for Account, Contact and customer site.
//
// ============================ WHAT THIS IS ============================
//
// The operator tool for docs/architecture/crm-cutover-plan.md §3:
//
//   --mode census   READ ONLY. Snapshot census (functions/src/crm/crmCutoverSnapshot.ts) plus the target tenant's facts
//                   (functions/src/crm/crmCutoverTarget.ts): owners that do not resolve to a same-tenant Employee,
//                   dangling Contact/site -> Account references, free-text billing addresses requiring resolution,
//                   unmappable statuses, Certification fixtures excluded, eos_commercial / eos_finance rows naming an
//                   Account the copy would not provide, existing eos_crm rows. Writes nothing to PostgreSQL. With
//                   --evidenceOut it writes the reconciliation evidence file (never overwritten, 0600).
//   --mode copy     COPY ONCE into eos_crm for ONE tenant (functions/src/crm/crmCutoverCopy.ts). Refuses unless the census
//                   is copy-ready; one transaction; drift and unknown target rows refused, never overwritten.
//   --mode verify   READ ONLY. Counts, id sets, field-by-field reconciliation, FK integrity, Commercial compatibility.
//
// ============================ THE SOURCE IS A FILE ============================
//
// --snapshot names an EOS_CRM_SNAPSHOT file written by scripts/exportCrmSnapshot.js. THIS TOOL LOADS NO FIREBASE
// MODULE AND CANNOT WRITE FIRESTORE. The snapshot must name the --environment and the Firebase project that
// environment declares, and never the production project. When <snapshot>.sha256 exists it must match the bytes read.
//
// ============================ THE FENCE ============================
//
// Refuses, BEFORE `pg` or lib/ is loaded (functions/test/operatorScriptEnvironmentFence.test.mjs proves the order):
//   * no --environment declared in config/environments.json; production by role or by project id; no
//     --databaseUrlEnv (shared: measureEmployeeReferenceIntegrity.js assertMeasurementTarget)
//   * EOS_ENVIRONMENT not exactly `nonprod` (shared: measureWorkforceActivation.js assertNonprodRuntime)
//   * --environment platform-certification (the Certification world is frozen)
//   * missing --mode / --tenantKey / --snapshot; copy without --performedByPrincipalId and --evidenceOut
// The tenant is resolved by --tenantKey from eos_policy.tenants and never created or inferred.
//
// Usage (Render Shell on eos-api-nonprod):
//   node scripts/crmCutover.js --mode census --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey taylor-nonprod --snapshot ./crm-snapshot.json [--evidenceOut ./crm-census-evidence.json]
//   ... --mode copy   ... --performedByPrincipalId <EOS Principal id> --evidenceOut ./crm-copy-evidence.json \
//                     [--retainDeclaredSyntheticSeedRows]   (Owner decision: keep the manifest-declared synthetic seed rows)
//   ... --mode verify ... [--sample 50|all]
//
// Exit: 0 census copy-ready / copy applied or no-op / verify reconciled; 1 census not copy-ready or verify not
// reconciled; 2 refused or failed. Output: one deterministic JSON document; no connection string, no secrets.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { assertMeasurementTarget, parseArgs, PRODUCTION_PROJECT_ID } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");

const MODES = Object.freeze(["census", "copy", "verify"]);
const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);
const DEFAULT_SAMPLE = 50;
const PRINCIPAL_ID = /^[A-Za-z0-9_-]{1,200}$/;

/** Every refusal that can be decided from argv and the process environment alone. No client, no lib/. */
function assertCutoverInvocation(args, env) {
  if (!MODES.includes(args.mode)) {
    throw new Error(`--mode must be one of ${MODES.join(" | ")} (got ${args.mode === undefined ? "nothing" : `'${args.mode}'`}).`);
  }
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) {
    throw new Error(`--environment '${environmentId}' is the Certification world, which is frozen. The CRM cutover neither reads it as a source nor writes its tenant.`);
  }
  if (!args.tenantKey || args.tenantKey === "true") throw new Error("--tenantKey is required: the tenant is named, never inferred.");
  if (!args.snapshot || args.snapshot === "true") throw new Error("--snapshot <file> is required: the copy consumes an exported snapshot, never a live Firestore read.");
  if (args.mode === "copy") {
    if (!args.performedByPrincipalId || !PRINCIPAL_ID.test(args.performedByPrincipalId)) {
      throw new Error("--performedByPrincipalId <EOS Principal id> is required for copy: created_by/updated_by name an EOS Principal, never a Firebase uid.");
    }
    if (!args.evidenceOut || args.evidenceOut === "true") throw new Error("--evidenceOut <file> is required for copy: legacy uid provenance is written there, never into PostgreSQL.");
  }
  if (args.retainDeclaredSyntheticSeedRows !== undefined && args.retainDeclaredSyntheticSeedRows !== "true") {
    throw new Error("--retainDeclaredSyntheticSeedRows is a bare flag.");
  }
  if (args.evidenceOut && args.evidenceOut !== "true" && fs.existsSync(path.resolve(args.evidenceOut))) {
    throw new Error(`--evidenceOut ${path.resolve(args.evidenceOut)} already exists; evidence is never overwritten.`);
  }
  let sample = DEFAULT_SAMPLE;
  if (args.sample !== undefined) {
    if (args.sample === "all") sample = "all";
    else if (/^[1-9][0-9]{0,6}$/.test(args.sample)) sample = Number(args.sample);
    else throw new Error("--sample must be a positive integer or all.");
  }
  return {
    mode: args.mode,
    environmentId,
    connectionString,
    tenantKey: args.tenantKey,
    snapshotPath: args.snapshot,
    performedByPrincipalId: args.performedByPrincipalId,
    evidenceOut: args.evidenceOut && args.evidenceOut !== "true" ? path.resolve(args.evidenceOut) : null,
    retainDeclaredSynthetic: args.retainDeclaredSyntheticSeedRows === "true",
    sample,
  };
}

/** The Firebase project the environment registry declares for this environment. */
function declaredProjectId(environmentId) {
  const registry = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../config/environments.json"), "utf8"));
  const env = (registry.environments || []).find((e) => e && e.id === environmentId);
  return env && env.firebase ? env.firebase.projectId : null;
}

/** The snapshot must come from the environment being cut over, and never from production. */
function assertSnapshotSource(snapshot, environmentId) {
  const { firebaseProjectId, environmentId: snapshotEnvironment } = snapshot.source;
  if (firebaseProjectId === PRODUCTION_PROJECT_ID) {
    throw new Error(`the snapshot was exported from the production project '${PRODUCTION_PROJECT_ID}'. A production census or copy requires separate Owner authorization; refused.`);
  }
  if (snapshotEnvironment !== environmentId) {
    throw new Error(`the snapshot was exported for environment '${snapshotEnvironment}', not --environment '${environmentId}'. Refused.`);
  }
  const declared = declaredProjectId(environmentId);
  if (declared === null || firebaseProjectId !== declared) {
    throw new Error(`the snapshot names Firebase project '${firebaseProjectId}', but --environment '${environmentId}' declares '${declared}'. Refused.`);
  }
}

/** sha256 of the exact bytes; a present sidecar must agree. */
function snapshotDigest(snapshotPath, requireSidecar) {
  const bytes = fs.readFileSync(path.resolve(snapshotPath));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sidecar = `${path.resolve(snapshotPath)}.sha256`;
  if (fs.existsSync(sidecar)) {
    const recorded = fs.readFileSync(sidecar, "utf8").trim().split(/\s+/)[0];
    if (recorded !== sha256) throw new Error(`the snapshot bytes (sha256 ${sha256}) do not match ${sidecar} (${recorded}). Refused.`);
  } else if (requireSidecar) {
    throw new Error(`${sidecar} is required for copy: the copied bytes must be the checksummed export.`);
  }
  return { bytes, sha256 };
}

/** The ids the governed synthetic nonprod seed manifest DECLARES (scripts/fixtures/syntheticNonprodWorkforceSeed.v1.json). */
function declaredSyntheticIds() {
  const m = JSON.parse(fs.readFileSync(path.resolve(__dirname, "fixtures/syntheticNonprodWorkforceSeed.v1.json"), "utf8"));
  const ids = (xs) => (Array.isArray(xs) ? xs.map((x) => x.id) : []);
  return { accounts: ids(m.accounts), contacts: ids(m.contacts), locations: ids(m.locations) };
}

/** Every legacy actor string (Firebase uid, seed actor) the provenance evidence names. None may become an attribution. */
function provenanceActorsOf(evidence) {
  const out = new Set();
  for (const p of evidence.provenance) {
    for (const v of [p.createdBy, p.updatedBy, p.ownerAssignment && p.ownerAssignment.assignedToUserId, p.ownerAssignment && p.ownerAssignment.assignedByUserId]) {
      if (typeof v === "string" && v !== "") out.add(v);
    }
  }
  return [...out].sort();
}

function excludedIdsOf(evidence) {
  const out = { accounts: [], contacts: [], locations: [] };
  for (const e of evidence.certificationExcluded) out[e.collection].push(e.id);
  return out;
}

function writeEvidence(file, document) {
  fs.writeFileSync(file, JSON.stringify(document, null, 2) + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // THE FENCE FIRST, before any client or lib/ module exists.
  const options = assertCutoverInvocation(args, process.env);

  const { bytes, sha256 } = snapshotDigest(options.snapshotPath, options.mode === "copy");
  // AFTER the fence, never at module scope.
  const { parseCrmSnapshot, censusCrmSnapshot, finalizeCrmCensus } = require("../lib/crm/crmCutoverSnapshot.js");
  const snapshot = parseCrmSnapshot(JSON.parse(bytes.toString("utf8")));
  assertSnapshotSource(snapshot, options.environmentId);
  const snapshotResult = censusCrmSnapshot(snapshot);

  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const { measureCrmTarget } = require("../lib/crm/crmCutoverTarget.js");
  const client = new pg.Client(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));
  await client.connect();
  try {
    const tenant = await client.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [options.tenantKey]);
    if (tenant.rows.length !== 1) throw new Error(`no tenant with key ${options.tenantKey}; the cutover never creates one`);
    const tenantId = tenant.rows[0].id;
    const header = { mode: options.mode, environment: options.environmentId, tenantKey: options.tenantKey, tenantId, snapshotSha256: sha256 };

    await client.query("BEGIN READ ONLY");
    const target = await measureCrmTarget(client, tenantId, Object.keys(snapshotResult.census.ownerReferences));
    await client.query("COMMIT");
    const { census, crm, evidence } = finalizeCrmCensus(snapshotResult, target.facts);

    if (options.mode === "census") {
      if (options.evidenceOut) {
        writeEvidence(options.evidenceOut, { kind: "EOS_CRM_CENSUS_EVIDENCE", ...header, canonicalDigest: census.canonicalDigest, evidence });
      }
      console.log(JSON.stringify({ ...header, readOnly: true, census, target: target.report }, null, 2));
      process.exitCode = census.copyReady ? 0 : 1;
      return;
    }
    if (options.mode === "copy" && !census.copyReady) {
      console.log(JSON.stringify({ ...header, outcome: "REFUSED", reason: "CENSUS_NOT_COPY_READY", blockers: census.blockers, census }, null, 2));
      process.exitCode = 2;
      return;
    }
    const declaredSynthetic = declaredSyntheticIds();
    const policy = { declaredSynthetic, retainDeclaredSynthetic: options.retainDeclaredSynthetic };
    const { copyCrm, verifyCrm } = require("../lib/crm/crmCutoverCopy.js");
    if (options.mode === "copy") {
      // The evidence is written BEFORE the transaction: the uid provenance must exist whether or not the copy commits.
      const evidenceText = JSON.stringify({ kind: "EOS_CRM_COPY_EVIDENCE", ...header, canonicalDigest: census.canonicalDigest, evidence }, null, 2) + "\n";
      fs.writeFileSync(options.evidenceOut, evidenceText, { encoding: "utf8", flag: "wx", mode: 0o600 });
      const evidenceSha256 = createHash("sha256").update(evidenceText).digest("hex");
      const report = await copyCrm(client, {
        tenantId, performedByPrincipalId: options.performedByPrincipalId, crm, canonicalDigest: census.canonicalDigest,
        snapshotSha256: sha256, evidenceSha256, ...policy,
      });
      console.log(JSON.stringify({ ...header, evidenceSha256, report }, null, 2));
      process.exitCode = 0;
      return;
    }
    const report = await verifyCrm(client, {
      tenantId, crm, sample: options.sample, provenanceActors: provenanceActorsOf(evidence), excludedIds: excludedIdsOf(evidence), declaredSynthetic,
    });
    console.log(JSON.stringify({ ...header, canonicalDigest: census.canonicalDigest, report }, null, 2));
    process.exitCode = report.reconciled ? 0 : 1;
  } finally {
    await client.end();
  }
}

module.exports = { assertCutoverInvocation, assertSnapshotSource, snapshotDigest, MODES, FROZEN_ENVIRONMENTS };

if (require.main === module) {
  main().catch((err) => {
    // Governed refusals speak for themselves; a driver or connection error is reduced to its code, because its message
    // can carry a host or user.
    const governed = !err || !err.code || ["CrmCutoverError", "CrmSnapshotError"].includes(err.name);
    const details = err && err.details ? { details: err.details } : {};
    const message = governed ? (err instanceof Error ? err.message : String(err)) : "the run could not be completed";
    console.error(JSON.stringify({ outcome: "REFUSED_OR_FAILED", code: err && err.code ? err.code : null, message, ...details }, null, 2));
    process.exitCode = 2;
  });
}
