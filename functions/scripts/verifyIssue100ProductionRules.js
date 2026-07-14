// Issue #100 (docs/specifications/inventory-nav-access-alignment.md,
// docs/implementation-plans/inventory-nav-access-alignment.md) --
// combined authenticated production verification for Gates 4 (PR 1a),
// 7 (PR 2a), and 10 (PR 3a). OPERATOR-RUN ONLY. This script requires
// real production credentials for the dedicated PARTS_MANAGER/
// WAREHOUSE_MANAGER/PARTS_ASSOCIATE/admin test accounts and an Admin
// SDK service account with production Firestore access -- neither is
// ever searched for, generated, or defaulted by this script. It is not
// invoked by Claude Code; it is committed so an operator (a human, or
// a CI job holding real secrets) can run it, and so its logic can be
// proven correct against the local emulator (see
// functions/test/verifyIssue100ProductionRules.test.js) without ever
// touching production.
//
// SCOPE:
//   - PARTS_MANAGER: Queue / assigned-work oversight / Relevant
//     History / shared inventory_transactions reads; the merged
//     Assign-write branch (isAdminOrDispatcher() ||
//     isActiveOperationalRole("PARTS_MANAGER")).
//   - WAREHOUSE_MANAGER: shared inventory_transactions read;
//     inventory_actions read.
//   - PARTS_ASSOCIATE: self-scoped reorder_requests/reorder_purchase_
//     orders/reorder_purchase_order_voids reads; all four assignee-
//     restricted lifecycle writes (Start Purchasing, Post Purchasing
//     Update, Record PO, Mark Received).
//   - Approve/Reject/Cancel/Void remain denied to all three
//     operational roles; cross-user denials for PARTS_ASSOCIATE.
//   - Broken/inactive/ineligible/non-reciprocal linkage fail closed
//     (each independently optional -- supplied credentials only).
//   - admin/dispatcher regression (existing reads unaffected).
//
// SAFETY MODEL:
//   - Refuses to run at all unless every required environment variable
//     in REQUIRED_ENV is present, FIREBASE_PROJECT_ID is exactly
//     "taylor-parts", and PRODUCTION_DATA_AUTHORIZED is exactly "YES"
//     -- all three independently required; missing any one aborts
//     before any network call.
//   - Every write attempt in this script -- whether EXPECTED to
//     succeed (the five real lifecycle/assign mutations) or EXPECTED
//     to be denied (every Approve/Reject/Cancel/Void/cross-user
//     attempt) -- is preceded by an Admin-SDK snapshot of every
//     document that write could touch, and followed, in a `finally`
//     block, by an unconditional check: if the post-attempt state
//     differs from the snapshot at all, the exact pre-attempt state is
//     restored via the Admin SDK (which bypasses Rules, since the
//     document may now be in a state no Rules-respecting write can
//     reverse), then re-read and deep-compared to PROVE exact
//     restoration. A restoration that does not verify byte-for-byte
//     exits with a DISTINCT exit code (3) from an ordinary check
//     failure (1), so an operator/CI system can tell "a check failed"
//     apart from "production data may be in a bad state" at a glance.
//   - The Admin SDK credential (GOOGLE_APPLICATION_CREDENTIALS) is
//     used ONLY for: (a) the pre-write snapshot read, and (b) the
//     restore-and-reverify path if a mutation is ever detected. Every
//     PASS/FAIL classification itself is performed with the real,
//     signed-in test accounts' own ID tokens against the real deployed
//     Rules -- never the Admin SDK bypass.
//   - Every REQUIRED account (PARTS_MANAGER/WAREHOUSE_MANAGER/
//     PARTS_ASSOCIATE/ADMIN) is resolved, via the SAME User ->
//     reciprocal Employee linkage firestore.rules itself requires
//     (users/{uid}.employeeId -> employees/{employeeId}.userId == uid),
//     to its human Employee displayName. A role-authenticated account
//     that cannot resolve to a human name is NOT an acceptable
//     verification outcome -- the run aborts (exit code 2) before any
//     read/write check is attempted. Each resolved account is reported
//     as "RESOLVED -- <ROLE> -- <Name>". The deliberately-broken/
//     inactive/ineligible/non-reciprocal optional linkage probes are
//     exempt from this -- their entire purpose is to exercise a linkage
//     that may not resolve, so they are reported with a safe scenario
//     label ("RESOLVED -- BROKEN_LINKAGE fixture account
//     authenticated"), never a resolved name or any identifier.
//   - Never prints an email, password, ID token, service-account path
//     or content, uid, Employee ID, document ID, or any other document
//     field value. The ONLY document field this script ever surfaces is
//     a resolved Employee displayName for a required account, by
//     design (see above). Output is otherwise limited to: role/scenario
//     labels, PASS/FAIL/SKIP per named check, a final count, restoration
//     status, and exit code.
//   - Creates nothing. Every fixture document this script exercises
//     must already exist, supplied by the operator via the fixture-ID
//     environment variables below -- this script errors out rather
//     than fabricate one if a required read returns 404 unexpectedly
//     for reasons other than the specific check under test. (The single
//     unavoidable exception is inherent to the Record PO check itself,
//     which -- like the real production action it verifies -- creates a
//     reorder_purchase_orders document as part of a real, Rules-
//     enforced write; this is immediately reverted and byte-for-byte
//     re-verified by the same snapshot/restore path every other
//     mutating check uses, per the safety rule above.)
//
// USAGE:
//   All credentials and fixture identifiers are supplied ONLY via
//   environment variables -- never CLI arguments (which can leak into
//   shell history/process lists), never hardcoded. See "Required
//   environment variables" in the accompanying PR description / this
//   file's own REQUIRED_ENV list below.
//
//   cd functions
//   node scripts/verifyIssue100ProductionRules.js
//
// Exit codes:
//   0  -- every required check (and every supplied optional check)
//         passed, no mutation ever detected (or every detected
//         mutation was cleanly restored and verified).
//   1  -- one or more checks failed (a real Rules-behavior mismatch),
//         but no restoration failure occurred.
//   2  -- a required prerequisite was missing: either an env var,
//         project guard, or production-data authorization (aborted
//         before any network call), OR a required account (PARTS_
//         MANAGER/WAREHOUSE_MANAGER/PARTS_ASSOCIATE/ADMIN) could not be
//         resolved to a human display name via User -> reciprocal
//         Employee linkage (aborted after sign-in, before any
//         read/write check).
//   3  -- a write attempt mutated production data and the subsequent
//         restore could NOT be verified byte-for-byte. Requires
//         immediate manual operator intervention. Always takes
//         precedence over exit code 1 if both would otherwise apply.
"use strict";

