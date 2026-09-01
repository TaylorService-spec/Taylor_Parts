// CERT-WH-MAIN-01 -- THE WORLD HELD 571 UNITS OF WAREHOUSE STOCK AND NO WAREHOUSE.
//
// ============================ WHAT WENT WRONG, AND WHY NOTHING SAW IT ============================
//
// Every warehouse-side opening balance books to `wh-main`. No governed `warehouses/wh-main` record
// was ever built for a live world -- emulatorBootstrap.mjs wrote one and nothing else did. The
// ledger takes a location reference at its word, so summing worked perfectly; readPartBalance does
// not, and it builds its eligible set from `warehouses where status == "ACTIVE"`. With the
// collection empty that set is empty and every warehouse ledger row is dropped.
//
// Measured live on 2026-08-31, before this correction:
//   readPartBalance agreed with the warehouse ledger sum on 0 of 32 quantity-bearing parts
//   warehouse ledger total 571, governed read total 0
//   world state: COMPLETE, 1.7.0, 1092/1092, expected = recorded = observed = fcc38a5f
//
// COMPLETE WAS TRUE AND MEANINGLESS. Completeness was measured over the ten groups the builder
// emitted, and the missing record was not one of them. That is the whole failure: not a wrong
// number anywhere, but a question nobody was asking.
//
// ============================ WHAT THESE TESTS ACTUALLY ASSERT ============================
//
// The reconciliation cases below drive the REAL readPartBalance against the REAL inventory plan
// through a fake Firestore, rather than asserting that a fixture contains a string. A source scan
// would have passed against the broken world too -- `wh-main` appeared in eight files. What it
// never did was RESOLVE. So the load-bearing assertion here is an end-to-end number, 571, produced
// by the product's own reader over the fixture's own movements.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Timestamp } from "firebase-admin/firestore";

const REPO = path.resolve(process.cwd(), "..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { buildWorld } = await import(L("functions/scripts/certificationWorld/build.mjs"));
const { expectedRecords } = await import(L("functions/scripts/certificationWorld.mjs"));
const { CERTIFICATION_WORLD_VERSION, MARKER_FIELD } = await import(L("functions/scripts/certificationWorld/manifest.mjs"));
const { worldFingerprint } = await import(L("functions/scripts/certificationWorld/state.mjs"));
const { buildInventoryPlan, CERT_WAREHOUSE_ID } = await import(L("functions/scripts/certificationWorld/data/inventoryPlan.mjs"));
const { CERT_TRUCKS } = await import(L("functions/scripts/certificationWorld/data/inventory.mjs"));
const { certificationWarehouseData, certificationWarehouseRecords } =
  await import(L("functions/scripts/certificationWorld/data/warehouses.mjs"));
const { stampedForWrite } = await import(L("functions/scripts/certificationWorld/seedWrite.mjs"));

const { validateGovernedWarehouse, GOVERNED_WAREHOUSE_REASONS } =
  await import(L("functions/lib/warehouseGovernance/governedWarehouseValidation.js"));
const { readPartBalance } = await import(L("functions/lib/inventory/partBalanceReadService.js"));
const { makeResolveWarehouseLocationActive } =
  await import(L("functions/lib/inventoryReceiving/receivingLocationResolver.js"));

// ── THE PINS. Moved deliberately by this correction; see manifest.mjs v1.8.0.
const EXPECTED_VERSION = "1.8.0";
const EXPECTED_RECORDS = 1093;
const EXPECTED_FINGERPRINT = "1782e853";
const EXPECTED_WAREHOUSE_TOTAL = 571;

const world = buildWorld();
const warehouseRecordOf = (w) => (w.warehouses ?? []).find((r) => r.id === CERT_WAREHOUSE_ID) ?? null;

// ============================================================================================
// 1. buildWorld contains the canonical governed warehouse the inventory plan needs.
// ============================================================================================
test("buildWorld produces the governed warehouse the inventory plan books stock to", () => {
  const rec = warehouseRecordOf(world);
  assert.ok(rec, "buildWorld must emit a warehouses record -- its absence is CERT-WH-MAIN-01 itself");
  assert.equal(rec.collection, "warehouses");
  assert.equal(rec.id, CERT_WAREHOUSE_ID);

  // Asked of the VALIDATOR, not of a field list. A field list here would be a third copy of the
  // contract and would drift the way the emulator's copy did.
  const parsed = validateGovernedWarehouse(
    { ...rec.data, createdAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1) },
    rec.id);
  assert.equal(parsed.reason, null);
  assert.ok(parsed.valid, "the built warehouse must satisfy the shared §3A governed validator");
  assert.equal(parsed.value.status, "ACTIVE");
});

