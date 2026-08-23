// WO-04 — THE WAREHOUSE / PARTS HANDHELD, and the structured-field standard it establishes.
// Run: node --test test/warehouseHandheld.test.mjs   (also `npm test`)
//
// Two layers, and the split matters:
//
//   1  the PURE decisions — who is offered what, in what order, what may carry a number, and how a
//      business object becomes fields rather than a sentence;
//   2  a STRUCTURAL guard that the shell is actually reachable, reading the route table rather than
//      any test file. The technician shell was orphaned for two whole slices while every component
//      test passed, because rendering a component is importing it. Not again.
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  WAREHOUSE_TABS, WAREHOUSE_MORE_ITEMS, ATTENTION_ORDER, COUNTABLE_QUEUES,
  composeWarehouseHome, assertWarehouseMoreIsSmall,
  WAREHOUSE_OFFLINE_MATRIX, offlineMatrixCovers,
} from "../src/domain/warehouseHandheld.js";
import {
  field, statusField, statusLabel, locationField, quantityField, fieldsForWidth,
  serializedUnitFields, partFields, transferFields, receivingLineFields,
  FIELD_KIND, ABSENCE,
} from "../src/domain/structuredFields.js";
import { SCAN_WORKFLOW } from "../src/access/scanWorkflows.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (rel) => readFileSync(path.resolve(root, rel), "utf8");

/** A capability gate that holds exactly the listed ids. */
const holding = (...ids) => (id) => ids.includes(id);
const ALL = () => true;

// =====================================================================================
// 1 — COMPOSITION AND AUTHORITY
// =====================================================================================

describe("who is offered what", () => {
  test("a person holding NOTHING is offered lookup only, and told why the rest is absent", () => {
    // Lookup reads the governed Part Master and needs no capability activation, so it is genuinely
    // available. Everything else is ABSENT rather than disabled.
    const home = composeWarehouseHome({ hasCapability: () => false });
    assert.deepEqual(home.queues.map((q) => q.key), [SCAN_WORKFLOW.LOOKUP]);
    assert.equal(home.empty, false);
  });

  test("ABSENCE, NOT DISABLEMENT — nothing unavailable is rendered as a queue", () => {
    const home = composeWarehouseHome({ hasCapability: holding("inventory.stock.receive"), receivingReady: true });
    const keys = home.queues.map((q) => q.key);
    // A disabled tile would assert the operation exists and that access is the only obstacle. For
    // several of these the capability is active:false and carried by no Role anywhere.
    assert.ok(!keys.includes(SCAN_WORKFLOW.CYCLE_COUNT));
    assert.ok(!keys.includes(SCAN_WORKFLOW.TRANSFER));
    assert.ok(keys.includes(SCAN_WORKFLOW.SUPPLIER_RECEIVING));
  });

  test("A RECEIVING CLERK DOES NOT GET PUT-AWAY", () => {
    // Receiving is named accountability. Holding it says nothing about stowing stock.
    const home = composeWarehouseHome({ hasCapability: holding("inventory.stock.receive"), receivingReady: true });
    assert.ok(!home.queues.map((q) => q.key).includes(SCAN_WORKFLOW.PUT_AWAY));
  });

  test("put-away needs BOTH the placement authority and the bin read", () => {
    const only = composeWarehouseHome({ hasCapability: holding("inventory.placement.record") });
    assert.ok(!only.queues.map((q) => q.key).includes(SCAN_WORKFLOW.PUT_AWAY),
      "recording a placement without being able to check the bin is how stock lands on racking that does not exist");
    const both = composeWarehouseHome({ hasCapability: holding("inventory.placement.record", "inventory.location.bin.read") });
    assert.ok(both.queues.map((q) => q.key).includes(SCAN_WORKFLOW.PUT_AWAY));
  });

  test("a MULTI-ROLE worker gets the union, in attention order, with no duplicates", () => {
    const home = composeWarehouseHome({
      hasCapability: holding(
        "inventory.stock.receive", "inventory.placement.record", "inventory.location.bin.read",
        "inventory.cycleCount.create", "inventory.cycleCount.submit",
      ),
      receivingReady: true,
    });
    const keys = home.queues.map((q) => q.key);
    assert.equal(new Set(keys).size, keys.length, "no queue appears twice");
    // Attention order, not the order capabilities happened to be listed.
    assert.deepEqual(keys, ATTENTION_ORDER.filter((k) => keys.includes(k)));
    assert.equal(keys[0], SCAN_WORKFLOW.SUPPLIER_RECEIVING, "stock on the dock leads");
  });

  test("COUNTING DOES NOT COME FROM RECONCILE AUTHORITY", () => {
    // A reconciler is not thereby a counter: approving a variance is a separate act, and offering
    // counting on the strength of it would put it behind the wrong grant.
    const home = composeWarehouseHome({ hasCapability: holding("inventory.cycleCount.reconcile") });
    assert.ok(!home.queues.map((q) => q.key).includes(SCAN_WORKFLOW.CYCLE_COUNT));
  });

  test("a THROWING capability gate denies, never allows", () => {
    const home = composeWarehouseHome({ hasCapability: () => { throw new Error("boom"); } });
    assert.deepEqual(home.queues.map((q) => q.key), [SCAN_WORKFLOW.LOOKUP]);
  });

  test("receiving transport not ready is reported SEPARATELY from not authorized", () => {
    const home = composeWarehouseHome({ hasCapability: holding("inventory.stock.receive"), receivingReady: false });
    assert.ok(!home.queues.map((q) => q.key).includes(SCAN_WORKFLOW.SUPPLIER_RECEIVING));
    const entry = home.unavailable.find((u) => u.workflow === SCAN_WORKFLOW.SUPPLIER_RECEIVING);
    assert.equal(entry.reason, "NOT_READY", "'unreachable here' is not 'you may not'");
  });
});

