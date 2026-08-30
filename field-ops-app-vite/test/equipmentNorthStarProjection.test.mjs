// Equipment North Star P1v2.1 — the derivation layer, made falsifiable.
//
// The locked design's non-negotiables are rules about what the family may and may not COMPOSE, so
// they are testable here rather than only at the render. Each test below fails if the corresponding
// rule is reverted:
//
//   EQ-G5  Installed equipment never states an operating company. Not from the Customer, not from
//          the location, not from the manufacturer — a customer may own machines from both Taylor
//          and Ventana, so a derived value is confidently wrong for exactly the customers it
//          matters most for.
//   EQ-G2  An unresolvable location is an ABSENCE. Never the raw key, never a guessed type.
//   EQ-D2  warrantyExpiresDate is displayed as recorded. No in/out-of-warranty judgment, no days
//          remaining, no provider, no coverage.
//   EQ-D1  No repair economics. EQ-D3 no Opportunity linkage. EQ-D4 no compatible-parts panel.
//   #106   A missing business reference is not permission to display a record id.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  EQUIPMENT_RECORD_HEADER_FACT_KEYS,
  EQUIPMENT_RECORD_HEADER_OWNED_FIELD,
  INSTALL_CONFIRMATION_CONSEQUENCE,
  LOCATION_UNAVAILABLE_LABEL,
  availableRowCells,
  equipmentRecordFacts,
  equipmentRecordIdentity,
  equipmentRecordKicker,
  equipmentRecordShellDefinition,
  installConfirmationSummary,
  installedOperatingCompany,
  timelineEventWords,
} from "../src/domain/equipmentNorthStar.js";
import { equipmentRecordPage } from "../src/metadata/definitions/equipmentPage.js";
import { EDITABLE_EQUIPMENT_FIELDS } from "../src/domain/equipment.js";
import { TIMELINE_SOURCE } from "../src/domain/serializedAssetInstallation.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const read = (rel) => readFileSync(join(SRC, rel), "utf8");
// COMMENTS ARE NOT CODE, and this distinction is load-bearing for the absence proofs below. A file
// that EXPLAINS why it does not derive warranty status necessarily contains the words; a file that
// derives one contains the expression. Scanning the raw text would make the explanation the defect
// and reward deleting it, which is the opposite of what these tests are for.
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const UNIT = {
  id: "eq_8Xy2QrT",
  name: "Soft Serve Freezer 2",
  status: "ACTIVE",
  manufacturer: "Taylor",
  model: "C712",
  serialNumber: "K1122873",
  accountId: "acct_desert_sun",
  locationId: "loc_broadway",
  warrantyExpiresDate: "2024-03-14",
};

// ═════════════════════════════════ EQ-G5 — the operating-company seam

test("EQ-G5 — an installed unit's operating company is UNKNOWN, with the reason", () => {
  const answer = installedOperatingCompany(UNIT);
  assert.equal(answer.known, false);
  assert.equal(answer.value, null);
  assert.match(answer.reason, /cannot be derived from the customer/i);
});

test("EQ-G5 — no account, location or manufacturer can supply the operating company", () => {
  // Every field a plausible derivation would reach for, present and unambiguous. The answer is
  // still that we do not know, because none of them is the authority.
  for (const shape of [
    { ...UNIT, accountId: "acct_taylor_only" },
    { ...UNIT, locationId: "loc_taylor_depot" },
    { ...UNIT, manufacturer: "Taylor" },
    { ...UNIT, manufacturer: "Icetro" },
    { ...UNIT, lineOfBusiness: "TAYLOR" },
  ]) {
    assert.equal(installedOperatingCompany(shape).known, false);
  }
});

test("EQ-G5 — a GOVERNED ownership field, when one exists, is composed rather than ignored", () => {
  // The seam. This is what a later governed authority plugs into; nothing writes the field today.
  const answer = installedOperatingCompany({ ...UNIT, operatingCompanyId: "VENTANA" });
  assert.equal(answer.known, true);
  assert.equal(answer.value, "VENTANA");
});

