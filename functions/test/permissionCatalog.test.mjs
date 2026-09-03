// Enterprise Access & Administration Platform (Issue #226) -- Row 1
// (Task 6) acceptance test A2 (docs/specifications/
// enterprise-access-and-administration-platform.md §21): Permission ids
// conform to §6 and are unique/immutable across the seed set.
//
// Dependency-free: plain Node assert against the compiled catalog, no
// test runner, matching this repo's existing pure-logic test
// convention (field-ops-app-vite/test/*.test.mjs).
//
// Prerequisite: `npm run build` in functions/ first (this test imports
// the compiled lib/ output, not the TypeScript source).
import assert from "node:assert/strict";
import { resolveCapabilityOverrides, ENVIRONMENT_ACTIVATION_REGISTRY } from "../lib/access/environmentCapabilityOverrides.js";
import {
  PERMISSION_CATALOG,
  isValidPermissionId,
  findPermission,
  requirePermission,
  isValidReportObjectReadCapabilityId,
  isValidReportFieldReadCapabilityId,
  isValidReportDefinitionCapabilityId,
  isActivePermission,
} from "../lib/access/permissionCatalog.js";

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

check("catalog is non-empty", () => {
  assert.ok(PERMISSION_CATALOG.length > 0);
});

check("every id matches the <domain>.<resource>.<action> format", () => {
  for (const permission of PERMISSION_CATALOG) {
    assert.ok(
      isValidPermissionId(permission.id),
      `"${permission.id}" does not match the required format`,
    );
  }
});

check("every id is unique", () => {
  const ids = PERMISSION_CATALOG.map((p) => p.id);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length, "duplicate PermissionId found");
});

check("the catalog array is frozen (immutable)", () => {
  assert.ok(Object.isFrozen(PERMISSION_CATALOG));
});

check("every entry is frozen (immutable)", () => {
  for (const permission of PERMISSION_CATALOG) {
    assert.ok(Object.isFrozen(permission), `"${permission.id}" is not frozen`);
  }
});

check("no entry is deprecated without a successor id", () => {
  for (const permission of PERMISSION_CATALOG) {
    if (permission.deprecated) {
      assert.ok(
        permission.deprecatedInFavorOf,
        `"${permission.id}" is deprecated with no deprecatedInFavorOf`,
      );
    }
  }
});

check("findPermission resolves a known id", () => {
  const found = findPermission("customer.record.read");
  assert.ok(found);
  assert.equal(found.id, "customer.record.read");
});

check("findPermission returns undefined for an unknown id", () => {
  assert.equal(findPermission("not.a.realPermission"), undefined);
});

check("requirePermission throws (fails closed) for an unknown id", () => {
  assert.throws(() => requirePermission("not.a.realPermission"));
});

check("requirePermission resolves a known id", () => {
  const permission = requirePermission("workOrder.transition");
  assert.equal(permission.id, "workOrder.transition");
});

// --- Issue #325 / ADR-007 D-226: field-level read-capability extension ---

check("wave-1 report.* catalog: exactly 4 object-read + 30 field-read + 5 definition-CRUD ids (39 total)", () => {
  // Categorize definition ids FIRST (permissionCatalog.ts's own header
  // comment on REPORT_DEFINITION_CAPABILITY_PATTERN: "report.definition.
  // read" also structurally matches the generic object-read pattern --
  // a deliberate, harmless naming coincidence, not a real ambiguity, but
  // a categorizer must exclude it from the object-read count explicitly
  // rather than relying on pattern exclusivity).
  const reportIds = PERMISSION_CATALOG.filter((p) => p.id.startsWith("report."));
  const definitionIds = reportIds.filter((p) => isValidReportDefinitionCapabilityId(p.id));
  const nonDefinitionIds = reportIds.filter((p) => !isValidReportDefinitionCapabilityId(p.id));
  const objectIds = nonDefinitionIds.filter((p) => isValidReportObjectReadCapabilityId(p.id));
  const fieldIds = nonDefinitionIds.filter((p) => isValidReportFieldReadCapabilityId(p.id));
  assert.equal(definitionIds.length, 5, "expected exactly 5 W-SAVE definition-CRUD capabilities");
  assert.equal(objectIds.length, 4, "expected exactly 4 wave-1 object read capabilities");
  assert.equal(fieldIds.length, 30, "expected exactly 30 wave-1 field read capabilities");
  assert.equal(reportIds.length, 39, "every report.* id must be definition-, object-, or field-shaped, no fourth shape");
});

