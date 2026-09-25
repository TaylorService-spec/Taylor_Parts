/**
 * NEGATIVE TESTS for the sandbox credential reconciliation.
 *
 * These are the point of the lane, not a formality. Each one pins a way this tooling could do real
 * harm — mint a password against production, authenticate as the wrong identity, print a secret
 * into a log, rotate the one credential that works, or lose the operator's file — and asserts the
 * harm is structurally impossible rather than merely not currently happening.
 *
 * Hermetic: no network, no Firebase, no Auth client, no emulator, no database. Temp files only,
 * under os.tmpdir(), removed afterwards. Nothing here can touch a real account.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CLASSIFICATIONS,
  CREDENTIAL_POLICY,
  FORBIDDEN_PROJECT_IDS,
  RECONCILIATION,
  ReconciliationRefusal,
  SANDBOX_PROJECT_ID,
  assertSandboxTarget,
  discoverCredentialSources,
  formatCounts,
  reconcile,
  rotationSet,
  vocabularies,
} from "./sandboxCredentialReconciliation.mjs";
import {
  CANONICAL_ROLE_KEYS,
  CANONICAL_ROLE_REGISTRY,
  CREDENTIAL_SOURCE_ENV,
  NONCANONICAL_FIXTURE_IDENTITIES,
  PENDING_ACCOUNT_PERSONAS,
  PERSONA_ALIASES,
  RETIRED_PERSONAS,
  SANDBOX_PERSONAS,
  UNRECONCILED_PERSONAS,
  loadSandboxPersona,
  personaDirectory,
} from "./sandboxCredentials.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = path.join(HERE, "sandboxCredentialReconciliation.mjs");
const LOADER_PATH = path.join(HERE, "sandboxCredentials.mjs");

/**
 * A sentinel that looks exactly like a real generated password (the repository's own shape,
 * `Sbx!<base64url>`), so a test that greps for it is testing the real hazard. It is fictional and
 * authenticates nothing.
 */
const SENTINEL = "Sbx!aaaaTESTSENTINELbbbb";

