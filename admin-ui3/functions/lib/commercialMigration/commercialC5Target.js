"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.keyOf = exports.ORDER_FIELDS = exports.AGREEMENT_FIELDS = exports.OPPORTUNITY_FIELDS = exports.CommercialC5Error = void 0;
exports.c5SchemaPresence = c5SchemaPresence;
exports.resolveAcceptor = resolveAcceptor;
exports.resolveEmployees = resolveEmployees;
exports.probeCatalogReferences = probeCatalogReferences;
exports.measureC5Target = measureC5Target;
exports.finalizeC5Census = finalizeC5Census;
exports.readTenantRows = readTenantRows;
exports.differingFields = differingFields;
exports.establishmentReason = establishmentReason;
exports.copyCommercial = copyCommercial;
exports.verifyCommercial = verifyCommercial;
const node_crypto_1 = require("node:crypto");
const postgresEmployeeAuthority_1 = require("../employeeIdentity/postgresEmployeeAuthority");
const employeeAuthority_1 = require("../employeeIdentity/employeeAuthority");
const accountablePersonStorage_1 = require("../responsibility/accountablePersonStorage");
const commercialAccountabilityRepository_1 = require("../eosCommercial/commercialAccountabilityRepository");
const commercialNumbering_1 = require("../eosCommercial/commercialNumbering");
const postgresPolicyRepository_1 = require("../adminPolicy/postgresPolicyRepository");
const principalContext_1 = require("../adminPolicy/principalContext");
const commercialC5Snapshot_1 = require("./commercialC5Snapshot");
const S = "eos_commercial";
const asciiSort = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const TS = (column) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
class CommercialC5Error extends Error {
    code;
    details;
    constructor(code, message, details = null) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = "CommercialC5Error";
    }
}
exports.CommercialC5Error = CommercialC5Error;
const TABLE = Object.freeze({
    opportunity: { table: `${S}.opportunities`, number: "opportunity_number", lines: `${S}.opportunity_lines`, lineFk: "opportunity_id" },
    salesAgreement: { table: `${S}.sales_agreements`, number: "sales_agreement_number", lines: `${S}.sales_agreement_lines`, lineFk: "sales_agreement_id" },
    salesOrder: { table: `${S}.sales_orders`, number: "sales_order_number", lines: `${S}.sales_order_lines`, lineFk: "sales_order_id" },
});
const HISTORY_COLUMN = Object.freeze({ opportunity: "opportunity_id", salesAgreement: "sales_agreement_id", salesOrder: "sales_order_id" });
const keyOf = (family) => commercialC5Snapshot_1.C5_FAMILIES.find((f) => f.family === family).key;
exports.keyOf = keyOf;
async function c5SchemaPresence(db) {
    const { rows } = await db.query(`SELECT table_schema, table_name, column_name FROM information_schema.columns
      WHERE (table_schema = 'eos_commercial' AND table_name IN ('opportunities', 'accountability_handoffs', 'number_counters'))
         OR (table_schema = 'eos_crm' AND table_name = 'accounts')
         OR (table_schema = 'eos_ops' AND table_name = 'parts')`);
    const has = (s, t, c) => rows.some((r) => r.table_schema === s && r.table_name === t && r.column_name === c);
    return {
        commercialParity: has("eos_commercial", "opportunities", "stage") && has("eos_commercial", "number_counters", "last_value"),
        accountabilitySource: has("eos_commercial", "accountability_handoffs", "source"),
        crmAccounts: has("eos_crm", "accounts", "id"),
        partMaster: has("eos_ops", "parts", "internal_part_number"),
    };
}
/**
 * The historical accepter: a Firebase credential subject mapped to an EOS Principal through the governed identity read
 * (`PostgresPolicyRepository.getPrincipalBySubject`, the reader principalContext.ts resolves callers with), then its
 * membership in THIS tenant (`getMembership`). Current principal / membership status is recorded as evidence and is not
 * required to be active -- the acceptance is history. More than one principal for the subject (the
 * `principals_provider_subject_unique` constraint forbids it; counted anyway, never picked from) is AMBIGUOUS.
 */
async function resolveAcceptor(db, tenantId, uid) {
    const repo = new postgresPolicyRepository_1.PostgresPolicyRepository(db);
    const candidates = Number((await db.query(`SELECT count(*) AS n FROM eos_policy.principals WHERE identity_provider = $1 AND external_subject = $2`, [principalContext_1.FIREBASE_IDENTITY_PROVIDER, uid])).rows[0].n);
    if (candidates > 1)
        return { outcome: "AMBIGUOUS", candidates };
    const principal = await repo.getPrincipalBySubject(principalContext_1.FIREBASE_IDENTITY_PROVIDER, uid);
    if (!principal)
        return { outcome: "UNRESOLVED" };
    const membership = await repo.getMembership(tenantId, principal.id);
    if (!membership)
        return { outcome: "OUTSIDE_TENANT", principalId: principal.id, principalStatus: principal.status };
    return { outcome: "RESOLVED", principalId: principal.id, principalStatus: principal.status, membershipStatus: membership.status };
}
const acceptedUidOf = (provenance, id) => provenance.find((p) => p.family === "salesAgreement" && p.id === id)?.acceptedByUid ?? null;
/** Resolve through the governed PostgreSQL Employee authority, one reference at a time. */
async function resolveEmployees(db, tenantId, ids) {
    const authority = (0, postgresEmployeeAuthority_1.createPostgresEmployeeAuthority)(db);
    const out = new Map();
    for (const employeeId of ids) {
        const r = await authority.resolveEmployeeReference({ tenantId, employeeId });
        out.set(employeeId, r.outcome === "RESOLVED" ? { outcome: "RESOLVED", employee: r.employee } : { outcome: r.outcome });
    }
    return out;
}
/**
 * The #1911 catalog reference authority's probe shape (postgresCatalogReferenceAuthority.ts), restated for migration
 * measurement only -- not an import, because that adapter may not be imported before the catalog cutover composes it.
 * commercialC5MigrationPostgres.test.mjs proves the two agree on populated data.
 */
