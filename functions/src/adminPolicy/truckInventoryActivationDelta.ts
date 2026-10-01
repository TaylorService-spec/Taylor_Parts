// THE TRUCK INVENTORY ACTIVATION DELTA -- the Controller-ruled authority this package needs, stated as DATA so the nonprod
// activation window issues a reviewed list through Administration: never an improvised grant, never a migration grant
// (Controller TRUCK INVENTORY ACTIVATION AUTHORIZED, 2026-10-01).
//
//   OD-T2  inventory.location.scopeBinding.manage -> the EXISTING Operational Configuration Administrator Security Role
//          (DQ-029 / DQ-033). Nonprod: that Role is ASSIGNED to the Warehouse Manager persona's Principal -- never granted
//          to the Warehouse Manager job/security Role itself. Owner stays outside configuration authority.
//   OD-T7  inventory.truckRegistry.manage -> the same Operational Configuration Administrator Role (truck / MOBILE registry
//          administration). The Dispatcher reads the roster operationally (listTruckRoster) and is not an administrator.
//   OD-T6  inventory.catalog.read + inventory.catalog.alias.read -> the EXISTING inventoryLookupReader composition (resolve
//          and read only; no catalog manage). Holders: Parts Associate, Parts Manager, Warehouse Associate, Warehouse
//          Manager, Technician (nonprod personas; Technician A and B).
//   OD-T3  the Technician's truck operations -> the EXISTING technician Security Role: inventory.transaction.read (truck
//   OD-T4  stock reads), inventory.transfer.receive (receive an already-governed transfer INTO its own truck) and
//          inventory.workOrderConsumption.record (consume from its own truck on its assigned Work Order). Every one is
//          narrowed at run time by SERVICE_TECHNICIAN eligibility + a CURRENT MOBILE scope over that truck; the Role confers
//          no warehouse authority, no transfer create / dispatch / cancel and no receipt into a warehouse.
//
// Every row is an ordinary Administration act: Administration can later change any of it without source, Firebase or a
// migration. Not read by any command; nothing changes until the activation window applies it.

export const TRUCK_INVENTORY_ACTIVATION_RULING = "Controller TRUCK INVENTORY ACTIVATION AUTHORIZED (2026-10-01)";

export interface TruckGrantDecision { readonly roleKey: string; readonly capabilityKey: string; readonly reason: string }

export const TRUCK_CAPABILITY_OBJECT_ACTION: Readonly<Record<string, { readonly objectKey: string; readonly actionKey: string }>> = Object.freeze({
  "inventory.location.scopeBinding.manage": Object.freeze({ objectKey: "mobileLocation", actionKey: "manageScopeBinding" }),
  "inventory.truckRegistry.manage": Object.freeze({ objectKey: "mobileLocation", actionKey: "manageRegistry" }),
  "inventory.catalog.read": Object.freeze({ objectKey: "part", actionKey: "read" }),
  "inventory.catalog.alias.read": Object.freeze({ objectKey: "part", actionKey: "resolveAlias" }),
  "inventory.transaction.read": Object.freeze({ objectKey: "inventoryTransaction", actionKey: "read" }),
  "inventory.transfer.receive": Object.freeze({ objectKey: "transferOrder", actionKey: "receive" }),
  "inventory.workOrderConsumption.record": Object.freeze({ objectKey: "workOrder", actionKey: "recordConsumption" }),
});

export const OPERATIONAL_CONFIGURATION_ADMINISTRATOR_ROLE_KEY = "operationalConfigurationAdministrator";
export const INVENTORY_LOOKUP_READER_ROLE_KEY = "inventoryLookupReader";
export const TECHNICIAN_ROLE_KEY = "technician";

