// WHICH SOURCE ANSWERS THE SESSION'S IDENTITY, CAPABILITIES AND TECHNICIAN LINK -- the single compile-time seam.
// Firebase exit F1 (DECISIONS #244).
//
// It is the SAME flag that decides navigation (config/navigationAuthorityReadiness.js, resolved from
// config/environments.json): an environment that declares an EOS API is one where EOS already decides what the person
// may open, so it must also decide the rest of the session. scripts/eosApiEnvironmentContract.test.mjs refuses a true
// flag without a configured API, in either direction, so this can never be true where nothing answers.
//
//   false  Firebase is the SOLE source, exactly as before F1: users/{uid} + employees/{id} (auth/employeeSession.js),
//          the users/{uid}.accessVersion snapshot + resolveEffectiveAccessCallable (access/useReportCapabilities.js),
//          users.technicianId + fieldops_technicians (hooks/useCurrentTechnician.js). Nothing about the running
//          product changes, and no EOS request is made for any of it.
//   true   EOS is the SOLE source. The Firebase path is not consulted -- not as a fallback, not on failure, not on an
//          empty answer. A person whose EOS read fails sees a settled deny / a retryable error, never a legacy role.
//
// There is deliberately NO runtime override. A test injects the choice through the hook's own argument.
import { EOS_NAVIGATION_AUTHORITY_READY } from "../config/navigationAuthorityReadiness.js";

export const EOS_SESSION_SOURCE = EOS_NAVIGATION_AUTHORITY_READY === true;
