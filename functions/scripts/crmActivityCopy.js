// THE CRM-ACTIVITY COPY -- CENSUS (the default), COPY (Owner-gated), VERIFY -- Firestore `crm_activities` -> eos_crm.activities
// (Firebase exit F7b, DECISIONS #243).
//
//   --mode census   (THE DEFAULT; READ ONLY.) Every snapshot record classified against the tenant: COPYABLE /
//                   ALREADY_PRESENT_EQUIVALENT / CONFLICT / BLOCKED (with reasons -- notably ACCOUNT_NOT_IN_EOS, an activity
//                   whose Account the PostgreSQL CRM does not hold), counts by type and by Account. Prints the copy checksum.
//                   Writes nothing.
//   --mode copy     NEVER WITHOUT THE OWNER'S EXPLICIT GO-AHEAD: requires --ownerAuthorization <the Owner's ruling reference>.
//                   INSERT ONLY, ONE transaction, as the EOS Principal --principalId (an active tenant member), bound to
//                   --reviewedChecksum. Refuses, writing nothing, on drift, any CONFLICT or any BLOCKED record. Rows keep their
//                   Firestore id and are MIGRATED; the Firebase actor is evidence only (created_by stays NULL). Firestore is
//                   never touched: this tool loads no Firebase module.
//   --mode verify   READ ONLY. Every snapshot record present with equal fields; no MIGRATED row the snapshot lacks.
//
// Accounts are tenant-scoped (eos_crm.accounts carries no operating company), so there is no company mapping to supply.
//
// The fence is catalogCutover.js's, reused: a declared non-production --environment and --databaseUrlEnv, EOS_ENVIRONMENT
// exactly `nonprod`, never platform-certification, --tenantKey and --snapshot named; the snapshot from the project the
// environment declares, never production.
//
// Usage (Render Shell on eos-api-nonprod; operator-run):
//   node scripts/crmActivityCopy.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL --tenantKey taylor-nonprod \
//     --snapshot ./crm-activity-snapshot.json                                                          # census
//   ... --mode copy --principalId <EOS principal> --reviewedChecksum <census> --ownerAuthorization "<ruling>"
//   ... --mode verify
//
// Exit: 0 census copy-ready / copy applied or no-op / verify reconciled; 1 not copy-ready / not reconciled; 2 refused/failed.
"use strict";

const crypto = require("node:crypto");
const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");
const { verifySnapshotChecksum, assertSnapshotSource } = require("./catalogCutover.js");

