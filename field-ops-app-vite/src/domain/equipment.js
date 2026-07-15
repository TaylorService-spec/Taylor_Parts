// Explicit .js extension: this module is imported by a plain-node pure test, so the
// specifier must be node-ESM-resolvable -- the same convention accountPortfolio.js /
// commercialProfile.js already use for exactly that reason.
import { EQUIPMENT_STATUS } from "./constants.js";

// Equipment & Installed Asset Management -- Issue #232, unit E1 (Domain
// foundation) of docs/implementation-plans/equipment-and-installed-asset-management.md,
// implementing docs/specifications/equipment-and-installed-asset-management.md
// under ADR-006.
//
// PURE and dependency-free beyond ./constants (which imports nothing), so this
// module is node-importable and unit-tested directly (test/equipmentDomain.test.mjs)
// without a browser or emulator -- the same pattern as domain/accountPortfolio.js.
//
// **There is NO write path here.** E1 is deliberately read/compute-only: the
// Firestore repository/hooks land in E2, Rules/indexes in E3. Nothing in this file
// touches firebase, and nothing here authorizes anything -- Firestore Rules and (for
// move/lifecycle) the trusted writer remain the sole authorities.

const STATUSES = new Set(Object.values(EQUIPMENT_STATUS));

// Spec §3 allowed transitions. ACTIVE <-> INACTIVE (plain); ACTIVE/INACTIVE ->
// RETIRED (confirmed, destructive); RETIRED -> ACTIVE (reactivate, confirmed).
// RETIRED -> INACTIVE is NOT allowed: a retired asset reactivates to ACTIVE only.
const ALLOWED_TRANSITIONS = {
  [EQUIPMENT_STATUS.ACTIVE]: [EQUIPMENT_STATUS.INACTIVE, EQUIPMENT_STATUS.RETIRED],
  [EQUIPMENT_STATUS.INACTIVE]: [EQUIPMENT_STATUS.ACTIVE, EQUIPMENT_STATUS.RETIRED],
  [EQUIPMENT_STATUS.RETIRED]: [EQUIPMENT_STATUS.ACTIVE],
};

// ---------------------------------------------------------------- status ----

// Normalize a stored/incoming status to the canonical enum. Unknown, missing, or
// malformed values fail closed to null (never silently coerced to ACTIVE) so a
// caller must decide explicitly rather than inherit a wrong default.
export function normalizeEquipmentStatus(value) {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return STATUSES.has(upper) ? upper : null;
}

export function isValidEquipmentStatus(value) {
  return normalizeEquipmentStatus(value) !== null;
}

// Is `to` reachable from `from`? Unknown statuses on either side => false.
export function canTransitionEquipmentStatus(from, to) {
  const a = normalizeEquipmentStatus(from);
  const b = normalizeEquipmentStatus(to);
  if (!a || !b || a === b) return false;
  return (ALLOWED_TRANSITIONS[a] ?? []).includes(b);
}

export function isRetired(equipment) {
  return normalizeEquipmentStatus(equipment?.status) === EQUIPMENT_STATUS.RETIRED;
}

// ------------------------------------------------------ input normalization --

function trimmedOrNull(value) {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t === "" ? null : t;
}

// Spec §1/§2: optional strings are trimmed, empty -> null; required strings are
// trimmed. Only the specified fields survive -- unknown keys are dropped here, and
// the write path (E2) plus Rules (E3) reject them independently.
export function normalizeEquipmentInput(values = {}) {
  return {
    accountId: trimmedOrNull(values.accountId),
    locationId: trimmedOrNull(values.locationId),
    name: trimmedOrNull(values.name),
    status: normalizeEquipmentStatus(values.status) ?? EQUIPMENT_STATUS.ACTIVE,
    manufacturer: trimmedOrNull(values.manufacturer),
    model: trimmedOrNull(values.model),
    serialNumber: trimmedOrNull(values.serialNumber),
    assetTag: trimmedOrNull(values.assetTag),
    installedDate: trimmedOrNull(values.installedDate),
    warrantyExpiresDate: trimmedOrNull(values.warrantyExpiresDate),
    notes: trimmedOrNull(values.notes),
  };
}

