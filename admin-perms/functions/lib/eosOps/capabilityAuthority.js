"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GRANT_CONDITION_RELATION = exports.SHIPPED_GRANT_CONDITION_PROVIDER = void 0;
exports.resolveOperationalCapabilities = resolveOperationalCapabilities;
exports.resolveOperationalContext = resolveOperationalContext;
exports.resolveOperationalContextForPrincipal = resolveOperationalContextForPrincipal;
exports.capabilitiesWithoutUnevaluatedConditions = capabilitiesWithoutUnevaluatedConditions;
exports.capabilitiesForRoleKeys = capabilitiesForRoleKeys;
exports.operationalCapabilityPool = operationalCapabilityPool;
exports.listCapabilityKeys = listCapabilityKeys;
exports.roleCapabilityGrants = roleCapabilityGrants;
exports.principalCapabilityGrants = principalCapabilityGrants;
exports.grantConditionRows = grantConditionRows;
exports.describeGrantConditionRelation = describeGrantConditionRelation;
exports.grantConditionRelationDrift = grantConditionRelationDrift;
const policyDatabase_1 = require("../adminPolicy/policyDatabase");
const principalContext_1 = require("../adminPolicy/principalContext");
const assignmentScopeRuntime_1 = require("../adminPolicy/assignmentScopeRuntime");
const conditionalEntitlement_1 = require("./conditionalEntitlement");
const grantConditionPolicy_1 = require("./grantConditionPolicy");
const SCHEMA = "eos_policy";
/** The deployed provider: the SHIPPED catalog, which is empty, frozen, and costs ZERO queries. */
const SHIPPED_GRANT_CONDITION_PROVIDER = () => conditionalEntitlement_1.SHIPPED_GRANT_CONDITIONS;
exports.SHIPPED_GRANT_CONDITION_PROVIDER = SHIPPED_GRANT_CONDITION_PROVIDER;
/**
 * The request-scoped, memoizing entitlement resolver.
 *
 * ONE resolution per request, however many gate sites ask and however many capabilities a kernel
 * checks in its loop. A REJECTION is memoized too, deliberately: the store was unreadable for this
 * request, and a retry inside the same request must not be able to turn that outage into a
 * successful "no conditions found".
 */
function requestScopedEntitlementResolver(pool, tenantId, heldRoleKeys, direct, conditions, counters) {
    let pending;
    return () => {
        counters.requests += 1;
        if (pending)
            return pending;
        counters.resolutions += 1;
        pending = (async () => {
            // The provenance read and the condition catalog, together, and only now. `capabilitiesForRoleKeys`
            // already answered "what may this Principal do"; this answers "and WHO granted it, under what".
            // The direct grants were read ONCE, on the request path, and are reused here -- so the flat set and the
            // entitlement list are built from the same rows and cannot disagree about a direct exception.
            const [grantRows, catalog] = await Promise.all([
                roleCapabilityGrants(pool, tenantId, heldRoleKeys),
                Promise.resolve(conditions(tenantId)),
            ]);
            return (0, conditionalEntitlement_1.entitlementsFrom)([...roleGrantsOf(grantRows), ...directGrantsOf(direct)], catalog);
        })();
        return pending;
    };
}
const roleGrantsOf = (rows) => rows.map((r) => ({ grantor: { kind: "ROLE", roleKey: r.roleKey }, capabilityKey: r.capabilityKey }));
const directGrantsOf = (rows) => rows.map((r) => ({ grantor: { kind: "PRINCIPAL", principalId: r.principalId }, capabilityKey: r.capabilityKey }));
/**
 * THE capability resolution -- Roles AND direct exceptions, one set of semantics. Every runtime entry point
 * (`resolveOperationalContext`, `resolveOperationalContextForPrincipal`) and the operator actor resolution
 * (employeeAdministrationAuthority) call this, so a direct grant is decided the same way on every gate:
 *
 *   capability sources   role_capabilities of the QUALIFYING GLOBAL Roles  +  UNEXPIRED principal_capabilities
 *   conditions           ONE catalog (ROLE and PRINCIPAL cells) from the composed provider
 *   flat set             a key with at least one UNCONDITIONED grant, of either kind
 *   conditionallyHeld    a key reached only through conditioned grants, of either kind -- never flat
 *   entitlements         every grant, with its grantor (ROLE or PRINCIPAL) and its condition
 *
 * An expired direct grant is not read at all (the SQL filters on `now()`), so it confers nothing on any gate. An
 * unreadable grant or condition store throws: "could not read" is never "holds nothing extra" nor "unconditioned".
 */
