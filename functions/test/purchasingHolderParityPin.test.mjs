// PURCHASING / ALIAS-READ HOLDER SETS -- PINNED FROM THE FIREBASE CATALOG (Firebase exit B3-x, brief item 1).
//
// The brief asked for a grant-bearing migration + baseline JSON that restores the Firebase holders of the buyer's workflow (reorder.request.startPurchasing /
// postPurchasingUpdate / recordPurchaseOrder -> purchasingManager) and mirrors the holders of inventory.catalog.alias.read. THAT WRITE WAS REFUSED by the
// permission classifier ("[Permission Grant]" on the new migrations/*.sql), and by the brief's own rule it was NOT worked around: no migration, no baseline
// edit, no new holder. What this test does instead is make the TARGET unambiguous and cheap to verify so the Owner/controller can take the block as one
// decision: the exact holder sets the Firebase role catalog (GOVERNED_BUSINESS_ROLES -- the catalog the Firebase surface was authored from) defines. A
// migration that lands later is correct iff the EOS role_capabilities rows equal exactly these sets -- no more, no fewer.
//
// This is a PIN, not a grant: it changes no behaviour and adds no holder.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GOVERNED_BUSINESS_ROLES } = require("../lib/access/governedBusinessRoles.js");

const holdersOf = (capability) =>
  Object.values(GOVERNED_BUSINESS_ROLES).filter((r) => r.permissions.includes(capability)).map((r) => r.id).sort();

test("the Firebase holders of the buyer's workflow capabilities are exactly the target set", () => {
  assert.deepEqual(holdersOf("reorder.request.startPurchasing"), ["purchasingManager"]);
  assert.deepEqual(holdersOf("reorder.request.recordPurchaseOrder"), ["purchasingManager"]);
  // generalManager already holds the update on both sides; the parity gap is purchasingManager only.
  assert.deepEqual(holdersOf("reorder.request.postPurchasingUpdate"), ["generalManager", "purchasingManager"]);
});

test("the Firebase holders of inventory.catalog.alias.read are the two lookup-shaped functional roles, and no positional role", () => {
  // The recorded decision in governedBusinessRoles.ts: resolving a Part alias belongs to the lookup FUNCTIONAL role, never to a position (Owner included).
  assert.deepEqual(holdersOf("inventory.catalog.alias.read"), ["inventoryLookupReader", "inventoryStockRelocationOperator"]);
});
