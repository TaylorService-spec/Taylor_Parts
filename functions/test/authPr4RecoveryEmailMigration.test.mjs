// AUTH-PR-4 -- tests for the governed recovery-email migration operator workflow
// (functions/scripts/authPr4RecoveryEmailMigration.js).
//
// TWO LAYERS:
//   1. PURE-HELPER tests -- always run, no emulator, no SDK writes. They prove
//      the guards (project, execution-authorization, ordered-persona), the exact
//      forward/rollback plans (forward always emailVerified=false; rollback
//      restores the captured boolean), and evidence sanitization (no real
//      address/UID leaks).
//   2. AUTH-EMULATOR integration tests -- run only when FIREBASE_AUTH_EMULATOR_HOST
//      is set (i.e. under `firebase emulators:exec --only auth`). They exercise a
//      real forward EXECUTE against a NON-PRODUCTION (demo-*) project, exact
//      rollback (verified prior state restored), and fail-closed halts for
//      disabled accounts and alias collisions.
//
// NON-PRODUCTION ONLY. Sanitized: real emails are never printed.
//
// Run (pure only):
//   node test/authPr4RecoveryEmailMigration.test.mjs
// Run (pure + emulator):
//   firebase emulators:exec --only auth --project demo-authpr4 \
//     "node functions/test/authPr4RecoveryEmailMigration.test.mjs"

import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const wf = require("../scripts/authPr4RecoveryEmailMigration.js");

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log("PASS -- " + name);
}
async function okAsync(name, fn) {
  await fn();
  passed += 1;
  console.log("PASS -- " + name);
}
function throws(fn, re, msg) {
  assert.throws(fn, re, msg);
}

// ----------------------------------------------------------------------------
// 1. PURE-HELPER TESTS
// ----------------------------------------------------------------------------

ok("assertProjectTarget requires --projectId", () => {
  throws(() => wf.assertProjectTarget({}), /--projectId is required/);
});

ok("assertProjectTarget blocks production without matching --confirmProduction", () => {
  throws(
    () => wf.assertProjectTarget({ projectId: "taylor-parts" }),
    /requires an explicit, matching --confirmProduction/,
  );
});

ok("assertProjectTarget allows production with matching confirmation, and any non-prod id", () => {
  assert.equal(
    wf.assertProjectTarget({ projectId: "taylor-parts", confirmProduction: "taylor-parts" }),
    "taylor-parts",
  );
  assert.equal(wf.assertProjectTarget({ projectId: "demo-authpr4" }), "demo-authpr4");
});

ok("assertExecutionAuthorization BLOCKS execute/rollback against production", () => {
  throws(
    () => wf.assertExecutionAuthorization({ execute: true, projectId: "taylor-parts" }),
    /Refusing to write against the production project/,
  );
  throws(
    () => wf.assertExecutionAuthorization({ rollback: true, projectId: "taylor-parts" }),
    /Refusing to write against the production project/,
  );
});

ok("assertExecutionAuthorization allows dry-run against production and execute against non-prod", () => {
  assert.equal(wf.assertExecutionAuthorization({ projectId: "taylor-parts" }), "dry-run");
  assert.equal(wf.assertExecutionAuthorization({ execute: true, projectId: "demo-authpr4" }), "write");
});

ok("assertPersonaOrder rejects excluded personas (sales-manager, break-glass)", () => {
  throws(
    () => wf.assertPersonaOrder({ employeeId: "emp-rudy-sales-manager", position: 1 }),
    /explicitly EXCLUDED/,
  );
  throws(() => wf.assertPersonaOrder({ employeeId: "break-glass-admin", position: 1 }), /EXCLUDED/);
});

ok("assertPersonaOrder rejects unknown personas and wrong positions", () => {
  throws(() => wf.assertPersonaOrder({ employeeId: "emp-someone-else", position: 1 }), /not in the ordered persona allowlist/);
  throws(
    () => wf.assertPersonaOrder({ employeeId: "emp-rudy-driver", position: 2 }),
    /Order violation/,
  );
});

