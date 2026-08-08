// Commercial Coverage & Territory (#15) — governed write command core. Pure tests. Proves territory geo
// validation per kind, the person-assignment + scope validation, effective dating, and that assignments are
// records-only (no precedence/credit/commission). Prereq: npm run build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTerritory, buildCoverageAssignment, TERRITORY_KINDS, COVERAGE_SCOPE_KINDS, CoverageCommandError } from "../lib/coverage/coverageCommands.js";

const DEPS = { nowMillis: 1_700_000_000_000 };

test("territory kinds + scope kinds are the ratified sets", () => {
  assert.deepEqual([...TERRITORY_KINDS], ["STATE", "STATE_GROUP", "ZIP_GROUP", "GEOSPATIAL"]);
  assert.deepEqual([...COVERAGE_SCOPE_KINDS], ["TERRITORY", "ACCOUNT", "NAMED_ACCOUNT", "CORPORATE", "CHANNEL"]);
});

test("buildTerritory validates geo per kind (states / zips / polygonRef), uppercases states", () => {
  assert.deepEqual(buildTerritory({ name: "AZ", kind: "STATE", geo: { states: ["az"] } }, DEPS).geo, { states: ["AZ"] });
  assert.deepEqual(buildTerritory({ name: "SW", kind: "STATE_GROUP", geo: { states: ["AZ", "nv"] } }, DEPS).geo, { states: ["AZ", "NV"] });
  assert.deepEqual(buildTerritory({ name: "Metro", kind: "ZIP_GROUP", geo: { zipPrefixes: ["850"] } }, DEPS).geo, { zipPrefixes: ["850"] });
  assert.deepEqual(buildTerritory({ name: "Poly", kind: "GEOSPATIAL", geo: { polygonRef: "poly-1" } }, DEPS).geo, { polygonRef: "poly-1" });
  assert.equal(buildTerritory({ name: "X", kind: "STATE", geo: { states: ["AZ"] }, status: "INACTIVE" }, DEPS).status, "INACTIVE");
});

test("buildTerritory fail-closed: bad kind / missing name / missing geo", () => {
  assert.throws(() => buildTerritory({ name: "x", kind: "COUNTRY", geo: {} }, DEPS), (e) => e instanceof CoverageCommandError && e.code === "KIND_INVALID");
  assert.throws(() => buildTerritory({ name: "", kind: "STATE", geo: { states: ["AZ"] } }, DEPS), (e) => e.code === "REQUIRED");
  assert.throws(() => buildTerritory({ name: "x", kind: "STATE", geo: {} }, DEPS), (e) => e.code === "GEO_INVALID");
  assert.throws(() => buildTerritory({ name: "x", kind: "ZIP_GROUP", geo: {} }, DEPS), (e) => e.code === "GEO_INVALID");
  assert.throws(() => buildTerritory({ name: "x", kind: "GEOSPATIAL", geo: {} }, DEPS), (e) => e.code === "GEO_INVALID");
});

const assignee = { assignedToEmployeeId: "EMP-1", assignedToUserId: "UID-1", assignedToDisplayName: "Sam" };

test("buildCoverageAssignment: valid TERRITORY scope, effective-dated, records only (no winner/credit)", () => {
  const r = buildCoverageAssignment({ companyId: "taylor", assignee, scope: { kind: "TERRITORY", territoryId: "T-AZ", channelId: "RETAIL" }, responsibility: "SALESPERSON", priority: "PRIMARY", effectiveFrom: 1000, effectiveTo: null }, DEPS);
  assert.equal(r.companyId, "taylor");
  assert.equal(r.assignee.assignedToEmployeeId, "EMP-1");
  assert.deepEqual(r.scope, { kind: "TERRITORY", territoryId: "T-AZ", channelId: "RETAIL" }); // channel AND geo coexist
  assert.equal(r.responsibility, "SALESPERSON");
  assert.equal(r.priority, "PRIMARY");
  assert.equal(r.effectiveTo, null);
  // records only: no derived credit/commission/winner fields
  for (const f of ["credit", "commission", "isPrimarySalesperson", "winner"]) assert.equal(f in r, false);
});

test("each scope kind requires its ref; assignee requires both identity refs", () => {
  const base = { companyId: "taylor", assignee, effectiveFrom: 1 };
  assert.throws(() => buildCoverageAssignment({ ...base, scope: { kind: "TERRITORY" } }, DEPS), (e) => e.code === "SCOPE_INVALID");
  assert.throws(() => buildCoverageAssignment({ ...base, scope: { kind: "ACCOUNT" } }, DEPS), (e) => e.code === "SCOPE_INVALID");
  assert.throws(() => buildCoverageAssignment({ ...base, scope: { kind: "CORPORATE" } }, DEPS), (e) => e.code === "SCOPE_INVALID");
  assert.throws(() => buildCoverageAssignment({ ...base, scope: { kind: "WHAT", accountId: "A" } }, DEPS), (e) => e.code === "SCOPE_INVALID");
  assert.throws(() => buildCoverageAssignment({ companyId: "t", assignee: { assignedToEmployeeId: "E" }, scope: { kind: "ACCOUNT", accountId: "A" }, effectiveFrom: 1 }, DEPS), (e) => e.code === "ASSIGNEE_INVALID");
});

test("effective dating: from required; to must be after from (or null)", () => {
  const base = { companyId: "t", assignee, scope: { kind: "ACCOUNT", accountId: "A" } };
  assert.throws(() => buildCoverageAssignment({ ...base }, DEPS), (e) => e.code === "EFFECTIVE_FROM_INVALID");
  assert.throws(() => buildCoverageAssignment({ ...base, effectiveFrom: 100, effectiveTo: 50 }, DEPS), (e) => e.code === "EFFECTIVE_RANGE_INVALID");
  assert.equal(buildCoverageAssignment({ ...base, effectiveFrom: 100, effectiveTo: 200 }, DEPS).effectiveTo, 200);
});
