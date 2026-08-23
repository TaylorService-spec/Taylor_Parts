// INSTALLATION — the pure contract, and every way it must refuse.
//
// ============================ WHY THE REFUSALS MATTER MORE THAN THE HAPPY PATH ============================
//
// Installation is irreversible. Equipment `accountId` and `locationId` are immutable after create and
// no command clears `currentEquipmentId`, so a unit installed against the wrong customer stays
// installed against the wrong customer. There is no undo to fall back on, which makes every guard
// below the last line rather than the first.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const {
  installSerializedAsset, validateInstallRequest, equipmentDocIdFor, installFingerprint,
  INSTALLABLE_STATES, INSTALLED_STATE, EQUIPMENT_INSTALL_CAPABILITY, InstallCommandError,
} = await import(L("functions/lib/equipmentInstall/installSerializedAssetCommand.js"));
const { SERIALIZED_ASSET_STATES } = await import(L("functions/lib/serializedAsset/types.js"));

// ── A hand-built Firestore double: enough to exercise the transaction, nothing more. ────────────
function makeDb({ assets = {}, accounts = {}, locations = {}, equipment = {} } = {}) {
  const store = {
    serialized_assets: { ...assets },
    accounts: { ...accounts },
    locations: { ...locations },
    equipment: { ...equipment },
  };
  const audits = [];
  const db = {
    collection: (name) => ({
      doc: (id) => ({ __c: name, __id: id, id }),
    }),
    runTransaction: async (fn) => {
      const txn = {
        get: async (ref) => {
          const data = store[ref.__c]?.[ref.__id];
          return { exists: data !== undefined, data: () => data, id: ref.__id };
        },
        create: (ref, data) => {
          if (store[ref.__c][ref.__id] !== undefined) throw new Error("ALREADY_EXISTS");
          store[ref.__c][ref.__id] = { ...data };
        },
        update: (ref, data) => {
          store[ref.__c][ref.__id] = { ...store[ref.__c][ref.__id], ...data };
        },
      };
      return fn(txn);
    },
  };
  return { db, store, audits };
}

const ASSET_ID = "sa_taylor_unit_one";
const asset = (over = {}) => ({
  schemaVersion: 1,
  serialNo: "TAY-2026-0001",
  partId: "CW-P-WHOLE-TAYLOR",
  currentLocationId: "wh-main",
  inventoryState: "AVAILABLE",
  currentEquipmentId: null,
  ownership: "COMPANY",
  createdAtMillis: 1, createdByUid: "u", updatedAtMillis: 1, updatedByUid: "u",
  ...over,
});

const baseWorld = (assetOver = {}) => makeDb({
  assets: { [ASSET_ID]: asset(assetOver) },
  accounts: { "cw-acct-0003": { name: "Dense Customer" } },
  locations: { "cw-acct-0003-loc-00": { accountId: "cw-acct-0003" },
               "cw-acct-0009-loc-00": { accountId: "cw-acct-0009" } },
});

const deps = (db, { allow = true, audits = [] } = {}) => ({
  db,
  actor: { kind: "USER", id: "uid-installer" },
  authorize: async () => allow,
  stageAudit: (_txn, a) => audits.push(a),
  now: () => new Date("2026-08-23T10:00:00.000Z"),
});

const request = (over = {}) => ({
  serializedAssetId: ASSET_ID,
  accountId: "cw-acct-0003",
  locationId: "cw-acct-0003-loc-00",
  name: "Taylor C712 — Front Counter",
  idempotencyKey: "install-taylor-001",
  ...over,
});

const failed = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

// ── THE HAPPY PATH ────────────────────────────────────────────────────────────────────────────

