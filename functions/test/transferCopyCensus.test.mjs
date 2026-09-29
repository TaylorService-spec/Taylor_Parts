// Transfer COPY-lane census (DQ-018): the existing governed mapper over an offline snapshot. CLI over temp files.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const doc = (over = {}) => ({
  sourceOperatingCompanyId: "oc-alpha", destinationOperatingCompanyId: "oc-beta", partId: "PRT-000123",
  trackingMode: "NONE", quantity: 2, origin: { type: "WAREHOUSE", locationId: "wh-1" },
  destination: { type: "WAREHOUSE", locationId: "wh-2" }, status: "IN_TRANSIT", idempotencyKey: "k", createdBy: "u", ...over,
});
const run = (f) => spawnSync(process.execPath, ["scripts/transferCopyCensus.js", "--snapshot", f], { encoding: "utf8" });

test("every record maps -> COPY_READY, with the IN_TRANSIT ids that need ledger agreement", () => {
  const dir = mkdtempSync(join(tmpdir(), "l3-trf-census-"));
  const f = join(dir, "ok.json");
  writeFileSync(f, JSON.stringify({ rows: [{ id: "t1", data: doc() }, { id: "t2", data: doc({ status: "COMPLETED", idempotencyKey: "k2" }) }] }));
  const r = run(f);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.verdict, "COPY_READY");
  assert.deepEqual(out.inTransitNeedingLedgerAgreement, ["t1"]);
  assert.equal(out.reconciliation.mapped, 2);
});

test("a refused record -> REFUSALS_PRESENT, listed by id and code only (no values echoed)", () => {
  const dir = mkdtempSync(join(tmpdir(), "l3-trf-census-"));
  const f = join(dir, "bad.json");
  writeFileSync(f, JSON.stringify({ collections: { transfer_orders: [
    { id: "t1", data: doc() },
    { id: "t-half", data: doc({ destinationOperatingCompanyId: undefined, idempotencyKey: "SECRET-VALUE" }) },
  ] } }));
  const r = run(f);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.refusals, [{ id: "t-half", code: "MISSING_PARTICIPATING_COMPANY" }]);
  assert.ok(!r.stdout.includes("SECRET-VALUE"));
  const dup = join(dir, "dup.json");
  writeFileSync(dup, JSON.stringify({ rows: [{ id: "a", data: {} }, { id: "a", data: {} }] }));
  assert.equal(run(dup).status, 2);
});
