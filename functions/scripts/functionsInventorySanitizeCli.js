"use strict";

// EI Phase-2 Receiving -- Gate E2-V: sanitize a raw `gcloud functions list --format json` payload into the
// bounded, distributable inventory the exact-delta verifier needs -- EXACTLY {name, region, state,
// entryPoint, runtime, updateTime} per function, dropping every other operational field (env-var
// names/values, service config, service-account identifiers, URIs, labels, build metadata). The RAW
// inventory is an access-controlled operator artifact kept OUTSIDE the sanitized evidence tarball; THIS
// output is the safe-to-package, hash-bound `--pre-deploy-inventory` input. Pure transform via the reviewed
// core normalizer; INERT on import; no network, no production.

const { VerificationError } = require("./firestoreDeploymentVerificationShared");
const { normalizeGcloudInventory } = require("./verifyReceivingE2Deployment");

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

// Pure: raw gcloud JSON text -> deterministic sanitized inventory JSON (sorted by name) + count.
function sanitizeInventory(rawJson) {
  let payload;
  try { payload = JSON.parse(rawJson); } catch { throw new VerificationError("gcloud inventory payload is not valid JSON"); }
  if (!Array.isArray(payload)) throw new VerificationError("gcloud inventory payload must be a JSON array");
  const sanitized = normalizeGcloudInventory(payload).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { count: sanitized.length, inventory: sanitized, text: `${JSON.stringify(sanitized, null, 2)}\n` };
}

async function run(deps, argv) {
  const args = parseArgs(argv);
  const raw = args.in ? deps.readFileSync(args.in, "utf8") : await deps.readStdin();
  const { text, count } = sanitizeInventory(raw);
  if (args.out) deps.writeFileSync(args.out, text);
  else deps.writeStdout(text);
  return { count };
}

module.exports = { parseArgs, sanitizeInventory, run };

if (require.main === module) {
  const fs = require("node:fs");
  const deps = {
    readFileSync: (p, e) => fs.readFileSync(p, e),
    writeFileSync: (p, c) => fs.writeFileSync(p, c),
    writeStdout: (t) => process.stdout.write(t),
    readStdin: () => new Promise((resolve, reject) => { let d = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (c) => { d += c; }); process.stdin.on("end", () => resolve(d)); process.stdin.on("error", reject); }),
  };
  run(deps, process.argv.slice(2))
    .then((r) => { process.stderr.write(`sanitized ${r.count} functions\n`); process.exitCode = 0; })
    .catch((err) => { process.stderr.write(`FUNCTIONS INVENTORY SANITIZE CLI FAILURE: ${err.message}\n`); process.exitCode = 2; });
}
