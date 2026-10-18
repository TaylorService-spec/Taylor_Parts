// THE FIREBASE MODULE'S STAND-IN FOR AN EOS-ONLY SIGN-IN BUILD (Firebase exit B2).
//
// vite.config.js aliases every import of `firebase/firebase` to THIS file when the build is EOS-only
// (`VITE_AUTH_SOURCE=eos`, allowed only by config/environments.json `authSources`). The real module is then never loaded,
// so nothing is initialised: no Firebase app, no Firestore, no Auth, no Functions, no request to any Google endpoint, and
// no Firebase config exists in the bundle to initialise them from.
//
// The handles are NULL. A screen whose batch has not migrated yet (B1 Financials, B3 Warehouse and receiving, B4 Records and
// reporting) therefore cannot reach Firebase, and fails through its existing error path or the route boundary
// (components/RouteErrorBoundary.jsx) -- recorded as "blocked by known unmigrated dependencies", never as working.
//
// The real firebase.js is deliberately left byte-for-byte as it was: it is the canonical transitional shim the Firebase-exit
// guards census, and a build that does not alias it behaves exactly as before.
export { APP_ENVIRONMENT } from "../config/appEnvironment.js";

export const db = null;
export const auth = null;
export const functions = null;
