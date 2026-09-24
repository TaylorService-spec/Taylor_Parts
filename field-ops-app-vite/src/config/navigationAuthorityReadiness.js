// WHICH SOURCE DECIDES NAVIGATION IN THIS ENVIRONMENT -- the single, compile-time seam.
//
// false  navigation is decided exactly as it always was: ROLE_NAV_ACCESS[users/{uid}.role],
//        employees/{id}.operationalRoles, and the Firestore accessVersion capability feed. Nothing
//        about the running product changes, and the EOS transport is never called.
//
// true   navigation is decided by the EOS principal experience context
//        (POST /operations/experience -> functions/src/eosOps/experienceAuthority.ts). The legacy
//        branches are NOT consulted at all -- not as a fallback, not on failure, not on an empty
//        answer. When the EOS source cannot answer, the honest result is a visible refusal, never a
//        quiet degrade to `users/{uid}.role`. That degrade is the defect this seam exists to remove,
//        and reintroducing it as a safety net would reintroduce the defect as a feature.
//
// FALSE IN EVERY ENVIRONMENT TODAY, production included and production fenced. Flipping it is not
// activation on its own: VITE_EOS_API_BASE_URL must also be configured for the environment, the
// personas must hold governed Security Roles, and the surfaces they need must be earnable from the
// catalog. Those preconditions are stated in the Lane V report, not assumed here.
//
// THE FIRST OF THOSE PRECONDITIONS IS MET IN NON-PRODUCTION, and was already met before it was
// listed (Wave 7 / Lane AD). VITE_EOS_API_BASE_URL is set in the Vercel non-production project and
// Vite inlines `https://eos-api-nonprod.onrender.com` into that bundle; the address is recorded in
// config/environments.json as `platform-sandbox.eosApi` and pinned by
// scripts/eosApiEnvironmentContract.test.mjs. It is deliberately NOT met in production, where the
// registry declares `eosApi: null`.
//
// KNOWING WHERE THE API IS CHANGES NOTHING HERE. With the base URL configured and this flag false,
// no experience request is made at all -- proved, with the real variable set, in
// test/operationsExperienceTransport.test.jsx. The two are separate switches and only the Owner
// throws the second one.
//
// Resolved from the ONE environment registry (config/environments.json) via vite.config.js, exactly
// like every other readiness flag; scripts/resolveEnvironment.mjs lists the key as REQUIRED, so an
// environment that omits it is a build error rather than a silent default.
//
// There is deliberately NO runtime override seam and no query-string escape hatch. A test that needs
// the other branch injects the authority value directly through the existing `operationalContext`
// argument, which introduces no production-importable bypass.
export const EOS_NAVIGATION_AUTHORITY_READY = __APP_READINESS__.EOS_NAVIGATION_AUTHORITY_READY;
