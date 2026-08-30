// FRAME 1a — the Parts collection derivations (ND-30, Owner 2026-08-30).
//
// Frame 1a is composed INSIDE `/inventory`, as the Parts Catalog panel of the existing role home.
// The Work group, the Flow group and the governed reorder queues stay where they are. What is
// proved here is the derivation layer that panel renders:
//
//   counts   labelled for what they actually count, and never total-minus-inactive
//   views    filters over rows already loaded — never a state machine, never a backend concept
//   rows     Part · Manufacturer · Category · Control · Status · Attention, and NO quantity
//   sort     honest over a fully-loaded list, with absent identifiers last
//
// vitest rather than node:test, and not by preference: `partsNorthStar.js` imports the readiness
// gate, which reads Vite's build-time `__APP_READINESS__` global. node:test cannot load it at all.
import { describe, it, expect } from "vitest";

import {
  partsAttentionByPartId,
  partsCollectionSummary,
  partsCollectionViews,
  applyPartsCollectionView,
  partsCollectionRow,
  sortPartsCollectionRows,
  PARTS_COLLECTION_VIEW,
  PARTS_COLLECTION_SORT,
} from "../src/domain/partsNorthStar.js";

// A composed catalogue row, as buildPartsCatalogRows produces it after the #1593 widening.
const ROW = (over = {}) => ({
  sku: "P-1",
  internalPartNumber: "CW-P-0001",
  name: "Condenser Fan Blade",
  description: "Condenser fan blade, 12in",
  category: "Refrigeration",
  status: "ACTIVE",
  controlType: "STANDARD",
  manufacturerId: null,
  ...over,
});

describe("counts say what they count", () => {
  it("active is not total-minus-inactive, because an absent status is not a negative one", () => {
    const rows = [
      ROW(),
      ROW({ sku: "P-2", status: "SUPERSEDED" }),
      // A static-only row has no canonical document, so it carries no status at all.
      ROW({ sku: "P-3", status: null, internalPartNumber: null }),
    ];
    const summary = partsCollectionSummary(rows, new Map());
    expect(summary.total).toBe(3);
    expect(summary.totalLabel).toBe("parts in the catalogue");
    expect(summary.active).toBe(1);
    expect(summary.statusUnknown).toBe(1);
    expect(summary.active).not.toBe(summary.total - 1);
  });

  it("the label is singular for one part", () => {
    expect(partsCollectionSummary([ROW()], new Map()).totalLabel).toBe("part in the catalogue");
  });
});

describe("attention is the governed projection's, not this module's", () => {
  it("ACTION_ITEM outranks NOTIFICATION for the one cell a row has", () => {
    const byPart = partsAttentionByPartId([
      { partId: "P-1", attentionType: "NOTIFICATION", sectionLabel: "Purchasing Started" },
      { partId: "P-1", attentionType: "ACTION_ITEM", sectionLabel: "Pending Review" },
      { partId: "P-2", attentionType: "NOTIFICATION", sectionLabel: "Purchasing Started" },
    ]);
    expect(byPart.get("P-1").label).toBe("Pending Review");
    expect(byPart.get("P-1").actionRequired).toBe(true);
    expect(byPart.get("P-2").actionRequired).toBe(false);
    // The words are the projection's own sectionLabel — no vocabulary is invented here.
    expect(byPart.get("P-2").label).toBe("Purchasing Started");
  });

  it("malformed items are dropped, never guessed at", () => {
    const byPart = partsAttentionByPartId([null, {}, { partId: 7 }, { partId: "P-9" }]);
    expect(byPart.has("P-9")).toBe(true);
    expect(byPart.get("P-9").label).toBeNull();
    expect(byPart.size).toBe(1);
  });
});

describe("a view is a filter, never a state", () => {
  const rows = [ROW(), ROW({ sku: "P-2", status: "SUPERSEDED" }), ROW({ sku: "P-3", controlType: "SERIALIZED" })];
  const attention = new Map([["P-2", { label: "Pending Review", actionRequired: true }]]);

  it("each view selects from rows already loaded", () => {
    expect(applyPartsCollectionView(rows, PARTS_COLLECTION_VIEW.ALL, attention)).toHaveLength(3);
    expect(applyPartsCollectionView(rows, PARTS_COLLECTION_VIEW.ACTIVE, attention)).toHaveLength(2);
    expect(applyPartsCollectionView(rows, PARTS_COLLECTION_VIEW.SERIALIZED, attention)).toHaveLength(1);
    expect(applyPartsCollectionView(rows, PARTS_COLLECTION_VIEW.NEEDS_ATTENTION, attention)).toHaveLength(1);
  });

  it("every chip's count equals what its own filter returns", () => {
    // A count that disagrees with its view is how a list lies about how much work there is.
    for (const v of partsCollectionViews(rows, attention)) {
      expect(v.count, v.key).toBe(applyPartsCollectionView(rows, v.key, attention).length);
    }
  });
});

describe("the row model", () => {
  it("carries no quantity field at all — ND-25", () => {
    const row = partsCollectionRow(ROW(), {});
    const keys = Object.keys(row).map((k) => k.toLowerCase());
    for (const banned of ["onhand", "available", "availablestock", "quantity", "qty", "warehouseqty"]) {
      expect(keys.includes(banned), `the Frame 1a row grew a ${banned} field`).toBe(false);
    }
  });

  it("renders words, never stored tokens", () => {
    const row = partsCollectionRow(ROW({ controlType: "SERIALIZED" }), {});
    expect(row.control).toBe("Serialized");
    expect(row.status).toBe("Active");
  });

  it("states an absent manufacturer rather than borrowing another field", () => {
    expect(partsCollectionRow(ROW(), {}).manufacturer).toBeNull();

    // An id with no catalogue name shows the id — honest — rather than a fabricated name.
    const unresolved = partsCollectionRow(ROW({ manufacturerId: "MFR-X" }), { manufacturerNames: new Map() });
    expect(unresolved.manufacturer).toBe("MFR-X");
    expect(unresolved.manufacturerResolved).toBe(false);

    const resolved = partsCollectionRow(ROW({ manufacturerId: "MFR-X" }), {
      manufacturerNames: new Map([["MFR-X", "Taylor Company"]]),
    });
    expect(resolved.manufacturer).toBe("Taylor Company");
    expect(resolved.manufacturerResolved).toBe(true);
  });

  it("ND-26: no Part Number is null, never the document key", () => {
    const row = partsCollectionRow(ROW({ internalPartNumber: null }), {});
    expect(row.partNumber).toBeNull();
    expect(row.sku).toBe("P-1");
    expect(row.partNumber).not.toBe(row.sku);
  });
});

describe("sorting", () => {
  it("puts rows with no Part Number last, and does not mutate the caller", () => {
    const rows = [
      ROW({ sku: "P-2", internalPartNumber: null }),
      ROW({ sku: "P-3", internalPartNumber: "CW-P-0003" }),
      ROW({ sku: "P-1", internalPartNumber: "CW-P-0001" }),
    ];
    const snapshot = rows.map((r) => r.sku);
    const sorted = sortPartsCollectionRows(rows, PARTS_COLLECTION_SORT.PART_NUMBER);
    expect(sorted.map((r) => r.sku)).toEqual(["P-1", "P-3", "P-2"]);
    // An absent identifier is not a small one: floating the least-identified rows to the top of a
    // list people scan is the opposite of useful.
    expect(sorted[sorted.length - 1].internalPartNumber).toBeNull();
    expect(rows.map((r) => r.sku)).toEqual(snapshot);
  });
});