check("isValidReportDefinitionCapabilityId accepts exactly the five adopted actions, nothing else", () => {
  for (const action of ["create", "read", "rename", "duplicate", "delete"]) {
    assert.ok(isValidReportDefinitionCapabilityId(`report.definition.${action}`), action);
  }
  assert.ok(!isValidReportDefinitionCapabilityId("report.definition.share"), "share is not one of the five adopted actions");
  assert.ok(!isValidReportDefinitionCapabilityId("report.customer.read"), "an object id is not a definition id");
  assert.ok(!isValidReportDefinitionCapabilityId("Report.definition.read"), "wrong case must not match");
});

check("isValidReportObjectReadCapabilityId accepts the exact adopted shape only", () => {
  assert.ok(isValidReportObjectReadCapabilityId("report.customer.read"));
  assert.ok(!isValidReportObjectReadCapabilityId("report.customer.field.name.read"), "a field id is not an object id");
  assert.ok(!isValidReportObjectReadCapabilityId("Report.customer.read"), "wrong case must not match");
  assert.ok(!isValidReportObjectReadCapabilityId("report.customer.write"), "wrong action must not match");
  assert.ok(!isValidReportObjectReadCapabilityId("customer.record.read"), "a non-report id must not match");
});

check("isValidReportFieldReadCapabilityId accepts the exact adopted shape only", () => {
  assert.ok(isValidReportFieldReadCapabilityId("report.customer.field.name.read"));
  assert.ok(!isValidReportFieldReadCapabilityId("report.customer.read"), "an object id is not a field id");
  assert.ok(!isValidReportFieldReadCapabilityId("report.customer.name.read"), "missing the literal 'field' segment must not match");
  assert.ok(!isValidReportFieldReadCapabilityId("report.customer.field.name.write"), "wrong action must not match");
  assert.ok(!isValidReportFieldReadCapabilityId("Report.customer.field.name.read"), "wrong case must not match");
});

check("every wave-1 report.* id is registered and passes isValidPermissionId (the general shape check already accepts it unchanged)", () => {
  for (const id of [
    "report.customer.read",
    "report.customer.field.billingAddress.read",
    "report.contact.field.customer.read",
    "report.location.field.accessNotes.read",
    "report.equipment.field.identity.read",
  ]) {
    assert.ok(isValidPermissionId(id), `"${id}" must satisfy the general PermissionId pattern`);
    assert.ok(findPermission(id), `"${id}" must be registered in the catalog`);
  }
});

check("isActivePermission: true for a registered, active id", () => {
  // 2C.6C: the example used to be report.customer.field.name.read. The report.* family is now
  // environment-activated (DECISIONS #167), so no report id is catalogue-active any more and the
  // example moved to a capability that still is. The assertion itself is unchanged.
  assert.equal(isActivePermission("workOrder.transition"), true);
  assert.equal(isActivePermission("customer.record.read"), true, "an ordinary pre-existing id with no active flag is active");
});

check("isActivePermission: false for a registered but explicitly inactive id (ADR-007 sec2.6 sensitive-by-default)", () => {
  assert.equal(isActivePermission("report.customer.field.notes.read"), false, "security-text, pending wave-1 review confirmation");
  assert.equal(isActivePermission("report.customer.field.accountOwner.read"), false, "employee-sensitivity, deferred to wave 4");
  assert.equal(isActivePermission("report.location.field.accessNotes.read"), false, "security-text, pending wave-1 review confirmation");
});

check("isActivePermission: false (never true) for an unregistered id -- stricter than findPermission, not a substitute", () => {
  assert.equal(isActivePermission("report.customer.field.doesNotExist.read"), false);
  assert.equal(isActivePermission("not.a.realPermission"), false);
});

