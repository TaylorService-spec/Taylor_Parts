// AUTH-PR-3 -- Auth-emulator proof for the round-5/6 safety contract: an EARLIER
// password-reset OOB code remains valid after a LATER generatePasswordResetLink()
// for the same user. This is what makes the extra link a stale worker may
// generate (after a >5min takeover) harmless: it does NOT invalidate the
// already-delivered reset link. Evidence: docs/audits/auth-pr-3-oob-validity/.
//
// Uses the AUTH emulator + Admin SDK generatePasswordResetLink (the real link
// generator). Validity is checked two project-safe ways (no ambiguous API key):
//  1. the project-scoped emulator oobCodes list still contains the earlier code
//     after the later generation (it was not invalidated/removed);
//  2. the earlier code can actually COMPLETE a password reset.
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

await okAsync("earlier reset OOB code stays valid after a later link generation (extra link is harmless)", async () => {
  const email = `linkvalidity_${Date.now()}@example.com`;
  await auth.createUser({ email, password: "Passw0rd!23" });

  const earlier = oob(await auth.generatePasswordResetLink(email));
  const later = oob(await auth.generatePasswordResetLink(email));
  assert.notStrictEqual(earlier, later, "each generation yields a distinct OOB code");

  // (1) Project-scoped: both codes are still outstanding after the later
  // generation -- the earlier was not invalidated/removed.
  const outstanding = new Set(
    (await listOobCodes()).filter((c) => c.requestType === "PASSWORD_RESET").map((c) => c.oobCode),
  );
  assert.ok(outstanding.has(earlier), "the EARLIER code must remain outstanding after a later generation");
  assert.ok(outstanding.has(later), "the later code is outstanding too");

  // (2) The earlier code can COMPLETE a password reset (fully usable, not just
  // listed). The emulator hosts a single project here, so this routes correctly.
  const res = await fetch(`${EMU}/identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=fake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oobCode: earlier, newPassword: "NewPassw0rd!45" }),
  });
  assert.ok(res.ok, `the earlier code must complete a password reset (status ${res.status})`);
});

console.log(`\n${passed} passed`);
process.exit(0);