async function resolveOperationalCapabilities(pool, tenantId, principalId, heldRoleKeys, conditions) {
    if (typeof conditions !== "function") {
        throw new Error("resolveOperationalCapabilities: the condition source must be a GrantConditionProvider");
    }
    const [granted, catalog] = await Promise.all([
        grantedCapabilityKeys(pool, tenantId, heldRoleKeys, principalId),
        Promise.resolve(conditions(tenantId)),
    ]);
    const direct = Object.freeze(granted.direct.map((capabilityKey) => Object.freeze({ principalId, capabilityKey })));
    const held = new Set([...granted.viaRoles, ...granted.direct]);
    // A CONDITIONED-ONLY CAPABILITY IS NEVER IN THE FLAT SET (Pass 8 D1, PLATFORM_SAFETY) -- for a direct grant
    // exactly as for a Role grant. The provenance read happens only when a condition names one of this
    // Principal's grantors (a held Role, or the Principal itself), so an unconditioned tenant pays nothing extra.
    const principalPrefix = `PRINCIPAL:${principalId}|`;
    const touches = [...catalog.keys()].some((k) => k.startsWith(principalPrefix) || heldRoleKeys.some((r) => k.startsWith(`ROLE:${r}|`)));
    let capabilities = held;
    let conditionallyHeld = new Set();
    if (touches) {
        const roleRows = heldRoleKeys.length > 0 ? await roleCapabilityGrants(pool, tenantId, heldRoleKeys) : [];
        const unconditional = new Set((0, conditionalEntitlement_1.entitlementsFrom)([...roleGrantsOf(roleRows), ...directGrantsOf(direct)], catalog)
            .filter((e) => e.condition === null).map((e) => e.capabilityKey));
        capabilities = new Set([...held].filter((k) => unconditional.has(k)));
        conditionallyHeld = new Set([...held].filter((k) => !unconditional.has(k)));
    }
    const counters = { requests: 0, resolutions: 0 };
    const entitlements = requestScopedEntitlementResolver(pool, tenantId, heldRoleKeys, direct, () => catalog, counters);
    return Object.freeze({ capabilities, conditionallyHeld, directGrants: direct, catalog, entitlements, lookups: counters });
}
/**
 * Resolve an authenticated subject to its tenant, Roles and operational capabilities.
 *
 * Refuses (via `resolvePrincipalContext`'s own errors) exactly as the Administration API does --
 * no reduced-access fallback, ever. A principal holding zero qualifying Roles resolves successfully
 * with an EMPTY capability set, which is what "authenticated but not authorized for anything
 * operational" looks like; it is the caller's job to then refuse the specific operation, not this
 * function's job to throw for it.
 */
async function resolveOperationalContext(reader, pool, input, conditions = exports.SHIPPED_GRANT_CONDITION_PROVIDER) {
    // FAIL CLOSED ON A MISCOMPOSED SERVER. The fourth argument used to be a catalog; a deployment that
    // still passes one would silently produce a resolver that throws on first use. It refuses here,
    // loudly, at composition time, rather than one request later.
    if (typeof conditions !== "function") {
        throw new Error("resolveOperationalContext: the condition source must be a GrantConditionProvider");
    }
    const principalContext = await (0, principalContext_1.resolvePrincipalContext)(reader, input);
    return operationalContextFor(pool, principalContext, conditions);
}
/**
 * The SAME operational context for a Principal named by id -- for Administration's effective-access
 * explanation only (never authentication). Principal resolution is `resolvePrincipalContextById`, which
 * shares its whole tail with `resolvePrincipalContext`; everything after it is this module's own code.
 */
