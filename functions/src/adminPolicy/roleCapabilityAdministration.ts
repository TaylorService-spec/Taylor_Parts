// THE ADMINISTRATION CONTROL PLANE — invariants, precedence and tenant-authority verification for
// Role -> capability grants. Pure: no storage, no SQL (the DAL rule of this directory).
//
// ════════════════════ THREE KINDS OF FACT, KEPT APART ════════════════════
//
//   1. PLATFORM CATALOG      eos_policy.capabilities -- the vocabulary, born in migrations.
//   2. SYSTEM INVARIANTS     pairs that must NEVER be held, whoever asks (this file). A violation is
//                            refused on write and reported as drift on read -- always.
//   3. TENANT CONFIGURATION  what each Role holds. Two sources compose into it:
//        SYSTEM_DEFAULT      what the repository produces: migrations, the Role catalog reconcile,
//                            and an environment activation (roleCapabilityAuthorityBaseline.ts)
//        ADMIN decision      what an administrator decided through EOS Administration
//                            (eos_policy.role_capability_decisions, append-only, audited)
//
// ════════════════════ THE PRECEDENCE RULE (deterministic, one line) ════════════════════
//
//     SYSTEM_INVARIANT  >  current ADMIN decision (GRANTED or REVOKED)  >  SYSTEM_DEFAULT
//
// A forbidden pair is absent whatever an administrator or a default says. Otherwise the CURRENT
// administrator decision wins: ADMIN_REVOKED keeps a default out (a catalog reconcile, an activation
// tool or a seed may never re-insert it), ADMIN_GRANTED keeps a non-default in (no default writer
// may delete it). With no decision, the system default stands.
//
// This is NOT per-Role withholding. No Role key appears below except in the SYSTEM INVARIANTS,
// which are Owner rulings (ruling A's Owner exclusions and the withheld technician Purchase Order
// cells) -- engine facts, not configuration, and deliberately not administrable.
import { OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES } from "../access/governedBusinessRoles";
import type { RoleCapabilityDecision } from "./types";

export interface RoleCapabilityCell {
  readonly roleKey: string;
  readonly capabilityKey: string;
}

const cellKey = (roleKey: string, capabilityKey: string): string => `${roleKey}\u0000${capabilityKey}`;

// ════════════════════ 2. SYSTEM INVARIANTS ════════════════════
//
// Owner rule (Pass 8): only PLATFORM_SAFETY and OWNER_GOVERNANCE rules may be immutable.
//
//   OWNER_GOVERNANCE  pairs the Owner has ruled no tenant may hold -- data-level, enforced on every
//                     Role grant, at the PRINCIPAL level (custom Role or direct grant to an owner
//                     holder), by every default writer, and reported as drift.
//   PLATFORM_SAFETY   engine rules, enforced by code and database, listed in PLATFORM_SAFETY_INVARIANTS.
//
// NOT immutable any more (LEGACY_BASELINE_ARTIFACT, Pass 8 review): owner x reorder.request.read.queue
// and technician x reorder.purchaseOrder.read/.create. The technician ruling withholds ACTIVATING a
// CONDITION on those cells, which CONDITIONABLE_GRANTS below preserves by never listing them.

export type InvariantClass = "OWNER_GOVERNANCE" | "PLATFORM_SAFETY";

export interface ForbiddenRoleCapabilityPair extends RoleCapabilityCell {
  readonly invariantClass: "OWNER_GOVERNANCE";
  /** The ruling that forbids it, so a refusal can say WHY in words an administrator can act on. */
  readonly ruling: string;
}

/** Capabilities the Owner Role -- and any PRINCIPAL holding it -- may never hold (Owner ruling A). */
export const OWNER_EXCLUDED_CAPABILITIES: readonly string[] = Object.freeze([
  ...OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES,
  "reorder.request.assign",
]);

/**
 * Pairs no tenant may hold. Derived from the constants that already carry the Owner rulings, never
 * re-typed, so a ruling edited in one place is enforced here without a second edit.
 */
