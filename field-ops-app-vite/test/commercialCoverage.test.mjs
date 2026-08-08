// Commercial Coverage & Territory — PURE authority model tests (node:test). Proves the ratified principles:
// configurable channels, durable geographic territories (independent of salesperson), MULTI-assignment
// resolution (coverageAssignments[], never one), coexisting geographic + corporate coverage, effective-dated
// historical truth, and NO winner/owner/credit/commission decision.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEED_COMMERCIAL_CHANNELS, isConfiguredChannel,
  territoryCoversLocation, isEffective,
  resolveCommercialCoverage, summarizeCoverage,
} from "../src/domain/commercialCoverage.js";

const DAY = 24 * 60 * 60 * 1000;
const person = (id) => ({ assignedToEmployeeId: id, assignedToUserId: `${id}-uid`, assignedToDisplayName: id });

test("channels are configurable ref data (seed incl STRATEGIC_ACCOUNTS); unknown/inactive rejected", () => {
  assert.equal(isConfiguredChannel("RETAIL"), true);
  assert.equal(isConfiguredChannel("NATIONAL_ACCOUNTS"), true);
  assert.equal(isConfiguredChannel("STRATEGIC_ACCOUNTS"), true);
  assert.equal(isConfiguredChannel("MADE_UP"), false);
  assert.equal(isConfiguredChannel("X", [{ id: "X", active: false }]), false);
  assert.equal(SEED_COMMERCIAL_CHANNELS.length >= 3, true); // not hardcoded to a smaller triad boundary
});

test("territory covers location by STATE / STATE_GROUP / ZIP exact + prefix; GEOSPATIAL fail-closed", () => {
  assert.equal(territoryCoversLocation({ kind: "STATE", geo: { states: ["AZ", "NV"] } }, { state: "az" }), true);
  assert.equal(territoryCoversLocation({ kind: "STATE", geo: { states: ["AZ"] } }, { state: "CA" }), false);
  assert.equal(territoryCoversLocation({ kind: "STATE_GROUP", geo: { states: ["AZ", "NV", "UT"] } }, { state: "UT" }), true);
  assert.equal(territoryCoversLocation({ kind: "ZIP_GROUP", geo: { zips: ["85001"] } }, { zip: "85001" }), true);
  assert.equal(territoryCoversLocation({ kind: "ZIP_GROUP", geo: { zipPrefixes: ["850"] } }, { zip: "85042" }), true);
  assert.equal(territoryCoversLocation({ kind: "ZIP_GROUP", geo: { zipPrefixes: ["850"] } }, { zip: "90210" }), false);
  // GEOSPATIAL cannot be asserted without a geometry authority — never a fabricated hit
  assert.equal(territoryCoversLocation({ kind: "GEOSPATIAL", geo: { polygonRef: "poly-1" } }, { state: "AZ", zip: "85001" }), false);
});

test("effective dating: inclusive-from, exclusive-to, open-ended; excludes past/future", () => {
  const a = { effectiveFrom: 100, effectiveTo: 200 };
  assert.equal(isEffective(a, 100), true);
  assert.equal(isEffective(a, 199), true);
  assert.equal(isEffective(a, 200), false);
  assert.equal(isEffective(a, 50), false);
  assert.equal(isEffective({ effectiveFrom: 100, effectiveTo: null }, 10_000), true); // open-ended
});

const AZ_TERRITORY = { territoryId: "T-AZ", kind: "STATE", geo: { states: ["AZ"] } };
const territoriesById = { "T-AZ": AZ_TERRITORY };

