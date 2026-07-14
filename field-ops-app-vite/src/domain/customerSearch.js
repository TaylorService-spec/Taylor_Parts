// Work Order wizard -- Customer picker PURE helpers: deterministic ranking of
// customer matches, the safe secondary line (billing city/state or external
// customer number -- NEVER a raw id), and a bounded location summary with a
// "+N more" overflow count. No React/Firebase import, so all of this is
// directly unit-testable in Node (same pattern as domain/accountPortfolio.js).

// City/State from a billing/location address, blanks dropped ("Denver, CO").
export function locationCityState(address) {
  if (!address || typeof address !== "object") return "";
  const city = (address.city ?? "").trim();
  const state = (address.state ?? "").trim();
  return [city, state].filter(Boolean).join(", ");
}

// The safe secondary identifier for a customer result: billing city/state when
// present, else the external customer number ("Customer #: ..."), else nothing.
// NEVER the Firestore document id.
export function customerSecondaryLine(account = {}) {
  const cityState = locationCityState(account.billingAddress);
  if (cityState) return cityState;
  if (account.customerNumber) return `Customer #: ${account.customerNumber}`;
  return "";
}

// Deterministic match + rank + limit over the ALREADY-LOADED accounts array
// (no Firestore read). Matches by name (exact > prefix > substring) and, last,
// by external customer number. Ties break by name then id, so the order is
// stable for identically scored/named customers. Returns the bounded `results`
// plus the full `total` so the UI can show "+N more results".
export function rankCustomerMatches(accounts = [], rawQuery = "", limit = 8) {
  const q = (rawQuery ?? "").trim().toLowerCase();
  if (!q) return { results: [], total: 0 };
  const scored = [];
  for (const a of accounts) {
    const name = (a.name ?? "").toLowerCase();
    const cnum = (a.customerNumber ?? "").toLowerCase();
    let score;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(q)) score = 2;
    else if (cnum && cnum.includes(q)) score = 3;
    else continue;
    scored.push({ account: a, score });
  }
  scored.sort(
    (x, y) =>
      x.score - y.score ||
      (x.account.name ?? "").localeCompare(y.account.name ?? "") ||
      String(x.account.id ?? "").localeCompare(String(y.account.id ?? ""))
  );
  return { results: scored.slice(0, limit).map((s) => s.account), total: scored.length };
}

// Bounded, deterministic location summary for one customer. `shown` carries the
// first `maxShown` locations (name + city/state); `moreCount` drives the
// "+N more locations" affordance; `total === 0` is the "No locations" case.
export function summarizeLocations(locations = [], maxShown = 2) {
  const sorted = [...locations].sort(
    (a, b) => (a.name ?? "").localeCompare(b.name ?? "") || String(a.id ?? "").localeCompare(String(b.id ?? ""))
  );
  const shown = sorted.slice(0, maxShown).map((l) => ({
    name: l.name ?? "Unnamed location",
    cityState: locationCityState(l.address),
  }));
  return { shown, moreCount: Math.max(0, sorted.length - maxShown), total: sorted.length };
}
