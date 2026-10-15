"use strict";
// EOS Commercial Data Plane — the PURE ownership authority for the three PERSON-owned commercial
// records, and the reconciliation that says whether a Firestore document may become a PostgreSQL
// row (migration 008).
//
// NO I/O. No Firestore, no `pg`, no `firebase-admin`, no `firebase-functions`. Everything here is a
// function of its arguments, which is why it can be tested without a database and without an
// emulator, and why it can be reused unchanged by a governed command, by a reconciliation report,
// and by the repository.
//
// ════════════════════ WHAT THIS ADDS, AND WHAT IT REFUSES TO RESTATE ════════════════════
//
// It adds exactly one thing: the PostgreSQL-side shape of a commercial record's ownership and
// company authority, and the rules for moving that ownership.
//
// It restates nothing. In particular it does NOT re-derive who the owner should be — that is
// ownership/creationOwnerResolution.ts (ruling D-4), which already encodes "explicit, else inherit
// the governed upstream, else REFUSE" and the six forbidden fallbacks. A second copy of that
// resolver here would be a second authority, and the only thing two authorities can do that one
// cannot is disagree. This module takes the owner the governed resolver produced and enforces what
// the STORE must be able to say about it.
//
// Nor does it re-declare the operating companies: `resolveOperatingCompany` in
// ownership/operatingCompanyAuthority.ts is the authority for `taylor | ventana`, and it is called,
// not mirrored.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_RECONCILIATION_SAMPLES = exports.CommercialOwnershipError = exports.MAX_HANDOFF_REASON_LENGTH = exports.COMMERCIAL_HANDOFF_SOURCES = exports.COMPANY_REQUIRED_KINDS = exports.COMMERCIAL_TABLE_BY_KIND = exports.COMMERCIAL_FAMILY_BY_KIND = exports.COMMERCIAL_RECORD_KINDS = void 0;
exports.isCommercialRecordKind = isCommercialRecordKind;
exports.isCommercialHandoffSource = isCommercialHandoffSource;
exports.assertFamilyIsGovernedHere = assertFamilyIsGovernedHere;
exports.buildCommercialOwnershipRow = buildCommercialOwnershipRow;
exports.normalizeOperatingCompany = normalizeOperatingCompany;
exports.buildCommercialHandoff = buildCommercialHandoff;
exports.reconcileCommercialDocument = reconcileCommercialDocument;
exports.reconcileCommercialFamily = reconcileCommercialFamily;
const typedOwner_1 = require("../ownership/typedOwner");
const operatingCompanyAuthority_1 = require("../ownership/operatingCompanyAuthority");
const ownershipMatrix_1 = require("../ownership/ownershipMatrix");
/**
 * The three commercial families migration 008 gives a table. These are exactly the rows
 * ownershipMatrix.ts classifies `ownerClass: "PERSON"` in the commercial chain, and they are
 * cross-checked against the matrix by `assertFamilyIsGovernedHere` below rather than trusted.
 *
 * `salesTerritory` is ABSENT, and that absence is a ruling rather than an omission: the matrix
 * classifies it EXCLUDED ("coverage is not ownership, credit, commission or security",
 * ownershipMatrix.ts:452). It is a real, built object -- coverage/coverageCallables.ts writes it
 * through a governed command -- but it has no owner to enforce, so there is nothing for this
 * module to hold. See the migration header.
 */
