import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SANDBOX_PERSONAS,
  CredentialAccessError,
  candidatePaths,
  parseCredentials,
  loadSandboxPersona,
  describeLoad,
} from "../../scripts/sandboxCredentials.mjs";

const FAKE = '"dispatcher@sandbox.invalid": "Sbx!fictional-value-01",\n"tech@sandbox.invalid": "Sbx!fictional-value-02"';

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
  assert.equal(table["tech@sandbox.invalid"], "Sbx!fictional-value-02");
});

test("parses a proper JSON object too", () => {
  const table = parseCredentials('{"dispatcher@sandbox.invalid": "Sbx!fictional-value-01"}');
  assert.equal(table["dispatcher@sandbox.invalid"], "Sbx!fictional-value-01");
});

test("a trailing comma does not defeat the parse", () => {
  const table = parseCredentials(`${FAKE},\n`);
  assert.equal(table["tech@sandbox.invalid"], "Sbx!fictional-value-02");
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
  withTempCredentialFile('"tech@sandbox.invalid": "Sbx!fictional-value-02"', () => {
    assert.throws(() => loadSandboxPersona("dispatcher"), (err) => {
      assert.equal(err.failureType, "PERSONA_NOT_IN_FILE");
      return true;
    });
  });
});

test("errors never carry the credential value", () => {
  withTempCredentialFile('"tech@sandbox.invalid": "Sbx!fictional-value-02"', () => {
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
