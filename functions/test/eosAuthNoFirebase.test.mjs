// THE EOS IDENTITY PATH IS FIREBASE-FREE AND SECRET-FREE, and the Firebase-exit census records Firebase Auth as
// TRANSITIONAL. docs/architecture/eos-identity-session-foundation.md, proofs 15 (static half), 16 (source half)
// and 17. Static only: reads source files, loads no SDK, contacts nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const read = (rel) => readFileSync(join(REPO_ROOT, rel), "utf8");

const EOS_AUTH_SRC = readdirSync(join(REPO_ROOT, "functions/src/eosAuth")).filter((f) => f.endsWith(".ts")).map((f) => `functions/src/eosAuth/${f}`);
/** Every module on the EOS token path: issuer, verifier, config, transport, binding CLI, harness client, client token source. */
const EOS_PATH_FILES = Object.freeze([
  ...EOS_AUTH_SRC,
  "functions/scripts/bindPrincipalEosIdentity.js",
  "scripts/eosPersonaSession.mjs",
  "field-ops-app-vite/src/auth/eosSession.js",
  "field-ops-app-vite/src/auth/eosSessionIdentity.js",
]);

/** Every module specifier a source file loads (static import/export-from, dynamic import, require). */
function specifiersOf(source) {
  const text = source.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const out = new Set();
  for (const re of [/\bfrom\s*["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, /\brequire\(\s*["']([^"']+)["']\s*\)/g, /^\s*import\s*["']([^"']+)["']/gm]) {
    for (const m of text.matchAll(re)) out.add(m[1]);
  }
  return [...out];
}

const FORBIDDEN = /^(firebase|firebase-admin|firebase-functions|@firebase\/|@google-cloud\/|google-auth-library|gcp-metadata|googleapis|jose|jsonwebtoken)(\/|$)/;

test("15. no module on the EOS identity path imports a Firebase, Google or JWT package", () => {
  assert.ok(EOS_AUTH_SRC.length >= 5, `expected the eosAuth modules, found ${EOS_AUTH_SRC.length}`);
  for (const file of EOS_PATH_FILES) {
    const specs = specifiersOf(read(file));
    const bad = specs.filter((s) => FORBIDDEN.test(s));
    assert.deepEqual(bad, [], `${file} imports ${bad.join(", ")}`);
    // Nor does it reach the Firebase shim modules by path.
    const shim = specs.filter((s) => /firebase\/firebase(\.js)?$|\/firebase$/.test(s));
    assert.deepEqual(shim, [], `${file} imports a Firebase shim ${shim.join(", ")}`);
  }
});

test("15. the EOS verifier/issuer modules use only node: built-ins and each other (no new dependency)", () => {
  for (const file of EOS_AUTH_SRC) {
    for (const s of specifiersOf(read(file))) {
      assert.ok(s.startsWith("node:") || s.startsWith("./") || s.startsWith("../adminPolicy/"), `${file}: unexpected dependency '${s}'`);
    }
  }
  const pkg = JSON.parse(read("functions/package.json"));
  for (const dep of ["jose", "jsonwebtoken"]) {
    assert.equal(pkg.dependencies?.[dep] ?? pkg.devDependencies?.[dep], undefined, `${dep} was added as a dependency`);
  }
});

test("16. no key material, credential or token literal in the EOS path source, the docs or render.yaml", () => {
  const files = [...EOS_PATH_FILES, "docs/architecture/eos-identity-session-foundation.md", "render.yaml",
    "functions/migrations/1764200000000_eos-principal-identities.sql"];
  for (const file of files) {
    const text = read(file);
    assert.doesNotMatch(text, /-----BEGIN [A-Z ]*PRIVATE KEY-----\s*\n?\s*[A-Za-z0-9+/]{20,}/, `${file}: a PEM private key body`);
    assert.doesNotMatch(text, /"d"\s*:\s*"[A-Za-z0-9_-]{20,}"/, `${file}: a private JWK member`);
    assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/, `${file}: a token literal`);
  }
  // The new secrets are NOT declared in render.yaml: setting them is an operator act, not a merge side effect.
  const render = read("render.yaml");
  for (const name of ["EOS_AUTH_SIGNING_KEY_NONPROD", "EOS_PERSONA_ISSUER_CREDENTIAL_SHA256", "EOS_AUTH_VERIFY_KEYS"]) {
    assert.equal(render.includes(name), false, `render.yaml declares ${name}`);
  }
  // The client token source never names a server secret.
  for (const file of ["field-ops-app-vite/src/auth/eosSession.js", "field-ops-app-vite/src/auth/eosSessionIdentity.js"]) {
    assert.doesNotMatch(read(file), /EOS_AUTH_SIGNING|PERSONA_ISSUER_CREDENTIAL|privateKey/, file);
  }
});

test("17. the Firebase-exit census classifies Firebase Auth as a TRANSITIONAL ACTIVE dependency, and its count does not grow", () => {
  const manifest = JSON.parse(read("docs/architecture/firebase-exit-manifest.json"));
  const identity = manifest.classification.IDENTITY_ONLY;
  assert.equal(identity.exitStatus, "TRANSITIONAL_ACTIVE_PENDING_RETIREMENT");
  assert.equal(identity.exitLedger.id, "FX-AUTH-001");
  assert.equal(identity.exitLedger.status, "TRANSITIONAL_ACTIVE");
  assert.equal(identity.exitLedger.replacement, "docs/architecture/eos-identity-session-foundation.md");
  assert.equal(identity.trendsToZero, true);

  const baseline = JSON.parse(read("docs/architecture/firebase-exit-baseline.json"));
  assert.deepEqual(baseline.authority.firebaseAllowedAfterExit, [], "Firebase Auth is no longer a post-exit carve-out");
  const pinned = identity.exitLedger.baselineCountAtClassification;
  let total = 0;
  for (const key of identity.baselineKeys) {
    const [section, name] = key.split(".");
    const files = baseline.baseline[section]?.[name] ?? [];
    assert.ok(files.length <= pinned[key], `${key} grew: ${files.length} > ${pinned[key]}`);
    total += files.length;
  }
  assert.ok(total <= pinned.total, `Firebase Auth dependency count grew: ${total} > ${pinned.total}`);
  assert.equal(pinned.total, 7);
  // No EOS path file is in any Firebase bucket.
  const all = Object.values(baseline.baseline).flatMap((s) => Object.values(s).flat());
  for (const file of EOS_PATH_FILES) assert.equal(all.includes(file), false, `${file} is in the Firebase baseline`);
});
