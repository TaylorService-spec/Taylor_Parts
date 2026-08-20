// PART IDENTIFIERS — pure contract for the Barcodes & Identifiers administration surface.
// No I/O, no JSX, unit-tested.
//
// This module MIRRORS the server's rules so the form can refuse an obviously-invalid value before
// spending a round trip, and can say WHY. It is not the authority and never becomes one: the trusted
// command re-validates everything (functions/src/partMaster/normalization.ts), and where this file
// and the server disagree, the server is right and the surface reports what it said.
//
// The mirror is deliberately CONSERVATIVE — it only refuses what the server certainly refuses
// (empty, over-length, non-digit GS1, wrong GS1 length, MANUFACTURER_PN without a manufacturer). It
// never accepts-and-assumes; anything it is unsure about is sent, and the server decides.

/** Alias types, in the order the form offers them. Mirrors functions/src/partMaster/types.ts. */
export const ALIAS_TYPES = Object.freeze([
  "INTERNAL_PN",
  "MANUFACTURER_PN",
  "SUPPLIER_SKU",
  "UPC",
  "EAN",
  "GTIN",
  "LEGACY",
  "CUSTOMER_REF",
  "VENDOR_REF",
  "BARCODE_OTHER",
]);

// Plain-language labels. The stored value is the enum; a person should never have to read
// `BARCODE_OTHER` to understand what they are choosing.
export const ALIAS_TYPE_LABEL = Object.freeze({
  INTERNAL_PN: "Internal part number",
  MANUFACTURER_PN: "Manufacturer part number",
  SUPPLIER_SKU: "Supplier SKU",
  UPC: "UPC barcode",
  EAN: "EAN barcode",
  GTIN: "GTIN barcode",
  LEGACY: "Legacy identifier",
  CUSTOMER_REF: "Customer reference",
  VENDOR_REF: "Vendor reference",
  BARCODE_OTHER: "Other barcode",
});

/** Mirrors normalization.ts's MAX_IDENTIFIER_LENGTH. */
export const MAX_IDENTIFIER_LENGTH = 120;

/** Mirrors normalization.ts's NUMERIC_LENGTHS — the GS1 symbologies and their exact digit counts. */
export const GS1_DIGIT_LENGTHS = Object.freeze({
  UPC: [12],
  EAN: [13],
  GTIN: [8, 12, 13, 14],
});

/**
 * MANUFACTURER_PN is scoped per manufacturer — the same part number from two manufacturers is two
 * different identifiers, and the normalized value embeds the manufacturer. So the field is required
 * for that type and meaningless for every other.
 */
export function requiresManufacturer(aliasType) {
  return aliasType === "MANUFACTURER_PN";
}

/**
 * Validate a draft identifier against the mirrored rules.
 *
 * @returns {{ valid: true } | { valid: false, field: string, message: string }}
 */
export function validateIdentifierDraft({ aliasType, rawValue, manufacturerId } = {}) {
  if (!ALIAS_TYPES.includes(aliasType)) {
    return { valid: false, field: "aliasType", message: "Choose an identifier type." };
  }
  const value = typeof rawValue === "string" ? rawValue : "";
  if (value.trim().length === 0) {
    return { valid: false, field: "rawValue", message: "Enter the identifier value." };
  }
  if (value.length > MAX_IDENTIFIER_LENGTH) {
    return {
      valid: false,
      field: "rawValue",
      message: `That is longer than ${MAX_IDENTIFIER_LENGTH} characters.`,
    };
  }
  const lengths = GS1_DIGIT_LENGTHS[aliasType];
  if (lengths) {
    // Separators are allowed and stripped; leading zeroes are meaningful, so this stays in the
    // string domain and never becomes a number.
    const digits = value.replace(/[\s-]/g, "");
    if (!/^\d+$/.test(digits)) {
      return {
        valid: false,
        field: "rawValue",
        message: `${ALIAS_TYPE_LABEL[aliasType]} must be digits only (spaces and hyphens are allowed).`,
      };
    }
    if (!lengths.includes(digits.length)) {
      return {
        valid: false,
        field: "rawValue",
        message: `${ALIAS_TYPE_LABEL[aliasType]} must be ${lengths.join(" or ")} digits — that one has ${digits.length}.`,
      };
    }
  }
  if (requiresManufacturer(aliasType) && !(typeof manufacturerId === "string" && manufacturerId.trim())) {
    return {
      valid: false,
      field: "manufacturerId",
      message: "A manufacturer part number needs the manufacturer it belongs to.",
    };
  }
  return { valid: true };
}

