// CERTIFICATION AUTHORITY GENESIS -- the one grant the governed path cannot reach.
//
// ============================ THE ASYMMETRY BEING TESTED ============================
//
// `admin.roleAssignment.write` is carried by exactly ONE Role, `owner`, which is privileged.
// Granting a privileged Role needs a second distinct approver who already holds that same
// authority. A freshly installed Certification World has zero role assignments, so there is no
// actor, no approver, and nobody who can authenticate -- the first grant is impossible through the
// governed path, by design.
//
// Every OTHER grant is then trivial: 86 of the fixture's 87 are non-privileged, and a
// non-privileged grant needs one authorized actor and no approver at all.
//
// Genesis exists to close exactly that gap and then refuse forever. These tests hold it to
// "exactly", because a bootstrap that could do anything more would be a role-assignment back door
// with a reassuring name.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

/**
 * Source with COMMENTS REMOVED, for the checks that scan for forbidden code.
 *
 * THE SAME LESSON certificationIdentitySurvivesReset.test.mjs recorded, and it caught this file
 * too: the first version failed on the bootstrap's own header, which explains at length that it
 * accepts no --roleId. Documenting a prohibition made the file look like it did the thing it
 * prohibits. A guard that reads prose punishes explanation -- scan the code.
 */
function codeOf(rel) {
  // NORMALIZE LINE ENDINGS FIRST. On a CRLF checkout every boundary search for a newline-brace-
  // newline sequence misses, so a "function body" ran 45,000 characters past its own function and
  // swallowed unrelated code -- including a grantRole input the assertion then blamed on genesis.
  // A guard that depends on the checkout line endings passes or fails by luck. This removes the class.
  const raw = readFileSync(path.resolve(REPO, rel), "utf8").split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
  let out = "", i = 0;
  while (i < raw.length) {
    const o = raw.indexOf("/*", i);
    if (o === -1) { out += raw.slice(i); break; }
    out += raw.slice(i, o);
    const c = raw.indexOf("*/", o + 2);
    if (c === -1) break;
    i = c + 2;
  }
  return out.split(String.fromCharCode(10))
    .map((line) => (line.trimStart().startsWith("//") ? "" : line))
    .join(String.fromCharCode(10));
}

/**
 * The body of one named function, LINE-ENDING AGNOSTIC.
 *
 * The hand-rolled version searched for a newline-brace-newline terminator against a file checked
 * out with CRLF, so it never matched at the intended place and the "function body" ran 45,000 chars
 * past the function -- swallowing unrelated code and, in one case, an `input.roleId` belonging to
 * grantRole. The assertion then failed for a reason that had nothing to do with what it was
 * checking, on a branch where nothing about the function had changed.
 *
 * A guard that depends on the checkout's line endings is a guard that passes or fails by luck. It
 * happened to pass on the first branch and failed on the rebuilt one, which is exactly the kind of
 * accident that erodes trust in a suite. Normalizing first, in one place, removes the whole class.
 */
function functionBody(rel, signature) {
  const src = codeOf(rel);
  const start = src.indexOf(signature);
  if (start === -1) throw new Error(`${signature} not found in ${rel}`);
  const fn = src.slice(start);
  const NL = String.fromCharCode(10);
  const end = fn.indexOf(NL + "}" + NL);
  if (end === -1) throw new Error(`could not find the end of ${signature} in ${rel}`);
  return fn.slice(0, end);
}

const { authorizeGenesis, deriveGenesisEmployee, assessWorld, OUTCOME,
  EXPECTED_DATASET_VERSION, EXPECTED_FINGERPRINT, EXPECTED_RECORDS, EXPECTED_PRINCIPALS } =
  await import(L("functions/scripts/certificationWorld/bootstrapCertificationAuthority.mjs"));
const { LIVE_SANDBOX_PROJECT, CERTIFICATION_PROJECT, PRODUCTION_PROJECT, LIVE_FLAG,
  CERTIFICATION_LIVE_FLAG } =
  await import(L("functions/scripts/certificationWorld/executionTarget.mjs"));
