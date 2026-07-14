// Issue #100 -- emulator proof for functions/scripts/
// bootstrapIssue100VerificationFixtures.js. NEVER touches production --
// every network call here targets the local Firestore/Auth emulator.
// Also proves the INTEGRATION claim this tool exists to make: fixtures
// this script creates, fed as environment variables into
// functions/scripts/verifyIssue100ProductionRules.js's own runChecks(),
// produce a complete PASS with zero restoration failures and zero
// skips -- the bootstrap tool's output is directly usable by the
// verify tool, not merely shaped similarly to it.
//
// Proves, without any production credential:
//   1. validateInput()/assertOutsideRepo() refuse every invalid
//      combination (missing/wrong project guard, missing production-data
//      authorization, missing Admin credential, a relative or
//      inside-repository --credentialsOutFile/--manifestFile, a missing
//      --manifestFile for --cleanup) and accept a fully valid one.
//   2. Dry-run safety -- a dry-run performs a REAL conflict-detecting
//      read against the emulator but creates zero Auth accounts, zero
//      Firestore documents, and zero credentials file.
//   3. A real --apply run creates exactly the expected account/document
//      counts, and the resulting env-var block, fed into
//      verifyIssue100ProductionRules.js's runChecks(), passes completely.
//   4. Secret non-disclosure -- no generated password or account email
//      ever appears in captured console output; the credentials file
//      (on disk, outside the repo) does contain them.
//   5. Collision/idempotent refusal -- re-running --apply against
//      already-provisioned state throws before any additional write,
//      naming a real conflict.
//   6. Cleanup boundaries -- a dry-run cleanup deletes nothing; a real
//      cleanup deletes every manifest-listed target EXCEPT one whose
//      fixtureMarker was tampered with after creation (marker-guard
//      proof, not blind trust in the manifest); a manifest whose own
//      fixtureMarker doesn't match this script's constant is refused
//      entirely.
//
// Prerequisite: run against a live Firestore + Auth emulator pair, e.g.:
//   firebase emulators:start --only firestore,auth --project taylor-parts
// then, in a second terminal:
//   node functions/test/bootstrapIssue100VerificationFixtures.test.js
"use strict";

const path = require("path");
const os = require("os");
const fs = require("fs");

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const admin = require("firebase-admin");
const {
  validateInput,
  assertOutsideRepo,
  repoRoot,
  buildAccountPlan,
  enumerateTargets,
  readCurrentState,
  detectConflicts,
  runBootstrapCommand,
  runCleanupCommand,
  runCleanup,
  FIXTURE_MARKER,
  FIXTURE_EMAIL_DOMAIN,
} = require("../scripts/bootstrapIssue100VerificationFixtures.js");
const { runChecks } = require("../scripts/verifyIssue100ProductionRules.js");

const PROJECT_ID = "taylor-parts";
const FIRESTORE_REST_BASE = "http://127.0.0.1:8080/v1";
const IDENTITY_TOOLKIT_BASE = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const auth = admin.auth();