test("the seeder supplies the timestamps the governed contract requires, and the builder does not", () => {
  // NATIVE provenance requires a coherent createdAt/createdBy pair, and the validator requires a
  // real Firestore Timestamp -- which a pure builder cannot produce and must not fake. So the
  // builder carries createdBy/updatedBy and the seeder stamps the times. This test pins that split,
  // because "just add createdAt" is the obvious wrong fix and it would make the world
  // non-deterministic to make one validator happy.
  const data = certificationWarehouseData();
  assert.ok(!("createdAt" in data), "the builder must not invent a timestamp");
  assert.ok(!("updatedAt" in data), "the builder must not invent a timestamp");
  assert.equal(typeof data.createdBy, "string");
  assert.equal(typeof data.updatedBy, "string");

  const written = stampedForWrite(data, () => Timestamp.fromMillis(1));
  const parsed = validateGovernedWarehouse(written, CERT_WAREHOUSE_ID);
  assert.ok(parsed.valid, `the STAMPED record is what lands in Firestore and it must validate: ${parsed.reason}`);
});

// ============================================================================================
// THE THREE FIELDS THAT CANNOT BE THERE. Each is a convention every OTHER record in this world
// follows, and each one fails the warehouse closed. These are regressions waiting to happen the
// next time someone makes the warehouse "consistent with the rest of the fixture".
// ============================================================================================
test("the world's own conventions are refused by the governed warehouse contract", () => {
  const base = { ...certificationWarehouseData(), createdAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1) };
  const reasonFor = (extra) => validateGovernedWarehouse({ ...base, ...extra }, CERT_WAREHOUSE_ID).reason;

  assert.equal(reasonFor({ dataProvenance: "SYNTHETIC_CERTIFICATION_FACT" }), GOVERNED_WAREHOUSE_REASONS.UNKNOWN_FIELD,
    "every other cert record carries dataProvenance; the warehouse may not");
  assert.equal(reasonFor({ active: true }), GOVERNED_WAREHOUSE_REASONS.ACTIVE_FORBIDDEN,
    "the trucks require active:true; the warehouse forbids the key outright");
  assert.equal(reasonFor({ [MARKER_FIELD]: { version: CERTIFICATION_WORLD_VERSION, datasetId: "warehouses" } }),
    GOVERNED_WAREHOUSE_REASONS.UNKNOWN_FIELD,
    "THE MARKER ITSELF fails the contract -- which is why the warehouse group is markerless");
});

// ============================================================================================
// MARKERLESS MEMBERSHIP. The fixture yields to the governed contract; the world still owns the id.
// ============================================================================================
test("the warehouse is seeded WITHOUT the fixture marker, and every other record keeps it", () => {
  const { records } = expectedRecords();
  const wh = records.filter((r) => r.collection === "warehouses");
  assert.equal(wh.length, 1);
  assert.ok(!(MARKER_FIELD in wh[0].data),
    "a markered warehouse would seed, count and fingerprint correctly and be refused by Receiving");

  const others = records.filter((r) => r.collection !== "warehouses");
  const unmarked = others.filter((r) => !r.data[MARKER_FIELD]);
  assert.equal(unmarked.length, 0,
    `markerless must be the NAMED exception, not a leak: ${unmarked.slice(0, 3).map((r) => r.collection + "/" + r.id)}`);
});

test("markerless membership is still exact: the world names the ids it owns", () => {
  const { markerlessIds } = expectedRecords();
  assert.ok(markerlessIds instanceof Map);
  assert.deepEqual([...(markerlessIds.get("warehouses") ?? [])], [CERT_WAREHOUSE_ID],
    "reset and verify identify these documents by id, so the id set is the whole authority");
});