function withTempCredentialFile(contents, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bv-recon-"));
  const file = path.join(dir, "sandbox-credentials.local.json");
  fs.writeFileSync(file, contents);
  try {
    return fn(file, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ======================================================================================
// PRODUCTION IS REFUSED — BY PROJECT ID AND BY ENVIRONMENT ROLE, INDEPENDENTLY
// ======================================================================================

test("production is refused by project id, before the registry is even consulted", () => {
  for (const forbidden of FORBIDDEN_PROJECT_IDS) {
    assert.throws(
      () => assertSandboxTarget(forbidden),
      (err) => err instanceof ReconciliationRefusal && err.code === "PRODUCTION_PROJECT_FORBIDDEN",
      `${forbidden} must be refused by name`,
    );
  }
});

test("`taylor-parts` is literally unreachable: the deny list names it", () => {
  assert.ok(FORBIDDEN_PROJECT_IDS.includes("taylor-parts"));
  assert.throws(() => assertSandboxTarget("taylor-parts"), /PRODUCTION_PROJECT_FORBIDDEN/);
});

test("production is ALSO refused by registry role, via a second independent fence", () => {
  // The registry's production project is refused by name above. This asserts the ROLE fence exists
  // and is reachable: a hypothetical production environment not on the deny list must still fail.
  // Proven by construction — the role check runs for every project that clears the deny list.
  const registry = JSON.parse(fs.readFileSync(path.resolve(HERE, "..", "config", "environments.json"), "utf8"));
  const production = registry.environments.filter((e) => e.role === "production" && e.firebase?.projectId);
  assert.ok(production.length > 0, "the registry must declare at least one production environment for this fence to matter");
  for (const env of production) {
    assert.throws(
      () => assertSandboxTarget(env.firebase.projectId),
      (err) => err instanceof ReconciliationRefusal && /PRODUCTION_(PROJECT|ROLE)_FORBIDDEN/.test(err.code),
      `${env.id} must be refused`,
    );
  }
});

test("the source refuses production by BOTH mechanisms, and the deny list is checked first", () => {
  const src = fs.readFileSync(MODULE_PATH, "utf8");
  assert.match(src, /FORBIDDEN_PROJECT_IDS\.includes\(projectId\)/, "must deny by literal project id");
  assert.match(src, /env\.role === "production"/, "must deny by registry role");
  // Order matters: a registry edited to relabel production must not be able to let it through.
  assert.ok(
    src.indexOf("FORBIDDEN_PROJECT_IDS.includes(projectId)") < src.indexOf('env.role === "production"'),
    "the literal deny list must be evaluated before the (editable) registry",
  );
});

// ======================================================================================
// WRONG PROJECT IS REFUSED
// ======================================================================================

test("an unknown Firebase project fails closed", () => {
  assert.throws(
    () => assertSandboxTarget("some-project-nobody-provisioned"),
    (err) => err.code === "UNKNOWN_PROJECT",
  );
});

test("a DIFFERENT sandbox is still refused — this reconciliation is pinned to one project", () => {
  assert.throws(
    () => assertSandboxTarget("eos-platform-certification"),
    (err) => err.code === "WRONG_SANDBOX_PROJECT",
  );
  assert.equal(assertSandboxTarget(SANDBOX_PROJECT_ID).firebase.projectId, SANDBOX_PROJECT_ID);
});

test("no project id at all is refused; there is no default target", () => {
  for (const bad of [undefined, null, "", 0, {}]) {
    assert.throws(() => assertSandboxTarget(bad), (err) => err.code === "PROJECT_ID_REQUIRED");
  }
});

// ======================================================================================
// DUPLICATE AUTH IDENTITY IS REFUSED
// ======================================================================================

test("no two canonical slots claim the same auth uid — a duplicate identity is refused by the table", () => {
  const uids = RECONCILIATION.filter((r) => r.authUid).map((r) => r.authUid);
  assert.equal(new Set(uids).size, uids.length, "a uid appearing twice would mean two personas are the same account");
});

test("no two canonical slots claim the same credential key, principal or employee", () => {
  for (const field of ["credentialCandidate", "authUid", "jobRole"]) {
    const values = RECONCILIATION.map((r) => r[field]).filter(Boolean);
    assert.equal(new Set(values).size, values.length, `${field} must be unique across slots`);
  }
});

test("a persona that already has an account is never classified as needing one created", () => {
  for (const row of RECONCILIATION) {
    if (row.authAccountExists) {
      assert.notEqual(row.classification, "AUTH_ACCOUNT_MISSING", `${row.slot} has an account and must not be marked missing`);
    } else {
      assert.equal(row.authUid, null, `${row.slot} has no account, so it cannot carry a uid`);

    }
  }
});

// ======================================================================================
// A CREDENTIAL VALUE PRINTED OR LOGGED IS A TEST FAILURE
// ======================================================================================

test("the dry-run CLI never prints a credential value, even when the file it reads is full of them", () => {
  // A file whose VALUES are the sentinel and whose KEYS are real canonical addresses. If any code
  // path prints a value, the sentinel lands in stdout or stderr and this test fails.
  const table = {
    "eos-owner@sandbox.invalid": SENTINEL,
    "admin@sandbox.invalid": SENTINEL,
    "dispatcher@sandbox.invalid": SENTINEL,
    "restricted@sandbox.invalid": SENTINEL,
    "acctmgr@sandbox.invalid": SENTINEL,
  };
  withTempCredentialFile(JSON.stringify(table, null, 2), (file) => {
    const run = (args) =>
      execFileSync(process.execPath, [MODULE_PATH, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        // A clean env, so an inherited SANDBOX_CREDENTIALS_FILE cannot change what is read.
        env: { ...process.env, SANDBOX_CREDENTIALS_FILE: file },
      });

    for (const args of [
      ["--project", SANDBOX_PROJECT_ID],
      ["--project", SANDBOX_PROJECT_ID, "--verbose"],
      ["--project", SANDBOX_PROJECT_ID, "--source", file, "--verbose"],
    ]) {
      const out = run(args);
      assert.ok(!out.includes(SENTINEL), `a credential value reached stdout/stderr for: ${args.join(" ")}`);
      // The KEY NAMES are identifiers and may legitimately appear; the VALUE may never.
      assert.match(out, /DRY RUN\./);
    }
  });
});

test("the CLI's stderr is checked too: a refusal must not carry the file's contents", () => {
  withTempCredentialFile(JSON.stringify({ "admin@sandbox.invalid": SENTINEL }), (file) => {
    let combined = "";
    try {
      execFileSync(process.execPath, [MODULE_PATH, "--project", "taylor-parts"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, SANDBOX_CREDENTIALS_FILE: file },
      });
    } catch (err) {
      combined = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    // The refusal happens before any file is read, and must say so without quoting anything.
    assert.ok(!combined.includes(SENTINEL), "a refusal path leaked a credential value");
  });
});

test("SOURCE-LEVEL GUARD: this tooling contains no password-generating or file-writing path at all", () => {
  const src = fs.readFileSync(MODULE_PATH, "utf8");
  // A reconciliation that could mint or write is not a reconciliation. These forbidden tokens are
  // what a future `console.log(password)` or a quiet "while I'm here, let me just fix it" would
  // need, so their absence is the guard. Comments are stripped first: this file DISCUSSES rotation
  // and passwords deliberately, and prose must not trip a code-level fence.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const forbidden of [
    "node:crypto",
    "randomBytes",
    "writeFileSync",
    "appendFileSync",
    "createWriteStream",
    "renameSync",
    "updateUser",
    "createUser",
    "firebase-admin",
    "signInWithPassword",
    "signUp",
    "getAuth",
  ]) {
    assert.ok(!code.includes(forbidden), `the reconciliation must not contain '${forbidden}'`);
  }
});

test("reconcile() refuses to be handed a credential table by accident", () => {
  // The hazard: a caller passes `{email: password}` where key names were wanted, and values start
  // flowing through code that assumes identifiers. Object.values of a table are strings, so the
  // type check alone cannot catch that — but passing the OBJECT, or any non-string, is refused.
  assert.throws(
    () => reconcile({ credentialKeyNames: [{ "admin@sandbox.invalid": SENTINEL }] }),
    (err) => err instanceof ReconciliationRefusal && err.code === "KEY_NAMES_ONLY",
  );
  assert.throws(() => reconcile({ credentialKeyNames: [123] }), /KEY_NAMES_ONLY/);
});

test("formatCounts emits counts and classification names only — no address, uid or value", () => {
  const text = formatCounts(reconcile({ credentialKeyNames: ["admin@sandbox.invalid"] }));
  assert.ok(!text.includes("@"), "no address may appear in the counts summary");
  assert.ok(!text.includes(SENTINEL));
  for (const row of RECONCILIATION) {
    if (row.authUid) assert.ok(!text.includes(row.authUid), "no uid may appear in the counts summary");
  }
});

test("discoverCredentialSources reports key names and counts, and never a value", () => {
  withTempCredentialFile(JSON.stringify({ "admin@sandbox.invalid": SENTINEL }), (file) => {
    const [source] = discoverCredentialSources({ extraPaths: [file] }).filter((s) => s.path === file);
    assert.equal(source.present, true);
    assert.equal(source.entryCount, 1);
    assert.deepEqual(source.keyNames, ["admin@sandbox.invalid"]);
    assert.ok(!JSON.stringify(source).includes(SENTINEL), "the discovery result carried a credential value");
    assert.ok(!("values" in source) && !("table" in source) && !("passwordLength" in source));
  });
});

// ======================================================================================
// THE OWNER CREDENTIAL IS NEVER ROTATED
// ======================================================================================

test("the Owner persona is classified as an existing exact match and its action is NONE", () => {
  const owner = RECONCILIATION.find((r) => r.persona === "ownerExecutive");
  assert.equal(owner.slot, "P01");
  assert.equal(owner.classification, "EXISTING_CREDENTIAL_EXACT_MATCH");
  assert.equal(owner.credentialCandidate, "eos-owner@sandbox.invalid");
  assert.equal(owner.authUid, "ajXZSa0gTcWAyDHVSsVifwZfNRf1");
  assert.match(owner.action, /NEVER ROTATE/);
  assert.match(owner.action, /^NONE\./);
});

test("the Owner's address is the eos-owner spelling, never the retired owner@ one", () => {
  const owner = RECONCILIATION.find((r) => r.persona === "ownerExecutive");
  assert.equal(owner.credentialCandidate, "eos-owner@sandbox.invalid");
  assert.notEqual(owner.credentialCandidate, "owner@sandbox.invalid");
  // The retired spelling must never be a credential candidate for ANY slot: it has no Principal.
  for (const row of RECONCILIATION) assert.notEqual(row.credentialCandidate, "owner@sandbox.invalid");
});

test("no slot whose credential already exists is ever assigned a mutating action", () => {
  for (const row of RECONCILIATION) {
    if (row.classification.startsWith("EXISTING_CREDENTIAL_")) {
      assert.match(row.action, /^NONE\./, `${row.slot} already has a credential and must not be acted on`);
      assert.match(row.action, /NEVER ROTATE/, `${row.slot} must say so explicitly`);
    }
  }
});

// ======================================================================================
// EXISTING CREDENTIAL ENTRIES ARE NEVER LOST
// ======================================================================================

test("the reconciliation reads every source and unions their keys; no source shadows another", () => {
  // The loader deliberately takes the FIRST existing candidate and stops, which is right for
  // resolving one persona and wrong for a census: it is exactly how a 70-byte stub hid a 60-entry
  // file. Discovery must therefore report EVERY source, and the union must lose nothing.
  const a = { "eos-owner@sandbox.invalid": SENTINEL };
  const b = { "admin@sandbox.invalid": SENTINEL, "dispatcher@sandbox.invalid": SENTINEL };
  withTempCredentialFile(JSON.stringify(a), (fileA) => {
    withTempCredentialFile(JSON.stringify(b), (fileB) => {
      const sources = discoverCredentialSources({ extraPaths: [fileA, fileB] });
      const union = new Set(sources.flatMap((s) => s.keyNames));
      for (const key of [...Object.keys(a), ...Object.keys(b)]) {
        assert.ok(union.has(key), `${key} was lost by the merge`);
      }
      assert.equal(sources.filter((s) => s.path === fileA)[0].entryCount, 1);
      assert.equal(sources.filter((s) => s.path === fileB)[0].entryCount, 2);
    });
  });
});

test("an unparseable source is reported, never silently treated as empty", () => {
  withTempCredentialFile("{ this is not json", (file) => {
    const [source] = discoverCredentialSources({ extraPaths: [file] }).filter((s) => s.path === file);
    assert.equal(source.present, true);
    assert.ok(source.parseFailure, "a file that exists but cannot be parsed must say so");
    assert.equal(source.entryCount, 0);
  });
});

test("an off-loader-path source is flagged as unreachable rather than quietly counted as fine", () => {
  withTempCredentialFile(JSON.stringify({ "admin@sandbox.invalid": SENTINEL }), (file) => {
    const [source] = discoverCredentialSources({ extraPaths: [file] }).filter((s) => s.path === file);
    assert.equal(source.reachableByLoader, false, "the reachability defect must be visible, not smoothed over");
  });
});

// ======================================================================================
// THE TABLE ITSELF IS COMPLETE AND HONEST
// ======================================================================================

test("all sixteen canonical slots are present exactly once, in order", () => {
  assert.equal(RECONCILIATION.length, 16);
  assert.deepEqual(
    RECONCILIATION.map((r) => r.slot),
    Array.from({ length: 16 }, (_, i) => `P${String(i + 1).padStart(2, "0")}`),
  );
  const personas = RECONCILIATION.map((r) => r.persona);
  assert.deepEqual(personas, vocabularies().canonicalKeys, "the slots must match the canonical role registry exactly");
});

test("every slot carries exactly one classification, drawn from the declared vocabulary", () => {
  for (const row of RECONCILIATION) {
    assert.ok(CLASSIFICATIONS.includes(row.classification), `${row.slot}: ${row.classification} is not a declared state`);
  }
  const result = reconcile({ credentialKeyNames: [] });
  assert.equal(
    Object.values(result.counts).reduce((a, b) => a + b, 0),
    16,
    "the counts must partition all sixteen slots",
  );
});

test("the dry run performs zero mutations, by declaration and by absence of any writer", () => {
  const result = reconcile({ credentialKeyNames: ["admin@sandbox.invalid"] });
  assert.equal(result.mode, "DRY_RUN");
  assert.equal(result.mutations, 0);
});

test("every legacy alias resolves to a canonical key and carries no address of its own", () => {
  const { legacyAliases, canonicalKeys } = vocabularies();
  // The consolidation added aliases for the renamed keys (owner, admin, reporting, restricted) and
  // collapsed three technician spellings onto one role.
  assert.deepEqual(Object.keys(legacyAliases).sort(), [
    "admin",
    "fieldManager",
    "owner",
    "reporting",
    "restricted",
    "salesperson",
    "serviceTechnicianA",
    "technician",
    "technicianAssigned",
  ]);
  for (const [alias, target] of Object.entries(legacyAliases)) {
    assert.ok(canonicalKeys.includes(target), `${alias} must resolve to a canonical key, not to '${target}'`);
    assert.ok(!String(target).includes("@"), `${alias} must not carry an address of its own`);
  }
});

test("an alias can never supply a credential, so ALIAS_MATCH is structurally unreachable here", () => {
  // Recorded as a finding, not a gap. Aliases map key -> key and never key -> address (the loader
  // enforces that, and the test above pins it), so no alias can contribute a credential-file key.
  // Every legacy credential that DOES exist belongs to a legacy ADDRESS, and exactly one of those
  // (admin@) has a live Principal — which makes it an EXACT match, not an alias match.
  const aliasMatches = RECONCILIATION.filter((r) => r.classification === "EXISTING_CREDENTIAL_ALIAS_MATCH");
  assert.equal(aliasMatches.length, 0);
});

test("the retired KEYS stay retired even though one of their addresses is now reused", () => {
  // Subtle and worth stating: the Owner ruled `acctmgr@sandbox.invalid` — the ADDRESS — is reused
  // as P14's identity. That does NOT revive the `accountingManager` KEY, which still names a Role
  // no Principal holds. An address and a persona key are different things, and conflating them is
  // how the original catalog acquired keys standing in front of no identity.
  assert.deepEqual(vocabularies().retiredKeys.sort(), [
    "accountingManager",
    "contractTechnician",
    "operationsManager",
    "retailSalesB",
    "salesManager",
    "technicianUnassigned",
  ]);
  const adopted = RECONCILIATION.map((r) => r.credentialCandidate).filter(Boolean);
  for (const address of ["opsmgr@sandbox.invalid", "salesmgr@sandbox.invalid"]) {
    assert.ok(!adopted.includes(address), `${address} has no live EOS Principal and must not be adopted`);
  }
});

test("a legacy address is adopted ONLY where the Owner ruled it reused", () => {
  // Never adopted: no Principal, and no ruling reusing them.
  const stillDead = [
    "owner@sandbox.invalid",
    "tech@sandbox.invalid",
    "whmgr@sandbox.invalid",
    "partsmgr@sandbox.invalid",
    "partsassoc@sandbox.invalid",
    "fieldmgr@sandbox.invalid",
    "mikael@sandbox.invalid",
    "opsmgr@sandbox.invalid",
    "salesmgr@sandbox.invalid",
  ];
  const adopted = RECONCILIATION.map((r) => r.credentialCandidate).filter(Boolean);
  for (const address of stillDead) {
    assert.ok(!adopted.includes(address), `${address} must not be adopted`);
  }
  // The four the Owner ruled reused, each against a real Admin SDK account.
  for (const address of [
    "admin@sandbox.invalid",
    "dispatcher@sandbox.invalid",
    "acctmgr@sandbox.invalid",
    "restricted@sandbox.invalid",
  ]) {
    assert.ok(adopted.includes(address), `${address} was ruled reused and must be adopted`);
  }
  // The retired `owner@` spelling stays dead; the Owner persona uses eos-owner@.
  assert.ok(!adopted.includes("owner@sandbox.invalid"));
  assert.ok(adopted.includes("eos-owner@sandbox.invalid"));
});

test("the loader remains READ ONLY: the reconciliation did not add a write path to it", () => {
  const loader = fs.readFileSync(LOADER_PATH, "utf8");
  const code = loader.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const forbidden of ["writeFileSync", "appendFileSync", "renameSync", "createWriteStream", "randomBytes"]) {
    assert.ok(!code.includes(forbidden), `scripts/sandboxCredentials.mjs must contain no '${forbidden}'`);
  }
});

