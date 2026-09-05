// O-3 — environment resolution, PURE CORE.
//
// The one authoritative way to answer "which environment is this build for, and
// what is its identity?". Consumed by the Vite build (client Firebase identity +
// readiness), by D2's drift checker, and available to operator tooling — so there
// is a single mechanism rather than one per program.
//
// PURE: no network, filesystem, or process access. The caller supplies the
// registry and the requested id.
//
// FAILS CLOSED. An unknown environment id, or a known-but-unprovisioned one, is
// an error — never a silent fallback to production. Falling back would let a typo
// point a sandbox build at the customer's live data, which is the exact failure
// this module exists to make impossible.

export class EnvironmentResolutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EnvironmentResolutionError';
    this.code = code;
  }
}

export const REQUIRED_FIREBASE_KEYS = Object.freeze([
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
  'functionsRegion',
]);

export const READINESS_KEYS = Object.freeze([
  'RECEIVING_TRANSPORT_READY',
  // Scanner Program Phase A. Registered here so an environment that FORGETS it is a build
  // error rather than a silent default -- the same fail-closed rule every other flag follows.
  'PART_IDENTIFIER_TRANSPORT_READY',
  // Scanner Program Phase H. The shared inventory-balance read's transport gate. Same fail-closed
  // rule: an environment that omits it is a build error, never a silent default-to-enabled.
  'INVENTORY_BALANCE_READ_READY',
  // North Star Work Order intelligence. Separate from inventory-balance transport because the
  // context callable has its own deploy lifecycle; enabling one must never imply the other exists.
  'WORK_ORDER_READINESS_CONTEXT_READY',
  'TRUCK_MANAGEMENT_WRITE_READY',
  'TRUSTED_COMPLETION_ENABLED',
]);

