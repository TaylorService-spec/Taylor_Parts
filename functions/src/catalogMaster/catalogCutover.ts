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
// Drift is never overwritten: after the copy PostgreSQL is (or is about to become) the authority, and a changed
// source is a finding for a person, not an update for a script. Equipment Models are written before Parts so the
// Part -> Equipment Model foreign key holds row by row. A run that inserts anything appends ONE
// eos_policy.audit_events row naming the snapshot digest and counts; a no-op run appends nothing.
//
// Actor columns record the cutover operator (`catalog-cutover:<performedBy>`), not the Firestore uid that last
// touched a document: a Firebase uid is identity, not EOS authority, and is not carried into eos_ops.
//
// ════════════════════ VERIFY ════════════════════
//
// READ ONLY transaction. Counts, identity-set reconciliation, exact field reconciliation over a deterministic
// sample (or all), duplicate canonical identity, dangling Part -> Equipment Model references, and catalog
// reference verdict spot-checks with the SAME tenant-scoped EXISTS probe the #1911 reference authority issues
// (FOUND own kind / WRONG_KIND other kind / NOT_FOUND absent or other tenant). Adapter-level verdict proof over
// populated data is an integration step once #1911 is merged.
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
import type { CanonicalCatalog } from "./catalogSnapshot";

type Db = Pick<PoolClient, "query">;

export class CatalogCutoverError extends Error {
  constructor(readonly code: string, message: string, readonly details: unknown = null) {
    super(message);
    this.name = "CatalogCutoverError";
  }
}