// -------------------------------------------------------------- validation --

// Spec §2. Required: accountId, locationId, name (non-blank), status (valid; the
// normalizer defaults a missing one to ACTIVE). Duplicate names within an Account
// are ALLOWED (real-world) -- disambiguated in the UI by Location/manufacturer/
// model/serial, never rejected here.
//
// Returns { valid, errors: { field: message }, value } -- `value` is the normalized
// payload, safe to hand to E2's write path only when `valid` is true.
export function validateEquipmentInput(values = {}) {
  const value = normalizeEquipmentInput(values);
  const errors = {};
  if (!value.accountId) errors.accountId = "Select a customer.";
  if (!value.locationId) errors.locationId = "Select a location.";
  if (!value.name) errors.name = "Enter an equipment name.";
  if (!isValidEquipmentStatus(value.status)) errors.status = "Select a valid status.";
  return { valid: Object.keys(errors).length === 0, errors, value };
}

// ------------------------------------------ Account / Location relationships --

// Spec §4: an Equipment's Location must belong to its owning Account. A missing or
// malformed Location fails closed (false) -- never treated as "probably fine".
export function locationBelongsToAccount(location, accountId) {
  if (!location || typeof accountId !== "string" || accountId === "") return false;
  return location.accountId === accountId;
}

// The Locations a piece of Equipment for `accountId` may be installed at / moved to.
// Cross-Account destinations are excluded here as well as denied by Rules (E3).
export function locationsForAccount(locations = [], accountId) {
  if (typeof accountId !== "string" || accountId === "") return [];
  return locations.filter((l) => locationBelongsToAccount(l, accountId));
}

// Whole-record ownership check: the equipment names an Account and a Location, and
// that Location resolves to the same Account.
export function equipmentOwnershipValid(equipment, location) {
  if (!equipment?.accountId || !equipment?.locationId) return false;
  if (!location || location.id !== equipment.locationId) return false;
  return locationBelongsToAccount(location, equipment.accountId);
}

// Spec §4: ordinary edits must never change ownership. Pure predicate the edit
// surface (E8) and its tests use; Rules (E3) enforce it independently.
export function ownershipUnchanged(before = {}, after = {}) {
  return before.accountId === after.accountId && before.locationId === after.locationId;
}

// ------------------------------------------------------------ presentation --

// The human reference (Spec §8): the display name, never the raw document id.
export function equipmentDisplayName(equipment) {
  return trimmedOrNull(equipment?.name) ?? "Unnamed equipment";
}

// A one-line disambiguating summary -- duplicate names are legal, so surface the
// distinguishing context. Omits empty parts; never renders a raw id.
export function equipmentSummary(equipment) {
  const parts = [
    [trimmedOrNull(equipment?.manufacturer), trimmedOrNull(equipment?.model)].filter(Boolean).join(" "),
    trimmedOrNull(equipment?.serialNumber) ? `S/N ${trimmedOrNull(equipment.serialNumber)}` : null,
    trimmedOrNull(equipment?.assetTag) ? `Tag ${trimmedOrNull(equipment.assetTag)}` : null,
  ].filter((p) => p && p !== "");
  return parts.join(" · ");
}

// ------------------------------------------------------------ safe errors ----

// Safe, categorized copy for an Equipment read/write failure. Never surfaces a raw
// Firebase code, document id, or internal detail -- the same discipline as the other
// domain *SaveErrorMessage helpers.
export function equipmentSaveErrorMessage(err) {
  if (err?.blocked) return "Saving is disabled in this mode — no equipment was saved.";
  const code = typeof err?.code === "string" ? err.code.split("/").pop() : "";
  if (code === "permission-denied" || code === "unauthenticated") {
    return "You do not have permission to save this equipment. Nothing was saved.";
  }
  if (code === "unavailable" || code === "deadline-exceeded") {
    return "The service is temporarily unavailable. Nothing was saved — please try again.";
  }
  return "Could not save this equipment. Nothing was saved — please try again.";
}

