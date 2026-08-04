"use strict";

// EI Phase-2 Receiving -- Gate E2-V: operator path that #554 invokes to extract + hash the live Firestore
// Rules source STRICTLY (P2-2). Reads a Firebase Rules `GetRelease`/ruleset API JSON payload (the
// {source:{files:[...]}} object) from a file or stdin, requires EXACTLY one source file named
// firestore.rules with valid content (rejecting extra files, wrong names, malformed content -- no silent
// files[0] fallback), and prints the sha256 of that content. INERT on import; no network, no production.
// Use for BOTH the pre-deploy baseline and the post-deploy verification hash in the runbook.

const { VerificationError, sha256 } = require("./firestoreDeploymentVerificationShared");
const { extractRulesSourceStrict } = require("./verifyReceivingE2Deployment");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith("--")) throw new VerificationError(`unexpected argument: ${t}`);
    const k = t.slice(2); const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new VerificationError(`--${k} requires a value`);
    args[k] = v; i += 1;
  }
  return args; // --in <path> optional; otherwise stdin
}

// Pure: raw API JSON text -> { contentSha256, byteLength }. Fails closed on malformed structure/content.
function hashRulesPayload(rawJson) {
  let payload;
  try { payload = JSON.parse(rawJson); } catch { throw new VerificationError("Rules API payload is not valid JSON"); }
  const content = extractRulesSourceStrict(payload);
  return { contentSha256: sha256(content), byteLength: Buffer.byteLength(content, "utf8") };
}

async function run(deps, argv) {
  const args = parseArgs(argv);
  const raw = args.in ? deps.readFileSync(args.in, "utf8") : await deps.readStdin();
  return hashRulesPayload(raw);
}

module.exports = { parseArgs, hashRulesPayload, run };

if (require.main === module) {
  const fs = require("node:fs");
  const deps = {
    readFileSync: (p, e) => fs.readFileSync(p, e),
    readStdin: () => new Promise((resolve, reject) => { let d = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (c) => { d += c; }); process.stdin.on("end", () => resolve(d)); process.stdin.on("error", reject); }),
  };
  run(deps, process.argv.slice(2))
    .then((r) => { console.log(JSON.stringify({ ok: true, ...r }, null, 2)); process.exitCode = 0; })
    .catch((err) => { console.error(`RULES SOURCE HASH CLI FAILURE: ${err.message}`); process.exitCode = 2; });
}
