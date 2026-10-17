// FIREBASE EXIT F1 (DECISIONS #244) -- the Data Import stage -> execute mapping, proved from the SERVER side.
// Run: node --test test/dataImportStageMappingParity.test.mjs   (needs `npm run build`: imports the compiled lib/)
//
// The client asks the Firebase permission id admin.dataImport.stage under the EOS key admin.dataImport.execute
// (field-ops-app-vite/src/access/eosCapabilityAccess.js). That is honest only while:
//   (a) the Firebase catalog grants stage and execute to EXACTLY the same Roles, and the Owner holds neither;
//   (b) on EOS, execute is Owner-locked (a FORBIDDEN_ROLE_CAPABILITY_PAIR) -- the PostgreSQL half of this is proved against
//       the real engine in authorityPreviewEquivalencePostgres.test.mjs ("F1: on EOS admin.dataImport.execute is held only by
//       admin and locked for owner ...") and the holders in roleCapabilityAuthorityBaseline;
//   (c) the mapping exists and points at execute -- so this fails the day the two holder sets diverge, in EITHER catalog.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { COMPATIBILITY_ROLES } from "../lib/access/compatibilityRoles.js";
import { GOVERNED_BUSINESS_ROLES, OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES } from "../lib/access/governedBusinessRoles.js";
import { FORBIDDEN_ROLE_CAPABILITY_PAIRS } from "../lib/adminPolicy/roleCapabilityAdministration.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STAGE = "admin.dataImport.stage";
const EXECUTE = "admin.dataImport.execute";

const ALL_ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const firebaseHolders = (id) => Object.entries(ALL_ROLES).filter(([, role]) => (role.permissions ?? []).includes(id)).map(([key]) => key).sort();

test("(a) the Firebase catalog grants stage and execute to EXACTLY the same Roles, and the Owner holds neither", () => {
  const stage = firebaseHolders(STAGE);
  const execute = firebaseHolders(EXECUTE);
  assert.deepEqual(execute, ["admin"], "execute is held by admin alone");
  assert.deepEqual(stage, execute, "stage and execute must have identical holders");
  assert.equal(GOVERNED_BUSINESS_ROLES.owner.permissions.includes(STAGE), false);
  assert.equal(GOVERNED_BUSINESS_ROLES.owner.permissions.includes(EXECUTE), false);
});

test("(b) on EOS execute is held by admin alone (the migration-backed baseline roleCapabilityAuthorityBaselinePostgres proves equal to a rebuilt database)", () => {
  const baseline = JSON.parse(fs.readFileSync(path.resolve(HERE, "../src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json"), "utf8"));
  const holders = [...new Set(baseline.grants.filter((g) => g.capabilityKey === EXECUTE).map((g) => g.roleKey))].sort();
  assert.deepEqual(holders, ["admin"]);
  assert.deepEqual(holders, firebaseHolders(STAGE), "EOS holders of execute == Firebase holders of stage");
  assert.equal(baseline.grants.some((g) => g.capabilityKey === STAGE), false, "no EOS grant of stage exists");
});

test("(b) execute is Owner-excluded by Owner ruling A: in the exclusion list and a FORBIDDEN_ROLE_CAPABILITY_PAIR", () => {
  assert.ok(OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES.includes(EXECUTE));
  assert.ok(FORBIDDEN_ROLE_CAPABILITY_PAIRS.some((p) => p.roleKey === "owner" && p.capabilityKey === EXECUTE && p.invariantClass === "OWNER_GOVERNANCE"));
});

test("(c) the F1 mapping asks stage under execute, and stage is NOT a separately registered EOS capability", async () => {
  const mapping = await import(pathToFileURL(path.resolve(HERE, "../../field-ops-app-vite/src/access/eosCapabilityAccess.js")).href);
  assert.equal(mapping.eosKeyForFirebaseId(STAGE), EXECUTE);
  // consistent with (a) + (b): the mapped key's holders are the Firebase id's holders, and the target is Owner-locked
  assert.deepEqual(firebaseHolders(EXECUTE), firebaseHolders(STAGE));
  assert.ok(FORBIDDEN_ROLE_CAPABILITY_PAIRS.some((p) => p.roleKey === "owner" && p.capabilityKey === mapping.eosKeyForFirebaseId(STAGE)));
  // no migration registers stage: nothing exists for an administrator to grant
  const migrations = path.resolve(HERE, "../migrations");
  for (const f of fs.readdirSync(migrations).filter((n) => n.endsWith(".sql"))) {
    const sql = fs.readFileSync(path.join(migrations, f), "utf8").replace(/^\s*--.*$/gm, "");
    assert.ok(!sql.includes(`'${STAGE}'`), `${f} registers or grants ${STAGE}`);
  }
});
