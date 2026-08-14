// Site-work round-3 item J -- the frontend permission catalog/role mirrors
// (field-ops-app-vite/src/access/permissionCatalog.ts,
// field-ops-app-vite/src/access/compatibilityRoles.ts) had drifted from
// their backend source of truth (functions/src/access/permissionCatalog.ts,
// functions/src/access/compatibilityRoles.ts). The two backend/frontend
// pairs are hand-mirrored (each file's own header says so; no shared/
// monorepo tooling exists in this repo) -- this test is the parity check
// that catches drift going forward, and directly exercises the concrete
// symptom (findPermission returning undefined / DENY previews for
// authorized principals) the drift caused.
//
// Follows this repo's existing functional-source-diff convention (see
// test/resolveEffectivePermissionParity.test.mjs): strip full-line
// comments and collapse whitespace, then require the two mirrors to be
// textually identical. Comment wording may legitimately differ (e.g. each
// file's header names the OTHER file's path); catalog/role DATA must not.
//
// Run: node test/permissionCatalogRoleParity.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERMISSION_CATALOG, findPermission } from "../src/access/permissionCatalog.ts";
import { COMPATIBILITY_ROLES } from "../src/access/compatibilityRoles.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const functionalSource = (file) => fs.readFileSync(file, "utf8")
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("//"))
  .join("\n")
  .replace(/\s+/g, " ")
  .trim();

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// ----- Full-file functional parity (catches ANY future drift, not just today's 10 ids) -----
ok("permissionCatalog.ts frontend mirror is functionally identical to the backend catalog", () => {
  const frontend = functionalSource(path.join(root, "field-ops-app-vite/src/access/permissionCatalog.ts"));
  const backend = functionalSource(path.join(root, "functions/src/access/permissionCatalog.ts"));
  assert.equal(frontend, backend, "frontend permission catalog must stay data-identical to the backend source of truth");
});

ok("compatibilityRoles.ts frontend mirror is functionally identical to the backend catalog", () => {
  const frontend = functionalSource(path.join(root, "field-ops-app-vite/src/access/compatibilityRoles.ts"));
  const backend = functionalSource(path.join(root, "functions/src/access/compatibilityRoles.ts"));
  assert.equal(frontend, backend, "frontend compatibility Roles must stay data-identical to the backend source of truth");
});

// ----- The 10 previously-missing ids now resolve (this was today's concrete symptom:
// findPermission returned undefined, so resolveEffectivePermission's client-side preview
// denied every authorized principal for these ids) -----
const PREVIOUSLY_MISSING_IDS = [
  "finance.invoice.issue",
  "finance.payment.apply",
  "finance.adjustment.record",
  "finance.read",
  "finance.refund.record",
  "coverage.write",
  "coverage.read",
  "inventory.catalog.manage",
  "inventory.catalog.activate",
  "inventory.stock.receive",
];

for (const id of PREVIOUSLY_MISSING_IDS) {
  ok(`findPermission("${id}") now returns a definition, not undefined`, () => {
    const permission = findPermission(id);
    assert.ok(permission, `expected "${id}" to be registered in the frontend PERMISSION_CATALOG`);
    assert.equal(permission.id, id);
  });
}

// ----- The missing role grant: inventory.stock.receive is granted to admin/dispatcher -----
ok('"inventory.stock.receive" is granted to the ADMIN compatibility Role', () => {
  assert.ok(
    COMPATIBILITY_ROLES.admin.permissions.includes("inventory.stock.receive"),
    "expected the admin Role to hold inventory.stock.receive",
  );
});

ok('"inventory.stock.receive" is granted to the DISPATCHER compatibility Role', () => {
  assert.ok(
    COMPATIBILITY_ROLES.dispatcher.permissions.includes("inventory.stock.receive"),
    "expected the dispatcher Role to hold inventory.stock.receive",
  );
});

// ----- No unrelated additions: the frontend catalog gained ONLY ids the backend already has -----
ok("every frontend PERMISSION_CATALOG id also exists in the backend catalog (no orphaned/invented ids)", () => {
  const backendSource = fs.readFileSync(path.join(root, "functions/src/access/permissionCatalog.ts"), "utf8");
  for (const permission of PERMISSION_CATALOG) {
    assert.ok(
      backendSource.includes(`id: "${permission.id}"`),
      `frontend id "${permission.id}" was not found in the backend catalog`,
    );
  }
});

console.log(`\n${passed} passed, 0 failed`);
