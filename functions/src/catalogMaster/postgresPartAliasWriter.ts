// THE POSTGRESQL PART ALIAS AUTHORITY -- alias commands and reads, in the Catalog bounded context.
//
// It restates NO domain rule. Normalization, the alias key, the storage-safe id encoding, the type
// and status vocabularies and the scanned-identifier fan-out are all REUSED from the pure
// `partMaster` modules -- a second normalization algorithm would mean the same barcode resolved to
// two different identities depending on which store answered, which is the one defect an identifier
// authority cannot have.
//
// ════════════════════ IDENTITY IS DERIVED, NEVER GENERATED ════════════════════
//
// `deriveAliasDocId` produces the id from (type, raw value, manufacturer scope) through
// `normalizeIdentifier` -> `buildAliasKey` -> `encodeAliasDocId`. That id is the primary key, so
// "is this identifier already taken" is answered by the key rather than by a query somebody has to
// remember to run, and a row copied from Firestore keeps the id it already had.
//
// ════════════════════ WHAT THE PROJECTION MAY SHOW ════════════════════
//
// Alias administration, which requires the Catalog capability, sees `originalValue` -- a person
// correcting a mis-typed supplier SKU has to see what was typed. AUDIT carries a FINGERPRINT of the
// normalized value instead, exactly as the Firestore authority does: an audit trail is read by more
// people, kept longer, and exported more often than the record it describes, and a raw customer or
// vendor identifier in it is the copy that outlives every control around the original.

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import {
  CATALOG_CAPABILITIES,
  type CatalogActorContext,
  type CatalogCommandDeps,
  type CatalogCommandResult,
  refuse,
  requireExpectedVersion,
  requirePlainObject,
  runCatalogCommand,
} from "./catalogMasterKernel.js";
import { deriveAliasDocId } from "../partMaster/partAliasIdentity.js";
import { ALIAS_TYPES, ALIAS_STATUSES } from "../partMaster/types.js";
import type { AliasType, AliasStatus } from "../partMaster/types.js";
import {
  resolveScannedIdentifierWith,
  type AliasProbeOutcome,
  type ScannedIdentifierResolution,
} from "../partMaster/partAliasScanCore.js";
import { isoMicros } from "./catalogRows.js";

const SCHEMA = "eos_ops";
export const ALIAS_PROVENANCE = Object.freeze({ NATIVE: "NATIVE", MIGRATED: "MIGRATED" } as const);

/** The audit-safe form of an identifier value. Never the value itself. */
export function aliasValueFingerprint(normalizedValue: string): string {
  return createHash("sha256").update(normalizedValue).digest("hex").slice(0, 16);
}

export interface CanonicalPartAlias {
  readonly aliasId: string;
  readonly partId: string;
  readonly aliasType: AliasType;
  readonly originalValue: string;
  readonly normalizedValue: string;
  readonly status: AliasStatus;
  readonly source: string;
  readonly manufacturerId: string | null;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly version: number;
  readonly provenance: "NATIVE" | "MIGRATED";
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly updatedAt: string;
  readonly updatedBy: string | null;
  readonly deactivatedAt: string | null;
  readonly deactivatedBy: string | null;
}

export const ALIAS_SELECT = `
  SELECT id AS alias_id, part_id, alias_type::text AS alias_type, original_value, normalized_value,
         status::text AS status, source, manufacturer_id,
         effective_from::text AS effective_from, effective_to::text AS effective_to,
         version, provenance::text AS provenance,
         created_at, created_by, updated_at, updated_by, deactivated_at, deactivated_by
    FROM ${SCHEMA}.part_aliases`;

type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v instanceof Date ? isoMicros(v) : (v === null || v === undefined ? null : String(v)));

export function aliasFromRow(r: Row): CanonicalPartAlias {
  return Object.freeze({
    aliasId: r.alias_id as string,
    partId: r.part_id as string,
    aliasType: r.alias_type as AliasType,
    originalValue: r.original_value as string,
    normalizedValue: r.normalized_value as string,
    status: r.status as AliasStatus,
    source: r.source as string,
    manufacturerId: (r.manufacturer_id as string | null) ?? null,
    effectiveFrom: (r.effective_from as string | null) ?? null,
    effectiveTo: (r.effective_to as string | null) ?? null,
    version: Number(r.version),
    provenance: r.provenance as "NATIVE" | "MIGRATED",
    createdAt: iso(r.created_at) as string,
    createdBy: (r.created_by as string | null) ?? null,
    updatedAt: iso(r.updated_at) as string,
    updatedBy: (r.updated_by as string | null) ?? null,
    deactivatedAt: iso(r.deactivated_at),
    deactivatedBy: (r.deactivated_by as string | null) ?? null,
  });
}

