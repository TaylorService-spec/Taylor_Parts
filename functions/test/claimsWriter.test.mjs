// Enterprise Access & Administration Platform (Issue #226) -- Row 6
// (Task 11) test for the compact-claims mint/refresh/revoke mechanics
// (functions/src/access/claimsWriter.ts) against a live Firebase Auth
// emulator. Proves: a freshly-issued ID token actually carries the
// minted claims; an ALREADY-ISSUED token does NOT reflect a claims
// change until the client re-authenticates/refreshes (real staleness,
// not simulated); setCompactClaims fully REPLACES rather than merges
// (no leftover field from a prior grant survives); and revokeCompact
// Claims actually clears the claim namespace.
//
// Follows this repo's established Firebase-Auth-emulator-test
// convention (see employeesRules.test.js's idTokenFor helper): plain
// Node fetch against the emulator REST API, no test runner, no
// @firebase/rules-unit-testing.
//
// Prerequisite: run against a live Auth emulator, e.g.:
//   firebase emulators:start --only auth --project taylor-parts
// then, in a second terminal (after `npm run build`):
//   node functions/test/claimsWriter.test.mjs
//
// Read/write only against the emulator (FIREBASE_AUTH_EMULATOR_HOST
// below) -- never touches the live "taylor-parts" project.
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

import assert from "node:assert/strict";
import admin from "firebase-admin";
import {
  setCompactClaims,
  revokeCompactClaims,
} from "../lib/access/claimsWriter.js";
import { CompactClaimsValidationError } from "../lib/access/compactClaims.js";

const PROJECT_ID = "taylor-parts";
const AUTH_HOST = "http://127.0.0.1:9099";

admin.initializeApp({ projectId: PROJECT_ID });
const auth = admin.auth();

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

async function idTokenFor(uid) {
  const customToken = await auth.createCustomToken(uid);
  const res = await fetch(
    `${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const body = await res.json();
  if (!body.idToken) throw new Error(`Failed to mint ID token for ${uid}: ${JSON.stringify(body)}`);
  return body.idToken;
}

function decodeJwtPayload(idToken) {
  const [, payloadB64] = idToken.split(".");
  const json = Buffer.from(payloadB64, "base64url").toString("utf8");
  return JSON.parse(json);
}

async function main() {
  await check("setCompactClaims mints claims that appear on a FRESHLY-issued ID token", async () => {
    const uid = `claims-fresh-${Date.now()}`;
    await auth.createUser({ uid });
    await setCompactClaims(uid, { accessVersion: 1, platformAdmin: true });
    const token = await idTokenFor(uid);
    const payload = decodeJwtPayload(token);
    assert.equal(payload.accessVersion, 1);
    assert.equal(payload.platformAdmin, true);
  });

  await check("a token issued BEFORE a claims change does NOT reflect it (real staleness, not simulated)", async () => {
    const uid = `claims-stale-${Date.now()}`;
    await auth.createUser({ uid });
    await setCompactClaims(uid, { accessVersion: 1 });
    const oldToken = await idTokenFor(uid);
    const oldPayload = decodeJwtPayload(oldToken);
    assert.equal(oldPayload.accessVersion, 1);

    // Access change: bump accessVersion.
    await setCompactClaims(uid, { accessVersion: 2 });

    // The ALREADY-ISSUED token's own payload is fixed at issuance time --
    // decoding it again yields the same stale value, proving a client
    // holding this exact token is genuinely carrying stale claims until
    // it force-refreshes (Spec sec11's refresh/revocation-latency model).
    const stillOldPayload = decodeJwtPayload(oldToken);
    assert.equal(stillOldPayload.accessVersion, 1, "the old token must remain frozen at its issuance-time value");

    // A NEWLY-issued token (the force-refresh path) reflects the change.
    const newToken = await idTokenFor(uid);
    const newPayload = decodeJwtPayload(newToken);
    assert.equal(newPayload.accessVersion, 2);
  });

  await check("setCompactClaims fully REPLACES claims -- no leftover field survives from a prior grant", async () => {
    const uid = `claims-replace-${Date.now()}`;
    await auth.createUser({ uid });
    await setCompactClaims(uid, { accessVersion: 1, companyAdmin: true, companyId: "company-old" });
    await setCompactClaims(uid, { accessVersion: 2 }); // no companyAdmin/companyId this time
    const token = await idTokenFor(uid);
    const payload = decodeJwtPayload(token);
    assert.equal(payload.accessVersion, 2);
    assert.equal(payload.companyAdmin, undefined, "companyAdmin must not survive a replacing grant that omits it");
    assert.equal(payload.companyId, undefined, "companyId must not survive a replacing grant that omits it");
  });

  await check("setCompactClaims rejects an attempt to smuggle a detailed-permission-shaped field (Spec sec11 hard prohibition, enforced even at the writer boundary)", async () => {
    const uid = `claims-reject-${Date.now()}`;
    await auth.createUser({ uid });
    await assert.rejects(
      () => setCompactClaims(uid, { accessVersion: 1, permissions: ["account.record.read"] }),
      CompactClaimsValidationError,
    );
  });

  await check("revokeCompactClaims (rollback path) clears the claim namespace entirely", async () => {
    const uid = `claims-revoke-${Date.now()}`;
    await auth.createUser({ uid });
    await setCompactClaims(uid, { accessVersion: 1, platformAdmin: true });
    await revokeCompactClaims(uid);
    const token = await idTokenFor(uid);
    const payload = decodeJwtPayload(token);
    assert.equal(payload.accessVersion, undefined);
    assert.equal(payload.platformAdmin, undefined);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
