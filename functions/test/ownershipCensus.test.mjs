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
const warehouses = ownershipFamily("warehouse");

test("the census covers EVERY OWNABLE family, and only those (ruling D-8)", () => {
  const ownable = OWNERSHIP_MATRIX.filter(
    (f) => f.ownerClass === "PERSON" || f.ownerClass === "COMPANY" || f.ownerClass === "PARTICIPATING_COMPANIES",
  );
  assert.deepEqual(
    CENSUS_FAMILIES.map((f) => f.family),
    ownable.map((f) => f.family),
  );
  // REFERENCE and EXCLUDED are absent BY CLASSIFICATION, not by omission. Counting them would
  // report a backlog no decision could ever clear -- there is no company that owns a part number.
  const censused = new Set(CENSUS_FAMILIES.map((f) => f.family));
  for (const f of OWNERSHIP_MATRIX) {
    if (f.ownerClass === "REFERENCE" || f.ownerClass === "EXCLUDED") {
      assert.ok(!censused.has(f.family), `${f.family} is ${f.ownerClass} and must not be censused`);
      assert.equal(f.ownerType, null, `${f.family} is ${f.ownerClass} and must have no owner type`);
    }
  }
  // Every censused family declares a usable shape: a single owner type, or -- for a cross-company
  // transaction -- the participating pair that stands in place of one.
  for (const f of CENSUS_FAMILIES) {
    if (f.ownerClass === "PARTICIPATING_COMPANIES") {
      assert.equal(f.ownerType, null, `${f.family} has a participating shape and must not claim one owner type`);
      assert.equal(f.participatingFields?.length, 2, `${f.family} must name both participants`);
    } else {
      assert.ok(f.ownerType, `${f.family} is ownable and must declare an owner type`);
    }
  }
});

test("REFERENCE families are classified out of the invariant, not counted as ownerless", () => {
  // Ruling D-11: Taylor and Ventana may both legitimately use the same part. Assigning one of them
  // would fabricate a fact to satisfy a sentence, so `parts` is company-NEUTRAL by classification.
  assert.equal(parts.ownerClass, "REFERENCE");
  assert.equal(parts.ownerType, null);
  assert.equal(parts.companyScope, "COMPANY_NEUTRAL");
  assert.match(parts.unresolvedPolicy, /not ownable/);
});

test("an ownable family with no ownership storage counts as OWNERLESS, never as a clean zero", () => {
  // Every company-owned family is in this state today. Reporting them as skipped-or-absent would
  // make the gate pass over the whole section.
  assert.deepEqual(warehouses.ownerFields, []);
  const out = classifyDocument(warehouses, { name: "Main DC" });
  assert.equal(out.resolution, "OWNERLESS");
  assert.match(out.reason, /no ownership storage yet/);
});

test("the five buckets are counted from the real derivations, and nothing is double-counted", () => {
  const report = censusFamily(accounts, [
    { id: "a1", data: { accountOwner: { assignedToEmployeeId: "emp-1" } } },
    { id: "a2", data: { accountOwner: { assignedToUserId: "uid-1" } } },
    { id: "a3", data: {} },
    { id: "a4", data: { accountOwner: "emp-9" } },
  ]);
  assert.deepEqual(report.counts, { resolved: 1, ownerless: 1, invalid: 2, unknown: 0, ambiguous: 0 });
  assert.equal(report.scanned, 4);
  assert.equal(
    Object.values(report.counts).reduce((a, b) => a + b, 0),
    report.scanned,
    "every document must land in exactly one bucket",
  );
  assert.equal(report.truncated, false);
  assert.deepEqual(report.samples.ownerless, ["a3"]);
  assert.ok(report.samples.invalid.includes("a2"));
});

