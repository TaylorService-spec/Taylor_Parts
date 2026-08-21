// DESCRIPTIVE BIN REGISTRY — bin identity, and nothing else. PURE: no Firestore, no I/O.
//
// ============================ A BIN DESCRIBES; THE WAREHOUSE OWNS ============================
//
// DECISIONS #116. The warehouse is the inventory custody authority. A bin is a descriptive physical
// sub-location within one — a place to look, not a place stock belongs to.
//
// The invariant that decision protects: PUTTING STOCK INTO A BIN MUST NOT REMOVE IT FROM WAREHOUSE
// ON-HAND OR AVAILABLE. Every governed authority — availability, receiving, transfer, cycle count —
// counts a movement only at `type === "WAREHOUSE"`. If a bin were a custody location, the moment a
// receipt was put away it would vanish from sellable stock.
//
// So this registry deliberately does NOT:
//   • produce a LocationRef of type BIN, or anything a movement command would accept as a location;
//   • carry a quantity, a balance, a reservation or any stock figure;
//   • establish a hierarchy that anything rolls up through.
//
// It answers one question: "is BIN-14 a real, active place in warehouse WH-1?" A test asserts the
// module never emits a BIN location reference, because that is the shape that would let a bin leak
// into custody math.
//
// ============================ DUPLICATES ARE STRUCTURALLY IMPOSSIBLE ============================
//
// The document id is derived from (warehouseId, normalized code), so two bins with the same code in
// the same warehouse are the same document. A uniqueness CHECK could race; a derived id cannot.
// The same discipline part_aliases already uses.

/** A bin is active or retired. Retiring keeps history readable; nothing is ever deleted. */
export const BIN_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type BinStatus = (typeof BIN_STATUSES)[number];

/**
 * Bin codes as they appear on a warehouse label: letters, digits, and the separators people
 * actually paint on racking. No spaces after normalization, and nothing that could be mistaken for
 * a path segment or an id delimiter.
 */
const BIN_CODE_PATTERN = /^[A-Z0-9][A-Z0-9.\-_]{0,31}$/;
const MAX_BIN_NAME = 120;

export interface BinValue {
  readonly warehouseId: string;
  /** The normalized, canonical code. Upper-case, whitespace collapsed away. */
  readonly code: string;
  /** What was typed, preserved so a label can be reprinted exactly as it reads. */
  readonly originalCode: string;
  /** Optional human name ("Bulk rack, north wall"). Never used for matching. */
  readonly name: string | null;
  readonly status: BinStatus;
}

export type Result<T> =
  | { readonly valid: true; readonly value: T; readonly reason: null }
  | { readonly valid: false; readonly value: null; readonly reason: string };

const invalid = (reason: string): Result<never> => ({ valid: false, value: null, reason });

/**
 * Normalize a bin code to its canonical form.
 *
 * Collapses whitespace and upper-cases — a label reading "a-14" and one reading "A-14" are the same
 * physical rack, and treating them as two bins would split a shelf in half in the data.
 *
 * NO other coercion: a code with unsupported characters is rejected rather than stripped, because
 * silently deleting a character produces a code that will never match the label on the wall.
 */
export function normalizeBinCode(raw: unknown): Result<{ code: string; originalCode: string }> {
  if (typeof raw !== "string") return invalid("code_required");
  const originalCode = raw.trim();
  if (originalCode === "") return invalid("code_required");
  const code = originalCode.replace(/\s+/g, "").toUpperCase();
  if (!BIN_CODE_PATTERN.test(code)) return invalid("code_invalid");
  return { valid: true, value: { code, originalCode }, reason: null };
}

