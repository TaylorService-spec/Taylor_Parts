// Coordinated-operations SOURCE seam — pure unit tests (node:test). Fidelity fix (2026-08-15): proves the
// production default is no longer synthetic, structurally (not by convention), that the synthetic fixture
// source stays injectable for tests/stories from its own module, and that the governed-read result mapper
// keeps "ready" / "denied" / "unavailable" distinct — so failure never collapses into empty, and denial
// never collapses into absence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  mapCoordinatedOperationsReadResult,
  inertCoordinatedOperationsSource,
  governedCoordinatedOperationsSource,
  DEFAULT_COORDINATED_OPERATIONS_SOURCE,
} from "../src/access/coordinatedOperationsSource.js";
import { syntheticCoordinatedOperationsSource } from "../src/access/coordinatedOperationsSyntheticSource.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRODUCTION_SOURCE_PATH = path.join(__dirname, "../src/access/coordinatedOperationsSource.js");

// ----- STRUCTURAL: the production module cannot regress to synthetic data by accident -----

test("the production coordinatedOperationsSource.js module never IMPORTS the synthetic source or its fixtures", () => {
  const raw = readFileSync(PRODUCTION_SOURCE_PATH, "utf8");
  const importLines = raw.split("\n").filter((line) => /^\s*import\b/.test(line));
  for (const line of importLines) {
    assert.equal(/coordinatedOperationsFixtures/.test(line), false, `must not import fixtures: "${line}"`);
    assert.equal(/coordinatedOperationsSyntheticSource/.test(line), false, `must not import the synthetic source: "${line}"`);
    assert.equal(/syntheticCoordinatedOperationsSource/.test(line), false, `must not import the synthetic export: "${line}"`);
  }
});

test("the production module does not export a synthetic source at all", async () => {
  const mod = await import("../src/access/coordinatedOperationsSource.js");
  assert.equal("syntheticCoordinatedOperationsSource" in mod, false);
});

test("DEFAULT_COORDINATED_OPERATIONS_SOURCE is the governed source, not a synthetic one", () => {
  assert.equal(DEFAULT_COORDINATED_OPERATIONS_SOURCE, governedCoordinatedOperationsSource);
  assert.notEqual(DEFAULT_COORDINATED_OPERATIONS_SOURCE, syntheticCoordinatedOperationsSource);
});

// ----- the fixture source stays injectable for tests/stories, from its OWN module -----

test("syntheticCoordinatedOperationsSource remains directly importable/injectable and self-identifies as synthetic", () => {
  const snap = syntheticCoordinatedOperationsSource();
  assert.equal(snap.status, "ready");
  assert.equal(snap.synthetic, true);
  assert.equal(Array.isArray(snap.workOrders), true);
  assert.equal(snap.workOrders.length > 0, true);
});

// ----- authorized / denied / empty / unavailable stay distinct -----

test("mapCoordinatedOperationsReadResult: a successful payload with data -> ready, populated, not synthetic", () => {
  const snap = mapCoordinatedOperationsReadResult({
    ok: true,
    payload: { status: "ready", workOrders: [{ id: "WO-1", salesOrderId: "SO-1" }], skipped: 0, truncated: false },
  });
  assert.equal(snap.status, "ready");
  assert.equal(snap.synthetic, false);
  assert.equal(snap.workOrders.length, 1);
  assert.equal(snap.error, null);
});

test("mapCoordinatedOperationsReadResult: a successful payload with ZERO work orders -> ready + empty (not unavailable, not denied)", () => {
  const snap = mapCoordinatedOperationsReadResult({ ok: true, payload: { status: "ready", workOrders: [], skipped: 0, truncated: false } });
  assert.equal(snap.status, "ready");
  assert.deepEqual(snap.workOrders, []);
});

test("mapCoordinatedOperationsReadResult: a permission-denied error -> denied, NOT unavailable and NOT empty-ready", () => {
  const snap = mapCoordinatedOperationsReadResult({ ok: false, errorCode: "permission-denied" });
  assert.equal(snap.status, "denied");
  assert.notEqual(snap.status, "ready");
  assert.notEqual(snap.status, "unavailable");
  assert.deepEqual(snap.workOrders, []);
});

test("mapCoordinatedOperationsReadResult: an unrelated failure (network/internal) -> unavailable, distinct from denied", () => {
  const snap = mapCoordinatedOperationsReadResult({ ok: false, errorCode: "internal" });
  assert.equal(snap.status, "unavailable");
  assert.notEqual(snap.status, "denied");
});

test("mapCoordinatedOperationsReadResult: no arguments at all (thrown before a code was known) -> unavailable, never a silent ready/empty", () => {
  const snap = mapCoordinatedOperationsReadResult();
  assert.equal(snap.status, "unavailable");
  assert.notEqual(snap.error, null);
});

// ----- inert source stays a distinct, explicit "not wired" state -----

test("inertCoordinatedOperationsSource is unavailable + empty, distinct from a governed 'ready + empty' result", () => {
  const snap = inertCoordinatedOperationsSource();
  assert.equal(snap.status, "unavailable");
  assert.deepEqual(snap.workOrders, []);
});

// ----- no raw UID passthrough: the mapper never invents or copies an actor/uid field onto the snapshot -----

test("mapCoordinatedOperationsReadResult never adds a uid-shaped field even if the raw payload carries one", () => {
  const snap = mapCoordinatedOperationsReadResult({
    ok: true,
    payload: { status: "ready", workOrders: [{ id: "WO-1", salesOrderId: "SO-1", createdByUid: "uid-should-not-appear-on-snapshot" }] },
  });
  assert.equal("createdByUid" in snap, false);
  assert.equal("uid" in snap, false);
  assert.equal("actorUid" in snap, false);
});
