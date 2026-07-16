// Enterprise Access & Administration Platform (Issue #226) -- production
// foundation verification. Fixed by docs/specifications/enterprise-
// access-and-administration-platform.md sec21 (V1, S1, S3, S4, S5) and
// sequenced by docs/implementation-plans/enterprise-access-and-
// administration-platform.md (Row 21 / Task 26).
//
// WHAT THIS SCRIPT IS: the Row 21 verification tool, prepared and tested
// against the emulator NOW so it is ready to run against the real
// deployed project the moment Row 20 (deployment) happens -- but this
// script itself deploys nothing, uses no production credentials by
// default, and performs no enforcement cutover. It is read-only against
// pre-existing production data; the only writes it ever makes are to
// its OWN dedicated, clearly-`verify-`-prefixed fixtures, which it
// deletes in a `finally` block regardless of pass/fail (fail-closed
// cleanup) -- EXCEPT the Audit Events its own verification calls
// generate, which are deliberately left in place: Spec sec14/S5 requires
// Audit Events to be append-only/immutable, and a verification run does
// not get an exemption from the same guarantee the whole system
// provides. Every verification-run Audit Event's `actorUid`/`targetId`
// carries the `verify-` prefix, so it is trivially distinguishable from
// real production audit history in any later review.
//
// Criteria verified (Spec sec21):
//   S1 -- fail-closed on missing/stale/malformed access data (all DENY)
//   S3 -- claims contain only the four permitted fields, never detailed
//         permission/Scope/Condition data
//   S4 -- separation-of-duty: self-approval and single-actor privileged
//         grant are rejected server-side
//   S5 -- Audit Events are immutable (a client-direct write attempt to
//         an existing Audit Event is denied by firestore.rules) and
//         secret-free (no raw token/credential ever appears in one)
//   V1 -- the six trusted Functions are deployed (appear in
//         `firebase functions:list`) and enforce authentication over the
//         real network (an unauthenticated raw HTTPS call is rejected);
//         the Firestore Rules Regression suite passes
//
// Follows this repo's established operator-script conventions (see
// operatorAccessCommand.js): --projectId required (no default),
// --confirmProduction exact-match gate for production, --ownerAuthorization
// exact-phrase gate, dry-run default (--execute required to create/
// exercise/clean up any fixture), write-ahead/recovery via a local,
// 0o600-mode result file, no credential discovery/logging.
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { execFileSync } = require("child_process");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const PRODUCTION_PROJECT_ID = "taylor-parts";
const OWNER_AUTHORIZATION_PHRASE = "I CONFIRM OWNER AUTHORIZATION FOR THIS ACCESS CHANGE";
const DEFAULT_RESULT_DIR = ".production-verification-results";
const REGION = "us-central1";
const CALLABLE_NAMES = [
  "grantRole",
  "revokeRole",
  "assignApprovedRole",
  "setUserStatus",
  "approveAccessRequest",
  "rejectAccessRequest",
];

function parseArgs(argv) {
  const args = {};
  const BOOLEAN_FLAGS = new Set(["execute"]);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const flag = token.slice(2);
    if (BOOLEAN_FLAGS.has(flag)) {
      args[flag] = true;
      continue;
    }
    args[flag] = argv[i + 1];
    i += 1;
  }
  return args;
}

function assertProjectTarget(args) {
  if (!args.projectId) {
    throw new Error(
      "--projectId is required (no default target -- e.g. --projectId taylor-parts, or a non-production id for testing)."
    );
  }
  if (args.projectId === PRODUCTION_PROJECT_ID && args.confirmProduction !== PRODUCTION_PROJECT_ID) {
    throw new Error(
      `--projectId "${PRODUCTION_PROJECT_ID}" targets the production project -- this requires an explicit, ` +
        `matching --confirmProduction ${PRODUCTION_PROJECT_ID} flag as a deliberate, per-run confirmation. ` +
        `Use a different --projectId for emulator/non-production testing to skip this requirement.`
    );
  }
  return args.projectId;
}

