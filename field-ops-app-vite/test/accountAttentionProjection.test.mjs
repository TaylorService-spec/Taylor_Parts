import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_ATTENTION_TYPE,
  ACCOUNT_ATTENTION_SOURCE_STATUS,
  ACCOUNT_ATTENTION_SECTION_ORDER,
  accountArAttentionItems,
  accountWorkOrderPastDueItems,
  accountAttentionItems,
  groupAccountAttentionItemsBySection,
} from "../src/domain/accountAttentionProjection.js";
import { ACCOUNT_AR_STATE } from "../src/domain/accountArView.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 5, 10, 12, 0, 0, 0).getTime();
const TODAY_START = new Date(2026, 5, 10, 0, 0, 0, 0).getTime();

// ---- Source 1: AR overdue (composed from accountArView output) ---------------------------------------

test("READY AR view with an OVERDUE row -> one ACTION_ITEM under 'Accounts Receivable'", () => {
  const arView = {
    kind: ACCOUNT_AR_STATE.READY,
    rows: [
      { key: "inv-1", invoiceNumber: "INV-1001", position: "OVERDUE", outstandingText: "USD 500.00", daysOverdueText: "12d overdue" },
    ],
  };
  const { items, sourceStatus } = accountArAttentionItems(arView, { accountId: "acct-1" });
  assert.equal(sourceStatus, ACCOUNT_ATTENTION_SOURCE_STATUS.READY);
  assert.equal(items.length, 1);
  const item = items[0];
  assert.equal(item.attentionType, ACCOUNT_ATTENTION_TYPE.ACTION_ITEM);
  assert.equal(item.requiresAction, true);
  assert.equal(item.sectionLabel, "Accounts Receivable");
  assert.equal(item.deepLink, "/customers/acct-1#account-ar-section");
  assert.equal(item.invoiceNumber, "INV-1001");
  assert.equal(item.outstandingText, "USD 500.00");
  assert.equal(item.daysOverdueText, "12d overdue");
});

test("READY AR view with CURRENT/SETTLED/VOID rows -> no items (only OVERDUE surfaces)", () => {
  const arView = {
    kind: ACCOUNT_AR_STATE.READY,
    rows: [
      { key: "inv-1", position: "CURRENT" },
      { key: "inv-2", position: "SETTLED" },
      { key: "inv-3", position: "VOID" },
    ],
  };
  const { items, sourceStatus } = accountArAttentionItems(arView, { accountId: "acct-1" });
  assert.equal(items.length, 0);
  assert.equal(sourceStatus, ACCOUNT_ATTENTION_SOURCE_STATUS.READY); // confirmed healthy, not "unavailable"
});

test("multiple OVERDUE invoices each produce their own distinct item", () => {
  const arView = {
    kind: ACCOUNT_AR_STATE.READY,
    rows: [
      { key: "inv-1", position: "OVERDUE" },
      { key: "inv-2", position: "OVERDUE" },
    ],
  };
  const { items } = accountArAttentionItems(arView, { accountId: "acct-1" });
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.objectId).sort(), ["inv-1", "inv-2"]);
});

test("EMPTY AR view (zero invoices at all) is confirmed healthy, not unavailable", () => {
  const { items, sourceStatus } = accountArAttentionItems({ kind: ACCOUNT_AR_STATE.EMPTY }, { accountId: "acct-1" });
  assert.equal(items.length, 0);
  assert.equal(sourceStatus, ACCOUNT_ATTENTION_SOURCE_STATUS.READY);
});

test("LOADING/DENIED/UNAVAILABLE AR views degrade honestly and never produce a fake zero", () => {
  for (const [kind, expected] of [
    [ACCOUNT_AR_STATE.LOADING, ACCOUNT_ATTENTION_SOURCE_STATUS.LOADING],
    [ACCOUNT_AR_STATE.DENIED, ACCOUNT_ATTENTION_SOURCE_STATUS.DENIED],
    [ACCOUNT_AR_STATE.UNAVAILABLE, ACCOUNT_ATTENTION_SOURCE_STATUS.UNAVAILABLE],
  ]) {
    const { items, sourceStatus } = accountArAttentionItems({ kind }, { accountId: "acct-1" });
    assert.equal(items.length, 0);
    assert.equal(sourceStatus, expected, `kind ${kind}`);
  }
});