const { GOVERNED_BUSINESS_ROLES: GB } = await import(L("functions/lib/access/governedBusinessRoles.js"));
const { buildWorkforce } = await import(L("functions/scripts/certificationWorld/data/workforce.mjs"));

function withEnv(env, fn) {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    for (const [k, v] of Object.entries(saved)) process.env[k] = v;
  }
}
const auth = (args, env = {}) =>
  withEnv({ FIRESTORE_EMULATOR_HOST: undefined, GOOGLE_CLOUD_PROJECT: undefined, GCLOUD_PROJECT: undefined, ...env },
    () => authorizeGenesis(args));
const refused = (args, env = {}) => { try { auth(args, env); return null; } catch (e) { return e; } };

const LIVE = ["--projectId", CERTIFICATION_PROJECT, "--apply", CERTIFICATION_LIVE_FLAG];

// ── THE MINIMUM GENESIS STATE IS DERIVED, NOT CHOSEN ──────────────────────────────────────────

test("GENESIS: the fixture declares exactly ONE privileged grant, and that is the whole bootstrap", () => {
  // This is the fact the entire design rests on. If the fixture ever declared two privileged Roles,
  // one authority holder would no longer be sufficient and genesis would need rethinking -- so it
  // is asserted rather than assumed, and deriveGenesisEmployee refuses rather than picking.
  const workforce = buildWorkforce();
  const privileged = workforce.flatMap((e) =>
    (e.certGovernedRoles ?? []).filter((r) => GB[r]?.privileged).map((r) => `${e.employeeId}:${r}`));
  assert.equal(privileged.length, 1, `expected exactly one privileged grant, got ${privileged.join(", ")}`);

  const g = deriveGenesisEmployee();
  assert.equal(g.employeeId, "cw-emp-000");
  assert.equal(g.roleId, "owner");
});

test("GENESIS: owner is the ONLY Role carrying admin.roleAssignment.write", () => {
  // If another Role carried it, genesis could establish a NON-privileged authority holder instead
  // and would not need to grant a privileged Role at all -- a strictly smaller bootstrap. It does
  // not, today, and this fails loudly if that ever changes.
  const holders = Object.entries(GB)
    .filter(([, r]) => (r.permissions ?? r.capabilities ?? []).includes("admin.roleAssignment.write"))
    .map(([id]) => id);
  assert.deepEqual(holders, ["owner"]);
  assert.equal(GB.owner.privileged, true);
});

test("GENESIS: every OTHER fixture grant is non-privileged, so one holder suffices", () => {
  // The payoff. A non-privileged grant requires verifyActorPermission alone -- one actor, no
  // approver -- so after genesis the remaining 86 flow through ordinary grantRole.
  const workforce = buildWorkforce();
  const all = workforce.flatMap((e) => (e.certGovernedRoles ?? []).map((r) => ({ e: e.employeeId, r })));
  const nonPriv = all.filter((g) => !GB[g.r]?.privileged);
  assert.equal(all.length - nonPriv.length, 1, "exactly one privileged grant expected");
  assert.ok(nonPriv.length >= 80, `expected the bulk to be non-privileged, got ${nonPriv.length}`);
});

test("GENESIS: refuses to choose when the fixture declares more than one privileged grant", () => {
  const twoPrivileged = [
    { employeeId: "cw-emp-000", certGovernedRoles: ["owner"] },
    { employeeId: "cw-emp-001", certGovernedRoles: ["owner"] },
  ];
  assert.throws(() => deriveGenesisEmployee(twoPrivileged), /will not choose between them/);
});

test("GENESIS: refuses when the fixture declares no privileged grant at all", () => {
  assert.throws(() => deriveGenesisEmployee([{ employeeId: "x", certGovernedRoles: ["dispatcher"] }]),
    /no privileged Role/);
});

// ── NO ARBITRARY INPUT ────────────────────────────────────────────────────────────────────────