export const FORBIDDEN_ROLE_CAPABILITY_PAIRS: readonly ForbiddenRoleCapabilityPair[] = Object.freeze(
  OWNER_EXCLUDED_CAPABILITIES.map((capabilityKey) => Object.freeze({
    roleKey: "owner", capabilityKey, invariantClass: "OWNER_GOVERNANCE" as const,
    ruling: capabilityKey === "reorder.request.assign"
      ? "Owner ruling A (2026-09-24): work coordination, not oversight -- excluded from the Owner"
      : "Owner ruling A (2026-09-24): an administrator-only capability the Owner must never hold",
  })),
);

/** The engine's own immutable rules, and where each is enforced. Read-only documentation of code. */
export const PLATFORM_SAFETY_INVARIANTS = Object.freeze([
  { key: "ANTI_LOCKOUT", invariantClass: "PLATFORM_SAFETY",
    rule: "the last principal the gate would admit for admin.securityPolicy.write or admin.roleAssignment.write is never removed",
    enforcedBy: "policyCommands (inside the tenant governance lock) -- WOULD_REMOVE_LAST_ADMINISTRATION_PATH" },
  { key: "ADMIN_NOT_CONDITIONABLE", invariantClass: "PLATFORM_SAFETY",
    rule: "no condition on an admin.* capability; only CONDITIONABLE_GRANTS may carry one",
    enforcedBy: "setGrantCondition / grantObjectActionToRole -- CONDITION_NOT_SUPPORTED" },
  { key: "NEVER_WIDEN_ON_RETIRE", invariantClass: "PLATFORM_SAFETY",
    rule: "an ACTIVE condition is never retired or deleted while its grant is held; conditioned-only keys never reach a flat capability set",
    enforcedBy: "capability_grant_conditions_never_widen trigger + grant-cell lock; resolveOperationalContext withholding" },
  { key: "APPEND_ONLY_AUDIT", invariantClass: "PLATFORM_SAFETY",
    rule: "audit_events and role_capability_decisions are never updated (bar the one-time supersede stamp), deleted or truncated",
    enforcedBy: "append-only row triggers + statement TRUNCATE triggers (migration 1762646400000)" },
] as const);

const FORBIDDEN = new Map(FORBIDDEN_ROLE_CAPABILITY_PAIRS.map((p) => [cellKey(p.roleKey, p.capabilityKey), p]));

/** The invariant a (Role, capability) pair violates, or null when it may be held. */
export function forbiddenPair(roleKey: string, capabilityKey: string): ForbiddenRoleCapabilityPair | null {
  return FORBIDDEN.get(cellKey(roleKey, capabilityKey)) ?? null;
}

/**
 * PRINCIPAL-LEVEL Owner governance: a principal holding the owner Role may not hold an excluded
 * capability through ANY path -- another Role or a direct grant. Returns the offending keys.
 */
export function ownerPrincipalViolations(heldRoleKeys: readonly string[], effectiveCapabilityKeys: Iterable<string>): readonly string[] {
  if (!heldRoleKeys.includes("owner")) return Object.freeze([]);
  const held = new Set(effectiveCapabilityKeys);
  return Object.freeze(OWNER_EXCLUDED_CAPABILITIES.filter((k) => held.has(k)).sort());
}

/**
 * The Administration write capabilities. Their gate reads the FLAT capability set, so a condition on
 * one would be decorative -- conditioning them is refused -- and removing the last holder of one
 * would leave the tenant unadministrable, so that is refused too (the anti-lockout guard).
 */
export const ADMINISTRATION_GOVERNING_CAPABILITIES: readonly string[] = Object.freeze([
  "admin.securityPolicy.write",
  "admin.roleAssignment.write",
]);

