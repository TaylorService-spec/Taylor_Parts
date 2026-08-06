import { initializeApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

// O-3 — Firebase identity is INJECTED from the one environment registry
// (config/environments.json) at build time via vite.config.js, not hard-coded
// here. Selecting a build target is `VITE_ENVIRONMENT_ID`; unset resolves to the
// registry's defaultEnvironmentId, which reproduces the previous production
// build exactly.
//
// Why this changed: the previous literal `projectId: "taylor-parts"` meant the
// application could not point anywhere except the customer's production project,
// which made a sandbox or preview environment impossible (finding S-1).
//
// PUBLIC, NOT SECRET: a Firebase Web apiKey is a project identifier, not a
// credential — access is enforced by Firestore Rules + Auth, not by hiding it.
// Real credentials never appear in client config or in the registry.
//
// FAILS CLOSED: the build throws on an unknown or unprovisioned environment, so
// this constant is always a complete, deliberate identity.
const firebaseConfig = __APP_FIREBASE_CONFIG__;

/** Which environment this bundle was built for: { id, role, deployment }. */
export const APP_ENVIRONMENT = __APP_ENVIRONMENT__;

const app = initializeApp({
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  storageBucket: firebaseConfig.storageBucket,
  messagingSenderId: firebaseConfig.messagingSenderId,
  appId: firebaseConfig.appId,
  ...(firebaseConfig.measurementId ? { measurementId: firebaseConfig.measurementId } : {}),
});
export const db = getFirestore(app);
export const auth = getAuth(app);
// Work Order Engine v1.2 (Epic 1): region must match functions/src's deploy
// region (onCall({ region: ... })). Now environment-resolved rather than a
// literal, so a future environment can deploy Functions elsewhere.
export const functions = getFunctions(app, firebaseConfig.functionsRegion);

// Local dev/agent-driven smoke testing only -- opt-in via ?emulator=1,
// same URL-param mode-switching pattern as config/env.js's ?env=demo.
// Gated on import.meta.env.DEV (ChatGPT architecture review on PR #93:
// a query param alone is reachable in a production build -- this
// branch must be unreachable there, not just off-by-default) so a
// production build has no path to this code at all, not merely a
// param that defaults to inactive. Never touches the live
// "taylor-parts" project in dev either, unless the param is present.
// See .claude/skills/run-field-ops-app-vite/ for the driver that uses
// this to sign in against the Firestore/Auth emulator without ever
// authenticating against production.
if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("emulator") === "1") {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  // Functions emulator (firebase.json: functions port 5001) so the Work Order
  // callables (createWorkOrder/transitionWorkOrder/updateWorkOrderExecutionData)
  // resolve against the local emulator in ?emulator=1 dev instead of production
  // -- same DEV-only, opt-in gate as Firestore/Auth above. Never active in a
  // production build or without the param.
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
