// Issue #100 (docs/specifications/inventory-nav-access-alignment.md) --
// OPERATOR-RUN ONLY. Provisions the exact accounts and fixture
// documents functions/scripts/verifyIssue100ProductionRules.js requires
// (its REQUIRED_ACCOUNT_ENV/REQUIRED_FIXTURE_ENV/OPTIONAL_ACCOUNT_ENV_
// PAIRS, imported directly from that file below so the two scripts can
// never drift out of sync) -- so an operator does not have to hand-craft
// twelve Firestore documents and eight accounts before every production
// verification run. It is not invoked by Claude Code; it exists so an
// operator (a human, or a CI job holding real secrets) can run it, and
// so its logic can be proven correct against the local emulator (see
// functions/test/bootstrapIssue100VerificationFixtures.test.js) without
// ever touching production.
//
// THREAT MODEL / SAFETY DECISIONS:
//   1. Default to dry-run. Every invocation -- with or without --apply
//      -- validates input, connects with real Admin SDK credentials,
//      reads current state, and detects every conflict a real run would
//      hit. Only --apply additionally permits the write phase to run.
//      A dry-run performs zero Auth/Firestore writes and creates no
//      file of any kind.
//   2. Refuse to overwrite Auth/Firestore state. Conflict detection
//      (readCurrentState/detectConflicts) runs BEFORE any write -- if
//      ANY target Auth email or ANY target Firestore document already
//      exists, the entire run throws and writes NOTHING. This script
//      never updates an existing document -- create-only, always.
//   3. TRUE write-ahead recovery manifest. Every Auth account and
//      Firestore document this script will ever create has a
//      DETERMINISTIC identity (a fixed uid derived from its role,
//      exactly like its email/employeeId/docId already were) -- known
//      BEFORE the mutation is even attempted. For every single
//      creation: a manifest entry in state "planned" (naming the exact
//      uid/collection+docId that is ABOUT to be created) is durably
//      persisted FIRST; only then is the real Auth/Firestore write
//      attempted; only then is that SAME entry flipped to "created" and
//      persisted again. A crash at ANY point -- including exactly
//      between the real write landing and the "created" transition --
//      leaves a manifest that already names the resource, because its
//      identity was recorded before the mutation, not after. Recovery
//      (this run's own catch-based compensation, OR a later --cleanup
//      pointed at a manifest left behind by a hard crash) never needs
//      to guess: for any non-"deleted" entry it re-checks reality by
//      that exact deterministic identity -- if the resource exists, it
//      is compensated; if it doesn't (the crash landed before the
//      mutation ever reached Firebase), the entry is simply marked
//      resolved. No created resource -- planned-then-crashed or fully
//      confirmed -- is ever left without a durable, discoverable
//      record.
//   4. On any failure, every touched entry (whether it reached "created"
//      or was left "planned") is compensated in REVERSE creation order
//      via that same reality-check-then-delete-if-present logic. If
//      compensation fully resolves everything, the run still fails
//      (exit 1) but leaves no residual state. If any compensating
//      delete itself fails, the manifest is retained exactly as-is and
//      the run exits with a DISTINCT hard-failure code (4).
//   5. Deviation from provisionEmployeeAccess.js's passwordless
//      convention, deliberate and scoped: that script never generates a
//      credential because it provisions REAL employee access records.
//      This script provisions DISPOSABLE, clearly-fixture-labeled test
//      identities whose entire purpose is signing in with a password via
//      verifyIssue100ProductionRules.js's Identity Toolkit REST calls --
//      a passwordless account cannot do that. A strong, random password
//      is generated per account and written ONLY into the credentials/
//      manifest file described below -- never to stdout, never logged,
//      never included in any error message.
//   6. Secret-file protection is ESTABLISHED AND VERIFIED, not merely
//      requested. The file is first exclusively created empty (`wx` --
//      refuses any pre-existing destination, never truncates/overwrites
//      a prior manifest); on POSIX, 0o600 is applied and re-read back to
//      confirm it actually took; on Windows, this script shells out to
//      `icacls` to strip inherited permissions and grant access to
//      ONLY the current operator plus the unavoidable SYSTEM/
//      Administrators principals, then re-reads the ACL back and
//      refuses to proceed (deleting the still-empty, still-secret-free
//      file) if any OTHER principal (Users, Authenticated Users,
//      Everyone, or any other group) is present, or if establishing/
//      verifying the ACL failed for any reason -- fail closed, no
//      secret is ever written otherwise. EVERY subsequent update to the
//      file (one per creation/compensation/cleanup step) re-applies and
//      re-verifies this same protection on the temp file BEFORE it is
//      renamed over the target, so the guarantee holds for the file's
//      entire lifetime, not just its first byte.
//   7. --credentialsOutFile/--manifestFile must resolve, via the REAL
//      (symlink/junction-resolved) filesystem path of their PARENT
//      directory, outside this repository -- compared CASE-
//      INSENSITIVELY on Windows (a case-different alias of the same
//      physical directory is the same directory on NTFS/Windows,
//      confirmed by direct testing that fs.realpathSync() does NOT
//      itself normalize case) -- not merely a lexical path.resolve()
//      check, which neither a symlinked parent NOR a case-different
//      alias could be caught by alone.
//   8. Marker- and manifest-guarded cleanup, never automatic, always
//      all-or-nothing, TOCTOU-resistant. --cleanup [--apply] first
//      PREVALIDATES every non-"deleted" manifest entry (Firestore
//      fixtureMarker, Auth account identity/email-domain) with ZERO
//      deletions attempted -- if ANY entry mismatches, the whole
//      cleanup aborts having deleted nothing. Only once every entry
//      validates does deletion begin, one target at a time -- and
//      immediately before each individual deletion, identity is
//      RE-VERIFIED again (Auth: a fresh getUser() re-check; Firestore:
//      the delete itself carries a `lastUpdateTime` precondition
//      captured at validation time, so Firestore itself atomically
//      refuses the delete if the document changed in between). If a
//      target genuinely changed between validation and its own
//      deletion, cleanup stops immediately, persists the accurate
//      progress so far, and returns a DISTINCT recoverable-failure
//      result -- never silently deleting stale-validated data. Each
//      deletion is immediately marked in the SAME manifest file,
//      durably, so an interrupted cleanup is always safely re-runnable.
//      Cleanup is NEVER invoked automatically by the create path.
//   9. Console output is limited to fixed, classified, identifier-free
//      messages and aggregate counts -- never an email, password, uid,
//      document ID, the credentials/manifest file's own path, or a
//      caught error's raw message. A caught error's real message is
//      preserved ONLY on the value this script returns to its own
//      caller (consumed by tests directly, never printed).
//  10. Never executes on import. Every exported function is a plain,
//      side-effect-free (until explicitly called) unit; main() only runs
//      under `if (require.main === module)`, identical to this
//      project's other operator scripts.
//
// USAGE (dry-run preview, safe by default):
//   cd functions
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
//   FIREBASE_PROJECT_ID=taylor-parts PRODUCTION_DATA_AUTHORIZED=YES \
//     node scripts/bootstrapIssue100VerificationFixtures.js \
//     --credentialsOutFile /absolute/path/outside/this/repo/issue100-verify-fixtures.json
//
// USAGE (apply -- creates real accounts/documents and the manifest file;
// the target path must NOT already exist):
//   ...same as above, plus --apply
//
// USAGE (cleanup preview, validates only, deletes nothing):
//   node scripts/bootstrapIssue100VerificationFixtures.js --cleanup \
//     --manifestFile /absolute/path/outside/this/repo/issue100-verify-fixtures.json
//
// USAGE (cleanup, apply -- deletes only if every entry validates):
//   ...same as above, plus --apply
//
// Exit codes:
//   0 -- completed (dry-run preview, or a real apply/cleanup) with no
//        unresolved issue.
//   1 -- a prerequisite was missing/invalid, a pre-mutation conflict was
//        detected (zero writes occurred), a cleanup prevalidation
//        mismatch was found (zero deletions occurred), OR an apply
//        failed but was FULLY compensated (no residual Auth/Firestore
//        state -- the run still failed, but nothing was left behind).
//   4 -- an apply failed AND compensation could NOT fully undo it, OR a
//        cleanup target changed between validation and its own
//        deletion partway through. The manifest file has been retained
//        exactly as-is and MUST be used (via --cleanup, or manual
//        review) to resolve the remaining state. Always takes
//        precedence over exit code 1.
"use strict";

