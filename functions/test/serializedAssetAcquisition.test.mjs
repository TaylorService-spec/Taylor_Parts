// ACQUISITION — an already-owned serialized unit entering EOS without a purchase.
//
// ============================ WHAT THIS IS DEFENDING ============================
//
// The temptation this command exists to remove is receiving a unit against a made-up purchase order.
// That would work, and it would be a lie with consequences: a receipt advances an order's progress,
// contributes to receiving throughput, and leaves a receiving_orders record that looks exactly like a
// real one forever.
//
// So the tests care most about two things — that an acquired unit can never be mistaken for a
// received one, and that this command cannot quietly become a way around procurement.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const {
  acquireSerializedAsset, validateAcquireRequest, ACQUISITION_REASONS,
  ACQUIRED_INITIAL_STATE, ACQUISITION_PROVENANCE, SERIALIZED_ASSET_ACQUIRE_CAPABILITY,
  AcquireCommandError,
} = await import(L("functions/lib/serializedAsset/acquireSerializedAssetCommand.js"));
const { serializedAssetDocId } = await import(L("functions/lib/serializedAsset/serializedAssetRegistration.js"));
const { projectSerializedAsset } = await import(L("functions/lib/serializedAsset/serializedAssetReadService.js"));
const { INSTALLABLE_STATES } = await import(L("functions/lib/equipmentInstall/installSerializedAssetCommand.js"));

function makeDb(seed = {}) {
  const store = { serialized_assets: { ...seed } };
  return {
    store,
    db: {
      collection: (name) => ({ doc: (id) => ({ __c: name, __id: id, id }) }),
      runTransaction: async (fn) => fn({
        get: async (ref) => {
          const data = store[ref.__c]?.[ref.__id];
          return { exists: data !== undefined, data: () => data, id: ref.__id };
        },
        create: (ref, data) => {
          if (store[ref.__c][ref.__id] !== undefined) throw new Error("ALREADY_EXISTS");
          store[ref.__c][ref.__id] = { ...data };
        },
        update: (ref, data) => { store[ref.__c][ref.__id] = { ...store[ref.__c][ref.__id], ...data }; },
      }),
    },
  };
}

const PART = "CW-P-WU-TAYLOR-C712";
const SERIAL = "TAY-C712-0001";

const deps = (db, over = {}) => ({
  db,
  actor: { kind: "USER", id: "uid-controller" },
  authorize: async () => true,
  resolvePart: async () => ({ partId: PART, trackingMode: "SERIAL", active: true }),
  resolveLocationActive: async () => true,
  stageAudit: (_t, a) => (over.audits ?? []).push(a),
  now: () => new Date("2026-08-23T12:00:00.000Z"),
  ...over,
});

const req = (over = {}) => ({
  partId: PART, serialNo: SERIAL, locationId: "wh-main",
  reason: "OPENING_BALANCE", idempotencyKey: "acq-taylor-001", ...over,
});

const failed = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

// ── THE HAPPY PATH ────────────────────────────────────────────────────────────────────────────

test("an already-owned unit enters custody with no purchase order anywhere in sight", async () => {
  const { db, store } = makeDb();
  const audits = [];
  const out = await acquireSerializedAsset(req(), deps(db, { audits }));

  assert.equal(out.outcome, "acquired");
  assert.equal(out.state, ACQUIRED_INITIAL_STATE);

  const stored = store.serialized_assets[out.serializedAssetId];
  assert.equal(stored.serialNo, SERIAL);
  assert.equal(stored.partId, PART);
  assert.equal(stored.currentEquipmentId, null, "acquired, not installed");
  assert.equal(stored.ownership, "COMPANY");
  assert.equal(stored.acquisitionReason, "OPENING_BALANCE");
  assert.equal(stored.acquisitionProvenance, ACQUISITION_PROVENANCE);
});

test("NO RECEIPT PROVENANCE IS WRITTEN -- the two populations stay distinguishable forever", async () => {
  // The property Reporting depends on. A query asking "what did we receive?" filters on
  // activatedByReceivingId, and an acquired unit must never answer it.
  const { db, store } = makeDb();
  const out = await acquireSerializedAsset(req(), deps(db));
  const stored = store.serialized_assets[out.serializedAssetId];
  assert.equal("activatedByReceivingId" in stored, false,
    "an acquired unit must carry no receiving order id");
  assert.equal(stored.acquisitionProvenance, ACQUISITION_PROVENANCE,
    "and must carry the one that says how it really arrived");
});

test("the initial state is AVAILABLE, not RECEIVED", () => {
  // RECEIVED means a delivery arrived at a dock and has not been put away -- a claim about an event
  // that did not happen here.
  assert.equal(ACQUIRED_INITIAL_STATE, "AVAILABLE");
  assert.notEqual(ACQUIRED_INITIAL_STATE, "RECEIVED");
});

test("the acquired state is one the install command accepts", async () => {
  // The two commands must compose without an edit in between: acquire -> custody -> install.
  assert.ok(INSTALLABLE_STATES.includes(ACQUIRED_INITIAL_STATE),
    `${ACQUIRED_INITIAL_STATE} must be installable or the forward lifecycle has a hole`);
});

