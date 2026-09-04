// EOS Data Import -- portable validation + preview.
//
// PORTABILITY BOUNDARY. Pure: no firebase-admin, no Firestore. It takes mapped rows and
// an injected view of EXISTING identity, and produces the ready/warning/error board the
// admin approves. Whether existing identity comes from Firestore, a customer-hosted
// database, or a fixture in a test is the caller's business, not this module's.
//
// NO OPERATIONAL WRITE HAPPENS HERE, and none can: this module has no write capability
// of any kind. That is what makes "no operational record is written during upload,
// mapping, validation or preview" a structural property rather than a promise.
//
// ROW CLASSIFICATION
//   READY    -- will be imported
//   WARNING  -- will be imported; the admin should look
//   ERROR    -- will NOT be imported, and is shown rather than hidden

import { normalizePartRow, type FieldFinding } from "./contracts/partImportContract.js";
import type { MappedRow, ImportEntityType } from "./importIntake.js";

export type RowClassification = "READY" | "WARNING" | "ERROR";

export interface PreviewRow {
  readonly sourceRowNumber: number;
  /** The row's natural identity, when one could be derived. Used for duplicate reporting. */
  readonly identity: string | null;
  readonly classification: RowClassification;
  readonly findings: readonly FieldFinding[];
  /** The canonical draft, present only when the row is importable. */
  readonly draft: Readonly<Record<string, unknown>> | null;
}

export interface PreviewSummary {
  readonly total: number;
  readonly ready: number;
  readonly warnings: number;
  readonly errors: number;
}

export interface ImportPreview {
  readonly entityType: ImportEntityType;
  readonly summary: PreviewSummary;
  readonly rows: readonly PreviewRow[];
}

/**
 * Existing-identity lookup, injected.
 *
 * Returns the set of natural identities that ALREADY exist in the target data plane.
 * A Set keeps this a value, not a live query, so preview is deterministic and testable
 * without infrastructure.
 */
export type ExistingIdentityIndex = ReadonlySet<string>;

function finding(severity: "ERROR" | "WARNING", field: string, code: string, message: string): FieldFinding {
  return Object.freeze({ severity, field, code, message });
}

/** Identity normalization for duplicate comparison: case- and whitespace-insensitive. */
export function partIdentityKey(internalPartNumber: string): string {
  return internalPartNumber.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Build the preview for a PARTS import.
 *
 * Duplicate policy, deliberately split:
 *   * two rows in the SAME FILE claiming one identity is an ERROR on the later row --
 *     the file contradicts itself and nothing here can choose a winner;
 *   * a row whose identity ALREADY EXISTS in the target is an ERROR, not a silent
 *     update. P1 creates Parts; quietly mutating an existing governed Part from a
 *     spreadsheet is exactly the ambiguity the brief says to fail closed on.
 */
export function buildPartsPreview(rows: readonly MappedRow[], existing: ExistingIdentityIndex): ImportPreview {
  const seenInFile = new Map<string, number>();
  const out: PreviewRow[] = [];

  for (const row of rows) {
    const normalized = normalizePartRow(row.values);
    const findings: FieldFinding[] = [...normalized.findings];
    let identity: string | null = null;

    if (normalized.draft) {
      identity = partIdentityKey(String(normalized.draft.internalPartNumber));

      const firstSeenAt = seenInFile.get(identity);
      if (firstSeenAt !== undefined) {
        findings.push(
          finding(
            "ERROR",
            "internalPartNumber",
            "DUPLICATE_IN_FILE",
            `Internal Part Number "${normalized.draft.internalPartNumber}" also appears on source row ${firstSeenAt}. The file contradicts itself; neither row can be chosen automatically.`,
          ),
        );
      } else {
        seenInFile.set(identity, row.sourceRowNumber);
      }

      if (existing.has(identity)) {
        findings.push(
          finding(
            "ERROR",
            "internalPartNumber",
            "ALREADY_EXISTS",
            `A Part with Internal Part Number "${normalized.draft.internalPartNumber}" already exists. Import creates new Parts; it will not overwrite an existing one.`,
          ),
        );
      }
    }

    const hasError = findings.some((f) => f.severity === "ERROR");
    const hasWarning = findings.some((f) => f.severity === "WARNING");
    const classification: RowClassification = hasError ? "ERROR" : hasWarning ? "WARNING" : "READY";

    out.push(
      Object.freeze({
        sourceRowNumber: row.sourceRowNumber,
        identity,
        classification,
        findings: Object.freeze(findings),
        draft: hasError ? null : (normalized.draft as Readonly<Record<string, unknown>> | null),
      }),
    );
  }

  return Object.freeze({
    entityType: "PARTS" as const,
    summary: Object.freeze({
      total: out.length,
      ready: out.filter((r) => r.classification === "READY").length,
      warnings: out.filter((r) => r.classification === "WARNING").length,
      errors: out.filter((r) => r.classification === "ERROR").length,
    }),
    rows: Object.freeze(out),
  });
}

/** The rows an execute step is allowed to act on: READY and WARNING, never ERROR. */
export function importableRows(preview: ImportPreview): readonly PreviewRow[] {
  return Object.freeze(preview.rows.filter((r) => r.classification !== "ERROR" && r.draft !== null));
}
