// THE RETURNS-INTAKE COPY -- CENSUS (the default), COPY (Owner-gated), VERIFY -- Firestore `inventory_returns` ->
// eos_ops.inventory_returns (Firebase exit F7a, DECISIONS #242; Owner ruling 2026-10-17, item 4).
//
// ============================ MODES ============================
//
//   --mode census   (THE DEFAULT; READ ONLY.) Every snapshot record classified against the tenant: COPYABLE /
//                   ALREADY_PRESENT_EQUIVALENT / CONFLICT / BLOCKED (with the reasons), counts by source, condition and
//                   company, and the COMPANY / WAREHOUSE MAPPING GAPS. Prints the checksum a copy must be given back. Writes
//                   nothing.
//   --mode copy     NEVER WITHOUT THE OWNER'S EXPLICIT GO-AHEAD: requires --ownerAuthorization <the Owner's ruling
//                   reference>, which is printed in the evidence. INSERT ONLY, ONE transaction, as the EOS Principal named by
//                   --principalId (an active tenant member), bound to --reviewedChecksum from the reviewed census. Refuses,
//                   writing nothing, on drift, any CONFLICT or any BLOCKED record. Rows are MIGRATED; the Firebase actor is
//                   evidence only (received_by stays NULL). An identical rerun inserts nothing. Firestore is never touched:
//                   this tool loads no Firebase module, so it cannot delete a source record.
//   --mode verify   READ ONLY. The reconciliation criteria: every snapshot record is present with equal fields, no MIGRATED
//                   row exists that the snapshot does not contain, and the counts agree. Repairs nothing.
//
// ============================ THE COMPANY IS NEVER GUESSED ============================
//
// A Firestore return carries no operating company and no warehouse. --mapping names them, per record, in a file a person
// wrote ({ format: "EOS_RETURNS_COMPANY_MAPPING", version: 1, returns: { "<returnId>": { operatingCompanyId, warehouseId? } } }).
// A record the mapping does not name is BLOCKED (COMPANY_UNMAPPED) -- there is no default company and no inference.
//
// ============================ THE FENCE (catalogCutover.js's, reused) ============================
//
// Before `pg` or lib/ loads: a declared non-production --environment and --databaseUrlEnv, EOS_ENVIRONMENT exactly `nonprod`,
// never platform-certification, --tenantKey and --snapshot named; the snapshot from the project the environment declares,
// never production. A production copy is a separate, Owner-gated change to this fence.
//
// Usage (Render Shell on eos-api-nonprod; operator-run):
//   node scripts/returnIntakeCopy.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL --tenantKey taylor-nonprod \
//     --snapshot ./returns-snapshot.json [--mapping ./returns-mapping.json]                                # census
//   ... --mode copy --mapping <file> --principalId <EOS principal> --reviewedChecksum <census> --ownerAuthorization "<ruling>"
//   ... --mode verify --mapping <file>
//
// Exit: 0 census copy-ready / copy applied or no-op / verify reconciled; 1 census not copy-ready or verify not reconciled;
// 2 refused or failed. Output: one JSON document; no connection string, no secrets.
"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");
const { verifySnapshotChecksum, assertSnapshotSource } = require("./catalogCutover.js");

const MODES = Object.freeze(["census", "copy", "verify"]);
const SOURCES = Object.freeze(["WORK_ORDER", "CUSTOMER", "TRUCK", "SUPPLIER", "UNKNOWN"]);
const CONDITIONS = Object.freeze(["UNOPENED", "OPENED", "DAMAGED", "UNKNOWN"]);
const named = (v) => typeof v === "string" && v !== "true" && v.trim() !== "";
const nonBlank = (v) => typeof v === "string" && v.trim() !== "";

