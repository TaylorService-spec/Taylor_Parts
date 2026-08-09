import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../src/modules/technicianDashboard/TechnicianDashboard.jsx", import.meta.url), "utf8");

test("an operational-role holder is not told to get a technician record", () => {
  // Warehouse Manager / Parts Manager / Parts Associate sit on top of the base
  // "technician" role, so they land here. Two personas reported the technician-record
  // message as the first thing they saw — an error as a landing page, for an account
  // that is correctly provisioned.
  assert.match(src, /operationalRoles && operationalRoles\.length > 0/, "must branch on operational roles");
  assert.match(src, /not field work/i, "must say why this is not their workspace");
  assert.match(src, /inventory-role/, "must point at the workspace that is theirs");
});

test("a genuinely unmapped technician still gets the original guidance", () => {
  assert.match(src, /isn't linked to a technician record yet/, "the real unmapped case must survive");
  assert.match(src, /Contact an admin/, "and keep its remedy");
});

test("the branch reads auth rather than inferring a role from data shape", () => {
  assert.match(src, /useAuth\(\)/, "operational roles must come from the auth context");
});
