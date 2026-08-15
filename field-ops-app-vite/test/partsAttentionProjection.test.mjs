import test from "node:test";
import assert from "node:assert/strict";
import {
  PARTS_ATTENTION_TYPE,
  DEFAULT_STALE_AFTER_MS,
  partsAttentionItem,
  partsAttentionItems,
  groupPartsAttentionItemsBySection,
  PARTS_ATTENTION_SECTION_ORDER,
} from "../src/domain/partsAttentionProjection.js";

const NOW = 1_000_000_000_000;

test("PENDING_REVIEW / READY_FOR_PARTS_MANAGER / ASSIGNED_TO_PARTS_ASSOCIATE map deterministically to ACTION_ITEM", () => {
  const pending = partsAttentionItem({ id: "r1", partId: "P1", status: "PENDING_REVIEW" });
  assert.equal(pending.attentionType, PARTS_ATTENTION_TYPE.ACTION_ITEM);
  assert.equal(pending.requiresAction, true);
  assert.equal(pending.recipientRole, "REVIEWER");
  assert.equal(pending.sectionLabel, "Pending Review");

  const ready = partsAttentionItem({ id: "r2", partId: "P1", status: "READY_FOR_PARTS_MANAGER" });
  assert.equal(ready.attentionType, PARTS_ATTENTION_TYPE.ACTION_ITEM);
  assert.equal(ready.recipientRole, "PARTS_MANAGER");
  assert.equal(ready.sectionLabel, "Ready for Parts Manager");

  const assigned = partsAttentionItem({ id: "r3", partId: "P1", status: "ASSIGNED_TO_PARTS_ASSOCIATE", assignedToUserId: "u1" });
  assert.equal(assigned.attentionType, PARTS_ATTENTION_TYPE.ACTION_ITEM);
  assert.equal(assigned.recipientUserId, "u1");
  assert.equal(assigned.sectionLabel, "Assigned to You");
});

test("PURCHASING_IN_PROGRESS is NOT automatically an Action Item -- honest actionable-vs-update distinction", () => {
  // Never updated at all -> stale -> ACTION_ITEM.
  const neverUpdated = partsAttentionItem({ id: "r1", partId: "P1", status: "PURCHASING_IN_PROGRESS" }, { nowMs: NOW });
  assert.equal(neverUpdated.attentionType, PARTS_ATTENTION_TYPE.ACTION_ITEM);
  assert.equal(neverUpdated.requiresAction, true);

  // Updated just now -> fresh -> NOTIFICATION, not actionable.
  const fresh = partsAttentionItem(
    { id: "r2", partId: "P1", status: "PURCHASING_IN_PROGRESS", lastPurchasingUpdateAt: NOW - 1000 },
    { nowMs: NOW }
  );
  assert.equal(fresh.attentionType, PARTS_ATTENTION_TYPE.NOTIFICATION);
  assert.equal(fresh.requiresAction, false);

  // Updated long ago (past the stale threshold) -> ACTION_ITEM again.
  const stale = partsAttentionItem(
    { id: "r3", partId: "P1", status: "PURCHASING_IN_PROGRESS", lastPurchasingUpdateAt: NOW - DEFAULT_STALE_AFTER_MS - 1 },
    { nowMs: NOW }
  );
  assert.equal(stale.attentionType, PARTS_ATTENTION_TYPE.ACTION_ITEM);
  assert.equal(stale.requiresAction, true);

  // Custom threshold is honored.
  const customThreshold = partsAttentionItem(
    { id: "r4", partId: "P1", status: "PURCHASING_IN_PROGRESS", lastPurchasingUpdateAt: NOW - 5000 },
    { nowMs: NOW, staleAfterMs: 1000 }
  );
  assert.equal(customThreshold.attentionType, PARTS_ATTENTION_TYPE.ACTION_ITEM);
});

