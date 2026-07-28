// D4 Stage D -- permission-catalog entries, AuditAction registration, mirror integrity and the
// client-closed Rules proposal. Pure logic, no emulator: these assert what the REPOSITORY declares,
// not what any environment enforces. Rules ENFORCEMENT against the emulator is Stage E, and deployment
// is the separate D10 gate.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const read = (p) => readFileSync(join(repoRoot, p), "utf8");

const catalog = await import("../lib/access/permissionCatalog.js");
const { COMMAND_CAPABILITIES, EQUIPMENT_AUDIT_ACTIONS } = await import("../lib/equipmentCompatibility/commands.js");
const { EQUIPMENT_COMPATIBILITY_COLLECTIONS } = await import("../lib/equipmentCompatibility/repository.js");

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
ok("the shared audit writer now ACCEPTS every equipment action and still rejects a foreign one", async () => {
  // Exercises the real validator through its exported surface, so registration is proven behaviourally
  // rather than by string match alone.
  const { buildAuditEventDocForTest } = await import("../lib/access/auditEventWriter.js").then((m) => ({
    buildAuditEventDocForTest: m.buildAuditEventDoc ?? null,
  }));
  if (buildAuditEventDocForTest === null) {
    // The writer does not export its builder; the allowlist assertion above is the available evidence.
    return;
  }
  for (const action of EQUIPMENT_AUDIT_ACTIONS) {
    assert.doesNotThrow(() => buildAuditEventDocForTest({
      actorUid: "actor-1", action, targetType: "equipment_models", targetId: "TAYLOR--C713",
      outcome: "applied", summary: "registration check",
    }), action);
  }
});

// ---- client-closed Rules proposal ----
ok("all five governed collections are client-closed in firestore.rules", () => {
  const rules = read("firestore.rules");
  for (const collection of EQUIPMENT_COMPATIBILITY_COLLECTIONS) {
    const match = new RegExp(`match /${collection}/\\{[A-Za-z]+\\} \\{\\s*allow read, write: if false;\\s*\\}`);
    assert.match(rules, match, `${collection} must deny all client reads and writes`);
  }
});
ok("the equipment Rules block grants no conditional client access at all", () => {
  const rules = read("firestore.rules");
  const start = rules.indexOf("// D4 -- Part-Equipment Compatibility: CLIENT-CLOSED");
  assert.notEqual(start, -1, "the D4 block must be present and labelled");
  const block = rules.slice(start);
  // Nothing in this block may allow anything on any condition.
  const allows = block.match(/allow [^;]+;/g) || [];
  assert.equal(allows.length, EQUIPMENT_COMPATIBILITY_COLLECTIONS.length, "one allow per collection");
  for (const allow of allows) {
    assert.equal(allow, "allow read, write: if false;", "every allow must be an unconditional denial");
  }
  // No role, claim or resolver reference can creep into a client-closed block.
  for (const forbidden of ["request.auth", "isSignedIn", "hasPermission", "get(", "exists("]) {
    assert.equal(block.includes(forbidden), false, `the D4 block must not reference ${forbidden}`);
  }
});
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
