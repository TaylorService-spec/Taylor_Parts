// Firebase exit B2 -- BUILT-ARTIFACT PROOF for the EOS-only sign-in build.
//
// Builds the app the way the operator's Vercel project will (VITE_ENVIRONMENT_ID=platform-sandbox, VITE_AUTH_SOURCE=eos) into a
// throwaway directory, and asserts on the OUTPUT: the environment's Firebase project identity -- its apiKey, projectId,
// authDomain, storage bucket, messaging sender and app id, all read from config/environments.json -- appears NOWHERE in the
// emitted files. "No Firebase config is in the bundle" is a statement about the artifact, so it is asserted on the artifact.
// (The Firebase SDK's own code may still be bundled; what is absent is any app to initialise and any config to initialise it.)
//
// It also builds the ordinary Firebase-sign-in bundle of the same environment and requires the identity to be PRESENT there, so
// the absence above cannot be a vacuous pass of a scan that finds nothing anywhere.
//
// Run: npm run verify:eos-only  (from field-ops-app-vite/)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const appDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const registry = JSON.parse(fs.readFileSync(path.join(appDir, "..", "config", "environments.json"), "utf8"));
const env = registry.environments.find((e) => e.id === "platform-sandbox");
assert.ok(env?.firebase && env.authSources?.includes("eos"), "platform-sandbox declares a Firebase identity and the eos auth source");
// The bare project id also appears in prose (a measurement note in one Administration screen names the environment), so it is
// searched for only as a CONFIG PROPERTY (`projectId: "..."`); the other five values are unique strings searched for verbatim.
const identity = ["apiKey", "authDomain", "storageBucket", "messagingSenderId", "appId"].map((k) => env.firebase[k]);
assert.ok(identity.every((v) => typeof v === "string" && v.length >= 8), "every identity value is long enough to search for");
// (The minifier writes string literals with backticks, double or single quotes; accept any.)
const projectIdProperty = new RegExp(`projectId["'\`]?\\s*:\\s*["'\`]${env.firebase.projectId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`);

function build(extraEnv) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "eos-only-build-"));
  execSync(`npx vite build --outDir "${out}" --emptyOutDir`, {
    cwd: appDir,
    stdio: "inherit",
    env: { ...process.env, VITE_ENVIRONMENT_ID: "platform-sandbox", VITE_EOS_API_BASE_URL: "https://eos-api-nonprod.onrender.com", ...extraEnv },
  });
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|css|html|json|map)$/.test(e.name)) files.push(p);
    }
  };
  walk(out);
  const text = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  fs.rmSync(out, { recursive: true, force: true });
  return text;
}

const firebaseBuild = build({ VITE_AUTH_SOURCE: "firebase" });
for (const value of identity) {
  assert.ok(firebaseBuild.includes(value), `the ordinary build must carry the Firebase identity (${value.slice(0, 6)}...): otherwise this scan proves nothing`);
}

assert.ok(projectIdProperty.test(firebaseBuild), "the ordinary build must carry projectId as a config property");

const eosBuild = build({ VITE_AUTH_SOURCE: "eos" });
assert.ok(!projectIdProperty.test(eosBuild), "the EOS-only build must NOT carry projectId as a config property");
for (const value of identity) {
  assert.ok(!eosBuild.includes(value), `the EOS-only build must NOT contain the Firebase identity value (${value.slice(0, 6)}...)`);
}
assert.ok(eosBuild.includes("eos-api-nonprod.onrender.com"), "the EOS-only build points at the EOS API");

console.log("verify:eos-only OK -- the EOS-only bundle carries none of the Firebase identity values (apiKey, projectId property, authDomain, storageBucket, messagingSenderId, appId); the ordinary bundle carries all of them");
