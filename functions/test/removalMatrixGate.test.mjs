// THE REMOVAL-MATRIX REGRESSION GATE (field permissions PR 1 -- tests only, zero runtime change).
//
// For every key a proposed field-permission REMOVAL names (the architecture lane's removal specs, ported into
// support/removalMatrix.mjs), this pins which Roles hold it according to the REPOSITORY's code, one column per source:
// the authority baseline (roleCapabilityAuthorityBaseline.json: global rows + recorded NONPROD_ACTIVATION rows), the
// recorded nonprod Administration delta modules (src/adminPolicy/*Delta.ts: grants, revokes, grant conditions, imported
// from the real modules) and the protected Administrator's standing (protectedAdministrator.ts). Per spec it pins the
// Roles that meet `before`, meet `after`, and would lose or gain. A PR that moves any of it -- a grant-bearing migration
// and its baseline row, a Role-catalog declaration, a delta module, a PA exclusion or management key -- FAILS here until
// the pin is regenerated and its digest moved, deliberately, in the same reviewed diff.
//
// OUT OF SCOPE (no repository change produces it; the mandatory grant preview of PRs 2-3 governs it): grants, revokes
// and conditions made at RUNTIME through Administration that no delta module records (ADMIN_GRANTED rows), assignment
// SCOPES (e.g. salesChannel-scoped Role assignments), direct Principal capability grants, and Role assignments.
// No census, principal or record is read or committed.
// Pure: no database, no network. Prerequisite: `npm run build`. The metadata half (and the baseline Role holders) is
// proved on a rebuilt database by removalMatrixMetadataPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  ADMIN_ROLE_KEY,
  CAPABILITY_METADATA,
  PIN_PATH,
  REMOVAL_SPECS,
  computeMatrix,
  loadRecordedDeltas,
  renderMatrix,
  specKeys,
} from "./support/removalMatrix.mjs";

const require = createRequire(import.meta.url);
const baseline = require("../lib/adminPolicy/roleCapabilityAuthorityBaseline.js");
const pa = require("../lib/adminPolicy/protectedAdministrator.js");

/** sha256 of test/fixtures/removalMatrix.pinned.json (origin/main a360020d). Move ONLY with a deliberate re-pin. */
export const REMOVAL_MATRIX_PIN_DIGEST = "99719d0b1976d88169fa70a64711cabe2dd0059ad7058e5a603cfb1a46d4515a";

const onDisk = readFileSync(PIN_PATH, "utf8");
const real = { baseline, pa, deltas: loadRecordedDeltas() };

test("the pin file is the pinned one (no silent regeneration)", () => {
  assert.equal(createHash("sha256").update(onDisk).digest("hex"), REMOVAL_MATRIX_PIN_DIGEST,
    "the committed removal-matrix pin changed: a deliberate change must move REMOVAL_MATRIX_PIN_DIGEST in the same reviewed diff");
});

test("the repository's authority reproduces the pin byte-for-byte", () => {
  const rendered = renderMatrix(computeMatrix(real));
  if (rendered !== onDisk) {
    const a = rendered.split("\n");
    const b = onDisk.split("\n");
    const i = a.findIndex((line, n) => line !== b[n]);
    assert.fail(`who holds a removal-spec key moved (first differing line ${i + 1}):\n  now:    ${a[i]?.slice(0, 600)}\n  pinned: ${b[i]?.slice(0, 600)}\n`
      + "If intended: node test/support/removalMatrix.mjs --write, move REMOVAL_MATRIX_PIN_DIGEST, and cite the ruling.");
  }
});

test("every recorded delta module is read: the compiled modules are exactly src/adminPolicy/*Delta.ts", () => {
  const src = readdirSync("src/adminPolicy").filter((f) => /Delta\.ts$/.test(f)).map((f) => f.replace(/\.ts$/, "")).sort();
  const read = [...new Set(real.deltas.map((d) => d.source.split(".")[0]))].sort();
  assert.deepEqual(read, src, "a delta module with no exported *Operations(), or a stale lib/ file");
  assert.ok(real.deltas.every((d) => d.operations.length > 0), "every *Operations() returns operations");
});

test("every spec key is accounted for: existing keys have metadata, proposed keys do not, ids are unique", () => {
  const { existing, proposed } = specKeys();
  assert.deepEqual(Object.keys(CAPABILITY_METADATA).sort(), existing, "CAPABILITY_METADATA names exactly the existing spec keys");
  for (const k of proposed) assert.equal(k in CAPABILITY_METADATA, false, `${k} is proposed, so it has no registered metadata`);
  assert.equal(new Set(REMOVAL_SPECS.map((s) => s.id)).size, REMOVAL_SPECS.length);
  const allowed = new Set(["id", "title", "before", "after", "proposedKeys", "condBefore"]);
  for (const s of REMOVAL_SPECS) {
    for (const f of Object.keys(s)) assert.ok(allowed.has(f), `${s.id}: field ${f} is not modelled by the gate`);
    for (const req of [s.before, s.after]) {
      assert.ok(Array.isArray(req) && req.length > 0 && req.every((all) => Array.isArray(all) && all.length > 0), `${s.id} requirement shape`);
    }
  }
});