// Per-environment capability activation (per-environment-capability-activation-
// spec.md, Owner-directed 2026-08-14). The 11 sales/fulfillment/finance spine
// capability ids eligible for per-environment activation. Mirrors
// functions/src/access/environmentCapabilityOverrides.ts's
// SPINE_OVERRIDE_ELIGIBLE_IDS exactly (parity asserted by
// environmentArchitecture.test.mjs). Hardcoded allow-list: bounds what ANY
// environment can activate, so registry data can only ever be a subset.
export const SPINE_OVERRIDE_ELIGIBLE_IDS = Object.freeze([
  // 2C.6C (DECISIONS #167): the reporting family became environment-activated, so its ids must be
  // override-eligible here too. This list is the SCRIPT-side copy of the same contract the
  // Functions module declares; the environment-architecture guard compares config/environments.json
  // against THIS one, so omitting them here would reject the sandbox declaration as ineligible.
  "report.customer.read",
  "report.customer.field.name.read",
  "report.customer.field.status.read",
  "report.customer.field.relationshipTypes.read",
  "report.customer.field.billingAddress.read",
  "report.customer.field.tags.read",
  "report.customer.field.externalIds.read",
  "report.customer.field.createdAt.read",
  "report.customer.field.paymentTerms.read",
  "report.customer.field.taxStatus.read",
  "report.customer.field.commercialProfile.read",
  "report.customer.field.billingContact.read",
  "report.contact.read",
  "report.contact.field.name.read",
  "report.contact.field.email.read",
  "report.contact.field.phone.read",
  "report.contact.field.role.read",
  "report.contact.field.customer.read",
  "report.location.read",
  "report.location.field.name.read",
  "report.location.field.address.read",
  "report.location.field.customer.read",
  "report.equipment.read",
  "report.equipment.field.name.read",
  "report.equipment.field.status.read",
  "report.equipment.field.identity.read",
  "report.equipment.field.dates.read",
  "report.equipment.field.notes.read",
  "report.equipment.field.customer.read",
  "report.equipment.field.location.read",
  "report.equipment.field.createdAt.read",
  "report.definition.create",
  "report.definition.read",
  "report.definition.rename",
  "report.definition.duplicate",
  "report.definition.delete",
  'opportunity.write',
  'opportunity.read',
  'opportunity.createSalesOrder',
  'salesOrder.read',
  'salesOrder.write',
  'salesOrder.fulfill',
  'salesOrder.service',
  'finance.invoice.issue',
  'finance.payment.apply',
  'finance.adjustment.record',
  'finance.read',
  'finance.refund.record',
  'inventory.catalog.read',
  // Wave 7 (Owner-authorized sandbox activation) -- mirrors the same three additions in
  // functions/src/access/environmentCapabilityOverrides.ts. Parity between the two is asserted
  // by environmentArchitecture.test.mjs, so this list can never silently drift from the backend.
  'workOrder.parts.plan',
  'crm.activity.create',
  'crm.activity.read',
  // Consolidated sandbox promotion -- mirrors the same additions in
  // functions/src/access/environmentCapabilityOverrides.ts; parity is test-asserted.
  'fulfillment.coordinatedVisit.read',
  'inventory.serializedAsset.read',
  'inventory.location.display.read',
  'inventory.transfer.create',
  'inventory.transfer.dispatch',
  'inventory.transfer.receive',
  'inventory.transfer.cancel',
  'inventory.cycleCount.create',
  'inventory.cycleCount.submit',
  'inventory.cycleCount.reconcile',
  'inventory.cycleCount.cancel',
  // Sales Agreement (Slice 4) -- mirrors environmentCapabilityOverrides.ts, parity-asserted.
  'salesAgreement.create',
  'salesAgreement.updateDraft',
  'salesAgreement.accept',
  'salesAgreement.read',
  // SCANNER PROMOTION -- mirrors environmentCapabilityOverrides.ts. Parity is asserted, so these two
  // lists cannot drift: a capability eligible on the backend but not here would be denied by the UI
  // and allowed by the command, which is the worst of both answers.
  'inventory.catalog.alias.read',
  'inventory.balance.read',
  'inventory.location.bin.manage',
  'inventory.location.bin.read',
  'inventory.placement.record',
  'inventory.returns.intake',
  // SERIALIZED EQUIPMENT FORWARD LIFECYCLE -- mirrors environmentCapabilityOverrides.ts, whose
  // comment carries the full reasoning. Present here because the frontend bakes THIS list into the
  // bundle: eligible on the backend but not here would mean the UI hides an action the command
  // would have allowed, which is a disagreement rather than a safeguard.
  'inventory.serializedAsset.acquire',
  'equipment.install',
  // FIN-004 CONSOLIDATED REACH -- mirrors environmentCapabilityOverrides.ts, whose comment carries
  // the full reasoning. Present here because the frontend bakes THIS list into the bundle: eligible
  // on the backend but not here would mean the UI hides a surface the governed read would answer,
  // which is a disagreement rather than a safeguard.
  'finance.visibility.consolidated',
  // PERFORMANCE GOAL AUTHORITY -- mirrors environmentCapabilityOverrides.ts, whose comment carries
  // the full reasoning. Present here for the same reason as the ids above: the frontend bakes THIS
  // list into the bundle, so a verb eligible on the backend but absent here would hide a management
  // action the command would have allowed -- a disagreement rather than a safeguard.
  'performance.goal.read',
  'performance.goal.create',
  'performance.goal.approve',
  'performance.goal.supersede',
  'performance.goal.retire',
  // CERT-FIN-02 FINANCIAL POLICY -- mirrors environmentCapabilityOverrides.ts, whose comment
  // carries the full reasoning. Present here for the same reason as the ids above: the frontend
  // bakes THIS list into the bundle, so a capability eligible on the backend but absent here would
  // hide the Financial Policy surface the governed read would have answered -- a disagreement
  // rather than a safeguard.
  'financialPolicy.profile.read',
  'financialPolicy.profile.configure',
  // DATA IMPORT P1 -- mirrors environmentCapabilityOverrides.ts, whose comment carries the full
  // reasoning. Present here for the same reason as the ids above: the frontend bakes THIS list
  // into the bundle, so a capability eligible on the backend but absent here would hide the Data
  // Import screen the command would have answered.
  'admin.dataImport.stage',
  'admin.dataImport.execute',
  // EMAIL CONNECTIONS + INBOUND WORK. The SCRIPT-side copy of the same contract; the environment-
  // architecture guard compares config/environments.json against THIS list, so omitting them here would
  // reject the sandbox declaration as ineligible.
  'administration.emailIntake.read',
  'administration.emailIntake.manage',
  'service.inboundWork.read',
  'service.inboundWork.accept',
  'service.inboundWork.decline',
  'service.inboundWork.attachExisting',
]);

/**
 * The spine capability ids `env` activates despite their catalog active:false.
 * PURE mirror of environmentCapabilityOverrides.ts's resolveCapabilityOverrides,
 * keyed the same way — this is what the frontend build bakes into the bundle.
 *
 * Fail-closed:
 *  - role === "production"  -> [] unconditionally (role-keyed; ignores data)
 *  - otherwise              -> declared overrides ∩ the eligible allow-list
 * A production build therefore CANNOT carry a non-empty set even if the registry
 * were mis-edited, and an absent key is simply [].
 */
export function resolveCapabilityActivationOverrides(env) {
  if (!env || env.role === 'production') return [];
  const declared = Array.isArray(env.capabilityActivationOverrides)
    ? env.capabilityActivationOverrides
    : [];
  const eligible = new Set(SPINE_OVERRIDE_ELIGIBLE_IDS);
  return declared.filter((id) => typeof id === 'string' && eligible.has(id));
}

