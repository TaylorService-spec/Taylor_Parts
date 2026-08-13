import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXECUTION_PROFILES, PROFILE_NAMES, TURN_CEILINGS, BOUNDED_CORRECTION_TURN_CEILING,
  resolveProfile, turnCeilingFor, assertProfileInvariants,
} from "./executionProfiles.mjs";

test("four profiles exist with the specified bounded, differentiated turn ceilings", () => {
  assert.deepEqual(PROFILE_NAMES, ["READ_ONLY_ANALYSIS", "READ_ONLY_VERIFY", "PATCH_PRODUCER", "GOVERNED_INTEGRATION"]);
  assert.equal(turnCeilingFor("READ_ONLY_ANALYSIS"), 40);
  assert.equal(turnCeilingFor("READ_ONLY_VERIFY"), 60);
  assert.equal(turnCeilingFor("PATCH_PRODUCER"), 80);
  assert.equal(turnCeilingFor("GOVERNED_INTEGRATION"), 100);
  assert.equal(BOUNDED_CORRECTION_TURN_CEILING, 80, "the legacy-40 replacement is a bounded 80");
});

test("every profile is dontAsk and no profile is unrestricted-Bash or bypass", () => {
  for (const name of PROFILE_NAMES) {
    const p = EXECUTION_PROFILES[name];
    assert.equal(p.permissionMode, "dontAsk");
    const joined = p.allowedTools.join(" ");
    assert.ok(!/\bBash\(\s*\*?\s*\)/.test(joined) && !p.allowedTools.includes("Bash"), `${name} must not grant unrestricted Bash`);
    assert.ok(!/bypass|dangerously/i.test(joined), `${name} must never express bypassPermissions`);
  }
});

test("READ_ONLY_VERIFY supports test/build/lint + git-read, but NOT Edit/Write", () => {
  const p = EXECUTION_PROFILES.READ_ONLY_VERIFY;
  assert.ok(p.allowedTools.includes("Bash(node --test *)"));
  assert.ok(p.allowedTools.includes("Bash(npm run build *)"));
  assert.ok(p.allowedTools.includes("Bash(npm run lint *)"));
  assert.ok(p.allowedTools.some((t) => t.startsWith("Bash(git log")));
  assert.ok(!p.allowedTools.includes("Edit") && !p.allowedTools.includes("Write"), "verify is read-only");
  assert.equal(p.allowsWrite, false);
});

test("PATCH_PRODUCER supports isolated-worktree patch production + tests + diff/hash, but NOT merge/deploy/push/PR", () => {
  const p = EXECUTION_PROFILES.PATCH_PRODUCER;
  assert.ok(p.allowedTools.includes("Edit") && p.allowedTools.includes("Write"));
  assert.ok(p.allowedTools.includes("Bash(git worktree *)"));
  assert.ok(p.allowedTools.includes("Bash(git apply *)"));
  assert.ok(p.allowedTools.includes("Bash(sha256sum *)"));
  assert.ok(p.allowsWorktree === true && p.allowsWrite === true);
  const joined = p.allowedTools.join(" ").toLowerCase();
  for (const forbidden of ["git push", "gh pr", "pr merge", "firebase deploy"]) {
    assert.ok(!joined.includes(forbidden), `PATCH_PRODUCER must NOT carry "${forbidden}"`);
  }
  assert.equal(p.allowsIntegration, false);
});

test("GOVERNED_INTEGRATION is a SEPARATE profile (branch push + PR create) but never merge/deploy", () => {
  const p = EXECUTION_PROFILES.GOVERNED_INTEGRATION;
  assert.ok(p.allowedTools.includes("Bash(git push *)") && p.allowedTools.includes("Bash(gh pr create *)"));
  assert.equal(p.allowsIntegration, true);
  const joined = p.allowedTools.join(" ").toLowerCase();
  assert.ok(!joined.includes("pr merge") && !joined.includes("firebase deploy"), "integration is not merge/deploy");
});

test("resolveProfile fails closed on an unknown name", () => {
  assert.throws(() => resolveProfile("UNRESTRICTED"), /unknown profile/);
  assert.throws(() => turnCeilingFor("nope"), /unknown profile/);
});

test("assertProfileInvariants rejects unsafe hand-built profiles (fail-closed construction)", () => {
  assert.throws(() => assertProfileInvariants({ name: "X", permissionMode: "bypassPermissions", maxTurns: 40, allowedTools: [] }), /dontAsk/);
  assert.throws(() => assertProfileInvariants({ name: "X", permissionMode: "dontAsk", maxTurns: 40, allowedTools: ["Bash(*)"] }), /unrestricted Bash/);
  assert.throws(() => assertProfileInvariants({ name: "X", permissionMode: "dontAsk", maxTurns: 40, allowedTools: ["Bash(gh pr merge *)"] }), /forbidden authority/);
  assert.throws(() => assertProfileInvariants({ name: "PATCH_PRODUCER", permissionMode: "dontAsk", maxTurns: 80, allowedTools: ["Bash(git push *)"] }), /integration authority/);
  assert.throws(() => assertProfileInvariants({ name: "X", permissionMode: "dontAsk", maxTurns: 9999, allowedTools: [] }), /bounded integer/);
});
