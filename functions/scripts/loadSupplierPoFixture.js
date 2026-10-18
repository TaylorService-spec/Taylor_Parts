// SYNTHETIC SUPPLIER PURCHASE ORDER FIXTURE LOADER (Firebase exit B3, DECISIONS #B3, OD-B3-1) -- nonprod only.
//
// WHY THIS EXISTS. Nothing in EOS authors a canonical supplier purchase order yet (that is its own batch), so a freshly migrated nonprod
// database has an EMPTY eos_ops.supplier_purchase_orders and the Receiving screen can show nothing to receive. This loads TWO
// multi-line, clearly SYNTHETIC/UAT purchase orders so the runtime proof (receive in two partial scans, replay one) has something real
// to receive against. It copies NOTHING from Firebase, loads no Firebase module, and cannot write Firestore.
//
//   (default)   DRY RUN. Reads only; prints what it WOULD insert; rolls back. Nothing is written.
//   --apply     One transaction: the missing orders + their lines + ONE audit event. A rerun is NO_CHANGES (idempotent).
//
// FENCES (the same as every nonprod operator script): --environment must be byte-identical to a non-production id in
// config/environments.json (production, and the frozen Certification world, are refused); the connection string is read from the
// variable --databaseUrlEnv NAMES and never from argv; EOS_ENVIRONMENT must read exactly 'nonprod' in this process; the tenant, the
// operating company, the Parts and the acting Principal are all NAMED and must already exist -- the loader creates none of them.
//
// WHAT IT WRITES, AND HOW IT IS LABELLED. Order ids are `synthetic-uat-spo-<companyKey>-001|002`, order numbers `SYNTHETIC-UAT-001|002`,
// status SENT, created_by `synthetic-fixture:loadSupplierPoFixture`, no supplier (a canonical order's supplier is optional). The audit
// event (action inventory.supplierPo.fixtureLoad) names every order inserted. An order that already exists with DIFFERENT lines or
// another company is a CONFLICT and aborts the whole load (nothing is overwritten); one that exists identically is PRESENT, whatever its
// status or version has since become (a received order is not "reset").
//
// OUTPUT: ids, counts, outcome -- never a connection string. Exit 0 success / dry run; 2 refused or failed.
//
// OPERATOR COMMAND (Render Shell on eos-api-nonprod, where EOS_ENVIRONMENT=nonprod and DATABASE_URL is the nonprod database):
//   node scripts/loadSupplierPoFixture.js --environment <nonprod environment id> --databaseUrlEnv DATABASE_URL \
//        --tenantKey <tenant key> --operatingCompanyKey <company key> --parts <partId1>,<partId2>[,<partId3>] \
//        --principalId <acting EOS principal id>            # dry run
//   ... the same command with --apply                       # load
"use strict";

const crypto = require("node:crypto");
const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");

const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);
const ALLOWED_OPTIONS = Object.freeze(["environment", "databaseUrlEnv", "tenantKey", "operatingCompanyKey", "parts", "principalId", "apply"]);
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const WRITER = "synthetic-fixture:loadSupplierPoFixture";
const AUDIT_ACTION = "inventory.supplierPo.fixtureLoad";
const LABEL = "SYNTHETIC/UAT";

/** Every refusal decidable from argv and the environment alone. No client. */
function assertFixtureInvocation(args, env) {
  for (const k of Object.keys(args)) {
    if (!ALLOWED_OPTIONS.includes(k)) throw new Error(`unknown option --${k}; allowed: ${ALLOWED_OPTIONS.map((o) => `--${o}`).join(" ")}`);
  }
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) throw new Error(`--environment '${environmentId}' is the Certification world, which is frozen.`);
  for (const k of ["tenantKey", "operatingCompanyKey", "parts", "principalId"]) {
    if (!args[k] || args[k] === "true") throw new Error(`--${k} is required: the fixture's tenant, company, Parts and acting Principal are named, never inferred.`);
  }
  if (args.apply !== undefined && args.apply !== "true") throw new Error("--apply is a flag and takes no value.");
  const partIds = String(args.parts).split(",").map((p) => p.trim());
  if (partIds.length < 2 || partIds.length > 3 || new Set(partIds).size !== partIds.length || partIds.some((p) => !SAFE.test(p))) {
    throw new Error("--parts must name 2 or 3 DISTINCT Part ids, comma-separated (a multi-line order needs more than one Part).");
  }
  if (!SAFE.test(args.operatingCompanyKey)) throw new Error("--operatingCompanyKey is not a safe key.");
  return { environmentId, connectionString, tenantKey: args.tenantKey, companyKey: args.operatingCompanyKey, partIds, principalId: args.principalId, apply: args.apply === "true" };
}

/** The fixture itself: pure, deterministic, labelled. Two multi-line orders over the named Parts. */
function buildFixturePlan(companyKey, partIds) {
  const [a, b, c] = partIds;
  const orders = [
    { id: `synthetic-uat-spo-${companyKey}-001`, externalPoNumber: "SYNTHETIC-UAT-001",
      lines: [{ lineId: "L1", partId: a, quantity: 10 }, { lineId: "L2", partId: b, quantity: 4 }] },
    { id: `synthetic-uat-spo-${companyKey}-002`, externalPoNumber: "SYNTHETIC-UAT-002",
      lines: [{ lineId: "L1", partId: b, quantity: 6 }, { lineId: "L2", partId: a, quantity: 3 }, ...(c === undefined ? [] : [{ lineId: "L3", partId: c, quantity: 5 }])] },
  ];
  return orders.map((o) => Object.freeze({ ...o, companyKey, status: "SENT", label: LABEL }));
}

