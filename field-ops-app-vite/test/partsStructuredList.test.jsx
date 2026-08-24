// PARTS / PART MASTER — the structured list, and the two ways it could quietly lie.
//
// The highest-volume object in EOS, so this suite is weighted toward the failures that only appear at
// scale and the ones that are invisible on screen:
//
//   1. A read that LOOKS paged but is not, or is paged where paging produces wrong answers.
//   2. A criterion that looks applied and is not, so a person concludes the catalogue is smaller.
//   3. A tracking vocabulary borrowed from the ledger, so two screens disagree about how a part is
//      counted.
//
// The list SCREEN is covered by test/partMasterStructuredListScreen.test.jsx -- separate file because
// this one remocks Firestore per case, and doing that in the same file as eight React renders
// accumulates eight module graphs and exhausts the heap.
//
// The service is exercised against a recording fake Firestore rather than a stub returning rows: what
// matters is the CONSTRAINTS it sends, and a stub that ignores them would pass every assertion here
// while shipping a full-collection scan.
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  PART_FIELDS, PART_FIELD_GAPS, PART_STATUS_ORDER, PART_STATUS_LABEL, CONTROL_TYPE_LABEL,
  STOCKING_CLASS_LABEL, ITEM_TYPE_LABEL, PART_DEFAULT_SORT, PART_STORED_NOT_PROJECTED,
} from "../src/domain/partFields.js";
import {
  visibleFields, filterableFields, sortableFields, sortOptionsFor, OPERATOR, FIELD_TYPE,
  UNSUPPORTED_REASON,
} from "../src/domain/fieldMetadata.js";
import {
  emptyListState, makeFilter, addFilter, setSort, toQueryPlan, toSearchParams, fromSearchParams,
  describeFilter,
} from "../src/domain/listQueryState.js";

// ═════════════════════════════════════════ A — the field contract

describe("Part field contract", () => {
  const byId = new Map(PART_FIELDS.map((f) => [f.id, f]));

  it("the business identity is the part number, and the document id is not a field at all", () => {
    expect(byId.get("internalPartNumber").type).toBe(FIELD_TYPE.IDENTIFIER);
    expect(byId.get("internalPartNumber").filterable).toBe(true);
    expect(PART_FIELDS.some((f) => f.id === "partId")).toBe(false);
  });

  it("default columns are the five a person reads to identify and classify a part", () => {
    // `visibleFields` is everything DISPLAYABLE; the default COLUMNS are the subset opted in. The
    // distinction is what keeps the per-row balance callables (displayable, not default) off the list.
    expect(visibleFields(PART_FIELDS).filter((f) => f.defaultVisible).map((f) => f.label)).toEqual([
      "Part Number", "Description", "Status", "Tracking", "Stocking Class",
    ]);
  });

  it("Status sorts by its LIFECYCLE, not alphabetically", () => {
    expect(PART_STATUS_ORDER).toEqual(["DRAFT", "ACTIVE", "INACTIVE", "SUPERSEDED", "DISCONTINUED"]);
    expect(byId.get("status").statusOrder).toEqual(PART_STATUS_ORDER);
    // Alphabetical would open with DISCONTINUED, which is the least interesting state there is.
    expect([...PART_STATUS_ORDER].sort()).not.toEqual(PART_STATUS_ORDER);
  });

  it("Tracking and Stocking Class are CLASSIFICATIONS: filterable, never sortable", () => {
    for (const id of ["controlType", "stockingClass", "stockingUnit"]) {
      expect(byId.get(id).filterable, id).toBe(true);
      expect(byId.get(id).sortable, id).toBe(false);
      expect(byId.get(id).unsupportedSortReason, id).toBe(UNSUPPORTED_REASON.NO_CANONICAL_ORDER);
    }
  });

  it("every unsupported field STATES A REASON — the honesty rule, with no exemptions", () => {
    for (const f of PART_FIELDS) {
      if (!f.filterable) expect(f.unsupportedFilterReason, `${f.id} filter`).toBeTruthy();
      if (!f.sortable) expect(f.unsupportedSortReason, `${f.id} sort`).toBeTruthy();
    }
  });

  it("stored-but-unprojected is marked NOT_PROJECTED, which is not the same claim as NO_AUTHORITY", () => {
    // The value EXISTS on the document. The fix is a projection change, not a domain decision, and
    // conflating the two would make a solvable problem look like a blocked one.
    for (const id of ["wholeUnit", "manufacturerPartNumber", "manufacturer.name", "equipmentModel.name"]) {
      expect(byId.get(id).unsupportedFilterReason, id).toBe(UNSUPPORTED_REASON.NOT_PROJECTED);
    }
    expect(PART_STORED_NOT_PROJECTED).toContain("wholeUnit");
    expect(PART_STORED_NOT_PROJECTED).toContain("equipmentModelId");
  });

  it("the default order is the EXISTING operational one, tie-broken so it cannot shuffle", () => {
    expect(PART_DEFAULT_SORT.fieldId).toBe("internalPartNumber");
    expect(PART_DEFAULT_SORT.direction).toBe("asc");
    expect(PART_DEFAULT_SORT.tieBreak).toBe("partId");
    expect(PART_DEFAULT_SORT.why).toMatch(/existing operational order/i);
  });
});