// ============================================================================================
// 2 & 3. EVERY ledger location the plan references resolves through a registry.
// ============================================================================================
test("every WAREHOUSE location in the inventory plan resolves to a governed ACTIVE warehouse", () => {
  const movements = buildInventoryPlan();
  const referenced = new Set(movements.filter((m) => m.location.type === "WAREHOUSE").map((m) => m.location.locationId));
  assert.ok(referenced.size > 0, "the plan must actually book warehouse stock or this proves nothing");

  const built = new Map((world.warehouses ?? []).map((r) => [r.id, r.data]));
  for (const locationId of referenced) {
    const data = built.get(locationId);
    assert.ok(data, `the plan books stock to ${locationId} and the world builds no such warehouse`);
    const parsed = validateGovernedWarehouse(
      { ...data, createdAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1) }, locationId);
    assert.ok(parsed.valid && parsed.value.status === "ACTIVE",
      `${locationId} must be governed and ACTIVE, got ${parsed.reason ?? parsed.value.status}`);
  }
});

test("every MOBILE location in the inventory plan resolves through the mobile-location registry", () => {
  const movements = buildInventoryPlan();
  const referenced = new Set(movements.filter((m) => m.location.type === "MOBILE").map((m) => m.location.locationId));
  assert.ok(referenced.size > 0);
  const built = new Map(world.trucks.map((r) => [r.id, r.data]));
  for (const locationId of referenced) {
    const data = built.get(locationId);
    assert.ok(data, `the plan books stock to ${locationId} and the world builds no such mobile location`);
    assert.equal(data.locationId, locationId, "locationId must equal the document id");
    assert.equal(data.type, "MOBILE");
    assert.equal(data.active, true);
  }
  assert.equal(referenced.size, CERT_TRUCKS.length, "every truck the fixture declares should carry stock");
});

// ============================================================================================
// 4 & 5. THE LOAD-BEARING PROOF. The product's own reader, over the fixture's own movements.
//
// A fake Firestore rather than an emulator: this must run in the ordinary unit suite, and what is
// being proven is a pure consequence of which documents exist. `warehouses` is the variable.
// ============================================================================================
function fakeDb({ movements, warehouses }) {
  const docsOf = (rows) => rows.map((data, i) => ({ id: data.__id ?? `d${i}`, data: () => data }));
  const snap = (rows) => ({ docs: docsOf(rows), size: rows.length, empty: rows.length === 0 });
  return {
    collection(name) {
      const all = name === "inventory_transactions" ? movements
        : name === "warehouses" ? warehouses
          : [];
      const api = {
        get: async () => snap(all),
        where: (field, _op, value) => ({
          get: async () => snap(all.filter((r) => {
            if (field === "partId") return r.partId === value;
            if (field === "status") return r.status === value;
            return false;
          })),
          where: () => api,
        }),
      };
      return api;
    },
  };
}

const planMovements = buildInventoryPlan().map((m) => ({
  partId: m.partId, type: m.type, quantity: m.quantity, location: m.location, trackingMode: m.trackingMode,
}));
const governedWarehouseDocs = certificationWarehouseRecords().map((r) => ({
  __id: r.id, ...r.data, createdAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1),
}));
const warehousePartIds = [...new Set(planMovements
  .filter((m) => m.location.type === "WAREHOUSE").map((m) => m.partId))];
const ledgerWarehouseSum = (partId) => planMovements
  .filter((m) => m.partId === partId && m.location.type === "WAREHOUSE")
  .reduce((n, m) => n + m.quantity, 0);

test("with the governed warehouse present, readPartBalance SEES the warehouse inventory", async () => {
  const db = fakeDb({ movements: planMovements, warehouses: governedWarehouseDocs });
  let total = 0;
  for (const partId of warehousePartIds) {
    const b = await readPartBalance(db, partId, false);
    assert.equal(b.onHand.state, "KNOWN", `${partId}: on-hand must be KNOWN once the warehouse exists`);
    total += b.onHand.value;
  }
  assert.equal(total, EXPECTED_WAREHOUSE_TOTAL,
    "the governed read must total the same 571 units the ledger holds -- this is the number that read 0 live");
});

test("all warehouse quantity parts reconcile between the ledger and readPartBalance", async () => {
  const db = fakeDb({ movements: planMovements, warehouses: governedWarehouseDocs });
  const mismatched = [];
  for (const partId of warehousePartIds) {
    const b = await readPartBalance(db, partId, false);
    const governed = b.available.state === "KNOWN" ? b.available.value : null;
    const ledger = ledgerWarehouseSum(partId);
    if (governed !== ledger) mismatched.push(`${partId}: governed ${governed} != ledger ${ledger}`);
  }
  assert.deepEqual(mismatched, [], "two independent implementations of 'what is on hand' must agree on every part");
  assert.equal(warehousePartIds.length, 32, "the reconciled set is the 32 parts measured live as 0-of-32");
});