check("the three sensitive wave-1 report ids stay withheld -- now at the activation layer", () => {
  // 2C.6C moved the ENTIRE report.* family to `active: false` so production could be fail-closed
  // (DECISIONS #167). That erased this distinction at the CATALOGUE level, where it used to live:
  // 36 active, 3 inactive-pending-review.
  //
  // The distinction is not lost, it MOVED to where it is now meaningful. Sandbox re-activates
  // exactly the 36 that were live and deliberately does NOT carry these three, so the
  // sensitivity decision still holds in the one environment where Reporting runs.
  const reportIds = PERMISSION_CATALOG.filter((p) => p.id.startsWith("report."));
  assert.ok(reportIds.every((p) => p.active === false), "the whole family is environment-activated now");

  const sandbox = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "eos-platform-sandbox");
  const withheld = reportIds.filter((p) => !sandbox.has(p.id)).map((p) => p.id).sort();
  assert.deepEqual(withheld, [
    "report.customer.field.accountOwner.read",   // employee-sensitivity, deferred to wave 4
    "report.customer.field.notes.read",          // security-text, pending wave-1 review
    "report.location.field.accessNotes.read",    // security-text, pending wave-1 review
  ].sort());
  assert.equal(reportIds.length - withheld.length, 36, "the other 36 are activated in sandbox");
});

