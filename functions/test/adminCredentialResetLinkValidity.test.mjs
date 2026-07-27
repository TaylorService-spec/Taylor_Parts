// AUTH-PR-3 -- Auth-emulator proof for the round-5/6 safety contract: an EARLIER
// password-reset OOB code remains valid after a LATER generatePasswordResetLink()
// for the same user. This is what makes the extra link a stale worker may
// generate (after a >5min takeover) harmless: it does NOT invalidate the
// already-delivered reset link. Evidence: docs/audits/auth-pr-3-oob-validity/.
//
// Uses the AUTH emulator + Admin SDK generatePasswordResetLink (the real link
// generator), then verifies OOB codes via the emulator's Identity Toolkit REST.
// Sanitized: OOB codes / links / emails are never printed. Emulator-only.
//
// Run (after `npm run build` is not required -- this test has no lib import):
//   firebase emulators:exec --only auth --project taylor-parts \
//     "node functions/test/adminCredentialResetLinkValidity.test.mjs"
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

import assert from "node:assert/strict";
import admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-authpr3" });
const auth = getAuth();

let passed = 0;
async function okAsync(name, fn) { await fn(); passed += 1; console.log("PASS -- " + name); }

const oob = (link) => new URL(link).searchParams.get("oobCode");
async function resetPasswordCall(payload) {
  const res = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=fake",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
  );
  return { ok: res.ok, body: await res.json() };
}

await okAsync("earlier reset OOB code stays valid after a later link generation (extra link is harmless)", async () => {
  const email = `linkvalidity_${Date.now()}@example.com`;
  await auth.createUser({ email, password: "Passw0rd!23" });

  const oobEarlier = oob(await auth.generatePasswordResetLink(email));
  const oobLater = oob(await auth.generatePasswordResetLink(email));
  assert.notStrictEqual(oobEarlier, oobLater, "each generation yields a distinct OOB code");

  // Verify-only (no newPassword): a valid code returns its requestType.
  const vEarlier = await resetPasswordCall({ oobCode: oobEarlier });
  const vLater = await resetPasswordCall({ oobCode: oobLater });
  assert.ok(vEarlier.ok, "the EARLIER (already-delivered) code must remain valid after a later generation");
  assert.strictEqual(vEarlier.body.requestType, "PASSWORD_RESET");
  assert.ok(vLater.ok, "the later code is valid too");

  // The earlier code can actually COMPLETE a password reset (fully usable, not
  // merely verifiable).
  const completed = await resetPasswordCall({ oobCode: oobEarlier, newPassword: "NewPassw0rd!45" });
  assert.ok(completed.ok, "the earlier code completes a password reset");
});

console.log(`\n${passed} passed`);
process.exit(0);
