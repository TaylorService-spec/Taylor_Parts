#!/usr/bin/env node
// Verify named callables EXIST in a project, using the FIREBASE CLI.
//
// ============================ WHY THIS EXISTS ALONGSIDE verifySandboxFunctions.mjs ============================
//
// verifySandboxFunctions.mjs is the better check: it asks `gcloud functions list --v2` and verifies
// each callable EXISTS, is ACTIVE, and runs the expected runtime. But it needs the gcloud SDK, and
// the operator running the sandbox runbook does not necessarily have it -- on 2026-08-21 the runbook
// finished a completely successful deploy and then printed eighteen lines of "FAIL: query failed",
// every one of them caused by `spawnSync gcloud ENOENT` rather than by anything wrong in the estate.
//
// A verification step that reports FAILED after a successful deploy is worse than no verification
// step: the next real failure gets ignored because the last three were noise.
//
// ============================ IT DELIBERATELY CLAIMS LESS ============================
//
// The firebase CLI's functions:list reports the deployed function set. It does NOT report a
// per-function ACTIVE state or runtime the way gcloud does. So this answers exactly one question --
// IS IT DEPLOYED -- and says so in those words. It must never be described as proving a function is
// healthy, because it does not look.
//
// PRESENCE IS NOT ACTIVATION AND NEITHER IS AUTHORIZATION. A callable can be deployed and still deny
// every principal, because its capability is registered active:false or nobody holds it. That is a
// separate question and this tool has no opinion on it.
//
// Usage:
//   node scripts/verifyDeployedCallablesFirebase.mjs --project <id> <fn1> [fn2 ...]
//
// Exit codes:
//   0 = every named callable is present
//   1 = at least one is missing, or the query itself failed
//   2 = usage error
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  let project = null;
  const names = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--project") { project = argv[i + 1] ?? null; i += 1; continue; }
    if (argv[i] === "--function") { if (argv[i + 1]) names.push(argv[i + 1]); i += 1; continue; }
    if (argv[i].startsWith("--")) continue;
    names.push(argv[i]);
  }
  return { project, names };
}

/**
 * Pull function names out of the firebase CLI's box-drawn table. PURE, so the parsing is testable
 * without invoking anything.
 *
 * The parse is deliberately strict about the header row: an earlier ad-hoc version of this matched
 * zero rows and would have reported every function as ABSENT after a perfectly good deploy. A parser
 * that silently matches nothing is indistinguishable from a catastrophe, so this one refuses to
 * return an empty set quietly -- see the caller.
 */
export function parseFirebaseFunctionsTable(stdout) {
  const names = [];
  // eslint-disable-next-line no-control-regex
  const plain = String(stdout).replace(/\[[0-9;]*m/g, "");
  for (const line of plain.split(/\r?\n/)) {
    if (!line.includes("│")) continue;
    const cell = line.split("│")[1];
    if (cell === undefined) continue;
    const name = cell.trim();
    if (name === "" || name === "Function") continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) names.push(name);
  }
  return [...new Set(names)];
}

function main() {
  const { project, names } = parseArgs(process.argv.slice(2));
  if (!project || names.length === 0) {
    console.error("usage: verifyDeployedCallablesFirebase.mjs --project <id> <fn> [fn ...]");
    process.exit(2);
  }

  let stdout;
  try {
    stdout = execFileSync("firebase", ["functions:list", "--project", project], {
      encoding: "utf8", maxBuffer: 16 * 1024 * 1024, shell: process.platform === "win32",
    });
  } catch (err) {
    console.error(`FAIL: firebase functions:list --project ${project} failed: ${err?.message ?? err}`);
    process.exit(1);
  }

  const deployed = parseFirebaseFunctionsTable(stdout);
  if (deployed.length === 0) {
    // Refusing to report "all missing" off an empty parse. That conclusion would be indistinguishable
    // from a wiped estate, and it would be wrong far more often than it was right.
    console.error("FAIL: parsed ZERO functions from the CLI output -- treating this as a query failure, not as an empty estate.");
    process.exit(1);
  }

  const present = new Set(deployed);
  let missing = 0;
  for (const name of names) {
    if (present.has(name)) {
      console.log(`DEPLOYED  ${name}`);
    } else {
      console.log(`MISSING   ${name}`);
      missing += 1;
    }
  }

  console.log(`\n${names.length - missing}/${names.length} deployed (${deployed.length} functions in the project).`);
  console.log("This checks PRESENCE only. It does not prove a function is ACTIVE, nor that any principal may call it.");
  process.exit(missing === 0 ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("verifyDeployedCallablesFirebase.mjs")) {
  main();
}
