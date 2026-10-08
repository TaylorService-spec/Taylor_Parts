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
export const COMMERCIAL_SHARED_CONTEXT_RULING = "Controller D-B Option A (2026-09-30): shared context global, selling channel-scoped";
export const OPERATIONAL_CONFIGURATION_ADMINISTRATOR_RULING = "Controller DQ-033 (2026-10-01): a narrow operational configuration Security Role";

export const RECORDED_TENANT_SALES_CHANNELS = Object.freeze(["RETAIL", "NATIONAL_ACCOUNTS"] as const);

export const COMMERCIAL_SHARED_CONTEXT_ROLE = Object.freeze({ key: "commercialSharedContext", name: "Commercial Shared Context" });
export const COMMERCIAL_SHARED_CONTEXT_GRANTS = Object.freeze([
  Object.freeze({ capabilityKey: "customer.record.read", objectKey: "account", actionKey: "read" }),
  Object.freeze({ capabilityKey: "customer.record.create", objectKey: "account", actionKey: "create" }),
  Object.freeze({ capabilityKey: "customer.record.update", objectKey: "account", actionKey: "edit" }),
  Object.freeze({ capabilityKey: "inventory.catalog.read", objectKey: "part", actionKey: "read" }),
]);

export const OPERATIONAL_CONFIGURATION_ADMINISTRATOR_ROLE = Object.freeze({
  key: "operationalConfigurationAdministrator", name: "Operational Configuration Administrator",
});

/** The Administration operations a replay issues for D-B (after the sales channels are ACTIVE). */
export function commercialSharedContextOperations(): readonly { readonly operation: "createRole" | "grantObjectActionToRole"; readonly input: Record<string, unknown> }[] {
  return Object.freeze([
    Object.freeze({ operation: "createRole" as const, input: Object.freeze({ ...COMMERCIAL_SHARED_CONTEXT_ROLE, reason: COMMERCIAL_SHARED_CONTEXT_RULING }) }),
    ...COMMERCIAL_SHARED_CONTEXT_GRANTS.map((g) => Object.freeze({
      operation: "grantObjectActionToRole" as const,
      input: Object.freeze({ roleKey: COMMERCIAL_SHARED_CONTEXT_ROLE.key, objectKey: g.objectKey, actionKey: g.actionKey, reason: COMMERCIAL_SHARED_CONTEXT_RULING }),
    })),
  ]);
}

/** The Administration operation a replay issues for DQ-033 (before the Parts and Truck deltas). */
export function operationalConfigurationAdministratorOperations(): readonly { readonly operation: "createRole"; readonly input: Record<string, unknown> }[] {
  return Object.freeze([Object.freeze({ operation: "createRole" as const,
    input: Object.freeze({ ...OPERATIONAL_CONFIGURATION_ADMINISTRATOR_ROLE, reason: OPERATIONAL_CONFIGURATION_ADMINISTRATOR_RULING }) })]);
}
