#!/usr/bin/env node
// THE WORK ORDER MIGRATION DRY RUN -- read-only, sandbox-only.
//
//   node scripts/workOrderMigrationDryRun.mjs [--project eos-platform-sandbox] [--manifest <file.json>]
//
// WHAT IT DOES: reads the source Work Order population and exactly the supporting facts needed to
// CLASSIFY it, builds one deterministic checksummed snapshot, and runs the pure classification core
// (lib/eosOps/migration/workOrderMigrationDryRun.js) over it.
//
// WHAT IT CANNOT DO: write. There is no `set`, `update`, `delete`, `add`, `commit` or `INSERT` in this
// file, and a test asserts that by reading the source. The Firestore handle is used only for `.get()`,
// and the PostgreSQL handle only for one SELECT.
//
// PRODUCTION IS REFUSED BY NAME, before any credential is used and before any read: the target must be
// exactly the sandbox project. An unknown project is refused too -- "not production" is not evidence of
// "safe", which is the same posture importTargetGuard.ts takes for Data Import.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../lib/eosOps/migration/workOrderMigrationDryRun.js");

export const ALLOWED_SOURCE_PROJECT = "eos-platform-sandbox";
export const PRODUCTION_PROJECT_ID = "taylor-parts";

/** No default target, and production refused by name before anything else happens. */
export function assertSandboxSource(projectId) {
  if (typeof projectId !== "string" || projectId.trim() === "") {
    throw new Error("REFUSING: an explicit --project is required. This tool has no default target.");
  }
  const target = projectId.trim();
  if (target === PRODUCTION_PROJECT_ID) {
    throw new Error(`REFUSING: '${PRODUCTION_PROJECT_ID}' is the customer production project. This tool is sandbox-only.`);
  }
  if (target !== ALLOWED_SOURCE_PROJECT) {
    throw new Error(`REFUSING: '${target}' is not ${ALLOWED_SOURCE_PROJECT}. Unknown sources fail closed.`);
  }
  return target;
}

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const project = assertSandboxSource(arg("project", ALLOWED_SOURCE_PROJECT));
  const admin = require("firebase-admin");
  admin.initializeApp({ projectId: project });
  const db = admin.firestore();

  // ── source population ──
  const woSnap = await db.collection("fieldops_wos").get();
  const records = woSnap.docs.map((d) => ({ id: d.id, data: d.data() }));

  // ── exactly the supporting facts the classification needs, and nothing broader ──
  const techSnap = await db.collection("fieldops_technicians").get();
  const technicians = new Map(techSnap.docs.map((d) => [d.id, { employeeId: d.get("employeeId") ?? null }]));
  const empSnap = await db.collection("employees").get();
  const employees = new Set(empSnap.docs.map((d) => d.id));

  const referenced = (field) => [...new Set(records.map((r) => r.data[field]).filter((v) => typeof v === "string" && v))];
  const salesOrders = new Map();
  for (const id of referenced("salesOrderId")) {
    const doc = await db.collection("sales_orders").doc(id).get();
    if (doc.exists) salesOrders.set(id, { operatingCompanyId: doc.get("operatingCompanyId") ?? null });
  }
  const setOf = async (collection, ids) => {
    const out = new Set();
    for (const id of ids) {
      const doc = await db.collection(collection).doc(id).get();
      if (doc.exists) out.add(id);
    }
    return out;
  };
  const accounts = await setOf("accounts", referenced("customerId"));
  const locations = await setOf("locations", referenced("locationId"));
  const equipment = await setOf("equipment", referenced("equipmentId"));

  // ── the Owner's resolution manifest, if one was written. NEVER authored here. ──
  const manifestPath = arg("manifest");

  // ── target collision check, READ ONLY and optional ──
  let targetWorkOrderIds = null;
  const targetUrl = process.env.WORK_ORDER_TARGET_DATABASE_URL ?? "";
  if (targetUrl) {
    const pg = require("pg");
    const client = new pg.Client({ connectionString: targetUrl });
    await client.connect();
    try {
      const { rows } = await client.query("SELECT id FROM eos_ops.work_orders");
      targetWorkOrderIds = new Set(rows.map((r) => String(r.id)));
    } finally {
      await client.end();
    }
  }

  const snapshot = core.buildSourceSnapshot(project, "fieldops_wos", records, sha256);
  const baseEvidence = { technicians, employees, salesOrders, accounts, locations, equipment, targetWorkOrderIds };

  // TWO PASSES, DELIBERATELY. The manifest is validated against the CLASSIFIED population -- which records
  // are business and which are fixtures -- and that classification is itself an output of the dry run. So
  // the first pass runs with no manifest and establishes the population a human could read; the manifest
  // is then checked against exactly that. Validating against the raw source instead would accept a
  // decision about a fixture, which is the misreading the refusal exists to catch.
  const firstPass = core.runDryRun({ snapshot, records, evidence: { ...baseEvidence, resolutionManifest: null } });
  let resolutionManifest = null;
  if (manifestPath) {
    resolutionManifest = core.validateResolutionManifest(JSON.parse(readFileSync(manifestPath, "utf8")), {
      snapshotBodySha256: snapshot.bodySha256,
      businessIds: new Set(firstPass.records.filter((r) => r.recordClass === "BUSINESS").map((r) => r.workOrderId)),
      fixtureIds: new Set(firstPass.records.filter((r) => r.recordClass !== "BUSINESS").map((r) => r.workOrderId)),
      employeeIds: employees,
    });
    console.log(`manifest accepted: ${resolutionManifest.decisionId} (${resolutionManifest.byWorkOrderId.size} decision(s))`);
  }

  const report = manifestPath
    ? core.runDryRun({ snapshot, records, evidence: { ...baseEvidence, resolutionManifest } })
    : firstPass;

  print(report);
  printWorksheets(report, records);
  if (process.argv.includes("--scaffold")) {
    // Printed, never written to disk by this tool: the Owner saves it where they will edit it, and a
    // file this tool wrote could be mistaken for a decision it made.
    console.log("MANIFEST SCAFFOLD (blank -- every decision field is null, and it is REFUSED until filled)");
    console.log(JSON.stringify(core.buildManifestScaffold(report, records), null, 2));
  }
  return report;
}

