import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildWorkOrderIntelligenceContext,
  deriveWorkOrderIntelligence,
  mergeWorkOrderAttention,
  INTELLIGENCE_ORIGIN,
  AUTHORITY_STATE,
  NO_INSIGHT_REASON,
} from "../src/domain/workOrderIntelligence.js";
import { buildWorkOrderPartsReadiness } from "../src/domain/workOrderPartsReadiness.js";
import { resolveEnvironment } from "../../scripts/resolveEnvironment.mjs";

const wo = (over = {}) => ({
  id: "cIk3hlPDTXH5IB3VHdLy",
  woNumber: "WO-2026-000873",
  status: "DISPATCHED",
  type: "REPAIR",
  priority: "P2",
  customerId: "aBcDeFgHiJkLmNoPqRsT",
  scheduledTechId: "uVwXyZ0123456789AbCd",
  inventorySnapshot: [
    { partId: "V4otE0s7EAp7ABCZEjam", name: "Scraper Blade Kit", sku: "X49463-3", qtyPlanned: 2 },
    { partId: "Z9otE0s7EAp7ABCZEjaQ", name: "Seal Kit", sku: "S-100", qtyPlanned: 1 },
  ],
  ...over,
});

const readiness = (over = {}) => ({
  workOrderId: "cIk3hlPDTXH5IB3VHdLy",
  plannedCount: 2,
  jobReadiness: "UNKNOWN",
  counts: { READY: 1, ATTENTION: 0, UNKNOWN: 1 },
  degraded: ["truckInventory"],
  rows: [
    { partId: "V4otE0s7EAp7ABCZEjam", name: "Scraper Blade Kit", qtyPlanned: 2, readiness: "READY", reason: "WAREHOUSE_AVAILABLE", knownShortfall: 0 },
    { partId: "Z9otE0s7EAp7ABCZEjaQ", name: "Seal Kit", qtyPlanned: 1, readiness: "UNKNOWN", reason: "TRUCK_UNAVAILABLE", knownShortfall: 1 },
  ],
  ...over,
});

test("the context is an explicit model-safe shape, not a database handle", () => {
  const context = buildWorkOrderIntelligenceContext(wo(), { partsReadiness: readiness() });
  assert.equal(context.schemaVersion, 1);
  assert.equal(context.subject.reference, "WO-2026-000873");
  assert.equal(context.subject.status, "DISPATCHED");
  assert.equal(context.parts.plannedLineCount, 2);
  assert.equal(context.parts.plannedQuantity, 3);
  assert.equal(context.parts.readinessProjectionAvailable, true);
  assert.equal(context.parts.readiness.jobReadiness, "UNKNOWN");

  const encoded = JSON.stringify(context);
  for (const rawId of [
    "cIk3hlPDTXH5IB3VHdLy",
    "aBcDeFgHiJkLmNoPqRsT",
    "uVwXyZ0123456789AbCd",
    "V4otE0s7EAp7ABCZEjam",
    "Z9otE0s7EAp7ABCZEjaQ",
  ]) assert.doesNotMatch(encoded, new RegExp(rawId));
  assert.equal("id" in context.subject, false);
  assert.equal("customerId" in context.subject, false);
  assert.equal("partId" in context.parts.readiness.rows[0], false);
});

test("no assembled readiness projection stays quiet instead of filling the attention band", () => {
  const signal = deriveWorkOrderIntelligence(wo());
  assert.equal(signal.speak, false);
  assert.equal(signal.origin, INTELLIGENCE_ORIGIN.DETERMINISTIC);
  assert.equal(signal.reason, NO_INSIGHT_REASON.READINESS_NOT_ASSEMBLED);
  assert.equal(signal.attentionItem, null);
  assert.equal(signal.observedFact, null);
});

test("UNKNOWN canonical readiness stays quiet because uncertainty is already rendered by the parts surface", () => {
  const signal = deriveWorkOrderIntelligence(wo(), { partsReadiness: readiness() });
  assert.equal(signal.speak, false);
  assert.equal(signal.reason, NO_INSIGHT_REASON.READINESS_UNKNOWN);
  assert.equal(signal.attentionItem, null);
  assert.equal(signal.recommendedAction, null);
  assert.equal(signal.evidence.length, 0);
});

