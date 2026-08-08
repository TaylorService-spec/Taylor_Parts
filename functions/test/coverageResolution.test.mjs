// Commercial Coverage — TS resolver mirror (#15 read). Pure tests. Proves multi-assignment resolution (all
// effective + matching coexist), geographic + corporate + channel coverage, effective-dated historical truth,
// and no winner. Prereq: npm run build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCommercialCoverage, territoryCoversLocation, isEffective } from "../lib/coverage/coverageResolution.js";

const T_AZ = { kind: "STATE", geo: { states: ["AZ"] } };
const territoriesById = { "T-AZ": T_AZ };

test("territoryCoversLocation: STATE/ZIP; GEOSPATIAL fail-closed", () => {
  assert.equal(territoryCoversLocation(T_AZ, { state: "az" }), true);
  assert.equal(territoryCoversLocation(T_AZ, { state: "CA" }), false);
  assert.equal(territoryCoversLocation({ kind: "ZIP_GROUP", geo: { zipPrefixes: ["850"] } }, { zip: "85042" }), true);
  assert.equal(territoryCoversLocation({ kind: "GEOSPATIAL", geo: { polygonRef: "p" } }, { state: "AZ" }), false);
});

test("isEffective: inclusive from / exclusive to / open-ended", () => {
  assert.equal(isEffective({ effectiveFrom: 100, effectiveTo: 200 }, 100), true);
  assert.equal(isEffective({ effectiveFrom: 100, effectiveTo: 200 }, 200), false);
  assert.equal(isEffective({ effectiveFrom: 100, effectiveTo: null }, 9999), true);
});

test("resolve returns MULTIPLE coexisting assignments (geographic + corporate), expired excluded, no winner", () => {
  const assignments = [
    { assignmentId: "local", scope: { kind: "TERRITORY", territoryId: "T-AZ" }, effectiveFrom: 0, effectiveTo: null },
    { assignmentId: "corp", scope: { kind: "CORPORATE", corporateAccountId: "ACME" }, effectiveFrom: 0, effectiveTo: null },
    { assignmentId: "old", scope: { kind: "TERRITORY", territoryId: "T-AZ" }, effectiveFrom: 0, effectiveTo: 500 },
  ];
  const ctx = { accountId: "ACME-PHX", corporateAccountIds: ["ACME"], location: { state: "AZ", zip: "85001" } };
  const r = resolveCommercialCoverage(ctx, assignments, { now: 1000, territoriesById });
  assert.deepEqual(r.map((a) => a.assignmentId).sort(), ["corp", "local"]);
});

test("channel scope gates; corporate propagates across geography; historical truth by effective date", () => {
  const assignments = [
    { assignmentId: "natl", scope: { kind: "CHANNEL", channelId: "NATIONAL_ACCOUNTS" }, effectiveFrom: 0, effectiveTo: null },
    { assignmentId: "corp", scope: { kind: "CORPORATE", corporateAccountId: "ACME" }, effectiveFrom: 0, effectiveTo: null },
  ];
  const ctx = { accountId: "ACME-CA", corporateAccountIds: ["ACME"], channelId: "NATIONAL_ACCOUNTS", location: { state: "CA" } };
  assert.deepEqual(resolveCommercialCoverage(ctx, assignments, { now: 10, territoriesById }).map((a) => a.assignmentId).sort(), ["corp", "natl"]);
  assert.deepEqual(resolveCommercialCoverage({ ...ctx, channelId: "RETAIL" }, assignments, { now: 10, territoriesById }).map((a) => a.assignmentId), ["corp"]);
  // reassignment history
  const hist = [
    { assignmentId: "was", scope: { kind: "ACCOUNT", accountId: "A1" }, effectiveFrom: 0, effectiveTo: 1000 },
    { assignmentId: "now", scope: { kind: "ACCOUNT", accountId: "A1" }, effectiveFrom: 1000, effectiveTo: null },
  ];
  assert.deepEqual(resolveCommercialCoverage({ accountId: "A1" }, hist, { now: 500 }).map((a) => a.assignmentId), ["was"]);
  assert.deepEqual(resolveCommercialCoverage({ accountId: "A1" }, hist, { now: 5000 }).map((a) => a.assignmentId), ["now"]);
});

test("fail-closed: non-numeric now / bad input ⇒ []", () => {
  assert.deepEqual(resolveCommercialCoverage({ accountId: "A" }, [{ scope: { kind: "ACCOUNT", accountId: "A" }, effectiveFrom: 0 }], { now: null }), []);
  assert.deepEqual(resolveCommercialCoverage({}, null, { now: 1 }), []);
});
