// WORK ORDERS ON THE BOUNDED LIST RUNTIME — and the realtime board it must not have taken with it.
//
// GOVERNANCE: docs/releases/ux-sandbox-release.md, "UX core object migrations".
//
// The risk in this migration was never the list. It was that `subscribeToWorkOrders` — an unfiltered
// onSnapshot over the whole collection — is read by five REALTIME surfaces (Dispatch, the Dispatcher
// Board, Control Tower, Job Assignments, Scheduling), and the cheapest way to page the list would
// have been to page that subscription. A dispatch board that updates a page at a time is a board
// that sends the wrong technician.
//
// So these tests hold two lines at once: the list is bounded, and the board is untouched.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { workOrderEntity, workOrderIndexList } from "../src/metadata/definitions/workOrder.js";
import {
  WORK_ORDER_STATUS_GROUPS,
  WORK_ORDER_STATUS_GROUP_VALUES,
  activeStatusGroupKey,
  statusGroupCoverage,
} from "../src/domain/workOrderStatusGroups.js";
import {
  workOrderSearchQueryShape,
  interpretWorkOrderSearchRead,
  normalizeWorkOrderTerm,
  WORK_ORDER_SEARCH_CAP,
} from "../src/domain/workOrderSearch.js";
import { workOrderTypeLabel, WORK_ORDER_TYPE_VALUES } from "../src/domain/workOrderType.js";
import { buildQueryDescriptor } from "../src/metadata/listRuntime.js";

const read = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");
const SCREEN = read("src/modules/workOrders/WorkOrdersList.jsx");
const SERVICE = read("src/services/workOrderService.ts");

// ═════════════════════════════════════════ realtime dispatch is untouched