const path = require("path");
const os = require("os");
const crypto = require("crypto");
const fs = require("fs");
const { execFileSync } = require("child_process");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

const {
  REQUIRED_PROJECT_ID,
  REQUIRED_ACCOUNT_ENV,
  REQUIRED_FIXTURE_ENV,
  OPTIONAL_ACCOUNT_ENV_PAIRS,
} = require("./verifyIssue100ProductionRules.js");

// Versioned so a future shape change can distinguish its own fixtures
// from an older run's, if ever needed -- deterministic, not per-run
// random (see "Deterministic fixture IDs" below).
const FIXTURE_MARKER = "ISSUE_100_VERIFICATION_FIXTURE_V2";

// RFC 2606 reserves `.invalid` as a TLD guaranteed to never resolve --
// every fixture Auth account's email lives under this domain, doubling
// as a second, independent marker (alongside FIXTURE_MARKER on every
// Firestore document) that cleanup's prevalidation re-checks against a
// live Auth record before ever deleting anything.
const FIXTURE_EMAIL_DOMAIN = "issue100-verify.fixtures.invalid";

const ID_PREFIX = "issue100-verify";

// Deterministic Auth uid per account -- known BEFORE auth.createUser()
// is ever called, which is what makes a true write-ahead manifest entry
// possible for Auth accounts (Firebase would otherwise only hand back a
// uid AFTER creation succeeds).
function uidFor(slug) {
  return `${ID_PREFIX}-uid-${slug}`;
}

const REQUIRED_ACCOUNTS = [
  { key: "PARTS_MANAGER", slug: "parts-manager", displayName: "Issue 100 Verify - Parts Manager", operationalRoles: ["PARTS_MANAGER"], securityRole: "technician" },
  { key: "WAREHOUSE_MANAGER", slug: "warehouse-manager", displayName: "Issue 100 Verify - Warehouse Manager", operationalRoles: ["WAREHOUSE_MANAGER"], securityRole: "technician" },
  { key: "PARTS_ASSOCIATE", slug: "parts-associate", displayName: "Issue 100 Verify - Parts Associate", operationalRoles: ["PARTS_ASSOCIATE"], securityRole: "technician" },
  { key: "ADMIN", slug: "admin", displayName: "Issue 100 Verify - Admin", operationalRoles: [], securityRole: "admin" },
];

// Not itself one of verifyIssue100ProductionRules.js's REQUIRED_ACCOUNT_ENV
// entries (that script never signs in as this identity) -- it exists so
// PM_OVERSIGHT_DOC_ID/PM_HISTORY_DOC_ID/PA_OTHER_USER_DOC_ID can be owned
// by a real, reciprocally-linked, resolvable-by-name Associate who is
// NOT the primary PARTS_ASSOCIATE fixture, proving cross-user denial
// against a genuine second identity rather than a synthetic uid string.
const CROSS_USER_ACCOUNT = {
  key: "PARTS_ASSOCIATE_OTHER", slug: "parts-associate-other",
  displayName: "Issue 100 Verify - Parts Associate (Cross-User Owner)",
  operationalRoles: ["PARTS_ASSOCIATE"], securityRole: "technician",
};

// Each pair's presence/absence in the credentials file's env block is
// entirely optional at verification time (OPTIONAL_ACCOUNT_ENV_PAIRS,
// imported above) -- but this bootstrap tool always provisions all
// four, so an operator gets full coverage without a second run.
const OPTIONAL_ACCOUNTS = [
  { key: "BROKEN_LINKAGE", slug: "broken-linkage", displayName: null, kind: "broken" },
  { key: "INACTIVE_LINKAGE", slug: "inactive-linkage", displayName: "Issue 100 Verify - Inactive Linkage", operationalRoles: ["PARTS_MANAGER"], employmentStatus: "TERMINATED", kind: "normal" },
  { key: "INELIGIBLE", slug: "ineligible", displayName: "Issue 100 Verify - Ineligible", operationalRoles: [], employmentStatus: "ACTIVE", kind: "normal" },
  { key: "NONRECIPROCAL", slug: "nonreciprocal", displayName: "Issue 100 Verify - Nonreciprocal (mismatched target)", operationalRoles: ["PARTS_MANAGER"], employmentStatus: "ACTIVE", kind: "nonreciprocal" },
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "true";
      args[key] = value;
      if (value !== "true") i += 1;
    }
  }
  return args;
}

class ValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// This file lives at functions/scripts/<this file> -- repo root is two
// directories up. Used only to refuse an --credentialsOutFile/--manifestFile
// path whose REAL parent directory resolves inside this repository.
function repoRoot() {
  return fs.realpathSync(path.resolve(__dirname, "..", ".."));
}

// Windows/NTFS (and, by default, macOS/APFS) are case-insensitive but
// case-PRESERVING filesystems -- two differently-cased strings can name
// the exact same physical directory. fs.realpathSync() does NOT itself
// normalize case (confirmed by direct testing: realpathSync of a
// lowercased real path returns it lowercased, not canonicalized) -- so
// the containment comparison itself must be case-insensitive on
// case-insensitive platforms, or a same-directory alias with different
// case bypasses it entirely.
function normalizeForContainmentComparison(p) {
  return process.platform === "win32" ? p.toLowerCase() : p;
}

// Resolves the REAL (symlink/junction-free) parent directory of
// `absPath` and refuses if that real location is inside this
// repository -- a lexical path.resolve() check alone cannot catch a
// symlinked/junctioned parent directory, or a differently-cased alias
// of the same directory, that actually points back into the repo. The
// target file itself need not exist yet; its parent directory must.
function assertOutsideRepo(label, code, absPath) {
  const parent = path.dirname(path.resolve(absPath));
  let realParent;
  try {
    realParent = fs.realpathSync(parent);
  } catch (err) {
    throw new ValidationError(`${code}_PARENT_MISSING`, `${label}'s parent directory "${parent}" does not exist or is not accessible.`);
  }
  const root = repoRoot();
  const normalizedParent = normalizeForContainmentComparison(realParent);
  const normalizedRoot = normalizeForContainmentComparison(root);
  const normalizedRootWithSep = normalizedRoot + path.sep;
  if (normalizedParent === normalizedRoot || normalizedParent.startsWith(normalizedRootWithSep)) {
    throw new ValidationError(`${code}_INSIDE_REPO`, `${label} must be OUTSIDE this repository -- its real (symlink-resolved) parent directory resolves inside it.`);
  }
}

