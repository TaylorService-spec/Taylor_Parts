// The `assignedToUserId` consumer census, checked against the repository.
//
// The census is the retirement gate for the Reorder assignment identity seam, so it is only worth having if it
// cannot be wrong: the suite DERIVES the executable set and asserts correspondence in both directions, including
// the occurrence counts.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(FUNCTIONS_DIR, "..");
const require = createRequire(import.meta.url);
const census = require("../lib/eosOps/migration/assignedToUserIdCensus.js");
const { ASSIGNED_TO_USER_ID_CENSUS, CENSUS_CLASSIFICATIONS, CENSUS_OBJECTS, CENSUS_STATUSES, BLOCKING_CLASSIFICATIONS, assignmentCutoverReadiness } = census;

const FIELD = "assignedToUserId";
/** The census module itself names the field as its own subject, not as a consumer of it. */
const SELF = "functions/src/eosOps/migration/assignedToUserIdCensus.ts";

/** Comments are prose. Line structure is preserved so Rules attribution stays honest. */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

function walk(dir, out = []) {
  let entries = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs|rules)$/.test(name)) out.push(p);
  }
  return out;
}

function derive() {
  const found = new Map();
  const files = [];
  for (const root of ["functions/src", "functions/scripts", "field-ops-app-vite/src", "integrations", "tools"]) {
    walk(join(REPO, root), files);
  }
  files.push(join(REPO, "firestore.rules"));
  for (const file of files) {
    let raw;
    try { raw = readFileSync(file, "utf8"); } catch { continue; }
    const occurrences = (stripComments(raw).match(new RegExp(FIELD, "g")) ?? []).length;
    const rel = relative(REPO, file).split("\\").join("/");
    if (occurrences > 0 && rel !== SELF) found.set(rel, occurrences);
  }
  return found;
}

const derived = derive();
const byPath = new Map(ASSIGNED_TO_USER_ID_CENSUS.map((c) => [c.path, c]));

test("the census and the repository name exactly the same consumers", () => {
  assert.deepEqual([...byPath.keys()].sort(), [...derived.keys()].sort(),
    "a consumer appeared or disappeared: classify the new one, or remove the entry whose file no longer uses the field");
  assert.equal(byPath.size, ASSIGNED_TO_USER_ID_CENSUS.length, "a path is listed twice");
});

test("every recorded occurrence count is the real one", () => {
  // A count that drifts is how a consumer gains an authorization use nobody classified.
  for (const [path, occurrences] of derived) {
    assert.equal(byPath.get(path).occurrences, occurrences, path);
  }
});

test("every entry is internally coherent", () => {
  for (const c of ASSIGNED_TO_USER_ID_CENSUS) {
    assert.ok(CENSUS_OBJECTS.includes(c.object), `${c.path}: unknown object`);
    assert.ok(CENSUS_CLASSIFICATIONS.includes(c.classification), `${c.path}: unknown classification`);
    assert.ok(CENSUS_STATUSES.includes(c.status), `${c.path}: unknown status`);
    assert.ok(typeof c.consumer === "string" && c.consumer.length > 20, `${c.path}: consumer must say what it does`);
    assert.ok(c.occurrences > 0, `${c.path}: an entry with no occurrences is not a consumer`);
  }
});

test("TWO OBJECTS share the name, and only REORDER gates the Reorder retirement", () => {
  const commercial = ASSIGNED_TO_USER_ID_CENSUS.filter((c) => c.object === "COMMERCIAL");
  assert.ok(commercial.length > 0, "the Commercial Person Assignment consumers must be recorded");
  // The Commercial map already carries the Employee id beside the uid, so it lacks the defect this census exists
  // for. Proving that here keeps the two seams from being conflated by a later reader.
  const profile = readFileSync(join(REPO, "field-ops-app-vite/src/domain/commercialProfile.js"), "utf8");
  assert.match(profile, /assignedToEmployeeId/, "the Commercial assignment must already name an Employee");
  const readiness = assignmentCutoverReadiness();
  for (const c of commercial) {
    assert.ok(!readiness.blockedBy.includes(c.path), `${c.path} is gating the Reorder cutover`);
  }
});

test("the cutover gate is COMPUTED, and every authorization consumer is still unconverted", () => {
  const readiness = assignmentCutoverReadiness();
  assert.equal(readiness.ready, false, "the governed assignment must not be live while any uid consumer decides access");
  // The seam was originally scoped to write transitions alone; the derivation proves reads are in it too.
  assert.ok(readiness.blockingByClassification.ASSIGNEE_READ_AUTHORIZATION > 0,
    "an assignee-scoped READ consumer must be counted: the cutover cannot move writes alone");
  assert.ok(readiness.blockingByClassification.ASSIGNMENT_WRITE > 0);
  assert.ok(readiness.blockingByClassification.ASSIGNEE_ACTION_AUTHORIZATION > 0);

  // The gate is derived from status, not asserted: converting the blocking set must open it.
  const pretend = ASSIGNED_TO_USER_ID_CENSUS.map((c) =>
    BLOCKING_CLASSIFICATIONS.includes(c.classification) ? { ...c, status: "CONVERTED" } : c);
  assert.equal(assignmentCutoverReadiness(pretend).ready, true);
  // And converting only the writes does NOT open it -- the whole assignee seam moves together.
  const writesOnly = ASSIGNED_TO_USER_ID_CENSUS.map((c) =>
    c.classification === "ASSIGNMENT_WRITE" ? { ...c, status: "CONVERTED" } : c);
  assert.equal(assignmentCutoverReadiness(writesOnly).ready, false,
    "moving the writer alone must not open the gate: that is the forbidden dual-authority state");
});

test("nothing is CONVERTED yet: the governed assignment authority exists but is inert", () => {
  assert.deepEqual(ASSIGNED_TO_USER_ID_CENSUS.filter((c) => c.status !== "NOT_STARTED").map((c) => c.path), []);
});

test("the census decides nothing and scans nothing: pure data plus one derivation", () => {
  const src = stripComments(readFileSync(join(FUNCTIONS_DIR, "src/eosOps/migration/assignedToUserIdCensus.ts"), "utf8"));
  assert.doesNotMatch(src, /\bpg\b|pool|client\.query|SELECT |INSERT |UPDATE |DELETE /i);
  assert.doesNotMatch(src, /readFileSync|readdirSync|process\.env|fetch\(/, "the census must not scan; its suite does");
  assert.doesNotMatch(src, /require\(\s*["'][^"']*fire(base|store)[^"']*["']\s*\)|from\s+["'][^"']*fire(base|store)[^"']*["']/i);
  assert.ok(Object.keys(census).length <= 10, "the census is growing beyond a census");
});