describe("counts", () => {
  test("ONLY RECEIVING MAY SHOW A NUMBER", () => {
    // Transfers, counts and returns have COMMANDS but no list callable. A number invented for a
    // warehouse is a stock-out somebody discovers at a customer site.
    assert.deepEqual([...COUNTABLE_QUEUES], [SCAN_WORKFLOW.SUPPLIER_RECEIVING]);
  });

  test("an uncountable queue says so in words, and never shows 0", () => {
    const home = composeWarehouseHome({
      hasCapability: holding("inventory.placement.record", "inventory.location.bin.read"),
    });
    const putAway = home.queues.find((q) => q.key === SCAN_WORKFLOW.PUT_AWAY);
    assert.equal(putAway.count, null);
    assert.equal(putAway.countable, false);
    assert.match(putAway.countText, /count is not available/i);
  });

  test("receiving shows a count when one was actually read", () => {
    const home = composeWarehouseHome({
      hasCapability: holding("inventory.stock.receive"), receivingReady: true,
      counts: { [SCAN_WORKFLOW.SUPPLIER_RECEIVING]: 3 },
    });
    assert.equal(home.queues.find((q) => q.key === SCAN_WORKFLOW.SUPPLIER_RECEIVING).count, 3);
  });

  test("a count offered for an UNCOUNTABLE queue is ignored, not displayed", () => {
    // Defends against a future caller passing a number derived from something it should not have.
    const home = composeWarehouseHome({
      hasCapability: holding("inventory.placement.record", "inventory.location.bin.read"),
      counts: { [SCAN_WORKFLOW.PUT_AWAY]: 99 },
    });
    assert.equal(home.queues.find((q) => q.key === SCAN_WORKFLOW.PUT_AWAY).count, null);
  });
});

