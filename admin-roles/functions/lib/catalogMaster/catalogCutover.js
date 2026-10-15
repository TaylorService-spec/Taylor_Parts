"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ABSENT_TENANT_PROBE = exports.CatalogCutoverError = void 0;
exports.partMasterSchemaPresent = partMasterSchemaPresent;
exports.partAliasSchemaPresent = partAliasSchemaPresent;
exports.copyCatalog = copyCatalog;
exports.sampleIds = sampleIds;
exports.verifyCatalog = verifyCatalog;
const node_crypto_1 = require("node:crypto");
const catalogRows_1 = require("./catalogRows");
const catalogSnapshot_1 = require("./catalogSnapshot");
const postgresPartAliasWriter_1 = require("./postgresPartAliasWriter");
const partAliasIdentity_1 = require("../partMaster/partAliasIdentity");
const catalogKnownFixtures_1 = require("./catalogKnownFixtures");
class CatalogCutoverError extends Error {
    code;
    details;
    constructor(code, message, details = null) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = "CatalogCutoverError";
    }
}
exports.CatalogCutoverError = CatalogCutoverError;
/** Does eos_ops.parts carry migration 027's descriptive columns? (026 alone is identity only; an unmigrated database refuses.) */
async function partMasterSchemaPresent(db) {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema = 'eos_ops' AND table_name = 'parts' AND column_name IN ('internal_part_number', 'version', 'updated_at')`);
    return rows[0].n === 3;
}
async function tenantRows(db, tenantId, withParts, withAliases) {
    const models = (await db.query(`${catalogRows_1.EQUIPMENT_MODEL_SELECT} WHERE tenant_id = $1 ORDER BY id`, [tenantId])).rows.map(catalogRows_1.equipmentModelFromRow);
    const parts = withParts ? (await db.query(`${catalogRows_1.PART_SELECT} WHERE tenant_id = $1 ORDER BY id`, [tenantId])).rows.map(catalogRows_1.partFromRow) : [];
    const partAliases = withAliases
        ? (await db.query(`${postgresPartAliasWriter_1.ALIAS_SELECT} WHERE tenant_id = $1 ORDER BY id`, [tenantId])).rows.map(aliasToCanonicalSnapshotRecord)
        : [];
    return { models, parts, partAliases };
}
/** The target row, in the SNAPSHOT's shape, so drift is compared field-for-field against the source. */
function aliasToCanonicalSnapshotRecord(row) {
    const a = (0, postgresPartAliasWriter_1.aliasFromRow)(row);
    return Object.freeze({
        id: a.aliasId, partId: a.partId, aliasType: a.aliasType, originalValue: a.originalValue,
        normalizedValue: a.normalizedValue, status: a.status, source: a.source,
        manufacturerId: a.manufacturerId, effectiveFrom: a.effectiveFrom, effectiveTo: a.effectiveTo,
        version: a.version, createdAt: a.createdAt, updatedAt: a.updatedAt, deactivatedAt: a.deactivatedAt,
    });
}
/** Is the alias authority present in this database? */
async function partAliasSchemaPresent(db) {
    const { rows } = await db.query(`SELECT to_regclass('eos_ops.part_aliases') IS NOT NULL AS present`);
    return rows[0].present === true;
}
function plan(source, target, fields) {
    const byId = new Map(target.map((r) => [r.id, r]));
    const sourceIds = new Set(source.map((r) => r.id));
    const out = { insert: [], unchanged: 0, drift: [], unknown: target.filter((r) => !sourceIds.has(r.id)).map((r) => r.id) };
    for (const s of source) {
        const t = byId.get(s.id);
        if (t === undefined) {
            out.insert.push(s);
            continue;
        }
        const diff = (0, catalogRows_1.differingFields)(fields, s, t);
        if (diff.length === 0)
            out.unchanged += 1;
        else
            out.drift.push({ id: s.id, fields: diff });
    }
    return out;
}
async function copyCatalog(client, input) {
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
        if (tenant.rows.length === 0)
            throw new CatalogCutoverError("TENANT_NOT_FOUND", "the target tenant does not exist; the copy never creates one");
        const member = await client.query(`SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
        WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`, [tenantId, actor]);
        if (member.rows.length === 0)
            throw new CatalogCutoverError("CUTOVER_PRINCIPAL_NOT_TENANT_MEMBER", "the cutover Principal is not an active member of the target tenant");
        const partSchema = await partMasterSchemaPresent(client);
        if (catalog.parts.length > 0 && !partSchema) {
            throw new CatalogCutoverError("PART_TARGET_SCHEMA_ABSENT", "eos_ops.parts lacks the Part Master columns: migrations 026 and 027 must be applied first");
        }
        const aliasSchema = await partAliasSchemaPresent(client);
        if (catalog.partAliases.length > 0 && !aliasSchema) {
            throw new CatalogCutoverError("PART_ALIAS_TARGET_SCHEMA_ABSENT", "eos_ops.part_aliases is absent: the catalog alias migration must be applied first");
        }
        const target = await tenantRows(client, tenantId, partSchema, aliasSchema);
        const models = plan(catalog.equipmentModels, target.models, catalogRows_1.EQUIPMENT_MODEL_FIELDS);
        const parts = plan(catalog.parts, target.parts, catalogRows_1.PART_FIELDS);
        const aliases = plan(catalog.partAliases, target.partAliases, catalogSnapshot_1.PART_ALIAS_DIGEST_FIELDS);
        const drift = [
            ...models.drift.map((d) => ({ kind: "equipment_model", ...d })),
            ...parts.drift.map((d) => ({ kind: "part", ...d })),
            ...aliases.drift.map((d) => ({ kind: "part_alias", ...d })),
        ];
        if (drift.length > 0)
            throw new CatalogCutoverError("DRIFT_DETECTED", `${drift.length} source records differ from the copied records; nothing was written`, drift);
        const fixtures = (0, catalogKnownFixtures_1.classifyKnownFixtures)(tenantId, target.models, new Set(catalog.equipmentModels.map((m) => m.id)));
        if (fixtures.refusals.length > 0) {
            throw new CatalogCutoverError("KNOWN_FIXTURE_MISMATCH", `the pinned Sample Company fixture set is not exactly as pinned; nothing was written`, fixtures.refusals);
        }
        const unknown = [
            ...fixtures.unknown.map((id) => ({ kind: "equipment_model", id })),
            ...parts.unknown.map((id) => ({ kind: "part", id })),
            ...aliases.unknown.map((id) => ({ kind: "part_alias", id })),
        ];
        if (unknown.length > 0)
            throw new CatalogCutoverError("TARGET_HAS_UNKNOWN_RECORDS", `${unknown.length} tenant records are not in the snapshot; nothing was written`, unknown);
        // ORDER IS THE FOREIGN KEY. Equipment Models, then Parts, then the aliases that name them --
        // each row's reference resolves at the moment it is written rather than at the end of the
        // transaction, so a broken chain fails on the row that broke it.
        for (const m of models.insert)
            await client.query(catalogRows_1.INSERT_EQUIPMENT_MODEL_SQL, (0, catalogRows_1.insertEquipmentModelValues)(tenantId, m, actor, actor));
        for (const p of parts.insert)
            await client.query(catalogRows_1.INSERT_PART_SQL, (0, catalogRows_1.insertPartValues)(tenantId, p, actor, actor));
        for (const a of aliases.insert) {
            const rec = a;
            await client.query(postgresPartAliasWriter_1.INSERT_ALIAS_SQL, (0, postgresPartAliasWriter_1.insertAliasValues)(tenantId, {
                aliasId: rec.id, partId: rec.partId, aliasType: rec.aliasType,
                originalValue: rec.originalValue, normalizedValue: rec.normalizedValue,
                status: rec.status, source: rec.source, manufacturerId: rec.manufacturerId,
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
        const report = {
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
            await client.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at)
         VALUES ($1, $2, 'catalog.cutover.copy', $3, 'catalog_snapshot', $4, NULL, $5, $6)`, [`audit_${(0, node_crypto_1.randomUUID)()}`, tenantId, actor, input.canonicalDigest, JSON.stringify({
                    equipmentModels: report.equipmentModels, parts: report.parts, partAliases: report.partAliases,
                    certificationExcluded: excluded.length,
                }), input.now ?? new Date()]);
        }
        await client.query("COMMIT");
        return report;
    }
    catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (err instanceof CatalogCutoverError)
            throw err;
        const e = err;
        throw new CatalogCutoverError("COPY_FAILED", `the copy could not be completed${typeof e?.constraint === "string" ? ` (constraint ${e.constraint})` : ""}; nothing was written`);
    }
}
/**
 * The #1911 catalog reference adapter's probe shape, restated for verification only.
 * Not an import: that adapter's CATALOG_CUTOVER_TAIL ratchet forbids any runtime module from importing it until the
 * cutover composes it (step 8). catalogCutoverPostgres.test.mjs proves this probe and the adapter agree on populated data.
 */
