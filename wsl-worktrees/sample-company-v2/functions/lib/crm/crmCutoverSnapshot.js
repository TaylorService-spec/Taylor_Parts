"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OWNER_DERIVATION_RULE = exports.LOCATION_FIELDS = exports.CONTACT_FIELDS = exports.ACCOUNT_FIELDS = exports.LOCATION_FIELD_DISPOSITIONS = exports.CONTACT_FIELD_DISPOSITIONS = exports.ACCOUNT_FIELD_DISPOSITIONS = exports.CrmSnapshotError = exports.TAX_STATUSES = exports.PAYMENT_TERMS = exports.MAX_CRM_TEXT_LENGTH = exports.MAX_ACCOUNT_TAG_LENGTH = exports.MAX_ACCOUNT_TAGS = exports.INVOICE_DELIVERY_METHODS = exports.ACCOUNT_RELATIONSHIP_TYPES = exports.ACCOUNT_LINES_OF_BUSINESS = exports.CERTIFICATION_ID_PREFIX = exports.CERTIFICATION_MARKER_FIELD = exports.CRM_SNAPSHOT_COLLECTIONS = exports.CRM_SNAPSHOT_VERSION = exports.CRM_SNAPSHOT_FORMAT = void 0;
exports.parseCrmSnapshot = parseCrmSnapshot;
exports.canonicalCrmDigest = canonicalCrmDigest;
exports.censusCrmSnapshot = censusCrmSnapshot;
exports.finalizeCrmCensus = finalizeCrmCensus;
// THE CRM SNAPSHOT -- the legacy Firestore `accounts`, `contacts` and `locations` documents, as a file, and the PURE
// census / canonicalization the one-time CRM cutover runs on it (functions/scripts/crmCutover.js,
// docs/architecture/crm-cutover-plan.md).
//
// ════════════════════ PURE. NO FIREBASE, NO DATABASE, NO WRITES ════════════════════
//
// Input is an already-exported EOS_CRM_SNAPSHOT file (the fenced CRM snapshot export script, the Owner's
// migration-only Firebase exit exception). Output is a report plus the canonical records a copy would write. Target
// facts that need PostgreSQL (does an owner resolve to a same-tenant Employee, which eos_commercial rows name an
// Account) are gathered by the CLI and folded in by `finalizeCrmCensus`, which is also pure.
//
// ════════════════════ WHAT "CANONICAL" MEANS ════════════════════
//
// Exactly what the governed PostgreSQL CRM authority (functions/src/eosCrm/**, D1-A) would store for the same stored
// value: names and optional text trimmed, a blank optional text is NULL, enum values exact, sets in vocabulary order.
// A value that authority would REFUSE is a BLOCKING finding here; nothing is repaired, defaulted or guessed:
//
//   * a status that is not exactly PROSPECT / ACTIVE / INACTIVE / ARCHIVED ("Active", "DORMANT", absent) blocks;
//   * a single free-text billing address (Data Import's customer contract writes one) is NEVER parsed. It is kept in
//     the reconciliation evidence only, the Account is marked BILLING_ADDRESS_REQUIRES_RESOLUTION, and the copy
//     refuses until it is resolved at the source through the structured Account form;
//   * accountOwner.assignedBy* / assignedAt and every Firebase uid are PROVENANCE EVIDENCE: they are never a column
//     and never become ownership history (no governed Account ownership-handoff history exists);
//   * a customer site carrying `type` / `locationType` blocks (the CRM site namespace has no type);
//   * a field this module does not classify blocks -- a new stored field is a mapping decision, not a silent drop.
//
// Certification-world records (the `certificationWorld` marker of functions/scripts/certificationWorld/manifest.mjs)
// are EXCLUDED from the copy with their ids and reason in the evidence; the Certification world is frozen.
const node_crypto_1 = require("node:crypto");
const customerIdentity_js_1 = require("./customerIdentity.js");
exports.CRM_SNAPSHOT_FORMAT = "EOS_CRM_SNAPSHOT";
exports.CRM_SNAPSHOT_VERSION = 1;
/** The ONLY collections the snapshot carries. The exporter allowlists exactly these. */
exports.CRM_SNAPSHOT_COLLECTIONS = Object.freeze(["accounts", "contacts", "locations"]);
/** The explicit Certification-world fixture marker (functions/scripts/certificationWorld/manifest.mjs MARKER_FIELD). */
exports.CERTIFICATION_MARKER_FIELD = "certificationWorld";
/** The id prefix the Certification world mints (build.mjs "cw-acct-"). Evidence only: a marker is what identifies. */
exports.CERTIFICATION_ID_PREFIX = "cw-";
// The governed D1-A authority's own bounds and vocabularies -- imported, never restated, so the census cannot accept a
// value the authority would refuse (functions/src/eosCrm/accountVocabulary.ts, crmAuthorityKernel.ts).
const accountVocabulary_js_1 = require("../eosCrm/accountVocabulary.js");
Object.defineProperty(exports, "ACCOUNT_LINES_OF_BUSINESS", { enumerable: true, get: function () { return accountVocabulary_js_1.ACCOUNT_LINES_OF_BUSINESS; } });
Object.defineProperty(exports, "ACCOUNT_RELATIONSHIP_TYPES", { enumerable: true, get: function () { return accountVocabulary_js_1.ACCOUNT_RELATIONSHIP_TYPES; } });
Object.defineProperty(exports, "INVOICE_DELIVERY_METHODS", { enumerable: true, get: function () { return accountVocabulary_js_1.INVOICE_DELIVERY_METHODS; } });
Object.defineProperty(exports, "MAX_ACCOUNT_TAGS", { enumerable: true, get: function () { return accountVocabulary_js_1.MAX_ACCOUNT_TAGS; } });
Object.defineProperty(exports, "MAX_ACCOUNT_TAG_LENGTH", { enumerable: true, get: function () { return accountVocabulary_js_1.MAX_ACCOUNT_TAG_LENGTH; } });
Object.defineProperty(exports, "PAYMENT_TERMS", { enumerable: true, get: function () { return accountVocabulary_js_1.PAYMENT_TERMS; } });
Object.defineProperty(exports, "TAX_STATUSES", { enumerable: true, get: function () { return accountVocabulary_js_1.TAX_STATUSES; } });
const crmAuthorityKernel_js_1 = require("../eosCrm/crmAuthorityKernel.js");
Object.defineProperty(exports, "MAX_CRM_TEXT_LENGTH", { enumerable: true, get: function () { return crmAuthorityKernel_js_1.MAX_CRM_TEXT_LENGTH; } });
/** Oldest legacy timestamp accepted as a real business time (2000-01-01T00:00:00Z). */
const EARLIEST_MS = 946_684_800_000;
const DAY_MS = 86_400_000;
class CrmSnapshotError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "CrmSnapshotError";
    }
}
exports.CrmSnapshotError = CrmSnapshotError;
const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
/** Structural parse. Content problems are census findings, not parse errors. */
function parseCrmSnapshot(json) {
    if (!isPlain(json) || json.format !== exports.CRM_SNAPSHOT_FORMAT || json.version !== exports.CRM_SNAPSHOT_VERSION) {
        throw new CrmSnapshotError("SNAPSHOT_FORMAT_INVALID", `not an ${exports.CRM_SNAPSHOT_FORMAT} version ${exports.CRM_SNAPSHOT_VERSION} file`);
    }
    const extra = Object.keys(json).filter((k) => !["format", "version", "source", "exporter", ...exports.CRM_SNAPSHOT_COLLECTIONS].includes(k));
    if (extra.length > 0) {
        throw new CrmSnapshotError("SNAPSHOT_FORMAT_INVALID", `the snapshot carries collections outside the allowlist: ${extra.sort().join(", ")}`);
    }
    const source = json.source;
    if (!isPlain(source) || typeof source.environmentId !== "string" || source.environmentId === ""
        || typeof source.firebaseProjectId !== "string" || source.firebaseProjectId === "" || typeof source.exportedAt !== "string"
        || Number.isNaN(Date.parse(source.exportedAt))) {
        throw new CrmSnapshotError("SNAPSHOT_FORMAT_INVALID", "source.environmentId, source.firebaseProjectId and an ISO source.exportedAt are required");
    }
    const docs = (name) => {
        const list = json[name];
        if (!Array.isArray(list))
            throw new CrmSnapshotError("SNAPSHOT_FORMAT_INVALID", `${name} must be a list`);
        return list.map((d, i) => {
            if (!isPlain(d) || typeof d.id !== "string" || !isPlain(d.data) || Object.keys(d).length !== 2) {
                throw new CrmSnapshotError("SNAPSHOT_FORMAT_INVALID", `${name}[${i}] must be exactly { id, data }`);
            }
            return { id: d.id, data: d.data };
        });
    };
    return {
        source: { environmentId: source.environmentId, firebaseProjectId: source.firebaseProjectId, exportedAt: source.exportedAt },
        accounts: docs("accounts"),
        contacts: docs("contacts"),
        locations: docs("locations"),
    };
}
exports.ACCOUNT_FIELD_DISPOSITIONS = Object.freeze({
    name: "COLUMN", status: "COLUMN", accountOwner: "COLUMN", billingAddress: "COLUMN", notes: "COLUMN",
    customerNumber: "COLUMN", erpId: "COLUMN", accountingId: "COLUMN", legacyId: "COLUMN", defaultCurrency: "COLUMN",
    purchaseOrderRequired: "COLUMN", invoiceDeliveryMethod: "COLUMN", paymentTerms: "COLUMN", taxStatus: "COLUMN",
    billingContact: "COLUMN", tags: "COLUMN", relationshipTypes: "COLUMN", lineOfBusiness: "COLUMN",
    createdAt: "COLUMN", updatedAt: "COLUMN",
    accountId: "IDENTITY_ECHO",
    nameLower: "DERIVED",
    createdBy: "PROVENANCE_EVIDENCE", updatedBy: "PROVENANCE_EVIDENCE",
    [exports.CERTIFICATION_MARKER_FIELD]: "CERTIFICATION_MARKER",
    certLineMode: "CERTIFICATION_FIXTURE_ONLY", category: "CERTIFICATION_FIXTURE_ONLY", fixtureCompleteness: "CERTIFICATION_FIXTURE_ONLY",
    dataProvenance: "CERTIFICATION_FIXTURE_ONLY", fieldProvenance: "CERTIFICATION_FIXTURE_ONLY", publicSource: "CERTIFICATION_FIXTURE_ONLY",
    syntheticDataDisclaimer: "CERTIFICATION_FIXTURE_ONLY",
    // Controller ruling 3 census (crm-cutover-plan.md §2.5): written only by the Certification world
    // (certificationWorld/build.mjs:151-164), read by no product surface, report or command -> C, not migrated, the value
    // preserved per record in the evidence. NEVER promoted to a billing address.
    city: "NOT_MIGRATED_OBSOLETE", state: "NOT_MIGRATED_OBSOLETE", addressLine1: "NOT_MIGRATED_OBSOLETE",
    phone: "NOT_MIGRATED_OBSOLETE", website: "NOT_MIGRATED_OBSOLETE",
});
exports.CONTACT_FIELD_DISPOSITIONS = Object.freeze({
    accountId: "COLUMN", name: "COLUMN", email: "COLUMN", phone: "COLUMN", role: "COLUMN", isPrimary: "COLUMN", owner: "COLUMN",
    createdAt: "COLUMN", updatedAt: "COLUMN",
    contactId: "IDENTITY_ECHO",
    createdBy: "PROVENANCE_EVIDENCE", updatedBy: "PROVENANCE_EVIDENCE",
    [exports.CERTIFICATION_MARKER_FIELD]: "CERTIFICATION_MARKER",
    dataProvenance: "CERTIFICATION_FIXTURE_ONLY",
    // Ruling 3: `title` is the SAME fact as `role` -- the product's own CSV importer maps a Title / Job title / Position
    // column to role (field-ops-app-vite/src/domain/contactCsvImport.js:109) -> B, mapped to contact_role; a record whose
    // title and role disagree blocks. `locationId` (Certification world only, no reader) -> C, not migrated, in evidence.
    title: "COLUMN", locationId: "NOT_MIGRATED_OBSOLETE",
});
exports.LOCATION_FIELD_DISPOSITIONS = Object.freeze({
    accountId: "COLUMN", name: "COLUMN", address: "COLUMN", addressLine1: "COLUMN", city: "COLUMN", state: "COLUMN", zip: "COLUMN",
    accessNotes: "COLUMN", owner: "COLUMN", createdAt: "COLUMN", updatedAt: "COLUMN",
    locationId: "IDENTITY_ECHO",
    createdBy: "PROVENANCE_EVIDENCE", updatedBy: "PROVENANCE_EVIDENCE",
    [exports.CERTIFICATION_MARKER_FIELD]: "CERTIFICATION_MARKER",
    fieldProvenance: "CERTIFICATION_FIXTURE_ONLY",
    // The inventory discriminator: a CRM customer site has no type (migration 1758758400000 header, point 3).
    ...Object.fromEntries(customerIdentity_js_1.INVENTORY_LOCATION_DISCRIMINATOR_KEYS.map((k) => [k, "NOT_MIGRATED_BLOCKING"])),
});
const DISPOSITIONS = Object.freeze({
    accounts: exports.ACCOUNT_FIELD_DISPOSITIONS,
    contacts: exports.CONTACT_FIELD_DISPOSITIONS,
    locations: exports.LOCATION_FIELD_DISPOSITIONS,
});
exports.ACCOUNT_FIELDS = Object.freeze([
    "id", "name", "status", "ownerEmployeeId", "notes", "billingAddressStreet", "billingAddressCity", "billingAddressState",
    "billingAddressPostalCode", "customerNumber", "erpId", "accountingId", "legacyId", "defaultCurrency", "purchaseOrderRequired",
    "invoiceDeliveryMethod", "paymentTerms", "taxStatus", "billingContactId", "tags", "relationshipTypes", "linesOfBusiness",
    "createdAt", "updatedAt",
]);
exports.CONTACT_FIELDS = Object.freeze([
    "id", "accountId", "name", "email", "phone", "contactRole", "isPrimary", "ownerEmployeeId", "createdAt", "updatedAt",
]);
exports.LOCATION_FIELDS = Object.freeze([
    "id", "accountId", "name", "addressStreet", "addressCity", "addressState", "addressPostalCode", "accessNotes",
    "ownerEmployeeId", "createdAt", "updatedAt",
]);
/** Ruling 4: the D1 creation-owner rule applied at cutover, recorded per derived record. */
exports.OWNER_DERIVATION_RULE = "D1_CREATION_OWNER_FOLLOWS_ACCOUNT_OWNER_AT_CUTOVER";
const asciiSort = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sortedBag = (bag) => Object.fromEntries(Object.entries(bag).sort(([a], [b]) => asciiSort(a, b)));
function canonicalCrmDigest(crm) {
    const h = (0, node_crypto_1.createHash)("sha256");
    for (const a of crm.accounts)
        h.update(JSON.stringify(exports.ACCOUNT_FIELDS.map((f) => a[f])) + "\n");
    h.update("--contacts--\n");
    for (const c of crm.contacts)
        h.update(JSON.stringify(exports.CONTACT_FIELDS.map((f) => c[f])) + "\n");
    h.update("--locations--\n");
    for (const l of crm.locations)
        h.update(JSON.stringify(exports.LOCATION_FIELDS.map((f) => l[f])) + "\n");
    return h.digest("hex");
}
/** Absent / null -> null; blank -> null; trimmed; non-string or over the bound refuses. (crmAuthorityKernel optionalText) */
function optionalText(value) {
    if (value === undefined || value === null)
        return { ok: true, value: null };
    if (typeof value !== "string")
        return { ok: false, reason: `must be text, found ${describe(value)}` };
    if (value.length > crmAuthorityKernel_js_1.MAX_CRM_TEXT_LENGTH)
        return { ok: false, reason: `exceeds ${crmAuthorityKernel_js_1.MAX_CRM_TEXT_LENGTH} characters` };
    const trimmed = value.trim();
    return { ok: true, value: trimmed === "" ? null : trimmed, normalized: trimmed !== value };
}
/** A required name: non-blank text within the bound, trimmed. (crmAuthorityKernel requireName) */
function requiredName(value) {
    if (typeof value !== "string" || value.trim() === "" || value.length > crmAuthorityKernel_js_1.MAX_CRM_TEXT_LENGTH) {
        return { ok: false, reason: value === undefined ? "absent" : `must be non-blank text of at most ${crmAuthorityKernel_js_1.MAX_CRM_TEXT_LENGTH} characters` };
    }
    return { ok: true, value: value.trim(), normalized: value.trim() !== value };
}
function optionalEnum(value, allowed) {
    if (value === undefined || value === null)
        return { ok: true, value: null };
    if (typeof value !== "string" || !allowed.includes(value))
        return { ok: false, reason: `${JSON.stringify(value)} is not one of ${allowed.join(", ")}` };
    return { ok: true, value };
}
function enumSet(value, allowed) {
    if (value === undefined || value === null)
        return { ok: true, value: [] };
    if (!Array.isArray(value))
        return { ok: false, reason: `must be a list, found ${describe(value)}` };
    if (!value.every((v) => typeof v === "string" && allowed.includes(v)) || new Set(value).size !== value.length) {
        return { ok: false, reason: `must be distinct values from ${allowed.join(", ")}, found ${JSON.stringify(value)}` };
    }
    return { ok: true, value: allowed.filter((v) => value.includes(v)) };
}
function describe(value) {
    if (value === null)
        return "null";
    if (Array.isArray(value))
        return "a list";
    if (isPlain(value) && isPlain(value.$timestamp))
        return "a Timestamp";
    if (isPlain(value) && typeof value.$unsupported === "string")
        return `an unsupported ${value.$unsupported}`;
    return typeof value === "object" ? "a map" : typeof value;
}
/** Firestore Timestamp (tagged) or epoch milliseconds -> microsecond ISO. Anything else refuses. */
function readInstant(value, exportedAtMs) {
    if (value === undefined || value === null)
        return { shape: "ABSENT", iso: null, truncated: false };
    const latest = exportedAtMs + DAY_MS;
    if (typeof value === "number") {
        if (!Number.isSafeInteger(value) || value < EARLIEST_MS || value > latest)
            return { shape: "INVALID", iso: null, truncated: false };
        return { shape: "EPOCH_MILLIS", iso: `${new Date(value).toISOString().slice(0, 23)}000Z`, truncated: false };
    }
    if (isPlain(value) && Object.keys(value).length === 1 && isPlain(value.$timestamp) && Object.keys(value.$timestamp).length === 2) {
        const { seconds, nanoseconds } = value.$timestamp;
        if (Number.isSafeInteger(seconds) && Number.isInteger(nanoseconds) && nanoseconds >= 0 && nanoseconds <= 999_999_999) {
            const ms = seconds * 1000 + Math.floor(nanoseconds / 1_000_000);
            if (ms >= EARLIEST_MS && ms <= latest) {
                const micros = String(Math.floor(nanoseconds / 1000)).padStart(6, "0");
                return { shape: "TIMESTAMP", iso: `${new Date(ms).toISOString().slice(0, 19)}.${micros}Z`, truncated: nanoseconds % 1000 !== 0 };
            }
        }
    }
    return { shape: "INVALID", iso: null, truncated: false };
}
/** The typed owner { type: "USER", id } (functions/src/ownership/typedOwner.ts) -- the only Contact/site owner shape. */
function readTypedOwner(value) {
    if (value === undefined || value === null)
        return { ok: true, value: null };
    if (!isPlain(value) || value.type !== "USER" || Object.keys(value).some((k) => !["type", "id"].includes(k))
        || typeof value.id !== "string" || !customerIdentity_js_1.CRM_ID_PATTERN.test(value.id)) {
        return { ok: false, reason: "owner is not a typed owner { type: 'USER', id: <Employee id> }" };
    }
    return { ok: true, value: value.id };
}
const ASSIGNMENT_KEYS = ["assignedToEmployeeId", "assignedToUserId", "assignedToDisplayName", "assignedByEmployeeId", "assignedByUserId", "assignedByDisplayName", "assignedAt"];
/**
 * The Account's Person Assignment map (domain/commercialProfile.js isCompleteAccountOwner). ONLY assignedToEmployeeId
 * is ownership; the rest is provenance evidence. An assignment map with no assignee is OWNERLESS.
 */
