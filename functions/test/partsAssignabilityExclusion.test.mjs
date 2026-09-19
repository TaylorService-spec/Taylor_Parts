// LEGACY_SEMANTIC_CONFLICT: measuring what `securityRole == TECHNICIAN` excludes, proved offline.
//
// The measurement exists so an Owner ruling rests on evidence rather than on the filter's apparent intent. So this
// suite pins BOTH halves: the partition itself, and the repository facts that make the conflict what it is.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(FUNCTIONS_DIR, "..");
const require = createRequire(import.meta.url);
const exclusion = require("../lib/eosWorkforce/migration/partsAssignabilityExclusion.js");
const { parseEmployeeProfileSnapshot } = require("../lib/eosWorkforce/migration/employeeProfileSnapshot.js");
const { COMPATIBILITY_ROLES } = require("../lib/access/compatibilityRoles.js");

const VALID = ["admin", "dispatcher", "technician", "salesperson", "partsManager", "warehouseManager"];

const snapshotOf = (employees) => parseEmployeeProfileSnapshot({
  format: "EOS_EMPLOYEE_PROFILE_SNAPSHOT", version: 1,
  source: { firebaseProjectId: "taylor-nonprod", exportedAt: "2026-09-19T00:00:00.000Z" },
  employees,
});
const assignable = (over = {}) => ({ employmentStatus: "ACTIVE", operationalRoles: ["PARTS_ASSOCIATE"], userId: "uid-x", securityRole: "partsManager", ...over });

test("the STORED query is reproduced exactly: all three clauses, none optional", () => {
  const report = exclusion.reportPartsAssignabilityExclusion(snapshotOf([
    { id: "e-ok", data: assignable() },
    { id: "e-inactive", data: assignable({ employmentStatus: "ON_LEAVE" }) },
    { id: "e-not-parts", data: assignable({ operationalRoles: ["TECHNICIAN"] }) },
    { id: "e-no-roles", data: assignable({ operationalRoles: [] }) },
    { id: "e-unlinked", data: assignable({ userId: null }) },
    { id: "e-blank-link", data: assignable({ userId: "" }) },
  ]), new Map(), VALID);
  assert.equal(report.satisfyingStoredQuery, 1, "only the Employee satisfying all three clauses counts");
  assert.equal(report.counts.INCLUDED_TODAY, 1);
  assert.deepEqual(report.excluded, []);
});

test("the partition: technician excluded, unverified excluded and counted apart, everyone else included", () => {
  const report = exclusion.reportPartsAssignabilityExclusion(snapshotOf([
    { id: "e-parts", data: assignable({ securityRole: "partsManager" }) },
    { id: "e-tech", data: assignable({ securityRole: "technician" }) },
    { id: "e-missing", data: assignable({ securityRole: null }) },
    { id: "e-absent", data: (() => { const d = assignable(); delete d.securityRole; return d; })() },
    { id: "e-drifted", data: assignable({ securityRole: "not-a-role" }) },
  ]), new Map(), VALID);

  assert.equal(report.satisfyingStoredQuery, 5);
  assert.deepEqual(report.counts, {
    INCLUDED_TODAY: 1,
    EXCLUDED_BY_TECHNICIAN_SECURITY_ROLE: 1,
    // The warning case is counted SEPARATELY, never folded into "not eligible" -- the hook's own rule.
    EXCLUDED_BY_UNVERIFIED_SECURITY_ROLE: 3,
  });
  assert.deepEqual(report.excluded.map((e) => [e.employeeId, e.disposition, e.legacySecurityRole]), [
    ["e-absent", "EXCLUDED_BY_UNVERIFIED_SECURITY_ROLE", null],
    ["e-drifted", "EXCLUDED_BY_UNVERIFIED_SECURITY_ROLE", "not-a-role"],
    ["e-missing", "EXCLUDED_BY_UNVERIFIED_SECURITY_ROLE", null],
    ["e-tech", "EXCLUDED_BY_TECHNICIAN_SECURITY_ROLE", "technician"],
  ]);
});