ok("assertPersonaOrder accepts each lower-risk persona at its exact position", () => {
  assert.equal(wf.assertPersonaOrder({ employeeId: "emp-rudy-driver", position: 1 }), 1);
  assert.equal(wf.assertPersonaOrder({ employeeId: "emp-rudy-parts-associate", position: 2 }), 2);
  assert.equal(wf.assertPersonaOrder({ employeeId: "emp-rudy-warehouse-manager", position: 3 }), 3);
  assert.equal(wf.assertPersonaOrder({ employeeId: "emp-rudy-parts-manager", position: 4 }), 4);
});

ok("assertPersonaOrder gates the PRIMARY ADMIN (last) on break-glass + lower-risk completion", () => {
  throws(
    () => wf.assertPersonaOrder({ employeeId: "emp-rudy-owner", position: 5 }),
    /requires --breakGlassVerified/,
  );
  throws(
    () => wf.assertPersonaOrder({ employeeId: "emp-rudy-owner", position: 5, breakGlassVerified: true }),
    /requires --confirmLowerRiskComplete/,
  );
  assert.equal(
    wf.assertPersonaOrder({
      employeeId: "emp-rudy-owner",
      position: 5,
      breakGlassVerified: true,
      confirmLowerRiskComplete: true,
    }),
    5,
  );
});

ok("buildForwardPlan ALWAYS sets emailVerified=false, even when prior was verified", () => {
  const plan = wf.buildForwardPlan({
    employeeId: "emp-rudy-driver",
    uid: "u1",
    priorAddress: "old@example.com",
    priorEmailVerified: true, // prior TRUE must not be carried to the new alias
    newAlias: "base+driver@gmail.com",
  });
  assert.equal(plan.update.email, "base+driver@gmail.com");
  assert.equal(plan.update.emailVerified, false);
  assert.equal(plan.captured.priorEmailVerified, true);
});

ok("buildRollbackPlan restores the EXACT captured prior address + prior boolean", () => {
  const plan = wf.buildRollbackPlan({
    employeeId: "emp-rudy-driver",
    uid: "u1",
    priorAddress: "old@example.com",
    priorEmailVerified: true,
  });
  assert.equal(plan.update.email, "old@example.com");
  assert.equal(plan.update.emailVerified, true); // exact reversal, NOT coerced false
});

ok("buildRollbackPlan halts when captured prior state is missing/invalid", () => {
  throws(() => wf.buildRollbackPlan({ employeeId: "x", uid: "u1", priorEmailVerified: true }), /exact prior address/);
  throws(
    () => wf.buildRollbackPlan({ employeeId: "x", uid: "u1", priorAddress: "old@example.com" }),
    /exact prior emailVerified boolean/,
  );
});

ok("addressRef never returns the raw address", () => {
  const ref = wf.addressRef("base+driver@gmail.com");
  assert.ok(!ref.includes("@"));
  assert.ok(!ref.includes("base"));
  assert.equal(wf.addressRef(""), "(none)");
});

ok("sanitizeEvidence emits booleans/patterns only -- no real address, UID, or address-linked boolean", () => {
  const ev = wf.sanitizeEvidence({
    employeeId: "emp-rudy-driver",
    position: 1,
    mode: "execute",
    projectClass: "non-production",
    newAliasRef: wf.addressRef("base+driver@gmail.com"),
    priorAddressRef: wf.addressRef("old@example.com"),
    checks: { uidUnchanged: true, newAliasEmailVerifiedFalse: true, priorAddressUnclaimed: true, accountEnabled: true },
    outcome: "applied",
  });
  const blob = JSON.stringify(ev);
  assert.ok(!blob.includes("@"), "no raw email address in evidence");
  assert.ok(!/\buid\b\s*[:=]\s*"[^"]/.test(blob), "no raw uid value in evidence");
  assert.equal(ev.aliasPattern, "<owner-inbox>+<persona-tag>");
  assert.equal(ev.operatorRevocationPerformed, false);
  assert.equal(ev.resetOrVerificationEmailSent, false);
  assert.equal(ev.checks.newAliasEmailVerifiedFalse, true);
});