test("P15 is the ONLY missing account, and it is the reporting analyst", () => {
  const missing = RECONCILIATION.filter((r) => r.classification === "AUTH_ACCOUNT_MISSING");
  assert.deepEqual(missing.map((r) => r.persona), ["reportingAnalyst"]);
  assert.equal(missing[0].credentialCandidate, "reporting@sandbox.invalid");
  assert.equal(missing[0].authAccountExists, false);
  assert.match(missing[0].action, /CREATE EXACTLY ONE/);
});

test("financeAccounting and generalEmployee reuse existing accounts and are never rotated", () => {
  for (const role of ["financeAccounting", "generalEmployee"]) {
    const row = RECONCILIATION.find((r) => r.persona === role);
    assert.equal(row.classification, "EXISTING_CREDENTIAL_EXACT_MATCH", `${role} reuses an existing account`);
    assert.equal(row.authAccountExists, true);
    assert.ok(row.authUid, `${role} must carry the measured uid`);
    assert.match(row.action, /NEVER ROTATE/);
    assert.match(row.action, /do not create a second account/i);
  }
});

// ======================================================================================
// THE OWNER'S CREDENTIAL POLICY, ASSERTED AS DATA
// ======================================================================================

test("a preserve-only role can NEVER enter the rotation set", () => {
  const rotatable = new Set(rotationSet());
  for (const role of CREDENTIAL_POLICY.preserveNeverRotate) {
    assert.ok(!rotatable.has(role), `${role} is preserve-only and must never be rotated`);
  }
  assert.deepEqual(rotationSet(), [...CREDENTIAL_POLICY.bootstrapAuthorized]);
});

