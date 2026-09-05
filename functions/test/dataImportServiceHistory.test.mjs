// EOS Data Import P1 -- Service History.
//
// The entity whose whole design is a refusal: EOS already has Service History, derived from
// Work Orders, and this must not become a second way to manufacture one. So most of what is
// asserted here is what an imported service record is NOT.
//
// SEEDED SYNTHETIC DATA ONLY.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  normalizeServiceHistoryRow,
  serviceHistoryContextFindings,
  SERVICE_HISTORY_REFERENCES,
  SERVICE_HISTORY_REQUIRED_FIELDS,
  SERVICE_HISTORY_IMPORT_CONTRACT,
} from "../lib/dataImport/contracts/serviceHistoryImportContract.js";
import { naturalIdentityKey } from "../lib/dataImport/contracts/entityContract.js";
import { buildEntityPreview } from "../lib/dataImport/importPreview.js";
import { detectEntityType } from "../lib/dataImport/importIntake.js";
import { IMPORTED_SERVICE_HISTORY_COLLECTION } from "../lib/dataImport/firestoreServiceHistoryAdapters.js";
import { WORK_ORDERS_COLLECTION } from "../lib/constants/collections.js";

const TODAY = "2026-09-04";
const GOOD = {
  customerName: "Seeded Soda Works",
  serviceDate: "2019-06-14",
  summary: "Replaced evaporator fan motor and cleaned condenser.",
  externalReference: "OLD-4471",
};

const CONTEXT = {
  existing: new Set(),
  references: {
    [SERVICE_HISTORY_REFERENCES.CUSTOMER]: new Set([naturalIdentityKey("Seeded Soda Works")]),
  },
};

const row = (n, values) => ({ sourceRowNumber: n, values });

// --------------------------------------------------------------- what it is

test("a clean historical row normalizes", () => {
  const { draft, findings } = normalizeServiceHistoryRow(GOOD, TODAY);
  assert.equal(draft.serviceDate, "2019-06-14");
  assert.equal(draft.externalReference, "OLD-4471");
  assert.equal(findings.length, 0);
});

test("customer, date and what was done are all required", () => {
  assert.deepEqual([...SERVICE_HISTORY_REQUIRED_FIELDS], ["customerName", "serviceDate", "summary"]);
  for (const field of SERVICE_HISTORY_REQUIRED_FIELDS) {
    const { draft } = normalizeServiceHistoryRow({ ...GOOD, [field]: "" }, TODAY);
    assert.equal(draft, null, `${field} must be required`);
  }
});

test("a record with no description is refused -- a date and a name record nothing useful", () => {
  const { draft, findings } = normalizeServiceHistoryRow({ ...GOOD, summary: "" }, TODAY);
  assert.equal(draft, null);
  assert.ok(findings.some((f) => f.field === "summary" && f.severity === "ERROR"));
});

// --------------------------------------------------------------- what it is NOT

test("a FUTURE service date is refused -- this imports history, not schedule", () => {
  // The defining check for this entity. A future date is a typo or an attempt to schedule
  // work through the import path, and scheduling work is what Work Orders and dispatch are
  // for -- with a lifecycle this record deliberately does not have.
  const { draft, findings } = normalizeServiceHistoryRow({ ...GOOD, serviceDate: "2027-01-01" }, TODAY);
  assert.equal(draft, null);
  assert.ok(findings.some((f) => f.code === "NOT_HISTORICAL"));
});

test("today is still history; tomorrow is not", () => {
  assert.ok(normalizeServiceHistoryRow({ ...GOOD, serviceDate: TODAY }, TODAY).draft);
  assert.equal(normalizeServiceHistoryRow({ ...GOOD, serviceDate: "2026-09-05" }, TODAY).draft, null);
});

test("an ambiguous date is refused rather than resolved by assuming a locale", () => {
  const { draft, findings } = normalizeServiceHistoryRow({ ...GOOD, serviceDate: "06/14/2019" }, TODAY);
  assert.equal(draft, null);
  assert.ok(findings.some((f) => f.code === "AMBIGUOUS_DATE"));
});

test("the record is NOT written to the Work Order collection", () => {
  // A Work Order is a lifecycle. A record dropped into a terminal state never had one, and
  // would be indistinguishable from a real Work Order in every metric that counts them --
  // completion rates, technician job counts, availability.
  assert.notEqual(IMPORTED_SERVICE_HISTORY_COLLECTION, WORK_ORDERS_COLLECTION);
  assert.equal(IMPORTED_SERVICE_HISTORY_COLLECTION, "imported_service_history");
});

