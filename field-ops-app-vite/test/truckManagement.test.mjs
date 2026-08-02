// EI Truck Registry -- pure-logic + source-boundary tests for the Truck Management UI.
// Runs offline under `node --test` (no jsdom, no firebase): domain error mapping, the
// governed option sets, the management-record projection, create validation, the
// write-readiness seam default, and static assertions that the management surface holds
// NO firebase / no direct Firestore-write imports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  mapTruckCommandError,
  projectManagementRecords,
  indexManagementRecords,
  validateCreateInput,
  TRUCK_STATUS_OPTIONS,
  REACTIVATION_TARGET_OPTIONS,
  TRUCK_COMMAND_OUTCOME,
  DEACTIVATED_STATUS,
  truckStatusLabel,
  makeIdempotencyKey,
} from "../src/domain/truckManagement.js";
import { TRUCK_MANAGEMENT_WRITE_READY, resolveWriteReadiness } from "../src/config/truckManagementReadiness.js";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");

test("governed status options are exactly the three governed values (never inferred)", () => {
  assert.deepEqual([...TRUCK_STATUS_OPTIONS], ["ACTIVE", "IDLE", "OUT_OF_SERVICE"]);
  assert.deepEqual([...REACTIVATION_TARGET_OPTIONS], ["ACTIVE", "IDLE"]);
  assert.equal(DEACTIVATED_STATUS, "OUT_OF_SERVICE");
  assert.equal(truckStatusLabel("ACTIVE"), "Active");
  assert.equal(truckStatusLabel("bogus"), "Unavailable");
});

test("error mapping: each code -> stable kind, and the raw message never leaks", () => {
  const cases = [
    ["functions/permission-denied", TRUCK_COMMAND_OUTCOME.DENIED],
    ["functions/unauthenticated", TRUCK_COMMAND_OUTCOME.DENIED],
    ["functions/aborted", TRUCK_COMMAND_OUTCOME.CONFLICT],
    ["functions/invalid-argument", TRUCK_COMMAND_OUTCOME.INVALID],
    ["functions/failed-precondition", TRUCK_COMMAND_OUTCOME.INVALID],
    ["functions/not-found", TRUCK_COMMAND_OUTCOME.INVALID],
    ["functions/already-exists", TRUCK_COMMAND_OUTCOME.INVALID],
    ["functions/unavailable", TRUCK_COMMAND_OUTCOME.UNAVAILABLE],
    ["functions/deadline-exceeded", TRUCK_COMMAND_OUTCOME.UNAVAILABLE],
    ["functions/internal", TRUCK_COMMAND_OUTCOME.FAILURE],
    ["permission-denied", TRUCK_COMMAND_OUTCOME.DENIED], // firestore-style (no prefix)
  ];
  const SECRET = "SECRET-internal-id-v42-do-not-render";
  for (const [code, kind] of cases) {
    const out = mapTruckCommandError({ code, message: SECRET });
    assert.equal(out.kind, kind, `code ${code}`);
    assert.ok(typeof out.message === "string" && out.message.length > 0);
    assert.ok(!out.message.includes(SECRET), `raw message leaked for ${code}`);
  }
  // Undefined / weird errors collapse to a generic failure.
  assert.equal(mapTruckCommandError(undefined).kind, TRUCK_COMMAND_OUTCOME.FAILURE);
  assert.equal(mapTruckCommandError({}).kind, TRUCK_COMMAND_OUTCOME.FAILURE);
  assert.equal(mapTruckCommandError(new Error("boom")).kind, TRUCK_COMMAND_OUTCOME.FAILURE);
});

test("projectManagementRecords: keeps valid rows, fails closed on missing id/version", () => {
  const docs = [
    { docId: "TRK-1", data: { version: 3, status: "ACTIVE", homeWarehouseId: "WH-1", assignedDriverEmployeeId: "E1", displayLabel: "One", vehicleNumber: "V1" } },
    { docId: "TRK-2", data: { version: 1, status: "WEIRD", homeWarehouseId: "", assignedDriverEmployeeId: null } }, // bad status -> null, kept
    { docId: "TRK-3", data: { status: "IDLE" } }, // no version -> skipped
    { docId: "", data: { version: 1 } }, // no id -> skipped
    "nonsense",
    null,
  ];
  const recs = projectManagementRecords(docs);
  assert.equal(recs.length, 2);
  const one = recs.find((r) => r.truckId === "TRK-1");
  assert.deepEqual(one, { truckId: "TRK-1", version: 3, status: "ACTIVE", homeWarehouseId: "WH-1", assignedDriverEmployeeId: "E1", displayLabel: "One", vehicleNumber: "V1" });
  const two = recs.find((r) => r.truckId === "TRK-2");
  assert.equal(two.status, null); // ungoverned status is not surfaced as a selectable value
  assert.equal(two.homeWarehouseId, null);
  assert.equal(projectManagementRecords("nope").length, 0);

  const idx = indexManagementRecords(recs);
  assert.equal(idx.get("TRK-1").version, 3);
  assert.equal(idx.has("TRK-3"), false);
});

