// EOS Data Import -- portable file intake: parse, detect, map, classify.
//
// PORTABILITY BOUNDARY. Pure module: no firebase-admin, no Firestore, no storage. It
// turns file TEXT into mapped canonical rows and deterministic findings. Whatever data
// plane a customer deploys, this layer is identical -- which is the point of the Owner
// data-plane ruling.
//
// REUSE, NOT REINVENTION. CSV parsing is the repository's existing RFC-4180 house
// parser from partMaster/csvMigrationAnalysis.ts. A second CSV parser in the same repo
// would be a second set of quoting bugs. Its behaviour is already covered by
// test:csvMigrationAnalysis; this module adds only what import needs on top.
//
// The drift rule is taken from the Customer 1 B-06 intake work, which established it
// against a real export: the expected column set is DERIVED from the accepted mapping,
// never written down a second time, because a hand-maintained column list beside a
// mapping table drifts and the drift shows up as a silently dropped column.

import { parseCsv } from "../partMaster/csvMigrationAnalysis.js";
import {
  PART_CANONICAL_FIELDS,
  PART_REQUIRED_FIELDS,
  type CanonicalFieldSpec,
  type FieldFinding,
} from "./contracts/partImportContract.js";

/** P1 entity types. Only PARTS is wired in the first vertical slice. */
export const IMPORT_ENTITY_TYPES = ["PARTS", "CUSTOMERS", "EQUIPMENT", "INVENTORY", "SERVICE_HISTORY"] as const;
export type ImportEntityType = (typeof IMPORT_ENTITY_TYPES)[number];

/** Explicit P1 limits. Stated here so the UI and the backend cannot disagree. */
export const IMPORT_LIMITS = Object.freeze({
  /** Conservative: the payload travels inside a trusted callable request, not Storage. */
  maxFileBytes: 2 * 1024 * 1024,
  maxRows: 5000,
  maxColumns: 100,
  allowedExtensions: Object.freeze([".csv"]),
  allowedContentTypes: Object.freeze(["text/csv", "application/csv", "text/plain"]),
});

export type IntakeFailureCode =
  | "FILE_EMPTY"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_EXTENSION"
  | "NO_HEADER_ROW"
  | "DUPLICATE_COLUMN"
  | "TOO_MANY_COLUMNS"
  | "TOO_MANY_ROWS";

export class IntakeError extends Error {
  readonly code: IntakeFailureCode;
  constructor(code: IntakeFailureCode, message: string) {
    super(message);
    this.name = "IntakeError";
    this.code = code;
  }
}

export interface ParsedSourceFile {
  readonly columns: readonly string[];
  /** Data rows, aligned to `columns`. Excludes the header. */
  readonly rows: readonly (readonly string[])[];
  /** 1-based source line number of each data row, for row-level reporting. */
  readonly sourceRowNumbers: readonly number[];
}

function assertExtension(filename: string): void {
  const lower = filename.toLowerCase();
  if (!IMPORT_LIMITS.allowedExtensions.some((e) => lower.endsWith(e))) {
    throw new IntakeError(
      "UNSUPPORTED_EXTENSION",
      `Only ${IMPORT_LIMITS.allowedExtensions.join(", ")} files are supported in this release. Received "${filename}".`,
    );
  }
}

/**
 * Parse a delimited source file into columns + rows.
 *
 * Deliberately strict about the header: the header row is what tells the mapping which
 * value is which, so a duplicate column name misfiles every value beneath it. That is a
 * file-level refusal, not a row-level warning.
 */