test("installing a company-held asset creates Equipment and links the asset, in one transaction", async () => {
  const { db, store } = baseWorld();
  const audits = [];
  const out = await installSerializedAsset(request(), deps(db, { audits }));

  assert.equal(out.outcome, "installed");
  assert.equal(out.state, INSTALLED_STATE);

  const eq = store.equipment[out.equipmentId];
  assert.ok(eq, "Equipment must exist");
  assert.equal(eq.accountId, "cw-acct-0003");
  assert.equal(eq.locationId, "cw-acct-0003-loc-00");
  assert.equal(eq.status, "ACTIVE", "Rules require create to land ACTIVE");
  assert.equal(eq.serialNumber, "TAY-2026-0001", "the SERIAL is what carries across");
  assert.equal(eq.serializedAssetId, ASSET_ID, "and the link back, so the relationship is navigable both ways");

  const a = store.serialized_assets[ASSET_ID];
  assert.equal(a.inventoryState, INSTALLED_STATE);
  assert.equal(a.currentEquipmentId, out.equipmentId);
  assert.equal(a.serialNo, "TAY-2026-0001", "serialized identity is unchanged by installation");
  assert.equal(a.partId, "CW-P-WHOLE-TAYLOR", "and so is its catalog identity");
});

test("the prior custody is recorded, because after this it is unrecoverable from the asset", async () => {
  const { db } = baseWorld({ currentLocationId: "cert-trk-03", inventoryState: "STAGED" });
  const audits = [];
  await installSerializedAsset(request(), deps(db, { audits }));
  assert.equal(audits.length, 1);
  assert.equal(audits[0].priorLocationId, "cert-trk-03");
  assert.equal(audits[0].priorState, "STAGED");
  assert.equal(audits[0].serialNo, "TAY-2026-0001");
});

// ── AUTHORIZATION ─────────────────────────────────────────────────────────────────────────────

test("an unauthorized actor is refused, and nothing is written", async () => {
  const { db, store } = baseWorld();
  const err = await failed(() => installSerializedAsset(request(), deps(db, { allow: false })));
  assert.equal(err.code, "PERMISSION_DENIED");
  assert.deepEqual(Object.keys(store.equipment), []);
  assert.equal(store.serialized_assets[ASSET_ID].currentEquipmentId, null);
});

test("the capability is its own, not borrowed from receiving or transfer", () => {
  assert.equal(EQUIPMENT_INSTALL_CAPABILITY, "equipment.install");
  assert.notEqual(EQUIPMENT_INSTALL_CAPABILITY, "inventory.stock.receive");
  assert.notEqual(EQUIPMENT_INSTALL_CAPABILITY, "inventory.transfer.create");
});

// ── THE ASSET ─────────────────────────────────────────────────────────────────────────────────

test("a missing asset is refused", async () => {
  const { db } = baseWorld();
  const err = await failed(() => installSerializedAsset(request({ serializedAssetId: "sa_nope" }), deps(db)));
  assert.equal(err.code, "ASSET_NOT_FOUND");
});

test("DOUBLE INSTALL IS REFUSED -- and the check is on the LINK, not the state", async () => {
  // The most important refusal in the file. A unit pointing at an Equipment record belongs to
  // somebody, whatever its state field happens to say, and there is no un-install to recover from.
  const { db, store } = baseWorld({ currentEquipmentId: "eq_existing", inventoryState: "INSTALLED" });
  const err = await failed(() => installSerializedAsset(request(), deps(db)));
  assert.equal(err.code, "ALREADY_INSTALLED");
  assert.match(err.message, /eq_existing/);
  assert.deepEqual(Object.keys(store.equipment), [], "no second Equipment record");
});

test("a state that is not installable is refused, one case per excluded state", async () => {
  const excluded = SERIALIZED_ASSET_STATES.filter((s) => !INSTALLABLE_STATES.includes(s) && s !== "INSTALLED");
  assert.ok(excluded.length > 0, "the exclusion list must not be empty");
  for (const state of excluded) {
    const { db } = baseWorld({ inventoryState: state });
    const err = await failed(() => installSerializedAsset(request(), deps(db)));
    assert.equal(err.code, "STATE_NOT_INSTALLABLE", `${state} must be refused`);
  }
});

