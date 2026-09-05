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

import { readXlsxGrid, XlsxError } from "./xlsxReader.js";
import { entityContractFor, wiredEntityContracts, type ImportEntityType } from "./contracts/entityContract.js";
// SIDE-EFFECT IMPORTS. A contract registers itself when its module loads, so the registry
// is empty unless something pulls the modules in. This is that something: importing intake
// is what makes every wired entity exist, and adding an entity means adding a line here.
import "./contracts/customerImportContract.js";
import "./contracts/equipmentImportContract.js";
import "./contracts/inventoryImportContract.js";
import { parseCsv } from "../partMaster/csvMigrationAnalysis.js";
import {
  PART_CANONICAL_FIELDS,
  PART_REQUIRED_FIELDS,
  type CanonicalFieldSpec,
  type FieldFinding,
} from "./contracts/partImportContract.js";

/** P1 entity types. Only PARTS is wired in the first vertical slice. */
// Re-exported so callers keep one import site; the LIST itself lives with the registry,
// because an entity's existence and an entity's contract are the same fact.
export { IMPORT_ENTITY_TYPES } from "./contracts/entityContract.js";
export type { ImportEntityType } from "./contracts/entityContract.js";

/** Explicit P1 limits. Stated here so the UI and the backend cannot disagree. */
export const IMPORT_LIMITS = Object.freeze({
  /** Conservative: the payload travels inside a trusted callable request, not Storage. */
  maxFileBytes: 2 * 1024 * 1024,
  maxRows: 5000,
  maxColumns: 100,
  allowedExtensions: Object.freeze([".csv", ".xlsx"]),
  /**
   * .xlsm is ABSENT and must stay absent. A macro-enabled workbook is refused at the
   * extension, before a single byte is inflated -- xlsxReader never opens a macro part
   * either, but two independent refusals is the right number for "we do not run your file".
   */
  allowedContentTypes: Object.freeze([
    "text/csv",
    "application/csv",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]),
});

export type IntakeFailureCode =
  | "FILE_EMPTY"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_EXTENSION"
  | "NO_HEADER_ROW"
  | "DUPLICATE_COLUMN"
  | "TOO_MANY_COLUMNS"
  | "TOO_MANY_ROWS"
  | "UNREADABLE_WORKBOOK";

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
/**
 * Each reader accepts only the extensions it can HONESTLY read.
 *
 * assertExtension answers "is this file type supported at all"; this answers "can THIS
 * function read it". Both are needed: without the second, parseSourceFile would accept a
 * .xlsx filename and CSV-parse a ZIP's bytes-as-text, producing one nonsense column of
 * mojibake instead of an error. The callable already picks the reader by the client's
 * encoding, so this is defence in depth -- and the kind that stops a future caller, not a
 * malicious one.
 */
function assertReadableAs(filename: string, accepted: readonly string[], readerLabel: string): void {
  const lower = filename.toLowerCase();
  if (!accepted.some((e) => lower.endsWith(e))) {
    throw new IntakeError(
      "UNSUPPORTED_EXTENSION",
      `"${filename}" is not a ${readerLabel}. It must be uploaded as ${accepted.join(" or ")}.`,
    );
  }
}
export function parseSourceFile(filename: string, text: string): ParsedSourceFile {
  assertExtension(filename);
  assertReadableAs(filename, [".csv"], "text file");

  const byteLength = Buffer.byteLength(text, "utf8");
  assertWithinSize(byteLength);

  // A UTF-8 BOM would otherwise ride along inside the first header name and silently
  // break the mapping for exactly one column -- the hardest kind of bug to see.
  const cleaned = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  return gridToParsedFile(parseCsv(cleaned));
}

/**
 * Parse an .xlsx workbook's FIRST worksheet.
 *
 * Deliberately the same return type, and deliberately the same validation: once the bytes
 * are a grid of strings, a workbook and a text file are the same problem. Everything that
 * makes import safe -- the header rules, the duplicate-column refusal, the row and column
 * caps, the mapping, the preview -- runs identically for both, because only the FIRST step
 * differs. A second validation path for spreadsheets is how the two formats would come to
 * disagree about what a file means.
 */
export function parseWorkbookFile(filename: string, bytes: Buffer): ParsedSourceFile {
  assertExtension(filename);
  assertReadableAs(filename, [".xlsx"], "workbook");
  assertWithinSize(bytes.length);

  let grid: string[][];
  try {
    grid = readXlsxGrid(bytes, { maxRows: IMPORT_LIMITS.maxRows, maxColumns: IMPORT_LIMITS.maxColumns });
  } catch (err) {
    // The reader's own refusals are re-stated as intake failures so a caller handles ONE
    // error type. The reader's message is kept: it describes the operator's own file
    // (password-protected, damaged, not a workbook) and is the actionable part.
    if (err instanceof XlsxError) throw new IntakeError("UNREADABLE_WORKBOOK", err.message);
    throw err;
  }

  return gridToParsedFile(grid);
}

function assertWithinSize(byteLength: number): void {
  if (byteLength > IMPORT_LIMITS.maxFileBytes) {
    throw new IntakeError(
      "FILE_TOO_LARGE",
      `The file is ${byteLength} bytes; this release accepts up to ${IMPORT_LIMITS.maxFileBytes} bytes.`,
    );
  }
}