const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const REQUIRED_PROJECT_ID = "taylor-parts";

// Each of these four accounts must ALSO have a reciprocally-linked
// Employee document (users/{uid}.employeeId -> employees/{employeeId}.
// userId == uid) with a non-empty displayName -- required so this
// script can resolve and report a human name for every one of them
// (see resolveDisplayName()/NameResolutionError below). This applies
// to the ADMIN fixture too, even though isAdminOrDispatcher() itself
// has no Employee-linkage requirement -- an Employee record must still
// be provisioned for the dedicated admin test account specifically so
// it can be named in this script's output.
const REQUIRED_ACCOUNT_ENV = [
  "PARTS_MANAGER_EMAIL", "PARTS_MANAGER_PASSWORD",
  "WAREHOUSE_MANAGER_EMAIL", "WAREHOUSE_MANAGER_PASSWORD",
  "PARTS_ASSOCIATE_EMAIL", "PARTS_ASSOCIATE_PASSWORD",
  "ADMIN_EMAIL", "ADMIN_PASSWORD",
];

const REQUIRED_FIXTURE_ENV = [
  "PM_QUEUE_DOC_ID",              // reorder_requests, READY_FOR_PARTS_MANAGER
  "PENDING_REVIEW_DOC_ID",        // reorder_requests, PENDING_REVIEW
  "PM_OVERSIGHT_DOC_ID",          // reorder_requests, ASSIGNED_TO_PARTS_ASSOCIATE or PURCHASING_IN_PROGRESS, assigned to a DIFFERENT uid than the PARTS_ASSOCIATE fixture; also cancel-eligible
  "PM_HISTORY_DOC_ID",            // reorder_requests, terminal, reviewedBy or assignedBy == the PARTS_MANAGER fixture's own uid
  "INVENTORY_TXN_DOC_ID",         // inventory_transactions, any document
  "INVENTORY_ACTIONS_DOC_ID",     // inventory_actions, any document
  "PA_ASSIGNED_DOC_ID",           // reorder_requests, ASSIGNED_TO_PARTS_ASSOCIATE, assignedToUserId == the PARTS_ASSOCIATE fixture's own uid
  "PA_PURCHASING_DOC_ID",         // reorder_requests, PURCHASING_IN_PROGRESS, assignedToUserId == the PARTS_ASSOCIATE fixture's own uid
  "PA_RECORD_PO_DOC_ID",          // reorder_requests, PURCHASING_IN_PROGRESS, assignedToUserId == the PARTS_ASSOCIATE fixture, with NO existing linked reorder_purchase_orders document
  "PA_RECEIVE_DOC_ID",            // reorder_requests, ORDERED, assignedToUserId == the PARTS_ASSOCIATE fixture, purchaseOrderId set to its own id, with an existing linked reorder_purchase_orders document already ORDERED
  "PA_VOID_RECORD_DOC_ID",        // reorder_requests, VOIDED, assignedToUserId == the PARTS_ASSOCIATE fixture, with an existing linked reorder_purchase_order_voids document
  "PA_OTHER_USER_DOC_ID",         // reorder_requests, ASSIGNED_TO_PARTS_ASSOCIATE, assignedToUserId == a DIFFERENT Parts Associate (not the PARTS_ASSOCIATE fixture)
];

// Independently optional -- each pair runs its own denial check ONLY
// if BOTH members are present. Never fabricated if absent.
const OPTIONAL_ACCOUNT_ENV_PAIRS = [
  ["BROKEN_LINKAGE_EMAIL", "BROKEN_LINKAGE_PASSWORD"],
  ["INACTIVE_LINKAGE_EMAIL", "INACTIVE_LINKAGE_PASSWORD"],
  ["INELIGIBLE_EMAIL", "INELIGIBLE_PASSWORD"],
  ["NONRECIPROCAL_EMAIL", "NONRECIPROCAL_PASSWORD"],
];

// Injectable REST endpoints -- default to real production hosts.
// functions/test/verifyIssue100ProductionRules.test.js overrides both
// via explicit parameters (never via these env vars) to point the
// exact same check logic at a local emulator instead. This file's own
// CLI entry point (main(), guarded below) never reads these override
// env vars -- production is always the CLI's literal, non-overridable
// target.
const DEFAULT_FIRESTORE_REST_BASE = "https://firestore.googleapis.com/v1";
const DEFAULT_IDENTITY_TOOLKIT_BASE = "https://identitytoolkit.googleapis.com/v1";