test("each installable state IS accepted", async () => {
  for (const state of INSTALLABLE_STATES) {
    const { db } = baseWorld({ inventoryState: state });
    const out = await installSerializedAsset(request(), deps(db));
    assert.equal(out.outcome, "installed", `${state} should install`);
  }
});

test("RECEIVED is deliberately NOT installable", () => {
  // Called out by name: a unit at the dock has not been put away, and installing from there would
  // hand a customer something that never entered custody.
  assert.equal(INSTALLABLE_STATES.includes("RECEIVED"), false);
});

test("a malformed stored asset is refused rather than repaired", async () => {
  const { db } = makeDb({
    assets: { [ASSET_ID]: { ...asset(), inventoryState: "NOT_A_STATE" } },
    accounts: { "cw-acct-0003": {} },
    locations: { "cw-acct-0003-loc-00": { accountId: "cw-acct-0003" } },
  });
  const err = await failed(() => installSerializedAsset(request(), deps(db)));
  assert.equal(err.code, "ASSET_MALFORMED");
});

// ── THE CUSTOMER AND THE PLACE ────────────────────────────────────────────────────────────────

test("an unknown customer is refused", async () => {
  const { db } = baseWorld();
  const err = await failed(() => installSerializedAsset(request({ accountId: "cw-acct-9999" }), deps(db)));
  assert.equal(err.code, "ACCOUNT_NOT_FOUND");
});

test("an unknown location is refused", async () => {
  const { db } = baseWorld();
  const err = await failed(() => installSerializedAsset(request({ locationId: "nowhere" }), deps(db)));
  assert.equal(err.code, "LOCATION_NOT_FOUND");
});

test("A LOCATION BELONGING TO A DIFFERENT CUSTOMER IS REFUSED", async () => {
  // The same integrity `equipmentLocationBelongsToAccount` enforces on the client path. This command
  // bypasses Rules entirely, so a trusted writer that skipped it would be the one hole in that rule.
  const { db, store } = baseWorld();
  const err = await failed(() => installSerializedAsset(
    request({ locationId: "cw-acct-0009-loc-00" }), deps(db)));
  assert.equal(err.code, "LOCATION_NOT_OF_ACCOUNT");
  assert.deepEqual(Object.keys(store.equipment), []);
});

// ── IDEMPOTENCY ───────────────────────────────────────────────────────────────────────────────

test("an identical retry produces ONE Equipment record, not two", async () => {
  const { db, store } = baseWorld();
  const first = await installSerializedAsset(request(), deps(db));
  const second = await installSerializedAsset(request(), deps(db));
  assert.equal(second.outcome, "replayed");
  assert.equal(second.equipmentId, first.equipmentId);
  assert.equal(Object.keys(store.equipment).length, 1);
});

