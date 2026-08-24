// THE FIELD METADATA CONTRACT — what a business field IS, before any screen renders one.
//
// ============================ WHY A CONTRACT AND NOT A CONFIG BLOB ============================
//
// A list needs to know: can this be filtered, sorted, searched, reported, exported? With which
// operators? Under whose authority? What happens when it does not resolve?
//
// Every screen answering those for itself is how a platform ends up with a Status column that filters
// on one list, sorts nonsensically on another, and is missing from the third. So the answers live
// once, per field, and the UI READS them. `+ Add Filter` is not a hardcoded array anywhere — it is a
// projection of this metadata.
//
// The declarations are VALIDATED (`validateField`), because a free-form blob nobody checks is a
// config file that silently rots.
//
// ============================ THE HONESTY RULE ============================
//
// `filterable` and `sortable` describe what the QUERY LAYER can actually do at scale, not what would
// be nice. Firestore is not relational: a field on a related object usually cannot be filtered or
// sorted server-side without a projection that does not exist yet.
//
// Where that is true the field is declared `sortable: false` with a stated reason, and the UI simply
// does not offer it. The alternative — offering it and fetching the whole collection to sort in the
// browser — works on a demo and dies on a real customer.
//
// PURE. No I/O, no JSX.

/** Where a field comes from. Decides who owns it, and who must authorize reading it. */
export const FIELD_CATEGORY = Object.freeze({
  /** A native attribute of the object. */
  OWNED: "OWNED",
  /** Owned by another object, exposed through an explicitly approved relationship. */
  RELATED: "RELATED",
  /** Calculated from authoritative facts. Never stored as a second source of truth. */
  DERIVED: "DERIVED",
  /** An authoritative financial value. Its own category because its authority is its own. */
  FINANCIAL: "FINANCIAL",
});

/** What a value IS, which is what decides how it may be compared and ordered. */
export const FIELD_TYPE = Object.freeze({
  STRING: "STRING",
  /** A business identifier a person reads and searches by: WO-2026-0001, a SKU, a serial. */
  IDENTIFIER: "IDENTIFIER",
  ENUM: "ENUM",
  DATE: "DATE",
  DATETIME: "DATETIME",
  NUMBER: "NUMBER",
  QUANTITY: "QUANTITY",
  CURRENCY: "CURRENCY",
  BOOLEAN: "BOOLEAN",
  PERSON: "PERSON",
  /** A reference to another business object, displayed by its human identity. */
  OBJECT_REF: "OBJECT_REF",
  LOCATION: "LOCATION",
  SERIAL: "SERIAL",
});

/**
 * Operators, in the user's language.
 *
 * Firestore's own vocabulary (`==`, `array-contains`, `>=`) never reaches a person. The query layer
 * translates; the UI offers these.
 */
export const OPERATOR = Object.freeze({
  IS: "IS",
  IS_NOT: "IS_NOT",
  IN: "IN",
  CONTAINS: "CONTAINS",
  STARTS_WITH: "STARTS_WITH",
  GREATER_THAN: "GREATER_THAN",
  LESS_THAN: "LESS_THAN",
  BETWEEN: "BETWEEN",
  BEFORE: "BEFORE",
  AFTER: "AFTER",
  /** "This week", "last 30 days" — resolved to a real range by the query layer, never stored. */
  RELATIVE: "RELATIVE",
  IS_EMPTY: "IS_EMPTY",
});

export const OPERATOR_LABEL = Object.freeze({
  [OPERATOR.IS]: "is",
  [OPERATOR.IS_NOT]: "is not",
  [OPERATOR.IN]: "is any of",
  [OPERATOR.CONTAINS]: "contains",
  [OPERATOR.STARTS_WITH]: "starts with",
  [OPERATOR.GREATER_THAN]: "greater than",
  [OPERATOR.LESS_THAN]: "less than",
  [OPERATOR.BETWEEN]: "between",
  [OPERATOR.BEFORE]: "before",
  [OPERATOR.AFTER]: "after",
  [OPERATOR.RELATIVE]: "is",
  [OPERATOR.IS_EMPTY]: "is empty",
});

