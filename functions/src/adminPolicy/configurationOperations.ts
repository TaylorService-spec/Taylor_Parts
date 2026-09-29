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

export const ADMIN_CONFIGURATION_OPERATIONS = Object.freeze({
  listMobileLocationScopeBindings: Object.freeze({ capability: MOBILE_LOCATION_SCOPE_BINDING_CAPABILITY, mutation: false }),
  readMobileLocationScopeBinding: Object.freeze({ capability: MOBILE_LOCATION_SCOPE_BINDING_CAPABILITY, mutation: false }),
  setMobileLocationScopeBinding: Object.freeze({ capability: MOBILE_LOCATION_SCOPE_BINDING_CAPABILITY, mutation: true }),
  removeMobileLocationScopeBinding: Object.freeze({ capability: MOBILE_LOCATION_SCOPE_BINDING_CAPABILITY, mutation: true }),
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
