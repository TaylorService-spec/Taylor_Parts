// INV-EQ-P1a -- tests for the pure Serialized Asset <-> installed Equipment link and
// read-composition domain. Proves fail-closed validators/predicates (nullable
// currentEquipmentId, one Equipment<->one serial, sequential-not-concurrent,
// never installed-and-available), the install/uninstall/redeploy/replacement
// transition validation, the Available-vs-Customer selectors, and timeline
// composition without merging authority.
//
// Run: node test/serializedAssetInstallation.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  isNonEmptyString,
  isNullableEquipmentRef,
  LINK_REJECT,
  LINK_ACTION,
  validateSerializedAsset,
  validateEquipmentRecord,
  isInstalled,
  isAvailableSerial,
  violatesInstalledAndAvailable,
  assetInvariantHolds,
  isReciprocalLink,
  validateInstall,
  validateUninstall,
  validateRedeploy,
  validateReplacement,
  countInstalls,
  nextLinkSeq,
  isSequentialHistory,
  deriveCurrentEquipmentId,
  buildLinkEntry,
  selectAvailableSerializedAssets,
  selectCustomerEquipment,
  composeUnifiedTimeline,
  TIMELINE_SOURCE,
} from "../src/domain/serializedAssetInstallation.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const AVAILABLE = { serialNo: "SN-1", partId: "P-1", currentEquipmentId: null, availableForAssignment: true };
const INSTALLED = { serialNo: "SN-2", partId: "P-1", currentEquipmentId: "EQ-2", availableForAssignment: false };
const EQ2 = { id: "EQ-2", serializedAssetId: "SN-2", accountId: "A-1", locationId: "L-1" };

// -- primitives --------------------------------------------------------------
ok("string + nullable-ref primitives are fail-closed", () => {
  assert.strictEqual(isNonEmptyString("x"), true);
  assert.strictEqual(isNonEmptyString(" "), false);
  assert.strictEqual(isNonEmptyString(5), false);
  assert.strictEqual(isNullableEquipmentRef(null), true);
  assert.strictEqual(isNullableEquipmentRef(undefined), true);
  assert.strictEqual(isNullableEquipmentRef("EQ-1"), true);
  assert.strictEqual(isNullableEquipmentRef(""), false);
  assert.strictEqual(isNullableEquipmentRef(0), false);
});

// -- shape validation (valid / invalid / incomplete) -------------------------
ok("validateSerializedAsset accepts a well-formed asset, rejects malformed/incomplete", () => {
  assert.strictEqual(validateSerializedAsset(AVAILABLE).ok, true);
  assert.strictEqual(validateSerializedAsset(INSTALLED).ok, true);
  assert.strictEqual(validateSerializedAsset(null).ok, false);
  assert.strictEqual(validateSerializedAsset({}).ok, false); // incomplete
  assert.strictEqual(validateSerializedAsset({ serialNo: "S", partId: "P", currentEquipmentId: 5, availableForAssignment: true }).ok, false);
  assert.strictEqual(validateSerializedAsset({ serialNo: "S", partId: "P", currentEquipmentId: null }).ok, false); // missing bool
});
ok("validateEquipmentRecord is fail-closed on serializedAssetId type", () => {
  assert.strictEqual(validateEquipmentRecord(EQ2).ok, true);
  assert.strictEqual(validateEquipmentRecord({ id: "EQ-3" }).ok, true); // unlinked allowed
  assert.strictEqual(validateEquipmentRecord({ id: "EQ-3", serializedAssetId: 7 }).ok, false);
  assert.strictEqual(validateEquipmentRecord({}).ok, false);
});