/** Does eos_ops.parts carry the deferred-027 descriptive columns? (025 alone is identity only.) */
export async function partMasterSchemaPresent(db: Db): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema = 'eos_ops' AND table_name = 'parts' AND column_name IN ('internal_part_number', 'version', 'updated_at')`,
  );
  return rows[0].n === 3;
}

async function tenantRows(db: Db, tenantId: string, withParts: boolean) {
  const models = (await db.query(`${EQUIPMENT_MODEL_SELECT} WHERE tenant_id = $1 ORDER BY id`, [tenantId])).rows.map(equipmentModelFromRow);
  const parts = withParts ? (await db.query(`${PART_SELECT} WHERE tenant_id = $1 ORDER BY id`, [tenantId])).rows.map(partFromRow) : [];
  return { models, parts };
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
}

export async function copyCatalog(
  client: PoolClient,
  input: { tenantId: string; performedBy: string; catalog: CanonicalCatalog; canonicalDigest: string; now?: Date },
): Promise<CopyReport> {
  const { tenantId, catalog } = input;
  if (typeof input.performedBy !== "string" || !/^[A-Za-z0-9._@-]{1,100}$/.test(input.performedBy)) {
    throw new CatalogCutoverError("PERFORMED_BY_INVALID", "--performedBy must name the operator ([A-Za-z0-9._@-], at most 100)");
  }
  const actor = `catalog-cutover:${input.performedBy}`;
  await client.query("BEGIN");
  try {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`catalog-cutover|${tenantId}`]);
    const tenant = await client.query(`SELECT 1 FROM eos_policy.tenants WHERE id = $1`, [tenantId]);
    if (tenant.rows.length === 0) throw new CatalogCutoverError("TENANT_NOT_FOUND", "the target tenant does not exist; the copy never creates one");
    const partSchema = await partMasterSchemaPresent(client);
    if (catalog.parts.length > 0 && !partSchema) {
      throw new CatalogCutoverError("PART_TARGET_SCHEMA_ABSENT", "eos_ops.parts lacks the Part Master columns: migration 025 (#1911) and deferred migration 027 must be applied first");
    }
    const target = await tenantRows(client, tenantId, partSchema);
    const models = plan(catalog.equipmentModels, target.models, EQUIPMENT_MODEL_FIELDS);
    const parts = plan(catalog.parts, target.parts, PART_FIELDS);
    const drift = [...models.drift.map((d) => ({ kind: "equipment_model", ...d })), ...parts.drift.map((d) => ({ kind: "part", ...d }))];
    if (drift.length > 0) throw new CatalogCutoverError("DRIFT_DETECTED", `${drift.length} source records differ from the copied records; nothing was written`, drift);
    const unknown = [...models.unknown.map((id) => ({ kind: "equipment_model", id })), ...parts.unknown.map((id) => ({ kind: "part", id }))];
    if (unknown.length > 0) throw new CatalogCutoverError("TARGET_HAS_UNKNOWN_RECORDS", `${unknown.length} tenant records are not in the snapshot; nothing was written`, unknown);

    for (const m of models.insert) await client.query(INSERT_EQUIPMENT_MODEL_SQL, insertEquipmentModelValues(tenantId, m as CanonicalEquipmentModel, actor, actor));
    for (const p of parts.insert) await client.query(INSERT_PART_SQL, insertPartValues(tenantId, p as CanonicalPart, actor, actor));

    const inserted = models.insert.length + parts.insert.length;
    const report: CopyReport = {
      outcome: inserted > 0 ? "COPIED" : "NO_CHANGES",
      tenantId,
      canonicalDigest: input.canonicalDigest,
      equipmentModels: { inserted: models.insert.length, unchanged: models.unchanged },
      parts: { inserted: parts.insert.length, unchanged: parts.unchanged },
    };
    if (inserted > 0) {
      await client.query(
        `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at)
         VALUES ($1, $2, 'catalog.cutover.copy', $3, 'catalog_snapshot', $4, NULL, $5, $6)`,
        [`audit_${randomUUID()}`, tenantId, actor, input.canonicalDigest, JSON.stringify(report), input.now ?? new Date()],
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

/** The #1911 adapter's probe shape, restated for verification only (not a reference authority). */
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
  readonly counts: { readonly equipmentModels: { source: number; target: number }; readonly parts: { source: number; target: number } };
  readonly identity: { readonly missingInTarget: readonly string[]; readonly extraInTarget: readonly string[] };
  readonly sampled: { readonly equipmentModels: number; readonly parts: number };
  readonly fieldMismatches: readonly { kind: string; id: string; fields: string[] }[];
  readonly duplicateIdentities: readonly { kind: string; id: string }[];
  readonly danglingEquipmentModelReferences: readonly string[];
  readonly verdictChecks: readonly { kind: string; ref: string; tenant: string; expected: CatalogVerdict; actual: CatalogVerdict }[];
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
  input: { tenantId: string; catalog: CanonicalCatalog; sample: number | "all" },
): Promise<VerifyReport> {
  const { tenantId, catalog } = input;
  await client.query("BEGIN READ ONLY");
  try {
    const partSchema = await partMasterSchemaPresent(client);
    const target = await tenantRows(client, tenantId, partSchema);
    const idsOf = (rows: readonly { id: string }[]) => new Set(rows.map((r) => r.id));
    const sModels = idsOf(catalog.equipmentModels), tModels = idsOf(target.models);
    const sParts = idsOf(catalog.parts), tParts = idsOf(target.parts);
    const missing = [...[...sModels].filter((id) => !tModels.has(id)).map((id) => `equipment_model:${id}`), ...[...sParts].filter((id) => !tParts.has(id)).map((id) => `part:${id}`)];
    const extra = [...[...tModels].filter((id) => !sModels.has(id)).map((id) => `equipment_model:${id}`), ...[...tParts].filter((id) => !sParts.has(id)).map((id) => `part:${id}`)];

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

    const duplicateIdentities = [...dupModels.map((r) => ({ kind: "equipment_model", id: String(r.id) })), ...dupParts.map((r) => ({ kind: "part", id: String(r.id) }))];
    const report: VerifyReport = {
      reconciled: false,
      tenantId,
      counts: {
        equipmentModels: { source: catalog.equipmentModels.length, target: target.models.length },
        parts: { source: catalog.parts.length, target: target.parts.length },
      },
      identity: { missingInTarget: missing, extraInTarget: extra },
      sampled: { equipmentModels: modelSample.length, parts: partSample.length },
      fieldMismatches: mismatches,
      duplicateIdentities,
      danglingEquipmentModelReferences: dangling,
      verdictChecks,
    };
    const reconciled =
      report.counts.equipmentModels.source === report.counts.equipmentModels.target &&
      report.counts.parts.source === report.counts.parts.target &&
      missing.length === 0 && extra.length === 0 && mismatches.length === 0 && duplicateIdentities.length === 0 &&
      dangling.length === 0 && verdictChecks.every((c) => c.expected === c.actual) &&
      (catalog.parts.length === 0 || partSchema);
    return { ...report, reconciled };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}
