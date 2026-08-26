import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptGovernedWorkOrderPartsRecommendation,
  deriveGovernedWorkOrderPartsRecommendation,
  WORK_ORDER_REORDER_ACTION_ID,
} from "../src/domain/workOrderGovernedRecommendation.js";
import { buildWorkOrderPartsReadiness } from "../src/domain/workOrderPartsReadiness.js";
import { deriveWorkOrderIntelligence, AUTHORITY_STATE } from "../src/domain/workOrderIntelligence.js";

const WORK_ORDER_ID = "cIk3hlPDTXH5IB3VHdLy";
const PART_ID = "Z9otE0s7EAp7ABCZEjaQ";

function shortProjection({ eligible = true } = {}) {
  return buildWorkOrderPartsReadiness({
    workOrder: {
      id: WORK_ORDER_ID,
      inventorySnapshot: [{ partId: PART_ID, name: "Seal Kit", sku: "S-100", qtyPlanned: 2 }],
    },
    plannedParts: [{
      partId: PART_ID,
      name: "Seal Kit",
      sku: "S-100",
      qtyPlanned: 2,
      qtyUsed: 0,
      reservedForJob: 0,
      warehouse: { status: "KNOWN", available: 0 },
      truck: { status: "KNOWN", onTruck: 0 },
      procurement: { status: "NONE" },
    }],
    capabilities: {
      warehouse: true,
      truckInventory: true,
      purchasing: true,
      requestReorder: eligible,
    },
  });
}

function wo() {
  return {
    id: WORK_ORDER_ID,
    woNumber: "WO-2026-000873",
    status: "DISPATCHED",
    type: "REPAIR",
    priority: "P2",
    inventorySnapshot: [{ partId: PART_ID, name: "Seal Kit", sku: "S-100", qtyPlanned: 2 }],
  };
}

test("one confirmed SHORT maps to the existing reorder action and nothing new", () => {
  const governed = deriveGovernedWorkOrderPartsRecommendation(shortProjection());
  assert.equal(governed.speak, true);
  assert.deepEqual(governed.recommendation, {
    actionId: WORK_ORDER_REORDER_ACTION_ID,
    label: "Request reorder",
    authority: "ALLOWED",
  });
  assert.equal(governed.execution.partId, PART_ID);
  assert.equal(governed.execution.workOrderId, WORK_ORDER_ID);
  assert.equal(governed.evidence.knownShortfall, 2);

  const modelVisible = JSON.stringify(governed.recommendation);
  assert.doesNotMatch(modelVisible, new RegExp(PART_ID));
  assert.doesNotMatch(modelVisible, new RegExp(WORK_ORDER_ID));
  assert.doesNotMatch(modelVisible, /requestedQty|recommendedQty|manualQty/);
});

test("the entire North Star intelligence payload stays raw-id-free even when it recommends reorder", () => {
  const intelligence = deriveWorkOrderIntelligence(wo(), { partsReadiness: shortProjection() });
  assert.equal(intelligence.speak, true);
  assert.equal(intelligence.recommendedAction.actionId, WORK_ORDER_REORDER_ACTION_ID);
  assert.equal(intelligence.authority.state, AUTHORITY_STATE.ALLOWED);
  assert.match(intelligence.attentionItem.fact, /Recommended next step: Request reorder/i);

  const encoded = JSON.stringify(intelligence);
  assert.doesNotMatch(encoded, new RegExp(PART_ID));
  assert.doesNotMatch(encoded, new RegExp(WORK_ORDER_ID));
  assert.doesNotMatch(encoded, /requestedQty|recommendedQty|manualQty/);
});

test("existing procurement never creates a duplicate reorder recommendation", () => {
  const projection = buildWorkOrderPartsReadiness({
    workOrder: { id: WORK_ORDER_ID },
    plannedParts: [{
      partId: PART_ID,
      name: "Seal Kit",
      qtyPlanned: 2,
      reservedForJob: 0,
      warehouse: { status: "KNOWN", available: 0 },
      truck: { status: "KNOWN", onTruck: 0 },
      procurement: { status: "PENDING" },
    }],
    capabilities: { warehouse: true, truckInventory: true, purchasing: true, requestReorder: true },
  });
  assert.equal(projection.rows[0].reason, "PROCUREMENT_PENDING");
  assert.equal(deriveGovernedWorkOrderPartsRecommendation(projection).speak, false);
});

test("unknown truck inventory remains UNKNOWN and cannot become a reorder recommendation", () => {
  const projection = buildWorkOrderPartsReadiness({
    workOrder: { id: WORK_ORDER_ID },
    plannedParts: [{
      partId: PART_ID,
      name: "Seal Kit",
      qtyPlanned: 2,
      reservedForJob: 0,
      warehouse: { status: "KNOWN", available: 0 },
      truck: { status: "UNAVAILABLE" },
      procurement: { status: "NONE" },
    }],
    capabilities: { warehouse: true, truckInventory: false, purchasing: true, requestReorder: true },
  });
  assert.equal(projection.rows[0].readiness, "UNKNOWN");
  assert.equal(deriveGovernedWorkOrderPartsRecommendation(projection).speak, false);
});

test("ineligible caller gets no model-visible action even when shortage is confirmed", () => {
  const governed = deriveGovernedWorkOrderPartsRecommendation(shortProjection({ eligible: false }));
  assert.equal(governed.speak, false);
  assert.equal(governed.authority, "DENIED");
  assert.equal(governed.recommendation, null);
  assert.equal(governed.execution, null);
});

test("multiple shortages fail closed instead of letting AI choose which part matters more", () => {
  const projection = shortProjection();
  projection.rows.push({ ...projection.rows[0], partId: "AnotherPart", name: "Second part" });
  projection.counts.ATTENTION = 2;
  const governed = deriveGovernedWorkOrderPartsRecommendation(projection);
  assert.equal(governed.speak, false);
  assert.equal(governed.reason, "MULTIPLE_CONFIRMED_SHORTAGES");
});

test("human acceptance calls the existing reorder seam with current analytics and invents no quantity", async () => {
  const governed = deriveGovernedWorkOrderPartsRecommendation(shortProjection());
  const currentInventoryRecommendation = {
    recommendationStatus: "READY",
    recommendedOrderQty: 4,
    urgency: "HIGH",
  };
  let received = null;
  const result = await acceptGovernedWorkOrderPartsRecommendation({
    governedRecommendation: governed,
    currentInventoryRecommendation,
    requestReorder: async (args) => {
      received = args;
      return { id: "existing-reorder-request" };
    },
  });

  assert.deepEqual(received, {
    partId: PART_ID,
    recommendation: currentInventoryRecommendation,
    manualQty: null,
    workOrderId: WORK_ORDER_ID,
  });
  assert.deepEqual(result, { id: "existing-reorder-request" });
});

test("acceptance refuses to execute without a current inventory recommendation", () => {
  const governed = deriveGovernedWorkOrderPartsRecommendation(shortProjection());
  assert.throws(
    () => acceptGovernedWorkOrderPartsRecommendation({
      governedRecommendation: governed,
      currentInventoryRecommendation: null,
      requestReorder: () => null,
    }),
    /AI may not invent reorder quantity/,
  );
});
