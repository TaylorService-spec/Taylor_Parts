// X-SALES-ORDER-NUMBER-BACKFILL -- GOVERNED Sales Order number backfill OPERATOR CLI. Repository-only.
// INERT on import: it does NOT run merely because it is required (only main() under `require.main === module`
// does anything), and it lazy-requires firebase-admin inside a production-deps closure -- so importing this
// file performs NO Firestore read/write and touches no production. All orchestration is injected-deps so it
// is unit-testable offline. Mirrors functions/scripts/warehouseGovernanceMigrationCli.js's conventions.
//
// DRY-RUN is the DEFAULT (zero writes): read the live `sales_orders` collection + the touched counters, plan
// deterministic assignments for every unnumbered record, and publish a `plan.json` artifact -- the SAME file
// execute binds to (content-hash-pinned). EXECUTE requires --execute, --acknowledge-production-write, and the
// exact --plan / --plan-sha256 produced by a prior dry-run; it re-reads live state inside ONE Firestore
// transaction, recomputes every planned record's pre-state fingerprint and every touched counter, fails closed
// on ANY drift or on any collision/blocked entry in the plan, and only after a passing post-write verification
// publishes the execution evidence ATOMICALLY (no report directory on failure).
//
// PRODUCTION EXECUTION IS A PROTECTED ACTION -- see docs/operations/sales-order-number-backfill-runbook.md.
// This tool being present and working does NOT authorize running it against any real project; that
// authorization is separate and is the Owner's alone (see docs/governance/... protected-action policy).
//
// X-BACKFILL-ENVIRONMENT-GUARD (fail-closed target guard, lives entirely inside parseArgs):
// `--environment` is now REQUIRED. The only accepted value is exactly "sandbox" -- "production", "prod",
// empty, or any typo is a hard error. Under `--environment sandbox` the only accepted `--project` is the
// single sandbox project id resolved from config/environments.json (role === "sandbox" with a real
// firebase.projectId; today that resolves to exactly "eos-platform-sandbox"). `taylor-parts`, any alias,
// any near-miss (trailing space, suffix, prefix), a missing --project, and any value NOT byte-identical to
// the resolved id are all refused explicitly -- nothing is ever inferred from .firebaserc or process.env.
// This check runs INSIDE parseArgs, which is called before buildProductionDeps() (the only place
// firebase-admin is required and Firestore is touched) in both the CLI entrypoint (main(), below) and every
// caller -- so a rejected configuration throws before firebase-admin is ever required and before any
// Firestore connection, read, or write is attempted. The --project/--confirm-project identity check, the
// --plan/--plan-sha256 pinning, and --execute's --acknowledge-production-write requirement are unchanged by
// this guard; it is an additional gate, not a replacement for any of them.
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

const lib = () => ({
  backfill: require("../lib/salesOrder/salesOrderNumberBackfill.js"),
  evidence: require("../lib/salesOrder/salesOrderNumberBackfillEvidence.js"),
});

// ---- environment guard: read-only local file, resolved BEFORE any Firebase/Firestore code runs ----------
// config/environments.json is the declared source of environment identity repo-wide (see its own header
// comment). Reading it here is a plain local JSON read via node:fs (already a dependency of this file,
// used elsewhere for evidence publishing) -- it adds no new runtime dependency and performs no Firestore
// or network I/O, so it does not weaken the "fails closed before Firebase init" property.
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

// Resolves the single sandbox project id from the registry: environments whose `role` is "sandbox" AND
// which carry a real `firebase.projectId` (excludes e.g. "local-emulator", whose firebase identity is
// deliberately null). Throws if that does not resolve to EXACTLY one project id -- never guesses.
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
  // --project/--confirm-project identity is already enforced above; this narrows the ALLOWED identity.
  const allowedProjectId = resolveSandboxProjectId(loadEnvironmentRegistry());
  if (args.projectId !== allowedProjectId) {
    throw new Error(`--environment sandbox only accepts --project '${allowedProjectId}'; refusing '${args.projectId}' (taylor-parts, aliases, near-misses, and any project not byte-identical to the registry-resolved sandbox id are refused; nothing is inferred from .firebaserc or the environment)`);
  }
}