/**
 * Outcome vocabulary for the alias callables, keyed by the DOMAIN code the adapter puts in
 * `details` (partAliasCallables.ts's mapError).
 *
 * Each one exists because the generic HttpsError message was wrong rather than merely vague:
 *   ALIAS_CONFLICT      — the identifier is taken. Not a validation failure; the value is fine and
 *                         belongs to something. The surface has the list and can say which.
 *   VERSION_CONFLICT    — someone else changed this identifier. Not a malformed request.
 *   IDEMPOTENCY_CONFLICT— the same key was reused for a different request. A client bug, said plainly.
 *   DENIED              — capability, not correctness.
 */
export const IDENTIFIER_OUTCOMES = Object.freeze({
  ALIAS_CONFLICT: {
    kind: "conflict",
    message: "That identifier is already recorded. Check the list below — it may be inactive on this part, or in use by another part.",
  },
  VERSION_CONFLICT: {
    kind: "conflict",
    message: "Someone else changed this identifier while you were looking at it. Reload and try again.",
  },
  IDEMPOTENCY_CONFLICT: {
    kind: "error",
    message: "That request was already used for something different. Reload and try again.",
  },
  DENIED: { kind: "denied", message: "You are not authorized to manage part identifiers." },
  NOT_FOUND: { kind: "notFound", message: "That identifier no longer exists. Reload the list." },
  INVALID: { kind: "invalid", message: "That request was rejected — check the value and try again." },
  INTERNAL: { kind: "error", message: "The request could not be completed. Try again." },
});

const CODE_OUTCOMES = Object.freeze({
  unauthenticated: { kind: "denied", message: "You must be signed in." },
  "permission-denied": IDENTIFIER_OUTCOMES.DENIED,
  "already-exists": IDENTIFIER_OUTCOMES.ALIAS_CONFLICT,
  aborted: IDENTIFIER_OUTCOMES.VERSION_CONFLICT,
  "not-found": IDENTIFIER_OUTCOMES.NOT_FOUND,
  "invalid-argument": IDENTIFIER_OUTCOMES.INVALID,
});

export function outcomeFromErrorCode(code, detail = null) {
  return (
    (detail ? IDENTIFIER_OUTCOMES[detail] : null) ??
    CODE_OUTCOMES[code] ??
    IDENTIFIER_OUTCOMES.INTERNAL
  );
}

/**
 * SCAN-TO-TEST result, in words.
 *
 * `INACTIVE` is deliberately never collapsed into `NOT_FOUND`. "Registered but switched off" and
 * "never registered" call for different fixes — reactivate one, create the other — and telling an
 * administrator the wrong one sends them to do the wrong thing.
 */
export function describeProbe(result, { partId } = {}) {
  if (!result || typeof result !== "object") {
    return { tone: "error", message: "The test could not be completed." };
  }
  switch (result.result) {
    case "FOUND":
      return result.partId === partId
        ? { tone: "ok", message: "Scanning this resolves to THIS part. Correct." }
        : { tone: "attention", message: `Scanning this resolves to a DIFFERENT part (${result.partId}).` };
    case "INACTIVE":
      return {
        tone: "attention",
        message:
          result.partId === partId
            ? "This identifier is registered to this part but is INACTIVE, so a scan will not resolve it. Reactivate it below."
            : `This identifier is registered to a different part (${result.partId}) and is inactive.`,
      };
    case "NOT_FOUND":
      return { tone: "attention", message: "Nothing is registered for that value — a scan would not find it." };
    case "MALFORMED":
      return { tone: "attention", message: "That value is not a usable identifier of the chosen type." };
    case "CONFLICT":
      return { tone: "error", message: "That value resolves ambiguously. Report this — it should not be possible." };
    default:
      return { tone: "error", message: "The test could not be completed." };
  }
}