function readAccountOwner(value) {
    if (value === undefined || value === null)
        return { ok: true, value: null };
    if (!isPlain(value) || Object.keys(value).some((k) => !ASSIGNMENT_KEYS.includes(k))) {
        return { ok: false, reason: "accountOwner is not a Person Assignment map (assignedToEmployeeId, assignedToUserId, assignedToDisplayName, assignedBy*, assignedAt)" };
    }
    const assignee = value.assignedToEmployeeId;
    if (assignee === undefined || assignee === null || assignee === "")
        return { ok: true, value: null };
    if (typeof assignee !== "string" || !customerIdentity_js_1.CRM_ID_PATTERN.test(assignee))
        return { ok: false, reason: "accountOwner.assignedToEmployeeId is not an Employee id" };
    return { ok: true, value: assignee };
}
/**
 * Census the snapshot and produce the canonical records a copy would write. Snapshot-only: target facts are added by
 * `finalizeCrmCensus`. A census that has not been finalized is never copy-ready (owners are unresolved).
 */
function censusCrmSnapshot(snapshot) {
    const findings = [];
    const exportedAtMs = Date.parse(snapshot.source.exportedAt);
    const add = (collection, id, code, severity, field, detail) => findings.push({ collection, id, code, severity, field, detail });
    const counts = { accounts: snapshot.accounts.length, contacts: snapshot.contacts.length, locations: snapshot.locations.length };
    const excludedCount = { accounts: 0, contacts: 0, locations: 0 };
    const ownerless = { accounts: 0, contacts: 0, locations: 0 };
    const fieldPresence = { accounts: {}, contacts: {}, locations: {} };
    const zeroShapes = () => ({ TIMESTAMP: 0, EPOCH_MILLIS: 0, ABSENT: 0, INVALID: 0 });
    const timestampShapes = {
        accounts: { createdAt: zeroShapes(), updatedAt: zeroShapes() },
        contacts: { createdAt: zeroShapes(), updatedAt: zeroShapes() },
        locations: { createdAt: zeroShapes(), updatedAt: zeroShapes() },
    };
    const statusDistribution = {};
    const addressShapes = { nested: 0, flat: 0, both: 0, absent: 0 };
    const billingAddressShapes = { structured: 0, freeText: 0, absent: 0, invalid: 0 };
    const ownerReferences = {};
    const billingAddressResolution = [];
    const notMigratedValues = [];
    const ownerDerivations = [];
    const certificationExcluded = [];
    const provenance = [];
    /** Shared per-document gate: id shape, duplicates, certification exclusion, field classification. */
    const gate = (collection, docs) => {
        const seen = new Map();
        for (const d of docs)
            seen.set(d.id, (seen.get(d.id) ?? 0) + 1);
        const admitted = [];
        for (const d of docs) {
            for (const f of Object.keys(d.data))
                fieldPresence[collection][f] = (fieldPresence[collection][f] ?? 0) + 1;
            if ((seen.get(d.id) ?? 0) > 1) {
                add(collection, d.id, "DUPLICATE_ID", "BLOCKING", null, `${seen.get(d.id)} snapshot documents claim this id`);
                continue;
            }
            if (Object.prototype.hasOwnProperty.call(d.data, exports.CERTIFICATION_MARKER_FIELD)) {
                excludedCount[collection] += 1;
                certificationExcluded.push({ collection, id: d.id, reason: `carries the ${exports.CERTIFICATION_MARKER_FIELD} marker: a frozen Certification-world fixture, never copied` });
                continue;
            }
            if (d.id.startsWith(exports.CERTIFICATION_ID_PREFIX)) {
                add(collection, d.id, "CERTIFICATION_ID_WITHOUT_MARKER", "BLOCKING", null, `the id has the Certification-world prefix '${exports.CERTIFICATION_ID_PREFIX}' but no ${exports.CERTIFICATION_MARKER_FIELD} marker; whether it is a fixture is not guessed`);
                continue;
            }
            if (!customerIdentity_js_1.CRM_ID_PATTERN.test(d.id)) {
                add(collection, d.id, "ID_SHAPE_INVALID", "BLOCKING", null, "the id is not 1-200 characters of A-Z a-z 0-9 _ -; ids are carried verbatim, never re-minted");
                continue;
            }
            let blocked = false;
            for (const [field, value] of Object.entries(d.data)) {
                const disposition = DISPOSITIONS[collection][field];
                if (disposition === undefined) {
                    add(collection, d.id, "UNCLASSIFIED_SOURCE_FIELD", "BLOCKING", field, "a stored field with no mapping decision; it is never silently dropped");
                    blocked = true;
                }
                else if (disposition === "CERTIFICATION_FIXTURE_ONLY" || disposition === "NOT_MIGRATED_BLOCKING") {
                    add(collection, d.id, disposition === "CERTIFICATION_FIXTURE_ONLY" ? "FIXTURE_FIELD_ON_UNMARKED_RECORD" : "FIELD_HAS_NO_CANONICAL_TARGET", "BLOCKING", field, "the value has no PostgreSQL target; correct the source or obtain an Owner mapping decision");
                    blocked = true;
                }
                else if (disposition === "NOT_MIGRATED_OBSOLETE") {
                    notMigratedValues.push({ collection, id: d.id, field, value });
                    add(collection, d.id, "FIELD_NOT_MIGRATED_OBSOLETE", "ADVISORY", field, "no current reader or writer (ruling 3, class C); not migrated, the value is preserved in the evidence");
                }
                else if (disposition === "IDENTITY_ECHO" && value !== d.id) {
                    add(collection, d.id, "IDENTITY_ECHO_MISMATCH", "BLOCKING", field, `stores ${JSON.stringify(value)}, which is not the document id`);
                    blocked = true;
                }
                else if (isPlain(value) && typeof value.$unsupported === "string") {
                    add(collection, d.id, "UNSUPPORTED_VALUE_TYPE", "BLOCKING", field, `a Firestore ${value.$unsupported} has no canonical representation`);
                    blocked = true;
                }
            }
            provenance.push({
                collection, id: d.id, createdBy: d.data.createdBy ?? null, updatedBy: d.data.updatedBy ?? null,
                ownerAssignment: collection === "accounts" && isPlain(d.data.accountOwner)
                    ? {
                        assignedToUserId: d.data.accountOwner.assignedToUserId ?? null,
                        assignedToDisplayName: d.data.accountOwner.assignedToDisplayName ?? null,
                        assignedByEmployeeId: d.data.accountOwner.assignedByEmployeeId ?? null,
                        assignedByUserId: d.data.accountOwner.assignedByUserId ?? null,
                        assignedByDisplayName: d.data.accountOwner.assignedByDisplayName ?? null,
                        assignedAt: d.data.accountOwner.assignedAt ?? null,
                    }
                    : null,
            });
            admitted.push({ d, blocked });
        }
        return admitted;
    };
    /** created/updated instants. Absent updatedAt reads as createdAt (the create path stamps both from one call). */
    const instants = (collection, d) => {
        const created = readInstant(d.data.createdAt, exportedAtMs);
        const updated = readInstant(d.data.updatedAt, exportedAtMs);
        timestampShapes[collection].createdAt[created.shape] += 1;
        timestampShapes[collection].updatedAt[updated.shape] += 1;
        if (created.truncated || updated.truncated) {
            add(collection, d.id, "TIMESTAMP_SUB_MICROSECOND_TRUNCATED", "ADVISORY", null, "nanoseconds below a microsecond are dropped (TIMESTAMPTZ precision)");
        }
        if (created.shape !== "TIMESTAMP" && created.shape !== "EPOCH_MILLIS") {
            add(collection, d.id, created.shape === "ABSENT" ? "CREATED_AT_ABSENT" : "CREATED_AT_INVALID", "BLOCKING", "createdAt", "a creation time is never fabricated; the source must carry a Timestamp or epoch milliseconds");
            return null;
        }
        if (updated.shape === "INVALID") {
            add(collection, d.id, "UPDATED_AT_INVALID", "BLOCKING", "updatedAt", "not a Timestamp or epoch milliseconds in range");
            return null;
        }
        if (created.shape !== updated.shape && updated.shape !== "ABSENT") {
            add(collection, d.id, "TIMESTAMP_SHAPE_DRIFT", "ADVISORY", null, `createdAt is ${created.shape}, updatedAt is ${updated.shape}`);
        }
        if (updated.shape === "ABSENT") {
            add(collection, d.id, "UPDATED_AT_ABSENT_USES_CREATED_AT", "ADVISORY", "updatedAt", "never updated since creation; updated_at = created_at");
            return { createdAt: created.iso, updatedAt: created.iso };
        }
        if (updated.iso < created.iso) {
            add(collection, d.id, "UPDATED_BEFORE_CREATED", "ADVISORY", null, "carried verbatim; the source clock disagrees with itself");
        }
        return { createdAt: created.iso, updatedAt: updated.iso };
    };
    const text = (collection, id, field, r) => {
        if (!r.ok) {
            add(collection, id, "FIELD_VALUE_INVALID", "BLOCKING", field, r.reason);
            return undefined;
        }
        if (r.normalized)
            add(collection, id, "TEXT_TRIMMED", "ADVISORY", field, "surrounding whitespace trimmed, as the governed authority stores it");
        return r.value;
    };
    // ──────────────── accounts ────────────────
    const accounts = [];
    const pendingBillingContact = new Map();
    for (const { d, blocked } of gate("accounts", snapshot.accounts)) {
        let bad = blocked;
        const data = d.data;
        const rawStatus = data.status;
        const statusKey = rawStatus === undefined ? "<absent>" : typeof rawStatus === "string" ? rawStatus : `<${describe(rawStatus)}>`;
        statusDistribution[statusKey] = (statusDistribution[statusKey] ?? 0) + 1;
        const name = text("accounts", d.id, "name", requiredName(data.name));
        if (name === undefined)
            bad = true;
        if (!(0, customerIdentity_js_1.isCrmAccountStatus)(rawStatus)) {
            add("accounts", d.id, "STATUS_UNMAPPABLE", "BLOCKING", "status", `${JSON.stringify(rawStatus ?? null)} is not exactly one of ${customerIdentity_js_1.CRM_ACCOUNT_STATUSES.join(" / ")}; a status is never case-folded, aliased or defaulted`);
            bad = true;
        }
        const owner = readAccountOwner(data.accountOwner);
        if (!owner.ok) {
            add("accounts", d.id, "OWNER_SHAPE_UNRECOGNISED", "BLOCKING", "accountOwner", owner.reason);
            bad = true;
        }
        let billing = [null, null, null, null];
        const ba = data.billingAddress;
        if (ba === undefined || ba === null)
            billingAddressShapes.absent += 1;
        else if (typeof ba === "string") {
            billingAddressShapes.freeText += 1;
            if (ba.trim() === "") {
                add("accounts", d.id, "TEXT_TRIMMED", "ADVISORY", "billingAddress", "a blank free-text billing address reads as no address");
            }
            else {
                billingAddressResolution.push({ accountId: d.id, freeText: ba });
                add("accounts", d.id, "BILLING_ADDRESS_REQUIRES_RESOLUTION", "BLOCKING", "billingAddress", "a single free-text billing address is never parsed into street/city/state/postal code; it is held in reconciliation evidence until a person records the structured address");
                bad = true;
            }
        }
        else if (isPlain(ba) && Object.keys(ba).every((k) => ["street", "city", "state", "zip"].includes(k))) {
            const parts = ["street", "city", "state", "zip"].map((k) => optionalText(ba[k]));
            if (parts.some((p) => !p.ok)) {
                billingAddressShapes.invalid += 1;
                add("accounts", d.id, "FIELD_VALUE_INVALID", "BLOCKING", "billingAddress", "every billing address part must be text or null");
                bad = true;
            }
            else {
                billingAddressShapes.structured += 1;
                billing = parts.map((p) => p.value);
            }
        }
        else {
            billingAddressShapes.invalid += 1;
            add("accounts", d.id, "FIELD_VALUE_INVALID", "BLOCKING", "billingAddress", "billingAddress must be { street, city, state, zip }, null, or (unresolved) free text");
            bad = true;
        }
        const opt = (field) => text("accounts", d.id, field, optionalText(data[field]));
        const notes = opt("notes"), customerNumber = opt("customerNumber"), erpId = opt("erpId"), accountingId = opt("accountingId"), legacyId = opt("legacyId");
        let defaultCurrency = null;
        if (data.defaultCurrency !== undefined && data.defaultCurrency !== null) {
            if (typeof data.defaultCurrency !== "string" || !/^[A-Z]{3}$/.test(data.defaultCurrency) || !accountVocabulary_js_1.ISO_4217_CURRENCIES.has(data.defaultCurrency)) {
                add("accounts", d.id, "FIELD_VALUE_INVALID", "BLOCKING", "defaultCurrency", `${JSON.stringify(data.defaultCurrency)} is not an ISO 4217 alphabetic code`);
                defaultCurrency = undefined;
            }
            else
                defaultCurrency = data.defaultCurrency;
        }
        let purchaseOrderRequired = null;
        if (data.purchaseOrderRequired !== undefined && data.purchaseOrderRequired !== null) {
            if (typeof data.purchaseOrderRequired !== "boolean") {
                add("accounts", d.id, "FIELD_VALUE_INVALID", "BLOCKING", "purchaseOrderRequired", `must be a boolean, found ${describe(data.purchaseOrderRequired)}`);
                purchaseOrderRequired = undefined;
            }
            else
                purchaseOrderRequired = data.purchaseOrderRequired;
        }
        const enumField = (field, allowed) => text("accounts", d.id, field, optionalEnum(data[field], allowed));
        const invoiceDeliveryMethod = enumField("invoiceDeliveryMethod", accountVocabulary_js_1.INVOICE_DELIVERY_METHODS);
        const paymentTerms = enumField("paymentTerms", accountVocabulary_js_1.PAYMENT_TERMS);
        const taxStatus = enumField("taxStatus", accountVocabulary_js_1.TAX_STATUSES);
        let billingContactId = null;
        const bc = data.billingContact;
        if (bc !== undefined && bc !== null) {
            if (!isPlain(bc) || Object.keys(bc).length !== 1 || typeof bc.contactId !== "string" || !customerIdentity_js_1.CRM_ID_PATTERN.test(bc.contactId)) {
                add("accounts", d.id, "FIELD_VALUE_INVALID", "BLOCKING", "billingContact", "billingContact must be { contactId }");
                billingContactId = undefined;
            }
            else {
                billingContactId = bc.contactId;
                pendingBillingContact.set(d.id, bc.contactId);
            }
        }
        let tags = [];
        if (data.tags !== undefined && data.tags !== null) {
            const raw = data.tags;
            if (!Array.isArray(raw) || raw.length > accountVocabulary_js_1.MAX_ACCOUNT_TAGS || !raw.every((t) => typeof t === "string" && t.trim() !== "" && t.trim().length <= accountVocabulary_js_1.MAX_ACCOUNT_TAG_LENGTH)
                || new Set(raw.map((t) => t.trim())).size !== raw.length) {
                add("accounts", d.id, "FIELD_VALUE_INVALID", "BLOCKING", "tags", `tags must be at most ${accountVocabulary_js_1.MAX_ACCOUNT_TAGS} distinct non-blank labels of at most ${accountVocabulary_js_1.MAX_ACCOUNT_TAG_LENGTH} characters`);
                tags = undefined;
            }
            else {
                tags = raw.map((t) => t.trim());
                if (tags.some((t, i) => t !== raw[i]))
                    add("accounts", d.id, "TEXT_TRIMMED", "ADVISORY", "tags", "tag whitespace trimmed");
            }
        }
        const relationshipTypes = text("accounts", d.id, "relationshipTypes", enumSet(data.relationshipTypes, accountVocabulary_js_1.ACCOUNT_RELATIONSHIP_TYPES));
        let linesOfBusiness;
        if (typeof data.lineOfBusiness === "string") {
            // Ruling 3, class B: the scalar is the one-member form of the same fact (the Account form reads it by membership,
            // AccountForm.jsx:60,324,332). A vocabulary value maps to a one-item set; anything else blocks.
            if (accountVocabulary_js_1.ACCOUNT_LINES_OF_BUSINESS.includes(data.lineOfBusiness)) {
                linesOfBusiness = [data.lineOfBusiness];
                add("accounts", d.id, "LINE_OF_BUSINESS_SCALAR_AS_SET", "ADVISORY", "lineOfBusiness", `the scalar ${JSON.stringify(data.lineOfBusiness)} is copied as a one-item set`);
            }
            else {
                add("accounts", d.id, "LINE_OF_BUSINESS_SCALAR_UNMAPPABLE", "BLOCKING", "lineOfBusiness", `the scalar ${JSON.stringify(data.lineOfBusiness)} is not one of ${accountVocabulary_js_1.ACCOUNT_LINES_OF_BUSINESS.join(", ")}`);
            }
        }
        else {
            linesOfBusiness = text("accounts", d.id, "lineOfBusiness", enumSet(data.lineOfBusiness, accountVocabulary_js_1.ACCOUNT_LINES_OF_BUSINESS));
        }
        if (typeof data.nameLower === "string" && typeof data.name === "string" && data.nameLower !== (0, customerIdentity_js_1.foldCustomerName)(data.name)) {
            add("accounts", d.id, "DERIVED_SEARCH_NAME_STALE", "ADVISORY", "nameLower", "the stored nameLower does not fold from name; PostgreSQL recomputes it and does not copy it");
        }
        const at = instants("accounts", d);
        const values = [name, notes, customerNumber, erpId, accountingId, legacyId, defaultCurrency, purchaseOrderRequired, invoiceDeliveryMethod,
            paymentTerms, taxStatus, billingContactId, tags, relationshipTypes, linesOfBusiness];
        if (bad || !owner.ok || at === null || values.some((v) => v === undefined))
            continue;
        accounts.push({
            id: d.id, name: name, status: rawStatus, ownerEmployeeId: owner.value,
            notes: notes, billingAddressStreet: billing[0], billingAddressCity: billing[1], billingAddressState: billing[2], billingAddressPostalCode: billing[3],
            customerNumber: customerNumber, erpId: erpId, accountingId: accountingId, legacyId: legacyId,
            defaultCurrency: defaultCurrency, purchaseOrderRequired: purchaseOrderRequired,
            invoiceDeliveryMethod: invoiceDeliveryMethod, paymentTerms: paymentTerms, taxStatus: taxStatus,
            billingContactId: billingContactId, tags: tags, relationshipTypes: relationshipTypes,
            linesOfBusiness: linesOfBusiness, createdAt: at.createdAt, updatedAt: at.updatedAt,
        });
    }
    const accountIds = new Set(accounts.map((a) => a.id));
    const accountOwnerOf = new Map(accounts.map((a) => [a.id, a.ownerEmployeeId]));
    /**
     * Ruling 4: a Contact or customer site with no independent stated owner follows its Account's owner AT CUTOVER (the
     * D1 creation semantics). Not accountability, and not a propagation of any later Account handoff. Evidence is
     * recorded per record. An ownerless Account yields no owner to follow: the child is BLOCKED, never left ownerless.
     */
    const childOwner = (collection, id, accountId, stated) => {
        if (stated !== null)
            return stated;
        const accountOwner = accountOwnerOf.get(accountId) ?? null;
        if (accountOwner === null) {
            add(collection, id, "CHILD_OWNER_UNDERIVABLE", "BLOCKING", "owner", `no owner is stated and Account ${accountId} is ownerless; a governed ${collection === "contacts" ? "Contact" : "customer site"} is never ownerless and its owner is never guessed`);
            return undefined;
        }
        ownerDerivations.push({ collection, id, derivedFromAccountId: accountId, ownerEmployeeId: accountOwner, rule: exports.OWNER_DERIVATION_RULE });
        return accountOwner;
    };
    const everyAccountId = new Set(snapshot.accounts.map((a) => a.id));
    const parentOf = (collection, d) => {
        const r = typeof d.data.accountId === "string" && customerIdentity_js_1.CRM_ID_PATTERN.test(d.data.accountId) ? d.data.accountId : null;
        if (r === null) {
            add(collection, d.id, "ACCOUNT_ID_MISSING", "BLOCKING", "accountId", "a Contact or customer site belongs to exactly one Account; the parent is never guessed");
            return undefined;
        }
        if (!accountIds.has(r)) {
            add(collection, d.id, "ACCOUNT_REFERENCE_DANGLING", "BLOCKING", "accountId", everyAccountId.has(r) ? `Account ${r} is in the snapshot but not selected for copy (excluded or blocked)` : `Account ${r} is not in the snapshot`);
            return undefined;
        }
        return r;
    };
    // ──────────────── contacts ────────────────
    const contacts = [];
    for (const { d, blocked: bad } of gate("contacts", snapshot.contacts)) {
        const accountId = parentOf("contacts", d);
        const name = text("contacts", d.id, "name", requiredName(d.data.name));
        const email = text("contacts", d.id, "email", optionalText(d.data.email));
        const phone = text("contacts", d.id, "phone", optionalText(d.data.phone));
        const role = text("contacts", d.id, "role", optionalText(d.data.role));
        const title = text("contacts", d.id, "title", optionalText(d.data.title));
        let contactRole = role;
        if (role !== undefined && title !== undefined && title !== null) {
            if (role === null) {
                contactRole = title;
                add("contacts", d.id, "CONTACT_TITLE_AS_ROLE", "ADVISORY", "title", "title is the role fact (contactCsvImport.js:109); copied to contact_role");
            }
            else if (role !== title) {
                add("contacts", d.id, "CONTACT_TITLE_ROLE_CONFLICT", "BLOCKING", "title", `title ${JSON.stringify(title)} and role ${JSON.stringify(role)} disagree; neither is chosen`);
                contactRole = undefined;
            }
        }
        else if (title === undefined)
            contactRole = undefined;
        let isPrimary = false;
        if (d.data.isPrimary !== undefined && d.data.isPrimary !== null) {
            if (typeof d.data.isPrimary !== "boolean") {
                add("contacts", d.id, "FIELD_VALUE_INVALID", "BLOCKING", "isPrimary", `must be a boolean, found ${describe(d.data.isPrimary)}`);
                isPrimary = undefined;
            }
            else
                isPrimary = d.data.isPrimary;
        }
        const owner = readTypedOwner(d.data.owner);
        if (!owner.ok)
            add("contacts", d.id, "OWNER_SHAPE_UNRECOGNISED", "BLOCKING", "owner", owner.reason);
        const at = instants("contacts", d);
        if (bad || accountId === undefined || !owner.ok || at === null || [name, email, phone, contactRole, isPrimary].some((v) => v === undefined))
            continue;
        const contactOwner = childOwner("contacts", d.id, accountId, owner.value);
        if (contactOwner === undefined)
            continue;
        contacts.push({
            id: d.id, accountId, name: name, email: email, phone: phone,
            contactRole: contactRole, isPrimary: isPrimary, ownerEmployeeId: contactOwner, createdAt: at.createdAt, updatedAt: at.updatedAt,
        });
    }
    // Billing contact must be a selected Contact OF THAT Account (migration 025 accounts_billing_contact_on_account).
    const contactAccount = new Map(contacts.map((c) => [c.id, c.accountId]));
    const accountsOut = accounts.filter((a) => {
        if (a.billingContactId === null)
            return true;
        if (contactAccount.get(a.billingContactId) === a.id)
            return true;
        add("accounts", a.id, "BILLING_CONTACT_NOT_ON_ACCOUNT", "BLOCKING", "billingContact", `Contact ${a.billingContactId} is not a selected Contact of this Account`);
        return false;
    });
    if (accountsOut.length !== accounts.length) {
        // An Account dropped here orphans its children; they are reported, not silently copied without a parent.
        const dropped = new Set(accounts.filter((a) => !accountsOut.includes(a)).map((a) => a.id));
        for (let i = contacts.length - 1; i >= 0; i -= 1) {
            if (dropped.has(contacts[i].accountId)) {
                add("contacts", contacts[i].id, "ACCOUNT_REFERENCE_DANGLING", "BLOCKING", "accountId", `Account ${contacts[i].accountId} is blocked`);
                contacts.splice(i, 1);
            }
        }
        for (const id of dropped)
            accountIds.delete(id);
    }
    const primaries = new Map();
    for (const c of contacts)
        if (c.isPrimary)
            primaries.set(c.accountId, (primaries.get(c.accountId) ?? 0) + 1);
    for (const [accountId, n] of primaries) {
        if (n > 1)
            add("accounts", accountId, "MULTIPLE_PRIMARY_CONTACTS", "ADVISORY", null, `${n} Contacts are marked primary; uniqueness was never enforced and is not invented`);
    }
    // ──────────────── customer sites ────────────────
    const locations = [];
    for (const { d, blocked } of gate("locations", snapshot.locations)) {
        let bad = blocked;
        const accountId = parentOf("locations", d);
        const name = text("locations", d.id, "name", requiredName(d.data.name));
        const nested = d.data.address;
        const flat = { street: d.data.addressLine1, city: d.data.city, state: d.data.state, zip: d.data.zip };
        const hasFlat = Object.values(flat).some((v) => v !== undefined);
        let parts = [null, null, null, null];
        let nestedParts = null;
        if (nested !== undefined && nested !== null) {
            if (!isPlain(nested) || !Object.keys(nested).every((k) => ["street", "city", "state", "zip"].includes(k))) {
                add("locations", d.id, "FIELD_VALUE_INVALID", "BLOCKING", "address", "address must be { street, city, state, zip }");
                bad = true;
            }
            else {
                const read = ["street", "city", "state", "zip"].map((k) => optionalText(nested[k]));
                if (read.some((r) => !r.ok)) {
                    add("locations", d.id, "FIELD_VALUE_INVALID", "BLOCKING", "address", "every address part must be text or null");
                    bad = true;
                }
                else
                    nestedParts = read.map((r) => r.value);
            }
        }
        let flatParts = null;
        if (hasFlat) {
            const read = [flat.street, flat.city, flat.state, flat.zip].map((v) => optionalText(v));
            if (read.some((r) => !r.ok)) {
                add("locations", d.id, "FIELD_VALUE_INVALID", "BLOCKING", "addressLine1", "flat address parts must be text or null");
                bad = true;
            }
            else
                flatParts = read.map((r) => r.value);
        }
        if (nestedParts && flatParts) {
            addressShapes.both += 1;
            const conflict = ["street", "city", "state", "zip"].filter((_, i) => nestedParts[i] !== null && flatParts[i] !== null && nestedParts[i] !== flatParts[i]);
            if (conflict.length > 0) {
                add("locations", d.id, "ADDRESS_SHAPE_CONFLICT", "BLOCKING", "address", `nested and flat address parts disagree on ${conflict.join(", ")}; no precedence is chosen`);
                bad = true;
            }
            else
                parts = nestedParts.map((p, i) => p ?? flatParts[i]);
        }
        else if (nestedParts) {
            addressShapes.nested += 1;
            parts = nestedParts;
        }
        else if (flatParts) {
            addressShapes.flat += 1;
            parts = flatParts;
        }
        else if (!bad)
            addressShapes.absent += 1;
        const accessNotes = text("locations", d.id, "accessNotes", optionalText(d.data.accessNotes));
        const owner = readTypedOwner(d.data.owner);
        if (!owner.ok)
            add("locations", d.id, "OWNER_SHAPE_UNRECOGNISED", "BLOCKING", "owner", owner.reason);
        const at = instants("locations", d);
        if (bad || accountId === undefined || !owner.ok || at === null || name === undefined || accessNotes === undefined)
            continue;
        const siteOwner = childOwner("locations", d.id, accountId, owner.value);
        if (siteOwner === undefined)
            continue;
        locations.push({
            id: d.id, accountId, name, addressStreet: parts[0], addressCity: parts[1], addressState: parts[2], addressPostalCode: parts[3],
            accessNotes, ownerEmployeeId: siteOwner, createdAt: at.createdAt, updatedAt: at.updatedAt,
        });
    }
    const byFolded = new Map();
    for (const a of accountsOut)
        byFolded.set((0, customerIdentity_js_1.foldCustomerName)(a.name), [...(byFolded.get((0, customerIdentity_js_1.foldCustomerName)(a.name)) ?? []), a.id]);
    const duplicateFoldedNames = [...byFolded].filter(([, ids]) => ids.length > 1)
        .map(([foldedName, ids]) => ({ foldedName, accountIds: ids.sort(asciiSort) })).sort((a, b) => asciiSort(a.foldedName, b.foldedName));
    const byId = (xs) => xs.sort((a, b) => asciiSort(a.id, b.id));
    const crm = { accounts: byId(accountsOut), contacts: byId(contacts), locations: byId(locations) };
    // Ownership is counted over what is actually selected. A legacy OWNERLESS Account is carried, never filled in (ruling
    // D-6); a Contact or site is never ownerless (ruling 4: stated, or derived from its Account with evidence, or blocked).
    const owned = [
        ["accounts", crm.accounts], ["contacts", crm.contacts], ["locations", crm.locations],
    ];
    for (const [collection, records] of owned) {
        for (const r of records) {
            if (r.ownerEmployeeId === null) {
                ownerless[collection] += 1;
                add(collection, r.id, "OWNERLESS_LEGACY", "ADVISORY", collection === "accounts" ? "accountOwner" : "owner", "no owner stated; a legacy ownerless Account is carried as OWNERLESS, never filled in");
            }
            else
                ownerReferences[r.ownerEmployeeId] = (ownerReferences[r.ownerEmployeeId] ?? 0) + 1;
        }
    }
    const census = assembleCensus({
        source: snapshot.source, counts, excludedCount, crm, statusDistribution, timestampShapes, fieldPresence, addressShapes,
        billingAddressShapes, ownerReferences, ownerless, duplicateFoldedNames, findings,
        extraBlockers: ["OWNER_RESOLUTION_NOT_MEASURED"],
    });
    return {
        census,
        crm,
        evidence: {
            billingAddressResolution: billingAddressResolution.sort((a, b) => asciiSort(a.accountId, b.accountId)),
            ownerDerivations: ownerDerivations
                .filter((o) => (o.collection === "contacts" ? crm.contacts : crm.locations).some((r) => r.id === o.id))
                .sort((a, b) => asciiSort(`${a.collection}|${a.id}`, `${b.collection}|${b.id}`)),
            notMigratedValues: notMigratedValues.sort((a, b) => asciiSort(`${a.collection}|${a.id}|${a.field}`, `${b.collection}|${b.id}|${b.field}`)),
            certificationExcluded: certificationExcluded.sort((a, b) => asciiSort(`${a.collection}|${a.id}`, `${b.collection}|${b.id}`)),
            provenance: provenance.sort((a, b) => asciiSort(`${a.collection}|${a.id}`, `${b.collection}|${b.id}`)),
        },
    };
}
const SEVERITY_ORDER = (f) => `${f.severity === "BLOCKING" ? 0 : 1}|${f.collection}|${f.id}|${f.code}|${f.field ?? ""}`;
function assembleCensus(i) {
    const findings = [...i.findings].sort((a, b) => asciiSort(SEVERITY_ORDER(a), SEVERITY_ORDER(b)));
    const blockers = [...new Set([...findings.filter((f) => f.severity === "BLOCKING").map((f) => f.code), ...i.extraBlockers])].sort(asciiSort);
    return {
        source: i.source,
        counts: i.counts,
        certificationExcluded: i.excludedCount,
        selected: { accounts: i.crm.accounts.length, contacts: i.crm.contacts.length, locations: i.crm.locations.length },
        statusDistribution: sortedBag(i.statusDistribution),
        timestampShapes: i.timestampShapes,
        fieldPresence: {
            accounts: sortedBag(i.fieldPresence.accounts), contacts: sortedBag(i.fieldPresence.contacts), locations: sortedBag(i.fieldPresence.locations),
        },
        addressShapes: i.addressShapes,
        billingAddressShapes: i.billingAddressShapes,
        ownerReferences: sortedBag(i.ownerReferences),
        ownerless: i.ownerless,
        duplicateFoldedNames: i.duplicateFoldedNames,
        findings,
        blockers,
        copyReady: blockers.length === 0,
        canonicalDigest: canonicalCrmDigest(i.crm),
    };
}
/**
 * Fold PostgreSQL facts into a snapshot census: owners that do not resolve to a same-tenant Employee block (an owner is
 * never nulled, remapped or matched by name), and Commercial rows naming an Account that will not exist after the copy
 * block (the C6 Account dependency). Pure.
 */