export function parseSourceFile(filename: string, text: string): ParsedSourceFile {
  assertExtension(filename);

  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength > IMPORT_LIMITS.maxFileBytes) {
    throw new IntakeError(
      "FILE_TOO_LARGE",
      `The file is ${byteLength} bytes; this release accepts up to ${IMPORT_LIMITS.maxFileBytes} bytes.`,
    );
  }

  // A UTF-8 BOM would otherwise ride along inside the first header name and silently
  // break the mapping for exactly one column -- the hardest kind of bug to see.
  const cleaned = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const grid = parseCsv(cleaned);
  if (grid.length === 0) throw new IntakeError("FILE_EMPTY", "The file contains no rows.");

  const header = grid[0].map((h) => h.trim());
  if (header.length === 0 || header.every((h) => h === "")) {
    throw new IntakeError("NO_HEADER_ROW", "The first row must be a header row naming each column.");
  }
  if (header.length > IMPORT_LIMITS.maxColumns) {
    throw new IntakeError("TOO_MANY_COLUMNS", `The file has ${header.length} columns; the limit is ${IMPORT_LIMITS.maxColumns}.`);
  }
  const seen = new Set<string>();
  for (const h of header) {
    const key = h.toLowerCase();
    if (h === "") continue;
    if (seen.has(key)) {
      throw new IntakeError("DUPLICATE_COLUMN", `The header names "${h}" more than once. Column names must be unique.`);
    }
    seen.add(key);
  }

  const rows: string[][] = [];
  const sourceRowNumbers: number[] = [];
  for (let i = 1; i < grid.length; i += 1) {
    const r = grid[i];
    // A row of entirely empty cells is spreadsheet padding, not a record.
    if (r.every((c) => c.trim() === "")) continue;
    rows.push(r);
    sourceRowNumbers.push(i + 1); // 1-based, counting the header as line 1
  }

  if (rows.length > IMPORT_LIMITS.maxRows) {
    throw new IntakeError("TOO_MANY_ROWS", `The file has ${rows.length} data rows; this release accepts up to ${IMPORT_LIMITS.maxRows}.`);
  }

  return Object.freeze({
    columns: Object.freeze(header),
    rows: Object.freeze(rows.map((r) => Object.freeze(r))),
    sourceRowNumbers: Object.freeze(sourceRowNumbers),
  });
}

// ---------------------------------------------------------------------------
// Entity detection
// ---------------------------------------------------------------------------

export interface EntityDetection {
  readonly entityType: ImportEntityType | null;
  readonly confidence: number;
  readonly reason: string;
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[\s_\-./]+/g, "");
}

/**
 * Suggest an entity type from the header set.
 *
 * Auto-detection only claims a result when confidence is high; otherwise the admin
 * chooses. A confidently WRONG entity silently misfiles a whole file, so the bar is
 * deliberately set where a near-miss returns null rather than a guess.
 */
