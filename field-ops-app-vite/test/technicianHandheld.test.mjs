// What a technician's phone shows, in what order, and what it is allowed to claim.
//
// The screen has room for one answer. These are the decisions behind which answer it is -- kept here
// rather than in JSX so the next person changes them deliberately rather than while adjusting a
// margin.
import test from "node:test";
import assert from "node:assert/strict";
import {
  HANDHELD_TABS, MORE_ITEMS, SYNC_STATE, SYNC_PRESENTATION, OFFLINE_MATRIX,
  composeTechnicianHome, composeJobCard, composeJobCards, homePrimaryActionLabel, assertMoreIsSmall,
} from "../src/domain/technicianHandheld.js";
import { sortFieldWorkOrders, awaitingDispatchWorkOrders } from "../src/domain/fieldWorkOrder.js";
import { withTruckStock, sumTruckStock } from "../src/domain/fieldTruckReadiness.js";
import { describeExecutionOutcome } from "../src/domain/executionOutcome.js";
import { buildWorkOrderPartsReadiness } from "../src/domain/workOrderPartsReadiness.js";

const wo = (over = {}) => ({
  id: over.id ?? "wo1", woNumber: over.woNumber ?? "WO-2026-000001",
  status: "WORK_IN_PROGRESS", type: "SERVICE_CALL",
  customerId: "acct-1", locationId: "loc-1", assignedTechId: "tech-1", ...over,
});

// ── THE FOUR TABS ─────────────────────────────────────────────────────────────────────────────

test("there are exactly four tabs", () => {
  // More than four is a desktop menu wearing a phone's clothes.
  assert.deepEqual(HANDHELD_TABS.map((t) => t.key), ["home", "jobs", "scan", "more"]);
});

test("More is a CLOSED list -- no desktop domain can be smuggled in", () => {
  // "More" is where a handheld app goes to die: every module that does not fit the four tabs ends up
  // there and the phone becomes a menu.
  assert.equal(assertMoreIsSmall(MORE_ITEMS), true);
  assert.equal(assertMoreIsSmall([...MORE_ITEMS, { key: "purchasing", label: "Purchasing" }]), false);
  assert.equal(assertMoreIsSmall([{ key: "reporting", label: "Reports" }]), false);
  for (const forbidden of ["crm", "purchasing", "reporting", "administration", "sales", "inventory"]) {
    assert.equal(MORE_ITEMS.some((i) => i.key === forbidden), false, `${forbidden} must not be in More`);
  }
});

// ── HOME ──────────────────────────────────────────────────────────────────────────────────────

test("Home's order is the CANONICAL field order, not a second rule", () => {
  // A second ordering rule would be a second answer to "what is next", and the two would disagree
  // the first time somebody touched one.
  const list = [wo({ id: "a", status: "DISPATCHED", woNumber: "WO-3" }),
                wo({ id: "b", status: "WORK_IN_PROGRESS", woNumber: "WO-1" }),
                wo({ id: "c", status: "ACCEPTED", woNumber: "WO-2" })];
  const home = composeTechnicianHome({ workOrders: list });
  assert.deepEqual(home.today.map((w) => w.id), sortFieldWorkOrders(list).map((w) => w.id));
  // The job actually being worked leads.
  assert.equal(home.current.id, "b");
  assert.equal(home.next.id, "c");
});

test("Home is operational, never analytical", () => {
  // A technician's phone is not a dashboard. Asserted structurally so nobody adds revenue to it.
  const home = composeTechnicianHome({ workOrders: [wo()] });
  for (const forbidden of ["revenue", "margin", "kpi", "pipeline", "invoices", "arTotal", "profit"]) {
    assert.equal(forbidden in home, false, `${forbidden} has no place on a technician's home screen`);
  }
  assert.deepEqual(Object.keys(home).sort(),
    ["activeCount", "blocked", "current", "next", "pending", "primaryAction", "today"]);
});

test("no active work means no current job -- and that is said, not implied", () => {
  const home = composeTechnicianHome({ workOrders: [wo({ status: "CLOSED" })] });
  assert.equal(home.current, null);
  assert.equal(home.next, null);
  assert.equal(home.activeCount, 0);
  assert.equal(home.today.length, 1, "a closed job is still assigned work; it is just not active");
});

