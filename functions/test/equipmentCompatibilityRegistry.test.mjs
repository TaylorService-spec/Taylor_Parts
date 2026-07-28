// D4 Stage D -- permission-catalog entries, AuditAction registration, mirror integrity and the
// client-closed Rules proposal. Pure logic, no emulator: these assert what the REPOSITORY declares,
// not what any environment enforces. Rules ENFORCEMENT against the emulator is Stage E, and deployment
// is the separate D10 gate.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "firebase-admin";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const read = (p) => readFileSync(join(repoRoot, p), "utf8");

// The audit-writer behavioural check below exercises the REAL exported writer, which mints an auto-id
// via getFirestore() before staging. That needs an initialized app but NEVER a live backend: the test
// passes a fake writer and never commits, so no document is read or written anywhere. The emulator host
// is set defensively so an accidental commit would fail loudly against localhost rather than reach prod.
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-equipment-registry-test" });

const catalog = await import("../lib/access/permissionCatalog.js");
const { COMMAND_CAPABILITIES, EQUIPMENT_AUDIT_ACTIONS } = await import("../lib/equipmentCompatibility/commands.js");
const { EQUIPMENT_COMPATIBILITY_COLLECTIONS } = await import("../lib/equipmentCompatibility/repository.js");
const { stageAuditEvent, AuditEventValidationError } = await import("../lib/access/auditEventWriter.js");

let passed = 0;
const ok = (n, f) => { f(); passed++; console.log(`PASS -- ${n}`); };

const EQUIPMENT_CAPABILITIES = [
  "equipment.compatibility.view",
  "equipment.compatibility.import",
  "equipment.compatibility.verify",
  "equipment.compatibility.correct",
  "equipment.model.manage",
];

// ---- permission catalog ----
ok("all five governed equipment capabilities are registered", () => {
  for (const id of EQUIPMENT_CAPABILITIES) {
    const permission = catalog.findPermission(id);
    assert.ok(permission, `${id} must be registered`);
    assert.equal(typeof permission.description, "string");
    assert.ok(permission.description.length > 0, `${id} needs a description`);
    assert.equal(id, `${permission.resource}.${permission.action}`, `${id} must match resource.action`);
  }
});
ok("every equipment capability is REGISTERED BUT NOT GRANTABLE (active:false)", () => {
  for (const id of EQUIPMENT_CAPABILITIES) {
    assert.equal(catalog.findPermission(id).active, false, `${id} must be inactive in D4`);
    // The fail-closed helper the resolver uses must agree.
    assert.equal(catalog.isActivePermission(id), false, `${id} must not resolve as active`);
  }
});
ok("the orchestrator's capability map uses only registered equipment ids", () => {
  const used = new Set(Object.values(COMMAND_CAPABILITIES));
  for (const id of used) {
    assert.ok(EQUIPMENT_CAPABILITIES.includes(id), `${id} must be a governed equipment capability`);
    assert.ok(catalog.findPermission(id), `${id} must exist in the catalog`);
  }
  // Every write capability is exercised by a command; `view` is deliberately unused in D4 because no
  // client or server read path exists yet (it belongs to the D5 read service).
  assert.deepEqual([...used].sort(), EQUIPMENT_CAPABILITIES.filter((id) => id !== "equipment.compatibility.view").sort());
});

