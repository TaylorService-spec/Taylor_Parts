"use strict";
// EOS Ownership Model v1 — the TYPED OWNER shape and its derivations, trusted-side mirror of the
// client authority field-ops-app-vite/src/domain/typedOwner.js (Owner rulings D-1/D-2/D-3,
// 2026-08-30). See that file's header for the reasoning: why this composes rather than replaces
// the existing authorities, why the `USER` id namespace is the canonical Employee id (open item
// O-1), and which adjacent authorities are deliberately NOT read here.
//
// INERT, DERIVED, READ-NORMALIZED. No setter, no writer, no persistence. Parity with the client
// mirror is asserted by test/typedOwner.test.mjs against the same canonical case table.
Object.defineProperty(exports, "__esModule", { value: true });
exports.OWNERSHIP_RESOLUTION = exports.OWNER_TYPES = void 0;
exports.isTypedOwner = isTypedOwner;
exports.typedOwner = typedOwner;
exports.deriveAccountOwner = deriveAccountOwner;
exports.deriveEmployeeRefOwner = deriveEmployeeRefOwner;
exports.deriveCompanyOwner = deriveCompanyOwner;
exports.combineOwnerDerivations = combineOwnerDerivations;
exports.deriveStoredOwner = deriveStoredOwner;
const operatingCompanyAuthority_js_1 = require("./operatingCompanyAuthority.js");
exports.OWNER_TYPES = {
    USER: "USER",
    COMPANY: "COMPANY",
};
/** See the client mirror for why these four states, and why UNRESOLVED and OWNERLESS stay apart. */
exports.OWNERSHIP_RESOLUTION = {
    RESOLVED: "RESOLVED",
    UNRESOLVED: "UNRESOLVED",
    AMBIGUOUS: "AMBIGUOUS",
    OWNERLESS: "OWNERLESS",
};
const nonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
/** Shape guard. A typed owner is exactly two fields — extra keys are rejected. */
function isTypedOwner(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return false;
    const v = value;
    const keys = Object.keys(v);
    if (keys.length !== 2 || !keys.includes("type") || !keys.includes("id"))
        return false;
    if (v.type === exports.OWNER_TYPES.USER)
        return nonEmptyString(v.id);
    if (v.type === exports.OWNER_TYPES.COMPANY)
        return (0, operatingCompanyAuthority_js_1.isOperatingCompanyIdShape)(v.id);
    return false;
}
/** The only constructor. Returns null when the inputs do not describe a typed owner. */
function typedOwner(type, id) {
    const candidate = { type, id: typeof id === "string" ? id.trim() : id };
    return isTypedOwner(candidate) ? Object.freeze(candidate) : null;
}
const outcome = (resolution, owner, reason, code) => ({
    resolution,
    owner,
    reason: reason ?? null,
    code: code ?? null,
});
/**
 * Account -> typed owner, projected from the EXISTING accountOwner map. Requires only the
 * assignee half: the seven-field completeness invariant governs WRITES, and holding a read to it
 * would miscount a legitimately-owned legacy Account as ownerless.
 */
function deriveAccountOwner(accountDoc) {
    const map = accountDoc?.accountOwner;
    if (map === null || map === undefined)
        return outcome(exports.OWNERSHIP_RESOLUTION.OWNERLESS, null, "no accountOwner");
    if (typeof map !== "object" || Array.isArray(map)) {
        return outcome(exports.OWNERSHIP_RESOLUTION.UNRESOLVED, null, "accountOwner is not a map", "INVALID");
    }
    const employeeId = map.assignedToEmployeeId;
    if (!nonEmptyString(employeeId)) {
        return outcome(exports.OWNERSHIP_RESOLUTION.UNRESOLVED, null, "accountOwner has no assignedToEmployeeId", "INVALID");
    }
    const owner = typedOwner(exports.OWNER_TYPES.USER, employeeId);
    return owner === null
        ? outcome(exports.OWNERSHIP_RESOLUTION.UNRESOLVED, null, "assignedToEmployeeId is not a usable id", "INVALID")
        : outcome(exports.OWNERSHIP_RESOLUTION.RESOLVED, owner);
}
/** Opportunity / Sales Order / Sales Agreement -> typed owner, projected from ownerEmployeeId. */
function deriveEmployeeRefOwner(doc, field = "ownerEmployeeId") {
    const value = doc?.[field];
    if (value === null || value === undefined)
        return outcome(exports.OWNERSHIP_RESOLUTION.OWNERLESS, null, `no ${field}`);
    if (!nonEmptyString(value)) {
        return outcome(exports.OWNERSHIP_RESOLUTION.UNRESOLVED, null, `${field} is empty or not a string`, "INVALID");
    }
    const owner = typedOwner(exports.OWNER_TYPES.USER, value);
    return owner === null
        ? outcome(exports.OWNERSHIP_RESOLUTION.UNRESOLVED, null, `${field} is not a usable id`, "INVALID")
        : outcome(exports.OWNERSHIP_RESOLUTION.RESOLVED, owner);
}
/**
 * A company-owned record -> typed owner. INACTIVE resolves: a record owned by a since-deactivated
 * company still HAS an owner, and calling it unresolved would invite a backfill to reassign it.
 */
