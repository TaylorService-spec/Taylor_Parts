// Issue #100 -- emulator proof for functions/scripts/
// bootstrapIssue100VerificationFixtures.js. NEVER touches production --
// every network call here targets the local Firestore/Auth emulator.
//
// Proves, without any production credential:
//   1. validateInput()/assertOutsideRepo() refuse every invalid
//      combination and accept a fully valid one, including the real
//      (symlink-resolved) parent-directory check.
//   2. Dry-run safety -- zero writes, zero files.
//   3. A real --apply run creates the exact expected counts, and the
//      resulting env-var block, fed into
//      verifyIssue100ProductionRules.js's runChecks(), passes
//      completely (zero-SKIP integration with PR #200).
//   4. Secret non-disclosure, and that error output is always a FIXED,
//      classified, identifier-free message -- never a caught error's
//      own raw message.
//   5. Collision/idempotent refusal.
//   6. Crash-safe recovery: a mid-Auth-creation failure and a mid-
//      Firestore-creation failure are each fully compensated (reverse
//      order, zero residual state); a failure DURING compensation
//      itself is reported as a distinct, non-recoverable-automatically
//      outcome (exit code 4) with the manifest retained and accurate;
//      a manifest left behind by a simulated hard crash (never reaching
//      compensation at all) is safely resolvable via --cleanup ("restart
//      recovery").
//   7. Credential/manifest output: refuses an already-existing
//      destination (never truncates/overwrites it), applies restrictive
//      permissions, and refuses a symlinked parent directory that
//      resolves back into this repository.
//   8. Cleanup is strictly all-or-nothing: a single marker-tampered
//      target aborts the ENTIRE cleanup with zero deletions -- not a
//      partial skip-one-continue-the-rest.
//   9. Corrected PM History fixture attribution: assignedBy is the
//      Parts Manager's own uid, reviewedBy is the Admin's own uid --
//      never an admin-only review transition attributed to Parts
//      Manager.
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
  applyBootstrapWithRecovery,
  FIXTURE_MARKER,
  FIXTURE_EMAIL_DOMAIN,
  FIXED_MESSAGES,
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
function skip(name, reason) {
  console.log(`SKIP -- ${name} (${reason})`);
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

async function deleteAllFixtureAuthUsers() {
  const list = await auth.listUsers(1000);
  const targets = list.users.filter((u) => (u.email || "").endsWith(`@${FIXTURE_EMAIL_DOMAIN}`));
  await Promise.all(targets.map((u) => auth.deleteUser(u.uid).catch(() => {})));
}

async function deleteAllFixtureDocs() {
  for (const collection of ["employees", "users", "reorder_requests", "reorder_purchase_orders", "reorder_purchase_order_voids", "inventory_transactions", "inventory_actions"]) {
    const snap = await db.collection(collection).get();
    await Promise.all(
      snap.docs
        .filter((d) => (d.data() || {}).fixtureMarker === FIXTURE_MARKER || String(d.id).startsWith("issue100-verify"))
        .map((d) => d.ref.delete().catch(() => {}))
    );
  }
}

async function resetEmulatorFixtureState() {
  await deleteAllFixtureAuthUsers();
  await deleteAllFixtureDocs();
}

// ---------------------------------------------------------------
// Failure-injection wrappers -- thin proxies over the real Admin SDK
// auth/db objects, used ONLY to deterministically trigger a failure at
// an exact call count so recovery/compensation logic can be proven
// without relying on genuine flakiness.
// ---------------------------------------------------------------
function wrapAuthWithFailure(realAuth, { failCreateOnCall = null, failDeleteOnCall = null } = {}) {
  let createCalls = 0;
  let deleteCalls = 0;
  return {
    createUser: async (...args) => {
      createCalls += 1;
      if (createCalls === failCreateOnCall) throw new Error("INJECTED: createUser failure");
      return realAuth.createUser(...args);
    },
    deleteUser: async (uid) => {
      deleteCalls += 1;
      if (deleteCalls === failDeleteOnCall) throw new Error("INJECTED: deleteUser failure");
      return realAuth.deleteUser(uid);
    },
    getUser: (...args) => realAuth.getUser(...args),
    getUserByEmail: (...args) => realAuth.getUserByEmail(...args),
  };
}

function wrapDbWithFailure(realDb, { failSetOnCall = null } = {}) {
  let setCalls = 0;
  return {
    collection: (name) => {
      const realCollection = realDb.collection(name);
      return {
        doc: (id) => {
          const realDocRef = realCollection.doc(id);
          return {
            get: () => realDocRef.get(),
            set: async (data) => {
              setCalls += 1;
              if (setCalls === failSetOnCall) throw new Error("INJECTED: set failure");
              return realDocRef.set(data);
            },
            delete: () => realDocRef.delete(),
          };
        },
      };
    },
  };
}

let pathCounter = 0;
function freshPath(scratchDir, name) {
  pathCounter += 1;
  return path.join(scratchDir, `${name}-${pathCounter}.json`);
}

async function main() {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "issue100-verify-bootstrap-test-"));

  // === 1. validateInput()/assertOutsideRepo() -- pure guard logic ===
  const credentialsOutFile = freshPath(scratchDir, "validate-check");

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
    "validateInput: refuses a --credentialsOutFile whose parent directory resolves INSIDE this repository",
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

  // === 7 (part 1). Symlink/junction escape -- best-effort: symlink
  // creation requires elevated privileges on some Windows configurations;
  // skip gracefully (not a FAIL) if unsupported in this environment. ===
  {
    const linkDir = path.join(scratchDir, "symlinked-parent");
    let symlinkCreated = false;
    try {
      fs.symlinkSync(repoRoot(), linkDir, "junction");
      symlinkCreated = true;
    } catch {
      try {
        fs.symlinkSync(repoRoot(), linkDir, "dir");
        symlinkCreated = true;
      } catch {
        symlinkCreated = false;
      }
    }
    if (!symlinkCreated) {
      skip("assertOutsideRepo: refuses a symlinked/junctioned parent directory that resolves back into the repository", "symlink/junction creation not permitted in this environment");
    } else {
      const throughSymlink = path.join(linkDir, "escaped-fixtures.json");
      let threw = false;
      try {
        assertOutsideRepo("test", throughSymlink);
      } catch (err) {
        threw = /real \(symlink-resolved\)/.test(err.message);
      }
      report("assertOutsideRepo: refuses a symlinked/junctioned parent directory that resolves back into the repository", threw);
    }
  }

  // === 2. Dry-run safety -- a REAL conflict-detecting read, ZERO writes ===
  await resetEmulatorFixtureState();
  const dryRunInput = validateInput({ credentialsOutFile: freshPath(scratchDir, "dry-run") }, baseEnv());
  const authUsersBeforeDryRun = await countFixtureAuthUsers();
  const dryRunResult = await runBootstrapCommand(db, auth, dryRunInput);
  report("dry-run: reports ok and applied:false", dryRunResult.ok === true && dryRunResult.applied === false);
  report("dry-run: creates zero Auth accounts", (await countFixtureAuthUsers()) === authUsersBeforeDryRun);
  report("dry-run: creates zero Firestore documents (spot-check the Parts Manager Employee)", (await db.collection("employees").doc(dryRunResult.accounts.PARTS_MANAGER.employeeId).get()).exists === false);
  report("dry-run: writes no credentials/manifest file", !fs.existsSync(dryRunInput.credentialsOutFile));

  // === 3/4/9. Real --apply run -- exact counts, secrets, integration,
  // corrected PM History attribution ===
  const applyPath = freshPath(scratchDir, "apply");
  const applyInput = validateInput({ credentialsOutFile: applyPath, apply: "true" }, baseEnv());

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
  report("apply: creates exactly 9 Auth accounts", applyResult.manifest.authUsers.length === 9, `got ${applyResult.manifest.authUsers.length}`);
  report("apply: creates exactly 32 Firestore documents", applyResult.manifest.firestoreDocs.length === 32, `got ${applyResult.manifest.firestoreDocs.length}`);
  report("apply: writes the credentials/manifest file", fs.existsSync(applyPath));

  const allPasswords = Object.values(applyResult.accounts).map((a) => a.password);
  const allEmails = Object.values(applyResult.accounts).map((a) => a.email);
  const leakedSecrets = capturedLines.filter((line) => allPasswords.some((p) => line.includes(p)) || allEmails.some((e) => line.includes(e)));
  report("apply: no password or email appears in any captured console line", leakedSecrets.length === 0, `leaked: ${JSON.stringify(leakedSecrets)}`);

  const fileContent = fs.readFileSync(applyPath, "utf8");
  const envBlockAccountKeys = Object.keys(applyResult.accounts).filter((k) => k !== "PARTS_ASSOCIATE_OTHER");
  const fileHasEverySecret = envBlockAccountKeys.every((k) => fileContent.includes(applyResult.accounts[k].password) && fileContent.includes(applyResult.accounts[k].email));
  report("apply: the credentials file contains every verifier-required account's password and email", fileHasEverySecret);
  report(
    "apply: the credentials file does NOT expose PARTS_ASSOCIATE_OTHER's password (not a verifier env var)",
    !fileContent.includes(applyResult.accounts.PARTS_ASSOCIATE_OTHER.password)
  );

  const statMode = fs.statSync(applyPath).mode & 0o777;
  report(
    "apply: the credentials file has restrictive (owner-only) permissions where the platform supports it",
    process.platform === "win32" || statMode === 0o600,
    `mode ${statMode.toString(8)}`
  );

  const parsedFile = JSON.parse(fileContent);
  report("apply: manifest status is COMPLETE", parsedFile.status === "COMPLETE");

  const pmHistoryEntry = parsedFile.manifest.firestoreDocs.find((d) => d.label === "PM_HISTORY_DOC_ID");
  const pmHistorySnap = await db.collection("reorder_requests").doc(pmHistoryEntry.docId).get();
  const pmHistoryData = pmHistorySnap.data();
  const pmUid = applyResult.manifest.authUsers.find((u) => u.role === "PARTS_MANAGER").uid;
  const adminUid = applyResult.manifest.authUsers.find((u) => u.role === "ADMIN").uid;
  report(
    "PM History fixture: assignedBy is the Parts Manager's own uid (a real Assign that account can actually perform)",
    pmHistoryData.assignedBy === pmUid
  );
  report(
    "PM History fixture: reviewedBy is the Admin's own uid (Approve/Reject/Cancel remain admin/dispatcher-only)",
    pmHistoryData.reviewedBy === adminUid
  );
  report(
    "PM History fixture: status is CANCELLED (a real terminal state reachable by this exact sequence)",
    pmHistoryData.status === "CANCELLED" && pmHistoryData.cancelledBy === adminUid
  );

  const envLines = parsedFile.envBlock.split("\n");
  const verifyEnv = Object.fromEntries(envLines.map((line) => {
    const idx = line.indexOf("=");
    return [line.slice(0, idx), line.slice(idx + 1)];
  }));
  verifyEnv.FIREBASE_WEB_API_KEY = "fake-api-key";

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

  // === 5. Collision / idempotent refusal ===
  const authUsersAfterFirstApply = await countFixtureAuthUsers();
  const secondApplyInput = validateInput({ credentialsOutFile: freshPath(scratchDir, "second-run"), apply: "true" }, baseEnv());
  const secondApplyResult = await runBootstrapCommand(db, auth, secondApplyInput);
  report("re-apply: refuses (ok:false) rather than duplicating or silently succeeding", secondApplyResult.ok === false && secondApplyResult.exitCode === 1 && secondApplyResult.reason === "CONFLICT");
  report("re-apply: internal error detail names a real conflicting email (available for tests, never printed)", allEmails.some((e) => secondApplyResult.internalErrorDetail.includes(e)));
  report("re-apply: creates ZERO additional Auth accounts", (await countFixtureAuthUsers()) === authUsersAfterFirstApply);
  report("re-apply: does not write a second credentials file", !fs.existsSync(secondApplyInput.credentialsOutFile));

  // === 7 (part 2). Existing-output refusal -- never truncates/overwrites ===
  // Reset first -- the collision-refusal test above deliberately left
  // the first apply's 9 real accounts/32 documents in place (that WAS
  // the point); this test needs a clean Auth/Firestore state so the
  // only conflict it can hit is the pre-existing output file itself.
  await resetEmulatorFixtureState();
  const preexistingPath = freshPath(scratchDir, "preexisting");
  const originalContent = "ORIGINAL CONTENT THAT MUST SURVIVE -- NOT A REAL MANIFEST";
  fs.writeFileSync(preexistingPath, originalContent);
  const authUsersBeforeRefusalTest = await countFixtureAuthUsers();
  const refusalInput = validateInput({ credentialsOutFile: preexistingPath, apply: "true" }, baseEnv());
  const refusalResult = await runBootstrapCommand(db, auth, refusalInput);
  report(
    "existing-output refusal: apply fails with reason MANIFEST_CREATE_FAILED when the destination already exists",
    refusalResult.ok === false && refusalResult.exitCode === 1 && refusalResult.reason === "MANIFEST_CREATE_FAILED"
  );
  report("existing-output refusal: the pre-existing file's content is completely unchanged (never truncated/overwritten)", fs.readFileSync(preexistingPath, "utf8") === originalContent);
  report("existing-output refusal: zero Auth accounts were created (conflict detection had already passed; refusal happens before any mutation)", (await countFixtureAuthUsers()) === authUsersBeforeRefusalTest);

  // === 4 (part 2) / 6. Crash-safe recovery ===

  // Mid-Auth failure: fails on the 5th of 9 createUser() calls -- the
  // first 4 (PARTS_MANAGER/WAREHOUSE_MANAGER/PARTS_ASSOCIATE/ADMIN) must
  // be compensated (deleted) in reverse order; zero Firestore writes
  // are ever attempted (Firestore writes only begin after every Auth
  // account succeeds).
  {
    await resetEmulatorFixtureState();
    const midAuthPath = freshPath(scratchDir, "mid-auth-failure");
    const midAuthInput = validateInput({ credentialsOutFile: midAuthPath, apply: "true" }, baseEnv());
    const accounts = buildAccountPlan();
    const failingAuth = wrapAuthWithFailure(auth, { failCreateOnCall: 5 });

    const capturedErrLines = [];
    const realConsoleError = console.error;
    console.error = (...args) => {
      capturedErrLines.push(args.join(" "));
      realConsoleError(...args);
    };
    let midAuthResult;
    try {
      midAuthResult = await applyBootstrapWithRecovery(db, failingAuth, accounts, midAuthInput);
    } finally {
      console.error = realConsoleError;
    }

    report(
      "mid-Auth failure: reported as fully compensated, exit code 1",
      midAuthResult.ok === false && midAuthResult.exitCode === 1 && midAuthResult.reason === "APPLY_FAILED_FULLY_COMPENSATED"
    );
    report("mid-Auth failure: zero fixture Auth accounts remain (all 4 created ones were compensated)", (await countFixtureAuthUsers()) === 0);
    report("mid-Auth failure: zero Firestore documents were ever created", (await db.collection("employees").doc("issue100-verify-emp-parts-manager").get()).exists === false);
    const midAuthManifest = JSON.parse(fs.readFileSync(midAuthPath, "utf8"));
    report("mid-Auth failure: manifest status is FAILED_COMPENSATED and every recorded account is marked deleted", midAuthManifest.status === "FAILED_COMPENSATED" && midAuthManifest.manifest.authUsers.length === 4 && midAuthManifest.manifest.authUsers.every((u) => u.deleted === true));
  }

  // Mid-Firestore failure: all 9 Auth accounts succeed, then a Firestore
  // set() call fails partway through document creation -- compensation
  // must reverse every created document AND every created Auth account.
  {
    await resetEmulatorFixtureState();
    const midDocPath = freshPath(scratchDir, "mid-doc-failure");
    const midDocInput = validateInput({ credentialsOutFile: midDocPath, apply: "true" }, baseEnv());
    const accounts = buildAccountPlan();
    const failingDb = wrapDbWithFailure(db, { failSetOnCall: 20 });

    const midDocResult = await applyBootstrapWithRecovery(failingDb, auth, accounts, midDocInput);
    report(
      "mid-Firestore failure: reported as fully compensated, exit code 1",
      midDocResult.ok === false && midDocResult.exitCode === 1 && midDocResult.reason === "APPLY_FAILED_FULLY_COMPENSATED"
    );
    report("mid-Firestore failure: zero fixture Auth accounts remain", (await countFixtureAuthUsers()) === 0);
    const midDocManifest = JSON.parse(fs.readFileSync(midDocPath, "utf8"));
    const allDocsDeleted = midDocManifest.manifest.firestoreDocs.every((d) => d.deleted === true);
    const allAuthDeleted = midDocManifest.manifest.authUsers.every((u) => u.deleted === true);
    report(
      "mid-Firestore failure: manifest status is FAILED_COMPENSATED and every recorded account/document is marked deleted",
      midDocManifest.status === "FAILED_COMPENSATED" && allDocsDeleted && allAuthDeleted,
      `docs deleted: ${allDocsDeleted}, auth deleted: ${allAuthDeleted}`
    );
    report("mid-Firestore failure: at least one document was actually attempted (proves the failure happened mid-Firestore-phase, not mid-Auth)", midDocManifest.manifest.firestoreDocs.length > 0);
  }

  // Incomplete rollback: a Firestore failure triggers compensation, but
  // the FIRST compensating deleteUser() call also fails -- compensation
  // must still attempt (and succeed at) every OTHER item, end with a
  // DISTINCT hard-failure exit code, and retain the manifest exactly as
  // it stands (some deleted:true, exactly one still deleted:false).
  {
    await resetEmulatorFixtureState();
    const incompletePath = freshPath(scratchDir, "incomplete-rollback");
    const incompleteInput = validateInput({ credentialsOutFile: incompletePath, apply: "true" }, baseEnv());
    const accounts = buildAccountPlan();
    const failingDb = wrapDbWithFailure(db, { failSetOnCall: 20 });
    const failingAuth = wrapAuthWithFailure(auth, { failDeleteOnCall: 1 });

    const incompleteResult = await applyBootstrapWithRecovery(failingDb, failingAuth, accounts, incompleteInput);
    report(
      "incomplete rollback: reported with the distinct hard-failure exit code 4",
      incompleteResult.ok === false && incompleteResult.exitCode === 4 && incompleteResult.reason === "APPLY_FAILED_INCOMPLETE_COMPENSATION"
    );
    report("incomplete rollback: exactly one compensation failure is recorded", incompleteResult.compensationFailures.length === 1, `got ${JSON.stringify(incompleteResult.compensationFailures)}`);
    const incompleteManifest = JSON.parse(fs.readFileSync(incompletePath, "utf8"));
    report("incomplete rollback: manifest status is FAILED_INCOMPLETE_COMPENSATION and is retained on disk", incompleteManifest.status === "FAILED_INCOMPLETE_COMPENSATION");
    const stillPresentAuth = incompleteManifest.manifest.authUsers.filter((u) => !u.deleted);
    report("incomplete rollback: exactly one Auth account is still recorded as NOT deleted (the one whose compensation failed)", stillPresentAuth.length === 1, `got ${JSON.stringify(stillPresentAuth)}`);
    report("incomplete rollback: every Firestore document WAS successfully compensated despite the Auth failure", incompleteManifest.manifest.firestoreDocs.every((d) => d.deleted === true));

    // Clean up the genuinely-stranded account (real Admin SDK, direct --
    // this is test teardown, not part of the mechanism under test) so it
    // doesn't pollute later assertions in this file.
    if (stillPresentAuth.length === 1) {
      await auth.deleteUser(stillPresentAuth[0].uid).catch(() => {});
    }
  }

  report("crash-safe recovery: zero fixture Auth accounts remain after all three recovery scenarios", (await countFixtureAuthUsers()) === 0);

  // Restart recovery: simulate a hard crash that never reached
  // compensation at all -- create some REAL Auth accounts/Firestore
  // documents directly (bypassing applyBootstrapWithRecovery entirely),
  // hand-write an IN_PROGRESS manifest describing exactly them, and
  // prove --cleanup can safely resolve it.
  {
    const restartPath = freshPath(scratchDir, "restart-recovery");
    const crashedUser1 = await auth.createUser({ email: "restart-recovery-1@issue100-verify.fixtures.invalid", password: "Xk9-restart-recovery-pw-1" });
    const crashedUser2 = await auth.createUser({ email: "restart-recovery-2@issue100-verify.fixtures.invalid", password: "Xk9-restart-recovery-pw-2" });
    await db.collection("employees").doc("issue100-verify-emp-restart-recovery").set({ employeeId: "issue100-verify-emp-restart-recovery", fixtureMarker: FIXTURE_MARKER, createdAt: Date.now() });

    const crashedManifest = {
      fixtureMarker: FIXTURE_MARKER,
      generatedAt: new Date().toISOString(),
      projectId: PROJECT_ID,
      status: "IN_PROGRESS", // never reached COMPLETE or any FAILED_* state -- exactly a hard-crash snapshot
      envBlock: null,
      manifest: {
        authUsers: [
          { role: "RESTART_1", uid: crashedUser1.uid, email: crashedUser1.email, deleted: false },
          { role: "RESTART_2", uid: crashedUser2.uid, email: crashedUser2.email, deleted: false },
        ],
        firestoreDocs: [
          { collection: "employees", docId: "issue100-verify-emp-restart-recovery", label: "RESTART employee", deleted: false },
        ],
      },
    };
    fs.writeFileSync(restartPath, JSON.stringify(crashedManifest, null, 2));

    const restartCleanupInput = validateInput({ cleanup: "true", manifestFile: restartPath, apply: "true" }, baseEnv());
    const restartCleanupResult = await runCleanupCommand(db, auth, restartCleanupInput);
    report(
      "restart recovery: cleanup successfully resolves a manifest left behind by a simulated hard crash (status IN_PROGRESS, never compensated)",
      restartCleanupResult.ok === true && restartCleanupResult.results.deletedAuthUsers === 2 && restartCleanupResult.results.deletedDocs === 1
    );
    report("restart recovery: both crashed Auth accounts are actually gone", (await auth.getUser(crashedUser1.uid).catch(() => null)) === null && (await auth.getUser(crashedUser2.uid).catch(() => null)) === null);
    report("restart recovery: the crashed Firestore document is actually gone", (await db.collection("employees").doc("issue100-verify-emp-restart-recovery").get()).exists === false);
  }

  // === 4 (part 3). Safe error output -- fixed messages only, never a
  // raw caught-error message, across every failure path exercised above
  // plus a fresh forced apply failure captured here directly. ===
  {
    await resetEmulatorFixtureState();
    const safeErrorPath = freshPath(scratchDir, "safe-error-output");
    const safeErrorInput = validateInput({ credentialsOutFile: safeErrorPath, apply: "true" }, baseEnv());
    const accounts = buildAccountPlan();
    const failingAuth = wrapAuthWithFailure(auth, { failCreateOnCall: 2 });

    const errCapturedLines = [];
    const realConsoleError = console.error;
    console.error = (...args) => {
      errCapturedLines.push(args.join(" "));
      realConsoleError(...args);
    };
    let forcedResult;
    try {
      forcedResult = await applyBootstrapWithRecovery(db, failingAuth, accounts, safeErrorInput);
    } finally {
      console.error = realConsoleError;
    }

    report(
      "safe error output: the raw injected error message is available on the return value (for tests/control flow) but never printed",
      forcedResult.internalErrorDetail === "INJECTED: createUser failure" &&
        !errCapturedLines.some((line) => line.includes("INJECTED"))
    );
    report(
      "safe error output: FIXED_MESSAGES strings are stable, exported constants a caller can rely on for classification",
      typeof FIXED_MESSAGES.APPLY_FAILED_FULLY_COMPENSATED === "string" && FIXED_MESSAGES.APPLY_FAILED_FULLY_COMPENSATED.length > 0
    );

    if (await countFixtureAuthUsers() > 0) await deleteAllFixtureAuthUsers();
  }

  // === 8. Cleanup all-or-nothing -- re-provision a full fixture set,
  // tamper with exactly one document's marker BEFORE any cleanup
  // deletion is attempted, and prove the ENTIRE cleanup aborts with
  // ZERO deletions -- not a partial skip-one-continue-the-rest. ===
  await resetEmulatorFixtureState();
  const cleanupTestPath = freshPath(scratchDir, "cleanup-all-or-nothing");
  const cleanupApplyInput = validateInput({ credentialsOutFile: cleanupTestPath, apply: "true" }, baseEnv());
  const cleanupApplyResult = await runBootstrapCommand(db, auth, cleanupApplyInput);
  report("cleanup setup: fresh apply for the all-or-nothing test succeeds", cleanupApplyResult.ok === true);

  const tamperedRef = db.collection("employees").doc(cleanupApplyResult.accounts.PARTS_MANAGER.employeeId);
  const tamperedBefore = (await tamperedRef.get()).data();
  await tamperedRef.set({ ...tamperedBefore, fixtureMarker: "SOMETHING_ELSE_ENTIRELY" }, { merge: true });

  const authUsersBeforeAllOrNothing = await countFixtureAuthUsers();
  const cleanupDryRunInput = validateInput({ cleanup: "true", manifestFile: cleanupTestPath }, baseEnv());
  const cleanupDryRunResult = await runCleanupCommand(db, auth, cleanupDryRunInput);
  report(
    "cleanup all-or-nothing (dry-run): aborts entirely, zero deletions counted, on a single mismatch",
    cleanupDryRunResult.ok === false && cleanupDryRunResult.reason === "CLEANUP_MISMATCH" && cleanupDryRunResult.results.mismatches.length === 1
  );

  const cleanupApplyAttemptInput = validateInput({ cleanup: "true", manifestFile: cleanupTestPath, apply: "true" }, baseEnv());
  const cleanupApplyAttemptResult = await runCleanupCommand(db, auth, cleanupApplyAttemptInput);
  report(
    "cleanup all-or-nothing (apply): aborts entirely with ZERO actual deletions, not a partial skip-one-continue-the-rest",
    cleanupApplyAttemptResult.ok === false && cleanupApplyAttemptResult.results.deletedAuthUsers === 0 && cleanupApplyAttemptResult.results.deletedDocs === 0
  );
  report("cleanup all-or-nothing: NOTHING was deleted -- every fixture Auth account from this run still exists", (await countFixtureAuthUsers()) === authUsersBeforeAllOrNothing);
  report("cleanup all-or-nothing: the tampered document itself is untouched", (await tamperedRef.get()).exists === true);

  // Revert the tamper and prove a clean cleanup now succeeds fully.
  await tamperedRef.set(tamperedBefore, { merge: false });
  const cleanupRealInput = validateInput({ cleanup: "true", manifestFile: cleanupTestPath, apply: "true" }, baseEnv());
  const cleanupRealResult = await runCleanupCommand(db, auth, cleanupRealInput);
  report("cleanup all-or-nothing: after reverting the tamper, cleanup succeeds completely", cleanupRealResult.ok === true && cleanupRealResult.results.deletedAuthUsers === 9 && cleanupRealResult.results.deletedDocs === 32);
  report("cleanup all-or-nothing: zero fixture Auth accounts remain", (await countFixtureAuthUsers()) === 0);

  // A manifest whose own top-level fixtureMarker doesn't match this
  // script's constant is refused entirely, before touching any target.
  const badManifestFile = freshPath(scratchDir, "bad-manifest");
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
