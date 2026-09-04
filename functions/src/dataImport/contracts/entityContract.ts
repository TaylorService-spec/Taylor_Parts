// EOS Data Import -- the entity contract, and the registry of them.
//
// PORTABILITY BOUNDARY. Pure: no firebase-admin, no Firestore, no collection names.
//
// WHY A REGISTRY RATHER THAN FIVE PIPELINES. Everything import does between "here are some
// mapped values" and "write this" is identical for every entity: suggest a mapping, detect
// which entity a header describes, normalize a row, classify it, refuse a duplicate. Only
// the FIELDS differ. Writing that logic once per entity would produce five copies that
// agree today and disagree after the first bug fix lands in four of them.
//
// So an entity contributes a CONTRACT -- its canonical fields, how a row normalizes, what
// its natural identity is -- and the pipeline stays one pipeline.
//
// AN UNWIRED ENTITY IS `null`, NOT AN EMPTY CONTRACT. An empty field list would make
// detection quietly succeed with zero confidence and mapping quietly validate a file with
// no fields at all. Absence has to be distinguishable from emptiness, because "we do not
// import this yet" and "this file has no columns" are different sentences.

import type { CanonicalFieldSpec, FieldFinding } from "./partImportContract.js";

/** The five entities named in the P1 brief. Order is display order. */
export const IMPORT_ENTITY_TYPES = ["PARTS", "CUSTOMERS", "EQUIPMENT", "INVENTORY", "SERVICE_HISTORY"] as const;
export type ImportEntityType = (typeof IMPORT_ENTITY_TYPES)[number];

export interface NormalizedRow {
  /** The canonical draft, or null when the row cannot produce one. */
  readonly draft: Readonly<Record<string, unknown>> | null;
  readonly findings: readonly FieldFinding[];
}

export interface EntityImportContract {
  readonly entityType: ImportEntityType;
  /** Singular, as an operator would say it: "Part", "Customer". */
  readonly label: string;
  readonly canonicalFields: readonly CanonicalFieldSpec[];
  readonly requiredFields: readonly string[];
  /**
   * The canonical field carrying the record's NATURAL identity -- what makes two rows the
   * same record. Duplicate detection, both within a file and against what already exists,
   * is defined entirely by this field and the key derived from it.
   */
  readonly identityField: string;
  /** How that field reads in a message: "Internal Part Number", "Customer Name". */
  readonly identityLabel: string;
  /** Never throws: a bad row yields findings and a null draft. */
  normalizeRow(values: Readonly<Record<string, unknown>>): NormalizedRow;
  /** Comparison form of the identity: case- and whitespace-insensitive. */
  identityKey(draft: Readonly<Record<string, unknown>>): string;
}

const REGISTRY = new Map<ImportEntityType, EntityImportContract>();

/**
 * Register a contract.
 *
 * Called once per contract module at import time rather than assembled in a central list,
 * so adding an entity is one file plus one import -- and so this module does not depend on
 * every contract, which would make the registry a cycle.
 */
export function registerEntityContract(contract: EntityImportContract): EntityImportContract {
  REGISTRY.set(contract.entityType, contract);
  return contract;
}

/** The contract for an entity, or null if this release does not import it. */
export function entityContractFor(entityType: ImportEntityType): EntityImportContract | null {
  return REGISTRY.get(entityType) ?? null;
}

/** Every wired contract, in the declared entity order (not registration order). */
export function wiredEntityContracts(): readonly EntityImportContract[] {
  return Object.freeze(
    IMPORT_ENTITY_TYPES.map((t) => REGISTRY.get(t)).filter((c): c is EntityImportContract => c !== undefined),
  );
}

/** Shared normalization for a natural-identity key. */
export function naturalIdentityKey(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}
