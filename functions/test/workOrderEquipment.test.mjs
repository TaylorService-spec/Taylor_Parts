// WHICH MACHINE THIS WORK ORDER IS ABOUT — the two rules, proved.
//
// GOVERNANCE: docs/assessments/core-transaction-actionability-audit.md gap 4; Owner Slice 2.
//
// A Work Order declared customerId and locationId and NO equipment reference, so a technician was
// dispatched to a customer and a site, never to a unit — while the Taylor service invoice
// identifies make / model / serial / install date before any service activity begins.
//
// Everything here runs the REAL validators from the compiled lib and asserts on what they do.

import test from "node:test";
import assert from "node:assert/strict";
import {
  WORK_ORDER_EQUIPMENT_RULE,
  assertEquipmentAllowedForType,
  assertEquipmentIntegrity,
  WorkOrderEquipmentError,
} from "../lib/workOrderEquipment.js";

const WO = { customerId: "acct-1", locationId: "loc-1" };
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof WorkOrderEquipmentError && e.code === code);

// ═════════════════════════════════════════ the type rule

test("service-type Work Orders may name an existing unit", () => {
  for (const type of ["SERVICE_CALL", "PM", "WARRANTY", "INSPECTION"]) {
    assert.equal(WORK_ORDER_EQUIPMENT_RULE[type], "OPTIONAL_EXISTING");
    assert.doesNotThrow(() => assertEquipmentAllowedForType(type, "eq-1"));
  }
});

test("INSTALL REFUSES a unit at creation, because the unit does not exist yet", () => {
  // It is created at completion, from the serialized asset that was physically delivered —
  // workOrderInstallCommand already owns that path. Naming one here points at a machine nobody has
  // installed.
  assert.equal(WORK_ORDER_EQUIPMENT_RULE.INSTALL, "FORBIDDEN_AT_CREATE");
  throwsCode(() => assertEquipmentAllowedForType("INSTALL", "eq-1"), "EQUIPMENT_NOT_ALLOWED_FOR_TYPE");
});

test("INSTALL without a unit is perfectly valid — that is the normal case", () => {
  assert.doesNotThrow(() => assertEquipmentAllowedForType("INSTALL", undefined));
  assert.doesNotThrow(() => assertEquipmentAllowedForType("INSTALL", null));
});

test("the reference is OPTIONAL on every type — legacy Work Orders stay valid", () => {
  // Every Work Order written before this existed has no equipment. Requiring it would retroactively
  // invalidate the whole history, and would also be wrong going forward: a service call can be
  // raised before anyone knows the unit.
  for (const type of ["SERVICE_CALL", "PM", "WARRANTY", "INSPECTION", "INSTALL", undefined]) {
    assert.doesNotThrow(() => assertEquipmentAllowedForType(type, undefined));
  }
});

test("an untyped Work Order follows the ordinary rule, not the INSTALL one", () => {
  // A Work Order is valid with a complaint and no type. Refusing it for a type it does not claim
  // would be inventing a restriction.
  assert.doesNotThrow(() => assertEquipmentAllowedForType(undefined, "eq-1"));
});

test("a malformed reference is refused rather than passed to a lookup", () => {
  for (const bad of ["", "   ", 5, {}, true]) {
    throwsCode(() => assertEquipmentAllowedForType("SERVICE_CALL", bad), "EQUIPMENT_REF_INVALID");
  }
});

// ═════════════════════════════════════════ the integrity rule

test("a unit belonging to this customer at this site is accepted", () => {
  assert.doesNotThrow(() =>
    assertEquipmentIntegrity({ exists: true, accountId: "acct-1", locationId: "loc-1" }, WO));
});

test("equipment that does not exist is refused", () => {
  throwsCode(() => assertEquipmentIntegrity({ exists: false }, WO), "EQUIPMENT_NOT_FOUND");
});

test("ACCOUNT IS STRICT — another customer's machine is the wrong record, not a near miss", () => {
  // Every downstream consumer — service history, warranty, billing responsibility — would inherit
  // the error.
  throwsCode(
    () => assertEquipmentIntegrity({ exists: true, accountId: "acct-OTHER", locationId: "loc-1" }, WO),
    "EQUIPMENT_ACCOUNT_MISMATCH",
  );
  // Absent is not a match either.
  throwsCode(
    () => assertEquipmentIntegrity({ exists: true, accountId: null, locationId: "loc-1" }, WO),
    "EQUIPMENT_ACCOUNT_MISMATCH",
  );
});

test("LOCATION is refused only when BOTH sides know it", () => {
  // A unit installed at one site is not the unit at another, even for the same customer.
  throwsCode(
    () => assertEquipmentIntegrity({ exists: true, accountId: "acct-1", locationId: "loc-OTHER" }, WO),
    "EQUIPMENT_LOCATION_MISMATCH",
  );
});

test("equipment with no recorded site cannot be proven incompatible, so it is allowed", () => {
  // Refusing on ABSENCE would block legitimate work on records whose site was never captured.
  assert.doesNotThrow(() =>
    assertEquipmentIntegrity({ exists: true, accountId: "acct-1", locationId: null }, WO));
  assert.doesNotThrow(() =>
    assertEquipmentIntegrity({ exists: true, accountId: "acct-1" }, WO));
});

test("a Work Order with no site accepts a unit from any of that customer's sites", () => {
  assert.doesNotThrow(() =>
    assertEquipmentIntegrity({ exists: true, accountId: "acct-1", locationId: "loc-9" }, { customerId: "acct-1" }));
});

test("account is checked BEFORE location — the wrong customer is the bigger error", () => {
  // A record that is both the wrong customer and the wrong site should report the customer, which
  // is the fact that makes it the wrong record at all.
  throwsCode(
    () => assertEquipmentIntegrity({ exists: true, accountId: "acct-OTHER", locationId: "loc-OTHER" }, WO),
    "EQUIPMENT_ACCOUNT_MISMATCH",
  );
});
