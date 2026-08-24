// THE SHARED LIST VIEW HEADER — one formatting, every object.
//
// GOVERNANCE: Owner direction, 2026-08-24 — "this should be every object formatting", "the
// processes dont change just the way we view information".
//
// ============================ WHAT THIS CLOSES ============================
//
// The metadata layer declares saved views on every object — "Open work", "Active customers",
// "Active parts", "Open orders" — and no screen ever mounted one. It knows precisely what a list
// is filtered by and sorted by, and said none of it out loud: a person looking at a narrowed list
// could not tell, from the list, that it was narrowed, or by what.
//
// So the answer to "whatever happened to the metadata we created" was: it was there, and unmounted.
// These tests hold it mounted, on EVERY migrated object rather than on the one it was built for.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { summarizeListView, describeSort, describeFilteredBy, selectableSavedViews } from "../src/metadata/listViewSummary.js";
import { workOrderEntity, workOrderIndexList } from "../src/metadata/definitions/workOrder.js";
import { accountEntity, accountIndexList } from "../src/metadata/definitions/account.js";
import { partEntity, partIndexList } from "../src/metadata/definitions/part.js";
import { equipmentEntity, equipmentIndexList } from "../src/metadata/definitions/equipment.js";
import { salesOrderEntity, salesOrderIndexList } from "../src/metadata/definitions/salesOrder.js";

const read = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");

const SCREENS = {
  workOrder: "src/modules/workOrders/WorkOrdersList.jsx",
  account: "src/modules/accounts/AccountsList.jsx",
  equipment: "src/modules/equipment/CustomerEquipment.jsx",
  part: "src/modules/inventory/PartMasterList.jsx",
  salesOrder: "src/modules/sales/SalesOrdersList.jsx",
};

const PAIRS = [
  ["workOrder", workOrderEntity, workOrderIndexList],
  ["account", accountEntity, accountIndexList],
  ["equipment", equipmentEntity, equipmentIndexList],
  ["part", partEntity, partIndexList],
  ["salesOrder", salesOrderEntity, salesOrderIndexList],
];

// ═════════════════════════════════════════ every object, not one

describe("every migrated list renders the same header", () => {
  for (const [id] of PAIRS) {
    it(`${id} mounts ListViewHeader and the shared chrome hook`, () => {
      const src = read(SCREENS[id]);
      expect(src).toMatch(/^import ListViewHeader/m);
      expect(src).toMatch(/^import \{ useListViewChrome \}/m);
      expect(src).toMatch(/<ListViewHeader/);
      // The header must be fed the SAME criteria the list queries with. A header describing
      // different criteria than the table below it is worse than no header.
      expect(src).toMatch(/criteria=\{criteria\}/);
    });
  }

  it("there is exactly ONE header component, not one per screen", () => {
    // The moment this is copied into a second file the two begin to disagree about what an
    // "item" counts.
    const offenders = Object.values(SCREENS).filter((f) => /fo-listview-header/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

// ═════════════════════════════════════════ the saved views that were never mounted

describe("saved views come from the metadata", () => {
  for (const [id, , def] of PAIRS) {
    it(`${id} declares at least one selectable view`, () => {
      expect(selectableSavedViews(def).length).toBeGreaterThan(0);
    });
  }

  it("RECENTLY_VIEWED is excluded, because nothing keeps that history", () => {
    // Offering it would put a control in the menu that silently behaves like "everything". A
    // control that lies is worse than one that is absent.
    const withRecent = { savedViews: [{ id: "recent", kind: "RECENTLY_VIEWED" }, { id: "open", kind: "STATIC" }] };
    expect(selectableSavedViews(withRecent).map((v) => v.id)).toEqual(["open"]);
  });
});

// ═════════════════════════════════════════ what the line says

describe("the summary line", () => {
  it("names the count, the sort and the filtered fields", () => {
    const line = summarizeListView({
      entity: workOrderEntity,
      criteria: { filters: [{ fieldId: "status" }], sort: [] },
      defaultSort: workOrderIndexList.defaultSort,
      total: 31,
    });
    expect(line).toBe("31 items · Sorted by Created (newest first) · Filtered by Status");
  });

  it("says ONE item, not 1 items", () => {
    expect(summarizeListView({ entity: workOrderEntity, criteria: {}, total: 1 })).toMatch(/^1 item\b/);
  });

  it("A COUNT OF NULL RENDERS NOTHING, never zero", () => {
    // "0 items" is a statement about the business; silence is a statement about the read, and a
    // denied or offline count must never be reported as an empty business.
    const line = summarizeListView({ entity: workOrderEntity, criteria: {}, total: null });
    expect(line ?? "").not.toMatch(/item/);
  });

  it("describes direction in the field's own terms", () => {
    // "Descending" is accurate and tells a reader nothing.
    expect(describeSort(workOrderEntity, [{ fieldId: "createdAt", direction: "DESC" }])).toMatch(/newest first/);
    expect(describeSort(workOrderEntity, [{ fieldId: "scheduledStart", direction: "ASC" }])).toMatch(/oldest first/);
    expect(describeSort(salesOrderEntity, [{ fieldId: "salesOrderNumber", direction: "DESC" }])).toMatch(/Z to A/);
    // An ENUM orders by its STORED value: it groups, and it is not the lifecycle order the
    // labels imply. Neither "A to Z" nor "first to last" would be true.
    expect(describeSort(workOrderEntity, [{ fieldId: "status", direction: "ASC" }])).toMatch(/grouped/);
  });

  it("names filtered FIELDS, and never drops one it cannot name", () => {
    expect(describeFilteredBy(workOrderEntity, [{ fieldId: "status" }, { fieldId: "customerId" }]))
      .toBe("Status, Customer");
    // A filter that is IN EFFECT must never be missing from the summary of what is in effect,
    // even when this build no longer declares the field.
    expect(describeFilteredBy(workOrderEntity, [{ fieldId: "ghostField" }])).toBe("ghostField");
    expect(describeFilteredBy(workOrderEntity, [])).toBeNull();
  });

  it("does not repeat the same field twice", () => {
    expect(describeFilteredBy(workOrderEntity, [
      { fieldId: "status", operator: "EQUALS" },
      { fieldId: "status", operator: "IN" },
    ])).toBe("Status");
  });
});
