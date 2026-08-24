// STRUCTURED OBJECT UX + FIELD METADATA — the pilot's contract, proven.
// Run: node --test test/structuredObjectFields.test.mjs   (also `npm test`)
//
// Three things are being defended here, and they are the reason the metadata exists at all:
//
//   1  a business attribute stays independently addressable — never folded into a sentence
//   2  the metadata tells the TRUTH about what the query layer can do, so a list never offers a
//      filter it would have to fetch the whole collection to honour
//   3  a Firestore document id never reaches a person
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIELD_CATEGORY, FIELD_TYPE, OPERATOR, OPERATORS_FOR_TYPE, UNSUPPORTED_REASON,
  defineField, defineObjectFields, visibleFields, filterableFields, sortableFields,
  groupFieldsByOwner, sortOptionsFor, unsupportedExplanation,
} from "../src/domain/fieldMetadata.js";
import {
  WORK_ORDER_FIELDS, SALES_ORDER_FIELDS, EQUIPMENT_FIELDS, AVAILABLE_UNIT_FIELDS,
  SALES_ORDER_DOLLARS_GAP, OBJECT,
} from "../src/domain/objectFields.js";
import {
  emptyListState, makeFilter, addFilter, removeFilter, clearFilters, setSort,
  toSearchParams, fromSearchParams, toQueryPlan, describeFilter,
  resolveRelativeRange, RELATIVE_RANGE, activeFilterCount, hasActiveCriteria,
} from "../src/domain/listQueryState.js";
import { objectListPath, objectListPathWithState, OBJECT_LIST_KEY } from "../src/navigation/objectRoutes.js";
import { WORK_ORDER_STATUS_VALUES } from "../src/domain/workOrderStatus.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (rel) => readFileSync(path.resolve(root, rel), "utf8");

const byId = (fields, id) => fields.find((f) => f.id === id);

// =====================================================================================
// 1 — THE CONTRACT VALIDATES ITSELF
// =====================================================================================

describe("the field contract refuses bad declarations", () => {
  test("an UNSUPPORTED capability must say WHY", () => {
    // Without this the metadata quietly becomes a list of things that mysteriously do not work.
    const r = defineField({
      id: "x", object: "O", category: FIELD_CATEGORY.OWNED, type: FIELD_TYPE.STRING,
      label: "X", filterable: false, sortable: false,
    });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /filterable:false must state a reason/.test(e)));
    assert.ok(r.errors.some((e) => /sortable:false must state a reason/.test(e)));
  });

  test("a field may NARROW its type's operators but never widen them", () => {
    const widened = defineField({
      id: "d", object: "O", category: FIELD_CATEGORY.OWNED, type: FIELD_TYPE.DATE, label: "D",
      filterable: true, sortable: true, operators: [OPERATOR.CONTAINS],
    });
    assert.equal(widened.valid, false, "'contains' on a date is how one list ends up unlike every other");

    const narrowed = defineField({
      id: "d2", object: "O", category: FIELD_CATEGORY.OWNED, type: FIELD_TYPE.DATE, label: "D",
      filterable: true, sortable: true, operators: [OPERATOR.BETWEEN],
    });
    assert.equal(narrowed.valid, true);
  });

  test("AN ENUM IS SORTABLE ONLY WITH AN EXPLICIT BUSINESS ORDER", () => {
    // Alphabetical status order puts CANCELLED before WORK_IN_PROGRESS and calls it order.
    const noOrder = defineField({
      id: "s", object: "O", category: FIELD_CATEGORY.OWNED, type: FIELD_TYPE.ENUM, label: "S",
      filterable: true, sortable: true,
    });
    assert.equal(noOrder.valid, false);
    assert.ok(noOrder.errors.some((e) => /alphabetical status order is nonsense/.test(e)));
  });

  test("a RELATED field must name the object that owns it", () => {
    const r = defineField({
      id: "r", object: "O", category: FIELD_CATEGORY.RELATED, type: FIELD_TYPE.STRING, label: "R",
      filterable: false, unsupportedFilterReason: UNSUPPORTED_REASON.NOT_PROJECTED,
      sortable: false, unsupportedSortReason: UNSUPPORTED_REASON.NOT_PROJECTED,
    });
    assert.equal(r.valid, false);
  });

  test("an invalid object contract THROWS at load rather than at a filter menu", () => {
    assert.throws(
      () => defineObjectFields("Broken", [{ id: "a", category: FIELD_CATEGORY.OWNED, type: FIELD_TYPE.STRING, label: "A" }]),
      /Invalid field metadata for Broken/,
    );
  });
});