function print(report) {
  const s = report.summary;
  const line = (label, value) => console.log(`  ${String(label).padEnd(44)} ${value}`);
  console.log(`\nWORK ORDER MIGRATION DRY RUN -- ${report.snapshot.sourceProject} / ${report.snapshot.collection}`);
  console.log(`snapshot bodySha256: ${report.snapshot.bodySha256}`);
  console.log(`documents: ${report.snapshot.documentCount}\n`);

  console.log("FIXTURE FAMILIES");
  for (const f of report.families) {
    console.log(`  ${f.key}  excluded=${f.excluded}  members=${f.memberIds.length}  diverged=${f.divergedIds.length}`);
    console.log(`    authored by ${f.authoredBy}`);
    if (f.refusalReason) console.log(`    ${f.refusalReason}`);
  }

  console.log("\nTOTALS");
  line("SOURCE_TOTAL", s.sourceTotal);
  line("PROVEN_BUSINESS", s.provenBusiness);
  line("PROVEN_FIXTURE_OR_NONBUSINESS", s.provenFixtureOrNonbusiness);
  line("COPYABLE", s.copyable);
  line("EXCLUDED_WITH_EVIDENCE", s.excluded);
  line("BLOCKED", s.blocked);

  console.log("\nBLOCKERS BY KIND (these OVERLAP -- do not add them up)");
  for (const [kind, n] of Object.entries(s.blockersByKind)) if (n > 0) line(kind, n);
  line("DISTINCT BLOCKED RECORDS", s.blockedRecordCount);

  console.log("\nBLOCKER INTERSECTIONS (records carrying exactly this combination)");
  for (const i of s.blockerIntersections) console.log(`  ${String(i.records).padStart(3)}  ${i.kinds.join(" + ")}`);

  console.log("\nOPERATING COMPANY");
  const oc = new Map();
  for (const r of report.records.filter((x) => x.recordClass === "BUSINESS")) {
    const k = `${r.operatingCompany.resolutionStatus} :: ${r.operatingCompany.evidenceKind}`;
    oc.set(k, (oc.get(k) ?? 0) + 1);
  }
  for (const [k, n] of oc) console.log(`  ${String(n).padStart(3)}  ${k}`);

  console.log("\nTYPE");
  const ty = new Map();
  for (const r of report.records) {
    const k = `${String(r.type.sourceValue)} -> ${r.type.action}  (deterministic=${r.type.deterministic}, class=${r.recordClass})`;
    ty.set(k, (ty.get(k) ?? 0) + 1);
  }
  for (const [k, n] of ty) console.log(`  ${String(n).padStart(3)}  ${k}`);

  console.log("\nNUMBER");
  const nu = new Map();
  for (const r of report.records) {
    const k = `${r.number.shape} -> ${r.number.action}  (class=${r.recordClass})`;
    nu.set(k, (nu.get(k) ?? 0) + 1);
  }
  for (const [k, n] of nu) console.log(`  ${String(n).padStart(3)}  ${k}`);

  console.log("\nASSIGNMENT");
  const as = new Map();
  for (const r of report.records) as.set(r.assignment.outcome, (as.get(r.assignment.outcome) ?? 0) + 1);
  for (const [k, n] of as) console.log(`  ${String(n).padStart(3)}  ${k}`);
  const refs = new Map();
  for (const r of report.records) {
    for (const ref of r.assignment.references) {
      if (ref.technicianId === null) continue;
      const k = `${ref.field}: ${ref.resolution}`;
      refs.set(k, (refs.get(k) ?? 0) + 1);
    }
  }
  for (const [k, n] of refs) console.log(`  ${String(n).padStart(3)}  ${k}`);

  console.log("\nTARGET COLLISIONS");
  if (!report.targetCollisionStatusKnown) {
    console.log("  TARGET_COLLISION_STATUS_UNKNOWN -- no target database was provided");
  } else {
    const tc = new Map();
    for (const r of report.records) tc.set(r.targetCollision, (tc.get(r.targetCollision) ?? 0) + 1);
    for (const [k, n] of tc) console.log(`  ${String(n).padStart(3)}  ${k}`);
  }
  console.log("");
}

