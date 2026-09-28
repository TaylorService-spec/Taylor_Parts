// REORDER CUTOVER -- the offline proofs. No database, no Firebase runtime, no network.
//
//   * the EOS_REORDER_SNAPSHOT parse refuses every untrustworthy file: wrong format/version, unknown key or collection,
//     a missing collection, a count mismatch, a duplicate id, a malformed document, a production or Certification
//     source;
//   * the mappers hand the EXISTING copy modules exactly their source shapes, unrepaired: objects, the stated
//     assignments, and the purchasing source with the back-links exactly as stated;
//   * the census reports counts, governed statuses (ungoverned ones bucketed, never echoed) and encoded Timestamps;
//   * neither reorderSnapshot.ts nor scripts/reorderCutover.js loads Firebase or names a Firestore write, and the CLI
//     requires only the fence helpers at module scope.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const snap = require("../lib/eosOps/migration/reorderSnapshot.js");
const objectPlan = require("../lib/eosOps/migration/reorderObjectMigration.js");
const assignmentPlan = require("../lib/eosOps/migration/reorderAssignmentMigration.js");
const poPlan = require("../lib/eosOps/migration/reorderPurchaseOrderMigration.js");

const reorder = (id, over = {}) => ({ id, data: { status: "PENDING_REVIEW", createdAt: 1700000000000, assignedToUserId: null, assignedBy: null, ...over } });
const snapshotOf = ({ requests = [], orders = [], voids = [] } = {}, over = {}) => ({
  format: "EOS_REORDER_SNAPSHOT",
  version: 1,
  source: { firebaseProjectId: "eos-platform-sandbox", exportedAt: "2026-09-28T12:00:00.000Z" },
  counts: { reorder_requests: requests.length, reorder_purchase_orders: orders.length, reorder_purchase_order_voids: voids.length },
  collections: { reorder_requests: requests, reorder_purchase_orders: orders, reorder_purchase_order_voids: voids },
  ...over,
});
const refused = (code) => (e) => { assert.equal(e.name, "ReorderSnapshotError"); assert.equal(e.code, code, e.message); return true; };

// ════════════════════ parse ════════════════════

test("a well-formed snapshot parses, frozen, with its header and three collections", () => {
  const s = snap.parseReorderSnapshot(snapshotOf({ requests: [reorder("rr-1")], orders: [{ id: "rr-1", data: {} }] }));
  assert.deepEqual(s.source, { firebaseProjectId: "eos-platform-sandbox", exportedAt: "2026-09-28T12:00:00.000Z" });
  assert.deepEqual({ ...s.counts }, { reorder_requests: 1, reorder_purchase_orders: 1, reorder_purchase_order_voids: 0 });
  assert.deepEqual([...snap.REORDER_SNAPSHOT_COLLECTIONS], ["reorder_requests", "reorder_purchase_orders", "reorder_purchase_order_voids"]);
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.collections.reorder_requests));
});

test("wrong format, wrong version, not an object, or an unknown top-level key is refused", () => {
  assert.throws(() => snap.parseReorderSnapshot(snapshotOf({}, { format: "EOS_CATALOG_SNAPSHOT" })), refused("SNAPSHOT_FORMAT_INVALID"));
  assert.throws(() => snap.parseReorderSnapshot(snapshotOf({}, { version: 2 })), refused("SNAPSHOT_FORMAT_INVALID"));
  assert.throws(() => snap.parseReorderSnapshot([]), refused("SNAPSHOT_FORMAT_INVALID"));
  assert.throws(() => snap.parseReorderSnapshot(snapshotOf({}, { extra: 1 })), refused("SNAPSHOT_FORMAT_INVALID"));
});

test("a missing or non-ISO source header is refused", () => {
  assert.throws(() => snap.parseReorderSnapshot(snapshotOf({}, { source: { firebaseProjectId: "", exportedAt: "2026-09-28T00:00:00Z" } })), refused("SNAPSHOT_FORMAT_INVALID"));
  assert.throws(() => snap.parseReorderSnapshot(snapshotOf({}, { source: { firebaseProjectId: "eos-platform-sandbox", exportedAt: "yesterday" } })), refused("SNAPSHOT_FORMAT_INVALID"));
});

test("a production or Certification source project is refused", () => {
  assert.throws(() => snap.parseReorderSnapshot(snapshotOf({}, { source: { firebaseProjectId: "taylor-parts", exportedAt: "2026-09-28T00:00:00Z" } })), refused("SNAPSHOT_PRODUCTION_SOURCE"));
  assert.throws(() => snap.parseReorderSnapshot(snapshotOf({}, { source: { firebaseProjectId: "eos-platform-certification", exportedAt: "2026-09-28T00:00:00Z" } })), refused("SNAPSHOT_CERTIFICATION_SOURCE"));
});