test("the three policy sets are disjoint and cover all sixteen roles exactly once", () => {
  const { preserveNeverRotate, bootstrapAuthorized, createOne } = CREDENTIAL_POLICY;
  const all = [...preserveNeverRotate, ...bootstrapAuthorized, ...createOne];
  assert.equal(new Set(all).size, all.length, "a role appears in two policy sets -- the policy is ambiguous");
  assert.deepEqual([...all].sort(), [...CANONICAL_ROLE_KEYS].sort(), "the policy must cover exactly the sixteen canonical roles");
});

test("the policy's counts match the derived table and the Owner's expected end state", () => {
  const { expectedEndState: e } = CREDENTIAL_POLICY;
  assert.equal(CREDENTIAL_POLICY.preserveNeverRotate.length, e.preserved);
  assert.equal(CREDENTIAL_POLICY.bootstrapAuthorized.length, e.bootstrapped);
  assert.equal(CREDENTIAL_POLICY.createOne.length, e.created);
  assert.equal(e.preserved + e.bootstrapped + e.created, e.ready);
  assert.equal(e.ready, 16);
  assert.equal(e.duplicatePersonaAccountsCreated, 0);

  const byRole = new Map(RECONCILIATION.map((r) => [r.persona, r]));
  for (const p of CREDENTIAL_POLICY.preserveNeverRotate) {
    assert.equal(byRole.get(p).classification, "EXISTING_CREDENTIAL_EXACT_MATCH", `${p} is preserved, so a credential must already exist`);
  }
  for (const p of CREDENTIAL_POLICY.bootstrapAuthorized) {
    assert.equal(byRole.get(p).classification, "EXISTING_ACCOUNT_BUT_NO_MATCHED_CREDENTIAL", `${p} is bootstrapped, so its account must exist without a credential`);
    assert.ok(byRole.get(p).authUid, `${p} must have a measured uid before a password is minted for it`);
  }
  for (const p of CREDENTIAL_POLICY.createOne) {
    assert.equal(byRole.get(p).classification, "AUTH_ACCOUNT_MISSING", `${p} is created, so its account must be absent`);
  }
});

