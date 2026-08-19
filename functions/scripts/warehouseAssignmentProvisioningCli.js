// X-WAREHOUSE-ASSIGNMENT-PROVISIONING -- GOVERNED tool for filling a MISSING `employees/{id}.assignedWarehouseIds`
// assignment. Repository-only. INERT on import: it does NOT run merely because it is required (only main()
// under `require.main === module` does anything), and it lazy-requires firebase-admin inside a
// production-deps closure -- so importing this file performs NO Firestore read/write and touches no
// production. Mirrors functions/scripts/salesOrderNumberBackfillCli.js's conventions (environment guard,
// dry-run default, plan-hash pinning, atomic evidence) and functions/scripts/warehouseGovernanceMigrationCli.js's
// Owner-authored-manifest pattern (WHICH warehouse an employee gets is a business decision this tool never
// makes on its own -- it only executes a manifest a human already decided and reviewed).
//
// SCOPE, deliberately narrow: this tool ONLY fills an employee's assignedWarehouseIds when it is currently
// ABSENT or EMPTY. It refuses (fails the whole plan closed) if a targeted employee already carries a
// non-empty assignedWarehouseIds -- reassigning or changing an EXISTING assignment is a different, not-yet-
// built governed action, and this tool must never silently do it.
//
// `employees/{employeeId}` is `allow create, update, delete: if false` for every client principal
// (firestore.rules) -- there is no client write path for this field under any role. All writes below run
// through the Admin SDK, exactly like functions/scripts/provisionEmployeeAccess.js (the general-purpose
// Employee provisioning tool this one complements: that tool CAN also set assignedWarehouseIds as part of a
// broader onboarding call, but has no dry-run/plan-hash/rollback discipline; THIS tool exists for the
// narrower, harder-gated "fill a governance gap under Owner-reviewed manifest" action described in the
// backfill runbook family).
//
// PRODUCTION EXECUTION IS A PROTECTED ACTION. This tool being present and working does NOT authorize running
// it against any real project; that authorization is the Owner's alone, separate from this file existing.
//
// X-BACKFILL-ENVIRONMENT-GUARD (fail-closed target guard, lives entirely inside parseArgs, copied verbatim
// in spirit from salesOrderNumberBackfillCli.js -- see that file's header for the full rationale):
// `--environment` is REQUIRED and the only accepted value is exactly "sandbox". Under `--environment
// sandbox` the only accepted `--project` is the single sandbox project id resolved from
// config/environments.json (role === "sandbox" with a real firebase.projectId). This check runs INSIDE
// parseArgs, called before buildProductionDeps() (the only place firebase-admin is required) in both
// main() and every caller -- a rejected configuration throws before firebase-admin is ever required and
// before any Firestore connection, read, or write is attempted.
"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs");

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}
function normalizeHash(h) {
  return typeof h === "string" ? h.trim().toLowerCase() : "";
}
function isHex64(h) {
  return /^[0-9a-f]{64}$/.test(h);
}
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
const SECRET_PATTERN = /(AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|password|refreshToken|idToken|client_secret)/i;
function scanForSecrets(text) {
  const found = [];
  if (SECRET_PATTERN.test(text)) found.push("secret-like-pattern");
  return found;
}

const EMPLOYEES_COLLECTION = "employees";
const WAREHOUSES_COLLECTION = "warehouses";