/**
 * THE CONDITION ALLOW-LIST: capability x recordKind that may carry a grant condition. A capability is
 * listed ONLY when every server gate consuming it evaluates entitlements (the entitled seam); a key a
 * flat-set gate reads would treat a conditioned grant as unconditional. Everything else is refused
 * (CONDITION_NOT_SUPPORTED) -- including the withheld technician Purchase Order cells.
 *
 * workOrder.record.read: no flat-set gate reads it; the Work Order record read is decided per record
 * by authorizeOperationalAction (technician RECORD_ASSIGNMENT, Pass 7 case D).
 */
export const CONDITIONABLE_GRANTS: readonly {
  readonly capabilityKey: string;
  readonly recordKinds: readonly string[];
  readonly kinds: readonly ("RECORD_ASSIGNMENT" | "WORK_ELIGIBILITY" | "OPERATIONAL_SCOPE")[];
}[] = Object.freeze([
  Object.freeze({ capabilityKey: "workOrder.record.read", recordKinds: Object.freeze(["workOrder"]),
    kinds: Object.freeze(["RECORD_ASSIGNMENT", "WORK_ELIGIBILITY", "OPERATIONAL_SCOPE"] as const) }),
]);

/**
 * The Operational Scope types a condition may name. Restated (not imported) because nothing outside
 * eosWorkforce may import it; administrationControlPlane.test.mjs proves it EQUALS
 * eosWorkforce/operationalScopeVocabulary OPERATIONAL_SCOPE_TYPES.
 */
export const CONDITION_OPERATIONAL_SCOPE_TYPES: readonly string[] = Object.freeze(["WAREHOUSE", "REORDER_QUEUE"]);

/** May this capability carry a condition at all? */
export const conditionIsEvaluableFor = (capabilityKey: string): boolean =>
  CONDITIONABLE_GRANTS.some((g) => g.capabilityKey === capabilityKey);

// ════════════════════ 3. PRECEDENCE ════════════════════

/**
 * ADMINISTRATION-GRANT-ONLY capabilities: registered, with NO system default. The Reorder lifecycle authority (Controller
 * ruling "REORDER LIFECYCLE AUTHORITY -- GO", 2026-09-28; migration 1763337600000) is registered in the current
 * Administration model and must be granted THROUGH Administration -- "do not seed legacy role grants".
 *
 * The compiled Role catalog still declares several of these keys on legacy Roles (admin, dispatcher, technician,
 * purchasingManager, generalManager, owner). Without this fence, the moment the keys became registered every default
 * writer (the catalog reconcile, the activation tool, the Sample Company seed) would import those legacy holders as
 * grants. With it, a catalog declaration of one of these keys is NOT a system default: the only way a Role holds one is
 * a current ADMIN_GRANTED decision, and until then every command requiring it fails closed.
 */
export const ADMINISTRATION_GRANT_ONLY_CAPABILITIES: ReadonlySet<string> = new Set([
  "reorder.request.approve",
  "reorder.request.reject",
  "reorder.request.startPurchasing",
  "reorder.request.postPurchasingUpdate",
  "reorder.request.markReceived",
  "reorder.request.cancel",
  "reorder.request.recordPurchaseOrder",
  "reorder.purchaseOrder.void",
  // Controller ruling DQ-011 (2026-09-28; migration 1763856000000): workOrder.parts.plan is registered with NO
  // default grant. The legacy catalog declares it on the compatibility admin Role (which composes the whole
  // PERMISSION_CATALOG) and on workOrderPartsPlanner, so without the fence the catalog reconcile would import it.
  // (DQ-010's workOrder.lifecycle.ready / .schedule / .close are NOT in PERMISSION_CATALOG, so no catalog
  // declaration can propose them; they need no fence entry.)
  "workOrder.parts.plan",
  // Controller ruling DQ-036(b) (2026-09-28; migration 1764129600000): acquire-existing-unit. The compiled catalog declares
  // it on admin (whole-catalog composition) and on inventorySerializedAssetAcquirer; neither is a default. Its Taylor
  // holders (Parts Associate, Parts Manager, Warehouse Associate, Warehouse Manager) are Administration grants.
  "inventory.serializedAsset.acquire",
]);