/**
 * Which operators a TYPE admits.
 *
 * Derived from the type rather than declared per field, so a date on one object cannot end up
 * offering different comparisons from a date on another. A field may NARROW this list; it may not
 * widen it.
 */
export const OPERATORS_FOR_TYPE = Object.freeze({
  [FIELD_TYPE.STRING]: [OPERATOR.IS, OPERATOR.CONTAINS, OPERATOR.STARTS_WITH, OPERATOR.IS_EMPTY],
  [FIELD_TYPE.IDENTIFIER]: [OPERATOR.IS, OPERATOR.STARTS_WITH, OPERATOR.CONTAINS],
  [FIELD_TYPE.ENUM]: [OPERATOR.IS, OPERATOR.IS_NOT, OPERATOR.IN],
  [FIELD_TYPE.DATE]: [OPERATOR.IS, OPERATOR.BEFORE, OPERATOR.AFTER, OPERATOR.BETWEEN, OPERATOR.RELATIVE],
  [FIELD_TYPE.DATETIME]: [OPERATOR.BEFORE, OPERATOR.AFTER, OPERATOR.BETWEEN, OPERATOR.RELATIVE],
  [FIELD_TYPE.NUMBER]: [OPERATOR.IS, OPERATOR.GREATER_THAN, OPERATOR.LESS_THAN, OPERATOR.BETWEEN],
  [FIELD_TYPE.QUANTITY]: [OPERATOR.IS, OPERATOR.GREATER_THAN, OPERATOR.LESS_THAN, OPERATOR.BETWEEN],
  [FIELD_TYPE.CURRENCY]: [OPERATOR.IS, OPERATOR.GREATER_THAN, OPERATOR.LESS_THAN, OPERATOR.BETWEEN],
  [FIELD_TYPE.BOOLEAN]: [OPERATOR.IS],
  [FIELD_TYPE.PERSON]: [OPERATOR.IS, OPERATOR.IS_NOT, OPERATOR.IN],
  [FIELD_TYPE.OBJECT_REF]: [OPERATOR.IS, OPERATOR.IS_NOT, OPERATOR.IN],
  [FIELD_TYPE.LOCATION]: [OPERATOR.IS, OPERATOR.IS_NOT, OPERATOR.IN],
  [FIELD_TYPE.SERIAL]: [OPERATOR.IS, OPERATOR.STARTS_WITH, OPERATOR.CONTAINS],
});

/**
 * How a type is ordered, in the words a person would choose.
 *
 * Note what ENUM does NOT get. Sorting statuses alphabetically puts CANCELLED before WORK_IN_PROGRESS
 * and calls it order — so a status field is sortable ONLY when it declares an explicit business
 * sequence. See `statusOrder` below.
 */
export const SORT_LABELS = Object.freeze({
  [FIELD_TYPE.DATE]: { asc: "Oldest first", desc: "Newest first" },
  [FIELD_TYPE.DATETIME]: { asc: "Oldest first", desc: "Newest first" },
  [FIELD_TYPE.NUMBER]: { asc: "Low to high", desc: "High to low" },
  [FIELD_TYPE.QUANTITY]: { asc: "Low to high", desc: "High to low" },
  [FIELD_TYPE.CURRENCY]: { asc: "Low to high", desc: "High to low" },
  [FIELD_TYPE.STRING]: { asc: "A to Z", desc: "Z to A" },
  [FIELD_TYPE.IDENTIFIER]: { asc: "A to Z", desc: "Z to A" },
  [FIELD_TYPE.PERSON]: { asc: "A to Z", desc: "Z to A" },
  [FIELD_TYPE.OBJECT_REF]: { asc: "A to Z", desc: "Z to A" },
  [FIELD_TYPE.LOCATION]: { asc: "A to Z", desc: "Z to A" },
  [FIELD_TYPE.SERIAL]: { asc: "A to Z", desc: "Z to A" },
  [FIELD_TYPE.ENUM]: { asc: "First to last", desc: "Last to first" },
  [FIELD_TYPE.BOOLEAN]: { asc: "No first", desc: "Yes first" },
});

