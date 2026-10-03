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

/** ADMINISTRATIVE CONFIGURATION authority for truck-location -> warehouse scope bindings. Held by no one by default. */
export const MOBILE_LOCATION_SCOPE_BINDING_CAPABILITY = "inventory.location.scopeBinding.manage";

/**
 * ADMINISTRATIVE CONFIGURATION authority for Warehouse and Bin master data (Controller DQ-E, 2026-10-01). Held by no one by
 * default; granted only through Administration. Not operational authority (receive / transfer / relocate / count).
 */
export const WAREHOUSE_MASTER_CAPABILITY = "warehouse.record.manage";

/**
 * ADMINISTRATIVE CONFIGURATION authority for the truck / MOBILE-location registry (Controller OD-T7, 2026-10-01). Held by no
 * one by default; the ruled holder is the Operational Configuration Administrator Role. Confers no inventory movement, no
 * warehouse binding and no Employee MOBILE scope.
 */
export const TRUCK_REGISTRY_CAPABILITY = "inventory.truckRegistry.manage";

/**
 * ADMINISTRATIVE CONFIGURATION authority for Finance configuration (DECISIONS #203 / Owner ruling #204): accounting
 * destinations and counterparty payment terms. Held by no one by default; the ruled holders are an Administration delta.
 */
export const FINANCE_CONFIGURATION_CAPABILITY = "finance.configuration.manage";

/**
 * SYSTEM ADMINISTRATION authority over governed company / system settings (Owner ruling #204): business time zone, default
 * language and the settings that follow. Confers no business approval.
 */
export const SYSTEM_CONFIGURATION_CAPABILITY = "admin.systemConfiguration.manage";

/**
 * SALES AUTHORITY ADMINISTRATION (Owner ruling #204): each Sales user's maximum CUSTOMER discount percentage. Confers no
 * discount of its own and no pricing, cost or trade-in authority.
 */
export const SALES_DISCOUNT_AUTHORITY_CAPABILITY = "sales.discountAuthority.manage";