describe("the shell stays small", () => {
  test("four tabs, exactly", () => {
    assert.deepEqual(WAREHOUSE_TABS.map((t) => t.key), ["home", "scan", "work", "more"]);
  });

  test("More is a closed list and refuses to grow", () => {
    assert.equal(assertWarehouseMoreIsSmall(), true);
    assert.equal(assertWarehouseMoreIsSmall([...WAREHOUSE_MORE_ITEMS, { key: "reporting", label: "Reporting" }]), false);
    assert.equal(assertWarehouseMoreIsSmall([{ key: "crm", label: "CRM" }]), false);
  });
});

// =====================================================================================
// 2 — STRUCTURED FIELDS
// =====================================================================================

describe("a business object is fields, not a sentence", () => {
  test("THE WORKED EXAMPLE: six attributes, six separately addressable fields", () => {
    const fields = serializedUnitFields(
      { productName: "Taylor C161", serialNo: "CW-C161-0001", inventoryState: "AVAILABLE" },
      { locationName: "Main Warehouse" },
    );
    assert.deepEqual(fields.map((f) => f.label),
      ["Equipment", "Serial Number", "Quantity", "Status", "Location", "Description"]);
    assert.deepEqual(fields.map((f) => f.value),
      ["Taylor C161", "CW-C161-0001", "1", "Available", "Main Warehouse", "Whole Unit Equipment"]);
  });

  test("STATUS KEEPS ITS RAW VALUE while showing a readable one", () => {
    const f = statusField("IN_TRANSIT");
    assert.equal(f.value, "In Transit", "what a person reads");
    assert.equal(f.raw, "IN_TRANSIT", "what a filter, a sort and a report compare against");
    assert.equal(f.kind, FIELD_KIND.STATUS);
  });

  test("a status nobody has written a label for still reads as words, never as a token", () => {
    assert.equal(statusLabel("AWAITING_RECONCILIATION"), "Awaiting Reconciliation");
    assert.equal(statusLabel("shipped"), "Shipped");
    assert.equal(statusLabel(null), null);
  });

  test("A RAW LOCATION ID IS NEVER SHOWN", () => {
    // The resolver returning nothing is a real answer. Falling back to `wh-main` would put an
    // internal key in front of a person as though it were information.
    const f = locationField(null);
    assert.equal(f.value, ABSENCE.UNRESOLVED);
    assert.equal(f.present, false);
    assert.ok(!String(f.value).includes("wh-"));
  });

  test("ZERO IS A QUANTITY, not an absence", () => {
    // The old bug: a falsy check turns "0 on hand" into "Not recorded", so an empty shelf and an
    // unexamined one look identical.
    const zero = quantityField(0, { label: "Available" });
    assert.equal(zero.value, "0");
    assert.equal(zero.present, true);
    assert.equal(zero.raw, 0);
  });

  test("UNKNOWN IS NOT ZERO", () => {
    const unknown = quantityField(null, { label: "Available", unknown: true });
    assert.equal(unknown.value, ABSENCE.NOT_AUTHORIZED);
    assert.notEqual(unknown.value, "0");
    assert.equal(unknown.raw, null);
  });

  test("the three absences stay distinct", () => {
    assert.equal(field({ label: "A", value: null }).value, ABSENCE.NOT_RECORDED);
    assert.equal(field({ label: "B", value: null, absence: ABSENCE.NOT_AUTHORIZED }).value, ABSENCE.NOT_AUTHORIZED);
    assert.equal(field({ label: "C", value: null, absence: ABSENCE.UNRESOLVED }).value, ABSENCE.UNRESOLVED);
  });

  test("a narrow screen DROPS fields; it never merges them", () => {
    const fields = serializedUnitFields({ productName: "Taylor C161", serialNo: "S1", inventoryState: "AVAILABLE" }, { locationName: "Main Warehouse" });
    const narrow = fieldsForWidth(fields, 1);
    assert.ok(narrow.length < fields.length, "some fields are dropped");
    // Every survivor is still a whole, separate field.
    for (const f of narrow) {
      assert.ok(typeof f.label === "string" && f.label.length > 0);
      assert.ok(!String(f.value).includes("·"), "no field may contain a joined second attribute");
    }
  });

  test("a transfer's two endpoints are TWO fields", () => {
    const fields = transferFields(
      { transferNumber: "TR-1", status: "IN_TRANSIT", quantity: 4 },
      { sourceName: "Main Warehouse", destinationName: "Truck 12" },
    );
    const byLabel = Object.fromEntries(fields.map((f) => [f.label, f.value]));
    assert.equal(byLabel.Source, "Main Warehouse");
    assert.equal(byLabel.Destination, "Truck 12");
    assert.equal(byLabel.Status, "In Transit");
  });

  test("REMAINING IS DERIVED, not stored — it cannot drift from the two it comes from", () => {
    const fields = receivingLineFields({ partName: "Seal kit", expectedQty: 10, receivedQty: 4 });
    const byLabel = Object.fromEntries(fields.map((f) => [f.label, f.value]));
    assert.equal(byLabel.Expected, "10");
    assert.equal(byLabel.Received, "4");
    assert.equal(byLabel.Remaining, "6");
  });

  test("over-receipt never renders a negative remainder", () => {
    const fields = receivingLineFields({ expectedQty: 2, receivedQty: 5 });
    assert.equal(fields.find((f) => f.label === "Remaining").value, "0");
  });

  test("a part with unknown availability says so rather than claiming none", () => {
    const fields = partFields({ name: "Seal kit", internalPartNumber: "TS-4410" }, { availabilityUnknown: true });
    assert.equal(fields.find((f) => f.label === "Available").value, ABSENCE.NOT_AUTHORIZED);
  });

  test("NO FIELD VALUE IS EVER A JOINED STRING", () => {
    // The one thing this whole model exists to prevent, asserted across every builder here.
    const all = [
      ...serializedUnitFields({ productName: "P", serialNo: "S", inventoryState: "AVAILABLE" }, { locationName: "L" }),
      ...partFields({ name: "P", internalPartNumber: "SKU", status: "ACTIVE" }, { availableQty: 3, locationName: "L" }),
      ...transferFields({ transferNumber: "T", status: "REQUESTED", quantity: 1 }, { sourceName: "A", destinationName: "B" }),
      ...receivingLineFields({ partName: "P", sku: "S", expectedQty: 1, receivedQty: 1, status: "OPEN" }, { destinationName: "D" }),
    ];
    for (const f of all) {
      assert.ok(!/ · | — S\/N |, Qty /.test(String(f.value)), `"${f.value}" looks like two attributes in one field`);
    }
  });
});

