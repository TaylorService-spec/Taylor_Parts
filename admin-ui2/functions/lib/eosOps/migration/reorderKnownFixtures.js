"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST_PIN_NULLABLE_COLUMNS = exports.KNOWN_REORDER_FIXTURES = exports.SAMPLE_COMPANY_FIXTURE_COMPANY_KEY = exports.REORDER_FIXTURE_TENANT_ID = exports.KNOWN_NON_MIGRATED_FIXTURE = void 0;
exports.classifyReorderTarget = classifyReorderTarget;
exports.KNOWN_NON_MIGRATED_FIXTURE = "KNOWN_NON_MIGRATED_FIXTURE";
exports.REORDER_FIXTURE_TENANT_ID = "tenant-6ce59be1-1979-45cd-9d17-a4969037fb25";
exports.SAMPLE_COMPANY_FIXTURE_COMPANY_KEY = "sample-co-synthetic";
/** Measured read-only on eos-api-nonprod 2026-09-30 with `fingerprintSql` below. */
exports.KNOWN_REORDER_FIXTURES = Object.freeze({
    reorderRequests: Object.freeze([
        { id: "rr_ab54d29e-ab43-4792-9e7f-4c8b9fc771ae", fingerprint: "27eb1d62753bb7adfd6e086debe4cafd2fb25dc045ec7b1cd18f72481dd9c1f4" },
        { id: "rr_f7090a49-f1b1-40cf-8bde-c7d9a69574af", fingerprint: "79908c3dfaaf47a8777010d7ce9940856fad25ef59429c14f5de5c470aa98ee0" },
    ]),
    purchaseOrders: Object.freeze([
        { id: "rr_ab54d29e-ab43-4792-9e7f-4c8b9fc771ae", fingerprint: "35398321f84ba20f037c100cac5f31543db5999b9632ced5b8702875de1d616d" },
        { id: "rr_f7090a49-f1b1-40cf-8bde-c7d9a69574af", fingerprint: "0dd2b89a22cc4723c48c127911813fddf4518a077d4f352276eae7bfcc906245" },
    ]),
    /** A void's identity is the purchase order it voids. */
    voids: Object.freeze([
        { id: "rr_ab54d29e-ab43-4792-9e7f-4c8b9fc771ae", fingerprint: "be793be7b1f923a730ecd02d526ddb5d3fdbd38719d7315437561f2eed29a11b" },
    ]),
});
const TABLES = Object.freeze({
    reorderRequests: { table: "reorder_requests", idColumn: "id" },
    purchaseOrders: { table: "purchase_orders", idColumn: "id" },
    voids: { table: "purchase_order_voids", idColumn: "purchase_order_id" },
});
/**
 * Columns ADDED to a pinned table after the pins were measured. Each is left out of the fingerprint ONLY while it is NULL
 * on the row -- the value every pre-existing row carries -- so an additive migration does not silently invalidate the
 * pins, while ANY value written into such a column still changes the fingerprint and refuses. Additive only: a column
 * is listed here when a migration adds it, never to excuse a changed pinned column.
 *   reorder_requests: create_idempotency_key, create_request_fingerprint (migration 1764380000000, G2).
 *   purchase_orders: supplier_kind, supplier_id, supplier_operating_company_id, purchasing_operating_company_id (migration
 *     1764430000000, DECISIONS #193 -- explicit supplier identity; a pre-existing text-only PO carries all four NULL).
 */
exports.POST_PIN_NULLABLE_COLUMNS = Object.freeze({
    reorderRequests: Object.freeze(["create_idempotency_key", "create_request_fingerprint"]),
    purchaseOrders: Object.freeze(["supplier_kind", "supplier_id", "supplier_operating_company_id", "purchasing_operating_company_id"]),
    voids: Object.freeze([]),
});
/** The canonical fingerprint, computed by PostgreSQL. The caller's transaction must run with TimeZone UTC. */
const fingerprintSql = (table, idColumn) => `SELECT t.${idColumn} AS id, t.operating_company_key AS key,
          encode(sha256(convert_to((to_jsonb(t) - COALESCE((SELECT array_agg(c) FROM unnest($2::text[]) c
                                                             WHERE to_jsonb(t) -> c = 'null'::jsonb), '{}'::text[]))::text, 'UTF8')), 'hex') AS fingerprint
     FROM eos_ops.${table} t WHERE t.tenant_id = $1 ORDER BY 1`;
