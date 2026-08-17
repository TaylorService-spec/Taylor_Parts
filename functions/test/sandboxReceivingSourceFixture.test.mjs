// The sandbox Receiving SOURCE fixture must satisfy the governed Receiving contract.
//
// THE DEFECT THIS PINS. receiveInventoryStockCommand.ts reads the purchase order as
// `reorder_purchase_orders.doc(reorderRequestId)` -- the document KEY is the reorder request id, not
// the human PO number -- and additionally requires
// `reorderRequest.purchaseOrderId === reorderRequestId` when that field is present.
//
// The scenario fixture keyed those documents by "po-sbx-001"/"po-sbx-002" and set the request's
// purchaseOrderId to "po-sbx-001". The content was correct and completely unreachable: live
// Receiving answered NOT_FOUND for a source that plainly existed in Firestore, and the coherence
// check would have rejected it even if the key had matched.
//
// The warehouse half is the same class of bug: seeded warehouses carried provenance "SEEDED", which
// is not a WAREHOUSE_PROVENANCES member, so validateGovernedWarehouse() rejected every one of them
// and no seeded warehouse was a usable Receiving/Transfer destination.
//
// These assertions read the REAL contract constants and the REAL validator, so they cannot drift
// from the command they exist to protect.
//
// Run: node --test functions/test/sandboxReceivingSourceFixture.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

import { validateGovernedWarehouse } from "../lib/warehouseGovernance/governedWarehouseValidation.js";
import { WAREHOUSE_PROVENANCES } from "../lib/types/warehouse.js";
import { Timestamp } from "firebase-admin/firestore";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const TRANSACTIONAL = readFileSync(resolvePath(ROOT, "scripts/seedSandboxTransactional.js"), "utf8");
const BASELINE = readFileSync(resolvePath(ROOT, "scripts/seedSandboxBaseline.js"), "utf8");
const COMMAND = readFileSync(resolvePath(ROOT, "src/inventoryReceiving/receiveInventoryStockCommand.ts"), "utf8");

// Extract a `set("<collection>", "<id>", { ... })` call from the seed source.
function seededDoc(collection, id) {
  // The id may be followed by a plain object literal OR a builder call such as
  // `reorderRequest({ ... })` -- both are the same fixture, so anchor on the id and take the first
  // brace after it rather than assuming the literal form.
  const needle = `set("${collection}", "${id}",`;
  const start = TRANSACTIONAL.indexOf(needle);
  assert.notEqual(start, -1, `seed does not emit ${collection}/${id}`);
  const open = TRANSACTIONAL.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < TRANSACTIONAL.length; i += 1) {
    if (TRANSACTIONAL[i] === "{") depth += 1;
    else if (TRANSACTIONAL[i] === "}") {
      depth -= 1;
      if (depth === 0) return TRANSACTIONAL.slice(open, i + 1);
    }
  }
  throw new Error(`unterminated object for ${collection}/${id}`);
}

const RECEIVABLE_RRID = "ro-sbx-001";

// ---- the contract itself, read from the command ------------------------------------------------
test("the command still keys the purchase order by reorderRequestId", () => {
  // If this ever changes, the fixture below is wrong in a new way and must be revisited rather than
  // silently continuing to pass.
  assert.match(
    COMMAND,
    /collection\(REORDER_PURCHASE_ORDERS_COLLECTION\)\.doc\(reorderRequestId\)/,
    "Receiving no longer reads the PO by reorderRequestId -- re-derive the fixture contract",
  );
  assert.match(COMMAND, /req\.purchaseOrderId !== undefined && req\.purchaseOrderId !== reorderRequestId/);
});

// ---- required source document is emitted, under the key Receiving actually reads ---------------
test("the receivable purchase order is keyed by the reorder request id", () => {
  const po = seededDoc("reorder_purchase_orders", RECEIVABLE_RRID);
  assert.match(po, new RegExp(`reorderRequestId:\\s*"${RECEIVABLE_RRID}"`));
});

test("the legacy PO-number key is no longer emitted", () => {
  // The whole failure was a document that existed under an unreachable id.
  assert.equal(TRANSACTIONAL.includes('set("reorder_purchase_orders", "po-sbx-001"'), false);
  assert.equal(TRANSACTIONAL.includes('set("reorder_purchase_orders", "po-sbx-002"'), false);
});

test("the human order number survives as externalPoNumber", () => {
  // Re-keying must not destroy the readable identity a person recognises.
  const po = seededDoc("reorder_purchase_orders", RECEIVABLE_RRID);
  assert.match(po, /externalPoNumber:\s*"po-sbx-001"/);
});

// ---- status / quantity semantics ---------------------------------------------------------------
test("the receivable PO is ORDERED with a positive orderedQuantity", () => {
  const po = seededDoc("reorder_purchase_orders", RECEIVABLE_RRID);
  assert.match(po, /status:\s*"ORDERED"/);
  const qty = /orderedQuantity:\s*(\d+)/.exec(po);
  assert.ok(qty, "orderedQuantity must be present");
  assert.ok(Number(qty[1]) > 0, "orderedQuantity must be positive");
});