// The invariant this protects is that introducing `active` did not change behavior for any
// PRE-EXISTING id -- an id that resolved before must resolve the same way now. A NEWLY REGISTERED id
// declaring `active: false` cannot change any pre-existing behavior, because nothing resolved it
// before it existed. D4 registers the five `equipment.*` capabilities exactly that way
// (registered-but-not-grantable), so they are allowed to declare it and are separately asserted to
// declare `active: false` and nothing else in functions/test/equipmentCompatibilityRegistry.test.mjs.
// AUTH-PR-3.5 (DECISIONS #56): admin.credentialReset.initiate is registered
// `active: false` (inactive pending a separate production/security gate), the
// same additive posture as the report.*/equipment.* inactive capabilities.
// WO Parts Planning Phase 2: workOrder.parts.plan is registered `active: false`
// (the governed setWorkOrderPartsPlan producer's capability, ungranted-by-design
// pending a separate Owner grant), same additive posture.
// Sales Opportunity Cycle 3: opportunity.write is registered `active: false` (the governed Opportunity write
// command's capability, ungranted-by-design pending a separate Owner grant), same additive posture.
// Serialized Asset registry, Spec phase M.1: inventory.serializedAsset.read is registered `active: false`,
// same additive posture as the other inactive entries above.
// CRM Activity (Wave 7 extension Part 1.4): crm.activity.create/.read are registered `active: false`,
// ungranted-by-design pending a separate Owner grant -- the same additive posture. Adding the prefix
// here WIDENS this guard, so it is paired with an explicit assertion below that both ids are
// active:false and never true; the guard must not become a loophole for an active:true id.
// Coordinated Operations fidelity fix: fulfillment.coordinatedVisit.read, and Enterprise Inventory
// Phase 4: inventory.transfer.create/.dispatch/.receive/.cancel -- all registered `active: false`,
// the same additive posture as the inactive entries above (registered-but-ungranted pending separate
// Owner grant gates). Both landed in the same wave and are merged here deliberately rather than one
// overwriting the other.
// Scanner Phase Q: inventory.returns.intake -- recording that something came back. NOT
// inventory.stock.receive, because receiving accepts stock INTO sellable inventory, which is
// precisely what DECISIONS #118 forbids a return from doing. Disposition will need its own id when
// the policy exists; none is registered, because none has been decided. active:false, ungranted.
//
// // Scanner Phase L: inventory.placement.record -- put-away. A THIRD audience again: not labelling
// racking, not checking a bin is real, and deliberately NOT inventory.stock.receive, because reusing
// the receive capability would make every stow look like an authority to accept stock. It writes a
// placement record and no ledger movement (DECISIONS #116). active:false, granted to no Role.
//
// // Scanner Phase K: inventory.location.bin.manage / .read -- the descriptive bin registry
// (DECISIONS #116: the warehouse owns custody; a bin describes where stock sits inside one). TWO ids
// because there are two audiences: an operator putting stock away needs to check a bin is real, and
// gating that on the write capability would let them create and retire racking. Both active:false
// and granted to no Role; paired with their own explicit assertions below.
//
// // Scanner Phase H: inventory.balance.read -- the shared governed balance read (on-hand, reserved,
// available, on order for one Part). Its numbers come from fulfillment's Owner-ratified pure
// functions, so it is not a second on-hand authority; it needed its own id because
// warehouse.stockLocation.read names a collection the ledger superseded and is granted to the wrong
// audience, and inventory.analytics.read is an estate dashboard rather than a per-part answer.
// Registered active:false and granted to no Role; paired with its own explicit assertion below.
//
// Scanner Phase G: inventory.catalog.alias.read -- the resolve-only capability behind barcode/alias
// LOOKUP, deliberately separate from inventory.catalog.manage (which the five alias ADMINISTRATION
// callables use), because gating a warehouse lookup on a write capability would hand every scanning
// user the authority to create and deactivate identifiers. Registered active:false and granted to no
// Role; paired with its own explicit assertion below.
//
// NOTE the prefix is the FULL id, not "inventory.catalog.", because inventory.catalog.manage and
// .activate are ACTIVE and must stay outside this guard -- a broader prefix would let a future
// inventory.catalog.* entry declare active:true unnoticed.
//
// Prefixes accumulate as registered-but-ungranted capabilities land. Two waves added entries
// concurrently (coordinated-visit/transfer, and cycle count); both sets are kept -- one must never
// overwrite the other. Each is paired with its own active:false assertion elsewhere in this file.
const ACTIVE_DECLARING_PREFIXES = ["report.", "equipment.", "admin.credentialReset.", "workOrder.parts.", "workOrder.labor.", "opportunity.", "salesAgreement.", "salesOrder.", "finance.", "coverage.", "inventory.catalog.read", "inventory.catalog.alias.read", "inventory.balance.", "inventory.location.bin.", "inventory.placement.", "inventory.returns.", "inventory.serializedAsset.", "crm.activity.", "fulfillment.coordinatedVisit.", "inventory.transfer.", "inventory.location.display.", "inventory.cycleCount.", "performance.goal.", "financialPolicy.profile."];
check("no other catalog entry declares `active` (this addition is additive-only for every pre-existing id)", () => {
  for (const permission of PERMISSION_CATALOG) {
    if (ACTIVE_DECLARING_PREFIXES.some((prefix) => permission.id.startsWith(prefix))) continue;
    assert.equal("active" in permission, false, `"${permission.id}" must not declare active -- would be a behavior change`);
  }
});
// Performance Goal Authority. Paired with the prefix above, exactly as this file's own convention
// requires: a prefix that permits `active` to be DECLARED must come with an assertion pinning what
// it is declared AS. All five verbs are registered-but-inactive -- REGISTER != GRANT != ACTIVATE --
// and the count is asserted too, so a sixth verb cannot appear inside the prefix unnoticed.
check("all five performance.goal.* entries are registered-but-inactive (active: false, never true)", () => {
  const goalIds = ["performance.goal.read", "performance.goal.create", "performance.goal.approve", "performance.goal.supersede", "performance.goal.retire"];
  const found = PERMISSION_CATALOG.filter((p) => p.id.startsWith("performance.goal."));
  assert.deepEqual(found.map((p) => p.id).sort(), [...goalIds].sort(), "the performance.goal.* prefix covers exactly the five governed verbs");
  for (const permission of found) {
    assert.equal(permission.active, false, `${permission.id} must be registered active:false`);
    assert.equal(permission.resource, "performance.goal", `${permission.id} resource must match its id`);
    assert.equal(permission.action, permission.id.split(".")[2], `${permission.id} action must match its id`);
  }
});
check("goal AUTHORING and goal APPROVAL stay separate capabilities", () => {
  // The one collapse this authority must never permit: if one id covered both, a single person could
  // set and bless their own team's numbers in one act. FIN-007's self-approval prohibition is the
  // runtime guard; this is the structural one.
  assert.notEqual("performance.goal.create", "performance.goal.approve");
  assert.ok(PERMISSION_CATALOG.some((p) => p.id === "performance.goal.create"));
  assert.ok(PERMISSION_CATALOG.some((p) => p.id === "performance.goal.approve"));
});
check("both workOrder.labor.* entries are registered-but-inactive (active: false, never true)", () => {
  // Labor Domain V1. Paired with the prefix above, exactly as this file's own comment requires: a
  // prefix that permits `active` to be DECLARED must come with an assertion that it is declared
  // FALSE, or the allowance quietly becomes permission to activate.
  const labor = PERMISSION_CATALOG.filter((p) => p.id.startsWith("workOrder.labor."));
  assert.equal(labor.length, 2, "expected record + correct");
  assert.deepEqual(labor.map((p) => p.id).sort(), ["workOrder.labor.correct", "workOrder.labor.record"]);
  for (const p of labor) {
    assert.equal(p.active, false, `${p.id} must be inactive until a separate Owner activation`);
  }
});