test("EQ-G5 — no header fact, kicker or subtitle names an operating company", () => {
  const words = [
    equipmentRecordKicker(UNIT),
    equipmentRecordIdentity(UNIT).subtitle ?? "",
    ...equipmentRecordFacts(UNIT).map((f) => `${f.label} ${f.value}`),
  ].join(" ");
  assert.doesNotMatch(words, /ventana|operating company/i);
  // "Taylor" is legitimately present as the MANUFACTURER; it must not be presented as a line.
  assert.doesNotMatch(words, /line of business|business line/i);
});

// ═════════════════════════════════ #106 — the id is never identity

test("the record title is the NAME; the document id is never substituted", () => {
  assert.equal(equipmentRecordIdentity(UNIT).title, "Soft Serve Freezer 2");

  const unnamed = equipmentRecordIdentity({ ...UNIT, name: null });
  assert.equal(unnamed.titleIsAbsent, true);
  assert.doesNotMatch(unnamed.title, /eq_8Xy2QrT/);
  assert.equal(unnamed.title, "Unnamed equipment");
});

test("SERIAL IS CONTEXT, NOT IDENTITY — it is a fact beside the title, never the title", () => {
  const identity = equipmentRecordIdentity(UNIT);
  assert.notEqual(identity.title, UNIT.serialNumber);
  const serial = equipmentRecordFacts(UNIT).find((f) => f.key === "serialNumber");
  assert.equal(serial.value, "K1122873");

  // Optional and not unique: a unit without one still has a record and a title.
  const noSerial = { ...UNIT, serialNumber: null };
  assert.equal(equipmentRecordIdentity(noSerial).title, "Soft Serve Freezer 2");
  assert.equal(equipmentRecordFacts(noSerial).some((f) => f.key === "serialNumber"), false);
});

test("an absent product segment is DROPPED from the kicker, never filled", () => {
  assert.equal(equipmentRecordKicker(UNIT), "Equipment · Taylor C712");
  assert.equal(equipmentRecordKicker({ ...UNIT, manufacturer: null, model: null }), "Equipment");
  assert.doesNotMatch(equipmentRecordKicker({ ...UNIT, model: null }), /undefined|null/);
});

// ═════════════════════════════════ the header states the state once

test("the record shell drops the ONE fact the identity header owns, and nothing else", () => {
  const shell = equipmentRecordShellDefinition(equipmentRecordPage);
  const shellFields = shell.sections.flatMap((s) => s.fieldIds);
  assert.equal(shellFields.includes(EQUIPMENT_RECORD_HEADER_OWNED_FIELD), false);

  // Everything else survives — including the three identity fields the locked 1c frame deliberately
  // shows in BOTH places, because the grid is the only place a pencil can live.
  for (const fieldId of ["name", "manufacturer", "model", "serialNumber", "assetTag", "warrantyExpiresDate", "notes"]) {
    assert.ok(shellFields.includes(fieldId), `${fieldId} must survive the subset`);
  }
});

test("the dropped field costs no edit affordance — status was never pencilled", () => {
  assert.equal(EDITABLE_EQUIPMENT_FIELDS.includes(EQUIPMENT_RECORD_HEADER_OWNED_FIELD), false);
  // And the subset does not widen editability either.
  assert.deepEqual(
    equipmentRecordShellDefinition(equipmentRecordPage).editableFieldIds,
    equipmentRecordPage.editableFieldIds,
  );
});

test("a section emptied by the subset is dropped rather than rendered as a bare heading", () => {
  const only = { sections: [{ id: "s", fieldIds: ["status"] }, { id: "t", fieldIds: ["name"] }] };
  assert.deepEqual(equipmentRecordShellDefinition(only).sections.map((s) => s.id), ["t"]);
});

test("the header's fact keys are declared, so a reader can tell what the header claims", () => {
  assert.deepEqual([...EQUIPMENT_RECORD_HEADER_FACT_KEYS], ["status", "manufacturer", "model", "serialNumber"]);
  assert.deepEqual(equipmentRecordFacts(UNIT).map((f) => f.key), [...EQUIPMENT_RECORD_HEADER_FACT_KEYS]);
});