// ---- key/id relationship on the linked request --------------------------------------------------
test("the linked reorder request's purchaseOrderId equals the reorder request id", () => {
  const req = seededDoc("reorder_requests", RECEIVABLE_RRID);
  assert.match(req, new RegExp(`purchaseOrderId:\\s*"${RECEIVABLE_RRID}"`));
  assert.equal(req.includes('purchaseOrderId: "po-sbx-001"'), false);
});

test("the PO and the request name the same Part", () => {
  const po = seededDoc("reorder_purchase_orders", RECEIVABLE_RRID);
  const req = seededDoc("reorder_requests", RECEIVABLE_RRID);
  const partOf = (src) => /partId:\s*"([^"]+)"/.exec(src)[1];
  assert.equal(partOf(po), partOf(req));
});

// ---- referenced Part exists in the baseline fixture and is a STANDARD part ----------------------
test("the referenced Part is seeded and is STANDARD (first stock creation is not a serial case)", () => {
  const po = seededDoc("reorder_purchase_orders", RECEIVABLE_RRID);
  const partId = /partId:\s*"([^"]+)"/.exec(po)[1];
  const line = BASELINE.split("\n").find((l) => l.includes(`id: "${partId}"`));
  assert.ok(line, `${partId} is not defined in the baseline Part fixtures`);
  assert.match(line, /controlType:\s*"STANDARD"/);
});

// ---- destination warehouse is a VALID governed location, per the real validator ------------------
test("every seeded warehouse passes the real governed warehouse validator", () => {
  // Rebuilds each seeded warehouse exactly as the baseline writes it and runs the ACTUAL validator
  // Receiving/Transfer use -- not a restatement of its rules.
  const block = BASELINE.slice(BASELINE.indexOf("const WAREHOUSES = ["), BASELINE.indexOf("];", BASELINE.indexOf("const WAREHOUSES = [")) + 2);
  // eslint-disable-next-line no-new-func -- repo-local literal, not untrusted input.
  const warehouses = Function(`"use strict"; return ${block.slice(block.indexOf("["))};`)();
  assert.ok(warehouses.length > 0);

  const provenance = /provenance:\s*"([^"]+)"/.exec(BASELINE)[1];
  assert.ok(WAREHOUSE_PROVENANCES.includes(provenance), `provenance ${provenance} is not a governed member`);

  // The validator requires real Firestore Timestamps, exactly as the seed writes them.
  const stamp = Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
  let active = 0;
  for (const w of warehouses) {
    const result = validateGovernedWarehouse({
      id: w.id, name: w.name, location: w.location, status: w.status,
      version: 1, provenance,
      // NATIVE requires the created pair and FORBIDS the governance-init pair (§3A.1), which is the
      // exact shape the seed writes -- reproduced here rather than assumed.
      createdAt: stamp, createdBy: "seed", updatedAt: stamp, updatedBy: "seed",
    }, w.id);
    assert.equal(result.valid, true, `${w.id} invalid: ${result.valid ? "" : result.reason}`);
    if (result.value.status === "ACTIVE") active += 1;
  }
  assert.ok(active > 0, "at least one ACTIVE warehouse must exist as a Receiving destination");
});

test("the seed does not write governance-init metadata onto NATIVE warehouses", () => {
  // The provenance model is exclusive; emitting both pairs is a contradiction the validator rejects.
  const raw = BASELINE.slice(BASELINE.indexOf('upsert(db, "warehouses"'), BASELINE.indexOf('bump("warehouses")'));
  // Strip comment lines: the block deliberately EXPLAINS the forbidden pair, and prose mentioning a
  // field name is not the same as writing it.
  const block = raw.split(String.fromCharCode(10)).filter((l) => !l.trim().startsWith("//")).join(String.fromCharCode(10));
  assert.match(block, /provenance:\s*"NATIVE"/);
  // The pair must be DELETED, not merely omitted: every upsert is a merge, so a sandbox seeded
  // before the correction would otherwise keep the forbidden fields forever.
  assert.match(block, /governanceInitializedAt:\s*FieldValue\.delete\(\)/);
  assert.match(block, /governanceInitializedBy:\s*FieldValue\.delete\(\)/);
  assert.equal(/governanceInitializedAt:\s*now/.test(block), false, "NATIVE must not WRITE governanceInitializedAt");
  assert.match(block, /createdAt:\s*now/);
});

// ---- determinism / idempotency -------------------------------------------------------------------
test("the seed stays deterministic: fixed ids, merge writes, no random or wall-clock ids", () => {
  // Re-running must converge rather than duplicate, which is what makes the sandbox reproducible
  // from repository truth.
  assert.match(TRANSACTIONAL, /\.set\(d,\s*\{\s*merge:\s*true\s*\}\)/);
  const poCalls = [...TRANSACTIONAL.matchAll(/set\("reorder_purchase_orders",\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(poCalls, ["ro-sbx-001", "ro-sbx-005"]);
  for (const id of poCalls) {
    assert.equal(/^(ro|po)-sbx-\d+$/.test(id), true, `${id} is not a stable fixed id`);
  }
  assert.equal(/Math\.random/.test(TRANSACTIONAL), false, "seed ids must not vary per run");
});