check("every crm.activity.* entry is registered-but-not-grantable (active: false, never true)", () => {
  const crm = PERMISSION_CATALOG.filter((p) => p.id.startsWith("crm.activity."));
  assert.equal(crm.length, 2, "Part 1.4 registers exactly two CRM activity capabilities");
  assert.deepEqual(crm.map((p) => p.id).sort(), ["crm.activity.create", "crm.activity.read"]);
  for (const permission of crm) {
    assert.equal(permission.active, false, `"${permission.id}" must be inactive (registered-but-ungranted)`);
  }
});
check("every equipment.* entry is registered-but-not-grantable (active: false, never true)", () => {
  const equipment = PERMISSION_CATALOG.filter((p) => p.id.startsWith("equipment."));
  // D4 registered five (compatibility x4 + model.manage). equipment.install is the sixth, added with
  // the serialized-asset install authority -- the act the Serialized Asset contract calls "§H's job"
  // and records as not built. Listed BY NAME rather than counted, so the next addition has to be
  // named here too instead of merely bumping a number nobody reads.
  assert.deepEqual(equipment.map((p) => p.id).sort(), [
    "equipment.compatibility.correct",
    "equipment.compatibility.import",
    "equipment.compatibility.verify",
    "equipment.compatibility.view",
    "equipment.install",
    "equipment.model.manage",
  ]);
  for (const permission of equipment) {
    assert.equal(permission.active, false, `"${permission.id}" must be inactive`);
  }
});
check("every inventory.transfer.* entry is registered-but-not-grantable (active: false, never true)", () => {
  const transfer = PERMISSION_CATALOG.filter((p) => p.id.startsWith("inventory.transfer."));
  assert.deepEqual(
    transfer.map((p) => p.id).sort(),
    ["inventory.transfer.cancel", "inventory.transfer.create", "inventory.transfer.dispatch", "inventory.transfer.receive"],
    "Enterprise Inventory Phase 4 registers exactly four transfer capabilities",
  );
  for (const permission of transfer) {
    assert.equal(permission.active, false, `"${permission.id}" must be inactive (registered-but-ungranted)`);
  }
});

check("every financialPolicy.profile.* entry is registered-but-not-grantable (active: false, never true)", () => {
  const policy = PERMISSION_CATALOG.filter((p) => p.id.startsWith("financialPolicy.profile."));
  assert.deepEqual(
    policy.map((p) => p.id).sort(),
    ["financialPolicy.profile.configure", "financialPolicy.profile.read"],
    "deployment-time financial policy registers exactly two capabilities: read it, and configure it",
  );
  for (const permission of policy) {
    assert.equal(permission.active, false, `"${permission.id}" must be inactive -- which authority owns deployment-time financial configuration is an open Owner decision`);
  }
});

check("every inventory.cycleCount.* entry is registered-but-not-grantable (active: false, never true)", () => {
  const cycleCount = PERMISSION_CATALOG.filter((p) => p.id.startsWith("inventory.cycleCount."));
  assert.deepEqual(
    cycleCount.map((p) => p.id).sort(),
    ["inventory.cycleCount.cancel", "inventory.cycleCount.create", "inventory.cycleCount.reconcile", "inventory.cycleCount.submit"],
    "Cycle Count operating authority registers exactly four capabilities",
  );
  for (const permission of cycleCount) {
    assert.equal(permission.active, false, `"${permission.id}" must be inactive (registered-but-ungranted)`);
  }
});

