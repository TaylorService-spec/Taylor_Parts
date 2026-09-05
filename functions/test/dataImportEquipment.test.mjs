// EOS Data Import P1 -- Equipment.
//
// Equipment is the first entity with FOREIGN KEYS and the first with a uniqueness rule of
// its own, so this file is mostly about the two things that follow from those: a row that
// points at something absent, and a row that is the same machine twice.
//
// SEEDED SYNTHETIC DATA ONLY.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  normalizeEquipmentRow,
  equipmentContextFindings,
  scopedLocationKey,
  EQUIPMENT_REFERENCES,
  EQUIPMENT_REQUIRED_FIELDS,
  EQUIPMENT_IMPORT_CONTRACT,
} from "../lib/dataImport/contracts/equipmentImportContract.js";
import { naturalIdentityKey } from "../lib/dataImport/contracts/entityContract.js";
import { detectEntityType } from "../lib/dataImport/importIntake.js";
import { buildEntityPreview } from "../lib/dataImport/importPreview.js";
import { EQUIPMENT_WRITABLE_KEYS } from "../lib/equipmentInstall/equipmentImportCommand.js";

const GOOD = {
  serialNumber: "SN-1001",
  customerName: "Seeded Soda Works",
  locationName: "Main Plant",
  name: "Ice Machine 1",
};

const CONTEXT = {
  existing: new Set(),
  references: {
    [EQUIPMENT_REFERENCES.CUSTOMER]: new Set([naturalIdentityKey("Seeded Soda Works")]),
    [EQUIPMENT_REFERENCES.LOCATION]: new Set([scopedLocationKey("Seeded Soda Works", "Main Plant")]),
  },
};

const row = (n, values) => ({ sourceRowNumber: n, values });

// --------------------------------------------------------------- contract

test("a clean equipment row normalizes and is always ACTIVE", () => {
  const { draft, findings } = normalizeEquipmentRow({ ...GOOD, manufacturer: "Manitowoc", model: "IY-0454A" });
  assert.equal(draft.status, "ACTIVE");
  assert.equal(draft.serialNumber, "SN-1001");
  assert.equal(findings.length, 0);
});

test("every required field is genuinely required -- a machine with a gap has no identity or no home", () => {
  assert.deepEqual([...EQUIPMENT_REQUIRED_FIELDS], ["serialNumber", "customerName", "locationName", "name"]);
  for (const field of EQUIPMENT_REQUIRED_FIELDS) {
    const { draft, findings } = normalizeEquipmentRow({ ...GOOD, [field]: "" });
    assert.equal(draft, null, `${field} must be required`);
    assert.ok(findings.some((f) => f.severity === "ERROR" && f.field === field));
  }
});

test("a row asking for a non-ACTIVE status is WARNED about, not silently overridden", () => {
  const { draft, findings } = normalizeEquipmentRow({ ...GOOD, status: "RETIRED" });
  // Create is ACTIVE by rule; reaching RETIRED is an audited transition. Honouring the file
  // would be a side door into a lifecycle state, and ignoring it in silence would let an
  // operator believe their retired machines came across retired.
  assert.equal(draft.status, "ACTIVE");
  assert.ok(findings.some((f) => f.severity === "WARNING" && f.code === "STATUS_IGNORED"));
});

// --------------------------------------------------------------- dates

test("an ambiguous date is REFUSED rather than resolved by assuming a locale", () => {
  // "03/04/2026" is 3 April in most of the world and 4 March in the United States, and
  // nothing in a CSV says which. A warranty expiring on the wrong date costs somebody money.
  const { draft, findings } = normalizeEquipmentRow({ ...GOOD, installedDate: "03/04/2026" });
  assert.equal(draft, null);
  assert.ok(findings.some((f) => f.code === "AMBIGUOUS_DATE"));
});

test("an ISO date is accepted and an impossible one is refused", () => {
  assert.equal(normalizeEquipmentRow({ ...GOOD, installedDate: "2026-02-28" }).draft.installedDate, "2026-02-28");
  // 2026 is not a leap year, so 29 February does not exist. Date() would roll it to 1 March.
  const bad = normalizeEquipmentRow({ ...GOOD, installedDate: "2026-02-29" });
  assert.equal(bad.draft, null);
  assert.ok(bad.findings.some((f) => f.code === "INVALID_DATE"));
});

test("a warranty expiring before installation WARNS and still imports", () => {
  const { draft, findings } = normalizeEquipmentRow({
    ...GOOD,
    installedDate: "2026-01-01",
    warrantyExpiresDate: "2025-01-01",
  });
  // The dates disagree; which one is wrong is not knowable from here, and blocking the
  // machine over it would be the wrong trade.
  assert.ok(draft);
  assert.ok(findings.some((f) => f.code === "BEFORE_INSTALL"));
});

// --------------------------------------------------------------- foreign keys