function finalizeCrmCensus(result, facts) {
    const TARGET_CODES = ["OWNER_UNRESOLVED", "COMMERCIAL_ACCOUNT_REFERENCE_UNRESOLVABLE", "SYNTHETIC_ID_CONFLICT"];
    const findings = result.census.findings.filter((f) => !TARGET_CODES.includes(f.code));
    for (const [collection, records] of [["accounts", result.crm.accounts], ["contacts", result.crm.contacts], ["locations", result.crm.locations]]) {
        const declared = new Set(facts.declaredSyntheticIds?.[collection] ?? []);
        for (const r of records) {
            if (declared.has(r.id)) {
                findings.push({ collection, id: r.id, code: "SYNTHETIC_ID_CONFLICT", severity: "BLOCKING", field: null,
                    detail: "this source id is also declared by the synthetic nonprod seed manifest; synthetic acceptance rows and copied records must never share an id" });
            }
        }
    }
    const owned = [
        ["accounts", result.crm.accounts], ["contacts", result.crm.contacts], ["locations", result.crm.locations],
    ];
    for (const [collection, records] of owned) {
        for (const r of records) {
            if (r.ownerEmployeeId !== null && !facts.resolvableEmployeeIds.has(r.ownerEmployeeId)) {
                findings.push({ collection, id: r.id, code: "OWNER_UNRESOLVED", severity: "BLOCKING", field: "owner",
                    detail: `owner ${r.ownerEmployeeId} is not an Employee of the target tenant (eos_workforce.employees); it is never nulled, remapped or matched by uid or name` });
            }
        }
    }
    const afterCopy = new Set([...result.crm.accounts.map((a) => a.id), ...facts.existingAccountIds]);
    for (const ref of facts.commercialAccountIds) {
        if (!afterCopy.has(ref.accountId)) {
            findings.push({ collection: "accounts", id: ref.accountId, code: "COMMERCIAL_ACCOUNT_REFERENCE_UNRESOLVABLE", severity: "BLOCKING", field: null,
                detail: `${ref.table} names Account ${ref.accountId}, which neither the snapshot selection nor the tenant's eos_crm.accounts holds` });
        }
    }
    const c = result.census;
    const census = assembleCensus({
        source: c.source, counts: { ...c.counts }, excludedCount: { ...c.certificationExcluded }, crm: result.crm,
        statusDistribution: { ...c.statusDistribution }, timestampShapes: c.timestampShapes,
        fieldPresence: { accounts: { ...c.fieldPresence.accounts }, contacts: { ...c.fieldPresence.contacts }, locations: { ...c.fieldPresence.locations } },
        addressShapes: c.addressShapes, billingAddressShapes: c.billingAddressShapes, ownerReferences: { ...c.ownerReferences },
        ownerless: { ...c.ownerless }, duplicateFoldedNames: c.duplicateFoldedNames, findings, extraBlockers: [],
    });
    return { census, crm: result.crm, evidence: result.evidence };
}
//# sourceMappingURL=crmCutoverSnapshot.js.map