function assertOwnerAuthorized(args) {
  if (args.ownerAuthorization !== OWNER_AUTHORIZATION_PHRASE) {
    throw new Error(
      `--ownerAuthorization must exactly match the required confirmation phrase: "${OWNER_AUTHORIZATION_PHRASE}"`
    );
  }
}

function verifyRunId() {
  return `verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function resultFilePath(resultDir, runId) {
  const safeName = `${runId}.json`;
  if (!/^[A-Za-z0-9_-]+\.json$/.test(safeName)) {
    throw new Error("internal: unsafe result file name");
  }
  return path.join(resultDir, safeName);
}

function writeResult(resultDir, runId, record) {
  fs.mkdirSync(resultDir, { recursive: true });
  const filePath = resultFilePath(resultDir, runId);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), { mode: 0o600 });
  return filePath;
}

// A raw, unauthenticated HTTPS POST to a deployed v2 callable Function's
// public URL. Proves (V1) the function is actually deployed and reachable,
// and that it rejects a call with NO Authorization header -- the real
// network-level enforcement, not just the unit-level `request.auth` check
// already covered by accessCommandCallables.test.js.
function checkUnauthenticatedRejection(projectId, functionName) {
  return new Promise((resolve, reject) => {
    const hostname = `${REGION}-${projectId}.cloudfunctions.net`;
    const body = JSON.stringify({ data: {} });
    const req = https.request(
      {
        hostname,
        path: `/${functionName}`,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: 10000,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          resolve({ statusCode: res.statusCode, body: raw });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error(`timeout reaching ${hostname}/${functionName}`)));
    req.write(body);
    req.end();
  });
}

function checkFunctionsDeployed(projectId) {
  // `firebase functions:list` output is used only to confirm the six
  // names are present -- never logged verbatim (it can include internal
  // deployment metadata), only a boolean-per-name result.
  const raw = execFileSync(
    "firebase",
    ["functions:list", "--project", projectId, "--json"],
    { encoding: "utf8", timeout: 30000 },
  );
  const parsed = JSON.parse(raw);
  const deployedNames = new Set((parsed.result || []).map((fn) => fn.id || fn.name));
  return CALLABLE_NAMES.reduce((acc, name) => {
    acc[name] = [...deployedNames].some((deployed) => deployed.includes(name));
    return acc;
  }, {});
}

// Raw HTTP(S) JSON POST/PATCH -- used by the two helpers below, which
// must exercise the real CLIENT-authenticated network path (Firestore
// REST API with a real end-user ID token), never the Admin SDK, which
// unconditionally BYPASSES Firestore Security Rules regardless of
// environment. Testing "a client-direct write is denied" via the Admin
// SDK would always vacuously pass no-matter-what -- exactly the defect
// an earlier version of this file had, caught before merge.
function jsonRequest(urlString, method, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === "https:" ? https : http;
    const payload = body ? JSON.stringify(body) : undefined;
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
        timeout: 10000,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let parsed;
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            parsed = { raw };
          }
          resolve({ statusCode: res.statusCode, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error(`timeout reaching ${urlString}`)));
    if (payload) req.write(payload);
    req.end();
  });
}

// Exchanges an Admin-SDK-minted custom token for a real end-user ID
// token, via the SAME Auth REST endpoint a real client app uses --
// against the Auth emulator when FIREBASE_AUTH_EMULATOR_HOST is set
// (any string works as the API key there), or real Identity Toolkit
// otherwise (requires a real, PUBLIC Web API key -- never a secret --
// passed via --webApiKey for an eventual real run; this script is not
// run against real production yet).
async function getIdTokenForUid(uid, webApiKey) {
  const { getAuth: getAuthFresh } = require("firebase-admin/auth");
  const customToken = await getAuthFresh().createCustomToken(uid);
  const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const base = emulatorHost
    ? `http://${emulatorHost}/identitytoolkit.googleapis.com/v1`
    : "https://identitytoolkit.googleapis.com/v1";
  const key = emulatorHost ? "fake-api-key" : webApiKey;
  if (!key) throw new Error("--webApiKey is required when not running against the Auth emulator");
  const result = await jsonRequest(`${base}/accounts:signInWithCustomToken?key=${key}`, "POST", {
    token: customToken,
    returnSecureToken: true,
  });
  if (!result.body.idToken) {
    throw new Error(`could not obtain an ID token (status ${result.statusCode})`);
  }
  return result.body.idToken;
}

