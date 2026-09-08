// `users/{uid}.role` IS NOT AN EOS AUTHORITY — pinned structurally, and pinned HONESTLY.
//
// The session projection carries that legacy string to the browser for nav gating and display,
// which is the one thing that makes it dangerous: a field that crosses the wire looking like a role
// is a field somebody will eventually branch on. This suite exists so that becomes a failing test
// rather than a discovery.
//
// ════════════════════ WHAT THIS DOES NOT CLAIM ════════════════════
//
// It does not claim the number is zero. It is not. `adminCredentialCallables.ts` still resolves the
// legacy administrator from `users/{uid}.role === "admin"` for the credential-reset surface, by
// design and documented as legacy compatibility awaiting a 1:1 resolver swap. Asserting zero here
// would be a validator that passes by describing something other than the codebase.
//
// So the shape is an ALLOWLIST: every server-side consumer of that field is named below, and a new
// one fails this test. What is forbidden outright is the governed machinery — capability
// resolution, the read services, the write commands — consulting it at all.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

function everyTsFile(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...everyTsFile(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Source with comments stripped, so a file that merely EXPLAINS the field is not counted as using it. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const rel = (p) => path.relative(SRC, p).split(path.sep).join("/");

// A read of the legacy role off a user document. Deliberately narrow: `roleId`, `operationalRoles`
// and `env.role` are different fields entirely and are not what this guards.
const LEGACY_ROLE_READ = /\buserData\??\.role\b|\buser\??\.role\s*===|\bdata\.role\s*===/;

// The ONLY files permitted to touch it, each for a stated reason.
const ALLOWED = new Map([
  [
    "access/employeeSessionProjection.ts",
    "carries it to the client for nav gating and display, and makes no decision with it",
  ],
  [
    "access/adminCredentialCallables.ts",
    "the legacy compatibility administrator for the credential-reset surface, awaiting a 1:1 resolver swap",
  ],
  [
    "access/adminCredentialCommands.ts",
    "the pure half of the same legacy administrator resolution",
  ],
]);

test("no NEW server-side consumer of users/{uid}.role has appeared", () => {
  const found = everyTsFile(SRC)
    .filter((f) => LEGACY_ROLE_READ.test(code(readFileSync(f, "utf8"))))
    .map(rel)
    .sort();
  const unexpected = found.filter((f) => !ALLOWED.has(f));
  assert.deepEqual(
    unexpected,
    [],
    `these files read the legacy users/{uid}.role and are not on the allowlist:\n  ${unexpected.join("\n  ")}\n` +
      "If one of them is a legitimate legacy-compatibility surface, add it here WITH ITS REASON. " +
      "If it is a governed authorization decision, it belongs on a capability instead.",
  );
});

test("the allowlist has no stale entries: every named file still reads the field", () => {
  // A validator whose exceptions outlive the thing they excused stops being a validator. When one
  // of these is finally migrated, this test is what says so.
  for (const [file, why] of ALLOWED) {
    const src = code(readFileSync(path.join(SRC, file), "utf8"));
    assert.ok(LEGACY_ROLE_READ.test(src), `${file} no longer reads the legacy role -- remove it from the allowlist (${why})`);
  }
});

test("the GOVERNED machinery never consults it", () => {
  // Capability resolution, the read services and the write commands are where this field becoming
  // authority would actually matter. None of them may look at it under any circumstance.
  const governed = [
    "access/resolveEffectivePermission.ts",
    "access/effectiveAccessFeed.ts",
    "access/governedListReadService.ts",
    "access/governedReadRegistry.ts",
    "workOrder/scopedWorkOrderReadService.ts",
    "equipment/equipmentWriteCommands.ts",
    "crm/crmWriteCommands.ts",
    "reorderRequest/reorderTransitionCommands.ts",
  ];
  for (const file of governed) {
    const src = code(readFileSync(path.join(SRC, file), "utf8"));
    assert.ok(!LEGACY_ROLE_READ.test(src), `${file} must not consult users/{uid}.role`);
  }
});

test("the session projection returns the role but decides nothing with it", () => {
  const src = code(readFileSync(path.join(SRC, "access/employeeSessionProjection.ts"), "utf8"));
  // It is read once, off the user document, type-checked, and assigned. What it is never
  // compared against is a ROLE NAME -- that comparison is the entire difference between carrying
  // a value and honouring it. `typeof role === "string"` is a shape check and is not that.
  assert.ok(/const role = userData\?\.role \?\? null;/.test(src));
  assert.ok(
    !/(?<!typeof )\brole\s*===\s*"/.test(src),
    "the projection must never compare the legacy role against a role name",
  );
});