export const ADMIN_CONFIGURATION_OPERATIONS = Object.freeze({
  listMobileLocationScopeBindings: Object.freeze({ capability: MOBILE_LOCATION_SCOPE_BINDING_CAPABILITY, mutation: false }),
  readMobileLocationScopeBinding: Object.freeze({ capability: MOBILE_LOCATION_SCOPE_BINDING_CAPABILITY, mutation: false }),
  setMobileLocationScopeBinding: Object.freeze({ capability: MOBILE_LOCATION_SCOPE_BINDING_CAPABILITY, mutation: true }),
  removeMobileLocationScopeBinding: Object.freeze({ capability: MOBILE_LOCATION_SCOPE_BINDING_CAPABILITY, mutation: true }),
  // Warehouse and Bin master data (eosOps/warehouseBinAdministration.ts).
  listWarehouses: Object.freeze({ capability: WAREHOUSE_MASTER_CAPABILITY, mutation: false }),
  listWarehouseBins: Object.freeze({ capability: WAREHOUSE_MASTER_CAPABILITY, mutation: false }),
  createWarehouse: Object.freeze({ capability: WAREHOUSE_MASTER_CAPABILITY, mutation: true }),
  updateWarehouse: Object.freeze({ capability: WAREHOUSE_MASTER_CAPABILITY, mutation: true }),
  setWarehouseStatus: Object.freeze({ capability: WAREHOUSE_MASTER_CAPABILITY, mutation: true }),
  createBin: Object.freeze({ capability: WAREHOUSE_MASTER_CAPABILITY, mutation: true }),
  relabelBin: Object.freeze({ capability: WAREHOUSE_MASTER_CAPABILITY, mutation: true }),
  setBinStatus: Object.freeze({ capability: WAREHOUSE_MASTER_CAPABILITY, mutation: true }),
  // Truck / MOBILE-location registry (eosOps/truckRegistryAdministration.ts).
  listTrucks: Object.freeze({ capability: TRUCK_REGISTRY_CAPABILITY, mutation: false }),
  readTruck: Object.freeze({ capability: TRUCK_REGISTRY_CAPABILITY, mutation: false }),
  listMobileLocations: Object.freeze({ capability: TRUCK_REGISTRY_CAPABILITY, mutation: false }),
  createMobileLocation: Object.freeze({ capability: TRUCK_REGISTRY_CAPABILITY, mutation: true }),
  createTruck: Object.freeze({ capability: TRUCK_REGISTRY_CAPABILITY, mutation: true }),
  linkTruck: Object.freeze({ capability: TRUCK_REGISTRY_CAPABILITY, mutation: true }),
  relinkTruck: Object.freeze({ capability: TRUCK_REGISTRY_CAPABILITY, mutation: true }),
  unlinkTruck: Object.freeze({ capability: TRUCK_REGISTRY_CAPABILITY, mutation: true }),
  changeTruckStatus: Object.freeze({ capability: TRUCK_REGISTRY_CAPABILITY, mutation: true }),
  // Finance configuration (eosFinance/financeConfigurationAdministration.ts).
  listAccountingDestinations: Object.freeze({ capability: FINANCE_CONFIGURATION_CAPABILITY, mutation: false }),
  configureAccountingDestination: Object.freeze({ capability: FINANCE_CONFIGURATION_CAPABILITY, mutation: true }),
  setAccountingDestinationStatus: Object.freeze({ capability: FINANCE_CONFIGURATION_CAPABILITY, mutation: true }),
  listCounterpartyPaymentTerms: Object.freeze({ capability: FINANCE_CONFIGURATION_CAPABILITY, mutation: false }),
  setCounterpartyPaymentTerms: Object.freeze({ capability: FINANCE_CONFIGURATION_CAPABILITY, mutation: true }),
  // System Configuration (eosOps/systemConfigurationAdministration.ts): company settings, by registry.
  listSystemConfiguration: Object.freeze({ capability: SYSTEM_CONFIGURATION_CAPABILITY, mutation: false }),
  setSystemConfigurationSetting: Object.freeze({ capability: SYSTEM_CONFIGURATION_CAPABILITY, mutation: true }),
  // Employee Sales Authority (eosCommercial/salesDiscountAuthorityAdministration.ts).
  listSalesDiscountAuthorities: Object.freeze({ capability: SALES_DISCOUNT_AUTHORITY_CAPABILITY, mutation: false }),
  setSalesDiscountAuthority: Object.freeze({ capability: SALES_DISCOUNT_AUTHORITY_CAPABILITY, mutation: true }),
} as const);

export type AdminConfigurationOperation = keyof typeof ADMIN_CONFIGURATION_OPERATIONS;
export const ADMIN_CONFIGURATION_OPERATION_NAMES: readonly AdminConfigurationOperation[] =
  Object.freeze(Object.keys(ADMIN_CONFIGURATION_OPERATIONS) as AdminConfigurationOperation[]);

export const isAdminConfigurationOperation = (name: unknown): name is AdminConfigurationOperation =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(ADMIN_CONFIGURATION_OPERATIONS, name);

/** Who is asking, as the Administration dispatcher resolved it. Never read from the request body. */
export interface ConfigurationActor {
  readonly tenantId: string;
  readonly principalId: string;
}

/** The server-composed implementation. Absent, every configuration operation refuses. */
export type ConfigurationOperationHandler = (
  operation: AdminConfigurationOperation,
  actor: ConfigurationActor,
  input: Record<string, unknown>,
  reason: string | null,
) => Promise<unknown>;

/** A governed refusal with its own category, mapped by the dispatcher exactly like a WorkflowRefusal. */
export class ConfigurationRefusal extends Error {
  constructor(
    readonly code: string,
    readonly category: "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "ConfigurationRefusal";
  }
}

/** Refused because the caller does not hold the configuration operation's capability. */
export class ConfigurationDeniedError extends Error {
  constructor(readonly operation: string, readonly requiredCapability: string) {
    super(`not authorized: "${requiredCapability}" is required`);
    this.name = "ConfigurationDeniedError";
  }
}
