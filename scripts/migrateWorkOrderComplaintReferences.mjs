#!/usr/bin/env node
// LEGACY WORK ORDER COMPLAINT CORRECTION — governed runner.
//
// DRY RUN BY DEFAULT. Executing requires naming the destination AND passing a confirmation token
// equal to that destination, so a write is impossible by accidental default
// (docs/engineering/governed-migration-safety-pattern.md, gates 2 and 3).
//
//   node scripts/migrateWorkOrderComplaintReferences.mjs                       # dry run
//   node scripts/migrateWorkOrderComplaintReferences.mjs \
//        --apply --project eos-platform-sandbox --confirm eos-platform-sandbox/(default) \
//        --plan <fingerprint-from-the-dry-run>
//
// WHY THIS NEEDS AN OPERATOR. `fieldops_wos` is `allow create, update, delete: if false` — Work
// Orders are Admin-SDK-only writes, deliberately. This script therefore runs under Application
// Default Credentials that an authorized operator already holds; it never seeks, reads, prints or
// stores a credential of its own.
//
// PRODUCTION IS REFUSED BY IDENTITY, not by a flag anybody could forget.
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  planWorkOrderComplaintCorrection,
  MAX_MIGRATED_WORK_ORDERS,
  LEGACY_COMPLAINT_PATTERN,
} from "../functions/lib/serviceMigrations/workOrderComplaintReferenceMigration.js";

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const APPLY = argv.includes("--apply");
const PROJECT = flag("project") ?? "eos-platform-sandbox";
const CONFIRM = flag("confirm");
const EXPECTED_PLAN = flag("plan");

// ── GATE 0: production is not a target of this tool, at any argument combination.
if (/^taylor-parts$/i.test(PROJECT)) {
  console.error("REFUSING: taylor-parts is production. This migration is sandbox-only.");
  process.exit(2);
}

initializeApp({ credential: applicationDefault(), projectId: PROJECT });
const db = getFirestore();

// ── GATE 1: connected-destination proof. The token proves operator INTENT; this proves where the
//    writes would actually land. A mismatch fails closed.
const connectedProject = db.projectId ?? PROJECT;
if (APPLY) {
  const expectedToken = `${connectedProject}/${db.databaseId ?? "(default)"}`;
  if (CONFIRM !== expectedToken) {
    console.error(`REFUSING: --confirm must equal "${expectedToken}" (got ${JSON.stringify(CONFIRM)}).`);
    process.exit(2);
  }
  if (connectedProject !== PROJECT) {
    console.error(`REFUSING: connected project ${connectedProject} != named target ${PROJECT}.`);
    process.exit(2);
  }
}

// ── SCAN (bounded) and RESOLVE through the governed Sales Order documents.
//    The runner holds Admin credentials, so it reads sales_orders directly; the DRY RUN a reviewer
//    executes from a workstation resolves the same ids through the governed callable instead. Both
//    feed the SAME pure planner.
const snap = await db.collection("fieldops_wos").limit(500).get();
const records = snap.docs.map((d) => ({
  workOrderId: d.id,
  woNumber: d.data().woNumber ?? null,
  complaint: d.data().complaint,
  salesOrderId: d.data().salesOrderId ?? null,
}));

const embeddedIds = new Set();
for (const r of records) {
  const m = LEGACY_COMPLAINT_PATTERN.exec(typeof r.complaint === "string" ? r.complaint : "");
  if (m) embeddedIds.add(m[1]);
}
const resolved = new Map();
for (const id of embeddedIds) {
  const s = await db.collection("sales_orders").doc(id).get();
  resolved.set(id, { exists: s.exists, salesOrderNumber: s.exists ? (s.data()?.salesOrderNumber ?? null) : null });
}

const plan = planWorkOrderComplaintCorrection(records, (id) => resolved.get(id) ?? { exists: false, salesOrderNumber: null });

console.log(`\n═══ WORK ORDER COMPLAINT CORRECTION — ${APPLY ? "APPLY" : "DRY RUN"}`);
console.log(`    project=${connectedProject}  database=${db.databaseId ?? "(default)"}`);
console.log(`    scanned=${plan.scanned}  eligible=${plan.changes.length}  skipped=${plan.skipped.length}`);
console.log(`    plan fingerprint: ${plan.fingerprint}\n`);
for (const c of plan.changes) {
  console.log(`  ${c.woNumber ?? "(no number)"}  [${c.workOrderId}]  -> ${c.salesOrderNumber}`);
  console.log(`     BEFORE  ${c.before}`);
  console.log(`     AFTER   ${c.after}`);
}
for (const s of plan.skipped) console.log(`  SKIP ${s.woNumber ?? s.workOrderId}: ${s.reason} — ${s.detail}`);

