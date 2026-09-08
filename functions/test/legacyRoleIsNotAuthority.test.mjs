// `users/{uid}.role` MAKES ZERO AUTHORIZATION DECISIONS — server-side, repository-wide.
//
// This suite used to be an ALLOWLIST, because the claim could not honestly be zero: the
// credential-reset surface still resolved its administrator from that legacy string. It does not
// any more — the actor authorizes on `admin.credentialReset.initiate` and the target's admin status
// comes from the governed Role assignments — so the shape changed with the fact rather than the
// exception being quietly carried forward.
//
// ════════════════════ WHAT REMAINS, AND WHY IT IS NOT AN EXCEPTION ════════════════════
//
// Exactly one file still reads the field: `employeeSessionProjection.ts`, which TRANSPORTS it to
// the browser for nav gating and display. That is a different kind of thing from an exception to
// this rule, and the difference is the whole point — it is named separately below and held to a
// stricter contract than "please don't": it may not compare the value to anything.
//
// A field that crosses the wire looking like a role is a field somebody eventually branches on.
// This file is what makes that a failing test rather than a discovery.
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

// A DECISION made from it: a comparison against a role name, or a branch on its truthiness.
const LEGACY_ROLE_DECISION = /(?<!typeof )\brole\s*===\s*"|\brole\s*!==\s*"|if\s*\(\s*[A-Za-z.?]*\brole\b\s*\)/;

// The single TRANSPORT site. Not an exception to the rule above -- it makes no decision, which the
// last test proves separately and more strictly.
const TRANSPORT_ONLY = "access/employeeSessionProjection.ts";

const FILES = everyTsFile(SRC).map((f) => ({ path: rel(f), text: code(readFileSync(f, "utf8")) }));

test("LEGACY ROLE AUTHORIZATION CONSUMERS: 0", () => {
  // The headline number. Any file that both reads the legacy role AND decides something from it is
  // an authorization consumer, and there must be none.
  const consumers = FILES.filter((f) => LEGACY_ROLE_READ.test(f.text) && LEGACY_ROLE_DECISION.test(f.text))
    .map((f) => f.path)
    .sort();
  assert.deepEqual(
    consumers,
    [],
    `these files make an authorization decision from users/{uid}.role:\n  ${consumers.join("\n  ")}\n` +
      "Authority belongs on a governed capability or a Role assignment, never on that string.",
  );
});

test("the field is READ in exactly one place, and that place only transports it", () => {
  const readers = FILES.filter((f) => LEGACY_ROLE_READ.test(f.text)).map((f) => f.path).sort();
  assert.deepEqual(
    readers,
    [TRANSPORT_ONLY],
    "the only server-side read of the legacy role is the session projection that carries it to the client",
  );
});

test("the credential-reset surface authorizes on a CAPABILITY", () => {
  // Named explicitly because it was the last consumer, and because a rename without a real swap
  // would look identical from the outside.
  const callables = FILES.find((f) => f.path === "access/adminCredentialCallables.ts").text;
  const commands = FILES.find((f) => f.path === "access/adminCredentialCommands.ts").text;
  assert.ok(callables.includes("admin.credentialReset.initiate"), "the actor authority is the capability");
  assert.ok(callables.includes("resolveEffectiveAccess"), "resolved through the governed access feed");
  assert.ok(commands.includes("holdsCredentialResetCapability"), "the fact is the capability, not a role");
  // And the old fact name is gone rather than kept alongside as a second way in.
  assert.ok(!/\bisAdmin\b/.test(callables));
  assert.ok(!/\bisAdmin\b/.test(commands));
});

test("target admin status comes from Role ASSIGNMENTS, not from the user document", () => {
  const callables = FILES.find((f) => f.path === "access/adminCredentialCallables.ts").text;
  assert.ok(callables.includes("roleAssignments"), "the authoritative source");
  assert.ok(callables.includes("resolveFinalActiveAdmin"), "and the judgement is the pure resolver");
});

test("the GOVERNED machinery never consults the legacy role", () => {
  // Capability resolution, the read services and the write commands are where this field becoming
  // authority would actually matter. Kept as a named list even though the global count is already
  // zero: it is the list that would be checked first if the count ever moved.
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
    const src = FILES.find((f) => f.path === file).text;
    assert.ok(!LEGACY_ROLE_READ.test(src), `${file} must not consult users/{uid}.role`);
  }
});

test("the session projection carries the role and decides nothing with it", () => {
  const src = FILES.find((f) => f.path === TRANSPORT_ONLY).text;
  // Read once, off the user document, type-checked, assigned. What it never does is compare the
  // value to a ROLE NAME -- that comparison is the entire difference between carrying a value and
  // honouring it. `typeof role === "string"` is a shape check and is not that.
  assert.ok(/const role = userData\?\.role \?\? null;/.test(src));
  assert.ok(
    !LEGACY_ROLE_DECISION.test(src),
    "the projection must never make a decision from the legacy role",
  );
});
