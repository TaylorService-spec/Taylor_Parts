// Account Commercial Profile -- PR 1. Renders one resolved identity line while
// preserving its resolution state (from resolveOwnerIdentity /
// resolveContactIdentity in domain/commercialProfile.js): a distinct
// "resolving…" while the lookup source is still loading, an explicit
// unavailable line on a lookup error, the CURRENT resolved name when found,
// and "Unknown …" only after a completed unresolved lookup. Renders nothing
// when the reference is unset. Shared by the read-only detail view and the
// edit form so both show the current authority, never a stored snapshot.
//
// `variant="definition"` emits a <dt>/<dd> pair instead of a <div>, for the Account North Star
// rail's description list. Same four states, same words, same "unset renders nothing" rule -- the
// STATES are the contract here and they must not fork per layout, which is exactly why this is a
// variant of one component rather than a second identity renderer beside it.
export default function IdentityLine({ label, identity, variant = "line" }) {
  if (identity.state === "unset") return null;

  const value =
    identity.state === "loading" ? (
      <span className="fo-muted">resolving…</span>
    ) : identity.state === "error" ? (
      <span className="fo-warning">{identity.name}</span>
    ) : (
      identity.name
    );

  if (variant === "definition") {
    return (
      <>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </>
    );
  }

  return <div>{label}: {value}</div>;
}