// -- predicates + invariants -------------------------------------------------
ok("isInstalled / isAvailableSerial are exact and fail-closed", () => {
  assert.strictEqual(isInstalled(INSTALLED), true);
  assert.strictEqual(isInstalled(AVAILABLE), false);
  assert.strictEqual(isInstalled({}), false);
  assert.strictEqual(isAvailableSerial(AVAILABLE), true);
  assert.strictEqual(isAvailableSerial(INSTALLED), false);
  // not installed but flag false -> not available
  assert.strictEqual(isAvailableSerial({ ...AVAILABLE, availableForAssignment: false }), false);
});
ok("never installed-and-available invariant", () => {
  const bad = { serialNo: "SN-X", partId: "P", currentEquipmentId: "EQ-X", availableForAssignment: true };
  assert.strictEqual(violatesInstalledAndAvailable(bad), true);
  assert.strictEqual(assetInvariantHolds(bad), false);
  assert.strictEqual(assetInvariantHolds(AVAILABLE), true);
  assert.strictEqual(assetInvariantHolds(INSTALLED), true);
});
ok("one Equipment <-> one serial reciprocal link", () => {
  assert.strictEqual(isReciprocalLink(INSTALLED, EQ2), true);
  assert.strictEqual(isReciprocalLink(INSTALLED, { id: "EQ-9", serializedAssetId: "SN-2" }), false); // asset points elsewhere
  assert.strictEqual(isReciprocalLink(INSTALLED, { id: "EQ-2", serializedAssetId: "SN-9" }), false); // equipment points elsewhere
  assert.strictEqual(isReciprocalLink(AVAILABLE, EQ2), false); // not installed
});

// -- transitions: install (incl. concurrent) ---------------------------------
ok("validateInstall: valid new install; concurrent fails closed", () => {
  const r = validateInstall(AVAILABLE, { equipmentId: "EQ-NEW" });
  assert.deepStrictEqual(r, { ok: true, action: LINK_ACTION.INSTALL, resultingCurrentEquipmentId: "EQ-NEW" });
  assert.deepStrictEqual(validateInstall(INSTALLED, { equipmentId: "EQ-NEW" }), { ok: false, reason: LINK_REJECT.ALREADY_INSTALLED });
  assert.deepStrictEqual(validateInstall(AVAILABLE, {}), { ok: false, reason: LINK_REJECT.INVALID_INPUT });
  assert.deepStrictEqual(validateInstall({}, { equipmentId: "EQ-NEW" }), { ok: false, reason: LINK_REJECT.INVALID_INPUT });
});
ok("validateUninstall: installed -> cleared; not-installed fails closed", () => {
  assert.deepStrictEqual(validateUninstall(INSTALLED), { ok: true, action: LINK_ACTION.UNINSTALL, resultingCurrentEquipmentId: null });
  assert.deepStrictEqual(validateUninstall(AVAILABLE), { ok: false, reason: LINK_REJECT.NOT_INSTALLED });
});

// -- transitions: redeployment ----------------------------------------------
ok("validateRedeploy: repaired serial with prior install -> new Equipment; guards", () => {
  const history = [
    { action: LINK_ACTION.INSTALL, serialNo: "SN-1", equipmentId: "EQ-OLD", seq: 0 },
    { action: LINK_ACTION.UNINSTALL, serialNo: "SN-1", equipmentId: null, seq: 1 },
  ];
  const r = validateRedeploy(AVAILABLE, { equipmentId: "EQ-NEW", linkHistory: history });
  assert.deepStrictEqual(r, { ok: true, action: LINK_ACTION.REDEPLOY, resultingCurrentEquipmentId: "EQ-NEW" });
  // no prior install -> rejected
  assert.deepStrictEqual(validateRedeploy(AVAILABLE, { equipmentId: "EQ-NEW", linkHistory: [] }), { ok: false, reason: LINK_REJECT.NO_PRIOR_INSTALL });
  // already installed -> concurrent
  assert.deepStrictEqual(validateRedeploy(INSTALLED, { equipmentId: "EQ-NEW", linkHistory: history }), { ok: false, reason: LINK_REJECT.ALREADY_INSTALLED });
});