/**
 * The shared half: a grid of strings -> a validated ParsedSourceFile.
 *
 * This is where every file-level refusal lives, for every format.
 */
function gridToParsedFile(grid: readonly (readonly string[])[]): ParsedSourceFile {
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
    const r = [...grid[i]];
    // A row of entirely empty cells is spreadsheet padding, not a record. Workbooks are
    // full of these: a stray format applied to row 900 makes Excel emit 900 rows.
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

/**
 * How much of an entity's required-field set a header must name before that entity is even
 * a candidate. Ranking between candidates is by COVERAGE, not by this -- see detectEntityType.
 */
const REQUIRED_FIELD_THRESHOLD = 0.75;

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

  // TWO STAGES, and the order matters.
  //
  // FIRST A GATE: an entity whose REQUIRED fields are not all present in the header cannot be
  // what this file is, whatever else it matches. This is what stops a Parts export being read
  // as anything else -- a file with no Stocking Class is not a Part file.
  //
  // THEN COVERAGE, not the required-field fraction. Entities have different numbers of
  // required fields (a Part needs five, a Customer needs one), so "fraction of required
  // fields matched" is not comparable between them: a Customer contract scores a perfect 1.0
  // on any header containing NAME, including a Parts export. Coverage asks the comparable
  // question instead -- how much of THIS HEADER does the entity explain?
  const scores = wiredEntityContracts()
    .map((contract) => {
      const required = contract.canonicalFields.filter((f) => f.required);
      const matches = (f: CanonicalFieldSpec) =>
        f.synonyms.some((syn) => normalized.includes(normalizeHeader(syn))) ||
        normalized.includes(normalizeHeader(f.field));
      const requiredHit = required.filter(matches).length;
      const explained = contract.canonicalFields.filter(matches).length;
      return {
        contract,
        requiredHit,
        requiredTotal: required.length,
        // NOT all-or-nothing. A Parts export whose description column is not literally named
        // NAME is still recognisably a Parts export, and the operator maps that one column
        // by hand -- which is the normal workflow. An exact gate would answer "no entity
        // could be recognised" for a file whose identity is obvious, which is less useful
        // than a wrong guess would be harmful.
        satisfied: required.length > 0 && requiredHit / required.length >= REQUIRED_FIELD_THRESHOLD,
        coverage: normalized.length === 0 ? 0 : explained / normalized.length,
      };
    })
    .sort((a, b) => b.coverage - a.coverage);

  const eligible = scores.filter((s) => s.satisfied);

  if (eligible.length === 0) {
    // Nothing is eligible. Report the NEAREST miss, because "3 of 5 required Part columns"
    // tells an operator which column to add; "no entity recognised" tells them nothing.
    const nearest = scores.reduce<(typeof scores)[number] | null>(
      (a, b) => (a === null || b.requiredHit / Math.max(1, b.requiredTotal) > a.requiredHit / Math.max(1, a.requiredTotal) ? b : a),
      null,
    );
    return Object.freeze({
      entityType: null,
      confidence: nearest ? nearest.requiredHit / Math.max(1, nearest.requiredTotal) : 0,
      reason:
        nearest && nearest.requiredHit > 0
          ? `Only ${nearest.requiredHit} of ${nearest.requiredTotal} required ${nearest.contract.label} columns were recognised -- too few to assume. Choose the entity type.`
          : "No entity could be recognised from the header. Choose the entity type.",
    });
  }

  const best = eligible[0];
  const tied = eligible.filter((s) => s.coverage === best.coverage);
  if (tied.length > 1) {
    // Two entities explain this header equally well. Picking either would misfile a whole
    // file on an accident of list order, so the admin decides.
    return Object.freeze({
      entityType: null,
      confidence: best.coverage,
      reason: `This header matches ${tied.map((t) => t.contract.label).join(" and ")} equally well. Choose the entity type.`,
    });
  }

  return Object.freeze({
    entityType: best.contract.entityType,
    confidence: best.coverage,
    reason: `${best.requiredHit} of ${best.requiredTotal} required ${best.contract.label} columns were recognised, and ${Math.round(best.coverage * 100)}% of the header is ${best.contract.label} fields.`,
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
  // An UNWIRED entity has no contract and therefore no fields. Returning an empty set is
  // deliberate and is not the same as being wired with nothing to map: validateMapping
  // refuses an unwired entity outright, so an empty field list can never be mistaken for
  // a file that happens to need no mapping.
  return entityContractFor(entityType)?.canonicalFields ?? Object.freeze([]);
}

/** Is this entity importable in this release at all? */
export function isEntityWired(entityType: ImportEntityType): boolean {
  return entityContractFor(entityType) !== null;
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
  if (!isEntityWired(entityType)) {
    // An unwired entity is REFUSED here rather than validated against an empty field set,
    // which would report "valid" for a file nothing can execute -- the one answer that would
    // let an operator approve an import that does nothing at all.
    return Object.freeze({
      valid: false,
      findings: Object.freeze([
        Object.freeze({
          severity: "ERROR" as const,
          field: "entityType",
          code: "ENTITY_NOT_WIRED",
          message: `Import for ${entityType} is not available in this release.`,
        }),
      ]),
      mappedFields: Object.freeze([]),
      ignoredColumns: Object.freeze([...parsed.columns]),
    });
  }

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