/** Every refusal decidable from argv and the environment alone. No client, no lib/. */
function assertCopyInvocation(args, env) {
  const mode = args.mode === undefined ? "census" : args.mode;
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(" | ")} (got '${mode}').`);
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (environmentId === "platform-certification") throw new Error("--environment 'platform-certification' is the Certification world, which is frozen.");
  if (!named(args.tenantKey)) throw new Error("--tenantKey is required: the tenant is named, never inferred.");
  if (!named(args.snapshot)) throw new Error("--snapshot <file> is required: the copy consumes an exported snapshot, never a live Firestore read.");
  if (mode !== "census" && !named(args.mapping)) throw new Error("--mapping <file> is required: every return's company is named by a person, never guessed.");
  if (mode === "copy") {
    if (!named(args.ownerAuthorization)) throw new Error("--ownerAuthorization is required for copy: the copy never runs without the Owner's explicit go-ahead.");
    if (!named(args.principalId)) throw new Error("--principalId <EOS principal id> is required for copy: rows are written as an EOS Principal.");
    if (!named(args.reviewedChecksum)) throw new Error("--reviewedChecksum is required for copy: the checksum the reviewed census printed.");
  }
  return { mode, environmentId, connectionString, tenantKey: args.tenantKey, snapshotPath: args.snapshot, mappingPath: args.mapping ?? null,
    principalId: args.principalId, reviewedChecksum: args.reviewedChecksum, ownerAuthorization: args.ownerAuthorization ?? null };
}

/** A Firestore Timestamp as the exporter tagged it -> microsecond ISO, or null. */
function instant(v) {
  const t = v && v.$timestamp;
  if (!t || !Number.isInteger(t.seconds) || !Number.isInteger(t.nanoseconds)) return null;
  const micros = Math.floor(t.nanoseconds / 1000);
  return new Date(t.seconds * 1000).toISOString().replace(/\.\d{3}Z$/, `.${String(micros).padStart(6, "0")}Z`);
}

/** The snapshot's records in the target's shape, each with what blocks it (shape only; company and warehouse come later). */
function sourceRecords(raw) {
  if (!raw || raw.format !== "EOS_RETURNS_SNAPSHOT" || !Array.isArray(raw.inventoryReturns)) {
    throw new Error("not an EOS_RETURNS_SNAPSHOT file (scripts/exportReturnIntakeSnapshot.js writes one).");
  }
  return raw.inventoryReturns.map(({ id, data: d = {} }) => {
    const blockers = [];
    const serials = Array.isArray(d.serialNumbers) ? d.serialNumbers : [];
    const quantity = d.quantity === null || d.quantity === undefined ? null : d.quantity;
    if (!nonBlank(d.idempotencyKey) || id !== `ret_${d.idempotencyKey}`) blockers.push("ID_NOT_DERIVED");
    if (!nonBlank(d.partId)) blockers.push("PART_MISSING");
    if (!SOURCES.includes(d.source)) blockers.push("SOURCE_UNKNOWN");
    if (!CONDITIONS.includes(d.condition)) blockers.push("CONDITION_UNKNOWN");
    if (d.state !== "AWAITING_DISPOSITION") blockers.push("STATE_NOT_AWAITING_DISPOSITION");
    const qtyOk = serials.length > 0 ? quantity === null && serials.every(nonBlank) : Number.isInteger(quantity) && quantity > 0;
    if (!qtyOk) blockers.push("QUANTITY_OR_SERIALS_INVALID");
    if (d.reason !== null && d.reason !== undefined && (!nonBlank(d.reason) || d.reason.length > 500)) blockers.push("REASON_INVALID");
    const receivedAt = instant(d.receivedAt);
    if (receivedAt === null) blockers.push("RECEIVED_AT_MISSING");
    return {
      id: String(id), idempotencyKey: d.idempotencyKey ?? null, partId: nonBlank(d.partId) ? d.partId.trim() : null, source: d.source ?? null,
      sourceReference: nonBlank(d.sourceReference) ? d.sourceReference.trim() : null, condition: d.condition ?? null,
      reason: nonBlank(d.reason) ? d.reason.trim() : null, quantity: serials.length > 0 ? null : quantity, serialNumbers: serials.map((s) => String(s).trim()),
      receivedAt, legacyReceivedBy: d.receivedBy ?? null, blockers,
    };
  });
}

function readMapping(path) {
  if (path === null) return {};
  const m = JSON.parse(fs.readFileSync(path, "utf8"));
  if (!m || m.format !== "EOS_RETURNS_COMPANY_MAPPING" || m.version !== 1 || typeof m.returns !== "object") {
    throw new Error("--mapping is not an EOS_RETURNS_COMPANY_MAPPING version 1 file.");
  }
  return m.returns;
}

/** The checksum a copy is bound to: records AND their mapping, id-ordered. Pure; exported for tests. */
function copyChecksum(records, mapping) {
  const canonical = [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((r) => {
    const { legacyReceivedBy, blockers, ...fields } = r;
    return JSON.stringify({ ...fields, mapping: mapping[r.id] ?? null });
  });
  return crypto.hash("sha256", canonical.join("\n"));
}

const SAME_FIELDS = ["partId", "source", "sourceReference", "condition", "reason", "quantity", "receivedAt"];

/** Classify every record against the tenant's governed companies, warehouses and existing rows. Pure; exported for tests. */
function classify(records, mapping, { companies, warehouses, existing }) {
  return records.map((r) => {
    const blockers = [...r.blockers];
    const m = mapping[r.id];
    if (!m || !nonBlank(m.operatingCompanyId)) blockers.push("COMPANY_UNMAPPED");
    else if (!companies.has(m.operatingCompanyId)) blockers.push("COMPANY_NOT_GOVERNED");
    const warehouseId = m && nonBlank(m.warehouseId) ? m.warehouseId : null;
    if (m && warehouseId !== null) {
      const w = warehouses.get(warehouseId);
      if (!w) blockers.push("WAREHOUSE_NOT_FOUND");
      else if (w !== m.operatingCompanyId) blockers.push("WAREHOUSE_COMPANY_MISMATCH");
    }
    if (blockers.length > 0) return { id: r.id, disposition: "BLOCKED", blockers };
    const target = { ...r, operatingCompanyId: m.operatingCompanyId, warehouseId };
    const e = existing.get(r.id);
    if (!e) return { id: r.id, disposition: "COPYABLE", blockers, target };
    const same = SAME_FIELDS.every((k) => (e[k] ?? null) === (target[k] ?? null)) && e.operatingCompanyId === target.operatingCompanyId
      && (e.warehouseId ?? null) === target.warehouseId && JSON.stringify(e.serialNumbers) === JSON.stringify(target.serialNumbers);
    return { id: r.id, disposition: same ? "ALREADY_PRESENT_EQUIVALENT" : "CONFLICT", blockers, target };
  });
}

const tally = (items, key) => items.reduce((acc, x) => { const k = key(x) ?? "(none)"; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});

function censusReport(records, rows, mapping, checksum) {
  const by = (d) => rows.filter((r) => r.disposition === d);
  return {
    checksum, sourceCount: records.length,
    copyable: by("COPYABLE").length, alreadyPresentEquivalent: by("ALREADY_PRESENT_EQUIVALENT").length,
    conflictIds: by("CONFLICT").map((r) => r.id), blocked: by("BLOCKED").map((r) => ({ id: r.id, blockers: r.blockers })),
    bySource: tally(records, (r) => r.source), byCondition: tally(records, (r) => r.condition),
    byMappedCompany: tally(records, (r) => mapping[r.id]?.operatingCompanyId ?? null),
    mappingGaps: {
      unmapped: rows.filter((r) => r.blockers.includes("COMPANY_UNMAPPED")).length,
      companyNotGoverned: rows.filter((r) => r.blockers.includes("COMPANY_NOT_GOVERNED")).length,
      warehouseNotFound: rows.filter((r) => r.blockers.includes("WAREHOUSE_NOT_FOUND")).length,
      warehouseCompanyMismatch: rows.filter((r) => r.blockers.includes("WAREHOUSE_COMPANY_MISMATCH")).length,
      mappingNamesUnknownReturn: Object.keys(mapping).filter((id) => !records.some((r) => r.id === id)).length,
    },
    copyReady: by("CONFLICT").length === 0 && by("BLOCKED").length === 0,
    // The firebase actors are evidence, never a column.
    legacyActorProvenance: tally(records, (r) => r.legacyReceivedBy),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // THE FENCE FIRST, before any client or lib/ module exists.
  const o = assertCopyInvocation(args, process.env);
  const { bytes, sha256 } = verifySnapshotChecksum(o.snapshotPath);
  const raw = JSON.parse(bytes.toString("utf8"));
  assertSnapshotSource(raw, o.environmentId);
  const records = sourceRecords(raw);
  const mapping = readMapping(o.mappingPath);
  const checksum = copyChecksum(records, mapping);

  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const client = new pg.Client(resolvePolicyDatabaseConfig({ connectionString: o.connectionString }));
  await client.connect();
  try {
    const tenant = await client.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [o.tenantKey]);
    if (tenant.rows.length !== 1) throw new Error(`no tenant with key ${o.tenantKey}; the copy never creates one.`);
    const tenantId = tenant.rows[0].id;
    const header = { mode: o.mode, environment: o.environmentId, tenantKey: o.tenantKey, tenantId, snapshotSha256: sha256 };
    const readTenant = async () => {
      const companies = new Set((await client.query(
        "SELECT operating_company_id AS id FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 AND status = 'ACTIVE'", [tenantId])).rows.map((r) => r.id));
      const warehouses = new Map((await client.query(
        `SELECT w.id, k.operating_company_id AS company FROM eos_ops.warehouses w
           JOIN eos_policy.tenant_operating_company_keys k ON k.tenant_id = w.tenant_id AND k.operating_company_key = w.operating_company_key AND k.status = 'ACTIVE'
          WHERE w.tenant_id = $1`, [tenantId])).rows.map((r) => [r.id, r.company]));
      const existing = new Map((await client.query(
        `SELECT id, part_id, source, source_reference, condition, reason, quantity, serial_numbers, operating_company_id, warehouse_id, provenance,
                to_char(received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS received_at
           FROM eos_ops.inventory_returns WHERE tenant_id = $1`, [tenantId])).rows.map((r) => [r.id, {
        partId: r.part_id, source: r.source, sourceReference: r.source_reference, condition: r.condition, reason: r.reason,
        quantity: r.quantity, serialNumbers: r.serial_numbers, operatingCompanyId: r.operating_company_id, warehouseId: r.warehouse_id,
        receivedAt: r.received_at, provenance: r.provenance }]));
      return { companies, warehouses, existing };
    };

    if (o.mode !== "copy") {
      await client.query("BEGIN READ ONLY");
      const tenantState = await readTenant();
      await client.query("COMMIT");
      const rows = classify(records, mapping, tenantState);
      if (o.mode === "census") {
        const report = censusReport(records, rows, mapping, checksum);
        console.log(JSON.stringify({ ...header, readOnly: true, report }, null, 2));
        process.exitCode = report.copyReady ? 0 : 1;
      } else {
        const missing = rows.filter((r) => r.disposition !== "ALREADY_PRESENT_EQUIVALENT").map((r) => ({ id: r.id, disposition: r.disposition }));
        const ids = new Set(records.map((r) => r.id));
        const extra = [...tenantState.existing].filter(([id, e]) => e.provenance === "MIGRATED" && !ids.has(id)).map(([id]) => id);
        const report = { sourceCount: records.length, migratedRowCount: [...tenantState.existing.values()].filter((e) => e.provenance === "MIGRATED").length,
          notReconciled: missing, extraMigratedRows: extra, reconciled: missing.length === 0 && extra.length === 0 };
        console.log(JSON.stringify({ ...header, readOnly: true, report }, null, 2));
        process.exitCode = report.reconciled ? 0 : 1;
      }
      return;
    }

    if (checksum !== o.reviewedChecksum) throw new Error("SOURCE_CHECKSUM_DRIFT: the snapshot or mapping no longer matches the reviewed census; re-run the census.");
    await client.query("BEGIN");
    try {
      const member = await client.query(
        `SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
          WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`, [tenantId, o.principalId]);
      if (member.rows.length === 0) throw new Error("the copy Principal is not an active member of the target tenant.");
      await client.query("LOCK TABLE eos_ops.inventory_returns IN SHARE ROW EXCLUSIVE MODE");
      const rows = classify(records, mapping, await readTenant());
      const conflict = rows.filter((r) => r.disposition === "CONFLICT").map((r) => r.id);
      const blocked = rows.filter((r) => r.disposition === "BLOCKED").map((r) => r.id);
      if (conflict.length > 0) throw new Error(`TARGET_CONFLICT: ${conflict.length} target record(s) differ and are never overwritten: ${conflict.join(", ")}`);
      if (blocked.length > 0) throw new Error(`SOURCE_BLOCKED: ${blocked.length} record(s) cannot be copied: ${blocked.join(", ")}`);
      const inserts = rows.filter((r) => r.disposition === "COPYABLE").map((r) => r.target);
      for (const t of inserts) {
        await client.query(
          `INSERT INTO eos_ops.inventory_returns
             (tenant_id, id, idempotency_key, operating_company_id, warehouse_id, part_id, source, source_reference, condition, reason,
              quantity, serial_numbers, state, provenance, received_at, received_by, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'AWAITING_DISPOSITION','MIGRATED',$13,NULL,$14)`,
          [tenantId, t.id, t.idempotencyKey, t.operatingCompanyId, t.warehouseId, t.partId, t.source, t.sourceReference, t.condition, t.reason,
            t.quantity, t.serialNumbers, t.receivedAt, o.principalId]);
      }
      // One audit row per copy that changed something; a no-op rerun changed nothing and records nothing.
      if (inserts.length > 0) {
        await client.query(
          `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
           VALUES ($1,$2,'inventory.return.copy',$3,'inventory_return_copy',$4,NULL,$5::jsonb,now(),$6)`,
          [`audit_${crypto.randomUUID()}`, tenantId, o.principalId, checksum,
            JSON.stringify({ inserted: inserts.length, insertedIds: inserts.map((t) => t.id), snapshotSha256: sha256 }), `Owner authorization: ${o.ownerAuthorization}`]);
      }
      await client.query("COMMIT");
      console.log(JSON.stringify({ ...header, checksum, ownerAuthorization: o.ownerAuthorization, inserted: inserts.length,
        insertedIds: inserts.map((t) => t.id), outcome: inserts.length === 0 ? "NO_CHANGE" : "APPLIED" }, null, 2));
      process.exitCode = 0;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } finally {
    await client.end();
  }
}

module.exports = { assertCopyInvocation, sourceRecords, copyChecksum, classify, censusReport, MODES };

if (require.main === module) {
  main().catch((err) => {
    // A governed refusal speaks for itself; a driver error is reduced to its code (its message can carry a host).
    const governed = !err || !err.code;
    console.error(JSON.stringify({ outcome: "REFUSED_OR_FAILED", code: err && err.code ? err.code : null,
      message: governed ? (err instanceof Error ? err.message : String(err)) : "the run could not be completed" }, null, 2));
    process.exitCode = 2;
  });
}
