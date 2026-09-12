// THE ADMINISTRATION EDITING SURFACES — their proofs.
//
// Every assertion here fails on the state this tranche corrected. The defects were:
//
//   Roles & Permissions edited Object CRED only. Objects did not expand. Field CRED was not
//   editable — existing overrides were COUNTED and nothing more.
//   Objects displayed fields and created custom ones, but could not edit them.
//   Both screens rendered the stored policy as an extra panel BESIDE a measured read-only grid,
//   which is why the page still felt uneditable: the first grid you met was the one you could
//   not change.
//
// These are source-level and pure-logic proofs. The rendered behaviour is proved separately in
// adminPolicySurfaces.test.jsx, and the persistence is proved in the browser against a real
// database — a component test cannot tell you an override row was deleted.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  effectiveFieldAnswer,
  fieldVerbState,
  nextOverride,
  verbAvailable,
} from "../src/modules/administration/fieldPermissionState.js";

const SURFACES = readFileSync("src/modules/administration/AdminPolicySurfaces.jsx", "utf8");
const OBJECTS_SCREEN = readFileSync("src/modules/administration/AdminObjects.jsx", "utf8");
const ROLES_SCREEN = readFileSync("src/modules/administration/AdminRolesPermissions.jsx", "utf8");

// ============================ the four field facts ============================

test("a field verb distinguishes INHERITED from EXPLICIT, in both directions", () => {
  // The whole reason field cells are not checkboxes. A checkbox has two states and there are four
  // facts; "inherited deny" and "explicit deny" look identical in one and behave differently when
  // the object's answer changes.
  assert.equal(fieldVerbState(null, "R"), "inherit", "no override at all");
  assert.equal(fieldVerbState({}, "R"), "inherit", "an override that says nothing about R");
  assert.equal(fieldVerbState({ E: true }, "R"), "inherit", "an override about a DIFFERENT verb");
  assert.equal(fieldVerbState({ R: true }, "R"), "allow");
  assert.equal(fieldVerbState({ R: false }, "R"), "deny", "explicit false is NOT the same as absent");
});

test("the effective answer is shown, so 'Inherited' is never a shrug", () => {
  assert.equal(effectiveFieldAnswer(null, "R", true), "Inherited · Allow");
  assert.equal(effectiveFieldAnswer(null, "R", false), "Inherited · Deny");
  assert.equal(effectiveFieldAnswer({ R: true }, "R", true), "Allow");
  assert.equal(effectiveFieldAnswer({ R: false }, "R", true), "Deny");
});

test("THE DOORWAY IS SHOWN, NOT HIDDEN: an allow under a denied object says so", () => {
  // The invariant is the server's and this screen does not enforce it. What it must not do is
  // render a cheerful "Allow" for an override that grants nothing — an administrator would spend
  // the afternoon wondering why the field is invisible.
  assert.equal(
    effectiveFieldAnswer({ R: true }, "R", false),
    "Allow · blocked by object",
  );
});

// ============================ one verb changes, the others survive ============================

test("changing ONE verb preserves the field's other explicit verbs", () => {
  // `setFieldPermissionOverride` REPLACES the whole override. Sending only the verb being changed
  // would silently drop every other explicit verb on that field — data loss that looks like a
  // successful save.
  const existing = { R: true, E: false };

  const denied = nextOverride(existing, "C", "deny");
  assert.deepEqual(denied.override, { R: true, E: false, C: false }, "R and E survive");
  assert.equal(denied.remove, false);

  const allowed = nextOverride(existing, "E", "allow");
  assert.deepEqual(allowed.override, { R: true, E: true }, "E flips, R untouched");

  // And the caller's object is not mutated -- a shared reference edited in place would change what
  // the grid renders before the server had answered.
  assert.deepEqual(existing, { R: true, E: false }, "the input override is not mutated");
});

