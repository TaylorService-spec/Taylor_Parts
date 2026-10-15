"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ABSENT_TENANT_PROBE = exports.CatalogCutoverError = void 0;
exports.partMasterSchemaPresent = partMasterSchemaPresent;
exports.copyCatalog = copyCatalog;
exports.sampleIds = sampleIds;
exports.verifyCatalog = verifyCatalog;
const node_crypto_1 = require("node:crypto");
const catalogRows_1 = require("./catalogRows");
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
async function tenantRows(db, tenantId, withParts) {
    const models = (await db.query(`${catalogRows_1.EQUIPMENT_MODEL_SELECT} WHERE tenant_id = $1 ORDER BY id`, [tenantId])).rows.map(catalogRows_1.equipmentModelFromRow);
    const parts = withParts ? (await db.query(`${catalogRows_1.PART_SELECT} WHERE tenant_id = $1 ORDER BY id`, [tenantId])).rows.map(catalogRows_1.partFromRow) : [];
    return { models, parts };
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
        const target = await tenantRows(client, tenantId, partSchema);
        const models = plan(catalog.equipmentModels, target.models, catalogRows_1.EQUIPMENT_MODEL_FIELDS);
        const parts = plan(catalog.parts, target.parts, catalogRows_1.PART_FIELDS);
        const drift = [...models.drift.map((d) => ({ kind: "equipment_model", ...d })), ...parts.drift.map((d) => ({ kind: "part", ...d }))];
        if (drift.length > 0)
            throw new CatalogCutoverError("DRIFT_DETECTED", `${drift.length} source records differ from the copied records; nothing was written`, drift);
        const unknown = [...models.unknown.map((id) => ({ kind: "equipment_model", id })), ...parts.unknown.map((id) => ({ kind: "part", id }))];
        if (unknown.length > 0)
            throw new CatalogCutoverError("TARGET_HAS_UNKNOWN_RECORDS", `${unknown.length} tenant records are not in the snapshot; nothing was written`, unknown);
        for (const m of models.insert)
            await client.query(catalogRows_1.INSERT_EQUIPMENT_MODEL_SQL, (0, catalogRows_1.insertEquipmentModelValues)(tenantId, m, actor, actor));
        for (const p of parts.insert)
            await client.query(catalogRows_1.INSERT_PART_SQL, (0, catalogRows_1.insertPartValues)(tenantId, p, actor, actor));
        const inserted = models.insert.length + parts.insert.length;
        const report = {
            outcome: inserted > 0 ? "COPIED" : "NO_CHANGES",
            tenantId,
            canonicalDigest: input.canonicalDigest,
            equipmentModels: { inserted: models.insert.length, unchanged: models.unchanged },
            parts: { inserted: parts.insert.length, unchanged: parts.unchanged },
            cutoverPrincipalId: actor,
            certificationExcluded: { count: excluded.length, records: excluded },
        };
        if (inserted > 0) {
            await client.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at)
         VALUES ($1, $2, 'catalog.cutover.copy', $3, 'catalog_snapshot', $4, NULL, $5, $6)`, [`audit_${(0, node_crypto_1.randomUUID)()}`, tenantId, actor, input.canonicalDigest, JSON.stringify({
                    equipmentModels: report.equipmentModels, parts: report.parts, certificationExcluded: excluded.length,
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
        const target = await tenantRows(client, tenantId, partSchema);
        const idsOf = (rows) => new Set(rows.map((r) => r.id));
        const sModels = idsOf(catalog.equipmentModels), tModels = idsOf(target.models);
        const sParts = idsOf(catalog.parts), tParts = idsOf(target.parts);
        const missing = [...[...sModels].filter((id) => !tModels.has(id)).map((id) => `equipment_model:${id}`), ...[...sParts].filter((id) => !tParts.has(id)).map((id) => `part:${id}`)];
        const extra = [...[...tModels].filter((id) => !sModels.has(id)).map((id) => `equipment_model:${id}`), ...[...tParts].filter((id) => !sParts.has(id)).map((id) => `part:${id}`)];
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
            .filter((x) => (x.kind === "part" ? tParts.has(x.id) : tModels.has(x.id)))
            .map((x) => `${x.kind}:${x.id}`);
        const duplicateIdentities = [...dupModels.map((r) => ({ kind: "equipment_model", id: String(r.id) })), ...dupParts.map((r) => ({ kind: "part", id: String(r.id) }))];
        const report = {
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
            certificationExcluded: { count: excluded.length, records: excluded },
            certificationFixturesInTarget: fixturesInTarget,
        };
        const reconciled = report.counts.equipmentModels.source === report.counts.equipmentModels.target &&
            report.counts.parts.source === report.counts.parts.target &&
            missing.length === 0 && extra.length === 0 && mismatches.length === 0 && duplicateIdentities.length === 0 &&
            dangling.length === 0 && verdictChecks.every((c) => c.expected === c.actual) && fixturesInTarget.length === 0 &&
            (catalog.parts.length === 0 || partSchema);
        return { ...report, reconciled };
    }
    catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
    }
}
//# sourceMappingURL=catalogCutover.js.map