async function resolveOperationalContextForPrincipal(reader, pool, principalId, requestedTenantId, conditions) {
    if (typeof conditions !== "function") {
        throw new Error("resolveOperationalContextForPrincipal: the condition source must be a GrantConditionProvider");
    }
    const principalContext = await (0, principalContext_1.resolvePrincipalContextById)(reader, principalId, requestedTenantId);
    return operationalContextFor(pool, principalContext, conditions);
}
/** Principal context -> capabilities + the request-scoped entitlement resolver. Shared by both entry points. */
async function operationalContextFor(pool, principalContext, conditions) {
    // ONE RESOLUTION, TWO GRANT SOURCES (lane DX). Qualifying GLOBAL Role grants and unexpired DIRECT exceptions are
    // both capability sources, decided by `resolveOperationalCapabilities` with one set of rules: an unconditioned
    // grant of either kind is flat; a key reached only through conditioned grants of either kind is
    // `conditionallyHeld`, which only the entitled seam (authorizeEntitledAction) may evaluate, per record.
    const resolved = await resolveOperationalCapabilities(pool, principalContext.tenantId, principalContext.uid, principalContext.heldRoleKeys, conditions);
    const catalog = resolved.catalog;
    // SCOPED ASSIGNMENTS (lane SC). Resolved only when the principal HAS one, so a global-only principal pays nothing
    // and every existing decision is untouched. Only a runtime-supported scope type with an exact value can produce a
    // holding, and only for a capability a gate site decides at that scope; everything else is reported inert.
    // A direct grant has no scope and never appears here.
    const scoped = principalContext.scopedAssignments ?? [];
    let scopedHeld = Object.freeze([]);
    let inertScoped = Object.freeze([]);
    if (scoped.length > 0) {
        const scopedRoleKeys = [...new Set(scoped.map((a) => a.roleKey))];
        const rows = await roleCapabilityGrants(pool, principalContext.tenantId, scopedRoleKeys);
        const result = (0, assignmentScopeRuntime_1.scopedHoldingsFrom)(scoped, rows, (roleKey, capabilityKey) => catalog.get((0, conditionalEntitlement_1.grantCellKey)({ kind: "ROLE", roleKey }, capabilityKey)) ?? null);
        scopedHeld = result.held;
        inertScoped = result.inert;
    }
    return Object.freeze({
        principalContext,
        capabilities: resolved.capabilities,
        conditionallyHeld: resolved.conditionallyHeld,
        scopedHeld,
        inertScoped,
        directGrants: resolved.directGrants,
        entitlements: resolved.entitlements,
        lookups: resolved.lookups,
    });
}
/**
 * THE FLAT SET FOR A GATE THAT CANNOT EVALUATE CONDITIONS -- fail closed, never wider.
 *
 * The Commercial and CRM kernels decide on `capabilities.has(key)` alone; they have no record
 * context to answer a per-grant condition with. Handing them the full flat set would let a
 * CONDITIONED grant (e.g. "only records assigned to me") act as an UNCONDITIONAL one there -- a
 * widening an administrator never made. So such a transport receives the flat set MINUS every key
 * this principal reaches ONLY through conditioned entitlements. A key reached by at least one
 * unconditional grant is kept.
 *
 * ZERO-CONDITION PARITY. With no ACTIVE condition row for the tenant (the state of every tenant
 * until an administrator sets one) the catalog is empty and the set is returned UNCHANGED, after
 * exactly one indexed read of the condition relation -- byte-identical to the previous behaviour.
 * An unreadable condition store throws: "could not read the conditions" is never "there are none".
 */