describe("the realtime dispatch subscription survives the migration", () => {
  it("subscribeToWorkOrders is still an unfiltered collection listener", () => {
    // Deliberately asserted on the SOURCE. A test that mocked the service would pass while the
    // real one had been quietly bounded, which is the exact substitution this package forbids.
    expect(SERVICE).toMatch(/onSnapshot\(collection\(db, WORK_ORDERS_COLLECTION\)/);
  });

  it("the five realtime consumers still read useWorkOrders", () => {
    for (const file of [
      "src/modules/dispatch/Dispatch.jsx",
      "src/modules/dispatcherBoard/DispatcherBoard.jsx",
      "src/modules/controlTower/ControlTower.jsx",
      "src/modules/jobs/Jobs.jsx",
      "src/hooks/useSchedulingData.js",
    ]) {
      expect(read(file), file).toMatch(/useWorkOrders/);
    }
  });

  it("the LIST no longer holds the whole-collection subscription", () => {
    // Asserted on the IMPORT, not on any occurrence of the name: this screen's header explains at
    // length why useWorkOrders still exists elsewhere, and a bare text search matches the
    // explanation rather than the code. That is the measurement bug this package exists to stop.
    expect(SCREEN).not.toMatch(/^import .*useWorkOrders/m);
    expect(SCREEN).toMatch(/^import .*useMetadataList/m);
  });
});

// ═════════════════════════════════════════ the list is bounded and index-honest

describe("the list query is bounded and served by declared indexes", () => {
  it("every declared filter has a composite that serves it with the default sort", () => {
    // fieldops_wos declares (status, createdAt DESC) and (customerId, createdAt DESC). Those two
    // are exactly what the two declared filters need alongside the default sort.
    expect(workOrderIndexList.filters.map((f) => f.fieldId).sort()).toEqual(["customerId", "status"]);
    expect(workOrderIndexList.defaultSort[0].fieldId).toBe("createdAt");
  });

  it("a status-group query is a bounded descriptor with a limit and no offset", () => {
    const group = WORK_ORDER_STATUS_GROUPS.find((g) => g.key === "OPEN");
    const d = buildQueryDescriptor(workOrderIndexList, workOrderEntity, {
      filters: [{ fieldId: "status", operator: "IN", value: [...group.statuses] }],
    });
    // buildQueryDescriptor returns { descriptor, errors } -- the bound lives on the descriptor.
    expect(d.errors).toEqual([]);
    expect(d.descriptor.limit).toBeGreaterThan(0);
    // Cursor-paged, never offset-paged: an offset re-reads and re-bills every skipped row.
    expect(d.descriptor).not.toHaveProperty("offset");
    expect(d.descriptor.filters.map((f) => f.fieldId)).toContain("status");
  });

  it("type is a column and NOT a filter, because no (type, createdAt) index exists", () => {
    // Offering it would put a control on screen that errors at read time in front of a dispatcher.
    expect(workOrderIndexList.columns.map((c) => c.fieldId)).toContain("type");
    expect(workOrderIndexList.filters.map((f) => f.fieldId)).not.toContain("type");
  });
});

// ═════════════════════════════════════════ the chips

describe("status groups", () => {
  it("every lifecycle status belongs to exactly one chip", () => {
    // A chip naming a status the engine does not have would filter to nothing forever and read as
    // an empty queue rather than as a typo.
    expect(statusGroupCoverage()).toEqual({ uncovered: [], duplicated: [], unknown: [] });
  });

  it("a chip resolves from applied criteria, and an ad-hoc status filter lights none", () => {
    expect(activeStatusGroupKey(null)).toBe("ALL");
    expect(activeStatusGroupKey(["CREATED", "READY_TO_DISPATCH", "SCHEDULED"])).toBe("OPEN");
    // Lighting "All" while a filter is applied would state the opposite of what is on screen.
    expect(activeStatusGroupKey(["CREATED"])).toBeNull();
  });

  it("the chips no longer claim counts", () => {
    // "Open (34)" counted from a bounded page is a claim about the business derived from one
    // screenful — wrong in the direction that looks reassuring.
    expect(SCREEN).not.toMatch(/count:/);
    expect(WORK_ORDER_STATUS_GROUP_VALUES.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════ search: list page ≠ search corpus

describe("bounded work order search", () => {
  it("a blank term issues no query at all", () => {
    // An unfiltered read of the whole collection is not a search; it is the thing this replaces.
    expect(workOrderSearchQueryShape({ term: "   ", collection: "fieldops_wos" })).toBeNull();
  });

  it("the term is folded UP, because work order numbers are machine-generated uppercase", () => {
    expect(normalizeWorkOrderTerm(" wo-2026 ")).toBe("WO-2026");
    const shape = workOrderSearchQueryShape({ term: "wo-2026", collection: "fieldops_wos" });
    expect(shape.start).toBe("WO-2026");
    expect(shape.end).toBe("WO-2026");
    expect(shape.orderBy[0].fieldPath).toBe("woNumber");
  });

  it("the read is capped, and reads one extra row so truncation is DETECTED not assumed", () => {
    const shape = workOrderSearchQueryShape({ term: "WO", collection: "fieldops_wos" });
    expect(shape.limit).toBe(WORK_ORDER_SEARCH_CAP + 1);
    const docs = Array.from({ length: WORK_ORDER_SEARCH_CAP + 1 }, (_, i) => ({ id: `w${i}` }));
    const out = interpretWorkOrderSearchRead({ term: "WO", docs });
    expect(out.state).toBe("TRUNCATED");
    expect(out.results).toHaveLength(WORK_ORDER_SEARCH_CAP);
    expect(out.message).toMatch(/Type more/);
  });

  it("a denied read is never reported as 'no such work order'", () => {
    // A technician may only read work assigned to them, so denial is ordinary here.
    const denied = interpretWorkOrderSearchRead({ term: "WO", error: { code: "permission-denied" } });
    expect(denied.state).toBe("DENIED");
    expect(denied.message).not.toMatch(/No work order/);

    const failed = interpretWorkOrderSearchRead({ term: "WO", error: new Error("offline") });
    expect(failed.state).toBe("UNAVAILABLE");

    // Nothing fetched is a different fact from a search that ran and found nothing.
    expect(interpretWorkOrderSearchRead({ term: "WO", docs: null }).state).toBe("UNAVAILABLE");
    expect(interpretWorkOrderSearchRead({ term: "WO", docs: [] }).state).toBe("EMPTY");
  });

  it("the screen uses the bounded search and not the in-memory provider", () => {
    expect(SCREEN).toMatch(/useWorkOrderSearch/);
    expect(SCREEN).not.toMatch(/^import .*GlobalSearch/m);
  });
});

// ═════════════════════════════════════════ no raw ids

describe("nothing renders a Firestore document id", () => {
  it("the old `woNumber ?? wo.id` and `names.get(id) ?? id` fallbacks are gone", () => {
    // Both existed on this screen: the number fell back to the document key, and an unresolved
    // customer rendered its raw account id in the Customer column.
    expect(SCREEN).not.toMatch(/woNumber\s*\?\?\s*wo\.id/);
    expect(SCREEN).not.toMatch(/customerNames\.get\([^)]*\)\s*\?\?/);
  });

  it("an unresolvable search result says so instead of printing the key", () => {
    expect(SCREEN).toMatch(/Work order number unavailable/);
  });

  it("references resolve through governed resolvers, never a local find-or-id", () => {
    expect(SCREEN).toMatch(/useAccountReferenceResolver/);
    expect(SCREEN).toMatch(/resolveTechnicianIdentity/);
    expect(SCREEN).not.toMatch(/\?\?\s*(wo\.)?(customerId|assignedTechId)\b/);
  });
});

// ═════════════════════════════════════════ vocabulary

describe("type is a business word, not a machine value", () => {
  it("every declared type has a label that differs from its stored value", () => {
    for (const value of WORK_ORDER_TYPE_VALUES) {
      const label = workOrderTypeLabel(value);
      expect(label, value).toBeTruthy();
      // makeFieldDefinition enforces this too; asserted here so the reason is visible.
      expect(label).not.toBe(value);
    }
  });

  it("an unrecognised type returns null rather than the raw value", () => {
    // A legacy record carrying a type this build has never heard of must not be shown as though
    // it were one of the five.
    expect(workOrderTypeLabel("LEGACY_THING")).toBeNull();
    expect(workOrderTypeLabel(undefined)).toBeNull();
  });
});

// ═════════════════════════════════════════ the honest limits, registered

describe("the limits are recorded as gaps rather than worked around", () => {
  const ids = () => workOrderEntity.gaps.map((g) => g.id);

  it("scheduled-sort truncation is registered AND stated on the screen", () => {
    // Firestore's orderBy excludes documents missing the field; scheduledStart is optional.
    expect(ids()).toContain("WORK_ORDER_SCHEDULED_SORT_HIDES_UNSCHEDULED");
    expect(SCREEN).toMatch(/scheduled work only/);
  });

  it("search narrowness is still registered", () => {
    expect(ids()).toContain("WORK_ORDER_TEXT_SEARCH_GAP");
  });

  it("the equipment gap is CLOSED — the record has its own reference now", () => {
    // This used to assert the OPPOSITE, and it was right at the time: the record carried no
    // equipment reference, and a column fed from install close-outs would have been empty for every
    // OPEN work order. Slice 2 closed it by giving the record its own governed reference rather
    // than deriving one.
    expect(ids()).not.toContain("WORK_ORDER_CARRIES_NO_EQUIPMENT_REFERENCE");
    const field = workOrderEntity.fields.find((f) => f.id === "equipmentId");
    expect(field).toBeTruthy();
    expect(field.type).toBe("REFERENCE");
    expect(field.referenceTo).toBe("equipment");
  });
});

// ═════════════════════════════════════════ back navigation

describe("back to the list returns the list somebody had", () => {
  it("the list records its criteria under the key the detail page reads", () => {
    expect(SCREEN).toMatch(/useListCriteria\([\s\S]*OBJECT_LIST_KEY\.WORK_ORDERS/);
    expect(read("src/modules/workOrders/WorkOrderDetailPage.jsx"))
      .toMatch(/objectListPathWithState\(OBJECT_LIST_KEY\.WORK_ORDERS/);
  });

  it("the explicit Back control is not browser history", () => {
    // Opened from Dispatch, a dashboard tile or a pasted link, "back" would otherwise mean four
    // different things from one control.
    const detail = read("src/modules/workOrders/WorkOrderDetailPage.jsx");
    expect(detail).not.toMatch(/navigate\(-1\)/);
  });
});
