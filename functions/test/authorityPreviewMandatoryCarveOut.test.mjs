// MANDATORY PREVIEW (PR 4) -- the flag, the audit mark, and the PINNED machine carve-out. No database.
//
// The nine authority-changing commands may be VALUE-imported only by the Administration API (which routes them through
// the mandatory preview) and by the code-reviewed machine runners listed here, each of which must hand the command a
// machineAppliedRepository (audit MACHINE_APPLIED + manifest digest). A new direct caller fails this test until it is
// reviewed into the list -- and previewing these runners is a listed follow-up.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const FUNCTIONS = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(FUNCTIONS, "..");
const {
  adminPreviewMandatoryFrom, afterWithAuthorityChange, machineAppliedRepository, machineManifestDigest, withAuthorityChangeAudit,
  PREVIEW_DIGEST_PATTERN,
} = require("../lib/adminPolicy/authorityChangeCommitPort.js");

const NINE = ["grantObjectActionToRole", "revokeObjectActionFromRole", "applyObjectWideRoleAuthority", "setGrantCondition",
  "retireGrantCondition", "grantObjectActionToPrincipal", "revokeObjectActionFromPrincipal", "assignRole", "revokeRole"];

/** THE PIN. Path -> why it may call a command directly. */
const DIRECT_CALLERS = Object.freeze({
  "functions/src/adminPolicy/adminPolicyApi.ts": "the Administration API: dispatch + the mandatory-preview commit",
  "functions/src/adminPolicy/workOrderLifecycleGrantActivation.ts": "MACHINE_APPLIED carve-out (operator runner)",
  "functions/scripts/seedSampleCompany.js": "MACHINE_APPLIED carve-out (nonprod sample seed)",
  "functions/scripts/seedSyntheticNonprodWorkforce.js": "MACHINE_APPLIED carve-out (nonprod synthetic seed)",
  "functions/scripts/sampleCompany/loginActivation.js": "MACHINE_APPLIED carve-out (nonprod login activation)",
});

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "lib" || name === "test" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* sources(full);
    else if (/\.(ts|js|mjs|cjs)$/.test(name) && !/\.test\./.test(name)) yield full;
  }
}

/** Names VALUE-imported from policyCommands (ES import, not `import type`, or a destructuring require). */
function commandImports(text) {
  const names = new Set();
  for (const m of text.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["'][^"']*policyCommands(?:\.js)?["']/g)) {
    if (m[1]) continue;
    for (const part of m[2].split(",")) {
      const p = part.trim();
      if (!p || p.startsWith("type ")) continue;
      names.add(p.split(/\s+as\s+/)[0].trim());
    }
  }
  for (const m of text.matchAll(/\{([^}]*)\}\s*=\s*require\(\s*["'][^"']*policyCommands(?:\.js)?["']\s*\)/g)) {
    for (const part of m[1].split(",")) names.add(part.split(":")[0].trim());
  }
  for (const m of text.matchAll(/require\(\s*["'][^"']*policyCommands(?:\.js)?["']\s*\)\s*\.\s*(\w+)/g)) names.add(m[1]);
  return [...names].filter((n) => NINE.includes(n));
}

