// HOW PEOPLE SIGN IN TO THIS BUNDLE -- the single compile-time seam for the EOS-only sign-in build (Firebase exit B2).
//
// config/environments.json decides what an environment MAY do (`authSources`); the build asks (VITE_AUTH_SOURCE=eos); the
// resolver (scripts/resolveEnvironment.mjs) refuses unless the registry allows it, and then injects __APP_AUTH_SOURCE__ and
// NO Firebase config. So a bundle that says "eos" here has no Firebase identity to initialise at all.
//
//   false  Firebase sign-in, exactly as before. Production is ALWAYS this: a production-role bundle can never be EOS-only,
//          whatever the define says (checked here as well as in the resolver -- two independent refusals).
//   true   EOS is the SOLE sign-in. AuthContext never subscribes to Firebase auth, the API clients never ask Firebase for
//          a token, firebase/firebase.js initialises nothing, and EOS human login is on without any other variable.
//
// There is deliberately NO runtime override. A test injects the choice through the argument.
import { appEnvironmentRole } from "../config/environmentRole.js";

function buildValue() {
  try {
    // eslint-disable-next-line no-undef
    return typeof __APP_AUTH_SOURCE__ === "string" ? __APP_AUTH_SOURCE__ : "firebase";
  } catch {
    return "firebase";
  }
}

export function resolveEosAuthOnly({ source = buildValue(), role = appEnvironmentRole() } = {}) {
  return source === "eos" && role !== "production" && role !== null;
}

export const EOS_AUTH_ONLY = resolveEosAuthOnly();
