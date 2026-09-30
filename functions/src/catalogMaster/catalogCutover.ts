// COPY ONCE -> VERIFY: the PostgreSQL half of the governed catalog cutover (docs/architecture/catalog-cutover-plan.md).
//
// Driven only by the operator CLI functions/scripts/catalogCutover.js, which fences the environment BEFORE this
// module or `pg` is loaded. Consumes the canonical catalog catalogSnapshot.ts produced from an exported snapshot
// file; loads no Firebase module and has no Firestore write path (catalogMaster no-Firebase test).
//
// ════════════════════ COPY ════════════════════
//
// ONE transaction for the whole catalog, under a transaction-scoped advisory lock per tenant:
//   * every source record absent from the tenant           -> INSERT, verbatim id, version and timestamps
//   * every source record present and identical            -> nothing (a rerun of the same snapshot writes nothing)
//   * any source record present and DIFFERENT              -> REFUSE (DRIFT_DETECTED), roll back everything
//   * any tenant row the snapshot does not contain         -> REFUSE (TARGET_HAS_UNKNOWN_RECORDS), roll back
//     -- except the four PINNED Sample Company v2 fixture Equipment Models (catalogKnownFixtures.ts), which are
//     KNOWN_NON_MIGRATED_FIXTURE: never written, never blocking, and REFUSE (KNOWN_FIXTURE_MISMATCH) if that set
//     is not exactly the pinned one, unchanged
// Drift is never overwritten: after the copy PostgreSQL is (or is about to become) the authority, and a changed
// source is a finding for a person, not an update for a script. Equipment Models are written before Parts so the
// Part -> Equipment Model foreign key holds row by row. A run that inserts anything appends ONE
// eos_policy.audit_events row naming the snapshot digest and counts; a no-op run appends nothing.
//
// ACTOR COLUMNS CARRY AN EOS PRINCIPAL (Owner ruling 2026-09-14). created_by / updated_by and the audit actor are the
// cutover Principal (`principalId`, required to be an ACTIVE principal with an ACTIVE membership in the target
// tenant). A Firebase creator/updater uid is NOT an EOS Principal id and is never written to any column; the snapshot's
// legacy uids survive only in the migration evidence the CLI prints (catalogSnapshot.ts LegacyActorProvenance).
//
// CERTIFICATION FIXTURES never reach this module: catalogSnapshot.ts excludes them before canonicalization. The copy
// report and the verify report carry their counts and ids, and verify fails if any of them is found in the target.
//
// ════════════════════ VERIFY ════════════════════
//
// READ ONLY transaction. Counts, identity-set reconciliation, exact field reconciliation over a deterministic
// sample (or all), duplicate canonical identity, dangling Part -> Equipment Model references, and catalog
// reference verdict spot-checks with the SAME tenant-scoped EXISTS probe the #1911 reference authority issues
// (FOUND own kind / WRONG_KIND other kind / NOT_FOUND absent or other tenant). The adapter itself is proved against
// the populated copy in catalogCutoverPostgres.test.mjs (it may not be imported by runtime code before step 8).
import type { PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import {
  type CanonicalEquipmentModel,
  type CanonicalPart,
  differingFields,
  EQUIPMENT_MODEL_FIELDS,
  EQUIPMENT_MODEL_SELECT,
  equipmentModelFromRow,
  INSERT_EQUIPMENT_MODEL_SQL,
  INSERT_PART_SQL,
  insertEquipmentModelValues,
  insertPartValues,
  PART_FIELDS,
  PART_SELECT,
  partFromRow,
} from "./catalogRows";
import type { CanonicalCatalog, CatalogFinding, CanonicalPartAliasRecord } from "./catalogSnapshot";
import { PART_ALIAS_DIGEST_FIELDS } from "./catalogSnapshot";
import { ALIAS_SELECT, INSERT_ALIAS_SQL, aliasFromRow, insertAliasValues } from "./postgresPartAliasWriter";
import { deriveAliasDocId } from "../partMaster/partAliasIdentity";
import { classifyKnownFixtures, type KnownFixtureClassification } from "./catalogKnownFixtures";

type Db = Pick<PoolClient, "query">;

export class CatalogCutoverError extends Error {
  constructor(readonly code: string, message: string, readonly details: unknown = null) {
    super(message);
    this.name = "CatalogCutoverError";
  }
}

/** Does eos_ops.parts carry migration 027's descriptive columns? (026 alone is identity only; an unmigrated database refuses.) */
export async function partMasterSchemaPresent(db: Db): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema = 'eos_ops' AND table_name = 'parts' AND column_name IN ('internal_part_number', 'version', 'updated_at')`,
  );
  return rows[0].n === 3;
}

async function tenantRows(db: Db, tenantId: string, withParts: boolean, withAliases: boolean) {
  const models = (await db.query(`${EQUIPMENT_MODEL_SELECT} WHERE tenant_id = $1 ORDER BY id`, [tenantId])).rows.map(equipmentModelFromRow);
  const parts = withParts ? (await db.query(`${PART_SELECT} WHERE tenant_id = $1 ORDER BY id`, [tenantId])).rows.map(partFromRow) : [];
  const partAliases = withAliases
    ? (await db.query(`${ALIAS_SELECT} WHERE tenant_id = $1 ORDER BY id`, [tenantId])).rows.map(aliasToCanonicalSnapshotRecord)
    : [];
  return { models, parts, partAliases };
}

/** The target row, in the SNAPSHOT's shape, so drift is compared field-for-field against the source. */
function aliasToCanonicalSnapshotRecord(row: Record<string, unknown>): CanonicalPartAliasRecord {
  const a = aliasFromRow(row);
  return Object.freeze({
    id: a.aliasId, partId: a.partId, aliasType: a.aliasType, originalValue: a.originalValue,
    normalizedValue: a.normalizedValue, status: a.status, source: a.source,
    manufacturerId: a.manufacturerId, effectiveFrom: a.effectiveFrom, effectiveTo: a.effectiveTo,
    version: a.version, createdAt: a.createdAt, updatedAt: a.updatedAt, deactivatedAt: a.deactivatedAt,
  });
}

/** Is the alias authority present in this database? */
export async function partAliasSchemaPresent(db: Db): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT to_regclass('eos_ops.part_aliases') IS NOT NULL AS present`);
  return rows[0].present === true;
}