test("malformed AR view / missing accountId yields unavailable, never throws", () => {
  assert.deepEqual(accountArAttentionItems(null, { accountId: "acct-1" }).items, []);
  assert.equal(accountArAttentionItems(null, { accountId: "acct-1" }).sourceStatus, ACCOUNT_ATTENTION_SOURCE_STATUS.UNAVAILABLE);
  assert.equal(accountArAttentionItems({ kind: ACCOUNT_AR_STATE.READY, rows: [] }, {}).sourceStatus, ACCOUNT_ATTENTION_SOURCE_STATUS.UNAVAILABLE);
  assert.doesNotThrow(() => accountArAttentionItems({ kind: "BOGUS" }, { accountId: "acct-1" }));
});

test("a malformed row (missing key, non-object) is silently dropped, never fabricated", () => {
  const arView = { kind: ACCOUNT_AR_STATE.READY, rows: [{ position: "OVERDUE" }, null, "not-an-object", { key: "inv-9", position: "OVERDUE" }] };
  const { items } = accountArAttentionItems(arView, { accountId: "acct-1" });
  assert.equal(items.length, 1);
  assert.equal(items[0].objectId, "inv-9");
});

// ---- Source 2: WO past due (account-scoped, composed from workOrderPastDueItem) -----------------------

test("a SCHEDULED WO past due composes into an ACTION_ITEM under 'Past Due' (reused sectionLabel)", () => {
  const workOrders = [{ id: "WO-1", woNumber: "WO-1001", status: "SCHEDULED", scheduledStart: TODAY_START - DAY }];
  const { items, sourceStatus } = accountWorkOrderPastDueItems(workOrders, { nowMs: NOW });
  assert.equal(sourceStatus, ACCOUNT_ATTENTION_SOURCE_STATUS.READY);
  assert.equal(items.length, 1);
  assert.equal(items[0].attentionType, ACCOUNT_ATTENTION_TYPE.ACTION_ITEM);
  assert.equal(items[0].sectionLabel, "Past Due");
  assert.equal(items[0].deepLink, "/service/work-orders/WO-1"); // canonical WO route, not fabricated
});

test("SCHEDULED for today/future, or non-SCHEDULED, never produces a past-due item", () => {
  const workOrders = [
    { id: "WO-1", status: "SCHEDULED", scheduledStart: TODAY_START },
    { id: "WO-2", status: "SCHEDULED", scheduledStart: TODAY_START + DAY },
    { id: "WO-3", status: "COMPLETED", scheduledStart: TODAY_START - DAY },
  ];
  const { items } = accountWorkOrderPastDueItems(workOrders, { nowMs: NOW });
  assert.equal(items.length, 0);
});

test("a fully-healthy account's WO read (confirmed empty array) is READY with zero items -- not unavailable", () => {
  const { items, sourceStatus } = accountWorkOrderPastDueItems([], { nowMs: NOW });
  assert.equal(items.length, 0);
  assert.equal(sourceStatus, ACCOUNT_ATTENTION_SOURCE_STATUS.READY);
});

test("non-array workOrders (failed/loading read) degrades to unavailable, never a fabricated empty list", () => {
  assert.equal(accountWorkOrderPastDueItems(null).sourceStatus, ACCOUNT_ATTENTION_SOURCE_STATUS.UNAVAILABLE);
  assert.equal(accountWorkOrderPastDueItems(undefined).sourceStatus, ACCOUNT_ATTENTION_SOURCE_STATUS.UNAVAILABLE);
  assert.equal(accountWorkOrderPastDueItems("not-an-array").sourceStatus, ACCOUNT_ATTENTION_SOURCE_STATUS.UNAVAILABLE);
});

test("accountWorkOrderPastDueItems never throws on malformed WO entries", () => {
  assert.doesNotThrow(() => accountWorkOrderPastDueItems([null, { id: "WO-1" }, "not-an-object"], { nowMs: NOW }));
});

// ---- Batch + grouping ----------------------------------------------------------------------------------

test("accountAttentionItems composes both sources into one flat list with a per-source status map", () => {
  const arView = { kind: ACCOUNT_AR_STATE.READY, rows: [{ key: "inv-1", position: "OVERDUE" }] };
  const workOrders = [{ id: "WO-1", status: "SCHEDULED", scheduledStart: TODAY_START - DAY }];
  const { items, sourceStatus } = accountAttentionItems({ accountId: "acct-1", arView, workOrders, nowMs: NOW });
  assert.equal(items.length, 2);
  assert.equal(sourceStatus.ar, ACCOUNT_ATTENTION_SOURCE_STATUS.READY);
  assert.equal(sourceStatus.workOrder, ACCOUNT_ATTENTION_SOURCE_STATUS.READY);
});