test("condBefore is honoured: LOC-A2 counts the technician's RECORD_ASSIGNMENT-conditioned read before, not after", () => {
  const pin = JSON.parse(onDisk);
  assert.deepEqual(pin.keys["workOrder.record.read"].conditionedRoles, { technician: ["RECORD_ASSIGNMENT"] });
  assert.equal(pin.keys["workOrder.record.read"].heldRoles.includes("technician"), false, "a conditioned grant is not a flat holding");
  const loc = pin.specs.find((s) => s.id === "LOC-A2");
  assert.equal(loc.beforeCountsConditionedGrants, true);
  assert.ok(loc.beforeRoles.includes("technician") && loc.loseRoles.includes("technician"));
  // Without condBefore the same spec would not count the technician at all.
  const flat = computeMatrix(real, REMOVAL_SPECS.map((s) => (s.id === "LOC-A2" ? { ...s, condBefore: undefined } : s)));
  assert.equal(flat.specs.find((s) => s.id === "LOC-A2").beforeRoles.includes("technician"), false);
});

test("the pin contains no operational identity: Role keys and capability keys only", () => {
  const pin = JSON.parse(onDisk);
  const roleSet = new Set([ADMIN_ROLE_KEY, ...baseline.AUTHORITY_BASELINE_GRANTS.map((g) => g.roleKey),
    ...real.deltas.flatMap((d) => d.operations.map((o) => o.input?.roleKey ?? o.input?.key)).filter(Boolean)]);
  for (const [key, row] of Object.entries(pin.keys)) {
    for (const r of [...row.baselineRoles, ...row.baselineNonprodActivationRoles, ...row.recordedDeltaGrantRoles,
      ...row.recordedDeltaRevokeRoles, ...Object.keys(row.conditionedRoles), ...row.heldRoles]) assert.ok(roleSet.has(r), `${key}: ${r} is a Role key`);
  }
  for (const s of pin.specs) for (const r of [...s.beforeRoles, ...s.afterRoles]) assert.ok(roleSet.has(r));
  assert.equal(/principal|tenant-|@/i.test(JSON.stringify({ keys: pin.keys, specs: pin.specs })), false);
});

// ── the gate actually trips (falsifiability): perturb ONE source and the bytes differ from the COMMITTED pin ──

function withBaseline(mutate) {
  const global = [...baseline.globalAuthorityGrants()];
  const activation = [...baseline.NONPROD_ACTIVATED_CAPABILITY_GRANTS];
  mutate(global, activation);
  return { ...real, baseline: { globalAuthorityGrants: () => global, NONPROD_ACTIVATED_CAPABILITY_GRANTS: activation } };
}
const withDelta = (operation, input) => ({ ...real, deltas: [...real.deltas, { source: "testDelta.testOperations", operations: [{ operation, input }] }] });
const trips = (lib) => assert.notEqual(renderMatrix(computeMatrix(lib)), onDisk);

test("TRIPS: a Role gaining a spec key (a new grant-bearing migration) changes the pin", () => {
  trips(withBaseline((g) => g.push({ roleKey: "salesperson", capabilityKey: "employee.record.read" })));
});

test("TRIPS: a Role losing a spec key changes the pin", () => {
  trips(withBaseline((g) => {
    const i = g.findIndex((p) => p.roleKey === "owner" && p.capabilityKey === "customer.record.read");
    assert.ok(i >= 0, "fixture premise: owner holds customer.record.read");
    g.splice(i, 1);
  }));
});

test("TRIPS: excluding a key from protected Administrator standing (a code-deploy removal for admin) changes the pin", () => {
  trips({ ...real, pa: { isImpliedForProtectedAdministrator: (c) => c.key !== "employee.record.read" && pa.isImpliedForProtectedAdministrator(c) } });
});

test("TRIPS: a recorded baseline nonprod activation moving changes the pin", () => {
  trips(withBaseline((_, a) => a.push({ roleKey: "officeManager", capabilityKey: "workOrder.lifecycle.dispatch" })));
});

test("TRIPS: a recorded delta module granting, revoking or conditioning a spec key changes the pin", () => {
  trips(withDelta("grantObjectActionToRole", { roleKey: "salesperson", objectKey: "supplier", actionKey: "read" }));
  trips(withDelta("revokeObjectActionFromRole", { roleKey: "owner", objectKey: "employee", actionKey: "read" }));
  trips(withDelta("setGrantCondition", { roleKey: "dispatcher", objectKey: "workOrder", actionKey: "read", condition: { paths: [[{ kind: "RECORD_ASSIGNMENT" }]] } }));
  trips({ ...real, deltas: real.deltas.filter((d) => !d.source.startsWith("partsPurchasingReceivingDelta.")) });
});

test("NEUTRAL: a grant of a key NO spec names does not move the pin (baseline or delta)", () => {
  assert.equal(renderMatrix(computeMatrix(withBaseline((g) => g.push({ roleKey: "salesperson", capabilityKey: "some.unrelated.key" })))), onDisk);
  assert.equal(renderMatrix(computeMatrix({ ...real, deltas: [...real.deltas.map((d) => ({ ...d }))] })), onDisk);
});

test("fail closed: an unmodelled delta operation, a grant+revoke conflict, or a key with no metadata is refused", () => {
  assert.throws(() => computeMatrix(withDelta("grantCapabilityToPrincipal", { roleKey: "x", objectKey: "supplier", actionKey: "read" })), /does not model/);
  assert.throws(() => computeMatrix({ ...real, deltas: [{ source: "t.tOperations", operations: [
    { operation: "grantObjectActionToRole", input: { roleKey: "salesperson", objectKey: "supplier", actionKey: "read" } },
    { operation: "revokeObjectActionFromRole", input: { roleKey: "salesperson", objectKey: "supplier", actionKey: "read" } }] }] }), /both grants and revokes/);
  const specs = [{ id: "X", title: "x", before: [["unknown.key.read"]], after: [["unknown.key.read"]] }];
  assert.throws(() => computeMatrix(real, specs), /no CAPABILITY_METADATA for unknown\.key\.read/);
});