exports.COMMERCIAL_RECORD_KINDS = ["OPPORTUNITY", "SALES_AGREEMENT", "SALES_ORDER"];
/** kind -> the ownership-matrix family key, so the two vocabularies cannot drift apart silently. */
exports.COMMERCIAL_FAMILY_BY_KIND = Object.freeze({
    OPPORTUNITY: "opportunity",
    SALES_AGREEMENT: "salesAgreement",
    SALES_ORDER: "salesOrder",
});
/** kind -> the eos_commercial table. The Firestore collection name is NOT restated here. */
exports.COMMERCIAL_TABLE_BY_KIND = Object.freeze({
    OPPORTUNITY: "opportunities",
    SALES_AGREEMENT: "sales_agreements",
    SALES_ORDER: "sales_orders",
});
/**
 * Which kinds the STORE refuses without an operating company, mirroring what the governed commands
 * already refuse rather than tightening it.
 *
 *   SALES_ORDER        salesOrderCommands.ts:274-285 throws COMPANY_REQUIRED at creation.
 *   SALES_AGREEMENT    salesAgreementCommands.ts:354-361 throws only at ACCEPT, not at draft.
 *   OPPORTUNITY        opportunityCommands.ts:175 resolves to a nullable value by design.
 *
 * Only the Sales Order is unconditionally required, because only its requirement is unconditional.
 * An Agreement's is conditional on a lifecycle state this schema deliberately does not hold, so the
 * command stays the authority on when it must be filled -- the store would otherwise reject drafts
 * the governed path accepts, and the disagreement would surface at cutover.
 */
exports.COMPANY_REQUIRED_KINDS = Object.freeze(["SALES_ORDER"]);
/** Mirrors OWNERSHIP_HANDOFF_SOURCES (access/auditEventWriter.ts:429-433) and the SQL enum. */
exports.COMMERCIAL_HANDOFF_SOURCES = [
    "DIRECT_HANDOFF",
    "CUSTOMER_HANDOFF_REVIEW",
    "ADMIN_CORRECTION",
];
/** The audit writer's ceiling (auditEventWriter.ts:438), so a reason this accepts it also accepts. */
exports.MAX_HANDOFF_REASON_LENGTH = 500;
class CommercialOwnershipError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "CommercialOwnershipError";
    }
}
exports.CommercialOwnershipError = CommercialOwnershipError;
const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
function isCommercialRecordKind(value) {
    return typeof value === "string" && exports.COMMERCIAL_RECORD_KINDS.includes(value);
}
function isCommercialHandoffSource(value) {
    return typeof value === "string" && exports.COMMERCIAL_HANDOFF_SOURCES.includes(value);
}
/**
 * The matrix is the authority, not this file's constant list. If a family this module claims is
 * PERSON-owned and transferable were ever reclassified, this throws instead of quietly writing rows
 * under a rule that no longer holds.
 */
function assertFamilyIsGovernedHere(kind) {
    const family = (0, ownershipMatrix_1.ownershipFamily)(exports.COMMERCIAL_FAMILY_BY_KIND[kind]);
    if (family === null) {
        throw new CommercialOwnershipError("FAMILY_UNKNOWN", `${kind} names no ownership-matrix family`);
    }
    if (family.ownerClass !== "PERSON" || family.ownerType !== typedOwner_1.OWNER_TYPES.USER) {
        throw new CommercialOwnershipError("FAMILY_NOT_PERSON_OWNED", `${kind} is ${family.ownerClass}/${String(family.ownerType)} in the ownership matrix -- ` +
            "eos_commercial holds an employee owner and cannot represent it");
    }
    if (family.transfer !== "HANDOFF") {
        throw new CommercialOwnershipError("FAMILY_NOT_TRANSFERABLE", `${kind} is transfer=${family.transfer} in the ownership matrix -- historical ownership remains`);
    }
}
/**
 * Validate-and-normalize. Every refusal here is a refusal the database would also make -- this is
 * the readable half of the same rule, not a substitute for it, which is why the PostgreSQL suite
 * proves each one against a real server as well.
 */
