// SUP-1 (DECISIONS #230): the Administration Objects matrix represents Part Supplier Terms ACCURATELY.
//
// The Owner direction of 2026-10-12: "Ensure the Administration Objects matrix represents the new capability and its
// field-group actions accurately." This suite reads the matrix THROUGH the real Administration API
// (executeAdminOperation -> getObjectActionGrantMatrix, the read the Objects screen calls) on a baseline-equal tenant and
// asserts the supplierCatalogItem Object carries exactly its seven actions -- the four record keys and the three
// COMMERCIAL field-group keys -- with their action keys, kinds and labels; that the protected Administrator's standing is
// shown for inventory.supplierTerms.read ONLY; and that nothing is granted to anyone (the grants are PROPOSED, not
// executed). Set POLICY_TEST_DATABASE_URL; without it the suite SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const EXPECTED = [
  // [capabilityKey, actionKey, actionKind, displayLabel], sorted by actionKey (the test sorts; it assumes no matrix order).
  ["inventory.supplierTerms.changeStatus", "changeStatus", "BUSINESS_ACTION", "Activate / deactivate supplier terms"],
  ["inventory.catalog.cost.create", "createCost", "CREATE", "Set supplier cost & contract terms on new terms"],
  ["inventory.supplierTerms.create", "createTerms", "CREATE", "Add supplier terms"],
  ["inventory.catalog.cost.edit", "editCost", "EDIT", "Change supplier cost & contract terms"],
  ["inventory.supplierTerms.edit", "editTerms", "EDIT", "Edit supplier terms"],
  ["inventory.catalog.cost.read", "readCost", "READ", "Read supplier cost & contract terms"],
  ["inventory.supplierTerms.read", "readTerms", "READ", "Read supplier terms"],
];

test("the Objects matrix for supplierCatalogItem: seven actions, standing on the record read only, zero grants", { skip: SKIP, concurrency: false }, async (t) => {
  const { q, admin } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: "t-sup1-matrix", prefix: "sup1matrix" });

  const objects = await admin("listObjectsWithActions", {});
  assert.equal(objects.ok, true, JSON.stringify(objects).slice(0, 300));
  const object = objects.data.find((o) => o.key === "supplierCatalogItem");
  assert.ok(object, "the supplierCatalogItem Object is registered for the tenant");
  assert.deepEqual(object.actions.map((a) => a.actionKey).sort(), EXPECTED.map((e) => e[1]).sort(), "the Objects list names the same seven actions");

  const matrix = await admin("getObjectActionGrantMatrix", { objectKey: "supplierCatalogItem" });
  assert.equal(matrix.ok, true, JSON.stringify(matrix).slice(0, 300));
  assert.equal(matrix.data.objectKey, "supplierCatalogItem");
  const actions = [...matrix.data.actions].sort((a, b) => a.actionKey.localeCompare(b.actionKey));
  assert.deepEqual(actions.map((a) => [a.capabilityKey, a.actionKey, a.actionKind, a.displayLabel]), EXPECTED, "exactly seven actions, accurately labelled");

  for (const action of actions) {
    const held = action.roles.filter((cell) => cell.held);
    if (action.capabilityKey === "inventory.supplierTerms.read") {
      assert.deepEqual(held.map((c) => [c.roleKey, c.source]), [["admin", "PROTECTED_ADMINISTRATOR"]],
        "the protected Administrator's standing reaches the record READ (DECISIONS #223) -- and no Role holds it by grant");
    } else {
      assert.deepEqual(held, [], `${action.capabilityKey}: no Role holds it -- not by grant, not by standing`);
    }
    for (const cell of action.roles) {
      assert.notEqual(cell.source, "ADMIN_GRANTED", `${action.capabilityKey} ${cell.roleKey}: nothing is granted`);
      assert.notEqual(cell.source, "SYSTEM_DEFAULT", `${action.capabilityKey} ${cell.roleKey}: no default grant`);
      assert.equal(cell.condition, null, `${action.capabilityKey} ${cell.roleKey}: no condition`);
    }
    assert.deepEqual(action.principals, [], `${action.capabilityKey}: no direct Principal exception`);
  }

  // The database agrees: zero grants of all seven keys, zero Administration decisions naming them.
  const keys = EXPECTED.map((e) => e[0]);
  const n = async (sql) => (await q(sql, [keys])).rows[0].n;
  assert.equal(await n(`SELECT count(*)::int AS n FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE c.key = ANY($1::text[])`), 0);
  assert.equal(await n(`SELECT count(*)::int AS n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id WHERE c.key = ANY($1::text[])`), 0);
  assert.equal(await n(`SELECT count(*)::int AS n FROM eos_policy.role_capability_decisions WHERE capability_key = ANY($1::text[])`), 0);
});