// ---- environment guard: read-only local file, resolved BEFORE any Firebase/Firestore code runs ----------
function loadEnvironmentRegistry() {
  const registryPath = path.resolve(__dirname, "..", "..", "config", "environments.json");
  let raw;
  try {
    raw = fs.readFileSync(registryPath, "utf8");
  } catch (err) {
    throw new Error(`--environment sandbox requires config/environments.json to be readable at ${registryPath}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`config/environments.json is not valid JSON: ${err.message}`);
  }
}

function resolveSandboxProjectId(registry) {
  const ids = [...new Set(
    (registry.environments || [])
      .filter((e) => e && e.role === "sandbox" && e.firebase && typeof e.firebase.projectId === "string" && e.firebase.projectId.length > 0)
      .map((e) => e.firebase.projectId)
  )];
  if (ids.length !== 1) {
    throw new Error(`--environment sandbox requires config/environments.json to declare exactly one sandbox project id with a real firebase.projectId; found ${ids.length} (${JSON.stringify(ids)})`);
  }
  return ids[0];
}

function assertSandboxTarget(args) {
  if (!args.environment) throw new Error('--environment is required (the only accepted value today is "sandbox"; no default, nothing inferred)');
  if (args.environment !== "sandbox") {
    throw new Error(`--environment must be exactly "sandbox"; refusing '${args.environment}' (production and any other/unknown value are rejected)`);
  }
  const allowedProjectId = resolveSandboxProjectId(loadEnvironmentRegistry());
  if (args.projectId !== allowedProjectId) {
    throw new Error(`--environment sandbox only accepts --project '${allowedProjectId}'; refusing '${args.projectId}' (taylor-parts, aliases, near-misses, and any project not byte-identical to the registry-resolved sandbox id are refused; nothing is inferred from .firebaserc or the environment)`);
  }
}

function parseArgs(argv) {
  const args = { execute: false, acknowledgeProductionWrite: false, rollback: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--execute") args.execute = true;
    else if (a === "--rollback") args.rollback = true;
    else if (a === "--acknowledge-production-write") args.acknowledgeProductionWrite = true;
    else if (a === "--environment") args.environment = argv[++i];
    else if (a === "--project") args.projectId = argv[++i];
    else if (a === "--confirm-project") args.confirmProjectId = argv[++i];
    else if (a === "--commit") args.governedCommit = argv[++i];
    else if (a === "--evidence-dir") args.evidenceDir = argv[++i];
    else if (a === "--manifest") args.manifestPath = argv[++i];
    else if (a === "--plan") args.planPath = argv[++i];
    else if (a === "--plan-sha256") args.planSha256 = argv[++i];
    else if (a === "--execution-result") args.executionResultPath = argv[++i];
    else if (a === "--operator") args.operator = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!args.projectId) throw new Error("--project is required");
  if (!args.confirmProjectId) throw new Error("--confirm-project is required (must exactly match --project)");
  if (args.confirmProjectId !== args.projectId) throw new Error("--confirm-project does not match --project; refusing to run");
  assertSandboxTarget(args);
  if (!args.governedCommit) throw new Error("--commit is required");
  if (!args.evidenceDir) throw new Error("--evidence-dir is required");
  if (!args.operator) throw new Error("--operator is required");
  if (args.execute && args.rollback) throw new Error("--execute and --rollback are mutually exclusive");
  if (args.rollback) {
    if (!args.acknowledgeProductionWrite) throw new Error("--rollback requires --acknowledge-production-write");
    if (!args.executionResultPath) throw new Error("--rollback requires --execution-result (the execution-result.json to reverse)");
  } else if (args.execute) {
    if (!args.acknowledgeProductionWrite) throw new Error("--execute requires --acknowledge-production-write");
    if (!args.planPath) throw new Error("--execute requires --plan (the dry-run plan.json to bind to)");
    if (!args.planSha256) throw new Error("--execute requires --plan-sha256 (the Owner-reviewed plan hash)");
  } else {
    if (!args.manifestPath) throw new Error("dry-run requires --manifest (the Owner-authored employeeId/warehouseId decision file)");
  }
  return args;
}

// ---- manifest validation (pure, no I/O beyond the file already read by the caller) ----
function validateManifestShape(manifest) {
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.entries)) {
    throw new Error("manifest must be a JSON object with an `entries` array");
  }
  if (manifest.entries.length === 0) throw new Error("manifest `entries` must not be empty");
  const seenEmployeeIds = new Set();
  for (const [i, entry] of manifest.entries.entries()) {
    if (!entry || typeof entry !== "object") throw new Error(`manifest.entries[${i}] must be an object`);
    if (typeof entry.employeeId !== "string" || entry.employeeId.trim() === "") {
      throw new Error(`manifest.entries[${i}].employeeId must be a non-empty string`);
    }
    if (typeof entry.warehouseId !== "string" || entry.warehouseId.trim() === "") {
      throw new Error(`manifest.entries[${i}].warehouseId must be a non-empty string`);
    }
    if (typeof entry.rationale !== "string" || entry.rationale.trim() === "") {
      throw new Error(`manifest.entries[${i}].rationale must be a non-empty string (the business reason this warehouse was chosen)`);
    }
    if (seenEmployeeIds.has(entry.employeeId)) {
      throw new Error(`manifest.entries contains a duplicate employeeId '${entry.employeeId}'`);
    }
    seenEmployeeIds.add(entry.employeeId);
  }
  return manifest.entries;
}

// Atomic evidence publish: write to a sibling temp dir, secret-scan every file, and only on a clean scan
// rename it into place. On ANY failure the temp dir is removed and NO final directory is left behind.
function publishEvidenceAtomically(fsDeps, finalDir, files) {
  const tmpDir = `${finalDir}.tmp-${fsDeps.stamp}`;
  fsDeps.rmrf(tmpDir);
  fsDeps.mkdirp(tmpDir);
  try {
    const checksums = [];
    for (const f of files) {
      const found = scanForSecrets(f.content);
      if (found.length > 0) throw new Error(`refusing to publish: evidence file ${f.name} contains secret-like content`);
      fsDeps.writeFile(path.join(tmpDir, f.name), f.content);
      checksums.push(`${sha256Hex(f.content)}  ${f.name}`);
    }
    fsDeps.writeFile(path.join(tmpDir, "checksums.sha256"), checksums.join("\n") + "\n");
    if (fsDeps.exists(finalDir)) throw new Error(`refusing to overwrite existing evidence dir ${finalDir}`);
    fsDeps.rename(tmpDir, finalDir);
    return finalDir;
  } catch (err) {
    fsDeps.rmrf(tmpDir);
    throw err;
  }
}

function planReportMarkdown(planEvidence, planFileSha256) {
  const { counts } = planEvidence;
  const lines = [
    "# Warehouse Assignment Provisioning -- dry-run plan",
    "",
    `- Generated: ${planEvidence.generatedAt}`,
    `- Project: ${planEvidence.projectId}`,
    `- Repository commit: ${planEvidence.governedCommit}`,
    `- Bind this to --plan-sha256 at execute (sha256 of plan.json bytes): ${planFileSha256}`,
    "",
    `| total entries | ready to assign | refused (non-empty already) | refused (warehouse missing/inactive) |`,
    `|---|---|---|---|`,
    `| ${counts.total} | ${counts.ready} | ${counts.refusedNonEmpty} | ${counts.refusedWarehouse} |`,
    "",
    counts.refusedNonEmpty > 0 || counts.refusedWarehouse > 0
      ? "**This plan is NOT executable as-is.** Every entry must resolve READY before execute is accepted -- see `assignments` (ready) vs `refused` in plan.json."
      : "This plan is clean: every manifest entry resolved READY. Review `assignments` in plan.json before authorizing execute.",
    "",
  ];
  return lines.join("\n");
}

function executionReportMarkdown(execEvidence) {
  return [
    "# Warehouse Assignment Provisioning -- execution result",
    "",
    `- Generated: ${execEvidence.generatedAt}`,
    `- Project: ${execEvidence.projectId}`,
    `- Repository commit: ${execEvidence.governedCommit}`,
    `- Bound plan hash: ${execEvidence.boundPlanHash}`,
    `- Assigned: ${execEvidence.assigned.length}`,
    "",
  ].join("\n");
}

function rollbackReportMarkdown(rollbackEvidence) {
  return [
    "# Warehouse Assignment Provisioning -- rollback result",
    "",
    `- Generated: ${rollbackEvidence.generatedAt}`,
    `- Project: ${rollbackEvidence.projectId}`,
    `- Reversed execution: ${rollbackEvidence.boundPlanHash}`,
    `- Restored: ${rollbackEvidence.restored.length}`,
    "",
  ].join("\n");
}

// ---- dry-run: read live employee + warehouse docs, classify each manifest entry, never write ----
async function runDryRun(deps, args) {
  const manifest = JSON.parse(await deps.readManifestRaw(args.manifestPath));
  const entries = validateManifestShape(manifest);

  const assignments = [];
  const refused = [];
  for (const entry of entries) {
    // eslint-disable-next-line no-await-in-loop
    const employee = await deps.readEmployee(entry.employeeId);
    // eslint-disable-next-line no-await-in-loop
    const warehouse = await deps.readWarehouse(entry.warehouseId);
    if (!employee.exists) {
      refused.push({ ...entry, reason: "EMPLOYEE_NOT_FOUND" });
      continue;
    }
    const currentAssigned = Array.isArray(employee.assignedWarehouseIds) ? employee.assignedWarehouseIds : [];
    if (currentAssigned.length > 0) {
      refused.push({ ...entry, reason: "ALREADY_ASSIGNED_NON_EMPTY", currentAssignedWarehouseIds: currentAssigned });
      continue;
    }
    if (!warehouse.exists) {
      refused.push({ ...entry, reason: "WAREHOUSE_NOT_FOUND" });
      continue;
    }
    if (warehouse.status !== "ACTIVE") {
      refused.push({ ...entry, reason: "WAREHOUSE_NOT_ACTIVE", warehouseStatus: warehouse.status });
      continue;
    }
    const preStateFingerprint = sha256Hex(canonicalJson({
      operationalRoles: employee.operationalRoles ?? null,
      assignedWarehouseIds: currentAssigned,
      updateTimeMillis: employee.updateTimeMillis,
    }));
    assignments.push({
      employeeId: entry.employeeId,
      warehouseId: entry.warehouseId,
      rationale: entry.rationale,
      before: currentAssigned,
      after: [entry.warehouseId],
      preStateFingerprint,
      employeeUpdateTimeMillis: employee.updateTimeMillis,
    });
  }

  const counts = {
    total: entries.length,
    ready: assignments.length,
    refusedNonEmpty: refused.filter((r) => r.reason === "ALREADY_ASSIGNED_NON_EMPTY").length,
    refusedWarehouse: refused.filter((r) => r.reason === "WAREHOUSE_NOT_FOUND" || r.reason === "WAREHOUSE_NOT_ACTIVE").length,
  };
  const planEvidence = {
    kind: "warehouse-assignment-provisioning-plan",
    schemaVersion: 1,
    projectId: args.projectId,
    governedCommit: args.governedCommit,
    generatedAt: deps.now().toISOString(),
    counts,
    assignments,
    refused,
  };
  const planJson = JSON.stringify(planEvidence, null, 2);
  const planFileSha256 = sha256Hex(planJson);
  const dir = publishEvidenceAtomically(deps.fs, args.evidenceDir, [
    { name: "plan.json", content: planJson },
    { name: "plan-report.md", content: planReportMarkdown(planEvidence, planFileSha256) },
  ]);
  return { mode: "dry-run", planEvidence, planFileSha256, evidenceDir: dir };
}

// ---- execute: bind to a reviewed plan.json by content hash, re-read live state, fail closed on ANY drift,
// then write ALL assignments in one atomic Firestore batch with an updateTime precondition per document ----
async function runExecute(deps, args) {
  const rawPlan = await deps.readPlanRaw(args.planPath);
  const expected = normalizeHash(args.planSha256);
  if (!isHex64(expected)) throw new Error("expected plan sha256 must be a normalized 64-hex value");
  const actualHash = sha256Hex(rawPlan);
  if (actualHash !== expected) throw new Error("plan hash mismatch: refusing to execute (no writes)");
  const planEvidence = JSON.parse(rawPlan);
  if (planEvidence.projectId !== args.projectId) throw new Error("plan.json project does not match --project: refusing to execute");
  if (planEvidence.governedCommit !== args.governedCommit) throw new Error("plan.json commit does not match --commit: refusing to execute");
  // Checked BEFORE the empty-assignments check: a plan with any refused entry is never executable, even if
  // it also happens to have zero ready assignments -- the more specific, more actionable reason wins.
  if (Array.isArray(planEvidence.refused) && planEvidence.refused.length > 0) {
    throw new Error(`plan.json has ${planEvidence.refused.length} refused entr${planEvidence.refused.length === 1 ? "y" : "ies"}: refusing to execute a partial batch (resolve every entry to READY and rerun dry-run for a fresh plan)`);
  }
  if (!Array.isArray(planEvidence.assignments) || planEvidence.assignments.length === 0) {
    throw new Error("plan.json has no ready assignments: refusing to execute");
  }

  // Re-read live state and recompute every planned record's pre-state fingerprint before staging ANY write.
  // ANY drift -- an employee whose assignedWarehouseIds is no longer empty, a vanished record, a changed
  // updateTime -- fails the WHOLE batch closed (zero writes), exactly like salesOrderNumberBackfillCli.js's
  // execute-time re-verification.
  const verified = [];
  for (const a of planEvidence.assignments) {
    // eslint-disable-next-line no-await-in-loop
    const employee = await deps.readEmployee(a.employeeId);
    if (!employee.exists) throw new Error(`STALE_PRESTATE: employee '${a.employeeId}' no longer exists`);
    const currentAssigned = Array.isArray(employee.assignedWarehouseIds) ? employee.assignedWarehouseIds : [];
    if (currentAssigned.length > 0) throw new Error(`STALE_PRESTATE: employee '${a.employeeId}' now has a non-empty assignedWarehouseIds`);
    if (employee.updateTimeMillis !== a.employeeUpdateTimeMillis) throw new Error(`STALE_PRESTATE: employee '${a.employeeId}' has drifted (updateTime changed since dry-run)`);
    const fingerprint = sha256Hex(canonicalJson({
      operationalRoles: employee.operationalRoles ?? null,
      assignedWarehouseIds: currentAssigned,
      updateTimeMillis: employee.updateTimeMillis,
    }));
    if (fingerprint !== a.preStateFingerprint) throw new Error(`STALE_PRESTATE: employee '${a.employeeId}' fingerprint mismatch`);
    verified.push(a);
  }

  const writeResults = await deps.writeAssignmentsBatch(verified);
  const assigned = verified.map((a, i) => ({
    employeeId: a.employeeId,
    warehouseId: a.warehouseId,
    before: a.before,
    after: a.after,
    newUpdateTimeMillis: writeResults[i].updateTimeMillis,
  }));
  const execEvidence = {
    kind: "warehouse-assignment-provisioning-execution",
    schemaVersion: 1,
    projectId: args.projectId,
    governedCommit: args.governedCommit,
    generatedAt: deps.now().toISOString(),
    boundPlanHash: actualHash,
    assigned,
  };
  const dir = publishEvidenceAtomically(deps.fs, args.evidenceDir, [
    { name: "execution-result.json", content: JSON.stringify(execEvidence, null, 2) },
    { name: "execution-report.md", content: executionReportMarkdown(execEvidence) },
  ]);
  return { mode: "execute", execEvidence, evidenceDir: dir };
}

// ---- rollback: reverse ONE prior execution-result.json, re-verify current state matches the post-execute
// state recorded there, and restore each employee's PRE-execute assignedWarehouseIds with a precondition
// bound to the post-execute updateTime -- fails closed if anything changed since the execute ----
async function runRollback(deps, args) {
  const raw = await deps.readExecutionResultRaw(args.executionResultPath);
  const execEvidence = JSON.parse(raw);
  if (execEvidence.projectId !== args.projectId) throw new Error("execution-result.json project does not match --project: refusing to rollback");
  if (execEvidence.governedCommit !== args.governedCommit) throw new Error("execution-result.json commit does not match --commit: refusing to rollback");
  if (!Array.isArray(execEvidence.assigned) || execEvidence.assigned.length === 0) {
    throw new Error("execution-result.json has nothing to reverse");
  }

  const verified = [];
  for (const a of execEvidence.assigned) {
    // eslint-disable-next-line no-await-in-loop
    const employee = await deps.readEmployee(a.employeeId);
    if (!employee.exists) throw new Error(`ROLLBACK_STALE: employee '${a.employeeId}' no longer exists`);
    if (employee.updateTimeMillis !== a.newUpdateTimeMillis) {
      throw new Error(`ROLLBACK_STALE: employee '${a.employeeId}' has changed since the execution being reversed (updateTime drift) -- refusing to rollback over an unrelated write`);
    }
    const currentAssigned = Array.isArray(employee.assignedWarehouseIds) ? employee.assignedWarehouseIds : [];
    if (JSON.stringify(currentAssigned) !== JSON.stringify(a.after)) {
      throw new Error(`ROLLBACK_STALE: employee '${a.employeeId}' assignedWarehouseIds no longer matches the value this execution set`);
    }
    verified.push(a);
  }

  const writeResults = await deps.rollbackAssignmentsBatch(verified);
  const restored = verified.map((a, i) => ({
    employeeId: a.employeeId,
    restoredTo: a.before,
    newUpdateTimeMillis: writeResults[i].updateTimeMillis,
  }));
  const rollbackEvidence = {
    kind: "warehouse-assignment-provisioning-rollback",
    schemaVersion: 1,
    projectId: args.projectId,
    governedCommit: args.governedCommit,
    generatedAt: deps.now().toISOString(),
    boundPlanHash: execEvidence.boundPlanHash,
    restored,
  };
  const dir = publishEvidenceAtomically(deps.fs, args.evidenceDir, [
    { name: "rollback-result.json", content: JSON.stringify(rollbackEvidence, null, 2) },
    { name: "rollback-report.md", content: rollbackReportMarkdown(rollbackEvidence) },
  ]);
  return { mode: "rollback", rollbackEvidence, evidenceDir: dir };
}

async function run(deps, args) {
  if (args.rollback) return runRollback(deps, args);
  return args.execute ? runExecute(deps, args) : runDryRun(deps, args);
}

// Lazily build the real production deps -- firebase-admin is required ONLY here, never at import time.
function buildProductionDeps(projectId) {
  // eslint-disable-next-line global-require
  const admin = require("firebase-admin");
  const nodeFs = require("node:fs");
  if (!admin.apps.length) admin.initializeApp({ projectId });
  const db = admin.firestore();

  return {
    now: () => new Date(),
    async readManifestRaw(p) {
      return nodeFs.readFileSync(p, "utf8");
    },
    async readPlanRaw(p) {
      return nodeFs.readFileSync(p, "utf8");
    },
    async readExecutionResultRaw(p) {
      return nodeFs.readFileSync(p, "utf8");
    },
    async readEmployee(employeeId) {
      const snap = await db.collection(EMPLOYEES_COLLECTION).doc(employeeId).get();
      if (!snap.exists) return { exists: false };
      return {
        exists: true,
        operationalRoles: snap.get("operationalRoles"),
        assignedWarehouseIds: snap.get("assignedWarehouseIds"),
        updateTimeMillis: snap.updateTime ? snap.updateTime.toMillis() : null,
        updateTime: snap.updateTime,
      };
    },
    async readWarehouse(warehouseId) {
      const snap = await db.collection(WAREHOUSES_COLLECTION).doc(warehouseId).get();
      if (!snap.exists) return { exists: false };
      return { exists: true, status: snap.get("status"), name: snap.get("name") };
    },
    async writeAssignmentsBatch(assignments) {
      const batch = db.batch();
      const refs = [];
      for (const a of assignments) {
        const ref = db.collection(EMPLOYEES_COLLECTION).doc(a.employeeId);
        refs.push(ref);
        batch.update(
          ref,
          { assignedWarehouseIds: a.after, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { lastUpdateTime: admin.firestore.Timestamp.fromMillis(a.employeeUpdateTimeMillis) }
        );
      }
      await batch.commit();
      const fresh = await Promise.all(refs.map((r) => r.get()));
      return fresh.map((s) => ({ updateTimeMillis: s.updateTime.toMillis() }));
    },
    async rollbackAssignmentsBatch(entries) {
      const batch = db.batch();
      const refs = [];
      for (const a of entries) {
        const ref = db.collection(EMPLOYEES_COLLECTION).doc(a.employeeId);
        refs.push(ref);
        batch.update(
          ref,
          { assignedWarehouseIds: a.before, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { lastUpdateTime: admin.firestore.Timestamp.fromMillis(a.newUpdateTimeMillis) }
        );
      }
      await batch.commit();
      const fresh = await Promise.all(refs.map((r) => r.get()));
      return fresh.map((s) => ({ updateTimeMillis: s.updateTime.toMillis() }));
    },
    fs: {
      stamp: String(process.pid),
      mkdirp: (d) => nodeFs.mkdirSync(d, { recursive: true }),
      rmrf: (d) => nodeFs.rmSync(d, { recursive: true, force: true }),
      writeFile: (p, c) => nodeFs.writeFileSync(p, c, "utf8"),
      exists: (p) => nodeFs.existsSync(p),
      rename: (a, b) => nodeFs.renameSync(a, b),
    },
  };
}

// Full entrypoint composition, extracted so tests can invoke the SAME argv -> parseArgs ->
// buildProductionDeps -> run() chain a real CLI invocation uses, and prove the environment guard rejects
// BEFORE buildProductionDeps() (and therefore before firebase-admin is ever required and before any
// Firestore connection, read, or write) runs.
async function main(argv) {
  const args = parseArgs(argv);
  const deps = buildProductionDeps(args.projectId);
  return run(deps, args);
}

module.exports = {
  parseArgs,
  assertSandboxTarget,
  resolveSandboxProjectId,
  loadEnvironmentRegistry,
  validateManifestShape,
  publishEvidenceAtomically,
  runDryRun,
  runExecute,
  runRollback,
  run,
  buildProductionDeps,
  main,
  EMPLOYEES_COLLECTION,
  WAREHOUSES_COLLECTION,
};

if (require.main === module) {
  main(process.argv.slice(2))
    .then((result) => {
      console.log(`OK: ${result.mode} -> ${result.evidenceDir}`);
    })
    .catch((err) => {
      console.error("Failed:", err.message);
      process.exitCode = 1;
    });
}