function buildCommercialOwnershipRow(input) {
    if (!isCommercialRecordKind(input?.kind)) {
        throw new CommercialOwnershipError("KIND_INVALID", "kind must be one of " + exports.COMMERCIAL_RECORD_KINDS.join(", "));
    }
    assertFamilyIsGovernedHere(input.kind);
    if (!nonEmpty(input.recordNumber)) {
        throw new CommercialOwnershipError("NUMBER_REQUIRED", "the canonical record number is required");
    }
    if (!nonEmpty(input.accountId)) {
        throw new CommercialOwnershipError("ACCOUNT_REQUIRED", "accountId is required -- the Customer is the governed upstream a missing owner is inherited from");
    }
    // RULING 1, and the reason it is a refusal rather than a default: an owner picked here would be
    // indistinguishable afterwards from one a person assigned. See creationOwnerResolution.ts:20-24.
    if (!nonEmpty(input.ownerEmployeeId)) {
        throw new CommercialOwnershipError("OWNER_REQUIRED", "ownerEmployeeId is required and is never defaulted, inferred or manufactured -- " +
            "resolve it through creationOwnerResolution before writing");
    }
    if (!nonEmpty(input.createdBy)) {
        throw new CommercialOwnershipError("CREATED_BY_REQUIRED", "createdBy is required");
    }
    const company = normalizeOperatingCompany(input.kind, input.operatingCompanyId);
    if (input.kind === "OPPORTUNITY" && (nonEmpty(input.opportunityId) || nonEmpty(input.salesAgreementId))) {
        throw new CommercialOwnershipError("LINEAGE_INVALID", "an Opportunity is the head of the commercial chain and has no commercial upstream");
    }
    if (input.kind === "SALES_AGREEMENT" && nonEmpty(input.salesAgreementId)) {
        throw new CommercialOwnershipError("LINEAGE_INVALID", "a Sales Agreement has no Sales Agreement upstream");
    }
    return Object.freeze({
        kind: input.kind,
        recordNumber: input.recordNumber.trim(),
        accountId: input.accountId.trim(),
        ownerEmployeeId: input.ownerEmployeeId.trim(),
        operatingCompanyKey: company,
        createdBy: input.createdBy.trim(),
        opportunityId: nonEmpty(input.opportunityId) ? input.opportunityId.trim() : null,
        salesAgreementId: nonEmpty(input.salesAgreementId) ? input.salesAgreementId.trim() : null,
    });
}
/**
 * `operatingCompanyId` is never inferred (R-14/R-15, ownership/commercialCompanyScope.ts:14-19). A
 * supplied value must be a governed company; an absent one is refused only where the command
 * refuses it.
 */
function normalizeOperatingCompany(kind, operatingCompanyId) {
    if (!nonEmpty(operatingCompanyId)) {
        if (exports.COMPANY_REQUIRED_KINDS.includes(kind)) {
            throw new CommercialOwnershipError("COMPANY_REQUIRED", "a Sales Order is a commercial commitment and requires a governed operatingCompanyId");
        }
        return null;
    }
    const resolution = (0, operatingCompanyAuthority_1.resolveOperatingCompany)(operatingCompanyId.trim());
    if (resolution.state === "INVALID" || resolution.state === "UNKNOWN") {
        throw new CommercialOwnershipError("COMPANY_UNGOVERNED", `operatingCompanyId ${JSON.stringify(operatingCompanyId)} is not a governed operating company`);
    }
    // INACTIVE passes, exactly as commercialCompanyScope.ts:64-67 lets it pass: a company that has
    // stopped trading still owns the records it wrote.
    return operatingCompanyId.trim();
}
/**
 * RULING 4 (negotiated transfer is allowed) and RULING 5 (historical ownership remains) are the same
 * event seen from two sides, so they are validated in one place:
 *
 *   - the family must be transfer=HANDOFF in the matrix (an IMMUTABLE family is refused);
 *   - a no-op is refused, because a handoff that moves nothing is not a negotiation;
 *   - ONE record, never a list. There is no cascade parameter and no children flag
 *     (ownershipHandoffCommand.ts:25-30). Handing off an Opportunity leaves its Sales Orders where
 *     they were -- moving one is a separate row.
 *
 * RULING 6 (future sales follow the new owner) needs nothing here, and that is the point: it is
 * satisfied by the record's CURRENT owner column being the thing creationOwnerResolution inherits
 * from. Once the column moves, tomorrow's records inherit the new owner; yesterday's do not move,
 * which is ruling 5 again.
 */
