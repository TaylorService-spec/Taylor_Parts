// EI Phase-2 Receiving -- Gate E2-V: OFFLINE proof of the wired strict Rules-source extract+hash operator
// path (P2-2). No network, no production.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const cli = require("../scripts/firestoreRulesSourceHashCli.js");

let passed = 0, failed = 0;
async function check(name, fn) { try { await fn(); passed += 1; console.log(`PASS: ${name}`); } catch (e) { failed += 1; console.error(`FAIL: ${name}`); console.error(e); } }

const RULES = "rules_version = '2';\nservice cloud.firestore { match /databases/{db}/documents { } }\n";
const payload = (files) => JSON.stringify({ name: "projects/taylor-parts/rulesets/abc", source: { files } });

await check("hashRulesPayload: exactly one firestore.rules -> content sha256", () => {
  const r = cli.hashRulesPayload(payload([{ name: "firestore.rules", content: RULES }]));
  assert.equal(r.contentSha256, createHash("sha256").update(RULES).digest("hex"));
  assert.equal(r.byteLength, Buffer.byteLength(RULES, "utf8"));
});

await check("hashRulesPayload FAILS CLOSED: extra file / wrong name / empty / malformed / bad JSON", () => {
  assert.throws(() => cli.hashRulesPayload(payload([{ name: "a.rules", content: "x" }, { name: "firestore.rules", content: RULES }])));
  assert.throws(() => cli.hashRulesPayload(payload([{ name: "other.rules", content: RULES }])));
  assert.throws(() => cli.hashRulesPayload(payload([])));
  assert.throws(() => cli.hashRulesPayload(payload([{ name: "firestore.rules", content: "not-rules" }])));
  assert.throws(() => cli.hashRulesPayload("{not json"));
});

await check("run(): reads --in via injected fs and hashes", async () => {
  const deps = { readFileSync: (p) => (p === "rules.json" ? payload([{ name: "firestore.rules", content: RULES }]) : (() => { throw new Error("ENOENT"); })()), readStdin: async () => { throw new Error("should not read stdin"); } };
  const r = await cli.run(deps, ["--in", "rules.json"]);
  assert.equal(r.contentSha256, createHash("sha256").update(RULES).digest("hex"));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