test("governed facts are attached as EVIDENCE, and absence is reported rather than assumed", () => {
  const governed = new Map([
    ["e-tech", { securityRoleKeys: ["technician", "salesperson"], jobRole: "Parts / Warehouse", knownToPostgres: true }],
  ]);
  const report = exclusion.reportPartsAssignabilityExclusion(snapshotOf([
    { id: "e-tech", data: assignable({ securityRole: "technician" }) },
    { id: "e-unknown", data: assignable({ securityRole: "technician" }) },
  ]), governed, VALID);

  const [known, unknown] = report.excluded;
  assert.deepEqual([known.employeeId, known.governedSecurityRoleKeys, known.governedJobRole, known.knownToPostgres],
    ["e-tech", ["salesperson", "technician"], "Parts / Warehouse", true]);
  // An Employee PostgreSQL does not know is reported as unknown, never as "holds nothing".
  assert.deepEqual([unknown.employeeId, unknown.governedSecurityRoleKeys, unknown.governedJobRole, unknown.knownToPostgres],
    ["e-unknown", [], null, false]);
});

test("the report is deterministic and decides nothing", () => {
  const employees = [
    { id: "e-b", data: assignable({ securityRole: "technician" }) },
    { id: "e-a", data: assignable({ securityRole: null }) },
  ];
  const a = exclusion.reportPartsAssignabilityExclusion(snapshotOf(employees), new Map(), VALID);
  const b = exclusion.reportPartsAssignabilityExclusion(snapshotOf([...employees].reverse()), new Map(), VALID);
  assert.deepEqual(a, b, "the report depends on snapshot order");
  assert.deepEqual(a.excluded.map((e) => e.employeeId), ["e-a", "e-b"]);

  const src = readFileSync(join(FUNCTIONS_DIR, "src/eosWorkforce/migration/partsAssignabilityExclusion.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(src, /\bpg\b|pool|client\.query|SELECT |INSERT |UPDATE |DELETE /i);
  assert.doesNotMatch(src, /Date\.now|new Date|Math\.random/);
  // It must never become an eligibility rule: nothing here returns "assignable".
  assert.doesNotMatch(src, /isAssignable|canBeAssigned|eligible\s*=/);
});

test("REPOSITORY FACT: no server authority enforces the exclusion -- it is advisory UI filtering", () => {
  // This is what the Owner ruling turns on, so it is asserted rather than asserted-in-prose.
  const rules = readFileSync(join(REPO, "firestore.rules"), "utf8");
  const assignArm = rules.slice(rules.indexOf('// Assign -- gains the new OR'), rules.indexOf('// Start Purchasing'));
  assert.ok(assignArm.length > 0, "the Assign arm moved; re-establish the finding before trusting this report");
  // The arm requires an assignee id to be PRESENT, and checks nothing about who that assignee is.
  assert.match(assignArm, /request\.resource\.data\.assignedToUserId is string/);
  assert.doesNotMatch(assignArm, /securityRole|operationalRoles|employmentStatus/,
    "the Assign arm now checks the assignee: the exclusion may no longer be advisory");
  // And no server command validates an assignee's eligibility.
  const callables = readFileSync(join(FUNCTIONS_DIR, "src/reorderRequest/reorderCallables.ts"), "utf8");
  assert.doesNotMatch(callables, /securityRole/, "a server command began checking the assignee's Security Role");
  assert.equal(exclusion.reportPartsAssignabilityExclusion(snapshotOf([]), new Map(), VALID).enforcedByAnyServerAuthority, false);
});

test("REPOSITORY FACT: the technician Role can PERFORM the work it cannot be OFFERED", () => {
  // The tension the ruling should weigh: the picker refuses to offer the work to a technician-role Employee, while
  // the catalog grants that same Role the whole Parts-Associate reorder workflow under PARTS_ASSOCIATE.
  const conditioned = COMPATIBILITY_ROLES.technician.conditionsByPermission ?? {};
  const partsAssociateGated = Object.entries(conditioned)
    .filter(([, cs]) => (cs ?? []).some((c) => c.kind === "operationalRoleActive" && c.params?.role === exclusion.LEGACY_ASSIGNABLE_OPERATIONAL_ROLE))
    .map(([id]) => id).sort();
  assert.deepEqual(partsAssociateGated, [
    "reorder.purchaseOrder.create", "reorder.purchaseOrder.read", "reorder.request.markReceived",
    "reorder.request.postPurchasingUpdate", "reorder.request.read.own", "reorder.request.recordPurchaseOrder",
    "reorder.request.startPurchasing",
  ]);
  assert.equal(exclusion.LEGACY_EXCLUDED_SECURITY_ROLE, "technician");
});