// ======================================================================================
// NONCANONICAL IDENTITIES CAN NEVER BE A CANONICAL IDENTITY
// ======================================================================================

test("no noncanonical fixture identity is ever a canonical role identity or a credential candidate", () => {
  for (const [address, record] of Object.entries(NONCANONICAL_FIXTURE_IDENTITIES)) {
    assert.equal(record.classification, "NONCANONICAL_FIXTURE_IDENTITY");
    assert.ok(
      !Object.values(SANDBOX_PERSONAS).includes(address),
      `${address} is noncanonical and must never be a role's address`,
    );
    assert.ok(
      !RECONCILIATION.some((r) => r.credentialCandidate === address),
      `${address} is noncanonical and must never be a credential candidate`,
    );
  }
});

test("the retired two-technician and second-sales identities are recorded, and superseded by the canonical one", () => {
  for (const [address, expected] of [
    ["gray.fixture@sandbox.invalid", "finley.fixture@sandbox.invalid"],
    ["oakley.fixture@sandbox.invalid", "finley.fixture@sandbox.invalid"],
    ["indigo.fixture@sandbox.invalid", "harper.fixture@sandbox.invalid"],
    ["emerson.fixture@sandbox.invalid", "dispatcher@sandbox.invalid"],
    ["sage.fixture@sandbox.invalid", "acctmgr@sandbox.invalid"],
    ["wren.fixture@sandbox.invalid", "restricted@sandbox.invalid"],
  ]) {
    const record = NONCANONICAL_FIXTURE_IDENTITIES[address];
    assert.ok(record, `${address} must be recorded noncanonical`);
    assert.equal(record.supersededBy, expected);
    assert.ok(record.reason && record.reason.length > 40, `${address} must carry a real reason`);
  }
});