test("BLOCKED comes from resolved readiness, never a guess", () => {
  const list = [wo({ id: "a" }), wo({ id: "b" }), wo({ id: "c" })];
  const home = composeTechnicianHome({
    workOrders: list,
    readinessByWorkOrder: { a: "MISSING", b: "PARTIAL", c: "READY" },
  });
  assert.deepEqual(home.blocked.map((w) => w.id).sort(), ["a", "b"]);
});

test("a job with NO readiness answer is not blocked -- unknown is not missing", () => {
  // The two mean opposite things to somebody deciding whether to drive to a site.
  const home = composeTechnicianHome({ workOrders: [wo({ id: "a" })], readinessByWorkOrder: {} });
  assert.deepEqual(home.blocked, []);
});

test("UNSYNCED WORK IS SURFACED, and only unsynced work", () => {
  const home = composeTechnicianHome({
    workOrders: [wo()],
    pending: [
      { id: "1", state: SYNC_STATE.PENDING_SYNC },
      { id: "2", state: SYNC_STATE.SYNCED },
      { id: "3", state: SYNC_STATE.CONFLICT },
    ],
  });
  // Synced work is not "pending" -- listing it would train the technician to ignore the section.
  assert.deepEqual(home.pending.map((p) => p.id), ["1", "3"]);
});

test("the primary action comes from the governed matrix", () => {
  // Home does not decide what a technician may do.
  const home = composeTechnicianHome({ workOrders: [wo({ status: "ARRIVED" })] });
  assert.ok(home.primaryAction, "an arrived job has a next action");
  assert.ok(homePrimaryActionLabel(home));
  assert.equal(homePrimaryActionLabel({ primaryAction: null }), null);
});

// ── JOB CARDS ─────────────────────────────────────────────────────────────────────────────────

test("a card carries everything needed to decide, and nothing else", () => {
  const c = composeJobCard(wo({ type: "INSTALL" }), { readiness: "READY", customerName: "Harbor Grill" });
  assert.equal(c.customer, "Harbor Grill");
  assert.equal(c.isInstall, true);
  assert.equal(c.readiness, "READY");
  assert.equal(c.active, true);
  assert.ok(c.woNumber);
});

test("readiness defaults to UNKNOWN, never to READY and never to MISSING", () => {
  assert.equal(composeJobCard(wo()).readiness, "UNKNOWN");
});

test("a card keeps its own id as the WO reference, but NEVER shows a raw customer or site id (TW2)", () => {
  const c = composeJobCard(wo({ woNumber: null, customerId: "acct_9f2c", locationId: "site_41ab" }));
  assert.equal(c.woNumber, "wo1");
  // customerId / locationId are REFERENCES, not names: with no resolved name the card carries null and the screen says why.
  assert.equal(c.customer, null);
  assert.equal(c.location, null);
  assert.ok(!JSON.stringify(c).includes("acct_9f2c") && !JSON.stringify(c).includes("site_41ab"), "no raw reference reaches the card");
});

test("a card carries the names the governed field context resolved (TW2)", () => {
  const c = composeJobCard(wo(), { customerName: "Harbor Grill", locationLabel: "Main kitchen" });
  assert.equal(c.customer, "Harbor Grill");
  assert.equal(c.location, "Main kitchen");
});

// ── TW3: assigned but not dispatched ──────────────────────────────────────────────────────────

test("awaitingDispatchWorkOrders: SCHEDULED jobs are the technician's, sorted soonest first, and active/finished jobs are not in it (TW3)", () => {
  const list = [
    wo({ id: "late", status: "SCHEDULED", scheduledStart: "2026-10-21T16:00:00.000Z" }),
    wo({ id: "soon", status: "SCHEDULED", scheduledStart: "2026-10-20T15:00:00.000Z" }),
    wo({ id: "going", status: "DISPATCHED" }),
    wo({ id: "done", status: "COMPLETED" }),
    wo({ id: "unset", status: "SCHEDULED", scheduledStart: undefined }),
  ];
  assert.deepEqual(awaitingDispatchWorkOrders(list).map((w) => w.id), ["soon", "late", "unset"]);
  assert.deepEqual(awaitingDispatchWorkOrders(null), []);
});

// ── TW4: the technician's own truck, as the projection's `truck` dimension ───────────────────────

