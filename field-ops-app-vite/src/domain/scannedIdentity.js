import { INVENTORY_LOCATION_TYPES } from "./inventoryLocation.js";

/**
 * F2 — the ENTITY RESOLUTION BOUNDARY.
 *
 * One seam that every scan/input mechanism converges through: device camera,
 * QR, 1D/2D barcode, Bluetooth/HID wedge, laptop-attached scanner, manual
 * search, and any future RFID/NFC source. The business workflow must not care
 * which of those produced the value.
 *
 * THE PRINCIPLE THIS FILE EXISTS TO ENFORCE:
 *
 *   Scanning resolves IDENTITY. Scanning does NOT determine AUTHORITY.
 *
 * So this module answers only "what governed thing is this?" and deliberately
 * returns NO action list. What may be done next is derived elsewhere, from
 * effective authority + workflow state + resource relationship + Scope/Policy
 * (ADR-012). The barcode never maps to an action, and the device never confers
 * a permission.
 *
 * It is also PURE: candidate records are injected by the caller, which owns the
 * governed reads and therefore the authorization for them. That keeps identity
 * resolution unit-testable and keeps this file incapable of widening access.
 */

/** Governed entity types this boundary can resolve. Each has a canonical
 *  identifier that already exists in the repository — nothing is manufactured
 *  for entities whose identity is not yet governed. */
export const SCANNABLE_ENTITY_TYPES = Object.freeze([
  "PART",               // Part Master: partId / sku
  "SERIALIZED_ASSET",   // serialNo (+ owning partId)
  "WORK_ORDER",         // woNumber (WO-YYYY-NNNNNN)
  "INVENTORY_LOCATION", // LocationRef: { type, locationId } incl. MOBILE = truck
  "EQUIPMENT",          // equipmentId / serialNumber
]);

/**
 * Resolution states. Deliberately distinct, and deliberately NOT including an
 * authorization outcome — authorization is a separate axis resolved by the
 * caller. Collapsing "you may not see this" into "this does not exist" is an
 * information-disclosure decision that belongs to security policy, not to a
 * scanner.
 */
export const SCAN_RESOLUTION = Object.freeze({
  RESOLVED: "RESOLVED",   // exactly one governed entity matched
  NOT_FOUND: "NOT_FOUND", // a well-formed token matched nothing
  AMBIGUOUS: "AMBIGUOUS", // matched more than one governed entity
  INVALID: "INVALID",     // not a usable token at all (empty/garbage)
});

const WO_NUMBER = /^WO-\d{4}-[A-Z0-9]+$/i;

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * Normalize a raw scan into a comparable token.
 *
 * Physical scans arrive wrapped in whatever the label printer chose: a bare
 * code, a JSON payload, a URL with the id in a query parameter, or a
 * vendor-prefixed string. Unwrapping belongs HERE, once, rather than in each
 * scanning surface — that is the point of a shared boundary.
 *
 * Returns null when nothing usable can be extracted; the caller maps that to
 * INVALID rather than guessing.
 */
export function normalizeScanToken(raw) {
  if (!isNonEmptyString(raw)) return null;
  const value = raw.trim();

  // JSON payload — take the first governed identifier present, in a fixed order.
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") {
      for (const key of ["serialNo", "partId", "sku", "woNumber", "locationId", "equipmentId", "barcode", "id"]) {
        if (isNonEmptyString(parsed[key])) return parsed[key].trim();
      }
      return null;
    }
  } catch { /* not JSON — fall through */ }

  // URL payload — same fixed order over query parameters.
  //
  // Restricted to http(s) ON PURPOSE: `new URL()` happily accepts anything with
  // a scheme-like prefix, so a vendor code such as "TAYLOR-PART:PRT-1001"
  // parses as a URL with protocol "taylor-part:" and no query parameters, and
  // would be swallowed here before the prefix-stripping below ever ran.
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("not a web URL");
    for (const key of ["serial", "serialNo", "part", "partId", "sku", "wo", "woNumber", "location", "locationId", "equipment", "equipmentId", "barcode", "id"]) {
      const q = url.searchParams.get(key);
      if (isNonEmptyString(q)) return q.trim();
    }
    return null;
  } catch { /* not a URL — fall through */ }

  // Vendor/company prefixes. A normalization concern only: stripping a prefix
  // must never imply an entity type or an action.
  const stripped = value.replace(/^(TAYLOR|EOS)[-_:](PART|ASSET|WO|LOC|EQUIP)?[-_:]?/i, "");
  return isNonEmptyString(stripped) ? stripped.trim() : null;
}