interface KindPlan<T> { insert: T[]; unchanged: number; drift: { id: string; fields: string[] }[]; unknown: string[] }

function plan<T extends { id: string }>(source: readonly T[], target: readonly T[], fields: readonly (keyof T & string)[]): KindPlan<T> {
  const byId = new Map(target.map((r) => [r.id, r]));
  const sourceIds = new Set(source.map((r) => r.id));
  const out: KindPlan<T> = { insert: [], unchanged: 0, drift: [], unknown: target.filter((r) => !sourceIds.has(r.id)).map((r) => r.id) };
  for (const s of source) {
    const t = byId.get(s.id);
    if (t === undefined) { out.insert.push(s); continue; }
    const diff = differingFields(fields, s, t);
    if (diff.length === 0) out.unchanged += 1;
    else out.drift.push({ id: s.id, fields: diff });
  }
  return out;
}

export interface CopyReport {
  readonly outcome: "COPIED" | "NO_CHANGES";
  readonly tenantId: string;
  readonly canonicalDigest: string;
  readonly equipmentModels: { readonly inserted: number; readonly unchanged: number };
  readonly parts: { readonly inserted: number; readonly unchanged: number };
  readonly partAliases: { readonly inserted: number; readonly unchanged: number };
  readonly cutoverPrincipalId: string;
  readonly certificationExcluded: { readonly count: number; readonly records: readonly CatalogFinding[] };
  /** Target rows preserved untouched as pinned Sample Company v2 fixtures (never Taylor Catalog data). */
  readonly knownNonMigratedFixtures: KnownFixtureClassification["known"];
}