export function detectEntityType(columns: readonly string[]): EntityDetection {
  const normalized = columns.map(normalizeHeader);
  const requiredHit = PART_CANONICAL_FIELDS.filter((f) => f.required).filter((f) =>
    f.synonyms.some((s) => normalized.includes(normalizeHeader(s))),
  ).length;
  const requiredTotal = PART_REQUIRED_FIELDS.length;
  const confidence = requiredTotal === 0 ? 0 : requiredHit / requiredTotal;

  if (confidence >= 0.75) {
    return Object.freeze({
      entityType: "PARTS" as const,
      confidence,
      reason: `${requiredHit} of ${requiredTotal} required Part columns were recognised in the header.`,
    });
  }
  return Object.freeze({
    entityType: null,
    confidence,
    reason:
      requiredHit === 0
        ? "No entity could be recognised from the header. Choose the entity type."
        : `Only ${requiredHit} of ${requiredTotal} required Part columns were recognised -- too few to assume. Choose the entity type.`,
  });
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/** null target means the source column is deliberately ignored. */
export type ColumnMapping = Readonly<Record<string, string | null>>;

export interface MappingSuggestion {
  readonly sourceColumn: string;
  readonly canonicalField: string | null;
  readonly confidence: "EXACT" | "SYNONYM" | "NONE";
  readonly sampleValue: string | null;
}

export function canonicalFieldsFor(entityType: ImportEntityType): readonly CanonicalFieldSpec[] {
  // Only PARTS is wired in this slice. Other entities return an empty set rather than a
  // fabricated one, so an unwired entity cannot be mapped by accident.
  return entityType === "PARTS" ? PART_CANONICAL_FIELDS : Object.freeze([]);
}

/**
 * Suggest a mapping. Low-confidence guesses are NEVER applied silently: a column that
 * only weakly resembles a field is returned with canonicalField null so the admin sees
 * an explicit gap instead of a wrong mapping they have to notice.
 */
export function suggestMapping(
  entityType: ImportEntityType,
  parsed: ParsedSourceFile,
): readonly MappingSuggestion[] {
  const fields = canonicalFieldsFor(entityType);
  const taken = new Set<string>();
  const firstRow = parsed.rows[0] ?? [];

  return Object.freeze(
    parsed.columns.map((col, idx) => {
      const sample = firstRow[idx] !== undefined && String(firstRow[idx]).trim() !== "" ? String(firstRow[idx]) : null;
      const norm = normalizeHeader(col);

      const exact = fields.find((f) => !taken.has(f.field) && normalizeHeader(f.field) === norm);
      if (exact) {
        taken.add(exact.field);
        return Object.freeze({ sourceColumn: col, canonicalField: exact.field, confidence: "EXACT" as const, sampleValue: sample });
      }
      const syn = fields.find((f) => !taken.has(f.field) && f.synonyms.some((s) => normalizeHeader(s) === norm));
      if (syn) {
        taken.add(syn.field);
        return Object.freeze({ sourceColumn: col, canonicalField: syn.field, confidence: "SYNONYM" as const, sampleValue: sample });
      }
      return Object.freeze({ sourceColumn: col, canonicalField: null, confidence: "NONE" as const, sampleValue: sample });
    }),
  );
}

export interface MappingValidation {
  readonly valid: boolean;
  readonly findings: readonly FieldFinding[];
  readonly mappedFields: readonly string[];
  readonly ignoredColumns: readonly string[];
}

/** Validate a proposed mapping against the entity's canonical fields. */
export function validateMapping(entityType: ImportEntityType, parsed: ParsedSourceFile, mapping: ColumnMapping): MappingValidation {
  const fields = canonicalFieldsFor(entityType);
  const findings: FieldFinding[] = [];
  const mapped: string[] = [];
  const ignored: string[] = [];
  const usedBy = new Map<string, string[]>();

  for (const col of parsed.columns) {
    const target = Object.prototype.hasOwnProperty.call(mapping, col) ? mapping[col] : null;
    if (target === null || target === undefined) {
      ignored.push(col);
      continue;
    }
    if (!fields.some((f) => f.field === target)) {
      findings.push({ severity: "ERROR", field: target, code: "UNKNOWN_TARGET_FIELD", message: `"${col}" is mapped to "${target}", which is not a field of this entity.` });
      continue;
    }
    mapped.push(target);
    usedBy.set(target, [...(usedBy.get(target) ?? []), col]);
  }

  for (const [field, cols] of usedBy) {
    if (cols.length > 1) {
      findings.push({ severity: "ERROR", field, code: "DUPLICATE_TARGET_FIELD", message: `${cols.length} columns (${cols.join(", ")}) are mapped to "${field}". Map exactly one.` });
    }
  }

  for (const req of fields.filter((f) => f.required)) {
    if (!mapped.includes(req.field)) {
      findings.push({ severity: "ERROR", field: req.field, code: "REQUIRED_FIELD_UNMAPPED", message: `${req.label} is required and no source column is mapped to it.` });
    }
  }

  return Object.freeze({
    valid: !findings.some((f) => f.severity === "ERROR"),
    findings: Object.freeze(findings),
    mappedFields: Object.freeze([...new Set(mapped)]),
    ignoredColumns: Object.freeze(ignored),
  });
}

// ---------------------------------------------------------------------------
// Mapping profiles + drift
// ---------------------------------------------------------------------------

/**
 * A stable fingerprint of a file's SHAPE. Order-insensitive and case-insensitive:
 * two exports of the same report differ in column order more often than they differ
 * in meaning, and treating that as a new shape would make profiles useless.
 */
export function headerSignature(columns: readonly string[]): string {
  return [...columns.map(normalizeHeader)].filter((c) => c !== "").sort().join("|");
}

export interface MappingProfileValue {
  readonly profileId: string;
  readonly entityType: ImportEntityType;
  readonly headerSignature: string;
  readonly mapping: ColumnMapping;
}

export interface MappingDrift {
  readonly drifted: boolean;
  /** Columns the profile expects that this file does not have. */
  readonly missingColumns: readonly string[];
  /** Columns in this file the profile has never seen. */
  readonly newColumns: readonly string[];
  /** Required canonical fields the profile can no longer satisfy against this file. */
  readonly unsatisfiedRequiredFields: readonly string[];
  readonly message: string;
}

/**
 * Compare a saved profile against an actual file.
 *
 * A missing required source column is NEVER silently ignored -- that is the specific
 * failure this exists to prevent: PART_NO disappears, ITEM_NUMBER appears, and an
 * unguarded import maps nothing to the identity field and creates rows with no part
 * number.
 */
export function detectMappingDrift(profile: MappingProfileValue, parsed: ParsedSourceFile): MappingDrift {
  const fileCols = new Set(parsed.columns.map(normalizeHeader));
  const profileCols = Object.keys(profile.mapping);

  const missing = profileCols.filter((c) => !fileCols.has(normalizeHeader(c)));
  const known = new Set(profileCols.map(normalizeHeader));
  const added = parsed.columns.filter((c) => !known.has(normalizeHeader(c)));

  const required = canonicalFieldsFor(profile.entityType).filter((f) => f.required).map((f) => f.field);
  const stillSatisfied = new Set(
    profileCols
      .filter((c) => fileCols.has(normalizeHeader(c)))
      .map((c) => profile.mapping[c])
      .filter((t): t is string => typeof t === "string"),
  );
  const unsatisfied = required.filter((f) => !stillSatisfied.has(f));

  const drifted = missing.length > 0 || added.length > 0;
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`expected ${missing.join(", ")} missing`);
  if (added.length > 0) parts.push(`${added.join(", ")} newly detected`);
  if (unsatisfied.length > 0) parts.push(`required field(s) ${unsatisfied.join(", ")} no longer mapped`);

  return Object.freeze({
    drifted,
    missingColumns: Object.freeze(missing),
    newColumns: Object.freeze(added),
    unsatisfiedRequiredFields: Object.freeze(unsatisfied),
    message: drifted ? `MAPPING DRIFT: ${parts.join("; ")}.` : "The saved mapping still matches this file.",
  });
}

// ---------------------------------------------------------------------------
// Row projection
// ---------------------------------------------------------------------------

export interface MappedRow {
  readonly sourceRowNumber: number;
  readonly values: Readonly<Record<string, unknown>>;
}

/** Project parsed rows through a mapping into canonical-field-keyed values. */
export function projectRows(parsed: ParsedSourceFile, mapping: ColumnMapping): readonly MappedRow[] {
  const targets = parsed.columns.map((c) => (Object.prototype.hasOwnProperty.call(mapping, c) ? mapping[c] : null));
  return Object.freeze(
    parsed.rows.map((row, i) => {
      const values: Record<string, unknown> = {};
      for (let c = 0; c < targets.length; c += 1) {
        const t = targets[c];
        if (t === null || t === undefined) continue;
        values[t] = row[c];
      }
      return Object.freeze({ sourceRowNumber: parsed.sourceRowNumbers[i], values: Object.freeze(values) });
    }),
  );
}
