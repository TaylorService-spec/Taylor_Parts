// X-INVENTORY-CREATE-EXECUTOR-GRANT-MANIFEST -- offline unit tests for
// functions/scripts/inventoryCreateExecutorGrantManifestCli.js. PURE: no Firebase, no network, no filesystem
// writes. Proves the committed template (docs/provisioning/inventoryCreateExecutor-grant-manifest.template.json)
// is refused as-is, and that a fully-filled manifest passes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cliMod = await import("../scripts/inventoryCreateExecutorGrantManifestCli.js");
const cli = cliMod.default ?? cliMod;

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (err) { failed += 1; console.log(`  FAIL - ${name}: ${err && err.stack || err}`); }
}

const validManifest = () => ({
  roleId: "inventoryCreateExecutor",
  recipient: { employeeId: "sbx-partsmgr", principalUid: "9L4ISPqtTEfl3ARq8W5v1j0fOBm1", displayName: "Sandbox Parts Manager" },
  businessNeed: "One approved sandbox Part Master CREATE run reconciling the supplier catalog import batch.",
  scope: { type: "global" },
  approvedBy: "owner",
  authorizationReference: "Owner ruling 2026-08-18, provisioning-manifests prep",
});

check("committed template is refused: roleId/recipient present but every required value is null", () => {
  const templatePath = path.resolve(HERE, "..", "..", "docs", "provisioning", "inventoryCreateExecutor-grant-manifest.template.json");
  const manifest = JSON.parse(readFileSync(templatePath, "utf8"));
  assert.throws(() => cli.validateGrantManifestShape(manifest), /is required/);
});

check("validateGrantManifestShape: rejects wrong roleId", () => {
  const m = { ...validManifest(), roleId: "somethingElse" };
  assert.throws(() => cli.validateGrantManifestShape(m), /roleId must be exactly "inventoryCreateExecutor"/);
});

check("validateGrantManifestShape: rejects missing recipient.employeeId", () => {
  const m = validManifest();
  m.recipient = { ...m.recipient, employeeId: null };
  assert.throws(() => cli.validateGrantManifestShape(m), /recipient.employeeId is required/);
});

check("validateGrantManifestShape: rejects missing recipient.principalUid", () => {
  const m = validManifest();
  m.recipient = { ...m.recipient, principalUid: "" };
  assert.throws(() => cli.validateGrantManifestShape(m), /recipient.principalUid is required/);
});

check("validateGrantManifestShape: rejects a placeholder businessNeed (TBD/TODO/etc.)", () => {
  for (const placeholder of ["TBD", "todo", "REPLACE_ME", "N/A", "pending"]) {
    const m = validManifest();
    m.businessNeed = placeholder;
    assert.throws(() => cli.validateGrantManifestShape(m), /businessNeed/, `expected '${placeholder}' to be rejected`);
  }
});

check("validateGrantManifestShape: rejects a too-short businessNeed", () => {
  const m = validManifest();
  m.businessNeed = "fix stuff";
  assert.throws(() => cli.validateGrantManifestShape(m), /real sentence/);
});

check("validateGrantManifestShape: rejects missing approvedBy", () => {
  const m = validManifest();
  m.approvedBy = null;
  assert.throws(() => cli.validateGrantManifestShape(m), /approvedBy is required/);
});

check("validateGrantManifestShape: rejects missing authorizationReference", () => {
  const m = validManifest();
  m.authorizationReference = undefined;
  assert.throws(() => cli.validateGrantManifestShape(m), /authorizationReference is required/);
});

check("validateGrantManifestShape: rejects a non-global scope", () => {
  const m = validManifest();
  m.scope = { type: "warehouse" };
  assert.throws(() => cli.validateGrantManifestShape(m), /scope.type must be exactly "global"/);
});

check("validateGrantManifestShape: a fully-filled manifest passes and returns a normalized copy", () => {
  const validated = cli.validateGrantManifestShape(validManifest());
  assert.equal(validated.recipient.employeeId, "sbx-partsmgr");
  assert.equal(validated.roleId, "inventoryCreateExecutor");
});

check("run(): parseArgs requires --manifest", () => {
  assert.throws(() => cli.parseArgs([]), /--manifest is required/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