// ---------------------------------------------------------------
// Phase A -- parse and validate input. No I/O beyond the parent-
// directory realpath check above (no Firebase SDK call). Every failure
// throws a ValidationError with a stable `.code` -- console output is
// keyed off that code (see VALIDATION_FIXED_MESSAGES), never off the
// message text itself, which may include a real filesystem path.
// ---------------------------------------------------------------
function validateInput(rawArgs, env) {
  const apply = rawArgs.apply === "true";
  const cleanup = rawArgs.cleanup === "true";

  if (env.FIREBASE_PROJECT_ID !== REQUIRED_PROJECT_ID) {
    throw new ValidationError("BAD_PROJECT_ID", `FIREBASE_PROJECT_ID must be exactly "${REQUIRED_PROJECT_ID}" (no default target).`);
  }
  if (env.PRODUCTION_DATA_AUTHORIZED !== "YES") {
    throw new ValidationError("BAD_PRODUCTION_AUTHORIZATION", 'PRODUCTION_DATA_AUTHORIZED must be exactly "YES" (explicit, per-run Owner authorization).');
  }
  if (!env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new ValidationError("MISSING_ADMIN_CREDENTIALS", "GOOGLE_APPLICATION_CREDENTIALS is required (Admin SDK credential path).");
  }

  if (cleanup) {
    if (!rawArgs.manifestFile) {
      throw new ValidationError("MISSING_MANIFEST_FILE_FLAG", "--cleanup requires --manifestFile <absolute path to a file this script previously wrote>.");
    }
    if (!path.isAbsolute(rawArgs.manifestFile)) {
      throw new ValidationError("MANIFEST_FILE_NOT_ABSOLUTE", "--manifestFile must be an absolute path.");
    }
    assertOutsideRepo("--manifestFile", "MANIFEST_FILE", rawArgs.manifestFile);
    return { mode: "cleanup", apply, manifestFile: path.resolve(rawArgs.manifestFile), projectId: env.FIREBASE_PROJECT_ID };
  }

  if (!rawArgs.credentialsOutFile) {
    throw new ValidationError("MISSING_CREDENTIALS_OUT_FILE_FLAG", "--credentialsOutFile <absolute path outside this repository> is required.");
  }
  if (!path.isAbsolute(rawArgs.credentialsOutFile)) {
    throw new ValidationError("CREDENTIALS_OUT_FILE_NOT_ABSOLUTE", "--credentialsOutFile must be an absolute path.");
  }
  assertOutsideRepo("--credentialsOutFile", "CREDENTIALS_OUT_FILE", rawArgs.credentialsOutFile);

  return {
    mode: "bootstrap",
    apply,
    credentialsOutFile: path.resolve(rawArgs.credentialsOutFile),
    projectId: env.FIREBASE_PROJECT_ID,
    firebaseWebApiKey: env.FIREBASE_WEB_API_KEY || null,
    googleApplicationCredentials: env.GOOGLE_APPLICATION_CREDENTIALS,
  };
}

const VALIDATION_FIXED_MESSAGES = {
  BAD_PROJECT_ID: "FAIL -- invalid or missing FIREBASE_PROJECT_ID.",
  BAD_PRODUCTION_AUTHORIZATION: "FAIL -- invalid or missing PRODUCTION_DATA_AUTHORIZED.",
  MISSING_ADMIN_CREDENTIALS: "FAIL -- missing GOOGLE_APPLICATION_CREDENTIALS.",
  MISSING_MANIFEST_FILE_FLAG: "FAIL -- --cleanup requires --manifestFile.",
  MANIFEST_FILE_NOT_ABSOLUTE: "FAIL -- --manifestFile must be an absolute path.",
  MANIFEST_FILE_PARENT_MISSING: "FAIL -- --manifestFile's parent directory does not exist or is not accessible.",
  MANIFEST_FILE_INSIDE_REPO: "FAIL -- --manifestFile must resolve outside this repository.",
  MISSING_CREDENTIALS_OUT_FILE_FLAG: "FAIL -- --credentialsOutFile is required.",
  CREDENTIALS_OUT_FILE_NOT_ABSOLUTE: "FAIL -- --credentialsOutFile must be an absolute path.",
  CREDENTIALS_OUT_FILE_PARENT_MISSING: "FAIL -- --credentialsOutFile's parent directory does not exist or is not accessible.",
  CREDENTIALS_OUT_FILE_INSIDE_REPO: "FAIL -- --credentialsOutFile must resolve outside this repository.",
};

function generateStrongPassword() {
  // 24 random bytes, base64url-encoded -- 32 characters, cryptographically
  // random, well beyond Firebase Auth's own minimum. Never derived from
  // any predictable seed (account key, email, timestamp).
  return crypto.randomBytes(24).toString("base64url");
}

function emailFor(slug) {
  return `${slug}@${FIXTURE_EMAIL_DOMAIN}`;
}

function employeeIdFor(slug) {
  return `${ID_PREFIX}-emp-${slug}`;
}

function fixtureDocId(name) {
  return `${ID_PREFIX}-${name}`;
}

// ---------------------------------------------------------------
// Secret-file protection -- established AND verified, not merely
// requested. Two entry points:
//   - createSecretFileExclusively(): used EXACTLY ONCE per apply run, at
//     the very start of Phase E, on a path that must not already exist.
//     Creates an EMPTY file first, hardens+verifies its permissions,
//     and ONLY THEN writes the real (still secret-free at this exact
//     moment) initial content -- if hardening/verification fails, the
//     empty file is removed and NOTHING is written.
//   - writeSecretFileDurably(): every subsequent update to that SAME,
//     now-existing file (this run's own in-progress manifest, or a
//     cleanup's progress updates to an existing manifest) -- writes to
//     a temp file, hardens+verifies THAT temp file's permissions (a
//     rename preserves the source file's permissions/ACL exactly, so
//     hardening the temp file before the atomic rename is what makes
//     the guarantee hold for the file's entire lifetime, not just its
//     first byte), then atomically renames it over the target.
// ---------------------------------------------------------------

// Principal-name allowlist for the Windows ACL verification below --
// deliberately narrow: the current operator (by OS username, however
// icacls chooses to qualify it -- e.g. "MACHINE\\name" or "DOMAIN\\name"),
// plus the two unavoidable built-in principals every Windows ACL
// realistically still carries. Anything else (Users, Authenticated
// Users, Everyone, a custom group, an unresolvable raw SID) fails
// verification.
function windowsAllowedPrincipalPatterns() {
  const username = os.userInfo().username;
  const escapedUsername = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    new RegExp(`(^|\\\\)${escapedUsername}$`, "i"),
    /(^|\\)SYSTEM$/i,
    /(^|\\)Administrators$/i,
  ];
}

function parseIcaclsPrincipals(output, targetPath) {
  const principals = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const trimmedWhole = rawLine.trim();
    if (!trimmedWhole) continue;
    if (/^Successfully processed/i.test(trimmedWhole)) continue;
    if (/^Failed processing/i.test(trimmedWhole)) continue;
    let line = rawLine;
    if (line.startsWith(targetPath)) line = line.slice(targetPath.length);
    line = line.trim();
    const match = line.match(/^(.+?):\(/);
    if (match) principals.push(match[1].trim());
  }
  return principals;
}

// Strips inherited permissions and grants access to ONLY the current
// user plus SYSTEM/Administrators. Throws on any icacls failure.
// Deliberately separate from verifyWindowsAcl() below -- callers that
// need to CONFIRM an already-established ACL survived an intervening
// operation (e.g. a rename) call only the verify half, without
// redundantly re-granting.
function applyWindowsAcl(targetPath) {
  const username = os.userInfo().username;
  try {
    execFileSync("icacls", [targetPath, "/inheritance:r"], { stdio: "pipe" });
    execFileSync("icacls", [targetPath, "/grant:r", `${username}:F`, "SYSTEM:F", "Administrators:F"], { stdio: "pipe" });
  } catch (err) {
    throw new Error("Could not establish restrictive Windows ACLs on the credentials/manifest file.");
  }
}

// Re-reads the ACL and verifies no principal beyond the current user/
// SYSTEM/Administrators is present. Throws on ANY failure -- icacls
// missing, a command erroring, or an unexpected principal found -- so
// the caller can fail closed uniformly.
function verifyWindowsAcl(targetPath) {
  let output;
  try {
    output = execFileSync("icacls", [targetPath], { stdio: "pipe" }).toString();
  } catch (err) {
    throw new Error("Could not verify Windows ACLs on the credentials/manifest file.");
  }

  const principals = parseIcaclsPrincipals(output, targetPath);
  const allowed = windowsAllowedPrincipalPatterns();
  const unexpected = principals.filter((p) => !allowed.some((re) => re.test(p)));
  if (unexpected.length > 0 || principals.length === 0) {
    throw new Error("Windows ACL verification found an unexpected principal (or no principals at all) on the credentials/manifest file.");
  }
}

function establishAndVerifyWindowsAcl(targetPath) {
  applyWindowsAcl(targetPath);
  verifyWindowsAcl(targetPath);
}

// POSIX: the mode is applied at file-creation time by the caller
// (fs.openSync's third argument) -- this only VERIFIES it actually
// took (some filesystems/mount options can silently ignore or alter
// requested modes), failing closed if not.
function verifyPosixMode(targetPath) {
  const mode = fs.statSync(targetPath).mode & 0o777;
  if (mode !== 0o600) {
    throw new Error("POSIX file permissions could not be verified as restrictive (0600).");
  }
}

