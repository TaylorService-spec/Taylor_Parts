// INV-CONVERGENCE-E Stage A completion -- build-time constant injected by Vite `define`
// (vite.config.js). Holds the deterministic application/build commit identifier used by
// the shadow-parity diagnostics reader bundle. When the build cannot resolve a real
// identifier it is defined as "unknown", which the pure core treats as
// BLOCKED_INCOMPLETE_INPUT (never a false PASS).
declare const __APP_COMMIT__: string;

// O-3 — build-time constants injected by Vite `define` from the one environment
// registry (config/environments.json). PUBLIC Firebase client configuration and
// environment identity only; never credentials.
declare const __APP_FIREBASE_CONFIG__: {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
  functionsRegion: string;
};
declare const __APP_ENVIRONMENT__: { id: string; role: string; deployment: string };
declare const __APP_READINESS__: Record<string, boolean>;

// Per-environment capability activation (spec 2026-08-14) — build-time array of
// spine capability ids this environment activates despite catalog active:false.
// [] in a production build (resolveEnvironment.mjs is role-keyed). Presentation-
// only UI preview input; never authoritative.
declare const __APP_CAPABILITY_ACTIVATION_OVERRIDES__: string[];
