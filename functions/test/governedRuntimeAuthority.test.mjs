// Governed runtime authority -- the parts provable with no database (Pass 11 Fix Wave 1).
// The PostgreSQL-backed persona proofs are governedRuntimeAuthorityPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const {
  GOVERNED_RUNTIME_AUTHORITY_PROJECTS,
  isGovernedRuntimeAuthorityActive,
} = require("../lib/access/governedRuntimeAuthority.js");
const { governedDomainPrerequisite } = require("../lib/access/effectiveAccessFeed.js");

test("activation is declared per environment and production is refused unconditionally", () => {
  assert.equal(isGovernedRuntimeAuthorityActive("eos-platform-sandbox"), true);
  assert.equal(isGovernedRuntimeAuthorityActive("taylor-parts"), false, "production");
  assert.equal(isGovernedRuntimeAuthorityActive("eos-platform-certification"), false, "certification is frozen (#179)");
  assert.equal(isGovernedRuntimeAuthorityActive("some-unknown-project"), false);
  assert.equal(isGovernedRuntimeAuthorityActive(""), false);
  assert.equal(isGovernedRuntimeAuthorityActive(null), false);
});

test("the code list equals config/environments.json's governedRuntimeAuthority declarations (drift guard)", () => {
  const { environments } = JSON.parse(readFileSync(join(ROOT, "config", "environments.json"), "utf8"));
  const declared = environments.filter((e) => e.governedRuntimeAuthority === true).map((e) => e.firebase?.projectId).sort();
  assert.deepEqual([...GOVERNED_RUNTIME_AUTHORITY_PROJECTS].sort(), declared);
  for (const e of environments) {
    if (e.role === "production") assert.notEqual(e.governedRuntimeAuthority, true, `${e.id} must never declare it`);
  }
});

test("the legacy catalog is a prerequisite only: it can hold a governed key back, never grant one", () => {
  assert.equal(governedDomainPrerequisite("workOrder.record.read", new Set()), true, "a PG-only key has no legacy prerequisite");
  assert.equal(governedDomainPrerequisite("customer.record.read", new Set()), true);
});

// ── the test-harness seam the Firestore-emulator suites use (test/support/governedFixtureAccess.mjs) ──
test("HARNESS: fixture Security Roles answer the governed question through the pinned baseline, never Firestore roles", async () => {
  const { fakeFirestore } = await import("./support/governedRuntimeHarness.mjs");
  const { installGovernedFixtureAccess, GOVERNED_CATALOG_KEYS } = await import("./support/governedFixtureAccess.mjs");
  const { resolveEffectiveAccess } = require("../lib/access/effectiveAccessFeed.js");
  const { __resetRuntimeCapabilityOverridesCacheForTest } = require("../lib/access/environmentCapabilityOverrides.js");
  assert.equal(GOVERNED_CATALOG_KEYS.size, 82, "the governed catalog the harness answers for is the measured 82");
  const db = fakeFirestore({
    users: { "uid-t": {}, "uid-s": {}, "uid-g": {} },
    roleAssignments: {
      a: { principalUid: "uid-t", roleId: "technician", status: "active" },
      b: { principalUid: "uid-s", roleId: "salesperson", status: "active" },
      c: { principalUid: "uid-g", roleId: "generalEmployee", status: "active" },
      d: { principalUid: "uid-s", roleId: "admin", status: "disabled" },
    },
  });
  const saved = { p: process.env.GCLOUD_PROJECT, d: process.env.DATABASE_URL };
  process.env.GCLOUD_PROJECT = "eos-platform-sandbox";
  delete process.env.DATABASE_URL;
  __resetRuntimeCapabilityOverridesCacheForTest();
  const uninstall = installGovernedFixtureAccess(db);
  try {
    const ask = async (uid, ids) => (await resolveEffectiveAccess({ principalUid: uid, permissionIds: ids }, { db })).decisions;
    assert.deepEqual(await ask("uid-t", ["workOrder.record.read", "workOrder.lifecycle.complete", "customer.record.read"]),
      { "workOrder.record.read": true, "workOrder.lifecycle.complete": true, "customer.record.read": false });
    assert.deepEqual(await ask("uid-s", ["opportunity.read", "salesOrder.read", "admin.securityPolicy.write"]),
      { "opportunity.read": true, "salesOrder.read": true, "admin.securityPolicy.write": false }, "a disabled assignment grants nothing");
    assert.deepEqual(await ask("uid-g", ["customer.record.read", "workOrder.record.read"]),
      { "customer.record.read": false, "workOrder.record.read": false });
    uninstall();
    // Uninstalled, with no DATABASE_URL: the real resolver cannot compose -> UNAVAILABLE -> every id denied.
    assert.deepEqual(await ask("uid-s", ["opportunity.read"]), { "opportunity.read": false });
  } finally {
    uninstall();
    if (saved.p === undefined) delete process.env.GCLOUD_PROJECT; else process.env.GCLOUD_PROJECT = saved.p;
    if (saved.d !== undefined) process.env.DATABASE_URL = saved.d;
    __resetRuntimeCapabilityOverridesCacheForTest();
  }
});