test("an unknown collection -- in counts or in collections -- is refused, and a missing one is too", () => {
  const base = snapshotOf();
  assert.throws(() => snap.parseReorderSnapshot({ ...base, collections: { ...base.collections, parts: [] } }), refused("SNAPSHOT_UNKNOWN_COLLECTION"));
  assert.throws(() => snap.parseReorderSnapshot({ ...base, counts: { ...base.counts, receiving_orders: 0 } }), refused("SNAPSHOT_UNKNOWN_COLLECTION"));
  const { reorder_purchase_order_voids: _v, ...twoCollections } = base.collections;
  assert.throws(() => snap.parseReorderSnapshot({ ...base, collections: twoCollections }), refused("SNAPSHOT_FORMAT_INVALID"));
  const { reorder_requests: _c, ...twoCounts } = base.counts;
  assert.throws(() => snap.parseReorderSnapshot({ ...base, counts: twoCounts }), refused("SNAPSHOT_FORMAT_INVALID"));
});

test("a count that disagrees with its list is refused", () => {
  const s = snapshotOf({ requests: [reorder("rr-1"), reorder("rr-2")] });
  assert.throws(() => snap.parseReorderSnapshot({ ...s, counts: { ...s.counts, reorder_requests: 3 } }), refused("SNAPSHOT_COUNT_MISMATCH"));
  assert.throws(() => snap.parseReorderSnapshot({ ...s, counts: { ...s.counts, reorder_requests: -1 } }), refused("SNAPSHOT_FORMAT_INVALID"));
});

test("a duplicate document id within a collection is refused; the same id across collections is the PO identity", () => {
  assert.throws(() => snap.parseReorderSnapshot(snapshotOf({ requests: [reorder("rr-1"), reorder("rr-1")] })), refused("SNAPSHOT_DUPLICATE_ID"));
  const ok = snap.parseReorderSnapshot(snapshotOf({ requests: [reorder("rr-1")], orders: [{ id: "rr-1", data: {} }], voids: [{ id: "rr-1", data: {} }] }));
  assert.equal(ok.collections.reorder_purchase_order_voids[0].id, "rr-1");
});

test("a document that is not exactly { id, data } is refused", () => {
  for (const bad of [{ id: "rr-1" }, { id: "", data: {} }, { id: 7, data: {} }, { id: "rr-1", data: [] }, { id: "rr-1", data: {}, path: "x" }]) {
    assert.throws(() => snap.parseReorderSnapshot(snapshotOf({ requests: [bad] })), refused("SNAPSHOT_FORMAT_INVALID"), JSON.stringify(bad));
  }
});

// ════════════════════ mappers ════════════════════

test("objects: every Reorder document, unchanged", () => {
  const s = snap.parseReorderSnapshot(snapshotOf({ requests: [reorder("rr-1"), reorder("rr-2", { status: "NOT-A-STATUS" })] }));
  assert.deepEqual(snap.toReorderObjectSource(s).map((d) => [d.id, d.data.status]), [["rr-1", "PENDING_REVIEW"], ["rr-2", "NOT-A-STATUS"]]);
});

test("assignments: one per Reorder that STATES an assignee, raw values so the classifier refuses a blank one", () => {
  const s = snap.parseReorderSnapshot(snapshotOf({ requests: [
    reorder("rr-none"),
    reorder("rr-absent", { assignedToUserId: undefined }),
    reorder("rr-assigned", { assignedToUserId: "uid-alice", assignedBy: "uid-manager" }),
    reorder("rr-blank", { assignedToUserId: "" }),
    reorder("rr-no-assignor", { assignedToUserId: "uid-bob", assignedBy: undefined }),
  ] }));
  const rows = snap.toReorderAssignmentSource(s);
  assert.deepEqual(rows, [
    { reorderRequestId: "rr-assigned", assignedToUserId: "uid-alice", assignedBy: "uid-manager", assignedAt: null },
    { reorderRequestId: "rr-blank", assignedToUserId: "", assignedBy: null, assignedAt: null },
    { reorderRequestId: "rr-no-assignor", assignedToUserId: "uid-bob", assignedBy: null, assignedAt: null },
  ]);
  // The EXISTING classifier decides: a blank assignee is its REMEDIATION_REQUIRED, not a mapper repair.
  const plan = assignmentPlan.planReorderAssignmentMigration(rows, { tenantId: "t1", byUid: new Map(), employees: new Set(), currentAssignments: new Map() });
  assert.equal(plan.rows.find((r) => r.reorderRequestId === "rr-blank").disposition, "REMEDIATION_REQUIRED");
});

