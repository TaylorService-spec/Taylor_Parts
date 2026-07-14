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
//      A dry-run is therefore a genuine preview (it reflects real
//      collisions), not a structural-only simulation -- and it performs
//      zero Auth or Firestore writes and produces no credentials file.
//   2. Refuse to overwrite. Conflict detection runs BEFORE any write --
//      if ANY target Auth email or ANY target Firestore document
//      already exists, the entire run throws and writes NOTHING (all-
//      or-nothing, matching functions/scripts/provisionEmployeeAccess.js's
//      own established phase-ordering discipline). This script never
//      updates an existing document -- create-only, always.
//   3. Deviation from provisionEmployeeAccess.js's passwordless
//      convention, deliberate and scoped: that script never generates a
//      credential because it provisions REAL employee access records.
//      This script provisions DISPOSABLE, clearly-fixture-labeled test
//      identities whose entire purpose is signing in with a password via
//      verifyIssue100ProductionRules.js's Identity Toolkit REST calls --
//      a passwordless account cannot do that. A strong, random password
//      is generated per account and written ONLY to the operator-
//      selected credentials file (see #4) -- never to stdout, never
//      logged, never returned from any function that isn't explicitly
//      building that file's contents.
//   4. Secrets and every REQUIRED_ACCOUNT_ENV/REQUIRED_FIXTURE_ENV/
//      OPTIONAL_ACCOUNT_ENV_PAIRS value go ONLY into --credentialsOutFile,
//      an operator-chosen ABSOLUTE path that this script refuses to
//      accept if it resolves inside this repository (checked in phase A,
//      before any Firebase SDK call, via a plain path-prefix test against
//      this file's own repo root). Console output during a run is limited
//      to role/collection/label progress lines and counts -- never an
//      email, password, uid, or the credentials file's own contents.
//   5. Marker- and manifest-guarded cleanup, never automatic. --apply
//      writes a manifest (exactly which Auth uids and Firestore
//      collection/docId pairs were created) into the SAME credentials
//      file. A separate, always-explicit --cleanup [--apply] mode reads
//      that manifest and deletes ONLY what it lists -- and, as a second,
//      independent safety layer, re-reads each target immediately before
//      deleting it and refuses to delete anything whose fixtureMarker
//      field (Firestore) or fixture email domain (Auth) does not still
//      match this script's own FIXTURE_MARKER/FIXTURE_EMAIL_DOMAIN
//      constants -- protecting against a stale or hand-edited manifest.
//      Cleanup is NEVER invoked automatically by the create path (not on
//      error, not on exit) -- it is a wholly separate operator decision,
//      exactly once, when explicitly requested.
//   6. Never executes on import. Every exported function is a plain,
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
// USAGE (apply -- creates real accounts/documents and writes the file):
//   ...same as above, plus --apply
//
// USAGE (cleanup preview, deletes nothing):
//   node scripts/bootstrapIssue100VerificationFixtures.js --cleanup \
//     --manifestFile /absolute/path/outside/this/repo/issue100-verify-fixtures.json
//
// USAGE (cleanup, apply -- actually deletes, marker-guarded):
//   ...same as above, plus --apply
//
// Exit codes:
//   0 -- completed (dry-run preview, or a real apply/cleanup) with no
//        unresolved issue.
//   1 -- a prerequisite was missing/invalid, a conflict was detected
//        (refusing to overwrite), or one or more cleanup targets were
//        skipped because their marker no longer matched (requires
//        manual operator review -- see the printed SKIPPED lines).
"use strict";

const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
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
// random (see "Deterministic fixture IDs" -- item 4).
const FIXTURE_MARKER = "ISSUE_100_VERIFICATION_FIXTURE_V1";

// RFC 2606 reserves `.invalid` as a TLD guaranteed to never resolve --
// every fixture Auth account's email lives under this domain, doubling
// as a second, independent marker (alongside FIXTURE_MARKER on every
// Firestore document) that cleanup's marker-guard re-checks against a
// live Auth record before ever deleting it.
const FIXTURE_EMAIL_DOMAIN = "issue100-verify.fixtures.invalid";

const ID_PREFIX = "issue100-verify";

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

// This file lives at functions/scripts/<this file> -- repo root is two
// directories up. Used only to refuse an --credentialsOutFile/--manifestFile
// path that resolves inside this repository.
function repoRoot() {
  return path.resolve(__dirname, "..", "..");
}

function assertOutsideRepo(label, absPath) {
  const resolved = path.resolve(absPath);
  const root = repoRoot() + path.sep;
  if (resolved === repoRoot() || resolved.startsWith(root)) {
    throw new Error(`${label} must be OUTSIDE this repository -- "${resolved}" resolves inside it.`);
  }
}

