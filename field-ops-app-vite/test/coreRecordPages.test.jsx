// CORE RECORD PAGES — EQUIPMENT / SALES ORDER / WORK ORDER.
//
// GOVERNANCE: Owner package "UX CORE RECORD PAGES", 2026-08-24.
//
// ============================ THE TWO FAILURES WORTH GUARDING ============================
//
// Same shape as the list manifest, one level up. A record page can go wrong in two directions and
// both are quiet:
//
//   1. IT SHOWS WHAT IT CANNOT HONESTLY SHOW — a document key where a business label belongs, a
//      blank where "no value" belongs, a partial sum where a total belongs.
//   2. IT OFFERS AN EDIT IT HAS NO AUTHORITY TO PERFORM — a pencil beside a field no command
//      writes, or beside one this particular viewer may not change.
//
// The second is the reason two of these three objects have NO pencils at all, and that is DERIVED
// rather than chosen: neither Sales Order nor Work Order has a field-patch command in the codebase.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  RECORD_PAGE_OBJECTS, RECORD_PAGE_STATUS, evaluateAllRecordPages, handWrittenGridCount,
} from "../src/metadata/recordPageManifest.js";
import {
  SECTION_DENSITY, COLLAPSED_BY_DENSITY, sectionStartsCollapsed, fieldEditability, pageSubset,
} from "../src/metadata/pageDefinition.js";
import { equipmentRecordPage } from "../src/metadata/definitions/equipmentPage.js";
import { salesOrderRecordPage, salesOrderRecordPageRailSubset } from "../src/metadata/definitions/salesOrderPage.js";
import { workOrderRecordPage } from "../src/metadata/definitions/workOrderPage.js";
import { accountRecordPage } from "../src/metadata/definitions/accountPage.js";
import { equipmentEntity } from "../src/metadata/definitions/equipment.js";
import { salesOrderEntity } from "../src/metadata/definitions/salesOrder.js";
import { workOrderEntity } from "../src/metadata/definitions/workOrder.js";
import { EDITABLE_EQUIPMENT_FIELDS, GOVERNED_EQUIPMENT_FIELDS } from "../src/domain/equipment.js";

const read = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");
const SHELL = read("src/metadata/MetadataRecordPage.jsx");
const SECTION = read("src/metadata/RecordSection.jsx");
const CSS = read("src/index.css");
const EQUIP = read("src/modules/equipment/EquipmentDetail.jsx");
const SO = read("src/modules/sales/SalesOrderDetail.jsx");
const WO = read("src/modules/workOrders/WorkOrderDetailPage.jsx");

const PAGES = [
  ["equipment", equipmentRecordPage, equipmentEntity],
  ["salesOrder", salesOrderRecordPage, salesOrderEntity],
  ["workOrder", workOrderRecordPage, workOrderEntity],
];

// ═════════════════════════════════════════ 1 · all three mount the shared shell

describe("every migrated object mounts the shared record shell", () => {
  const results = evaluateAllRecordPages(read);

  for (const objectId of ["account", "equipment", "salesOrder", "workOrder"]) {
    it(`${objectId} is MOUNTED`, () => {
      expect(results.find((r) => r.objectId === objectId).status).toBe(RECORD_PAGE_STATUS.MOUNTED);
    });
  }

  it("Part and Purchase Order are DEFERRED with a reason, not silently absent", () => {
    // "We chose not to" and "we forgot" must not look alike.
    for (const objectId of ["part", "purchaseOrder"]) {
      const r = results.find((x) => x.objectId === objectId);
      expect(r.status).toBe(RECORD_PAGE_STATUS.DEFERRED);
      expect(r.reason, `${objectId} must say why`).toBeTruthy();
    }
  });

  it("a screen that cannot be read never rounds up", () => {
    const r = evaluateAllRecordPages(() => { throw new Error("missing"); })
      .find((x) => x.objectId === "equipment");
    expect(r.status).toBe(RECORD_PAGE_STATUS.NONE);
  });

  it("the field grid lives ONLY in the shell, so the grammar cannot fork", () => {
    for (const [, file] of [["equipment", EQUIP], ["salesOrder", SO], ["workOrder", WO]]) {
      expect(file).not.toMatch(/fo-record-fields/);
    }
    expect(SHELL).toMatch(/fo-record-fields/);
  });

  it("a migrated screen keeps no more hand-written grids than it earned", () => {
    // EquipmentDetail keeps exactly ONE: the Customer & location panel distinguishes a FAILED read
    // from an unknown one and offers a Retry, which the generic grid has no slot for. Losing it
    // would turn "we could not look" back into "Unknown customer" stated as a fact.
    expect(handWrittenGridCount(EQUIP)).toBe(1);
    expect(handWrittenGridCount(SO)).toBe(0);
    expect(handWrittenGridCount(WO)).toBe(0);
  });
});

