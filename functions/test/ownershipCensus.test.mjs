// EOS Ownership Model v1 — the census classifier (Owner authorization, next-pass items 11/12).
//
// The census total decides whether ownership enforcement may be turned on, so it is tested here
// against fabricated documents rather than only exercised by a CLI that needs credentials nobody
// can supply in a test. No emulator, no Firebase, no network.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CENSUS_FAMILIES,
  censusFamily,
  censusGate,
  classifyDocument,
} from "../lib/ownership/ownershipCensus.js";
import { ownershipFamily, OWNERSHIP_MATRIX } from "../lib/ownership/ownershipMatrix.js";

const accounts = ownershipFamily("account");
const opportunities = ownershipFamily("opportunity");
const parts = ownershipFamily("part");

test("the census covers EVERY family in the matrix -- a narrower list cannot be iterated", () => {
  assert.equal(CENSUS_FAMILIES.length, OWNERSHIP_MATRIX.length);
  assert.deepEqual(
    CENSUS_FAMILIES.map((f) => f.family),
    OWNERSHIP_MATRIX.map((f) => f.family),
  );
});

test("a family with no ownership storage counts as OWNERLESS, never as a clean zero", () => {
  // Every company-owned family is in this state today. Reporting them as skipped-or-absent would
  // make the gate pass over the whole section.
  assert.deepEqual(parts.ownerFields, []);
  const out = classifyDocument(parts, { partNumber: "PRT-1" });
  assert.equal(out.resolution, "OWNERLESS");
  assert.match(out.reason, /no ownership storage yet/);
});

test("the four buckets are counted from the real derivations", () => {
  const report = censusFamily(accounts, [
    { id: "a1", data: { accountOwner: { assignedToEmployeeId: "emp-1" } } },
    { id: "a2", data: { accountOwner: { assignedToUserId: "uid-1" } } },
    { id: "a3", data: {} },
    { id: "a4", data: { accountOwner: "emp-9" } },
  ]);
  assert.deepEqual(report.counts, { resolved: 1, unresolved: 2, ambiguous: 0, ownerless: 1 });
  assert.equal(report.scanned, 4);
  assert.equal(report.truncated, false);
  // Offenders are named, with the reason, so the backlog is actionable rather than a bare number.
  assert.ok(report.samples.unresolved.some((s) => s.startsWith("a2 (")));
  assert.deepEqual(report.samples.ownerless, ["a3 (no accountOwner)"]);
  assert.deepEqual(report.samples.resolved, undefined);
});

test("the offender sample is capped at ten, and the COUNT is not", () => {
  const docs = Array.from({ length: 25 }, (_, i) => ({ id: `o${i}`, data: {} }));
  const report = censusFamily(opportunities, docs);
  assert.equal(report.counts.ownerless, 25);
  assert.equal(report.samples.ownerless.length, 10);
});

test("truncation is reported, never silent", () => {
  const report = censusFamily(opportunities, [{ id: "o1", data: { ownerEmployeeId: "emp-1" } }], true);
  assert.equal(report.truncated, true);
});

test("the gate: any unresolved, ambiguous, or ownerless record keeps enforcement off", () => {
  const clean = censusFamily(opportunities, [{ id: "o1", data: { ownerEmployeeId: "emp-1" } }]);
  assert.deepEqual(censusGate([clean]), { blocking: 0, unreadable: [], assessable: true });

  const dirty = censusFamily(opportunities, [{ id: "o2", data: {} }]);
  const gate = censusGate([clean, dirty]);
  assert.equal(gate.blocking, 1);
  assert.equal(gate.assessable, false);
});

test("the gate: A FAMILY NOBODY COULD READ ALSO BLOCKS IT", () => {
  // This is the important one. A permission or index failure that counted as zero would let
  // enforcement be enabled over records that were never looked at -- "do not deploy enforcement
  // solely because the code exists", seen from the data side.
  const clean = censusFamily(opportunities, [{ id: "o1", data: { ownerEmployeeId: "emp-1" } }]);
  const gate = censusGate([clean, { family: "equipment", error: "PERMISSION_DENIED" }]);
  assert.equal(gate.blocking, 0);
  assert.deepEqual(gate.unreadable, ["equipment"]);
  assert.equal(gate.assessable, false);
});