async function capabilitiesWithoutUnevaluatedConditions(pool, principalContext, capabilities, conditions) {
    const catalog = await conditions(principalContext.tenantId);
    if (catalog.size === 0)
        return capabilities;
    // BOTH grant sources (lane DX): a key held through an UNCONDITIONED direct exception is kept, exactly as one held
    // through an unconditioned Role grant is; a key reached only through conditioned grants of either kind is withheld.
    const [roleRows, direct] = await Promise.all([
        roleCapabilityGrants(pool, principalContext.tenantId, principalContext.heldRoleKeys),
        principalCapabilityGrants(pool, principalContext.tenantId, principalContext.uid),
    ]);
    const unconditional = new Set((0, conditionalEntitlement_1.entitlementsFrom)([...roleGrantsOf(roleRows), ...directGrantsOf(direct)], catalog)
        .filter((e) => e.condition === null).map((e) => e.capabilityKey));
    return new Set([...capabilities].filter((key) => unconditional.has(key)));
}
/**
 * The role_capabilities join, resolved by Role KEY (what `resolvePrincipalContext` already computed)
 * rather than by Role id -- so this file needs no second identity lookup and cannot disagree with
 * the Administration API about which Roles are held.
 */
async function capabilitiesForRoleKeys(pool, tenantId, roleKeys) {
    if (roleKeys.length === 0)
        return new Set();
    const { rows } = await pool.query(`SELECT DISTINCT c.key AS key
       FROM ${SCHEMA}.role_capabilities rc
       JOIN ${SCHEMA}.capabilities c ON c.id = rc.capability_id
       JOIN ${SCHEMA}.roles r        ON r.id = rc.role_id
      WHERE rc.tenant_id = $1
        AND r.tenant_id  = $1
        AND r.key = ANY($2::text[])`, [tenantId, roleKeys]);
    return new Set(rows.map((r) => r.key));
}
/**
 * The flat-set read, BOTH grant sources in ONE statement (lane DX): the Role join `capabilitiesForRoleKeys` performs,
 * UNION ALL the Principal's UNEXPIRED direct grants (`principalCapabilityGrants`' filter). One round trip, so counting
 * direct exceptions costs a request nothing extra; each row says which source it came from.
 */
async function grantedCapabilityKeys(pool, tenantId, roleKeys, principalId) {
    const { rows } = await pool.query(`SELECT DISTINCT c.key AS key, 'ROLE' AS source
       FROM ${SCHEMA}.role_capabilities rc
       JOIN ${SCHEMA}.capabilities c ON c.id = rc.capability_id
       JOIN ${SCHEMA}.roles r        ON r.id = rc.role_id
      WHERE rc.tenant_id = $1
        AND r.tenant_id  = $1
        AND r.key = ANY($2::text[])
     UNION ALL
     SELECT DISTINCT c.key AS key, 'PRINCIPAL' AS source
       FROM ${SCHEMA}.principal_capabilities pc
       JOIN ${SCHEMA}.capabilities c ON c.id = pc.capability_id
      WHERE pc.tenant_id = $1 AND pc.principal_id = $3
        AND ((to_jsonb(pc) ->> 'expires_at') IS NULL OR (to_jsonb(pc) ->> 'expires_at')::timestamptz > now())`, [tenantId, [...roleKeys], principalId]);
    // Only a row the statement tagged PRINCIPAL is a direct exception; every other row is the Role join's.
    return {
        viaRoles: rows.filter((r) => r.source !== "PRINCIPAL").map((r) => r.key),
        direct: rows.filter((r) => r.source === "PRINCIPAL").map((r) => r.key).sort(),
    };
}
/** Convenience for a command that needs the pool this module already knows how to build. */
function operationalCapabilityPool() {
    return (0, policyDatabase_1.getPolicyDatabasePool)();
}
/**
 * Every capability key the catalog currently declares. Exists so callers outside this module --
 * the P1A inventory-authority capability parity harness (adminPolicy/migration/
 * inventoryCapabilityParityHarness.ts) in particular -- never need their own SQL or their own
 * `pg` import to answer "is this capability key known" -- exactly the same "no SQL beyond this
 * file" rule the module header already states for `role_capabilities`.
 */
async function listCapabilityKeys(pool) {
    const { rows } = await pool.query(`SELECT key FROM ${SCHEMA}.capabilities`);
    return new Set(rows.map((r) => r.key));
}
/**
 * The same join `capabilitiesForRoleKeys` performs, WITHOUT the DISTINCT-on-key that discards the
 * Role. Same table, same tenant guard, same resolution by Role key; only the projection differs.
 */