// =====================================================================================
// 2 — HONESTY ABOUT WHAT THE QUERY LAYER CAN DO
// =====================================================================================

describe("the metadata tells the truth about queryability", () => {
  test("EVERY unsupported filter and sort names its reason", () => {
    for (const [name, fields] of Object.entries({
      "Work Order": WORK_ORDER_FIELDS, "Sales Order": SALES_ORDER_FIELDS,
      Equipment: EQUIPMENT_FIELDS, "Available Unit": AVAILABLE_UNIT_FIELDS,
    })) {
      for (const f of fields) {
        if (!f.filterable && f.category !== FIELD_CATEGORY.DERIVED) {
          assert.ok(f.unsupportedFilterReason, `${name}.${f.id} must say why it cannot be filtered`);
        }
        if (!f.sortable && f.category !== FIELD_CATEGORY.DERIVED) {
          assert.ok(f.unsupportedSortReason, `${name}.${f.id} must say why it cannot be sorted`);
        }
      }
    }
  });

  test("RELATED NAME FIELDS ARE NOT SORTABLE — the value is not on this document", () => {
    // Firestore is not relational. Sorting by a name stored elsewhere means fetching everything.
    for (const id of ["customer.name", "location.name", "technician.name", "equipment.model"]) {
      const f = byId(WORK_ORDER_FIELDS, id);
      assert.equal(f.sortable, false, `${id} must not claim to be sortable`);
      assert.equal(f.unsupportedSortReason, UNSUPPORTED_REASON.NOT_PROJECTED);
    }
  });

  test("but a related field whose ID IS stored may still be FILTERED", () => {
    // The picker shows names; the query uses the id behind them. That is genuinely scalable.
    const tech = byId(WORK_ORDER_FIELDS, "technician.name");
    assert.equal(tech.filterable, true);
    assert.deepEqual([...tech.operators], [OPERATOR.IS, OPERATOR.IS_NOT, OPERATOR.IN]);
  });

  test("a DERIVED field is neither filtered nor sorted server-side", () => {
    const readiness = byId(WORK_ORDER_FIELDS, "partsReadiness");
    assert.equal(readiness.category, FIELD_CATEGORY.DERIVED);
    assert.equal(readiness.filterable, false);
    assert.equal(readiness.unsupportedFilterReason, UNSUPPORTED_REASON.DERIVED_AT_READ);
  });

  test("the explanation is in words a person can act on", () => {
    const f = byId(WORK_ORDER_FIELDS, "customer.name");
    assert.match(unsupportedExplanation(f, "sort"), /Customer cannot be sorted here/);
    assert.match(unsupportedExplanation(f, "sort"), /lives on a related record/);
  });
});

describe("status ordering", () => {
  test("WORK ORDER STATUS SORTS BY LIFECYCLE, and REUSES the existing order", () => {
    const status = byId(WORK_ORDER_FIELDS, "status");
    assert.equal(status.sortable, true);
    // Reused, not restated -- a second copy would drift and then the list and the workflow would
    // disagree about what comes after what.
    assert.deepEqual([...status.statusOrder], [...WORK_ORDER_STATUS_VALUES]);
    assert.equal(status.statusOrder[0], "CREATED");
    assert.equal(status.statusOrder[status.statusOrder.length - 1], "CANCELLED");
  });

  test("TYPE IS NOT SORTABLE — a classification is not a sequence", () => {
    const type = byId(WORK_ORDER_FIELDS, "type");
    assert.equal(type.sortable, false);
    assert.equal(type.unsupportedSortReason, UNSUPPORTED_REASON.NO_CANONICAL_ORDER);
    assert.equal(type.filterable, true, "but it is still filterable, which is what people want");
  });

  test("SALES ORDER STATUS IS FILTERABLE BUT NOT SORTABLE — no order is declared in the domain", () => {
    const status = byId(SALES_ORDER_FIELDS, "status");
    assert.equal(status.filterable, true);
    assert.equal(status.sortable, false);
    assert.equal(status.unsupportedSortReason, UNSUPPORTED_REASON.NO_CANONICAL_ORDER);
  });
});

// =====================================================================================
// 3 — THE SALES ORDER DOLLARS GAP
// =====================================================================================