function establishAndVerifySecretFilePermissions(targetPath) {
  if (process.platform === "win32") {
    establishAndVerifyWindowsAcl(targetPath);
  } else {
    verifyPosixMode(targetPath);
  }
}

// VERIFY-ONLY (never re-applies/re-grants) -- used to confirm an
// already-hardened file's ACL survived an intervening operation, e.g.
// the atomic rename in writeSecretFileDurably below.
function verifySecretFilePermissions(targetPath) {
  if (process.platform === "win32") {
    verifyWindowsAcl(targetPath);
  } else {
    verifyPosixMode(targetPath);
  }
}

function createSecretFileExclusively(targetPath, content) {
  const fd = fs.openSync(targetPath, "wx", 0o600);
  fs.closeSync(fd);
  try {
    establishAndVerifySecretFilePermissions(targetPath);
  } catch (err) {
    fs.unlinkSync(targetPath); // still empty, still secret-free -- safe to remove
    throw err;
  }
  const writeFd = fs.openSync(targetPath, "w");
  try {
    fs.writeSync(writeFd, content);
    fs.fsyncSync(writeFd);
  } finally {
    fs.closeSync(writeFd);
  }
}

// Ordered so NO secret byte is ever written before the file's ACL has
// been established AND verified:
//   1. Exclusively create an empty temporary file.
//   2. Apply and verify the restrictive ACL while it is still empty.
//   3. Write secret content through the already-secured file handle.
//   4. Flush file content durably and close it.
//   5. Atomically replace the destination.
//   6. Verify the destination retains the restricted ACL.
//   7. On any failure in 1-4, close and remove the temporary file
//      without ever having exposed its contents under a weaker ACL.
function writeSecretFileDurably(targetPath, content) {
  const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

  const fd = fs.openSync(tmpPath, "wx", 0o600); // 1
  try {
    establishAndVerifySecretFilePermissions(tmpPath); // 2 -- still empty at this point
    fs.writeSync(fd, content); // 3
    fs.fsyncSync(fd); // 4
  } catch (err) {
    fs.closeSync(fd);
    try {
      fs.unlinkSync(tmpPath);
    } catch (unlinkErr) {
      // Best-effort -- the original error is what matters to the caller.
    }
    throw err; // 7
  }
  fs.closeSync(fd); // 4, continued

  try {
    fs.renameSync(tmpPath, targetPath); // 5 -- preserves the temp file's own (already-hardened) ACL
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch (unlinkErr) {
      // Best-effort.
    }
    throw err;
  }

  verifySecretFilePermissions(targetPath); // 6 -- never re-deletes the destination on failure here: it may
  // already hold the operator's only copy of real, newly-created
  // resource records: surface the error to the caller's own recovery
  // machinery instead of destroying it.
}

// ---------------------------------------------------------------
// Phase B -- read current state for every target identity/document.
// Reads only, no mutation. Used identically by both a dry-run and an
// --apply run -- a dry-run's preview is real, not simulated.
// ---------------------------------------------------------------
async function readCurrentState(db, auth, targets) {
  const authByEmail = {};
  await Promise.all(
    targets.emails.map(async (email) => {
      authByEmail[email] = await auth.getUserByEmail(email).catch((err) => {
        if (err.code === "auth/user-not-found") return null;
        throw err;
      });
    })
  );

  const docsByRef = {};
  await Promise.all(
    targets.docRefs.map(async ({ collection, docId }) => {
      const snap = await db.collection(collection).doc(docId).get();
      docsByRef[`${collection}/${docId}`] = snap.exists;
    })
  );

  return { authByEmail, docsByRef };
}

// ---------------------------------------------------------------
// Phase C -- detect conflicts. Pure. Throws on the FIRST conflict found;
// nothing has been written when this throws -- all-or-nothing, matching
// provisionEmployeeAccess.js's own discipline. "Refuse to overwrite" is
// enforced here, unconditionally, for every account and every document.
// ---------------------------------------------------------------
function detectConflicts(state) {
  const existingEmails = Object.entries(state.authByEmail)
    .filter(([, user]) => user !== null)
    .map(([email]) => email);
  if (existingEmails.length > 0) {
    throw new Error(
      `Refusing to overwrite: Firebase Auth account(s) already exist for ${existingEmails.join(", ")}. ` +
        "Run --cleanup first (with the manifest from whichever run created them), or resolve manually."
    );
  }

  const existingDocs = Object.entries(state.docsByRef)
    .filter(([, exists]) => exists)
    .map(([ref]) => ref);
  if (existingDocs.length > 0) {
    throw new Error(
      `Refusing to overwrite: Firestore document(s) already exist at ${existingDocs.join(", ")}. ` +
        "Run --cleanup first (with the manifest from whichever run created them), or resolve manually."
    );
  }
}

// ---------------------------------------------------------------
// Phase D -- build the complete plan. Pure (no I/O). Generates
// passwords here (not earlier) so a dry-run that never reaches this
// point never wastes real entropy on credentials nothing will use.
// ---------------------------------------------------------------
function buildAccountPlan() {
  const accounts = {};
  for (const spec of [...REQUIRED_ACCOUNTS, CROSS_USER_ACCOUNT]) {
    accounts[spec.key] = {
      ...spec,
      email: emailFor(spec.slug),
      uid: uidFor(spec.slug),
      password: generateStrongPassword(),
      employeeId: employeeIdFor(spec.slug),
      employmentStatus: "ACTIVE",
    };
  }
  for (const spec of OPTIONAL_ACCOUNTS) {
    accounts[spec.key] = {
      ...spec,
      email: emailFor(spec.slug),
      uid: uidFor(spec.slug),
      password: generateStrongPassword(),
      employeeId: employeeIdFor(spec.slug),
    };
  }
  return accounts;
}

function canonicalReorderRequestFields(now, overrides) {
  return {
    partId: "issue100-verify-part", recommendationStatus: "READY", urgency: "LOW",
    quantitySource: "ANALYTICS", recommendedQty: 1, requestedQty: 1,
    status: "PENDING_REVIEW", currentOwner: "INVENTORY", requestedBy: null, createdAt: now,
    reviewedBy: null, reviewedAt: null, reviewDecision: null, reviewNotes: null,
    assignedToUserId: null, assignedBy: null, assignedAt: null,
    purchasingStartedAt: null, purchasingStartedBy: null,
    purchasingNotes: null, vendorContacted: null, expectedAvailabilityDate: null,
    lastPurchasingUpdateAt: null, lastPurchasingUpdateBy: null,
    purchaseOrderId: null, orderedBy: null, orderedAt: null,
    receivedBy: null, receivedAt: null,
    cancelledBy: null, cancelledAt: null, cancellationReason: null,
    voidedBy: null, voidedAt: null, voidReason: null,
    fixtureMarker: FIXTURE_MARKER,
    ...overrides,
  };
}

