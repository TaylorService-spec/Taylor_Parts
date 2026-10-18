// Which environment this bundle was built for: { id, role, deployment } (config/environments.json via vite `define`).
//
// Lives apart from firebase/firebase.js so the sign-in screens can read it WITHOUT importing the Firebase module: an EOS-only
// sign-in build (Firebase exit B2) must be able to draw its sign-in page with firebase.js never evaluated.
export const APP_ENVIRONMENT = (() => {
  try {
    // eslint-disable-next-line no-undef
    return typeof __APP_ENVIRONMENT__ === "object" ? __APP_ENVIRONMENT__ : null;
  } catch {
    return null;
  }
})();