export type GrantAuthoritySource =
  | "SYSTEM_INVARIANT"
  | "ADMIN_GRANTED"
  | "ADMIN_REVOKED"
  | "SYSTEM_DEFAULT"
  | "NONE";

export interface CellResolution {
  /** Must this Role hold this capability in this tenant? */
  readonly shouldHold: boolean;
  /** Which rule decided it. */
  readonly source: GrantAuthoritySource;
}

/** THE precedence rule. Every writer and every verifier asks this and nothing else. */
export function resolveCell(input: {
  readonly roleKey: string;
  readonly capabilityKey: string;
  readonly decision: RoleCapabilityDecision | null;
  readonly isSystemDefault: boolean;
}): CellResolution {
  if (forbiddenPair(input.roleKey, input.capabilityKey)) {
    return Object.freeze({ shouldHold: false, source: "SYSTEM_INVARIANT" as const });
  }
  if (input.decision === "ADMIN_GRANTED") return Object.freeze({ shouldHold: true, source: "ADMIN_GRANTED" as const });
  if (input.decision === "ADMIN_REVOKED") return Object.freeze({ shouldHold: false, source: "ADMIN_REVOKED" as const });
  // No system default exists for an Administration-grant-only capability, whatever a catalog declares.
  if (ADMINISTRATION_GRANT_ONLY_CAPABILITIES.has(input.capabilityKey)) return Object.freeze({ shouldHold: false, source: "NONE" as const });
  if (CATALOG_DECLARATIONS_WITHOUT_SYSTEM_DEFAULT.has(cellKey(input.roleKey, input.capabilityKey))) return Object.freeze({ shouldHold: false, source: "NONE" as const });
  return input.isSystemDefault
    ? Object.freeze({ shouldHold: true, source: "SYSTEM_DEFAULT" as const })
    : Object.freeze({ shouldHold: false, source: "NONE" as const });
}

/**
 * LEGACY CATALOG DECLARATIONS THAT ARE NOT SYSTEM DEFAULTS -- Controller DQ-023 / DQ-037 (2026-09-28): reconciliation is
 * REPORT-ONLY for anything no accepted ruling established; only Administration changes governed authority.
 *
 * The compiled Role catalog (admin composes the whole legacy permission catalog) declares these eight (Role, capability)
 * PAIRS, but no migration, ruling or measured baseline establishes them: none is in the governed authority baseline
 * (roleCapabilityAuthorityBaseline), so a verifier already reads them as "no system default". Without this fence every
 * default writer (catalog reconcile --apply, the Sample Company seed) still INSERTED them. With it, a default writer
 * reports them (status ADMINISTRATION_ONLY) and never applies them; a Role holds one only through a current
 * ADMIN_GRANTED decision.
 *
 * PAIR-LEVEL, deliberately -- not a capability-key fence. The same keys ARE governed defaults for other Roles
 * (partsManager / reorder.request.assign; the purchaseOrder.create / .read holders), and a key-level fence would strip
 * default status from grants the baseline establishes. Nothing is revoked: an existing row is untouched.
 */
export const CATALOG_DECLARATIONS_WITHOUT_SYSTEM_DEFAULT: ReadonlySet<string> = new Set([
  ["admin", "reorder.request.assign"], ["admin", "reorder.request.read.queue"],
  ["dispatcher", "reorder.request.assign"], ["dispatcher", "reorder.request.read.queue"],
  ["partsManager", "reorder.request.read.queue"], ["purchasingManager", "reorder.request.read.queue"],
  ["technician", "reorder.purchaseOrder.create"], ["technician", "reorder.purchaseOrder.read"],
].map(([roleKey, capabilityKey]) => cellKey(roleKey, capabilityKey)));

export interface CurrentDecision extends RoleCapabilityCell {
  readonly decision: RoleCapabilityDecision;
}