/** Why a field cannot be filtered or sorted at scale. Stated, never silently omitted. */
export const UNSUPPORTED_REASON = Object.freeze({
  /** The value lives on another document and is not projected onto this one. */
  NOT_PROJECTED: "NOT_PROJECTED",
  /** Computed on read; there is nothing stored to order by. */
  DERIVED_AT_READ: "DERIVED_AT_READ",
  /** No business ordering exists, and alphabetical would be nonsense. */
  NO_CANONICAL_ORDER: "NO_CANONICAL_ORDER",
  /** Would need a composite index that does not exist. */
  NEEDS_INDEX: "NEEDS_INDEX",
  /** The value does not exist anywhere yet. */
  NO_AUTHORITY: "NO_AUTHORITY",
});

export const UNSUPPORTED_TEXT = Object.freeze({
  [UNSUPPORTED_REASON.NOT_PROJECTED]: "lives on a related record and is not copied onto this one",
  [UNSUPPORTED_REASON.DERIVED_AT_READ]: "is calculated when the list is read, so there is nothing stored to order by",
  [UNSUPPORTED_REASON.NO_CANONICAL_ORDER]: "has no agreed business order, and alphabetical would be misleading",
  [UNSUPPORTED_REASON.NEEDS_INDEX]: "needs a database index that has not been created",
  [UNSUPPORTED_REASON.NO_AUTHORITY]: "does not exist as an authoritative value yet",
});

const isNonBlank = (v) => typeof v === "string" && v.trim() !== "";

/**
 * Declare one field.
 *
 * @param id            stable, dotted for related fields: `customer.name`.
 * @param object        the object that OWNS the list this appears on.
 * @param category      FIELD_CATEGORY.
 * @param type          FIELD_TYPE — decides operators and sort vocabulary.
 * @param label         what a person calls it. Never the storage key.
 * @param source        where the value comes from, for a reader tracing it back.
 * @param relatedObject for RELATED fields, the object that owns the value.
 * @param filterable / sortable   what the QUERY LAYER can do, not what would be nice.
 * @param unsupportedFilterReason / unsupportedSortReason   required when the above are false.
 * @param capability    the capability a caller must hold to see it at all. Null = no extra gate
 *                      beyond reading the object itself.
 * @param statusOrder   for ENUMs: the business sequence. Its presence is what makes one sortable.
 * @param align         presentation only. Currency and quantity right-align; nothing else should.
 */
export function defineField({
  id, object, category, type, label,
  source = null, relatedObject = null,
  displayable = true, filterable = false, sortable = false,
  searchable = false, groupable = false, reportable = true, exportable = true,
  defaultVisible = false, align = "left", formatter = null,
  unresolvedText = null, capability = null, statusOrder = null,
  operators = null, unsupportedFilterReason = null, unsupportedSortReason = null,
  description = null,
} = {}) {
  const errors = [];
  if (!isNonBlank(id)) errors.push("id required");
  if (!isNonBlank(label)) errors.push("label required");
  if (!Object.values(FIELD_CATEGORY).includes(category)) errors.push(`unknown category ${category}`);
  if (!Object.values(FIELD_TYPE).includes(type)) errors.push(`unknown type ${type}`);
  if (category === FIELD_CATEGORY.RELATED && !isNonBlank(relatedObject)) {
    errors.push("a RELATED field must name the object that owns it");
  }
  // The honesty rule, enforced: an unsupported capability must say WHY. Without this the metadata
  // quietly becomes a list of things that mysteriously do not work.
  if (!filterable && unsupportedFilterReason === null && category !== FIELD_CATEGORY.DERIVED) {
    // Derived fields are commonly display-only and need no excuse; everything else does.
    errors.push(`${id}: filterable:false must state a reason`);
  }
  if (!sortable && unsupportedSortReason === null && category !== FIELD_CATEGORY.DERIVED) {
    errors.push(`${id}: sortable:false must state a reason`);
  }
  const allowed = OPERATORS_FOR_TYPE[type] ?? [];
  const declared = operators ?? allowed;
  // A field may NARROW its type's operators. It may never widen them — that is how one list ends up
  // offering "contains" on a date.
  const widened = declared.filter((op) => !allowed.includes(op));
  if (widened.length > 0) errors.push(`${id}: operators ${widened.join(", ")} are not valid for ${type}`);
  if (type === FIELD_TYPE.ENUM && sortable && !Array.isArray(statusOrder)) {
    errors.push(`${id}: an ENUM is sortable only with an explicit statusOrder — alphabetical status order is nonsense`);
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value: Object.freeze({
      id, object, category, type, label, source, relatedObject,
      displayable, filterable, sortable, searchable, groupable, reportable, exportable,
      defaultVisible, align, formatter, unresolvedText, capability,
      statusOrder: statusOrder ? Object.freeze([...statusOrder]) : null,
      operators: Object.freeze(declared),
      unsupportedFilterReason, unsupportedSortReason, description,
    }),
  };
}