/** Warehouse ids are used as a document-id segment, so they must be safe as one. */
export function isSafeIdSegment(value: unknown): value is string {
  return typeof value === "string"
    && value.trim() !== ""
    && value.length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

/**
 * The deterministic document id for a bin.
 *
 * Two bins with the same code in the same warehouse ARE the same document — a duplicate cannot be
 * created because there is nowhere for a second one to go. The warehouse is part of the id, so the
 * same code in two warehouses is two different bins, which is how racking is actually labelled.
 */
export function deriveBinDocId(warehouseId: string, code: string): string {
  return `bin_${warehouseId}__${code}`;
}

/**
 * Validate a bin creation request against the warehouses that actually exist.
 *
 * SCOPE VALIDATION IS NOT OPTIONAL: a bin in a warehouse that does not exist is a place nobody can
 * go, and it would accept put-aways forever without anyone noticing.
 */
export function validateBinDraft(
  input: unknown,
  knownWarehouseIds: ReadonlySet<string>,
): Result<BinValue> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid("not_object");
  const draft = input as Record<string, unknown>;

  if (!isSafeIdSegment(draft.warehouseId)) return invalid("warehouse_invalid");
  if (!knownWarehouseIds.has(draft.warehouseId)) return invalid("warehouse_unknown");

  const normalized = normalizeBinCode(draft.code);
  if (!normalized.valid) return invalid(normalized.reason);

  let name: string | null = null;
  if (draft.name !== undefined && draft.name !== null) {
    if (typeof draft.name !== "string") return invalid("name_invalid");
    const trimmed = draft.name.trim();
    if (trimmed.length > MAX_BIN_NAME) return invalid("name_too_long");
    name = trimmed === "" ? null : trimmed;
  }

  return {
    valid: true,
    reason: null,
    value: {
      warehouseId: draft.warehouseId,
      code: normalized.value.code,
      originalCode: normalized.value.originalCode,
      name,
      status: "ACTIVE",
    },
  };
}

/** Why a scanned bin cannot be used as a put-away destination. */
export type BinResolution =
  | { readonly result: "FOUND"; readonly binId: string; readonly warehouseId: string; readonly code: string }
  | { readonly result: "INACTIVE"; readonly binId: string; readonly warehouseId: string; readonly code: string }
  | { readonly result: "NOT_FOUND" }
  | { readonly result: "WRONG_WAREHOUSE"; readonly binId: string; readonly warehouseId: string }
  | { readonly result: "MALFORMED"; readonly detail: string };

/**
 * Resolve a scanned bin code within a warehouse, from an already-read record.
 *
 * PURE — the caller supplies the stored bin, so this is the same decision whether it runs in a
 * command's transaction or in a read service, and the two can never disagree.
 *
 * WRONG_WAREHOUSE is its own answer rather than NOT_FOUND: a real bin at the wrong site means the
 * operator is standing in the wrong building, which is a different problem from a code nobody
 * registered, and it is the one an operator most needs told plainly.
 */
export function resolveBin(
  rawCode: unknown,
  expectedWarehouseId: string,
  stored: { readonly warehouseId?: unknown; readonly code?: unknown; readonly status?: unknown } | null,
): BinResolution {
  const normalized = normalizeBinCode(rawCode);
  if (!normalized.valid) return { result: "MALFORMED", detail: normalized.reason };
  if (stored === null) return { result: "NOT_FOUND" };

  const warehouseId = typeof stored.warehouseId === "string" ? stored.warehouseId : "";
  const code = typeof stored.code === "string" ? stored.code : "";
  if (warehouseId === "" || code === "") return { result: "MALFORMED", detail: "stored bin is unreadable" };

  const binId = deriveBinDocId(warehouseId, code);
  if (warehouseId !== expectedWarehouseId) return { result: "WRONG_WAREHOUSE", binId, warehouseId };

  const status = (BIN_STATUSES as readonly string[]).includes(stored.status as string) ? (stored.status as BinStatus) : null;
  // An unrecognized status fails closed as INACTIVE rather than being treated as usable: a bin whose
  // state cannot be read is not a bin anyone should be told to put stock into.
  if (status !== "ACTIVE") return { result: "INACTIVE", binId, warehouseId, code };

  return { result: "FOUND", binId, warehouseId, code };
}
