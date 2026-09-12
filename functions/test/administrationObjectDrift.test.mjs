// ADMINISTRATION OBJECT DRIFT — the four authority tables, held against each other.
//
// ════════════════════ WHY THIS FILE EXISTS ════════════════════
//
// Administration → Objects advertises, per business object, which capability governs each of
// Create / Read / Edit / Delete. FOUR separate tables in this repository claim to answer that one
// question, and until this file nothing compared them:
//
//   field-ops-app-vite/src/access/objectPermissionMap.js       OBJECT_PERMISSIONS — what the
//                                                              Administration screens render
//   functions/scripts/governance/objectCapabilityMap.mjs       OBJECT_CAPABILITY_MAP — what the
//                                                              governance contract and workbook
//                                                              generators read
//   field-ops-app-vite/src/access/policyObjectRegistry.js      MATRIX_GAP_CAPABILITIES — the
//                                                              registry-only extension
//   scripts/reconcileCrudMatrix.mjs                            a fourth, private copy inside the
//                                                              reconciliation report script
//
// The first two disagreed in the repository as shipped. `objectPermissionMap.js` advertised
// `inventory.action.create`; `objectCapabilityMap.mjs` recorded `C: []` for the same object. Both
// were committed, both were tested, and nothing in either suite could see the other. That is the
// defect class this file closes: not a wrong value, but TWO ANSWERS TO ONE QUESTION with no
// mechanism that could ever notice.
//
// ════════════════════ WHAT THIS FILE DOES NOT DO ════════════════════
//
// It does NOT require the four tables to be identical. They are not, and several differences are
// deliberate and recorded — `objectCapabilityMap.mjs` maps Users and Roles/Permissions to nothing
// on purpose (Owner decision 2026-08-21), and maps Contacts to nothing on purpose rather than to
// `crm.activity.*`. Asserting equality would delete those decisions to make a test pass.
//
// It asserts the invariants that hold REGARDLESS of those judgements, plus the two live gaps
// pinned by name so that growing one fails the build and closing one fails loudly enough to be
// removed from here. Everything a person still has to decide is written down in
// docs/handoff/w1-c18-registrations.md rather than asserted.
//
// It also does not claim to prove ENFORCEMENT. Whether a governed server command actually
// implements an advertised verb cannot be decided mechanically in this repository: capability ids
// reach their enforcement sites through module constants and injected `authorize` seams, and
// several wirings discard the id the command passes. `docs/architecture/capability-graph.json`
// records literal-reference evidence and says so itself ("a literal-id scan is evidence of
// reference, never proof of a callable"). The one case where the answer IS provable — a writer
// that throws unconditionally — is asserted directly, below.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const clientModule = (...segments) =>
  pathToFileURL(path.join(REPO, "field-ops-app-vite", "src", ...segments)).href;

const { OBJECT_PERMISSIONS, VERBS, WORKFLOW_ACTION_CAPABILITIES } = await import(
  clientModule("access", "objectPermissionMap.js")
);
const { MATRIX_GAP_CAPABILITIES } = await import(clientModule("access", "policyObjectRegistry.js"));
const { recordInventoryAction } = await import(clientModule("domain", "inventoryActions.js"));
const { OBJECT_CAPABILITY_MAP, RULE_GOVERNED_OBJECTS, UNMODELLED_OBJECTS } = await import(
  pathToFileURL(path.join(HERE, "..", "scripts", "governance", "objectCapabilityMap.mjs")).href
);
const { PERMISSION_CATALOG } = await import(
  pathToFileURL(path.join(HERE, "..", "lib", "access", "permissionCatalog.js")).href
);

const RECONCILE_SCRIPT = path.join(REPO, "scripts", "reconcileCrudMatrix.mjs");
const reconcileSource = readFileSync(RECONCILE_SCRIPT, "utf8");

const catalogIds = new Set(PERMISSION_CATALOG.map((p) => p.id));

/** Every (where, id) pair the four tables advertise, so a failure can name its own source. */
function advertisedCapabilities() {
  const out = [];
  for (const entry of OBJECT_PERMISSIONS) {
    for (const verb of VERBS) {
      for (const id of entry[verb] ?? []) out.push({ where: `objectPermissionMap ${entry.object}/${verb}`, id });
    }
  }
  for (const [object, m] of Object.entries(OBJECT_CAPABILITY_MAP)) {
    for (const verb of VERBS) {
      for (const id of m[verb] ?? []) out.push({ where: `objectCapabilityMap ${object}/${verb}`, id });
    }
  }
  for (const [key, m] of Object.entries(MATRIX_GAP_CAPABILITIES)) {
    for (const verb of VERBS) {
      for (const id of m[verb] ?? []) out.push({ where: `MATRIX_GAP_CAPABILITIES ${key}/${verb}`, id });
    }
  }
  return out;
}

// ════════════════════ 1. nothing is advertised that the catalog does not define ════════════════

