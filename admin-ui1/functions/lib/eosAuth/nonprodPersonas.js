"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NONPROD_PERSONA_SUBJECT_PREFIX = exports.isNonprodPersonaKey = exports.NONPROD_PERSONA_KEYS = void 0;
exports.nonprodPersonaSubject = nonprodPersonaSubject;
// THE 16 GOVERNED NONPROD PERSONA KEYS -- the ONLY identities the nonprod persona issuer can mint for.
//
// The authority is config/sandboxRoleIdentityRegistry.json (`roles[].key`); test/eosAuthNoFirebase.test.mjs
// pins this list to it, so the two cannot drift. It is a closed list in code rather than a runtime read of
// the registry because the service must not depend on a repository file outside its own build root, and
// because a closed list is what makes "no generic impersonation" a property of the code: there is no
// subject parameter anywhere in the issuer, only one of these keys.
//
// KEYS ONLY. No address, uid, password or Principal id lives here.
exports.NONPROD_PERSONA_KEYS = Object.freeze([
    "ownerExecutive",
    "generalManager",
    "officeManager",
    "administrator",
    "serviceManager",
    "dispatcher",
    "serviceTechnician",
    "partsAssociate",
    "partsManager",
    "warehouseAssociate",
    "warehouseManager",
    "retailSales",
    "nationalAccountsSales",
    "financeAccounting",
    "reportingAnalyst",
    "generalEmployee",
]);
const KEY_SET = new Set(exports.NONPROD_PERSONA_KEYS);
const isNonprodPersonaKey = (v) => typeof v === "string" && KEY_SET.has(v);
exports.isNonprodPersonaKey = isNonprodPersonaKey;
/** The prefix every persona EOS subject carries. A human EOS subject never uses it. */
exports.NONPROD_PERSONA_SUBJECT_PREFIX = "nonprod-persona.";
/**
 * The EOS subject of a persona: a PURE derivation, so the issuer needs no lookup table and the
 * binding table remains the only mapping from subject to Principal.
 */
function nonprodPersonaSubject(key) {
    if (!(0, exports.isNonprodPersonaKey)(key))
        throw new Error("not a governed nonprod persona key");
    return `${exports.NONPROD_PERSONA_SUBJECT_PREFIX}${key}`;
}
//# sourceMappingURL=nonprodPersonas.js.map