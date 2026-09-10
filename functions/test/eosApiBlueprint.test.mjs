// THE NON-PRODUCTION BLUEPRINT — proofs about the file that stands the environment up.
//
// render.yaml is the only description of the deployed non-production environment, and it is read by
// Render, not by this repository, so nothing else here would notice it going wrong. These
// assertions exist because the identity block as first written WOULD HAVE FAILED THE FIRST
// AUTHENTICATED REQUEST: it declared GOOGLE_APPLICATION_CREDENTIALS_JSON, which nothing reads --
// `firebase-admin` reads GOOGLE_APPLICATION_CREDENTIALS, a FILE PATH, and there is no inline
// `_JSON` variant -- while leaving GOOGLE_CLOUD_PROJECT to be typed into a dashboard, which is the
// variable verification actually needs.
//
// The behaviour behind that claim is measured here too, against the real firebase-admin with no
// credential present. That is the part worth re-running: the rest is configuration, but "token
// verification needs no service-account key" is a claim about a library, and libraries change.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RAW = readFileSync(new URL("../../render.yaml", import.meta.url), "utf8");
const LINES = RAW.split(/\r?\n/).filter((line) => !/^\s*#/.test(line));

// A tiny reader rather than a YAML library. This repository declares no YAML parser, and js-yaml is
// present only transitively through jest -- a dependency this test would be quietly relying on
// until a hoist changed and it vanished. The file's shape is flat, known, and ours.
const scalar = (key) => {
  const prefix = key + ":";
  const hit = LINES.find((line) => line.trim().startsWith(prefix) && line.trim().length > prefix.length);
  if (hit === undefined) return undefined;
  // YAML inline comments: a value ends at whitespace-then-#.
  return hit.trim().slice(prefix.length).replace(/\s+#.*$/, "").trim();
};

/** Every `- key: X` entry under envVars, with the indented lines belonging to it. */
function readEnvVars() {
  const start = LINES.findIndex((line) => /^\s*envVars:\s*$/.test(line));
  const entries = [];
  for (let i = start + 1; i < LINES.length; i += 1) {
    const named = /^\s*- key:\s*(\S+)\s*$/.exec(LINES[i]);
    if (named) {
      entries.push({ key: named[1], body: [] });
      continue;
    }
    if (entries.length === 0) continue;
    if (LINES[i].trim() && !/^\s/.test(LINES[i])) break;
    entries[entries.length - 1].body.push(LINES[i]);
  }
  return entries.map(({ key, body }) => {
    const text = body.join("\n");
    const value = /^\s*value:\s*(.+)$/m.exec(text);
    const fromDatabase = /^\s*fromDatabase:/m.test(text) ? /^\s*name:\s*(\S+)/m.exec(text) : null;
    return {
      key,
      value: value === null ? undefined : value[1].trim(),
      sync: /^\s*sync:\s*false\s*$/m.test(text) ? false : undefined,
      fromDatabase: fromDatabase === null ? undefined : { name: fromDatabase[1] },
    };
  });
}

const ENV_VARS = readEnvVars();
const envOf = (key) => ENV_VARS.find((v) => v.key === key);

// ============================ identity ============================

test("GOOGLE_CLOUD_PROJECT is declared with a value, not left to a dashboard", () => {
  // It is not a secret -- a Firebase project id is public -- and it is the one variable
  // `verifyIdToken` refuses to run without.
  const v = envOf("GOOGLE_CLOUD_PROJECT");
  assert.ok(v, "GOOGLE_CLOUD_PROJECT must be declared");
  assert.equal(v.value, "eos-platform-sandbox");
  assert.notEqual(v.sync, false, "prompting for it invites a typo in the one value identity needs");
});

test("THE NON-PRODUCTION PROJECT, AND NOT THE OTHER TWO", () => {
  // `taylor-parts` is the customer's production project and `eos-platform-certification` is
  // Certification. Either one CONFIGURED here would point a writable non-production service at an
  // identity boundary it must never cross.
  //
  // Values, not file text: the comments in render.yaml deliberately NAME the two forbidden
  // projects, and a test that grepped the whole file would forbid saying so -- deleting the
  // warning rather than the danger.
  const configured = ENV_VARS.map((v) => String(v.value ?? "")).join(" ");
  assert.doesNotMatch(configured, /taylor-parts(?!-preview)/, "production Firebase project");
  assert.doesNotMatch(configured, /eos-platform-certification/, "Certification project");
});

test("NO SERVICE-ACCOUNT KEY IS ASKED FOR — because none is read", () => {
  assert.equal(envOf("GOOGLE_APPLICATION_CREDENTIALS_JSON"), undefined, "nothing reads this key");
  assert.equal(envOf("GOOGLE_APPLICATION_CREDENTIALS"), undefined, "and no key file is mounted");
});

test("verifyIdToken needs the project id and NO credential — measured, not assumed", async () => {
  // A structurally valid JWT signed by nobody. Reaching "kid does not correspond to a known public
  // key" proves the SDK got past credential resolution and fetched Google's public certificates;
  // failing earlier with a credential complaint would prove the opposite.
  const seg = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const token = [
    seg({ alg: "RS256", kid: "none", typ: "JWT" }),
    seg({
      aud: "eos-platform-sandbox",
      iss: "https://securetoken.google.com/eos-platform-sandbox",
      sub: "subject",
      iat: 1,
      exp: 9999999999,
    }),
    "signature",
  ].join(".");

  const imported = await import("firebase-admin");
  const admin = imported.default ?? imported;
  const app = admin.apps?.length ? admin.app() : admin.initializeApp();

  const saved = process.env.GOOGLE_CLOUD_PROJECT;
  try {
    process.env.GOOGLE_CLOUD_PROJECT = envOf("GOOGLE_CLOUD_PROJECT").value;
    await assert.rejects(
      () => app.auth().verifyIdToken(token),
      /kid|public key/i,
      "verification reached public-key checking with no credential present",
    );
  } finally {
    if (saved === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = saved;
  }
});

// ============================ the rest of the contract ============================

test("no wildcard origin, and the allowed origin is the real preview domain", () => {
  const v = envOf("EOS_ALLOWED_ORIGINS");
  assert.equal(v.value, "https://taylor-parts-preview.vercel.app");
  assert.doesNotMatch(v.value, /\*/, "readServiceConfig refuses a '*' anyway; do not send one");
});

test("this environment is non-production, and says so in the process, not just in names", () => {
  assert.equal(envOf("EOS_ENVIRONMENT").value, "nonprod");
});

test("the database connection string is injected, never written here", () => {
  const v = envOf("DATABASE_URL");
  assert.equal(v.fromDatabase?.name, "eos-policy-nonprod");
  assert.equal(v.value, undefined);
});

test("NO SECRET IS PROMPTED FOR AT ALL — the Blueprint stands the environment up alone", () => {
  assert.deepEqual(ENV_VARS.filter((v) => v.sync === false), []);
});

test("migrations run in the deploy phase, not in the build", () => {
  // A build that migrates ties schema mutation to artifact construction, so rebuilding an old
  // commit would re-migrate.
  assert.equal(scalar("preDeployCommand"), "npm run migrate:up");
  assert.doesNotMatch(scalar("buildCommand"), /migrate/);
  // --include=dev is load-bearing: Render sets NODE_ENV=production, under which npm omits
  // devDependencies, where `typescript` correctly lives.
  assert.match(scalar("buildCommand"), /--include=dev/);
});

test("nothing is provisioned that the platform did not ask for", () => {
  assert.equal(LINES.some((line) => /^workers:/.test(line)), false);
  assert.equal(LINES.some((line) => /^cronJobs:/.test(line)), false);
  assert.equal(scalar("numInstances"), undefined, "no replicas");
  assert.equal(scalar("ipAllowList"), "[]", "the database is not reachable from the internet");
});
