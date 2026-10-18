// MANDATORY PREVIEW (PR 4) -- the flag, the audit mark, and the PINNED machine carve-out. No database.
//
// The nine authority-changing commands may be VALUE-imported only by the Administration API (which routes them through
// the mandatory preview) and by the code-reviewed machine runners listed here, each of which must hand the command a
// machineAppliedRepository (audit MACHINE_APPLIED + manifest digest). A new direct caller fails this test until it is
// reviewed into the list. This is a TRIPWIRE over source text, not an allow-list proof (see commandImports).
// DEVIATION FROM DESIGN §3.3, tracked for the Owner: the runners are AUDITED, not PREVIEWED (follow-up).
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
  "retireGrantCondition", "grantObjectActionToPrincipal", "revokeObjectActionFromPrincipal", "assignRole", "revokeRole",
  // DECISIONS #249: the Employee company-access grant commands take the same mandatory-preview path.
  "grantCompanyAuthority", "revokeCompanyAuthority"];

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

const MODULE = String.raw`["'][^"']*policyCommands(?:\.js)?["']`;
const WHOLE = "*";

/**
 * What a file takes from policyCommands: the named VALUE imports, or WHOLE ("*") when it takes the module itself -- a
 * namespace import, a default import, a whole-module require, a re-export, a dynamic import -- which reaches all nine.
 * `import type` is ignored. A TRIPWIRE over source text (no type checker): it catches the shapes this repository uses
 * and every shape listed in the scanner test; it is not a proof that no other route exists.
 */
function commandImports(text) {
  const names = new Set();
  const take = (list) => {
    for (const part of list.split(",")) {
      const p = part.trim();
      if (!p || p.startsWith("type ")) continue;
      names.add(p.split(/\s+as\s+|\s*:\s*/)[0].trim());
    }
  };
  for (const m of text.matchAll(new RegExp(String.raw`import\s+(type\s+)?([^;]*?)\s+from\s+${MODULE}`, "g"))) {
    if (m[1]) continue;
    const clause = m[2];
    const braces = clause.match(/\{([^}]*)\}/);
    if (braces) take(braces[1]);
    if (/\*\s+as\s+\w+/.test(clause) || /^\s*\w+\s*(,|$)/.test(clause)) names.add(WHOLE);
  }
  for (const m of text.matchAll(new RegExp(String.raw`export\s+(type\s+)?(\*|\{[^}]*\})\s*(?:as\s+\w+\s*)?from\s+${MODULE}`, "g"))) {
    if (m[1]) continue;
    if (m[2] === "*") names.add(WHOLE); else take(m[2].slice(1, -1));
  }
  for (const m of text.matchAll(new RegExp(String.raw`(\{[^}]*\}\s*=\s*)?(?:await\s+)?\b(require|import)\(\s*${MODULE}\s*\)(\s*\.\s*(\w+))?`, "g"))) {
    if (m[1]) take(m[1].replace(/=\s*$/, "").trim().slice(1, -1));
    else if (m[4]) names.add(m[4]);
    else names.add(WHOLE);
  }
  return [...names].filter((n) => n === WHOLE || NINE.includes(n));
}

/** The receivers a carved-out runner may hand a command: the MACHINE_APPLIED repository, nothing else. */
const MACHINE_RECEIVER = /^(machineRepo|machineAppliedRepository\([\s\S]*)$/;

test("CARVE-OUT TRIPWIRE: only the Administration API and the reviewed machine runners take the nine commands", () => {
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
    assert.equal(found[file].includes(WHOLE), false, `${file} must import the commands by name, never the whole module`);
    const text = readFileSync(join(REPO, file), "utf8");
    assert.match(text, /machineAppliedRepository\(/, `${file} must run the commands through machineAppliedRepository`);
    for (const name of found[file]) {
      let calls = 0;
      for (const m of text.matchAll(new RegExp(String.raw`\b${name}\(\s*([^,]+?)\s*,`, "g"))) {
        calls += 1;
        assert.match(m[1], MACHINE_RECEIVER, `${file} calls ${name}(${m[1]}, ...) -- only the MACHINE_APPLIED repository may receive it`);
      }
      assert.ok(calls > 0, `${file} imports ${name} but no call was recognised (the tripwire cannot see it)`);
    }
  }
});

test("CARVE-OUT TRIPWIRE: the scanner recognises every way of taking the module", () => {
  const cases = {
    'import { assignRole } from "./policyCommands";': ["assignRole"],
    'import { assignRole as a, type AdminActor } from "../adminPolicy/policyCommands";': ["assignRole"],
    'import type { AdminActor } from "./policyCommands";': [],
    'import * as commands from "./policyCommands";': [WHOLE],
    'import commands from "./policyCommands.js";': [WHOLE],
    'const { revokeRole } = require("../lib/adminPolicy/policyCommands.js");': ["revokeRole"],
    'const { revokeRole: r } = require("../lib/adminPolicy/policyCommands.js");': ["revokeRole"],
    'const c = require("../lib/adminPolicy/policyCommands.js");': [WHOLE],
    'const g = require("./policyCommands").grantObjectActionToRole;': ["grantObjectActionToRole"],
    'export * from "./policyCommands";': [WHOLE],
    'export { setGrantCondition } from "./policyCommands";': ["setGrantCondition"],
    'const m = await import("./policyCommands.js");': [WHOLE],
    'import { createRole } from "./policyCommands";': [],
  };
  for (const [text, expected] of Object.entries(cases)) assert.deepEqual(commandImports(text).sort(), expected, text);
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
