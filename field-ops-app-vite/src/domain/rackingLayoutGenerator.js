// RACKING LAYOUT GENERATOR — turning a described rack into proposed governed bins.
// PURE: no Firestore, no callable, no clock, no capability decision, no side effects.
//
// ============================ WHAT IT DOES NOT DECIDE ============================
//
// It proposes STRUCTURE. It does not decide whether a proposal is creatable — that verdict comes
// from the trusted `previewBinCreates` read, because only the server can see `bin_code_claims` and
// the stored idempotency key. The one classification computable here is DUPLICATE: two rows of the
// SAME request resolving to the same structured location, which is a property of the request and
// needs no registry.
//
// It also never authors a `binId`. Identity stays server-derived by createBin; this module only
// derives the deterministic idempotency KEY that feeds it (see binIdempotencyKey below).
//
// ============================ ODD BY DEFAULT, EVEN BY HAND ============================
//
// Initial generation numbers positions 1, 3, 5 … 2N−1, leaving the even values free so a rack can
// gain a shelf later without renumbering its neighbours. That is GENERATION POLICY ONLY. Position is
// a plain integer everywhere: nothing in the schema, the validators or this file encodes
// `position % 2`, and an operator may create 002 between 001 and 003 whenever the physical rack
// gains one.
//
// ============================ THE RACK IS NOT UNIFORM ============================
//
// Bay count varies by aisle and position count varies by bay, because real racking does. The input
// therefore takes defaults with per-aisle and per-bay overrides, plus an explicit position list for
// a bay that follows no pattern at all. Forcing uniformity would make an operator hand-create every
// position in a warehouse because one bay is irregular.

/** Mirrors the governed server validation closely enough to normalize before sending. */
const AREA_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;
const AISLE_PATTERN = /^[A-Z]{1,2}$/;
const MAX_BAY = 9999;
const MAX_POSITION = 99999;

/** What a proposed row can be, before the server has said anything. */
export const PROPOSAL_STATE = Object.freeze({
  PROPOSED: "PROPOSED",
  DUPLICATE: "DUPLICATE",
  INVALID: "INVALID",
});

/**
 * Normalize structured input exactly as the governed server does.
 *
 * The client normalizes VISIBLY, before preview, so what an operator sees is what is sent. Typing
 * "parts room" and silently shipping `PARTS_ROOM` while the screen still reads the other is how a
 * form and a registry end up disagreeing about the same rack.
 *
 * The SERVER remains authoritative: anything this mirror lets through and the server refuses comes
 * back from preview as INVALID.
 */
export const normalizeArea = (raw) =>
  typeof raw === "string" ? raw.trim().replace(/\s+/g, "_").toUpperCase() : "";
export const normalizeAisle = (raw) =>
  typeof raw === "string" ? raw.trim().replace(/\s+/g, "").toUpperCase() : "";

/**
 * The Administration idempotency key — ONE derivation for every create path.
 *
 * P1 validates `idempotencyKey` only as a non-blank string; nothing requires it to be random. A
 * deterministic key serves the original intent more completely: a retry addresses the same document,
 * AND a bin an operator adds by hand is the same bin the generator would have proposed, so the two
 * REPLAY instead of colliding.
 *
 * Namespaced and versioned on purpose. `binadm:v1:` scopes it to Administration-authored bins and
 * leaves room to change the derivation later for NEW bins without disturbing existing identities —
 * which is exactly what makes it safe to adopt.
 *
 * Excludes the formatted code, the name, the status and any display padding: those are renderings
 * and metadata, not identity, and folding them in would make a typo correction or a format change
 * fork the bin.
 */
export function binIdempotencyKey({ warehouseId, area, aisle, bay, position }) {
  return `binadm:v1:${warehouseId}:${area}:${aisle}:${bay}:${position}`;
}

function expandAisleRange(from, to) {
  const a = normalizeAisle(from);
  const b = normalizeAisle(to);
  if (!AISLE_PATTERN.test(a) || !AISLE_PATTERN.test(b)) return { ok: false, reason: "aisle_invalid" };
  // A range across widths ("A" to "AF") has no unambiguous reading, so it is refused rather than
  // guessed at. An operator who wants both lists them explicitly.
  if (a.length !== b.length) return { ok: false, reason: "aisle_range_width_mismatch" };
  if (a > b) return { ok: false, reason: "aisle_range_reversed" };

  const out = [];
  if (a.length === 1) {
    for (let c = a.charCodeAt(0); c <= b.charCodeAt(0); c += 1) out.push(String.fromCharCode(c));
    return { ok: true, aisles: out };
  }
  for (let hi = a.charCodeAt(0); hi <= b.charCodeAt(0); hi += 1) {
    const lo0 = hi === a.charCodeAt(0) ? a.charCodeAt(1) : 65;
    const lo1 = hi === b.charCodeAt(0) ? b.charCodeAt(1) : 90;
    for (let lo = lo0; lo <= lo1; lo += 1) out.push(String.fromCharCode(hi) + String.fromCharCode(lo));
  }
  return { ok: true, aisles: out };
}

