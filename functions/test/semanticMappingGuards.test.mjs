// SEMANTIC MAPPING GUARDS. Run: node --test test/semanticMappingGuards.test.mjs
//
// ============================ THE RULE THESE ENFORCE ============================
//
// Every non-empty Object -> Capability mapping must show that the capability governs THE SAME
// BUSINESS ACTION the matrix row describes. A related object is not enough. A related workflow is
// not enough. A similar name is certainly not enough.
//
// This rule exists because three mappings of exactly that shape were written and caught during the
// reconciliation, and each would have granted real authority through a spreadsheet column:
//
//   Equipment / Installed Base -> equipment.model.manage
//       Installed base is the CUSTOMER'S assets; the capability administers the MODEL CATALOG. Would
//       have handed catalog administration to technicians, parts associates and shop staff because
//       their CRUD cell said "edit equipment".
//
//   Inventory Adjustments -> cycle-count counter AND reconciler
//       Counting and reconciling are deliberately separated (DECISIONS #111). One "adjustments" edit
//       cell would have collapsed a segregation of duties into a checkbox.
//
//   Contacts -> crm.activity.read / crm.activity.create
//       crm.activity.* is ACTIVITY LOGGING; the contact RECORD is a different, Rules-governed object.
//       Would have silently reversed an explicit Owner ruling of 2026-08-19 confining crm.activity.*
//       to crmActivityContributor -- a governance decision overturned by a spreadsheet column.
//
// The honest mapping when no capability governs the object is EMPTY. RULE_GOVERNED and UNMODELLED are
// answers, not gaps to be filled with the nearest-looking id.
import test from "node:test";
import assert from "node:assert/strict";
import { OBJECT_CAPABILITY_MAP, governanceTypeFor, GOVERNANCE_TYPE } from "../scripts/governance/objectCapabilityMap.mjs";

const capsFor = (obj) => {
  const m = OBJECT_CAPABILITY_MAP[obj] || {};
  return [...(m.C || []), ...(m.R || []), ...(m.E || []), ...(m.D || [])];
};

test("Installed Base never maps to model-catalog administration", () => {
  const caps = capsFor("Equipment / Installed Base");
  assert.equal(
    caps.includes("equipment.model.manage"), false,
    "The installed base is the customer's assets. equipment.model.manage administers the MODEL CATALOG -- " +
    "a different object. Editing an installed unit is not administering the catalog it came from.",
  );
  assert.ok(
    caps.every((c) => !c.startsWith("equipment.compatibility.")),
    "Compatibility administration is likewise a different action from reading or editing an installed asset.",
  );
  assert.equal(governanceTypeFor("Equipment / Installed Base"), GOVERNANCE_TYPE.RULE_GOVERNED);
});

test("Inventory Adjustments never maps to cycle-count authority, and never to both sides of it", () => {
  const caps = capsFor("Inventory Adjustments");
  for (const forbidden of ["inventory.cycleCount.create", "inventory.cycleCount.submit", "inventory.cycleCount.reconcile"]) {
    assert.equal(caps.includes(forbidden), false, `${forbidden} must not be derived from a generic adjustments cell`);
  }
  // The specific catastrophe: one cell granting a person both sides of the control.
  const bothSides = caps.includes("inventory.cycleCount.submit") && caps.includes("inventory.cycleCount.reconcile");
  assert.equal(bothSides, false, "a single CRUD cell must never yield counter AND reconciler (DECISIONS #111)");
});

test("Contacts never maps to CRM activity capabilities", () => {
  const caps = capsFor("Contacts");
  assert.ok(
    caps.every((c) => !c.startsWith("crm.activity.")),
    "crm.activity.* is activity LOGGING and is confined to crmActivityContributor by the Owner ruling of " +
    "2026-08-19. The contact RECORD is a different object, governed by firestore.rules.",
  );
  assert.equal(governanceTypeFor("Contacts"), GOVERNANCE_TYPE.RULE_GOVERNED);
});

test("an object with no governing capability declares an empty mapping rather than a near-miss", () => {
  // The generic form of all three failures above. Every object must either map to capabilities that
  // genuinely govern it, or map to nothing and say so through its governance type.
  for (const [obj, m] of Object.entries(OBJECT_CAPABILITY_MAP)) {
    const caps = [...(m.C || []), ...(m.R || []), ...(m.E || []), ...(m.D || [])];
    const type = governanceTypeFor(obj);
    if (caps.length === 0) {
      assert.notEqual(type, GOVERNANCE_TYPE.CAPABILITY_GOVERNED, `${obj} maps to nothing but claims to be capability-governed`);
    } else {
      assert.equal(type, GOVERNANCE_TYPE.CAPABILITY_GOVERNED, `${obj} maps to capabilities but is not marked capability-governed`);
    }
  }
});

test("security administration is never derived from the matrix", () => {
  // Owner decision 2026-08-21. The workbook grants General Manager CRED on Users and Roles /
  // Permissions; implementing that literally creates a non-privileged role able to grant itself
  // anything. These objects deliberately map to nothing, and admin.* stays with Owner and Admin.
  for (const obj of ["Users", "Roles / Permissions"]) {
    assert.deepEqual(capsFor(obj), [], `${obj} must not derive any capability from the matrix`);
  }
});