const sameLines = (stored, planned) => stored.length === planned.length
  && planned.every((p) => stored.some((s) => s.line_id === p.lineId && s.part_id === p.partId && Number(s.ordered_quantity) === p.quantity));

/** Dry run or apply, in ONE transaction. Returns the report; throws (after rollback) on a refusal or conflict. */
async function loadSupplierPoFixture(pool, options) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const tenant = await c.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [options.tenantKey]);
    if (tenant.rows.length !== 1) throw new Error(`no tenant with key ${options.tenantKey}; the loader never creates one`);
    const tenantId = tenant.rows[0].id;
    const company = await c.query(
      "SELECT 1 FROM eos_policy.tenant_operating_company_keys WHERE tenant_id = $1 AND operating_company_key = $2 AND status = 'ACTIVE'", [tenantId, options.companyKey]);
    if (company.rows.length === 0) throw new Error(`operating company key ${options.companyKey} is not ACTIVE for this tenant; the loader never creates one`);
    const principal = await c.query(
      `SELECT 1 FROM eos_policy.principals p JOIN eos_policy.tenant_memberships m ON m.principal_id = p.id AND m.tenant_id = $1 AND m.status = 'active'
        WHERE p.id = $2 AND p.status = 'active'`, [tenantId, options.principalId]);
    if (principal.rows.length === 0) throw new Error("--principalId is not an active member of this tenant");
    const parts = await c.query("SELECT id, status::text AS status FROM eos_ops.parts WHERE tenant_id = $1 AND id = ANY($2::text[])", [tenantId, options.partIds]);
    const missing = options.partIds.filter((p) => !parts.rows.some((r) => r.id === p && r.status === "ACTIVE"));
    if (missing.length > 0) throw new Error(`these Parts are not ACTIVE in this tenant: ${missing.join(", ")}`);

    const plan = buildFixturePlan(options.companyKey, options.partIds);
    const toInsert = [];
    const present = [];
    for (const o of plan) {
      const existing = await c.query("SELECT operating_company_key FROM eos_ops.supplier_purchase_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE", [tenantId, o.id]);
      if (existing.rows.length === 0) { toInsert.push(o); continue; }
      const lines = await c.query("SELECT line_id, part_id, ordered_quantity FROM eos_ops.supplier_purchase_order_lines WHERE tenant_id = $1 AND purchase_order_id = $2", [tenantId, o.id]);
      if (existing.rows[0].operating_company_key !== o.companyKey || !sameLines(lines.rows, o.lines)) {
        throw new Error(`CONFLICT: ${o.id} already exists with a different company or different lines; nothing was changed`);
      }
      present.push(o.id);
    }
    if (options.apply && toInsert.length > 0) {
      for (const o of toInsert) {
        await c.query(
          `INSERT INTO eos_ops.supplier_purchase_orders (tenant_id, id, operating_company_key, supplier_id, external_po_number, status, version, provenance, created_by, updated_by)
           VALUES ($1,$2,$3,NULL,$4,'SENT',0,'NATIVE',$5,$5)`, [tenantId, o.id, o.companyKey, o.externalPoNumber, WRITER]);
        for (const l of o.lines) {
          await c.query(
            "INSERT INTO eos_ops.supplier_purchase_order_lines (tenant_id, purchase_order_id, line_id, part_id, ordered_quantity) VALUES ($1,$2,$3,$4,$5)",
            [tenantId, o.id, l.lineId, l.partId, l.quantity]);
        }
      }
      await c.query(
        `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, reason)
         VALUES ($1,$2,$3,$4,'supplier_purchase_order_fixture',$5,NULL,$6::jsonb,$7)`,
        [`audit_${crypto.randomUUID()}`, tenantId, AUDIT_ACTION, options.principalId, toInsert[0].id,
          JSON.stringify({ label: LABEL, inserted: toInsert.map((o) => o.id), partIds: options.partIds, companyKey: options.companyKey }),
          `${LABEL} supplier purchase order fixture for the Firebase-exit B3 runtime proof (OD-B3-1)`]);
    }
    await c.query(options.apply ? "COMMIT" : "ROLLBACK");
    return {
      label: LABEL, mode: options.apply ? "APPLY" : "DRY_RUN", tenantId, companyKey: options.companyKey,
      outcome: !options.apply ? "DRY_RUN" : toInsert.length === 0 ? "NO_CHANGES" : "APPLIED",
      wouldInsert: options.apply ? undefined : toInsert.map((o) => o.id), inserted: options.apply ? toInsert.map((o) => o.id) : [], present,
      orders: plan.map((o) => ({ id: o.id, externalPoNumber: o.externalPoNumber, lines: o.lines.length })),
    };
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

async function main() {
  const options = assertFixtureInvocation(parseArgs(process.argv.slice(2)), process.env);
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const pool = new pg.Pool({ ...resolvePolicyDatabaseConfig({ connectionString: options.connectionString }), max: 2 });
  pool.on("error", () => undefined);
  try {
    console.log(JSON.stringify({ environment: options.environmentId, ...(await loadSupplierPoFixture(pool, options)) }, null, 2));
  } finally {
    await pool.end();
  }
}

module.exports = { assertFixtureInvocation, buildFixturePlan, loadSupplierPoFixture, AUDIT_ACTION, WRITER, LABEL };

if (require.main === module) {
  main().catch((err) => {
    console.error(String(err instanceof Error ? err.message : err).replace(/postgres(ql)?:\/\/\S+/g, "<redacted>"));
    process.exitCode = 2;
  });
}
