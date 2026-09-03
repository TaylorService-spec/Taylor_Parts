// BIN LABEL — a governed Bin, projected into the thing that goes on the rack.
// PURE: no React, no Firebase, no clock, no persistence, no side effects.
//
// ============================ A LABEL IS A RENDERING, NOT A RECORD ============================
//
// There is no label collection, no template store and no printed-label registry, and P5 does not add
// one. The durable authority for where things are is `bins/{binId}` and nothing else. The moment a
// label store exists it becomes a SECOND answer to "where is A01-003?", and the two drift the first
// time one is written without the other -- which is exactly what `stock_locations` did, and what
// BIN-P2/P2R spent two phases removing.
//
// A label is a photograph of a bin. Not a copy of it.
//
// ============================ TWO IDENTITIES, ON PURPOSE ============================
//
//   HUMAN   "A01-003"              warehouse-scoped, MUTABLE (renameBin corrects a mislabelled rack)
//   MACHINE "EOS-LOC:bin_5f3a…"    globally unique, STABLE for the life of the bin
//
// The machine token derives from `binId` and from NOTHING else -- not the code, the area, the aisle,
// the bay or the position. That single choice is what lets a barcode already stuck to a shelf keep
// resolving after a rename. A token derived from the human code would silently invalidate every
// printed label in the building the first time someone corrected a typo.
//
// ============================ THE SCANNER NEEDS NO CHANGE ============================
//
// domain/scannedIdentity.js strips vendor prefixes with
//   /^(TAYLOR|EOS)[-_:](PART|ASSET|WO|LOC|EQUIP)?[-_:]?/i
// so "EOS-LOC:bin_x" already normalizes to "bin_x", which resolveBinFromToken already accepts and
// answers with { type: "BIN", locationId: binId }. This module therefore defines no second parser
// and modifies no scanner code; the round trip is proved in test rather than assumed.

/** The prefix the shared scan normalizer already understands. Not a new vocabulary. */
export const BIN_SCAN_TOKEN_PREFIX = "EOS-LOC:";

/**
 * The barcode payload for one bin.
 *
 * Deterministic and total: the same binId always yields the same token, which is what makes a
 * reprinted label identical to the original.
 */
export function toBinScanToken(binId) {
  return `${BIN_SCAN_TOKEN_PREFIX}${binId}`;
}

/**
 * Project one governed bin into a label.
 *
 * `canonicalCode` is COPIED from the server's `code`, never re-derived. The formatter is
 * server-owned (BIN-P1); a client that re-renders the code introduces a second formatter that can
 * disagree with the registry, which is the same class of defect P3's trusted preview exists to
 * prevent.
 *
 * `warehouse` is optional display context from the governed warehouse read the Administration screen
 * already performs. Absent is fine -- the label just carries less context.
 */
export function buildBinLabel(bin, warehouse = null) {
  return Object.freeze({
    binId: bin.binId,
    warehouseId: warehouse?.id ?? null,
    warehouseName: warehouse?.name ?? null,
    area: bin.area,
    aisle: bin.aisle,
    bay: bin.bay,
    position: bin.position,
    canonicalCode: bin.code,
    machineToken: toBinScanToken(bin.binId),
    status: bin.status,
  });
  // Deliberately absent: idempotencyKey, fingerprint, claim data, audit fields, and any quantity.
  // listBins does not return the first three, so this is structural rather than a matter of care.
}

/**
 * Total, deterministic order — the same for the preview and the CSV.
 *
 * Bay and position sort NUMERICALLY. A string sort puts bay 10 before bay 2, which is wrong in the
 * one place an operator walks the aisle in order. The binId tie-breaker makes the order total, and a
 * total order is what makes a repeated export byte-identical.
 */
export function sortBinLabels(labels) {
  return [...labels].sort((a, b) =>
    String(a.area ?? "").localeCompare(String(b.area ?? ""), "en")
    || String(a.aisle ?? "").localeCompare(String(b.aisle ?? ""), "en")
    || (a.bay ?? 0) - (b.bay ?? 0)
    || (a.position ?? 0) - (b.position ?? 0)
    || String(a.binId).localeCompare(String(b.binId), "en"));
}

/**
 * Project a list of bins.
 *
 * ACTIVE only by default. Nobody wants a wall of labels for shelves that are out of service, and a
 * label that looks operational for a retired location is worse than no label at all -- so including
 * them is an explicit choice, and the preview marks them.
 */
export function buildBinLabels(bins, { warehouse = null, includeInactive = false } = {}) {
  const kept = includeInactive ? bins : bins.filter((b) => b.status === "ACTIVE");
  return sortBinLabels(kept.map((b) => buildBinLabel(b, warehouse)));
}

// ═══════════════════════════════════ CSV ═══════════════════════════════════

/**
 * The exported columns.
 *
 * `name` is deliberately absent. It is the one free-form, operator-typed field on a bin, and leaving
 * it out removes the formula-injection surface entirely rather than mitigating it. Nothing about a
 * label needs it.
 */
export const BIN_LABEL_CSV_COLUMNS = Object.freeze([
  "warehouseId", "binId", "area", "aisle", "bay", "position", "code", "scanToken", "status",
]);

/**
 * Neutralize a value a spreadsheet might execute.
 *
 * CSV is an executable-adjacent format: a leading =, +, - or @ can be read as a formula. Governed bin
 * fields are structurally validated and should never start with those -- but "should never" is not a
 * control, and this costs one comparison.
 */
function neutralizeFormula(text) {
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

/** RFC 4180: quote when the value contains a comma, quote, CR or LF; double embedded quotes. */
function csvField(value) {
  const text = neutralizeFormula(value === null || value === undefined ? "" : String(value));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Serialize labels to deterministic UTF-8 CSV.
 *
 * There is deliberately NO timestamp in the body. A timestamp would make every export differ from the
 * last, destroying the one useful property of a stable export: diff two of them and see what actually
 * changed about the racking.
 */
export function labelsToCsv(labels) {
  const rows = [BIN_LABEL_CSV_COLUMNS.join(",")];
  for (const l of sortBinLabels(labels)) {
    rows.push([
      csvField(l.warehouseId), csvField(l.binId), csvField(l.area), csvField(l.aisle),
      csvField(l.bay), csvField(l.position), csvField(l.canonicalCode),
      csvField(l.machineToken), csvField(l.status),
    ].join(","));
  }
  return `${rows.join("\r\n")}\r\n`;
}

/**
 * A safe download filename.
 *
 * A free-form warehouse identity never reaches the filesystem unsanitized: no path separator, no
 * leading dot, bounded length.
 */
export function binLabelCsvFilename(warehouseId) {
  const safe = String(warehouseId ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `bin-labels-${safe === "" ? "warehouse" : safe}.csv`;
}
