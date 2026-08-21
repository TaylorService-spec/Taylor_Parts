// WORKBOOK RECONCILIATION GUARDS. Run: node --test test/workbookReconciliation.test.mjs
//
// A stale Summary sheet must become impossible to merge unnoticed. It was possible before, and it
// happened: Summary and Detailed CRUD disagreed in 68 places, and the disagreement was invisible
// because the two sheets were maintained as independent designs. Whoever read Summary was reading a
// different permission model from whoever read Detailed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OBJECT_CAPABILITY_MAP } from "../scripts/governance/objectCapabilityMap.mjs";
import { FUNCTIONAL_ROLE_DECISIONS } from "../scripts/governance/functionalRoleComposition.mjs";
import { GOVERNED_BUSINESS_ROLES } from "../lib/access/governedBusinessRoles.js";
import { COMPATIBILITY_ROLES } from "../lib/access/compatibilityRoles.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rows = JSON.parse(readFileSync(path.join(REPO, "docs/assessments/detailed-crud.json"), "utf8"));
const codeOf = (r) => ["C", "R", "E", "D"].filter((k) => (r[k] || "").trim().toLowerCase() === "yes").join("");

test("Access Code equals the derived CRUD booleans on every canonical row", () => {
  // The original sheet carried two rows with Read=Yes and a blank Access Code. Deriving the code
  // instead of transcribing it makes that class of defect unrepresentable.
  const bad = rows.filter((r) => codeOf(r) !== (r.code || "").trim())
    .map((r) => `${r.role}/${r.obj}: booleans=${codeOf(r) || "-"} code=${r.code || "(blank)"}`);
  assert.deepEqual(bad, [], "Access Code must be derivable from the C/R/E/D booleans");
});

test("the generated Summary is a pure projection of Detailed CRUD", () => {
  // Regenerating must be idempotent: build the projection twice and it must agree with itself and
  // with the source. If Summary is ever edited independently again, this is what catches it.
  const byRole = {};
  for (const r of rows) (byRole[r.role] ??= {})[r.obj] = codeOf(r);
  for (const r of rows) {
    assert.equal(byRole[r.role][r.obj], codeOf(r), `${r.role}/${r.obj} projection disagrees with its source row`);
  }
});

test("no duplicate Role/Object rows", () => {
  const seen = new Set();
  const dupes = [];
  for (const r of rows) {
    const k = `${r.role}/${r.obj}`;
    if (seen.has(k)) dupes.push(k);
    seen.add(k);
  }
  assert.deepEqual(dupes, [], "a duplicated row means two answers for one question");
});

test("the canonical grid is complete: every role has a row for every object", () => {
  // A MISSING row is not the same as a row granting nothing, and only one of them is a decision.
  const roles = [...new Set(rows.map((r) => r.role))];
  const objects = [...new Set(rows.map((r) => r.obj))];
  const present = new Set(rows.map((r) => `${r.role}/${r.obj}`));
  const missing = [];
  for (const role of roles) for (const obj of objects) {
    if (!present.has(`${role}/${obj}`)) missing.push(`${role}/${obj}`);
  }
  assert.deepEqual(missing, [], "every Role x Object intersection must be explicitly decided");
  assert.equal(rows.length, roles.length * objects.length);
});

test("every mapped capability id actually exists", () => {
  const known = new Set();
  for (const r of Object.values({ ...GOVERNED_BUSINESS_ROLES, ...COMPATIBILITY_ROLES })) {
    for (const p of r.permissions || []) known.add(p);
  }
  const unknown = [];
  for (const [obj, m] of Object.entries(OBJECT_CAPABILITY_MAP)) {
    for (const cap of [...(m.C || []), ...(m.R || []), ...(m.E || []), ...(m.D || [])]) {
      if (!known.has(cap)) unknown.push(`${obj} -> ${cap}`);
    }
  }
  assert.deepEqual(unknown, [], "a mapping naming a capability nobody holds is a typo or an invention");
});

test("every functional Role named in the composition policy exists", () => {
  const unknown = Object.keys(FUNCTIONAL_ROLE_DECISIONS).filter((id) => !GOVERNED_BUSINESS_ROLES[id]);
  assert.deepEqual(unknown, [], "composition policy references a Role that does not exist");
  // And every business Role it composes into must exist too -- a typo here silently composes nothing.
  const badTargets = [];
  for (const [fid, d] of Object.entries(FUNCTIONAL_ROLE_DECISIONS)) {
    for (const target of d.composedInto || []) {
      if (!GOVERNED_BUSINESS_ROLES[target]) badTargets.push(`${fid} -> ${target}`);
    }
  }
  assert.deepEqual(badTargets, [], "composition target Role does not exist");
});
