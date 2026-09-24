// COMMERCIAL SYNTHETIC CLEANUP -- the governed removal of the TWELVE declared-synthetic nonprod Commercial
// records that block Commercial C5, and of nothing else, ever.
//
// ============================ WHAT THIS IS, AND WHY IT IS NOT AN SQL SNIPPET ============================
//
// Owner ruling (nonprod only): "COMMERCIAL SYNTHETIC CLEANUP -- AUTHORIZED IN NONPROD. Exact proven population:
// 3 synthetic Sales Orders, 6 synthetic Opportunities, 3 synthetic Sales Agreements. Total: 12. Use a governed
// cleanup script. DO NOT use an unrecorded ad-hoc SQL statement set."
//
// An ad-hoc `DELETE ... WHERE number LIKE 'SYN-%'` would satisfy the sentence and violate the ruling. It leaves no
// artifact, it is not reviewable before it runs, it cannot state what it expected to remove, it cannot tell the
// difference between removing twelve rows and removing thirteen, and its PREDICATE -- not its identity set -- decides
// what dies. This file is the opposite of that on every one of those axes:
//
//   * THE SET IS A CONSTANT, NOT A QUERY. DELETE_SET below holds the twelve (family, id, number) triples literally.
//     There is no --prefix, no --where, no --number, no --all, no --discover and no selection option of ANY kind; the
//     fence refuses them by name. Nothing this tool deletes can be chosen at the command line.
//   * THE SET IS FINGERPRINTED AND THE OPERATOR RESTATES IT. `--confirmExactIds <sha256>` must equal the sha256 of
//     the canonical serialization of DELETE_SET. An edit to the constant changes the fingerprint and invalidates
//     every runbook confirmation written against the old one, which is the point.
//   * THE SET IS CLASSIFIED BY DECLARATION, NOT BY SHAPE. Every one of the twelve numbers must appear in
//     `commercialC5.js` declaredSyntheticSeedNumbers() -- the union of the governed fixture manifests
//     (syntheticNonprodWorkforceSeed.v1.json, sampleCompany.v2.json). A row is SYNTHETIC_NONBUSINESS because the
//     repository DECLARES it fixture data, never because its number "looks synthetic". If a manifest stops
//     declaring one of them, this tool refuses rather than deleting it.
//   * DRY RUN IS THE DEFAULT AND THE DATABASE ENFORCES IT. `--mode plan` (the default) runs inside
//     `BEGIN READ ONLY`, so PostgreSQL itself rejects a write even if a future edit attempted one. Writing requires
//     BOTH `--mode apply` AND the separate explicit `--apply` flag; a mode alone never writes.
//
// ============================ THERE IS NO PRODUCTION PATH ============================
//
// Not "production is discouraged" -- production is unreachable from this file:
//   * `assertMeasurementTarget` refuses production TWICE, by registry role AND by the project id `taylor-parts`
//     named literally, before any driver is loaded.
//   * `assertNonprodRuntime` requires EOS_ENVIRONMENT to read exactly `nonprod` in this process. Refusing production
//     is not the same as knowing the target is nonprod, so both are required.
//   * `--environment` must be exactly `platform-sandbox`. Not-production is not the same as the one environment this
//     cleanup is authorized for, and `platform-certification` is refused BY NAME as well (frozen world).
//   * `--nonprodDataMutationAuthorized` must be given explicitly. The Owner's authorization is a nonprod-data
//     authorization; the operator restates that this is what they are exercising.
//   * `--confirmProduction`, `--production`, `--project`, `--force`, `--yes` and every selection option are refused
//     BY NAME. There is no flag, no environment variable and no code path in this file that reaches a production
//     database, and functions/test/commercialSyntheticCleanup.test.mjs asserts the absence statically.
//
// ============================ WHY NOT A MIGRATION ============================
//
// MEASURED, not assumed. Twenty migrations under functions/migrations/ do contain DML, so "migrations are schema
// only" would be false here. Every one of those twenty writes the POLICY VOCABULARY -- `capabilities`,
// `role_capabilities` -- reference data that must exist byte-identically in every environment INCLUDING production.
// Not one migration in the repository deletes a tenant business or fixture row (`grep -l "DELETE FROM eos_commercial"
// functions/migrations/*.sql` returns nothing). `npm run migrate:up` runs everywhere the schema is deployed, so a
// migration that deleted these twelve nonprod ids would be a statement SCHEDULED to run against production and to
// silently no-op there -- a production execution path created by the packaging rather than by anyone's intent. The
// removal of environment-specific fixture rows is therefore an OPERATOR ACTION, and this is the operator tool.
//
// ============================ FK ORDER IS MEASURED, NOT RECITED ============================
//
// Every run re-reads pg_constraint and REFUSES if the dependency graph it finds is not the one DEPENDENTS encodes.
// Measured on the nonprod instance 2026-09-23 (18 FKs touching the three families):
//
//   opportunity_lines       (tenant_id, opportunity_id)      -> opportunities
//   sales_agreement_lines   (tenant_id, sales_agreement_id)  -> sales_agreements
//   sales_order_lines       (tenant_id, sales_order_id)      -> sales_orders
//   accountability_handoffs (opportunity_id|sales_agreement_id|sales_order_id) -> all three
//   ownership_handoffs      (opportunity_id|sales_agreement_id|sales_order_id) -> all three
//   sales_agreements.opportunity_id -> opportunities
//   sales_orders.opportunity_id     -> opportunities
//   sales_orders.sales_agreement_id -> sales_agreements
//
// NONE declares ON DELETE CASCADE, so nothing disappears implicitly. The ruling's order (sales_orders ->
// sales_agreements -> opportunities) is correct for the three families but INCOMPLETE: five further child relations
// reference them. This tool therefore deletes leaves first -- the child relations, then sales_orders, then
// sales_agreements, then opportunities -- and asserts an exact rowcount at every step.
//
// `ownership_handoffs` is APPEND-ONLY, protected by `refuse_ownership_history_mutation`, which raises on UPDATE and
// DELETE. Its expected inbound count here is 0 and the preflight PROVES it is 0 before any delete runs: a nonzero
// count is a hard refusal, never an attempt. Immutable history is not something this tool negotiates with, so it is
// measured but never listed among the relations this tool deletes from.
//
// ============================ WHAT IT PROVES BEFORE IT WRITES ============================
//
// All inside ONE transaction, under `pg_advisory_xact_lock(hashtextextended('commercial-c5|<tenantId>', 0))` -- the
// SAME key commercialC5Target.ts copyCommercial takes, so a cleanup and a C5 copy cannot interleave:
//
//   1. the tenant key resolves to exactly one tenant row, and to the tenant id the authorization names
//   2. all 12 ids exist, each in that tenant, each carrying exactly the expected number -- 12/12, no more, no less
//   3. the tenant holds NO Commercial record outside the 12 (an unreviewed row means the reviewed identity set no
//      longer describes the instance; fail closed rather than delete around it)
//   4. every one of the 12 numbers is declared-synthetic by a governed manifest -> SYNTHETIC_NONBUSINESS
//   5. inbound references = 0 across every measured referencing relation, FK-backed and not: the child relations,
//      eos_commercial.command_receipts.target_id, eos_finance.invoices / invoice_totals.sales_order_id,
//      eos_ops.work_orders.sales_order_id and eos_ops.work_order_sales_order_lines.sales_order_id
//   6. PRE-FINGERPRINT: sha256 over the canonical serialization of what was found
//   ... deletes, each with its expected rowcount asserted ...
//   7. POST-FINGERPRINT: re-measured from the database, expecting zero of the 12 to remain and zero collateral
//
// Any assertion that fails ROLLS BACK the whole transaction and exits 2. Nothing is ever partially removed.
//
// Usage (Render Shell on eos-api-nonprod):
//   node scripts/commercialSyntheticCleanup.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey taylor-nonprod --nonprodDataMutationAuthorized --performedBy <operator>
//   ... add `--mode apply --apply --confirmExactIds <deleteSetSha256 printed by plan>` to write.
//
// Exit: 0 plan complete and every precondition met / apply committed; 1 a precondition is NOT met (plan);
// 2 refused or failed. Output: one JSON document. No connection string, no host, no password, ever.
"use strict";