export const TRUCK_GRANTS: readonly TruckGrantDecision[] = Object.freeze([
  { roleKey: OPERATIONAL_CONFIGURATION_ADMINISTRATOR_ROLE_KEY, capabilityKey: "inventory.location.scopeBinding.manage",
    reason: `${TRUCK_INVENTORY_ACTIVATION_RULING} OD-T2: truck location -> warehouse scope binding is operational configuration (DQ-029)` },
  { roleKey: OPERATIONAL_CONFIGURATION_ADMINISTRATOR_ROLE_KEY, capabilityKey: "inventory.truckRegistry.manage",
    reason: `${TRUCK_INVENTORY_ACTIVATION_RULING} OD-T7: truck / MOBILE location registry administration` },
  { roleKey: INVENTORY_LOOKUP_READER_ROLE_KEY, capabilityKey: "inventory.catalog.read",
    reason: `${TRUCK_INVENTORY_ACTIVATION_RULING} OD-T6: the lookup composition reads the Part a scan names` },
  { roleKey: INVENTORY_LOOKUP_READER_ROLE_KEY, capabilityKey: "inventory.catalog.alias.read",
    reason: `${TRUCK_INVENTORY_ACTIVATION_RULING} OD-T6: the lookup composition resolves a scanned identifier to its Part` },
  { roleKey: TECHNICIAN_ROLE_KEY, capabilityKey: "inventory.transaction.read",
    reason: `${TRUCK_INVENTORY_ACTIVATION_RULING} OD-T3: a Technician reads the stock of the truck it holds MOBILE scope over` },
  { roleKey: TECHNICIAN_ROLE_KEY, capabilityKey: "inventory.transfer.receive",
    reason: `${TRUCK_INVENTORY_ACTIVATION_RULING} OD-T3: a Technician receives an already-governed transfer into its own truck` },
  { roleKey: TECHNICIAN_ROLE_KEY, capabilityKey: "inventory.workOrderConsumption.record",
    reason: `${TRUCK_INVENTORY_ACTIVATION_RULING} OD-T4: a Technician consumes from its own truck on its assigned Work Order` },
].map((g) => Object.freeze(g)));

/** The nonprod synthetic personas (principal ids measured 2026-10-01, census truckCensus4) and the Roles each is assigned. */
export const TRUCK_PERSONA_ROLE_ASSIGNMENTS = Object.freeze([
  Object.freeze({ persona: "warehouseManager", principalId: "00e45827-043a-484f-b150-0d8502e8e39f", roleKey: OPERATIONAL_CONFIGURATION_ADMINISTRATOR_ROLE_KEY,
    reason: `${TRUCK_INVENTORY_ACTIVATION_RULING} OD-T2: the Warehouse Manager persona holds operational configuration in nonprod` }),
  ...([
    ["partsAssociate", "29ec481c-51a6-468f-831e-5f84308bad0d"],
    ["partsManager", "68ab4dec-5922-4d0c-954c-5161befe3bd8"],
    ["warehouseAssociate", "65a269d9-86f8-4c7a-b974-436dd6779bbf"],
    ["warehouseManager", "00e45827-043a-484f-b150-0d8502e8e39f"],
    ["serviceTechnician", "97652f09-07bf-48e8-90b9-f321a01fe10d"],
    ["serviceTechnicianB", "728f5b0d-45bf-4708-8624-0864ab19bcab"],
  ] as const).map(([persona, principalId]) => Object.freeze({ persona, principalId, roleKey: INVENTORY_LOOKUP_READER_ROLE_KEY,
    reason: `${TRUCK_INVENTORY_ACTIVATION_RULING} OD-T6: scanner Part identification` })),
]);

/** The Administration grant operations, in the order the activation window issues them. */
export function truckInventoryActivationOperations(): readonly { readonly operation: "grantObjectActionToRole"; readonly input: Record<string, unknown> }[] {
  return Object.freeze(TRUCK_GRANTS.map((g) => Object.freeze({
    operation: "grantObjectActionToRole" as const,
    input: Object.freeze({ roleKey: g.roleKey, ...TRUCK_CAPABILITY_OBJECT_ACTION[g.capabilityKey], reason: g.reason }),
  })));
}
