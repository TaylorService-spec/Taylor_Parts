import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SANDBOX_PERSONAS,
  CANONICAL_PERSONA_KEYS,
  CANONICAL_ROLE_KEYS,
  CANONICAL_ROLE_REGISTRY,
  CREDENTIAL_SOURCE_ENV,
  NONCANONICAL_FIXTURE_IDENTITIES,
  PENDING_ACCOUNT_PERSONAS,
  PERSONA_ALIASES,
  RETIRED_PERSONAS,
  UNRECONCILED_PERSONAS,
  CredentialAccessError,
  candidatePaths,
  parseCredentials,
  loadSandboxPersona,
  describeLoad,
  personaDirectory,
  resolvePersonaKey,
} from "../../scripts/sandboxCredentials.mjs";

// Fictional values against the CANONICAL role logins (Owner ruling 2026-09-25: one canonical
// sandbox login per canonical Job Role). The dispatcher role's authentication identity is
// dispatcher@sandbox.invalid -- the account the live Dispatcher Principal is actually behind.
// emerson.fixture@ remains the Employee's WORK EMAIL, which is contact data and not a login, and it
// is recorded NONCANONICAL_FIXTURE_IDENTITY.
const FAKE = '"dispatcher@sandbox.invalid": "Sbx!fictional-value-01",\n"finley.fixture@sandbox.invalid": "Sbx!fictional-value-02"';