ok("loadMappingEntry reads a protected out-of-band mapping and rejects missing entries", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authpr4-test-"));
  const file = path.join(dir, "mapping.json");
  fs.writeFileSync(file, JSON.stringify({ "emp-rudy-driver": { uid: "u1", newAlias: "base+driver@gmail.com" } }));
  const entry = wf.loadMappingEntry(file, "emp-rudy-driver");
  assert.equal(entry.uid, "u1");
  assert.equal(entry.newAlias, "base+driver@gmail.com");
  throws(() => wf.loadMappingEntry(file, "emp-rudy-owner"), /no \{ uid, newAlias \} entry/);
  fs.rmSync(dir, { recursive: true, force: true });
});

ok("writeCapturedState writes an owner-only temp file and secureUnlink removes it", () => {
  const file = wf.writeCapturedState("emp-rudy-driver", {
    uid: "u1",
    priorAddress: "old@example.com",
    priorEmailVerified: true,
  });
  assert.ok(fs.existsSync(file));
  const mode = fs.statSync(file).mode & 0o777;
  // 0o600 on POSIX; Windows reports differently, so only assert group/other are not readable on POSIX.
  if (process.platform !== "win32") assert.equal(mode, 0o600);
  wf.secureUnlink(file);
  assert.ok(!fs.existsSync(file));
});

// ----------------------------------------------------------------------------
// 2. AUTH-EMULATOR INTEGRATION TESTS (non-production only)
// ----------------------------------------------------------------------------

const EMU_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!EMU_HOST) {
  console.log("\nSKIP -- Auth-emulator integration tests (FIREBASE_AUTH_EMULATOR_HOST not set).");
  console.log("       Run under: firebase emulators:exec --only auth --project demo-authpr4 \"node <this file>\"");
  console.log(`\n${passed} passed (pure-helper layer)`);
  process.exit(0);
}

const admin = require("firebase-admin");
const PROJECT = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "demo-authpr4";
assert.notEqual(PROJECT, wf.PRODUCTION_PROJECT_ID, "integration tests must NOT run against the production project");
admin.initializeApp({ projectId: PROJECT });
const auth = admin.auth();

const uniq = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

await okAsync("preflight captures exact prior verified state and passes for an enabled, non-colliding account", async () => {
  const priorAddress = `prior_${uniq()}@example.com`;
  const user = await auth.createUser({ email: priorAddress, emailVerified: true, password: "Passw0rd!23" });
  const newAlias = `base+driver_${uniq()}@gmail.com`;
  const pre = await wf.preflight(auth, { employeeId: "emp-rudy-driver", uid: user.uid, newAlias });
  assert.equal(pre.uid, user.uid);
  assert.equal(pre.priorAddress, priorAddress);
  assert.equal(pre.priorEmailVerified, true);
  assert.equal(pre.accountEnabled, true);
  assert.equal(pre.newAliasUnclaimed, true);
});

await okAsync("forward EXECUTE sets new alias with emailVerified=false and preserves the UID", async () => {
  const priorAddress = `prior_${uniq()}@example.com`;
  const user = await auth.createUser({ email: priorAddress, emailVerified: true, password: "Passw0rd!23" });
  const newAlias = `base+driver_${uniq()}@gmail.com`;
  const pre = await wf.preflight(auth, { employeeId: "emp-rudy-driver", uid: user.uid, newAlias });
  const plan = wf.buildForwardPlan({
    employeeId: "emp-rudy-driver",
    uid: pre.uid,
    priorAddress: pre.priorAddress,
    priorEmailVerified: pre.priorEmailVerified,
    newAlias,
  });
  const res = await wf.applyPlan(auth, plan, { execute: true });
  assert.equal(res.applied, true);
  assert.equal(res.readback.uid, user.uid); // UID preserved
  assert.equal(res.readback.email, newAlias);
  assert.equal(res.readback.emailVerified, false); // never carries prior true
});