test("THE REGRESSION ITSELF: remove the warehouse and every governed balance silently reads zero", async () => {
  // The exact live condition on 2026-08-31. Pinned so the defect can never return quietly: it must
  // return as a FAILING TEST rather than as a world that reports COMPLETE.
  const db = fakeDb({ movements: planMovements, warehouses: [] });
  let total = 0;
  for (const partId of warehousePartIds) {
    const b = await readPartBalance(db, partId, false);
    total += b.onHand.state === "KNOWN" ? b.onHand.value : 0;
  }
  assert.equal(total, 0, "this is what the live world did, and it raised no error anywhere");
  assert.notEqual(total, EXPECTED_WAREHOUSE_TOTAL);
});

test("an INACTIVE or malformed warehouse fails closed rather than half-working", async () => {
  const variants = [
    ["INACTIVE status", [{ ...governedWarehouseDocs[0], status: "INACTIVE" }]],
    ["lingering active flag", [{ ...governedWarehouseDocs[0], active: true }]],
    ["id disagreeing with its path", [{ ...governedWarehouseDocs[0], id: "wh-other" }]],
    ["carrying the fixture marker", [{ ...governedWarehouseDocs[0], [MARKER_FIELD]: { version: "1.8.0", datasetId: "warehouses" } }]],
  ];
  for (const [label, warehouses] of variants) {
    const db = fakeDb({ movements: planMovements, warehouses });
    // The status query is what readPartBalance filters on, so an INACTIVE record never arrives;
    // the others arrive and must be refused by the validator at the resolver boundary below.
    const b = await readPartBalance(db, warehousePartIds[0], false);
    const governed = b.onHand.state === "KNOWN" ? b.onHand.value : 0;
    if (label === "INACTIVE status") {
      assert.equal(governed, 0, `${label}: an ineligible warehouse must contribute nothing`);
    }
    const parsed = validateGovernedWarehouse(warehouses[0], CERT_WAREHOUSE_ID);
    if (label !== "INACTIVE status") {
      assert.ok(!parsed.valid, `${label} must be refused by the governed validator`);
    }
  }
});

// ============================================================================================
// 6. RECEIVING DESTINATION. The next authorized ceremony after purchasing.
// ============================================================================================
test("Receiving accepts the canonical wh-main as a destination, and refuses everything else", async () => {
  // __id is the fake harness's document key and is NOT part of the stored document. Leaving it in
  // the body would fail the closed-key validator on a field Firestore never stores -- the fake would
  // then "prove" a refusal the real system does not perform.
  const strip = ({ __id, ...body }) => body;
  const stored = new Map(governedWarehouseDocs.map((d) => [d.__id, d]));
  const txn = {
    get: async (ref) => {
      const doc = stored.get(ref.__id);
      return { exists: doc !== undefined, data: () => (doc === undefined ? undefined : strip(doc)) };
    },
  };
  const db = { collection: () => ({ doc: (id) => ({ __id: id }) }) };
  const resolve = makeResolveWarehouseLocationActive(db);

  assert.equal(await resolve(txn, { type: "WAREHOUSE", locationId: CERT_WAREHOUSE_ID }), true,
    "the receiving ceremony that follows purchasing could not have succeeded before this correction");
  assert.equal(await resolve(txn, { type: "WAREHOUSE", locationId: "wh-absent" }), false);
  assert.equal(await resolve(txn, { type: "MOBILE", locationId: CERT_WAREHOUSE_ID }), false);
  assert.equal(await resolve(txn, { type: "WAREHOUSE", locationId: "a/b" }), false);

  stored.set("wh-inactive", { ...governedWarehouseDocs[0], __id: "wh-inactive", id: "wh-inactive", status: "INACTIVE" });
  assert.equal(await resolve(txn, { type: "WAREHOUSE", locationId: "wh-inactive" }), false);
});

// ============================================================================================
// 8, 9, 10. DETERMINISM, COVERAGE AND THE PINS.
// ============================================================================================
test("the world builder stays deterministic with the warehouse in it", () => {
  const a = expectedRecords();
  const b = expectedRecords();
  assert.equal(worldFingerprint(a.records).hash, worldFingerprint(b.records).hash);
  assert.deepEqual(warehouseRecordOf(buildWorld()), warehouseRecordOf(buildWorld()));
});