export const INSERT_ALIAS_SQL = `
  INSERT INTO ${SCHEMA}.part_aliases
    (id, tenant_id, part_id, alias_type, original_value, normalized_value, status, source,
     manufacturer_id, effective_from, effective_to, version, provenance,
     created_at, created_by, updated_at, updated_by, deactivated_at, deactivated_by)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11::date,$12,$13,$14,$15,$16,$17,$18,$19)`;

export function insertAliasValues(tenantId: string, a: CanonicalPartAlias): unknown[] {
  return [
    a.aliasId, tenantId, a.partId, a.aliasType, a.originalValue, a.normalizedValue, a.status, a.source,
    a.manufacturerId, a.effectiveFrom, a.effectiveTo, a.version, a.provenance,
    a.createdAt, a.createdBy, a.updatedAt, a.updatedBy, a.deactivatedAt, a.deactivatedBy,
  ];
}

// ─────────────────────────────── shared client-scoped primitives ───────────────────────────────

/** Read one alias by its DERIVED id, locked. Null when the identity is unclaimed. */
export async function lockAlias(
  client: Pick<PoolClient, "query">, tenantId: string, aliasId: string,
): Promise<CanonicalPartAlias | null> {
  const { rows } = await client.query(`${ALIAS_SELECT} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, aliasId]);
  return rows.length === 0 ? null : aliasFromRow(rows[0]);
}

async function requirePart(client: Pick<PoolClient, "query">, tenantId: string, partId: string): Promise<void> {
  const { rows } = await client.query(
    `SELECT 1 FROM ${SCHEMA}.parts WHERE tenant_id = $1 AND id = $2`, [tenantId, partId]);
  if (rows.length === 0) refuse("PART_NOT_FOUND", "NOT_FOUND", `no part ${partId} in this tenant`);
}

function derive(aliasType: unknown, rawValue: unknown, manufacturerId: unknown):
  { aliasId: string; normalizedValue: string; aliasType: AliasType; manufacturerId: string | null } {
  if (typeof aliasType !== "string" || !(ALIAS_TYPES as readonly string[]).includes(aliasType)) {
    refuse("ALIAS_TYPE_INVALID", "INVALID_INPUT", "aliasType is not a governed alias type");
  }
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    refuse("ALIAS_VALUE_REQUIRED", "INVALID_INPUT", "an alias records an identifier value");
  }
  const scope = manufacturerId === undefined || manufacturerId === null ? undefined : manufacturerId;
  if (scope !== undefined && (typeof scope !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(scope))) {
    refuse("MANUFACTURER_ID_INVALID", "INVALID_INPUT", "manufacturerId is not a governed reference");
  }
  // THE ONE normalization + key + encoding authority. A null answer means the value is not a
  // well-formed identifier for this type, which is a refusal rather than a stored oddity.
  const derived = deriveAliasDocId(aliasType as AliasType, rawValue, (scope as string | undefined) as never);
  if (derived === null) {
    refuse("ALIAS_VALUE_MALFORMED", "INVALID_INPUT", `the value is not a well-formed ${aliasType} identifier`);
  }
  return {
    aliasId: derived.docId, normalizedValue: derived.normalizedValue,
    aliasType: aliasType as AliasType, manufacturerId: (scope as string | undefined) ?? null,
  };
}

/**
 * PRESERVE THE OLD INTERNAL PART NUMBER, inside the caller's transaction.
 *
 * This is the primitive the Part update needs and could not have. It opens no transaction and takes
 * no pool: the caller owns BEGIN and COMMIT, which is what makes "no Part update without the alias"
 * structural rather than a convention.
 *
 * BOTH identities are probed BEFORE anything is written -- the OLD number that is about to become an
 * alias, and the NEW number the Part is moving to. Either one owned by a different Part refuses the
 * WHOLE update, because an internal part number that already resolves elsewhere cannot also resolve
 * here, and discovering that after the Part row changed would leave two Parts answering to one
 * number.
 *
 * An alias that ALREADY records exactly this fact -- same identity, same Part, ACTIVE -- is left
 * untouched and reported, rather than refused. Re-running an update that renamed a Part is not a
 * collision with itself.
 */
export async function aliasAuthorityPresent(client: Pick<PoolClient, "query">): Promise<boolean> {
  const { rows } = await client.query(`SELECT to_regclass('${SCHEMA}.part_aliases') IS NOT NULL AS present`);
  return rows[0].present === true;
}

export async function preserveInternalPartNumberAlias(
  client: Pick<PoolClient, "query">,
  input: {
    readonly tenantId: string;
    readonly partId: string;
    readonly previousInternalPartNumber: string;
    readonly nextInternalPartNumber: string;
    readonly actorPrincipalId: string;
    readonly now: Date;
  },
): Promise<{ readonly aliasId: string; readonly created: boolean }> {
  // THE ORIGINAL REFUSAL, STILL CORRECT WHERE IT IS STILL TRUE.
  //
  // A database that has not run the catalog alias migration genuinely has no alias authority, and
  // renaming a Part there would break historical lookup exactly as before. Fail closed with the code
  // that says so, rather than letting a missing relation surface as COMMAND_FAILED -- an operator
  // reading that would look for a bug instead of a migration.
  if (!(await aliasAuthorityPresent(client))) {
    refuse("INTERNAL_PART_NUMBER_ALIAS_AUTHORITY_UNAVAILABLE", "UNAVAILABLE",
      "changing internalPartNumber preserves the prior number as an alias, and eos_ops.part_aliases is not present in this database");
  }
  const previous = derive("INTERNAL_PN", input.previousInternalPartNumber, undefined);
  const next = derive("INTERNAL_PN", input.nextInternalPartNumber, undefined);

  // ---- PROBE BOTH, BEFORE ANY WRITE ----
  const existingNext = await lockAlias(client, input.tenantId, next.aliasId);
  if (existingNext !== null && existingNext.partId !== input.partId) {
    refuse("ALIAS_IDENTITY_OWNED_BY_ANOTHER_PART", "CONFLICT",
      "the new internal part number is already an identifier for a different part");
  }
  const existingPrevious = await lockAlias(client, input.tenantId, previous.aliasId);
  if (existingPrevious !== null && existingPrevious.partId !== input.partId) {
    refuse("ALIAS_IDENTITY_OWNED_BY_ANOTHER_PART", "CONFLICT",
      "the previous internal part number is already an identifier for a different part");
  }
  if (existingPrevious !== null) {
    if (existingPrevious.status === "ACTIVE") {
      // The fact is already recorded, truthfully, for this same Part.
      return { aliasId: previous.aliasId, created: false };
    }
    // An INACTIVE alias for this Part, holding the number we must now preserve. Reactivating it
    // silently here would be a lifecycle change nobody asked for and no audit would explain; the
    // Part update refuses instead, and a person decides.
    refuse("ALIAS_INACTIVE_FOR_THIS_PART", "CONFLICT",
      "the previous internal part number is a deactivated identifier for this part; reactivate it deliberately before renaming");
  }

  const at = isoMicros(input.now);
  await client.query(INSERT_ALIAS_SQL, insertAliasValues(input.tenantId, {
    aliasId: previous.aliasId,
    partId: input.partId,
    aliasType: "INTERNAL_PN",
    originalValue: input.previousInternalPartNumber,
    normalizedValue: previous.normalizedValue,
    status: "ACTIVE",
    // Not "manual": nobody typed this alias. It exists because the Part was renamed, and the source
    // says so, so a person reading the row later knows why it is there.
    source: "internal-part-number-preservation",
    manufacturerId: null, effectiveFrom: null, effectiveTo: null,
    version: 1, provenance: "NATIVE",
    createdAt: at, createdBy: input.actorPrincipalId,
    updatedAt: at, updatedBy: input.actorPrincipalId,
    deactivatedAt: null, deactivatedBy: null,
  }));
  return { aliasId: previous.aliasId, created: true };
}

// ─────────────────────────────── commands ───────────────────────────────

export interface AliasWriteResult {
  readonly aliasId: string;
  readonly partId: string;
  readonly version: number;
  readonly status: AliasStatus;
}

export async function createPartAlias(
  deps: CatalogCommandDeps,
  actor: CatalogActorContext,
  input: { partId: unknown; aliasType: unknown; rawValue: unknown; source?: unknown;
    manufacturerId?: unknown; effectiveFrom?: unknown; effectiveTo?: unknown },
): Promise<CatalogCommandResult<AliasWriteResult>> {
  return runCatalogCommand(deps, actor, CATALOG_CAPABILITIES.PART_MANAGE, async (client, now) => {
    const envelope = requirePlainObject(input, "input");
    const partId = envelope.partId;
    if (typeof partId !== "string" || partId.trim() === "") refuse("PART_ID_REQUIRED", "INVALID_INPUT", "partId is required");
    const d = derive(envelope.aliasType, envelope.rawValue, envelope.manufacturerId);
    const source = typeof envelope.source === "string" && envelope.source.trim() !== "" ? envelope.source : "manual";
    const effectiveFrom = envelope.effectiveFrom === undefined || envelope.effectiveFrom === null ? null : String(envelope.effectiveFrom);
    const effectiveTo = envelope.effectiveTo === undefined || envelope.effectiveTo === null ? null : String(envelope.effectiveTo);
    if (effectiveFrom !== null && effectiveTo !== null && effectiveTo < effectiveFrom) {
      refuse("EFFECTIVE_RANGE_INVALID", "INVALID_INPUT", "effectiveTo must not precede effectiveFrom");
    }

    await requirePart(client, actor.tenantId, partId);
    const existing = await lockAlias(client, actor.tenantId, d.aliasId);
    if (existing !== null) {
      if (existing.partId === partId && existing.status === "ACTIVE") {
        // An equivalent ACTIVE alias for the SAME part: idempotent-equivalent success, never a
        // second row, because there cannot be a second row.
        return { result: { aliasId: d.aliasId, partId, version: existing.version, status: existing.status }, replayed: true, audit: null };
      }
      refuse(
        existing.partId === partId ? "ALIAS_INACTIVE_FOR_THIS_PART" : "ALIAS_IDENTITY_OWNED_BY_ANOTHER_PART",
        "CONFLICT",
        existing.partId === partId
          ? "this identifier exists but is deactivated for this part; reactivate it rather than creating a second one"
          : "this identifier is already an alias of a different part",
      );
    }

    const at = isoMicros(now);
    const row: CanonicalPartAlias = {
      aliasId: d.aliasId, partId, aliasType: d.aliasType,
      originalValue: envelope.rawValue as string, normalizedValue: d.normalizedValue,
      status: "ACTIVE", source, manufacturerId: d.manufacturerId,
      effectiveFrom, effectiveTo, version: 1, provenance: "NATIVE",
      createdAt: at, createdBy: actor.principalId, updatedAt: at, updatedBy: actor.principalId,
      deactivatedAt: null, deactivatedBy: null,
    };
    await client.query(INSERT_ALIAS_SQL, insertAliasValues(actor.tenantId, row));
    return {
      result: { aliasId: d.aliasId, partId, version: 1, status: "ACTIVE" as AliasStatus },
      replayed: false,
      // FINGERPRINT, never the identifier. See the header.
      audit: { action: "catalog.partAlias.create", targetKind: "part_alias", targetId: d.aliasId,
        before: null, after: { partId, aliasType: d.aliasType, valueFingerprint: aliasValueFingerprint(d.normalizedValue), status: "ACTIVE" } },
    };
  });
}

async function setAliasStatus(
  deps: CatalogCommandDeps,
  actor: CatalogActorContext,
  input: { aliasId: unknown; expectedVersion: unknown },
  to: AliasStatus,
  action: string,
): Promise<CatalogCommandResult<AliasWriteResult>> {
  return runCatalogCommand(deps, actor, CATALOG_CAPABILITIES.PART_MANAGE, async (client, now) => {
    const envelope = requirePlainObject(input, "input");
    const aliasId = envelope.aliasId;
    if (typeof aliasId !== "string" || aliasId.trim() === "") refuse("ALIAS_ID_REQUIRED", "INVALID_INPUT", "aliasId is required");
    const expectedVersion = requireExpectedVersion(envelope.expectedVersion);

    const stored = await lockAlias(client, actor.tenantId, aliasId);
    if (stored === null) refuse("ALIAS_NOT_FOUND", "NOT_FOUND", "no such alias in this tenant");
    if (stored.version === expectedVersion + 1 && stored.status === to) {
      return { result: { aliasId, partId: stored.partId, version: stored.version, status: stored.status }, replayed: true, audit: null };
    }
    if (stored.version !== expectedVersion) refuse("VERSION_CONFLICT", "CONFLICT", "the record changed since it was loaded; reload and retry");
    if (stored.status === to) refuse("NO_CHANGES", "PRECONDITION_FAILED", `the alias is already ${to}`);

    const at = isoMicros(now);
    const deactivating = to === "INACTIVE";
    await client.query(
      `UPDATE ${SCHEMA}.part_aliases
          SET status = $4, version = version + 1, updated_at = $5, updated_by = $6,
              deactivated_at = $7, deactivated_by = $8
        WHERE tenant_id = $1 AND id = $2 AND version = $3`,
      [actor.tenantId, aliasId, expectedVersion, to, at, actor.principalId,
        deactivating ? at : null, deactivating ? actor.principalId : null],
    );
    return {
      result: { aliasId, partId: stored.partId, version: stored.version + 1, status: to },
      replayed: false,
      audit: { action, targetKind: "part_alias", targetId: aliasId,
        before: { status: stored.status }, after: { status: to, valueFingerprint: aliasValueFingerprint(stored.normalizedValue) } },
    };
  });
}

export const deactivatePartAlias = (
  deps: CatalogCommandDeps, actor: CatalogActorContext, input: { aliasId: unknown; expectedVersion: unknown },
) => setAliasStatus(deps, actor, input, "INACTIVE", "catalog.partAlias.deactivate");

export const reactivatePartAlias = (
  deps: CatalogCommandDeps, actor: CatalogActorContext, input: { aliasId: unknown; expectedVersion: unknown },
) => setAliasStatus(deps, actor, input, "ACTIVE", "catalog.partAlias.reactivate");

// ─────────────────────────────── reads ───────────────────────────────

/** Alias administration for one Part. Authorized callers see the ORIGINAL value. */
export async function listPartAliases(
  client: Pick<PoolClient, "query">, tenantId: string, partId: string,
): Promise<readonly CanonicalPartAlias[]> {
  const { rows } = await client.query(
    `${ALIAS_SELECT} WHERE tenant_id = $1 AND part_id = $2 ORDER BY alias_type, normalized_value`,
    [tenantId, partId]);
  return rows.map(aliasFromRow);
}

/** Probe ONE identity. The per-type answer the scanned-identifier fan-out is built from. */
export async function probePartAlias(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  input: { readonly aliasType: AliasType; readonly rawValue: string; readonly manufacturerId?: string },
): Promise<AliasProbeOutcome> {
  const derived = deriveAliasDocId(input.aliasType, input.rawValue, input.manufacturerId as never);
  if (derived === null) return { result: "MALFORMED", detail: `not a well-formed ${input.aliasType} identifier` };
  const { rows } = await client.query(
    `${ALIAS_SELECT} WHERE tenant_id = $1 AND id = $2`, [tenantId, derived.docId]);
  if (rows.length === 0) return { result: "NOT_FOUND" };
  const a = aliasFromRow(rows[0]);
  return {
    result: a.status === "ACTIVE" ? "FOUND" : "INACTIVE",
    partId: a.partId as never, aliasType: a.aliasType, aliasId: a.aliasId,
  };
}

/** The scanner's question, answered through the SHARED pure fan-out. */
export async function resolveScannedPartIdentifier(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  input: { readonly rawValue: string; readonly manufacturerId?: string },
): Promise<ScannedIdentifierResolution> {
  return resolveScannedIdentifierWith((probe) => probePartAlias(client, tenantId, probe), input);
}

export const ALIAS_STATUS_VOCABULARY: readonly AliasStatus[] = ALIAS_STATUSES;