const crypto = require("node:crypto");
const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");
const { declaredSyntheticSeedNumbers, declaredSyntheticSeedProvenance } = require("./commercialC5.js");

const MODES = Object.freeze(["plan", "apply"]);
/** The one environment this cleanup is authorized for. Not-production is not the same as this. */
const REQUIRED_ENVIRONMENT = "platform-sandbox";
const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);
const REQUIRED_TENANT_KEY = "taylor-nonprod";
/** The tenant the Owner's authorization names, restated here so argv cannot redirect the cleanup at another one. */
const REQUIRED_TENANT_ID = "tenant-6ce59be1-1979-45cd-9d17-a4969037fb25";
/** The classification this tool acts on, and the ONLY one it will delete. */
const CLASSIFICATION = "SYNTHETIC_NONBUSINESS";

// ════════════════════════════ THE EXACT SET -- the whole of what may be deleted ════════════════════════════
//
// Reviewed and proven by the forensic lane, re-verified in full by this tool's preflight before any delete runs.
// Order here is documentation only; the delete order is CHILD_DELETE_ORDER + FAMILY_DELETE_ORDER below, measured
// from pg_constraint.
const DELETE_SET = Object.freeze([
  Object.freeze({ family: "opportunity", id: "opp_3d1fdd30-9b0a-4344-983a-3598ca909494", number: "SYN-NP-OPP-0001" }),
  Object.freeze({ family: "opportunity", id: "opp_16ea0f86-3aea-4da4-8017-02dd4b1f12af", number: "SYN-NP-OPP-0002" }),
  Object.freeze({ family: "opportunity", id: "opp_3b79d076-09c1-43bf-86c1-7b3ba4e6bd82", number: "SYN-NP-OPP-0003" }),
  Object.freeze({ family: "opportunity", id: "opp_e481459d-12f2-4dab-8b2b-d574bd7a034e", number: "SYN-NP-OPP-0004" }),
  Object.freeze({ family: "opportunity", id: "opp_5880fb7c-55c7-4bc9-8fbe-bde55bfd96e1", number: "SAMPLE-CO-OPP-0005" }),
  Object.freeze({ family: "opportunity", id: "opp_61eeeb83-1518-48b9-b181-65b6174cfe8b", number: "SAMPLE-CO-OPP-0006" }),
  Object.freeze({ family: "salesAgreement", id: "sag_3f17be2a-d728-473a-b54d-efaba417362b", number: "SYN-NP-SA-0001" }),
  Object.freeze({ family: "salesAgreement", id: "sag_faf8952b-c50b-4654-b013-6d8484972e3f", number: "SYN-NP-SA-0002" }),
  Object.freeze({ family: "salesAgreement", id: "sag_c7e8d9d6-e4b8-4504-82bf-4781b9bf0510", number: "SAMPLE-CO-SA-0003" }),
  Object.freeze({ family: "salesOrder", id: "sor_d86545ba-167e-4dcd-8d70-06a958748cc8", number: "SYN-NP-SO-0001" }),
  Object.freeze({ family: "salesOrder", id: "sor_aa480123-e315-4b0e-8da4-c73dd90ab9ef", number: "SYN-NP-SO-0002" }),
  Object.freeze({ family: "salesOrder", id: "sor_2d2e1715-9e18-4e50-8d80-776890011440", number: "SAMPLE-CO-SO-0003" }),
]);