test("RESETTING TO INHERIT REMOVES THE ROW — it does not store a false", () => {
  // "No opinion" has one spelling. An all-false override is a different policy fact that happens to
  // resolve the same way today and stops doing so the moment the object changes.
  const last = nextOverride({ R: false }, "R", "inherit");
  assert.deepEqual(last.override, {}, "nothing is left");
  assert.equal(last.remove, true, "so the row is REMOVED, not stored empty");

  // Inheriting one verb while others stay explicit keeps the row.
  const partial = nextOverride({ R: false, E: true }, "R", "inherit");
  assert.deepEqual(partial.override, { E: true });
  assert.equal(partial.remove, false);
});

// ============================ unavailable means what the server enforces ============================

test("UNAVAILABLE is Delete-on-a-non-deletable-object, and nothing invented", () => {
  // Measured: `setObjectPermission` refuses exactly one ungoverned cell — D where supportsDelete is
  // false. Greying out C/R/E would be a UI opinion dressed as policy, since the server accepts them.
  const deletable = { supportsDelete: true };
  const not = { supportsDelete: false };

  for (const verb of ["C", "R", "E"]) {
    assert.equal(verbAvailable(not, verb), true, `${verb} is governable even where Delete is not`);
  }
  assert.equal(verbAvailable(deletable, "D"), true);
  assert.equal(verbAvailable(not, "D"), false, "the one cell the server refuses");
  assert.equal(verbAvailable(undefined, "D"), false, "and an absent object fails closed");

  // It inherits downward: the field rows ask the same question about the same object.
  assert.match(SURFACES, /UNGOVERNED INHERITS DOWNWARD/);
});

// ============================ objects expand into fields ============================

test("the ROLE grid expands an object into its fields", () => {
  // The defect: Roles & Permissions edited object CRED and stopped there.
  assert.match(SURFACES, /function RoleObjectRows/, "an object row that can expand");
  assert.match(SURFACES, /function RoleFieldRow/, "and field rows underneath it");
  assert.match(
    SURFACES,
    /usePolicyStore\("readObjectWithFields", open \? \{ objectKey: object\.key \} : null, \{ enabled: open \}\)/,
    "fields load PER EXPANDED OBJECT -- not 37 objects' worth of fields for a collapsed table",
  );
});

test("field rows offer Inherit / Allow / Deny, not a checkbox", () => {
  assert.match(SURFACES, /<option value=\{INHERIT\}>Inherit<\/option>/);
  assert.match(SURFACES, /<option value=\{ALLOW\}>Allow<\/option>/);
  assert.match(SURFACES, /<option value=\{DENY\}>Deny<\/option>/);
});

// ============================ roles are managed here ============================

