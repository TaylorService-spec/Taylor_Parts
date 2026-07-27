// AUTH-PR-3 -- Auth-emulator OBSERVATION for the round-5/6 safety discussion:
// after generating a LATER password-reset link for a user, the EARLIER code
// remains LISTED (outstanding) in the Auth emulator's project-scoped oobCodes
// list -- i.e. a later generation does not REMOVE the earlier already-delivered
// code from the emulator's outstanding set.
//
// SCOPE / LIMITS: this test demonstrates list persistence (non-removal) ONLY.
// It does NOT call accounts:resetPassword, does NOT consume the earlier code,
// and does NOT prove the earlier code is end-to-end CONSUMABLE after a later
// generation. End-to-end consumability against real Firebase Auth is a
// production-enablement condition (see docs/audits/auth-pr-3-oob-validity/), not
// something asserted here.
//
// Uses the AUTH emulator + Admin SDK generatePasswordResetLink (the real link
// generator) and the project-scoped /emulator/v1/projects/{project}/oobCodes
// list (no ambiguous API key; robust across firebase-tools versions).
// Sanitized: OOB codes / links / emails are never printed. Emulator-only.
//
// Run:
//   firebase emulators:exec --only auth --project taylor-parts \
//     "node functions/test/adminCredentialResetLinkValidity.test.mjs"
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

import assert from "node:assert/strict";
import admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";

const PROJECT = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "demo-authpr3";
admin.initializeApp({ projectId: PROJECT });
const auth = getAuth();
const EMU = "http://127.0.0.1:9099";

let passed = 0;
async function okAsync(name, fn) { await fn(); passed += 1; console.log("PASS -- " + name); }

const oob = (link) => new URL(link).searchParams.get("oobCode");
async function listOobCodes() {
  const res = await fetch(`${EMU}/emulator/v1/projects/${PROJECT}/oobCodes`);
  const body = await res.json();
  return body.oobCodes || [];
}

await okAsync("both earlier and later reset codes remain LISTED (outstanding) in the Auth emulator after a later generation", async () => {
  const email = `linkvalidity_${Date.now()}@example.com`;
  await auth.createUser({ email, password: "Passw0rd!23" });

  const earlier = oob(await auth.generatePasswordResetLink(email));
  const later = oob(await auth.generatePasswordResetLink(email));
  assert.notStrictEqual(earlier, later, "each generation yields a distinct OOB code");

  // Project-scoped list membership (no ambiguous API key, version-robust): the
  // earlier code is NOT removed from the emulator's outstanding oobCodes set by
  // generating a later one. This demonstrates list persistence / non-removal --
  // NOT end-to-end consumability (see the header/evidence).
  const listed = new Set(
    (await listOobCodes()).filter((c) => c.requestType === "PASSWORD_RESET").map((c) => c.oobCode),
  );
  assert.ok(listed.has(earlier), "the EARLIER code must remain LISTED after a later generation");
  assert.ok(listed.has(later), "the later code is LISTED too");
});

console.log(`\n${passed} passed`);
process.exit(0);