describe("Sales Order Dollars", () => {
  test("IT IS BLOCKED, AND THE FIELD SAYS SO RATHER THAN VANISHING", () => {
    const dollars = byId(SALES_ORDER_FIELDS, "dollars");
    assert.ok(dollars, "the requirement stays in the contract");
    assert.equal(dollars.displayable, false, "but the column does not render");
    assert.equal(dollars.category, FIELD_CATEGORY.FINANCIAL);
    assert.equal(dollars.unsupportedFilterReason, UNSUPPORTED_REASON.NO_AUTHORITY);
  });

  test("it is absent from every capability list, so nothing can offer it", () => {
    assert.ok(!visibleFields(SALES_ORDER_FIELDS).some((f) => f.id === "dollars"));
    assert.ok(!filterableFields(SALES_ORDER_FIELDS).some((f) => f.id === "dollars"));
    assert.ok(!sortableFields(SALES_ORDER_FIELDS).some((f) => f.id === "dollars"));
  });

  test("the gap records its EVIDENCE, not just its existence", () => {
    assert.equal(SALES_ORDER_DOLLARS_GAP.object, OBJECT.SALES_ORDER);
    assert.ok(SALES_ORDER_DOLLARS_GAP.evidence.length >= 4);
    assert.ok(SALES_ORDER_DOLLARS_GAP.evidence.some((e) => /unitPrice/.test(e)));
    assert.ok(SALES_ORDER_DOLLARS_GAP.evidence.some((e) => /Invoice/i.test(e)));
  });

  test("NO CLIENT-SIDE TOTAL IS COMPUTED ANYWHERE — the forbidden shortcut", () => {
    // "Do NOT compute list total by parsing UI line items on the client."
    const src = read("src/domain/objectFields.js");
    assert.ok(!/reduce\([^)]*unitPrice/.test(src));
    assert.ok(!/lines\.reduce/.test(src));
  });
});

// =====================================================================================
// 4 — LIST STATE
// =====================================================================================

describe("list state survives the round trip", () => {
  const state = () => addFilter(
    setSort(emptyListState, "scheduledStart", "asc"),
    makeFilter({ fieldId: "status", operator: OPERATOR.IS, value: "WORK_IN_PROGRESS" }),
  );

  test("filters and sort serialize into a URL and come back intact", () => {
    const params = toSearchParams(state());
    const restored = fromSearchParams(params.toString(), WORK_ORDER_FIELDS);
    assert.equal(restored.filters.length, 1);
    assert.equal(restored.filters[0].fieldId, "status");
    assert.equal(restored.filters[0].value, "WORK_IN_PROGRESS");
    assert.deepEqual(restored.sort, { fieldId: "scheduledStart", direction: "asc" });
  });

  test("multiple filters all survive", () => {
    let s = state();
    s = addFilter(s, makeFilter({ fieldId: "priority", operator: OPERATOR.IS, value: "HIGH" }));
    s = addFilter(s, makeFilter({ fieldId: "type", operator: OPERATOR.IS, value: "INSTALL" }));
    const restored = fromSearchParams(toSearchParams(s).toString(), WORK_ORDER_FIELDS);
    assert.equal(restored.filters.length, 3);
    assert.equal(activeFilterCount(restored), 3);
  });

  test("A STALE URL DEGRADES TO AN UNFILTERED LIST, never to a broken screen", () => {
    // A URL is user-editable and may be from an older build.
    const restored = fromSearchParams("f=noSuchField:IS:x&sort=alsoGone:asc", WORK_ORDER_FIELDS);
    assert.deepEqual([...restored.filters], []);
    assert.equal(restored.sort, null);
  });

  test("a URL cannot ask for an operator the field never allowed", () => {
    // status is an ENUM; "contains" is not one of its operators.
    const restored = fromSearchParams("f=status:CONTAINS:WORK", WORK_ORDER_FIELDS);
    assert.deepEqual([...restored.filters], []);
  });

  test("a URL cannot ask to sort by something declared unsortable", () => {
    const restored = fromSearchParams("sort=customer.name:asc", WORK_ORDER_FIELDS);
    assert.equal(restored.sort, null, "otherwise a pasted link becomes a full-collection scan");
  });

  test("a value containing a colon survives encoding", () => {
    const s = addFilter(emptyListState, makeFilter({ fieldId: "woNumber", operator: OPERATOR.IS, value: "WO:2026:1" }));
    const restored = fromSearchParams(toSearchParams(s).toString(), WORK_ORDER_FIELDS);
    assert.equal(restored.filters[0].value, "WO:2026:1");
  });

  test("ANY criteria change resets the page cursor", () => {
    // Paging into a result set that no longer exists is how a list shows the wrong records.
    const paged = { ...emptyListState, cursor: "abc" };
    assert.equal(addFilter(paged, makeFilter({ fieldId: "status", operator: OPERATOR.IS, value: "X" })).cursor, null);
    assert.equal(removeFilter(paged, "status").cursor, null);
    assert.equal(setSort(paged, "createdAt", "desc").cursor, null);
    assert.equal(clearFilters(paged).cursor, null);
  });

  test("removing one filter leaves the others", () => {
    let s = addFilter(emptyListState, makeFilter({ fieldId: "status", operator: OPERATOR.IS, value: "A" }));
    s = addFilter(s, makeFilter({ fieldId: "priority", operator: OPERATOR.IS, value: "HIGH" }));
    const after = removeFilter(s, "status");
    assert.equal(after.filters.length, 1);
    assert.equal(after.filters[0].fieldId, "priority");
  });

  test("adding the same field+operator REPLACES rather than contradicting itself", () => {
    let s = addFilter(emptyListState, makeFilter({ fieldId: "status", operator: OPERATOR.IS, value: "A" }));
    s = addFilter(s, makeFilter({ fieldId: "status", operator: OPERATOR.IS, value: "B" }));
    assert.equal(s.filters.length, 1);
    assert.equal(s.filters[0].value, "B");
  });

  test("hasActiveCriteria distinguishes a filtered empty list from an empty system", () => {
    assert.equal(hasActiveCriteria(emptyListState), false);
    assert.equal(hasActiveCriteria(state()), true);
  });
});