/** Index the CURRENT decisions by cell. Two current decisions for one cell is a store defect. */
export function decisionIndex(decisions: readonly CurrentDecision[]): ReadonlyMap<string, RoleCapabilityDecision> {
  const map = new Map<string, RoleCapabilityDecision>();
  for (const d of decisions) {
    const key = cellKey(d.roleKey, d.capabilityKey);
    if (map.has(key)) throw new Error(`two current Administration decisions for ${d.roleKey}/${d.capabilityKey}`);
    map.set(key, d.decision);
  }
  return map;
}

/**
 * For a DEFAULT WRITER (catalog reconcile, activation tool, seed): may it insert this pair?
 * Only when the precedence rule says the pair should be held for a reason other than an admin grant
 * the writer is not making -- i.e. never over ADMIN_REVOKED and never a forbidden pair.
 */
export function defaultWriterMayInsert(
  decisions: ReadonlyMap<string, RoleCapabilityDecision>,
  roleKey: string,
  capabilityKey: string,
): { readonly allowed: boolean; readonly source: GrantAuthoritySource } {
  const resolution = resolveCell({
    roleKey, capabilityKey, decision: decisions.get(cellKey(roleKey, capabilityKey)) ?? null, isSystemDefault: true,
  });
  return Object.freeze({ allowed: resolution.shouldHold, source: resolution.source });
}

// ════════════════════ VERIFICATION: a live tenant against default ⊕ decisions ════════════════════

export interface TenantAuthorityVerification {
  /** SYSTEM INVARIANT violations. Always drift -- no decision can explain them. */
  readonly forbiddenPresent: readonly RoleCapabilityCell[];
  /** Held, not a default, explained by a current ADMIN_GRANTED decision. NOT drift. */
  readonly explainedByAdminGrant: readonly RoleCapabilityCell[];
  /** A default that is absent, explained by a current ADMIN_REVOKED decision. NOT drift. */
  readonly explainedByAdminRevoke: readonly RoleCapabilityCell[];
  /** Held, not a default, no decision: UNEXPLAINED (AN2 -- do not bless live drift). */
  readonly unexplainedExtra: readonly RoleCapabilityCell[];
  /** A default that is absent with no decision explaining it. */
  readonly missingDefault: readonly RoleCapabilityCell[];
  /** The store disagrees with its own decision: ADMIN_GRANTED but absent. */
  readonly adminGrantedMissing: readonly RoleCapabilityCell[];
  /** The store disagrees with its own decision: ADMIN_REVOKED but present. */
  readonly adminRevokedPresent: readonly RoleCapabilityCell[];
  /** PRINCIPAL-level Owner governance: an owner holder reaching an excluded key via any path. */
  readonly forbiddenPrincipalHoldings: readonly { readonly principalId: string; readonly capabilityKey: string }[];
  /** Every entry above that IS drift, flattened. Empty means the tenant is fully explained. */
  readonly drift: readonly (RoleCapabilityCell & { readonly kind: string })[];
}

/**
 * Explain every live grant and every absent default of one tenant.
 *
 * `systemDefault` is what the repository produces for this environment (e.g.
 * `nonprodAuthorityGrants()`); `live` is what the tenant holds; `decisions` are the CURRENT
 * Administration decisions. Forbidden-pair and structural checks are NOT weakened by a decision:
 * a forbidden pair that is present is drift whatever the decision table says.
 */
