// DQ-032 (Controller, 2026-09-28): the eight synthetic Reorder fixtures are EXCLUDED from the COPY by an explicit,
// checksummed manifest -- never deleted from Firestore. This proves the manifest is exactly the declared eight, that
// only fact-matching fixtures are excluded, that nothing else is removed, and that the exclusion refuses rather than
// guess when a declared id is occupied by something else or a copied record would point at an excluded one.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const x = require("../lib/eosOps/migration/reorderMigrationExclusion.js");
const { REORDER_SCENARIO_FIXTURES, SCENARIO_ID } = require("../lib/sandboxFixtures/reorderScenarioFixtures.js");

const sha = (t) => createHash("sha256").update(t).digest("hex");
const MANIFEST_FILE = resolve(import.meta.dirname, "../../docs/architecture/reorder-migration-exclusion-manifest.json");

const fixtureDocs = () => {
  const out = { reorder_requests: [], reorder_purchase_orders: [], reorder_purchase_order_voids: [] };
  for (const f of REORDER_SCENARIO_FIXTURES) out[f.collection].push({ id: f.id, data: { ...f.facts, scenarioId: SCENARIO_ID } });
  return out;
};
const snapshotOf = (collections) => ({
  source: { firebaseProjectId: "eos-platform-sandbox", exportedAt: "t" },
  counts: Object.fromEntries(Object.entries(collections).map(([k, v]) => [k, v.length])),
  collections,
});
const REAL = {
  reorder_requests: [{ id: "rr-real-1", data: { status: "ORDERED", purchaseOrderId: "rr-real-1" } }],
  reorder_purchase_orders: [{ id: "rr-real-1", data: { reorderRequestId: "rr-real-1" } }],
  reorder_purchase_order_voids: [],
};
const merged = (extra = {}) => {
  const f = fixtureDocs();
  const c = {};
  for (const k of Object.keys(REAL)) c[k] = [...REAL[k], ...f[k], ...(extra[k] ?? [])];
  return c;
};

test("the committed manifest is exactly the declared eight, and matches its sha256 sidecar", () => {
  const text = readFileSync(MANIFEST_FILE, "utf8");
  assert.equal(text, x.renderReorderExclusionManifest());
  assert.equal(readFileSync(`${MANIFEST_FILE}.sha256`, "utf8").split(/\s+/)[0], sha(text));
  const m = x.assertDeclaredExclusionManifest(text);
  assert.equal(m.count, 8);
  assert.deepEqual(
    m.entries.map((e) => `${e.collection}/${e.id}`).sort(),
    REORDER_SCENARIO_FIXTURES.map((f) => `${f.collection}/${f.id}`).sort(),
  );
});