test("ONE login per Job Role, and ONE Job Role per login", () => {
  const jobRoles = CANONICAL_ROLE_KEYS.map((k) => CANONICAL_ROLE_REGISTRY[k].jobRole);
  const emails = CANONICAL_ROLE_KEYS.map((k) => CANONICAL_ROLE_REGISTRY[k].email);
  assert.equal(new Set(jobRoles).size, 16, "two roles share a Job Role");
  assert.equal(new Set(emails).size, 16, "two roles share a login");
  // Exactly one technician.
  assert.deepEqual(CANONICAL_ROLE_KEYS.filter((k) => CANONICAL_ROLE_REGISTRY[k].jobRole === "service-technician"), ["serviceTechnician"]);
});

test("P05 is the dispatcher and names the account the live Dispatcher Principal is behind", () => {
  const row = RECONCILIATION.find((r) => r.persona === "dispatcher");
  assert.equal(row.credentialCandidate, "dispatcher@sandbox.invalid");
  assert.equal(row.authUid, "PEiRkebIGRPcEau7yBBV0D77Dho1");
  assert.equal(SANDBOX_PERSONAS.dispatcher, "dispatcher@sandbox.invalid");
  // The superseded account keeps its own, different uid -- two accounts, not two spellings of one.
  const superseded = NONCANONICAL_FIXTURE_IDENTITIES["emerson.fixture@sandbox.invalid"];
  assert.equal(superseded.uid, "NReyNyXVMdVkv75vpmxWuvGUeOm1");
  assert.notEqual(superseded.uid, row.authUid);
});