/** The Owner ruling's stated population, asserted against DELETE_SET so the constant cannot drift from the authorization. */
const AUTHORIZED_POPULATION = Object.freeze({ opportunity: 6, salesAgreement: 3, salesOrder: 3, total: 12 });

const FAMILY = Object.freeze({
  opportunity: Object.freeze({ table: "opportunities", numberColumn: "opportunity_number", idPrefix: "opp_" }),
  salesAgreement: Object.freeze({ table: "sales_agreements", numberColumn: "sales_agreement_number", idPrefix: "sag_" }),
  salesOrder: Object.freeze({ table: "sales_orders", numberColumn: "sales_order_number", idPrefix: "sor_" }),
});

/** Parents last. Measured from pg_constraint; see the header. */
const FAMILY_DELETE_ORDER = Object.freeze(["salesOrder", "salesAgreement", "opportunity"]);

/**
 * Every relation that references the three families, with the inbound count expected for THIS delete set (zero).
 * Each is measured in the preflight; a nonzero count is a refusal, not a cascade.
 *
 * `fkBacked: false` entries have NO foreign key -- PostgreSQL would not stop the delete, which is exactly why they
 * are measured here. An inbound reference nothing enforces is the one that silently becomes a dangling id.
 *
 * `deletedHere: false` with `appendOnly: true` is ownership_handoffs: immutable history this tool measures and
 * never touches.
 */
const DEPENDENTS = Object.freeze([
  Object.freeze({ relation: "eos_commercial.opportunity_lines", column: "opportunity_id", families: ["opportunity"], fkBacked: true, deletedHere: true }),
  Object.freeze({ relation: "eos_commercial.sales_agreement_lines", column: "sales_agreement_id", families: ["salesAgreement"], fkBacked: true, deletedHere: true }),
  Object.freeze({ relation: "eos_commercial.sales_order_lines", column: "sales_order_id", families: ["salesOrder"], fkBacked: true, deletedHere: true }),
  Object.freeze({ relation: "eos_commercial.accountability_handoffs", column: "opportunity_id", families: ["opportunity"], fkBacked: true, deletedHere: true }),
  Object.freeze({ relation: "eos_commercial.accountability_handoffs", column: "sales_agreement_id", families: ["salesAgreement"], fkBacked: true, deletedHere: true }),
  Object.freeze({ relation: "eos_commercial.accountability_handoffs", column: "sales_order_id", families: ["salesOrder"], fkBacked: true, deletedHere: true }),
  Object.freeze({ relation: "eos_commercial.ownership_handoffs", column: "opportunity_id", families: ["opportunity"], fkBacked: true, deletedHere: false, appendOnly: true }),
  Object.freeze({ relation: "eos_commercial.ownership_handoffs", column: "sales_agreement_id", families: ["salesAgreement"], fkBacked: true, deletedHere: false, appendOnly: true }),
  Object.freeze({ relation: "eos_commercial.ownership_handoffs", column: "sales_order_id", families: ["salesOrder"], fkBacked: true, deletedHere: false, appendOnly: true }),
  Object.freeze({ relation: "eos_commercial.command_receipts", column: "target_id", families: ["opportunity", "salesAgreement", "salesOrder"], fkBacked: false, deletedHere: false }),
  Object.freeze({ relation: "eos_finance.invoices", column: "sales_order_id", families: ["salesOrder"], fkBacked: false, deletedHere: false }),
  Object.freeze({ relation: "eos_finance.invoice_totals", column: "sales_order_id", families: ["salesOrder"], fkBacked: false, deletedHere: false }),
  Object.freeze({ relation: "eos_ops.work_orders", column: "sales_order_id", families: ["salesOrder"], fkBacked: false, deletedHere: false }),
  Object.freeze({ relation: "eos_ops.work_order_sales_order_lines", column: "sales_order_id", families: ["salesOrder"], fkBacked: false, deletedHere: false }),
]);