// Builds every fixture document this script creates, keyed exactly to
// REQUIRED_FIXTURE_ENV's twelve names (imported from
// verifyIssue100ProductionRules.js -- see that file's own inline
// comments for each fixture's required shape, mirrored here verbatim).
// `uids` maps account key -> Firebase Auth uid (deterministic --
// available even before any account is actually created).
function buildFixturePlan(now, uids) {
  const docs = [];

  const pmQueueId = fixtureDocId("pm-queue");
  docs.push({
    envKey: "PM_QUEUE_DOC_ID", collection: "reorder_requests", docId: pmQueueId,
    data: canonicalReorderRequestFields(now, {
      status: "READY_FOR_PARTS_MANAGER", currentOwner: "PARTS_MANAGER",
      requestedBy: uids.ADMIN, reviewedBy: uids.ADMIN, reviewedAt: now, reviewDecision: "APPROVED",
    }),
  });

  const pendingReviewId = fixtureDocId("pending-review");
  docs.push({
    envKey: "PENDING_REVIEW_DOC_ID", collection: "reorder_requests", docId: pendingReviewId,
    data: canonicalReorderRequestFields(now, { requestedBy: uids.ADMIN }),
  });

  const pmOversightId = fixtureDocId("pm-oversight");
  docs.push({
    envKey: "PM_OVERSIGHT_DOC_ID", collection: "reorder_requests", docId: pmOversightId,
    data: canonicalReorderRequestFields(now, {
      status: "ASSIGNED_TO_PARTS_ASSOCIATE", currentOwner: "PARTS_ASSOCIATE",
      requestedBy: uids.ADMIN, reviewedBy: uids.ADMIN, reviewedAt: now, reviewDecision: "APPROVED",
      assignedToUserId: uids.PARTS_ASSOCIATE_OTHER, assignedBy: uids.PARTS_MANAGER, assignedAt: now,
    }),
  });

  // Realistic terminal history: Admin approves (reviewedBy/reviewDecision),
  // the PARTS_MANAGER fixture performs a REAL Assign (assignedBy -- the
  // one transition a plain, non-admin/dispatcher Parts Manager account
  // can actually perform under firestore.rules), then Admin cancels
  // (admin/dispatcher-only, unchanged by this transition's own pinning
  // of assignedBy) -- every field reflects a transition its own actor
  // could really have performed; never attributes an admin-only Approve/
  // Reject/Cancel decision to the Parts Manager fixture itself. Relevant
  // History's Rules OR-condition (reviewedBy==uid || assignedBy==uid) is
  // satisfied via assignedBy, not reviewedBy.
  const pmHistoryId = fixtureDocId("pm-history");
  docs.push({
    envKey: "PM_HISTORY_DOC_ID", collection: "reorder_requests", docId: pmHistoryId,
    data: canonicalReorderRequestFields(now, {
      status: "CANCELLED", currentOwner: "PARTS_ASSOCIATE",
      requestedBy: uids.ADMIN, reviewedBy: uids.ADMIN, reviewedAt: now, reviewDecision: "APPROVED",
      assignedToUserId: uids.PARTS_ASSOCIATE_OTHER, assignedBy: uids.PARTS_MANAGER, assignedAt: now,
      cancelledBy: uids.ADMIN, cancelledAt: now, cancellationReason: "Issue 100 verification fixture -- historical record.",
    }),
  });

  const invTxnId = fixtureDocId("txn-1");
  docs.push({
    envKey: "INVENTORY_TXN_DOC_ID", collection: "inventory_transactions", docId: invTxnId,
    data: { partId: "issue100-verify-part", type: "CONSUMPTION", quantity: -1, createdAt: now, fixtureMarker: FIXTURE_MARKER },
  });

  const invActionId = fixtureDocId("action-1");
  docs.push({
    envKey: "INVENTORY_ACTIONS_DOC_ID", collection: "inventory_actions", docId: invActionId,
    data: { partId: "issue100-verify-part", type: "RECEIVE_STOCK", quantity: 1, actorUid: uids.ADMIN, createdAt: now, fixtureMarker: FIXTURE_MARKER },
  });

  const paAssignedId = fixtureDocId("pa-assigned");
  docs.push({
    envKey: "PA_ASSIGNED_DOC_ID", collection: "reorder_requests", docId: paAssignedId,
    data: canonicalReorderRequestFields(now, {
      status: "ASSIGNED_TO_PARTS_ASSOCIATE", currentOwner: "PARTS_ASSOCIATE",
      requestedBy: uids.ADMIN, reviewedBy: uids.ADMIN, reviewedAt: now, reviewDecision: "APPROVED",
      assignedToUserId: uids.PARTS_ASSOCIATE, assignedBy: uids.PARTS_MANAGER, assignedAt: now,
    }),
  });

  const paPurchasingId = fixtureDocId("pa-purchasing");
  docs.push({
    envKey: "PA_PURCHASING_DOC_ID", collection: "reorder_requests", docId: paPurchasingId,
    data: canonicalReorderRequestFields(now, {
      status: "PURCHASING_IN_PROGRESS", currentOwner: "PARTS_ASSOCIATE",
      requestedBy: uids.ADMIN, reviewedBy: uids.ADMIN, reviewedAt: now, reviewDecision: "APPROVED",
      assignedToUserId: uids.PARTS_ASSOCIATE, assignedBy: uids.PARTS_MANAGER, assignedAt: now,
      purchasingStartedAt: now, purchasingStartedBy: uids.PARTS_ASSOCIATE,
    }),
  });

  const paRecordPoId = fixtureDocId("pa-record-po");
  docs.push({
    envKey: "PA_RECORD_PO_DOC_ID", collection: "reorder_requests", docId: paRecordPoId,
    data: canonicalReorderRequestFields(now, {
      status: "PURCHASING_IN_PROGRESS", currentOwner: "PARTS_ASSOCIATE",
      requestedBy: uids.ADMIN, reviewedBy: uids.ADMIN, reviewedAt: now, reviewDecision: "APPROVED",
      assignedToUserId: uids.PARTS_ASSOCIATE, assignedBy: uids.PARTS_MANAGER, assignedAt: now,
      purchasingStartedAt: now, purchasingStartedBy: uids.PARTS_ASSOCIATE,
    }),
    // Deliberately NO linked reorder_purchase_orders document -- this is
    // exactly the pre-Record-PO state verifyIssue100ProductionRules.js's
    // Record PO check requires (its own script creates and then deletes
    // the linked document as part of that guarded write).
  });

  const paReceiveId = fixtureDocId("pa-receive");
  docs.push({
    envKey: "PA_RECEIVE_DOC_ID", collection: "reorder_requests", docId: paReceiveId,
    data: canonicalReorderRequestFields(now, {
      status: "ORDERED", currentOwner: "PARTS_ASSOCIATE",
      requestedBy: uids.ADMIN, reviewedBy: uids.ADMIN, reviewedAt: now, reviewDecision: "APPROVED",
      assignedToUserId: uids.PARTS_ASSOCIATE, assignedBy: uids.PARTS_MANAGER, assignedAt: now,
      purchasingStartedAt: now, purchasingStartedBy: uids.PARTS_ASSOCIATE,
      purchaseOrderId: paReceiveId, orderedBy: uids.PARTS_ASSOCIATE, orderedAt: now,
    }),
  });
  docs.push({
    envKey: null, collection: "reorder_purchase_orders", docId: paReceiveId, label: "PA_RECEIVE linked Purchase Order",
    data: {
      reorderRequestId: paReceiveId, partId: "issue100-verify-part", supplierName: "Issue 100 Verify Supplier Co.",
      externalPoNumber: "ISSUE100-VERIFY-PO-1", orderedQuantity: 5, orderedDate: "2026-01-01", expectedArrivalDate: null,
      status: "ORDERED", createdBy: uids.PARTS_ASSOCIATE, createdAt: now, fixtureMarker: FIXTURE_MARKER,
    },
  });

  const paVoidId = fixtureDocId("pa-void-record");
  docs.push({
    envKey: "PA_VOID_RECORD_DOC_ID", collection: "reorder_requests", docId: paVoidId,
    data: canonicalReorderRequestFields(now, {
      status: "VOIDED", currentOwner: "PARTS_ASSOCIATE",
      requestedBy: uids.ADMIN, reviewedBy: uids.ADMIN, reviewedAt: now, reviewDecision: "APPROVED",
      assignedToUserId: uids.PARTS_ASSOCIATE, assignedBy: uids.PARTS_MANAGER, assignedAt: now,
      purchasingStartedAt: now, purchasingStartedBy: uids.PARTS_ASSOCIATE,
      purchaseOrderId: paVoidId, orderedBy: uids.PARTS_ASSOCIATE, orderedAt: now,
      voidedBy: uids.PARTS_ASSOCIATE, voidedAt: now, voidReason: "Issue 100 verification fixture.",
    }),
  });
  docs.push({
    envKey: null, collection: "reorder_purchase_orders", docId: paVoidId, label: "PA_VOID_RECORD linked Purchase Order",
    data: {
      // Never modified by Void, per firestore.rules -- stays ORDERED,
      // same as it was the moment before voiding, matching production
      // reality byte-for-byte (see that Rule's own comment).
      reorderRequestId: paVoidId, partId: "issue100-verify-part", supplierName: "Issue 100 Verify Supplier Co.",
      externalPoNumber: "ISSUE100-VERIFY-PO-2", orderedQuantity: 5, orderedDate: "2026-01-01", expectedArrivalDate: null,
      status: "ORDERED", createdBy: uids.PARTS_ASSOCIATE, createdAt: now, fixtureMarker: FIXTURE_MARKER,
    },
  });
  docs.push({
    envKey: null, collection: "reorder_purchase_order_voids", docId: paVoidId, label: "PA_VOID_RECORD linked Void record",
    data: {
      reorderPurchaseOrderId: paVoidId, reorderRequestId: paVoidId, partId: "issue100-verify-part",
      voidedBy: uids.PARTS_ASSOCIATE, reason: "Issue 100 verification fixture.", createdAt: now, fixtureMarker: FIXTURE_MARKER,
    },
  });

  const paOtherUserId = fixtureDocId("pa-other-user");
  docs.push({
    envKey: "PA_OTHER_USER_DOC_ID", collection: "reorder_requests", docId: paOtherUserId,
    data: canonicalReorderRequestFields(now, {
      status: "ASSIGNED_TO_PARTS_ASSOCIATE", currentOwner: "PARTS_ASSOCIATE",
      requestedBy: uids.ADMIN, reviewedBy: uids.ADMIN, reviewedAt: now, reviewDecision: "APPROVED",
      assignedToUserId: uids.PARTS_ASSOCIATE_OTHER, assignedBy: uids.PARTS_MANAGER, assignedAt: now,
    }),
  });

  return { docs, envDocIds: Object.fromEntries(docs.filter((d) => d.envKey).map((d) => [d.envKey, d.docId])) };
}

