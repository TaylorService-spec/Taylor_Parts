// EI Phase-2 Receiving -- Gate E2-V: OFFLINE proof of the raw->sanitized Functions-inventory operator path
// (P1-3). No network, no production.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const cli = require("../scripts/functionsInventorySanitizeCli.js");

let passed = 0, failed = 0;
async function check(name, fn) { try { await fn(); passed += 1; console.log(`PASS: ${name}`); } catch (e) { failed += 1; console.error(`FAIL: ${name}`); console.error(e); } }

const RAW = JSON.stringify([
  { name: "projects/p/locations/us-central1/functions/zeta", state: "ACTIVE", buildConfig: { entryPoint: "zeta", runtime: "nodejs20" }, serviceConfig: { serviceAccountEmail: "svc@secret", uri: "https://zeta", environmentVariables: { API_KEY: "AIzaSECRET" } }, updateTime: "T2" },
  { name: "projects/p/locations/us-central1/functions/alpha", state: "ACTIVE", buildConfig: { entryPoint: "alpha", runtime: "nodejs20" }, updateTime: "T1" },
]);

await check("sanitizeInventory: only allowlisted fields, sorted by name, drops all secrets/metadata", () => {
  const { inventory, count, text } = cli.sanitizeInventory(RAW);
  assert.equal(count, 2);
  assert.deepEqual(inventory.map((f) => f.name), ["alpha", "zeta"]); // sorted
  for (const f of inventory) assert.deepEqual(Object.keys(f).sort(), ["entryPoint", "name", "region", "runtime", "state", "updateTime"]);
  assert.equal(inventory[1].region, "us-central1");
  // No secret/metadata leaks anywhere in the emitted text.
  for (const needle of ["svc@secret", "AIzaSECRET", "environmentVariables", "serviceConfig", "uri", "https://"]) assert.equal(text.includes(needle), false, needle);
});

await check("sanitizeInventory FAILS CLOSED: non-array / bad JSON", () => {
  assert.throws(() => cli.sanitizeInventory("{}"));
  assert.throws(() => cli.sanitizeInventory("{not json"));
});

await check("run(): --in -> --out writes the sanitized inventory via injected fs", async () => {
  const files = new Map();
  const deps = { readFileSync: (p) => (p === "raw.json" ? RAW : (() => { throw new Error("ENOENT"); })()), writeFileSync: (p, c) => files.set(p, c), writeStdout: () => { throw new Error("should write file"); }, readStdin: async () => { throw new Error("no stdin"); } };
  const r = await cli.run(deps, ["--in", "raw.json", "--out", "sanitized.json"]);
  assert.equal(r.count, 2);
  const out = files.get("sanitized.json");
  assert.equal(out.includes("svc@secret"), false);
  assert.equal(JSON.parse(out)[0].name, "alpha");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
