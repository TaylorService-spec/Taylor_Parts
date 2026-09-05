// Imported Service History -- the trusted READ.
//
// The projection and the ordering are pure and tested here against fakes; the authorization
// gate and the end-to-end visibility are proven in dataImportEndToEnd.test.mjs against a live
// emulator, because a capability decision made against a mock proves nothing about a capability.
import test from "node:test";
import assert from "node:assert/strict";

import {
  projectImportedServiceHistoryRow,
  orderImportedServiceHistory,
  readImportedServiceHistoryForAccount,
  ImportedServiceHistoryReadError,
  IMPORTED_SERVICE_RECORD_KIND,
  IMPORTED_SERVICE_HISTORY_MAX,
  CAP_IMPORTED_SERVICE_HISTORY_READ,
} from "../lib/dataImport/importedServiceHistoryReadService.js";
import { IMPORTED_SERVICE_HISTORY_COLLECTION } from "../lib/dataImport/firestoreServiceHistoryAdapters.js";

const STORED = {
  accountId: "acct-1",
  serviceDate: "2019-06-14",
  summary: "Replaced evaporator fan motor",
  externalReference: "OLD-4471",
  technicianName: "R. Alvarez",
  equipmentSerialNumber: "SN-1001",
  locationName: "Main Plant",
  recordKind: "IMPORTED_SERVICE_HISTORY",
  sourceSystem: "DATA_IMPORT",
  importJobId: "IMP-1",
};

/** A Firestore stand-in implementing only what the read actually uses. */
function fakeDb(docs = []) {
  return {
    collection(name) {
      assert.equal(name, IMPORTED_SERVICE_HISTORY_COLLECTION, "the read must name only its own collection");
      return {
        where(field, op, value) {
          assert.equal(field, "accountId");
          assert.equal(op, "==");
          return {
            limit(n) {
              return {
                async get() {
                  const matched = docs.filter((d) => d.data.accountId === value).slice(0, n);
                  return { docs: matched.map((d) => ({ id: d.id, data: () => d.data })) };
                },
              };
            },
          };
        },
      };
    },
  };
}

// --------------------------------------------------------------- projection

test("the projection is an ALLOW-LIST, not a passthrough of the stored document", () => {
  const row = projectImportedServiceHistoryRow("SH-1", {
    ...STORED,
    // Import stores what a file said, and a file can contain a column nobody reviewed. A field
    // added to a future contract must be invisible here until somebody adds it here too.
    customerSocialSecurityNumber: "should never leave",
    identityKey: "internal",
    importedBy: "admin-uid",
    accountId: "acct-1",
  });

  assert.equal(row.customerSocialSecurityNumber, undefined);
  assert.equal(row.identityKey, undefined, "an internal comparison key is not product data");
  assert.equal(row.importedBy, undefined, "a raw uid never crosses the boundary");
  assert.equal(row.accountId, undefined, "the caller already named the account");
});

test("every row states its kind in the DATA, so a consumer never has to assume", () => {
  const row = projectImportedServiceHistoryRow("SH-1", STORED);
  assert.equal(row.recordKind, IMPORTED_SERVICE_RECORD_KIND);
  // Even a stored document claiming otherwise cannot make a row look like something else.
  assert.equal(projectImportedServiceHistoryRow("SH-2", { ...STORED, recordKind: "WORK_ORDER" }).recordKind, IMPORTED_SERVICE_RECORD_KIND);
});

test("the technician and the serial leave as TEXT, and no id is manufactured beside them", () => {
  const row = projectImportedServiceHistoryRow("SH-1", STORED);
  assert.equal(row.technicianName, "R. Alvarez");
  assert.equal(row.equipmentSerialNumber, "SN-1001");
  // Nothing downstream can resolve an identity it was never given.
  assert.equal(row.technicianId, undefined);
  assert.equal(row.equipmentId, undefined);
});

test("no Work Order field is ever synthesised onto a row", () => {
  const row = projectImportedServiceHistoryRow("SH-1", { ...STORED, status: "COMPLETED", woNumber: "WO-1" });
  for (const forbidden of ["status", "woNumber", "assignedTechId", "scheduledStart", "customerId"]) {
    assert.equal(row[forbidden], undefined, `${forbidden} must not leave the server on a historical row`);
  }
});