test("purchasing: orders and voids as documents, and every Reorder's back-link exactly as stated (absent stays absent)", () => {
  const s = snap.parseReorderSnapshot(snapshotOf({
    requests: [reorder("rr-1", { purchaseOrderId: "rr-1" }), reorder("rr-2", { purchaseOrderId: null }), reorder("rr-3")],
    orders: [{ id: "rr-1", data: { reorderRequestId: "rr-1" } }],
    voids: [{ id: "rr-1", data: { reorderRequestId: "rr-1" } }],
  }));
  const p = snap.toPurchasingSource(s);
  assert.deepEqual(p.purchaseOrders.map((d) => d.id), ["rr-1"]);
  assert.deepEqual(p.voids.map((d) => d.id), ["rr-1"]);
  assert.deepEqual([...p.requestBackLinks.entries()], [["rr-1", "rr-1"], ["rr-2", null], ["rr-3", undefined]]);
  assert.equal(p.requestBackLinks.has("rr-3"), true, "a Reorder without a back-link is still a SOURCE Reorder");
});

test("instants: epoch milliseconds are what the object classifier accepts; an encoded Timestamp is refused, never converted", () => {
  const good = { partId: "PART-1", recommendationStatus: "BELOW_MIN", quantitySource: "MANUAL", requestedQty: 1, status: "PENDING_REVIEW",
    requestedBy: "uid-a", createdAt: 1700000000000, warehouseId: "wh-1", operatingCompanyId: "taylor" };
  const view = { tenantId: "t1", byUid: new Map(), warehouseCompany: new Map([["wh-1", "k"]]), companyKeyByCompanyId: new Map([["taylor", "k"]]), existingReorderIds: new Set() };
  const s = snap.parseReorderSnapshot(snapshotOf({ requests: [
    { id: "rr-ms", data: good },
    { id: "rr-ts", data: { ...good, createdAt: { $timestamp: { seconds: 1700000000, nanoseconds: 0 } } } },
  ] }));
  const plan = objectPlan.planReorderObjectMigration(snap.toReorderObjectSource(s), view);
  assert.equal(plan.rows.find((r) => r.reorderRequestId === "rr-ms").disposition, "MIGRATABLE");
  assert.equal(plan.rows.find((r) => r.reorderRequestId === "rr-ts").refusalCode, "INVALID_INSTANT");
  assert.deepEqual({ ...snap.censusReorderSnapshot(s).encodedTimestampFields }, { "reorder_requests.createdAt": 1 });
});

test("the purchasing mapper output is accepted by the existing purchase-order classifier as-is", () => {
  const s = snap.parseReorderSnapshot(snapshotOf({ requests: [reorder("rr-1", { purchaseOrderId: "rr-other" })], orders: [{ id: "rr-1", data: { reorderRequestId: "rr-1" } }] }));
  const src = snap.toPurchasingSource(s);
  const plan = poPlan.planReorderPurchaseOrderMigration({ purchaseOrders: src.purchaseOrders, voids: src.voids, sourceRequestBackLinks: src.requestBackLinks,
    view: { tenantId: "t1", byUid: new Map(), companyKeyByCompanyId: new Map(), targetReorderStatusById: new Map(), targetPurchaseOrders: new Map(), targetVoidIds: new Set() } });
  assert.equal(plan.purchaseOrders[0].refusalCode, "PO_IDENTITY_MISMATCH", "the back-link is checked as the third statement of the identity");
});

// ════════════════════ census ════════════════════

test("census: counts, governed status distribution with ungoverned values bucketed, stated assignments", () => {
  const s = snap.parseReorderSnapshot(snapshotOf({ requests: [
    reorder("rr-1"), reorder("rr-2", { status: "ORDERED", assignedToUserId: "uid-a" }), reorder("rr-3", { status: "Customer Name Inc" }), reorder("rr-4", { status: null }),
  ] }));
  const c = snap.censusReorderSnapshot(s);
  assert.deepEqual({ ...c.statusDistribution }, { "(ABSENT)": 1, "(UNGOVERNED)": 1, ORDERED: 1, PENDING_REVIEW: 1 });
  assert.equal(c.statedAssignments, 1);
  assert.doesNotMatch(JSON.stringify(c), /Customer Name/);
});

