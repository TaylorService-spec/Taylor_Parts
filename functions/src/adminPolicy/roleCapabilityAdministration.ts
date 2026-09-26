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
import {
  OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES,
  OWNER_EXCLUDED_NOT_AN_AUTHORITY,
} from "../access/governedBusinessRoles";
import { WITHHELD_CONDITIONED_CELLS } from "../eosOps/grantConditionPolicy";
import type { RoleCapabilityDecision } from "./types";

export interface RoleCapabilityCell {
  readonly roleKey: string;
  readonly capabilityKey: string;
}

const cellKey = (roleKey: string, capabilityKey: string): string => `${roleKey}\u0000${capabilityKey}`;

// ════════════════════ 2. SYSTEM INVARIANTS ════════════════════

export interface ForbiddenRoleCapabilityPair extends RoleCapabilityCell {
  /** The ruling that forbids it, so a refusal can say WHY in words an administrator can act on. */
  readonly ruling: string;
}

/**
 * Pairs no tenant may hold. Derived from the constants that already carry the Owner rulings, never
 * re-typed, so a ruling edited in one place is enforced here without a second edit.
 */
export const FORBIDDEN_ROLE_CAPABILITY_PAIRS: readonly ForbiddenRoleCapabilityPair[] = Object.freeze([
  ...OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES.map((capabilityKey) => Object.freeze({
    roleKey: "owner", capabilityKey,
    ruling: "Owner ruling A (2026-09-24): an administrator-only capability the Owner Role must never hold",
  })),
  ...OWNER_EXCLUDED_NOT_AN_AUTHORITY.map((capabilityKey) => Object.freeze({
    roleKey: "owner", capabilityKey,
    ruling: "Owner ruling A (2026-09-24): excluded from the Owner Role",
  })),
  ...WITHHELD_CONDITIONED_CELLS.map((capabilityKey) => Object.freeze({
    roleKey: "technician", capabilityKey,
    ruling: "Owner ruling (2026-09-24): the technician Purchase Order cells are WITHHELD",
  })),
]);

const FORBIDDEN = new Map(FORBIDDEN_ROLE_CAPABILITY_PAIRS.map((p) => [cellKey(p.roleKey, p.capabilityKey), p]));

/** The invariant a (Role, capability) pair violates, or null when it may be held. */
export function forbiddenPair(roleKey: string, capabilityKey: string): ForbiddenRoleCapabilityPair | null {
  return FORBIDDEN.get(cellKey(roleKey, capabilityKey)) ?? null;
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

/** Keys whose gate cannot evaluate a per-grant condition: every `admin.*` Administration key. */
export const conditionIsEvaluableFor = (capabilityKey: string): boolean => !capabilityKey.startsWith("admin.");

// ════════════════════ 3. PRECEDENCE ════════════════════

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
  return input.isSystemDefault
    ? Object.freeze({ shouldHold: true, source: "SYSTEM_DEFAULT" as const })
    : Object.freeze({ shouldHold: false, source: "NONE" as const });
}

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
  const drift = [
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
    adminRevokedPresent: freeze(out.adminRevokedPresent), drift: freeze(drift),
  });
}