// ═════════════════════════════════════════ 2/3 · density and collapse

describe("density controls placement and collapse", () => {
  it("every section declares a density from the small vocabulary", () => {
    for (const [id, page] of PAGES) {
      for (const section of page.sections) {
        expect(SECTION_DENSITY, `${id}/${section.id}`).toContain(section.density);
      }
    }
  });

  it("each object declares exactly ONE summary section", () => {
    // If everything is summary, nothing is.
    for (const [id, page] of PAGES) {
      const summary = page.sections.filter((s) => s.density === "SUMMARY");
      expect(summary.length, `${id} must have at most one summary`).toBeLessThanOrEqual(1);
    }
    expect(equipmentRecordPage.sections.filter((s) => s.density === "SUMMARY")).toHaveLength(1);
  });

  it("a summary is SMALL — it answers four questions, it is not the record", () => {
    for (const [id, page] of PAGES) {
      const summary = page.sections.find((s) => s.density === "SUMMARY");
      if (!summary) continue;
      expect(summary.fieldIds.length, `${id} summary is too big to be a summary`).toBeLessThanOrEqual(5);
    }
  });

  it("SECONDARY and SYSTEM arrive collapsed; primary facts do not", () => {
    expect(COLLAPSED_BY_DENSITY).toEqual(["SECONDARY", "SYSTEM"]);
    const big = { totalFieldCount: 20 };
    expect(sectionStartsCollapsed({ density: "SECONDARY" }, big)).toBe(true);
    expect(sectionStartsCollapsed({ density: "SYSTEM" }, big)).toBe(true);
    expect(sectionStartsCollapsed({ density: "DETAILS" }, big)).toBe(false);
    expect(sectionStartsCollapsed({ density: "SUMMARY" }, big)).toBe(false);
  });

  it("a page with very little on it opens everything", () => {
    // Collapsing three fields hides most of a small record behind a click, to save space the page
    // does not need.
    expect(sectionStartsCollapsed({ density: "SYSTEM" }, { totalFieldCount: 5 })).toBe(false);
  });

  it("an explicit decision beats the rule of thumb, in both directions", () => {
    expect(sectionStartsCollapsed({ density: "SYSTEM", collapsedByDefault: false }, { totalFieldCount: 50 })).toBe(false);
    expect(sectionStartsCollapsed({ density: "DETAILS", collapsedByDefault: true }, { totalFieldCount: 50 })).toBe(true);
  });
});