test("READY canonical readiness is quiet -- clean is the signal", () => {
  const signal = deriveWorkOrderIntelligence(wo(), {
    partsReadiness: readiness({
      jobReadiness: "READY",
      counts: { READY: 2, ATTENTION: 0, UNKNOWN: 0 },
      degraded: [],
    }),
  });
  assert.equal(signal.speak, false);
  assert.equal(signal.reason, NO_INSIGHT_REASON.PARTS_READY);
  assert.equal(signal.attentionItem, null);
});

test("ATTENTION canonical readiness is explained, not independently re-derived", () => {
  const signal = deriveWorkOrderIntelligence(wo(), {
    partsReadiness: readiness({
      jobReadiness: "ATTENTION",
      counts: { READY: 1, ATTENTION: 1, UNKNOWN: 0 },
      degraded: ["truckInventory"],
      rows: [
        { partId: "V4otE0s7EAp7ABCZEjam", name: "Scraper Blade Kit", qtyPlanned: 2, readiness: "READY", reason: "WAREHOUSE_AVAILABLE", knownShortfall: 0 },
        { partId: "Z9otE0s7EAp7ABCZEjaQ", name: "Seal Kit", qtyPlanned: 1, readiness: "ATTENTION", reason: "PROCUREMENT_PENDING", knownShortfall: 1 },
      ],
    }),
  });
  assert.equal(signal.speak, true);
  assert.equal(signal.origin, INTELLIGENCE_ORIGIN.DETERMINISTIC);
  assert.equal(signal.key, "parts-readiness-attention");
  assert.match(signal.observedFact, /1 needs attention; 1 ready/i);
  assert.match(signal.businessConsequence, /not be treated as fully parts-ready/i);
  assert.match(signal.attentionItem.fact, /needs attention/i);
  assert.equal(signal.recommendedAction, null, "projection evidence does not create a new governed command");
  assert.equal(signal.authority.state, AUTHORITY_STATE.NOT_APPLICABLE);
  assert.equal(signal.evidence.length, 2);
  assert.equal(signal.evidence[1].kind, "WORK_ORDER_PARTS_READINESS");
});

test("trusted source dimensions flow through the canonical readiness projection before intelligence speaks", () => {
  const serverContext = {
    plannedParts: [
      {
        name: "Scraper Blade Kit",
        sku: "X49463-3",
        qtyPlanned: 2,
        qtyUsed: 0,
        reservedForJob: 0,
        warehouse: { status: "KNOWN", available: 2 },
        truck: { status: "UNAVAILABLE" },
        procurement: { status: "NONE" },
      },
      {
        name: "Seal Kit",
        sku: "S-100",
        qtyPlanned: 1,
        qtyUsed: 0,
        reservedForJob: 0,
        warehouse: { status: "KNOWN", available: 0 },
        truck: { status: "UNAVAILABLE" },
        procurement: { status: "PENDING" },
      },
    ],
    capabilities: { warehouse: true, truckInventory: false, purchasing: true },
  };
  const projection = buildWorkOrderPartsReadiness({
    workOrder: wo(),
    plannedParts: serverContext.plannedParts,
    capabilities: serverContext.capabilities,
  });
  assert.equal(projection.jobReadiness, "ATTENTION");
  assert.deepEqual(projection.counts, { READY: 1, ATTENTION: 1, UNKNOWN: 0 });

  const signal = deriveWorkOrderIntelligence(wo(), { partsReadiness: projection });
  assert.equal(signal.speak, true);
  assert.equal(signal.attentionItem.key, "parts-readiness-attention");
});

test("the client transport is fail-closed before Firebase loads and sends only workOrderId", () => {
  const source = readFileSync(
    new URL("../src/services/workOrderReadinessContextClient.js", import.meta.url),
    "utf8",
  );
  const gate = source.indexOf("if (!WORK_ORDER_READINESS_CONTEXT_READY)");
  const firebaseImport = source.indexOf('import("firebase/functions")');
  assert.ok(gate >= 0 && firebaseImport > gate, "transport must refuse before dynamically loading Firebase");
  assert.match(source, /callable\(\{ workOrderId: workOrderId\.trim\(\) \}\)/);
  for (const forbidden of ["partId:", "customerId:", "warehouseId:", "reorderRequestId:"]) {
    assert.doesNotMatch(source, new RegExp(forbidden));
  }
});