export async function copyCatalog(
  client: PoolClient,
  input: { tenantId: string; principalId: string; catalog: CanonicalCatalog; canonicalDigest: string; certificationExcluded?: readonly CatalogFinding[]; now?: Date },
): Promise<CopyReport> {
  const { tenantId, catalog } = input;
  if (typeof input.principalId !== "string" || input.principalId.trim() === "" || input.principalId !== input.principalId.trim()) {
    throw new CatalogCutoverError("CUTOVER_PRINCIPAL_REQUIRED", "the copy must be performed as a named EOS Principal");
  }
  const actor = input.principalId;
  const excluded = input.certificationExcluded ?? [];
  await client.query("BEGIN");
  try {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`catalog-cutover|${tenantId}`]);
    const tenant = await client.query(`SELECT 1 FROM eos_policy.tenants WHERE id = $1`, [tenantId]);
    if (tenant.rows.length === 0) throw new CatalogCutoverError("TENANT_NOT_FOUND", "the target tenant does not exist; the copy never creates one");
    const member = await client.query(
      `SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
        WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`,
      [tenantId, actor],
    );
    if (member.rows.length === 0) throw new CatalogCutoverError("CUTOVER_PRINCIPAL_NOT_TENANT_MEMBER", "the cutover Principal is not an active member of the target tenant");
    const partSchema = await partMasterSchemaPresent(client);
    if (catalog.parts.length > 0 && !partSchema) {
      throw new CatalogCutoverError("PART_TARGET_SCHEMA_ABSENT", "eos_ops.parts lacks the Part Master columns: migrations 026 and 027 must be applied first");
    }
    const aliasSchema = await partAliasSchemaPresent(client);
    if (catalog.partAliases.length > 0 && !aliasSchema) {
      throw new CatalogCutoverError("PART_ALIAS_TARGET_SCHEMA_ABSENT",
        "eos_ops.part_aliases is absent: the catalog alias migration must be applied first");
    }
    const target = await tenantRows(client, tenantId, partSchema, aliasSchema);
    const models = plan(catalog.equipmentModels, target.models, EQUIPMENT_MODEL_FIELDS);
    const parts = plan(catalog.parts, target.parts, PART_FIELDS);
    const aliases = plan(catalog.partAliases, target.partAliases, PART_ALIAS_DIGEST_FIELDS);
    const drift = [
      ...models.drift.map((d) => ({ kind: "equipment_model", ...d })),
      ...parts.drift.map((d) => ({ kind: "part", ...d })),
      ...aliases.drift.map((d) => ({ kind: "part_alias", ...d })),
    ];
    if (drift.length > 0) throw new CatalogCutoverError("DRIFT_DETECTED", `${drift.length} source records differ from the copied records; nothing was written`, drift);
    const fixtures = classifyKnownFixtures(tenantId, target.models, new Set(catalog.equipmentModels.map((m) => m.id)));
    if (fixtures.refusals.length > 0) {
      throw new CatalogCutoverError("KNOWN_FIXTURE_MISMATCH", `the pinned Sample Company fixture set is not exactly as pinned; nothing was written`, fixtures.refusals);
    }
    const unknown = [
      ...fixtures.unknown.map((id) => ({ kind: "equipment_model", id })),
      ...parts.unknown.map((id) => ({ kind: "part", id })),
      ...aliases.unknown.map((id) => ({ kind: "part_alias", id })),
    ];
    if (unknown.length > 0) throw new CatalogCutoverError("TARGET_HAS_UNKNOWN_RECORDS", `${unknown.length} tenant records are not in the snapshot; nothing was written`, unknown);

    // ORDER IS THE FOREIGN KEY. Equipment Models, then Parts, then the aliases that name them --
    // each row's reference resolves at the moment it is written rather than at the end of the
    // transaction, so a broken chain fails on the row that broke it.
    for (const m of models.insert) await client.query(INSERT_EQUIPMENT_MODEL_SQL, insertEquipmentModelValues(tenantId, m as CanonicalEquipmentModel, actor, actor));
    for (const p of parts.insert) await client.query(INSERT_PART_SQL, insertPartValues(tenantId, p as CanonicalPart, actor, actor));
    for (const a of aliases.insert) {
      const rec = a as CanonicalPartAliasRecord;
      await client.query(INSERT_ALIAS_SQL, insertAliasValues(tenantId, {
        aliasId: rec.id, partId: rec.partId, aliasType: rec.aliasType as never,
        originalValue: rec.originalValue, normalizedValue: rec.normalizedValue,
        status: rec.status as never, source: rec.source, manufacturerId: rec.manufacturerId,
        effectiveFrom: rec.effectiveFrom, effectiveTo: rec.effectiveTo,
        version: rec.version,
        // MIGRATED, and its actors are NULL. The legacy Firestore uid is not a Principal and is never
        // written to a business column; it survives only as the migration provenance evidence the
        // census returns. Substituting the cutover Principal would attribute a stranger's record to
        // whoever ran the import.
        provenance: "MIGRATED",
        createdAt: rec.createdAt, createdBy: null,
        updatedAt: rec.updatedAt, updatedBy: null,
        deactivatedAt: rec.deactivatedAt, deactivatedBy: null,
      }));
    }

    const inserted = models.insert.length + parts.insert.length + aliases.insert.length;
    const report: CopyReport = {
      outcome: inserted > 0 ? "COPIED" : "NO_CHANGES",
      tenantId,
      canonicalDigest: input.canonicalDigest,
      equipmentModels: { inserted: models.insert.length, unchanged: models.unchanged },
      parts: { inserted: parts.insert.length, unchanged: parts.unchanged },
      partAliases: { inserted: aliases.insert.length, unchanged: aliases.unchanged },
      cutoverPrincipalId: actor,
      certificationExcluded: { count: excluded.length, records: excluded },
      knownNonMigratedFixtures: fixtures.known,
    };
    if (inserted > 0) {
      await client.query(
        `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at)
         VALUES ($1, $2, 'catalog.cutover.copy', $3, 'catalog_snapshot', $4, NULL, $5, $6)`,
        [`audit_${randomUUID()}`, tenantId, actor, input.canonicalDigest, JSON.stringify({
          equipmentModels: report.equipmentModels, parts: report.parts, partAliases: report.partAliases,
          certificationExcluded: excluded.length,
        }), input.now ?? new Date()],
      );
    }
    await client.query("COMMIT");
    return report;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (err instanceof CatalogCutoverError) throw err;
    const e = err as { constraint?: unknown; code?: unknown };
    throw new CatalogCutoverError("COPY_FAILED", `the copy could not be completed${typeof e?.constraint === "string" ? ` (constraint ${e.constraint})` : ""}; nothing was written`);
  }
}

