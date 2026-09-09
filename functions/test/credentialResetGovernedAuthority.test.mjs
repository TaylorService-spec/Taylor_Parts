// CREDENTIAL RESET — the last server-side legacy authority, closed.
//
// Two decisions used to come out of `users/{uid}.role === "admin"`: whether the ACTOR could reset
// somebody else's credentials, and whether the TARGET was an administrator worth protecting from
// losing the last recoverable account. Both were Firebase data answering an EOS question.
//
// Neither reads that field any more, and this suite is what keeps it that way. It is pure: the
// emulator-backed suites exercise the Firestore round trip, but the JUDGEMENT — which is the half
// that can be wrong in a way a round trip would never reveal — is tested here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  evaluateActorAuthorization,
  resolveFinalActiveAdmin,
} from "../lib/access/adminCredentialCommands.js";
import { PERMISSION_CATALOG } from "../lib/access/permissionCatalog.js";

const CAPABILITY = "admin.credentialReset.initiate";

/** Source with comments removed. These files EXPLAIN the legacy check they no longer make. */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const source = (file) => strip(readFileSync(new URL(`../src/access/${file}`, import.meta.url), "utf8"));

const actor = (over = {}) => ({
  authExists: true,
  disabled: false,
  holdsCredentialResetCapability: true,
  hasEmployeeLink: true,
  employeeLinkReciprocal: true,
  employmentStatus: "ACTIVE",
  ...over,
});

// ============================ the actor ============================

test("the actor authority is the CAPABILITY, and there is no second way in", () => {
  assert.deepEqual(evaluateActorAuthorization(actor()), { authorized: true, category: "authorized" });
  assert.deepEqual(evaluateActorAuthorization(actor({ holdsCredentialResetCapability: false })), {
    authorized: false,
    category: "missing-capability",
  });
});

test("the fact set has no legacy-admin field left to fall back to", () => {
  // A rename would be cosmetic if the old field still existed alongside. It does not: an object
  // carrying the OLD name and nothing else is unauthorized, because the new fact is simply absent.
  const legacyShaped = { ...actor(), isAdmin: true };
  delete legacyShaped.holdsCredentialResetCapability;
  assert.equal(evaluateActorAuthorization(legacyShaped).category, "missing-capability");
});

test("the capability is registered INACTIVE, so the surface fails closed everywhere today", () => {
  // This is the intended state, not an oversight: activation is a separate production/security
  // gate. Pinned so that flipping it becomes a deliberate, visible change rather than a side effect.
  const entry = PERMISSION_CATALOG.find((p) => p.id === CAPABILITY);
  assert.ok(entry, "the capability must exist -- it was not invented here, it already did");
  assert.equal(entry.active, false);
});

test("the capability is excluded even from per-environment sandbox activation", () => {
  // The credential-reset surface is not sandbox-activatable, so "it authorizes in the emulator" can
  // never become the reason a legacy fallback gets restored.
  const src = readFileSync(new URL("../src/access/environmentCapabilityOverrides.ts", import.meta.url), "utf8");
  const activatable = /SPINE_ACTIVATABLE[\s\S]*?\]\)/.exec(src)?.[0] ?? src;
  assert.ok(!activatable.includes(`"${CAPABILITY}"`), "credential reset must not be in any activation set");
});

// ============================ the target ============================

test("target admin status comes from the ACTIVE admin role assignments", () => {
  assert.deepEqual(resolveFinalActiveAdmin(["u-1", "u-2"], "u-1"), {
    targetIsAdmin: true,
    isFinalActiveAdmin: false,
  });
  assert.deepEqual(resolveFinalActiveAdmin(["u-1"], "u-1"), {
    targetIsAdmin: true,
    isFinalActiveAdmin: true,
  });
});

test("a target who holds no admin assignment is not protected, and none is invented", () => {
  assert.deepEqual(resolveFinalActiveAdmin(["u-2", "u-3"], "u-1"), {
    targetIsAdmin: false,
    isFinalActiveAdmin: false,
  });
});

test("duplicate assignments for the same principal do not fake a second administrator", () => {
  // Two active assignments naming the SAME person is one administrator, not two. Counting rows
  // instead of principals would clear the protection on the last admin account.
  assert.equal(resolveFinalActiveAdmin(["u-1", "u-1"], "u-1").isFinalActiveAdmin, true);
});

test("an undeterminable query PROTECTS", () => {
  // Refusing a legitimate reset is recoverable. Resetting the last administrator is not.
  assert.deepEqual(resolveFinalActiveAdmin(null, "u-1"), {
    targetIsAdmin: true,
    isFinalActiveAdmin: true,
  });
});

test("a malformed assignment beside an admin target PROTECTS, because it might BE the target", () => {
  for (const junk of [undefined, null, "", 42, {}]) {
    assert.equal(
      resolveFinalActiveAdmin(["u-1", junk], "u-1").isFinalActiveAdmin,
      true,
      `a ${String(junk)} principalUid must not be counted as somebody else`,
    );
  }
});

test("malformed entries do not manufacture protection for a non-admin target", () => {
  // Fail-safe is not fail-loud-at-everything: a target absent from the population is still absent.
  assert.deepEqual(resolveFinalActiveAdmin(["u-2", null], "u-1"), {
    targetIsAdmin: false,
    isFinalActiveAdmin: false,
  });
});

// ============================ the field itself ============================

test("neither credential file reads users/{uid}.role any more", () => {
  // Asserted on the SOURCE, because this is a claim about what the code CANNOT do. A behavioural
  // test would pass against a file that still held the fallback on a branch it did not take.
  for (const file of ["adminCredentialCallables.ts", "adminCredentialCommands.ts"]) {
    const src = source(file);
    assert.ok(!/userData\??\.role\b/.test(src), `${file} must not read users/{uid}.role`);
    assert.ok(!/\brole\s*===\s*"admin"/.test(src), `${file} must not compare a role to "admin"`);
  }
});

test("the actor uid is never taken from the payload", () => {
  const src = source("adminCredentialCallables.ts");
  assert.ok(src.includes("request.auth"), "the actor comes from the authenticated context");
  // No `actorUid` read out of request.data anywhere -- the browser cannot name who is acting, nor
  // claim a role, a capability or an administrator flag.
  assert.ok(!/data\??\.(actorUid|role|isAdmin|capabilit)/i.test(src));
});