test("an unknown customer is an ERROR -- import never invents the customer", () => {
  const findings = equipmentContextFindings({ ...GOOD, customerName: "Nobody Ltd" }, CONTEXT);
  assert.ok(findings.some((f) => f.severity === "ERROR" && f.code === "CUSTOMER_NOT_FOUND"));
  // Only ONE finding: the location key is scoped by customer, so an unknown customer makes
  // the location question unanswerable. Reporting both would tell the operator to fix two
  // things when there is one.
  assert.equal(findings.length, 1);
});

test("a location belonging to a DIFFERENT customer does not satisfy the row", () => {
  const context = {
    existing: new Set(),
    references: {
      [EQUIPMENT_REFERENCES.CUSTOMER]: new Set([naturalIdentityKey("Seeded Soda Works")]),
      // "Main Plant" exists -- under somebody else. firestore.rules requires the location to
      // belong to the account, so this must not pass.
      [EQUIPMENT_REFERENCES.LOCATION]: new Set([scopedLocationKey("Other Co", "Main Plant")]),
    },
  };
  const findings = equipmentContextFindings(GOOD, context);
  assert.ok(findings.some((f) => f.code === "LOCATION_NOT_FOUND"));
});

test("a resolvable row produces no context findings at all", () => {
  assert.deepEqual([...equipmentContextFindings(GOOD, CONTEXT)], []);
});

test("with NO references loaded, every row fails closed rather than passing", () => {
  // A loader that returned nothing (a read that failed, an entity wired without its
  // references) must not look like "every customer exists".
  const findings = equipmentContextFindings(GOOD, { existing: new Set() });
  assert.ok(findings.some((f) => f.code === "CUSTOMER_NOT_FOUND"));
});

// --------------------------------------------------------------- serial identity

test("serial comparison ignores spacing and case -- a plate transcribed twice is one machine", () => {
  const key = (serialNumber) => EQUIPMENT_IMPORT_CONTRACT.identityKey({ serialNumber });
  assert.equal(key("AB 12345"), key("ab12345"));
});

test("a duplicate serial inside the file, and one already registered, are both ERRORS", () => {
  const preview = buildEntityPreview(
    "EQUIPMENT",
    [
      row(2, { ...GOOD, serialNumber: "SN-1" }),
      // Case and stray spacing only. A HYPHEN is deliberately not treated as a space:
      // "SN-1" and "SN 1" may be two different plates, and merging them would lose a machine.
      row(3, { ...GOOD, serialNumber: " sn-1 ", name: "Ice Machine 2" }),
      row(4, { ...GOOD, serialNumber: "SN-EXISTING", name: "Ice Machine 3" }),
    ],
    { ...CONTEXT, existing: new Set(["SN-EXISTING"]) },
  );

  assert.deepEqual(preview.summary, { total: 3, ready: 1, warnings: 0, errors: 2 });
  assert.ok(preview.rows[1].findings.some((f) => f.code === "DUPLICATE_IN_FILE"));
  assert.ok(preview.rows[2].findings.some((f) => f.code === "ALREADY_EXISTS"));
  // The message uses the EQUIPMENT vocabulary, not the Part or Customer one.
  assert.match(preview.rows[2].findings.find((f) => f.code === "ALREADY_EXISTS").message, /Serial Number/);
});

// --------------------------------------------------------------- rules mirror

test("the writable key set mirrors firestore.rules equipmentWritableKeys()", () => {
  // THE FAILURE THIS STOPS. The Admin SDK evaluates no Rules, so the allow-list that makes
  // client creates fail closed for fields nobody has thought of yet does not apply to import
  // -- unless import re-states it. This asserts the two lists are the same list.
  const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
  const block = /function equipmentWritableKeys\(\)\s*\{\s*return \[([\s\S]*?)\];/.exec(rules)?.[1];
  assert.ok(block, "equipmentWritableKeys() must be findable in firestore.rules");

  const fromRules = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual([...EQUIPMENT_WRITABLE_KEYS].sort(), fromRules);
});

test("the contract offers no field outside that key set, plus the two it resolves away", () => {
  const resolvedAway = ["customerName", "locationName"];
  for (const field of EQUIPMENT_IMPORT_CONTRACT.canonicalFields.map((f) => f.field)) {
    assert.ok(
      EQUIPMENT_WRITABLE_KEYS.includes(field) || resolvedAway.includes(field),
      `${field} is neither writable nor resolved to an id`,
    );
  }
});

// --------------------------------------------------------------- detection

test("an equipment header detects as EQUIPMENT, not as Customers on its customer column", () => {
  const detection = detectEntityType(["SERIAL", "CUSTOMER", "SITE", "NAME", "MAKE", "MODEL"]);
  assert.equal(detection.entityType, "EQUIPMENT");
});

// --------------------------------------------------------------- portability

test("the equipment contract stays on the portable side", () => {
  const src = readFileSync(new URL("../src/dataImport/contracts/equipmentImportContract.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  assert.ok(!/from\s+["'][^"']*firebase-admin/.test(src));
  assert.ok(!/\.collection\(/.test(src));
});
