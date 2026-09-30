// EOS PERSONA SESSION FOR BROWSER HARNESSES -- offline proof, no network, no credential file.
// Run: node --test test/eosHarnessSession.test.mjs
//
// Covers the acceptance-harness cutover (category A consumers):
//   * deployedSession.mjs openEosPersonaSession -- the one shared EOS entry point: issue, seed before
//     the first app script, navigate; fail closed before touching the page; never return the token.
//   * establishSession's deployed EOS branch goes through it.
//   * scripts/adminUsersResponsiveProbe.mjs signs in ONLY through it: no SANDBOX_CREDENTIALS_FILE,
//     no password, no Identity Toolkit, and it refuses without the issuer credential.
//
// Every issuer call here is a fake `fetch`; the credential and token values are test literals.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const REPO = join(APP, "..");
const SKILL = join(APP, ".claude", "skills", "run-field-ops-app-vite");

const deployed = await import(pathToFileURL(join(SKILL, "deployedSession.mjs")).href);
const issuerClient = await import(pathToFileURL(join(REPO, "scripts", "eosPersonaSession.mjs")).href);
const probe = await import(pathToFileURL(join(APP, "scripts", "adminUsersResponsiveProbe.mjs")).href);

const BASE = "https://eos-api.test";
const CREDENTIAL = "test-issuer-credential-not-a-secret";
// A structurally valid, unsigned-looking compact token; the client never verifies it here.
const TOKEN = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ0ZXN0In0.c2ln";

function fakeIssuer({ status = 200, body } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const payload = body ?? {
      ok: true, token: TOKEN, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      personaKey: JSON.parse(init.body).personaKey, principalId: "pr-test-1",
    };
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
  };
  return { fetch, calls };
}

/** A page double that records what a harness does to it, and can present a signed-in shell. */
function fakePage({ signedIn = true } = {}) {
  const log = [];
  return {
    log,
    async addInitScript(fn, arg) { log.push({ op: "addInitScript", arg }); },
    async goto(url, opts) { log.push({ op: "goto", url, opts }); },
    locator(sel) {
      return {
        first: () => ({ waitFor: async () => { log.push({ op: "waitFor", sel }); } }),
        count: async () => (signedIn && /fo-appheader|fo-rail/.test(sel) ? 1 : 0),
        innerText: async () => (signedIn ? "Administration  Users" : "Sign in to continue"),
      };
    },
  };
}

const env = { EOS_PERSONA_ISSUER_CREDENTIAL: CREDENTIAL };

test("openEosPersonaSession issues, seeds before boot, then navigates -- and returns no token", async () => {
  issuerClient.clearEosPersonaSessionCache();
  const issuer = fakeIssuer();
  const page = fakePage();
  const opened = await deployed.openEosPersonaSession(page, "https://app.test/", "admin",
    { env, baseUrl: BASE, fetch: issuer.fetch });

  assert.equal(issuer.calls.length, 1);
  assert.equal(issuer.calls[0].url, `${BASE}/auth/nonprod/persona-session`);
  assert.equal(issuer.calls[0].init.headers["x-eos-persona-issuer-credential"], CREDENTIAL);
  // The local driver key is mapped onto the canonical persona.
  assert.equal(JSON.parse(issuer.calls[0].init.body).personaKey, "administrator");

  assert.deepEqual(page.log.map((e) => e.op), ["addInitScript", "goto"], "seed strictly before navigation");
  assert.deepEqual(page.log[0].arg, ["eos.session.v1", TOKEN]);
  assert.equal(page.log[1].url, "https://app.test/");

  assert.equal(opened.personaKey, "administrator");
  assert.equal(opened.principalId, "pr-test-1");
  assert.ok(!JSON.stringify(opened).includes(TOKEN), "the return value must never carry the token");
});

test("a canonical persona key passes through unchanged", async () => {
  issuerClient.clearEosPersonaSessionCache();
  const issuer = fakeIssuer();
  await deployed.openEosPersonaSession(fakePage(), "https://app.test/", "financeAccounting",
    { env, baseUrl: BASE, fetch: issuer.fetch });
  assert.equal(JSON.parse(issuer.calls[0].init.body).personaKey, "financeAccounting");
});

test("without the issuer credential it refuses before touching the page or the network", async () => {
  issuerClient.clearEosPersonaSessionCache();
  const issuer = fakeIssuer();
  const page = fakePage();
  await assert.rejects(
    deployed.openEosPersonaSession(page, "https://app.test/", "administrator", { env: {}, baseUrl: BASE, fetch: issuer.fetch }),
    (err) => err.code === "NO_ISSUER_CREDENTIAL",
  );
  assert.equal(issuer.calls.length, 0);
  assert.equal(page.log.length, 0);
});

test("a refused issue never seeds or navigates, and the error names no secret", async () => {
  issuerClient.clearEosPersonaSessionCache();
  const issuer = fakeIssuer({ status: 401, body: { ok: false, code: "ISSUER_CREDENTIAL_REFUSED" } });
  const page = fakePage();
  await assert.rejects(
    deployed.openEosPersonaSession(page, "https://app.test/", "administrator", { env, baseUrl: BASE, fetch: issuer.fetch }),
    (err) => {
      assert.equal(err.code, "ISSUER_CREDENTIAL_REFUSED");
      assert.ok(!err.message.includes(CREDENTIAL));
      return true;
    },
  );
  assert.equal(page.log.length, 0);
});

