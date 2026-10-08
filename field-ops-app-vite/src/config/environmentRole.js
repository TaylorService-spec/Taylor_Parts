// The bundle's environment role (config/environments.json via vite `define` __APP_ENVIRONMENT__). Read-only; decides only
// whether NONPROD QA tooling is OFFERED. Authority stays the server's. An unidentified bundle is treated as production
// (fail closed): QA tooling appears only where the build positively says it is not production.
export function appEnvironmentRole() {
  try {
    // eslint-disable-next-line no-undef
    return typeof __APP_ENVIRONMENT__ === "object" && __APP_ENVIRONMENT__ ? __APP_ENVIRONMENT__.role ?? null : null;
  } catch {
    return null;
  }
}

/** True only for a bundle whose declared role is a non-production role. */
export function isNonprodEnvironment(role = appEnvironmentRole()) {
  return typeof role === "string" && role !== "" && role !== "production";
}