test("resolveCommercialCoverage returns MULTIPLE coexisting assignments (geographic + corporate), no winner", () => {
  const now = 1_000_000;
  const assignments = [
    { assignmentId: "local", assignee: person("rivera"), scope: { kind: "TERRITORY", territoryId: "T-AZ" }, responsibility: "SALESPERSON", priority: "PRIMARY", effectiveFrom: 0, effectiveTo: null },
    { assignmentId: "corp", assignee: person("lee"), scope: { kind: "CORPORATE", corporateAccountId: "ACME" }, responsibility: "RELATIONSHIP_MGR", priority: "OVERLAY", effectiveFrom: 0, effectiveTo: null },
    { assignmentId: "other", assignee: person("kim"), scope: { kind: "TERRITORY", territoryId: "T-AZ" }, responsibility: "SPECIALIST", effectiveFrom: 0, effectiveTo: 500 }, // expired
  ];
  const ctx = { accountId: "ACME-PHX", corporateAccountIds: ["ACME"], location: { state: "AZ", zip: "85001" } };
  const covered = resolveCommercialCoverage(ctx, assignments, { now, territoriesById });
  assert.deepEqual(covered.map((a) => a.assignmentId).sort(), ["corp", "local"]); // both coexist; expired excluded
});

test("effective dating preserves historical truth: yesterday's coverage != today's after reassignment", () => {
  const assignments = [
    { assignmentId: "old", assignee: person("rivera"), scope: { kind: "ACCOUNT", accountId: "A1" }, effectiveFrom: 0, effectiveTo: 1000 },
    { assignmentId: "new", assignee: person("lee"), scope: { kind: "ACCOUNT", accountId: "A1" }, effectiveFrom: 1000, effectiveTo: null },
  ];
  const ctx = { accountId: "A1" };
  assert.deepEqual(resolveCommercialCoverage(ctx, assignments, { now: 500 }).map((a) => a.assignmentId), ["old"]);
  assert.deepEqual(resolveCommercialCoverage(ctx, assignments, { now: 5000 }).map((a) => a.assignmentId), ["new"]);
});

test("channel scope gates coverage; corporate coverage propagates across geography", () => {
  const now = 10;
  const assignments = [
    { assignmentId: "natl", assignee: person("lee"), scope: { kind: "CHANNEL", channelId: "NATIONAL_ACCOUNTS" }, effectiveFrom: 0, effectiveTo: null },
    { assignmentId: "corp-far", assignee: person("lee"), scope: { kind: "CORPORATE", corporateAccountId: "ACME" }, effectiveFrom: 0, effectiveTo: null },
  ];
  // A location in a DIFFERENT geography still gets corporate coverage (geography is not the only mechanism).
  const ctx = { accountId: "ACME-CA", corporateAccountIds: ["ACME"], channelId: "NATIONAL_ACCOUNTS", location: { state: "CA" } };
  assert.deepEqual(resolveCommercialCoverage(ctx, assignments, { now, territoriesById }).map((a) => a.assignmentId).sort(), ["corp-far", "natl"]);
  // wrong channel → the channel-scoped assignment drops out
  const ctx2 = { ...ctx, channelId: "RETAIL" };
  assert.deepEqual(resolveCommercialCoverage(ctx2, assignments, { now, territoriesById }).map((a) => a.assignmentId), ["corp-far"]);
});

test("fail-closed: non-numeric now or bad input yields [] (never a fabricated owner)", () => {
  assert.deepEqual(resolveCommercialCoverage({ accountId: "A1" }, [{ scope: { kind: "ACCOUNT", accountId: "A1" }, effectiveFrom: 0 }], { now: null }), []);
  assert.deepEqual(resolveCommercialCoverage({}, null, { now: 1 }), []);
});

test("summarizeCoverage counts by responsibility + primary flag, but exposes NO owner/credit/commission", () => {
  const covered = [
    { responsibility: "SALESPERSON", priority: "PRIMARY" },
    { responsibility: "RELATIONSHIP_MGR", priority: "OVERLAY" },
    { responsibility: "SALESPERSON" },
  ];
  const s = summarizeCoverage(covered);
  assert.equal(s.total, 3);
  assert.equal(s.byResponsibility.SALESPERSON, 2);
  assert.equal(s.hasPrimary, true);
  for (const forbidden of ["owner", "salesperson", "credit", "commission", "primary", "winner"]) {
    assert.equal(forbidden in s, false, `summary must not expose ${forbidden}`);
  }
});
