// A DATA RESET MUST NEVER DELETE AN IDENTITY.
//
// ============================ THE PROPERTY ============================
//
//   Certification DATA is disposable and is rebuilt from the repository.
//   Certification IDENTITIES are durable and survive every reset, refresh and rebuild.
//
// That separation is the whole reason the 47 principals are worth creating. If a routine reset
// deleted them, every rebuild would mint 47 new UIDs, and every roleAssignment, audit entry and
// piece of work history keyed on the old ones would silently detach.
//
// PROVEN STRUCTURALLY, NOT BY POLICY. A comment saying "reset does not touch Auth" is true until
// someone adds a tidy-up loop. These checks assert that the world tooling contains no Auth deletion
// code path AT ALL — the capability is absent, so the mistake is not available.
//
// Verified live on 2026-08-22: a full `rebuild --confirm-reset` destroyed and rebuilt all 717
// records, and the 47 certification UIDs were byte-identical before and after.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(HERE, "../scripts");

const read = (rel) => readFileSync(path.join(SCRIPTS, rel), "utf8");

/**
 * Source with COMMENTS REMOVED.
 *
 * The first version of these checks grepped raw source and failed on the provisioner's own header,
 * which explains at length why it does NOT accept a production flag and why it does NOT offer
 * rotation. Documenting a refusal made the file look like it did the thing it refuses.
 *
 * That is worth keeping rather than quietly fixing: a guard that reads prose punishes explanation,
 * and the explanation is the most valuable part of these files. Scan the code.
 */
function codeOf(rel) {
  const raw = read(rel);
  // Block comments first, then whole-line comments. Written with indexOf/startsWith rather than
  // regex literals on purpose: escape sequences in this repository tooling have been mangled in
  // transit more than once, and a silently broken pattern would make the guard match nothing and
  // pass forever -- which is the failure mode this whole file exists to prevent.
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const open = raw.indexOf("/*", i);
    if (open === -1) { out += raw.slice(i); break; }
    out += raw.slice(i, open);
    const close = raw.indexOf("*/", open + 2);
    if (close === -1) break;
    i = close + 2;
  }
  return out
    .split(String.fromCharCode(10))
    .map((line) => (line.trimStart().startsWith("//") ? "" : line))
    .join(String.fromCharCode(10));
}

/** Every module that participates in resetting or rebuilding the certification world. */
const WORLD_TOOLING = [
  "certificationWorld.mjs",
  "certificationWorld/build.mjs",
  "certificationWorld/verify.mjs",
  "certificationWorld/state.mjs",
  "certificationWorld/manifest.mjs",
];

/** Auth-destructive APIs. Any one of these in world tooling is the defect. */
const AUTH_DESTRUCTIVE = [
  "deleteUser",
  "deleteUsers",
  "firebase-admin/auth",
  "getAuth(",
];

test("the world reset/rebuild tooling contains no Auth code path at all", () => {
  for (const file of WORLD_TOOLING) {
    let source;
    try {
      source = read(file);
    } catch {
      continue; // a module that does not exist cannot delete anything
    }
    for (const api of AUTH_DESTRUCTIVE) {
      assert.equal(
        source.includes(api), false,
        `${file} references "${api}". World reset must never be able to touch an identity: data is `
        + `disposable, identities are durable, and a rebuild that mints new UIDs silently detaches `
        + `every roleAssignment and audit entry keyed on the old ones.`,
      );
    }
  }
});

test("the provisioner itself has no delete path", () => {
  // It creates and links. Removing an identity is a SEPARATE governed command that does not exist
  // yet, and deliberately so -- the cleanup tool is the one that needs the most review, not the
  // least, and bundling it here would make it reachable by a flag typo.
  const source = read("certificationWorld/provisionPrincipals.mjs");
  for (const api of ["deleteUser", "deleteUsers"]) {
    assert.equal(source.includes(api), false,
      `provisionPrincipals references "${api}" -- identity cleanup must stay a separate governed command`);
  }
});

test("the provisioner refuses production unconditionally, with no confirmation escape", async () => {
  // The governed provisionEmployeeAccess.js permits production WITH --confirmProduction, which is
  // right for a tool that provisions real staff. This one has no such job and must have no such
  // flag: a flag that can authorize production is a flag that can be typed by mistake.
  const source = codeOf("certificationWorld/provisionPrincipals.mjs");
  assert.equal(source.includes("confirmProduction"), false,
    "the certification provisioner must not accept a production confirmation flag");

  // THE REFUSALS MOVED, AND THIS CHECK MOVED WITH THEM.
  //
  // This used to grep the provisioner's source for the literal strings its own assertSandboxTarget
  // threw -- "is a PRODUCTION environment", "Unknown project", "There is no default target". That
  // guard has been REPLACED by the shared executionTarget authority (which refuses production by
  // name AND by role, rather than by role alone), so the strings are legitimately gone while every
  // refusal they stood for is strictly stronger.
  //
  // A source-text assertion could not tell those two situations apart: a guard that was deleted and
  // a guard that was superseded look identical to grep. So this now EXERCISES the decision instead
  // of reading it, which is what the check was always trying to establish and can no longer be
  // satisfied by a file merely containing the right words.
  const { authorizeProvisioning } =
    await import(pathToFileURL(path.join(SCRIPTS, "certificationWorld/provisionPrincipals.mjs")).href);
  const refusal = (argv) => {
    try { authorizeProvisioning(argv); return null; } catch (err) { return err.message; }
  };

  assert.match(refusal(["--projectId", "taylor-parts", "--apply", "--apply-live-certification"]) ?? "",
    /production/i, "it must refuse production explicitly, whatever flags accompany it");
  assert.match(refusal(["--projectId", "taylor-parts"]) ?? "",
    /production/i, "production must be refused even for a read-only dry run");
  assert.match(refusal(["--projectId", "not-a-registered-project"]) ?? "",
    /Unknown project/, "it must refuse an unregistered project");
  assert.match(refusal(["--apply"]) ?? "",
    /--projectId is required/, "it must refuse a missing --projectId");
});

test("interactive-login activation cannot silently rotate a working credential", () => {
  // activateSandboxPersonas.js learned this the hard way: it once rotated every persona on every
  // run, which invalidated the Owner's saved copy twice in one day and surfaced as "invalid
  // password" -- sending whoever ran it to debug the wrong thing entirely.
  //
  // The certification activation must set a password ONLY where none is recorded, and must MERGE
  // into the credentials file rather than replacing it.
  const source = codeOf("certificationWorld/provisionPrincipals.mjs");
  assert.ok(source.includes("if (existing[row.email])"),
    "activation must skip accounts that already have a recorded credential");
  assert.ok(source.includes("That is a replace, not a merge"),
    "activation must refuse to write when the entry count falls -- a merge never loses entries");
  assert.equal(source.includes("--rotate"), false,
    "this tool must not offer rotation; that belongs to the persona tooling that owns those accounts");
});

test("no credential value is ever printed by the provisioner", () => {
  // A terminal is an observable log surface. The generated secret goes to the gitignored credentials
  // file and nowhere else.
  const source = read("certificationWorld/provisionPrincipals.mjs");
  const printsSecret = /console\.log\([^)]*\b(secret|password)\b/i.test(source);
  assert.equal(printsSecret, false, "the provisioner must never print a credential");
});