test("a fully-healthy account (AR empty, no past-due WOs) yields an honest empty projection", () => {
  const { items, sourceStatus } = accountAttentionItems({
    accountId: "acct-1",
    arView: { kind: ACCOUNT_AR_STATE.EMPTY },
    workOrders: [],
    nowMs: NOW,
  });
  assert.deepEqual(items, []);
  assert.equal(sourceStatus.ar, ACCOUNT_ATTENTION_SOURCE_STATUS.READY);
  assert.equal(sourceStatus.workOrder, ACCOUNT_ATTENTION_SOURCE_STATUS.READY);
});

test("an unavailable AR source degrades that source alone -- the WO source's own confirmed items still surface", () => {
  const workOrders = [{ id: "WO-1", status: "SCHEDULED", scheduledStart: TODAY_START - DAY }];
  const { items, sourceStatus } = accountAttentionItems({
    accountId: "acct-1",
    arView: { kind: ACCOUNT_AR_STATE.UNAVAILABLE },
    workOrders,
    nowMs: NOW,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].domain, "workOrder");
  assert.equal(sourceStatus.ar, ACCOUNT_ATTENTION_SOURCE_STATUS.UNAVAILABLE);
  assert.equal(sourceStatus.workOrder, ACCOUNT_ATTENTION_SOURCE_STATUS.READY);
});

test("default (no args) yields an empty, unavailable-sourced projection, never throws", () => {
  const { items, sourceStatus } = accountAttentionItems();
  assert.deepEqual(items, []);
  assert.equal(sourceStatus.ar, ACCOUNT_ATTENTION_SOURCE_STATUS.UNAVAILABLE);
  assert.equal(sourceStatus.workOrder, ACCOUNT_ATTENTION_SOURCE_STATUS.UNAVAILABLE);
});

test("groupAccountAttentionItemsBySection: fixed order, AR and WO past-due kept in DISTINCT sections (never interleaved/ranked)", () => {
  const arView = { kind: ACCOUNT_AR_STATE.READY, rows: [{ key: "inv-1", position: "OVERDUE" }] };
  const workOrders = [{ id: "WO-1", status: "SCHEDULED", scheduledStart: TODAY_START - DAY }];
  const { items } = accountAttentionItems({ accountId: "acct-1", arView, workOrders, nowMs: NOW });
  const grouped = groupAccountAttentionItemsBySection(items);
  assert.deepEqual(grouped.map((g) => g.sectionLabel), ["Accounts Receivable", "Past Due"]);
  assert.equal(grouped[0].items.length, 1);
  assert.equal(grouped[0].items[0].domain, "ar");
  assert.equal(grouped[1].items.length, 1);
  assert.equal(grouped[1].items[0].domain, "workOrder");
});

test("groupAccountAttentionItemsBySection omits an empty section rather than rendering it blank", () => {
  const workOrders = [{ id: "WO-1", status: "SCHEDULED", scheduledStart: TODAY_START - DAY }];
  const { items } = accountAttentionItems({ accountId: "acct-1", arView: { kind: ACCOUNT_AR_STATE.EMPTY }, workOrders, nowMs: NOW });
  const grouped = groupAccountAttentionItemsBySection(items);
  assert.deepEqual(grouped.map((g) => g.sectionLabel), ["Past Due"]);
});

test("groupAccountAttentionItemsBySection: malformed input never throws", () => {
  assert.deepEqual(groupAccountAttentionItemsBySection(null), []);
  assert.deepEqual(groupAccountAttentionItemsBySection([{ foo: "bar" }, null]), []);
});

test("ACCOUNT_ATTENTION_SECTION_ORDER is the exact, stable two-section order", () => {
  assert.deepEqual(ACCOUNT_ATTENTION_SECTION_ORDER, ["Accounts Receivable", "Past Due"]);
});

// ---- No raw UID -----------------------------------------------------------------------------------------

test("no item field ever carries a raw actor/user identifier -- neither AR nor WO signal reads or exposes one", () => {
  const arView = { kind: ACCOUNT_AR_STATE.READY, rows: [{ key: "inv-1", position: "OVERDUE", invoiceNumber: "INV-1", outstandingText: "USD 1.00", daysOverdueText: "1d overdue" }] };
  const workOrders = [{ id: "WO-1", woNumber: "WO-1001", status: "SCHEDULED", scheduledStart: TODAY_START - DAY }];
  const { items } = accountAttentionItems({ accountId: "acct-1", arView, workOrders, nowMs: NOW });
  const forbiddenKeys = ["userId", "uid", "actorId", "recipientUserId", "createdBy", "assignedToUserId"];
  for (const item of items) {
    for (const key of forbiddenKeys) {
      assert.equal(Object.prototype.hasOwnProperty.call(item, key), false, `item unexpectedly carries ${key}`);
    }
  }
});
