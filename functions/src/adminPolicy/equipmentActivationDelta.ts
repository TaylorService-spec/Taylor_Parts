// THE EQUIPMENT ACTIVATION DELTA -- the Controller-ruled authority this package needs, stated as DATA so the nonprod
// activation window issues a reviewed list through Administration: never an improvised grant, never a migration grant
// (Controller EQUIPMENT ACTIVATION AUTHORIZED, 2026-10-01).
//
//   OD-2   equipment.install -> the EXISTING equipmentInstaller Security Role (declared; no grant until now). The
//          Technician is the normal installer: Technician A and B are ASSIGNED equipmentInstaller. Nothing else -- no
//          register management for the Technician, no install for Admin as an operational habit, none for Owner
//          (OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES stands).
//   OD-3   equipment.record.read -> Service Manager (fieldManager), Dispatcher, Office Manager, Owner, Parts Associate,
//          Parts Manager: the operational register, globally. -> salesperson: held ONLY through each seller's
//          salesChannel-scoped assignment, so a seller reads Equipment only through the governed commercial
//          relationship of its channel. NOT the Warehouse Roles: handling serialized stock is not customer-register
//          authority. The Technician reads the Equipment of an ASSIGNED Work Order through the Work Order (no grant).
//          equipment.record.manage -> a NEW narrow ordinary Role, equipmentRegisterManager, created through
//          Administration and carrying nothing else; its initial holder is the Office Manager. Not Owner by default.
//
// Every row is an ordinary Administration act: Administration can later change any of it without source, Firebase or
// a migration. Not read by any command; nothing changes until the activation window applies it.

export const EQUIPMENT_ACTIVATION_RULING = "Controller EQUIPMENT ACTIVATION AUTHORIZED (2026-10-01)";

export const EQUIPMENT_REGISTER_MANAGER_ROLE = Object.freeze({
  key: "equipmentRegisterManager",
  name: "Equipment Register Manager",
  description:
    "Creates and updates customer Equipment register records (equipment.record.manage): name, model, serial, asset tag, dates, notes, status. Customer, site and operating company are fixed at create. Confers NO installation (equipment.install), no inventory custody, no register read by itself and no catalog authority.",
});

export interface EquipmentGrantDecision { readonly roleKey: string; readonly capabilityKey: string; readonly reason: string }

export const EQUIPMENT_CAPABILITY_OBJECT_ACTION: Readonly<Record<string, { readonly objectKey: string; readonly actionKey: string }>> = Object.freeze({
  "equipment.install": Object.freeze({ objectKey: "equipment", actionKey: "install" }),
  "equipment.record.read": Object.freeze({ objectKey: "equipment", actionKey: "read" }),
  "equipment.record.manage": Object.freeze({ objectKey: "equipment", actionKey: "manage" }),
});

export const EQUIPMENT_READ_ROLES: readonly string[] = Object.freeze([
  "fieldManager", "dispatcher", "officeManager", "owner", "partsAssociate", "partsManager", "salesperson",
]);

export const EQUIPMENT_GRANTS: readonly EquipmentGrantDecision[] = Object.freeze([
  { roleKey: "equipmentInstaller", capabilityKey: "equipment.install",
    reason: `${EQUIPMENT_ACTIVATION_RULING} OD-2: the existing Equipment Installer Role -- installation on an assigned INSTALL Work Order` },
  ...EQUIPMENT_READ_ROLES.map((roleKey) => ({ roleKey, capabilityKey: "equipment.record.read",
    reason: roleKey === "salesperson"
      ? `${EQUIPMENT_ACTIVATION_RULING} OD-3: sellers read Equipment through their salesChannel-scoped assignment only`
      : `${EQUIPMENT_ACTIVATION_RULING} OD-3: operational Equipment register read` })),
  { roleKey: EQUIPMENT_REGISTER_MANAGER_ROLE.key, capabilityKey: "equipment.record.manage",
    reason: `${EQUIPMENT_ACTIVATION_RULING} OD-3: the narrow Equipment register management Role` },
].map((g) => Object.freeze(g)));

/** The nonprod synthetic personas (principal ids measured 2026-10-01, census eqp0) and the Roles each is assigned. */
export const EQUIPMENT_PERSONA_ROLE_ASSIGNMENTS = Object.freeze([
  Object.freeze({ persona: "serviceTechnician", principalId: "97652f09-07bf-48e8-90b9-f321a01fe10d", roleKey: "equipmentInstaller",
    reason: `${EQUIPMENT_ACTIVATION_RULING} OD-2: Technician A is a normal operational installer` }),
  Object.freeze({ persona: "serviceTechnicianB", principalId: "728f5b0d-45bf-4708-8624-0864ab19bcab", roleKey: "equipmentInstaller",
    reason: `${EQUIPMENT_ACTIVATION_RULING} OD-2: Technician B is a normal operational installer` }),
  Object.freeze({ persona: "officeManager", principalId: "a358c615-c65a-49ea-977d-9dc9b12785cb", roleKey: EQUIPMENT_REGISTER_MANAGER_ROLE.key,
    reason: `${EQUIPMENT_ACTIVATION_RULING} OD-3: the Office Manager is the initial Equipment register manager` }),
]);

/** The Administration operations, in the order the activation window issues them. */
export function equipmentActivationOperations(): readonly { readonly operation: "createRole" | "grantObjectActionToRole"; readonly input: Record<string, unknown> }[] {
  return Object.freeze([
    Object.freeze({ operation: "createRole" as const, input: Object.freeze({ ...EQUIPMENT_REGISTER_MANAGER_ROLE,
      reason: `${EQUIPMENT_ACTIVATION_RULING} OD-3: a narrow ordinary Equipment management Security Role` }) }),
    ...EQUIPMENT_GRANTS.map((g) => Object.freeze({
      operation: "grantObjectActionToRole" as const,
      input: Object.freeze({ roleKey: g.roleKey, ...EQUIPMENT_CAPABILITY_OBJECT_ACTION[g.capabilityKey], reason: g.reason }),
    })),
  ]);
}