// ═════════════════════════════════════════ B — what was refused

describe("what the Part cannot prove, it does not show", () => {
  const byId = new Map(PART_FIELDS.map((f) => [f.id, f]));
  const gapNames = PART_FIELD_GAPS.map((g) => g.gap);

  it("money is BLOCKED end to end: no Dollars column arrives because PO and SO lists have one", () => {
    for (const id of ["unitCost", "sellPrice"]) {
      const f = byId.get(id);
      expect(f.displayable, id).toBe(false);
      // The export is the back door a blocked column ships through. It is shut too.
      expect(f.reportable, id).toBe(false);
      expect(f.exportable, id).toBe(false);
      expect(f.unsupportedFilterReason, id).toBe(UNSUPPORTED_REASON.NO_AUTHORITY);
    }
    expect(gapNames).toContain("PART INVENTORY VALUATION AUTHORITY GAP");
  });

  it("business line, truck stock, company-owned and preferred supplier are all blocked, not guessed", () => {
    for (const id of ["businessLine", "mobileQuantity", "companyOwned", "preferredSupplier.name"]) {
      expect(byId.get(id).displayable, id).toBe(false);
      expect(byId.get(id).exportable, id).toBe(false);
    }
    expect(gapNames).toContain("PART BUSINESS LINE NOT AUTHORITATIVE");
    expect(gapNames).toContain("PART SUPPLIER IS MANY-TO-MANY");
  });

  it("FALSE_COMFORT: warehouse availability is NAMED as warehouse-only, never as 'Stock'", () => {
    const f = byId.get("warehouseAvailable");
    expect(f.label).toBe("Warehouse Available");
    expect(f.source).toMatch(/EXCLUDES truck stock/);
    // A single ambiguous "Stock" heading is the failure: a picker reading "Stock: 8" cannot tell
    // whether the vans are counted.
    expect(PART_FIELDS.some((x) => x.label === "Stock")).toBe(false);
  });

  it("balance columns are off by default rather than issuing a callable per row", () => {
    for (const id of ["warehouseAvailable", "onOrder", "reorderPoint"]) {
      expect(byId.get(id).defaultVisible ?? false, id).toBe(false);
    }
    const gap = PART_FIELD_GAPS.find((g) => g.gap === "PART LIST BALANCE N+1 GAP");
    expect(gap.refused).toMatch(/hiding the cost behind a spinner/i);
  });

  it("the reorder point is derived at read, so it is displayable but never queryable", () => {
    const f = byId.get("reorderPoint");
    expect(f.unsupportedFilterReason).toBe(UNSUPPORTED_REASON.DERIVED_AT_READ);
    expect(f.unsupportedSortReason).toBe(UNSUPPORTED_REASON.DERIVED_AT_READ);
  });

  it("description search declares NEEDS_INDEX rather than fetching everything and .includes()-ing it", () => {
    expect(byId.get("name").unsupportedFilterReason).toBe(UNSUPPORTED_REASON.NEEDS_INDEX);
    const gap = PART_FIELD_GAPS.find((g) => g.gap === "PART DESCRIPTION SEARCH INDEX GAP");
    expect(gap.refused).toMatch(/includes\(\)/);
    // Identifiers stay searchable — that is what makes identifier-first search an answer and not an
    // excuse.
    expect(byId.get("internalPartNumber").searchable).toBe(true);
    expect(byId.get("manufacturerPartNumber").searchable).toBe(true);
  });
});

