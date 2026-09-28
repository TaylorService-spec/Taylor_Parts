// Governed record read -- the parts provable with no database (Pass 11 Fix Wave 1).
// The PostgreSQL-backed persona proofs are governedRecordReadPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  GOVERNED_READ_SURFACES,
  parseGovernedReadInput,
  readGovernedRecords,
  toWire,
  GovernedReadRefusal,
} = require("../lib/access/governedRecordRead.js");
const { Timestamp } = require("firebase-admin/firestore");

test("the surface registry is closed: one collection and one governed read capability each", () => {
  assert.deepEqual(Object.keys(GOVERNED_READ_SURFACES).sort(),
    ["accounts", "inventoryTransactions", "parts", "purchaseOrders", "reorderRequests", "transferOrders", "warehouses", "workOrders"]);
  for (const [k, s] of Object.entries(GOVERNED_READ_SURFACES)) {
    assert.match(s.capability, /\.read$/, `${k} is a read capability`);
    assert.equal(typeof s.collection, "string");
  }
});

test("input validation refuses anything that is not a bounded read of a registered surface", () => {
  const bad = [
    {}, { surface: "users", limit: 5 }, { surface: "roleAssignments", limit: 5 }, { surface: "accounts" },
    { surface: "accounts", limit: 0 }, { surface: "accounts", limit: 501 },
    { surface: "accounts", limit: 5, filters: [{ fieldId: "a/b", operator: "EQUALS", value: 1 }] },
    { surface: "accounts", limit: 5, filters: [{ fieldId: "status", operator: "REGEX", value: 1 }] },
    { surface: "accounts", limit: 5, sort: [{ fieldId: "name", direction: "SIDEWAYS" }] },
    { surface: "accounts", limit: 5, afterId: "x/y" },
  ];
  for (const b of bad) assert.throws(() => parseGovernedReadInput(b), (e) => e instanceof GovernedReadRefusal && e.code === "invalid-argument", JSON.stringify(b));
  const ok = parseGovernedReadInput({ surface: "workOrders", limit: 25, filters: [{ fieldId: "status", operator: "IN", value: ["scheduled"] }], sort: [{ fieldId: "createdAt", direction: "DESC" }] });
  assert.equal(ok.surface, "workOrders");
});

test("an inactive environment refuses before resolving anybody", async () => {
  let asked = 0;
  await assert.rejects(
    readGovernedRecords({ db: {}, governed: async () => { asked += 1; return { status: "RESOLVED" }; }, active: false }, "uid", { surface: "accounts", limit: 5 }),
    (e) => e instanceof GovernedReadRefusal && e.code === "failed-precondition");
  assert.equal(asked, 0);
});

test("Timestamps cross the callable boundary as a tagged ISO string", () => {
  const ts = Timestamp.fromDate(new Date("2026-09-27T12:00:00.000Z"));
  assert.deepEqual(toWire({ a: ts, b: [ts], c: { d: ts }, e: "x" }), {
    a: { __timestamp: "2026-09-27T12:00:00.000Z" }, b: [{ __timestamp: "2026-09-27T12:00:00.000Z" }],
    c: { d: { __timestamp: "2026-09-27T12:00:00.000Z" } }, e: "x",
  });
});