describe("the query plan", () => {
  test("A PAGE SIZE IS ALWAYS APPLIED", () => {
    const plan = toQueryPlan(emptyListState, WORK_ORDER_FIELDS);
    assert.ok(plan.pageSize > 0, "an unbounded list query dies on a real customer's data");
  });

  test("an unqueryable filter comes back UNSUPPORTED, never as a client-side scan", () => {
    // The guard against "fetch all, filter in the browser".
    const s = addFilter(emptyListState, makeFilter({ fieldId: "customer.name", operator: OPERATOR.IS, value: "Acme" }));
    const plan = toQueryPlan(s, WORK_ORDER_FIELDS);
    assert.equal(plan.executable, false);
    assert.equal(plan.server.length, 0);
    assert.equal(plan.unsupported[0].reason, UNSUPPORTED_REASON.NOT_PROJECTED);
  });

  test("a supported filter becomes a SERVER execution", () => {
    const s = addFilter(emptyListState, makeFilter({ fieldId: "status", operator: OPERATOR.IS, value: "WORK_IN_PROGRESS" }));
    const plan = toQueryPlan(s, WORK_ORDER_FIELDS);
    assert.equal(plan.executable, true);
    assert.equal(plan.server[0].execution, "SERVER");
  });

  test("an unsortable sort is reported rather than silently ignored", () => {
    const plan = toQueryPlan({ ...emptyListState, sort: { fieldId: "customer.name", direction: "asc" } }, WORK_ORDER_FIELDS);
    assert.equal(plan.sort, null);
    assert.equal(plan.unsupported.length, 1);
  });
});

describe("relative date ranges", () => {
  test("stored as a keyword, so a bookmark still means THIS week next month", () => {
    const s = addFilter(emptyListState, makeFilter({
      fieldId: "scheduledStart", operator: OPERATOR.RELATIVE, value: RELATIVE_RANGE.THIS_WEEK,
    }));
    const restored = fromSearchParams(toSearchParams(s).toString(), WORK_ORDER_FIELDS);
    assert.equal(restored.filters[0].value, RELATIVE_RANGE.THIS_WEEK);
  });

  test("a week starts Monday — a service week is a working week", () => {
    // Wednesday 2026-08-19.
    const wed = new Date(2026, 7, 19, 15, 0, 0).getTime();
    const range = resolveRelativeRange(RELATIVE_RANGE.THIS_WEEK, wed);
    assert.equal(new Date(range.from).getDay(), 1, "Monday");
    assert.equal((range.to - range.from) / (24 * 60 * 60 * 1000), 7);
  });

  test("today is one day, not a moment", () => {
    const range = resolveRelativeRange(RELATIVE_RANGE.TODAY, new Date(2026, 7, 19, 15, 0, 0).getTime());
    assert.equal((range.to - range.from) / (24 * 60 * 60 * 1000), 1);
  });
});