test("GENESIS: the CLI accepts no role name and no employee id", () => {
  // A bootstrap that took either would be "grant arbitrary role to arbitrary person" wearing a
  // reassuring name. Asserted against the source because the absence of a parameter is the control.
  const src = codeOf("functions/scripts/certificationWorld/bootstrapCertificationAuthority.mjs");
  for (const forbidden of ["--roleId", "--employeeId", "--principalUid", "--role", "--uid"]) {
    assert.equal(src.includes(forbidden), false, `genesis must not accept ${forbidden}`);
  }
});

test("GENESIS: the service fixes the Role and takes no roleId input", () => {
  const body = functionBody("functions/src/access/trustedWriterCommands.ts",
    "export async function bootstrapCertificationAuthority");
  assert.equal(/input\.roleId/.test(body), false, "the genesis service must not read a roleId input");
  assert.match(body, /CERTIFICATION_GENESIS_ROLE_ID/, "it must use the fixed Role constant");
});

// ── TARGET AUTHORIZATION ──────────────────────────────────────────────────────────────────────

test("GENESIS: allowed with --projectId + --apply + the certification flag", () => {
  const r = auth(LIVE);
  assert.equal(r.target.projectId, CERTIFICATION_PROJECT);
  assert.equal(r.apply, true);
});

test("GENESIS: --apply alone is refused", () => {
  const err = refused(["--projectId", CERTIFICATION_PROJECT, "--apply"]);
  assert.ok(err);
  assert.match(err.message, /--apply-live-certification/);
});

test("GENESIS: the SANDBOX flag is refused, and so is the sandbox itself", () => {
  // Certification is the only environment whose authority is uninitialized by design. The sandbox's
  // came from its own history, and offering a second source for a world that already has one is
  // exactly what a bootstrap must not become.
  assert.match(refused(["--projectId", CERTIFICATION_PROJECT, "--apply", LIVE_FLAG])?.message ?? "",
    /--apply-live-certification/);
  assert.match(refused(["--projectId", LIVE_SANDBOX_PROJECT, "--apply", LIVE_FLAG])?.message ?? "",
    /genesis targets eos-platform-certification only/);
  assert.match(refused(["--projectId", LIVE_SANDBOX_PROJECT])?.message ?? "",
    /genesis targets eos-platform-certification only/);
});

test("GENESIS: PRODUCTION is refused with every flag combination, dry run included", () => {
  for (const args of [
    ["--projectId", PRODUCTION_PROJECT],
    ["--projectId", PRODUCTION_PROJECT, "--apply", CERTIFICATION_LIVE_FLAG],
    ["--projectId", PRODUCTION_PROJECT, "--apply", LIVE_FLAG, CERTIFICATION_LIVE_FLAG],
  ]) {
    const err = refused(args);
    assert.ok(err, `must refuse: ${args.join(" ")}`);
    assert.match(err.message, /production/i);
  }
});

test("GENESIS: unknown project, missing projectId and ambient mismatch are refused", () => {
  assert.match(refused(["--projectId", "eos-platform-certifcation", "--apply", CERTIFICATION_LIVE_FLAG])?.message ?? "",
    /Unknown project/);
  assert.match(refused(["--apply", CERTIFICATION_LIVE_FLAG])?.message ?? "", /--projectId is required/);
  assert.match(refused(LIVE, { GOOGLE_CLOUD_PROJECT: LIVE_SANDBOX_PROJECT })?.message ?? "",
    /Ambient credentials/);
});

test("GENESIS: a dry run needs no live flag and is not a write", () => {
  const r = auth(["--projectId", CERTIFICATION_PROJECT]);
  assert.equal(r.apply, false);
});

// ── WORLD PRECONDITIONS ───────────────────────────────────────────────────────────────────────

const GOOD = {
  state: { datasetVersion: EXPECTED_DATASET_VERSION, fingerprint: EXPECTED_FINGERPRINT, expectedRecords: EXPECTED_RECORDS },
  employeeCount: EXPECTED_PRINCIPALS,
  linkedCount: EXPECTED_PRINCIPALS,
  genesisEmployee: "cw-emp-000",
  genesisUid: "uid-000",
};