function printWorksheets(report, records) {
  const rows = core.buildOwnerWorksheet(report, records);
  console.log(`OWNER DECISION WORKSHEET -- ${rows.length} genuine business Work Order(s), sorted by woNumber`);
  console.log("  the OPERATING COMPANY column is intentionally blank and is never suggested\n");
  const head = ["woNumber", "workOrderId", "status", "srcType", "tgtType", "typeResolution",
                "customerId", "locationId", "equipmentId", "salesOrderId", "assignedTech", "scheduledTech", "COMPANY"];
  const body = rows.map((r) => [
    r.woNumber ?? "", r.workOrderId, r.status ?? "", String(r.sourceType), String(r.targetType), r.typeResolution,
    r.customerId ?? "", r.locationId ?? "", r.equipmentId ?? "", r.salesOrderId ?? "",
    r.assignedTechIdResolution, r.scheduledTechIdResolution, r.operatingCompanyDecision,
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => String(b[i]).length)));
  const line = (cells) => "  " + cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  console.log(line(head));
  console.log("  " + widths.map((w) => "-".repeat(w)).join("  "));
  for (const b of body) console.log(line(b));

  const assign = core.buildAssignmentWorksheet(report, records);
  console.log(`\nACTIVE ASSIGNMENT WORKSHEET -- ${assign.length} record(s) requiring an explicit Employee decision`);
  if (assign.length === 0) console.log("  (none)");
  for (const a of assign) {
    console.log(`  ${a.woNumber}  ${a.workOrderId}  ${a.status}`);
    console.log(`    legacy assignedTechId : ${a.legacyAssignedTechId ?? "(none)"}`);
    console.log(`    legacy scheduledTechId: ${a.legacyScheduledTechId ?? "(none)"}`);
    console.log(`    exact resolution      : ${a.exactResolutionResult}`);
    console.log(`    ASSIGNMENT EMPLOYEE DECISION: ${a.assignmentEmployeeDecision || "(blank)"}`);
  }
  console.log("");
}

if (process.argv[1] && process.argv[1].endsWith("workOrderMigrationDryRun.mjs")) {
  main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
