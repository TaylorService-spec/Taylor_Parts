// Issue #100 -- emulator proof for functions/scripts/
// bootstrapIssue100VerificationFixtures.js. NEVER touches production --
// every network call here targets the local Firestore/Auth emulator.
//
// Proves, without any production credential:
//   1. validateInput()/assertOutsideRepo() refuse every invalid
//      combination -- including a case-different alias of the repo
//      path on Windows, a symlinked/junctioned parent, and every
//      missing/invalid flag -- and accept a fully valid one.
//   2. Dry-run safety -- zero writes, zero files.
//   3. A real --apply run creates the exact expected counts, and the
//      resulting env-var block, fed into
//      verifyIssue100ProductionRules.js's runChecks(), passes
//      completely (zero-SKIP integration with PR #200).
//   4. Secret non-disclosure: no password/email/uid/path in console
//      output, and every error path prints a FIXED, classified,
//      identifier-free message -- never a caught error's own raw
//      message, never the credentials/manifest file's own path.
//   5. Collision/idempotent refusal.
//   6. TRUE write-ahead crash-safe recovery, proven with GENUINE
//      mutations and a GENUINE forced-interruption point (not a
//      hand-built manifest, not a mocked return value):
//        a. a wrapped Auth client lets the real auth.createUser() call
//           land for real, then throws immediately after -- simulating
//           a crash in the exact window between the mutation landing
//           and its "created" completion-state write -- and proves the
//           SAME run's own catch-based compensation discovers the real
//           account (by reality-check, not by trusting a "created" flag
//           that was never written) and correctly removes it;
//        b. a genuine restart-recovery scenario: this test manually
//           drives the SAME real primitives the script itself uses
//           (createSecretFileExclusively, a "planned" entry, a REAL
//           auth.createUser() mutation) and then deliberately stops --
//           never calling the completion-state write, never entering
//           applyBootstrapWithRecovery's own compensation at all --
//           leaving a manifest on disk that is exactly what a true hard
//           process kill would leave. --cleanup, invoked fresh against
//           that manifest, must discover and safely remove the real
//           account it never itself created;
//        c. a failure DURING compensation itself is reported as a
//           distinct, non-recoverable-automatically outcome (exit code
//           4) with the manifest retained and accurate.
//   7. Credential/manifest output: refuses an already-existing
//      destination (never truncates/overwrites it), establishes AND
//      verifies restrictive permissions (Windows ACL parsing/matching
//      logic proven directly against both a real, freshly-hardened ACL
//      and a fabricated bad one; POSIX 0600 verified on supported
//      platforms), and refuses a symlinked/junctioned parent directory.
//   8. Cleanup is strictly all-or-nothing with TOCTOU protection: a
//      single marker-tampered target aborts the ENTIRE cleanup with
//      zero deletions; a target that changes AFTER validation but
//      BEFORE its own deletion (simulated via a wrapped Firestore
//      client that mutates the document immediately before the real
//      delete call, triggering a genuine FAILED_PRECONDITION from the
//      emulator) halts cleanup immediately with a distinct recoverable-
//      failure result, not a silent stale-data deletion.
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
const { execFileSync } = require("child_process");

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const admin = require("firebase-admin");
const {
  validateInput,
  assertOutsideRepo,
  repoRoot,
  buildAccountPlan,
  runBootstrapCommand,
  runCleanupCommand,
  runCleanup,
  applyBootstrapWithRecovery,
  createSecretFileExclusively,
  writeSecretFileDurably,
  initialManifestState,
  uidFor,
  emailFor,
  parseIcaclsPrincipals,
  windowsAllowedPrincipalPatterns,
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
// auth/db objects. Every wrapper still performs the REAL underlying
// operation; they only add a deterministic point at which to inject a
// failure or an external change, so recovery/compensation/TOCTOU logic
// can be proven without relying on genuine flakiness.
// ---------------------------------------------------------------

// The real createUser() call happens FOR REAL; the wrapped promise then
// throws immediately after -- simulating a process crash in the exact
// window between a mutation landing and the script's own "created"
// completion-state write.
function wrapAuthCrashAfterMutation(realAuth, { crashAfterCreateCall = null } = {}) {
  let createCalls = 0;
  return {
    createUser: async (...args) => {
      createCalls += 1;
      const result = await realAuth.createUser(...args);
      if (createCalls === crashAfterCreateCall) {
        throw new Error("SIMULATED CRASH: after real mutation landed, before completion-state write");
      }
      return result;
    },
    deleteUser: (...args) => realAuth.deleteUser(...args),
    getUser: (...args) => realAuth.getUser(...args),
    getUserByEmail: (...args) => realAuth.getUserByEmail(...args),
  };
}

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
            delete: (...args) => realDocRef.delete(...args),
          };
        },
      };
    },
  };
}