/** A single, uniform identity result. Never carries actions. */
function identity(resolutionState, extra = {}) {
  return {
    resolutionState,
    entityType: null,
    entityId: null,
    canonicalIdentity: null,
    token: null,
    candidates: [],
    ...extra,
  };
}

const eq = (a, b) =>
  isNonEmptyString(a) && isNonEmptyString(b) && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Match a normalized token against injected governed candidates.
 *
 * `candidates` is what the CALLER already read under its own authority:
 *   { parts:[{partId,sku}], serializedAssets:[{serialNo,partId}],
 *     workOrders:[{id,woNumber}], locations:[{locationId,type}],
 *     equipment:[{equipmentId,serialNumber}] }
 *
 * Every match is exact on a canonical identifier. There is no fuzzy matching:
 * a scanner that guesses is worse than one that says NOT_FOUND.
 */
export function resolveScannedIdentity(raw, candidates = {}) {
  const token = normalizeScanToken(raw);
  if (!token) return identity(SCAN_RESOLUTION.INVALID, { token: null });

  const matches = [];

  for (const p of candidates.parts ?? []) {
    if (eq(p.partId, token) || eq(p.sku, token)) {
      matches.push({
        entityType: "PART",
        entityId: p.partId ?? p.sku,
        canonicalIdentity: { partId: p.partId ?? null, sku: p.sku ?? null },
      });
    }
  }
  for (const a of candidates.serializedAssets ?? []) {
    if (eq(a.serialNo, token)) {
      matches.push({
        entityType: "SERIALIZED_ASSET",
        entityId: a.serialNo,
        canonicalIdentity: { serialNo: a.serialNo, partId: a.partId ?? null },
      });
    }
  }
  for (const w of candidates.workOrders ?? []) {
    if (eq(w.woNumber, token) || eq(w.id, token)) {
      matches.push({
        entityType: "WORK_ORDER",
        entityId: w.id ?? w.woNumber,
        canonicalIdentity: { woNumber: w.woNumber ?? null, id: w.id ?? null },
      });
    }
  }
  for (const l of candidates.locations ?? []) {
    // A LocationRef is only canonical with a governed type — a bare id is not.
    if (eq(l.locationId, token) && INVENTORY_LOCATION_TYPES.includes(l.type)) {
      matches.push({
        entityType: "INVENTORY_LOCATION",
        entityId: l.locationId,
        canonicalIdentity: { type: l.type, locationId: l.locationId },
      });
    }
  }
  for (const e of candidates.equipment ?? []) {
    if (eq(e.equipmentId, token) || eq(e.serialNumber, token)) {
      matches.push({
        entityType: "EQUIPMENT",
        entityId: e.equipmentId,
        canonicalIdentity: { equipmentId: e.equipmentId ?? null, serialNumber: e.serialNumber ?? null },
      });
    }
  }

  if (matches.length === 0) {
    // A well-formed Work Order number that matched nothing is still NOT_FOUND,
    // never a fabricated Work Order identity. `looksLike` is a presentation
    // hint for the error message only — it confers nothing.
    return identity(SCAN_RESOLUTION.NOT_FOUND, {
      token,
      looksLike: WO_NUMBER.test(token) ? "WORK_ORDER" : null,
    });
  }

  // Deduplicate identical (type,id) hits before declaring ambiguity, so the same
  // entity appearing in two candidate lists is not a false ambiguity.
  const unique = [];
  const seen = new Set();
  for (const m of matches) {
    const k = `${m.entityType}:${String(m.entityId).toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(m);
  }

  if (unique.length > 1) return identity(SCAN_RESOLUTION.AMBIGUOUS, { token, candidates: unique });
  return identity(SCAN_RESOLUTION.RESOLVED, { token, ...unique[0] });
}
