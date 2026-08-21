// AUTHENTICATE A BROWSER AGAINST THE DEPLOYED SANDBOX WITHOUT TYPING A PASSWORD.
//
// The certification instruments sign in by filling the real Login.jsx form with a DRIVER_ACCOUNTS
// entry from seed.mjs. Those are `@example.test` accounts the EMULATOR seeds; they do not exist in
// the deployed sandbox, which has its own SANDBOX_PERSONAS. So the browser-driven gate steps could
// not authenticate against a deployed build at all.
//
// The obvious fix -- read a real sandbox password and fill it into the login form -- is the one
// thing this session will not do. So this takes the path the scanner scenarios already established
// and that the repo already governs: exchange the persona for an idToken through the Identity
// Toolkit REST endpoint (scripts/sandboxCredentials.mjs owns the file access; the password goes
// straight from that module into the request body and is never surfaced, logged, or typed), then
// seed the Firebase Auth SDK's own persistence record before the app boots.
//
// This is a standard test-session technique, not an auth bypass: the token is a REAL credential
// obtained through the REAL sign-in endpoint, and every downstream Rules and capability check sees
// exactly the principal it identifies. Nothing here weakens a gate; it only avoids a keystroke.
//
// Firebase Auth (web) persists the signed-in user in IndexedDB database `firebaseLocalStorageDb`,
// object store `firebaseLocalStorage`, under key `firebase:authUser:<apiKey>:[DEFAULT]`. Writing
// that record before the first app script runs is what makes onAuthStateChanged resolve to a signed
// -in user instead of null.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

export function sandboxFirebaseConfig(environmentId = "platform-sandbox") {
  const registry = JSON.parse(readFileSync(join(REPO_ROOT, "config", "environments.json"), "utf8"));
  // config/environments.json is { $comment, schema, ..., environments: [ {id, role, firebase} ] }.
  // An earlier version indexed the LIST by id and then tested Array.isArray on the WRAPPER, which
  // is an object -- so every lookup fell through to 'unknown environment'.
  const list = Array.isArray(registry.environments) ? registry.environments : [];
  const entry = list.find((e) => e.id === environmentId);
  if (!entry) throw new Error(`unknown environment '${environmentId}' in config/environments.json`);
  // FAIL CLOSED on anything that is not an explicitly non-production sandbox. A certification run
  // must never be able to point itself at production by mis-typing an environment id.
  if (entry.role === "production") throw new Error(`REFUSING: '${environmentId}' is role=production`);
  return entry.firebase;
}

export async function signInPersona(personaId, environmentId = "platform-sandbox") {
  // pathToFileURL, not a bare path: on Windows a dynamic import of "D:\..." is rejected outright
  // ("Only URLs with a scheme in: file, data, and node are supported").
  const { loadSandboxPersona } = await import(pathToFileURL(join(REPO_ROOT, "scripts", "sandboxCredentials.mjs")).href);
  const cfg = sandboxFirebaseConfig(environmentId);
  const { email, password } = loadSandboxPersona(personaId);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${cfg.apiKey}`,
    { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }) },
  );
  const body = await res.json();
  // Never echo the response wholesale -- it carries the refresh token.
  if (!res.ok || !body.idToken) throw new Error(`sign-in failed for ${personaId}: ${body?.error?.message ?? res.status}`);
  return { apiKey: cfg.apiKey, uid: body.localId, email: body.email, idToken: body.idToken,
           refreshToken: body.refreshToken, expiresIn: Number(body.expiresIn ?? 3600) };
}

/** Seed the SDK's persistence record so the app boots already signed in. Call BEFORE the first goto. */
export async function seedAuthenticatedSession(page, origin, session) {
  await page.goto(`${origin}/favicon.ico`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.evaluate(async (s) => {
    const record = {
      uid: s.uid, email: s.email, emailVerified: true, isAnonymous: false,
      providerData: [{ providerId: "password", uid: s.email, email: s.email }],
      stsTokenManager: {
        refreshToken: s.refreshToken, accessToken: s.idToken,
        expirationTime: Date.now() + s.expiresIn * 1000,
      },
      createdAt: String(Date.now()), lastLoginAt: String(Date.now()),
      apiKey: s.apiKey, appName: "[DEFAULT]",
    };
    await new Promise((resolve, reject) => {
      const open = indexedDB.open("firebaseLocalStorageDb", 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains("firebaseLocalStorage")) {
          open.result.createObjectStore("firebaseLocalStorage", { keyPath: "fbase_key" });
        }
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("firebaseLocalStorage", "readwrite");
        tx.objectStore("firebaseLocalStorage")
          .put({ fbase_key: `firebase:authUser:${s.apiKey}:[DEFAULT]`, value: record });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, session);
}

// The certification personas do not have the same KEYS in both environments, because they are not
// the same accounts: locally they are emulator seeds from seed.mjs, and in the sandbox they are
// governed accounts provisioned through provisionEmployeeAccess.js. This maps each local driver key
// to its closest governed sandbox equivalent, and says so rather than pretending they are identical.
//
//   technicianMultiRole  -> technician       (a technician holding operational roles)
//   ineligibleDispatcher -> dispatcher       (dispatcher security role)
//   eligiblePartsManager -> partsManager     (the parts-floor management persona)
//
// A key with no mapping is passed through unchanged, so a caller may name a sandbox persona directly.
export const LOCAL_TO_SANDBOX_PERSONA = Object.freeze({
  admin: "admin",
  technicianMultiRole: "technician",
  ineligibleDispatcher: "dispatcher",
  eligiblePartsManager: "partsManager",
});

/**
 * Establish an authenticated session for whichever target is in play.
 *
 * LOCAL keeps the real form login, deliberately: against the emulator that exercises Login.jsx
 * itself, which is a surface worth certifying and costs nothing to keep.
 *
 * DEPLOYED seeds the SDK's own persistence with a token obtained through the governed REST path --
 * no password is ever typed into a field. The emulator's `@example.test` accounts do not exist in
 * the sandbox, so the form path could not authenticate there at all.
 */
export async function establishSession(page, { BASE, IS_LOCAL, EMU, accountKey, driverAccounts }) {
  if (IS_LOCAL) {
    const acct = driverAccounts[accountKey];
    if (!acct) throw new Error(`unknown driver account '${accountKey}'`);
    await page.goto(`${BASE}/${EMU}`, { waitUntil: "networkidle" });
    await page.locator('input[type="email"]').fill(acct.email);
    await page.locator('input[type="password"]').fill(acct.password);
    await page.locator('button[type="submit"]').click();
  } else {
    const personaId = LOCAL_TO_SANDBOX_PERSONA[accountKey] ?? accountKey;
    const session = await signInPersona(personaId);
    const origin = new URL(BASE).origin;
    await seedAuthenticatedSession(page, origin, session);
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  }
  await page.locator(".fo-appheader, .fo-workspace, .fo-rail").first().waitFor({ timeout: 25000 });
}
