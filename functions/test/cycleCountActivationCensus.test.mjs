// Cycle Count activation gate 1: the zero-population census (2026-09-20 ruling; DQ-018). Pure + CLI over a temp file.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const { censusCycleCountDocuments } = await import("../lib/cycleCount/cycleCountActivationCensus.js");

test("v1 records are legacy evidence; the gate is open only with ZERO v2 sheets and nothing unclassifiable", () => {
  const v1 = (id) => ({ id, data: { schemaVersion: 1, partId: "P", status: "RECONCILED" } });
  assert.equal(censusCycleCountDocuments([v1("a"), v1("b")]).verdict, "ZERO_POPULATION");
  assert.equal(censusCycleCountDocuments([]).verdict, "ZERO_POPULATION");
  const withV2 = censusCycleCountDocuments([v1("a"), { id: "s2", data: { schemaVersion: 2, status: "OPEN" } }, { id: "s3", data: { schemaVersion: 2, status: "CLOSED" } }]);
  assert.equal(withV2.verdict, "V2_SHEETS_PRESENT");
  assert.deepEqual(withV2.v2SheetIds, ["s2", "s3"]);
  assert.deepEqual(withV2.v2ByStatus, { OPEN: 1, CLOSED: 1 });
  assert.equal(withV2.legacyV1, 1);
  const odd = censusCycleCountDocuments([v1("a"), { id: "x", data: { schemaVersion: 7 } }, { id: "y", data: null }]);
  assert.equal(odd.verdict, "UNCLASSIFIABLE_PRESENT");
  assert.deepEqual(odd.unclassifiableIds, ["x", "y"]);
});

test("CLI exits 0 on zero population, 3 on STOP, 2 on refused input", () => {
  const dir = mkdtempSync(join(tmpdir(), "l3-cc-census-"));
  const run = (f) => spawnSync(process.execPath, ["scripts/cycleCountActivationCensus.js", "--snapshot", f], { encoding: "utf8" });
  const zero = join(dir, "zero.json");
  writeFileSync(zero, JSON.stringify({ collections: { cycle_counts: [{ id: "a", data: { schemaVersion: 1 } }] } }));
  assert.equal(run(zero).status, 0);
  const stop = join(dir, "stop.json");
  writeFileSync(stop, JSON.stringify({ rows: [{ id: "s", data: { schemaVersion: 2, status: "OPEN" } }] }));
  const r = run(stop);
  assert.equal(r.status, 3); assert.equal(JSON.parse(r.stdout).verdict, "V2_SHEETS_PRESENT");
  const dup = join(dir, "dup.json");
  writeFileSync(dup, JSON.stringify({ rows: [{ id: "s", data: {} }, { id: "s", data: {} }] }));
  assert.equal(run(dup).status, 2);
});
