import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SANDBOX_PERSONAS,
  CANONICAL_PERSONA_KEYS,
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

// Fictional values against the RECONCILED addresses: the dispatcher persona is the Sample
// Company login emerson.fixture@, not the retired dispatcher@ that no Principal ever held.
const FAKE = '"emerson.fixture@sandbox.invalid": "Sbx!fictional-value-01",\n"finley.fixture@sandbox.invalid": "Sbx!fictional-value-02"';

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
  assert.equal(table["emerson.fixture@sandbox.invalid"], "Sbx!fictional-value-01");
  assert.equal(table["finley.fixture@sandbox.invalid"], "Sbx!fictional-value-02");
});

test("parses a proper JSON object too", () => {
  const table = parseCredentials('{"emerson.fixture@sandbox.invalid": "Sbx!fictional-value-01"}');
  assert.equal(table["emerson.fixture@sandbox.invalid"], "Sbx!fictional-value-01");
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
    assert.equal(cred.email, "emerson.fixture@sandbox.invalid");
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
      email: "emerson.fixture@sandbox.invalid",
      passwordLength: "Sbx!fictional-value-01".length,
      loaded: true,
    });
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
 * The twelve retired `sbx-*`-era addresses: every one had no live EOS Principal, and nine of
 * them collided by NAME with a persona that does exist. The thirteenth legacy entry,
 * `admin@sandbox.invalid`, is deliberately ABSENT from this list -- it is the one that was
 * always correct: the reused pre-existing sandbox Administrator, Principal subject
 * ZVu3lHTP1NQhj0Am04zTAGou0dx1.
 */
const RETIRED_ADDRESSES = [
  "owner@sandbox.invalid",
  "dispatcher@sandbox.invalid",
  "tech@sandbox.invalid",
  "whmgr@sandbox.invalid",
  "partsmgr@sandbox.invalid",
  "partsassoc@sandbox.invalid",
  "fieldmgr@sandbox.invalid",
  "mikael@sandbox.invalid",
  "opsmgr@sandbox.invalid",
  "salesmgr@sandbox.invalid",
  "acctmgr@sandbox.invalid",
  "restricted@sandbox.invalid",
];

test("no persona key resolves to a retired address -- the collision that returned the wrong identity", () => {
  for (const [id, email] of Object.entries(SANDBOX_PERSONAS)) {
    assert.ok(
      !RETIRED_ADDRESSES.includes(email),
      `${id} still points at ${email}, which no live EOS Principal is behind. A name collision against a live persona is a defect, not an alias.`,
    );
  }
});

test("all sixteen canonical keys are accounted for, as mapped or as unreconciled -- never missing", () => {
  assert.equal(CANONICAL_PERSONA_KEYS.length, 16);
  const directory = personaDirectory();
  assert.equal(directory.length, 16);
  for (const row of directory) {
    assert.ok(["MAPPED", "UNRECONCILED"].includes(row.state), `${row.personaId} has no state`);
    if (row.state === "MAPPED") assert.match(row.email, /@sandbox\.invalid$/);
    else assert.equal(row.email, null, `${row.personaId} is unreconciled and must offer NO address`);
  }
  assert.equal(directory.filter((r) => r.state === "MAPPED").length, 13);
});

test("the three unreconciled keys are exactly the ones with no live Principal, each with a reason and an operator action", () => {
  assert.deepEqual(Object.keys(UNRECONCILED_PERSONAS).sort(), ["financeAccounting", "reporting", "restricted"]);
  for (const [id, entry] of Object.entries({ ...UNRECONCILED_PERSONAS, ...RETIRED_PERSONAS })) {
    assert.ok(entry.reason && entry.reason.length > 20, `${id} must carry a reason`);
    assert.ok(entry.operatorAction && entry.operatorAction.length > 20, `${id} must name the operator action that would fix it`);
    assert.doesNotMatch(entry.operatorAction, /create (a|an|the)? ?(password|credential)/i,
      `${id} must never advise creating a credential -- the gap is an authority, not a password`);
  }
});

test("an unreconciled persona fails closed BEFORE the credential file is consulted", () => {
  // Point the loader at a path that does not exist. A FILE_NOT_FOUND here would mean the
  // loader went looking for a password for an identity that does not exist -- which is what
  // sends the reader to the wrong place.
  const prev = process.env.SANDBOX_CREDENTIALS_FILE;
  process.env.SANDBOX_CREDENTIALS_FILE = path.join(os.tmpdir(), "definitely-absent", "sandbox-credentials.local.json");
  try {
    for (const id of Object.keys(UNRECONCILED_PERSONAS)) {
      assert.throws(() => loadSandboxPersona(id), (err) => {
        assert.equal(err.failureType, "PERSONA_UNRECONCILED", `${id} must not be reported as a missing password`);
        assert.deepEqual(err.pathsTried, [], "no path may be reported: none was tried");
        assert.match(err.message, /OPERATOR ACTION:/);
        return true;
      });
    }
    for (const id of Object.keys(RETIRED_PERSONAS)) {
      assert.throws(() => loadSandboxPersona(id), (err) => {
        assert.equal(err.failureType, "PERSONA_RETIRED", `${id} must be reported as retired, not as unknown`);
        return true;
      });
    }
  } finally {
    if (prev === undefined) delete process.env.SANDBOX_CREDENTIALS_FILE;
    else process.env.SANDBOX_CREDENTIALS_FILE = prev;
  }
});

test("every alias points at a canonical key and carries no address of its own", () => {
  for (const [alias, target] of Object.entries(PERSONA_ALIASES)) {
    assert.ok(!Object.prototype.hasOwnProperty.call(SANDBOX_PERSONAS, alias),
      `${alias} is an alias and must hold no address -- an address is how a collision hides`);
    assert.ok(SANDBOX_PERSONAS[target] || UNRECONCILED_PERSONAS[target],
      `${alias} -> ${target}, which is not a key this module knows`);
    assert.ok(!PERSONA_ALIASES[target], `${alias} -> ${target} is an alias chain; aliases resolve in one hop`);
    assert.equal(resolvePersonaKey(alias), target);
  }
});

test("a legacy alias reaches the reconciled identity and reports the CANONICAL key back", () => {
  withTempCredentialFile(FAKE, () => {
    const cred = loadSandboxPersona("technician");
    assert.equal(cred.personaId, "technicianAssigned", "the canonical key is returned, never the alias that was typed");
    assert.equal(cred.email, "finley.fixture@sandbox.invalid");
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

test("the assigned and unassigned technicians are two DIFFERENT live accounts", () => {
  assert.notEqual(SANDBOX_PERSONAS.technicianAssigned, SANDBOX_PERSONAS.technicianUnassigned,
    "the pair exists to differ by record assignment; one account cannot be both sides of it");
});

test("the operator's own credential location is searched, under the one canonical filename", () => {
  const paths = candidatePaths();
  assert.ok(paths.some((p) => p.includes(`${path.sep}.eos-sandbox${path.sep}`)),
    "the only credential file on the primary host lives in ~/.eos-sandbox; a correctly spelled persona must not fail FILE_NOT_FOUND while the file sits on disk");
  for (const p of paths) assert.match(path.basename(p), /^\.?sandbox-credentials\.local\.json$/);
});

test("the module names no credential, only addresses and identifiers", () => {
  const src = fs.readFileSync(new URL("../../scripts/sandboxCredentials.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /password\s*[:=]\s*["'`][^"'`]/, "no literal password may appear in the loader");
});
