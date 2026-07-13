// Account Commercial Profile -- PR 1. Renders one resolved identity line while
// preserving its resolution state (from resolveOwnerIdentity /
// resolveContactIdentity in domain/commercialProfile.js): a distinct
// "resolving…" while the lookup source is still loading, an explicit
// unavailable line on a lookup error, the CURRENT resolved name when found,
// and "Unknown …" only after a completed unresolved lookup. Renders nothing
// when the reference is unset. Shared by the read-only detail view and the
// edit form so both show the current authority, never a stored snapshot.
export default function IdentityLine({ label, identity }) {
  if (identity.state === "unset") return null;
  if (identity.state === "loading") {
    return <div>{label}: <span className="fo-muted">resolving…</span></div>;
  }
  if (identity.state === "error") {
    return <div>{label}: <span className="fo-warning">{identity.name}</span></div>;
  }
  return <div>{label}: {identity.name}</div>;
}