// ════════════════════ no Firebase on the PostgreSQL side ════════════════════

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const FORBIDDEN = [
  /from\s+["']firebase/, /require\(\s*["']firebase/, /import\(\s*["']firebase/, /\bgetFirestore\s*\(/, /\bFieldValue\b/, /@google-cloud\/firestore/,
];

test("reorderSnapshot.ts imports no Firebase module and has only type imports", () => {
  const text = readFileSync("src/eosOps/migration/reorderSnapshot.ts", "utf8");
  for (const p of FORBIDDEN) assert.doesNotMatch(text, p);
  const imports = [...stripComments(text).matchAll(/^import\s.*$/gm)].map((m) => m[0]);
  assert.ok(imports.length > 0 && imports.every((l) => l.startsWith("import type ")), `value imports: ${imports.join(" | ")}`);
});

test("the Reorder cutover tool loads no Firebase module and has no Firestore write path", () => {
  const code = stripComments(readFileSync("scripts/reorderCutover.js", "utf8"));
  for (const p of FORBIDDEN) assert.doesNotMatch(code, p);
  assert.doesNotMatch(code, /\.(set|add|update|delete|create|commit|batch|runTransaction|bulkWriter)\s*\(/);
  assert.doesNotMatch(code, /\b(DELETE|TRUNCATE|DROP)\b/, "the cutover never deletes a PostgreSQL row");
  // It requires only the fence helpers at module scope; lib/ and pg after the fence.
  const topLevelRequires = code.split("async function main")[0].match(/require\(\s*["'][^"']+["']\s*\)/g);
  assert.deepEqual(topLevelRequires, ['require("./measureEmployeeReferenceIntegrity.js")', 'require("./measureWorkforceActivation.js")', 'require("./catalogCutover.js")']);
});

test("loading the snapshot module, the three copy modules and the CLI never resolves a Firebase package (runtime probe)", () => {
  const dir = mkdtempSync(join(tmpdir(), "reorder-cutover-probe-"));
  const preload = join(dir, "banFirebase.cjs");
  writeFileSync(preload, 'const M=require("module");const l=M._load;M._load=function(r,...a){if(/firebase|@google-cloud\\/firestore/i.test(r)){process.stderr.write("FIREBASE_LOADED:"+r);process.exit(97);}return l.call(this,r,...a);};');
  const modules = [
    "lib/eosOps/migration/reorderSnapshot.js",
    "lib/eosOps/migration/reorderObjectMigrationCopy.js",
    "lib/eosOps/migration/reorderAssignmentMigrationCopy.js",
    "lib/eosOps/migration/reorderPurchaseOrderMigrationCopy.js",
    "lib/adminPolicy/policyDatabase.js",
    "scripts/reorderCutover.js",
  ].map((m) => resolve(m));
  const probe = spawnSync(process.execPath, ["--require", preload, "-e", modules.map((m) => `require(${JSON.stringify(m)});`).join("")], { encoding: "utf8" });
  assert.equal(probe.status, 0, `a Reorder cutover module transitively loaded Firebase: ${probe.stderr}`);
});

test("assignment instants: a valid legacy assignedAt becomes effective_from; absent or malformed says so and never blocks", () => {
  const view = { tenantId: "t1", byUid: new Map([["uid-a", { principalId: "p-a", tenantId: "t1", activeEmployeeIds: ["e-a"] }]]),
    employees: new Set(["e-a"]), currentAssignments: new Map() };
  const plan = assignmentPlan.planReorderAssignmentMigration([
    { reorderRequestId: "rr-1", assignedToUserId: "uid-a", assignedBy: null, assignedAt: 1758000200000 },
    { reorderRequestId: "rr-2", assignedToUserId: "uid-a", assignedBy: null, assignedAt: null },
    { reorderRequestId: "rr-3", assignedToUserId: "uid-a", assignedBy: null, assignedAt: "yesterday" },
  ], view);
  const by = Object.fromEntries(plan.rows.map((r) => [r.reorderRequestId, r]));
  assert.equal(by["rr-1"].effectiveFrom, new Date(1758000200000).toISOString());
  assert.equal(by["rr-1"].assignedAtDisposition, "LEGACY_INSTANT");
  assert.deepEqual([by["rr-2"].effectiveFrom, by["rr-2"].assignedAtDisposition], [null, "ABSENT"]);
  assert.deepEqual([by["rr-3"].effectiveFrom, by["rr-3"].assignedAtDisposition], [null, "MALFORMED"]);
  // The instant is a fact about WHEN, not WHO: it never changes the assignee disposition or blocks the row.
  for (const r of plan.rows) assert.equal(r.disposition, by["rr-1"].disposition);
  assert.equal(by["rr-1"].disposition, "EXACT_EMPLOYEE_ASSIGNMENT");
  assert.equal(plan.copyable.length, 3, "a missing or malformed instant never blocks the assignment");
});