check("inventory.serializedAsset.read is registered exactly once, active: false, resource/action match the id", () => {
  const matches = PERMISSION_CATALOG.filter((p) => p.id === "inventory.serializedAsset.read");
  assert.equal(matches.length, 1, "inventory.serializedAsset.read must be registered exactly once");
  const [permission] = matches;
  assert.equal(permission.active, false, "inventory.serializedAsset.read must be inactive (registered-but-ungranted)");
  assert.equal(permission.resource, "inventory.serializedAsset");
  assert.equal(permission.action, "read");
});

check("inventory.returns.intake is registered exactly once, active: false, resource/action match", () => {
  const matches = PERMISSION_CATALOG.filter((p) => p.id === "inventory.returns.intake");
  assert.equal(matches.length, 1);
  const [permission] = matches;
  assert.equal(permission.active, false, "returns intake must be inactive (registered-but-ungranted)");
  assert.equal(permission.resource, "inventory.returns");
  assert.equal(permission.action, "intake");
});

check("no DISPOSITION capability exists, because no disposition policy has been decided", () => {
  // DECISIONS #118. Registering one before the policy exists would invite something to be built
  // against an authority whose meaning nobody has settled.
  const disposition = PERMISSION_CATALOG.filter((p) => /disposition|restock|scrap|quarantine/i.test(p.id));
  assert.deepEqual(disposition.map((p) => p.id), []);
});

check("inventory.placement.record is registered exactly once, active: false, resource/action match", () => {
  const matches = PERMISSION_CATALOG.filter((p) => p.id === "inventory.placement.record");
  assert.equal(matches.length, 1);
  const [permission] = matches;
  assert.equal(permission.active, false, "put-away must be inactive (registered-but-ungranted)");
  assert.equal(permission.resource, "inventory.placement");
  assert.equal(permission.action, "record");
});

check("stowing stock is NOT the authority to receive it, nor to retire racking", () => {
  // Three audiences, three ids. Collapsing any pair would hand a warehouse operator authority they
  // have no business holding all day.
  const ids = ["inventory.placement.record", "inventory.stock.receive", "inventory.location.bin.manage"];
  const resources = ids.map((id) => PERMISSION_CATALOG.find((p) => p.id === id)?.resource);
  assert.equal(new Set(resources).size, 3, "each must govern its own resource");
});

check("both bin capabilities are registered exactly once, active: false, resource/action match", () => {
  for (const [id, action] of [["inventory.location.bin.manage", "manage"], ["inventory.location.bin.read", "read"]]) {
    const matches = PERMISSION_CATALOG.filter((p) => p.id === id);
    assert.equal(matches.length, 1, `${id} must be registered exactly once`);
    const [permission] = matches;
    assert.equal(permission.active, false, `${id} must be inactive (registered-but-ungranted)`);
    assert.equal(permission.resource, "inventory.location.bin");
    assert.equal(permission.action, action);
  }
});

check("bin READ and bin MANAGE stay separate capabilities", () => {
  // The whole point. If these collapsed into one id, every put-away operator would hold the
  // authority to create and retire racking.
  const manage = PERMISSION_CATALOG.find((p) => p.id === "inventory.location.bin.manage");
  const read = PERMISSION_CATALOG.find((p) => p.id === "inventory.location.bin.read");
  assert.ok(manage && read);
  assert.notEqual(manage.action, read.action);
  assert.equal(manage.active, false);
  assert.equal(read.active, false);
});

check("inventory.balance.read is registered exactly once, active: false, resource/action match the id", () => {
  const matches = PERMISSION_CATALOG.filter((p) => p.id === "inventory.balance.read");
  assert.equal(matches.length, 1, "inventory.balance.read must be registered exactly once");
  const [permission] = matches;
  assert.equal(permission.active, false, "inventory.balance.read must be inactive (registered-but-ungranted)");
  assert.equal(permission.resource, "inventory.balance");
  assert.equal(permission.action, "read");
});

check("inventory.catalog.alias.read is registered exactly once, active: false, resource/action match the id", () => {
  const matches = PERMISSION_CATALOG.filter((p) => p.id === "inventory.catalog.alias.read");
  assert.equal(matches.length, 1, "inventory.catalog.alias.read must be registered exactly once");
  const [permission] = matches;
  assert.equal(permission.active, false, "inventory.catalog.alias.read must be inactive (registered-but-ungranted)");
  assert.equal(permission.resource, "inventory.catalog.alias");
  assert.equal(permission.action, "read");
});