test("GENESIS: the correct world passes every precondition", () => {
  assert.deepEqual(assessWorld(GOOD), []);
});

test("GENESIS: a WRONG FINGERPRINT is refused", () => {
  // The sharpest case. A genesis grant against the wrong world establishes real authority over a
  // dataset nobody verified, and the assignment looks identical either way afterwards.
  const p = assessWorld({ ...GOOD, state: { ...GOOD.state, fingerprint: "deadbeef" } });
  assert.equal(p.length, 1);
  assert.match(p[0], /fingerprint deadbeef != expected 005ebb1b/);
});

test("GENESIS: a wrong datasetVersion or record count is refused", () => {
  assert.match(assessWorld({ ...GOOD, state: { ...GOOD.state, datasetVersion: "1.5.0" } })[0], /datasetVersion/);
  assert.match(assessWorld({ ...GOOD, state: { ...GOOD.state, expectedRecords: 1091 } })[0], /expectedRecords/);
});

test("GENESIS: an INCOMPLETE world is refused -- no deployment record at all", () => {
  assert.match(assessWorld({ ...GOOD, state: null })[0], /world not installed/);
});

test("GENESIS: incomplete principal linkage is refused", () => {
  assert.match(assessWorld({ ...GOOD, linkedCount: 46 })[0], /46\/47 principals linked/);
  assert.match(assessWorld({ ...GOOD, employeeCount: 46, linkedCount: 46 })[0], /46 employees installed/);
});

test("GENESIS: a MISSING genesis principal is refused -- nobody to authorize", () => {
  assert.match(assessWorld({ ...GOOD, genesisUid: null })[0], /has no linked principal/);
});

test("GENESIS: problems accumulate rather than short-circuiting", () => {
  // An operator fixing one precondition at a time, discovering the next only after another live
  // run, is how a bootstrap gets attempted five times against a world nobody has looked at.
  const p = assessWorld({ state: null, employeeCount: 0, linkedCount: 0, genesisEmployee: "cw-emp-000", genesisUid: null });
  assert.ok(p.length >= 4, `expected several problems, got ${p.length}`);
});

test("GENESIS: the outcome vocabulary includes ALREADY_BOOTSTRAPPED", () => {
  assert.equal(OUTCOME.ALREADY_BOOTSTRAPPED, "ALREADY_BOOTSTRAPPED");
  assert.equal(OUTCOME.WOULD_BOOTSTRAP, "WOULD_BOOTSTRAP");
});

// ── THE GENESIS WRITE TELLS THE TRUTH ─────────────────────────────────────────────────────────

test("GENESIS: the audit action is its own, not grantRole", () => {
  // Recording a genesis write as an ordinary grant by a person who did not exist yet would be a lie
  // in the one record whose entire purpose is to be trustworthy.
  const types = readFileSync(path.resolve(REPO, "functions/src/types/access.ts"), "utf8");
  const mirror = readFileSync(path.resolve(REPO, "functions/src/access/auditEventWriter.ts"), "utf8");
  assert.match(types, /\| "bootstrapCertificationAuthority"/, "the union must carry the genesis action");
  assert.match(mirror, /"bootstrapCertificationAuthority",/, "the runtime allow-list must mirror it");
});

test("GENESIS: the actor is a system identity, never a fabricated principal", () => {
  const src = readFileSync(path.resolve(REPO, "functions/src/access/trustedWriterCommands.ts"), "utf8");
  assert.match(src, /CERTIFICATION_GENESIS_ACTOR = "system:certification-authority-genesis"/);
  const body = functionBody("functions/src/access/trustedWriterCommands.ts", "export async function bootstrapCertificationAuthority");
  assert.match(body, /actorUid: CERTIFICATION_GENESIS_ACTOR/, "the audit actor must be the system identity");
  assert.match(body, /grantedBy: CERTIFICATION_GENESIS_ACTOR/, "grantedBy must not name a principal");
  assert.match(body, /genesis: true/, "the assignment must be identifiable as genesis");
});