// ---- mirror integrity ----
ok("the equipment catalog block is BYTE-IDENTICAL across both governed mirrors", () => {
  // Scoped deliberately to the equipment block. The two catalogs are NOT identical overall at this
  // commit -- the server carries inventory.catalog.* entries the client mirror lacks -- and that
  // pre-existing INV-1 drift is reported separately rather than silently repaired or silently ignored
  // by a test that would otherwise fail for reasons this stage did not cause.
  const extract = (source) => {
    const start = source.indexOf("  // D4 -- Part-Equipment Compatibility trusted persistence (design package");
    assert.notEqual(start, -1, "the equipment block must be present");
    const end = source.indexOf('    id: "equipment.model.manage"', start);
    assert.notEqual(end, -1);
    const close = source.indexOf("  }),", end);
    return source.slice(start, close + "  }),".length);
  };
  const server = extract(read("functions/src/access/permissionCatalog.ts"));
  const client = extract(read("field-ops-app-vite/src/access/permissionCatalog.ts"));
  assert.equal(server, client, "the equipment permission block must match byte for byte");
  for (const id of EQUIPMENT_CAPABILITIES) {
    assert.ok(server.includes(`id: "${id}"`), `${id} must appear in the mirrored block`);
  }
  // Count the FIELD lines only -- the block comment also mentions the flag.
  assert.equal((server.match(/^ {4}active: false,$/gm) || []).length, EQUIPMENT_CAPABILITIES.length, "every entry inactive");
});

// ---- audit actions ----
ok("all five equipment AuditActions are registered in the shared writer allowlist", () => {
  const writerSource = read("functions/src/access/auditEventWriter.ts");
  const typeSource = read("functions/src/types/access.ts");
  for (const action of EQUIPMENT_AUDIT_ACTIONS) {
    assert.ok(writerSource.includes(`"${action}",`), `${action} must be in AUDIT_ACTIONS`);
    assert.ok(typeSource.includes(`| "${action}"`), `${action} must be in the AuditAction union`);
  }
  assert.equal(EQUIPMENT_AUDIT_ACTIONS.length, 5);
});
ok("the shared audit writer ACCEPTS every equipment action -- staged with that exact action -- via its real exported surface", () => {
  // Exercises the REAL exported writer (stageAuditEvent), not the non-exported builder. A fake writer
  // captures the staged document so we prove, behaviourally, that (a) each equipment action passes the
  // writer's own allowlist validation and (b) the value that lands in the staged doc IS that action.
  // If any equipment action were removed from AUDIT_ACTIONS in auditEventWriter.ts, assertValid would
  // throw here and this test would FAIL -- string-match evidence alone can no longer paper over a gap.
  assert.equal(EQUIPMENT_AUDIT_ACTIONS.length, 5, "exactly five equipment actions must be exercised");
  for (const action of EQUIPMENT_AUDIT_ACTIONS) {
    let staged = null;
    const captureWriter = { set(ref, data) { staged = { id: ref.id, data }; } };
    const returnedId = stageAuditEvent(captureWriter, {
      actorUid: "actor-1", action, targetType: "equipment_models", targetId: "TAYLOR--C713",
      outcome: "applied", summary: "registration check",
    });
    assert.ok(staged, `${action} must stage exactly one document`);
    assert.equal(staged.data.action, action, `${action} must be staged with its own action value`);
    assert.equal(staged.data.actorUid, "actor-1", `${action} must preserve the actor`);
    assert.equal(staged.data.outcome, "applied", `${action} must preserve the outcome`);
    assert.equal(staged.id, returnedId, `${action}: staged ref id must equal the returned id`);
  }
});
ok("the shared audit writer REJECTS a foreign action BEFORE any document is staged", () => {
  // assertValid runs before the writer is ever touched, so a non-allow-listed action must throw and the
  // fake writer's set() must never fire -- no half-written audit trail for an unrecognised action.
  let touched = false;
  const spyWriter = { set() { touched = true; } };
  assert.throws(
    () => stageAuditEvent(spyWriter, {
      actorUid: "actor-1", action: "definitelyNotAnEquipmentAuditAction", targetType: "equipment_models",
      targetId: "TAYLOR--C713", outcome: "applied", summary: "should be rejected",
    }),
    AuditEventValidationError,
    "a foreign action must be rejected by the writer's allowlist",
  );
  assert.equal(touched, false, "no document may be staged for a rejected action");
});