// =====================================================================================
// 3 — OFFLINE CLASSIFICATION (WO-05's contract)
// =====================================================================================

describe("the offline matrix", () => {
  test("every workflow the brief names is classified", () => {
    assert.equal(offlineMatrixCovers([
      "scan raw identifier", "part lookup", "receiving", "put-away", "pick / stage",
      "transfer dispatch", "transfer receipt", "truck handoff", "cycle count",
      "reconciliation", "return intake",
    ]), true);
  });

  test("RECONCILIATION IS NOT CAPTURABLE, and that is a decision not an omission", () => {
    const row = WAREHOUSE_OFFLINE_MATRIX.find((r) => r.workflow === "reconciliation");
    assert.equal(row.capturable, false);
    assert.equal(row.onlineRequired, true);
    assert.match(row.note, /authority decision/i);
  });

  test("truck handoff inherits the transfer contract rather than inventing a model", () => {
    assert.match(WAREHOUSE_OFFLINE_MATRIX.find((r) => r.workflow === "truck handoff").note, /transfer contract/i);
  });

  test("return intake does NOT restock, offline or online", () => {
    assert.match(WAREHOUSE_OFFLINE_MATRIX.find((r) => r.workflow === "return intake").note, /does NOT restock/i);
  });

  test("every row states all three answers — no workflow is left unclassified", () => {
    for (const row of WAREHOUSE_OFFLINE_MATRIX) {
      assert.equal(typeof row.readable, "boolean", `${row.workflow} readable`);
      assert.equal(typeof row.capturable, "boolean", `${row.workflow} capturable`);
      assert.equal(typeof row.onlineRequired, "boolean", `${row.workflow} onlineRequired`);
      assert.ok(row.note && row.note.length > 0, `${row.workflow} must say why`);
    }
  });
});

