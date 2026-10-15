"use strict";
// ADMINISTRATION CONFIGURATION OPERATIONS -- operational configuration an administrator governs through
// /admin/policy, each gated by ONE dedicated capability rather than by an Administration surface read.
//
// ════════════════════ WHY A THIRD LIST, NOT AN ENTRY ON THE OTHER TWO ════════════════════
//
// ADMIN_READ_OPERATIONS are the SECURITY MODEL's reads, each mapped to the Administration surface that
// shows it (and so to that surface's read capability). ADMIN_MUTATION_OPERATIONS are the security model's
// changes, each gated inside its command. An operational configuration -- which warehouse's operational
// scope governs a truck inventory location (Controller rulings DQ-024 / DQ-029) -- is neither: it is not
// security policy, and its authority is its OWN capability, `inventory.location.scopeBinding.manage`,
// for reading and changing alike. Putting it on the surface map would have made "may read the Objects
// screen" imply "may see truck bindings"; putting it among the security mutations would have gated it on
// the security-administration invariant. A separate, closed table keeps each list meaning what it says.
//
// ════════════════════ THE GATE ════════════════════
//
// executeAdminOperation resolves the caller's effective access with the SAME resolver every other
// Administration gate uses (role_capabilities UNION principal_capabilities, conditioned grants withheld)
// and refuses unless the capability is held. No Role name, no Administrator check, no Firebase claim.
// The work itself is done by an implementation the SERVER composes over its pool
// (eosOps/mobileLocationScopeBindingAdministration.ts), injected because this module never touches pg.
//
// PURE: no pg, no Firebase.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigurationDeniedError = exports.ConfigurationRefusal = exports.isAdminConfigurationOperation = exports.ADMIN_CONFIGURATION_OPERATION_NAMES = exports.ADMIN_CONFIGURATION_OPERATIONS = exports.SALES_DISCOUNT_AUTHORITY_CAPABILITY = exports.SYSTEM_CONFIGURATION_CAPABILITY = exports.FINANCE_CONFIGURATION_CAPABILITY = exports.TRUCK_REGISTRY_CAPABILITY = exports.WAREHOUSE_MASTER_CAPABILITY = exports.MOBILE_LOCATION_SCOPE_BINDING_CAPABILITY = void 0;
/** ADMINISTRATIVE CONFIGURATION authority for truck-location -> warehouse scope bindings. Held by no one by default. */
exports.MOBILE_LOCATION_SCOPE_BINDING_CAPABILITY = "inventory.location.scopeBinding.manage";
/**
 * ADMINISTRATIVE CONFIGURATION authority for Warehouse and Bin master data (Controller DQ-E, 2026-10-01). Held by no one by
 * default; granted only through Administration. Not operational authority (receive / transfer / relocate / count).
 */
exports.WAREHOUSE_MASTER_CAPABILITY = "warehouse.record.manage";
/**
 * ADMINISTRATIVE CONFIGURATION authority for the truck / MOBILE-location registry (Controller OD-T7, 2026-10-01). Held by no
 * one by default; the ruled holder is the Operational Configuration Administrator Role. Confers no inventory movement, no
 * warehouse binding and no Employee MOBILE scope.
 */
exports.TRUCK_REGISTRY_CAPABILITY = "inventory.truckRegistry.manage";
/**
 * ADMINISTRATIVE CONFIGURATION authority for Finance configuration (DECISIONS #203 / Owner ruling #204): accounting
 * destinations and counterparty payment terms. Held by no one by default; the ruled holders are an Administration delta.
 */
exports.FINANCE_CONFIGURATION_CAPABILITY = "finance.configuration.manage";
/**
 * SYSTEM ADMINISTRATION authority over governed company / system settings (Owner ruling #204): business time zone, default
 * language and the settings that follow. Confers no business approval.
 */
exports.SYSTEM_CONFIGURATION_CAPABILITY = "admin.systemConfiguration.manage";
/**
 * SALES AUTHORITY ADMINISTRATION (Owner ruling #204): each Sales user's maximum CUSTOMER discount percentage. Confers no
 * discount of its own and no pricing, cost or trade-in authority.
 */
