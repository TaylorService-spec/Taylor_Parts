// Inventory > Transfers -- OFFLINE tests for the pure presentation helpers (house check()/passed
// convention). These compose the CANONICAL buildTransferOrdersView row shape; they do not re-map
// raw docs. No Firebase/network. A parity assertion pins the status set to the domain authority
// (TRANSFER_ORDER_STATUSES) so the two can't drift.
import assert from "node:assert/strict";
import {
  TRANSFER_STATUS_META,
  TRANSFER_FILTERS,
  DEFAULT_TRANSFER_FILTER,
  filterTransfers,
  countForFilter,
  summarizeTransfers,
  transferStatusLabel,
  transferStatusTone,
} from "../src/domain/transfersView.js";
import { TRANSFER_ORDER_STATUSES } from "../src/domain/inventoryTransferPairing.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("transfersView.test.mjs");

// rows exactly as buildTransferOrdersView produces them.
const row = (id, status) => ({
  transferOrderId: id,
  partId: `part-${id}`,
  status,
  origin: { type: "WAREHOUSE", locationId: "wh-1", label: "Main" },
  destination: { type: "MOBILE", locationId: "truck-14", label: "truck-14" },
});
const ROWS = [row("t1", "REQUESTED"), row("t2", "IN_TRANSIT"), row("t3", "IN_TRANSIT"), row("t4", "COMPLETED"), row("t5", "CANCELLED")];

check("status meta covers exactly the domain-authority statuses (no drift)", () => {
  assert.deepEqual(Object.keys(TRANSFER_STATUS_META).sort(), [...TRANSFER_ORDER_STATUSES].sort());
});
check("labels avoid raw enum casing; tone falls back safely", () => {
  assert.equal(transferStatusLabel("IN_TRANSIT"), "In transit");
  assert.equal(transferStatusLabel("REQUESTED"), "Requested");
  assert.equal(transferStatusLabel("NONSENSE"), "NONSENSE"); // never throws
  assert.equal(transferStatusTone("COMPLETED"), "done");
  assert.equal(transferStatusTone("NONSENSE"), "muted");
});

check("default filter is Active, and it means REQUESTED + IN_TRANSIT", () => {
  assert.equal(DEFAULT_TRANSFER_FILTER, "active");
  const active = filterTransfers(ROWS, "active").map((r) => r.transferOrderId);
  assert.deepEqual(active.sort(), ["t1", "t2", "t3"]);
});
check("filterTransfers: in_transit / completed / cancelled / all", () => {
  assert.deepEqual(filterTransfers(ROWS, "in_transit").map((r) => r.transferOrderId).sort(), ["t2", "t3"]);
  assert.deepEqual(filterTransfers(ROWS, "completed").map((r) => r.transferOrderId), ["t4"]);
  assert.deepEqual(filterTransfers(ROWS, "cancelled").map((r) => r.transferOrderId), ["t5"]);
  assert.equal(filterTransfers(ROWS, "all").length, 5);
});
check("filterTransfers: unknown key -> all (never hides everything), non-array -> []", () => {
  assert.equal(filterTransfers(ROWS, "bogus").length, 5);
  assert.deepEqual(filterTransfers(null, "active"), []);
});

check("countForFilter matches the filtered length for each filter", () => {
  for (const f of TRANSFER_FILTERS) {
    assert.equal(countForFilter(ROWS, f.key), filterTransfers(ROWS, f.key).length);
  }
});

check("summarizeTransfers: per-status counts, total, and inFlight (REQUESTED + IN_TRANSIT)", () => {
  const s = summarizeTransfers(ROWS);
  assert.equal(s.total, 5);
  assert.equal(s.byStatus.REQUESTED, 1);
  assert.equal(s.byStatus.IN_TRANSIT, 2);
  assert.equal(s.byStatus.COMPLETED, 1);
  assert.equal(s.byStatus.CANCELLED, 1);
  assert.equal(s.inFlight, 3);
});
check("summarizeTransfers: non-array / malformed rows -> zeroed, never throws", () => {
  const s = summarizeTransfers(undefined);
  assert.equal(s.total, 0);
  assert.equal(s.inFlight, 0);
  // a row with an unknown status is counted in total but not in any known bucket
  const s2 = summarizeTransfers([{ status: "WHAT" }, { status: "IN_TRANSIT" }]);
  assert.equal(s2.total, 2);
  assert.equal(s2.inFlight, 1);
});

check("filter bar exposes Active/In transit/Completed/Cancelled/All in order", () => {
  assert.deepEqual(TRANSFER_FILTERS.map((f) => f.key), ["active", "in_transit", "completed", "cancelled", "all"]);
});

console.log(`\n${passed} passed, 0 failed`);
