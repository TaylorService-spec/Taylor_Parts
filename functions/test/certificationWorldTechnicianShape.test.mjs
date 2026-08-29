// Certification-world technician records must be VALID TECHNICIANS, not employees wearing a
// technician collection name.
//
// ============================ THE DEFECT THIS PINS ============================
//
// buildTechnicianRecords wrote `displayName`, `active` and `available` -- the EMPLOYEE vocabulary --
// into `fieldops_technicians`, whose canonical shape is `{ id, name, phone, status }`. Nothing
// rejected it, because the seeder runs on the Admin SDK and so bypasses the firestore.rules check
// that requires `status` on any client-written technician.
//
// Measured on eos-platform-sandbox 2026-08-27, on the eleven records it had already written:
//
//   * `name` absent  -> every one rendered "Unknown technician" on the Dispatch board. The resolver
//     was right: it refuses to print a raw document id where a business name belongs.
//   * `status` absent -> governed placement refused all eleven with TECHNICIAN_INELIGIBLE. A third
//     of the sandbox roster could not be scheduled at all.
//
// Neither symptom is a UI bug and neither is a Scheduling bug. Both are this generator.
//
// ============================ WHY IT ASSERTS AGAINST THE REAL SET ============================
//
// The status vocabulary is imported from the compiled scheduling repository -- the SAME
// GOVERNED_TECHNICIAN_STATUSES that placementPolicy.ts's eligibility check consults. Re-listing the
// three strings here would be a second copy of exactly the authority whose divergence caused the
// defect, and it would still pass on the day someone changed the real one.
//
// Prerequisite: `npm run build` in functions/ (imports lib/, as this repo's other compiled-authority
// tests do).
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildWorkforce } from "../scripts/certificationWorld/data/workforce.mjs";
import { buildTechnicianRecords } from "../scripts/certificationWorld/data/workforceLoad.mjs";
import { GOVERNED_TECHNICIAN_STATUSES } from "../lib/scheduling/schedulingRepository.js";

const workforce = buildWorkforce();
const technicianEmployees = workforce.filter((e) => e.securityRole === "technician");
const records = buildTechnicianRecords(workforce);
const byId = new Map(records.map((r) => [r.id, r]));

test("the generator emits one record per technician employee, and only technicians", () => {
  assert.ok(technicianEmployees.length > 0, "fixture must contain technicians or this suite proves nothing");
  assert.equal(records.length, technicianEmployees.length);
  for (const r of records) {
    assert.equal(r.collection, "fieldops_technicians");
    const employee = workforce.find((e) => e.employeeId === r.id);
    assert.equal(employee?.securityRole, "technician", `${r.id} is not a technician employee`);
  }
});

test("name comes from the certification employee display name — never fabricated, never an id", () => {
  for (const e of technicianEmployees) {
    const r = byId.get(e.employeeId);
    assert.equal(r.data.name, e.displayName, `${e.employeeId} name must be the employee display name`);
    assert.notEqual(r.data.name, e.employeeId, "a document id is not a business name");
    assert.ok(typeof r.data.name === "string" && r.data.name.trim().length > 0,
      `${e.employeeId} must carry a non-empty name — an empty one resolves to "Unknown technician"`);
  }
});

test("phone comes from certPhone", () => {
  for (const e of technicianEmployees) {
    assert.equal(byId.get(e.employeeId).data.phone, e.certPhone);
  }
});

test("status is a status the governed placement check actually recognises", () => {
  // This is the exact predicate at placementPolicy.ts's eligibility branch, against the exact set it
  // imports. If this passes, no generated technician can be refused TECHNICIAN_INELIGIBLE for want
  // of a governed status.
  for (const r of records) {
    assert.ok(GOVERNED_TECHNICIAN_STATUSES.has(r.data.status),
      `${r.id} status ${JSON.stringify(r.data.status)} is not in the governed set`);
  }
});

test("an available employee is available; an unavailable one is off_shift, not omitted", () => {
  const available = technicianEmployees.filter((e) => e.certAvailable !== false);
  const unavailable = technicianEmployees.filter((e) => e.certAvailable === false);
  assert.ok(available.length > 0 && unavailable.length > 0,
    "the fixture must exercise BOTH branches or this assertion is decorative");

  for (const e of available) assert.equal(byId.get(e.employeeId).data.status, "available");
  for (const e of unavailable) {
    const r = byId.get(e.employeeId);
    assert.equal(r.data.status, "off_shift");
    // Present, not absent. completeAssignedJob fails closed when a technician record is missing, so
    // an unavailable technician must still HAVE a record — that is why these documents exist.
    assert.ok(r, `${e.employeeId} must still get a record`);
  }
});

test("identity linkage holds: technicianId equals the document id, employeeId is retained", () => {
  // transitionWorkOrder and completeAssignedJob address technicians by document id. A technicianId
  // that disagreed with it would resolve nowhere while looking correct in a listing.
  for (const r of records) {
    assert.equal(r.data.technicianId, r.id);
    assert.equal(r.data.employeeId, r.id);
  }
});

test("certification provenance is preserved, so the governed reset can still find these", () => {
  // `reset` is marker-scoped. A record without provenance is one the sanctioned cleanup path cannot
  // reach, which turns a reseedable fixture into permanent sandbox litter.
  for (const r of records) {
    assert.equal(r.data.dataProvenance, "SYNTHETIC_CERTIFICATION_FACT");
  }
  // The certificationWorld marker itself is stamped centrally by certificationWorld.mjs for every
  // dataset, so it is deliberately NOT emitted here — asserting it in this unit would pin the wrong
  // layer and fail for the right code.
});

test("no regression to employee-only vocabulary", () => {
  // The exact fields the defect wrote. Their absence is the fix; if one comes back, one document
  // carries two spellings of identity and the next reader picks the wrong one.
  for (const r of records) {
    for (const forbidden of ["displayName", "active", "available"]) {
      assert.ok(!(forbidden in r.data),
        `${r.id} must not carry employee vocabulary "${forbidden}" in the technician collection`);
    }
  }
});

test("regression evidence: the OLD shape fails the very check the new shape passes", () => {
  // Without this, every assertion above could pass against a predicate that accepts anything. This
  // reconstructs the pre-fix record and proves the governed eligibility check rejects it — the
  // repo-side equivalent of the live TECHNICIAN_INELIGIBLE refusal, with no sandbox mutation.
  const e = technicianEmployees[0];
  const oldShape = {
    technicianId: e.employeeId,
    employeeId: e.employeeId,
    displayName: e.displayName,
    active: e.active !== false,
    available: e.certAvailable !== false,
    dataProvenance: "SYNTHETIC_CERTIFICATION_FACT",
  };
  assert.ok(!GOVERNED_TECHNICIAN_STATUSES.has(oldShape.status),
    "the old shape carried no governed status — that is what placement refused");
  assert.equal(oldShape.name, undefined, "the old shape carried no name — that is what the board could not resolve");

  const newShape = byId.get(e.employeeId).data;
  assert.ok(GOVERNED_TECHNICIAN_STATUSES.has(newShape.status));
  assert.equal(newShape.name, e.displayName);
});