function parseArgs(argv) {
  const args = { execute: false, acknowledgeProductionWrite: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--execute") args.execute = true;
    else if (a === "--acknowledge-production-write") args.acknowledgeProductionWrite = true;
    else if (a === "--environment") args.environment = argv[++i];
    else if (a === "--project") args.projectId = argv[++i];
    else if (a === "--confirm-project") args.confirmProjectId = argv[++i];
    else if (a === "--commit") args.governedCommit = argv[++i];
    else if (a === "--evidence-dir") args.evidenceDir = argv[++i];
    else if (a === "--plan") args.planPath = argv[++i];
    else if (a === "--plan-sha256") args.planSha256 = argv[++i];
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
  if (args.execute) {
    if (!args.acknowledgeProductionWrite) throw new Error("--execute requires --acknowledge-production-write");
    if (!args.planPath) throw new Error("--execute requires --plan (the dry-run plan.json to bind to)");
    if (!args.planSha256) throw new Error("--execute requires --plan-sha256 (the Owner-reviewed plan hash)");
  }
  return args;
}

// Atomic evidence publish: write to a sibling temp dir, secret-scan every file, and only on a clean scan
// rename it into place. On ANY failure the temp dir is removed and NO final directory is left behind.
function publishEvidenceAtomically(fsDeps, finalDir, files) {
  const { evidence } = lib();
  const tmpDir = `${finalDir}.tmp-${fsDeps.stamp}`;
  fsDeps.rmrf(tmpDir);
  fsDeps.mkdirp(tmpDir);
  try {
    const checksums = [];
    for (const f of files) {
      const found = evidence.scanForSecrets(f.content);
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
    "# Sales Order Number Backfill -- dry-run plan",
    "",
    `- Generated: ${planEvidence.generatedAt}`,
    `- Project: ${planEvidence.projectId}`,
    `- Repository commit: ${planEvidence.governedCommit}`,
    // TWO different hashes, and confusing them fails the execute gate. `--plan-sha256` binds the sha256 of
    // the plan.json FILE BYTES (the artifact the Owner reviewed) -- that is what runExecute() compares.
    // `planEvidence.planHash` is the narrower operative-content hash (projectId + commit + assignments +
    // collisions + blocked + counterSnapshot, excluding generatedAt); it is what stays STABLE across two
    // dry-runs of unchanged data, which makes it the right value for reproducibility comparison and the
    // WRONG value to pass to --plan-sha256. This report previously printed the operative hash under the
    // label "bind this to --plan-sha256", which would have failed closed at execute with a bare
    // "plan hash mismatch" -- safe, but a false instruction.
    `- Bind this to --plan-sha256 at execute (sha256 of plan.json bytes): ${planFileSha256}`,
    `- Operative plan hash (stable across reruns when data is unchanged; NOT the --plan-sha256 value): ${planEvidence.planHash}`,
    "",
    `| total | already numbered (skip) | to assign (create) | collisions (fail) | blocked (fail) |`,
    `|---|---|---|---|---|`,
    `| ${counts.total} | ${counts.alreadyNumbered} | ${counts.toAssign} | ${counts.collisions} | ${counts.blocked} |`,
    "",
    counts.collisions > 0 || counts.blocked > 0
      ? "**This plan is NOT executable as-is.** Resolve the collisions listed in plan.json (an existing salesOrderNumber value already occupies a candidate slot), then rerun dry-run for a fresh plan."
      : "This plan is clean: zero collisions, zero blocked records. Review assignments in plan.json before authorizing execute.",
    "",
  ];
  return lines.join("\n");
}

function executionReportMarkdown(execEvidence) {
  const { counts } = execEvidence;
  return [
    "# Sales Order Number Backfill -- execution result",
    "",
    `- Generated: ${execEvidence.generatedAt}`,
    `- Project: ${execEvidence.projectId}`,
    `- Repository commit: ${execEvidence.governedCommit}`,
    `- Bound plan hash: ${execEvidence.boundPlanHash}`,
    `- Assigned: ${counts.assigned}`,
    `- Skipped (already numbered): ${counts.skippedAlreadyNumbered}`,
    "",
  ].join("\n");
}

async function runDryRun(deps, args) {
  const { backfill, evidence } = lib();
  const records = await deps.readAllSalesOrders();
  const counterCache = new Map();
  const readCounterSequence = (year) => {
    if (!counterCache.has(year)) counterCache.set(year, deps.readCounterSequenceSync(year));
    return counterCache.get(year);
  };
  const plan = backfill.planBackfill(records, readCounterSequence);
  const planEvidence = evidence.buildPlanEvidence(plan, { projectId: args.projectId, governedCommit: args.governedCommit, now: deps.now });
  // Serialize ONCE and hash those exact bytes, so the value printed in the report is byte-identical to the
  // plan.json actually published (and to its checksums.sha256 line) -- not a re-serialization that could drift.
  const planJson = evidence.serializeEvidence(planEvidence);
  const planFileSha256 = sha256Hex(planJson);
  const dir = publishEvidenceAtomically(deps.fs, args.evidenceDir, [
    { name: "plan.json", content: planJson },
    { name: "plan-report.md", content: planReportMarkdown(planEvidence, planFileSha256) },
  ]);
  return { mode: "dry-run", plan, planEvidence, planFileSha256, evidenceDir: dir };
}

async function runExecute(deps, args) {
  const { evidence } = lib();
  // Bind execution to the Owner-reviewed plan content hash. Hash the EXACT plan bytes BEFORE parsing;
  // require an exact normalized 64-hex match; fail closed (zero writes) on mismatch.
  const rawPlan = await deps.readPlanRaw(args.planPath);
  const expected = normalizeHash(args.planSha256);
  if (!isHex64(expected)) throw new Error("expected plan sha256 must be a normalized 64-hex value");
  const actualHash = sha256Hex(rawPlan);
  if (actualHash !== expected) throw new Error("plan hash mismatch: refusing to execute (no writes)");
  const planEvidence = JSON.parse(rawPlan);
  // Note: `actualHash` (checked above) is the hash of the WHOLE plan.json file -- the byte-exact artifact
  // the operator reviewed. `planEvidence.planHash` is a separate, narrower content hash (assignments +
  // collisions + blocked + counterSnapshot only, excluding `generatedAt`) carried inside the file for
  // cross-referencing in reports; it is deliberately NOT expected to equal `actualHash`.
  if (planEvidence.projectId !== args.projectId) throw new Error("plan.json project does not match --project: refusing to execute");
  if (planEvidence.governedCommit !== args.governedCommit) throw new Error("plan.json commit does not match --commit: refusing to execute");

  const plan = {
    assignments: planEvidence.assignments,
    collisions: planEvidence.collisions,
    blocked: planEvidence.blocked,
    alreadyNumbered: [],
    counterSnapshot: planEvidence.counterSnapshot,
    counts: planEvidence.counts,
  };

  const result = await deps.runExecuteTxn({ plan });
  const execEvidence = evidence.buildExecutionEvidence(result, {
    projectId: args.projectId,
    governedCommit: args.governedCommit,
    boundPlanHash: actualHash,
    now: deps.now,
  });
  const dir = publishEvidenceAtomically(deps.fs, args.evidenceDir, [
    { name: "execution-result.json", content: evidence.serializeEvidence(execEvidence) },
    { name: "execution-report.md", content: executionReportMarkdown(execEvidence) },
  ]);
  return { mode: "execute", result, execEvidence, evidenceDir: dir };
}

async function run(deps, argv) {
  const args = parseArgs(argv);
  return args.execute ? runExecute(deps, args) : runDryRun(deps, args);
}

// Lazily build the real production deps -- firebase-admin is required ONLY here, never at import time.
function buildProductionDeps(projectId) {
  // eslint-disable-next-line global-require
  const admin = require("firebase-admin");
  const fs = require("node:fs");
  if (!admin.apps.length) admin.initializeApp({ projectId });
  const db = admin.firestore();
  const SALES_ORDERS = "sales_orders";
  const COUNTERS = "counters";
  const counterDocId = (year) => `sales_orders_${year}`;

  let cachedRecords = null;
  return {
    now: () => new Date(),
    async readAllSalesOrders() {
      // Memoized: the CLI entrypoint reads this once to prefetch counter years, then runDryRun reads it
      // again -- cache so that's one Firestore read, not two.
      if (cachedRecords === null) {
        const snap = await db.collection(SALES_ORDERS).get();
        cachedRecords = snap.docs.map((d) => ({
          salesOrderId: d.id,
          salesOrderNumber: d.get("salesOrderNumber"),
          createdAt: d.get("createdAt"),
        }));
      }
      return cachedRecords;
    },
    readCounterSequenceSync() {
      throw new Error("readCounterSequenceSync is not available outside a transaction; dry-run uses readAllCounters()");
    },
    async readAllCounters(years) {
      const out = new Map();
      for (const year of years) {
        // eslint-disable-next-line no-await-in-loop
        const doc = await db.collection(COUNTERS).doc(counterDocId(year)).get();
        out.set(year, doc.exists ? doc.data().sequence || 0 : 0);
      }
      return out;
    },
    async readPlanRaw(p) {
      return fs.readFileSync(p, "utf8");
    },
    async runExecuteTxn({ plan }) {
      const { backfill } = lib();
      return db.runTransaction(async (txn) => {
        const ids = plan.assignments.map((a) => a.salesOrderId);
        const years = plan.counterSnapshot.map((s) => s.year);
        const soRefs = ids.map((id) => db.collection(SALES_ORDERS).doc(id));
        const counterRefs = years.map((y) => db.collection(COUNTERS).doc(counterDocId(y)));
        const soSnaps = ids.length > 0 ? await Promise.all(soRefs.map((r) => txn.get(r))) : [];
        const counterSnaps = years.length > 0 ? await Promise.all(counterRefs.map((r) => txn.get(r))) : [];

        const staged = { counters: [], assignments: [] };
        const store = {
          async readAllSalesOrders() {
            return soSnaps.map((s) => ({
              salesOrderId: s.id,
              salesOrderNumber: s.exists ? s.get("salesOrderNumber") : undefined,
              createdAt: s.exists ? s.get("createdAt") : undefined,
            }));
          },
          async readCounterSequence(year) {
            const idx = years.indexOf(year);
            const s = counterSnaps[idx];
            return s && s.exists ? s.data().sequence || 0 : 0;
          },
          stageCounter(year, newSequence) {
            staged.counters.push({ year, newSequence });
          },
          stageAssignment(salesOrderId, salesOrderNumber) {
            staged.assignments.push({ salesOrderId, salesOrderNumber });
          },
        };

        const result = await backfill.executeBackfill({ plan, store, actorId: "tool:sales-order-number-backfill" });
        for (const c of staged.counters) {
          txn.set(db.collection(COUNTERS).doc(counterDocId(c.year)), {
            year: c.year,
            sequence: c.newSequence,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        for (const a of staged.assignments) {
          txn.update(db.collection(SALES_ORDERS).doc(a.salesOrderId), {
            salesOrderNumber: a.salesOrderNumber,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        return result;
      });
    },
    fs: {
      stamp: String(process.pid),
      mkdirp: (d) => fs.mkdirSync(d, { recursive: true }),
      rmrf: (d) => fs.rmSync(d, { recursive: true, force: true }),
      writeFile: (p, c) => fs.writeFileSync(p, c, "utf8"),
      exists: (p) => fs.existsSync(p),
      rename: (a, b) => fs.renameSync(a, b),
    },
  };
}

// Dry-run needs a plain synchronous-looking planBackfill(records, readCounterSequence) call, but real counter
// reads are async (Firestore). Bridge: read every counter the live records COULD touch up front (one read per
// distinct year present among unnumbered records), then hand planBackfill a synchronous lookup over that
// pre-fetched map. This keeps the pure core (salesOrderNumberBackfill.ts) free of any async/Firestore
// dependency while the CLI does the one round of I/O it actually needs.
async function withPrefetchedCounters(deps, records) {
  const { backfill } = lib();
  const years = new Set();
  for (const r of records) {
    const c = backfill.classifyRecord(r);
    if (c.category === "NEEDS_ASSIGNMENT") years.add(c.year);
  }
  const counters = await deps.readAllCounters([...years]);
  return {
    ...deps,
    readCounterSequenceSync: (year) => counters.get(year) ?? 0,
  };
}

// Full entrypoint composition, extracted from the require.main IIFE so tests can invoke the SAME
// argv -> parseArgs -> buildProductionDeps -> run() chain a real CLI invocation uses, and prove the
// environment guard rejects BEFORE buildProductionDeps() (and therefore before firebase-admin is ever
// required and before any Firestore connection, read, or write) runs.
async function main(argv) {
  const args = parseArgs(argv);
  let deps = buildProductionDeps(args.projectId);
  if (!args.execute) deps = await withPrefetchedCounters(deps, await deps.readAllSalesOrders());
  return run(deps, argv);
}

module.exports = {
  parseArgs,
  publishEvidenceAtomically,
  runDryRun,
  runExecute,
  run,
  buildProductionDeps,
  withPrefetchedCounters,
  resolveSandboxProjectId,
  loadEnvironmentRegistry,
  main,
};

if (require.main === module) {
  main(process.argv.slice(2))
    .then((r) => {
      console.log(JSON.stringify({ ok: true, mode: r.mode, evidenceDir: r.evidenceDir }, null, 2));
      process.exitCode = 0;
    })
    .catch((err) => {
      console.error(`SALES ORDER NUMBER BACKFILL CLI FAILURE: ${err.message}`);
      process.exitCode = 2;
    });
}