// =====================================================================================
// 5 — NO FIRESTORE IDS
// =====================================================================================

describe("no raw ids reach a person", () => {
  test("EVERY reference field declares what to say when it cannot resolve", () => {
    const refTypes = [FIELD_TYPE.OBJECT_REF, FIELD_TYPE.LOCATION, FIELD_TYPE.PERSON];
    for (const [name, fields] of Object.entries({
      "Work Order": WORK_ORDER_FIELDS, "Sales Order": SALES_ORDER_FIELDS,
      Equipment: EQUIPMENT_FIELDS, "Available Unit": AVAILABLE_UNIT_FIELDS,
    })) {
      for (const f of fields.filter((x) => refTypes.includes(x.type) && x.displayable)) {
        assert.ok(f.unresolvedText, `${name}.${f.id} must say what to show when it does not resolve`);
        // "Customer unavailable" -- never the id, and never "(unresolved id)".
        assert.match(f.unresolvedText, /unavailable$/i);
        assert.ok(!/\{|\}|id\b/i.test(f.unresolvedText), `${f.id}: unresolved text must not mention an id`);
      }
    }
  });

  test("a filter chip renders the human LABEL, never the id behind it", () => {
    const filter = makeFilter({
      fieldId: "customer.name", operator: OPERATOR.IS,
      value: "acct-harbor", valueLabel: "Harbor Grill Restaurant Group",
    });
    const text = describeFilter(filter, WORK_ORDER_FIELDS);
    assert.match(text, /Harbor Grill Restaurant Group/);
    assert.ok(!text.includes("acct-harbor"), "the query may use the id; the person never sees it");
  });

  test("relative ranges read as words, not as keywords", () => {
    const filter = makeFilter({ fieldId: "scheduledStart", operator: OPERATOR.RELATIVE, value: RELATIVE_RANGE.THIS_WEEK });
    assert.equal(describeFilter(filter, WORK_ORDER_FIELDS), "Scheduled Date: This week");
  });

  test("NO PILOT FIELD EXPOSES A DOCUMENT ID AS A LABEL", () => {
    for (const fields of [WORK_ORDER_FIELDS, SALES_ORDER_FIELDS, EQUIPMENT_FIELDS, AVAILABLE_UNIT_FIELDS]) {
      for (const f of fields.filter((x) => x.displayable)) {
        assert.ok(!/^id$|documentId|docId/i.test(f.id), `${f.id} looks like a document id`);
        assert.ok(!/\bid\b/i.test(f.label), `${f.label} must not be an id`);
      }
    }
  });
});

// =====================================================================================
// 6 — BACK NAVIGATION
// =====================================================================================

describe("Back to Work Orders goes to Work Orders", () => {
  test("THE LIST IS THE INDEX OF /service — which is why the old path matched nothing", () => {
    assert.equal(objectListPath(OBJECT_LIST_KEY.WORK_ORDERS), "/service");
    assert.notEqual(objectListPath(OBJECT_LIST_KEY.WORK_ORDERS), "/service/work-orders");
  });

  test("the path is DERIVED, so a nav move follows automatically", () => {
    assert.equal(objectListPath("salesOrders"), "/customers/sales-orders");
    assert.equal(objectListPath("equipment"), "/equipment");
  });

  test("an unknown key FAILS LOUDLY rather than routing somewhere plausible", () => {
    assert.throws(() => objectListPath("nopeNotAKey"), /no nav item/);
  });

  test("saved list state rides along", () => {
    assert.equal(
      objectListPathWithState(OBJECT_LIST_KEY.WORK_ORDERS, "f=status:IS:WORK_IN_PROGRESS&sort=scheduledStart:asc"),
      "/service?f=status:IS:WORK_IN_PROGRESS&sort=scheduledStart:asc",
    );
    assert.equal(objectListPathWithState(OBJECT_LIST_KEY.WORK_ORDERS, ""), "/service");
  });

  test("THE DETAIL PAGE NO LONGER NAVIGATES TO THE DEAD PATH", () => {
    const src = read("src/modules/workOrders/WorkOrderDetailPage.jsx");
    // Only the explanatory comments may mention it now.
    assert.ok(!/navigate\("\/service\/work-orders"\)/.test(src));
    assert.match(src, /objectListPathWithState/);
    // And NOT browser history, which would make one control mean four different things.
    assert.ok(!/navigate\(-1\)/.test(src));
  });
});