test("an absent optional field is null, never an empty string pretending to be a value", () => {
  const row = projectImportedServiceHistoryRow("SH-1", { serviceDate: "2019-01-01", summary: "x", technicianName: "   " });
  assert.equal(row.technicianName, null);
  assert.equal(row.externalReference, null);
  assert.equal(row.equipmentSerialNumber, null);
});

// --------------------------------------------------------------- ordering

test("newest service first, and an undated row sorts LAST rather than first", () => {
  const rows = orderImportedServiceHistory([
    projectImportedServiceHistoryRow("a", { ...STORED, serviceDate: "2019-06-14" }),
    projectImportedServiceHistoryRow("b", { ...STORED, serviceDate: "" }),
    projectImportedServiceHistoryRow("c", { ...STORED, serviceDate: "2021-01-02" }),
  ]);
  // A record with no date is the least useful thing on the list; putting it at the top because
  // an empty string sorts high would bury the history somebody came to read.
  assert.deepEqual(rows.map((r) => r.id), ["c", "a", "b"]);
});

// --------------------------------------------------------------- reading

test("the read is scoped to ONE account and returns only that account's records", async () => {
  const db = fakeDb([
    { id: "SH-1", data: { ...STORED, accountId: "acct-1" } },
    { id: "SH-2", data: { ...STORED, accountId: "acct-OTHER", summary: "somebody else" } },
  ]);
  const result = await readImportedServiceHistoryForAccount(db, "acct-1");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].id, "SH-1");
});

test("the result is BOUNDED, and says so when it cut the list", async () => {
  const docs = Array.from({ length: 5 }, (_, i) => ({
    id: `SH-${i}`,
    data: { ...STORED, serviceDate: `2019-06-${String(i + 10)}` },
  }));
  const result = await readImportedServiceHistoryForAccount(fakeDb(docs), "acct-1", 3);
  assert.equal(result.rows.length, 3);
  // Stated rather than implied: a truncated list that looks complete is a customer's history
  // silently missing its oldest half.
  assert.equal(result.truncated, true);

  const whole = await readImportedServiceHistoryForAccount(fakeDb(docs), "acct-1", 10);
  assert.equal(whole.truncated, false);
});

test("a caller cannot raise the ceiling by asking for more", async () => {
  const docs = Array.from({ length: 3 }, (_, i) => ({ id: `SH-${i}`, data: STORED }));
  const db = {
    collection: () => ({
      where: () => ({
        limit(n) {
          // The ceiling is enforced on the QUERY, not on the result, so an unbounded request
          // never becomes an unbounded read.
          assert.ok(n <= IMPORTED_SERVICE_HISTORY_MAX + 1, `limit ${n} exceeded the ceiling`);
          return { async get() { return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })) }; } };
        },
      }),
    }),
  };
  await readImportedServiceHistoryForAccount(db, "acct-1", 10_000);
  await readImportedServiceHistoryForAccount(db, "acct-1", Number.POSITIVE_INFINITY);
});

test("a missing account is refused rather than read as everything", async () => {
  for (const bad of ["", "   ", null, undefined]) {
    await assert.rejects(
      readImportedServiceHistoryForAccount(fakeDb(), bad),
      (err) => err instanceof ImportedServiceHistoryReadError && err.code === "INVALID",
    );
  }
});

// --------------------------------------------------------------- authority

test("the gate is the EXISTING customer-read capability, not a new one", () => {
  // Reading a customer's service history is reading about that customer. Inventing
  // `serviceHistory.read` to serve one callable would add a catalog entry whose only holder
  // and only caller is this file.
  assert.equal(CAP_IMPORTED_SERVICE_HISTORY_READ, "customer.record.read");
  // And deliberately NOT the import capability: gating the read on admin.dataImport.* would
  // make imported history visible only to whoever imported it.
  assert.notEqual(CAP_IMPORTED_SERVICE_HISTORY_READ, "admin.dataImport.stage");
  assert.notEqual(CAP_IMPORTED_SERVICE_HISTORY_READ, "admin.dataImport.execute");
});

test("the read module has no write path at all", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/dataImport/importedServiceHistoryReadService.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  for (const write of [".set(", ".update(", ".add(", ".delete(", "runTransaction"]) {
    assert.ok(!src.includes(write), `a read service must not contain ${write}`);
  }
});