export type CatalogVerdict = "FOUND" | "NOT_FOUND" | "WRONG_KIND";

/**
 * The #1911 catalog reference adapter's probe shape, restated for verification only.
 * Not an import: that adapter's CATALOG_CUTOVER_TAIL ratchet forbids any runtime module from importing it until the
 * cutover composes it (step 8). catalogCutoverPostgres.test.mjs proves this probe and the adapter agree on populated data.
 */
async function verdicts(db: Db, tenantId: string, refs: readonly { kind: "PART" | "EQUIPMENT_MODEL"; ref: string }[], partSchema: boolean): Promise<CatalogVerdict[]> {
  if (refs.length === 0) return [];
  const partProbe = partSchema ? `EXISTS (SELECT 1 FROM eos_ops.parts p WHERE p.tenant_id = $1 AND p.id = r.ref)` : "false";
  const { rows } = await db.query(
    `SELECT r.ordinal, ${partProbe} AS is_part,
            EXISTS (SELECT 1 FROM eos_ops.equipment_models m WHERE m.tenant_id = $1 AND m.id = r.ref) AS is_model
       FROM unnest($2::text[]) WITH ORDINALITY AS r(ref, ordinal) ORDER BY r.ordinal`,
    [tenantId, refs.map((r) => r.ref)],
  );
  return rows.map((row, i) => {
    const own = refs[i].kind === "PART" ? row.is_part : row.is_model;
    const other = refs[i].kind === "PART" ? row.is_model : row.is_part;
    return own ? "FOUND" : other ? "WRONG_KIND" : "NOT_FOUND";
  });
}