/**
 * Build an object's field set, refusing an invalid declaration loudly.
 *
 * Throwing at module load is deliberate: a malformed field contract is a build-time mistake, and
 * discovering it when somebody opens a filter menu in production is far worse than a failed import.
 */
export function defineObjectFields(objectName, declarations) {
  const fields = [];
  const problems = [];
  for (const d of declarations) {
    const built = defineField({ ...d, object: objectName });
    if (!built.valid) problems.push(...built.errors);
    else fields.push(built.value);
  }
  if (problems.length > 0) {
    throw new Error(`Invalid field metadata for ${objectName}:\n  ${problems.join("\n  ")}`);
  }
  return Object.freeze(fields);
}

// ============================ READING THE METADATA ============================

/**
 * The fields this caller may actually see.
 *
 * READING THE PARENT DOES NOT AUTHORIZE EVERY RELATED FIELD. A person may see a Work Order and still
 * have no business seeing a financial attribute reached through it, so an unauthorized field is
 * removed here — before it can appear as a column, a filter option, a sort option or an export.
 */
export function visibleFields(fields, { hasCapability = null } = {}) {
  const holds = (capability) => {
    if (!capability) return true;
    try { return typeof hasCapability === "function" && hasCapability(capability) === true; } catch { return false; }
  };
  return Object.freeze((fields ?? []).filter((f) => f.displayable && holds(f.capability)));
}

/** What `+ Add Filter` offers, grouped by the object that owns each field. */
export function filterableFields(fields, options = {}) {
  return Object.freeze(visibleFields(fields, options).filter((f) => f.filterable));
}

export function sortableFields(fields, options = {}) {
  return Object.freeze(visibleFields(fields, options).filter((f) => f.sortable));
}

/**
 * Group fields for the filter menu: the object's own first, then each related object.
 *
 * A flat list of thirty fields is a search problem. Grouped by owner it reads as the business does —
 * "Customer → Business Line" rather than "customerBusinessLine".
 */
export function groupFieldsByOwner(fields, objectLabel = "This record") {
  const groups = new Map();
  for (const f of fields) {
    const owner = f.category === FIELD_CATEGORY.RELATED ? (f.relatedObject ?? "Related") : objectLabel;
    if (!groups.has(owner)) groups.set(owner, []);
    groups.get(owner).push(f);
  }
  return Object.freeze([...groups.entries()].map(([owner, list]) => Object.freeze({
    owner, fields: Object.freeze(list),
  })));
}

/** The sort choices for one field, in the vocabulary its type deserves. */
export function sortOptionsFor(field) {
  const labels = SORT_LABELS[field.type] ?? { asc: "Ascending", desc: "Descending" };
  return Object.freeze([
    { fieldId: field.id, direction: "desc", label: `${field.label} — ${labels.desc}` },
    { fieldId: field.id, direction: "asc", label: `${field.label} — ${labels.asc}` },
  ]);
}

/** Why a field a person expected is not offered — said in words, not omitted in silence. */
export function unsupportedExplanation(field, kind = "filter") {
  const reason = kind === "sort" ? field.unsupportedSortReason : field.unsupportedFilterReason;
  if (!reason) return null;
  return `${field.label} cannot be ${kind === "sort" ? "sorted" : "filtered"} here — it ${UNSUPPORTED_TEXT[reason] ?? "is not supported"}.`;
}