// All doc refs and account emails this script will ever touch -- used
// by Phase B/C so conflict detection covers everything up front, before
// any write. `now` is only needed for buildFixturePlan's timestamps, not
// for target enumeration, so a placeholder uid map is fine here.
function enumerateTargets(accounts) {
  const uids = Object.fromEntries(Object.entries(accounts).map(([k, a]) => [k, a.uid]));
  const { docs } = buildFixturePlan(0, uids);
  return {
    emails: Object.values(accounts).map((a) => a.email),
    docRefs: [
      ...Object.values(accounts).map((a) => ({ collection: "employees", docId: a.employeeId })),
      ...docs.map((d) => ({ collection: d.collection, docId: d.docId })),
    ],
  };
}

function buildEnvBlock(accounts, envDocIds, input) {
  const lines = [];
  lines.push(`FIREBASE_PROJECT_ID=${input.projectId}`);
  lines.push("PRODUCTION_DATA_AUTHORIZED=YES");
  lines.push(`FIREBASE_WEB_API_KEY=${input.firebaseWebApiKey ?? "<FILL IN -- this script does not know your Firebase Web API key>"}`);
  lines.push(`GOOGLE_APPLICATION_CREDENTIALS=${input.googleApplicationCredentials}`);
  for (const spec of REQUIRED_ACCOUNTS) {
    const a = accounts[spec.key];
    lines.push(`${spec.key}_EMAIL=${a.email}`);
    lines.push(`${spec.key}_PASSWORD=${a.password}`);
  }
  for (const envKey of REQUIRED_FIXTURE_ENV) {
    lines.push(`${envKey}=${envDocIds[envKey]}`);
  }
  for (const [emailKey, passKey] of OPTIONAL_ACCOUNT_ENV_PAIRS) {
    const key = emailKey.replace("_EMAIL", "");
    const a = accounts[key];
    lines.push(`${emailKey}=${a.email}`);
    lines.push(`${passKey}=${a.password}`);
  }
  return lines.join("\n");
}

function initialManifestState(input) {
  return {
    fixtureMarker: FIXTURE_MARKER,
    generatedAt: new Date().toISOString(),
    projectId: input.projectId,
    status: "IN_PROGRESS",
    envBlock: null,
    manifest: { authUsers: [], firestoreDocs: [] },
  };
}

// Builds the plain (employees/users + fixture docs) creation order as a
// flat list of { collection, docId, data, label } steps, so Phase E can
// iterate ONE list, write-ahead-persisting before and after every
// single step.
function buildAccountFirestoreSteps(accounts, uids, now) {
  const steps = [];
  for (const [key, spec] of Object.entries(accounts)) {
    if (spec.kind === "broken") {
      steps.push({
        collection: "users", docId: uids[key], role: key,
        data: { role: "technician", employeeId: employeeIdFor(`${spec.slug}-target-missing`), fixtureMarker: FIXTURE_MARKER },
        label: `${key} user`,
      });
      continue;
    }
    if (spec.kind === "nonreciprocal") {
      steps.push({
        collection: "employees", docId: spec.employeeId, role: key,
        data: {
          employeeId: spec.employeeId, displayName: spec.displayName, firstName: null, lastName: null,
          employmentStatus: spec.employmentStatus, operationalRoles: spec.operationalRoles, securityRole: null,
          companyId: null, departmentId: null, locationId: null,
          userId: "issue100-verify-nonreciprocal-mismatched-uid-placeholder",
          createdAt: now, updatedAt: now, fixtureMarker: FIXTURE_MARKER,
        },
        label: `${key} employee`,
      });
      steps.push({
        collection: "users", docId: uids[key], role: key,
        data: { role: "technician", employeeId: spec.employeeId, fixtureMarker: FIXTURE_MARKER },
        label: `${key} user`,
      });
      continue;
    }
    steps.push({
      collection: "employees", docId: spec.employeeId, role: key,
      data: {
        employeeId: spec.employeeId, displayName: spec.displayName, firstName: null, lastName: null,
        employmentStatus: spec.employmentStatus ?? "ACTIVE", operationalRoles: spec.operationalRoles,
        securityRole: null, companyId: null, departmentId: null, locationId: null,
        userId: uids[key], createdAt: now, updatedAt: now, fixtureMarker: FIXTURE_MARKER,
      },
      label: `${key} employee`,
    });
    steps.push({
      collection: "users", docId: uids[key], role: key,
      data: { role: spec.securityRole ?? "technician", employeeId: spec.employeeId, fixtureMarker: FIXTURE_MARKER },
      label: `${key} user`,
    });
  }
  return steps;
}

// ---------------------------------------------------------------
// Reality-check-then-compensate -- the SAME logic used both by this
// run's own catch-based compensation AND by --cleanup (including a
// --cleanup pointed at a manifest left behind by a hard crash). Never
// assumes an entry's recorded state ("planned" or "created") reflects
// reality -- always re-checks by the entry's own deterministic
// identity. A "planned" entry that turns out not to exist resolves
// cleanly (the crash landed before the mutation ever reached Firebase)
// -- NOT an error. An entry that exists but fails identity verification
// throws, refusing to delete something that isn't provably ours.
// ---------------------------------------------------------------
async function resolveAndCompensateAuthEntry(auth, entry) {
  if (entry.state === "deleted") return { deleted: false, wasPresent: false };
  const user = await auth.getUser(entry.uid).catch(() => null);
  if (!user) {
    entry.state = "deleted";
    return { deleted: false, wasPresent: false };
  }
  const matches = user.email && user.email.endsWith(`@${FIXTURE_EMAIL_DOMAIN}`) && user.email === entry.email;
  if (!matches) {
    throw new Error("Auth identity verification failed during compensation -- refusing to delete.");
  }
  await auth.deleteUser(entry.uid);
  entry.state = "deleted";
  return { deleted: true, wasPresent: true };
}

async function resolveAndCompensateDocEntry(db, entry) {
  if (entry.state === "deleted") return { deleted: false, wasPresent: false };
  const ref = db.collection(entry.collection).doc(entry.docId);
  const snap = await ref.get();
  if (!snap.exists) {
    entry.state = "deleted";
    return { deleted: false, wasPresent: false };
  }
  if (snap.data().fixtureMarker !== FIXTURE_MARKER) {
    throw new Error("Firestore marker verification failed during compensation -- refusing to delete.");
  }
  await ref.delete({ lastUpdateTime: snap.updateTime });
  entry.state = "deleted";
  return { deleted: true, wasPresent: true };
}