function checkPrerequisites(env) {
  const missingAccounts = REQUIRED_ACCOUNT_ENV.filter((k) => !env[k]);
  const missingFixtures = REQUIRED_FIXTURE_ENV.filter((k) => !env[k]);
  const missing = [
    ...(!env.FIREBASE_PROJECT_ID ? ["FIREBASE_PROJECT_ID"] : []),
    ...(!env.PRODUCTION_DATA_AUTHORIZED ? ["PRODUCTION_DATA_AUTHORIZED"] : []),
    ...(!env.FIREBASE_WEB_API_KEY ? ["FIREBASE_WEB_API_KEY"] : []),
    ...(!env.GOOGLE_APPLICATION_CREDENTIALS ? ["GOOGLE_APPLICATION_CREDENTIALS"] : []),
    ...missingAccounts,
    ...missingFixtures,
  ];
  if (missing.length > 0) {
    return { ok: false, reason: `missing required environment variable(s): ${missing.join(", ")}` };
  }
  if (env.FIREBASE_PROJECT_ID !== REQUIRED_PROJECT_ID) {
    return { ok: false, reason: `project guard: FIREBASE_PROJECT_ID must be exactly "${REQUIRED_PROJECT_ID}"` };
  }
  if (env.PRODUCTION_DATA_AUTHORIZED !== "YES") {
    return { ok: false, reason: `production-data guard: PRODUCTION_DATA_AUTHORIZED must be exactly "YES" (explicit, per-run Owner authorization)` };
  }
  return { ok: true };
}

function resolveOptionalPairs(env) {
  const present = [];
  const skipped = [];
  for (const [emailKey, passKey] of OPTIONAL_ACCOUNT_ENV_PAIRS) {
    const label = emailKey.replace("_EMAIL", "");
    if (env[emailKey] && env[passKey]) present.push(label);
    else skipped.push(label);
  }
  return { present, skipped };
}

async function signIn(identityToolkitBase, apiKey, email, password) {
  const res = await fetch(`${identityToolkitBase}/accounts:signInWithPassword?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json();
  if (!body.idToken) {
    throw new Error("Sign-in failed for a supplied account (no credential/detail logged).");
  }
  return body.idToken;
}

// Decodes the `user_id` claim from a Firebase ID token's own payload
// (base64url JSON, no signature verification needed -- this script
// already trusts a token it just received directly from Firebase
// Auth's own signInWithPassword response). Used ONLY to populate
// Rules-required self-referential fields (assignedBy ==
// request.auth.uid, purchasingStartedBy, orderedBy, etc.) with the
// caller's OWN real uid -- never logged, never printed, never
// returned to any report() call.
function decodeUidFromIdToken(idToken) {
  const payload = idToken.split(".")[1];
  const json = Buffer.from(payload, "base64url").toString("utf8");
  const claims = JSON.parse(json);
  return claims.user_id || claims.sub;
}

// Resolves a signed-in account's own uid to its human Employee display
// name via the SAME reciprocal linkage firestore.rules' own
// reciprocallyLinkedEmployee()/isActiveOperationalRole() require:
// users/{uid}.employeeId -> employees/{employeeId}.userId == uid, both
// directions. Uses the Admin SDK (bypasses Rules, same as the
// snapshot/restore path) purely to READ the two documents needed to
// resolve a name -- never to establish authorization, which is always
// decided by the real signed-in token against the real deployed Rules
// elsewhere in this file. Returns the displayName string, or null if
// the account is unsigned-in-linkable (no employeeId, no Employee
// document, a broken/non-reciprocal link, or a missing/empty
// displayName) -- deliberately the SAME "cannot resolve" outcome for
// every failure mode, since the caller's response (abort, for a
// required account) does not depend on which sub-check failed. Never
// logs, prints, or returns anything but the display name itself or
// null -- the caller is responsible for only ever surfacing the name,
// not the uid/employeeId this function reads along the way.
async function resolveDisplayName(adminDb, uid) {
  const userSnap = await adminDb.collection("users").doc(uid).get();
  if (!userSnap.exists) return null;
  const employeeId = userSnap.data().employeeId;
  if (!employeeId) return null;
  const employeeSnap = await adminDb.collection("employees").doc(employeeId).get();
  if (!employeeSnap.exists) return null;
  const employee = employeeSnap.data();
  if (employee.userId !== uid) return null; // reciprocal check, mirrors firestore.rules exactly
  return employee.displayName || null;
}

// Thrown when a REQUIRED account (PARTS_MANAGER/WAREHOUSE_MANAGER/
// PARTS_ASSOCIATE/ADMIN) cannot resolve to a human display name.
// Deliberately distinct from an ordinary check failure -- main()
// treats this the same as a missing prerequisite (exit code 2),
// aborting before any read/write check or mutation is attempted,
// because role-only success (an authenticated token with no resolvable
// human identity behind it) is not an acceptable verification outcome
// for this script. The message never includes the uid/employeeId that
// failed to resolve -- only the role label, which is not a secret.
class NameResolutionError extends Error {}

async function getDocStatus(firestoreRestBase, projectId, collection, docId, idToken) {
  const headers = idToken ? { Authorization: `Bearer ${idToken}` } : {};
  const res = await fetch(`${firestoreRestBase}/projects/${projectId}/databases/(default)/documents/${collection}/${docId}`, { headers });
  return res.status;
}

async function updateDocStatus(firestoreRestBase, projectId, collection, docId, idToken, fields, updateMaskFields) {
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` };
  const mask = updateMaskFields.map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const res = await fetch(`${firestoreRestBase}/projects/${projectId}/databases/(default)/documents/${collection}/${docId}?${mask}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });
  return res.status;
}

async function commitStatus(firestoreRestBase, projectId, idToken, writes) {
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` };
  const res = await fetch(`${firestoreRestBase}/projects/${projectId}/databases/(default)/documents:commit`, {
    method: "POST",
    headers,
    body: JSON.stringify({ writes }),
  });
  return res.status;
}