exports.SALES_DISCOUNT_AUTHORITY_CAPABILITY = "sales.discountAuthority.manage";
exports.ADMIN_CONFIGURATION_OPERATIONS = Object.freeze({
    listMobileLocationScopeBindings: Object.freeze({ capability: exports.MOBILE_LOCATION_SCOPE_BINDING_CAPABILITY, mutation: false }),
    readMobileLocationScopeBinding: Object.freeze({ capability: exports.MOBILE_LOCATION_SCOPE_BINDING_CAPABILITY, mutation: false }),
    setMobileLocationScopeBinding: Object.freeze({ capability: exports.MOBILE_LOCATION_SCOPE_BINDING_CAPABILITY, mutation: true }),
    removeMobileLocationScopeBinding: Object.freeze({ capability: exports.MOBILE_LOCATION_SCOPE_BINDING_CAPABILITY, mutation: true }),
    // Warehouse and Bin master data (eosOps/warehouseBinAdministration.ts).
    listWarehouses: Object.freeze({ capability: exports.WAREHOUSE_MASTER_CAPABILITY, mutation: false }),
    listWarehouseBins: Object.freeze({ capability: exports.WAREHOUSE_MASTER_CAPABILITY, mutation: false }),
    createWarehouse: Object.freeze({ capability: exports.WAREHOUSE_MASTER_CAPABILITY, mutation: true }),
    updateWarehouse: Object.freeze({ capability: exports.WAREHOUSE_MASTER_CAPABILITY, mutation: true }),
    setWarehouseStatus: Object.freeze({ capability: exports.WAREHOUSE_MASTER_CAPABILITY, mutation: true }),
    createBin: Object.freeze({ capability: exports.WAREHOUSE_MASTER_CAPABILITY, mutation: true }),
    relabelBin: Object.freeze({ capability: exports.WAREHOUSE_MASTER_CAPABILITY, mutation: true }),
    setBinStatus: Object.freeze({ capability: exports.WAREHOUSE_MASTER_CAPABILITY, mutation: true }),
    // Truck / MOBILE-location registry (eosOps/truckRegistryAdministration.ts).
    listTrucks: Object.freeze({ capability: exports.TRUCK_REGISTRY_CAPABILITY, mutation: false }),
    readTruck: Object.freeze({ capability: exports.TRUCK_REGISTRY_CAPABILITY, mutation: false }),
    listMobileLocations: Object.freeze({ capability: exports.TRUCK_REGISTRY_CAPABILITY, mutation: false }),
    createMobileLocation: Object.freeze({ capability: exports.TRUCK_REGISTRY_CAPABILITY, mutation: true }),
    createTruck: Object.freeze({ capability: exports.TRUCK_REGISTRY_CAPABILITY, mutation: true }),
    linkTruck: Object.freeze({ capability: exports.TRUCK_REGISTRY_CAPABILITY, mutation: true }),
    relinkTruck: Object.freeze({ capability: exports.TRUCK_REGISTRY_CAPABILITY, mutation: true }),
    unlinkTruck: Object.freeze({ capability: exports.TRUCK_REGISTRY_CAPABILITY, mutation: true }),
    changeTruckStatus: Object.freeze({ capability: exports.TRUCK_REGISTRY_CAPABILITY, mutation: true }),
    // Finance configuration (eosFinance/financeConfigurationAdministration.ts).
    listAccountingDestinations: Object.freeze({ capability: exports.FINANCE_CONFIGURATION_CAPABILITY, mutation: false }),
    configureAccountingDestination: Object.freeze({ capability: exports.FINANCE_CONFIGURATION_CAPABILITY, mutation: true }),
    setAccountingDestinationStatus: Object.freeze({ capability: exports.FINANCE_CONFIGURATION_CAPABILITY, mutation: true }),
    listCounterpartyPaymentTerms: Object.freeze({ capability: exports.FINANCE_CONFIGURATION_CAPABILITY, mutation: false }),
    setCounterpartyPaymentTerms: Object.freeze({ capability: exports.FINANCE_CONFIGURATION_CAPABILITY, mutation: true }),
    // System Configuration (eosOps/systemConfigurationAdministration.ts): company settings, by registry.
    listSystemConfiguration: Object.freeze({ capability: exports.SYSTEM_CONFIGURATION_CAPABILITY, mutation: false }),
    setSystemConfigurationSetting: Object.freeze({ capability: exports.SYSTEM_CONFIGURATION_CAPABILITY, mutation: true }),
    // Employee Sales Authority (eosCommercial/salesDiscountAuthorityAdministration.ts).
    listSalesDiscountAuthorities: Object.freeze({ capability: exports.SALES_DISCOUNT_AUTHORITY_CAPABILITY, mutation: false }),
    setSalesDiscountAuthority: Object.freeze({ capability: exports.SALES_DISCOUNT_AUTHORITY_CAPABILITY, mutation: true }),
});
exports.ADMIN_CONFIGURATION_OPERATION_NAMES = Object.freeze(Object.keys(exports.ADMIN_CONFIGURATION_OPERATIONS));
const isAdminConfigurationOperation = (name) => typeof name === "string" && Object.prototype.hasOwnProperty.call(exports.ADMIN_CONFIGURATION_OPERATIONS, name);
exports.isAdminConfigurationOperation = isAdminConfigurationOperation;
/** A governed refusal with its own category, mapped by the dispatcher exactly like a WorkflowRefusal. */
class ConfigurationRefusal extends Error {
    code;
    category;
    constructor(code, category, message) {
        super(message);
        this.code = code;
        this.category = category;
        this.name = "ConfigurationRefusal";
    }
}
exports.ConfigurationRefusal = ConfigurationRefusal;
/** Refused because the caller does not hold the configuration operation's capability. */
class ConfigurationDeniedError extends Error {
    operation;
    requiredCapability;
    constructor(operation, requiredCapability) {
        super(`not authorized: "${requiredCapability}" is required`);
        this.operation = operation;
        this.requiredCapability = requiredCapability;
        this.name = "ConfigurationDeniedError";
    }
}
exports.ConfigurationDeniedError = ConfigurationDeniedError;
//# sourceMappingURL=configurationOperations.js.map