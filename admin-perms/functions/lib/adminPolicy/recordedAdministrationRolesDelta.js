"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPERATIONAL_CONFIGURATION_ADMINISTRATOR_ROLE = exports.COMMERCIAL_SHARED_CONTEXT_GRANTS = exports.COMMERCIAL_SHARED_CONTEXT_ROLE = exports.RECORDED_TENANT_SALES_CHANNELS = exports.OPERATIONAL_CONFIGURATION_ADMINISTRATOR_RULING = exports.COMMERCIAL_SHARED_CONTEXT_RULING = void 0;
exports.commercialSharedContextOperations = commercialSharedContextOperations;
exports.operationalConfigurationAdministratorOperations = operationalConfigurationAdministratorOperations;
// RECORDED NONPROD ADMINISTRATION DECISIONS THAT CREATED ROLES (UI corrections integration readiness, 2026-10-08).
//
// The governed nonprod authority (94 migrations / 128 capabilities / 542 grants) is the authority baseline plus the recorded
// Administration decisions in this directory. Two of those decisions CREATED a Security Role through the Administration API and
// were never captured as replay data, so a replay from the repository alone could not reproduce nonprod -- the Parts and
// Truck deltas grant to a Role nothing in the repository creates, and the Commercial Shared Context Role existed only in nonprod
// and in a test fixture. A grant-by-grant comparison (local governed replay vs. the local proof harness) traced the harness's
// 499 against 542 to exactly these missing inputs plus the unreplayed recorded deltas:
//
//   D-B, OPTION A (Commercial/CRM activation, 2026-09-30, 418 -> 422): the tenant sales channels RETAIL and NATIONAL_ACCOUNTS are
//     ACTIVE, and the Security Role `commercialSharedContext` holds exactly customer.record.read / create / update and
//     inventory.catalog.read -- the shared context a channel-scoped seller keeps (a scoped assignment adds nothing to the flat
//     set). Assigned GLOBALLY to the sellers alongside their salesperson@salesChannel assignment.
//   DQ-033 (Parts / Purchasing / Receiving, 2026-10-01): the Security Role `operationalConfigurationAdministrator`, a narrow
//     configuration Role; its grants are recorded in partsPurchasingReceivingDelta / truckInventoryActivationDelta.
//
// DATA ONLY, exactly like the other deltas: read by no command; nothing changes until Administration applies it. Nonprod already
// holds every row; no new Role, grant or capability is introduced by this file.
exports.COMMERCIAL_SHARED_CONTEXT_RULING = "Controller D-B Option A (2026-09-30): shared context global, selling channel-scoped";
exports.OPERATIONAL_CONFIGURATION_ADMINISTRATOR_RULING = "Controller DQ-033 (2026-10-01): a narrow operational configuration Security Role";
exports.RECORDED_TENANT_SALES_CHANNELS = Object.freeze(["RETAIL", "NATIONAL_ACCOUNTS"]);
exports.COMMERCIAL_SHARED_CONTEXT_ROLE = Object.freeze({ key: "commercialSharedContext", name: "Commercial Shared Context" });
exports.COMMERCIAL_SHARED_CONTEXT_GRANTS = Object.freeze([
    Object.freeze({ capabilityKey: "customer.record.read", objectKey: "account", actionKey: "read" }),
    Object.freeze({ capabilityKey: "customer.record.create", objectKey: "account", actionKey: "create" }),
    Object.freeze({ capabilityKey: "customer.record.update", objectKey: "account", actionKey: "edit" }),
    Object.freeze({ capabilityKey: "inventory.catalog.read", objectKey: "part", actionKey: "read" }),
]);
exports.OPERATIONAL_CONFIGURATION_ADMINISTRATOR_ROLE = Object.freeze({
    key: "operationalConfigurationAdministrator", name: "Operational Configuration Administrator",
});
/** The Administration operations a replay issues for D-B (after the sales channels are ACTIVE). */
function commercialSharedContextOperations() {
    return Object.freeze([
        Object.freeze({ operation: "createRole", input: Object.freeze({ ...exports.COMMERCIAL_SHARED_CONTEXT_ROLE, reason: exports.COMMERCIAL_SHARED_CONTEXT_RULING }) }),
        ...exports.COMMERCIAL_SHARED_CONTEXT_GRANTS.map((g) => Object.freeze({
            operation: "grantObjectActionToRole",
            input: Object.freeze({ roleKey: exports.COMMERCIAL_SHARED_CONTEXT_ROLE.key, objectKey: g.objectKey, actionKey: g.actionKey, reason: exports.COMMERCIAL_SHARED_CONTEXT_RULING }),
        })),
    ]);
}
/** The Administration operation a replay issues for DQ-033 (before the Parts and Truck deltas). */
function operationalConfigurationAdministratorOperations() {
    return Object.freeze([Object.freeze({ operation: "createRole",
            input: Object.freeze({ ...exports.OPERATIONAL_CONFIGURATION_ADMINISTRATOR_ROLE, reason: exports.OPERATIONAL_CONFIGURATION_ADMINISTRATOR_RULING }) })]);
}
//# sourceMappingURL=recordedAdministrationRolesDelta.js.map