test("CARVE-OUT PIN: only the Administration API and the reviewed machine runners call the nine commands directly", () => {
  const found = {};
  for (const root of [join(FUNCTIONS, "src"), join(FUNCTIONS, "scripts"), join(REPO, "scripts")]) {
    let ok = true;
    try { statSync(root); } catch { ok = false; }
    if (!ok) continue;
    for (const file of sources(root)) {
      const names = commandImports(readFileSync(file, "utf8"));
      if (names.length > 0) found[relative(REPO, file)] = names.sort();
    }
  }
  assert.deepEqual(Object.keys(found).sort(), Object.keys(DIRECT_CALLERS).sort(),
    `direct callers of the nine authority commands changed: ${JSON.stringify(found)}`);
  for (const file of Object.keys(DIRECT_CALLERS)) {
    if (file.endsWith("adminPolicyApi.ts")) continue;
    const text = readFileSync(join(REPO, file), "utf8");
    assert.match(text, /machineAppliedRepository\(/, `${file} must run the commands through machineAppliedRepository`);
    for (const name of found[file]) {
      const bare = new RegExp(`\\b${name}\\(\\s*repo\\s*,`);
      assert.doesNotMatch(text, bare, `${file} calls ${name}(repo, ...) without the MACHINE_APPLIED repository`);
    }
  }
});

test("FLAG: ADMIN_PREVIEW_MANDATORY is ON only for the exact value \"true\"; absent is OFF", () => {
  assert.equal(adminPreviewMandatoryFrom({}), false);
  assert.equal(adminPreviewMandatoryFrom(undefined), false);
  for (const v of ["false", "1", "yes", "on", "", "tru"]) assert.equal(adminPreviewMandatoryFrom({ ADMIN_PREVIEW_MANDATORY: v }), false, v);
  for (const v of ["true", "TRUE", " true "]) assert.equal(adminPreviewMandatoryFrom({ ADMIN_PREVIEW_MANDATORY: v }), true, v);
  assert.match("a".repeat(64), PREVIEW_DIGEST_PATTERN);
  assert.doesNotMatch("A".repeat(64), PREVIEW_DIGEST_PATTERN);
});

test("FLAG: no deployed environment turns it on (render.yaml does not set it)", () => {
  let text = "";
  try { text = readFileSync(join(REPO, "render.yaml"), "utf8"); } catch { /* none */ }
  assert.equal(/ADMIN_PREVIEW_MANDATORY/.test(text), false, "the Owner turns the requirement on; it ships OFF everywhere");
});

test("AUDIT MARK: merged into a record `after`, never overwriting; non-records untouched", () => {
  const mark = { mode: "HUMAN_PREVIEWED", previewed: true, previewDigest: "d", affectedCount: 2, impactDigest: "i" };
  assert.deepEqual(afterWithAuthorityChange({ a: 1 }, mark), { a: 1, authorityChange: mark });
  assert.deepEqual(afterWithAuthorityChange({ authorityChange: "x" }, mark), { authorityChange: "x" });
  assert.equal(afterWithAuthorityChange(null, mark), null);
});

test("MACHINE_APPLIED: every audit row inside the runner's transactions is marked with the manifest digest", async () => {
  const written = [];
  const tx = { appendAudit: async (input) => { written.push(input); return "id"; }, other: () => "x" };
  const repo = { transact: async (_actor, fn) => fn(tx), listRoles: async () => ["r"] };
  const manifest = { manifestId: "m1", ruling: "test", changes: [{ roleKey: "a" }] };
  const marked = machineAppliedRepository(repo, manifest);
  assert.deepEqual(await marked.listRoles(), ["r"]);
  await marked.transact({}, async (t) => { assert.equal(t.other(), "x"); await t.appendAudit({ action: "x", after: { k: 1 } }); });
  assert.deepEqual(written[0].after, { k: 1, authorityChange: { mode: "MACHINE_APPLIED", previewed: false, manifestId: "m1", manifestDigest: machineManifestDigest(manifest) } });
  assert.equal(machineManifestDigest(manifest), machineManifestDigest({ changes: [{ roleKey: "a" }], ruling: "test", manifestId: "m1" }));
  assert.notEqual(machineManifestDigest(manifest), machineManifestDigest({ ...manifest, changes: [] }));
  assert.throws(() => machineAppliedRepository(repo, { manifestId: "" }));
  // The unmarked repository is untouched.
  await repo.transact({}, (t) => t.appendAudit({ action: "y", after: { k: 2 } }));
  assert.deepEqual(written[1].after, { k: 2 });
  const human = withAuthorityChangeAudit(repo, { mode: "HUMAN_PREVIEWED", previewed: true, previewDigest: "p", affectedCount: 0, impactDigest: "i" });
  await human.transact({}, (t) => t.appendAudit({ action: "z", after: {} }));
  assert.equal(written[2].after.authorityChange.mode, "HUMAN_PREVIEWED");
});