await okAsync("exact ROLLBACK restores the exact prior address AND the prior emailVerified=true", async () => {
  const priorAddress = `prior_${uniq()}@example.com`;
  const user = await auth.createUser({ email: priorAddress, emailVerified: true, password: "Passw0rd!23" });
  const newAlias = `base+driver_${uniq()}@gmail.com`;
  const pre = await wf.preflight(auth, { employeeId: "emp-rudy-driver", uid: user.uid, newAlias });
  await wf.applyPlan(
    auth,
    wf.buildForwardPlan({ employeeId: "emp-rudy-driver", uid: pre.uid, priorAddress: pre.priorAddress, priorEmailVerified: pre.priorEmailVerified, newAlias }),
    { execute: true },
  );
  // Now roll back using the captured prior state.
  const rollback = wf.buildRollbackPlan({
    employeeId: "emp-rudy-driver",
    uid: pre.uid,
    priorAddress: pre.priorAddress,
    priorEmailVerified: pre.priorEmailVerified,
  });
  const res = await wf.applyPlan(auth, rollback, { execute: true });
  assert.equal(res.readback.uid, user.uid);
  assert.equal(res.readback.email, priorAddress); // exact prior address
  assert.equal(res.readback.emailVerified, true); // exact prior boolean, not coerced false
});

await okAsync("preflight HALTS (fail closed) for a DISABLED account", async () => {
  const priorAddress = `prior_${uniq()}@example.com`;
  const user = await auth.createUser({ email: priorAddress, password: "Passw0rd!23", disabled: true });
  const newAlias = `base+driver_${uniq()}@gmail.com`;
  await assert.rejects(
    () => wf.preflight(auth, { employeeId: "emp-rudy-driver", uid: user.uid, newAlias }),
    /DISABLED/,
  );
});

await okAsync("preflight HALTS (fail closed) on an alias COLLISION with a different account", async () => {
  const targetAddress = `prior_${uniq()}@example.com`;
  const target = await auth.createUser({ email: targetAddress, password: "Passw0rd!23" });
  const collidingAlias = `base+driver_${uniq()}@gmail.com`;
  await auth.createUser({ email: collidingAlias, password: "Passw0rd!23" }); // a DIFFERENT account holds the alias
  await assert.rejects(
    () => wf.preflight(auth, { employeeId: "emp-rudy-driver", uid: target.uid, newAlias: collidingAlias }),
    /collision/,
  );
});

await okAsync("dry-run performs NO write (account unchanged)", async () => {
  const priorAddress = `prior_${uniq()}@example.com`;
  const user = await auth.createUser({ email: priorAddress, emailVerified: true, password: "Passw0rd!23" });
  const newAlias = `base+driver_${uniq()}@gmail.com`;
  const pre = await wf.preflight(auth, { employeeId: "emp-rudy-driver", uid: user.uid, newAlias });
  const res = await wf.applyPlan(
    auth,
    wf.buildForwardPlan({ employeeId: "emp-rudy-driver", uid: pre.uid, priorAddress: pre.priorAddress, priorEmailVerified: pre.priorEmailVerified, newAlias }),
    { execute: false },
  );
  assert.equal(res.applied, false);
  const after = await auth.getUser(user.uid);
  assert.equal(after.email, priorAddress); // unchanged
  assert.equal(after.emailVerified, true); // unchanged
});

console.log(`\n${passed} passed (pure-helper + Auth-emulator layers)`);
process.exit(0);
