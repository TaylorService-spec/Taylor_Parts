// DQ-038 / DQ-036(b) PARITY: the EOS put-away and acquisition validators answer exactly as the Firestore commands do
// (inventoryLocation/putAwayCommand.ts validatePutAwayRequest / derivePlacementId / buildPlacementEntries;
// serializedAsset/acquireSerializedAssetCommand.ts validateAcquireRequest / ACQUISITION_REASONS). Moving them onto EOS
// changes WHERE they run, never WHAT they accept or how a retry is recognised. Pure; no database, no emulator.
import test from "node:test";
import assert from "node:assert/strict";
import { validatePutAwayRequest, derivePlacementId, MAX_PLACEMENT_NOTE, buildPlacementEntries } from "../lib/inventoryLocation/putAwayCommand.js";
import { validateEosPutAwayRequest, eosPlacementId, EOS_MAX_PLACEMENT_NOTE, planPlacements } from "../lib/eosOps/binPlacementOperations.js";
import { validateAcquireRequest, ACQUISITION_REASONS } from "../lib/serializedAsset/acquireSerializedAssetCommand.js";
import { validateEosAcquireRequest, EOS_ACQUISITION_REASONS } from "../lib/eosOps/serializedAssetAcquireOperations.js";

const put = { warehouseId: "WH-1", partId: "P-1", idempotencyKey: "k-1", binId: "bin_abc", quantity: 3 };
const PUT_CASES = [
  put, null, [], "x",
  { ...put, warehouseId: " " }, { ...put, partId: undefined }, { ...put, idempotencyKey: "" },
  { ...put, binCode: "A-01" },
  { warehouseId: "WH-1", partId: "P-1", idempotencyKey: "k", quantity: 1 },
  { ...put, binId: "nope" }, { ...put, binId: "bin_bad/id" },
  { warehouseId: "WH-1", partId: "P-1", idempotencyKey: "k", binCode: " a 01 ", quantity: 1 },
  { warehouseId: "WH-1", partId: "P-1", idempotencyKey: "k", binCode: "!!", quantity: 1 },
  { warehouseId: "WH-1", partId: "P-1", idempotencyKey: "k", binCode: "", quantity: 1 },
  { ...put, note: 5 }, { ...put, note: "   " }, { ...put, note: " why " }, { ...put, note: "x".repeat(501) }, { ...put, note: null },
  { ...put, quantity: undefined }, { ...put, serialNumbers: ["a"] },
  { ...put, quantity: undefined, serialNumbers: [] }, { ...put, quantity: undefined, serialNumbers: ["a", "A"] },
  { ...put, quantity: undefined, serialNumbers: [" s1 ", "s2"] }, { ...put, quantity: undefined, serialNumbers: ["s1", 2] },
  { ...put, quantity: 0 }, { ...put, quantity: 1.5 }, { ...put, quantity: "3" },
  { ...put, pickedForWorkOrderId: " WO-1 " }, { ...put, pickedForWorkOrderId: "" },
];

test("put-away: the EOS validator gives the Firestore command's answer for every case", () => {
  for (const c of PUT_CASES) assert.deepEqual(validateEosPutAwayRequest(c), validatePutAwayRequest(c), JSON.stringify(c));
  assert.equal(EOS_MAX_PLACEMENT_NOTE, MAX_PLACEMENT_NOTE);
});

test("put-away: the same placement identity and the same rows (one per serial, one for a quantity)", () => {
  for (const [k, d] of [["k-1", "P-1"], ["a:b", "SN-9"]]) assert.equal(eosPlacementId(k, d), derivePlacementId(k, d));
  for (const serialNumbers of [[], ["S1", "S2"]]) {
    const common = { warehouseId: "WH-1", binId: "bin_x", binCode: "A-01", partId: "P-1", idempotencyKey: "k-9", pickedForWorkOrderId: "WO-1", note: "n", serialNumbers, quantity: 4 };
    const fs = buildPlacementEntries({ ...common, now: new Date(0), actorId: "u" });
    const eos = planPlacements(common);
    assert.deepEqual(eos.map((p) => p.id), fs.map((e) => e.id));
    assert.deepEqual(eos.map((p) => [p.warehouseId, p.binId, p.binCode, p.partId, p.serialNumber, p.quantity, p.idempotencyKey, p.pickedForWorkOrderId, p.note]),
      fs.map((e) => [e.data.warehouseId, e.data.binId, e.data.binCode, e.data.partId, e.data.serialNo, e.data.quantity, e.data.idempotencyKey, e.data.pickedForWorkOrderId, e.data.note]));
  }
});

const acq = { partId: "P-1", serialNo: "SN-1", locationId: "WH-1", reason: "OPENING_BALANCE", idempotencyKey: "k-1" };
const ACQ_CASES = [
  acq, null, [], "x",
  { ...acq, extra: 1 }, { ...acq, partId: " " }, { ...acq, serialNo: undefined }, { ...acq, locationId: "" }, { ...acq, idempotencyKey: 3 },
  { ...acq, reason: "PURCHASE" }, { ...acq, reason: undefined }, { ...acq, reason: "LEGACY_MIGRATION" }, { ...acq, reason: "EXISTING_COMPANY_ASSET" },
  { ...acq, provenanceNote: "from the old ERP" }, { ...acq, provenanceNote: "  " }, { ...acq, provenanceNote: 5 },
];

test("acquire: the EOS validator gives the Firestore command's decision and message for every case", () => {
  assert.deepEqual([...EOS_ACQUISITION_REASONS], [...ACQUISITION_REASONS]);
  for (const c of ACQ_CASES) {
    let fs;
    try { fs = { valid: true, value: validateAcquireRequest(c) }; } catch (err) { fs = { valid: false, message: err.message }; }
    assert.deepEqual(validateEosAcquireRequest(c), fs, JSON.stringify(c));
  }
});