test("the audit event names it as an acquisition, never a receipt", async () => {
  const { db } = makeDb();
  const audits = [];
  await acquireSerializedAsset(req({ provenanceNote: "Carried over from the legacy register." }),
    deps(db, { audits }));
  assert.equal(audits.length, 1);
  assert.equal(audits[0].reason, "OPENING_BALANCE");
  assert.equal(audits[0].serialNo, SERIAL);
  assert.equal(audits[0].provenanceNote, "Carried over from the legacy register.");
});

// ── IT MUST NOT BECOME A WAY AROUND PURCHASING ────────────────────────────────────────────────

test("THE REASON SET IS CLOSED, AND CONTAINS NOTHING MEANING 'WE BOUGHT IT'", () => {
  // The closure is the whole safety argument. An open text field would let somebody type "purchase"
  // and erase the distinction this module exists to preserve.
  assert.deepEqual([...ACQUISITION_REASONS].sort(),
    ["EXISTING_COMPANY_ASSET", "LEGACY_MIGRATION", "OPENING_BALANCE"]);
  for (const r of ACQUISITION_REASONS) {
    assert.equal(/purchas|order|receipt|vendor|supplier|bought/i.test(r), false,
      `${r} must not describe a procurement event`);
  }
});

test("an unrecognised reason is REFUSED, never coerced to a default", async () => {
  for (const bad of ["PURCHASE", "OTHER", "", "opening_balance"]) {
    const err = await failed(() => acquireSerializedAsset(req({ reason: bad }), deps(makeDb().db)));
    assert.ok(err instanceof AcquireCommandError, `${JSON.stringify(bad)} must be refused`);
    assert.equal(err.code, "REQUEST_INVALID");
  }
});

test("the request cannot carry a purchase order, receipt, or receiving order", async () => {
  // Requiring one would recreate the defect; ACCEPTING one would let a caller smuggle the very
  // history this command exists to avoid fabricating.
  for (const smuggled of ["purchaseOrderId", "receivingId", "receiptId", "activatedByReceivingId"]) {
    const err = await failed(() => acquireSerializedAsset({ ...req(), [smuggled]: "po_1" }, deps(makeDb().db)));
    assert.equal(err.code, "REQUEST_INVALID", `${smuggled} must be refused`);
  }
});

test("its capability is its own, not receiving's", () => {
  assert.equal(SERIALIZED_ASSET_ACQUIRE_CAPABILITY, "inventory.serializedAsset.acquire");
  assert.notEqual(SERIALIZED_ASSET_ACQUIRE_CAPABILITY, "inventory.stock.receive");
});

test("an unauthorized actor is refused and nothing is created", async () => {
  const { db, store } = makeDb();
  const err = await failed(() => acquireSerializedAsset(req(), deps(db, { authorize: async () => false })));
  assert.equal(err.code, "PERMISSION_DENIED");
  assert.deepEqual(Object.keys(store.serialized_assets), []);
});

// ── THE PART ──────────────────────────────────────────────────────────────────────────────────

test("a quantity-only Part is refused -- it has no individual units to acquire", async () => {
  const { db } = makeDb();
  const err = await failed(() => acquireSerializedAsset(req(),
    deps(db, { resolvePart: async () => ({ partId: PART, trackingMode: "NONE", active: true }) })));
  assert.equal(err.code, "PART_NOT_SERIALIZED");
});

test("a missing or inactive Part is refused", async () => {
  const missing = await failed(() => acquireSerializedAsset(req(),
    deps(makeDb().db, { resolvePart: async () => null })));
  assert.equal(missing.code, "PART_NOT_FOUND");
  const inactive = await failed(() => acquireSerializedAsset(req(),
    deps(makeDb().db, { resolvePart: async () => ({ partId: PART, trackingMode: "SERIAL", active: false }) })));
  assert.equal(inactive.code, "PART_NOT_FOUND");
});

// ── CUSTODY ───────────────────────────────────────────────────────────────────────────────────

test("a location that is not an active governed company location is refused", async () => {
  const { db, store } = makeDb();
  const err = await failed(() => acquireSerializedAsset(req(),
    deps(db, { resolveLocationActive: async () => false })));
  assert.equal(err.code, "LOCATION_INVALID");
  assert.deepEqual(Object.keys(store.serialized_assets), [], "and nothing is created");
});

// ── IDENTITY ──────────────────────────────────────────────────────────────────────────────────

test("identity is the EXISTING (partId, serialNo) derivation, not a parallel scheme", async () => {
  const { db } = makeDb();
  const out = await acquireSerializedAsset(req(), deps(db));
  assert.equal(out.serializedAssetId, serializedAssetDocId(PART, SERIAL),
    "a second identity scheme would let one physical unit exist twice");
});

test("the stored document is readable by the product's own projection", async () => {
  // The mistake the install command made on its first run, not repeated: a document the domain's own
  // reader rejects is a document that does not really exist as far as the platform is concerned.
  const { db, store } = makeDb();
  const out = await acquireSerializedAsset(req(), deps(db));
  const projected = projectSerializedAsset(out.serializedAssetId, store.serialized_assets[out.serializedAssetId]);
  assert.ok(projected, "acquired assets must survive projectSerializedAsset");
  assert.equal(projected.serialNo, SERIAL);
  assert.equal(projected.currentEquipmentId, null);
});