// =====================================================================================
// 7 — FIELD DISCOVERY DRIVES THE UI
// =====================================================================================

describe("the UI reads the metadata", () => {
  test("filter fields are GROUPED BY THE OBJECT THAT OWNS THEM", () => {
    const groups = groupFieldsByOwner(filterableFields(WORK_ORDER_FIELDS), "Work Order");
    const owners = groups.map((g) => g.owner);
    assert.ok(owners.includes("Work Order"));
    assert.ok(owners.includes("Technician"), "a related field is offered under its own object");
  });

  test("an UNAUTHORIZED field is absent from columns, filters and sorts alike", () => {
    // Reading the parent does not authorize every related field.
    const fields = defineObjectFields("Guarded", [
      { id: "open", category: FIELD_CATEGORY.OWNED, type: FIELD_TYPE.STRING, label: "Open", filterable: true, sortable: true },
      {
        id: "secret", category: FIELD_CATEGORY.FINANCIAL, type: FIELD_TYPE.CURRENCY, label: "Secret",
        capability: "finance.read", filterable: true, sortable: true,
      },
    ]);
    const denied = { hasCapability: () => false };
    assert.deepEqual(visibleFields(fields, denied).map((f) => f.id), ["open"]);
    assert.deepEqual(filterableFields(fields, denied).map((f) => f.id), ["open"]);
    assert.deepEqual(sortableFields(fields, denied).map((f) => f.id), ["open"]);

    const allowed = { hasCapability: (c) => c === "finance.read" };
    assert.equal(visibleFields(fields, allowed).length, 2);
  });

  test("a THROWING capability gate denies", () => {
    const fields = defineObjectFields("G", [{
      id: "x", category: FIELD_CATEGORY.OWNED, type: FIELD_TYPE.STRING, label: "X",
      capability: "some.cap", filterable: true, sortable: true,
    }]);
    assert.deepEqual(visibleFields(fields, { hasCapability: () => { throw new Error("boom"); } }).map((f) => f.id), []);
  });

  test("sort options speak the TYPE's language", () => {
    const date = sortOptionsFor(byId(WORK_ORDER_FIELDS, "scheduledStart"));
    assert.equal(date[0].label, "Scheduled Date — Newest first");
    assert.equal(date[1].label, "Scheduled Date — Oldest first");

    const name = sortOptionsFor(byId(EQUIPMENT_FIELDS, "manufacturer"));
    assert.equal(name[0].label, "Manufacturer — Z to A");
    assert.equal(name[1].label, "Manufacturer — A to Z");
  });

  test("operators come from the TYPE, so a date behaves the same on every object", () => {
    for (const fields of [WORK_ORDER_FIELDS, SALES_ORDER_FIELDS, EQUIPMENT_FIELDS]) {
      for (const f of fields.filter((x) => x.type === FIELD_TYPE.DATETIME && x.filterable)) {
        for (const op of f.operators) {
          assert.ok(OPERATORS_FOR_TYPE[FIELD_TYPE.DATETIME].includes(op), `${f.id} offers ${op}`);
        }
      }
    }
  });
});

// =====================================================================================
// 8 — INSTALLED vs UNINSTALLED
// =====================================================================================

describe("Equipment and serialized stock are different things", () => {
  test("an available unit has NO customer, and installed Equipment does", () => {
    // Merging them makes "Customer" empty for half the rows, and nobody can tell whether that means
    // unassigned or uninstalled.
    assert.ok(!AVAILABLE_UNIT_FIELDS.some((f) => f.id.startsWith("customer")));
    assert.ok(EQUIPMENT_FIELDS.some((f) => f.id === "customer.name"));
  });

  test("a serialized unit's quantity is ALWAYS ONE, and says so", () => {
    const qty = byId(AVAILABLE_UNIT_FIELDS, "quantity");
    assert.equal(qty.type, FIELD_TYPE.QUANTITY);
    assert.match(qty.source, /always 1/i);
    assert.equal(qty.align, "right");
  });

  test("both resolve location through the governed projection, not a hardcoded map", () => {
    assert.match(byId(AVAILABLE_UNIT_FIELDS, "currentLocation").source, /getLocationDisplay/);
    assert.match(byId(EQUIPMENT_FIELDS, "location.name").source, /getLocationDisplay/);
  });
});