let passed = 0;
let failed = 0;
function report(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`PASS -- ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL -- ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

function baseEnv(overrides) {
  return {
    FIREBASE_PROJECT_ID: PROJECT_ID,
    PRODUCTION_DATA_AUTHORIZED: "YES",
    GOOGLE_APPLICATION_CREDENTIALS: "/dev/null-not-actually-read-emulator-already-initialized",
    ...overrides,
  };
}

async function countFixtureAuthUsers() {
  const list = await auth.listUsers(1000);
  return list.users.filter((u) => (u.email || "").endsWith(`@${FIXTURE_EMAIL_DOMAIN}`)).length;
}

async function main() {
  // === 1. validateInput()/assertOutsideRepo() -- pure guard logic ===
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "issue100-verify-bootstrap-test-"));
  const credentialsOutFile = path.join(scratchDir, "issue100-verify-fixtures.json");

  report(
    "validateInput: refuses a wrong FIREBASE_PROJECT_ID",
    (() => {
      try {
        validateInput({ credentialsOutFile }, baseEnv({ FIREBASE_PROJECT_ID: "some-other-project" }));
        return false;
      } catch (err) {
        return /FIREBASE_PROJECT_ID/.test(err.message);
      }
    })()
  );

  report(
    "validateInput: refuses a missing/wrong PRODUCTION_DATA_AUTHORIZED",
    (() => {
      try {
        validateInput({ credentialsOutFile }, baseEnv({ PRODUCTION_DATA_AUTHORIZED: "yes" }));
        return false;
      } catch (err) {
        return /PRODUCTION_DATA_AUTHORIZED/.test(err.message);
      }
    })()
  );

  report(
    "validateInput: refuses a missing GOOGLE_APPLICATION_CREDENTIALS",
    (() => {
      const env = baseEnv();
      delete env.GOOGLE_APPLICATION_CREDENTIALS;
      try {
        validateInput({ credentialsOutFile }, env);
        return false;
      } catch (err) {
        return /GOOGLE_APPLICATION_CREDENTIALS/.test(err.message);
      }
    })()
  );

  report(
    "validateInput: refuses a missing --credentialsOutFile",
    (() => {
      try {
        validateInput({}, baseEnv());
        return false;
      } catch (err) {
        return /credentialsOutFile/.test(err.message);
      }
    })()
  );

  report(
    "validateInput: refuses a relative --credentialsOutFile",
    (() => {
      try {
        validateInput({ credentialsOutFile: "relative/path.json" }, baseEnv());
        return false;
      } catch (err) {
        return /absolute/.test(err.message);
      }
    })()
  );

  report(
    "validateInput: refuses a --credentialsOutFile that resolves INSIDE this repository",
    (() => {
      try {
        validateInput({ credentialsOutFile: path.join(repoRoot(), "leaked-fixtures.json") }, baseEnv());
        return false;
      } catch (err) {
        return /OUTSIDE this repository/.test(err.message);
      }
    })()
  );

  report(
    "validateInput: accepts a fully valid bootstrap invocation",
    (() => {
      const result = validateInput({ credentialsOutFile }, baseEnv());
      return result.mode === "bootstrap" && result.credentialsOutFile === credentialsOutFile && result.apply === false;
    })()
  );

  report(
    "validateInput: --apply flag is correctly parsed as true",
    validateInput({ credentialsOutFile, apply: "true" }, baseEnv()).apply === true
  );

  report(
    "validateInput: --cleanup requires --manifestFile",
    (() => {
      try {
        validateInput({ cleanup: "true" }, baseEnv());
        return false;
      } catch (err) {
        return /manifestFile/.test(err.message);
      }
    })()
  );

  report(
    "validateInput: --cleanup with a valid absolute outside-repo --manifestFile is accepted",
    validateInput({ cleanup: "true", manifestFile: credentialsOutFile }, baseEnv()).mode === "cleanup"
  );

  report(
    "assertOutsideRepo: throws for a path inside this repository, not for one outside it",
    (() => {
      let insideThrew = false;
      try {
        assertOutsideRepo("test", path.join(repoRoot(), "x.json"));
      } catch {
        insideThrew = true;
      }
      let outsideThrew = false;
      try {
        assertOutsideRepo("test", credentialsOutFile);
      } catch {
        outsideThrew = true;
      }
      return insideThrew && !outsideThrew;
    })()
  );

  // === 2. Dry-run safety -- a REAL conflict-detecting read, ZERO writes ===
  const dryRunInput = validateInput({ credentialsOutFile }, baseEnv());
  const authUsersBeforeDryRun = await countFixtureAuthUsers();
  const dryRunResult = await runBootstrapCommand(db, auth, dryRunInput);
  report("dry-run: reports ok and applied:false", dryRunResult.ok === true && dryRunResult.applied === false);
  report("dry-run: creates zero Auth accounts", (await countFixtureAuthUsers()) === authUsersBeforeDryRun);
  report("dry-run: creates zero Firestore documents (spot-check the Parts Manager Employee)", (await db.collection("employees").doc(dryRunResult.accounts.PARTS_MANAGER.employeeId).get()).exists === false);
  report("dry-run: writes no credentials file", !fs.existsSync(credentialsOutFile));

  // === 3. Real --apply run -- exact counts, then hand its own output to
  // the real verify script's runChecks() and prove a complete PASS ===
  const applyInput = validateInput({ credentialsOutFile, apply: "true" }, baseEnv());

  const capturedLines = [];
  const realConsoleLog = console.log;
  console.log = (...args) => {
    capturedLines.push(args.join(" "));
    realConsoleLog(...args);
  };
  let applyResult;
  try {
    applyResult = await runBootstrapCommand(db, auth, applyInput);
  } finally {
    console.log = realConsoleLog;
  }

  report("apply: succeeds and reports applied:true", applyResult.ok === true && applyResult.applied === true);
  // 4 required + 1 cross-user + 4 optional = 9.
  report("apply: creates exactly 9 Auth accounts", applyResult.manifest.authUsers.length === 9, `got ${applyResult.manifest.authUsers.length}`);
  // 7 normal accounts x2 (employees+users) + 1 broken (users only) + 1
  // nonreciprocal x2 (employees+users) = 17, plus 12 env-keyed fixture
  // docs + 3 extra linked Purchase-Order/Void records = 15. Total 32.
  report("apply: creates exactly 32 Firestore documents", applyResult.manifest.firestoreDocs.length === 32, `got ${applyResult.manifest.firestoreDocs.length}`);
  report("apply: writes the credentials file", fs.existsSync(credentialsOutFile));

  // === 4. Secret non-disclosure ===
  // Every account's password/email -- including PARTS_ASSOCIATE_OTHER,
  // the cross-user fixture owner -- must never appear in console output,
  // even though that one account (unlike the other 8) is never signed
  // in by verifyIssue100ProductionRules.js and so is deliberately absent
  // from the credentials file's own env block below (checked separately).
  const allPasswords = Object.values(applyResult.accounts).map((a) => a.password);
  const allEmails = Object.values(applyResult.accounts).map((a) => a.email);
  const leakedSecrets = capturedLines.filter((line) => allPasswords.some((p) => line.includes(p)) || allEmails.some((e) => line.includes(e)));
  report("apply: no password or email appears in any captured console line", leakedSecrets.length === 0, `leaked: ${JSON.stringify(leakedSecrets)}`);

  const fileContent = fs.readFileSync(credentialsOutFile, "utf8");
  const envBlockAccountKeys = Object.keys(applyResult.accounts).filter((k) => k !== "PARTS_ASSOCIATE_OTHER");
  const envBlockPasswords = envBlockAccountKeys.map((k) => applyResult.accounts[k].password);
  const envBlockEmails = envBlockAccountKeys.map((k) => applyResult.accounts[k].email);
  const fileHasEverySecret = envBlockPasswords.every((p) => fileContent.includes(p)) && envBlockEmails.every((e) => fileContent.includes(e));
  report("apply: the credentials file contains every verifier-required account's password and email", fileHasEverySecret);
  report(
    "apply: the credentials file does NOT expose PARTS_ASSOCIATE_OTHER's password (not a verifier env var)",
    !fileContent.includes(applyResult.accounts.PARTS_ASSOCIATE_OTHER.password)
  );

  // === 5. Integration -- bootstrap's own output drives a full verify pass ===
  const parsedFile = JSON.parse(fileContent);
  const envLines = parsedFile.envBlock.split("\n");
  const verifyEnv = Object.fromEntries(envLines.map((line) => {
    const idx = line.indexOf("=");
    return [line.slice(0, idx), line.slice(idx + 1)];
  }));
  verifyEnv.FIREBASE_WEB_API_KEY = "fake-api-key"; // bootstrap doesn't know the real one in this test env

  const r = await runChecks({
    firestoreRestBase: FIRESTORE_REST_BASE,
    identityToolkitBase: IDENTITY_TOOLKIT_BASE,
    projectId: PROJECT_ID,
    adminDb: db,
    env: verifyEnv,
  });
  report("integration: verifyIssue100ProductionRules.js's runChecks() reports zero failures against bootstrap's own fixtures", r.failed === 0, `${r.passed} passed, ${r.failed} failed`);
  report("integration: zero restoration failures", r.restorationFailures === 0);
  const skippedCount = r.results.filter((x) => x.ok === null).length;
  report("integration: zero SKIPs (every optional linkage fixture was supplied)", skippedCount === 0, `${skippedCount} skipped`);

  // === 6. Collision / idempotent refusal -- re-running --apply now MUST
  // refuse before any additional write ===
  const authUsersAfterFirstApply = await countFixtureAuthUsers();
  const secondApplyInput = validateInput({ credentialsOutFile: path.join(scratchDir, "second-run.json"), apply: "true" }, baseEnv());
  const secondApplyResult = await runBootstrapCommand(db, auth, secondApplyInput);
  report("re-apply: refuses (ok:false) rather than duplicating or silently succeeding", secondApplyResult.ok === false && secondApplyResult.exitCode === 1);
  report("re-apply: names a real conflicting email in its error", allEmails.some((e) => secondApplyResult.error.includes(e)));
  report("re-apply: creates ZERO additional Auth accounts", (await countFixtureAuthUsers()) === authUsersAfterFirstApply);
  report("re-apply: does not write a second credentials file", !fs.existsSync(path.join(scratchDir, "second-run.json")));

  // === 7. Cleanup boundaries ===
  // Tamper with exactly one fixture document's marker, simulating a
  // stale/hand-edited manifest pointing at a document that has since
  // been repurposed -- cleanup must skip THIS ONE document, never trust
  // the manifest blindly.
  const tamperedRef = db.collection("employees").doc(applyResult.accounts.PARTS_MANAGER.employeeId);
  const tamperedBefore = (await tamperedRef.get()).data();
  await tamperedRef.set({ ...tamperedBefore, fixtureMarker: "SOMETHING_ELSE_ENTIRELY" }, { merge: true });

  const cleanupDryRunInput = validateInput({ cleanup: "true", manifestFile: credentialsOutFile }, baseEnv());
  const cleanupDryRunResult = await runCleanupCommand(db, auth, cleanupDryRunInput);
  report("cleanup dry-run: deletes zero Auth accounts", (await countFixtureAuthUsers()) === authUsersAfterFirstApply);
  report("cleanup dry-run: deletes zero Firestore documents (spot-check the tampered Employee still exists)", (await tamperedRef.get()).exists === true);
  report(
    "cleanup dry-run: correctly identifies the one tampered document as a would-be SKIP",
    cleanupDryRunResult.results.skippedDocs.length === 1,
    `skipped: ${JSON.stringify(cleanupDryRunResult.results.skippedDocs)}`
  );

  const cleanupApplyInput = validateInput({ cleanup: "true", manifestFile: credentialsOutFile, apply: "true" }, baseEnv());
  const cleanupApplyResult = await runCleanupCommand(db, auth, cleanupApplyInput);
  report("cleanup apply: deletes all 9 fixture Auth accounts", (await countFixtureAuthUsers()) === 0);
  report(
    "cleanup apply: deletes 31 of 32 Firestore documents, skipping the tampered one",
    cleanupApplyResult.results.deletedDocs === 31 && cleanupApplyResult.results.skippedDocs.length === 1,
    `deleted ${cleanupApplyResult.results.deletedDocs}, skipped ${JSON.stringify(cleanupApplyResult.results.skippedDocs)}`
  );
  report("cleanup apply: the marker-tampered document was NOT deleted (marker-guard proof)", (await tamperedRef.get()).exists === true);
  report("cleanup apply: exit code is nonzero when anything was skipped, signaling manual review is needed", cleanupApplyResult.exitCode === 1);

  // A manifest whose own top-level fixtureMarker doesn't match this
  // script's constant is refused entirely, before touching any target.
  const badManifestFile = path.join(scratchDir, "bad-manifest.json");
  fs.writeFileSync(badManifestFile, JSON.stringify({ fixtureMarker: "WRONG_VERSION", manifest: { authUsers: [], firestoreDocs: [] } }));
  let badManifestThrew = false;
  try {
    await runCleanup(db, auth, badManifestFile, false);
  } catch (err) {
    badManifestThrew = /fixtureMarker/.test(err.message);
  }
  report("cleanup: refuses a manifest whose own fixtureMarker does not match this script's constant", badManifestThrew);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