check("alias LOOKUP and alias ADMINISTRATION stay separate capabilities", () => {
  // The whole point of Phase G. If these ever became one id, every scanning user would hold the
  // authority to create, deactivate and reactivate identifiers.
  const manage = PERMISSION_CATALOG.find((p) => p.id === "inventory.catalog.manage");
  const aliasRead = PERMISSION_CATALOG.find((p) => p.id === "inventory.catalog.alias.read");
  assert.ok(manage, "inventory.catalog.manage must still exist");
  assert.ok(aliasRead, "inventory.catalog.alias.read must still exist");
  assert.notEqual(manage.resource, aliasRead.resource, "they must not collapse onto one resource");
  assert.equal(manage.active, undefined, "the administration capability stays active");
  assert.equal(aliasRead.active, false, "the lookup capability stays inert until separately authorized");
});

check("fulfillment.coordinatedVisit.read is registered exactly once, active: false, resource/action match the id", () => {
  const matches = PERMISSION_CATALOG.filter((p) => p.id === "fulfillment.coordinatedVisit.read");
  assert.equal(matches.length, 1, "fulfillment.coordinatedVisit.read must be registered exactly once");
  const [permission] = matches;
  assert.equal(permission.active, false, "fulfillment.coordinatedVisit.read must be inactive (registered-but-ungranted)");
  assert.equal(permission.resource, "fulfillment.coordinatedVisit");
  assert.equal(permission.action, "read");
});


// ============================ CAPABILITIES THAT MUST NOT BE INVENTED ============================
//
// PRECEDENCE SWEEP 2026-08-21, rank HIGH, previously unguarded. Three separate decisions each
// refused to create a capability, and each refusal was recorded only in prose.
//
// The failure this prevents is not a privilege escalation; it is worse in a quieter way. A
// symmetry-only permission makes a Role LOOK authorized while nothing enforces it. The CRUD matrix
// asks for Marketing Initiatives CRED and for Commissions; no engine governs either. Registering
// `marketing.initiative.write` to make the workbook tidy would produce a Role that reads as
// authorized in every report, every audit and every UI gate, and grants nothing.
//
// The honest form is a recorded GAP, which is what these are. Each entry names the decision that
// refused it, so adding one has to be someone's argued choice rather than a spreadsheet symmetry.
const MUST_NOT_EXIST = [
  { prefix: "supplier.", why: "DECISIONS #78: Supplier is a CATALOG-governed object and reuses inventory.catalog.manage/.activate. A supplier.manage/supplier.read pair would be a symmetry-only permission and a temporary path R-1 would then have to retire." },
  { prefix: "marketing.", why: "Owner ruling 2026-08-19: the matrix gives Marketing CRED over Marketing Initiatives and no engine governs them. Marketing Manager was created with the reads it can really hold; the rest is a recorded catalog gap, not an unenforced grant." },
  { prefix: "commission.", why: "Recorded catalog gap beside Marketing Initiatives, Technician Time and Notifications. Commissions are UNMODELLED -- the matrix expresses intent the platform does not implement." },
];

check("no capability is invented to make the business-intent matrix look symmetrical", () => {
  const ids = PERMISSION_CATALOG.map((p) => p.id);
  for (const entry of MUST_NOT_EXIST) {
    const found = ids.filter((id) => id.startsWith(entry.prefix));
    assert.deepEqual(
      found, [],
      `Capability ids beginning "${entry.prefix}" were registered: ${found.join(", ")}.` +
      "\n\nDECISION: " + entry.why +
      "\n\nIf the platform now genuinely governs this object, that is a real capability with an " +
      "engine behind it -- register it deliberately and remove this entry, saying what enforces it. " +
      "Registering it to complete a CRUD row is the thing this guard exists to stop.",
    );
  }
});

check("the uninvented-capability list cannot be quietly emptied", () => {
  // A guard whose data can be deleted is a guard that can be disabled without touching its logic.
  assert.ok(MUST_NOT_EXIST.length >= 3, "recorded refusals must not be removed to make a change pass");
  for (const e of MUST_NOT_EXIST) {
    assert.ok(e.why.length > 80, `${e.prefix} must carry the decision that refused it`);
  }
});
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
