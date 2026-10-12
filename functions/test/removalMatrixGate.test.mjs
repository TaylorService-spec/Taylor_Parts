// THE REMOVAL-MATRIX REGRESSION GATE (field permissions PR 1 -- tests only, zero runtime change).
//
// For every key a proposed field-permission REMOVAL names (arch/removal-matrix.md, ported as REMOVAL_SPECS), this pins
// which Roles hold it -- from the REPOSITORY's authority (roleCapabilityAuthorityBaseline.json: global + recorded nonprod
// activation) plus the protected Administrator's standing (protectedAdministrator.ts) -- and, per spec, the Roles that
// meet `before`, meet `after`, and would lose. A PR that moves any of it (a grant-bearing migration + its baseline row, a
// Role-catalog declaration, a PA exclusion or management key) FAILS here until the pin is regenerated and its digest
// moved, deliberately, in the same reviewed diff. No census, principal or record is read or committed.
// Pure: no database, no network. Prerequisite: `npm run build`. The metadata half is proved by
// removalMatrixMetadataPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  ADMIN_ROLE_KEY,
  CAPABILITY_METADATA,
  PIN_PATH,
  REMOVAL_SPECS,
  computeMatrix,
  renderMatrix,
  specKeys,
} from "./support/removalMatrix.mjs";

const require = createRequire(import.meta.url);
const baseline = require("../lib/adminPolicy/roleCapabilityAuthorityBaseline.js");
const pa = require("../lib/adminPolicy/protectedAdministrator.js");

/** sha256 of test/fixtures/removalMatrix.pinned.json at origin/main a360020d. Move ONLY with a deliberate re-pin. */
export const REMOVAL_MATRIX_PIN_DIGEST = "c260b3004e6e58969ca5930368a0bc7e72c2782f80b754d623adac04bf60ed58";

const onDisk = readFileSync(PIN_PATH, "utf8");

test("the pin file is the pinned one (no silent regeneration)", () => {
  assert.equal(createHash("sha256").update(onDisk).digest("hex"), REMOVAL_MATRIX_PIN_DIGEST,
    "the committed removal-matrix pin changed: a deliberate change must move REMOVAL_MATRIX_PIN_DIGEST in the same reviewed diff");
});

test("the repository's authority reproduces the pin byte-for-byte", () => {
  const rendered = renderMatrix(computeMatrix());
  if (rendered !== onDisk) {
    const a = rendered.split("\n");
    const b = onDisk.split("\n");
    const i = a.findIndex((line, n) => line !== b[n]);
    assert.fail(`who holds a removal-spec key moved (first differing line ${i + 1}):\n  now:    ${a[i]?.slice(0, 600)}\n  pinned: ${b[i]?.slice(0, 600)}\n`
      + "If intended: node test/support/removalMatrix.mjs --write, move REMOVAL_MATRIX_PIN_DIGEST, and cite the ruling.");
  }
});

test("every spec key is accounted for: existing keys have metadata, proposed keys do not, ids are unique", () => {
  const { existing, proposed } = specKeys();
  assert.deepEqual(Object.keys(CAPABILITY_METADATA).sort(), existing, "CAPABILITY_METADATA names exactly the existing spec keys");
  for (const k of proposed) assert.equal(k in CAPABILITY_METADATA, false, `${k} is proposed, so it has no registered metadata`);
  assert.equal(new Set(REMOVAL_SPECS.map((s) => s.id)).size, REMOVAL_SPECS.length);
  for (const s of REMOVAL_SPECS) for (const req of [s.before, s.after]) {
    assert.ok(Array.isArray(req) && req.length > 0 && req.every((all) => Array.isArray(all) && all.length > 0), `${s.id} requirement shape`);
  }
});

test("the pin contains no operational identity: Role keys and capability keys only", () => {
  const pin = JSON.parse(onDisk);
  const roleSet = new Set([ADMIN_ROLE_KEY, ...baseline.AUTHORITY_BASELINE_GRANTS.map((g) => g.roleKey)]);
  for (const [key, row] of Object.entries(pin.keys)) {
    for (const r of [...row.globalRoles, ...row.nonprodActivationRoles]) assert.ok(roleSet.has(r), `${key}: ${r} is a baseline Role key`);
  }
  for (const s of pin.specs) for (const r of [...s.beforeRoles, ...s.afterRoles]) assert.ok(roleSet.has(r));
  assert.equal(/principal|tenant-|uid|@/i.test(JSON.stringify({ keys: pin.keys, specs: pin.specs })), false);
});

// ── the gate actually trips (falsifiability): feed computeMatrix a perturbed authority and watch the bytes move ──

const real = { baseline, pa };
const pinnedBytes = renderMatrix(computeMatrix(real));

function withBaseline(mutate) {
  const global = [...baseline.globalAuthorityGrants()];
  const activation = [...baseline.NONPROD_ACTIVATED_CAPABILITY_GRANTS];
  mutate(global, activation);
  return { ...real, baseline: { globalAuthorityGrants: () => global, NONPROD_ACTIVATED_CAPABILITY_GRANTS: activation } };
}

test("TRIPS: a Role gaining a spec key (a new grant-bearing migration) changes the pin", () => {
  const lib = withBaseline((g) => g.push({ roleKey: "salesperson", capabilityKey: "employee.record.read" }));
  assert.notEqual(renderMatrix(computeMatrix(lib)), pinnedBytes);
});

test("TRIPS: a Role losing a spec key changes the pin", () => {
  const lib = withBaseline((g) => {
    const i = g.findIndex((p) => p.roleKey === "owner" && p.capabilityKey === "customer.record.read");
    assert.ok(i >= 0, "fixture premise: owner holds customer.record.read");
    g.splice(i, 1);
  });
  assert.notEqual(renderMatrix(computeMatrix(lib)), pinnedBytes);
});

test("TRIPS: excluding a key from protected Administrator standing (a code-deploy removal for admin) changes the pin", () => {
  const lib = { ...real, pa: { isImpliedForProtectedAdministrator: (c) => c.key !== "employee.record.read" && pa.isImpliedForProtectedAdministrator(c) } };
  assert.notEqual(renderMatrix(computeMatrix(lib)), pinnedBytes);
});

test("TRIPS: a recorded nonprod activation moving changes the pin", () => {
  const lib = withBaseline((_, a) => a.push({ roleKey: "dispatcher", capabilityKey: "workOrder.lifecycle.schedule" }));
  assert.notEqual(renderMatrix(computeMatrix(lib)), pinnedBytes);
});

test("NEUTRAL: a grant of a key NO spec names does not move the pin", () => {
  const lib = withBaseline((g) => g.push({ roleKey: "salesperson", capabilityKey: "some.unrelated.key" }));
  assert.equal(renderMatrix(computeMatrix(lib)), pinnedBytes);
});

test("a key with no metadata is refused, never silently treated as unheld", () => {
  const specs = [{ id: "X", title: "x", before: [["unknown.key.read"]], after: [["unknown.key.read"]] }];
  assert.throws(() => computeMatrix(real, specs), /no CAPABILITY_METADATA for unknown\.key\.read/);
});
