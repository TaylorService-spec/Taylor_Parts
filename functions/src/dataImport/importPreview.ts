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

import type { FieldFinding } from "./contracts/partImportContract.js";
import { entityContractFor, type ImportEntityType } from "./contracts/entityContract.js";
import type { MappedRow } from "./importIntake.js";

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
export function buildEntityPreview(
  entityType: ImportEntityType,
  rows: readonly MappedRow[],
  existing: ExistingIdentityIndex,
): ImportPreview {
  const contract = entityContractFor(entityType);
  if (!contract) {
    // Not an empty preview. An unwired entity must be refused by the caller before it gets
    // here; reaching this point means something staged a job nothing can execute.
    throw new Error(`no import contract is registered for ${entityType}`);
  }

  const seenInFile = new Map<string, number>();
  const out: PreviewRow[] = [];

  for (const row of rows) {
    const normalized = contract.normalizeRow(row.values);
    const findings: FieldFinding[] = [...normalized.findings];
    let identity: string | null = null;

    if (normalized.draft) {
      const shown = String(normalized.draft[contract.identityField] ?? "");
      identity = contract.identityKey(normalized.draft);

      const firstSeenAt = seenInFile.get(identity);
      if (firstSeenAt !== undefined) {
        findings.push(
          finding(
            "ERROR",
            contract.identityField,
            "DUPLICATE_IN_FILE",
            `${contract.identityLabel} "${shown}" also appears on source row ${firstSeenAt}. The file contradicts itself; neither row can be chosen automatically.`,
          ),
        );
      } else {
        seenInFile.set(identity, row.sourceRowNumber);
      }

      if (existing.has(identity)) {
        findings.push(
          finding(
            "ERROR",
            contract.identityField,
            "ALREADY_EXISTS",
            `A ${contract.label} with ${contract.identityLabel} "${shown}" already exists. Import creates new records; it will not overwrite an existing one.`,
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
    entityType,
    summary: Object.freeze({
      total: out.length,
      ready: out.filter((r) => r.classification === "READY").length,
      warnings: out.filter((r) => r.classification === "WARNING").length,
      errors: out.filter((r) => r.classification === "ERROR").length,
    }),
    rows: Object.freeze(out),
  });
}

/** Parts, by name. Kept because Parts is the entity most callers mean. */
export function buildPartsPreview(rows: readonly MappedRow[], existing: ExistingIdentityIndex): ImportPreview {
  return buildEntityPreview("PARTS", rows, existing);
}

/** The rows an execute step is allowed to act on: READY and WARNING, never ERROR. */
export function importableRows(preview: ImportPreview): readonly PreviewRow[] {
  return Object.freeze(preview.rows.filter((r) => r.classification !== "ERROR" && r.draft !== null));
}