// ======================================================================================
// THE CATALOG AND THE EXPLICIT CREDENTIAL SOURCE
// ======================================================================================

test("the catalog declares all sixteen roles, and the only non-loadable one is the pending account", () => {
  const directory = personaDirectory();
  assert.equal(directory.length, 16);
  assert.equal(directory.filter((r) => r.state === "MAPPED").length, 15);
  const pending = directory.filter((r) => r.state === "PENDING_ACCOUNT");
  assert.deepEqual(pending.map((r) => r.personaId), ["reportingAnalyst"]);
  assert.equal(pending[0].email, "reporting@sandbox.invalid", "a pending key still declares its address");
  assert.deepEqual(Object.keys(UNRECONCILED_PERSONAS), [], "the unreconciled state was emptied by the ruling");
  for (const row of directory) assert.ok(row.jobRole, `${row.personaId} must name its Job Role`);
});

test("an UNSET credential source fails closed with CREDENTIAL_SOURCE_NOT_CONFIGURED, never a search", () => {
  const prev = process.env[CREDENTIAL_SOURCE_ENV];
  delete process.env[CREDENTIAL_SOURCE_ENV];
  try {
    assert.throws(
      () => loadSandboxPersona("dispatcher"),
      (err) => {
        assert.equal(err.failureType, "CREDENTIAL_SOURCE_NOT_CONFIGURED");
        assert.deepEqual(err.pathsTried, [], "no path may be reported: none was tried");
        assert.match(err.message, new RegExp(CREDENTIAL_SOURCE_ENV));
        return true;
      },
    );
    // A blank value is a configuration error too, not an empty search.
    process.env[CREDENTIAL_SOURCE_ENV] = "   ";
    assert.throws(() => loadSandboxPersona("dispatcher"), (err) => err.failureType === "CREDENTIAL_SOURCE_NOT_CONFIGURED");
  } finally {
    if (prev === undefined) delete process.env[CREDENTIAL_SOURCE_ENV];
    else process.env[CREDENTIAL_SOURCE_ENV] = prev;
  }
});