test("terminal / unrecognized statuses yield null -- nothing fabricated, matches today's bell disappearance", () => {
  for (const status of ["RECEIVED", "CANCELLED", "VOIDED", "REJECTED", "BOGUS_STATUS", undefined]) {
    assert.equal(partsAttentionItem({ id: "r1", partId: "P1", status }), null, `status ${status} should yield null`);
  }
});

test("malformed input (missing id/partId) yields null, never a partial/guessed item", () => {
  assert.equal(partsAttentionItem(null), null);
  assert.equal(partsAttentionItem({ partId: "P1", status: "PENDING_REVIEW" }), null);
  assert.equal(partsAttentionItem({ id: "r1", status: "PENDING_REVIEW" }), null);
});

test("deep links target the EXACT canonical Parts destination the bell/PartsList already use", () => {
  const item = partsAttentionItem({ id: "r1", partId: "PRT-1001", status: "PENDING_REVIEW" });
  assert.equal(item.deepLink, "/inventory/PRT-1001?requestId=r1");
});

test("source state remains authoritative -- recipientUserId is EXACTLY assignedToUserId, never widened/invented", () => {
  const noAssignee = partsAttentionItem({ id: "r1", partId: "P1", status: "ASSIGNED_TO_PARTS_ASSOCIATE" });
  assert.equal(noAssignee.recipientUserId, null); // honest, not fabricated
  const withAssignee = partsAttentionItem({ id: "r2", partId: "P1", status: "ASSIGNED_TO_PARTS_ASSOCIATE", assignedToUserId: "specific-uid" });
  assert.equal(withAssignee.recipientUserId, "specific-uid");
  // A malformed (non-string) assignedToUserId is never trusted through.
  const malformedAssignee = partsAttentionItem({ id: "r3", partId: "P1", status: "ASSIGNED_TO_PARTS_ASSOCIATE", assignedToUserId: 12345 });
  assert.equal(malformedAssignee.recipientUserId, null);
});

test("partsAttentionItems: batch form drops malformed/terminal entries, never fabricates a placeholder", () => {
  const items = partsAttentionItems([
    { id: "r1", partId: "P1", status: "PENDING_REVIEW" },
    { id: "r2", partId: "P1", status: "RECEIVED" }, // terminal -> dropped
    null, // malformed -> dropped
    { id: "r3", partId: "P1", status: "READY_FOR_PARTS_MANAGER" },
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.objectId), ["r1", "r3"]);
  assert.equal(partsAttentionItems(null).length, 0);
  assert.equal(partsAttentionItems(undefined).length, 0);
});

test("groupPartsAttentionItemsBySection: fixed order, empty sections omitted, unauthorized/malformed items excluded", () => {
  const items = partsAttentionItems([
    { id: "r1", partId: "P1", status: "ASSIGNED_TO_PARTS_ASSOCIATE", assignedToUserId: "u1" },
    { id: "r2", partId: "P1", status: "PENDING_REVIEW" },
  ]);
  const grouped = groupPartsAttentionItemsBySection(items);
  assert.deepEqual(grouped.map((g) => g.sectionLabel), ["Pending Review", "Assigned to You"]); // fixed order, not insertion order
  assert.equal(grouped.find((g) => g.sectionLabel === "Ready for Parts Manager"), undefined); // empty section omitted
  assert.equal(grouped[0].items.length, 1);
  assert.equal(grouped[0].items[0].objectId, "r2");

  // Malformed items (no sectionLabel) never leak into any group.
  assert.equal(groupPartsAttentionItemsBySection([{ foo: "bar" }, null]).length, 0);
  assert.equal(groupPartsAttentionItemsBySection(null).length, 0);
});

test("PARTS_ATTENTION_SECTION_ORDER is exactly today's four bell sections, in today's order", () => {
  assert.deepEqual(PARTS_ATTENTION_SECTION_ORDER, ["Pending Review", "Ready for Parts Manager", "Assigned to You", "Purchasing Started"]);
});
