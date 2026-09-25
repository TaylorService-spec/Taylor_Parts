/**
 * THE TWO CREDENTIAL OPERATIONS the Owner authorized on 2026-09-25, and the vocabulary that keeps
 * them honest.
 *
 *   RESET_EXISTING_SANDBOX_PASSWORD  ten accounts that EXIST and already HAVE a password nobody knows
 *   CREATE_AUTH_ACCOUNT              one account that does not exist
 *   PRESERVE                         five that already work and are never touched
 *
 * THE NAMES ARE TESTED, not merely preferred. These ten were previously called "activate missing
 * passwords". Activation acts only where there is NO password; all fifteen existing accounts already
 * have one, so that path would have acted on ZERO of them while a plan claimed ten. The wrong name is
 * what let the wrong expectation survive, so a test asserts the right one cannot quietly come back.
 *
 * Hermetic: a fake Admin SDK and temp-file fixtures. NOTHING here touches a real account or the
 * operator's real credential files, and no test asserts on a credential VALUE.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const credentialFile = require("../scripts/sandboxCredentialFile.js");
const bootstrap = require("../scripts/sandboxPersonaBootstrap.js");
const { createFirebaseSandboxAuthDirectory } = require("../scripts/sampleCompany/sandboxAuthDirectory.js");
const { generateSandboxPassword } = require("../scripts/activateSandboxPersonas.js");
const REGISTRY = require("../../config/sandboxRoleIdentityRegistry.json");

/** Fictional throughout. Never a real credential. */
const OWNER_VALUE = "Sbx!fixture-owner-value-0001";
const OTHER_VALUE = "Sbx!fixture-other-value-0002";

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "bv-credfile-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeFixture(dir, name, table) {
  const p = join(dir, name);
  writeFileSync(p, `${JSON.stringify(table, null, 2)}\n`, { mode: 0o600 });
  return p;
}

// ======================================================================================
// THE OWNER CREDENTIAL MERGE -- atomic, idempotent, non-destructive
// ======================================================================================

test("merges the Owner credential from the retiring stub into the canonical file, verbatim", () => {
  withTempDir((dir) => {
    const stub = writeFixture(dir, "stub-credentials.local.json", { "eos-owner@sandbox.invalid": OWNER_VALUE });
    const canonical = writeFixture(dir, "sandbox-credentials.local.json", {
      "admin@sandbox.invalid": OTHER_VALUE,
      "dispatcher@sandbox.invalid": OTHER_VALUE,
    });

    const result = credentialFile.mergeOwnerCredentialFromStub({ stubPath: stub, canonicalPath: canonical });
    assert.deepEqual(result.merged, ["eos-owner@sandbox.invalid"]);
    assert.equal(result.wrote, true);
    assert.equal(result.entryCountBefore, 2);
    assert.equal(result.entryCountAfter, 3);

    // VERBATIM: the value that arrives is the value that was there. Compared here, in a test, against
    // a fixture -- never printed and never compared anywhere in the product code.
    const after = credentialFile.parseCredentialFile(readFileSync(canonical, "utf8"));
    assert.equal(after["eos-owner@sandbox.invalid"], OWNER_VALUE, "the Owner credential must be copied, not regenerated");
    // And nothing else moved.
    assert.equal(after["admin@sandbox.invalid"], OTHER_VALUE);
    assert.equal(after["dispatcher@sandbox.invalid"], OTHER_VALUE);
  });
});