async function verdicts(db, tenantId, refs, partSchema) {
    if (refs.length === 0)
        return [];
    const partProbe = partSchema ? `EXISTS (SELECT 1 FROM eos_ops.parts p WHERE p.tenant_id = $1 AND p.id = r.ref)` : "false";
    const { rows } = await db.query(`SELECT r.ordinal, ${partProbe} AS is_part,
            EXISTS (SELECT 1 FROM eos_ops.equipment_models m WHERE m.tenant_id = $1 AND m.id = r.ref) AS is_model
       FROM unnest($2::text[]) WITH ORDINALITY AS r(ref, ordinal) ORDER BY r.ordinal`, [tenantId, refs.map((r) => r.ref)]);
    return rows.map((row, i) => {
        const own = refs[i].kind === "PART" ? row.is_part : row.is_model;
        const other = refs[i].kind === "PART" ? row.is_model : row.is_part;
        return own ? "FOUND" : other ? "WRONG_KIND" : "NOT_FOUND";
    });
}
/** Deterministic sample: ids ordered by sha256(id); `all` or the first N. */
function sampleIds(ids, sample) {
    const ordered = [...ids].sort((a, b) => {
        const ha = (0, node_crypto_1.createHash)("sha256").update(a).digest("hex"), hb = (0, node_crypto_1.createHash)("sha256").update(b).digest("hex");
        return ha < hb ? -1 : ha > hb ? 1 : 0;
    });
    return sample === "all" ? ordered : ordered.slice(0, sample);
}
/** A tenant id that cannot exist (eos_policy.tenants ids are never this), for the cross-tenant NOT_FOUND probe. */
exports.ABSENT_TENANT_PROBE = "catalog-cutover-verify-absent-tenant";
async function verifyCatalog(client, input) {
    const excluded = input.certificationExcluded ?? [];
    const { tenantId, catalog } = input;
    await client.query("BEGIN READ ONLY");
    try {
        const partSchema = await partMasterSchemaPresent(client);
        const aliasSchema = await partAliasSchemaPresent(client);
        const target = await tenantRows(client, tenantId, partSchema, aliasSchema);
        const idsOf = (rows) => new Set(rows.map((r) => r.id));
        const fixtures = (0, catalogKnownFixtures_1.classifyKnownFixtures)(tenantId, target.models, idsOf(catalog.equipmentModels));
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
        const mismatches = [];
        const targetModel = new Map(target.models.map((m) => [m.id, m]));
        const targetPart = new Map(target.parts.map((p) => [p.id, p]));
        const sourceModel = new Map(catalog.equipmentModels.map((m) => [m.id, m]));
        const sourcePart = new Map(catalog.parts.map((p) => [p.id, p]));
        const modelSample = sampleIds([...sModels].filter((id) => tModels.has(id)), input.sample);
        const partSample = sampleIds([...sParts].filter((id) => tParts.has(id)), input.sample);
        for (const id of modelSample) {
            const fields = (0, catalogRows_1.differingFields)(catalogRows_1.EQUIPMENT_MODEL_FIELDS, sourceModel.get(id), targetModel.get(id));
            if (fields.length > 0)
                mismatches.push({ kind: "equipment_model", id, fields });
        }
        for (const id of partSample) {
            const fields = (0, catalogRows_1.differingFields)(catalogRows_1.PART_FIELDS, sourcePart.get(id), targetPart.get(id));
            if (fields.length > 0)
                mismatches.push({ kind: "part", id, fields });
        }
        const targetAlias = new Map(target.partAliases.map((a) => [a.id, a]));
        const sourceAlias = new Map(catalog.partAliases.map((a) => [a.id, a]));
        const aliasSample = sampleIds([...sAliases].filter((id) => tAliases.has(id)), input.sample);
        for (const id of aliasSample) {
            const fields = (0, catalogRows_1.differingFields)(catalogSnapshot_1.PART_ALIAS_DIGEST_FIELDS, sourceAlias.get(id), targetAlias.get(id));
            if (fields.length > 0)
                mismatches.push({ kind: "part_alias", id, fields });
        }
        // NORMALIZATION AGREEMENT, re-derived in the target. A stored id that disagrees with what its own
        // value normalizes to is an identifier that would never be found by the lookup it exists for.
        const aliasIdentityDisagreements = target.partAliases
            .filter((a) => {
            const derived = (0, partAliasIdentity_1.deriveAliasDocId)(a.aliasType, a.originalValue, (a.manufacturerId ?? undefined));
            return derived === null || derived.docId !== a.id || derived.normalizedValue !== a.normalizedValue;
        })
            .map((a) => a.id).sort();
        const danglingAliasPartReferences = aliasSchema && partSchema
            ? (await client.query(`SELECT a.id FROM eos_ops.part_aliases a LEFT JOIN eos_ops.parts p
           ON p.tenant_id = a.tenant_id AND p.id = a.part_id
          WHERE a.tenant_id = $1 AND p.id IS NULL ORDER BY a.id`, [tenantId])).rows.map((r) => String(r.id))
            : [];
        const dupAliases = aliasSchema
            ? (await client.query(`SELECT id FROM eos_ops.part_aliases WHERE tenant_id = $1
          GROUP BY id HAVING count(*) > 1`, [tenantId])).rows
            : [];
        const dupModels = (await client.query(`SELECT id FROM eos_ops.equipment_models WHERE tenant_id = $1 GROUP BY id HAVING count(*) > 1`, [tenantId])).rows;
        const dupParts = partSchema ? (await client.query(`SELECT id FROM eos_ops.parts WHERE tenant_id = $1 GROUP BY id HAVING count(*) > 1`, [tenantId])).rows : [];
        const dangling = partSchema
            ? (await client.query(`SELECT p.id FROM eos_ops.parts p LEFT JOIN eos_ops.equipment_models m ON m.tenant_id = p.tenant_id AND m.id = p.equipment_model_id
          WHERE p.tenant_id = $1 AND p.equipment_model_id IS NOT NULL AND m.id IS NULL ORDER BY p.id`, [tenantId])).rows.map((r) => String(r.id))
            : [];
        // Verdict spot-checks: up to 5 sampled ids per kind, each as own kind, as the other kind, and in an absent tenant.
        const checks = [];
        for (const id of modelSample.slice(0, 5)) {
            checks.push({ kind: "EQUIPMENT_MODEL", ref: id, tenant: tenantId, expected: "FOUND" });
            checks.push({ kind: "PART", ref: id, tenant: tenantId, expected: sParts.has(id) ? "FOUND" : "WRONG_KIND" });
            checks.push({ kind: "EQUIPMENT_MODEL", ref: id, tenant: exports.ABSENT_TENANT_PROBE, expected: "NOT_FOUND" });
        }
        for (const id of partSample.slice(0, 5)) {
            checks.push({ kind: "PART", ref: id, tenant: tenantId, expected: "FOUND" });
            checks.push({ kind: "EQUIPMENT_MODEL", ref: id, tenant: tenantId, expected: sModels.has(id) ? "FOUND" : "WRONG_KIND" });
            checks.push({ kind: "PART", ref: id, tenant: exports.ABSENT_TENANT_PROBE, expected: "NOT_FOUND" });
        }
        const absentRef = "catalog-cutover-verify-absent-ref";
        checks.push({ kind: "PART", ref: absentRef, tenant: tenantId, expected: "NOT_FOUND" });
        checks.push({ kind: "EQUIPMENT_MODEL", ref: absentRef, tenant: tenantId, expected: "NOT_FOUND" });
        const verdictChecks = [];
        for (const tenant of [tenantId, exports.ABSENT_TENANT_PROBE]) {
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
        const report = {
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
        const reconciled = report.counts.equipmentModels.source === report.counts.equipmentModels.target &&
            report.counts.parts.source === report.counts.parts.target &&
            report.counts.partAliases.source === report.counts.partAliases.target &&
            missing.length === 0 && extra.length === 0 && mismatches.length === 0 && duplicateIdentities.length === 0 &&
            dangling.length === 0 && danglingAliasPartReferences.length === 0 && aliasIdentityDisagreements.length === 0 &&
            verdictChecks.every((c) => c.expected === c.actual) && fixturesInTarget.length === 0 && fixtures.refusals.length === 0 &&
            (catalog.parts.length === 0 || partSchema) && (catalog.partAliases.length === 0 || aliasSchema);
        return { ...report, reconciled };
    }
    catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
    }
}
//# sourceMappingURL=catalogCutover.js.map