// ---------------------------------------------------------------
// Phase A -- parse and validate input. No I/O, no Firebase SDK call.
// ---------------------------------------------------------------
function validateInput(rawArgs, env) {
  const apply = rawArgs.apply === "true";
  const cleanup = rawArgs.cleanup === "true";

  if (env.FIREBASE_PROJECT_ID !== REQUIRED_PROJECT_ID) {
    throw new Error(`FIREBASE_PROJECT_ID must be exactly "${REQUIRED_PROJECT_ID}" (no default target).`);
  }
  if (env.PRODUCTION_DATA_AUTHORIZED !== "YES") {
    throw new Error('PRODUCTION_DATA_AUTHORIZED must be exactly "YES" (explicit, per-run Owner authorization).');
  }
  if (!env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS is required (Admin SDK credential path).");
  }

  if (cleanup) {
    if (!rawArgs.manifestFile) {
      throw new Error("--cleanup requires --manifestFile <absolute path to a file this script previously wrote>.");
    }
    if (!path.isAbsolute(rawArgs.manifestFile)) {
      throw new Error("--manifestFile must be an absolute path.");
    }
    assertOutsideRepo("--manifestFile", rawArgs.manifestFile);
    return { mode: "cleanup", apply, manifestFile: path.resolve(rawArgs.manifestFile), projectId: env.FIREBASE_PROJECT_ID };
  }

  if (!rawArgs.credentialsOutFile) {
    throw new Error("--credentialsOutFile <absolute path outside this repository> is required.");
  }
  if (!path.isAbsolute(rawArgs.credentialsOutFile)) {
    throw new Error("--credentialsOutFile must be an absolute path.");
  }
  assertOutsideRepo("--credentialsOutFile", rawArgs.credentialsOutFile);

  return {
    mode: "bootstrap",
    apply,
    credentialsOutFile: path.resolve(rawArgs.credentialsOutFile),
    projectId: env.FIREBASE_PROJECT_ID,
    firebaseWebApiKey: env.FIREBASE_WEB_API_KEY || null,
    googleApplicationCredentials: env.GOOGLE_APPLICATION_CREDENTIALS,
  };
}

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
      password: generateStrongPassword(),
      employeeId: employeeIdFor(spec.slug),
      employmentStatus: "ACTIVE",
    };
  }
  for (const spec of OPTIONAL_ACCOUNTS) {
    accounts[spec.key] = {
      ...spec,
      email: emailFor(spec.slug),
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
// `uids` maps account key -> Firebase Auth uid (only known once Phase E
// has created/resolved every account -- see applyBootstrap()).
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

  const pmHistoryId = fixtureDocId("pm-history");
  docs.push({
    envKey: "PM_HISTORY_DOC_ID", collection: "reorder_requests", docId: pmHistoryId,
    data: canonicalReorderRequestFields(now, {
      status: "REJECTED", currentOwner: "INVENTORY",
      requestedBy: uids.ADMIN, reviewedBy: uids.PARTS_MANAGER, reviewedAt: now, reviewDecision: "REJECTED",
      reviewNotes: "Issue 100 verification fixture -- historical record.",
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
  const placeholderUids = Object.fromEntries(Object.keys(accounts).map((k) => [k, `placeholder-${k}`]));
  const { docs } = buildFixturePlan(0, placeholderUids);
  return {
    emails: Object.values(accounts).map((a) => a.email),
    docRefs: [
      ...Object.values(accounts).map((a) => ({ collection: "employees", docId: a.employeeId })),
      ...docs.map((d) => ({ collection: d.collection, docId: d.docId })),
    ],
  };
}

// ---------------------------------------------------------------
// Phase E -- apply. Only reached when input.apply === true. Creates
// every Auth account, then every Firestore document (employees/users
// first, so uids exist before fixture docs that reference them),
// returning the full manifest for the credentials file.
// ---------------------------------------------------------------
async function applyBootstrap(db, auth, accounts) {
  const now = Date.now();
  const manifest = { authUsers: [], firestoreDocs: [] };

  const uids = {};
  for (const [key, spec] of Object.entries(accounts)) {
    const userRecord = await auth.createUser({ email: spec.email, password: spec.password, displayName: spec.displayName ?? undefined, emailVerified: true });
    uids[key] = userRecord.uid;
    manifest.authUsers.push({ role: key, uid: userRecord.uid, email: spec.email });
    console.log(`Created Firebase Auth account for ${key}.`);
  }

  for (const [key, spec] of Object.entries(accounts)) {
    if (spec.kind === "broken") {
      // No employees/{employeeId} document at all -- the whole point of
      // this probe. users/{uid}.employeeId points to an id that will
      // never resolve.
      await db.collection("users").doc(uids[key]).set({ role: "technician", employeeId: employeeIdFor(`${spec.slug}-target-missing`), fixtureMarker: FIXTURE_MARKER });
      manifest.firestoreDocs.push({ collection: "users", docId: uids[key], label: `${key} user` });
      continue;
    }

    if (spec.kind === "nonreciprocal") {
      // employees/{employeeId}.userId points to a deliberately mismatched
      // sentinel, never this account's own real uid -- users/{uid}.
      // employeeId still points at it, so the link is one-directional.
      const employeeDoc = {
        employeeId: spec.employeeId, displayName: spec.displayName, firstName: null, lastName: null,
        employmentStatus: spec.employmentStatus, operationalRoles: spec.operationalRoles, securityRole: null,
        companyId: null, departmentId: null, locationId: null,
        userId: "issue100-verify-nonreciprocal-mismatched-uid-placeholder",
        createdAt: now, updatedAt: now, fixtureMarker: FIXTURE_MARKER,
      };
      await db.collection("employees").doc(spec.employeeId).set(employeeDoc);
      manifest.firestoreDocs.push({ collection: "employees", docId: spec.employeeId, label: `${key} employee` });
      await db.collection("users").doc(uids[key]).set({ role: "technician", employeeId: spec.employeeId, fixtureMarker: FIXTURE_MARKER });
      manifest.firestoreDocs.push({ collection: "users", docId: uids[key], label: `${key} user` });
      continue;
    }

    // Normal reciprocal linkage -- every REQUIRED/CROSS_USER account,
    // plus INACTIVE_LINKAGE/INELIGIBLE.
    const employeeDoc = {
      employeeId: spec.employeeId, displayName: spec.displayName, firstName: null, lastName: null,
      employmentStatus: spec.employmentStatus ?? "ACTIVE", operationalRoles: spec.operationalRoles,
      securityRole: null, companyId: null, departmentId: null, locationId: null,
      userId: uids[key], createdAt: now, updatedAt: now, fixtureMarker: FIXTURE_MARKER,
    };
    await db.collection("employees").doc(spec.employeeId).set(employeeDoc);
    manifest.firestoreDocs.push({ collection: "employees", docId: spec.employeeId, label: `${key} employee` });
    await db.collection("users").doc(uids[key]).set({ role: spec.securityRole ?? "technician", employeeId: spec.employeeId, fixtureMarker: FIXTURE_MARKER });
    manifest.firestoreDocs.push({ collection: "users", docId: uids[key], label: `${key} user` });
    console.log(`Created reciprocally-linked Employee/User records for ${key}.`);
  }

  const { docs, envDocIds } = buildFixturePlan(now, uids);
  for (const d of docs) {
    await db.collection(d.collection).doc(d.docId).set(d.data);
    manifest.firestoreDocs.push({ collection: d.collection, docId: d.docId, label: d.envKey ?? d.label });
    console.log(`Created ${d.collection}/${d.envKey ?? d.label}.`);
  }

  return { uids, manifest, envDocIds };
}

function buildCredentialsFileContent({ accounts, manifest, envDocIds, input }) {
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

  return JSON.stringify(
    {
      fixtureMarker: FIXTURE_MARKER,
      generatedAt: new Date().toISOString(),
      projectId: input.projectId,
      envBlock: lines.join("\n"),
      manifest,
    },
    null,
    2
  );
}

// ---------------------------------------------------------------
// Cleanup mode -- reads a manifest, re-verifies each target's marker
// live (never trusts the manifest alone), deletes only what still
// matches. Runs its OWN dry-run/apply split, identical in spirit to
// bootstrap's -- --cleanup without --apply previews only.
// ---------------------------------------------------------------
async function runCleanup(db, auth, manifestFile, apply) {
  const raw = fs.readFileSync(manifestFile, "utf8");
  const parsed = JSON.parse(raw);
  if (parsed.fixtureMarker !== FIXTURE_MARKER) {
    throw new Error(`Manifest fixtureMarker "${parsed.fixtureMarker}" does not match this script's own "${FIXTURE_MARKER}" -- refusing to clean up a manifest from a different/incompatible run.`);
  }

  const results = { deletedAuthUsers: 0, deletedDocs: 0, skippedAuthUsers: [], skippedDocs: [] };

  for (const entry of parsed.manifest.authUsers) {
    const user = await auth.getUser(entry.uid).catch(() => null);
    if (!user || !user.email || !user.email.endsWith(`@${FIXTURE_EMAIL_DOMAIN}`) || user.email !== entry.email) {
      results.skippedAuthUsers.push(entry.role);
      console.log(`SKIPPED -- ${entry.role} Auth account: marker/email no longer matches (or already gone). Not deleted.`);
      continue;
    }
    if (apply) await auth.deleteUser(entry.uid);
    results.deletedAuthUsers += 1;
    console.log(`${apply ? "Deleted" : "Would delete"} Auth account for ${entry.role}.`);
  }

  for (const entry of parsed.manifest.firestoreDocs) {
    const ref = db.collection(entry.collection).doc(entry.docId);
    const snap = await ref.get();
    if (!snap.exists || snap.data().fixtureMarker !== FIXTURE_MARKER) {
      results.skippedDocs.push(`${entry.collection}/${entry.label}`);
      console.log(`SKIPPED -- ${entry.collection}/${entry.label}: marker no longer matches (or already gone). Not deleted.`);
      continue;
    }
    if (apply) await ref.delete();
    results.deletedDocs += 1;
    console.log(`${apply ? "Deleted" : "Would delete"} ${entry.collection}/${entry.label}.`);
  }

  return results;
}

// ---------------------------------------------------------------
// Orchestration -- one function per mode, each doing exactly what
// main() invokes, factored out so tests can drive them directly against
// a real (emulator) db/auth without spawning a subprocess or parsing
// captured stdout to determine outcome. Both return { ok, exitCode }
// alongside whatever the caller needs to assert on.
// ---------------------------------------------------------------
async function runCleanupCommand(db, auth, input) {
  console.log(`Issue #100 verification fixture cleanup -- project "${input.projectId}" -- ${input.apply ? "APPLY" : "DRY-RUN preview"}.\n`);
  let results;
  try {
    results = await runCleanup(db, auth, input.manifestFile, input.apply);
  } catch (err) {
    console.error(`FAIL -- ${err.message}`);
    return { ok: false, exitCode: 1, error: err.message };
  }
  console.log(
    `\n${input.apply ? "Deleted" : "Would delete"} ${results.deletedAuthUsers} Auth account(s), ${results.deletedDocs} Firestore document(s). ` +
      `${results.skippedAuthUsers.length + results.skippedDocs.length} skipped (marker mismatch).`
  );
  const exitCode = results.skippedAuthUsers.length + results.skippedDocs.length > 0 ? 1 : 0;
  return { ok: exitCode === 0, exitCode, results };
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
    console.error(`FAIL -- ${err.message}`);
    return { ok: false, exitCode: 1, error: err.message };
  }

  console.log(`Plan: ${Object.keys(accounts).length} Auth account(s), ${targets.docRefs.length} Firestore document(s). No conflicts detected.`);

  if (!input.apply) {
    console.log("\nDRY-RUN -- no Auth account, Firestore document, or credentials file was created. Re-run with --apply to create them.");
    return { ok: true, exitCode: 0, applied: false, accounts, targets };
  }

  const { manifest, envDocIds } = await applyBootstrap(db, auth, accounts);
  const fileContent = buildCredentialsFileContent({ accounts, manifest, envDocIds, input });
  fs.writeFileSync(input.credentialsOutFile, fileContent, { mode: 0o600 });

  console.log(`\nOK -- ${manifest.authUsers.length} Auth account(s) and ${manifest.firestoreDocs.length} Firestore document(s) created.`);
  console.log(`Credentials and verifier environment variables written to: ${input.credentialsOutFile}`);
  console.log("This file contains real passwords -- keep it outside version control, delete it when no longer needed, and use --cleanup with it when you are done verifying.");
  return { ok: true, exitCode: 0, applied: true, accounts, manifest, envDocIds };
}

async function main() {
  const rawArgs = parseArgs(process.argv.slice(2));
  let input;
  try {
    input = validateInput(rawArgs, process.env);
  } catch (err) {
    console.error(`FAIL -- ${err.message}`);
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
  assertOutsideRepo,
  repoRoot,
  generateStrongPassword,
  emailFor,
  employeeIdFor,
  fixtureDocId,
  readCurrentState,
  detectConflicts,
  buildAccountPlan,
  canonicalReorderRequestFields,
  buildFixturePlan,
  enumerateTargets,
  applyBootstrap,
  buildCredentialsFileContent,
  runCleanup,
  runBootstrapCommand,
  runCleanupCommand,
  FIXTURE_MARKER,
  FIXTURE_EMAIL_DOMAIN,
  ID_PREFIX,
  REQUIRED_ACCOUNTS,
  CROSS_USER_ACCOUNT,
  OPTIONAL_ACCOUNTS,
};