test("every capability Administration advertises is defined in the permission catalog", () => {
  const unknown = advertisedCapabilities().filter(({ id }) => !catalogIds.has(id));
  assert.deepEqual(
    unknown,
    [],
    "an advertised id the catalog does not define can never be granted, held or enforced — the " +
      "grid would offer authority that does not exist",
  );
});

test("every workflow action named as banned is itself a real catalog id", () => {
  // The ban list is only as good as its spelling. A retired or mistyped id would silently stop
  // banning anything, and the bans below would pass while enforcing nothing.
  const unknown = WORKFLOW_ACTION_CAPABILITIES.filter((id) => !catalogIds.has(id));
  assert.deepEqual(unknown, []);
});

// ════════════════════ 2. workflow actions are not CRED cells, in ANY table ══════════════════════
//
// Owner ruling 2026-09-08 (D-5): a capability representing a business ACTION or state transition is
// not an Object.Edit permission, and must not be duplicated as a CRED checkbox. Object/field CRED
// answers "what DATA may I change"; a workflow action answers "what ACTION may I perform". Neither
// implies the other, so an id with two homes gives an administrator two contradictory ways to grant
// one thing.
//
// `objectPermissionMap.js` already proved this about ITSELF (workflowActionsAlsoInCred). The ruling
// was never checked against the other two tables, and `objectCapabilityMap.mjs` was in breach:
// Purchase Orders / Edit carried `reorder.request.postPurchasingUpdate`, which is both a banned
// workflow action AND a REORDER REQUEST transition attributed to the Purchase Order object.

test("no workflow action is advertised as a CRED cell in the governance capability map", () => {
  const banned = new Set(WORKFLOW_ACTION_CAPABILITIES);
  const breaches = [];
  for (const [object, m] of Object.entries(OBJECT_CAPABILITY_MAP)) {
    for (const verb of VERBS) {
      for (const id of m[verb] ?? []) if (banned.has(id)) breaches.push(`${object}/${verb} -> ${id}`);
    }
  }
  assert.deepEqual(breaches, []);
});

test("no workflow action is advertised as a CRED cell in the registry gap table", () => {
  const banned = new Set(WORKFLOW_ACTION_CAPABILITIES);
  const breaches = [];
  for (const [key, m] of Object.entries(MATRIX_GAP_CAPABILITIES)) {
    for (const verb of VERBS) {
      for (const id of m[verb] ?? []) if (banned.has(id)) breaches.push(`${key}/${verb} -> ${id}`);
    }
  }
  assert.deepEqual(breaches, []);
});

test("no workflow action appears in the reconciliation script's private matrix", () => {
  // Read as TEXT rather than imported: the script has top-level side effects and refuses to run
  // against a stale build. A substring scan is enough — every id in its table is a quoted literal.
  const breaches = WORKFLOW_ACTION_CAPABILITIES.filter((id) => reconcileSource.includes(`"${id}"`));
  assert.deepEqual(
    breaches,
    [],
    "scripts/reconcileCrudMatrix.mjs carries a FOURTH copy of the object/capability mapping. It " +
      "is not imported by anything, so nothing else can catch it drifting.",
  );
});

// ════════════════════ 3. the retired Inventory Action write side ════════════════════════════════

test("the Inventory Action writer is retired and still throws", () => {
  assert.throws(
    () => recordInventoryAction(),
    /no longer accepts new entries/,
    "this is the premise of the assertion below — if the writer is ever revived, that test's " +
      "reason disappears and it must be reconsidered rather than left standing",
  );
});

test("no CRED table advertises a Create on Inventory Actions", () => {
  // `inventory.action.create` is registered ACTIVE in the permission catalog and is granted to
  // admin and dispatcher, so nothing in the authorization engine marks it dead. Its only
  // application-layer writer throws unconditionally (Owner ruling 2026-08-30) and the `.add()`
  // capable store handle was deleted. Advertising it told an administrator to request authority
  // for an operation with no code behind it.
  const found = advertisedCapabilities().filter(({ id }) => id === "inventory.action.create");
  assert.deepEqual(found, []);
  assert.ok(
    !reconcileSource.includes('"inventory.action.create"'),
    "the reconciliation script's private matrix must not advertise it either",
  );
});

// ════════════════════ 4. the two capability maps cover the same objects ═════════════════════════

test("the governance capability map names no object Administration does not advertise", () => {
  const advertised = new Set(OBJECT_PERMISSIONS.map((e) => e.object));
  const orphans = Object.keys(OBJECT_CAPABILITY_MAP).filter((o) => !advertised.has(o));
  assert.deepEqual(orphans, []);
});