export interface VerifyReport {
  readonly reconciled: boolean;
  readonly tenantId: string;
  readonly counts: {
    readonly equipmentModels: { source: number; target: number };
    readonly parts: { source: number; target: number };
    readonly partAliases: { source: number; target: number };
  };
  readonly identity: { readonly missingInTarget: readonly string[]; readonly extraInTarget: readonly string[] };
  readonly sampled: { readonly equipmentModels: number; readonly parts: number; readonly partAliases: number };
  readonly fieldMismatches: readonly { kind: string; id: string; fields: string[] }[];
  readonly duplicateIdentities: readonly { kind: string; id: string }[];
  readonly danglingEquipmentModelReferences: readonly string[];
  /** Aliases in the target whose Part is not. Must be empty: an identifier resolving to nothing. */
  readonly danglingAliasPartReferences: readonly string[];
  /** Aliases whose stored id disagrees with the identity their own value normalizes to. */
  readonly aliasIdentityDisagreements: readonly string[];
  readonly verdictChecks: readonly { kind: string; ref: string; tenant: string; expected: CatalogVerdict; actual: CatalogVerdict }[];
  readonly certificationExcluded: { readonly count: number; readonly records: readonly CatalogFinding[] };
  /** Excluded Certification fixture ids found in the target. Must be empty. */
  readonly certificationFixturesInTarget: readonly string[];
  /** Pinned Sample Company v2 fixtures present and unchanged; not counted as target Catalog data. */
  readonly knownNonMigratedFixtures: KnownFixtureClassification["known"];
  /** The fixture set is not exactly as pinned. Must be empty. */
  readonly knownFixtureRefusals: readonly string[];
}

/** Deterministic sample: ids ordered by sha256(id); `all` or the first N. */
export function sampleIds(ids: readonly string[], sample: number | "all"): string[] {
  const ordered = [...ids].sort((a, b) => {
    const ha = createHash("sha256").update(a).digest("hex"), hb = createHash("sha256").update(b).digest("hex");
    return ha < hb ? -1 : ha > hb ? 1 : 0;
  });
  return sample === "all" ? ordered : ordered.slice(0, sample);
}

/** A tenant id that cannot exist (eos_policy.tenants ids are never this), for the cross-tenant NOT_FOUND probe. */
export const ABSENT_TENANT_PROBE = "catalog-cutover-verify-absent-tenant";

