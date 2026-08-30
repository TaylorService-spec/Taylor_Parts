// EOS Ownership Model v1 — the TYPED OWNER shape and its derivations, trusted-side mirror of the
// client authority field-ops-app-vite/src/domain/typedOwner.js (Owner rulings D-1/D-2/D-3,
// 2026-08-30). See that file's header for the reasoning: why this composes rather than replaces
// the existing authorities, why the `USER` id namespace is the canonical Employee id (open item
// O-1), and which adjacent authorities are deliberately NOT read here.
//
// INERT, DERIVED, READ-NORMALIZED. No setter, no writer, no persistence. Parity with the client
// mirror is asserted by test/typedOwner.test.mjs against the same canonical case table.

import { isOperatingCompanyIdShape, resolveOperatingCompany } from "./operatingCompanyAuthority.js";

export const OWNER_TYPES = {
  USER: "USER",
  COMPANY: "COMPANY",
} as const;

export type OwnerType = (typeof OWNER_TYPES)[keyof typeof OWNER_TYPES];

export interface TypedOwner {
  readonly type: OwnerType;
  readonly id: string;
}

/** See the client mirror for why these four states, and why UNRESOLVED and OWNERLESS stay apart. */
export const OWNERSHIP_RESOLUTION = {
  RESOLVED: "RESOLVED",
  UNRESOLVED: "UNRESOLVED",
  AMBIGUOUS: "AMBIGUOUS",
  OWNERLESS: "OWNERLESS",
} as const;

export type OwnershipResolution = (typeof OWNERSHIP_RESOLUTION)[keyof typeof OWNERSHIP_RESOLUTION];

export interface OwnerDerivation {
  resolution: OwnershipResolution;
  owner: TypedOwner | null;
  reason: string | null;
}

const nonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** Shape guard. A typed owner is exactly two fields — extra keys are rejected. */
export function isTypedOwner(value: unknown): value is TypedOwner {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  if (keys.length !== 2 || !keys.includes("type") || !keys.includes("id")) return false;
  if (v.type === OWNER_TYPES.USER) return nonEmptyString(v.id);
  if (v.type === OWNER_TYPES.COMPANY) return isOperatingCompanyIdShape(v.id);
  return false;
}

/** The only constructor. Returns null when the inputs do not describe a typed owner. */
export function typedOwner(type: unknown, id: unknown): TypedOwner | null {
  const candidate = { type, id: typeof id === "string" ? id.trim() : id };
  return isTypedOwner(candidate) ? Object.freeze(candidate) : null;
}

const outcome = (resolution: OwnershipResolution, owner: TypedOwner | null, reason?: string): OwnerDerivation => ({
  resolution,
  owner,
  reason: reason ?? null,
});

/**
 * Account -> typed owner, projected from the EXISTING accountOwner map. Requires only the
 * assignee half: the seven-field completeness invariant governs WRITES, and holding a read to it
 * would miscount a legitimately-owned legacy Account as ownerless.
 */
export function deriveAccountOwner(accountDoc: Record<string, unknown> | null | undefined): OwnerDerivation {
  const map = accountDoc?.accountOwner;
  if (map === null || map === undefined) return outcome(OWNERSHIP_RESOLUTION.OWNERLESS, null, "no accountOwner");
  if (typeof map !== "object" || Array.isArray(map)) {
    return outcome(OWNERSHIP_RESOLUTION.UNRESOLVED, null, "accountOwner is not a map");
  }
  const employeeId = (map as Record<string, unknown>).assignedToEmployeeId;
  if (!nonEmptyString(employeeId)) {
    return outcome(OWNERSHIP_RESOLUTION.UNRESOLVED, null, "accountOwner has no assignedToEmployeeId");
  }
  const owner = typedOwner(OWNER_TYPES.USER, employeeId);
  return owner === null
    ? outcome(OWNERSHIP_RESOLUTION.UNRESOLVED, null, "assignedToEmployeeId is not a usable id")
    : outcome(OWNERSHIP_RESOLUTION.RESOLVED, owner);
}