async function roleCapabilityGrants(pool, tenantId, roleKeys) {
    if (roleKeys.length === 0)
        return Object.freeze([]);
    const { rows } = await pool.query(`SELECT DISTINCT r.key AS role_key, c.key AS capability_key
       FROM ${SCHEMA}.role_capabilities rc
       JOIN ${SCHEMA}.capabilities c ON c.id = rc.capability_id
       JOIN ${SCHEMA}.roles r        ON r.id = rc.role_id
      WHERE rc.tenant_id = $1
        AND r.tenant_id  = $1
        AND r.key = ANY($2::text[])
      ORDER BY r.key, c.key`, [tenantId, roleKeys]);
    return Object.freeze(rows.map((r) => Object.freeze({ roleKey: r.role_key, capabilityKey: r.capability_key })));
}
/**
 * Direct grants for one Principal (AB3) -- UNEXPIRED rows only, decided against the database clock.
 *
 * A capability SOURCE of `resolveOperationalCapabilities` since lane DX (Owner: "complete support for direct
 * exceptions"): every runtime gate sees a direct grant through that one resolution, with a Role grant's semantics
 * (conditions narrow it; it has no scope). It stays a separate reader so the Role join above keeps answering the
 * Role question alone, which the baseline and the Role-only equality proofs pin.
 */
async function principalCapabilityGrants(pool, tenantId, principalId) {
    const { rows } = await pool.query(`SELECT DISTINCT pc.principal_id AS principal_id, c.key AS capability_key
       FROM ${SCHEMA}.principal_capabilities pc
       JOIN ${SCHEMA}.capabilities c ON c.id = pc.capability_id
      WHERE pc.tenant_id = $1 AND pc.principal_id = $2
        AND ((to_jsonb(pc) ->> 'expires_at') IS NULL OR (to_jsonb(pc) ->> 'expires_at')::timestamptz > now())
      ORDER BY c.key`, [tenantId, principalId]);
    return Object.freeze(rows.map((r) => Object.freeze({ principalId: r.principal_id, capabilityKey: r.capability_key })));
}
/**
 * The relation that holds per-grant conditions. LIVE: migration 1762214400000, applied 2026-09-24.
 * The name is declared once, in grantConditionPolicy.ts, and re-stated here only so the SQL below
 * reads as SQL.
 */
exports.GRANT_CONDITION_RELATION = grantConditionPolicy_1.GRANT_CONDITION_RELATION_NAME;
/**
 * Read the ACTIVE per-grant conditions for one tenant.
 *
 * THE RELATION IS LIVE and holds zero rows, so today this returns an EMPTY list for every tenant --
 * which is not the same fact as the relation being absent, and the difference is load-bearing. A
 * database that does not carry the relation makes this throw `relation does not exist`, which the
 * entitled decision path turns into CONTEXT_AUTHORITY_UNAVAILABLE, never into "then there are no
 * conditions". Reading a missing condition store as "unconditioned" would convert every conditioned
 * grant into an unconditional one, so it fails closed instead.
 *
 * RETIRED rows are not conditions and are not loaded; retiring a condition is how a condition is
 * lifted, and it leaves the row readable as history.
 */
async function grantConditionRows(pool, tenantId) {
    const { rows } = await pool.query(`SELECT grant_scope, grantor_key, capability_key, condition
       FROM ${exports.GRANT_CONDITION_RELATION}
      WHERE tenant_id = $1 AND status = 'ACTIVE'
      ORDER BY grant_scope, grantor_key, capability_key`, [tenantId]);
    return Object.freeze(rows.map((r) => Object.freeze({
        grantScope: r.grant_scope, grantorKey: r.grantor_key, capabilityKey: r.capability_key, condition: r.condition,
    })));
}
/**
 * Read the live shape of the condition relation. READ ONLY: three catalog queries and nothing else.
 *
 * This is the half of "the repository understands the deployed schema" that a CREATE TABLE string
 * can never be. `GRANT_CONDITION_RELATION_SHAPE` declares what is expected;
 * `grantConditionRelationDrift` compares the two and names every difference, so drift in EITHER
 * direction -- a column added in the database, a column removed from the declaration -- is a
 * failure rather than a surprise.
 */
