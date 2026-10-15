"use strict";
// CERT-FIN-02 -- the trusted command service for a company's financial policy profile.
//
// Admin-SDK only. `financial_policy_profiles` has NO firestore.rules match block, so it is DENY-ALL
// to every client including admin -- the same posture `bins`, `bin_code_claims` and `part_aliases`
// use, and the reason this needed no Rules change at all. A callable runs on the Admin SDK, which
// Rules do not govern; there is deliberately no client-direct write path to smuggle configuration
// authority through.
//
// ============================ THE LOCK IS ENFORCED HERE, NOT IN THE UI ============================
//
// The screen disables its controls when a profile is LOCKED. That is a courtesy to the operator and
// it is not the rule. EVERY write in this module re-reads the stored status INSIDE the transaction
// and calls assertProfileMutable before staging anything, so a crafted request, a stale tab, a
// replayed call or a direct callable invocation all hit the same refusal. A test asserts exactly
// that: a locked profile refuses a well-formed configure request from an authorized principal.
//
// There is no unlock command, no force flag and no admin bypass. Admin can do most operational
// things in EOS; it deliberately cannot do this one. Coming back from LOCKED is an accounting-policy
// migration -- approval, effective date, impact assessment, conversion, activation -- and that does
// not exist. Adding a `--force` here would be building the dangerous half of it and none of the safe
// half.
//
// ============================ WHAT IT DOES NOT DO ============================
//
// It never touches an acquisition-cost fact. Selecting or changing a policy must not mutate the
// historical facts the policy is applied TO -- that is the whole point of keeping the two apart, and
// this module imports nothing that can write one.
Object.defineProperty(exports, "__esModule", { value: true });
exports.FINANCIAL_POLICY_PROFILES_COLLECTION = void 0;
exports.financialPolicyProfileDocId = financialPolicyProfileDocId;
exports.deserializeStoredProfile = deserializeStoredProfile;
exports.configureFinancialPolicyProfile = configureFinancialPolicyProfile;
exports.activateFinancialPolicyProfile = activateFinancialPolicyProfile;
exports.readFinancialPolicyProfile = readFinancialPolicyProfile;
const firestore_1 = require("firebase-admin/firestore");
const financialPolicyProfile_js_1 = require("./financialPolicyProfile.js");
exports.FINANCIAL_POLICY_PROFILES_COLLECTION = "financial_policy_profiles";
/** One profile per operating company. The company IS the identity -- there is no second profile. */
function financialPolicyProfileDocId(operatingCompanyId) {
    return operatingCompanyId;
}
const STORED_KEYS = new Set([
    "operatingCompanyId",
    "status",
    "inventoryCostMethod",
    "serializedInventoryCostMethod",
    "cogsRecognitionPointId",
    "freightTreatment",
    "landedCostTreatment",
    "approval",
    "version",
    "updatedAt",
    "updatedByUid",
]);
/**
 * Read a stored profile back, fail-closed. A stored document that does not satisfy the current
 * contract is refused rather than normalized into validity -- the same posture the operational
 * ledger's deserializer takes.
 */
function deserializeStoredProfile(data) {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new financialPolicyProfile_js_1.FinancialPolicyError("PROFILE_MALFORMED", "stored financial policy is not an object");
    }
    const d = data;
    const unknownKey = Object.keys(d).find((k) => !STORED_KEYS.has(k));
    if (unknownKey !== undefined) {
        throw new financialPolicyProfile_js_1.FinancialPolicyError("PROFILE_MALFORMED", `stored financial policy has unknown field: ${unknownKey}`);
    }
    const { version, updatedAt, updatedByUid, ...policy } = d;
    if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
        throw new financialPolicyProfile_js_1.FinancialPolicyError("PROFILE_MALFORMED", "stored financial policy has an invalid version");
    }
    if (typeof updatedByUid !== "string" || updatedByUid.trim() === "") {
        throw new financialPolicyProfile_js_1.FinancialPolicyError("PROFILE_MALFORMED", "stored financial policy has no updatedByUid");
    }
    // A LOCKED stored profile must still be READABLE -- validate() refuses an unavailable recognition
    // point, and a point could become unavailable after a profile was locked under it. Reading history
    // is not configuring it, so the lock path deserializes without re-running availability.
    const validated = validateStoredPolicyShape(policy);
    const millis = updatedAt instanceof firestore_1.Timestamp
        ? updatedAt.toDate().getTime()
        : (() => {
            throw new financialPolicyProfile_js_1.FinancialPolicyError("PROFILE_MALFORMED", "stored updatedAt is not a server Timestamp");
        })();
    return Object.freeze({ ...validated, version, updatedAtMillis: millis, updatedByUid });
}
/**
 * Shape-validate a STORED policy without the "is this recognition point still available today"
 * check. See deserializeStoredProfile -- a locked historical choice must remain readable even if the
 * platform later withdraws that option, and refusing to read it would be worse than reading it.
 */