test("the merge is IDEMPOTENT: a second run writes nothing and does not touch the file", () => {
  withTempDir((dir) => {
    const stub = writeFixture(dir, "stub-credentials.local.json", { "eos-owner@sandbox.invalid": OWNER_VALUE });
    const canonical = writeFixture(dir, "sandbox-credentials.local.json", { "admin@sandbox.invalid": OTHER_VALUE });

    const first = credentialFile.mergeOwnerCredentialFromStub({ stubPath: stub, canonicalPath: canonical });
    assert.equal(first.wrote, true);
    const mtimeAfterFirst = statSync(canonical).mtimeMs;
    const bytesAfterFirst = readFileSync(canonical, "utf8");

    const second = credentialFile.mergeOwnerCredentialFromStub({ stubPath: stub, canonicalPath: canonical });
    assert.equal(second.wrote, false, "a second merge must write nothing");
    assert.deepEqual(second.merged, []);
    assert.deepEqual(second.unchanged, ["eos-owner@sandbox.invalid"]);
    assert.equal(statSync(canonical).mtimeMs, mtimeAfterFirst, "an idempotent no-op must not touch the file");
    assert.equal(readFileSync(canonical, "utf8"), bytesAfterFirst);
  });
});

test("the merge REFUSES to overwrite an existing DIFFERENT value, and writes nothing at all", () => {
  withTempDir((dir) => {
    const stub = writeFixture(dir, "stub-credentials.local.json", { "eos-owner@sandbox.invalid": OWNER_VALUE });
    const canonical = writeFixture(dir, "sandbox-credentials.local.json", {
      "eos-owner@sandbox.invalid": OTHER_VALUE, // already holds something else
      "admin@sandbox.invalid": OTHER_VALUE,
    });
    const before = readFileSync(canonical, "utf8");

    assert.throws(
      () => credentialFile.mergeOwnerCredentialFromStub({ stubPath: stub, canonicalPath: canonical }),
      (err) => {
        assert.equal(err.code, "CREDENTIAL_CONFLICT");
        assert.match(err.message, /eos-owner@sandbox\.invalid/);
        // The refusal names the KEY and never the value.
        assert.ok(!err.message.includes(OWNER_VALUE) && !err.message.includes(OTHER_VALUE), "a refusal leaked a credential value");
        return true;
      },
    );
    assert.equal(readFileSync(canonical, "utf8"), before, "a refused merge must leave the file byte-identical");
  });
});