export function verifyTenantAuthority(input: {
  readonly systemDefault: readonly RoleCapabilityCell[];
  readonly live: readonly RoleCapabilityCell[];
  readonly decisions: readonly CurrentDecision[];
  /** Optional principal view: each principal's GLOBAL Role keys and unexpired direct capability keys. */
  readonly principals?: readonly { readonly principalId: string; readonly roleKeys: readonly string[];
    readonly directCapabilityKeys: readonly string[] }[];
}): TenantAuthorityVerification {
  const decisions = decisionIndex(input.decisions);
  const defaults = new Set(input.systemDefault.map((p) => cellKey(p.roleKey, p.capabilityKey)));
  const live = new Set(input.live.map((p) => cellKey(p.roleKey, p.capabilityKey)));
  const cells = new Map<string, RoleCapabilityCell>();
  for (const p of [...input.systemDefault, ...input.live, ...input.decisions]) {
    cells.set(cellKey(p.roleKey, p.capabilityKey), { roleKey: p.roleKey, capabilityKey: p.capabilityKey });
  }
  const out = {
    forbiddenPresent: [] as RoleCapabilityCell[], explainedByAdminGrant: [] as RoleCapabilityCell[],
    explainedByAdminRevoke: [] as RoleCapabilityCell[], unexplainedExtra: [] as RoleCapabilityCell[],
    missingDefault: [] as RoleCapabilityCell[], adminGrantedMissing: [] as RoleCapabilityCell[],
    adminRevokedPresent: [] as RoleCapabilityCell[],
  };
  const sorted = [...cells.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [key, cell] of sorted) {
    const held = live.has(key);
    const isDefault = defaults.has(key);
    const decision = decisions.get(key) ?? null;
    if (forbiddenPair(cell.roleKey, cell.capabilityKey)) {
      if (held) out.forbiddenPresent.push(cell);
      continue;
    }
    if (decision === "ADMIN_GRANTED") {
      if (!held) out.adminGrantedMissing.push(cell);
      else if (!isDefault) out.explainedByAdminGrant.push(cell);
      continue;
    }
    if (decision === "ADMIN_REVOKED") {
      if (held) out.adminRevokedPresent.push(cell);
      else if (isDefault) out.explainedByAdminRevoke.push(cell);
      continue;
    }
    if (held && !isDefault) out.unexplainedExtra.push(cell);
    if (!held && isDefault) out.missingDefault.push(cell);
  }
  const liveByRole = new Map<string, Set<string>>();
  for (const p of input.live) {
    if (!liveByRole.has(p.roleKey)) liveByRole.set(p.roleKey, new Set());
    liveByRole.get(p.roleKey)!.add(p.capabilityKey);
  }
  const forbiddenPrincipalHoldings: { principalId: string; capabilityKey: string }[] = [];
  for (const principal of input.principals ?? []) {
    const effective = new Set(principal.directCapabilityKeys);
    for (const roleKey of principal.roleKeys) for (const k of liveByRole.get(roleKey) ?? []) effective.add(k);
    for (const capabilityKey of ownerPrincipalViolations(principal.roleKeys, effective)) {
      forbiddenPrincipalHoldings.push({ principalId: principal.principalId, capabilityKey });
    }
  }
  const drift = [
    ...forbiddenPrincipalHoldings.map((h) => ({ roleKey: `principal:${h.principalId}`, capabilityKey: h.capabilityKey, kind: "FORBIDDEN_PRINCIPAL_HOLDING" })),
    ...out.forbiddenPresent.map((c) => ({ ...c, kind: "FORBIDDEN_PRESENT" })),
    ...out.unexplainedExtra.map((c) => ({ ...c, kind: "UNEXPLAINED_EXTRA" })),
    ...out.missingDefault.map((c) => ({ ...c, kind: "MISSING_DEFAULT" })),
    ...out.adminGrantedMissing.map((c) => ({ ...c, kind: "ADMIN_GRANTED_MISSING" })),
    ...out.adminRevokedPresent.map((c) => ({ ...c, kind: "ADMIN_REVOKED_PRESENT" })),
  ];
  const freeze = <T>(xs: T[]): readonly T[] => Object.freeze(xs.map((x) => Object.freeze(x)));
  return Object.freeze({
    forbiddenPresent: freeze(out.forbiddenPresent), explainedByAdminGrant: freeze(out.explainedByAdminGrant),
    explainedByAdminRevoke: freeze(out.explainedByAdminRevoke), unexplainedExtra: freeze(out.unexplainedExtra),
    missingDefault: freeze(out.missingDefault), adminGrantedMissing: freeze(out.adminGrantedMissing),
    adminRevokedPresent: freeze(out.adminRevokedPresent),
    forbiddenPrincipalHoldings: freeze(forbiddenPrincipalHoldings), drift: freeze(drift),
  });
}