test("version, expected record count and fingerprint move together and are pinned by value", () => {
  const { world: w, records } = expectedRecords();
  assert.equal(w.version, EXPECTED_VERSION, "content changed, so the version MUST have moved");
  assert.equal(CERTIFICATION_WORLD_VERSION, EXPECTED_VERSION);
  assert.equal(records.length, EXPECTED_RECORDS, "1092 -> 1093: exactly one record, not a padded signal");
  assert.equal(worldFingerprint(records).hash, EXPECTED_FINGERPRINT);
  // The superseded authority must not still validate.
  assert.notEqual(worldFingerprint(records).hash, "fcc38a5f");
});

test("the expected count is the builder's actual output, not a hand-maintained number", () => {
  const { records } = expectedRecords();
  const counted = Object.values(records.reduce((acc, r) => {
    acc[r.collection] = (acc[r.collection] ?? 0) + 1; return acc;
  }, {})).reduce((a, b) => a + b, 0);
  assert.equal(counted, records.length);
  assert.equal(counted, EXPECTED_RECORDS);
});

// ============================================================================================
// 11. THE LOAD-BEARING ONE. Verification must not report COMPLETE without the warehouse.
// ============================================================================================
test("a world missing the governed warehouse CANNOT verify as COMPLETE", async () => {
  const { classifyWorld, WORLD_STATE } = await import(L("functions/scripts/certificationWorld/verify.mjs"));
  const { records } = expectedRecords();
  const expectedCounts = records.reduce((acc, r) => { acc[r.collection] = (acc[r.collection] ?? 0) + 1; return acc; }, {});
  const fingerprint = worldFingerprint(records).hash;

  const complete = classifyWorld({
    expected: { version: EXPECTED_VERSION, counts: expectedCounts },
    actual: { ...expectedCounts },
    versionsFound: [EXPECTED_VERSION], duplicateIds: [], invariantViolations: [],
    identityLinkage: { linked: 47, total: 47 },
    fingerprint: { expected: fingerprint, recorded: fingerprint, observed: fingerprint },
  });
  assert.equal(complete.state, WORLD_STATE.COMPLETE, "the control case must pass or the negative proves nothing");

  // Someone deletes the warehouse and leaves the ledger plan intact -- the exact live condition.
  const withoutWarehouse = { ...expectedCounts, warehouses: 0 };
  const degraded = classifyWorld({
    expected: { version: EXPECTED_VERSION, counts: expectedCounts },
    actual: withoutWarehouse,
    versionsFound: [EXPECTED_VERSION], duplicateIds: [], invariantViolations: [],
    identityLinkage: { linked: 47, total: 47 },
    fingerprint: { expected: fingerprint, recorded: fingerprint, observed: fingerprint },
  });
  assert.notEqual(degraded.state, WORLD_STATE.COMPLETE,
    "a world that cannot serve its own inventory baseline must never report COMPLETE again");
  assert.equal(degraded.state, WORLD_STATE.PARTIAL);
});