export async function verifyCatalog(
  client: PoolClient,
  input: { tenantId: string; catalog: CanonicalCatalog; sample: number | "all"; certificationExcluded?: readonly CatalogFinding[] },
): Promise<VerifyReport> {
  const excluded = input.certificationExcluded ?? [];
  const { tenantId, catalog } = input;
  await client.query("BEGIN READ ONLY");
  try {
    const partSchema = await partMasterSchemaPresent(client);
    const aliasSchema = await partAliasSchemaPresent(client);
    const target = await tenantRows(client, tenantId, partSchema, aliasSchema);
    const idsOf = (rows: readonly { id: string }[]) => new Set(rows.map((r) => r.id));
    const fixtures = classifyKnownFixtures(tenantId, target.models, idsOf(catalog.equipmentModels));
    const knownIds = new Set(fixtures.known.map((f) => f.id));
    const catalogModels = target.models.filter((m) => !knownIds.has(m.id));
    const sModels = idsOf(catalog.equipmentModels), tModels = idsOf(catalogModels);
    const sParts = idsOf(catalog.parts), tParts = idsOf(target.parts);
    const sAliases = idsOf(catalog.partAliases), tAliases = idsOf(target.partAliases);
    const missing = [
      ...[...sModels].filter((id) => !tModels.has(id)).map((id) => `equipment_model:${id}`),
      ...[...sParts].filter((id) => !tParts.has(id)).map((id) => `part:${id}`),
      ...[...sAliases].filter((id) => !tAliases.has(id)).map((id) => `part_alias:${id}`),
    ];
    const extra = [
      ...[...tModels].filter((id) => !sModels.has(id)).map((id) => `equipment_model:${id}`),
      ...[...tParts].filter((id) => !sParts.has(id)).map((id) => `part:${id}`),
      ...[...tAliases].filter((id) => !sAliases.has(id)).map((id) => `part_alias:${id}`),
    ];

    const mismatches: { kind: string; id: string; fields: string[] }[] = [];
    const targetModel = new Map(target.models.map((m) => [m.id, m]));
    const targetPart = new Map(target.parts.map((p) => [p.id, p]));
    const sourceModel = new Map(catalog.equipmentModels.map((m) => [m.id, m]));
    const sourcePart = new Map(catalog.parts.map((p) => [p.id, p]));
    const modelSample = sampleIds([...sModels].filter((id) => tModels.has(id)), input.sample);
    const partSample = sampleIds([...sParts].filter((id) => tParts.has(id)), input.sample);
    for (const id of modelSample) {
      const fields = differingFields(EQUIPMENT_MODEL_FIELDS, sourceModel.get(id)!, targetModel.get(id)!);
      if (fields.length > 0) mismatches.push({ kind: "equipment_model", id, fields });
    }
    for (const id of partSample) {
      const fields = differingFields(PART_FIELDS, sourcePart.get(id)!, targetPart.get(id)!);
      if (fields.length > 0) mismatches.push({ kind: "part", id, fields });
    }
    const targetAlias = new Map(target.partAliases.map((a) => [a.id, a]));
    const sourceAlias = new Map(catalog.partAliases.map((a) => [a.id, a]));
    const aliasSample = sampleIds([...sAliases].filter((id) => tAliases.has(id)), input.sample);
    for (const id of aliasSample) {
      const fields = differingFields(PART_ALIAS_DIGEST_FIELDS, sourceAlias.get(id)!, targetAlias.get(id)!);
      if (fields.length > 0) mismatches.push({ kind: "part_alias", id, fields });
    }

    // NORMALIZATION AGREEMENT, re-derived in the target. A stored id that disagrees with what its own
    // value normalizes to is an identifier that would never be found by the lookup it exists for.
    const aliasIdentityDisagreements = target.partAliases
      .filter((a) => {
        const derived = deriveAliasDocId(a.aliasType as never, a.originalValue, (a.manufacturerId ?? undefined) as never);
        return derived === null || derived.docId !== a.id || derived.normalizedValue !== a.normalizedValue;
      })
      .map((a) => a.id).sort();
    const danglingAliasPartReferences = aliasSchema && partSchema
      ? (await client.query(
        `SELECT a.id FROM eos_ops.part_aliases a LEFT JOIN eos_ops.parts p
           ON p.tenant_id = a.tenant_id AND p.id = a.part_id
          WHERE a.tenant_id = $1 AND p.id IS NULL ORDER BY a.id`, [tenantId])).rows.map((r) => String(r.id))
      : [];
    const dupAliases = aliasSchema
      ? (await client.query(
        `SELECT id FROM eos_ops.part_aliases WHERE tenant_id = $1
          GROUP BY id HAVING count(*) > 1`, [tenantId])).rows
      : [];

    const dupModels = (await client.query(`SELECT id FROM eos_ops.equipment_models WHERE tenant_id = $1 GROUP BY id HAVING count(*) > 1`, [tenantId])).rows;
    const dupParts = partSchema ? (await client.query(`SELECT id FROM eos_ops.parts WHERE tenant_id = $1 GROUP BY id HAVING count(*) > 1`, [tenantId])).rows : [];
    const dangling = partSchema
      ? (await client.query(
        `SELECT p.id FROM eos_ops.parts p LEFT JOIN eos_ops.equipment_models m ON m.tenant_id = p.tenant_id AND m.id = p.equipment_model_id
          WHERE p.tenant_id = $1 AND p.equipment_model_id IS NOT NULL AND m.id IS NULL ORDER BY p.id`, [tenantId])).rows.map((r) => String(r.id))
      : [];

    // Verdict spot-checks: up to 5 sampled ids per kind, each as own kind, as the other kind, and in an absent tenant.
    const checks: { kind: "PART" | "EQUIPMENT_MODEL"; ref: string; tenant: string; expected: CatalogVerdict }[] = [];
    for (const id of modelSample.slice(0, 5)) {
      checks.push({ kind: "EQUIPMENT_MODEL", ref: id, tenant: tenantId, expected: "FOUND" });
      checks.push({ kind: "PART", ref: id, tenant: tenantId, expected: sParts.has(id) ? "FOUND" : "WRONG_KIND" });
      checks.push({ kind: "EQUIPMENT_MODEL", ref: id, tenant: ABSENT_TENANT_PROBE, expected: "NOT_FOUND" });
    }
    for (const id of partSample.slice(0, 5)) {
      checks.push({ kind: "PART", ref: id, tenant: tenantId, expected: "FOUND" });
      checks.push({ kind: "EQUIPMENT_MODEL", ref: id, tenant: tenantId, expected: sModels.has(id) ? "FOUND" : "WRONG_KIND" });
      checks.push({ kind: "PART", ref: id, tenant: ABSENT_TENANT_PROBE, expected: "NOT_FOUND" });
    }
    const absentRef = "catalog-cutover-verify-absent-ref";
    checks.push({ kind: "PART", ref: absentRef, tenant: tenantId, expected: "NOT_FOUND" });
    checks.push({ kind: "EQUIPMENT_MODEL", ref: absentRef, tenant: tenantId, expected: "NOT_FOUND" });
    const verdictChecks: { kind: string; ref: string; tenant: string; expected: CatalogVerdict; actual: CatalogVerdict }[] = [];
    for (const tenant of [tenantId, ABSENT_TENANT_PROBE]) {
      const group = checks.filter((c) => c.tenant === tenant);
      const answers = await verdicts(client, tenant, group, partSchema);
      group.forEach((c, i) => verdictChecks.push({ ...c, actual: answers[i] }));
    }
    await client.query("COMMIT");

    const fixturesInTarget = excluded
      .filter((x) => (x.kind === "part" ? tParts.has(x.id) : x.kind === "part_alias" ? tAliases.has(x.id) : tModels.has(x.id)))
      .map((x) => `${x.kind}:${x.id}`);
    const duplicateIdentities = [
      ...dupModels.map((r) => ({ kind: "equipment_model", id: String(r.id) })),
      ...dupParts.map((r) => ({ kind: "part", id: String(r.id) })),
      ...dupAliases.map((r) => ({ kind: "part_alias", id: String(r.id) })),
    ];
    const report: VerifyReport = {
      reconciled: false,
      tenantId,
      counts: {
        equipmentModels: { source: catalog.equipmentModels.length, target: catalogModels.length },
        parts: { source: catalog.parts.length, target: target.parts.length },
        partAliases: { source: catalog.partAliases.length, target: target.partAliases.length },
      },
      identity: { missingInTarget: missing, extraInTarget: extra },
      sampled: { equipmentModels: modelSample.length, parts: partSample.length, partAliases: aliasSample.length },
      fieldMismatches: mismatches,
      duplicateIdentities,
      danglingEquipmentModelReferences: dangling,
      danglingAliasPartReferences,
      aliasIdentityDisagreements,
      verdictChecks,
      certificationExcluded: { count: excluded.length, records: excluded },
      certificationFixturesInTarget: fixturesInTarget,
      knownNonMigratedFixtures: fixtures.known,
      knownFixtureRefusals: fixtures.refusals,
    };
    const reconciled =
      report.counts.equipmentModels.source === report.counts.equipmentModels.target &&
      report.counts.parts.source === report.counts.parts.target &&
      report.counts.partAliases.source === report.counts.partAliases.target &&
      missing.length === 0 && extra.length === 0 && mismatches.length === 0 && duplicateIdentities.length === 0 &&
      dangling.length === 0 && danglingAliasPartReferences.length === 0 && aliasIdentityDisagreements.length === 0 &&
      verdictChecks.every((c) => c.expected === c.actual) && fixturesInTarget.length === 0 && fixtures.refusals.length === 0 &&
      (catalog.parts.length === 0 || partSchema) && (catalog.partAliases.length === 0 || aliasSchema);
    return { ...report, reconciled };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}
