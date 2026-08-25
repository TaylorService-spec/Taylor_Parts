// THE CLIENT SIDE OF "WHICH MACHINE" — the mirror, the picker, and the label.
//
// GOVERNANCE: Owner Slice 2.
//
// The server decides (functions/src/workOrderEquipment.ts). This file guards the three ways the
// client can still get it wrong:
//
//   1. the rule mirror DRIFTS, so the UI offers what the server refuses
//   2. the picker becomes a text box, asking somebody to type a document id
//   3. the reference renders as a raw id instead of the machine

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { WORK_ORDER_EQUIPMENT_RULE, equipmentAllowedAtCreate } from "../src/domain/workOrderEquipmentRule.js";
import { workOrderEntity } from "../src/metadata/definitions/workOrder.js";
import { workOrderRecordPage } from "../src/metadata/definitions/workOrderPage.js";
import { equipmentDisplayName, equipmentSummary } from "../src/domain/equipment.js";

const read = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");
const PICKER = read("src/modules/workOrders/EquipmentPicker.jsx");
const WIZARD = read("src/modules/workOrders/WorkOrderWizard.jsx");
const DETAIL = read("src/modules/workOrders/WorkOrderDetailPage.jsx");
const SERVER_RULE = read("../functions/src/workOrderEquipment.ts");

// ═════════════════════════════════════════ the mirror cannot drift

describe("the client rule mirrors the server", () => {
  it("every type carries the same rule on both sides", () => {
    // Two copies of a rule that drift are worse than one copy in the wrong place: the UI offers
    // something the server refuses and nobody can tell which is right.
    for (const [type, rule] of Object.entries(WORK_ORDER_EQUIPMENT_RULE)) {
      expect(SERVER_RULE, `${type} missing from the server rule`).toMatch(
        new RegExp(`${type}:\\s*"${rule}"`),
      );
    }
  });

  it("the server declares no type the client does not mirror", () => {
    const serverTypes = [...SERVER_RULE.matchAll(/^\s{2}([A-Z_]+):\s*"(OPTIONAL_EXISTING|FORBIDDEN_AT_CREATE)"/gm)]
      .map((m) => m[1]);
    expect(serverTypes.length).toBeGreaterThan(0);
    expect(serverTypes.sort()).toEqual(Object.keys(WORK_ORDER_EQUIPMENT_RULE).sort());
  });

  it("INSTALL is the only type that forbids a unit at creation", () => {
    expect(equipmentAllowedAtCreate("INSTALL")).toBe(false);
    for (const type of ["SERVICE_CALL", "PM", "WARRANTY", "INSPECTION"]) {
      expect(equipmentAllowedAtCreate(type)).toBe(true);
    }
    // An untyped Work Order is valid and is not an INSTALL.
    expect(equipmentAllowedAtCreate(undefined)).toBe(true);
    expect(equipmentAllowedAtCreate("")).toBe(true);
  });
});

// ═════════════════════════════════════════ never a raw id

describe("the machine is chosen and shown by what it is", () => {
  it("the picker is a select of labelled options, not an id input", () => {
    expect(PICKER).toMatch(/<select/);
    expect(PICKER).not.toMatch(/type="text"/);
    expect(PICKER).toMatch(/equipmentDisplayName\(e\)/);
    expect(PICKER).toMatch(/equipmentSummary\(e\)/);
  });

  it("the label carries the disambiguating line, because duplicate names are legal", () => {
    // Proven on the real helpers, not on the fact that the picker mentions them.
    const unit = { name: "Front Machine", manufacturer: "Taylor", model: "C713", serialNumber: "SN-9", assetTag: "T-4" };
    expect(equipmentDisplayName(unit)).toBe("Front Machine");
    const summary = equipmentSummary(unit);
    expect(summary).toContain("Taylor C713");
    expect(summary).toContain("SN-9");
    // And the id is nowhere in it.
    expect(summary).not.toContain("eq-");
  });

  it("an unnamed unit still gets words, never a key", () => {
    expect(equipmentDisplayName({ id: "eq-123" })).toBe("Unnamed equipment");
    expect(equipmentDisplayName({ id: "eq-123" })).not.toContain("eq-123");
  });

  it("the detail page resolves the reference to a business label", () => {
    expect(DETAIL).toMatch(/fieldId === "equipmentId"/);
    expect(DETAIL).toMatch(/equipmentDisplayName\(equipment\)/);
    // NOT_FOUND rather than the stored id when the unit does not resolve.
    expect(DETAIL).toMatch(/REFERENCE_STATE\.NOT_FOUND/);
  });
});

// ═════════════════════════════════════════ scope is not validation

describe("the client filter never stands in for server validation", () => {
  it("the picker scopes to the customer, and says so is a convenience", () => {
    expect(PICKER).toMatch(/useEquipmentForAccount/);
    expect(PICKER).toMatch(/it is not evidence|IT IS NOT EVIDENCE/);
  });

  it("the wizard never sends a unit on an INSTALL", () => {
    // Switching type to INSTALL clears the selection, so a stale choice cannot survive into a
    // submit the server would refuse.
    expect(WIZARD).toMatch(/equipmentAllowedAtCreate\(type\) && equipmentId/);
    expect(WIZARD).toMatch(/if \(!equipmentAllowedAtCreate\(next\)\) setEquipmentId\(null\)/);
  });

  it("the client writes nothing directly", () => {
    for (const forbidden of ["updateDoc", "setDoc", "addDoc"]) {
      expect(WIZARD, `wizard must not ${forbidden}`).not.toMatch(new RegExp(`\\b${forbidden}\\s*\\(`));
      expect(PICKER, `picker must not ${forbidden}`).not.toMatch(new RegExp(`\\b${forbidden}\\s*\\(`));
    }
  });
});

// ═════════════════════════════════════════ metadata and the record page

describe("the reference is declared and surfaced", () => {
  it("equipmentId is a REFERENCE field pointing at equipment", () => {
    const field = workOrderEntity.fields.find((f) => f.id === "equipmentId");
    expect(field).toBeTruthy();
    expect(field.type).toBe("REFERENCE");
    expect(field.referenceTo).toBe("equipment");
  });

  it("it is NOT filterable — no composite serves that query", () => {
    // Offering the filter would put a control on screen that errors at read time.
    const field = workOrderEntity.fields.find((f) => f.id === "equipmentId");
    expect(field.filterable).not.toBe(true);
  });

  it("it appears in the record page SUMMARY, because it is a first-viewport question", () => {
    const summary = workOrderRecordPage.sections.find((s) => s.density === "SUMMARY");
    expect(summary.fieldIds).toContain("equipmentId");
    // Still five — a summary that grows is no longer a summary.
    expect(summary.fieldIds.length).toBeLessThanOrEqual(5);
  });

  it("WORK_ORDER_CARRIES_NO_EQUIPMENT_REFERENCE is closed, and recorded as closed", () => {
    expect(workOrderEntity.gaps.map((g) => g.id)).not.toContain("WORK_ORDER_CARRIES_NO_EQUIPMENT_REFERENCE");
    const def = read("src/metadata/definitions/workOrder.js");
    expect(def).toMatch(/CLOSED — WORK_ORDER_CARRIES_NO_EQUIPMENT_REFERENCE/);
  });
});
