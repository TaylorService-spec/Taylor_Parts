// PURCHASING / ALIAS-READ HOLDER SETS -- PINNED FROM THE FIREBASE CATALOGS (Firebase exit B3-x; Owner policy direction 2026-10-18, item 1).
//
// The Owner targets EXACT historical Firebase parity for the buyer's workflow (reorder.request.startPurchasing / postPurchasingUpdate / recordPurchaseOrder)
// and inventory.catalog.alias.read -- no additional holders, nothing broadened through catalog defaults. The grant migration is written by the CONTROLLER
// through the Owner-approved path; this lane authored none (its own attempt was refused by the permission classifier and was not worked around).
// What this test does is make the target machine-checkable: docs/architecture/b3x-purchasing-alias-grant-parity.json (the same shape as the B4 file) must
// equal, key for key, the holders the compiled Firebase catalogs declare -- and no migration, seed or baseline in this lane may grant any of the four keys.
//
// This is a PIN, not a grant: it changes no behaviour and adds no holder.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const REPO = resolve(FUNCTIONS_DIR, "..");
const { COMPATIBILITY_ROLES } = require("../lib/access/compatibilityRoles.js");
const { GOVERNED_BUSINESS_ROLES } = require("../lib/access/governedBusinessRoles.js");

const ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const PARITY = JSON.parse(readFileSync(join(REPO, "docs", "architecture", "b3x-purchasing-alias-grant-parity.json"), "utf8"));
const KEYS = PARITY.keys;

/** Firebase holders of a key, a conditioned holder named with its condition (the technician is the Firebase Parts Associate). */
function firebaseHolders(key) {
  return Object.entries(ROLES).filter(([, r]) => (r.permissions ?? []).includes(key))
    .map(([id, r]) => (r.conditionsByPermission?.[key]?.length ? `${id}[conditioned]` : id)).sort();
}

test("the parity file names exactly the four keys, and its Firebase holders equal the compiled catalogs", () => {
  assert.deepEqual(KEYS, ["reorder.request.startPurchasing", "reorder.request.postPurchasingUpdate", "reorder.request.recordPurchaseOrder", "inventory.catalog.alias.read"]);
  assert.equal(PARITY.keyCount, KEYS.length);
  for (const key of KEYS) {
    assert.deepEqual([...PARITY.firebaseHoldersByKey[key]].sort(), firebaseHolders(key), `holders of ${key}`);
  }
});

test("the recorded decision stands: no positional role other than the Administrator holds inventory.catalog.alias.read", () => {
  // governedBusinessRoles.ts: resolving a Part alias belongs to the lookup FUNCTIONAL role; Owner is a position and does not hold it.
  assert.deepEqual(PARITY.firebaseHoldersByKey["inventory.catalog.alias.read"], ["admin", "inventoryLookupReader", "inventoryStockRelocationOperator"]);
});

test("the diff is pairs only, each pair a Firebase holder, and nothing is claimed for EOS beyond the repository evidence", () => {
  const pairs = new Set(KEYS.flatMap((k) => PARITY.firebaseHoldersByKey[k].map((h) => `${h}|${k}`)));
  for (const { role, key } of PARITY.diff.firebaseOnly) {
    assert.ok(KEYS.includes(key), `${key} is one of the four`);
    assert.ok(pairs.has(`${role}|${key}`), `${role} holds ${key} in Firebase`);
  }
  assert.deepEqual(PARITY.diff.eosOnly, [], "EOS holds no key of these four that Firebase did not (the lane adds no holder)");
  assert.equal(new Set(PARITY.diff.firebaseOnly.map((d) => `${d.role}|${d.key}`)).size, PARITY.diff.firebaseOnly.length, "no duplicate pair");
});
