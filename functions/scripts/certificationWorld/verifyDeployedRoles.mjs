#!/usr/bin/env node
// POST-DEPLOY VERIFICATION. Read the environment; do not trust an exit code.
//
// ============================ WHY THIS EXISTS ============================
//
// A deploy command that exits 0 has told you the CLI finished, not that the runtime changed. This
// project has a standing rule about that for good reason, and the grant phase depends on it: the
// 16 remaining grants fail with "roleId is not recognized" against an old build, and re-running
// them blind after a partial deploy would produce the same failure with a different explanation.
//
// So this asks the deployed environment three questions and refuses to guess at any of them:
//
//   1. what commit is actually live?
//   2. does the deployed runtime answer at all (health), and
//   3. did Rules or indexes move, when the delta said they should not?
//
// WHAT THIS DELIBERATELY DOES NOT DO: probe grantRole with a throwaway principal. An earlier
// capability probe did exactly that and CREATED a real role assignment for a fake UID, which then
// had to be revoked through the governed path. grantRole is a mutating command; using it to ask a
// read question is how that happened. Runtime recognition of the four Roles is proven by applying
// the 16 REAL grants that were always intended -- the first success is the proof, and no throwaway
// write is involved.
//
// Run: node scripts/certificationWorld/verifyDeployedRoles.mjs --expect <commit>
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PROJECT_ID = "eos-platform-sandbox";
const VERSION_URL = "https://eos-platform-sandbox.web.app/version.json";

/** The commit the sandbox was on before this deploy. Anything still reading this is a no-op deploy. */
const PREVIOUS_DEPLOYED = "4f1c1b03";

const argv = process.argv.slice(2);
const expected = (() => { const i = argv.indexOf("--expect"); return i >= 0 ? argv[i + 1] : null; })();

const results = [];
const record = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " -- " + detail : ""}`); };

// ── 1. What is actually live?
let live = null;
try {
  const res = await fetch(VERSION_URL, { cache: "no-store" });
  live = await res.json();
} catch (err) {
  record("deployed version readable", false, String(err));
}

if (live) {
  const short = String(live.commit || "").slice(0, 8);
  record("deployed version readable", true, `commit ${short}, built ${live.buildTime}`);
  record("environment is the sandbox", live.environmentId === "platform-sandbox" && live.environmentRole === "sandbox",
    `${live.environmentId} / ${live.environmentRole}`);
  record("deploy actually moved the commit", short !== PREVIOUS_DEPLOYED,
    short === PREVIOUS_DEPLOYED ? `still on ${PREVIOUS_DEPLOYED} -- the deploy did not land` : `${PREVIOUS_DEPLOYED} -> ${short}`);
  if (expected) {
    record("deployed commit matches expected", short === expected.slice(0, 8), `expected ${expected.slice(0, 8)}, live ${short}`);
  }
}

// ── 2. Does the deployed runtime answer?
//
// resolveEffectiveAccessCallable is READ-ONLY. Health is "it responds and rejects an unauthenticated
// caller", which proves the estate is serving without asserting anything about authority.
try {
  const res = await fetch(`https://us-central1-${PROJECT_ID}.cloudfunctions.net/resolveEffectiveAccessCallable`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: { permissionIds: ["customer.record.read"] } }),
  });
  // 401/403 is the CORRECT answer to an unauthenticated call. A 404 means the function is missing;
  // a 500 means it is broken. Both are deploy failures wearing different numbers.
  const healthy = res.status === 401 || res.status === 403;
  record("Functions estate responding", healthy, `unauthenticated call returned ${res.status} (401/403 expected)`);
} catch (err) {
  record("Functions estate responding", false, String(err));
}

// ── 3. Did anything move that the delta said would not?
try {
  const changed = execSync(
    `git diff --name-only ${PREVIOUS_DEPLOYED}..HEAD -- firestore.rules storage.rules firestore.indexes.json`,
    { cwd: REPO, encoding: "utf8" },
  ).trim();
  record("no Rules or index change in the delta", changed === "", changed || "none");
} catch (err) {
  record("no Rules or index change in the delta", false, String(err));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("DEPLOY NOT PROVEN -- do not apply grants.");
  process.exitCode = 1;
} else {
  console.log("Deploy verified against the environment. Safe to apply the 16 remaining grants.");
}