test("sumTruckStock adds every truck's quantity per Part", () => {
  assert.deepEqual(
    sumTruckStock([{ quantities: [{ partId: "PRT-1005", onHand: 1 }] }, { quantities: [{ partId: "PRT-1005", onHand: 2 }, { partId: "PRT-2", onHand: 5 }] }, null]),
    { "PRT-1005": 3, "PRT-2": 5 },
  );
});

test("withTruckStock attaches a KNOWN on-truck quantity only when the stock was actually read (TW4)", () => {
  const plan = [{ partId: "PRT-1005", sku: "PRT-1005", qtyPlanned: 1, qtyUsed: 0 }, { partId: "PRT-9", sku: "PRT-9", qtyPlanned: 2, qtyUsed: 0 }];
  const read = withTruckStock(plan, { known: true, onHand: { "PRT-1005": 1 } });
  assert.deepEqual(read.map((p) => p.truck), [{ status: "KNOWN", onTruck: 1 }, { status: "KNOWN", onTruck: 0 }]);
  // not read -> NOTHING attached: the part stays UNKNOWN, never a fabricated zero
  assert.deepEqual(withTruckStock(plan, { known: false, onHand: {} }), plan);
  assert.deepEqual(withTruckStock(plan, null), plan);
});

test("the shared readiness projection turns the truck dimension into READY / UNKNOWN, with truckInventory no longer degraded (TW4)", () => {
  const plan = [{ partId: "PRT-1005", sku: "PRT-1005", qtyPlanned: 1, qtyUsed: 0 }];
  const onTruck = buildWorkOrderPartsReadiness({ plannedParts: withTruckStock(plan, { known: true, onHand: { "PRT-1005": 1 } }), capabilities: { truckInventory: true } });
  assert.equal(onTruck.jobReadiness, "READY");
  assert.equal(onTruck.rows[0].reason, "ON_TRUCK");
  assert.ok(!onTruck.degraded.includes("truckInventory"));
  const short = buildWorkOrderPartsReadiness({ plannedParts: withTruckStock(plan, { known: true, onHand: {} }), capabilities: { truckInventory: true } });
  assert.equal(short.rows[0].dimensions.truck.onTruck, 0);
  assert.notEqual(short.jobReadiness, "READY");
  // before TW4: no stock read -> degraded, as it was
  assert.ok(buildWorkOrderPartsReadiness({ plannedParts: plan, capabilities: {} }).degraded.includes("truckInventory"));
});

test("cards come back in the canonical order", () => {
  const list = [wo({ id: "a", status: "DISPATCHED" }), wo({ id: "b", status: "WORK_IN_PROGRESS" })];
  assert.deepEqual(composeJobCards(list).map((c) => c.workOrderId),
    sortFieldWorkOrders(list).map((w) => w.id));
});

test("malformed input yields nothing, never a throw", () => {
  assert.equal(composeJobCard(null), null);
  assert.deepEqual(composeJobCards(null), []);
  const home = composeTechnicianHome({});
  assert.equal(home.current, null);
});

// ── WHAT MAY BE CLAIMED ───────────────────────────────────────────────────────────────────────

test("ONLY SYNCED may claim the work is complete", () => {
  // A UI built on the assumption that every action completes immediately cannot later be taught
  // otherwise without rewriting it, which is why these exist before the offline runtime does.
  for (const [state, p] of Object.entries(SYNC_PRESENTATION)) {
    assert.equal(p.claimsComplete, state === SYNC_STATE.SYNCED, `${state} claims the wrong thing`);
    assert.ok(p.label.length > 0);
    assert.ok(["ok", "pending", "attention"].includes(p.tone));
  }
});

test("every sync state has a presentation -- none can render as a raw enum", () => {
  for (const state of Object.values(SYNC_STATE)) {
    assert.ok(SYNC_PRESENTATION[state], `${state} would render as a bare identifier`);
  }
});

// ── THE OFFLINE CONTRACT WO-03 INHERITS ───────────────────────────────────────────────────────

test("every technician workflow is classified", () => {
  const required = ["job list", "job detail", "notes", "labor", "parts usage",
    "scan resolution", "equipment installation", "work order completion"];
  assert.deepEqual(OFFLINE_MATRIX.map((r) => r.workflow).sort(), [...required].sort());
});