// ---------------------------------------------------------------
// Phase E -- apply with crash-safe, write-ahead recovery. Only reached
// when input.apply === true and conflict detection has already passed.
// Exclusively creates the manifest file, then for EVERY Auth account
// and Firestore document: persists a "planned" entry (naming its
// already-known deterministic identity) BEFORE attempting the real
// write, then flips that SAME entry to "created" and persists again
// AFTER the write succeeds. On any failure, every touched entry
// (planned or created) is resolved/compensated in exact reverse order
// via the reality-check logic above.
// ---------------------------------------------------------------
async function applyBootstrapWithRecovery(db, auth, accounts, input) {
  let manifestState;
  try {
    manifestState = initialManifestState(input);
    createSecretFileExclusively(input.credentialsOutFile, JSON.stringify(manifestState, null, 2));
  } catch (err) {
    return { ok: false, exitCode: 1, reason: "MANIFEST_CREATE_FAILED", internalErrorDetail: err.message };
  }

  function persist() {
    writeSecretFileDurably(input.credentialsOutFile, JSON.stringify(manifestState, null, 2));
  }

  const touchedAuthUids = []; // in creation-attempt order, for reverse compensation
  const touchedDocRefs = []; // [{ collection, docId }], in creation-attempt order

  try {
    const uids = {};
    for (const [key, spec] of Object.entries(accounts)) {
      const authEntry = { role: key, uid: spec.uid, email: spec.email, state: "planned" };
      manifestState.manifest.authUsers.push(authEntry);
      touchedAuthUids.push(spec.uid);
      persist();

      await auth.createUser({ uid: spec.uid, email: spec.email, password: spec.password, displayName: spec.displayName ?? undefined, emailVerified: true });
      uids[key] = spec.uid;

      authEntry.state = "created";
      persist();
      console.log(`Created Firebase Auth account for ${key}.`);
    }

    const now = Date.now();
    const accountSteps = buildAccountFirestoreSteps(accounts, uids, now);
    for (const step of accountSteps) {
      const docEntry = { collection: step.collection, docId: step.docId, label: step.label, state: "planned" };
      manifestState.manifest.firestoreDocs.push(docEntry);
      touchedDocRefs.push({ collection: step.collection, docId: step.docId });
      persist();

      await db.collection(step.collection).doc(step.docId).set(step.data);

      docEntry.state = "created";
      persist();
      console.log(`Created ${step.collection}/${step.label}.`);
    }

    const { docs, envDocIds } = buildFixturePlan(now, uids);
    for (const d of docs) {
      const docEntry = { collection: d.collection, docId: d.docId, label: d.envKey ?? d.label, state: "planned" };
      manifestState.manifest.firestoreDocs.push(docEntry);
      touchedDocRefs.push({ collection: d.collection, docId: d.docId });
      persist();

      await db.collection(d.collection).doc(d.docId).set(d.data);

      docEntry.state = "created";
      persist();
      console.log(`Created ${d.collection}/${d.envKey ?? d.label}.`);
    }

    manifestState.status = "COMPLETE";
    manifestState.envBlock = buildEnvBlock(accounts, envDocIds, input);
    persist();

    return { ok: true, exitCode: 0, applied: true, accounts, manifest: manifestState.manifest, envDocIds };
  } catch (err) {
    const compensationFailures = [];

    for (let i = touchedDocRefs.length - 1; i >= 0; i -= 1) {
      const ref = touchedDocRefs[i];
      const entry = manifestState.manifest.firestoreDocs.find((d) => d.collection === ref.collection && d.docId === ref.docId && d.state !== "deleted");
      if (!entry) continue;
      try {
        await resolveAndCompensateDocEntry(db, entry);
        persist();
      } catch (compErr) {
        compensationFailures.push({ type: "doc", collection: ref.collection, docId: ref.docId, detail: compErr.message });
      }
    }

    for (let i = touchedAuthUids.length - 1; i >= 0; i -= 1) {
      const uid = touchedAuthUids[i];
      const entry = manifestState.manifest.authUsers.find((u) => u.uid === uid && u.state !== "deleted");
      if (!entry) continue;
      try {
        await resolveAndCompensateAuthEntry(auth, entry);
        persist();
      } catch (compErr) {
        compensationFailures.push({ type: "auth", uid, detail: compErr.message });
      }
    }

    if (compensationFailures.length === 0) {
      manifestState.status = "FAILED_COMPENSATED";
      persist();
      return { ok: false, exitCode: 1, reason: "APPLY_FAILED_FULLY_COMPENSATED", internalErrorDetail: err.message };
    }

    manifestState.status = "FAILED_INCOMPLETE_COMPENSATION";
    persist();
    return { ok: false, exitCode: 4, reason: "APPLY_FAILED_INCOMPLETE_COMPENSATION", internalErrorDetail: err.message, compensationFailures };
  }
}

// ---------------------------------------------------------------
// Cleanup -- two strict phases, TOCTOU-resistant. Phase 1 prevalidates
// EVERY non-"deleted" manifest entry (planned OR created, treated
// identically -- see resolveAndCompensate* above) with zero mutation;
// if anything mismatches, returns immediately having deleted nothing.
// Phase 2 (only reached if phase 1 found zero mismatches) deletes one
// target at a time, IMMEDIATELY re-verifying identity right before each
// Auth deletion and carrying a Firestore `lastUpdateTime` precondition
// captured at validation time on each Firestore deletion -- if a target
// genuinely changed in between, this phase stops immediately, persists
// accurate progress, and reports a distinct recoverable-failure result.
// ---------------------------------------------------------------
async function runCleanup(db, auth, manifestFile, apply) {
  const raw = fs.readFileSync(manifestFile, "utf8");
  const parsed = JSON.parse(raw);
  if (parsed.fixtureMarker !== FIXTURE_MARKER) {
    throw new Error(`Manifest fixtureMarker "${parsed.fixtureMarker}" does not match this script's own "${FIXTURE_MARKER}" -- refusing to clean up a manifest from a different/incompatible run.`);
  }

  const authPlan = [];
  for (const entry of parsed.manifest.authUsers) {
    if (entry.state === "deleted") continue;
    const user = await auth.getUser(entry.uid).catch(() => null);
    if (!user) {
      authPlan.push({ entry, action: "already-gone" });
      continue;
    }
    const matches = user.email && user.email.endsWith(`@${FIXTURE_EMAIL_DOMAIN}`) && user.email === entry.email;
    authPlan.push({ entry, action: matches ? "delete" : "mismatch" });
  }

  const docPlan = [];
  for (const entry of parsed.manifest.firestoreDocs) {
    if (entry.state === "deleted") continue;
    const ref = db.collection(entry.collection).doc(entry.docId);
    const snap = await ref.get();
    if (!snap.exists) {
      docPlan.push({ entry, ref, action: "already-gone" });
      continue;
    }
    const matches = snap.data().fixtureMarker === FIXTURE_MARKER;
    docPlan.push({ entry, ref, action: matches ? "delete" : "mismatch", expectedUpdateTime: snap.updateTime });
  }

  const mismatches = [
    ...authPlan.filter((p) => p.action === "mismatch").map((p) => p.entry.role),
    ...docPlan.filter((p) => p.action === "mismatch").map((p) => `${p.entry.collection}/${p.entry.label}`),
  ];

  if (mismatches.length > 0) {
    return { aborted: true, deletedAuthUsers: 0, deletedDocs: 0, mismatches };
  }

  const toDeleteAuthCount = authPlan.filter((p) => p.action === "delete").length;
  const toDeleteDocCount = docPlan.filter((p) => p.action === "delete").length;

  if (!apply) {
    return { aborted: false, wouldDeleteAuthUsers: toDeleteAuthCount, wouldDeleteDocs: toDeleteDocCount, mismatches: [] };
  }

  function persist() {
    writeSecretFileDurably(manifestFile, JSON.stringify(parsed, null, 2));
  }

  let deletedAuthUsers = 0;
  for (const { entry, action } of authPlan) {
    if (action === "delete") {
      // Immediate revalidation -- re-check identity right before this
      // specific deletion, not just at Phase 1 validation time.
      const recheck = await auth.getUser(entry.uid).catch(() => null);
      if (recheck) {
        const stillMatches = recheck.email && recheck.email.endsWith(`@${FIXTURE_EMAIL_DOMAIN}`) && recheck.email === entry.email;
        if (!stillMatches) {
          persist();
          return { aborted: false, targetChangedMidRun: true, changedTarget: entry.role, deletedAuthUsers, deletedDocs: 0 };
        }
        await auth.deleteUser(entry.uid);
        deletedAuthUsers += 1;
      }
      // If recheck is null, it vanished between phase 1 and phase 2 --
      // nothing to delete, not a change requiring abort.
    }
    entry.state = "deleted";
    persist();
  }

  let deletedDocs = 0;
  for (const { entry, ref, action, expectedUpdateTime } of docPlan) {
    if (action === "delete") {
      try {
        await ref.delete({ lastUpdateTime: expectedUpdateTime });
        deletedDocs += 1;
      } catch (err) {
        const isPreconditionFailure = err.code === 9 || /FAILED_PRECONDITION/i.test(err.message || "");
        if (isPreconditionFailure) {
          persist();
          return { aborted: false, targetChangedMidRun: true, changedTarget: `${entry.collection}/${entry.label}`, deletedAuthUsers, deletedDocs };
        }
        throw err;
      }
    }
    entry.state = "deleted";
    persist();
  }

  return { aborted: false, deletedAuthUsers, deletedDocs, mismatches: [] };
}

