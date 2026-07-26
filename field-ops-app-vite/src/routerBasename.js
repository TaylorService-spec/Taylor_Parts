// I-1R — single source of truth for React Router's basename, derived from
// the SAME build-time base authority Vite uses (import.meta.env.BASE_URL,
// which equals vite.config's resolved `base`). This keeps the router mount
// point aligned with where the bundle is actually served, with no host
// logic duplicated:
//   - GitHub Pages build  (base "/Taylor_Parts/field-ops/") -> "/Taylor_Parts/field-ops"
//   - Firebase build       (base "/")                         -> "/"
// BrowserRouter wants no trailing slash except for the root "/".
//
// This helper is PURE (no import.meta reference) so it is unit-testable in
// plain Node; App.jsx supplies import.meta.env.BASE_URL at the call site.
export function routerBasenameFrom(baseUrl) {
  if (typeof baseUrl !== "string" || baseUrl === "" || baseUrl === "/") return "/";
  return baseUrl.replace(/\/+$/, "");
}