test("every environment explicitly declares the Work Order readiness transport and it remains off", () => {
  const registry = JSON.parse(readFileSync(new URL("../../config/environments.json", import.meta.url), "utf8"));
  for (const env of registry.environments) {
    assert.equal(typeof env.readiness?.WORK_ORDER_READINESS_CONTEXT_READY, "boolean", env.id);
    assert.equal(env.readiness.WORK_ORDER_READINESS_CONTEXT_READY, false, env.id);
  }
  const sandbox = resolveEnvironment(registry, "platform-sandbox");
  assert.equal(sandbox.readiness.WORK_ORDER_READINESS_CONTEXT_READY, false);
});

test("the intelligence signal attaches to the existing attention channel instead of creating a second band", () => {
  const existing = [{ key: "schedule-window-passed", severity: "ATTENTION", fact: "Scheduled window has passed." }];
  const signal = deriveWorkOrderIntelligence(wo(), {
    partsReadiness: readiness({
      jobReadiness: "ATTENTION",
      counts: { READY: 1, ATTENTION: 1, UNKNOWN: 0 },
    }),
  });
  const merged = mergeWorkOrderAttention(existing, signal);
  assert.equal(merged.length, 2);
  assert.equal(merged[0], existing[0], "existing North Star attention remains first");
  assert.equal(merged[1].key, "parts-readiness-attention");
});

test("quiet intelligence contributes no attention item", () => {
  const existing = [{ key: "schedule-window-passed", severity: "ATTENTION", fact: "Scheduled window has passed." }];
  const merged = mergeWorkOrderAttention(existing, deriveWorkOrderIntelligence(wo()));
  assert.deepEqual(merged, existing);
});

test("attention attachment de-duplicates by fact key", () => {
  const existing = [{ key: "parts-readiness-attention", severity: "ATTENTION", fact: "Existing owner." }];
  const signal = deriveWorkOrderIntelligence(wo(), {
    partsReadiness: readiness({ jobReadiness: "ATTENTION", counts: { READY: 1, ATTENTION: 1, UNKNOWN: 0 } }),
  });
  const merged = mergeWorkOrderAttention(existing, signal);
  assert.deepEqual(merged, existing, "one fact must never render twice");
});

test("no parts plan stays quiet because the existing attention rule already owns that fact", () => {
  const signal = deriveWorkOrderIntelligence(wo({ inventorySnapshot: [] }));
  assert.equal(signal.speak, false);
  assert.equal(signal.reason, NO_INSIGHT_REASON.NO_GOVERNED_PARTS_PLAN);
  assert.equal(signal.attentionItem, null);
});

test("completed, closed, and cancelled Work Orders stay quiet", () => {
  for (const status of ["COMPLETED", "CLOSED", "CANCELLED"]) {
    const signal = deriveWorkOrderIntelligence(wo({ status }), { partsReadiness: readiness() });
    assert.equal(signal.speak, false, status);
    assert.equal(signal.reason, NO_INSIGHT_REASON.RECORD_CLOSED, status);
    assert.equal(signal.attentionItem, null, status);
  }
});

test("missing record is a no-insight state, not an exception", () => {
  const signal = deriveWorkOrderIntelligence(null);
  assert.equal(signal.speak, false);
  assert.equal(signal.reason, NO_INSIGHT_REASON.NO_ACTIONABLE_SIGNAL);
  assert.equal(signal.context, null);
});

test("recommendation and authority remain empty until an existing governed action is actually proposed", () => {
  const signal = deriveWorkOrderIntelligence(wo(), {
    partsReadiness: readiness({ jobReadiness: "ATTENTION", counts: { READY: 1, ATTENTION: 1, UNKNOWN: 0 } }),
  });
  assert.equal(signal.recommendedAction, null);
  assert.equal(signal.authority.state, AUTHORITY_STATE.NOT_APPLICABLE);
  assert.equal(signal.authority.action, null);
});

test("the entire intelligence payload excludes raw document ids", () => {
  const payload = deriveWorkOrderIntelligence(wo(), {
    partsReadiness: readiness({ jobReadiness: "ATTENTION", counts: { READY: 1, ATTENTION: 1, UNKNOWN: 0 } }),
  });
  const encoded = JSON.stringify(payload);
  const RAW = /\b[A-Za-z0-9]{20}\b/;
  assert.doesNotMatch(encoded, RAW, "a Firestore-shaped id crossed the intelligence boundary");
});