// -- transitions: replacement ------------------------------------------------
ok("validateReplacement: retires old, installs replacement serial into a NEW Equipment", () => {
  const newAsset = { serialNo: "SN-REPL", partId: "P-1", currentEquipmentId: null, availableForAssignment: true };
  const r = validateReplacement({ oldAsset: INSTALLED, oldEquipment: EQ2, newAsset, newEquipmentId: "EQ-REPL" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.action, LINK_ACTION.REPLACE);
  assert.strictEqual(r.retireEquipmentId, "EQ-2");
  assert.deepStrictEqual(r.install, { serialNo: "SN-REPL", equipmentId: "EQ-REPL" });
  assert.deepStrictEqual({ ...r.relationship }, { REPLACES: "EQ-2", REPLACED_BY: "EQ-REPL" });
});
ok("validateReplacement: a new serial may NEVER attach to the existing Equipment record", () => {
  const newAsset = { serialNo: "SN-REPL", partId: "P-1", currentEquipmentId: null, availableForAssignment: true };
  assert.deepStrictEqual(
    validateReplacement({ oldAsset: INSTALLED, oldEquipment: EQ2, newAsset, newEquipmentId: "EQ-2" }),
    { ok: false, reason: LINK_REJECT.SAME_EQUIPMENT },
  );
});
ok("validateReplacement: non-reciprocal old link / invalid inputs fail closed", () => {
  const newAsset = { serialNo: "SN-REPL", partId: "P-1", currentEquipmentId: null, availableForAssignment: true };
  assert.deepStrictEqual(
    validateReplacement({ oldAsset: INSTALLED, oldEquipment: { id: "EQ-2", serializedAssetId: "SN-OTHER" }, newAsset, newEquipmentId: "EQ-REPL" }),
    { ok: false, reason: LINK_REJECT.LINK_MISMATCH },
  );
  assert.deepStrictEqual(
    validateReplacement({ oldAsset: INSTALLED, oldEquipment: EQ2, newAsset: {}, newEquipmentId: "EQ-REPL" }),
    { ok: false, reason: LINK_REJECT.INVALID_INPUT },
  );
});

// -- link history: sequential-not-concurrent ---------------------------------
ok("countInstalls / nextLinkSeq are fail-closed", () => {
  const h = [
    { action: LINK_ACTION.INSTALL, serialNo: "S", equipmentId: "E1", seq: 0 },
    { action: LINK_ACTION.UNINSTALL, serialNo: "S", equipmentId: null, seq: 1 },
    { action: LINK_ACTION.REDEPLOY, serialNo: "S", equipmentId: "E2", seq: 2 },
  ];
  assert.strictEqual(countInstalls(h), 2);
  assert.strictEqual(countInstalls("nope"), 0);
  assert.strictEqual(nextLinkSeq(h), 3);
  assert.strictEqual(nextLinkSeq([]), 0);
  assert.ok(Number.isNaN(nextLinkSeq([{ action: "install", serialNo: "S", seq: "x" }])));
});
ok("isSequentialHistory: valid sequence true; concurrent / gapped / malformed false", () => {
  const good = [
    { action: LINK_ACTION.INSTALL, serialNo: "S", equipmentId: "E1", seq: 0 },
    { action: LINK_ACTION.UNINSTALL, serialNo: "S", equipmentId: null, seq: 1 },
    { action: LINK_ACTION.REDEPLOY, serialNo: "S", equipmentId: "E2", seq: 2 },
    { action: LINK_ACTION.UNINSTALL, serialNo: "S", equipmentId: null, seq: 3 },
  ];
  assert.strictEqual(isSequentialHistory(good), true);
  const concurrent = [
    { action: LINK_ACTION.INSTALL, serialNo: "S", equipmentId: "E1", seq: 0 },
    { action: LINK_ACTION.INSTALL, serialNo: "S", equipmentId: "E2", seq: 1 }, // second open link
  ];
  assert.strictEqual(isSequentialHistory(concurrent), false);
  const gapped = [
    { action: LINK_ACTION.INSTALL, serialNo: "S", equipmentId: "E1", seq: 0 },
    { action: LINK_ACTION.UNINSTALL, serialNo: "S", equipmentId: null, seq: 2 }, // gap
  ];
  assert.strictEqual(isSequentialHistory(gapped), false);
  const danglingUninstall = [{ action: LINK_ACTION.UNINSTALL, serialNo: "S", equipmentId: null, seq: 0 }];
  assert.strictEqual(isSequentialHistory(danglingUninstall), false);
});
ok("deriveCurrentEquipmentId reflects sequential installs; undefined on malformed", () => {
  assert.strictEqual(deriveCurrentEquipmentId([{ action: LINK_ACTION.INSTALL, serialNo: "S", equipmentId: "E1", seq: 0 }]), "E1");
  assert.strictEqual(deriveCurrentEquipmentId([
    { action: LINK_ACTION.INSTALL, serialNo: "S", equipmentId: "E1", seq: 0 },
    { action: LINK_ACTION.UNINSTALL, serialNo: "S", equipmentId: null, seq: 1 },
  ]), null);
  assert.strictEqual(deriveCurrentEquipmentId([
    { action: LINK_ACTION.INSTALL, serialNo: "S", equipmentId: "E1", seq: 0 },
    { action: LINK_ACTION.UNINSTALL, serialNo: "S", equipmentId: null, seq: 1 },
    { action: LINK_ACTION.REDEPLOY, serialNo: "S", equipmentId: "E2", seq: 2 },
  ]), "E2");
  assert.strictEqual(deriveCurrentEquipmentId([{ action: "install", serialNo: "S", seq: 5 }]), undefined); // non-sequential
});
ok("buildLinkEntry freezes a valid entry; uninstall nulls equipmentId; invalid rejected", () => {
  const r = buildLinkEntry({ action: LINK_ACTION.INSTALL, serialNo: "S", equipmentId: "E1", seq: 0, at: 100 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.entry.equipmentId, "E1");
  assert.ok(Object.isFrozen(r.entry));
  assert.strictEqual(buildLinkEntry({ action: LINK_ACTION.UNINSTALL, serialNo: "S", equipmentId: "E1", seq: 1 }).entry.equipmentId, null);
  assert.deepStrictEqual(buildLinkEntry({ action: "bogus", serialNo: "S", seq: 0 }), { ok: false, reason: LINK_REJECT.INVALID_INPUT });
});

// -- selectors: Available vs Customer ----------------------------------------
ok("selectAvailableSerializedAssets returns only available serials; skips malformed", () => {
  const assets = [AVAILABLE, INSTALLED, { ...AVAILABLE, serialNo: "SN-3" }, null, {}];
  const out = selectAvailableSerializedAssets(assets);
  assert.deepStrictEqual(out.map((a) => a.serialNo), ["SN-1", "SN-3"]);
  assert.deepStrictEqual(selectAvailableSerializedAssets("nope"), []);
});
ok("selectCustomerEquipment scopes by account (and optional location); skips malformed", () => {
  const recs = [
    EQ2, // A-1 / L-1
    { id: "EQ-3", serializedAssetId: "SN-3", accountId: "A-1", locationId: "L-2" },
    { id: "EQ-4", serializedAssetId: "SN-4", accountId: "A-9", locationId: "L-1" },
    {}, // malformed
  ];
  assert.deepStrictEqual(selectCustomerEquipment(recs, { accountId: "A-1" }).map((e) => e.id), ["EQ-2", "EQ-3"]);
  assert.deepStrictEqual(selectCustomerEquipment(recs, { accountId: "A-1", locationId: "L-1" }).map((e) => e.id), ["EQ-2"]);
  assert.deepStrictEqual(selectCustomerEquipment(recs, {}), []); // no account -> fail closed
});

// -- unified timeline: compose without merging authority ---------------------
ok("composeUnifiedTimeline interleaves by time, tags source, never merges; skips undated", () => {
  const inv = [{ at: 30, kind: "RECEIVED" }, { at: 10, kind: "TRANSFER_IN" }, { kind: "no-date" }];
  const svc = [{ at: 20, kind: "WORK_ORDER" }, { at: 30, kind: "SERVICE" }];
  const t = composeUnifiedTimeline({ inventoryEvents: inv, serviceEvents: svc });
  assert.deepStrictEqual(t.map((r) => [r.at, r.source, r.kind]), [
    [10, TIMELINE_SOURCE.INVENTORY, "TRANSFER_IN"],
    [20, TIMELINE_SOURCE.SERVICE, "WORK_ORDER"],
    [30, TIMELINE_SOURCE.INVENTORY, "RECEIVED"], // tie: inventory before service (stable)
    [30, TIMELINE_SOURCE.SERVICE, "SERVICE"],
  ]);
  // no merged record: each row keeps its own source authority + a ref to the original event, unmodified.
  assert.strictEqual(t[0].ref, inv[1]);
  assert.ok(t.every((r) => r.source === TIMELINE_SOURCE.INVENTORY || r.source === TIMELINE_SOURCE.SERVICE));
  assert.deepStrictEqual(composeUnifiedTimeline({}), []);
});

console.log(`\n${passed} passed`);