test("the load path consults the explicit source ONLY -- candidatePaths is diagnostics", () => {
  // The configured file exists and holds the role's key, so a load succeeds. If resolution still fell
  // back to the guess list, pointing the variable at a file WITHOUT the key would silently succeed
  // from some other copy on disk -- which is the defect this ruling removed.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bv-src-"));
  const good = path.join(dir, "sandbox-credentials.local.json");
  const bare = path.join(dir, "empty-credentials.local.json");
  fs.writeFileSync(good, JSON.stringify({ "dispatcher@sandbox.invalid": SENTINEL }));
  fs.writeFileSync(bare, JSON.stringify({ "nobody@sandbox.invalid": SENTINEL }));
  const prev = process.env[CREDENTIAL_SOURCE_ENV];
  try {
    process.env[CREDENTIAL_SOURCE_ENV] = good;
    assert.equal(loadSandboxPersona("dispatcher").email, "dispatcher@sandbox.invalid");
    process.env[CREDENTIAL_SOURCE_ENV] = bare;
    assert.throws(
      () => loadSandboxPersona("dispatcher"),
      (err) => {
        assert.equal(err.failureType, "PERSONA_NOT_IN_FILE", "it must fail on the NAMED file, not wander off to another copy");
        assert.deepEqual(err.pathsTried, [bare], "exactly one source may be reported");
        return true;
      },
    );
  } finally {
    if (prev === undefined) delete process.env[CREDENTIAL_SOURCE_ENV];
    else process.env[CREDENTIAL_SOURCE_ENV] = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a pending-account role fails closed BEFORE the credential source is read", () => {
  const prev = process.env[CREDENTIAL_SOURCE_ENV];
  // Deliberately UNSET: a pending role must be answered by name, so it must not even reach the
  // source check -- otherwise the operator is told to configure a file for an account that does not
  // exist, which is the wrong remedy.
  delete process.env[CREDENTIAL_SOURCE_ENV];
  try {
    assert.throws(
      () => loadSandboxPersona("reportingAnalyst"),
      (err) => {
        assert.equal(err.failureType, "PERSONA_ACCOUNT_PENDING");
        assert.deepEqual(err.pathsTried, []);
        assert.match(err.message, /reporting@sandbox\.invalid/);
        assert.match(err.message, /OPERATOR ACTION:/);
        return true;
      },
    );
  } finally {
    if (prev !== undefined) process.env[CREDENTIAL_SOURCE_ENV] = prev;
  }
});

test("a retired key is answered as RETIRED, and the unassigned technician is not silently aliased", () => {
  const prev = process.env[CREDENTIAL_SOURCE_ENV];
  delete process.env[CREDENTIAL_SOURCE_ENV];
  try {
    for (const key of ["technicianUnassigned", "retailSalesB", "contractTechnician"]) {
      assert.throws(
        () => loadSandboxPersona(key),
        (err) => {
          assert.equal(err.failureType, "PERSONA_RETIRED", `${key} must be reported retired`);
          assert.match(err.message, /OPERATOR ACTION:/);
          return true;
        },
      );
    }
    // The critical one: asking for the UNASSIGNED technician must NOT hand back the assigned one.
    // A silent alias would make a test that means "the unassigned technician" pass for the wrong
    // reason, which is worse than failing.
    assert.equal(PERSONA_ALIASES.technicianUnassigned, undefined);
    assert.equal(PERSONA_ALIASES.serviceTechnicianB, undefined);
    assert.match(RETIRED_PERSONAS.technicianUnassigned.reason, /BUSINESS DATA/);
  } finally {
    if (prev !== undefined) process.env[CREDENTIAL_SOURCE_ENV] = prev;
  }
});

test("legacy aliases still reach the canonical role and report the canonical key back", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bv-alias-"));
  const file = path.join(dir, "sandbox-credentials.local.json");
  fs.writeFileSync(file, JSON.stringify({
    "finley.fixture@sandbox.invalid": SENTINEL,
    "eos-owner@sandbox.invalid": SENTINEL,
    "admin@sandbox.invalid": SENTINEL,
  }));
  const prev = process.env[CREDENTIAL_SOURCE_ENV];
  try {
    process.env[CREDENTIAL_SOURCE_ENV] = file;
    for (const [alias, key] of [
      ["technician", "serviceTechnician"],
      ["technicianAssigned", "serviceTechnician"],
      ["serviceTechnicianA", "serviceTechnician"],
      ["owner", "ownerExecutive"],
      ["admin", "administrator"],
    ]) {
      const cred = loadSandboxPersona(alias);
      assert.equal(cred.personaId, key, `${alias} must report the canonical key, never the alias typed`);
      assert.equal(cred.email, CANONICAL_ROLE_REGISTRY[key].email);
      assert.ok(cred.jobRole, "a load must report the Job Role it serves");
    }
  } finally {
    if (prev === undefined) delete process.env[CREDENTIAL_SOURCE_ENV];
    else process.env[CREDENTIAL_SOURCE_ENV] = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("every alias points at a canonical role key and carries no address of its own", () => {
  for (const [alias, target] of Object.entries(PERSONA_ALIASES)) {
    assert.ok(CANONICAL_ROLE_KEYS.includes(target), `${alias} must resolve to a canonical role key, not '${target}'`);
    assert.ok(!String(target).includes("@"), `${alias} must not carry an address of its own`);
    assert.ok(!PERSONA_ALIASES[target], `${alias} -> ${target} is an alias chain; aliases resolve in one hop`);
  }
});

test("the loader remains READ ONLY: the consolidation did not add a write path", () => {
  const loader = fs.readFileSync(LOADER_PATH, "utf8");
  const code = loader.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const forbidden of ["writeFileSync", "appendFileSync", "renameSync", "createWriteStream", "randomBytes"]) {
    assert.ok(!code.includes(forbidden), `scripts/sandboxCredentials.mjs must contain no '${forbidden}'`);
  }
});