async function describeGrantConditionRelation(pool, schema = grantConditionPolicy_1.GRANT_CONDITION_RELATION_SHAPE.schema, table = grantConditionPolicy_1.GRANT_CONDITION_RELATION_SHAPE.table) {
    const columns = await pool.query(`SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position`, [schema, table]);
    if (columns.rows.length === 0) {
        return Object.freeze({ present: false, columns: Object.freeze([]), constraints: Object.freeze([]),
            indexes: Object.freeze([]), namedIndexColumns: Object.freeze([]) });
    }
    const constraints = await pool.query(`SELECT pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      WHERE ns.nspname = $1 AND rel.relname = $2`, [schema, table]);
    const indexes = await pool.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname`, [schema, table]);
    const named = indexes.rows.find((r) => r.indexname === grantConditionPolicy_1.GRANT_CONDITION_RELATION_SHAPE.namedIndex.name);
    const namedColumns = named
        ? (named.indexdef.match(/\(([^)]*)\)\s*$/)?.[1] ?? "").split(",").map((c) => c.trim()).filter(Boolean)
        : [];
    return Object.freeze({
        present: true,
        columns: Object.freeze(columns.rows.map((r) => Object.freeze({
            name: r.column_name, dataType: r.data_type,
            nullable: r.is_nullable === "YES", columnDefault: r.column_default,
        }))),
        constraints: Object.freeze(constraints.rows.map((r) => r.def).sort()),
        indexes: Object.freeze(indexes.rows.map((r) => r.indexname)),
        namedIndexColumns: Object.freeze(namedColumns),
    });
}
/**
 * Every way the live relation differs from the declared shape. EMPTY means parity.
 *
 * Both directions are reported. A database carrying an undeclared column is drift the repository
 * must learn about; a declaration naming a column the database does not have is drift that would
 * make a reader write to nothing.
 */
function grantConditionRelationDrift(facts) {
    if (!facts.present)
        return Object.freeze([`${exports.GRANT_CONDITION_RELATION} is absent`]);
    const drift = [];
    const expected = grantConditionPolicy_1.GRANT_CONDITION_RELATION_SHAPE;
    const actualByName = new Map(facts.columns.map((c) => [c.name, c]));
    for (const want of expected.columns) {
        const got = actualByName.get(want.name);
        if (!got) {
            drift.push(`column ${want.name} is missing`);
            continue;
        }
        if (got.dataType !== want.dataType)
            drift.push(`column ${want.name} is ${got.dataType}, expected ${want.dataType}`);
        if (got.nullable !== want.nullable)
            drift.push(`column ${want.name} nullability is ${got.nullable}, expected ${want.nullable}`);
        if ((got.columnDefault ?? null) !== want.columnDefault) {
            drift.push(`column ${want.name} default is ${String(got.columnDefault)}, expected ${String(want.columnDefault)}`);
        }
    }
    const declared = new Set(expected.columns.map((c) => c.name));
    for (const got of facts.columns)
        if (!declared.has(got.name))
            drift.push(`column ${got.name} is undeclared`);
    for (const want of expected.constraints) {
        if (!facts.constraints.includes(want))
            drift.push(`constraint missing: ${want}`);
    }
    for (const got of facts.constraints) {
        if (!expected.constraints.includes(got))
            drift.push(`constraint undeclared: ${got}`);
    }
    if (!facts.indexes.includes(expected.namedIndex.name))
        drift.push(`index missing: ${expected.namedIndex.name}`);
    else if (facts.namedIndexColumns.join(",") !== expected.namedIndex.columns.join(",")) {
        drift.push(`index ${expected.namedIndex.name} covers (${facts.namedIndexColumns.join(", ")}), expected (${expected.namedIndex.columns.join(", ")})`);
    }
    return Object.freeze(drift);
}
//# sourceMappingURL=capabilityAuthority.js.map