// ---------------------------------------------------------------
// Snapshot / restore -- Admin SDK only, used exclusively for the
// pre-write snapshot and the guarded post-write restore. `refs` is an
// array of { collection, docId } -- Record PO's atomic commit touches
// TWO documents (the reorder_requests doc AND the reorder_purchase_
// orders doc it may create), so this accepts multiple refs uniformly
// rather than special-casing single- vs multi-document writes.
// ---------------------------------------------------------------
async function snapshotDocs(adminDb, refs) {
  const snapshots = [];
  for (const { collection, docId } of refs) {
    const snap = await adminDb.collection(collection).doc(docId).get();
    snapshots.push({ collection, docId, existed: snap.exists, data: snap.exists ? snap.data() : null });
  }
  return snapshots;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Returns { mutated: boolean, restored: boolean|null }. restored is
// null when mutated is false (nothing to restore). Never throws for a
// mismatch -- the caller decides how to report/exit; it DOES throw if
// the Admin SDK itself fails, since that is a genuine operational
// error distinct from a restoration mismatch.
async function restoreIfMutated(adminDb, snapshotsBefore) {
  const after = await snapshotDocs(
    adminDb,
    snapshotsBefore.map(({ collection, docId }) => ({ collection, docId }))
  );

  const anyChanged = snapshotsBefore.some((before, i) => {
    const post = after[i];
    return before.existed !== post.existed || !deepEqual(before.data, post.data);
  });

  if (!anyChanged) {
    return { mutated: false, restored: null };
  }

  for (const before of snapshotsBefore) {
    const ref = adminDb.collection(before.collection).doc(before.docId);
    if (before.existed) {
      await ref.set(before.data, { merge: false });
    } else {
      await ref.delete();
    }
  }

  const verified = await snapshotDocs(
    adminDb,
    snapshotsBefore.map(({ collection, docId }) => ({ collection, docId }))
  );
  const exactMatch = snapshotsBefore.every((before, i) => {
    const post = verified[i];
    return before.existed === post.existed && deepEqual(before.data, post.data);
  });

  return { mutated: true, restored: exactMatch };
}

// ---------------------------------------------------------------
// The check runner. Each entry names the check, whether it's a read
// or a write, and the expected outcome. Reads never mutate, so they
// need no snapshot/restore. Every write entry -- expected-allowed OR
// expected-denied -- gets the full snapshot/attempt/restore-if-
// mutated treatment uniformly.
// ---------------------------------------------------------------
function makeReporter() {
  let passed = 0;
  let failed = 0;
  let restorationFailures = 0;
  const results = [];
  function report(name, ok, detail) {
    if (ok) passed += 1;
    else failed += 1;
    results.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"} -- ${name}${detail ? ` (${detail})` : ""}`);
  }
  function skip(name, reason) {
    results.push({ name, ok: null, detail: reason });
    console.log(`SKIP -- ${name} (${reason})`);
  }
  function restoration(name, outcome) {
    if (outcome.mutated === false) {
      console.log(`RESTORATION -- ${name}: not required (no mutation detected).`);
      return;
    }
    if (outcome.restored === true) {
      console.log(`RESTORATION -- ${name}: mutation detected and successfully reverted; verified byte-for-byte.`);
      // A mutation happening at all is itself noteworthy for a
      // should-be-denied check -- counted as a failure of that check
      // even though the data was cleanly restored.
    } else {
      console.error(`RESTORATION -- ${name}: FAILED. Mutation detected but the restored state does NOT match the pre-write snapshot. Manual operator intervention required immediately.`);
      restorationFailures += 1;
    }
  }
  return {
    report, skip, restoration,
    get passed() { return passed; },
    get failed() { return failed; },
    get restorationFailures() { return restorationFailures; },
    get results() { return results; },
  };
}

// ---------------------------------------------------------------
// Runs the complete combined Gate 4 + 7 + 10 check suite against the
// given endpoints/project/credentials. Pure with respect to the
// network -- every host is an explicit parameter, never a hardcoded
// production URL -- so this exact function is reused unchanged by
// both the production CLI entry point (main(), below) and the
// emulator test suite.
// ---------------------------------------------------------------
async function runChecks({ firestoreRestBase, identityToolkitBase, projectId, adminDb, env }) {
  const r = makeReporter();
  const now = Date.now();

  const tokens = {};
  for (const [label, emailKey, passKey] of [
    ["PARTS_MANAGER", "PARTS_MANAGER_EMAIL", "PARTS_MANAGER_PASSWORD"],
    ["WAREHOUSE_MANAGER", "WAREHOUSE_MANAGER_EMAIL", "WAREHOUSE_MANAGER_PASSWORD"],
    ["PARTS_ASSOCIATE", "PARTS_ASSOCIATE_EMAIL", "PARTS_ASSOCIATE_PASSWORD"],
    ["ADMIN", "ADMIN_EMAIL", "ADMIN_PASSWORD"],
  ]) {
    tokens[label] = await signIn(identityToolkitBase, env.FIREBASE_WEB_API_KEY, env[emailKey], env[passKey]);
  }

  // Decoded to populate Rules-required self-referential write fields
  // (assignedBy == request.auth.uid, purchasingStartedBy, orderedBy,
  // receivedBy) with each account's own real uid, AND to resolve each
  // required account's human display name below -- the uid itself is
  // never logged, never printed, never included in any report() call.
  const uids = {};
  for (const label of Object.keys(tokens)) uids[label] = decodeUidFromIdToken(tokens[label]);

  // Every REQUIRED account (PARTS_MANAGER/WAREHOUSE_MANAGER/
  // PARTS_ASSOCIATE/ADMIN) must resolve, via User -> reciprocal
  // Employee linkage, to a human display name -- an authenticated
  // token with no resolvable human identity behind it is not an
  // acceptable verification outcome ("role-only success"). Aborts
  // before any read/write check runs; never logs the uid/employeeId
  // that failed to resolve, only the role label.
  const names = {};
  for (const label of Object.keys(tokens)) {
    const name = await resolveDisplayName(adminDb, uids[label]);
    if (!name) {
      throw new NameResolutionError(
        `Required account ${label} could not be resolved to a human display name via User -> reciprocal Employee ` +
          `linkage (no identifier logged) -- aborting before any check runs.`
      );
    }
    names[label] = name;
    console.log(`RESOLVED -- ${label} -- ${name}`);
  }

  const optional = {};
  const { present, skipped } = resolveOptionalPairs(env);
  for (const label of skipped) r.skip(`${label} linkage check`, "fixture credentials not supplied");
  for (const label of present) {
    optional[label] = await signIn(identityToolkitBase, env.FIREBASE_WEB_API_KEY, env[`${label}_EMAIL`], env[`${label}_PASSWORD`]);
    console.log(`RESOLVED -- ${label} fixture account authenticated.`);
  }

  const get = (collection, docId, role) => getDocStatus(firestoreRestBase, projectId, collection, docId, tokens[role] ?? optional[role]);

  // === PARTS_MANAGER: allowed reads ===
  r.report("PARTS_MANAGER: Parts Manager Queue read", (await get("reorder_requests", env.PM_QUEUE_DOC_ID, "PARTS_MANAGER")) === 200);
  r.report("PARTS_MANAGER: assigned-work oversight read", (await get("reorder_requests", env.PM_OVERSIGHT_DOC_ID, "PARTS_MANAGER")) === 200);
  r.report("PARTS_MANAGER: Relevant History read", (await get("reorder_requests", env.PM_HISTORY_DOC_ID, "PARTS_MANAGER")) === 200);
  r.report("PARTS_MANAGER: shared inventory_transactions read", (await get("inventory_transactions", env.INVENTORY_TXN_DOC_ID, "PARTS_MANAGER")) === 200);

  // === WAREHOUSE_MANAGER: allowed reads ===
  r.report("WAREHOUSE_MANAGER: shared inventory_transactions read", (await get("inventory_transactions", env.INVENTORY_TXN_DOC_ID, "WAREHOUSE_MANAGER")) === 200);
  r.report("WAREHOUSE_MANAGER: inventory_actions read", (await get("inventory_actions", env.INVENTORY_ACTIONS_DOC_ID, "WAREHOUSE_MANAGER")) === 200);

  // === PARTS_ASSOCIATE: allowed self-scoped reads ===
  r.report("PARTS_ASSOCIATE: own assigned request read", (await get("reorder_requests", env.PA_ASSIGNED_DOC_ID, "PARTS_ASSOCIATE")) === 200);
  r.report("PARTS_ASSOCIATE: own reorder_purchase_orders read", (await get("reorder_purchase_orders", env.PA_RECEIVE_DOC_ID, "PARTS_ASSOCIATE")) === 200);
  r.report("PARTS_ASSOCIATE: own reorder_purchase_order_voids read", (await get("reorder_purchase_order_voids", env.PA_VOID_RECORD_DOC_ID, "PARTS_ASSOCIATE")) === 200);

  // === Cross-user / cross-role denials (read-only, no mutation) ===
  r.report("WAREHOUSE_MANAGER: denied Parts Manager Queue", (await get("reorder_requests", env.PM_QUEUE_DOC_ID, "WAREHOUSE_MANAGER")) === 403);
  r.report("WAREHOUSE_MANAGER: denied assigned-work oversight", (await get("reorder_requests", env.PM_OVERSIGHT_DOC_ID, "WAREHOUSE_MANAGER")) === 403);
  r.report("WAREHOUSE_MANAGER: denied Relevant History", (await get("reorder_requests", env.PM_HISTORY_DOC_ID, "WAREHOUSE_MANAGER")) === 403);
  r.report("WAREHOUSE_MANAGER: denied PARTS_ASSOCIATE personal read", (await get("reorder_requests", env.PA_ASSIGNED_DOC_ID, "WAREHOUSE_MANAGER")) === 403);
  r.report("WAREHOUSE_MANAGER: denied reorder_purchase_orders", (await get("reorder_purchase_orders", env.PA_RECEIVE_DOC_ID, "WAREHOUSE_MANAGER")) === 403);
  r.report("PARTS_MANAGER: denied inventory_actions", (await get("inventory_actions", env.INVENTORY_ACTIONS_DOC_ID, "PARTS_MANAGER")) === 403);
  r.report("PARTS_ASSOCIATE: denied inventory_actions", (await get("inventory_actions", env.INVENTORY_ACTIONS_DOC_ID, "PARTS_ASSOCIATE")) === 403);
  r.report("PARTS_ASSOCIATE: denied the Parts Manager Queue", (await get("reorder_requests", env.PM_QUEUE_DOC_ID, "PARTS_ASSOCIATE")) === 403);
  r.report("PARTS_ASSOCIATE: denied Relevant History", (await get("reorder_requests", env.PM_HISTORY_DOC_ID, "PARTS_ASSOCIATE")) === 403);
  r.report("PARTS_ASSOCIATE: denied shared inventory_transactions", (await get("inventory_transactions", env.INVENTORY_TXN_DOC_ID, "PARTS_ASSOCIATE")) === 403);
  r.report("PARTS_ASSOCIATE: denied a DIFFERENT Parts Associate's assigned request", (await get("reorder_requests", env.PA_OTHER_USER_DOC_ID, "PARTS_ASSOCIATE")) === 403);

  // === admin/dispatcher regression -- read-only, proves the base
  // isAdminOrDispatcher() grant is unaffected by every additive branch
  // above (write regression is proven indirectly: every mutating check
  // below uses the SAME restructured allow-update statement admin
  // writes also depend on; a broken shared clause would surface there
  // too). ===
  r.report("ADMIN: reads the Parts Manager Queue (regression)", (await get("reorder_requests", env.PM_QUEUE_DOC_ID, "ADMIN")) === 200);
  r.report("ADMIN: reads assigned-work oversight (regression)", (await get("reorder_requests", env.PM_OVERSIGHT_DOC_ID, "ADMIN")) === 200);
  r.report("ADMIN: reads inventory_transactions (regression)", (await get("inventory_transactions", env.INVENTORY_TXN_DOC_ID, "ADMIN")) === 200);
  r.report("ADMIN: reads inventory_actions (regression)", (await get("inventory_actions", env.INVENTORY_ACTIONS_DOC_ID, "ADMIN")) === 200);

  // === Fail-closed linkage (optional, read-only) ===
  for (const label of present) {
    r.report(`${label}: denied the Parts Manager Queue`, (await get("reorder_requests", env.PM_QUEUE_DOC_ID, label)) === 403);
  }

  // === Guarded write: PARTS_MANAGER Assign (expected 200) ===
  {
    const refs = [{ collection: "reorder_requests", docId: env.PM_QUEUE_DOC_ID }];
    const before = await snapshotDocs(adminDb, refs);
    let status;
    try {
      status = await updateDocStatus(firestoreRestBase, projectId, "reorder_requests", env.PM_QUEUE_DOC_ID, tokens.PARTS_MANAGER, {
        status: { stringValue: "ASSIGNED_TO_PARTS_ASSOCIATE" },
        currentOwner: { stringValue: "PARTS_ASSOCIATE" },
        // Rules require assignedToUserId to be a non-empty string --
        // the PARTS_ASSOCIATE fixture's own uid is a real, valid
        // assignment target. assignedBy must equal the caller's own
        // uid (request.auth.uid) -- never an arbitrary string.
        assignedToUserId: { stringValue: uids.PARTS_ASSOCIATE },
        assignedBy: { stringValue: uids.PARTS_MANAGER },
        assignedAt: { integerValue: String(now) },
      }, ["status", "currentOwner", "assignedToUserId", "assignedBy", "assignedAt"]);
    } finally {
      const outcome = await restoreIfMutated(adminDb, before);
      r.restoration("PARTS_MANAGER Assign", outcome);
    }
    r.report("PARTS_MANAGER: Assign write succeeds (merged branch)", status === 200, `status ${status}`);
  }

  // === Guarded writes expected DENIED: Approve, Reject (PM/WM/PA), Cancel (PM/WM/PA on PM_OVERSIGHT_DOC_ID), Void-attempt is covered implicitly by PA never gaining it -- Cancel/Void write attempts below ===
  const pendingReviewApproveFields = {
    status: { stringValue: "READY_FOR_PARTS_MANAGER" },
    reviewDecision: { stringValue: "APPROVED" },
    currentOwner: { stringValue: "PARTS_MANAGER" },
  };
  const pendingReviewRejectFields = {
    status: { stringValue: "REJECTED" },
    reviewDecision: { stringValue: "REJECTED" },
    reviewNotes: { stringValue: "verify-issue-100-production-rules-probe" },
    currentOwner: { stringValue: "INVENTORY" },
  };
  for (const [label, roleKey] of [["PARTS_MANAGER", "PARTS_MANAGER"], ["WAREHOUSE_MANAGER", "WAREHOUSE_MANAGER"], ["PARTS_ASSOCIATE", "PARTS_ASSOCIATE"]]) {
    for (const [action, fields, mask] of [
      ["Approve", pendingReviewApproveFields, ["status", "reviewDecision", "currentOwner"]],
      ["Reject", pendingReviewRejectFields, ["status", "reviewDecision", "reviewNotes", "currentOwner"]],
    ]) {
      const refs = [{ collection: "reorder_requests", docId: env.PENDING_REVIEW_DOC_ID }];
      const before = await snapshotDocs(adminDb, refs);
      let status;
      try {
        status = await updateDocStatus(firestoreRestBase, projectId, "reorder_requests", env.PENDING_REVIEW_DOC_ID, tokens[roleKey], fields, mask);
      } finally {
        const outcome = await restoreIfMutated(adminDb, before);
        r.restoration(`${label} ${action}-attempt`, outcome);
      }
      r.report(`${label} cannot ${action} -- remains admin/dispatcher-only`, status === 403, `status ${status}`);
    }
  }

  for (const [label, roleKey] of [["PARTS_MANAGER", "PARTS_MANAGER"], ["WAREHOUSE_MANAGER", "WAREHOUSE_MANAGER"], ["PARTS_ASSOCIATE", "PARTS_ASSOCIATE"]]) {
    const refs = [{ collection: "reorder_requests", docId: env.PM_OVERSIGHT_DOC_ID }];
    const before = await snapshotDocs(adminDb, refs);
    let status;
    try {
      status = await updateDocStatus(firestoreRestBase, projectId, "reorder_requests", env.PM_OVERSIGHT_DOC_ID, tokens[roleKey], {
        status: { stringValue: "CANCELLED" },
        cancelledBy: { stringValue: "verify-issue-100-production-rules-probe" },
        cancelledAt: { integerValue: String(now) },
        cancellationReason: { stringValue: "verify-issue-100-production-rules-probe" },
      }, ["status", "cancelledBy", "cancelledAt", "cancellationReason"]);
    } finally {
      const outcome = await restoreIfMutated(adminDb, before);
      r.restoration(`${label} Cancel-attempt`, outcome);
    }
    r.report(`${label} cannot Cancel -- remains admin/dispatcher-only`, status === 403, `status ${status}`);
  }

  // PARTS_ASSOCIATE Void-attempt (never gains it, even as the correct
  // assignee) -- probed on its own RECEIVE fixture's linked void-record
  // collection via an atomic commit shape (mirrors the real Void write).
  {
    const refs = [
      { collection: "reorder_requests", docId: env.PA_RECEIVE_DOC_ID },
      { collection: "reorder_purchase_order_voids", docId: env.PA_RECEIVE_DOC_ID },
    ];
    const before = await snapshotDocs(adminDb, refs);
    let status;
    try {
      status = await commitStatus(firestoreRestBase, projectId, tokens.PARTS_ASSOCIATE, [
        {
          update: {
            name: `projects/${projectId}/databases/(default)/documents/reorder_requests/${env.PA_RECEIVE_DOC_ID}`,
            fields: {
              status: { stringValue: "VOIDED" },
              voidedBy: { stringValue: "verify-issue-100-production-rules-probe" },
              voidedAt: { integerValue: String(now) },
              voidReason: { stringValue: "verify-issue-100-production-rules-probe" },
            },
          },
          updateMask: { fieldPaths: ["status", "voidedBy", "voidedAt", "voidReason"] },
        },
        {
          update: {
            name: `projects/${projectId}/databases/(default)/documents/reorder_purchase_order_voids/${env.PA_RECEIVE_DOC_ID}`,
            fields: {
              reorderPurchaseOrderId: { stringValue: env.PA_RECEIVE_DOC_ID },
              reorderRequestId: { stringValue: env.PA_RECEIVE_DOC_ID },
              partId: { stringValue: before[0].data?.partId ?? "" },
              voidedBy: { stringValue: "verify-issue-100-production-rules-probe" },
              reason: { stringValue: "verify-issue-100-production-rules-probe" },
              createdAt: { integerValue: String(now) },
            },
          },
        },
      ]);
    } finally {
      const outcome = await restoreIfMutated(adminDb, before);
      r.restoration("PARTS_ASSOCIATE Void-attempt", outcome);
    }
    r.report("PARTS_ASSOCIATE cannot Void -- never gains it, even as the correct assignee", status === 403, `status ${status}`);
  }

  // === Guarded writes expected ALLOWED: the four PARTS_ASSOCIATE lifecycle transitions ===

  // Start Purchasing.
  {
    const refs = [{ collection: "reorder_requests", docId: env.PA_ASSIGNED_DOC_ID }];
    const before = await snapshotDocs(adminDb, refs);
    let status;
    try {
      status = await updateDocStatus(firestoreRestBase, projectId, "reorder_requests", env.PA_ASSIGNED_DOC_ID, tokens.PARTS_ASSOCIATE, {
        status: { stringValue: "PURCHASING_IN_PROGRESS" },
        purchasingStartedBy: { stringValue: before[0].data?.assignedToUserId ?? "" },
        purchasingStartedAt: { integerValue: String(now) },
      }, ["status", "purchasingStartedBy", "purchasingStartedAt"]);
    } finally {
      const outcome = await restoreIfMutated(adminDb, before);
      r.restoration("PARTS_ASSOCIATE Start Purchasing", outcome);
    }
    r.report("PARTS_ASSOCIATE: Start Purchasing succeeds (own assigned request)", status === 200, `status ${status}`);
  }

  // A different Parts Associate attempting Start Purchasing on
  // PA_OTHER_USER_DOC_ID is expected DENIED.
  {
    const refs = [{ collection: "reorder_requests", docId: env.PA_OTHER_USER_DOC_ID }];
    const before = await snapshotDocs(adminDb, refs);
    let status;
    try {
      status = await updateDocStatus(firestoreRestBase, projectId, "reorder_requests", env.PA_OTHER_USER_DOC_ID, tokens.PARTS_ASSOCIATE, {
        status: { stringValue: "PURCHASING_IN_PROGRESS" },
        purchasingStartedBy: { stringValue: "verify-issue-100-production-rules-probe" },
        purchasingStartedAt: { integerValue: String(now) },
      }, ["status", "purchasingStartedBy", "purchasingStartedAt"]);
    } finally {
      const outcome = await restoreIfMutated(adminDb, before);
      r.restoration("PARTS_ASSOCIATE Start Purchasing (cross-user attempt)", outcome);
    }
    r.report("PARTS_ASSOCIATE cannot Start Purchasing on another Associate's request", status === 403, `status ${status}`);
  }

  // Post Purchasing Update.
  {
    const refs = [{ collection: "reorder_requests", docId: env.PA_PURCHASING_DOC_ID }];
    const before = await snapshotDocs(adminDb, refs);
    let status;
    try {
      status = await updateDocStatus(firestoreRestBase, projectId, "reorder_requests", env.PA_PURCHASING_DOC_ID, tokens.PARTS_ASSOCIATE, {
        purchasingNotes: { stringValue: "verify-issue-100-production-rules-probe" },
        vendorContacted: { stringValue: "verify-issue-100-production-rules-probe" },
        expectedAvailabilityDate: { stringValue: "2099-01-01" },
        lastPurchasingUpdateAt: { integerValue: String(now) },
        lastPurchasingUpdateBy: { stringValue: before[0].data?.assignedToUserId ?? "" },
      }, ["purchasingNotes", "vendorContacted", "expectedAvailabilityDate", "lastPurchasingUpdateAt", "lastPurchasingUpdateBy"]);
    } finally {
      const outcome = await restoreIfMutated(adminDb, before);
      r.restoration("PARTS_ASSOCIATE Post Purchasing Update", outcome);
    }
    r.report("PARTS_ASSOCIATE: Post Purchasing Update succeeds (own assigned request)", status === 200, `status ${status}`);
  }

  // Record PO -- atomic two-document commit; the ONLY check that can
  // create a document. Restore, if triggered, deletes the created
  // reorder_purchase_orders document (it did not exist before) and
  // reverts reorder_requests to its exact pre-write snapshot.
  {
    const refs = [
      { collection: "reorder_requests", docId: env.PA_RECORD_PO_DOC_ID },
      { collection: "reorder_purchase_orders", docId: env.PA_RECORD_PO_DOC_ID },
    ];
    const before = await snapshotDocs(adminDb, refs);
    let status;
    try {
      status = await commitStatus(firestoreRestBase, projectId, tokens.PARTS_ASSOCIATE, [
        {
          update: {
            name: `projects/${projectId}/databases/(default)/documents/reorder_requests/${env.PA_RECORD_PO_DOC_ID}`,
            fields: {
              status: { stringValue: "ORDERED" },
              purchaseOrderId: { stringValue: env.PA_RECORD_PO_DOC_ID },
              orderedBy: { stringValue: before[0].data?.assignedToUserId ?? "" },
              orderedAt: { integerValue: String(now) },
            },
          },
          updateMask: { fieldPaths: ["status", "purchaseOrderId", "orderedBy", "orderedAt"] },
        },
        {
          update: {
            name: `projects/${projectId}/databases/(default)/documents/reorder_purchase_orders/${env.PA_RECORD_PO_DOC_ID}`,
            fields: {
              reorderRequestId: { stringValue: env.PA_RECORD_PO_DOC_ID },
              partId: { stringValue: before[0].data?.partId ?? "" },
              supplierName: { stringValue: "verify-issue-100-production-rules-probe" },
              externalPoNumber: { stringValue: "verify-issue-100-production-rules-probe" },
              orderedQuantity: { integerValue: "1" },
              orderedDate: { stringValue: "2026-01-01" },
              expectedArrivalDate: { nullValue: null },
              status: { stringValue: "ORDERED" },
              createdBy: { stringValue: before[0].data?.assignedToUserId ?? "" },
              createdAt: { integerValue: String(now) },
            },
          },
        },
      ]);
    } finally {
      const outcome = await restoreIfMutated(adminDb, before);
      r.restoration("PARTS_ASSOCIATE Record PO", outcome);
    }
    r.report("PARTS_ASSOCIATE: Record PO succeeds (atomic commit, own assigned request)", status === 200, `status ${status}`);
  }

  // Mark Received.
  {
    const refs = [{ collection: "reorder_requests", docId: env.PA_RECEIVE_DOC_ID }];
    const before = await snapshotDocs(adminDb, refs);
    let status;
    try {
      status = await updateDocStatus(firestoreRestBase, projectId, "reorder_requests", env.PA_RECEIVE_DOC_ID, tokens.PARTS_ASSOCIATE, {
        status: { stringValue: "RECEIVED" },
        receivedBy: { stringValue: before[0].data?.assignedToUserId ?? "" },
        receivedAt: { integerValue: String(now) },
      }, ["status", "receivedBy", "receivedAt"]);
    } finally {
      const outcome = await restoreIfMutated(adminDb, before);
      r.restoration("PARTS_ASSOCIATE Mark Received", outcome);
    }
    r.report("PARTS_ASSOCIATE: Mark Received succeeds (own assigned request)", status === 200, `status ${status}`);
  }

  return r;
}

function loadEnv() {
  return process.env;
}

async function main() {
  const env = loadEnv();
  const pre = checkPrerequisites(env);
  if (!pre.ok) {
    console.error(`FAIL -- ${pre.reason}`);
    process.exitCode = 2;
    return;
  }

  const projectId = env.FIREBASE_PROJECT_ID;
  initializeApp({ projectId });
  const adminDb = getFirestore();

  console.log(`Combined Gate 4 + 7 + 10 production verification -- project "${projectId}".\n`);

  let r;
  try {
    r = await runChecks({
      firestoreRestBase: DEFAULT_FIRESTORE_REST_BASE,
      identityToolkitBase: DEFAULT_IDENTITY_TOOLKIT_BASE,
      projectId,
      adminDb,
      env,
    });
  } catch (err) {
    if (err instanceof NameResolutionError) {
      // Safe to print verbatim -- this message is entirely under this
      // script's own control and never includes a uid/employeeId/email.
      console.error(`FAIL -- ${err.message}`);
    } else {
      console.error("Verification aborted with an unexpected error (no credential/detail logged).");
    }
    process.exitCode = 2;
    return;
  }

  const skipped = r.results.filter((x) => x.ok === null).length;
  console.log(`\n${r.passed} passed, ${r.failed} failed, ${skipped} skipped.`);
  if (r.restorationFailures > 0) {
    console.error(`\n${r.restorationFailures} RESTORATION FAILURE(S) -- manual operator intervention required immediately.`);
    process.exitCode = 3;
    return;
  }
  console.log(r.failed === 0 ? "\nGATES 4 + 7 + 10: PASS" : "\nGATES 4 + 7 + 10: FAIL");
  process.exitCode = r.failed > 0 ? 1 : 0;
}

if (require.main === module) {
  main();
}

module.exports = {
  checkPrerequisites,
  resolveOptionalPairs,
  signIn,
  decodeUidFromIdToken,
  resolveDisplayName,
  NameResolutionError,
  getDocStatus,
  updateDocStatus,
  commitStatus,
  snapshotDocs,
  restoreIfMutated,
  deepEqual,
  runChecks,
  makeReporter,
  REQUIRED_ACCOUNT_ENV,
  REQUIRED_FIXTURE_ENV,
  OPTIONAL_ACCOUNT_ENV_PAIRS,
  REQUIRED_PROJECT_ID,
};