describe("collapsed is not hidden", () => {
  it("the toggle is a real button with aria-expanded and aria-controls", () => {
    expect(SECTION).toMatch(/<button/);
    expect(SECTION).toMatch(/aria-expanded=\{open\}/);
    expect(SECTION).toMatch(/aria-controls=\{contentId\}/);
    // A button is operated by Enter AND Space for free; a div with onClick is not.
    expect(SECTION).not.toMatch(/<div[^>]*onClick[^>]*role="button"/);
  });

  it("the heading CONTAINS the control, so its accessible name is the section name", () => {
    // Otherwise a page of collapsible sections is a page of controls all called "Toggle".
    // Asserted by POSITION rather than a span regex: the explanatory comment between the heading
    // and the control is longer than any fixed window, and a window that happened to fit today
    // would fail the next time somebody explained something.
    const h3 = SECTION.indexOf('<h3 className="fo-record-section-title fo-record-section-title--toggle">');
    const button = SECTION.indexOf('className="fo-record-section__toggle"');
    const h3Close = SECTION.indexOf("</h3>");
    expect(h3).toBeGreaterThan(-1);
    expect(button).toBeGreaterThan(h3);
    expect(h3Close).toBeGreaterThan(button);
  });

  it("content is UNMOUNTED while closed, not visually hidden", () => {
    // A hidden-but-present subtree keeps its controls in the tab order, so Tab lands focus on
    // something invisible.
    expect(SECTION).toMatch(/\{open && <div id=\{contentId\}>/);
  });

  it("state is never carried by colour alone", () => {
    // The chevron turns AND aria-expanded changes.
    expect(SECTION).toMatch(/open \? ChevronDown : ChevronRight/);
  });
});

// ═════════════════════════════════════════ 4/5 · truthful nulls, resolved labels

describe("truthful rendering survives the migration", () => {
  it("a missing value is an em dash, marked absent", () => {
    // Re-anchored: the ternary became multi-line when a stored OBJECT gained its own branch — an
    // object is refused in words rather than stringified, after `Timestamp(seconds=…)` reached the
    // Equipment record. The em dash still means exactly what it meant, and that is the claim.
    expect(SHELL).toMatch(/\? "—"/);
    expect(SHELL).toMatch(/isMissing/);
  });

  it("references resolve through an injected resolver, never the stored id", () => {
    expect(SHELL).toMatch(/resolveReference \? \{ resolveReference \} : undefined/);
    for (const [name, file] of [["salesOrder", SO], ["workOrder", WO]]) {
      expect(file, `${name} must inject a resolver`).toMatch(/resolveReference=\{/);
    }
  });

  it("the Sales Order Owner is a person now, not an employee id", () => {
    // The summary band rendered `view.ownerEmployeeId ?? "—"` — a raw employee id where a name
    // belongs. This is the defect that resolver threading exists to close.
    expect(SO).not.toMatch(/value: view\.ownerEmployeeId/);
    expect(SO).toMatch(/useEmployeeDirectory/);
    expect(SO).toMatch(/REFERENCE_STATE\.NOT_FOUND/);
  });

  it("the Work Order technician resolves through the ONE technician vocabulary", () => {
    expect(WO).toMatch(/resolveTechnicianIdentity/);
    // `find(...)?.name ?? id` is exactly how a raw id reaches a screen.
    expect(WO).not.toMatch(/\?\?\s*(workOrder\.)?assignedTechId/);
  });
});

// ═════════════════════════════════════════ 6/7 · touch floor, no overflow

describe("touch and overflow", () => {
  it("no 32px edit target survives", () => {
    // It shipped at 32px, below the governed floor, and was the smallest control on the page.
    expect(CSS).toMatch(/\.fo-record-field__edit \{[\s\S]*?min-width: 44px;[\s\S]*?min-height: 44px;/);
    expect(CSS).not.toMatch(/\.fo-record-field__edit \{[\s\S]*?min-width: 32px/);
  });

  it("the section toggle meets the same floor and works at 320px", () => {
    expect(CSS).toMatch(/\.fo-record-section__toggle \{[\s\S]*?min-height: 44px;/);
    // Full width rather than shrinking to the label, so it stays tappable on the narrowest screen.
    expect(CSS).toMatch(/\.fo-record-section__toggle \{[\s\S]*?width: 100%;/);
  });

  it("the pencil is visible without hover on touch and narrow screens", () => {
    // A control revealed only on hover is unreachable where there is no hover.
    expect(CSS).toMatch(/@media \(hover: none\), \(max-width: 640px\) \{\s*\.fo-record-field__edit \{ opacity: 1/);
  });

  it("long values wrap instead of widening the grid", () => {
    expect(CSS).toMatch(/\.fo-record-field__value \{[\s\S]*?overflow-wrap: anywhere/);
    expect(CSS).toMatch(/\.fo-record-field \{ display: block; min-width: 0; \}/);
  });
});

// ═════════════════════════════════════════ 8/9/10/11 · Equipment

describe("Equipment", () => {
  it("the editable allowlist IS the write path's, not a copy of it", () => {
    // Imported from domain/equipment.js rather than restated, so it cannot drift.
    expect(equipmentRecordPage.editableFieldIds).toEqual([...EDITABLE_EQUIPMENT_FIELDS]);
    expect(equipmentRecordPage.writeCommand).toBe("domain/equipmentRepository.js#updateEquipment");
    expect(read("src/metadata/definitions/equipmentPage.js")).toMatch(/^import \{ EDITABLE_EQUIPMENT_FIELDS \}/m);
  });

  it("governed fields cannot enter ordinary edit mode", () => {
    // An ordinary edit asking to change one is REFUSED WHOLE — "a dropped move reported as success
    // is worse than a refused edit".
    for (const fieldId of GOVERNED_EQUIPMENT_FIELDS) {
      expect(fieldEditability(equipmentRecordPage, fieldId).editable, fieldId).toBe(false);
    }
    expect(fieldEditability(equipmentRecordPage, "updatedAt").editable).toBe(false);
  });

  it("status is NOT a pencil, because it can only move one direction pair", () => {
    // It IS writable here, ACTIVE<->INACTIVE only. A pencil promises the field can be changed, and
    // this one can be changed conditionally — a promise the grid cannot qualify. Rendering one that
    // sometimes refuses teaches people to distrust every pencil.
    expect(equipmentRecordPage.editableFieldIds).not.toContain("status");
    expect(fieldEditability(equipmentRecordPage, "status").editable).toBe(false);
  });

  it("move / retire / reactivate remain governed actions on the page", () => {
    for (const action of ["move", "retire", "reactivate"]) {
      expect(EQUIP, `${action} action disappeared`).toMatch(new RegExp(`data-equipment-action="${action}"`));
    }
  });

  it("a pencil opens the SAME modal the Edit action opens", () => {
    expect(EQUIP).toMatch(/const openEditFor = \(\) => setEditing\(true\)/);
    expect(EQUIP).toMatch(/onEditField=\{openEditFor\}/);
    expect(EQUIP).toMatch(/EquipmentEditModal/);
  });

  it("the account-scoped register is untouched and still reachable", () => {
    const register = read("src/modules/equipment/EquipmentRegister.jsx");
    expect(register).toMatch(/useEquipmentForAccount/);
    expect(register).not.toMatch(/^import .*MetadataRecordPage/m);
  });
});

// ═════════════════════════════════════════ 12/13/14/15 · Sales Order

describe("Sales Order", () => {
  it("has NO editable fields, and that is derived", () => {
    // There is no field-update command for a Sales Order at all: every write is a governed ACTION
    // with its own capability and state guard.
    expect(salesOrderRecordPage.editableFieldIds).toEqual([]);
    expect(salesOrderRecordPage.writeCommand).toBeNull();
  });

  it("Dollars comes from the authoritative projection", () => {
    expect(salesOrderEntity.fields.find((f) => f.id === "totalMinor").type).toBe("CURRENCY_MINOR");
    expect(SO).toMatch(/salesOrderDollars\(view\)/);
  });

  // THESE ASSERTIONS USED TO MATCH SOURCE TEXT, AND THAT IS EXACTLY HOW THE DEFECT SHIPPED.
  //
  // "does the screen reference view.totalMinor" passed while view.totalMinor was UNDEFINED on
  // every order in existence, because salesOrderView() never carried it through. A reference is
  // not an arrival. The behaviour now lives in test/salesOrderMoneyArrives.test.mjs, which feeds
  // the view model a projection-shaped input and asserts on the VALUE that comes out.
  it("the money behaviour is proved by value, not by source text", () => {
    const proof = read("test/salesOrderMoneyArrives.test.mjs");
    expect(proof).toMatch(/assert\.equal\(v\.totalMinor, 5000\)/);
    expect(proof).toMatch(/a partly-priced order must show no figure at all/);
    // And the view model really does carry it, which is the line that was missing.
    expect(read("src/domain/salesOrderView.js")).toMatch(/totalMinor: typeof so\.totalMinor === "number"/);
  });

  it("the operational actions are all still reachable", () => {
    expect(SO).toMatch(/SalesOrderActions/);
    expect(SO).toMatch(/SalesOrderFulfillmentSection/);
  });

  it("the field grid renders a SUBSET, so no fact the header states is printed twice", () => {
    // THE RULE IS UNCHANGED; THE MECHANISM MOVED. This asserted that the screen called
    // `pageSubset(salesOrderRecordPage, ...)` inline. The North Star composition names the same
    // narrowing once, as `salesOrderRecordPageRailSubset`, so the rule is now asserted against the
    // subset ITSELF rather than against the call that built it — the stronger check anyway: source
    // text proves a call was written, never that anything was actually excluded.
    expect(SO).toMatch(/salesOrderRecordPageRailSubset/);

    const railFields = salesOrderRecordPageRailSubset.sections.flatMap((sec) => sec.fieldIds ?? []);
    // Every fact the composed header already states must be ABSENT from the grid (NS-P4).
    for (const stated of ["accountId", "state", "totalMinor", "ownerEmployeeId", "salesChannel"]) {
      expect(railFields, `${stated} is stated in the record header and must not repeat in the grid`)
        .not.toContain(stated);
    }
    // And it must still carry what the header does NOT say, or the narrowing has become a deletion.
    expect(railFields.length).toBeGreaterThan(0);

    // Narrowing what is DISPLAYED must never widen what is WRITABLE.
    expect(pageSubset(salesOrderRecordPage, []).editableFieldIds).toEqual([]);
    expect(salesOrderRecordPageRailSubset.editableFieldIds ?? []).toEqual([]);
  });
});

// ═════════════════════════════════════════ 16..20 · Work Order

describe("Work Order", () => {
  it("status cannot be edited as a normal field", () => {
    // Status is the OUTPUT of a transition: transitionWorkOrder takes an ACTION NAME and the engine
    // decides legality. A dropdown patch would bypass every guard silently.
    expect(workOrderRecordPage.editableFieldIds).toEqual([]);
    expect(fieldEditability(workOrderRecordPage, "status").editable).toBe(false);
    expect(fieldEditability(workOrderRecordPage, "assignedTechId").editable).toBe(false);
  });

  it("lifecycle and execution still go through the existing commands", () => {
    const service = read("src/services/workOrderService.ts");
    for (const callable of ["transitionWorkOrder", "updateWorkOrderExecutionData", "setWorkOrderPartsPlan"]) {
      expect(service, `${callable} must remain the write path`).toMatch(new RegExp(callable));
    }
    expect(WO).toMatch(/WorkOrderPartsPlanEditor/);
    expect(WO).toMatch(/WorkOrderDetail/);
  });

  it("Back navigation still keys to Work Orders", () => {
    expect(WO).toMatch(/objectListPathWithState\(OBJECT_LIST_KEY\.WORK_ORDERS/);
  });

  it("the realtime dispatch subscription is untouched", () => {
    // The list migration deliberately left this alone; a record-page package has even less business
    // near it.
    expect(read("src/services/workOrderService.ts"))
      .toMatch(/onSnapshot\(collection\(db, WORK_ORDERS_COLLECTION\)/);
  });
});

// ═════════════════════════════════════════ 21..24 · architecture guards

describe("nothing was widened", () => {
  it("no page introduced a direct Firestore write", () => {
    for (const [name, file] of [["shell", SHELL], ["equipment", EQUIP], ["salesOrder", SO], ["workOrder", WO]]) {
      for (const forbidden of ["updateDoc", "setDoc", "addDoc", "deleteDoc", "writeBatch"]) {
        expect(file, `${name} must not ${forbidden}`).not.toMatch(new RegExp(`\\b${forbidden}\\s*\\(`));
      }
    }
  });

  it("no new index is required: these pages read records, not queries", () => {
    // A record page fetches one document by id. None of these screens builds a bounded query.
    for (const [name, file] of [["equipment", EQUIP], ["salesOrder", SO], ["workOrder", WO]]) {
      expect(file, `${name} must not build its own query`).not.toMatch(/\borderBy\s*\(/);
    }
  });

  it("Part was not migrated in this package", () => {
    const part = read("src/modules/inventory/PartDetail.jsx");
    expect(part).not.toMatch(/^import .*MetadataRecordPage/m);
    expect(RECORD_PAGE_OBJECTS.find((o) => o.objectId === "part").deferred).toBeTruthy();
  });

  it("Purchase Order was not touched", () => {
    expect(read("src/modules/purchasing/PurchaseOrders.jsx")).not.toMatch(/^import .*MetadataRecordPage/m);
    expect(read("src/domain/constants.js")).toMatch(/PURCHASE_ORDERS_COLLECTION = "reorder_purchase_orders"/);
  });

  it("Account keeps everything the previous package proved", () => {
    expect(accountRecordPage.writeCommand).toBe("domain/accounts.js#updateAccount");
    expect(accountRecordPage.editableFieldIds.length).toBeGreaterThan(0);
  });
});