// A genuine client-authenticated attempt to write an existing document,
// via the real Firestore REST API (Rules-enforced for any non-Admin-SDK
// caller) -- never the Admin SDK. Returns { denied: boolean, statusCode }.
async function attemptClientDirectWrite(projectId, idToken, collectionPath, docId, fieldName, fieldValue) {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  const base = emulatorHost
    ? `http://${emulatorHost}/v1`
    : "https://firestore.googleapis.com/v1";
  const url =
    `${base}/projects/${projectId}/databases/(default)/documents/${collectionPath}/${docId}` +
    `?updateMask.fieldPaths=${fieldName}`;
  const result = await jsonRequestWithAuth(url, "PATCH", { fields: { [fieldName]: { stringValue: fieldValue } } }, idToken);
  const succeeded = result.statusCode >= 200 && result.statusCode < 300;
  return { denied: result.statusCode === 403 || result.statusCode === 401, succeeded, statusCode: result.statusCode };
}

function jsonRequestWithAuth(urlString, method, body, idToken) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === "https:" ? https : http;
    const payload = JSON.stringify(body);
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Authorization: `Bearer ${idToken}`,
        },
        timeout: 10000,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode, body: raw }));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error(`timeout reaching ${urlString}`)));
    req.write(payload);
    req.end();
  });
}

