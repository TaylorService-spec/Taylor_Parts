// The source-quiescence proof: two snapshots compare by CONTENT, the export timestamp is ignored, a checksum mismatch is
// refused, and a difference is reported by id without printing record values. Offline; no Firestore.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const fp = require("../scripts/snapshotContentFingerprint.js");

const SCRIPT = resolve(import.meta.dirname, "../scripts/snapshotContentFingerprint.js");
const dir = mkdtempSync(join(tmpdir(), "fp-"));

function writeSnapshot(name, snapshot) {
  const file = join(dir, name);
  const text = JSON.stringify(snapshot, null, 2) + "\n";
  writeFileSync(file, text);
  writeFileSync(`${file}.sha256`, `${createHash("sha256").update(text).digest("hex")}  ${name}\n`);
  return file;
}

const reorder = (exportedAt, requests) => ({
  format: "EOS_REORDER_SNAPSHOT", version: 1,
  source: { firebaseProjectId: "eos-platform-sandbox", exportedAt },
  counts: { reorder_requests: requests.length, reorder_purchase_orders: 0, reorder_purchase_order_voids: 0 },
  collections: { reorder_requests: requests, reorder_purchase_orders: [], reorder_purchase_order_voids: [] },
});
const catalog = (exportedAt, parts) => ({
  format: "EOS_CATALOG_SNAPSHOT", version: 1,
  source: { firebaseProjectId: "eos-platform-sandbox", exportedAt },
  parts, equipmentModels: [], partAliases: [],
});
const run = (a, b) => spawnSync(process.execPath, [SCRIPT, "--baseline", a, "--current", b], { encoding: "utf8" });

test("identical content exported at different times is IDENTICAL (exit 0)", () => {
  const recs = [{ id: "r1", data: { status: "ORDERED" } }];
  const r = run(writeSnapshot("a.json", reorder("2026-09-28T01:00:00Z", recs)), writeSnapshot("b.json", reorder("2026-09-28T02:00:00Z", recs)));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).verdict, "IDENTICAL");
});

test("a changed, added and removed record is DIFFERENT (exit 3) and listed by id only", () => {
  const a = writeSnapshot("c.json", catalog("t0", [{ id: "p1", data: { name: "A" } }, { id: "p2", data: { name: "B" } }]));
  const b = writeSnapshot("d.json", catalog("t1", [{ id: "p1", data: { name: "SECRET-CHANGED" } }, { id: "p3", data: { name: "C" } }]));
  const r = run(a, b);
  assert.equal(r.status, 3);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.diff.parts, { added: ["p3"], removed: ["p2"], changed: ["p1"] });
  assert.ok(!r.stdout.includes("SECRET-CHANGED"), "record values must never be printed");
});

test("a snapshot that disagrees with its checksum sidecar is refused (exit 2)", () => {
  const a = writeSnapshot("e.json", reorder("t0", []));
  const b = writeSnapshot("f.json", reorder("t1", []));
  writeFileSync(b, readFileSync(b, "utf8").replace('"version": 1', '"version": 2'));
  const r = run(a, b);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /does not match its \.sha256/);
});

test("a missing sidecar and mixed formats are refused", () => {
  const a = writeSnapshot("g.json", reorder("t0", []));
  const lone = join(dir, "lone.json");
  writeFileSync(lone, JSON.stringify(reorder("t0", [])));
  assert.equal(run(a, lone).status, 2);
  assert.throws(() => fp.compare(reorder("t", []), catalog("t", [])), /different formats/);
});

test("the tool is offline: it never loads firebase-admin or addresses a Firestore collection", () => {
  const src = readFileSync(SCRIPT, "utf8");
  assert.ok(!/require\(["']firebase-admin/.test(src));
  assert.ok(!/\.(collection|doc|batch|runTransaction)\(/.test(src));
});