test("no customer or location fact in the header — those reads fail independently, with Retry", () => {
  const keys = equipmentRecordFacts(UNIT).map((f) => f.key);
  assert.equal(keys.includes("accountId"), false);
  assert.equal(keys.includes("locationId"), false);
});

// ═════════════════════════════════ EQ-G2 — an unresolvable location is an absence

test("EQ-G2 — a location the resolver could not place renders an absence, never the key", () => {
  const cells = availableRowCells({
    serialNo: "CW-C712-0044", title: "Taylor C712", manufacturer: "Taylor", modelNumber: "C712",
    lifecycleState: "AVAILABLE", location: "wh-main", locationResolved: false,
  });
  assert.equal(cells.location, null);
  assert.equal(cells.locationAbsence, LOCATION_UNAVAILABLE_LABEL);
  assert.doesNotMatch(JSON.stringify(cells), /wh-main/);
});

test("EQ-G2 — a RESOLVED location renders its human name and no absence", () => {
  const cells = availableRowCells({ serialNo: "S1", location: "Main warehouse", locationResolved: true });
  assert.equal(cells.location, "Main warehouse");
  assert.equal(cells.locationAbsence, null);
});

test("the model cell carries the MODEL NUMBER only — never the product label standing in for one", () => {
  // An asset whose whole-unit Part did not join has no canonical model. Folding the composed title
  // into a column headed "Model" would label an internal part number as a model number.
  const unjoined = availableRowCells({ serialNo: "S2", title: "IPN-1", manufacturer: null, modelNumber: null });
  assert.equal(unjoined.model, null);
  assert.equal(unjoined.unit, "IPN-1");

  const joined = availableRowCells({ serialNo: "S1", title: "Taylor C161", manufacturer: "Taylor", modelNumber: "C161" });
  assert.equal(joined.model, "Taylor C161");
});

test("five attributes stay five values — the composer never concatenates", () => {
  const cells = availableRowCells({
    serialNo: "CW-C161-0001", title: "Taylor C161", manufacturer: "Taylor", modelNumber: "C161",
    lifecycleState: "AVAILABLE", location: "Main warehouse", locationResolved: true,
  });
  // The exact prose line this family abolished: "Taylor C161 — S/N CW-C161-0001 · AVAILABLE · wh-main".
  for (const value of Object.values(cells)) {
    if (typeof value === "string") assert.doesNotMatch(value, /S\/N|·|—/);
  }
});

// ═════════════════════════════════ the install confirmation

test("the confirmation is null until BOTH choices are made", () => {
  const unit = { title: "Taylor C161", serialNo: "CW-C161-0001" };
  assert.equal(installConfirmationSummary({ unit }), null);
  assert.equal(installConfirmationSummary({ unit, account: { id: "a", name: "Desert Sun" } }), null);
  assert.equal(installConfirmationSummary({ unit, location: { id: "l", name: "Broadway Plant" } }), null);
});

test("the confirmation names the unit, the serial, the customer and the installation location", () => {
  const rows = installConfirmationSummary({
    unit: { title: "Taylor C161", serialNo: "CW-C161-0001" },
    account: { id: "acct_desert_sun", name: "Desert Sun" },
    location: { id: "loc_broadway", name: "Broadway Plant" },
  });
  assert.deepEqual(rows.map((r) => r.key), ["unit", "serial", "customer", "location"]);
  assert.deepEqual(rows.map((r) => r.label), ["Unit", "Serial number", "Customer", "Installation location"]);
  assert.deepEqual(rows.map((r) => r.value), ["Taylor C161", "CW-C161-0001", "Desert Sun", "Broadway Plant"]);
});

test("a nameless customer or location shows an absence — never its document id", () => {
  const rows = installConfirmationSummary({
    unit: { title: "Taylor C161", serialNo: "CW-C161-0001" },
    account: { id: "acct_desert_sun" },
    location: { id: "loc_broadway" },
  });
  assert.doesNotMatch(JSON.stringify(rows), /acct_desert_sun|loc_broadway/);
  assert.equal(rows.find((r) => r.key === "customer").value, "Name unavailable");
});