// Immediately before the Nth real delete() call, mutates the target
// document for real (simulating an external actor's write landing in
// the exact window between cleanup's Phase 1 validation and Phase 2's
// own delete) -- the REAL subsequent delete() call, carrying the STALE
// precondition captured during Phase 1, then genuinely fails with
// FAILED_PRECONDITION against the emulator.
function wrapDbChangeBeforeDelete(realDb, { changeOnDeleteCall = null } = {}) {
  let deleteCalls = 0;
  return {
    collection: (name) => {
      const realCollection = realDb.collection(name);
      return {
        doc: (id) => {
          const realDocRef = realCollection.doc(id);
          return {
            get: () => realDocRef.get(),
            set: (data) => realDocRef.set(data),
            delete: async (precondition) => {
              deleteCalls += 1;
              if (deleteCalls === changeOnDeleteCall) {
                const current = (await realDocRef.get()).data();
                await realDocRef.set({ ...current, tamperedExternally: true });
              }
              return realDocRef.delete(precondition);
            },
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
        return err.code === "BAD_PROJECT_ID";
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
        return err.code === "BAD_PRODUCTION_AUTHORIZATION";
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
        return err.code === "MISSING_ADMIN_CREDENTIALS";
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
        return err.code === "MISSING_CREDENTIALS_OUT_FILE_FLAG";
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
        return err.code === "CREDENTIALS_OUT_FILE_NOT_ABSOLUTE";
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
        return err.code === "CREDENTIALS_OUT_FILE_INSIDE_REPO";
      }
    })()
  );

  report(
    "validateInput: refuses a CASE-DIFFERENT alias of the repository path (Windows/case-insensitive filesystems)",
    (() => {
      const caseAliased = path.join(repoRoot().toLowerCase(), "leaked-fixtures.json");
      try {
        validateInput({ credentialsOutFile: caseAliased }, baseEnv());
        return process.platform !== "win32"; // on a case-sensitive FS this alias is simply a different, nonexistent path -- not a meaningful test there
      } catch (err) {
        return err.code === "CREDENTIALS_OUT_FILE_INSIDE_REPO";
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
        return err.code === "MISSING_MANIFEST_FILE_FLAG";
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
        assertOutsideRepo("test", "CODE", path.join(repoRoot(), "x.json"));
      } catch {
        insideThrew = true;
      }
      let outsideThrew = false;
      try {
        assertOutsideRepo("test", "CODE", credentialsOutFile);
      } catch {
        outsideThrew = true;
      }
      return insideThrew && !outsideThrew;
    })()
  );

  // Symlink/junction escape -- best-effort: creation requires elevated
  // privileges on some Windows configurations; skip gracefully (not a
  // FAIL) if unsupported in this environment.
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
        assertOutsideRepo("test", "CODE", throughSymlink);
      } catch (err) {
        threw = err.code === "CODE_INSIDE_REPO";
      }
      report("assertOutsideRepo: refuses a symlinked/junctioned parent directory that resolves back into the repository", threw);

      // Nested: a REAL directory inside the repo, reached THROUGH the
      // junction plus additional path segments -- proves the whole
      // chain is resolved, not just a direct symlinked parent.
      const nestedRealDir = path.join(repoRoot(), "escape-test-nested-dir-tmp");
      fs.mkdirSync(nestedRealDir, { recursive: true });
      try {
        const nestedThroughJunction = path.join(linkDir, "escape-test-nested-dir-tmp", "x.json");
        let nestedThrew = false;
        try {
          assertOutsideRepo("test", "CODE", nestedThroughJunction);
        } catch (err) {
          nestedThrew = err.code === "CODE_INSIDE_REPO";
        }
        report("assertOutsideRepo: refuses a MULTI-LEVEL redirected parent (junction plus nested real subdirectory) resolving inside the repository", nestedThrew);
      } finally {
        fs.rmdirSync(nestedRealDir);
      }
    }
  }

  // === 7 (permissions). Windows ACL verification logic, and its
  // rejection of an unexpected principal -- proven directly against
  // both a REAL, freshly-hardened file and a fabricated bad ACL listing,
  // on the actual supported platform (parsing logic is platform-neutral
  // code, but only meaningfully exercised end-to-end on win32). ===
  if (process.platform === "win32") {
    const aclTestPath = freshPath(scratchDir, "acl-check");
    createSecretFileExclusively(aclTestPath, JSON.stringify({ hello: "world" }));
    const realOutput = execFileSync("icacls", [aclTestPath]).toString();
    const realPrincipals = parseIcaclsPrincipals(realOutput, aclTestPath);
    const allowed = windowsAllowedPrincipalPatterns();
    const realUnexpected = realPrincipals.filter((p) => !allowed.some((re) => re.test(p)));
    report(
      "Windows ACL: a freshly-hardened real file has ONLY the current user + SYSTEM + Administrators, no broad group",
      realPrincipals.length > 0 && realUnexpected.length === 0,
      `principals: ${JSON.stringify(realPrincipals)}`
    );
    fs.unlinkSync(aclTestPath);

    const fabricatedBadOutput = `C:\\fake\\path.json BUILTIN\\Users:(F)\r\n                    NT AUTHORITY\\SYSTEM:(F)\r\n\r\nSuccessfully processed 1 files; Failed processing 0 files\r\n`;
    const badPrincipals = parseIcaclsPrincipals(fabricatedBadOutput, "C:\\fake\\path.json");
    const badUnexpected = badPrincipals.filter((p) => !allowed.some((re) => re.test(p)));
    report(
      "Windows ACL: a fabricated listing containing a broad group (BUILTIN\\Users) is correctly flagged as unexpected",
      badUnexpected.length === 1 && /Users/i.test(badUnexpected[0])
    );

    // Fail-closed proof: createSecretFileExclusively deletes the
    // still-empty file and writes no secret if permission
    // establishment/verification fails. Simulated by pointing at a
    // path where the parent directory does not exist -- icacls itself
    // will fail against a nonexistent target, exercising the exact
    // same fail-closed branch a genuine ACL failure would.
    const unreachablePath = path.join(scratchDir, "does-not-exist-dir", "unreachable.json");
    let failedClosed = false;
    try {
      createSecretFileExclusively(unreachablePath, "SECRET-SHOULD-NEVER-BE-WRITTEN");
    } catch {
      failedClosed = !fs.existsSync(unreachablePath);
    }
    report("Windows ACL: fails closed (no file left behind) when the destination cannot be created/secured", failedClosed);
  } else {
    skip("Windows ACL verification tests", `platform is ${process.platform}, not win32`);
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
  report("apply: every manifest entry's state is 'created' (not left 'planned')", applyResult.manifest.authUsers.every((u) => u.state === "created") && applyResult.manifest.firestoreDocs.every((d) => d.state === "created"));

  const allPasswords = Object.values(applyResult.accounts).map((a) => a.password);
  const allEmails = Object.values(applyResult.accounts).map((a) => a.email);
  const allUids = Object.values(applyResult.accounts).map((a) => a.uid);
  const leakedSecrets = capturedLines.filter((line) =>
    allPasswords.some((p) => line.includes(p)) || allEmails.some((e) => line.includes(e)) || allUids.some((u) => line.includes(u)) || line.includes(applyPath)
  );
  report("apply: no password, email, uid, or the credentials file's own path appears in any captured console line", leakedSecrets.length === 0, `leaked: ${JSON.stringify(leakedSecrets)}`);

  const fileContent = fs.readFileSync(applyPath, "utf8");
  const envBlockAccountKeys = Object.keys(applyResult.accounts).filter((k) => k !== "PARTS_ASSOCIATE_OTHER");
  const fileHasEverySecret = envBlockAccountKeys.every((k) => fileContent.includes(applyResult.accounts[k].password) && fileContent.includes(applyResult.accounts[k].email));
  report("apply: the credentials file contains every verifier-required account's password and email", fileHasEverySecret);
  report(
    "apply: the credentials file does NOT expose PARTS_ASSOCIATE_OTHER's password (not a verifier env var)",
    !fileContent.includes(applyResult.accounts.PARTS_ASSOCIATE_OTHER.password)
  );

  if (process.platform !== "win32") {
    const statMode = fs.statSync(applyPath).mode & 0o777;
    report("apply: the credentials file has restrictive (owner-only) POSIX permissions", statMode === 0o600, `mode ${statMode.toString(8)}`);
  } else {
    const output = execFileSync("icacls", [applyPath]).toString();
    const principals = parseIcaclsPrincipals(output, applyPath);
    const allowed = windowsAllowedPrincipalPatterns();
    const unexpected = principals.filter((p) => !allowed.some((re) => re.test(p)));
    report("apply: the credentials file's real Windows ACL has no unexpected principal", principals.length > 0 && unexpected.length === 0, `principals: ${JSON.stringify(principals)}`);
  }

  const parsedFile = JSON.parse(fileContent);
  report("apply: manifest status is COMPLETE", parsedFile.status === "COMPLETE");

  const pmHistoryEntry = parsedFile.manifest.firestoreDocs.find((d) => d.label === "PM_HISTORY_DOC_ID");
  const pmHistorySnap = await db.collection("reorder_requests").doc(pmHistoryEntry.docId).get();
  const pmHistoryData = pmHistorySnap.data();
  const pmUid = applyResult.manifest.authUsers.find((u) => u.role === "PARTS_MANAGER").uid;
  const adminUid = applyResult.manifest.authUsers.find((u) => u.role === "ADMIN").uid;
  report("PM History fixture: assignedBy is the Parts Manager's own uid (a real Assign that account can actually perform)", pmHistoryData.assignedBy === pmUid);
  report("PM History fixture: reviewedBy is the Admin's own uid (Approve/Reject/Cancel remain admin/dispatcher-only)", pmHistoryData.reviewedBy === adminUid);
  report("PM History fixture: status is CANCELLED (a real terminal state reachable by this exact sequence)", pmHistoryData.status === "CANCELLED" && pmHistoryData.cancelledBy === adminUid);

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

  // === 7 (existing-output refusal) -- never truncates/overwrites ===
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

  // === 6a. Genuine mid-Auth mutation followed by forced interruption
  // BEFORE the completion-state write -- proves write-ahead + reality-
  // check compensation within the SAME run. ===
  {
    await resetEmulatorFixtureState();
    const midAuthPath = freshPath(scratchDir, "mid-auth-crash");
    const midAuthInput = validateInput({ credentialsOutFile: midAuthPath, apply: "true" }, baseEnv());
    const accounts = buildAccountPlan();
    // The 1st createUser() call (PARTS_MANAGER) is allowed to land for
    // real, then the wrapped promise throws BEFORE applyBootstrapWithRecovery
    // ever executes its own "state = 'created'" + persist() lines --
    // exactly the crash window write-ahead logging exists to cover.
    const crashingAuth = wrapAuthCrashAfterMutation(auth, { crashAfterCreateCall: 1 });

    const midAuthResult = await applyBootstrapWithRecovery(db, crashingAuth, accounts, midAuthInput);
    report(
      "mid-Auth crash-after-mutation: reported as fully compensated, exit code 1",
      midAuthResult.ok === false && midAuthResult.exitCode === 1 && midAuthResult.reason === "APPLY_FAILED_FULLY_COMPENSATED"
    );
    report("mid-Auth crash-after-mutation: the genuinely-created PARTS_MANAGER account no longer exists (discovered and compensated by reality-check, not by a 'created' flag that was never written)", (await countFixtureAuthUsers()) === 0);
    const midAuthManifest = JSON.parse(fs.readFileSync(midAuthPath, "utf8"));
    const pmEntry = midAuthManifest.manifest.authUsers.find((u) => u.role === "PARTS_MANAGER");
    report(
      "mid-Auth crash-after-mutation: the manifest entry for the crashed account is marked deleted, having been discovered from a 'planned' state (never reached 'created' in this run)",
      pmEntry.state === "deleted"
    );
  }

  // === 6b. Genuine restart recovery -- manually drives the SAME real
  // primitives the script itself uses, stopping exactly at the point a
  // true hard crash would (never calling the completion-state write,
  // never entering applyBootstrapWithRecovery's own compensation at
  // all) -- then proves a FRESH --cleanup invocation, knowing nothing
  // about this run except the manifest file, discovers and safely
  // removes the real account it never itself created. ===
  {
    await resetEmulatorFixtureState();
    const restartPath = freshPath(scratchDir, "restart-recovery");
    const restartInput = validateInput({ credentialsOutFile: restartPath, apply: "true" }, baseEnv());

    const manifestState = initialManifestState(restartInput);
    createSecretFileExclusively(restartPath, JSON.stringify(manifestState, null, 2));

    const slug = "restart-recovery-crash-target";
    const crashUid = uidFor(slug);
    const crashEmail = emailFor(slug);
    const plannedEntry = { role: "RESTART_TARGET", uid: crashUid, email: crashEmail, state: "planned" };
    manifestState.manifest.authUsers.push(plannedEntry);
    writeSecretFileDurably(restartPath, JSON.stringify(manifestState, null, 2)); // write-ahead: planned, BEFORE the mutation

    // The REAL mutation -- genuinely creates the account.
    await auth.createUser({ uid: crashUid, email: crashEmail, password: "Xk9-restart-recovery-genuine-pw" });

    // Simulated hard crash: deliberately never flip to "created", never
    // persist again, never call applyBootstrapWithRecovery's own catch/
    // compensation. The manifest on disk is now exactly what a real
    // process kill in this exact window would leave behind.
    report("restart recovery setup: the manifest on disk still shows the target as 'planned' (never advanced to 'created')", JSON.parse(fs.readFileSync(restartPath, "utf8")).manifest.authUsers[0].state === "planned");
    report("restart recovery setup: the account genuinely exists in Auth despite the manifest never being updated", (await auth.getUser(crashUid).catch(() => null)) !== null);

    const restartCleanupInput = validateInput({ cleanup: "true", manifestFile: restartPath, apply: "true" }, baseEnv());
    const restartCleanupResult = await runCleanupCommand(db, auth, restartCleanupInput);
    report(
      "restart recovery: a fresh --cleanup run discovers and removes the genuinely-created-but-never-confirmed account",
      restartCleanupResult.ok === true && restartCleanupResult.results.deletedAuthUsers === 1
    );
    report("restart recovery: the account is actually gone", (await auth.getUser(crashUid).catch(() => null)) === null);
  }

  // === 6c. Incomplete rollback: a Firestore failure triggers
  // compensation, but the FIRST compensating deleteUser() call also
  // fails -- compensation must still attempt (and succeed at) every
  // OTHER item, end with a DISTINCT hard-failure exit code, and retain
  // the manifest exactly as it stands. ===
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
    const stillPresentAuth = incompleteManifest.manifest.authUsers.filter((u) => u.state !== "deleted");
    report("incomplete rollback: exactly one Auth account is still recorded as NOT deleted (the one whose compensation failed)", stillPresentAuth.length === 1, `got ${JSON.stringify(stillPresentAuth)}`);
    report("incomplete rollback: every Firestore document WAS successfully compensated despite the Auth failure", incompleteManifest.manifest.firestoreDocs.every((d) => d.state === "deleted"));

    if (stillPresentAuth.length === 1) {
      await auth.deleteUser(stillPresentAuth[0].uid).catch(() => {});
    }
  }

  report("crash-safe recovery: zero fixture Auth accounts remain after all recovery scenarios", (await countFixtureAuthUsers()) === 0);

  // === 4 (safe error output). ===
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
      forcedResult.internalErrorDetail === "INJECTED: createUser failure" && !errCapturedLines.some((line) => line.includes("INJECTED"))
    );
    report(
      "safe error output: FIXED_MESSAGES strings are stable, exported constants a caller can rely on for classification",
      typeof FIXED_MESSAGES.APPLY_FAILED_FULLY_COMPENSATED === "string" && FIXED_MESSAGES.APPLY_FAILED_FULLY_COMPENSATED.length > 0
    );

    if (await countFixtureAuthUsers() > 0) await deleteAllFixtureAuthUsers();
  }

  // === 8. Cleanup all-or-nothing (marker mismatch) + TOCTOU (target
  // changes between validation and its own deletion). ===
  await resetEmulatorFixtureState();
  const cleanupTestPath = freshPath(scratchDir, "cleanup-all-or-nothing");
  const cleanupApplyInput = validateInput({ credentialsOutFile: cleanupTestPath, apply: "true" }, baseEnv());
  const cleanupApplyResult = await runBootstrapCommand(db, auth, cleanupApplyInput);
  report("cleanup setup: fresh apply for the all-or-nothing/TOCTOU tests succeeds", cleanupApplyResult.ok === true);

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

  // Revert the tamper, then prove TOCTOU protection: a wrapped db
  // mutates one document for real immediately before ITS OWN real
  // delete() call -- the emulator itself must reject that stale-
  // precondition delete, and cleanup must stop and report it distinctly.
  await tamperedRef.set(tamperedBefore, { merge: false });
  const toctouDb = wrapDbChangeBeforeDelete(db, { changeOnDeleteCall: 1 });
  const toctouCleanupInput = validateInput({ cleanup: "true", manifestFile: cleanupTestPath, apply: "true" }, baseEnv());
  const toctouResult = await runCleanupCommand(toctouDb, auth, toctouCleanupInput);
  report(
    "cleanup TOCTOU: a target changed between validation and its own deletion is detected via a genuine FAILED_PRECONDITION, distinct exit code 4",
    toctouResult.ok === false && toctouResult.exitCode === 4 && toctouResult.reason === "CLEANUP_TARGET_CHANGED_MID_RUN"
  );
  report("cleanup TOCTOU: cleanup stopped rather than deleting the changed document underneath the change", toctouResult.results.targetChangedMidRun === true);

  // Clean up fully now (real db, no wrapper, no further tampering) so
  // this file leaves no residual state.
  const finalCleanupInput = validateInput({ cleanup: "true", manifestFile: cleanupTestPath, apply: "true" }, baseEnv());
  const finalCleanupResult = await runCleanupCommand(db, auth, finalCleanupInput);
  report("cleanup all-or-nothing/TOCTOU: after resolving both scenarios, a final clean cleanup succeeds completely", finalCleanupResult.ok === true);
  report("cleanup all-or-nothing/TOCTOU: zero fixture Auth accounts remain", (await countFixtureAuthUsers()) === 0);

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