test("GENESIS: the write goes through the shared access-mutation plumbing, not a raw script write", () => {
  const body = functionBody("functions/src/access/trustedWriterCommands.ts", "export async function bootstrapCertificationAuthority");
  assert.match(body, /runAccessMutationCommand/,
    "genesis must reuse the atomic assignment + accessVersion + audit transaction");
});

test("GENESIS: the service refuses production and any pre-existing active assignment", () => {
  const body = functionBody("functions/src/access/trustedWriterCommands.ts", "export async function bootstrapCertificationAuthority");
  assert.match(body, /role === "production"/, "production must be refused from the runtime identity");
  assert.match(body, /where\("status", "==", "active"\)/, "any active assignment must block genesis");
});

// ── THE PASSWORDLESS CERTIFICATION GRANT PATH ─────────────────────────────────────────────────

test("ROLE GRANTS: the certification path uses no password and no deployed callable", () => {
  const body = functionBody("functions/scripts/certificationWorld/applyRoleGrants.mjs", "async function resolveGrantExecutor");
  const certBranch = body.slice(body.indexOf("const active = await db"));
  // NAMED CONSTRUCTS, not the substring "password". The branch's own operator-facing label reads
  // "(passwordless, ADC)" -- a bare /password/ matched the word describing the absence of one,
  // which is the same trap as scanning prose: the guard punished the code for being clear.
  assert.equal(/signInWithPassword|loadSandboxPersona|idToken/.test(certBranch), false,
    "the certification branch must not authenticate with a credential");
  assert.equal(/cloudfunctions\.net/.test(certBranch), false,
    "the certification branch must not call a deployed callable");
  assert.match(certBranch, /trustedWriterCommands/, "it must call the trusted service");
  assert.match(certBranch, /grantRole\(\{ actorUid/, "it must invoke the same grantRole service");
});

test("ROLE GRANTS: sandbox keeps its persona + deployed-callable path", () => {
  // Degrading sandbox fidelity to make certification easier would trade away the thing the sandbox
  // exists to provide: an exercise of the real HTTP surface, Auth and claims.
  const src = readFileSync(
    path.resolve(REPO, "functions/scripts/certificationWorld/applyRoleGrants.mjs"), "utf8");
  assert.match(src, /loadSandboxPersona\(ACTOR_PERSONA\)/, "sandbox must still sign in as a persona");
  assert.match(src, /callGrantRole\(target\.projectId, session\.idToken/, "sandbox must still call the callable");
});

test("ROLE GRANTS: the certification actor is READ from the world, never named in code", () => {
  const body = functionBody("functions/scripts/certificationWorld/applyRoleGrants.mjs", "async function resolveGrantExecutor");
  assert.match(body, /roleAssignments/, "the actor must come from the live assignments");
  assert.match(body, /no active owner assignment/, "it must refuse before genesis has run");
  assert.match(body, /more than one active owner assignment/, "ambiguity must refuse, not pick");
  assert.equal(/cw-emp-000/.test(body), false, "the actor must not be hardcoded");
});

test("ROLE GRANTS: neither path writes roleAssignments directly", () => {
  // The entire point. Both routes reach the same service, and the service owns the document.
  const src = readFileSync(
    path.resolve(REPO, "functions/scripts/certificationWorld/applyRoleGrants.mjs"), "utf8");
  assert.equal(/collection\("roleAssignments"\)\s*\.?\s*\n?\s*\.doc\([^)]*\)\.(set|create|update)\(/.test(src), false,
    "applyRoleGrants must never write a role assignment itself");
});

test("ROLE GRANTS: the privileged grant is still held back on both paths", () => {
  const src = readFileSync(
    path.resolve(REPO, "functions/scripts/certificationWorld/applyRoleGrants.mjs"), "utf8");
  assert.match(src, /HELD_PRIVILEGED/, "the privileged grant must remain excluded from the batch");
  assert.match(src, /manifest\.filter\(\(m\) => m\.privileged\)/, "privileged grants are separated, not granted");
});