// ═════════════════════════════════════════ C — the two tracking vocabularies

describe("Part Master tracking is NOT the ledger's trackingMode", () => {
  it("the labels are Part Master's own, and STANDARD reads as 'Quantity'", () => {
    expect(CONTROL_TYPE_LABEL.STANDARD).toBe("Quantity");
    expect(CONTROL_TYPE_LABEL.SERIALIZED_LOT).toBe("Serialized + Lot");
    expect(Object.keys(CONTROL_TYPE_LABEL)).toEqual(["STANDARD", "SERIALIZED", "LOT", "SERIALIZED_LOT"]);
  });

  it("the field names its own source and refuses the ledger's word", () => {
    const f = PART_FIELDS.find((x) => x.id === "controlType");
    expect(f.source).toMatch(/not the ledger's trackingMode/i);
    expect(PART_FIELDS.some((x) => x.id === "trackingMode")).toBe(false);
  });

  it("Item Type displays the wholeUnit BOOLEAN and introduces no new stored enum", () => {
    expect(ITEM_TYPE_LABEL.true).toBe("Whole Unit");
    expect(ITEM_TYPE_LABEL.false).toBe("Part");
    expect(PART_FIELDS.find((x) => x.id === "wholeUnit").type).toBe(FIELD_TYPE.BOOLEAN);
  });
});

// ═════════════════════════════════════════ D — the query plan and the read

describe("the query plan", () => {
  it("a page size is ALWAYS applied, even with no criteria at all", () => {
    expect(toQueryPlan(emptyListState, PART_FIELDS, { pageSize: 50 }).pageSize).toBe(50);
  });

  it("filters the metadata allows become SERVER work; the rest are reported, not dropped", () => {
    let state = emptyListState;
    state = addFilter(state, makeFilter({ fieldId: "status", operator: OPERATOR.IS, value: "ACTIVE" }));
    state = addFilter(state, makeFilter({ fieldId: "name", operator: OPERATOR.CONTAINS, value: "valve" }));
    const plan = toQueryPlan(state, PART_FIELDS);

    expect(plan.server.map((e) => e.field.id)).toEqual(["status"]);
    expect(plan.unsupported.map((u) => u.field.id)).toEqual(["name"]);
    expect(plan.unsupported[0].reason).toBe(UNSUPPORTED_REASON.NEEDS_INDEX);
    // `executable: false` is what makes the screen say so instead of silently narrowing nothing.
    expect(plan.executable).toBe(false);
  });

  it("sorting by a classification is refused at the plan, not silently reordered in the browser", () => {
    const plan = toQueryPlan(setSort(emptyListState, "stockingClass", "asc"), PART_FIELDS);
    expect(plan.sort).toBeNull();
    expect(plan.unsupported[0].reason).toBe(UNSUPPORTED_REASON.NO_CANONICAL_ORDER);
  });

  it("a three-criteria narrowing survives a URL round trip", () => {
    let state = emptyListState;
    state = addFilter(state, makeFilter({ fieldId: "status", operator: OPERATOR.IS, value: "ACTIVE", valueLabel: "Active" }));
    state = addFilter(state, makeFilter({ fieldId: "controlType", operator: OPERATOR.IS, value: "SERIALIZED", valueLabel: "Serialized" }));
    state = addFilter(state, makeFilter({ fieldId: "category", operator: OPERATOR.STARTS_WITH, value: "Valve" }));
    state = setSort(state, "internalPartNumber", "asc");

    const round = fromSearchParams(toSearchParams(state).toString(), PART_FIELDS);
    expect(round.filters).toHaveLength(3);
    expect(round.sort).toEqual({ fieldId: "internalPartNumber", direction: "asc" });
    expect(toQueryPlan(round, PART_FIELDS).server).toHaveLength(3);
  });

  it("changing the criteria resets the cursor — page 2 of an old query is not page 2 of a new one", () => {
    const paged = { ...emptyListState, cursor: ["PRT-1050", "p50"] };
    expect(addFilter(paged, makeFilter({ fieldId: "status", operator: OPERATOR.IS, value: "ACTIVE" })).cursor).toBeNull();
    expect(setSort(paged, "internalPartNumber", "desc").cursor).toBeNull();
  });

  it("sort options speak the field's own vocabulary, and only sortable fields offer any", () => {
    expect(sortableFields(PART_FIELDS).map((f) => f.id)).toEqual(["internalPartNumber", "name", "status"]);
    expect(sortOptionsFor(PART_FIELDS.find((f) => f.id === "status")).length).toBeGreaterThan(0);
    expect(filterableFields(PART_FIELDS).map((f) => f.id)).toEqual([
      "internalPartNumber", "status", "controlType", "stockingClass", "stockingUnit", "category",
    ]);
  });
});

// ═════════════════════════════════════════ E — the read actually sent

describe("fetchPartMasterPage sends a BOUNDED query", () => {
  let calls;

  beforeEach(() => {
    vi.resetModules();
    calls = [];
    // A recording fake, so the assertions are about the CONSTRAINTS. A stub that returned rows and
    // ignored its query would pass a row-shape test while shipping a full-collection scan.
    vi.doMock("firebase/firestore", () => ({
      collection: (_db, name) => ({ __collection: name }),
      query: (coll, ...cs) => ({ coll, cs }),
      where: (f, op, v) => ({ kind: "where", f, op, v }),
      orderBy: (f, dir) => ({ kind: "orderBy", f, dir }),
      limit: (n) => ({ kind: "limit", n }),
      startAfter: (...v) => ({ kind: "startAfter", v }),
      getDocs: async (q) => {
        calls.push(q);
        return { docs: [] };
      },
    }));
    vi.doMock("../src/firebase/firebase", () => ({ db: {} }));
  });

  const kinds = (q, kind) => q.cs.filter((c) => c.kind === kind);

  it("always orders, always limits, and always tie-breaks on partId", async () => {
    const { fetchPartMasterPage, PARTS_PAGE_SIZE } = await import("../src/services/partMasterQueries.js");
    await fetchPartMasterPage();
    const q = calls[0];
    expect(kinds(q, "orderBy").map((c) => [c.f, c.dir])).toEqual([["internalPartNumber", "asc"], ["partId", "asc"]]);
    // pageSize + 1: "is there another page" is ANSWERED by the read, not guessed from a full page.
    expect(kinds(q, "limit")[0].n).toBe(PARTS_PAGE_SIZE + 1);
  });

  it("server-executable filters go to Firestore as where() clauses", async () => {
    const { fetchPartMasterPage } = await import("../src/services/partMasterQueries.js");
    let state = addFilter(emptyListState, makeFilter({ fieldId: "status", operator: OPERATOR.IS, value: "ACTIVE" }));
    await fetchPartMasterPage({ plan: toQueryPlan(state, PART_FIELDS) });
    expect(kinds(calls[0], "where")).toEqual([{ kind: "where", f: "status", op: "==", v: "ACTIVE" }]);
  });

  it("STARTS_WITH becomes a prefix RANGE, which Firestore can do — not a substring search", async () => {
    const { fetchPartMasterPage } = await import("../src/services/partMasterQueries.js");
    const state = addFilter(emptyListState, makeFilter({ fieldId: "category", operator: OPERATOR.STARTS_WITH, value: "Valve" }));
    await fetchPartMasterPage({ plan: toQueryPlan(state, PART_FIELDS) });
    expect(kinds(calls[0], "where")).toEqual([
      { kind: "where", f: "category", op: ">=", v: "Valve" },
      { kind: "where", f: "category", op: "<", v: "Valvf" },
    ]);
  });

  it("hasMore comes from the extra document, and the cursor is the ordered values of the last row", async () => {
    vi.resetModules();
    const rows = Array.from({ length: 51 }, (_, i) => ({
      id: `p${i}`,
      data: () => ({ partId: `p${i}`, internalPartNumber: `PRT-${1000 + i}`, name: `Part ${i}`, status: "ACTIVE", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" }),
      get: (f) => ({ partId: `p${i}`, internalPartNumber: `PRT-${1000 + i}` }[f]),
    }));
    vi.doMock("firebase/firestore", () => ({
      collection: () => ({}), query: (_c, ...cs) => ({ cs }), where: () => ({}),
      orderBy: () => ({}), limit: () => ({}), startAfter: () => ({}),
      getDocs: async () => ({ docs: rows }),
    }));
    vi.doMock("../src/firebase/firebase", () => ({ db: {} }));
    const { fetchPartMasterPage } = await import("../src/services/partMasterQueries.js");

    const res = await fetchPartMasterPage();
    expect(res.ok).toBe(true);
    // 51 read, 50 shown: the extra document is the answer to "is there more", never a visible row.
    expect(res.parts).toHaveLength(50);
    expect(res.hasMore).toBe(true);
    expect(res.nextCursor).toEqual(["PRT-1049", "p49"]);
  });

  it("a denied read reports denial, never an empty catalogue", async () => {
    vi.resetModules();
    vi.doMock("firebase/firestore", () => ({
      collection: () => ({}), query: () => ({}), where: () => ({}), orderBy: () => ({}),
      limit: () => ({}), startAfter: () => ({}),
      getDocs: async () => { const e = new Error("nope"); e.code = "permission-denied"; throw e; },
    }));
    vi.doMock("../src/firebase/firebase", () => ({ db: {} }));
    const { fetchPartMasterPage } = await import("../src/services/partMasterQueries.js");
    expect(await fetchPartMasterPage()).toEqual({ ok: false, code: "permission-denied" });
  });

  it("the CATALOGUE read stays whole, and names every surface that depends on it", async () => {
    const mod = await import("../src/services/partMasterQueries.js");
    // Paging is opted INTO. The shared reader takes no plan, no cursor and no page size, because
    // seven consumers need every part and a silent first page gives them WRONG answers.
    expect(mod.fetchPartMasterList.length).toBe(0);
    expect(mod.PART_CATALOGUE_WHOLE_COLLECTION_READ).toContain("modules/scan/LookupScan");
    expect(mod.PART_CATALOGUE_WHOLE_COLLECTION_READ).toContain("hooks/useCanonicalPartNames");
    expect(mod.PART_CATALOGUE_WHOLE_COLLECTION_READ.length).toBe(7);
  });
});

// ═════════════════════════════════════════ F — a stale link degrades LOUDLY

describe("a URL asking for something this build cannot do", () => {
  it("drops the criterion, keeps the list usable, and REPORTS what it dropped", () => {
    // Degrading safely and degrading quietly are different things. Somebody following this link would
    // otherwise read the whole catalogue as the filtered subset -- the narrowing they asked for
    // silently became no narrowing at all.
    const state = fromSearchParams("f=name:CONTAINS:valve&f=status:IS:ACTIVE", PART_FIELDS);
    expect(state.filters.map((f) => f.fieldId)).toEqual(["status"]);
    expect(state.dropped).toHaveLength(1);
    expect(state.dropped[0].label).toBe("Description");
    expect(state.dropped[0].reason).toBe(UNSUPPORTED_REASON.NEEDS_INDEX);
  });

  it("reports an unsortable sort the same way, rather than falling back in silence", () => {
    const state = fromSearchParams("sort=stockingClass:asc", PART_FIELDS);
    expect(state.sort).toBeNull();
    expect(state.dropped[0]).toMatchObject({ kind: "sort", label: "Stocking Class" });
    expect(state.dropped[0].reason).toBe(UNSUPPORTED_REASON.NO_CANONICAL_ORDER);
  });

  it("a field this build no longer has is UNKNOWN_FIELD, not a crash", () => {
    const state = fromSearchParams("f=unitCost:GREATER_THAN:100&f=retiredField:IS:x", PART_FIELDS);
    expect(state.filters).toHaveLength(0);
    expect(state.dropped.map((d) => d.reason)).toEqual([UNSUPPORTED_REASON.NO_AUTHORITY, "UNKNOWN_FIELD"]);
  });

  it("a clean URL drops nothing — the report is not noise on the normal path", () => {
    expect(fromSearchParams("f=status:IS:ACTIVE&sort=internalPartNumber:asc", PART_FIELDS).dropped).toEqual([]);
  });

  it("the chip re-resolves its label, so a shared link never shows a storage token", () => {
    const state = fromSearchParams("f=status:IS:ACTIVE", PART_FIELDS);
    const options = { status: Object.entries(PART_STATUS_LABEL).map(([value, label]) => ({ value, label })) };
    // A URL carries no valueLabel, so without the picker options this reads "Status: ACTIVE".
    expect(describeFilter(state.filters[0], PART_FIELDS)).toBe("Status: ACTIVE");
    expect(describeFilter(state.filters[0], PART_FIELDS, options)).toBe("Status: Active");
  });
});