test("an operator manifest that differs by a single byte is refused (it cannot widen or narrow)", () => {
  const text = x.renderReorderExclusionManifest();
  assert.throws(() => x.assertDeclaredExclusionManifest(text.replace("ro-sbx-002", "rr-real-1")), /not the repository's declared/);
  assert.throws(() => x.assertDeclaredExclusionManifest(text.trimEnd()), /not the repository's declared/);
});

test("exactly the eight are excluded; every real record is retained; source = retained + excluded", () => {
  const { snapshot, proof } = x.applyReorderExclusion(snapshotOf(merged()), x.buildReorderExclusionManifest(), sha);
  assert.equal(proof.excluded.length, 8);
  assert.equal(proof.onlyDeclaredFixturesExcluded, true);
  assert.deepEqual(proof.absent, []);
  for (const [name, c] of Object.entries(proof.counts)) {
    assert.equal(c.source, c.retained + c.excluded, name);
    assert.deepEqual(snapshot.collections[name].map((d) => d.id), REAL[name].map((d) => d.id), name);
    assert.equal(snapshot.counts[name], REAL[name].length);
  }
});

test("a declared fixture the source does not hold is reported absent, never an error", () => {
  const c = merged();
  c.reorder_requests = c.reorder_requests.filter((d) => d.id !== "ro-sbx-004");
  const { proof } = x.applyReorderExclusion(snapshotOf(c), x.buildReorderExclusionManifest(), sha);
  assert.deepEqual(proof.absent, [{ collection: "reorder_requests", id: "ro-sbx-004" }]);
  assert.equal(proof.excluded.length, 7);
});

test("a declared id occupied by diverged content REFUSES the whole run (it may be real data)", () => {
  const c = merged();
  c.reorder_requests = c.reorder_requests.map((d) => (d.id === "ro-sbx-002" ? { id: d.id, data: { ...d.data, urgency: "LOW" } } : d));
  assert.throws(() => x.applyReorderExclusion(snapshotOf(c), x.buildReorderExclusionManifest(), sha), /ro-sbx-002 occupies a declared fixture id but is CONTENT_DIVERGED/);
});

test("a copied record that points at an excluded one REFUSES (no dangling reference)", () => {
  const c = merged({ reorder_purchase_order_voids: [{ id: "v-real", data: { reorderRequestId: "rr-real-1", purchaseOrderId: "ro-sbx-001" } }] });
  assert.throws(() => x.applyReorderExclusion(snapshotOf(c), x.buildReorderExclusionManifest(), sha), /names the excluded reorder_purchase_orders\/ro-sbx-001/);
});

test("the module is pure: no Firestore, no database, no file system", () => {
  const src = readFileSync(resolve(import.meta.dirname, "../src/eosOps/migration/reorderMigrationExclusion.ts"), "utf8");
  assert.doesNotMatch(src, /firebase|from "pg"|node:fs/);
});

// ============ Controller ruling 2026-09-30: CERTIFICATION_LIVE_PROOF and LEGACY_INCOMPLETE_OPERATING_CONTEXT ============
const LIVE_PROOF_REQUESTS = ["8qKjYorWjvNyYRH53Uzy", "KuYv3Ld0pFSGBz3bHvpc", "P1Ia7fpUTKPq3RloYEvF", "Sz8QPa815EgkmvmObQ1K",
  "YqD07rXiAE3jLoHf4q6x", "ggJNjr0LsxEEn7Hwc2zX", "kLbfmkzNcUGYITlWzFGG", "veqnZP7HHnaa09PgXTqe", "ywq7UpdczU1KZ6Z86ejS"];
const HOLD = "eA7o3t8DyUXmtg8MCKjT";
const liveReq = (id, over = {}) => ({ id, data: { partId: "CW-P-0000", warehouseId: "wh-main", operatingCompanyId: "taylor", status: "READY_FOR_PARTS_MANAGER", ...over } });
const fullSource = (over = {}) => {
  const c = merged();
  c.reorder_requests = [...c.reorder_requests, ...LIVE_PROOF_REQUESTS.map((id) => liveReq(id, id === "Sz8QPa815EgkmvmObQ1K" ? { status: "ORDERED", purchaseOrderId: id } : {})),
    { id: HOLD, data: { partId: "PRT-2001", status: "PENDING_REVIEW" } }, ...(over.requests ?? [])];
  c.reorder_purchase_orders = [...c.reorder_purchase_orders, { id: "Sz8QPa815EgkmvmObQ1K", data: { partId: "CW-P-0000", reorderRequestId: "Sz8QPa815EgkmvmObQ1K" } }];
  return c;
};

test("the manifest declares each class separately, with exact ids and reasons -- never inside the fixture bucket", () => {
  const m = x.buildReorderExclusionManifest();
  assert.equal(m.count, 8, "the SBX-SCN-001 fixture bucket is unchanged");
  assert.equal(m.certificationLiveProof.classification, "CERTIFICATION_LIVE_PROOF");
  assert.equal(m.certificationLiveProof.disposition, "EXCLUDED");
  assert.match(m.certificationLiveProof.reason, /Decision #155.*CW-P-0000/s);
  assert.deepEqual(m.certificationLiveProof.entries.filter((e) => e.collection === "reorder_requests").map((e) => e.id).sort(), [...LIVE_PROOF_REQUESTS].sort());
  assert.deepEqual(m.certificationLiveProof.entries.filter((e) => e.collection === "reorder_purchase_orders").map((e) => e.id), ["Sz8QPa815EgkmvmObQ1K"]);
  assert.equal(m.holds.classification, "LEGACY_INCOMPLETE_OPERATING_CONTEXT");
  assert.equal(m.holds.disposition, "HOLD");
  assert.deepEqual(m.holds.entries.map((e) => e.id), [HOLD]);
  const ids = (list) => list.map((e) => `${e.collection}/${e.id}`);
  const all = [...ids(m.entries), ...ids(m.certificationLiveProof.entries), ...ids(m.holds.entries)];
  assert.equal(new Set(all).size, all.length, "the three classes are mutually exclusive");
});

test("the full 15-request source: 8 fixtures + 10 live-proof removed, 1 held, 0 operational retained, each once", () => {
  const { snapshot, proof } = x.applyReorderExclusion(snapshotOf(fullSource()), x.buildReorderExclusionManifest(), sha);
  assert.equal(proof.excluded.length, 8);
  assert.equal(proof.certificationLiveProof.excluded.length, 10);
  assert.deepEqual(proof.held.held.map((e) => e.id), [HOLD]);
  assert.equal(proof.onlyDeclaredFixturesExcluded, true);
  // REAL records (not declared anywhere) are retained: nothing operational is excluded by accident.
  assert.deepEqual(snapshot.collections.reorder_requests.map((d) => d.id), ["rr-real-1"]);
  assert.deepEqual(snapshot.collections.reorder_purchase_orders.map((d) => d.id), ["rr-real-1"]);
  for (const [name, c] of Object.entries(proof.counts)) assert.equal(c.source, c.retained + c.excluded + c.held, name);
});

test("a declared live-proof id that no longer names CW-P-0000 REFUSES (it may have become real business data)", () => {
  const c = fullSource();
  c.reorder_requests = c.reorder_requests.map((d) => (d.id === "P1Ia7fpUTKPq3RloYEvF" ? liveReq(d.id, { partId: "PRT-1001" }) : d));
  assert.throws(() => x.applyReorderExclusion(snapshotOf(c), x.buildReorderExclusionManifest(), sha), /CERTIFICATION_LIVE_PROOF but no longer matches/);
});

test("the held record REFUSES if it gains an operating context (a new ruling is needed, never a silent hold or inference)", () => {
  const c = fullSource();
  c.reorder_requests = c.reorder_requests.map((d) => (d.id === HOLD ? { id: HOLD, data: { ...d.data, warehouseId: "wh-main" } } : d));
  assert.throws(() => x.applyReorderExclusion(snapshotOf(c), x.buildReorderExclusionManifest(), sha), /HELD as LEGACY_INCOMPLETE_OPERATING_CONTEXT but now states/);
});

test("exclusion never mutates the source snapshot", () => {
  const src = snapshotOf(fullSource());
  const before = JSON.stringify(src);
  x.applyReorderExclusion(src, x.buildReorderExclusionManifest(), sha);
  assert.equal(JSON.stringify(src), before);
});