/** `A, B, D, F` — for racking that skips letters, or a warehouse that follows no sequence at all. */
function expandExplicitAisles(list) {
  const raw = Array.isArray(list) ? list : String(list ?? "").split(",");
  const aisles = raw.map(normalizeAisle).filter((a) => a !== "");
  if (aisles.length === 0) return { ok: false, reason: "aisle_required" };
  for (const a of aisles) if (!AISLE_PATTERN.test(a)) return { ok: false, reason: "aisle_invalid" };
  return { ok: true, aisles };
}

export function resolveAisles(input) {
  const mode = input?.mode === "range" ? "range" : "explicit";
  return mode === "range"
    ? expandAisleRange(input?.from, input?.to)
    : expandExplicitAisles(input?.list);
}

/** N positions -> 1, 3, 5 … 2N-1. Generation policy; even values remain equally valid. */
export function oddPositions(count) {
  const out = [];
  for (let i = 1; i <= count; i += 1) out.push(2 * i - 1);
  return out;
}

const intOrNull = (v) => (typeof v === "number" && Number.isInteger(v) ? v : null);

function positionsForBay(input, aisle, bay) {
  const explicit = input.explicitPositions?.[`${aisle}:${bay}`];
  if (Array.isArray(explicit)) {
    // An explicit list is taken literally, including even values and gaps. The rack is what it is.
    return explicit.map(intOrNull);
  }
  const override = intOrNull(input.positionCountByBay?.[`${aisle}:${bay}`]);
  const perAisle = intOrNull(input.positionCountByAisle?.[aisle]);
  const count = override ?? perAisle ?? intOrNull(input.defaultPositionCount) ?? 0;
  return oddPositions(count);
}

function bayCountFor(input, aisle) {
  return intOrNull(input.bayCountByAisle?.[aisle]) ?? intOrNull(input.defaultBayCount) ?? 0;
}

/**
 * Generate the proposed rows for one described area.
 *
 * Every row carries the structured identity, its deterministic key, and a local state. It carries NO
 * canonical code: the code an operator reviews must be the SERVER's, so that preview and apply
 * cannot show different strings for the same bin.
 */
export function generateRackingLayout(input) {
  const warehouseId = typeof input?.warehouseId === "string" ? input.warehouseId.trim() : "";
  const area = normalizeArea(input?.area);

  const errors = [];
  if (warehouseId === "") errors.push("warehouse_required");
  if (!AREA_PATTERN.test(area)) errors.push("area_invalid");

  const aisleResult = resolveAisles(input?.aisles);
  if (!aisleResult.ok) errors.push(aisleResult.reason);
  if (errors.length > 0) return { ok: false, errors, rows: [] };

  const rows = [];
  const seen = new Set();
  for (const aisle of aisleResult.aisles) {
    const bays = bayCountFor(input, aisle);
    for (let bay = 1; bay <= bays; bay += 1) {
      for (const position of positionsForBay(input, aisle, bay)) {
        const identity = { warehouseId, area, aisle, bay, position };
        const invalid =
          position === null
          || position < 0 || position > MAX_POSITION
          || bay < 0 || bay > MAX_BAY;
        const key = invalid ? null : binIdempotencyKey(identity);
        // A duplicate WITHIN the request is the one verdict this pure module can reach, because it
        // is a fact about the request rather than about the registry.
        const duplicate = key !== null && seen.has(key);
        if (key !== null) seen.add(key);
        rows.push({
          ...identity,
          position,
          idempotencyKey: key,
          state: invalid ? PROPOSAL_STATE.INVALID : duplicate ? PROPOSAL_STATE.DUPLICATE : PROPOSAL_STATE.PROPOSED,
        });
      }
    }
  }

  return { ok: true, errors: [], rows };
}

/** The exact request shape createBin takes. No `code`, no `binId` — the server authors both. */
export function toCreateRequest(row) {
  return {
    warehouseId: row.warehouseId,
    area: row.area,
    aisle: row.aisle,
    bay: row.bay,
    position: row.position,
    idempotencyKey: row.idempotencyKey,
  };
}