test("the consequence copy does not imply install is reversible", () => {
  assert.match(INSTALL_CONFIRMATION_CONSEQUENCE, /cannot be undone/i);
  assert.doesNotMatch(INSTALL_CONFIRMATION_CONSEQUENCE, /can be undone|revert|reverse|you can change/i);
});

// ═════════════════════════════════ the timeline says words, not tokens

test("a stored Work Order type and status reach the reader as WORDS", () => {
  const words = timelineEventWords({
    source: TIMELINE_SOURCE.SERVICE, at: 1,
    ref: { workOrderId: "w1", woNumber: "WO-873", type: "INSTALL", status: "WORK_IN_PROGRESS" },
  });
  assert.equal(words.sourceLabel, "Service");
  assert.equal(words.reference, "WO-873");
  assert.equal(words.detail, "Install · In Progress");
  assert.doesNotMatch(words.detail, /WORK_IN_PROGRESS|INSTALL/);
});

test("an UNRECOGNISED token is dropped, not printed — printing it is what was wrong", () => {
  const words = timelineEventWords({
    source: TIMELINE_SOURCE.SERVICE, at: 1,
    ref: { workOrderId: "w1", woNumber: "WO-1", type: "SOMETHING_NEW", status: "ALSO_NEW" },
  });
  assert.equal(words.detail, null);
});

test("the Work Order document id is the link target and never the label", () => {
  const words = timelineEventWords({
    source: TIMELINE_SOURCE.SERVICE, at: 1, ref: { workOrderId: "w1", woNumber: null },
  });
  assert.equal(words.reference, null);
  assert.equal(words.workOrderId, "w1");
  assert.equal(words.fallbackEvent, "Work order");
});

test("an INVENTORY row keeps its own source label and its own kind", () => {
  const words = timelineEventWords({ source: TIMELINE_SOURCE.INVENTORY, at: 1, kind: "RECEIVED", ref: {} });
  assert.equal(words.sourceLabel, "Inventory");
  assert.equal(words.fallbackEvent, "RECEIVED");
  // Work Order vocabulary is not applied to a row that is not a Work Order.
  assert.equal(words.detail, null);
});

// ═════════════════════════════════ EQ-D1 / D2 / D3 / D4 — absent, and proved absent

test("EQ-D2 — Warranty Expires is a recorded date and nothing is derived from it", () => {
  const service = equipmentRecordPage.sections.find((s) => s.fieldIds.includes("warrantyExpiresDate"));
  assert.ok(service, "warrantyExpiresDate must be on the record page");

  // No composer in this layer touches it at all — a warranty JUDGMENT would have to start here.
  const source = code("domain/equipmentNorthStar.js");
  assert.doesNotMatch(source, /warrantyExpiresDate/);
  assert.doesNotMatch(source, /inWarranty|daysRemaining|warrantyStatus|coverage/i);
});

test("EQ-D2 — no Equipment surface derives a warranty STATUS anywhere in src/", () => {
  for (const rel of [
    "modules/equipment/EquipmentDetail.jsx",
    "modules/equipment/EquipmentTimeline.jsx",
    "modules/equipment/AvailableEquipment.jsx",
    "metadata/definitions/equipmentPage.js",
  ]) {
    assert.doesNotMatch(code(rel), /in warranty|out of warranty|warranty expired|days remaining/i, rel);
  }
});

test("EQ-D1 / EQ-D3 / EQ-D4 — no repair economics, opportunity linkage or compatibility panel", () => {
  for (const rel of [
    "domain/equipmentNorthStar.js",
    "modules/equipment/EquipmentDetail.jsx",
    "modules/equipment/AvailableEquipment.jsx",
    "modules/equipment/EquipmentTimeline.jsx",
  ]) {
    const source = code(rel);
    // EQ-D1
    assert.doesNotMatch(source, /repairSpend|repairHeavy|replacementScore|repairs12|costToReplace/i, rel);
    // EQ-D3 — the Equipment record has no relationship to an Opportunity.
    assert.doesNotMatch(source, /opportunit/i, rel);
    // EQ-D4 — the compatibility authority stays in the Parts catalog.
    assert.doesNotMatch(source, /equipmentCompatibilitySection|compatibleParts/i, rel);
  }
});