/**
 * Classify every target Reorder / PO / void row the snapshot does not account for. READ ONLY; runs in its own
 * READ ONLY transaction with TimeZone UTC so the fingerprint does not depend on the session.
 */
async function classifyReorderTarget(client, tenantId, sourceIds) {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
        await client.query("SET LOCAL TimeZone = 'UTC'");
        const pinnedTenant = tenantId === exports.REORDER_FIXTURE_TENANT_ID;
        const known = { reorderRequests: [], purchaseOrders: [], voids: [] };
        const unknown = { reorderRequests: [], purchaseOrders: [], voids: [] };
        const refusals = [];
        const present = { reorderRequests: new Set(), purchaseOrders: new Set(), voids: new Set() };
        for (const kind of Object.keys(TABLES)) {
            const pins = new Map(exports.KNOWN_REORDER_FIXTURES[kind].map((p) => [p.id, p.fingerprint]));
            const rows = (await client.query(fingerprintSql(TABLES[kind].table, TABLES[kind].idColumn), [tenantId, exports.POST_PIN_NULLABLE_COLUMNS[kind]])).rows;
            for (const r of rows) {
                present[kind].add(r.id);
                if (sourceIds[kind].has(r.id))
                    continue;
                const pin = pinnedTenant ? pins.get(r.id) : undefined;
                if (pin !== undefined) {
                    if (r.fingerprint === pin)
                        known[kind].push({ id: r.id, classification: exports.KNOWN_NON_MIGRATED_FIXTURE, fingerprint: r.fingerprint });
                    else
                        refusals.push(`${TABLES[kind].table} ${r.id} is a pinned fixture but its content changed`);
                }
                else if (r.key === exports.SAMPLE_COMPANY_FIXTURE_COMPANY_KEY) {
                    refusals.push(`${TABLES[kind].table} ${r.id} is a Sample Company record that is not a pinned fixture`);
                }
                else {
                    unknown[kind].push(r.id);
                }
            }
        }
        // THE SET IS EXACT, and so are its relationships. Checked only where the fixtures live: a tenant holding none of
        // them (production, a test tenant) has nothing to prove.
        const anyPinnedPresent = Object.keys(TABLES).some((k) => exports.KNOWN_REORDER_FIXTURES[k].some((p) => present[k].has(p.id)));
        if (pinnedTenant && anyPinnedPresent) {
            for (const kind of Object.keys(TABLES)) {
                for (const p of exports.KNOWN_REORDER_FIXTURES[kind])
                    if (!present[kind].has(p.id))
                        refusals.push(`pinned fixture ${TABLES[kind].table} ${p.id} is missing`);
            }
            const knownIds = (k) => new Set(known[k].map((x) => x.id));
            for (const po of exports.KNOWN_REORDER_FIXTURES.purchaseOrders) {
                if (knownIds("purchaseOrders").has(po.id) && !knownIds("reorderRequests").has(po.id))
                    refusals.push(`pinned purchase order ${po.id} is not paired with its pinned request`);
            }
            for (const v of exports.KNOWN_REORDER_FIXTURES.voids) {
                if (knownIds("voids").has(v.id) && !knownIds("purchaseOrders").has(v.id))
                    refusals.push(`pinned void ${v.id} does not name its pinned purchase order`);
            }
        }
        await client.query("COMMIT");
        return Object.freeze({ known: Object.freeze(known), unknown: Object.freeze(unknown), refusals: Object.freeze(refusals) });
    }
    catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
    }
}
//# sourceMappingURL=reorderKnownFixtures.js.map