function deriveCompanyOwner(doc, field = "operatingCompanyId") {
    const value = doc?.[field];
    if (value === null || value === undefined)
        return outcome(exports.OWNERSHIP_RESOLUTION.OWNERLESS, null, `no ${field}`);
    const { state } = (0, operatingCompanyAuthority_js_1.resolveOperatingCompany)(value);
    if (state === "INVALID")
        return outcome(exports.OWNERSHIP_RESOLUTION.UNRESOLVED, null, `${field} is malformed`, "INVALID");
    if (state === "UNKNOWN")
        return outcome(exports.OWNERSHIP_RESOLUTION.UNRESOLVED, null, `${field} names no seeded company`, "UNKNOWN");
    const owner = typedOwner(exports.OWNER_TYPES.COMPANY, value);
    return owner === null
        ? outcome(exports.OWNERSHIP_RESOLUTION.UNRESOLVED, null, `${field} is not a usable id`, "INVALID")
        : outcome(exports.OWNERSHIP_RESOLUTION.RESOLVED, owner);
}
/**
 * Combine the derivations that apply to one record. AMBIGUOUS when two RESOLVE to different
 * owners — the ruling forbids silently picking one. A single UNRESOLVED beside a RESOLVED is not
 * ambiguity: one field is broken, the other answers, and the broken one is still named.
 */
function combineOwnerDerivations(outcomes) {
    const list = (outcomes ?? []).filter((o) => Boolean(o));
    if (list.length === 0)
        return outcome(exports.OWNERSHIP_RESOLUTION.OWNERLESS, null, "no ownership-bearing field");
    const resolved = list.filter((o) => o.resolution === exports.OWNERSHIP_RESOLUTION.RESOLVED);
    const distinct = new Set(resolved.map((o) => `${o.owner.type}:${o.owner.id}`));
    if (distinct.size > 1) {
        return outcome(exports.OWNERSHIP_RESOLUTION.AMBIGUOUS, null, `conflicting owners: ${[...distinct].sort().join(", ")}`);
    }
    if (resolved.length > 0) {
        const broken = list
            .filter((o) => o.resolution === exports.OWNERSHIP_RESOLUTION.UNRESOLVED)
            .map((o) => o.reason)
            .filter((r) => Boolean(r));
        return outcome(exports.OWNERSHIP_RESOLUTION.RESOLVED, resolved[0].owner, broken.length > 0 ? broken.join("; ") : undefined);
    }
    const unresolved = list.filter((o) => o.resolution === exports.OWNERSHIP_RESOLUTION.UNRESOLVED);
    if (unresolved.length > 0) {
        // INVALID wins over UNKNOWN when a record manages both: a broken value is the more urgent fact,
        // and reporting it as merely unrecognised would understate the repair needed.
        const code = unresolved.some((o) => o.code === "INVALID")
            ? "INVALID"
            : (unresolved[0].code ?? "INVALID");
        return outcome(exports.OWNERSHIP_RESOLUTION.UNRESOLVED, null, unresolved.map((o) => o.reason).filter(Boolean).join("; "), code);
    }
    const reasons = list.map((o) => o.reason).filter((r) => Boolean(r));
    return outcome(exports.OWNERSHIP_RESOLUTION.OWNERLESS, null, reasons.length > 0 ? reasons.join("; ") : undefined);
}
/**
 * A record that stores an already-typed `owner` map -- the shape the backfill writes.
 *
 * Added when the sandbox backfill exposed the gap: the applier wrote `owner`, and the census kept
 * reporting those records OWNERLESS because no derivation could read the field. The matrix declares
 * where ownership is STORED, and a projection that cannot read its own storage makes the census
 * describe a backlog that no longer exists.
 *
 * A stored owner is held to the SAME shape guard as a constructed one: a malformed map is INVALID,
 * never quietly accepted because it happens to be persisted.
 */
function deriveStoredOwner(doc, field = "owner") {
    const value = doc?.[field];
    if (value === null || value === undefined)
        return outcome(exports.OWNERSHIP_RESOLUTION.OWNERLESS, null, `no ${field}`);
    if (!isTypedOwner(value)) {
        return outcome(exports.OWNERSHIP_RESOLUTION.UNRESOLVED, null, `${field} is not a typed owner`, "INVALID");
    }
    // A COMPANY owner must still name a governed company -- storage does not confer governance.
    if (value.type === exports.OWNER_TYPES.COMPANY && (0, operatingCompanyAuthority_js_1.resolveOperatingCompany)(value.id).company === null) {
        return outcome(exports.OWNERSHIP_RESOLUTION.UNRESOLVED, null, `${field} names no governed company`, "UNKNOWN");
    }
    return outcome(exports.OWNERSHIP_RESOLUTION.RESOLVED, value);
}
//# sourceMappingURL=typedOwner.js.map