function withTempCredentialFile(contents, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sbxcreds-"));
  const file = path.join(dir, "sandbox-credentials.local.json");
  fs.writeFileSync(file, contents);
  const prev = process.env.SANDBOX_CREDENTIALS_FILE;
  process.env.SANDBOX_CREDENTIALS_FILE = file;
  try {
    return fn(file);
  } finally {
    if (prev === undefined) delete process.env.SANDBOX_CREDENTIALS_FILE;
    else process.env.SANDBOX_CREDENTIALS_FILE = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("parses the brace-less entry list the real file has been seen to contain", () => {
  const table = parseCredentials(FAKE);
  assert.equal(table["dispatcher@sandbox.invalid"], "Sbx!fictional-value-01");
  assert.equal(table["finley.fixture@sandbox.invalid"], "Sbx!fictional-value-02");
});

test("parses a proper JSON object too", () => {
  const table = parseCredentials('{"dispatcher@sandbox.invalid": "Sbx!fictional-value-01"}');
  assert.equal(table["dispatcher@sandbox.invalid"], "Sbx!fictional-value-01");
});

test("a trailing comma does not defeat the parse", () => {
  const table = parseCredentials(`${FAKE},\n`);
  assert.equal(table["finley.fixture@sandbox.invalid"], "Sbx!fictional-value-02");
});

test("no quote or comma survives into the password -- the bug that wasted two runs", () => {
  const table = parseCredentials(FAKE);
  for (const password of Object.values(table)) {
    assert.doesNotMatch(password, /["']/, "password must carry no quote characters");
    assert.doesNotMatch(password, /,$/, "password must carry no trailing comma");
  }
});

test("loads a persona by stable id, never by hard-coded email", () => {
  withTempCredentialFile(FAKE, () => {
    const cred = loadSandboxPersona("dispatcher");
    assert.equal(cred.personaId, "dispatcher");
    assert.equal(cred.email, "dispatcher@sandbox.invalid");
    assert.equal(cred.password, "Sbx!fictional-value-01");
  });
});

test("NEVER falls back to sandbox.txt, even when it sits beside the canonical file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sbxcreds-"));
  fs.writeFileSync(path.join(dir, "sandbox.txt"), FAKE);
  const prev = process.env.SANDBOX_CREDENTIALS_FILE;
  process.env.SANDBOX_CREDENTIALS_FILE = path.join(dir, "sandbox-credentials.local.json");
  try {
    assert.throws(() => loadSandboxPersona("dispatcher"), (err) => {
      assert.ok(err instanceof CredentialAccessError);
      assert.equal(err.code, "CREDENTIAL_ACCESS_FAILED");
      assert.equal(err.failureType, "FILE_NOT_FOUND");
      return true;
    }, "a stale sibling must produce a clean failure, never a silent wrong-credential login");
  } finally {
    if (prev === undefined) delete process.env.SANDBOX_CREDENTIALS_FILE;
    else process.env.SANDBOX_CREDENTIALS_FILE = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("candidate paths only ever name the one canonical filename", () => {
  for (const p of candidatePaths()) {
    assert.match(path.basename(p), /^\.?sandbox-credentials\.local\.json$/);
  }
});

test("an unknown persona fails closed and names the valid keys, not the file contents", () => {
  assert.throws(() => loadSandboxPersona("saboteur"), (err) => {
    assert.equal(err.failureType, "UNKNOWN_PERSONA");
    assert.match(err.message, /dispatcher/);
    return true;
  });
});

test("a persona missing from the file fails closed rather than guessing", () => {
  withTempCredentialFile('"finley.fixture@sandbox.invalid": "Sbx!fictional-value-02"', () => {
    assert.throws(() => loadSandboxPersona("dispatcher"), (err) => {
      assert.equal(err.failureType, "PERSONA_NOT_IN_FILE");
      return true;
    });
  });
});

test("errors never carry the credential value", () => {
  withTempCredentialFile('"finley.fixture@sandbox.invalid": "Sbx!fictional-value-02"', () => {
    try {
      loadSandboxPersona("dispatcher");
      assert.fail("expected a failure");
    } catch (err) {
      const serialized = `${err.message} ${JSON.stringify(err.pathsTried)}`;
      assert.doesNotMatch(serialized, /fictional-value/, "no credential value may appear in an error");
    }
  });
});

test("empty and unparseable files fail closed", () => {
  assert.throws(() => parseCredentials("   "), (e) => e.failureType === "EMPTY_FILE");
  assert.throws(() => parseCredentials("not credentials at all"), (e) => e.failureType === "UNPARSEABLE");
  assert.throws(() => parseCredentials("[1,2,3]"), (e) => e.failureType === "UNPARSEABLE");
  assert.throws(() => parseCredentials("{}"), (e) => e.failureType === "NO_ENTRIES");
});

test("describeLoad reveals only a length -- never anything reversible", () => {
  withTempCredentialFile(FAKE, () => {
    const info = describeLoad("dispatcher");
    assert.deepEqual(info, {
      personaId: "dispatcher",
      email: "dispatcher@sandbox.invalid",
      jobRole: "service-coordinator-dispatcher",
      passwordLength: "Sbx!fictional-value-01".length,
      loaded: true,
    });
    // A length and a Job Role are not reversible; the VALUE must never appear.
    assert.doesNotMatch(JSON.stringify(info), /fictional-value/);
  });
});

test("every persona key maps to a sandbox.invalid address", () => {
  for (const [id, email] of Object.entries(SANDBOX_PERSONAS)) {
    assert.match(email, /@sandbox\.invalid$/, `${id} must be a fictional sandbox persona`);
  }
});

test("the loader exposes no write path", async () => {
  const src = fs.readFileSync(new URL("../../scripts/sandboxCredentials.mjs", import.meta.url), "utf8");
  for (const forbidden of ["writeFileSync", "appendFileSync", "createWriteStream", "unlinkSync", "rmSync"]) {
    assert.ok(!src.includes(forbidden), `loader must never ${forbidden} -- it is read-only by contract`);
  }
});

// ============================ THE CATALOG RECONCILIATION ============================
//
// These assert the defect that made the catalog worse than empty: a key that RESOLVED, to an
// address no live Principal was behind. The failure surfaced late, as the wrong identity,
// which is the one failure mode this module exists to prevent.

/**
 * The legacy `sbx-*`-era addresses that remain DEAD: no live EOS Principal, and no Owner ruling
 * reusing them. Three of the original twelve are no longer here, and deliberately so -- the Owner
 * ruled `dispatcher@`, `acctmgr@` and `restricted@` REUSED as canonical role identities, each
 * confirmed against a real Firebase Admin SDK lookup. `admin@` was never a collision.
 *
 * An ADDRESS being reused does not revive its old KEY: `accountingManager` is still a retired key
 * naming a Security Role no Principal holds, while `acctmgr@` is the canonical `financeAccounting`
 * login. Conflating the two is how the catalog acquired keys standing in front of no identity.
 */
const STILL_DEAD_ADDRESSES = [
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

test("no canonical role resolves to a dead address -- the collision that returned the wrong identity", () => {
  for (const [id, email] of Object.entries(SANDBOX_PERSONAS)) {
    assert.ok(
      !STILL_DEAD_ADDRESSES.includes(email),
      `${id} still points at ${email}, which no live EOS Principal is behind. A name collision against a live persona is a defect, not an alias.`,
    );
  }
});

test("every NONCANONICAL fixture identity is excluded from the canonical registry", () => {
  const canonical = new Set(Object.values(SANDBOX_PERSONAS));
  const pending = new Set(Object.values(PENDING_ACCOUNT_PERSONAS).map((x) => x.email));
  for (const [email, record] of Object.entries(NONCANONICAL_FIXTURE_IDENTITIES)) {
    assert.equal(record.classification, "NONCANONICAL_FIXTURE_IDENTITY");
    assert.ok(!canonical.has(email), `${email} is noncanonical and must not be a canonical role login`);
    assert.ok(!pending.has(email), `${email} is noncanonical and must not be a pending canonical login`);
  }
  // The retired second technician, second retail sales and contract technician are all recorded.
  for (const email of [
    "gray.fixture@sandbox.invalid",
    "indigo.fixture@sandbox.invalid",
    "oakley.fixture@sandbox.invalid",
    "emerson.fixture@sandbox.invalid",
    "sage.fixture@sandbox.invalid",
    "wren.fixture@sandbox.invalid",
  ]) {
    assert.ok(NONCANONICAL_FIXTURE_IDENTITIES[email], `${email} must be recorded noncanonical`);
  }
});

test("ONE canonical login per Job Role, and exactly ONE serviceTechnician", () => {
  assert.equal(CANONICAL_ROLE_KEYS.length, 16);
  const jobRoles = CANONICAL_ROLE_KEYS.map((k) => CANONICAL_ROLE_REGISTRY[k].jobRole);
  const emails = CANONICAL_ROLE_KEYS.map((k) => CANONICAL_ROLE_REGISTRY[k].email);
  assert.equal(new Set(jobRoles).size, 16, "two roles share a Job Role");
  assert.equal(new Set(emails).size, 16, "two roles share a login -- the duplication the ruling removed");

  const technicians = CANONICAL_ROLE_KEYS.filter((k) => CANONICAL_ROLE_REGISTRY[k].jobRole === "service-technician");
  assert.deepEqual(technicians, ["serviceTechnician"]);
  assert.equal(CANONICAL_ROLE_REGISTRY.serviceTechnician.email, "finley.fixture@sandbox.invalid");
  // Asking for the UNASSIGNED technician must never silently hand back the assigned one: that would
  // make a test meaning "the unassigned technician" pass for the wrong reason.
  assert.equal(PERSONA_ALIASES.technicianUnassigned, undefined);
  assert.equal(PERSONA_ALIASES.serviceTechnicianB, undefined);
  assert.ok(RETIRED_PERSONAS.technicianUnassigned, "the retired key must still explain itself");
  assert.match(RETIRED_PERSONAS.technicianUnassigned.reason, /BUSINESS DATA/);
});

test("SANDBOX_CREDENTIALS_FILE is THE source, and unset fails closed without searching", () => {
  const prev = process.env[CREDENTIAL_SOURCE_ENV];
  delete process.env[CREDENTIAL_SOURCE_ENV];
  try {
    for (const blank of [undefined, "", "   "]) {
      if (blank === undefined) delete process.env[CREDENTIAL_SOURCE_ENV];
      else process.env[CREDENTIAL_SOURCE_ENV] = blank;
      assert.throws(
        () => loadSandboxPersona("dispatcher"),
        (err) => {
          assert.equal(err.failureType, "CREDENTIAL_SOURCE_NOT_CONFIGURED");
          assert.deepEqual(err.pathsTried, [], "no path may be reported: none was tried");
          assert.match(err.message, new RegExp(CREDENTIAL_SOURCE_ENV));
          return true;
        },
      );
    }
  } finally {
    if (prev === undefined) delete process.env[CREDENTIAL_SOURCE_ENV];
    else process.env[CREDENTIAL_SOURCE_ENV] = prev;
  }
});

test("the load path reads ONLY the configured file -- candidatePaths is diagnostics, not resolution", () => {
  // Point the variable at a file that does NOT hold the role's key. If guessing were still part of
  // resolution, some other copy on disk could satisfy the load and this would silently pass -- which
  // is precisely the defect that let a 70-byte stub hide a 60-entry file.
  withTempCredentialFile('"nobody@sandbox.invalid": "Sbx!fictional-value-03"', (file) => {
    assert.throws(
      () => loadSandboxPersona("dispatcher"),
      (err) => {
        assert.equal(err.failureType, "PERSONA_NOT_IN_FILE");
        assert.deepEqual(err.pathsTried, [file], "exactly one source may be reported");
        return true;
      },
    );
  });
});

test("all sixteen canonical role keys are accounted for -- mapped or pending, never missing", () => {
  assert.equal(CANONICAL_PERSONA_KEYS.length, 16);
  assert.deepEqual([...CANONICAL_PERSONA_KEYS], [...CANONICAL_ROLE_KEYS], "the old export must be the role registry");
  const directory = personaDirectory();
  assert.equal(directory.length, 16);
  for (const row of directory) {
    assert.ok(["MAPPED", "PENDING_ACCOUNT"].includes(row.state), `${row.personaId} has no state`);
    assert.match(row.email, /@sandbox\.invalid$/, `${row.personaId} must declare its address in either state`);
    assert.ok(row.jobRole, `${row.personaId} must name the Job Role it serves`);
  }
  // Fifteen accounts exist; exactly one (the reporting analyst) does not.
  assert.equal(directory.filter((r) => r.state === "MAPPED").length, 15);
  const pending = directory.filter((r) => r.state === "PENDING_ACCOUNT");
  assert.deepEqual(pending.map((r) => r.personaId), ["reportingAnalyst"]);
  assert.equal(pending[0].email, "reporting@sandbox.invalid");
  assert.equal(pending[0].uid, null, "a pending role has no uid because it has no account");
});

test("the unreconciled state is EMPTY: every canonical role now has a settled address", () => {
  // The three former members were resolved by the ruling -- financeAccounting and generalEmployee
  // name EXISTING accounts, reportingAnalyst has a settled address with its account pending. The
  // export is kept rather than deleted: an emptied state says it was emptied, not forgotten.
  assert.deepEqual(Object.keys(UNRECONCILED_PERSONAS), []);
  for (const [id, entry] of Object.entries(RETIRED_PERSONAS)) {
    assert.ok(entry.reason && entry.reason.length > 20, `${id} must carry a reason`);
    assert.ok(entry.operatorAction && entry.operatorAction.length > 20, `${id} must name the operator action that would fix it`);
    assert.doesNotMatch(entry.operatorAction, /create (a|an|the)? ?(password|credential)/i,
      `${id} must never advise creating a credential -- the gap is an authority, not a password`);
  }
});

test("a PENDING_ACCOUNT role fails closed before the credential source is read, and names what to create", () => {
  const prev = process.env[CREDENTIAL_SOURCE_ENV];
  // Deliberately unset: a pending role must be answered BY NAME, so it must not even reach the source
  // check. Otherwise the operator is told to configure a file for an account that does not exist.
  delete process.env[CREDENTIAL_SOURCE_ENV];
  try {
    assert.throws(() => loadSandboxPersona("reportingAnalyst"), (err) => {
      assert.equal(err.failureType, "PERSONA_ACCOUNT_PENDING", "a missing ACCOUNT is not a missing password");
      assert.deepEqual(err.pathsTried, [], "no path may be reported: none was tried");
      assert.match(err.message, /reporting@sandbox\.invalid/);
      assert.match(err.message, /OPERATOR ACTION:/);
      return true;
    });
  } finally {
    if (prev !== undefined) process.env[CREDENTIAL_SOURCE_ENV] = prev;
  }
});

test("a RETIRED key fails closed with an explanation, before the credential source is consulted", () => {
  const prev = process.env[CREDENTIAL_SOURCE_ENV];
  // Unset on purpose: a retired key must be answered by name. A CREDENTIAL_SOURCE_NOT_CONFIGURED here
  // would mean the loader went looking for a password for an identity that does not exist, which is
  // what sends the reader to the wrong place.
  delete process.env[CREDENTIAL_SOURCE_ENV];
  try {
    for (const id of Object.keys(RETIRED_PERSONAS)) {
      assert.throws(() => loadSandboxPersona(id), (err) => {
        assert.equal(err.failureType, "PERSONA_RETIRED", `${id} must be reported as retired, not as unknown`);
        assert.deepEqual(err.pathsTried, [], "no path may be reported: none was tried");
        assert.match(err.message, /OPERATOR ACTION:/);
        return true;
      });
    }
  } finally {
    if (prev !== undefined) process.env[CREDENTIAL_SOURCE_ENV] = prev;
  }
});

test("every alias points at a canonical key and carries no address of its own", () => {
  for (const [alias, target] of Object.entries(PERSONA_ALIASES)) {
    assert.ok(!Object.prototype.hasOwnProperty.call(SANDBOX_PERSONAS, alias),
      `${alias} is an alias and must hold no address -- an address is how a collision hides`);
    assert.ok(CANONICAL_ROLE_KEYS.includes(target),
      `${alias} -> ${target}, which is not a canonical role key`);
    assert.ok(!PERSONA_ALIASES[target], `${alias} -> ${target} is an alias chain; aliases resolve in one hop`);
    assert.equal(resolvePersonaKey(alias), target);
  }
});

test("a legacy alias reaches the reconciled identity and reports the CANONICAL key back", () => {
  withTempCredentialFile(FAKE, () => {
    const cred = loadSandboxPersona("technician");
    assert.equal(cred.personaId, "serviceTechnician", "the canonical key is returned, never the alias that was typed");
    assert.equal(cred.email, "finley.fixture@sandbox.invalid");
    assert.equal(cred.jobRole, "service-technician", "a load reports the Job Role it serves");
  });
});

test("no two persona keys share an authentication account -- one identity, one key", () => {
  const seen = new Map();
  for (const [id, email] of Object.entries(SANDBOX_PERSONAS)) {
    const clash = seen.get(email);
    assert.equal(clash, undefined, `${id} and ${clash} share ${email}; two keys for one account is how a duplicate account gets created`);
    seen.set(email, id);
  }
});

test("assigned-vs-unassigned is BUSINESS DATA, not two identities", () => {
  // The pre-consolidation catalog held two technician logins told apart by a record assignment. That
  // put a business fact inside identity: every new acceptance scenario wanted another login, and two
  // logins for one Job Role are two things to keep in step. Owner ruling 2026-09-25 collapsed them.
  //
  // There is ONE canonical technician. Scenario A assigns a Work Order to it and proves own-record
  // access; Scenario B does not and proves the denial. The ASSIGNMENT changes; the identity does not.
  assert.equal(SANDBOX_PERSONAS.technicianAssigned, undefined, "the assigned-technician key is retired");
  assert.equal(SANDBOX_PERSONAS.technicianUnassigned, undefined, "the unassigned-technician key is retired");
  assert.equal(SANDBOX_PERSONAS.serviceTechnician, "finley.fixture@sandbox.invalid");

  // The second technician account is RETAINED as history -- the Owner ruled stale accounts stay until
  // a cleanup wave authorizes deletion -- but it is noncanonical and the loader must not require it.
  const gray = NONCANONICAL_FIXTURE_IDENTITIES["gray.fixture@sandbox.invalid"];
  assert.ok(gray, "the second technician must still be recorded, not erased");
  assert.equal(gray.supersededBy, "finley.fixture@sandbox.invalid");
  assert.ok(!Object.values(SANDBOX_PERSONAS).includes("gray.fixture@sandbox.invalid"));
});

test("candidatePaths is DIAGNOSTICS ONLY and names one filename -- it no longer resolves anything", () => {
  // Retained so an operator can be SHOWN where stray copies are and which one the old loader would
  // have picked. It is not consulted when loading, which the source assertion below pins: guessing is
  // how a 70-byte stub hid a 60-entry file and got read as "these personas have no passwords".
  const paths = candidatePaths();
  for (const p of paths) assert.match(path.basename(p), /^\.?sandbox-credentials\.local\.json$/);

  const src = fs.readFileSync(new URL("../../scripts/sandboxCredentials.mjs", import.meta.url), "utf8");
  const load = src.slice(src.indexOf("export function loadSandboxPersona"), src.indexOf("export function describeLoad"));
  assert.ok(!load.includes("candidatePaths("), "loadSandboxPersona must never consult the guess list");
  assert.ok(load.includes("credentialSourcePath("), "loadSandboxPersona must resolve from the explicit source");
});

test("the module names no credential, only addresses and identifiers", () => {
  const src = fs.readFileSync(new URL("../../scripts/sandboxCredentials.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /password\s*[:=]\s*["'`][^"'`]/, "no literal password may appear in the loader");
});