async function runVerification({ projectId, execute, runId, webApiKey }) {
  const findings = {};
  const createdAuthUids = [];
  const createdRoleAssignmentIds = [];

  const db = getFirestore();
  const auth = getAuth();

  try {
    // --- V1a: the six Functions are deployed ---
    try {
      findings.functionsDeployed = checkFunctionsDeployed(projectId);
    } catch (err) {
      findings.functionsDeployed = { error: "could not query deployed Functions -- see local CLI output" };
    }

    // --- V1b: each rejects an unauthenticated raw HTTPS call ---
    findings.unauthenticatedRejection = {};
    for (const name of CALLABLE_NAMES) {
      try {
        const result = await checkUnauthenticatedRejection(projectId, name);
        findings.unauthenticatedRejection[name] = {
          rejected: result.statusCode === 401 || result.statusCode === 403 || result.statusCode >= 400,
          statusCode: result.statusCode,
        };
      } catch (err) {
        findings.unauthenticatedRejection[name] = { error: "network check failed", message: err.message };
      }
    }

    if (!execute) {
      findings.note = "Dry run -- no dedicated fixtures were created. Re-run with --execute for S1/S3/S4/S5.";
      return findings;
    }

    // --- Dedicated fixtures (verify- prefixed, deleted in `finally`) ---
    const actorUid = `${runId}-actor`;
    const principalUid = `${runId}-principal`;
    const approverUid = `${runId}-approver`;
    await auth.createUser({ uid: actorUid });
    await auth.createUser({ uid: principalUid });
    await auth.createUser({ uid: approverUid });
    createdAuthUids.push(actorUid, principalUid, approverUid);

    async function seedAssignment(uid, roleId, overrides = {}) {
      const id = `${runId}-assignment-${uid}`;
      await db.collection("roleAssignments").doc(id).set({
        principalUid: uid,
        roleId,
        scope: { type: "global" },
        grantedBy: "production-verification",
        grantedAt: require("firebase-admin/firestore").Timestamp.now(),
        status: "active",
        accessVersionAtGrant: 0,
        ...overrides,
      });
      createdRoleAssignmentIds.push(id);
      return id;
    }

    // S1: fail-closed on missing access data -- a principal with NO
    // assignment at all must be denied by a real grantRole call.
    // instanceof, never `.name` -- these classes never override .name
    // (`class Foo extends Error {}` leaves err.name === "Error" on the
    // prototype chain), matching accessCommandCallables.ts's own mapping.
    const commands = require("../lib/access/trustedWriterCommands.js");
    const { grantRole } = commands;
    try {
      await grantRole({
        actorUid: `${runId}-actor-no-assignment`,
        principalUid,
        roleId: "technician",
        scope: { type: "global" },
        idempotencyKey: `${runId}-s1-missing`,
      });
      findings.s1FailClosedMissing = { pass: false, reason: "expected denial, got success" };
    } catch (err) {
      findings.s1FailClosedMissing = { pass: err instanceof commands.UnauthorizedActorError };
    }

    // S1: fail-closed on stale access data -- accessVersionAtGrant
    // greater than the actor's current accessVersion (impossible under a
    // correctly-operating writer) must be denied.
    await seedAssignment(actorUid, "admin", { accessVersionAtGrant: 5 });
    try {
      await grantRole({
        actorUid,
        principalUid,
        roleId: "technician",
        scope: { type: "global" },
        idempotencyKey: `${runId}-s1-stale`,
      });
      findings.s1FailClosedStale = { pass: false, reason: "expected denial, got success" };
    } catch (err) {
      findings.s1FailClosedStale = { pass: err instanceof commands.UnauthorizedActorError };
    }

    // Re-seed the actor with a CONSISTENT assignment for the remaining checks.
    await db.collection("roleAssignments").doc(`${runId}-assignment-${actorUid}`).set(
      { accessVersionAtGrant: 0 },
      { merge: true },
    );

    // S4: separation-of-duty -- self-elevation (actor grants themselves
    // the privileged admin Role) must be denied.
    try {
      await grantRole({
        actorUid,
        principalUid: actorUid,
        roleId: "admin",
        scope: { type: "global" },
        idempotencyKey: `${runId}-s4-self`,
      });
      findings.s4SelfElevation = { pass: false, reason: "expected denial, got success" };
    } catch (err) {
      findings.s4SelfElevation = { pass: err instanceof commands.SelfApprovalError };
    }

    // S4: a privileged grant with an approver who is NOT independently
    // privileged must be denied.
    await seedAssignment(approverUid, "technician");
    try {
      await grantRole({
        actorUid,
        principalUid,
        roleId: "admin",
        scope: { type: "global" },
        approverUid,
        idempotencyKey: `${runId}-s4-approver`,
      });
      findings.s4NonPrivilegedApprover = { pass: false, reason: "expected denial, got success" };
    } catch (err) {
      findings.s4NonPrivilegedApprover = { pass: err instanceof commands.InsufficientApproverAuthorityError };
    }

    // S3: a real, successful grant's resulting claims contain ONLY the
    // four permitted fields.
    const grantIdempotencyKey = `${runId}-s3-grant`;
    await grantRole({
      actorUid,
      principalUid,
      roleId: "technician",
      scope: { type: "global" },
      idempotencyKey: grantIdempotencyKey,
    });
    const principalRecord = await auth.getUser(principalUid);
    const claimKeys = Object.keys(principalRecord.customClaims || {}).sort();
    const permittedKeys = new Set(["accessVersion", "companyId", "platformAdmin", "companyAdmin"]);
    findings.s3ClaimsShape = {
      pass: claimKeys.every((k) => permittedKeys.has(k)),
      actualKeys: claimKeys,
    };

    // S5: Audit Events are immutable -- a client-direct write attempt to
    // the just-created Audit Event must be denied by firestore.rules
    // (proves Rules are actually deployed and enforcing, not merely
    // present in source). Uses a REAL client-authenticated ID token via
    // the Firestore REST API -- the Admin SDK always bypasses Rules
    // regardless of environment, so it can never test this property
    // (an earlier version of this check used the Admin SDK and always
    // passed vacuously; caught and fixed before merge).
    try {
      const actorIdToken = await getIdTokenForUid(actorUid, webApiKey);
      const writeAttempt = await attemptClientDirectWrite(
        projectId,
        actorIdToken,
        "auditEvents",
        grantIdempotencyKey,
        "outcome",
        "tampered",
      );
      findings.s5AuditImmutable = writeAttempt.denied
        ? { pass: true }
        : {
            pass: false,
            reason: writeAttempt.succeeded
              ? `client-direct write to an Audit Event SUCCEEDED (status ${writeAttempt.statusCode})`
              : `expected a 401/403 denial, got an unexpected non-2xx/non-40x response (status ${writeAttempt.statusCode})`,
          };
    } catch (err) {
      findings.s5AuditImmutable = { pass: false, reason: "could not complete the check", message: err.message };
    }

    // S5: Audit Events are secret-free -- spot-check the just-created
    // event for anything resembling a raw token/credential.
    const auditSnap = await db.collection("auditEvents").doc(grantIdempotencyKey).get();
    const auditJson = JSON.stringify(auditSnap.data() || {});
    findings.s5AuditSecretFree = {
      pass: !/eyJ[A-Za-z0-9_-]{10,}|AIza[0-9A-Za-z_-]{20,}/.test(auditJson),
    };

    // --- V1c: Rules Regression suite ---
    // Deliberately NOT run as a subprocess here: rulesRegressionRunner.mjs
    // starts and owns its OWN emulator instance for the duration of its
    // run, which collides with the live Firestore+Auth emulator this
    // script's own S1/S3/S4/S5 checks are already connected to (the
    // exact cross-process emulator collision this session hit once
    // already with an unrelated PR). Run it as a separate, standalone
    // step -- see docs/deployment/enterprise-access-production-
    // verification-plan.md -- either immediately before or after this
    // script, never concurrently with it.
    findings.rulesRegression = {
      note: "Not run by this script -- run `node scripts/rulesRegressionRunner.mjs` as a separate step (see the production verification plan doc for why).",
    };

    return findings;
  } finally {
    // Fail-closed cleanup: every dedicated fixture is removed regardless
    // of whether the checks above passed, failed, or threw. Audit Events
    // are DELIBERATELY NOT deleted here -- see this file's header.
    for (const id of createdRoleAssignmentIds) {
      await db.collection("roleAssignments").doc(id).delete().catch(() => {});
    }
    for (const uid of createdAuthUids) {
      await auth.deleteUser(uid).catch(() => {});
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = assertProjectTarget(args);
  assertOwnerAuthorized(args);

  initializeApp({ projectId });

  const runId = verifyRunId();
  const resultDir = args.resultDir || DEFAULT_RESULT_DIR;
  let record = { runId, projectId, execute: !!args.execute, status: "running", startedAt: new Date().toISOString() };
  writeResult(resultDir, runId, record);

  try {
    const findings = await runVerification({ projectId, execute: !!args.execute, runId, webApiKey: args.webApiKey });
    record = { ...record, status: "completed", findings, completedAt: new Date().toISOString() };
    writeResult(resultDir, runId, record);
    console.log(JSON.stringify(findings, null, 2));
    const allPass = Object.values(findings).every(
      (v) => v === undefined || typeof v !== "object" || v.pass !== false,
    );
    process.exitCode = allPass ? 0 : 1;
  } catch (err) {
    record = { ...record, status: "failed", error: err.message, completedAt: new Date().toISOString() };
    writeResult(resultDir, runId, record);
    console.error("Verification run failed:", err.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  assertProjectTarget,
  assertOwnerAuthorized,
  checkUnauthenticatedRejection,
  checkFunctionsDeployed,
  runVerification,
  OWNER_AUTHORIZATION_PHRASE,
  CALLABLE_NAMES,
};