test("a custom Role can be created and its metadata edited", () => {
  assert.match(SURFACES, /function CreateRoleForm/);
  assert.match(SURFACES, /function EditRoleForm/);
  assert.match(SURFACES, /mutate\("createRole"/);
  assert.match(SURFACES, /mutate\("updateRole"/);
});

test("a Role's key is presented as permanent", () => {
  assert.match(SURFACES, /The key is permanent\./);
  assert.match(SURFACES, /is identity and cannot change/);
});

// ============================ objects and custom fields are editable ============================

test("a CUSTOM field can be edited; a SYSTEM field offers no edit affordance", () => {
  assert.match(SURFACES, /function EditFieldForm/);
  assert.match(SURFACES, /mutate\("updateCustomFieldMetadata"/);
  assert.match(
    SURFACES,
    /field\.origin === "CUSTOM" \? \(/,
    "the Edit button is offered only for CUSTOM",
  );
  // And the screen says the button is not the enforcement.
  assert.match(SURFACES, /the server refuses a SYSTEM definition mutation whether or not a button/);
});

test("key and dataType are never presented as editable", () => {
  assert.match(SURFACES, /are not editable/i);
  // The edit form must not contain an input bound to key or dataType.
  const editForm = SURFACES.slice(SURFACES.indexOf("function EditFieldForm"), SURFACES.indexOf("function CreateFieldForm"));
  assert.equal(/setDraft\(\{ \.\.\.draft, key:/.test(editForm), false, "no key input");
  assert.equal(/setDraft\(\{ \.\.\.draft, dataType:/.test(editForm), false, "no dataType input");
});

test("custom field CREATION exposes the governed metadata, not three fields", () => {
  // The defect: the create form sent key/label/dataType and dropped everything else the command
  // supports, producing a field the administrator had to go and fix immediately.
  for (const key of ["required", "searchable", "sortable", "reportable", "sensitivity", "description"]) {
    assert.match(SURFACES, new RegExp(`${key}:`), `create sends ${key}`);
  }
});

test("ENUM demands allowed values and REFERENCE demands a target, before the round trip", () => {
  assert.match(SURFACES, /const needsAllowedValues = draft\.dataType === "ENUM" \|\| draft\.dataType === "ENUM_SET";/);
  assert.match(SURFACES, /const needsReference = draft\.dataType === "REFERENCE";/);
  assert.match(SURFACES, /CONDITIONAL, and required rather than optional/);
});

test("OBJECT display metadata is editable; identity and enforcement facts are not", () => {
  assert.match(SURFACES, /function EditObjectForm/);
  assert.match(SURFACES, /mutate\("updateObjectMetadata"/);
  const form = SURFACES.slice(SURFACES.indexOf("function EditObjectForm"), SURFACES.indexOf("function FieldTable"));
  for (const forbidden of ["key:", "origin:", "supportsDelete:", "lifecycle:"]) {
    assert.equal(form.includes(`setDraft({ ...draft, ${forbidden}`), false, `${forbidden} is not editable`);
  }
});

// ============================ there is ONE primary control ============================

test("NO DUPLICATE UX: when configured, the measured grid is a collapsed REFERENCE", () => {
  // The architectural defect this tranche exists to correct. Two grids on one screen, one editable
  // and one not, both claiming to describe permissions.
  for (const [name, source] of [["Objects", OBJECTS_SCREEN], ["Roles", ROLES_SCREEN]]) {
    assert.match(source, /isPolicyApiConfigured\(\)/, `${name}: the screen knows whether a store exists`);
    assert.match(source, /NotConfiguredNotice/, `${name}: says so plainly when it does not`);
  }
  assert.match(OBJECTS_SCREEN, /SourceReference/, "Objects demotes the measured model");
  assert.match(ROLES_SCREEN, /RolesPermissionsSurface/, "Roles leads with the stored policy");

  // The reference is collapsed and named as reference, not as control.
  assert.match(SURFACES, /platform reference, not configuration/);
});

test("the superseded panels are DELETED, not left beside the new surfaces", () => {
  // A second implementation of the same two screens is how the two start disagreeing about what a
  // cell means.
  const panels = readFileSync("src/modules/administration/PolicyStorePanels.jsx", "utf8");
  assert.equal(panels.includes("export function ObjectsPolicyPanel"), false);
  assert.equal(panels.includes("export function RolesPolicyPanel"), false);
  assert.match(panels, /OBJECTS AND ROLES LIVE IN AdminPolicySurfaces/);
});

test("NOT CONFIGURED shows no control that implies policy can be saved", () => {
  assert.match(SURFACES, /Nothing on this screen can be saved/);
  // Both surfaces refuse to render at all without a configured store.
  assert.match(SURFACES, /if \(!isPolicyApiConfigured\(\)\) return null;/);
});

// ============================ no request storm ============================

test("fields load per expanded object, and nothing loads per cell", () => {
  // 36 objects and 389 fields is small. It is not so small that a read per checkbox is acceptable.
  const perCellReads = (SURFACES.match(/usePolicyStore\(/g) ?? []).length;
  assert.ok(perCellReads <= 6, `${perCellReads} usePolicyStore call sites -- one per surface, not per cell`);
  assert.equal(SURFACES.includes("callPolicyApi("), false, "no panel bypasses the hook's re-read");
});