// ------------------------------------------------- payloads & field guards ---
// (Issue #232 unit E2 -- still PURE. The firebase-touching repository that consumes
// these lives in ./equipmentRepository.js; these builders stay here so they are
// node-testable and so the field policy has exactly one definition.)

// Spec §1/§4: ownership + lifecycle + createdAt are governed. An ORDINARY edit must
// never change them -- a Location change is only the audited move, and a status
// change is only an explicit lifecycle action. Rules (E3) re-enforce this
// independently; this constant is the client-side single source of that policy.
export const GOVERNED_EQUIPMENT_FIELDS = Object.freeze(["accountId", "locationId", "status", "createdAt"]);

// Everything an ordinary edit MAY change (Spec §6: descriptive/optional fields).
export const EDITABLE_EQUIPMENT_FIELDS = Object.freeze([
  "name", "manufacturer", "model", "serialNumber", "assetTag",
  "installedDate", "warrantyExpiresDate", "notes",
]);

// Create payload: the full validated record + updatedAt.
//
// `createdAt` is deliberately NOT set here -- makeCollectionStore.add() stamps it on
// write (the app-wide convention). Setting it here too would return one value to the
// caller while persisting another.
//
// Status is pinned ACTIVE (Spec §2). Reaching RETIRED/INACTIVE is a lifecycle
// transition that belongs to the trusted, audited seam, so create must not be usable
// as a side door into a non-ACTIVE state. A caller that explicitly asks for one is
// refused rather than silently overridden.
export function buildEquipmentCreatePayload(values = {}, now = 0) {
  const { valid, errors, value } = validateEquipmentInput(values);

  const requested = values.status === undefined ? null : normalizeEquipmentStatus(values.status);
  if (requested !== null && requested !== EQUIPMENT_STATUS.ACTIVE) {
    errors.status = "New equipment is always created active.";
  }
  if (Object.keys(errors).length > 0) return { valid: false, errors, payload: null };
  if (!valid) return { valid: false, errors, payload: null };

  return {
    valid: true,
    errors: {},
    payload: { ...value, status: EQUIPMENT_STATUS.ACTIVE, updatedAt: now },
  };
}

// The governed value as it would actually be stored, so the change check compares
// like with like. Without this, a caller round-tripping a record with "active" or a
// padded id reads as a governed CHANGE and gets its whole edit refused.
function governedValue(field, raw) {
  if (raw === undefined) return undefined;
  if (field === "status") return normalizeEquipmentStatus(raw);
  if (field === "createdAt") return raw;
  return trimmedOrNull(raw);
}

// Ordinary-edit payload.
//
// Two independent protections, because they fail differently:
//
//  1. BY CONSTRUCTION -- only editable fields the caller actually supplied reach the
//     payload. A governed field can never be written here even if a caller spreads a
//     whole record in, and fields the caller did not touch are left alone rather than
//     overwritten with null.
//  2. LOUDLY -- if the caller genuinely ASKED to change a governed field, refuse the
//     whole edit via `changedGoverned` instead of dropping it and reporting success.
//
// `before` is what proves a governed field is unchanged. If it cannot prove that, the
// field is reported as changed and the caller fails closed -- silence here is what
// would turn a dropped move into a false success.
export function buildEquipmentEditPayload(values = {}, before = {}, now = 0) {
  const normalized = normalizeEquipmentInput(values);
  const errors = {};
  // Only validate what the caller is actually editing; an absent key means unchanged.
  if (values.name !== undefined && !normalized.name) errors.name = "Enter an equipment name.";

  const changedGoverned = GOVERNED_EQUIPMENT_FIELDS.filter((f) => {
    const asked = governedValue(f, values[f]);
    if (asked === undefined) return false;
    const current = governedValue(f, before[f]);
    if (current === undefined) return true;
    return asked !== current;
  });

  const payload = { updatedAt: now };
  for (const f of EDITABLE_EQUIPMENT_FIELDS) {
    if (values[f] !== undefined) payload[f] = normalized[f];
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    payload: Object.keys(errors).length === 0 ? payload : null,
    changedGoverned,
  };
}

// ------------------------------------------- trusted-writer seam (contract) ---