/** The child relations this tool deletes from, leaves first, before any of the three families. */
const CHILD_DELETE_ORDER = Object.freeze(
  DEPENDENTS.filter((d) => d.deletedHere).map((d) => Object.freeze({ relation: d.relation, column: d.column, families: d.families })),
);

class CommercialSyntheticCleanupError extends Error {
  constructor(code, message, details) {
    super(`${code}: ${message}`);
    this.name = "CommercialSyntheticCleanupError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
const refuse = (code, message, details) => {
  throw new CommercialSyntheticCleanupError(code, message, details);
};

/** Deterministic serialization -> a fingerprint that changes if ANY id, number or family changes. */
const canonical = (value) => JSON.stringify(value);
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

/** The fingerprint of the reviewed identity set. `--confirmExactIds` must restate it to write. */
function deleteSetFingerprint() {
  const triples = DELETE_SET.map((r) => [r.family, r.id, r.number]).sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return sha256(canonical(triples));
}

const idsOf = (families) => DELETE_SET.filter((r) => families.includes(r.family)).map((r) => r.id);

// ════════════════════════════ invariants of the constant itself (pure, no I/O) ════════════════════════════

/**
 * The delete set must agree with the Owner's authorization and with the governed manifests, checked BEFORE a
 * database is opened. A constant that drifted from the ruling is the failure mode a reviewed identity set exists to
 * prevent, so it is a refusal rather than a comment.
 */
function assertDeleteSetIntegrity() {
  const counts = { opportunity: 0, salesAgreement: 0, salesOrder: 0 };
  const seenIds = new Set();
  const seenNumbers = new Set();
  for (const record of DELETE_SET) {
    const shape = FAMILY[record.family];
    if (!shape) refuse("DELETE_SET_INVALID", `${record.id}: unknown family '${record.family}'`);
    if (!record.id.startsWith(shape.idPrefix)) {
      refuse("DELETE_SET_INVALID", `${record.id} does not carry the ${record.family} id prefix '${shape.idPrefix}'`);
    }
    if (seenIds.has(record.id)) refuse("DELETE_SET_INVALID", `${record.id} appears twice`);
    if (seenNumbers.has(record.number)) refuse("DELETE_SET_INVALID", `${record.number} appears twice`);
    seenIds.add(record.id);
    seenNumbers.add(record.number);
    counts[record.family] += 1;
  }
  if (counts.opportunity !== AUTHORIZED_POPULATION.opportunity || counts.salesAgreement !== AUTHORIZED_POPULATION.salesAgreement
    || counts.salesOrder !== AUTHORIZED_POPULATION.salesOrder || DELETE_SET.length !== AUTHORIZED_POPULATION.total) {
    refuse("DELETE_SET_INVALID",
      `the delete set is ${counts.opportunity} Opportunities / ${counts.salesAgreement} Sales Agreements / ${counts.salesOrder} Sales Orders `
      + `(${DELETE_SET.length} total); the Owner authorized exactly ${AUTHORIZED_POPULATION.opportunity} / `
      + `${AUTHORIZED_POPULATION.salesAgreement} / ${AUTHORIZED_POPULATION.salesOrder} (${AUTHORIZED_POPULATION.total})`);
  }
  // DECLARATION, never shape. Undeclared stays undeleted.
  const declared = new Set(declaredSyntheticSeedNumbers());
  const undeclared = DELETE_SET.filter((r) => !declared.has(r.number));
  if (undeclared.length > 0) {
    refuse("CLASSIFICATION_REFUSED",
      `${undeclared.length} record(s) in the delete set are not declared by any governed synthetic fixture manifest, so they do not `
      + `classify ${CLASSIFICATION}; a row is deleted because the repository DECLARES it fixture data, never because its number looks synthetic`,
      undeclared.map((r) => `${r.number} (${r.id})`));
  }
  return { counts, deleteSetSha256: deleteSetFingerprint() };
}

// ════════════════════════════ the fence: argv + process env only, before any driver ════════════════════════════

/**
 * Every refusal decidable without a database. `pg` and lib/ are require()d only after this returns -- the property is
 * the ORDER, not merely that it throws.
 */
function assertCleanupInvocation(args, env) {
  const mode = args.mode === undefined ? "plan" : args.mode;
  if (!MODES.includes(mode)) {
    refuse("ARGUMENT_INVALID", `--mode must be one of ${MODES.join(" | ")} (plan is the default, and the database itself refuses a write in it)`);
  }
  // NO PRODUCTION PATH. Refused by NAME, so the refusal does not depend on one field in one registry file.
  for (const option of ["confirmProduction", "production", "prod", "project", "projectId", "confirmProject", "firebaseProjectId"]) {
    if (args[option] !== undefined) {
      refuse("ARGUMENT_INVALID",
        `--${option} is not an option: this cleanup has no production mode and no Firebase target at all. It removes nonprod PostgreSQL rows and nothing else.`);
    }
  }
  // NO DISCOVER-AND-DELETE. The set is a reviewed constant; there is no way to widen it from the command line.
  for (const option of ["all", "discover", "where", "predicate", "prefix", "like", "pattern", "number", "numbers", "id", "ids", "family", "limit", "cascade", "truncate"]) {
    if (args[option] !== undefined) {
      refuse("ARGUMENT_INVALID",
        `--${option} is not an option: the delete set is the reviewed constant DELETE_SET (${DELETE_SET.length} exact ids). `
        + "Selecting rows by predicate is precisely what the Owner ruling forbids.");
    }
  }
  for (const option of ["force", "yes", "skipPreflight", "ignoreDependents", "allowDrift"]) {
    if (args[option] !== undefined) refuse("ARGUMENT_INVALID", `--${option} is not an option: a guard this tool can be told to skip is not a guard.`);
  }
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) {
    refuse("ENVIRONMENT_REFUSED",
      `--environment '${environmentId}' is the Certification world, which is frozen. It carries role "sandbox" in the registry, so it is refused by NAME here rather than by role.`);
  }
  if (environmentId !== REQUIRED_ENVIRONMENT) {
    refuse("ENVIRONMENT_REFUSED",
      `this cleanup is authorized only in '${REQUIRED_ENVIRONMENT}'; refusing '${environmentId}'. Not-production is not the same as the one environment the authorization names.`);
  }
  if (args.tenantKey !== REQUIRED_TENANT_KEY) {
    refuse("ARGUMENT_REQUIRED", `--tenantKey ${REQUIRED_TENANT_KEY} is required and has no default: the tenant is named, never inferred.`);
  }
  if (args.nonprodDataMutationAuthorized !== "true") {
    refuse("ARGUMENT_REQUIRED",
      "--nonprodDataMutationAuthorized is required: this tool exercises an explicit Owner authorization to MUTATE NONPROD DATA, and the operator restates that this is what they are doing.");
  }
  if (typeof args.performedBy !== "string" || !/^[A-Za-z0-9._@-]{1,100}$/.test(args.performedBy)) {
    refuse("ARGUMENT_REQUIRED", "--performedBy <operator> is required ([A-Za-z0-9._@-], at most 100)");
  }
  const apply = mode === "apply";
  if (apply && args.apply !== "true") {
    refuse("ARGUMENT_REQUIRED", "--mode apply additionally requires the explicit --apply flag; a mode alone never writes");
  }
  if (!apply && args.apply === "true") {
    refuse("ARGUMENT_INVALID", "--apply was given without --mode apply; refusing rather than guessing what was meant");
  }
  const expected = deleteSetFingerprint();
  if (apply && args.confirmExactIds !== expected) {
    refuse("ARGUMENT_REQUIRED",
      `--confirmExactIds <deleteSetSha256> is required for --mode apply and must be byte-identical to the fingerprint of the reviewed identity set (${expected}); `
      + `run --mode plan to print it and REVIEW the ${DELETE_SET.length} ids it covers before restating it.`);
  }
  return { mode, apply, environmentId, connectionString, tenantKey: args.tenantKey, performedBy: args.performedBy, deleteSetSha256: expected };
}

// ════════════════════════════ measurement (every statement a SELECT) ════════════════════════════

/** The FK graph as the DATABASE reports it today, not as this file recites it. A recited order is not evidence. */
async function measureForeignKeys(client) {
  const { rows } = await client.query(
    `SELECT src_ns.nspname || '.' || src.relname AS child, con.conname, pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con
       JOIN pg_class src ON src.oid = con.conrelid
       JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
       JOIN pg_class tgt ON tgt.oid = con.confrelid
       JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt.relnamespace
      WHERE con.contype = 'f' AND tgt_ns.nspname = 'eos_commercial'
        AND tgt.relname IN ('opportunities','sales_agreements','sales_orders')
      ORDER BY 1, 2`);
  const measured = rows.map((r) => ({ child: r.child, constraint: r.conname, definition: r.def }));
  const cascading = measured.filter((r) => /ON DELETE CASCADE/i.test(r.definition));

  // The three families reference EACH OTHER -- sales_agreements.opportunity_id, sales_orders.opportunity_id,
  // sales_orders.sales_agreement_id -- so they legitimately appear as children of one another. Those edges are not
  // "dependents"; they are what FAMILY_DELETE_ORDER exists to satisfy, so they are checked against that order
  // rather than against DEPENDENTS. Every OTHER child relation must be one DEPENDENTS names, and every FK-backed
  // relation DEPENDENTS names must still exist -- either way the encoded delete order would be describing a schema
  // that is no longer there.
  const familyRelations = new Set(Object.values(FAMILY).map((f) => `eos_commercial.${f.table}`));
  const relationOfFamily = Object.fromEntries(Object.entries(FAMILY).map(([family, f]) => [`eos_commercial.${f.table}`, family]));
  const interFamily = measured.filter((r) => familyRelations.has(r.child));
  const outOfOrder = interFamily
    .map((r) => {
      // `FOREIGN KEY (...) REFERENCES eos_commercial.<parent>(...)`; the parent family must be deleted LATER.
      const parent = (/REFERENCES\s+(eos_commercial\.[a-z_]+)/i.exec(r.definition) || [])[1];
      const childFamily = relationOfFamily[r.child];
      const parentFamily = relationOfFamily[parent];
      if (parentFamily === undefined || childFamily === parentFamily) return null;
      const ok = FAMILY_DELETE_ORDER.indexOf(childFamily) < FAMILY_DELETE_ORDER.indexOf(parentFamily);
      return ok ? null : `${r.constraint}: ${childFamily} must be deleted before ${parentFamily}`;
    })
    .filter((x) => x !== null);

  const measuredChildren = new Set(measured.filter((r) => !familyRelations.has(r.child)).map((r) => r.child));
  const encodedChildren = new Set(DEPENDENTS.filter((d) => d.fkBacked).map((d) => d.relation));
  const missing = [...encodedChildren].filter((c) => !measuredChildren.has(c));
  const unencoded = [...measuredChildren].filter((c) => !encodedChildren.has(c));
  return {
    constraints: measured, cascading, missing, unencoded, outOfOrder,
    interFamily: interFamily.map((r) => r.constraint),
    agrees: missing.length === 0 && unencoded.length === 0 && outOfOrder.length === 0,
  };
}

/** Exactly what the tenant holds in the three families right now, and what the whole instance holds. */
async function measureCommercial(client, tenantId) {
  const perFamily = {};
  for (const family of Object.keys(FAMILY)) {
    const shape = FAMILY[family];
    const { rows } = await client.query(
      `SELECT id, ${shape.numberColumn} AS number FROM eos_commercial.${shape.table} WHERE tenant_id = $1 ORDER BY id`, [tenantId]);
    const instance = await client.query(`SELECT count(*)::int AS n FROM eos_commercial.${shape.table}`);
    perFamily[family] = { tenantRows: rows.map((r) => ({ id: r.id, number: r.number })), instanceTotal: Number(instance.rows[0].n) };
  }
  return perFamily;
}

/** Inbound references to the delete set, per measured relation. Must be zero everywhere. */
async function measureDependents(client) {
  const out = [];
  for (const dependent of DEPENDENTS) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM ${dependent.relation} WHERE ${dependent.column} = ANY($1::text[])`, [idsOf(dependent.families)]);
    out.push({
      relation: dependent.relation, column: dependent.column, fkBacked: dependent.fkBacked,
      appendOnly: dependent.appendOnly === true, inbound: Number(rows[0].n),
    });
  }
  return out;
}

/** The fingerprint of a measured state: what exists, keyed by id, plus every inbound count. */
function fingerprintState(perFamily, dependents) {
  const present = [];
  for (const family of Object.keys(FAMILY)) {
    for (const row of perFamily[family].tenantRows) present.push([family, row.id, row.number]);
  }
  present.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const inbound = dependents.map((d) => [d.relation, d.column, d.inbound]);
  return sha256(canonical({ present, inbound }));
}

/**
 * Every precondition K2 requires, decided from the measurement. An empty findings list means the cleanup may
 * proceed. It NEVER returns "probably fine": a fact that does not match is a finding, and a finding stops the run.
 */
function decidePreconditions(perFamily, dependents, foreignKeys) {
  const findings = [];
  const byId = new Map(DELETE_SET.map((r) => [r.id, r]));
  let confirmed = 0;
  for (const family of Object.keys(FAMILY)) {
    const expectedIds = DELETE_SET.filter((r) => r.family === family).map((r) => r.id);
    for (const row of perFamily[family].tenantRows) {
      const expected = byId.get(row.id);
      if (!expected || expected.family !== family) {
        findings.push({ code: "TENANT_HOLDS_A_RECORD_OUTSIDE_THE_REVIEWED_SET", detail: `${family} ${row.id} (${row.number}) is not in the reviewed identity set` });
        continue;
      }
      if (row.number !== expected.number) {
        findings.push({ code: "NUMBER_DIFFERS_FROM_REVIEWED_SET", detail: `${row.id} carries '${row.number}'; the reviewed set says '${expected.number}'` });
        continue;
      }
      confirmed += 1;
    }
    for (const id of expectedIds) {
      if (!perFamily[family].tenantRows.some((r) => r.id === id)) {
        findings.push({ code: "REVIEWED_RECORD_ABSENT", detail: `${family} ${id} (${byId.get(id).number}) is not in the tenant` });
      }
    }
    // A row of these families in ANY other tenant means the population the authorization described is not the
    // population that exists. It is never deleted; it is reported, and it stops the run.
    const outsideTenant = perFamily[family].instanceTotal - perFamily[family].tenantRows.length;
    if (outsideTenant !== 0) {
      findings.push({ code: "RECORDS_EXIST_OUTSIDE_THE_AUTHORIZED_TENANT", detail: `${outsideTenant} ${family} row(s) live in another tenant` });
    }
  }
  if (confirmed !== DELETE_SET.length) {
    findings.push({ code: "EXACT_SET_NOT_CONFIRMED", detail: `${confirmed}/${DELETE_SET.length} reviewed records confirmed present with the expected number` });
  }
  for (const dependent of dependents) {
    if (dependent.inbound !== 0) {
      findings.push({
        code: dependent.appendOnly ? "APPEND_ONLY_HISTORY_REFERENCES_THE_SET" : "UNEXPECTED_DEPENDENT_ROWS",
        detail: `${dependent.relation}.${dependent.column} holds ${dependent.inbound} inbound reference(s) to the delete set`,
      });
    }
  }
  if (!foreignKeys.agrees) {
    findings.push({
      code: "FK_GRAPH_DIFFERS_FROM_THE_ENCODED_ORDER",
      detail: `missing=${JSON.stringify(foreignKeys.missing)} unencoded=${JSON.stringify(foreignKeys.unencoded)} `
        + `outOfOrder=${JSON.stringify(foreignKeys.outOfOrder || [])}; the delete order encodes a schema the database no longer has`,
    });
  }
  if (foreignKeys.cascading.length > 0) {
    findings.push({ code: "CASCADING_FOREIGN_KEY_PRESENT", detail: `${foreignKeys.cascading.map((c) => c.constraint).join(", ")} would remove rows this tool never counted` });
  }
  return findings;
}

// ════════════════════════════ the run ════════════════════════════

async function runCleanup(client, options) {
  const integrity = assertDeleteSetIntegrity();
  const provenance = declaredSyntheticSeedProvenance();

  // plan runs READ ONLY: the DATABASE refuses a write, not merely this file's control flow.
  await client.query(options.apply ? "BEGIN" : "BEGIN READ ONLY");
  let committed = false;
  try {
    // THE SAME KEY commercialC5Target.ts copyCommercial takes, so a cleanup and a C5 copy cannot interleave.
    // Taken in plan mode too, so a dry run cannot measure a state a concurrent copy is halfway through.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`commercial-c5|${REQUIRED_TENANT_ID}`]);

    const tenant = await client.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [options.tenantKey]);
    if (tenant.rows.length !== 1) refuse("TENANT_UNRESOLVED", `no single tenant with key ${options.tenantKey}; this tool never creates one`);
    const tenantId = tenant.rows[0].id;
    if (tenantId !== REQUIRED_TENANT_ID) {
      refuse("TENANT_REFUSED",
        `--tenantKey ${options.tenantKey} resolves to '${tenantId}', but the authorization names '${REQUIRED_TENANT_ID}'. The key is not the binding; the id is.`);
    }

    const foreignKeys = await measureForeignKeys(client);
    const before = await measureCommercial(client, tenantId);
    const dependentsBefore = await measureDependents(client);
    const preFingerprint = fingerprintState(before, dependentsBefore);
    const findings = decidePreconditions(before, dependentsBefore, foreignKeys);

    const report = {
      classification: CLASSIFICATION,
      environment: options.environmentId,
      tenantKey: options.tenantKey,
      tenantId,
      performedBy: options.performedBy,
      mode: options.mode,
      applied: false,
      deleteSetSha256: integrity.deleteSetSha256,
      authorizedPopulation: AUTHORIZED_POPULATION,
      // THE ARTIFACT CONTAINS THE REVIEWED EXACT IDENTITY SET, each id with the manifest that declares its number.
      deleteSet: DELETE_SET.map((r) => ({
        family: r.family, id: r.id, number: r.number, classification: CLASSIFICATION,
        declaredBy: (provenance.find((p) => p.number === r.number) || { declaredBy: [] }).declaredBy,
      })),
      foreignKeys: {
        measured: foreignKeys.constraints,
        cascading: foreignKeys.cascading.map((c) => c.constraint),
        interFamily: foreignKeys.interFamily,
        agreesWithEncodedOrder: foreignKeys.agrees,
      },
      deleteOrder: [
        ...CHILD_DELETE_ORDER.map((c) => `${c.relation}.${c.column}`),
        ...FAMILY_DELETE_ORDER.map((f) => `eos_commercial.${FAMILY[f].table}`),
      ],
      before: {
        perFamily: Object.fromEntries(Object.entries(before).map(([k, v]) => [k, { tenantRows: v.tenantRows.length, instanceTotal: v.instanceTotal, ids: v.tenantRows.map((r) => r.id) }])),
        dependents: dependentsBefore,
      },
      preFingerprint,
      preconditions: { met: findings.length === 0, findings },
      steps: [],
    };

    if (findings.length > 0 || !options.apply) {
      await client.query("ROLLBACK");
      report.rolledBack = true;
      report.outcome = findings.length > 0 ? "PRECONDITIONS_NOT_MET" : "PLAN_ONLY_NOTHING_WRITTEN";
      return { report, exitCode: findings.length > 0 ? 1 : 0 };
    }

    // ---- the deletes. Leaves first, every rowcount asserted, every statement bound to the exact ids.
    for (const child of CHILD_DELETE_ORDER) {
      const result = await client.query(`DELETE FROM ${child.relation} WHERE ${child.column} = ANY($1::text[])`, [idsOf(child.families)]);
      if (result.rowCount !== 0) {
        refuse("ROWCOUNT_UNEXPECTED", `${child.relation}.${child.column}: deleted ${result.rowCount}, expected 0 (the preflight measured no inbound rows)`);
      }
      report.steps.push({ statement: `DELETE ${child.relation} WHERE ${child.column} IN (:exactIds)`, expected: 0, deleted: result.rowCount });
    }
    for (const family of FAMILY_DELETE_ORDER) {
      const shape = FAMILY[family];
      const ids = idsOf([family]);
      const result = await client.query(
        `DELETE FROM eos_commercial.${shape.table} WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, ids]);
      if (result.rowCount !== ids.length) {
        refuse("ROWCOUNT_UNEXPECTED", `eos_commercial.${shape.table}: deleted ${result.rowCount}, expected ${ids.length}`);
      }
      report.steps.push({
        statement: `DELETE eos_commercial.${shape.table} WHERE tenant_id = :tenantId AND id IN (:exactIds)`,
        expected: ids.length, deleted: result.rowCount, ids,
      });
    }

    // ---- POST-FINGERPRINT, re-measured from the database rather than inferred from the rowcounts.
    const after = await measureCommercial(client, tenantId);
    const dependentsAfter = await measureDependents(client);
    const remaining = DELETE_SET.filter((r) => after[r.family].tenantRows.some((row) => row.id === r.id));
    const collateral = Object.values(after).reduce((n, v) => n + v.instanceTotal, 0);
    if (remaining.length > 0) refuse("POST_STATE_UNEXPECTED", `${remaining.length} of the reviewed records are still present after the delete`);
    if (collateral !== 0) {
      refuse("POST_STATE_UNEXPECTED",
        `${collateral} Commercial row(s) remain in the instance; the reviewed set was the whole measured population, so this is collateral or drift`);
    }

    report.after = {
      perFamily: Object.fromEntries(Object.entries(after).map(([k, v]) => [k, { tenantRows: v.tenantRows.length, instanceTotal: v.instanceTotal }])),
      dependents: dependentsAfter,
    };
    report.postFingerprint = fingerprintState(after, dependentsAfter);
    report.rowsRemoved = report.steps.reduce((n, s) => n + s.deleted, 0);
    if (report.rowsRemoved !== AUTHORIZED_POPULATION.total) {
      refuse("ROWCOUNT_UNEXPECTED", `${report.rowsRemoved} rows removed in total; the authorization covers exactly ${AUTHORIZED_POPULATION.total}`);
    }

    await client.query("COMMIT");
    committed = true;
    report.applied = true;
    report.rolledBack = false;
    report.outcome = "CLEANUP_APPLIED";
    return { report, exitCode: 0 };
  } catch (err) {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // THE FENCE FIRST, before any client or lib/ module exists.
  const options = assertCleanupInvocation(args, process.env);

  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const client = new pg.Client(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));
  await client.connect();
  try {
    const { report, exitCode } = await runCleanup(client, options);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = exitCode;
  } finally {
    await client.end();
  }
}

module.exports = {
  assertCleanupInvocation, assertDeleteSetIntegrity, deleteSetFingerprint, decidePreconditions, fingerprintState,
  runCleanup, DELETE_SET, DEPENDENTS, CHILD_DELETE_ORDER, FAMILY_DELETE_ORDER, FAMILY, MODES,
  AUTHORIZED_POPULATION, CLASSIFICATION, REQUIRED_ENVIRONMENT, REQUIRED_TENANT_KEY, REQUIRED_TENANT_ID,
  CommercialSyntheticCleanupError,
};

if (require.main === module) {
  main().catch((err) => {
    // A governed refusal speaks for itself; a driver or connection error is reduced to its code, because its
    // message can carry a host or a user.
    const governed = !err || !err.code || err.name === "CommercialSyntheticCleanupError";
    const details = err && err.details ? { details: err.details } : {};
    const message = governed ? (err instanceof Error ? err.message : String(err)) : "the run could not be completed";
    console.error(JSON.stringify({ outcome: "REFUSED_OR_FAILED", code: err && err.code ? err.code : null, message, ...details }, null, 2));
    process.exitCode = 2;
  });
}