// ---------------------------------------------------------------
// Orchestration -- one function per mode, each doing exactly what
// main() invokes, factored out so tests can drive them directly against
// a real (emulator) db/auth without spawning a subprocess or parsing
// captured stdout to determine outcome. Console output is always a
// fixed, classified message keyed off `reason` -- never a caught
// error's own raw message, and never the credentials/manifest file's
// own path. The real message/path is preserved only on the returned
// result object for direct test inspection.
// ---------------------------------------------------------------
const FIXED_MESSAGES = {
  MANIFEST_CREATE_FAILED: "FAIL -- could not exclusively create and secure the credentials/manifest file (it may already exist, its location may be invalid, or restrictive permissions could not be established and verified). No Auth account or Firestore document was created.",
  APPLY_FAILED_FULLY_COMPENSATED: "FAIL -- apply could not complete; every partially-created Auth account and Firestore document was successfully removed. No residual state remains.",
  APPLY_FAILED_INCOMPLETE_COMPENSATION: "FAIL -- apply could not complete and some partially-created state could NOT be removed automatically. The manifest file has been retained -- immediate manual review (or --cleanup with that file) is required.",
  CLEANUP_MISMATCH: "FAIL -- one or more manifest targets did not verify (marker/identity mismatch, or the manifest itself is stale). Aborting with ZERO deletions.",
  CLEANUP_TARGET_CHANGED_MID_RUN: "FAIL -- a manifest target changed between validation and its own deletion. Cleanup stopped immediately; progress made so far has been durably recorded. Re-run --cleanup to resolve the remainder after investigating the change.",
};

async function runCleanupCommand(db, auth, input) {
  console.log(`Issue #100 verification fixture cleanup -- project "${input.projectId}" -- ${input.apply ? "APPLY" : "DRY-RUN preview"}.\n`);
  let results;
  try {
    results = await runCleanup(db, auth, input.manifestFile, input.apply);
  } catch (err) {
    console.error("FAIL -- cleanup aborted due to an unexpected error (no detail logged).");
    return { ok: false, exitCode: 1, reason: "CLEANUP_UNEXPECTED_ERROR", internalErrorDetail: err.message };
  }

  if (results.aborted) {
    console.error(FIXED_MESSAGES.CLEANUP_MISMATCH);
    return { ok: false, exitCode: 1, reason: "CLEANUP_MISMATCH", results };
  }

  if (results.targetChangedMidRun) {
    console.error(FIXED_MESSAGES.CLEANUP_TARGET_CHANGED_MID_RUN);
    return { ok: false, exitCode: 4, reason: "CLEANUP_TARGET_CHANGED_MID_RUN", results };
  }

  if (!input.apply) {
    console.log(`\nWould delete ${results.wouldDeleteAuthUsers} Auth account(s), ${results.wouldDeleteDocs} Firestore document(s). Every target validated.`);
    return { ok: true, exitCode: 0, results };
  }

  console.log(`\nDeleted ${results.deletedAuthUsers} Auth account(s), ${results.deletedDocs} Firestore document(s). Every target validated before any deletion.`);
  return { ok: true, exitCode: 0, results };
}

async function runBootstrapCommand(db, auth, input) {
  console.log(`Issue #100 verification fixture bootstrap -- project "${input.projectId}" -- ${input.apply ? "APPLY" : "DRY-RUN preview"}.\n`);

  const accounts = buildAccountPlan();
  const targets = enumerateTargets(accounts);

  let state;
  try {
    state = await readCurrentState(db, auth, targets);
    detectConflicts(state);
  } catch (err) {
    console.error("FAIL -- one or more targets already exist; refusing to create anything.");
    return { ok: false, exitCode: 1, reason: "CONFLICT", internalErrorDetail: err.message };
  }

  console.log(`Plan: ${Object.keys(accounts).length} Auth account(s), ${targets.docRefs.length} Firestore document(s). No conflicts detected.`);

  if (!input.apply) {
    console.log("\nDRY-RUN -- no Auth account, Firestore document, or credentials file was created. Re-run with --apply to create them.");
    return { ok: true, exitCode: 0, applied: false, accounts, targets };
  }

  const result = await applyBootstrapWithRecovery(db, auth, accounts, input);
  if (!result.ok) {
    console.error(FIXED_MESSAGES[result.reason] ?? "FAIL -- apply aborted due to an unexpected error (no detail logged).");
    return result;
  }

  console.log(`\nOK -- ${result.manifest.authUsers.length} Auth account(s) and ${result.manifest.firestoreDocs.length} Firestore document(s) created.`);
  console.log("Credentials and verifier environment variables have been written to the configured output file.");
  console.log("That file contains real passwords -- keep it outside version control, delete it when no longer needed, and use --cleanup with it when you are done verifying.");
  return result;
}

async function main() {
  const rawArgs = parseArgs(process.argv.slice(2));
  let input;
  try {
    input = validateInput(rawArgs, process.env);
  } catch (err) {
    console.error(VALIDATION_FIXED_MESSAGES[err.code] ?? "FAIL -- invalid configuration (no detail logged).");
    process.exitCode = 1;
    return;
  }

  if (getApps().length === 0) initializeApp({ projectId: input.projectId });
  const db = getFirestore();
  const auth = getAuth();

  const result = input.mode === "cleanup"
    ? await runCleanupCommand(db, auth, input)
    : await runBootstrapCommand(db, auth, input);
  process.exitCode = result.exitCode;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Failed (no credential/detail logged).");
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  validateInput,
  ValidationError,
  assertOutsideRepo,
  repoRoot,
  normalizeForContainmentComparison,
  generateStrongPassword,
  emailFor,
  employeeIdFor,
  fixtureDocId,
  uidFor,
  createSecretFileExclusively,
  writeSecretFileDurably,
  establishAndVerifySecretFilePermissions,
  verifySecretFilePermissions,
  applyWindowsAcl,
  verifyWindowsAcl,
  parseIcaclsPrincipals,
  windowsAllowedPrincipalPatterns,
  readCurrentState,
  detectConflicts,
  buildAccountPlan,
  canonicalReorderRequestFields,
  buildFixturePlan,
  buildAccountFirestoreSteps,
  enumerateTargets,
  buildEnvBlock,
  initialManifestState,
  resolveAndCompensateAuthEntry,
  resolveAndCompensateDocEntry,
  applyBootstrapWithRecovery,
  runCleanup,
  runBootstrapCommand,
  runCleanupCommand,
  FIXED_MESSAGES,
  VALIDATION_FIXED_MESSAGES,
  FIXTURE_MARKER,
  FIXTURE_EMAIL_DOMAIN,
  ID_PREFIX,
  REQUIRED_ACCOUNTS,
  CROSS_USER_ACCOUNT,
  OPTIONAL_ACCOUNTS,
};