test("the merge is ATOMIC: a temp file is used and none survives", () => {
  withTempDir((dir) => {
    const stub = writeFixture(dir, "stub-credentials.local.json", { "eos-owner@sandbox.invalid": OWNER_VALUE });
    const canonical = writeFixture(dir, "sandbox-credentials.local.json", { "admin@sandbox.invalid": OTHER_VALUE });
    credentialFile.mergeOwnerCredentialFromStub({ stubPath: stub, canonicalPath: canonical });

    const leftovers = require("node:fs").readdirSync(dir).filter((f) => f.includes(".tmp"));
    assert.deepEqual(leftovers, [], "a temp file holding credentials was left behind");

    const src = readFileSync(require.resolve("../scripts/sandboxCredentialFile.js"), "utf8");
    const writer = src.slice(src.indexOf("function writeAtomically("), src.indexOf("function mergeCredentialEntries("));
    assert.match(writer, /renameSync\(/, "the write must finish with a rename");
    assert.match(writer, /fsyncSync\(/, "the temp file must be flushed before the rename");
    assert.match(writer, /0o600/, "a credential file must not be world-readable");
  });
});

test("the merge never invents a canonical file, and refuses a non-canonical filename", () => {
  withTempDir((dir) => {
    const stub = writeFixture(dir, "stub-credentials.local.json", { "eos-owner@sandbox.invalid": OWNER_VALUE });
    const absent = join(dir, "sandbox-credentials.local.json");
    assert.throws(
      () => credentialFile.mergeOwnerCredentialFromStub({ stubPath: stub, canonicalPath: absent }),
      (err) => err.code === "TARGET_MISSING",
    );
    assert.ok(!existsSync(absent), "a refused merge must not create the file");

    const wrongName = writeFixture(dir, "notes.json", {});
    assert.throws(
      () => credentialFile.mergeCredentialEntries({ targetPath: wrongName, entries: { "a@sandbox.invalid": OWNER_VALUE } }),
      (err) => err.code === "TARGET_NOT_CANONICAL",
      "a target outside the gitignore rule must be refused",
    );
  });
});

test("the merge moves ONLY the authorized keys, so a polluted stub cannot smuggle an entry in", () => {
  withTempDir((dir) => {
    const stub = writeFixture(dir, "stub-credentials.local.json", {
      "eos-owner@sandbox.invalid": OWNER_VALUE,
      "someone-else@sandbox.invalid": OTHER_VALUE,
    });
    const canonical = writeFixture(dir, "sandbox-credentials.local.json", { "admin@sandbox.invalid": OTHER_VALUE });

    const result = credentialFile.mergeOwnerCredentialFromStub({ stubPath: stub, canonicalPath: canonical });
    assert.deepEqual(result.merged, ["eos-owner@sandbox.invalid"]);
    const after = credentialFile.parseCredentialFile(readFileSync(canonical, "utf8"));
    assert.ok(!("someone-else@sandbox.invalid" in after), "an unauthorized key was merged");
  });
});

test("an unreadable or unparseable stub refuses without touching the canonical file", () => {
  withTempDir((dir) => {
    const canonical = writeFixture(dir, "sandbox-credentials.local.json", { "admin@sandbox.invalid": OTHER_VALUE });
    const before = readFileSync(canonical, "utf8");
    const bad = join(dir, "broken-credentials.local.json");
    writeFileSync(bad, "{ not json at all");
    assert.throws(
      () => credentialFile.mergeOwnerCredentialFromStub({ stubPath: bad, canonicalPath: canonical }),
      (err) => err.code === "STUB_UNREADABLE",
    );
    assert.equal(readFileSync(canonical, "utf8"), before);
  });
});

test("no merge report or error carries a credential value", () => {
  withTempDir((dir) => {
    const stub = writeFixture(dir, "stub-credentials.local.json", { "eos-owner@sandbox.invalid": OWNER_VALUE });
    const canonical = writeFixture(dir, "sandbox-credentials.local.json", { "admin@sandbox.invalid": OTHER_VALUE });
    const result = credentialFile.mergeOwnerCredentialFromStub({ stubPath: stub, canonicalPath: canonical });
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(OWNER_VALUE) && !serialized.includes(OTHER_VALUE), "the merge report carried a value");

    const described = credentialFile.describeCredentialFile(canonical);
    assert.ok(!JSON.stringify(described).includes(OWNER_VALUE), "the file description carried a value");
    assert.equal(described.entryCount, 2);
    assert.deepEqual(described.keyNames, ["admin@sandbox.invalid", "eos-owner@sandbox.invalid"]);
  });
});

test("NOTHING the merge path writes to stdout or stderr carries a credential value", () => {
  // The other merge tests inspect the RETURN value, which a `console.log` inside the merge would sail
  // straight past -- and that is exactly how a credential reaches a terminal, a CI log or a scrollback
  // buffer. So this runs the real merge in a CHILD PROCESS over fixtures and captures both streams.
  withTempDir((dir) => {
    const stub = writeFixture(dir, "stub-credentials.local.json", { "eos-owner@sandbox.invalid": OWNER_VALUE });
    const canonical = writeFixture(dir, "sandbox-credentials.local.json", { "admin@sandbox.invalid": OTHER_VALUE });
    const modulePath = require.resolve("../scripts/sandboxCredentialFile.js");

    const script = [
      `const m = require(${JSON.stringify(modulePath)});`,
      // Run it twice: the writing path AND the idempotent no-op path.
      `m.mergeOwnerCredentialFromStub({ stubPath: ${JSON.stringify(stub)}, canonicalPath: ${JSON.stringify(canonical)} });`,
      `m.mergeOwnerCredentialFromStub({ stubPath: ${JSON.stringify(stub)}, canonicalPath: ${JSON.stringify(canonical)} });`,
      `console.log(JSON.stringify(m.describeCredentialFile(${JSON.stringify(canonical)})));`,
      // And the refusal path, which must also stay silent about values.
      `try { m.mergeCredentialEntries({ targetPath: ${JSON.stringify(canonical)}, entries: { "admin@sandbox.invalid": ${JSON.stringify(OWNER_VALUE)} } }); }`,
      `catch (e) { console.error(e.message); }`,
    ].join("\n");

    // spawnSync, not execFileSync: the latter returns stdout ONLY, so a credential written to stderr
    // would slip past a test that believes it is checking both streams.
    const { spawnSync } = require("node:child_process");
    const run = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
    assert.equal(run.status, 0, `the child failed: ${run.stderr}`);
    const out = `${run.stdout}${run.stderr}`;

    assert.ok(!out.includes(OWNER_VALUE), "a credential value reached stdout/stderr from the merge path");
    assert.ok(!out.includes(OTHER_VALUE), "a credential value reached stdout/stderr from the merge path");
    assert.doesNotMatch(out, /Sbx![A-Za-z0-9_-]{8,}/, "a credential-shaped token reached stdout/stderr");
    // The run really did exercise the paths, so a silent no-op cannot make this pass.
    assert.match(out, /eos-owner@sandbox\.invalid/, "the described key names should appear");
    assert.match(out, /CREDENTIAL_CONFLICT/, "the refusal path should have run");
  });
});

// ======================================================================================
// RESET_EXISTING_SANDBOX_PASSWORD -- fenced, and UID-stable on both sides
// ======================================================================================

/** A fake Admin SDK with one existing sandbox account. Records every write. */
function fakeSdk({ users = [], mutateUidOnUpdate = false } = {}) {
  const calls = { updateUser: [], createUser: [] };
  let apps = [];
  const byEmail = new Map(users.map((u) => [u.email, { ...u }]));
  const byUid = new Map(users.map((u) => [u.uid, { ...u }]));
  const notFound = () => Object.assign(new Error("no user"), { code: "auth/user-not-found" });
  const auth = {
    async listUsers() {
      return { users: [...byEmail.values()] };
    },
    async getUserByEmail(email) {
      const u = byEmail.get(email);
      if (!u) throw notFound();
      return u;
    },
    async getUser(uid) {
      const u = byUid.get(uid);
      if (!u) throw notFound();
      return u;
    },
    async updateUser(uid, input) {
      calls.updateUser.push({ uid, fields: Object.keys(input).sort() });
      if (mutateUidOnUpdate) {
        // Simulates the catastrophe the assertions exist to catch.
        const u = byUid.get(uid);
        byUid.delete(uid);
        byUid.set("migrated-uid", { ...u, uid: "migrated-uid" });
        byEmail.set(u.email, { ...u, uid: "migrated-uid" });
      }
      return byUid.get(uid) ?? { uid };
    },
    async createUser(input) {
      calls.createUser.push(input);
      return { uid: `uid-${calls.createUser.length}`, email: input.email };
    },
  };
  return {
    calls,
    sdk: {
      getApps: () => apps,
      applicationDefault: () => ({ getAccessToken: async () => ({ access_token: "fixture", expires_in: 60 }) }),
      initializeApp: (options) => {
        const app = { options };
        apps = [app];
        return app;
      },
      getAuth: () => auth,
    },
  };
}

const SANDBOX = "eos-platform-sandbox";
const TARGET = { uid: "uid-target-0001", email: "bailey.fixture@sandbox.invalid", disabled: false };

test("a reset updates an EXISTING account and never creates one", async () => {
  const fake = fakeSdk({ users: [TARGET] });
  const dir = createFirebaseSandboxAuthDirectory(SANDBOX, { env: {}, sdk: fake.sdk });
  const result = await dir.resetExistingSandboxPassword({
    email: TARGET.email,
    expectedUid: TARGET.uid,
    password: generateSandboxPassword(),
  });
  assert.deepEqual(result, { uid: TARGET.uid, email: TARGET.email, reset: true, uidStable: true });
  assert.equal(fake.calls.createUser.length, 0, "a reset must never create an account");
  assert.equal(fake.calls.updateUser.length, 1);
  assert.equal(fake.calls.updateUser[0].uid, TARGET.uid);
  // It is a DIFFERENT call from activation: it updates an existing user's password.
  assert.ok(fake.calls.updateUser[0].fields.includes("password"));
});

test("a reset REFUSES when the uid does not match, and writes nothing", async () => {
  const fake = fakeSdk({ users: [TARGET] });
  const dir = createFirebaseSandboxAuthDirectory(SANDBOX, { env: {}, sdk: fake.sdk });
  await assert.rejects(
    () => dir.resetExistingSandboxPassword({ email: TARGET.email, expectedUid: "some-other-uid", password: generateSandboxPassword() }),
    (err) => err.code === "RESET_UID_MISMATCH",
  );
  assert.equal(fake.calls.updateUser.length, 0, "a refused reset must not write");
});

test("a reset REFUSES an absent account -- that is CREATE_AUTH_ACCOUNT, a different disposition", async () => {
  const fake = fakeSdk({ users: [] });
  const dir = createFirebaseSandboxAuthDirectory(SANDBOX, { env: {}, sdk: fake.sdk });
  await assert.rejects(
    () => dir.resetExistingSandboxPassword({ email: TARGET.email, expectedUid: TARGET.uid, password: generateSandboxPassword() }),
    (err) => err.code === "RESET_TARGET_NOT_FOUND",
  );
  assert.equal(fake.calls.createUser.length, 0);
  assert.equal(fake.calls.updateUser.length, 0);
});

test("a reset DETECTS an identity migration after the write", async () => {
  // Non-vacuous: the same fixture without the mutation succeeds, so this proves the AFTER check works
  // rather than that something else is broken.
  const clean = fakeSdk({ users: [TARGET] });
  const cleanDir = createFirebaseSandboxAuthDirectory(SANDBOX, { env: {}, sdk: clean.sdk });
  await cleanDir.resetExistingSandboxPassword({ email: TARGET.email, expectedUid: TARGET.uid, password: generateSandboxPassword() });

  const fake = fakeSdk({ users: [TARGET], mutateUidOnUpdate: true });
  const dir = createFirebaseSandboxAuthDirectory(SANDBOX, { env: {}, sdk: fake.sdk });
  await assert.rejects(
    () => dir.resetExistingSandboxPassword({ email: TARGET.email, expectedUid: TARGET.uid, password: generateSandboxPassword() }),
    (err) => err.code === "RESET_IDENTITY_MIGRATED",
  );
});

test("a reset refuses a non-sandbox address, an absent expected uid and a weak password", async () => {
  const fake = fakeSdk({ users: [TARGET] });
  const dir = createFirebaseSandboxAuthDirectory(SANDBOX, { env: {}, sdk: fake.sdk });
  await assert.rejects(
    () => dir.resetExistingSandboxPassword({ email: "someone@taylorservice.com", expectedUid: TARGET.uid, password: generateSandboxPassword() }),
    /EMAIL_REFUSED/,
  );
  await assert.rejects(
    () => dir.resetExistingSandboxPassword({ email: TARGET.email, expectedUid: "", password: generateSandboxPassword() }),
    (err) => err.code === "EXPECTED_UID_REQUIRED",
  );
  await assert.rejects(
    () => dir.resetExistingSandboxPassword({ email: TARGET.email, expectedUid: TARGET.uid, password: "short" }),
    (err) => err.code === "WEAK_PASSWORD_REFUSED",
  );
  assert.equal(fake.calls.updateUser.length, 0);
});

test("the reset lives behind the fence: production and certification are refused before any SDK load", () => {
  for (const [project, pattern] of [
    ["taylor-parts", /customer production project/],
    ["eos-platform-certification", /Certification world/],
  ]) {
    const fake = fakeSdk({ users: [TARGET] });
    assert.throws(() => createFirebaseSandboxAuthDirectory(project, { env: {}, sdk: fake.sdk }), pattern);
    assert.equal(fake.calls.updateUser.length, 0);
  }
});

test("no reset result or error carries the password, and the directory never returns one", async () => {
  const SENTINEL = "Sbx!aaaaRESETSENTINELbbbbcccc";
  const fake = fakeSdk({ users: [TARGET] });
  const dir = createFirebaseSandboxAuthDirectory(SANDBOX, { env: {}, sdk: fake.sdk });
  const result = await dir.resetExistingSandboxPassword({ email: TARGET.email, expectedUid: TARGET.uid, password: SENTINEL });
  assert.ok(!JSON.stringify(result).includes(SENTINEL), "the reset result carried the password");

  // The recorded call keeps FIELD NAMES only, so even the test double cannot leak it.
  assert.ok(!JSON.stringify(fake.calls.updateUser).includes(SENTINEL));

  // And a failing reset says nothing either.
  const other = fakeSdk({ users: [TARGET] });
  const otherDir = createFirebaseSandboxAuthDirectory(SANDBOX, { env: {}, sdk: other.sdk });
  await assert.rejects(
    () => otherDir.resetExistingSandboxPassword({ email: TARGET.email, expectedUid: "nope", password: SENTINEL }),
    (err) => {
      assert.ok(!err.message.includes(SENTINEL), "a refusal leaked the password");
      return true;
    },
  );
});

// ======================================================================================
// THE VOCABULARY
// ======================================================================================

test("the registry declares exactly 5 PRESERVE, 10 RESET_EXISTING_SANDBOX_PASSWORD, 1 CREATE_AUTH_ACCOUNT", () => {
  const byDisposition = {};
  for (const r of REGISTRY.roles) {
    assert.ok(
      Object.values(bootstrap.CREDENTIAL_DISPOSITIONS).includes(r.credentialDisposition),
      `${r.key} has an undeclared disposition '${r.credentialDisposition}'`,
    );
    (byDisposition[r.credentialDisposition] ??= []).push(r.key);
  }
  assert.deepEqual(byDisposition.PRESERVE.sort(), ["administrator", "dispatcher", "financeAccounting", "generalEmployee", "ownerExecutive"]);
  assert.equal(byDisposition.RESET_EXISTING_SANDBOX_PASSWORD.length, 10);
  assert.deepEqual(byDisposition.CREATE_AUTH_ACCOUNT, ["reportingAnalyst"]);

  const expected = REGISTRY.credentialDispositions.expectedFinalState;
  assert.deepEqual(expected, { preserved: 5, rotated: 10, created: 1, canonicalUsableLogins: 16, duplicates: 0 });
  assert.equal(expected.preserved + expected.rotated + expected.created, expected.canonicalUsableLogins);
});

test("every RESET role has an account and a recorded uid; the CREATE role has neither", () => {
  for (const r of REGISTRY.roles) {
    if (r.credentialDisposition === "RESET_EXISTING_SANDBOX_PASSWORD") {
      assert.equal(r.accountExists, true, `${r.key} is RESET, so its account must already exist`);
      assert.ok(r.uid, `${r.key} is RESET, so the expected uid must be recorded to guard the write`);
    }
    if (r.credentialDisposition === "CREATE_AUTH_ACCOUNT") {
      assert.equal(r.accountExists, false, `${r.key} is CREATE, so no account may exist`);
      assert.equal(r.uid, null);
    }
  }
});

test("the misleading ACTIVATION vocabulary cannot come back for the reset ten", () => {
  // The original expectation survived because the operation was named for something it does not do.
  const bootstrapSrc = readFileSync(require.resolve("../scripts/sandboxPersonaBootstrap.js"), "utf8");
  const code = bootstrapSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.ok(!/activateMissing/i.test(code), "the bootstrap must not route the reset ten through the activation path");
  // The disposition names are present and exported.
  assert.deepEqual(Object.keys(bootstrap.CREDENTIAL_DISPOSITIONS).sort(), [
    "CREATE_AUTH_ACCOUNT",
    "PRESERVE",
    "RESET_EXISTING_SANDBOX_PASSWORD",
  ]);
});

test("there is exactly ONE password generator, and the reset path does not add a second", () => {
  const activate = readFileSync(require.resolve("../scripts/activateSandboxPersonas.js"), "utf8");
  assert.match(activate, /function generateSandboxPassword\(\)/);
  // The generator is used, not duplicated: the password-constructing expression appears EXACTLY once
  // in the repository, inside generateSandboxPassword itself. Counting is the check that matters --
  // forbidding the expression outright would forbid the one legitimate definition.
  const occurrences = activate.match(/crypto\.randomBytes\(/g) ?? [];
  assert.equal(occurrences.length, 1, "the password-generating expression must appear exactly once");
  const generatorBody = activate.slice(activate.indexOf("function generateSandboxPassword()"), activate.indexOf("function assertNonProductionTarget("));
  assert.match(generatorBody, /crypto\.randomBytes\(/, "the single occurrence must be inside the shared generator");

  for (const mod of ["../scripts/sandboxPersonaBootstrap.js", "../scripts/sampleCompany/sandboxAuthDirectory.js", "../scripts/sandboxCredentialFile.js"]) {
    const src = readFileSync(require.resolve(mod), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.ok(!code.includes("randomBytes"), `${mod} must not generate a password`);
    assert.ok(!code.includes("node:crypto"), `${mod} must not import crypto`);
  }

  // The generated shape is a real secret, not a placeholder.
  const generated = generateSandboxPassword();
  assert.ok(generated.length >= 20, "a generated password must be long enough to be a secret");
  assert.notEqual(generated, generateSandboxPassword(), "two calls must not produce the same value");
});

test("a PRESERVE role missing from the canonical source is reported as a merge, never a reset", () => {
  // This is ownerExecutive's measured state today: its credential is in the retiring stub, not the
  // canonical file. The plan must say MERGE. Quietly upgrading it to a reset would rotate the one
  // credential the Owner ruled must never be rotated.
  const auth = Object.fromEntries(REGISTRY.roles.filter((r) => r.accountExists).map((r) => [r.authEmail, { uid: r.uid }]));
  const result = bootstrap.plan({ authAccountsByEmail: auth, credentialKeyNames: [] });
  const owner = result.rows.find((r) => r.key === "ownerExecutive");
  assert.equal(owner.credentialDisposition, "PRESERVE");
  assert.ok(owner.states.includes(bootstrap.ROLE_STATES.CREDENTIAL_MISSING));
  const step5 = owner.steps.find((s) => s.step === 5);
  assert.match(step5.detail, /MERGE/);
  assert.match(step5.detail, /never reset/);
  assert.ok(!/RESET_EXISTING_SANDBOX_PASSWORD/.test(step5.detail.replace(/disposition PRESERVE;/, "")));
});

test("the dry run's disposition counts are 5 / 10 / 1", () => {
  const auth = Object.fromEntries(REGISTRY.roles.filter((r) => r.accountExists).map((r) => [r.authEmail, { uid: r.uid }]));
  const result = bootstrap.plan({ authAccountsByEmail: auth, credentialKeyNames: [] });
  assert.equal(result.counts.preserve, 5);
  assert.equal(result.counts.resetExistingSandboxPassword, 10);
  assert.equal(result.counts.createAuthAccount, 1);
  assert.match(bootstrap.formatPlan(result), /RESET_EXISTING_SANDBOX_PASSWORD : 10/);
});