async function probeCatalogReferences(db, tenantId, refs) {
    if (refs.length === 0)
        return [];
    const { rows } = await db.query(`SELECT r.ordinal,
            EXISTS (SELECT 1 FROM eos_ops.parts p WHERE p.tenant_id = $1 AND p.id = r.ref) AS is_part,
            EXISTS (SELECT 1 FROM eos_ops.equipment_models m WHERE m.tenant_id = $1 AND m.id = r.ref) AS is_model
       FROM unnest($2::text[]) WITH ORDINALITY AS r(ref, ordinal) ORDER BY r.ordinal`, [tenantId, refs.map((r) => r.ref)]);
    return rows.map((row, i) => {
        const own = refs[i].kind === "PART" ? row.is_part === true : row.is_model === true;
        const other = refs[i].kind === "PART" ? row.is_model === true : row.is_part === true;
        return own ? "FOUND" : other ? "WRONG_KIND" : "NOT_FOUND";
    });
}
async function measureC5Target(db, tenantId, census, canonical, legacyActorProvenance) {
    const schema = await c5SchemaPresence(db);
    if (!schema.commercialParity || !schema.accountabilitySource || !schema.crmAccounts) {
        throw new CommercialC5Error("TARGET_SCHEMA_ABSENT", "the eos_commercial parity / accountability-source schema or eos_crm.accounts is absent: apply the governed migrations first");
    }
    const employees = await resolveEmployees(db, tenantId, census.references.employeeIds);
    const accounts = await db.query(`SELECT id FROM eos_crm.accounts WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, census.references.accountIds]);
    const locations = await db.query(`SELECT id FROM eos_crm.account_locations WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, census.references.locationIds]);
    const catalog = schema.partMaster
        ? { status: "PROBED", verdicts: (await probeCatalogReferences(db, tenantId, census.references.catalog)).map((verdict, i) => ({ ...census.references.catalog[i], verdict })) }
        : { status: "PART_MASTER_SCHEMA_ABSENT", verdicts: [] };
    const existing = {};
    const others = [];
    for (const f of commercialC5Snapshot_1.C5_FAMILIES) {
        const t = TABLE[f.family];
        existing[f.family] = (await db.query(`SELECT id, ${t.number} AS number FROM ${t.table} WHERE tenant_id = $1 ORDER BY id`, [tenantId])).rows;
        const ids = canonical[f.key].map((r) => r.id);
        const held = await db.query(`SELECT id FROM ${t.table} WHERE id = ANY($1::text[]) AND tenant_id <> $2 ORDER BY id`, [ids, tenantId]);
        for (const r of held.rows)
            others.push({ family: f.family, id: r.id });
    }
    const counters = (await db.query(`SELECT series::text AS series, year, last_value FROM ${S}.number_counters WHERE tenant_id = $1 ORDER BY series, year`, [tenantId])).rows.map((r) => ({ series: r.series, year: Number(r.year), lastValue: Number(r.last_value) }));
    const acceptors = new Map();
    for (const a of canonical.salesAgreements) {
        if (a.state !== "ACCEPTED")
            continue;
        const uid = acceptedUidOf(legacyActorProvenance, a.id);
        if (uid !== null && !acceptors.has(uid))
            acceptors.set(uid, await resolveAcceptor(db, tenantId, uid));
    }
    return {
        schema, employees, accountIds: new Set(accounts.rows.map((r) => r.id)), locationIds: new Set(locations.rows.map((r) => r.id)),
        catalog, existing, idsHeldByOtherTenants: others, counters, acceptors,
    };
}
const eligible = (e) => (0, employeeAuthority_1.decideAccountabilityEligibility)(e, commercialC5Snapshot_1.C5_ACCOUNTABILITY_ELIGIBILITY_V1).eligible;
function finalizeC5Census(source, canonical, target, legacyActorProvenance, options = {}) {
    const findings = [];
    const advisories = [...source.advisories];
    const plan = [];
    const add = (family, id, code, detail) => findings.push({ family, id, code, ...(detail ? { detail } : {}) });
    const answer = (id) => target.employees.get(id) ?? { outcome: "AUTHORITY_UNAVAILABLE" };
    const records = commercialC5Snapshot_1.C5_FAMILIES.flatMap((f) => canonical[f.key].map((r) => ({ family: f.family, r })));
    const verdict = new Map(target.catalog.verdicts.map((v) => [`${v.kind}|${v.ref}`, v.verdict]));
    for (const { family, r } of records) {
        const owner = answer(r.ownerEmployeeId);
        if (owner.outcome === "AUTHORITY_UNAVAILABLE")
            add(family, r.id, "EMPLOYEE_AUTHORITY_UNAVAILABLE", `owner ${r.ownerEmployeeId}`);
        else if (owner.outcome === "NOT_FOUND")
            add(family, r.id, "OWNER_UNRESOLVED", r.ownerEmployeeId);
        if (r.creditedSalespersonEmployeeId) {
            const credited = answer(r.creditedSalespersonEmployeeId);
            if (credited.outcome === "AUTHORITY_UNAVAILABLE")
                add(family, r.id, "EMPLOYEE_AUTHORITY_UNAVAILABLE", `credited ${r.creditedSalespersonEmployeeId}`);
            else if (credited.outcome === "NOT_FOUND")
                add(family, r.id, "CREDITED_SALESPERSON_UNRESOLVED", r.creditedSalespersonEmployeeId);
        }
        if (!target.accountIds.has(r.accountId))
            add(family, r.id, "ACCOUNT_UNRESOLVED", r.accountId);
        const loc = r.locationId;
        if (loc && !target.locationIds.has(loc))
            advisories.push({ family, id: r.id, code: "LOCATION_UNRESOLVED_NO_TARGET_FK", detail: loc });
        for (const l of r.lines) {
            if (l.kind !== "PART" && l.kind !== "EQUIPMENT_MODEL")
                continue;
            if (target.catalog.status !== "PROBED") {
                add(family, r.id, "CATALOG_REFERENCES_UNVERIFIABLE", `${l.kind} ${l.ref}`);
                continue;
            }
            const v = verdict.get(`${l.kind}|${l.ref}`);
            if (v === "NOT_FOUND")
                add(family, r.id, "CATALOG_REFERENCE_NOT_FOUND", `${l.kind} ${l.ref}`);
            else if (v === "WRONG_KIND")
                add(family, r.id, "CATALOG_REFERENCE_WRONG_KIND", `${l.kind} ${l.ref}`);
            else if (v !== "FOUND")
                add(family, r.id, "CATALOG_REFERENCES_UNVERIFIABLE", `${l.kind} ${l.ref}`);
        }
    }
    const ownerOf = new Map(records.map(({ family, r }) => [`${family}|${r.id}`, r.ownerEmployeeId]));
    for (const a of canonical.accountability) {
        if (a.state === "PRESENT") {
            const person = answer(a.accountableEmployeeId);
            if (person.outcome === "AUTHORITY_UNAVAILABLE") {
                add(a.family, a.id, "EMPLOYEE_AUTHORITY_UNAVAILABLE", `accountable ${a.accountableEmployeeId}`);
                continue;
            }
            if (person.outcome === "NOT_FOUND") {
                add(a.family, a.id, "ACCOUNTABLE_PERSON_UNRESOLVED", a.accountableEmployeeId);
                continue;
            }
            const ok = eligible(person.employee);
            if (!ok && a.context === "ACTIONABLE") {
                add(a.family, a.id, "ACCOUNTABLE_PERSON_NOT_CURRENTLY_ELIGIBLE", `${a.accountableEmployeeId} is ${person.employee.employmentStatus} on an actionable record`);
                continue;
            }
            plan.push({
                family: a.family, id: a.id, path: ok ? "GOVERNED_ESTABLISHMENT" : "HISTORICAL_PRESERVED", accountableEmployeeId: person.employee.employeeId,
                source: a.recordedSource, derivedAtMigration: false, employmentStatus: person.employee.employmentStatus, context: a.context,
            });
        }
        else {
            const ownerId = ownerOf.get(`${a.family}|${a.id}`);
            const owner = answer(ownerId);
            if (owner.outcome === "AUTHORITY_UNAVAILABLE") {
                add(a.family, a.id, "EMPLOYEE_AUTHORITY_UNAVAILABLE", `owner ${ownerId}`);
                continue;
            }
            if (owner.outcome !== "RESOLVED" || !eligible(owner.employee)) {
                add(a.family, a.id, "ACCOUNTABLE_PERSON_UNDERIVABLE", `no recorded accountable person and the owner ${ownerId} ${owner.outcome !== "RESOLVED" ? "does not resolve" : `is ${owner.employee.employmentStatus}`}; derivation requires a currently eligible owner (#181 rung 2)`);
                continue;
            }
            plan.push({
                family: a.family, id: a.id, path: "GOVERNED_ESTABLISHMENT", accountableEmployeeId: owner.employee.employeeId, source: "DERIVED_FROM_RECORD_OWNER",
                derivedAtMigration: true, employmentStatus: owner.employee.employmentStatus, context: a.context,
            });
        }
    }
    // target rows: ids held elsewhere, numbers held by another record, unknown rows, already-present rows
    for (const h of target.idsHeldByOtherTenants)
        add(h.family, h.id, "ID_HELD_BY_ANOTHER_TENANT");
    const declaredSynthetic = new Set(options.declaredSyntheticNumbers ?? []);
    const unknownRecords = [];
    const syntheticRows = [];
    const alreadyPresent = { opportunity: 0, salesAgreement: 0, salesOrder: 0 };
    for (const f of commercialC5Snapshot_1.C5_FAMILIES) {
        const sourceIds = new Set(canonical[f.key].map((r) => r.id));
        const sourceNumber = new Map(canonical[f.key].map((r) => [r.number, r.id]));
        for (const row of target.existing[f.family]) {
            if (sourceIds.has(row.id))
                alreadyPresent[f.family] += 1;
            else {
                unknownRecords.push({ family: f.family, ...row });
                if (declaredSynthetic.has(row.number))
                    syntheticRows.push({ family: f.family, ...row });
            }
            const holder = sourceNumber.get(row.number);
            if (holder !== undefined && holder !== row.id)
                add(f.family, holder, "NUMBER_HELD_BY_ANOTHER_RECORD", `${row.number} is ${row.id} in the tenant`);
        }
    }
    // counters: max(existing, SOURCE-VISIBLE high-water) per (series, year); never lowered. The migrated maximum is reported
    // beside it; a series/year seen only on excluded records still seeds (its numbers were visible to people).
    const migratedMaxOf = (series, year) => {
        const seqs = records.map(({ family, r }) => (0, commercialC5Snapshot_1.readBusinessNumber)(family, r.number))
            .filter((n) => n.state === "VALID" && n.series === series && n.year === year).map((n) => n.sequence);
        return seqs.length === 0 ? null : Math.max(...seqs);
    };
    const counterSeedPlan = source.numbers.sourceVisibleHighWater.map((hw) => {
        const existing = target.counters.find((c) => c.series === hw.series && c.year === hw.year)?.lastValue ?? null;
        const seedTo = Math.max(existing ?? 0, hw.maxSequence);
        return {
            series: hw.series, year: hw.year, migratedMax: migratedMaxOf(hw.series, hw.year), sourceVisibleMax: hw.maxSequence, existing, seedTo,
            action: existing === null ? "INSERT" : existing < hw.maxSequence ? "RAISE" : "NONE",
        };
    });
    // accepted_by: the HISTORICAL accepter through the governed credential -> Principal read, with a tenant membership
    const acceptancePlan = [];
    for (const a of canonical.salesAgreements) {
        if (a.state !== "ACCEPTED")
            continue;
        const uid = acceptedUidOf(legacyActorProvenance, a.id);
        if (uid === null) {
            add("salesAgreement", a.id, "ACCEPTING_PRINCIPAL_UID_MISSING");
            continue;
        }
        const answer = target.acceptors.get(uid);
        if (!answer || answer.outcome === "UNRESOLVED") {
            add("salesAgreement", a.id, "ACCEPTING_PRINCIPAL_UNRESOLVED", "no EOS Principal carries this acceptedByUid as its firebase subject");
            continue;
        }
        if (answer.outcome === "AMBIGUOUS") {
            add("salesAgreement", a.id, "ACCEPTING_PRINCIPAL_AMBIGUOUS", `${answer.candidates} Principals carry this subject`);
            continue;
        }
        if (answer.outcome === "OUTSIDE_TENANT") {
            add("salesAgreement", a.id, "ACCEPTING_PRINCIPAL_OUTSIDE_TENANT", `Principal ${answer.principalId} has no membership in the tenant`);
            continue;
        }
        acceptancePlan.push({ id: a.id, legacyAcceptedByUidEvidence: uid, acceptedByPrincipalId: answer.principalId, principalStatus: answer.principalStatus, membershipStatus: answer.membershipStatus });
    }
    const sourceBlockers = source.blockers;
    const disposition = source.disposition.disposition;
    const blockers = new Set([...sourceBlockers, ...findings.map((f) => f.code)]);
    if (disposition !== "MIGRATION_REQUIRED_OR_OWNER_REVIEW")
        blockers.add(`DISPOSITION_${disposition}`);
    if (unknownRecords.length > 0)
        blockers.add("TARGET_HAS_UNKNOWN_RECORDS");
    if (syntheticRows.length > 0)
        blockers.add("TARGET_HAS_SYNTHETIC_SEED_ROWS");
    const productRefs = source.references.catalog.length;
    const gatingConditions = [
        { id: "CRM_CUTOVER_RECONCILED", status: findings.some((f) => f.code === "ACCOUNT_UNRESOLVED") ? "NOT_MET" : "OPERATOR_EVIDENCE_REQUIRED",
            detail: "every account_id must resolve in eos_crm.accounts of the tenant AND the CRM cutover verify must be reconciled (its evidence is attached, not re-derived here)" },
        { id: "CATALOG_CUTOVER_RECONCILED", status: productRefs === 0 ? "MET" : findings.some((f) => f.code.startsWith("CATALOG_")) ? "NOT_MET" : "OPERATOR_EVIDENCE_REQUIRED",
            detail: `${productRefs} PART/EQUIPMENT_MODEL references; a probe answer is only meaningful after the catalog cutover verify is reconciled` },
        { id: "EMPLOYEE_AUTHORITY", status: findings.some((f) => /^(OWNER|CREDITED|ACCOUNTABLE|EMPLOYEE)_/.test(f.code)) ? "NOT_MET" : "MET",
            detail: "owners, credited salespersons and accountable persons resolve as same-tenant Employees in eos_workforce" },
        { id: "FIRESTORE_COMMERCIAL_WRITERS_FROZEN_BEFORE_EXPORT", status: "OPERATOR_EVIDENCE_REQUIRED",
            detail: "the snapshot copied must be exported after the Firestore Commercial writers are frozen (plan §7); never both Firebase and Render mutation authority for the same operation" },
        { id: "PRODUCTION_CENSUS_AND_OWNER_DECISION", status: "NOT_MET",
            detail: "production (taylor-parts) has no C5 mode: an authorized read-only census and an Owner decision precede any production migration" },
    ];
    const sortF = (a, b) => asciiSort(`${a.family}|${a.id}|${a.code}|${a.detail ?? ""}`, `${b.family}|${b.id}|${b.code}|${b.detail ?? ""}`);
    return {
        blockers: [...blockers].sort(asciiSort),
        findings: [...source.findings, ...findings].sort(sortF),
        advisories: advisories.sort(sortF),
        accountabilityPlan: plan.sort((a, b) => asciiSort(`${a.family}|${a.id}`, `${b.family}|${b.id}`)),
        derivedAccountablePersons: plan.filter((p) => p.derivedAtMigration).map((p) => ({ family: p.family, id: p.id, accountableEmployeeId: p.accountableEmployeeId })),
        gatingConditions,
        target: {
            existing: { opportunity: target.existing.opportunity.length, salesAgreement: target.existing.salesAgreement.length, salesOrder: target.existing.salesOrder.length },
            unknownRecords, syntheticSeedRows: syntheticRows, alreadyPresent, counters: target.counters,
        },
        counterSeedPlan,
        acceptancePlan: acceptancePlan.sort((a, b) => asciiSort(a.id, b.id)),
        copyReady: blockers.size === 0,
    };
}
// ════════════════════ reading tenant rows back in canonical shape ════════════════════
const nullableNumber = (v) => (v === null || v === undefined ? null : Number(v));
exports.OPPORTUNITY_FIELDS = ["number", "accountId", "ownerEmployeeId", "operatingCompanyKey", "creditedSalespersonEmployeeId", "salesChannel", "stage", "outcome", "closedAt", "need", "expectedValue", "expectedCloseAt", "nextAction", "createdAt", "updatedAt", "lines"];
exports.AGREEMENT_FIELDS = ["number", "accountId", "opportunityId", "ownerEmployeeId", "operatingCompanyKey", "creditedSalespersonEmployeeId", "state", "currency", "locationId", "customerPo", "isLease", "fulfillmentIntent", "shippingInstructions", "shipVia", "specialInstructions", "shippingMinor", "installChargeMinor", "taxMinor", "downPaymentMinor", "tradeInMinor", "acceptedAt", "createdAt", "updatedAt", "lines"];
exports.ORDER_FIELDS = ["number", "accountId", "opportunityId", "salesAgreementId", "ownerEmployeeId", "operatingCompanyKey", "creditedSalespersonEmployeeId", "state", "salesChannel", "currency", "bookedAt", "locationId", "customerPo", "notes", "createdAt", "updatedAt", "lines"];
const FIELDS = { opportunity: exports.OPPORTUNITY_FIELDS, salesAgreement: exports.AGREEMENT_FIELDS, salesOrder: exports.ORDER_FIELDS };
async function linesByRecord(db, family, tenantId) {
    const t = TABLE[family];
    const cols = family === "opportunity" ? "kind::text AS kind, ref, qty"
        : family === "salesAgreement" ? `kind::text AS kind, ref, business_unit::text AS business_unit, quantity, unit_price_minor, condition::text AS condition, warranty, ${TS("estimated_arrival_at")} AS estimated_arrival_at`
            : "kind::text AS kind, ref, business_unit::text AS business_unit, ordered_qty, unit_price_minor";
    const { rows } = await db.query(`SELECT ${t.lineFk} AS record_id, line_number, ${cols} FROM ${t.lines} WHERE tenant_id = $1 ORDER BY ${t.lineFk}, line_number`, [tenantId]);
    const out = new Map();
    for (const r of rows) {
        const line = family === "opportunity"
            ? { lineNumber: r.line_number, kind: r.kind, ref: r.ref, qty: r.qty }
            : family === "salesAgreement"
                ? { lineNumber: r.line_number, kind: r.kind, ref: r.ref, businessUnit: r.business_unit, quantity: r.quantity, unitPriceMinor: nullableNumber(r.unit_price_minor), condition: r.condition, warranty: r.warranty, estimatedArrivalAt: r.estimated_arrival_at }
                : { lineNumber: r.line_number, kind: r.kind, ref: r.ref, businessUnit: r.business_unit, orderedQty: r.ordered_qty, unitPriceMinor: nullableNumber(r.unit_price_minor) };
        out.set(r.record_id, [...(out.get(r.record_id) ?? []), line]);
    }
    return out;
}
async function readTenantRows(db, family, tenantId) {
    const t = TABLE[family];
    const common = `id, ${t.number} AS number, account_id, owner_employee_id, operating_company_key, credited_salesperson_employee_id, accountable_employee_id,
    created_by, updated_by, ${TS("created_at")} AS created_at, ${TS("updated_at")} AS updated_at`;
    const specific = family === "opportunity"
        ? `sales_channel::text AS sales_channel, stage::text AS stage, outcome::text AS outcome, ${TS("closed_at")} AS closed_at, need, expected_value::text AS expected_value, ${TS("expected_close_at")} AS expected_close_at, next_action, NULL::text AS accepted_by`
        : family === "salesAgreement"
            ? `opportunity_id, state::text AS state, currency, location_id, customer_po, is_lease, fulfillment_intent::text AS fulfillment_intent, shipping_instructions, ship_via, special_instructions, shipping_minor, install_charge_minor, tax_minor, down_payment_minor, trade_in_minor, ${TS("accepted_at")} AS accepted_at, accepted_by`
            : `opportunity_id, sales_agreement_id, state::text AS state, sales_channel::text AS sales_channel, currency, ${TS("booked_at")} AS booked_at, location_id, customer_po, notes, NULL::text AS accepted_by`;
    const { rows } = await db.query(`SELECT ${common}, ${specific} FROM ${t.table} WHERE tenant_id = $1 ORDER BY id`, [tenantId]);
    const lines = await linesByRecord(db, family, tenantId);
    const out = new Map();
    for (const r of rows) {
        const base = {
            id: r.id, number: r.number, accountId: r.account_id, ownerEmployeeId: r.owner_employee_id, operatingCompanyKey: r.operating_company_key,
            creditedSalespersonEmployeeId: r.credited_salesperson_employee_id, createdAt: r.created_at, updatedAt: r.updated_at, lines: lines.get(r.id) ?? [],
        };
        const record = family === "opportunity"
            ? { ...base, salesChannel: r.sales_channel, stage: r.stage, outcome: r.outcome, closedAt: r.closed_at, need: r.need, expectedValue: nullableNumber(r.expected_value), expectedCloseAt: r.expected_close_at, nextAction: r.next_action }
            : family === "salesAgreement"
                ? { ...base, opportunityId: r.opportunity_id, state: r.state, currency: r.currency, locationId: r.location_id, customerPo: r.customer_po, isLease: r.is_lease, fulfillmentIntent: r.fulfillment_intent, shippingInstructions: r.shipping_instructions, shipVia: r.ship_via, specialInstructions: r.special_instructions, shippingMinor: nullableNumber(r.shipping_minor), installChargeMinor: nullableNumber(r.install_charge_minor), taxMinor: nullableNumber(r.tax_minor), downPaymentMinor: nullableNumber(r.down_payment_minor), tradeInMinor: nullableNumber(r.trade_in_minor), acceptedAt: r.accepted_at }
                : { ...base, opportunityId: r.opportunity_id, salesAgreementId: r.sales_agreement_id, state: r.state, salesChannel: r.sales_channel, currency: r.currency, bookedAt: r.booked_at, locationId: r.location_id, customerPo: r.customer_po, notes: r.notes };
        out.set(r.id, { record, accountableEmployeeId: r.accountable_employee_id, createdBy: r.created_by, updatedBy: r.updated_by, acceptedBy: r.accepted_by });
    }
    return out;
}
function differingFields(family, source, target) {
    const s = source, t = target;
    return FIELDS[family].filter((f) => JSON.stringify(s[f] ?? null) !== JSON.stringify(t[f] ?? null));
}
async function assertPrincipal(db, tenantId, principalId) {
    if (typeof principalId !== "string" || principalId.trim() === "" || principalId !== principalId.trim()) {
        throw new CommercialC5Error("CUTOVER_PRINCIPAL_REQUIRED", "the copy must be performed as a named EOS Principal");
    }
    const tenant = await db.query(`SELECT 1 FROM eos_policy.tenants WHERE id = $1`, [tenantId]);
    if (tenant.rows.length === 0)
        throw new CommercialC5Error("TENANT_NOT_FOUND", "the target tenant does not exist; the copy never creates one");
    const member = await db.query(`SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
      WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`, [tenantId, principalId]);
    if (member.rows.length === 0)
        throw new CommercialC5Error("CUTOVER_PRINCIPAL_NOT_TENANT_MEMBER", "the cutover Principal is not an active member of the target tenant");
}
async function insertRecord(db, family, tenantId, actor, r, acceptedBy) {
    if (family === "opportunity") {
        const o = r;
        await db.query(`INSERT INTO ${S}.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, operating_company_key, credited_salesperson_employee_id,
         sales_channel, stage, outcome, closed_at, need, expected_value, expected_close_at, next_action, edit_version, created_by, created_at, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,1,$16,$17,$16,$18)`, [o.id, tenantId, o.number, o.accountId, o.ownerEmployeeId, o.operatingCompanyKey, o.creditedSalespersonEmployeeId, o.salesChannel, o.stage, o.outcome,
            o.closedAt, o.need, o.expectedValue, o.expectedCloseAt, o.nextAction, actor, o.createdAt, o.updatedAt]);
        for (const l of o.lines) {
            await db.query(`INSERT INTO ${S}.opportunity_lines (tenant_id, opportunity_id, line_number, kind, ref, qty) VALUES ($1,$2,$3,$4,$5,$6)`, [tenantId, o.id, l.lineNumber, l.kind, l.ref, l.qty]);
        }
    }
    else if (family === "salesAgreement") {
        const a = r;
        await db.query(`INSERT INTO ${S}.sales_agreements (id, tenant_id, sales_agreement_number, account_id, opportunity_id, owner_employee_id, operating_company_key,
         credited_salesperson_employee_id, state, currency, location_id, customer_po, is_lease, fulfillment_intent, shipping_instructions, ship_via,
         special_instructions, shipping_minor, install_charge_minor, tax_minor, down_payment_minor, trade_in_minor, accepted_at, accepted_by,
         created_by, created_at, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$25,$27)`, [a.id, tenantId, a.number, a.accountId, a.opportunityId, a.ownerEmployeeId, a.operatingCompanyKey, a.creditedSalespersonEmployeeId, a.state, a.currency,
            a.locationId, a.customerPo, a.isLease, a.fulfillmentIntent, a.shippingInstructions, a.shipVia, a.specialInstructions, a.shippingMinor,
            a.installChargeMinor, a.taxMinor, a.downPaymentMinor, a.tradeInMinor, a.acceptedAt, acceptedBy, actor, a.createdAt, a.updatedAt]);
        for (const l of a.lines) {
            await db.query(`INSERT INTO ${S}.sales_agreement_lines (tenant_id, sales_agreement_id, line_number, kind, ref, business_unit, quantity, unit_price_minor, condition, warranty, estimated_arrival_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [tenantId, a.id, l.lineNumber, l.kind, l.ref, l.businessUnit, l.quantity, l.unitPriceMinor, l.condition, l.warranty, l.estimatedArrivalAt]);
        }
    }
    else {
        const s = r;
        await db.query(`INSERT INTO ${S}.sales_orders (id, tenant_id, sales_order_number, account_id, opportunity_id, sales_agreement_id, owner_employee_id, operating_company_key,
         credited_salesperson_employee_id, state, sales_channel, currency, booked_at, location_id, customer_po, notes, created_by, created_at, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$17,$19)`, [s.id, tenantId, s.number, s.accountId, s.opportunityId, s.salesAgreementId, s.ownerEmployeeId, s.operatingCompanyKey, s.creditedSalespersonEmployeeId,
            s.state, s.salesChannel, s.currency, s.bookedAt, s.locationId, s.customerPo, s.notes, actor, s.createdAt, s.updatedAt]);
        for (const l of s.lines) {
            await db.query(`INSERT INTO ${S}.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty, unit_price_minor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [tenantId, s.id, l.lineNumber, l.kind, l.ref, l.businessUnit, l.orderedQty, l.unitPriceMinor]);
        }
    }
}
/** The C5 migration reason recorded on every ESTABLISHMENT row the copy writes. <= 500 chars (migration 020). */
function establishmentReason(entry, snapshotSha256) {
    const snap = `snapshot:${snapshotSha256.slice(0, 16)}`;
    if (entry.path === "HISTORICAL_PRESERVED") {
        return `C5_MIGRATION_HISTORICAL_ACCOUNTABILITY_PRESERVED ${snap} status:${entry.employmentStatus} context:${entry.context} (#186 s7: historical accountability remains valid; not a current-eligibility verdict)`;
    }
    return `${entry.derivedAtMigration ? "C5_MIGRATION_DERIVED_FROM_RECORD_OWNER" : "C5_MIGRATION_RECORDED_ACCOUNTABLE_PERSON"} ${snap}`;
}
async function establish(db, tenantId, actor, entry, snapshotSha256) {
    const reason = establishmentReason(entry, snapshotSha256);
    if (entry.path === "GOVERNED_ESTABLISHMENT") {
        // Re-resolved inside the transaction and minted by the governed mint: the #1905 writer accepts nothing else.
        const resolution = await (0, postgresEmployeeAuthority_1.createPostgresEmployeeAuthority)(db).resolveEmployeeReference({ tenantId, employeeId: entry.accountableEmployeeId });
        if (resolution.outcome !== "RESOLVED")
            throw new CommercialC5Error("ACCOUNTABLE_PERSON_UNRESOLVED", `${entry.family} ${entry.id}: the accountable person no longer resolves`);
        const minted = (0, accountablePersonStorage_1.mintGovernedAccountablePerson)(resolution.employee, (0, employeeAuthority_1.decideAccountabilityEligibility)(resolution.employee, commercialC5Snapshot_1.C5_ACCOUNTABILITY_ELIGIBILITY_V1), entry.source);
        await (0, commercialAccountabilityRepository_1.stageCommercialAccountablePersonChange)(db, tenantId, actor, "ESTABLISHMENT", { family: entry.family, recordId: entry.id, accountablePerson: minted, reason });
        return;
    }
    // HISTORICAL_PRESERVED: the column set stageCommercialAccountablePersonChange writes, for a person the mint refuses by
    // design because they are not CURRENTLY eligible. Exactly one ESTABLISHMENT (previous NULL), source as recorded.
    const t = TABLE[entry.family];
    const locked = await db.query(`SELECT accountable_employee_id AS accountable FROM ${t.table} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, entry.id]);
    if (locked.rows.length !== 1 || locked.rows[0].accountable !== null)
        throw new CommercialC5Error("ALREADY_ESTABLISHED", `${entry.family} ${entry.id} already has an accountable person`);
    await db.query(`UPDATE ${t.table} SET accountable_employee_id = $3, updated_by = $4 WHERE tenant_id = $1 AND id = $2`, [tenantId, entry.id, entry.accountableEmployeeId, actor]);
    await db.query(`INSERT INTO ${S}.accountability_handoffs (id, tenant_id, ${HISTORY_COLUMN[entry.family]}, previous_accountable_employee_id, new_accountable_employee_id,
       eligibility_policy_id, source, reason, recorded_by)
     VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8)`, [`ach_${(0, node_crypto_1.randomUUID)()}`, tenantId, entry.id, entry.accountableEmployeeId, commercialC5Snapshot_1.C5_ACCOUNTABILITY_ELIGIBILITY_V1.policyId, entry.source, reason, actor]);
}
async function copyCommercial(client, input) {
    const { tenantId, canonical, census } = input;
    const actor = input.principalId;
    if (typeof input.snapshotSha256 !== "string" || !/^[0-9a-f]{64}$/.test(input.snapshotSha256))
        throw new CommercialC5Error("SNAPSHOT_DIGEST_REQUIRED", "the snapshot sha256 is required");
    if (input.confirmedSnapshotSha256 !== input.snapshotSha256) {
        throw new CommercialC5Error("MIGRATION_CONFIRMATION_REQUIRED", "copy requires the explicit confirmation --confirmMigrationRequired <snapshot sha256> naming this snapshot");
    }
    if (census.source.firebaseProjectId === "taylor-parts" || census.disposition.disposition === "STOP_FOR_OWNER_DECISION") {
        throw new CommercialC5Error("PRODUCTION_COPY_REFUSED", "a production source is never copied by this tool");
    }
    await client.query("BEGIN");
    try {
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`commercial-c5|${tenantId}`]);
        await assertPrincipal(client, tenantId, actor);
        const target = await measureC5Target(client, tenantId, census, canonical, input.legacyActorProvenance);
        const final = finalizeC5Census(census, canonical, target, input.legacyActorProvenance, { declaredSyntheticNumbers: input.declaredSyntheticNumbers });
        if (!final.copyReady)
            throw new CommercialC5Error("CENSUS_NOT_COPY_READY", "the census re-measured inside the copy transaction is not copy-ready; nothing was written", final.blockers);
        const planOf = new Map(final.accountabilityPlan.map((p) => [`${p.family}|${p.id}`, p]));
        const accepterOf = new Map(final.acceptancePlan.map((p) => [p.id, p.acceptedByPrincipalId]));
        const expectedAcceptedBy = (family, r) => family === "salesAgreement" && r.acceptedAt ? (accepterOf.get(r.id) ?? null) : null;
        const inserted = { opportunity: [], salesAgreement: [], salesOrder: [] };
        const unchanged = { opportunity: 0, salesAgreement: 0, salesOrder: 0 };
        const drift = [];
        const toInsert = [];
        for (const f of commercialC5Snapshot_1.C5_FAMILIES) {
            const rows = await readTenantRows(client, f.family, tenantId);
            for (const r of canonical[f.key]) {
                const existing = rows.get(r.id);
                if (!existing) {
                    toInsert.push({ family: f.family, r });
                    continue;
                }
                const fields = differingFields(f.family, r, existing.record);
                const expectedAccountable = planOf.get(`${f.family}|${r.id}`)?.accountableEmployeeId ?? null;
                if (existing.accountableEmployeeId !== expectedAccountable)
                    fields.push(accountablePersonStorage_1.ACCOUNTABLE_PERSON_FIELD);
                if (existing.acceptedBy !== expectedAcceptedBy(f.family, r))
                    fields.push("acceptedBy");
                if (fields.length === 0)
                    unchanged[f.family] += 1;
                else
                    drift.push({ family: f.family, id: r.id, fields });
            }
        }
        if (drift.length > 0)
            throw new CommercialC5Error("DRIFT_DETECTED", `${drift.length} source records differ from the rows already in the tenant; nothing was written`, drift);
        // (unknown target rows already refused by the in-transaction census: TARGET_HAS_UNKNOWN_RECORDS)
        let governed = 0, historical = 0;
        const derived = [];
        for (const { family, r } of toInsert) {
            const acceptedBy = expectedAcceptedBy(family, r);
            if (family === "salesAgreement" && r.acceptedAt !== null && acceptedBy === null) {
                throw new CommercialC5Error("ACCEPTING_PRINCIPAL_UNRESOLVED", `salesAgreement ${r.id} has no resolved historical accepter; nothing was written`);
            }
            await insertRecord(client, family, tenantId, actor, r, acceptedBy);
            const entry = planOf.get(`${family}|${r.id}`);
            if (!entry)
                throw new CommercialC5Error("ACCOUNTABILITY_PLAN_MISSING", `${family} ${r.id} has no accountable person plan`);
            await establish(client, tenantId, actor, entry, input.snapshotSha256);
            if (entry.path === "GOVERNED_ESTABLISHMENT")
                governed += 1;
            else
                historical += 1;
            if (entry.derivedAtMigration)
                derived.push(`${family}:${r.id}`);
            // The writer stamps updated_at = now(): that instant describes the migration, not the business record. Restore the
            // preserved source value in the same transaction (updated_by is the cutover Principal either way).
            await client.query(`UPDATE ${TABLE[family].table} SET updated_at = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, r.id, r.updatedAt]);
            inserted[family].push(r.id);
        }
        const counters = [];
        for (const c of final.counterSeedPlan) {
            if (c.action === "INSERT") {
                await client.query(`INSERT INTO ${S}.number_counters (tenant_id, series, year, last_value) VALUES ($1, $2, $3, $4)`, [tenantId, c.series, c.year, c.seedTo]);
            }
            else if (c.action === "RAISE") {
                await client.query(`UPDATE ${S}.number_counters SET last_value = $4, updated_at = now() WHERE tenant_id = $1 AND series = $2 AND year = $3 AND last_value < $4`, [tenantId, c.series, c.year, c.seedTo]);
            }
            counters.push({ series: c.series, year: c.year, action: c.action, from: c.existing, to: c.seedTo, migratedMax: c.migratedMax, sourceVisibleMax: c.sourceVisibleMax });
        }
        const wrote = toInsert.length > 0 || counters.some((c) => c.action !== "NONE");
        const report = {
            outcome: wrote ? "COPIED" : "NO_CHANGES",
            tenantId, snapshotSha256: input.snapshotSha256, canonicalDigest: census.canonicalDigest,
            inserted, unchanged,
            accountability: { governedEstablishments: governed, historicalPreserved: historical, derivedAtMigration: derived.sort(asciiSort) },
            counters, cutoverPrincipalId: actor, receiptsWritten: 0, acceptedBy: final.acceptancePlan,
        };
        if (wrote) {
            await client.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
         VALUES ($1, $2, 'commercial.c5.copy', $3, 'commercial_snapshot', $4, NULL, $5, $6, $7)`, [`audit_${(0, node_crypto_1.randomUUID)()}`, tenantId, actor, input.snapshotSha256, JSON.stringify({
                    canonicalDigest: census.canonicalDigest, inserted: { opportunity: inserted.opportunity.length, salesAgreement: inserted.salesAgreement.length, salesOrder: inserted.salesOrder.length },
                    accountability: report.accountability, counters, certificationExcluded: census.certificationExcluded.records.length,
                }), input.now ?? new Date(), "C5 one-time Commercial data migration (docs/architecture/commercial-c5-data-migration-plan.md)"]);
        }
        await client.query("COMMIT");
        return report;
    }
    catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (err instanceof CommercialC5Error)
            throw err;
        const e = err;
        if (typeof e?.name === "string" && ["CommercialAccountabilityWriteError", "AccountablePersonMintError"].includes(e.name)) {
            throw new CommercialC5Error(String(e.code), "the governed accountability writer refused; nothing was written");
        }
        throw new CommercialC5Error("COPY_FAILED", `the copy could not be completed${typeof e?.constraint === "string" ? ` (constraint ${e.constraint})` : ""}; nothing was written`);
    }
}
async function verifyCommercial(client, input) {
    const { tenantId, canonical, census } = input;
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    try {
        const counts = {};
        const missing = [], extra = [], mismatches = [];
        const numbersMissing = [], invalid = [], dupes = [], unresolved = [], problems = [];
        const uidAttr = [], nonPrincipal = [], acceptedByViolations = [];
        const legacyUids = new Set(input.legacyActorProvenance.flatMap((p) => [p.createdByUid, p.updatedByUid, p.acceptedByUid]).filter((u) => u !== null));
        const authority = (0, postgresEmployeeAuthority_1.createPostgresEmployeeAuthority)(client);
        let establishments = 0;
        const actors = new Set();
        for (const f of commercialC5Snapshot_1.C5_FAMILIES) {
            const rows = await readTenantRows(client, f.family, tenantId);
            const targetIds = [...rows.keys()];
            const source = canonical[f.key];
            counts[f.family] = { source: source.length, target: targetIds.length };
            const sourceIds = new Set(source.map((r) => r.id));
            for (const id of targetIds)
                if (!sourceIds.has(id))
                    extra.push(`${f.family}:${id}`);
            const seenNumbers = new Map();
            for (const [, row] of rows)
                seenNumbers.set(String(row.record.number), (seenNumbers.get(String(row.record.number)) ?? 0) + 1);
            for (const [n, c] of seenNumbers)
                if (c > 1)
                    dupes.push(`${f.family}:${n}`);
            for (const r of source) {
                const row = rows.get(r.id);
                if (!row) {
                    missing.push(`${f.family}:${r.id}`);
                    continue;
                }
                const fields = differingFields(f.family, r, row.record);
                if (fields.length > 0)
                    mismatches.push({ family: f.family, id: r.id, fields });
                if (row.record.number !== r.number)
                    numbersMissing.push(`${f.family}:${r.id}:${r.number}`);
                const reading = (0, commercialC5Snapshot_1.readBusinessNumber)(f.family, row.record.number);
                if (reading.state !== "VALID" && reading.state !== "SENTINEL_YEAR")
                    invalid.push(`${f.family}:${r.id}`);
                for (const a of [row.createdBy, row.updatedBy, row.acceptedBy])
                    if (a !== null)
                        actors.add(a);
                if (f.family === "salesAgreement") {
                    const acceptedAt = r.acceptedAt;
                    if (acceptedAt === null) {
                        if (row.acceptedBy !== null)
                            acceptedByViolations.push(`${r.id}:ACCEPTED_BY_WITHOUT_ACCEPTANCE`);
                    }
                    else {
                        const uid = acceptedUidOf(input.legacyActorProvenance, r.id);
                        const answer = uid === null ? null : await resolveAcceptor(client, tenantId, uid);
                        if (!answer || answer.outcome !== "RESOLVED")
                            acceptedByViolations.push(`${r.id}:HISTORICAL_ACCEPTER_UNRESOLVED`);
                        else if (row.acceptedBy !== answer.principalId)
                            acceptedByViolations.push(`${r.id}:ACCEPTED_BY_IS_NOT_THE_HISTORICAL_ACCEPTER`);
                    }
                }
                for (const person of [r.ownerEmployeeId, r.creditedSalespersonEmployeeId, row.accountableEmployeeId]) {
                    if (person === null)
                        continue;
                    if ((await authority.resolveEmployeeReference({ tenantId, employeeId: person })).outcome !== "RESOLVED")
                        unresolved.push(`${f.family}:${r.id}:${person}`);
                }
                if (row.accountableEmployeeId === null) {
                    problems.push(`${f.family}:${r.id}:NO_ACCOUNTABLE_PERSON`);
                    continue;
                }
                const history = await client.query(`SELECT action, source::text AS source, previous_accountable_employee_id AS previous, new_accountable_employee_id AS new_person, recorded_by
             FROM ${S}.accountability_handoffs WHERE tenant_id = $1 AND ${HISTORY_COLUMN[f.family]} = $2 ORDER BY recorded_at, id`, [tenantId, r.id]);
                const est = history.rows.filter((h) => h.action === "ESTABLISHMENT");
                if (est.length !== 1)
                    problems.push(`${f.family}:${r.id}:ESTABLISHMENT_COUNT_${est.length}`);
                else {
                    establishments += 1;
                    if (est[0].source === null)
                        problems.push(`${f.family}:${r.id}:ESTABLISHMENT_SOURCE_MISSING`);
                    const last = history.rows[history.rows.length - 1];
                    if (last.new_person !== row.accountableEmployeeId)
                        problems.push(`${f.family}:${r.id}:HISTORY_DOES_NOT_END_AT_CURRENT_PERSON`);
                }
                for (const h of history.rows)
                    actors.add(h.recorded_by);
            }
        }
        for (const a of actors)
            if (legacyUids.has(a))
                uidAttr.push(a);
        if (actors.size > 0) {
            const principals = await client.query(`SELECT id FROM eos_policy.principals WHERE id = ANY($1::text[])`, [[...actors]]);
            const known = new Set(principals.rows.map((p) => p.id));
            for (const a of actors)
                if (!known.has(a))
                    nonPrincipal.push(a);
        }
        const ids = (k) => canonical[k].map((r) => r.id);
        const fk = await client.query(`SELECT 'opportunity:' || o.id AS what FROM ${S}.opportunities o WHERE o.tenant_id = $1 AND o.id = ANY($2::text[])
          AND NOT EXISTS (SELECT 1 FROM eos_crm.accounts a WHERE a.tenant_id = o.tenant_id AND a.id = o.account_id)
       UNION ALL SELECT 'salesAgreement:' || s.id FROM ${S}.sales_agreements s WHERE s.tenant_id = $1 AND s.id = ANY($3::text[])
          AND NOT EXISTS (SELECT 1 FROM eos_crm.accounts a WHERE a.tenant_id = s.tenant_id AND a.id = s.account_id)
       UNION ALL SELECT 'salesOrder:' || s.id FROM ${S}.sales_orders s WHERE s.tenant_id = $1 AND s.id = ANY($4::text[])
          AND NOT EXISTS (SELECT 1 FROM eos_crm.accounts a WHERE a.tenant_id = s.tenant_id AND a.id = s.account_id)
       ORDER BY 1`, [tenantId, ids("opportunities"), ids("salesAgreements"), ids("salesOrders")]);
        const lineage = await client.query(`SELECT 'salesAgreement:' || s.id AS what FROM ${S}.sales_agreements s LEFT JOIN ${S}.opportunities o ON o.id = s.opportunity_id
         WHERE s.tenant_id = $1 AND s.id = ANY($2::text[]) AND s.opportunity_id IS NOT NULL AND (o.id IS NULL OR o.tenant_id <> s.tenant_id OR o.account_id <> s.account_id)
       UNION ALL
       SELECT 'salesOrder:' || s.id FROM ${S}.sales_orders s
         LEFT JOIN ${S}.opportunities o ON o.id = s.opportunity_id LEFT JOIN ${S}.sales_agreements a ON a.id = s.sales_agreement_id
         WHERE s.tenant_id = $1 AND s.id = ANY($3::text[])
           AND ((s.opportunity_id IS NOT NULL AND (o.id IS NULL OR o.tenant_id <> s.tenant_id OR o.account_id <> s.account_id))
             OR (s.sales_agreement_id IS NOT NULL AND (a.id IS NULL OR a.tenant_id <> s.tenant_id OR a.account_id <> s.account_id
                 OR a.opportunity_id IS DISTINCT FROM s.opportunity_id)))
       ORDER BY 1`, [tenantId, ids("salesAgreements"), ids("salesOrders")]);
        const excludedIds = census.certificationExcluded.records;
        const fixturesInTarget = [];
        for (const x of excludedIds) {
            const t = TABLE[x.family];
            if ((await client.query(`SELECT 1 FROM ${t.table} WHERE id = $1`, [x.id])).rows.length > 0)
                fixturesInTarget.push(`${x.family}:${x.id}`);
        }
        const allIds = [...ids("opportunities"), ...ids("salesAgreements"), ...ids("salesOrders")];
        const receipts = Number((await client.query(`SELECT count(*) AS n FROM ${S}.command_receipts WHERE tenant_id = $1 AND target_id = ANY($2::text[])`, [tenantId, allIds])).rows[0].n);
        // Counters, and the next allocation per series/year -- a PROBE on this transaction, rolled back below.
        const counterRows = (await client.query(`SELECT series::text AS series, year, last_value FROM ${S}.number_counters WHERE tenant_id = $1`, [tenantId])).rows;
        const counters = [];
        for (const hw of census.numbers.sourceVisibleHighWater) {
            const family = commercialC5Snapshot_1.C5_FAMILIES.find((f) => f.series === hw.series);
            const migrated = canonical[family.key]
                .map((r) => (0, commercialC5Snapshot_1.readBusinessNumber)(family.family, r.number)).filter((n) => n.state === "VALID" && n.year === hw.year);
            const migratedMax = migrated.length === 0 ? null : Math.max(...migrated.map((n) => n.sequence));
            const row = counterRows.find((c) => c.series === hw.series && Number(c.year) === hw.year);
            const counter = row ? Number(row.last_value) : null;
            await client.query("SAVEPOINT c5_probe");
            const probe = await (0, commercialNumbering_1.allocateCommercialNumber)(client, tenantId, hw.series, new Date(Date.UTC(hw.year, 6, 1)));
            const held = await client.query(`SELECT 1 FROM ${TABLE[family.family].table} WHERE tenant_id = $1 AND ${TABLE[family.family].number} = $2`, [tenantId, probe.number]);
            await client.query("ROLLBACK TO SAVEPOINT c5_probe");
            counters.push({
                series: hw.series, year: hw.year, migratedMax, sourceVisibleMax: hw.maxSequence, counter, probeNumber: probe.number,
                ok: counter !== null && counter >= hw.maxSequence && held.rows.length === 0 && probe.sequence > hw.maxSequence,
            });
        }
        await client.query("ROLLBACK");
        const report = {
            tenantId, counts, identity: { missingInTarget: missing.sort(asciiSort), extraInTarget: extra.sort(asciiSort) }, fieldMismatches: mismatches,
            numbers: { missingOrMoved: numbersMissing, invalidFormat: invalid, duplicatesInTarget: dupes }, counters, people: { unresolved },
            accountabilityHistory: { problems, establishments }, accountFkViolations: fk.rows.map((r) => r.what), lineageViolations: lineage.rows.map((r) => r.what),
            acceptedByViolations, certificationFixturesInTarget: fixturesInTarget, legacyUidAttributions: uidAttr.sort(asciiSort), nonPrincipalAttributions: nonPrincipal.sort(asciiSort),
            receiptsNamingMigratedRecords: receipts,
        };
        const reconciled = commercialC5Snapshot_1.C5_FAMILIES.every((f) => counts[f.family].source === counts[f.family].target)
            && missing.length === 0 && extra.length === 0 && mismatches.length === 0 && numbersMissing.length === 0 && invalid.length === 0 && dupes.length === 0
            && counters.every((c) => c.ok) && unresolved.length === 0 && problems.length === 0 && fk.rows.length === 0 && lineage.rows.length === 0
            && fixturesInTarget.length === 0 && uidAttr.length === 0 && nonPrincipal.length === 0 && acceptedByViolations.length === 0;
        return { reconciled, ...report };
    }
    catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
    }
}
//# sourceMappingURL=commercialC5Target.js.map