// ---- client-closed Rules proposal (BOTH governed mirrors) ----
// The repo carries TWO Rules files -- the root firestore.rules (the deployed artifact) and the client
// mirror field-ops-app-vite/firestore.rules. Enforcing the D4 closure on only one leaves the other free
// to drift open. Every check below therefore runs against BOTH, and a byte-equality gate + negative
// control prove the two mirrors' governed blocks are and stay identical.
const RULES_MIRRORS = ["firestore.rules", "field-ops-app-vite/firestore.rules"];

// Extract the labelled D4 block: from its banner comment through the closing brace of the last governed
// collection (equipment_compatibility_operations). Scoped so the comparison ignores unrelated Rules.
const extractRulesBlock = (source) => {
  const start = source.indexOf("    // D4 -- Part-Equipment Compatibility: CLIENT-CLOSED");
  assert.notEqual(start, -1, "the labelled D4 block must be present");
  const lastMatch = source.indexOf("match /equipment_compatibility_operations/", start);
  assert.notEqual(lastMatch, -1, "the operations collection must be present in the D4 block");
  const close = source.indexOf("\n    }", lastMatch);
  assert.notEqual(close, -1, "the operations collection must close");
  return source.slice(start, close + "\n    }".length);
};

ok("the D4 Rules block is BYTE-IDENTICAL across both governed mirrors", () => {
  const server = extractRulesBlock(read("firestore.rules"));
  const client = extractRulesBlock(read("field-ops-app-vite/firestore.rules"));
  assert.equal(server, client, "the D4 equipment Rules block must match byte for byte across both mirrors");
  for (const collection of EQUIPMENT_COMPATIBILITY_COLLECTIONS) {
    assert.ok(server.includes(`match /${collection}/`), `${collection} must appear in the mirrored block`);
  }
  // Negative/regression control: mutating ONE mirror's block (here: flipping a single denial open) must
  // make the byte comparison fail. This proves the equality gate actually discriminates rather than
  // being a trivially-true comparison that would pass even if a real mirror silently drifted open.
  const drifted = server.replace("allow read, write: if false;", "allow read, write: if true;");
  assert.notEqual(drifted, server, "the simulated drift must actually change the block");
  assert.notEqual(drifted, client, "a drifted mirror block must NOT compare equal -- the gate must catch it");
});

for (const file of RULES_MIRRORS) {
  ok(`all five governed collections are client-closed in ${file}`, () => {
    const rules = read(file);
    for (const collection of EQUIPMENT_COMPATIBILITY_COLLECTIONS) {
      const match = new RegExp(`match /${collection}/\\{[A-Za-z]+\\} \\{\\s*allow read, write: if false;\\s*\\}`);
      assert.match(rules, match, `${collection} must deny all client reads and writes in ${file}`);
    }
  });
  ok(`the equipment Rules block grants no conditional client access at all in ${file}`, () => {
    const block = extractRulesBlock(read(file));
    // Nothing in this block may allow anything on any condition.
    const allows = block.match(/allow [^;]+;/g) || [];
    assert.equal(allows.length, EQUIPMENT_COMPATIBILITY_COLLECTIONS.length, `one allow per collection in ${file}`);
    for (const allow of allows) {
      assert.equal(allow, "allow read, write: if false;", `every allow must be an unconditional denial in ${file}`);
    }
    // No role, claim or resolver reference can creep into a client-closed block.
    for (const forbidden of ["request.auth", "isSignedIn", "hasPermission", "get(", "exists("]) {
      assert.equal(block.includes(forbidden), false, `the D4 block must not reference ${forbidden} in ${file}`);
    }
  });
}
ok("D4 declares no compound index for the governed collections", () => {
  // The single bounded evidence query uses single-field equality, which Firestore indexes
  // automatically. Projections and their query shapes are deferred to D5.
  let indexes;
  try {
    indexes = JSON.parse(read("firestore.indexes.json"));
  } catch {
    return; // no index file in this repo checkout
  }
  const equipment = (indexes.indexes ?? []).filter((i) => String(i.collectionGroup ?? "").startsWith("equipment_"));
  assert.deepEqual(equipment, [], "D4 introduces no compound index");
});

console.log(`\n${passed} registry + rules checks passed`);
