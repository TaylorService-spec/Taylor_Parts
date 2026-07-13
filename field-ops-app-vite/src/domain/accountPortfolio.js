import { ACCOUNT_STATUS } from "./constants.js";

// Customer Results Dashboard -- PURE summary / filter / display helpers.
// No Firebase import: they operate ONLY on the accounts array already loaded by
// the existing Accounts subscription (useFirestoreCollection(ACCOUNTS_COLLECTION)).
// No per-account query, no Contact/Location fetch, no financial calculation,
// no raw-ID surfacing -- metrics and filtering are computed entirely locally
// and are directly unit-testable in Node.

// Portfolio counts by status, plus the total. An account with an
// unrecognized/absent status is counted in `total` only (never silently
// bucketed into a status it doesn't have).
export function summarizeAccounts(accounts = []) {
  const summary = { total: accounts.length, active: 0, prospect: 0, inactive: 0, archived: 0 };
  for (const a of accounts) {
    switch (a.status) {
      case ACCOUNT_STATUS.ACTIVE: summary.active += 1; break;
      case ACCOUNT_STATUS.PROSPECT: summary.prospect += 1; break;
      case ACCOUNT_STATUS.INACTIVE: summary.inactive += 1; break;
      case ACCOUNT_STATUS.ARCHIVED: summary.archived += 1; break;
      default: break;
    }
  }
  return summary;
}

// Local filter. `status` is one ACCOUNT_STATUS value or null (= all statuses).
// `relationshipTypes` uses AND semantics (an account must carry EVERY selected
// type). `tags` uses ANY semantics (an account matches if it has at least one
// selected tag). Empty/omitted filters are no-ops.
export function filterAccounts(accounts = [], { status = null, relationshipTypes = [], tags = [] } = {}) {
  return accounts.filter((a) => {
    if (status && a.status !== status) return false;
    if (relationshipTypes.length) {
      const rt = a.relationshipTypes ?? [];
      if (!relationshipTypes.every((t) => rt.includes(t))) return false;
    }
    if (tags.length) {
      const at = a.tags ?? [];
      if (!tags.some((t) => at.includes(t))) return false;
    }
    return true;
  });
}

// Distinct, sorted tag list across all accounts -- the options for the local
// tag filter. Blank/falsy tags are ignored.
export function collectTags(accounts = []) {
  const set = new Set();
  for (const a of accounts) {
    for (const t of a.tags ?? []) if (t) set.add(t);
  }
  return [...set].sort((x, y) => x.localeCompare(y));
}

// A filter set is "active" (i.e., Clear/Reset should be offered/enabled) when
// any of status / relationshipTypes / tags is set.
export function hasActiveFilters({ status = null, relationshipTypes = [], tags = [] } = {}) {
  return Boolean(status) || relationshipTypes.length > 0 || tags.length > 0;
}

// Human-readable relative "last update" from the schema's epoch-ms number
// (createdAt/updatedAt are Date.now() numbers -- see domain/accounts.js), and
// tolerant of a Firestore Timestamp or an ISO string just in case. Returns
// "Unknown" when absent/unparseable. Deterministic given `now`, so it is
// unit-testable without mocking the clock.
export function formatLastUpdate(value, now = Date.now()) {
  const ms = toEpochMs(value);
  if (ms == null) return "Unknown";
  const diff = now - ms;
  if (diff < 60_000) return "just now";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon} month${mon === 1 ? "" : "s"} ago`;
  const yr = Math.floor(day / 365);
  return `${yr} year${yr === 1 ? "" : "s"} ago`;
}

function toEpochMs(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object") {
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value.seconds === "number") return value.seconds * 1000;
  }
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}