test("the contract offers no field that would imply a lifecycle", () => {
  const offered = SERVICE_HISTORY_IMPORT_CONTRACT.canonicalFields.map((f) => f.field);
  // Each of these would assert that the record went through something in EOS. `status` would
  // be the worst: a COMPLETED record implies a transition somebody made.
  for (const forbidden of ["status", "state", "assignedTo", "scheduledFor", "transitionedBy", "priority", "workOrderId"]) {
    assert.ok(!offered.includes(forbidden), `${forbidden} must not be importable`);
  }
});

test("the technician stays a NAME and is never resolved to an employee", () => {
  const { draft } = normalizeServiceHistoryRow({ ...GOOD, technicianName: "R. Alvarez" }, TODAY);
  // Linking a 2019 job to a current employee on a name match would attribute somebody else's
  // work to a real person, inside a record that looks authoritative.
  assert.equal(draft.technicianName, "R. Alvarez");
  assert.equal(draft.technicianId, undefined);
  assert.equal(draft.assignedToUserId, undefined);
});

test("the equipment serial is recorded as written and never linked", () => {
  const { draft } = normalizeServiceHistoryRow({ ...GOOD, equipmentSerialNumber: "SN-1001" }, TODAY);
  // The machine may have been replaced; a link would attach the old one's history to the new.
  assert.equal(draft.equipmentSerialNumber, "SN-1001");
  assert.equal(draft.equipmentId, undefined);
});

// --------------------------------------------------------------- references and identity

test("an unknown customer is an ERROR -- service happened FOR somebody who exists", () => {
  const findings = serviceHistoryContextFindings({ ...GOOD, customerName: "Nobody Ltd" }, CONTEXT);
  assert.ok(findings.some((f) => f.code === "CUSTOMER_NOT_FOUND"));
});

test("identity is the SOURCE REFERENCE where there is one", () => {
  const key = (over) => SERVICE_HISTORY_IMPORT_CONTRACT.identityKey({ ...GOOD, ...over });
  // Same job number, different everything else: still the same job.
  assert.equal(key({ summary: "Something else entirely" }), key({}));
  assert.notEqual(key({ externalReference: "OLD-9999" }), key({}));
});

test("without a source reference, identity falls back to customer + date + description", () => {
  const key = (over) => SERVICE_HISTORY_IMPORT_CONTRACT.identityKey({ ...GOOD, externalReference: undefined, ...over });
  assert.equal(key({}), key({ technicianName: "somebody" }));
  assert.notEqual(key({}), key({ serviceDate: "2019-06-15" }));
  assert.notEqual(key({}), key({ summary: "A different job" }));
});

test("a missing source reference WARNS -- the record imports but cannot be traced back", () => {
  const { draft, findings } = normalizeServiceHistoryRow({ ...GOOD, externalReference: "" }, TODAY);
  assert.ok(draft, "it is still worth having");
  assert.ok(findings.some((f) => f.severity === "WARNING" && f.code === "NO_SOURCE_REFERENCE"));
});

test("the same job number twice in one file is a duplicate", () => {
  const preview = buildEntityPreview(
    "SERVICE_HISTORY",
    [
      row(2, { ...GOOD, externalReference: "OLD-1" }),
      row(3, { ...GOOD, externalReference: "old-1", summary: "Same job, described differently" }),
      row(4, { ...GOOD, externalReference: "OLD-2" }),
    ],
    CONTEXT,
  );
  assert.deepEqual(preview.summary, { total: 3, ready: 2, warnings: 0, errors: 1 });
  assert.ok(preview.rows[1].findings.some((f) => f.code === "DUPLICATE_IN_FILE"));
});

test("two genuinely different visits on one day are NOT duplicates", () => {
  const preview = buildEntityPreview(
    "SERVICE_HISTORY",
    [
      row(2, { ...GOOD, externalReference: undefined, summary: "Morning: replaced fan motor" }),
      row(3, { ...GOOD, externalReference: undefined, summary: "Afternoon: returned to fix leak" }),
    ],
    CONTEXT,
  );
  // One customer legitimately has two visits in a day. The composite fallback includes the
  // description precisely so those stay two records.
  assert.equal(preview.summary.errors, 0);
  assert.equal(preview.summary.warnings, 2, "both warn about the missing source reference");
});

// --------------------------------------------------------------- detection

test("a service-history header detects as SERVICE_HISTORY", () => {
  assert.equal(
    detectEntityType(["CUSTOMER", "SERVICE_DATE", "WORK_PERFORMED", "TICKET", "TECH"]).entityType,
    "SERVICE_HISTORY",
  );
});

// --------------------------------------------------------------- portability

test("the service-history contract stays on the portable side", () => {
  const src = readFileSync(new URL("../src/dataImport/contracts/serviceHistoryImportContract.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  assert.ok(!/from\s+["'][^"']*firebase-admin/.test(src));
  assert.ok(!/\.collection\(/.test(src));
});