// =====================================================================================
// 4 — REACHABILITY (structural)
// =====================================================================================

function shippedSources(dir = path.resolve(root, "src"), found = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) shippedSources(full, found);
    else if (/\.(jsx?|tsx?)$/.test(entry)) found.push(full);
  }
  return found;
}

describe("WarehouseShell is reachable", () => {
  const APP = read("src/App.jsx");
  const SHELL = read("src/modules/warehouse/WarehouseShell.jsx");

  test("IT IS IMPORTED BY SHIPPED SOURCE, not only by tests", () => {
    const importers = shippedSources()
      .filter((f) => !f.endsWith(path.join("warehouse", "WarehouseShell.jsx")))
      .filter((f) => /from\s+["'][^"']*WarehouseShell["']/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f));
    assert.ok(importers.some((f) => f.endsWith(path.join("src", "App.jsx"))),
      `the shell must be reachable from the route table; found ${importers.join(", ") || "nothing"}`);
  });

  test("it is RENDERED, from the warehouse workspace slot", () => {
    assert.match(APP, /<WarehouseShell\s+deps=/);
    assert.match(APP, /item\.key === "warehouseWorkspace"/);
    const nav = read("src/navigation/navConfig.js");
    assert.match(nav, /key:\s*"warehouseWorkspace"/);
    assert.match(nav, /path:\s*"warehouse-workspace"/);
  });

  test("ALL FOUR TABS render a branch — a tab that renders nothing is a dead button", () => {
    for (const key of ["home", "scan", "work", "more"]) {
      assert.match(SHELL, new RegExp(`tab === "${key}"`), `no branch for ${key}`);
    }
    assert.match(SHELL, /WAREHOUSE_TABS\.map/, "the bar must come from the governed list");
  });

  test("DESKTOP IS NOT FORCED INTO THE PHONE SHELL", () => {
    assert.match(APP, /useIsPhone\(\)\s*\?\s*<WarehouseShell[\s\S]{0,80}:\s*<ScanWorkspace/);
  });

  test("the nav item is gated by the UNION of station capabilities, not a coarse warehouse id", () => {
    const caps = read("src/access/governedSurfaceCapabilities.js");
    assert.match(caps, /WAREHOUSE_HANDHELD_CAPABILITIES/);
    // A single "warehouse user" capability is exactly what the station model exists to avoid.
    assert.ok(!/inventory\.warehouse\.use|warehouse\.all/.test(caps));
  });

  test("THE SHELL IMPLEMENTS NO WORKFLOW — it composes the governed ones", () => {
    // If a command client ever appears in the shell, somebody has built a second receiving.
    assert.ok(!/services\/(receiving|transfer|cycleCount|return|bin)/i.test(SHELL),
      "the shell must reach workflows through ScanWorkspace, never a command client of its own");
    assert.match(SHELL, /ScanWorkspace/);
  });

  test("NO CLIENT-DIRECT FIRESTORE WRITE anywhere in the handheld", () => {
    const offenders = [
      "src/modules/warehouse/WarehouseShell.jsx",
      "src/domain/warehouseHandheld.js",
      "src/domain/structuredFields.js",
      "src/shared/ui/StructuredFields.jsx",
    ].filter((f) => /(setDoc|updateDoc|addDoc|deleteDoc|writeBatch)\s*\(/.test(read(f)));
    assert.deepEqual(offenders, []);
  });
});