function buildCommercialHandoff(input) {
    if (!isCommercialRecordKind(input?.kind)) {
        throw new CommercialOwnershipError("KIND_INVALID", "kind must be one of " + exports.COMMERCIAL_RECORD_KINDS.join(", "));
    }
    assertFamilyIsGovernedHere(input.kind);
    if (!nonEmpty(input.recordId)) {
        throw new CommercialOwnershipError("RECORD_REQUIRED", "recordId is required");
    }
    if (!nonEmpty(input.newOwnerEmployeeId)) {
        throw new CommercialOwnershipError("OWNER_REQUIRED", "newOwnerEmployeeId is required");
    }
    if (input.previousOwnerEmployeeId !== null && !nonEmpty(input.previousOwnerEmployeeId)) {
        throw new CommercialOwnershipError("PREVIOUS_OWNER_INVALID", "previousOwnerEmployeeId is an employee id or null -- null means the record genuinely had none, " +
            "and an empty string is not a way of saying that");
    }
    const previous = input.previousOwnerEmployeeId === null ? null : input.previousOwnerEmployeeId.trim();
    const next = input.newOwnerEmployeeId.trim();
    if (previous === next) {
        throw new CommercialOwnershipError("HANDOFF_NO_OP", "the record is already owned by that employee -- a no-op is not a handoff");
    }
    if (!isCommercialHandoffSource(input.source)) {
        throw new CommercialOwnershipError("SOURCE_INVALID", "source must be one of " + exports.COMMERCIAL_HANDOFF_SOURCES.join(", "));
    }
    const reason = nonEmpty(input.reason) ? input.reason.trim() : null;
    if (reason !== null && reason.length > exports.MAX_HANDOFF_REASON_LENGTH) {
        throw new CommercialOwnershipError("REASON_TOO_LONG", `reason must be at most ${exports.MAX_HANDOFF_REASON_LENGTH} characters`);
    }
    return Object.freeze({
        kind: input.kind,
        recordId: input.recordId.trim(),
        previousOwnerEmployeeId: previous,
        newOwnerEmployeeId: next,
        source: input.source,
        reason,
    });
}
exports.MAX_RECONCILIATION_SAMPLES = 10;
function reconcileCommercialDocument(kind, doc) {
    const data = doc?.data ?? {};
    const ownerDerivation = (0, typedOwner_1.deriveEmployeeRefOwner)(data);
    if (ownerDerivation.resolution !== typedOwner_1.OWNERSHIP_RESOLUTION.RESOLVED) {
        return {
            id: doc.id,
            kind,
            verdict: "OWNERLESS",
            reason: ownerDerivation.reason ?? "no governed owner could be derived",
        };
    }
    if (!nonEmpty(data.accountId)) {
        return { id: doc.id, kind, verdict: "ACCOUNT_MISSING", reason: "accountId is absent" };
    }
    try {
        normalizeOperatingCompany(kind, data.operatingCompanyId);
    }
    catch (err) {
        const code = err instanceof CommercialOwnershipError ? err.code : "COMPANY_UNGOVERNED";
        return {
            id: doc.id,
            kind,
            verdict: code === "COMPANY_REQUIRED" ? "COMPANY_MISSING" : "COMPANY_UNGOVERNED",
            reason: err instanceof Error ? err.message : String(err),
        };
    }
    return { id: doc.id, kind, verdict: "READY", reason: null };
}
function reconcileCommercialFamily(kind, docs) {
    assertFamilyIsGovernedHere(kind);
    const verdicts = {};
    const blockedSamples = [];
    let ready = 0;
    for (const doc of docs) {
        const row = reconcileCommercialDocument(kind, doc);
        verdicts[row.verdict] = (verdicts[row.verdict] ?? 0) + 1;
        if (row.verdict === "READY") {
            ready += 1;
        }
        else if (blockedSamples.length < exports.MAX_RECONCILIATION_SAMPLES) {
            blockedSamples.push(row);
        }
    }
    return {
        kind,
        table: exports.COMMERCIAL_TABLE_BY_KIND[kind],
        scanned: docs.length,
        ready,
        blocked: docs.length - ready,
        verdicts,
        blockedSamples,
    };
}
//# sourceMappingURL=commercialOwnershipAuthority.js.map