test("LABOR IS ONLINE-REQUIRED BECAUSE THERE IS NOTHING TO CAPTURE INTO", () => {
  // Not a limitation of the device. No labor write authority exists at all -- see
  // TECHNICIAN LABOR AUTHORITY GAP. Classifying it as capturable would promise a runtime something
  // it could never deliver.
  const labor = OFFLINE_MATRIX.find((r) => r.workflow === "labor");
  assert.equal(labor.capturable, false);
  assert.equal(labor.onlineRequired, true);
  assert.match(labor.note, /NO AUTHORITY EXISTS/);
});

test("work order completion is the SERVER'S, and scan resolution needs the catalogue", () => {
  // Neither is an engineering gap to be closed later: a device may not advance a Work Order, and
  // resolving an identifier needs the data it resolves against.
  const complete = OFFLINE_MATRIX.find((r) => r.workflow === "work order completion");
  assert.equal(complete.capturable, false);
  assert.equal(complete.onlineRequired, true);
  const scan = OFFLINE_MATRIX.find((r) => r.workflow === "scan resolution");
  assert.equal(scan.capturable, true, "the raw identifier can be captured");
  assert.equal(scan.onlineRequired, true, "resolving it cannot");
});

test("nothing capturable claims the platform accepted it", () => {
  for (const row of OFFLINE_MATRIX.filter((r) => r.capturable)) {
    assert.match(row.note, /intent|draft|PENDING_SYNC|until/i,
      `${row.workflow} must say what a capture is worth before the server sees it`);
  }
});

// ── TW5: what recordWorkOrderExecution DID, in words ─────────────────────────────────────────────

const ASK = { qty: 1, label: "Filter", woNumber: "WO-2026-000103", sourceLabel: "Service Truck 01" };
const line = (over) => ({ partId: "PRT-1005", requestedDelta: 1, appliedDelta: 1, qtyUsed: 1, qtyPlanned: 1, ...over });

test("RECORDED says Recorded, with the truck it came from (TW5)", () => {
  const said = describeExecutionOutcome({ outcome: "RECORDED", usage: [line()] }, ASK);
  assert.equal(said.tone, "ok");
  assert.equal(said.applied, true);
  assert.equal(said.text, "Recorded 1 × Filter on WO-2026-000103 from Service Truck 01.");
  // a result with no outcome at all (an older transport) keeps today's wording
  assert.equal(describeExecutionOutcome(undefined, { ...ASK, sourceLabel: null }).text, "Recorded 1 × Filter on WO-2026-000103.");
});

test("NOT_APPLIED never says Recorded: it says the plan is full and who can change that (TW5)", () => {
  const said = describeExecutionOutcome(
    { outcome: "NOT_APPLIED", usage: [line({ appliedDelta: 0, reason: "PLAN_LIMIT_REACHED" })] }, ASK);
  assert.equal(said.tone, "warn");
  assert.equal(said.applied, false);
  assert.doesNotMatch(said.text, /^Recorded/);
  assert.match(said.text, /^Not recorded:/);
  assert.match(said.text, /1 planned, 1 already recorded/);
  assert.match(said.text, /Ask dispatch to raise the parts plan/);
});

test("PARTIALLY_APPLIED says how much of the ask was recorded, and why (TW5)", () => {
  const said = describeExecutionOutcome(
    { outcome: "PARTIALLY_APPLIED", usage: [line({ requestedDelta: 5, appliedDelta: 3, qtyUsed: 3, qtyPlanned: 3, reason: "PLAN_LIMIT_REACHED" })] },
    { ...ASK, qty: 5 });
  assert.equal(said.tone, "warn");
  assert.equal(said.applied, true);
  assert.match(said.text, /^Recorded 3 of 5 × Filter on WO-2026-000103 from Service Truck 01 \(plan limit reached\)/);
});

test("a correction that finds nothing to take back says so (TW5)", () => {
  const said = describeExecutionOutcome(
    { outcome: "NOT_APPLIED", usage: [line({ requestedDelta: -1, appliedDelta: 0, qtyUsed: 0, reason: "NOTHING_TO_REVERSE" })] }, { ...ASK, qty: 1 });
  assert.equal(said.applied, false);
  assert.match(said.text, /^Nothing was taken back/);
});