const MODES = Object.freeze(["census", "copy", "verify"]);
const TYPES = Object.freeze(["SALES_NOTE", "CALL", "MEETING", "RELATIONSHIP", "GENERAL"]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const named = (v) => typeof v === "string" && v !== "true" && v.trim() !== "";
const nonBlank = (v) => typeof v === "string" && v.trim() !== "";

function assertCopyInvocation(args, env) {
  const mode = args.mode === undefined ? "census" : args.mode;
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(" | ")} (got '${mode}').`);
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (environmentId === "platform-certification") throw new Error("--environment 'platform-certification' is the Certification world, which is frozen.");
  if (!named(args.tenantKey)) throw new Error("--tenantKey is required: the tenant is named, never inferred.");
  if (!named(args.snapshot)) throw new Error("--snapshot <file> is required: the copy consumes an exported snapshot, never a live Firestore read.");
  if (mode === "copy") {
    if (!named(args.ownerAuthorization)) throw new Error("--ownerAuthorization is required for copy: the copy never runs without the Owner's explicit go-ahead.");
    if (!named(args.principalId)) throw new Error("--principalId <EOS principal id> is required for copy: rows are written as an EOS Principal.");
    if (!named(args.reviewedChecksum)) throw new Error("--reviewedChecksum is required for copy: the checksum the reviewed census printed.");
  }
  return { mode, environmentId, connectionString, tenantKey: args.tenantKey, snapshotPath: args.snapshot, principalId: args.principalId,
    reviewedChecksum: args.reviewedChecksum, ownerAuthorization: args.ownerAuthorization ?? null };
}

/** A Firestore Timestamp as the exporter tagged it -> microsecond ISO, or null. */
function instant(v) {
  const t = v && v.$timestamp;
  if (!t || !Number.isInteger(t.seconds) || !Number.isInteger(t.nanoseconds)) return null;
  return new Date(t.seconds * 1000).toISOString().replace(/\.\d{3}Z$/, `.${String(Math.floor(t.nanoseconds / 1000)).padStart(6, "0")}Z`);
}
const millisIso = (n) => (typeof n === "number" && Number.isFinite(n) ? new Date(n).toISOString().replace(/Z$/, "000Z") : null);
const optId = (v) => (nonBlank(v) ? v.trim() : null);

/** The snapshot's records in the target's shape, with what blocks each (shape only). Pure; exported for tests. */
function sourceRecords(raw) {
  if (!raw || raw.format !== "EOS_CRM_ACTIVITY_SNAPSHOT" || !Array.isArray(raw.crmActivities)) {
    throw new Error("not an EOS_CRM_ACTIVITY_SNAPSHOT file (scripts/exportCrmActivitySnapshot.js writes one).");
  }
  return raw.crmActivities.map(({ id, data: d = {} }) => {
    const blockers = [];
    if (!ID.test(String(id))) blockers.push("ID_INVALID");
    if (!nonBlank(d.accountId)) blockers.push("ACCOUNT_MISSING");
    if (!TYPES.includes(d.type)) blockers.push("TYPE_UNKNOWN");
    if (!nonBlank(d.body) || d.body.trim().length > 4000) blockers.push("BODY_INVALID");
    const occurredAt = millisIso(d.occurredAtMillis);
    if (occurredAt === null) blockers.push("OCCURRED_AT_MISSING");
    const createdAt = instant(d.createdAt);
    if (createdAt === null) blockers.push("CREATED_AT_MISSING");
    return { id: String(id), accountId: optId(d.accountId), contactId: optId(d.contactId), opportunityId: optId(d.opportunityId),
      salesOrderId: optId(d.salesOrderId), type: d.type ?? null, body: nonBlank(d.body) ? d.body.trim() : null, occurredAt, createdAt,
      legacyCreatedBy: d.createdByUid ?? null, blockers };
  });
}

/** The checksum a copy is bound to, id-ordered. Pure; exported for tests. */
function copyChecksum(records) {
  return crypto.hash("sha256", [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ legacyCreatedBy, blockers, ...fields }) => JSON.stringify(fields)).join("\n"));
}

const FIELDS = ["accountId", "contactId", "opportunityId", "salesOrderId", "type", "body", "occurredAt", "createdAt"];

/** Classify against the tenant's Accounts and existing rows. Pure; exported for tests. */
function classify(records, { accounts, existing }) {
  return records.map((r) => {
    const blockers = [...r.blockers];
    if (r.accountId !== null && !accounts.has(r.accountId)) blockers.push("ACCOUNT_NOT_IN_EOS");
    if (blockers.length > 0) return { id: r.id, disposition: "BLOCKED", blockers };
    const e = existing.get(r.id);
    if (!e) return { id: r.id, disposition: "COPYABLE", blockers, target: r };
    const same = FIELDS.every((k) => (e[k] ?? null) === (r[k] ?? null));
    return { id: r.id, disposition: same ? "ALREADY_PRESENT_EQUIVALENT" : "CONFLICT", blockers, target: r };
  });
}

const tally = (items, key) => items.reduce((acc, x) => { const k = key(x) ?? "(none)"; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const o = assertCopyInvocation(args, process.env);
  const { bytes, sha256 } = verifySnapshotChecksum(o.snapshotPath);
  const raw = JSON.parse(bytes.toString("utf8"));
  assertSnapshotSource(raw, o.environmentId);
  const records = sourceRecords(raw);
  const checksum = copyChecksum(records);

  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const client = new pg.Client(resolvePolicyDatabaseConfig({ connectionString: o.connectionString }));
  await client.connect();
  try {
    const tenant = await client.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [o.tenantKey]);
    if (tenant.rows.length !== 1) throw new Error(`no tenant with key ${o.tenantKey}; the copy never creates one.`);
    const tenantId = tenant.rows[0].id;
    const header = { mode: o.mode, environment: o.environmentId, tenantKey: o.tenantKey, tenantId, snapshotSha256: sha256 };
    const ts = (col) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    const readTenant = async () => ({
      accounts: new Set((await client.query("SELECT id FROM eos_crm.accounts WHERE tenant_id = $1", [tenantId])).rows.map((r) => r.id)),
      existing: new Map((await client.query(
        `SELECT id, account_id, contact_id, opportunity_id, sales_order_id, type, body, provenance, ${ts("occurred_at")} AS occurred_at, ${ts("created_at")} AS created_at
           FROM eos_crm.activities WHERE tenant_id = $1`, [tenantId])).rows.map((r) => [r.id, {
        accountId: r.account_id, contactId: r.contact_id, opportunityId: r.opportunity_id, salesOrderId: r.sales_order_id, type: r.type,
        body: r.body, occurredAt: r.occurred_at, createdAt: r.created_at, provenance: r.provenance }])),
    });

    if (o.mode !== "copy") {
      await client.query("BEGIN READ ONLY");
      const state = await readTenant();
      await client.query("COMMIT");
      const rows = classify(records, state);
      const by = (d) => rows.filter((r) => r.disposition === d);
      if (o.mode === "census") {
        const report = { checksum, sourceCount: records.length, copyable: by("COPYABLE").length,
          alreadyPresentEquivalent: by("ALREADY_PRESENT_EQUIVALENT").length, conflictIds: by("CONFLICT").map((r) => r.id),
          blocked: by("BLOCKED").map((r) => ({ id: r.id, blockers: r.blockers })),
          accountGaps: rows.filter((r) => r.blockers.includes("ACCOUNT_NOT_IN_EOS")).length,
          byType: tally(records, (r) => r.type), byAccount: tally(records, (r) => r.accountId),
          copyReady: by("CONFLICT").length === 0 && by("BLOCKED").length === 0,
          legacyActorProvenance: tally(records, (r) => r.legacyCreatedBy) };
        console.log(JSON.stringify({ ...header, readOnly: true, report }, null, 2));
        process.exitCode = report.copyReady ? 0 : 1;
      } else {
        const ids = new Set(records.map((r) => r.id));
        const notReconciled = rows.filter((r) => r.disposition !== "ALREADY_PRESENT_EQUIVALENT").map((r) => ({ id: r.id, disposition: r.disposition }));
        const extra = [...state.existing].filter(([id, e]) => e.provenance === "MIGRATED" && !ids.has(id)).map(([id]) => id);
        const report = { sourceCount: records.length, migratedRowCount: [...state.existing.values()].filter((e) => e.provenance === "MIGRATED").length,
          notReconciled, extraMigratedRows: extra, reconciled: notReconciled.length === 0 && extra.length === 0 };
        console.log(JSON.stringify({ ...header, readOnly: true, report }, null, 2));
        process.exitCode = report.reconciled ? 0 : 1;
      }
      return;
    }

    if (checksum !== o.reviewedChecksum) throw new Error("SOURCE_CHECKSUM_DRIFT: the snapshot no longer matches the reviewed census; re-run the census.");
    await client.query("BEGIN");
    try {
      const member = await client.query(
        `SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
          WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`, [tenantId, o.principalId]);
      if (member.rows.length === 0) throw new Error("the copy Principal is not an active member of the target tenant.");
      await client.query("LOCK TABLE eos_crm.activities IN SHARE ROW EXCLUSIVE MODE");
      const rows = classify(records, await readTenant());
      const conflict = rows.filter((r) => r.disposition === "CONFLICT").map((r) => r.id);
      const blocked = rows.filter((r) => r.disposition === "BLOCKED").map((r) => r.id);
      if (conflict.length > 0) throw new Error(`TARGET_CONFLICT: ${conflict.length} target record(s) differ and are never overwritten: ${conflict.join(", ")}`);
      if (blocked.length > 0) throw new Error(`SOURCE_BLOCKED: ${blocked.length} record(s) cannot be copied: ${blocked.join(", ")}`);
      const inserts = rows.filter((r) => r.disposition === "COPYABLE").map((r) => r.target);
      for (const t of inserts) {
        await client.query(
          `INSERT INTO eos_crm.activities (tenant_id, id, account_id, contact_id, opportunity_id, sales_order_id, type, body, occurred_at,
                                           created_at, created_by, idempotency_key, provenance)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,NULL,'MIGRATED')`,
          [tenantId, t.id, t.accountId, t.contactId, t.opportunityId, t.salesOrderId, t.type, t.body, t.occurredAt, t.createdAt]);
      }
      if (inserts.length > 0) {
        await client.query(
          `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
           VALUES ($1,$2,'crm.activity.copy',$3,'crm_activity_copy',$4,NULL,$5::jsonb,now(),$6)`,
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

module.exports = { assertCopyInvocation, sourceRecords, copyChecksum, classify, MODES };

if (require.main === module) {
  main().catch((err) => {
    const governed = !err || !err.code;
    console.error(JSON.stringify({ outcome: "REFUSED_OR_FAILED", code: err && err.code ? err.code : null,
      message: governed ? (err instanceof Error ? err.message : String(err)) : "the run could not be completed" }, null, 2));
    process.exitCode = 2;
  });
}