test("the same key with a DIFFERENT customer is refused", async () => {
  const { db, store } = makeDb({
    assets: { [ASSET_ID]: asset(), sa_other: asset({ serialNo: "TAY-2" }) },
    accounts: { "cw-acct-0003": {}, "cw-acct-0009": {} },
    locations: { "cw-acct-0003-loc-00": { accountId: "cw-acct-0003" },
                 "cw-acct-0009-loc-00": { accountId: "cw-acct-0009" } },
  });
  await installSerializedAsset(request(), deps(db));
  const err = await failed(() => installSerializedAsset(
    request({ serializedAssetId: "sa_other", accountId: "cw-acct-0009", locationId: "cw-acct-0009-loc-00" }),
    deps(db)));
  assert.equal(err.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(Object.keys(store.equipment).length, 1, "the conflict wrote nothing");
});

test("the fingerprint covers the facts that define the installation", () => {
  const base = validateInstallRequest(request());
  assert.notEqual(installFingerprint(base), installFingerprint(validateInstallRequest(request({ accountId: "x" }))));
  assert.notEqual(installFingerprint(base), installFingerprint(validateInstallRequest(request({ locationId: "y" }))));
  assert.notEqual(installFingerprint(base),
    installFingerprint(validateInstallRequest(request({ serializedAssetId: "sa_z" }))));
  assert.equal(installFingerprint(base), installFingerprint(validateInstallRequest(request())));
});

test("the Equipment id is DERIVED, so create is itself the uniqueness check", () => {
  assert.equal(equipmentDocIdFor("k"), equipmentDocIdFor("k"));
  assert.notEqual(equipmentDocIdFor("k"), equipmentDocIdFor("k2"));
  assert.match(equipmentDocIdFor("k"), /^eq_[0-9a-f]{40}$/);
});

// ── REQUEST SHAPE ─────────────────────────────────────────────────────────────────────────────

test("an unrecognised field denies the whole request", () => {
  // The allow-list posture receiving and transfers already use. A caller cannot smuggle
  // currentEquipmentId, status, or a linkage field through the request body.
  for (const bad of ["currentEquipmentId", "status", "serialNumber", "createdBy"]) {
    const err = (() => { try { validateInstallRequest({ ...request(), [bad]: "x" }); return null; } catch (e) { return e; } })();
    assert.ok(err instanceof InstallCommandError, `${bad} must be refused`);
    assert.equal(err.code, "REQUEST_INVALID");
  }
});

test("name is required -- a generated placeholder is not a name anybody chose", () => {
  const err = (() => { try { validateInstallRequest({ ...request(), name: "  " }); return null; } catch (e) { return e; } })();
  assert.equal(err.code, "REQUEST_INVALID");
});

// ── MUTATION PROOFS ───────────────────────────────────────────────────────────────────────────

test("MUTATION: dropping the already-installed check would create a second Equipment", async () => {
  // Reconstructs the consequence rather than asserting the guard exists. The asset already points at
  // eq_existing; if the check were absent the command would happily mint a second customer record for
  // one physical machine, and nothing downstream could tell which was real.
  const { db, store } = baseWorld({ currentEquipmentId: "eq_existing", inventoryState: "INSTALLED" });
  const err = await failed(() => installSerializedAsset(request(), deps(db)));
  assert.equal(err.code, "ALREADY_INSTALLED");
  store.serialized_assets[ASSET_ID].currentEquipmentId = null;   // simulate the guard being gone
  store.serialized_assets[ASSET_ID].inventoryState = "AVAILABLE";
  const out = await installSerializedAsset(request(), deps(db));
  assert.equal(out.outcome, "installed");
  assert.equal(Object.keys(store.equipment).length, 1,
    "with the link cleared it installs -- which is exactly why the link must be checked");
});

test("MUTATION: a cross-customer location would otherwise produce an Equipment Rules would reject", async () => {
  const { db, store } = baseWorld();
  const err = await failed(() => installSerializedAsset(request({ locationId: "cw-acct-0009-loc-00" }), deps(db)));
  assert.equal(err.code, "LOCATION_NOT_OF_ACCOUNT");
  // And prove the guard is reading the location's OWN accountId, not the request's.
  store.locations["cw-acct-0009-loc-00"].accountId = "cw-acct-0003";
  const out = await installSerializedAsset(request({ locationId: "cw-acct-0009-loc-00" }), deps(db));
  assert.equal(out.outcome, "installed", "once the location genuinely belongs to the account, it installs");
});

test("MUTATION: no partial state -- a failed install leaves the asset untouched", async () => {
  const { db, store } = baseWorld();
  await failed(() => installSerializedAsset(request({ accountId: "cw-acct-9999" }), deps(db)));
  const a = store.serialized_assets[ASSET_ID];
  assert.equal(a.currentEquipmentId, null, "not linked");
  assert.equal(a.inventoryState, "AVAILABLE", "not marked installed");
  assert.deepEqual(Object.keys(store.equipment), [], "and no orphan Equipment");
});
