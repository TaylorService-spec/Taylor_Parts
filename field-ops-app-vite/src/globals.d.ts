// INV-CONVERGENCE-E Stage A completion -- build-time constant injected by Vite `define`
// (vite.config.js). Holds the deterministic application/build commit identifier used by
// the shadow-parity diagnostics reader bundle. When the build cannot resolve a real
// identifier it is defined as "unknown", which the pure core treats as
// BLOCKED_INCOMPLETE_INPUT (never a false PASS).
declare const __APP_COMMIT__: string;