if (plan.changes.length > MAX_MIGRATED_WORK_ORDERS) {
  console.error(`\nREFUSING: ${plan.changes.length} changes exceeds the bound of ${MAX_MIGRATED_WORK_ORDERS}.`);
  process.exit(2);
}

if (!APPLY) {
  console.log(`\nDRY RUN — nothing written. To apply, pass the fingerprint above as --plan.`);
  process.exit(0);
}

// ── GATE 2: the plan being applied must be the plan that was reviewed.
if (EXPECTED_PLAN !== plan.fingerprint) {
  console.error(`\nREFUSING: --plan ${JSON.stringify(EXPECTED_PLAN)} != current plan ${plan.fingerprint}.`);
  console.error("The data changed since the dry run. Re-run the dry run and review it again.");
  process.exit(2);
}

// ── APPLY: per-item isolated transaction, re-reading the CURRENT value and refusing on drift.
//    Bounded failure reporting (record + continue) rather than an unbounded throw, so one drifted
//    record cannot abandon the rest half-done with no artifact.
const applied = [];
const conflicts = [];
const errors = [];
for (const c of plan.changes) {
  const ref = db.collection("fieldops_wos").doc(c.workOrderId);
  try {
    await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      if (!cur.exists) throw new Error("record vanished between plan and apply");
      const now = cur.data()?.complaint;
      if (now !== c.before) {
        // Not an error: somebody else legitimately changed it. Refuse THIS record, keep the rest.
        conflicts.push({ workOrderId: c.workOrderId, woNumber: c.woNumber, expected: c.before, found: now });
        return;
      }
      // ONE FIELD. Nothing else on the document is named, so nothing else can move.
      tx.update(ref, { complaint: c.after });
      applied.push({ workOrderId: c.workOrderId, woNumber: c.woNumber, before: c.before, after: c.after });
    });
  } catch (err) {
    errors.push({ workOrderId: c.workOrderId, error: String(err?.message ?? err) });
  }
}

// ── AUDIT. One event describing the run, written after the fact, carrying the rollback artifact.
//    Emitted even when verification fails below: the artifact needed to undo committed writes must
//    never be discarded by a late failure.
const auditId = `workOrderComplaintReferenceMigration_${plan.fingerprint}`;
await db.collection("auditEvents").doc(auditId).set({
  at: new Date().toISOString(),
  actorUid: "operator:migration",
  action: "migrateWorkOrderComplaintReferences",
  targetType: "fieldops_wos",
  targetId: `${applied.length} work orders`,
  outcome: "applied",
  summary: `replaced a stored Sales Order document id with its governed reference on ${applied.length} work order(s)`,
  planFingerprint: plan.fingerprint,
  rollback: applied.map((a) => ({ workOrderId: a.workOrderId, complaint: a.before })),
}, { merge: true });

// ── POSTCONDITION: re-read and confirm. Recorded, never thrown -- the writes already committed.
const verifyFailures = [];
for (const a of applied) {
  const cur = await db.collection("fieldops_wos").doc(a.workOrderId).get();
  if (cur.data()?.complaint !== a.after) verifyFailures.push({ workOrderId: a.workOrderId, found: cur.data()?.complaint });
}

console.log(`\nAPPLIED  changed=${applied.length}  conflicts=${conflicts.length}  errors=${errors.length}  verifyFailures=${verifyFailures.length}`);
console.log(`audit event: auditEvents/${auditId}  (carries the rollback artifact)`);
for (const c of conflicts) console.log(`  CONFLICT ${c.woNumber}: current value differs from the reviewed plan — not written`);
for (const e of errors) console.log(`  ERROR ${e.workOrderId}: ${e.error}`);
for (const v of verifyFailures) console.log(`  VERIFY FAILED ${v.workOrderId}: reads back ${JSON.stringify(v.found)}`);
process.exit(errors.length || verifyFailures.length ? 1 : 0);