// ============================================================================================
// 7 (shape half) + the one-source-of-truth rule.
// ============================================================================================
test("there is exactly ONE definition of the canonical warehouse shape", async () => {
  const { readFileSync } = await import("node:fs");
  const emulator = readFileSync(path.resolve(REPO, "functions/scripts/certificationWorld/emulatorBootstrap.mjs"), "utf8");
  // Comments are prose and may legitimately mention the collection; a WRITE may not.
  const code = emulator.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/collection\(\s*["']warehouses["']\s*\)/.test(code),
    "emulatorBootstrap must receive the warehouse from buildWorld, not write its own copy");
  assert.ok(!/["']Main Distribution Center["']/.test(code),
    "a second handwritten warehouse literal is how the emulator and live certification diverged");
});

// ============================================================================================
// THE MIGRATION TOOL ITSELF. Found while tracing what the live 1.7.0 -> 1.8.0 upgrade would do.
// Both defects would have been written INTO the record this correction exists to make trustworthy.
// ============================================================================================
test("CERT-UPGRADE-PROVENANCE-03: an additive upgrade records the commit it actually ran from", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(path.resolve(REPO, "functions/scripts/certificationWorld/upgradeWorldAdditive.mjs"), "utf8");
  const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // The deployment record is written with merge, so a field it does not set KEEPS the previous
  // value. Advancing datasetVersion and fingerprint while leaving the old repoCommit made the
  // record claim that 1.8.0 came from the commit which built 1.7.0.
  assert.match(code, /repoCommit:\s*repoCommit\(\)/,
    "the deployment record must carry the commit this upgrade ran from, not the previous one");
  assert.match(code, /function repoCommit\(\)/, "and it must be derived, never passed in");
});

test("CERT-UPGRADE-FLAGS-04: a full-world additive upgrade requires BOTH live flags", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(path.resolve(REPO, "functions/scripts/certificationWorld/upgradeWorldAdditive.mjs"), "utf8");
  const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(code, /assertBothLiveFlags/,
    "this tool rewrites every record in the world, so it gets the rebuild rule not the light-writer rule");

  // EXERCISED, not merely present. A source scan cannot tell a reached guard from a dead one.
  const { assertBothLiveFlags, ExecutionTargetRefused } =
    await import(L("functions/scripts/certificationWorld/executionTarget.mjs"));
  const target = { projectId: "eos-platform-certification", isLive: true, apply: true };
  assert.throws(
    () => assertBothLiveFlags({ target, argv: ["node", "x", "--apply-live-certification"] }),
    (err) => err instanceof ExecutionTargetRefused && /BOTH --apply/.test(err.message));
  assert.throws(
    () => assertBothLiveFlags({ target, argv: ["node", "x", "--apply"] }),
    (err) => err instanceof ExecutionTargetRefused);
  assert.doesNotThrow(
    () => assertBothLiveFlags({ target, argv: ["node", "x", "--apply", "--apply-live-certification"] }));
});

// ============================================================================================
// CERT-WH-COMPANY-02 -- THE OWNER FACT, AND THE FIVE PLACES IT HAS TO HOLD.
//
// Owner decision 2026-08-31: wh-main belongs to TAYLOR. It was ASKED, never derived: the Phoenix
// address, which accounts draw stock, the fleet's homeWarehouseId and relative company size are all
// inferences, and an inference stored as an ownership fact is a false fact every downstream reorder
// would inherit. These cases pin the decided value and, just as importantly, pin that nothing
// derives a DIFFERENT one.
// ============================================================================================
const { OPERATING_COMPANY_IDS, resolveOperatingCompany } =
  await import(L("functions/lib/ownership/operatingCompanyAuthority.js"));
const { projectReorderWarehouseOptions } = await import(L("functions/lib/reorderRequest/reorderCallables.js"));
// R-32 (#152): reorderWarehouseEligibility.js is retired. A principal entitled to every warehouse
// is now expressed as an authority predicate rather than an ALL_GOVERNED scope object. The
// substitution is exact -- ALL_GOVERNED meant isWarehouseInReorderScope() returned true for every
// id, which is what `allows: () => true` says. What this test measures (the company gates the
// picker) is unchanged.
const UNSCOPED_AUTHORITY = { allows: () => true, reason: "GOVERNED_ASSIGNMENT" };

const { CERT_WAREHOUSE_OPERATING_COMPANY_ID } =
  await import(L("functions/scripts/certificationWorld/data/warehouses.mjs"));

test("the fixture's company id IS the canonical governed id, not a display name or a code", () => {
  // The builder is pure ESM and the authority is TypeScript, so the value is a literal there. This
  // is what stops the two drifting: "Taylor", "TAYLOR" and "Taylor Freezer of Arizona" would all
  // look right in a diff and all fail closed at resolve time.
  assert.equal(CERT_WAREHOUSE_OPERATING_COMPANY_ID, OPERATING_COMPANY_IDS.TAYLOR);
  assert.equal(resolveOperatingCompany(CERT_WAREHOUSE_OPERATING_COMPANY_ID).company?.id, "taylor");
});

test("the company survives seeding and the warehouse still validates with it present", () => {
  const written = stampedForWrite(certificationWarehouseData(), () => Timestamp.fromMillis(1));
  assert.equal(written.operatingCompanyId, OPERATING_COMPANY_IDS.TAYLOR, "the stamp must not drop it");
  const parsed = validateGovernedWarehouse(written, CERT_WAREHOUSE_ID);
  assert.ok(parsed.valid, `the stamped record must still validate: ${parsed.reason}`);
  // Carried into the sanitized reconstruction, so consumers see the ownership fact rather than only
  // the fields that predate it.
  assert.equal(parsed.value.operatingCompanyId, OPERATING_COMPANY_IDS.TAYLOR);
});