/** Opportunity / Sales Order / Sales Agreement -> typed owner, projected from ownerEmployeeId. */
export function deriveEmployeeRefOwner(
  doc: Record<string, unknown> | null | undefined,
  field = "ownerEmployeeId",
): OwnerDerivation {
  const value = doc?.[field];
  if (value === null || value === undefined) return outcome(OWNERSHIP_RESOLUTION.OWNERLESS, null, `no ${field}`);
  if (!nonEmptyString(value)) {
    return outcome(OWNERSHIP_RESOLUTION.UNRESOLVED, null, `${field} is empty or not a string`);
  }
  const owner = typedOwner(OWNER_TYPES.USER, value);
  return owner === null
    ? outcome(OWNERSHIP_RESOLUTION.UNRESOLVED, null, `${field} is not a usable id`)
    : outcome(OWNERSHIP_RESOLUTION.RESOLVED, owner);
}

/**
 * A company-owned record -> typed owner. INACTIVE resolves: a record owned by a since-deactivated
 * company still HAS an owner, and calling it unresolved would invite a backfill to reassign it.
 */
export function deriveCompanyOwner(
  doc: Record<string, unknown> | null | undefined,
  field = "operatingCompanyId",
): OwnerDerivation {
  const value = doc?.[field];
  if (value === null || value === undefined) return outcome(OWNERSHIP_RESOLUTION.OWNERLESS, null, `no ${field}`);
  const { state } = resolveOperatingCompany(value);
  if (state === "INVALID") return outcome(OWNERSHIP_RESOLUTION.UNRESOLVED, null, `${field} is malformed`);
  if (state === "UNKNOWN") return outcome(OWNERSHIP_RESOLUTION.UNRESOLVED, null, `${field} names no seeded company`);
  const owner = typedOwner(OWNER_TYPES.COMPANY, value);
  return owner === null
    ? outcome(OWNERSHIP_RESOLUTION.UNRESOLVED, null, `${field} is not a usable id`)
    : outcome(OWNERSHIP_RESOLUTION.RESOLVED, owner);
}

/**
 * Combine the derivations that apply to one record. AMBIGUOUS when two RESOLVE to different
 * owners — the ruling forbids silently picking one. A single UNRESOLVED beside a RESOLVED is not
 * ambiguity: one field is broken, the other answers, and the broken one is still named.
 */
export function combineOwnerDerivations(outcomes: readonly (OwnerDerivation | null | undefined)[]): OwnerDerivation {
  const list = (outcomes ?? []).filter((o): o is OwnerDerivation => Boolean(o));
  if (list.length === 0) return outcome(OWNERSHIP_RESOLUTION.OWNERLESS, null, "no ownership-bearing field");

  const resolved = list.filter((o) => o.resolution === OWNERSHIP_RESOLUTION.RESOLVED);
  const distinct = new Set(resolved.map((o) => `${o.owner!.type}:${o.owner!.id}`));
  if (distinct.size > 1) {
    return outcome(OWNERSHIP_RESOLUTION.AMBIGUOUS, null, `conflicting owners: ${[...distinct].sort().join(", ")}`);
  }
  if (resolved.length > 0) {
    const broken = list
      .filter((o) => o.resolution === OWNERSHIP_RESOLUTION.UNRESOLVED)
      .map((o) => o.reason)
      .filter((r): r is string => Boolean(r));
    return outcome(OWNERSHIP_RESOLUTION.RESOLVED, resolved[0].owner, broken.length > 0 ? broken.join("; ") : undefined);
  }
  const unresolved = list.filter((o) => o.resolution === OWNERSHIP_RESOLUTION.UNRESOLVED);
  if (unresolved.length > 0) {
    return outcome(
      OWNERSHIP_RESOLUTION.UNRESOLVED,
      null,
      unresolved.map((o) => o.reason).filter(Boolean).join("; "),
    );
  }
  const reasons = list.map((o) => o.reason).filter((r): r is string => Boolean(r));
  return outcome(OWNERSHIP_RESOLUTION.OWNERLESS, null, reasons.length > 0 ? reasons.join("; ") : undefined);
}