test("exactly one object Administration advertises is missing from the governance capability map", () => {
  // PINNED, NOT ACCEPTED. Owner ruling D-5 (2026-09-08) split Reorder Request out of Purchase
  // Orders as its own canonical Object. `objectPermissionMap.js` got the new row;
  // `objectCapabilityMap.mjs` never did, so every governance contract row, workbook sheet and
  // precedence-sweep classification generated from it silently omits the object — the capabilities
  // `reorder.request.create.manual`, `.create.system`, `.read.queue` and `.read.own` are attributed
  // to no object at all in the generated governance artifacts.
  //
  // Adding the row is a capability-map ADDITION and is therefore not this lane's to make. It is
  // written up as a required registration in docs/handoff/w1-c18-registrations.md. When it lands,
  // this test fails and must be deleted, not amended — the gap being closed is the whole point.
  const mapped = new Set(Object.keys(OBJECT_CAPABILITY_MAP));
  const missing = OBJECT_PERMISSIONS.map((e) => e.object).filter((o) => !mapped.has(o));
  assert.deepEqual(missing, ["Reorder Requests"]);
});

test("the reconciliation script's private matrix names no object Administration does not advertise", () => {
  const advertised = new Set(OBJECT_PERMISSIONS.map((e) => e.object));
  const named = [...reconcileSource.matchAll(/\{ object: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(named.length > 20, "the private matrix was not found — this scan has stopped checking anything");
  assert.deepEqual(named.filter((o) => !advertised.has(o)), []);
});

// ════════════════════ 5. the Rules-as-authorization census ══════════════════════════════════════
//
// Every `rulesOnly` entry is a standing instance of the prohibition on Firestore Rules serving as
// authorization: the object exists, Administration lists it, and the answer to "who may do this"
// lives in role branches inside firestore.rules where no capability, no Role definition and no
// governed command can see it. Three objects are in that state today. The census is PINNED so a
// fourth cannot appear without a decision, and so closing one is visible.

test("every rules-governed object advertises no capability on any verb", () => {
  const contradictions = [];
  for (const entry of OBJECT_PERMISSIONS) {
    if (!entry.rulesOnly) continue;
    for (const verb of VERBS) {
      if ((entry[verb] ?? []).length > 0) contradictions.push(`${entry.object}/${verb}`);
    }
  }
  assert.deepEqual(
    contradictions,
    [],
    "an object cannot be governed by Rules AND by a capability — the grid would show a grantable " +
      "verb whose real answer is decided somewhere the grant cannot reach",
  );
});

test("the rules-governed census is exactly the three objects on record", () => {
  const census = OBJECT_PERMISSIONS.filter((e) => e.rulesOnly).map((e) => `${e.object} -> ${e.rulesOnly}`);
  assert.deepEqual(census, [
    "Contacts -> contacts",
    "Customer Locations -> locations",
    "Equipment / Installed Base -> equipment",
  ]);
});

test("every rules-governed object is recorded as RULE_GOVERNED on the governance side too", () => {
  const missing = OBJECT_PERMISSIONS.filter((e) => e.rulesOnly && !RULE_GOVERNED_OBJECTS.includes(e.object)).map(
    (e) => e.object,
  );
  assert.deepEqual(missing, []);
});

test("the governance side calls two further objects RULE_GOVERNED that Administration does not", () => {
  // PINNED DISAGREEMENT, not an accepted one.
  //
  //   Notifications           objectPermissionMap advertises R: ["reorder.request.read.queue"], so
  //                           Administration says it is CAPABILITY-governed. objectCapabilityMap
  //                           maps it to nothing and lists it as RULE_GOVERNED. Both are shipped.
  //   Technician Time /       Neither table names a capability. It is an object the platform does
  //   Non-work                not model at all, which is UNMODELLED, not Rules-governed — no
  //                           firestore.rules collection corresponds to it.
  //
  // Recorded in docs/handoff/w1-c18-registrations.md. Resolving it means deciding which of the two
  // is right, which is an access-model decision with an owner.
  const clientRulesOnly = new Set(OBJECT_PERMISSIONS.filter((e) => e.rulesOnly).map((e) => e.object));
  const serverOnly = RULE_GOVERNED_OBJECTS.filter((o) => !clientRulesOnly.has(o));
  assert.deepEqual(serverOnly, ["Notifications", "Technician Time / Non-work"]);
});

test("an object with no capability on any verb is rules-governed, unmodelled, or named as neither", () => {
  // The third state is the one that matters: an object nobody can be granted anything on, which
  // nothing explains. Today every such object has an explanation; this fails when one does not.
  const unexplained = [];
  for (const entry of OBJECT_PERMISSIONS) {
    const total = VERBS.reduce((n, v) => n + (entry[v] ?? []).length, 0);
    if (total > 0) continue;
    if (entry.rulesOnly) continue;
    if (UNMODELLED_OBJECTS.includes(entry.object)) continue;
    if (RULE_GOVERNED_OBJECTS.includes(entry.object)) continue;
    unexplained.push(entry.object);
  }
  assert.deepEqual(unexplained, []);
});
