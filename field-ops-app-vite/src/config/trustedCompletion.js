// F-RULES-1 PR-B release gate (implementation-plan "deployment sequencing
// posture", Option C). The completeAssignedJob callable is merged and
// exported but NOT DEPLOYED until Owner Gate D1 -- and this repo's
// deploy-field-ops.yml auto-publishes the Vite app to GitHub Pages on every
// push to main. Without a gate, merging PR-B would put a completion button
// in production that calls a nonexistent Function.
//
// Same statically-unreachable pattern as src/firebase/firebase.js's
// emulator hookup (ChatGPT architecture review on PR #93: a query param
// alone is reachable in a production build -- the branch must not exist
// there): import.meta.env.DEV is compile-time false in `vite build`, so
// the trusted path is dead code in the published bundle, not merely
// off-by-default. The trusted path is live exactly where the callable
// exists today -- ?emulator=1 dev against the local Functions emulator.
//
// Gate D1 (deploy completeAssignedJob, Owner-authorized) flips this to
// `true` as part of the SAME coordinated release, after which the legacy
// client-transaction branch in FieldMode.jsx becomes dead and PR-C's Rules
// (Gate D2, strictly after D1) deny it outright.
export const TRUSTED_COMPLETION_ENABLED =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get("emulator") === "1";