test("an unresolvable company fails closed rather than being stored as an ownership fact", () => {
  const base = { ...certificationWarehouseData(), createdAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1) };
  for (const bad of ["TAYLOR", "Taylor", "Taylor Freezer of Arizona", "", "acme"]) {
    const r = validateGovernedWarehouse({ ...base, operatingCompanyId: bad }, CERT_WAREHOUSE_ID);
    assert.ok(!r.valid, `operatingCompanyId ${JSON.stringify(bad)} must be refused`);
    assert.equal(r.reason, GOVERNED_WAREHOUSE_REASONS.OPERATING_COMPANY_INVALID);
  }
});

test("Reorder now OFFERS wh-main -- the picker was empty without the company", () => {
  const candidates = certificationWarehouseRecords().map((r) => ({
    id: r.id, data: { ...r.data, createdAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1) },
  }));
  const offered = projectReorderWarehouseOptions(UNSCOPED_AUTHORITY, candidates);
  assert.equal(offered.length, 1, "the governed warehouse must be offered");
  assert.equal(offered[0].warehouseId, CERT_WAREHOUSE_ID);

  // THE STATE BEFORE THE OWNER DECISION, pinned. Absent company => silently skipped, no error.
  const withoutCompany = candidates.map(({ id, data }) => {
    const { operatingCompanyId, ...rest } = data;
    return { id, data: rest };
  });
  assert.deepEqual(projectReorderWarehouseOptions(UNSCOPED_AUTHORITY, withoutCompany), [],
    "this is why the field could not simply be left absent: an empty picker and nothing to read");
});

test("the OTHER company does not acquire wh-main by inference", () => {
  // The reorder create DERIVES the owning company from the warehouse (WAREHOUSE_NO_COMPANY when it
  // is missing). So the stored value is the whole answer, and there must be no second path to a
  // different one.
  const data = certificationWarehouseData();
  assert.notEqual(data.operatingCompanyId, OPERATING_COMPANY_IDS.VENTANA);
  assert.equal(resolveOperatingCompany(data.operatingCompanyId).company?.id, OPERATING_COMPANY_IDS.TAYLOR);

  // Nothing about the record's other content implies a company: the address, the name and the
  // fleet's homeWarehouseId are all inert here by design.
  const src = certificationWarehouseData();
  const inferenceCarriers = Object.entries(src).filter(([k]) => k !== "operatingCompanyId");
  for (const [, v] of inferenceCarriers) {
    if (typeof v !== "string") continue;
    assert.notEqual(resolveOperatingCompany(v).company?.id, OPERATING_COMPANY_IDS.VENTANA);
    assert.notEqual(resolveOperatingCompany(v).company?.id, OPERATING_COMPANY_IDS.TAYLOR);
  }
});

test("adding the company changes NOTHING about receiving or the governed inventory total", async () => {
  // The company is an ownership fact, not an eligibility one. Receiving and readPartBalance must be
  // exactly as they were -- otherwise a business decision would have moved an operational number.
  const withCompany = certificationWarehouseRecords().map((r) => ({
    __id: r.id, ...r.data, createdAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1),
  }));
  const db = fakeDb({ movements: planMovements, warehouses: withCompany });
  let total = 0;
  for (const partId of warehousePartIds) {
    const b = await readPartBalance(db, partId, false);
    total += b.onHand.state === "KNOWN" ? b.onHand.value : 0;
  }
  assert.equal(total, EXPECTED_WAREHOUSE_TOTAL, "571, unchanged by the ownership decision");

  const strip = ({ __id, ...body }) => body;
  const stored = new Map(withCompany.map((d) => [d.__id, d]));
  const txn = { get: async (ref) => {
    const doc = stored.get(ref.__id);
    return { exists: doc !== undefined, data: () => (doc === undefined ? undefined : strip(doc)) };
  } };
  const resolve = makeResolveWarehouseLocationActive({ collection: () => ({ doc: (id) => ({ __id: id }) }) });
  assert.equal(await resolve(txn, { type: "WAREHOUSE", locationId: CERT_WAREHOUSE_ID }), true,
    "Receiving must still accept the destination");
});