test("INVALID and UNKNOWN are separate columns, not one unresolved number", () => {
  // A malformed company id is data to repair; a well-formed unseeded one is a build that does not
  // recognise a legitimate value. Different work, so different columns.
  // `warehouse` is a COMPANY family (a physical company root, ruling D-9). `parts` is REFERENCE
  // now, so it can no longer stand in for a company-owned family here.
  const report = censusFamily({ ...ownershipFamily("warehouse"), ownerFields: ["operatingCompanyId"] }, [
    { id: "p1", data: { operatingCompanyId: "taylor" } },
    { id: "p2", data: { operatingCompanyId: "TAYLOR" } },
    { id: "p3", data: { operatingCompanyId: "third-company" } },
  ]);
  assert.deepEqual(report.counts, { resolved: 1, ownerless: 0, invalid: 1, unknown: 1, ambiguous: 0 });
  assert.deepEqual(report.samples.invalid, ["p2"]);
  assert.deepEqual(report.samples.unknown, ["p3"]);
});

test("a USER family's UNKNOWN column is structurally zero -- O-1 forbids the lookup that would fill it", () => {
  const report = censusFamily(opportunities, [
    { id: "o1", data: { ownerEmployeeId: "emp-does-not-exist" } },
    { id: "o2", data: { ownerEmployeeId: "" } },
  ]);
  // A nonexistent employee id still RESOLVES: ownership resolution is deterministic and does not
  // do a cross-collection existence check (Owner ruling O-1). Only a malformed value is INVALID.
  assert.equal(report.counts.unknown, 0);
  assert.equal(report.counts.resolved, 1);
  assert.equal(report.counts.invalid, 1);
});

test("the reason TALLY is the volume-safe report; the id sample is capped at ten", () => {
  const docs = Array.from({ length: 25 }, (_, i) => ({ id: `o${i}`, data: {} }));
  const report = censusFamily(opportunities, docs);
  assert.equal(report.counts.ownerless, 25);
  // 40,000 ownerless rows must report as one line, not 40,000 ids or a misleading sample.
  assert.deepEqual(report.reasons, { "no ownerEmployeeId": 25 });
  assert.equal(report.samples.ownerless.length, 10);
});

test("the gate: any non-resolved record keeps enforcement off", () => {
  const clean = censusFamily(opportunities, [{ id: "o1", data: { ownerEmployeeId: "emp-1" } }]);
  const g = censusGate([clean]);
  assert.equal(g.blocking, 0);
  assert.deepEqual(g.unreadable, []);
  assert.deepEqual(g.truncated, []);
  assert.equal(g.assessable, true);
  assert.equal(g.totals.resolved, 1);

  const dirty = censusFamily(opportunities, [{ id: "o2", data: {} }]);
  const gate = censusGate([clean, dirty]);
  assert.equal(gate.blocking, 1);
  assert.equal(gate.assessable, false);
});

test("the gate: A FAMILY NOBODY COULD READ ALSO BLOCKS IT", () => {
  // A permission or index failure that counted as zero would let enforcement be enabled over
  // records nobody looked at -- "do not deploy enforcement solely because the code exists", seen
  // from the data side.
  const clean = censusFamily(opportunities, [{ id: "o1", data: { ownerEmployeeId: "emp-1" } }]);
  const gate = censusGate([clean, { family: "equipment", collection: "equipment", ownerType: "COMPANY", error: "PERMISSION_DENIED" }]);
  assert.equal(gate.blocking, 0);
  assert.deepEqual(gate.unreadable, ["equipment"]);
  assert.equal(gate.assessable, false);
});

test("the gate: A TRUNCATED FAMILY ALSO BLOCKS IT", () => {
  // A --limit run measured a page, not a population. A gate decided on a page is a guess wearing a
  // number's clothes, so truncation is reported and it blocks.
  const partial = censusFamily(opportunities, [{ id: "o1", data: { ownerEmployeeId: "emp-1" } }], true);
  const gate = censusGate([partial]);
  assert.equal(gate.blocking, 0);
  assert.deepEqual(gate.truncated, ["opportunity"]);
  assert.equal(gate.assessable, false);
});
