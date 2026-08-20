import { makeFieldV2 } from "./fieldDefinitionV2.js";

// Record provenance — a platform invariant, expressed as SYSTEM fields.
//
// EVERY durable EOS business record must be able to answer "who created this, and when".
// Every MUTABLE durable record must additionally answer "who last changed it, and when".
// That is not a convention entities may opt into; it is the reason an operational system
// can be reasoned about after the fact at all.
//
// PROVENANCE IS NOT AUDIT HISTORY, and the distinction is load-bearing rather than
// pedantic. These four fields describe the record's CURRENT state: its origin and its
// most recent governed mutation. They cannot answer "what changed on the fourteenth", and
// attempting to reconstruct history from updatedBy/updatedAt yields a confident wrong
// answer — the last writer looks like the only writer. Material mutation history belongs
// to the existing audit event architecture (functions/src/access/auditEventWriter.ts),
// which this deliberately does NOT duplicate or replace.
//
// SERVER-AUTHORITATIVE. A client-supplied timestamp or actor identity is a claim, not
// provenance: any caller able to write the record is able to write the claim. These
// fields are written by trusted commands, which is why they are immutable and carry no
// write capability — there is no authority under which a caller may set them directly.

/**
 * How a record came to exist or change.
 *
 * createdBy is NOT always a human at a keyboard, and an architecture that assumes it is
 * cannot distinguish "a dispatcher did this" from "an import did this on a dispatcher's
 * behalf" — which is exactly the question asked first when data looks wrong.
 */
export const PROVENANCE_ORIGIN = Object.freeze([
  "USER",
  "AUTOMATION",
  "IMPORT",
  "INTEGRATION",
  "SYSTEM",
  "AI_ASSISTED",
]);

export const PROVENANCE_SYSTEM_NAMES = Object.freeze(["createdAt", "createdBy", "updatedAt", "updatedBy"]);

/**
 * Synonyms that must NOT be minted as new fields.
 *
 * A `creationDate` beside a `createdAt` is two answers to one question, and every report,
 * formula and export then has to pick one. Where legacy storage genuinely differs, the
 * separation to use is systemName vs storagePath — not a second name in the standard
 * vocabulary.
 */
export const PROVENANCE_SYNONYMS = Object.freeze([
  "creationDate", "createdDate", "dateCreated", "createdOn",
  "modifiedDate", "lastModified", "lastUpdated", "updatedDate", "dateUpdated",
  "createdByUser", "modifiedBy", "lastModifiedBy",
]);

const provenanceField = (systemName, label, type, { storagePath, immutable }) =>
  makeFieldV2({
    label,
    systemName,
    storagePath: storagePath ?? systemName,
    fieldClass: "SYSTEM",
    type,
    required: true,
    nullable: false,
    mutable: !immutable,
    createable: false,
    // No writeCapability, deliberately. There is no authority under which a caller sets
    // provenance directly — a trusted command writes it or it is not provenance.
    updateable: false,
    auditable: true,
    queryability: "MATERIALIZED",
  });

/**
 * The provenance fields for an entity.
 *
 * `mutable: false` means the entity is append-only in the business sense, so it has an
 * origin and no "last changed" — an issued invoice, a posted ledger entry. Emitting
 * updatedAt/updatedBy for such a record would imply a mutation path that must not exist.
 */
export function provenanceFields({ entitySystemName, mutable = true, storagePaths = {} } = {}) {
  const created = [
    provenanceField("createdAt", "Created", "TIMESTAMP", { storagePath: storagePaths.createdAt, immutable: true }),
    provenanceField("createdBy", "Created by", "REFERENCE", { storagePath: storagePaths.createdBy, immutable: true }),
  ].map((f) => makeFieldV2({ ...f, entitySystemName, referenceTo: f.type === "REFERENCE" ? "employee" : null }));

  if (!mutable) return Object.freeze(created);

  const updated = [
    provenanceField("updatedAt", "Last updated", "TIMESTAMP", { storagePath: storagePaths.updatedAt, immutable: false }),
    provenanceField("updatedBy", "Last updated by", "REFERENCE", { storagePath: storagePaths.updatedBy, immutable: false }),
  ].map((f) => makeFieldV2({ ...f, entitySystemName, referenceTo: f.type === "REFERENCE" ? "employee" : null }));

  return Object.freeze([...created, ...updated]);
}

/**
 * Why an entity is exempt from the invariant.
 *
 * Caches, locks, transient execution state and derived indexes are not business records,
 * and forcing provenance onto them would make the invariant meaningless by making it
 * universal. The exemption requires a stated reason so it stays a decision somebody made
 * rather than a gap somebody left.
 */
export function makeProvenanceExemption({ entitySystemName, reason } = {}) {
  return Object.freeze({ entitySystemName, reason: reason ?? null });
}

/**
 * Does an entity satisfy the provenance invariant?
 *
 * Exemptions are checked FIRST and require a reason, so an exemption without one fails
 * rather than silently excusing the entity.
 */
export function validateProvenance(entity, { exemption = null, at } = {}) {
  const where = at ?? `entity ${entity?.systemName ?? entity?.id ?? "(unnamed)"}`;
  const problems = [];

  if (exemption) {
    if (!exemption.reason) {
      problems.push(`${where}: a provenance exemption requires a stated reason — an unexplained exemption is a gap, not a decision`);
    }
    return problems;
  }

  const present = new Set((entity?.fields ?? []).map((f) => f.systemName ?? f.id));
  const required = entity?.mutable === false ? ["createdAt", "createdBy"] : PROVENANCE_SYSTEM_NAMES;

  for (const name of required) {
    if (!present.has(name)) problems.push(`${where}: durable business records require ${name}`);
  }

  for (const f of entity?.fields ?? []) {
    const systemName = f.systemName ?? f.id;
    if (PROVENANCE_SYNONYMS.includes(systemName)) {
      problems.push(`${where}: "${systemName}" duplicates a standard provenance concept — map legacy storage with storagePath instead of minting a synonym`);
    }
    if (PROVENANCE_SYSTEM_NAMES.includes(systemName)) {
      if (f.fieldClass && f.fieldClass !== "SYSTEM") {
        problems.push(`${where}: "${systemName}" is a SYSTEM field and may not be redefined as ${f.fieldClass}`);
      }
      if (f.updateable) {
        problems.push(`${where}: "${systemName}" is server-authoritative and may never be directly updateable`);
      }
      if ((systemName === "createdAt" || systemName === "createdBy") && f.mutable) {
        problems.push(`${where}: "${systemName}" is immutable after creation`);
      }
    }
  }
  return problems;
}

/**
 * The richer origin seam.
 *
 * Declared, not yet implemented: naming and shape must be reconciled against the existing
 * audit/event architecture before anything writes these, and inventing a parallel actor
 * vocabulary here is precisely what §32 forbids. What the seam guarantees is that the
 * questions remain answerable — who ultimately caused this, when, through what mechanism,
 * from which execution.
 */
export const PROVENANCE_ORIGIN_SEAM = Object.freeze({
  fields: Object.freeze(["createdVia", "updatedVia", "initiatedBy", "sourceExecutionId", "correlationId"]),
  reconcileWith: "functions/src/access/auditEventWriter.ts",
  note: "Shape is a seam, not a contract. Actor resolution reuses the governed actor identity architecture rather than re-deriving it.",
});