// Move / retire / reactivate are trusted-writer, audited actions (Spec §5/§11) and
// are gated on Issue #15 (Functions undeployed). Until then they are UNAVAILABLE --
// never a client-direct fallback, never optimistic success, never simulated. This is
// the single shape every such contract returns, so callers (E9/E10 UI) can render a
// clear reason and keep the action disabled.
export const TRUSTED_ACTION_UNAVAILABLE_REASON = "trusted-writer-unavailable";

export function trustedActionUnavailable(action) {
  return Object.freeze({
    ok: false,
    unavailable: true,
    reason: TRUSTED_ACTION_UNAVAILABLE_REASON,
    action: action ?? null,
    // Safe, human copy -- names no provider, code, id, or credential.
    message: "This action isn't available yet. Nothing was changed.",
  });
}

// ---------------------------------------------------------------- search -----

// Spec §7: match over name / assetTag / serialNumber / manufacturer / model,
// case-insensitive substring. A blank term matches everything (the caller's filters
// still apply). Pure over an already-bounded, Account/Location-scoped set -- this
// never issues a query and never loops per record over the network.
export function equipmentMatchesSearch(equipment, term) {
  const q = typeof term === "string" ? term.trim().toLowerCase() : "";
  if (q === "") return true;
  return [equipment?.name, equipment?.assetTag, equipment?.serialNumber, equipment?.manufacturer, equipment?.model]
    .some((f) => typeof f === "string" && f.toLowerCase().includes(q));
}

// Spec §7 deterministic ordering: name ascending (case-insensitive), tie-break by
// id -- a total order, so the register's rendering is stable and testable.
export function compareEquipment(a, b) {
  const an = (a?.name ?? "").toLowerCase();
  const bn = (b?.name ?? "").toLowerCase();
  if (an < bn) return -1;
  if (an > bn) return 1;
  const ai = a?.id ?? "";
  const bi = b?.id ?? "";
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

// Search + optional Location/status filters + deterministic order, in one pure pass.
// Returns a new array; never mutates the input.
export function searchEquipment(equipment = [], { term = "", locationId = null, status = null } = {}) {
  const wantStatus = normalizeEquipmentStatus(status);
  return equipment
    .filter((e) => equipmentMatchesSearch(e, term))
    .filter((e) => (locationId ? e?.locationId === locationId : true))
    .filter((e) => (wantStatus ? normalizeEquipmentStatus(e?.status) === wantStatus : true))
    .slice()
    .sort(compareEquipment);
}

// -------------------------------------------------- service history (derived) --

// Spec §10: Equipment Service History is DERIVED from linked Work Orders -- there is
// no duplicate history ledger. Given the Work Orders already loaded by the caller,
// select those linked to this equipment and order them newest-first.
//
// Historical entries survive retirement (Spec §3) -- nothing here filters by the
// equipment's status. Returns { id, workOrderId, status, at, ... } shaped entries
// carrying the Work Order through for linking; the raw equipment id is never a
// rendered reference.
export function equipmentServiceHistory(workOrders = [], equipmentId) {
  if (typeof equipmentId !== "string" || equipmentId === "") return [];
  return workOrders
    .filter((wo) => wo?.equipmentId === equipmentId)
    .map((wo) => ({
      workOrderId: wo.id,
      woNumber: wo.woNumber ?? null,
      status: wo.status ?? null,
      type: wo.type ?? null,
      at: toMillis(wo.createdAt),
    }))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

// Accepts a Firestore Timestamp (client or admin), a ms number, or a Date; anything
// else -> null (fail closed rather than render a wrong date).
function toMillis(value) {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return null;
}

// Group a derived history into buckets by calendar year, newest year first --
// the shape the detail page's Service History section renders.
export function groupServiceHistoryByYear(entries = []) {
  const buckets = new Map();
  for (const entry of entries) {
    const year = entry?.at ? new Date(entry.at).getFullYear() : null;
    const key = year ?? "Unknown";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(entry);
  }
  return [...buckets.entries()]
    .sort((a, b) => {
      if (a[0] === "Unknown") return 1;
      if (b[0] === "Unknown") return -1;
      return b[0] - a[0];
    })
    .map(([year, items]) => ({ year, entries: items }));
}