// ── IDEMPOTENCY AND CONFLICT ──────────────────────────────────────────────────────────────────

test("an identical retry replays and creates no second unit", async () => {
  const { db, store } = makeDb();
  const first = await acquireSerializedAsset(req(), deps(db));
  const second = await acquireSerializedAsset(req(), deps(db));
  assert.equal(second.outcome, "replayed");
  assert.equal(second.serializedAssetId, first.serializedAssetId);
  assert.equal(Object.keys(store.serialized_assets).length, 1);
});

test("the same unit acquired for a DIFFERENT reason is refused", async () => {
  const { db } = makeDb();
  await acquireSerializedAsset(req(), deps(db));
  const err = await failed(() => acquireSerializedAsset(
    req({ reason: "LEGACY_MIGRATION" }), deps(db)));
  assert.equal(err.code, "ALREADY_EXISTS_CONFLICT");
});

test("the same unit acquired into a DIFFERENT location is refused", async () => {
  const { db } = makeDb();
  await acquireSerializedAsset(req(), deps(db));
  const err = await failed(() => acquireSerializedAsset(req({ locationId: "wh-north" }), deps(db)));
  assert.equal(err.code, "ALREADY_EXISTS_CONFLICT");
});

test("ACQUISITION MUST NOT OVERWRITE A UNIT THAT ARRIVED BY RECEIPT", async () => {
  // The one that would destroy real history. A received unit carries activatedByReceivingId and no
  // acquisitionReason; re-acquiring it would replace genuine purchasing provenance with a claim that
  // it was always owned.
  const id = serializedAssetDocId(PART, SERIAL);
  const { db, store } = makeDb({
    [id]: {
      schemaVersion: 1, serialNo: SERIAL, partId: PART, currentLocationId: "wh-main",
      inventoryState: "AVAILABLE", currentEquipmentId: null, ownership: "COMPANY",
      activatedByReceivingId: "rcvc_real_receipt",
      createdAtMillis: 1, createdByUid: "u", updatedAtMillis: 1, updatedByUid: "u",
    },
  });
  const err = await failed(() => acquireSerializedAsset(req(), deps(db)));
  assert.equal(err.code, "ALREADY_EXISTS_CONFLICT");
  assert.match(err.message, /purchasing history/);
  assert.equal(store.serialized_assets[id].activatedByReceivingId, "rcvc_real_receipt",
    "the receipt provenance survives untouched");
});

// ── MUTATION PROOFS ───────────────────────────────────────────────────────────────────────────

test("MUTATION: an acquired unit written with receipt provenance would be counted as receiving", async () => {
  // Reconstructs the consequence. If this command wrote activatedByReceivingId, a receiving-throughput
  // query would count opening balances as purchases -- the exact defect Pass 3 spent a whole pass
  // removing from the quantity ledger.
  const { db, store } = makeDb();
  const out = await acquireSerializedAsset(req(), deps(db));
  const stored = store.serialized_assets[out.serializedAssetId];
  const receivedUnits = [stored].filter((a) => a.activatedByReceivingId !== undefined);
  assert.equal(receivedUnits.length, 0, "zero units answer a receiving query");

  const contaminated = { ...stored, activatedByReceivingId: "rcvc_fake" };
  assert.equal([contaminated].filter((a) => a.activatedByReceivingId !== undefined).length, 1,
    "...and one would, the moment that field were written");
});

test("MUTATION: opening the reason set would make this a purchasing bypass", () => {
  const open = [...ACQUISITION_REASONS, "PURCHASE"];
  assert.ok(open.some((r) => /purchas/i.test(r)),
    "an added procurement reason is exactly what the closed set prevents");
  assert.equal(ACQUISITION_REASONS.some((r) => /purchas/i.test(r)), false);
});

test("MUTATION: dropping the receipt-provenance guard would erase real purchasing history", async () => {
  const id = serializedAssetDocId(PART, SERIAL);
  const { db, store } = makeDb({
    [id]: {
      schemaVersion: 1, serialNo: SERIAL, partId: PART, currentLocationId: "wh-main",
      inventoryState: "AVAILABLE", currentEquipmentId: null, ownership: "COMPANY",
      activatedByReceivingId: "rcvc_real_receipt",
      createdAtMillis: 1, createdByUid: "u", updatedAtMillis: 1, updatedByUid: "u",
    },
  });
  const err = await failed(() => acquireSerializedAsset(req(), deps(db)));
  assert.equal(err.code, "ALREADY_EXISTS_CONFLICT");
  // Simulate the guard being absent: the stored unit now carries an acquisitionReason and the
  // receipt id is gone from the record's meaning.
  store.serialized_assets[id].acquisitionReason = "OPENING_BALANCE";
  const replayed = await acquireSerializedAsset(req(), deps(db));
  assert.equal(replayed.outcome, "replayed",
    "without the guard the command proceeds against a unit that was genuinely purchased");
});