function validateStoredPolicyShape(policy) {
    try {
        return (0, financialPolicyProfile_js_1.validateFinancialPolicyProfile)(policy);
    }
    catch (err) {
        if (err instanceof financialPolicyProfile_js_1.FinancialPolicyError && err.code === "RECOGNITION_UNAVAILABLE") {
            // Re-validate with the availability gate lifted by substituting a currently-available point,
            // then restore the stored id, so the shape is still fully checked.
            const probe = (0, financialPolicyProfile_js_1.validateFinancialPolicyProfile)({ ...policy, cogsRecognitionPointId: "INVOICE_ISSUE" });
            return Object.freeze({ ...probe, cogsRecognitionPointId: String(policy.cogsRecognitionPointId) });
        }
        throw err;
    }
}
function serialize(profile, version, deps) {
    return {
        operatingCompanyId: profile.operatingCompanyId,
        status: profile.status,
        inventoryCostMethod: profile.inventoryCostMethod,
        serializedInventoryCostMethod: profile.serializedInventoryCostMethod,
        cogsRecognitionPointId: profile.cogsRecognitionPointId,
        freightTreatment: profile.freightTreatment,
        landedCostTreatment: profile.landedCostTreatment,
        approval: profile.approval === null ? null : { ...profile.approval },
        version,
        updatedAt: firestore_1.Timestamp.fromDate(deps.now),
        updatedByUid: deps.actorUid,
    };
}
async function readStored(txn, db, operatingCompanyId) {
    const ref = db.collection(exports.FINANCIAL_POLICY_PROFILES_COLLECTION).doc(financialPolicyProfileDocId(operatingCompanyId));
    const snap = await txn.get(ref);
    return snap.exists ? deserializeStoredProfile(snap.data() ?? {}) : null;
}
/**
 * Configure (create or replace) a company's DRAFT/APPROVED financial policy.
 *
 * The stored status is re-read inside the transaction and the lock re-checked there, so a profile
 * locked between the operator opening the screen and pressing save is still refused.
 */
async function configureFinancialPolicyProfile(request, deps) {
    const desired = (0, financialPolicyProfile_js_1.validateFinancialPolicyProfile)(request);
    if (desired.status === "LOCKED") {
        throw new financialPolicyProfile_js_1.FinancialPolicyError("TRANSITION_ILLEGAL", "activation is not an ordinary configuration write -- use activateFinancialPolicyProfile");
    }
    return deps.db.runTransaction(async (txn) => {
        const stored = await readStored(txn, deps.db, desired.operatingCompanyId);
        (0, financialPolicyProfile_js_1.assertProfileMutable)(stored);
        if (stored !== null && !(0, financialPolicyProfile_js_1.isLegalTransition)(stored.status, desired.status) && stored.status !== desired.status) {
            throw new financialPolicyProfile_js_1.FinancialPolicyError("TRANSITION_ILLEGAL", `a ${stored.status} financial policy cannot become ${desired.status}`);
        }
        const version = (stored?.version ?? 0) + 1;
        const ref = deps.db
            .collection(exports.FINANCIAL_POLICY_PROFILES_COLLECTION)
            .doc(financialPolicyProfileDocId(desired.operatingCompanyId));
        const data = serialize(desired, version, deps);
        txn.set(ref, data);
        return {
            outcome: "applied",
            profile: Object.freeze({
                ...desired,
                version,
                updatedAtMillis: deps.now.getTime(),
                updatedByUid: deps.actorUid,
            }),
        };
    });
}
/**
 * Activate: APPROVED -> LOCKED. The one-way door.
 *
 * Idempotent by state rather than by a key: activating an already-LOCKED profile reports `unchanged`
 * instead of throwing, because a retried activation is not an attempt to edit a locked policy. Every
 * OTHER path into a locked profile still refuses.
 */
async function activateFinancialPolicyProfile(input, deps) {
    const companyId = typeof input?.operatingCompanyId === "string" ? input.operatingCompanyId.trim() : "";
    if (companyId === "") {
        throw new financialPolicyProfile_js_1.FinancialPolicyError("COMPANY_REQUIRED", "activation names exactly one operating company");
    }
    return deps.db.runTransaction(async (txn) => {
        const stored = await readStored(txn, deps.db, companyId);
        if (stored === null) {
            throw new financialPolicyProfile_js_1.FinancialPolicyError("PROFILE_MALFORMED", "no financial policy profile exists for this operating company");
        }
        if (stored.status === "LOCKED") {
            return { outcome: "unchanged", profile: stored };
        }
        if (!(0, financialPolicyProfile_js_1.isLegalTransition)(stored.status, "LOCKED")) {
            throw new financialPolicyProfile_js_1.FinancialPolicyError("TRANSITION_ILLEGAL", `a ${stored.status} financial policy cannot be activated -- accounting approval must be recorded first`);
        }
        if (stored.approval === null) {
            throw new financialPolicyProfile_js_1.FinancialPolicyError("APPROVAL_REQUIRED", "activation requires recorded accounting approval");
        }
        const locked = { ...stored, status: "LOCKED" };
        const version = stored.version + 1;
        const ref = deps.db.collection(exports.FINANCIAL_POLICY_PROFILES_COLLECTION).doc(financialPolicyProfileDocId(companyId));
        txn.set(ref, serialize(locked, version, deps));
        return {
            outcome: "applied",
            profile: Object.freeze({ ...locked, version, updatedAtMillis: deps.now.getTime(), updatedByUid: deps.actorUid }),
        };
    });
}
/** Read one company's profile. Returns null when none is configured -- never a fabricated default. */
async function readFinancialPolicyProfile(operatingCompanyId, db) {
    const snap = await db
        .collection(exports.FINANCIAL_POLICY_PROFILES_COLLECTION)
        .doc(financialPolicyProfileDocId(operatingCompanyId))
        .get();
    return snap.exists ? deserializeStoredProfile(snap.data() ?? {}) : null;
}
//# sourceMappingURL=financialPolicyProfileCommand.js.map