test("validateCreateInput: required fields + explicit governed status", () => {
  const bad = validateCreateInput({ truckId: " ", vehicleNumber: "", displayLabel: "L", locationId: "L1", homeWarehouseId: "WH", status: "NOPE" });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.truckId && bad.errors.vehicleNumber && bad.errors.status);
  assert.equal(bad.value, null);

  const good = validateCreateInput({ truckId: " TRK-9 ", vehicleNumber: "V9", displayLabel: "Nine", locationId: "MOBILE-9", homeWarehouseId: "WH-9", status: "IDLE", assignedDriverEmployeeId: "" });
  assert.equal(good.ok, true);
  assert.equal(good.value.truckId, "TRK-9"); // trimmed
  assert.equal(good.value.status, "IDLE");
  assert.equal(good.value.assignedDriverEmployeeId, null); // blank -> null (unassigned)
});

test("write-readiness seam is ACTIVATED (true); explicit boolean override still wins, false still fails closed", () => {
  assert.equal(TRUCK_MANAGEMENT_WRITE_READY, true);
  assert.equal(resolveWriteReadiness(undefined), true); // no override -> the activated constant
  assert.equal(resolveWriteReadiness("true"), true); // non-boolean ignored -> falls back to the constant
  assert.equal(resolveWriteReadiness(true), true); // explicit true override
  assert.equal(resolveWriteReadiness(false), false); // explicit false override STILL fails closed (zero callable attempts)
});

test("idempotency keys are unique and prefixed", () => {
  const a = makeIdempotencyKey();
  const b = makeIdempotencyKey();
  assert.ok(a.startsWith("tmui_") && b.startsWith("tmui_"));
  assert.notEqual(a, b);
});

// --- Source boundary: the management SURFACE must hold no firebase / no direct writes ---
const FIREBASE_FREE = [
  "domain/truckManagement.js",
  "config/truckManagementReadiness.js",
  "modules/inventory/truckManagement/GovernedStatusSelect.jsx",
  "modules/inventory/truckManagement/BoundedSelect.jsx",
  "modules/inventory/truckManagement/WriteDisabledNotice.jsx",
  "modules/inventory/truckManagement/OutcomeBanner.jsx",
  "modules/inventory/truckManagement/CreateTruckModal.jsx",
  "modules/inventory/truckManagement/ManageTruckDrawer.jsx",
  "modules/inventory/truckManagement/mockTruckCommandClient.js",
  "modules/inventory/truckManagement/TruckManagementPreview.jsx",
];
// Anywhere in the management code, no direct Firestore write primitives.
const WRITE_FREE = [
  ...FIREBASE_FREE,
  "hooks/useTruckManagement.js",
  "hooks/useDriverOptions.js",
  "hooks/useWarehouseOptions.js",
  "services/truckRegistryCommandClient.js",
];
const WRITE_PRIMITIVES = /\b(setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction|setDocs)\b/;

test("management surface imports NO firebase (renderable/mocked without a backend)", () => {
  for (const rel of FIREBASE_FREE) {
    const text = readFileSync(join(src, rel), "utf8");
    assert.ok(!/from\s+["'][^"']*firebase/.test(text), `${rel} must not import firebase`);
  }
});

test("no direct Firestore write calls anywhere in the management code (callables only)", () => {
  for (const rel of WRITE_FREE) {
    const text = readFileSync(join(src, rel), "utf8");
    assert.ok(!WRITE_PRIMITIVES.test(text), `${rel} must not use a direct Firestore write primitive`);
  }
});

test("the mock preview client can never reach production (no firebase, no httpsCallable)", () => {
  const text = readFileSync(join(src, "modules/inventory/truckManagement/mockTruckCommandClient.js"), "utf8");
  assert.ok(!/httpsCallable/.test(text));
  assert.ok(!/from\s+["'][^"']*firebase/.test(text));
  assert.ok(!/import\s+["'][^"']*firebase/.test(text));
});