/** Every environment id the registry knows. This is the allow-list. */
export function knownEnvironmentIds(registry) {
  return (registry?.environments ?? []).map((e) => e.id);
}

/** Every real Firebase project id the registry knows — the project allow-list. */
export function knownProjectIds(registry) {
  return (registry?.environments ?? [])
    .map((e) => e.firebase?.projectId)
    .filter((id) => typeof id === 'string' && id.length > 0);
}

/**
 * Is this project id one the platform knows about?
 *
 * Production guards use this INSTEAD OF widening to a wildcard: an unknown
 * project must still fail closed. Membership is not permission — a caller that
 * additionally requires production still checks the role.
 */
export function isKnownProjectId(registry, projectId) {
  return knownProjectIds(registry).includes(projectId);
}

/**
 * Resolve the environment record for `id`.
 *
 * `requireFirebaseIdentity` (default true) rejects environments declared but not
 * yet provisioned, so a build cannot silently produce an app with no backend.
 */
export function resolveEnvironment(registry, id, { requireFirebaseIdentity = true } = {}) {
  if (!registry || !Array.isArray(registry.environments)) {
    throw new EnvironmentResolutionError('INVALID_REGISTRY', 'Environment registry is missing or malformed.');
  }
  const requested = id ?? registry.defaultEnvironmentId;
  if (!requested) {
    throw new EnvironmentResolutionError(
      'NO_ENVIRONMENT',
      'No environment id supplied and the registry declares no defaultEnvironmentId.',
    );
  }

  const env = registry.environments.find((e) => e.id === requested);
  if (!env) {
    throw new EnvironmentResolutionError(
      'UNKNOWN_ENVIRONMENT',
      `Unknown environment '${requested}'. Known: ${knownEnvironmentIds(registry).join(', ')}. ` +
        'Refusing to fall back to a default — a typo must not silently target another environment.',
    );
  }

  if (requireFirebaseIdentity) {
    if (!env.firebase) {
      throw new EnvironmentResolutionError(
        'ENVIRONMENT_NOT_PROVISIONED',
        `Environment '${requested}' is declared but has no Firebase identity (status: ${env.status}). ` +
          'It has not been provisioned; building against it would produce an app with no backend.',
      );
    }
    for (const key of REQUIRED_FIREBASE_KEYS) {
      const value = env.firebase[key];
      if (typeof value !== 'string' || value.length === 0) {
        throw new EnvironmentResolutionError(
          'INCOMPLETE_FIREBASE_IDENTITY',
          `Environment '${requested}' is missing Firebase '${key}'.`,
        );
      }
    }
  }

  const readiness = env.readiness ?? {};
  for (const key of READINESS_KEYS) {
    if (typeof readiness[key] !== 'boolean') {
      throw new EnvironmentResolutionError(
        'INCOMPLETE_READINESS',
        `Environment '${requested}' is missing boolean readiness flag '${key}'. ` +
          'Readiness must be explicit per environment — an absent flag must never default to enabled.',
      );
    }
  }

  // Private AI data classification. Held to the same explicit-boolean rule as readiness, and for a
  // stronger reason: this one decides whether an environment's operational evidence may leave EOS
  // for a model at all. It is validated here but deliberately NOT returned below — it is a
  // server-side classification the Functions runtime resolves from its own project identity, and
  // projecting it into the browser bundle would imply the client has some say in it.
  if (typeof env.privateAiSyntheticOperationalInterpretation !== 'boolean') {
    throw new EnvironmentResolutionError(
      'INCOMPLETE_PRIVATE_AI_CLASSIFICATION',
      `Environment '${requested}' is missing boolean 'privateAiSyntheticOperationalInterpretation'. ` +
        'Whether an environment may send operational evidence to a model must be declared, never inferred.',
    );
  }

  return {
    id: env.id,
    role: env.role,
    deployment: env.deployment,
    status: env.status,
    firebase: env.firebase ? { ...env.firebase } : null,
    readiness: { ...readiness },
    // Build-time projection of the per-environment activation override set
    // (spec 2026-08-14). Always an array (never absent) so the consumer has a
    // definite value; [] for production and for any env that declares none.
    capabilityActivationOverrides: resolveCapabilityActivationOverrides(env),
  };
}

/**
 * Is this resolved environment a production one?
 * Deliberately keyed on ROLE, never on a project name or deployment — that is
 * what keeps "production" from silently meaning "Taylor Parts".
 */
export function isProductionEnvironment(resolved) {
  return resolved?.role === 'production';
}