test("establishSession's deployed EOS branch goes through openEosPersonaSession and still asserts sign-in", () => {
  const src = readFileSync(join(SKILL, "deployedSession.mjs"), "utf8");
  const body = src.slice(src.indexOf("export async function establishSession"), src.indexOf("export async function assertSignedIn"));
  assert.match(body, /auth === "eos"\) \{[\s\S]{0,300}await openEosPersonaSession\(page, `\$\{BASE\}\/`, accountKey\);/);
  assert.ok(body.includes("await assertSignedIn(page, accountKey)"));
});

test("adminUsersResponsiveProbe signs in through the EOS persona session and nothing else", () => {
  const src = readFileSync(join(APP, "scripts", "adminUsersResponsiveProbe.mjs"), "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const forbidden of ["sandboxCredentials", "loadSandboxPersona", "signInPersona", "identitytoolkit",
    "signInWithPassword", "seedAuthenticatedSession", 'input[type="password"]', '"firebase/', "firebase-admin"]) {
    assert.ok(!code.includes(forbidden), `the probe must not contain '${forbidden}'`);
  }
  assert.ok(code.includes("openEosPersonaSession("));
  assert.ok(code.includes("assertSignedIn(page, persona)"));
  // Read-only: nothing that submits or types.
  assert.ok(!/\.click\(|\.fill\(|\.press\(/.test(code), "the probe must never click, fill or press");
});

test("the probe refuses production targets and defaults to the canonical administrator persona", () => {
  assert.equal(probe.refusesTarget("https://taylor-parts.web.app"), true);
  assert.equal(probe.refusesTarget("https://taylor-parts.firebaseapp.com"), true);
  assert.equal(probe.refusesTarget("https://nonprod-frontend.test"), false);
  const args = probe.parseProbeArgs(["--target", "https://app.test/", "--label", "after"]);
  assert.deepEqual(args, { target: "https://app.test", label: "after", persona: "administrator" });
});

test("establishProbeSession: EOS session, shell, signed-in assertion -- in that order", async () => {
  issuerClient.clearEosPersonaSessionCache();
  const issuer = fakeIssuer();
  const page = fakePage();
  const opened = await probe.establishProbeSession(page,
    { target: "https://app.test", persona: "administrator", env, baseUrl: BASE, fetch: issuer.fetch });
  assert.equal(opened.personaKey, "administrator");
  assert.deepEqual(page.log.map((e) => e.op), ["addInitScript", "goto", "waitFor"]);
  assert.equal(page.log[1].url, "https://app.test/");
  assert.equal(page.log[2].sel, probe.SHELL_SELECTOR);
});

test("establishProbeSession refuses without the credential, before any page action", async () => {
  const page = fakePage();
  await assert.rejects(
    probe.establishProbeSession(page, { target: "https://app.test", persona: "administrator", env: {} }),
    /EOS_PERSONA_ISSUER_CREDENTIAL is not set/,
  );
  assert.equal(page.log.length, 0);
});

test("establishProbeSession refuses loudly when the page is the sign-in screen", async () => {
  issuerClient.clearEosPersonaSessionCache();
  const issuer = fakeIssuer();
  await assert.rejects(
    probe.establishProbeSession(fakePage({ signedIn: false }),
      { target: "https://app.test", persona: "administrator", env, baseUrl: BASE, fetch: issuer.fetch }),
    /NOT SIGNED IN/,
  );
});

// ============================ Controller rulings, 2026-09-29 (harness cutover close) ============================
// Authentication must match the backend a harness tests. establishSession has NO implicit mode, so a Firebase-backed
// sweep can never silently become an EOS run (and fail by design) just because the issuer credential is present.
const skillFile = (name) => readFileSync(join(SKILL, name), "utf8");
const repoRoot = join(APP, "..");

test("establishSession requires an explicit auth mode and has no silent EOS/Firebase fallback", () => {
  const src = skillFile("deployedSession.mjs");
  assert.match(src, /establishSession requires auth: "firebase" \| "eos"/);
  assert.match(src, /auth === "eos"[\s\S]{0,200}requires EOS_PERSONA_ISSUER_CREDENTIAL/);
  // the old implicit switch on credential presence is gone
  assert.doesNotMatch(src, /else if \(eosPersonaSessionAvailable\(\)\)/);
});

for (const harness of ["certify.mjs", "certifyDynamic.mjs", "createReach.mjs", "reachability.mjs"]) {
  test(`${harness} is pinned to Firebase (its journeys still read Firestore / call Firebase Functions)`, () => {
    const src = skillFile(harness);
    const calls = src.match(/establishSession\(page, \{[^}]*\}\)/g) ?? [];
    assert.ok(calls.length > 0, "calls establishSession");
    for (const c of calls) assert.match(c, /auth: "firebase"/, c);
  });
}

test("financialsNorthStarQuickGate and personaSweep stay Firebase-only (no EOS path)", () => {
  const gate = skillFile("financialsNorthStarQuickGate.mjs");
  const sweep = readFileSync(join(APP, "scripts", "personaSweep.mjs"), "utf8");
  for (const src of [gate, sweep]) {
    assert.doesNotMatch(src, /openEosPersonaSession|issueEosPersonaSession|seedEosSession|auth: "eos"/);
  }
});

test("the obsolete adminUserEditRolesProbe is deleted and nothing references it", () => {
  let exists = true;
  try { readFileSync(join(APP, "scripts", "adminUserEditRolesProbe.mjs")); } catch { exists = false; }
  assert.equal(exists, false);
  for (const f of [join(repoRoot, "docs", "architecture", "repo-graph.json"), join(APP, "src", "index.css"), join(APP, "test", "suites.json")]) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /adminUserEditRolesProbe/, f);
  }
});
