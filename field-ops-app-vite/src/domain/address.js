// Customer Record Page sprint, PR 1 (docs/specifications/customer-record-page-structured-address.md,
// Component 2). Single source of truth for turning a stored address
// object ({ street, city, state, zip }) into a display form -- replaces
// the two duplicated inline .filter(Boolean).join(", ") call sites that
// used to live in AccountDetail.jsx.

// Returns null for a null/undefined address (never an empty string or a
// string of stray commas) so callers can decide whether to omit the row
// entirely -- no fabricated/empty values are ever displayed.
export function formatAddress(address) {
  if (!address) return null;
  const parts = [address.street, address.city, address.state, address.zip].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

// Structured form for "distinct displayed rows" -- returns an ordered
// array of { label, value } pairs, omitting any field that's
// empty/missing (never a fabricated "Not set" value).
export function addressRows(address) {
  if (!address) return [];
  return [
    { label: "Street address", value: address.street },
    { label: "City", value: address.city },
    { label: "State", value: address.state },
    { label: "ZIP code", value: address.zip },
  ].filter((row) => Boolean(row.value));
}
