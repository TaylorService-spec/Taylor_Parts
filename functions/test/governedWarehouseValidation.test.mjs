// Receiving Location Authority -- I-LA C2 / gate I-LA1a: offline unit tests for the pure
// §3A governed-warehouse validator (functions/src/warehouseGovernance/governedWarehouseValidation.ts).
//
// The module under test is PURE (no Firebase app, no emulator, no clock, no network), so
// this is a plain Node assert test against the compiled lib/ output -- matching this repo's
// pure-logic test convention (inventoryEffectDetection.test.mjs, transitionEngine.test.mjs).
// `Timestamp` is constructed offline via firebase-admin/firestore (no initializeApp needed).
//
// Prerequisite: `npm run build` in functions/ first.
// Run: node test/governedWarehouseValidation.test.mjs   (or npm run test:warehouseGovernance)
// NO test here connects to any Firebase project, emulator, or network.

import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import {
  validateGovernedWarehouse,
  GOVERNED_WAREHOUSE_REASONS,
} from "../lib/warehouseGovernance/governedWarehouseValidation.js";

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL - ${name}: ${err && err.message}`);
  }
}

const ALL_REASONS = new Set(Object.values(GOVERNED_WAREHOUSE_REASONS));
const TS = Timestamp.fromMillis(1_700_000_000_000); // a real server Timestamp instance
const TS2 = Timestamp.fromMillis(1_700_000_500_000);
// A look-alike that exposes .toMillis() but is NOT `instanceof Timestamp` -- the timestamp
// contract must reject it.
const FAKE_TS = { toMillis: () => 1_700_000_000_000, _seconds: 1_700_000_000, _nanoseconds: 0 };

function baseNative(over = {}) {
  return {
    id: "wh-1",
    name: "Main Warehouse",
    location: "Dallas, TX",
    status: "ACTIVE",
    version: 1,
    updatedAt: TS,
    updatedBy: "system:writer",
    provenance: "NATIVE",
    createdAt: TS,
    createdBy: "system:writer",
    ...over,
  };
}
function baseMigrated(over = {}) {
  return {
    id: "wh-2",
    name: "Satellite Warehouse",
    location: "Austin, TX",
    status: "ACTIVE",
    version: 1,
    updatedAt: TS,
    updatedBy: "system:migration",
    provenance: "MIGRATED",
    governanceInitializedAt: TS,
    governanceInitializedBy: "system:migration",
    ...over,
  };
}

function expectValid(input) {
  const r = validateGovernedWarehouse(input);
  assert.equal(r.valid, true, `expected valid, got ${JSON.stringify(r.reason)}`);
  assert.equal(r.reason, null);
  assert.ok(r.value && typeof r.value === "object");
  return r.value;
}
function expectInvalid(input, reason) {
  const r = validateGovernedWarehouse(input);
  assert.equal(r.valid, false, `expected invalid for reason ${reason}`);
  assert.equal(r.value, null);
  assert.equal(r.reason, reason);
  assert.ok(ALL_REASONS.has(r.reason), `reason ${r.reason} is not a bounded governed token`);
}

// ---- valid records ----
check("valid NATIVE record", () => {
  const v = expectValid(baseNative());
  assert.equal(v.provenance, "NATIVE");
  assert.equal(v.status, "ACTIVE");
  assert.equal(v.version, 1);
  assert.ok(v.createdAt instanceof Timestamp && typeof v.createdBy === "string");
  assert.equal(v.governanceInitializedAt, undefined);
  assert.equal(v.governanceInitializedBy, undefined);
});

check("valid MIGRATED record WITHOUT creation metadata", () => {
  const v = expectValid(baseMigrated());
  assert.equal(v.provenance, "MIGRATED");
  assert.equal(v.createdAt, undefined);
  assert.equal(v.createdBy, undefined);
  assert.ok(v.governanceInitializedAt instanceof Timestamp);
  assert.equal(v.governanceInitializedBy, "system:migration");
});

check("valid MIGRATED record PRESERVING a complete authentic creation pair", () => {
  const v = expectValid(baseMigrated({ createdAt: TS2, createdBy: "legacy:origin" }));
  assert.ok(v.createdAt instanceof Timestamp);
  assert.equal(v.createdBy, "legacy:origin");
  assert.ok(v.governanceInitializedAt instanceof Timestamp);
});

check("ACTIVE and INACTIVE are both accepted", () => {
  assert.equal(expectValid(baseNative({ status: "ACTIVE" })).status, "ACTIVE");
  assert.equal(expectValid(baseMigrated({ status: "INACTIVE" })).status, "INACTIVE");
});

// ---- status / provenance ----
check("missing status -> status_invalid", () => {
  const r = baseNative();
  delete r.status;
  expectInvalid(r, GOVERNED_WAREHOUSE_REASONS.STATUS_INVALID);
});
check("unknown status -> status_invalid", () => {
  expectInvalid(baseNative({ status: "PENDING" }), GOVERNED_WAREHOUSE_REASONS.STATUS_INVALID);
  expectInvalid(baseNative({ status: "active" }), GOVERNED_WAREHOUSE_REASONS.STATUS_INVALID); // case-sensitive
});
check("missing provenance -> provenance_invalid", () => {
  const r = baseNative();
  delete r.provenance;
  expectInvalid(r, GOVERNED_WAREHOUSE_REASONS.PROVENANCE_INVALID);
});
check("unknown provenance -> provenance_invalid", () => {
  expectInvalid(baseNative({ provenance: "LEGACY" }), GOVERNED_WAREHOUSE_REASONS.PROVENANCE_INVALID);
});

// ---- version classes ----
check("every invalid version class -> version_invalid", () => {
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1", true, null]) {
    expectInvalid(baseNative({ version: bad }), GOVERNED_WAREHOUSE_REASONS.VERSION_INVALID);
  }
  const missing = baseNative();
  delete missing.version;
  expectInvalid(missing, GOVERNED_WAREHOUSE_REASONS.VERSION_INVALID);
});

// ---- updated metadata ----
check("missing/malformed updatedAt -> updated_at_invalid", () => {
  const missing = baseNative();
  delete missing.updatedAt;
  expectInvalid(missing, GOVERNED_WAREHOUSE_REASONS.UPDATED_AT_INVALID);
  expectInvalid(baseNative({ updatedAt: FAKE_TS }), GOVERNED_WAREHOUSE_REASONS.UPDATED_AT_INVALID);
  expectInvalid(baseNative({ updatedAt: 1_700_000_000_000 }), GOVERNED_WAREHOUSE_REASONS.UPDATED_AT_INVALID);
});
check("missing/blank updatedBy -> updated_by_invalid", () => {
  const missing = baseNative();
  delete missing.updatedBy;
  expectInvalid(missing, GOVERNED_WAREHOUSE_REASONS.UPDATED_BY_INVALID);
  expectInvalid(baseNative({ updatedBy: "   " }), GOVERNED_WAREHOUSE_REASONS.UPDATED_BY_INVALID);
  expectInvalid(baseNative({ updatedBy: 42 }), GOVERNED_WAREHOUSE_REASONS.UPDATED_BY_INVALID);
});

// ---- half-pair permutations ----
check("created half-pairs -> created_pair_incomplete", () => {
  const onlyAt = baseNative();
  delete onlyAt.createdBy; // createdAt present, createdBy absent
  expectInvalid(onlyAt, GOVERNED_WAREHOUSE_REASONS.CREATED_PAIR_INCOMPLETE);
  const onlyBy = baseNative();
  delete onlyBy.createdAt;
  expectInvalid(onlyBy, GOVERNED_WAREHOUSE_REASONS.CREATED_PAIR_INCOMPLETE);
});
check("governanceInitialized half-pairs -> governance_pair_incomplete", () => {
  const onlyAt = baseMigrated();
  delete onlyAt.governanceInitializedBy;
  expectInvalid(onlyAt, GOVERNED_WAREHOUSE_REASONS.GOVERNANCE_PAIR_INCOMPLETE);
  const onlyBy = baseMigrated();
  delete onlyBy.governanceInitializedAt;
  expectInvalid(onlyBy, GOVERNED_WAREHOUSE_REASONS.GOVERNANCE_PAIR_INCOMPLETE);
});

// ---- provenance coherence ----
check("governanceInitialized fields on NATIVE -> native_forbids_governance_init", () => {
  expectInvalid(
    baseNative({ governanceInitializedAt: TS, governanceInitializedBy: "system:migration" }),
    GOVERNED_WAREHOUSE_REASONS.NATIVE_FORBIDS_GOVERNANCE_INIT,
  );
});
check("NATIVE without creation pair -> native_requires_created", () => {
  const r = baseNative();
  delete r.createdAt;
  delete r.createdBy;
  expectInvalid(r, GOVERNED_WAREHOUSE_REASONS.NATIVE_REQUIRES_CREATED);
});
check("MIGRATED without governanceInitialized -> migrated_requires_governance_init", () => {
  const r = baseMigrated();
  delete r.governanceInitializedAt;
  delete r.governanceInitializedBy;
  expectInvalid(r, GOVERNED_WAREHOUSE_REASONS.MIGRATED_REQUIRES_GOVERNANCE_INIT);
});

// ---- malformed timestamps / blank actors within a present pair ----
check("malformed created timestamp / blank creator -> created_metadata_invalid", () => {
  expectInvalid(baseNative({ createdAt: FAKE_TS }), GOVERNED_WAREHOUSE_REASONS.CREATED_METADATA_INVALID);
  expectInvalid(baseNative({ createdBy: "" }), GOVERNED_WAREHOUSE_REASONS.CREATED_METADATA_INVALID);
});
check("malformed governance timestamp / blank migrator -> governance_metadata_invalid", () => {
  expectInvalid(baseMigrated({ governanceInitializedAt: FAKE_TS }), GOVERNED_WAREHOUSE_REASONS.GOVERNANCE_METADATA_INVALID);
  expectInvalid(baseMigrated({ governanceInitializedBy: "  " }), GOVERNED_WAREHOUSE_REASONS.GOVERNANCE_METADATA_INVALID);
});

// ---- active forbidden ----
check("active present as true/false/null/undefined-own-property -> active_forbidden", () => {
  expectInvalid(baseNative({ active: true }), GOVERNED_WAREHOUSE_REASONS.ACTIVE_FORBIDDEN);
  expectInvalid(baseNative({ active: false }), GOVERNED_WAREHOUSE_REASONS.ACTIVE_FORBIDDEN);
  expectInvalid(baseNative({ active: null }), GOVERNED_WAREHOUSE_REASONS.ACTIVE_FORBIDDEN);
  expectInvalid(baseNative({ active: undefined }), GOVERNED_WAREHOUSE_REASONS.ACTIVE_FORBIDDEN); // own property, value undefined
});

// ---- shape of input ----
check("null / array / primitive input -> not_object", () => {
  for (const bad of [null, undefined, [], ["x"], "wh", 1, true, () => {}]) {
    expectInvalid(bad, GOVERNED_WAREHOUSE_REASONS.NOT_OBJECT);
  }
});
check("unknown field -> unknown_field", () => {
  expectInvalid(baseNative({ region: "south" }), GOVERNED_WAREHOUSE_REASONS.UNKNOWN_FIELD);
});
check("blank/non-string id/name/location fail closed", () => {
  expectInvalid(baseNative({ id: "" }), GOVERNED_WAREHOUSE_REASONS.ID_INVALID);
  expectInvalid(baseNative({ id: 7 }), GOVERNED_WAREHOUSE_REASONS.ID_INVALID);
  expectInvalid(baseNative({ name: "   " }), GOVERNED_WAREHOUSE_REASONS.NAME_INVALID);
  expectInvalid(baseNative({ location: null }), GOVERNED_WAREHOUSE_REASONS.LOCATION_INVALID);
});

// ---- determinism, no mutation, sanitized output ----
check("deterministic output and no input mutation", () => {
  const input = baseNative({ region: undefined }); // has 'region' own key (undefined) -> unknown_field path? no: undefined own key still a key
  delete input.region; // ensure a clean valid input
  const snapshotKeys = Object.keys(input).sort();
  const snapshotEntries = snapshotKeys.map((k) => [k, input[k]]);
  const r1 = validateGovernedWarehouse(input);
  const r2 = validateGovernedWarehouse(input);
  assert.equal(r1.valid, true);
  // deterministic: identical JSON on repeat runs
  assert.equal(JSON.stringify(r1.value), JSON.stringify(r2.value));
  // no input mutation: same keys and same values afterward
  assert.deepEqual(Object.keys(input).sort(), snapshotKeys);
  for (const [k, val] of snapshotEntries) assert.equal(input[k], val);
  // returned value is a fresh object, not the input
  assert.notEqual(r1.value, input);
});
check("valid value carries only governed fields (no active, no unknowns)", () => {
  const v = expectValid(baseNative());
  const keys = Object.keys(v);
  assert.ok(!keys.includes("active"));
  for (const k of keys) {
    assert.ok(
      ["id", "name", "location", "status", "version", "updatedAt", "updatedBy", "provenance", "createdAt", "createdBy", "governanceInitializedAt", "governanceInitializedBy"].includes(k),
      `unexpected key ${k} in sanitized value`,
    );
  }
});
check("every failure reason is a bounded governed token", () => {
  const samples = [
    null,
    baseNative({ active: true }),
    baseNative({ region: "x" }),
    baseNative({ status: "X" }),
    baseNative({ version: 0 }),
    baseNative({ updatedAt: FAKE_TS }),
    baseMigrated({ governanceInitializedBy: "" }),
  ];
  for (const s of samples) {
    const r = validateGovernedWarehouse(s);
    assert.equal(r.valid, false);
    assert.ok(ALL_REASONS.has(r.reason), `reason ${r.reason} not bounded`);
    // sanitized: reason is a short snake_case token, never echoes a raw value
    assert.match(r.reason, /^[a-z_]+$/);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
