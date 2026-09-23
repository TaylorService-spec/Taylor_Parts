// CRED CONVERGENCE MEASUREMENT -- what would change if Object CRED were computed from capabilities?
//
// ════════════════════ WHAT role_object_permissions ACTUALLY IS ════════════════════
//
// It is NOT an independent authority. `policySeed.ts`'s `deriveObjectCred` computes each row from
// two inputs:
//
//     held                  the Role's permission ids, from the in-repo Role catalog
//     capabilitiesByVerb    the Object's per-verb capability list, from the frontend CRUD matrix
//
// So today's CRED is a STORED PROJECTION of a capability grant -- but of a grant expressed in the
// FIREBASE permission catalog (several hundred ids), not in eos_policy.capabilities (49). That is
// the whole reason this measurement exists rather than a migration: the two sides are projections
// of two different vocabularies, and the only honest way to learn whether they agree is to compute
// both and diff them per principal, per object, per verb.
//
// ════════════════════ WHY THIS REFUSES TO GUESS ════════════════════
//
// A verb with NO governing capability is UNGOVERNED -- nobody can hold it, which is different from
// "everybody is denied". The current resolver already distinguishes those two, and so does this: an
// ungoverned verb is reported separately and never counted as a difference, because "the target
// cannot express this" is not the same finding as "the target disagrees".
import type { CapabilityRecord, CredSet, CredVerb } from "../types";

export const CRED_VERB_KIND: Readonly<Record<CredVerb, string>> = Object.freeze({
  C: "CREATE", R: "READ", E: "EDIT", D: "DELETE",
});

export type EquivalenceVerdict =
  | "equivalent"
  | "missingInTarget"   // current allows, capability model does not
  | "extraInTarget"     // capability model allows, current does not
  | "ungovernedInTarget"; // no capability of that kind exists on the Object at all

export interface EquivalenceRow {
  readonly principalId: string;
  readonly objectKey: string;
  readonly verb: CredVerb;
  readonly current: boolean;
  readonly proposed: boolean;
  readonly verdict: EquivalenceVerdict;
}

export interface EquivalenceInput {
  /** Each principal and the Role ids of their ACTIVE assignments. */
  readonly principals: readonly { principalId: string; roleIds: readonly string[] }[];
  /** objectId -> objectKey, so CRED rows (which key by id) can meet capabilities (which key by key). */
  readonly objectKeyById: ReadonlyMap<string, string>;
  /** Current stored CRED: one row per (roleId, objectId). */
  readonly objectPermissions: readonly { roleId: string; objectId: string; cred: CredSet }[];
  readonly capabilities: readonly CapabilityRecord[];
  readonly roleCapabilities: readonly { roleId: string; capabilityId: string }[];
  readonly principalCapabilities: readonly { principalId: string; capabilityId: string }[];
}

export interface EquivalenceReport {
  readonly rows: readonly EquivalenceRow[];
  readonly equivalent: number;
  readonly missingInTarget: number;
  readonly extraInTarget: number;
  readonly conflict: number;
  readonly ungovernedInTarget: number;
  /** True only when the capability model reproduces current access exactly. */
  readonly cutoverSafe: boolean;
}

const VERBS: readonly CredVerb[] = ["C", "R", "E", "D"];

export function measureCredEquivalence(input: EquivalenceInput): EquivalenceReport {
  const capById = new Map(input.capabilities.map((c) => [c.id, c]));
  const kindsByObject = new Map<string, Set<string>>();
  for (const c of input.capabilities) {
    if (!kindsByObject.has(c.objectKey)) kindsByObject.set(c.objectKey, new Set());
    kindsByObject.get(c.objectKey)!.add(c.actionKind);
  }
  const capsByRole = new Map<string, string[]>();
  for (const g of input.roleCapabilities) {
    if (!capsByRole.has(g.roleId)) capsByRole.set(g.roleId, []);
    capsByRole.get(g.roleId)!.push(g.capabilityId);
  }
  const directByPrincipal = new Map<string, string[]>();
  for (const g of input.principalCapabilities) {
    if (!directByPrincipal.has(g.principalId)) directByPrincipal.set(g.principalId, []);
    directByPrincipal.get(g.principalId)!.push(g.capabilityId);
  }

  const objectKeys = [...new Set(input.objectKeyById.values())].sort();
  const rows: EquivalenceRow[] = [];

  for (const p of input.principals) {
    // CURRENT: the union of every Role's stored CRED, exactly as effectiveObjectAccess.ts unions it.
    const currentByObject = new Map<string, Record<CredVerb, boolean>>();
    for (const perm of input.objectPermissions) {
      if (!p.roleIds.includes(perm.roleId)) continue;
      const key = input.objectKeyById.get(perm.objectId);
      if (!key) continue;
      const acc = currentByObject.get(key) ?? { C: false, R: false, E: false, D: false };
      for (const v of VERBS) acc[v] = acc[v] || perm.cred[v] === true;
      currentByObject.set(key, acc);
    }

    // PROPOSED: the capability union -- role-derived plus direct -- projected back to verbs.
    const heldCapIds = new Set<string>([
      ...p.roleIds.flatMap((r) => capsByRole.get(r) ?? []),
      ...(directByPrincipal.get(p.principalId) ?? []),
    ]);
    const proposedByObject = new Map<string, Set<string>>();
    for (const id of heldCapIds) {
      const cap = capById.get(id);
      if (!cap) continue;
      if (!proposedByObject.has(cap.objectKey)) proposedByObject.set(cap.objectKey, new Set());
      proposedByObject.get(cap.objectKey)!.add(cap.actionKind);
    }

    for (const objectKey of objectKeys) {
      const current = currentByObject.get(objectKey) ?? { C: false, R: false, E: false, D: false };
      const proposedKinds = proposedByObject.get(objectKey) ?? new Set<string>();
      const governedKinds = kindsByObject.get(objectKey) ?? new Set<string>();
      for (const verb of VERBS) {
        const kind = CRED_VERB_KIND[verb];
        const cur = current[verb] === true;
        const prop = proposedKinds.has(kind);
        // An UNGOVERNED verb is reported, never scored as a disagreement: the target cannot express
        // it at all, which is a different finding from the target answering differently.
        const ungoverned = !governedKinds.has(kind);
        if (!cur && !prop && !ungoverned) continue; // both deny a governed verb: nothing to report
        if (!cur && !prop && ungoverned) continue;  // nobody had it and nothing governs it
        const verdict: EquivalenceVerdict = cur && prop ? "equivalent"
          : cur && ungoverned ? "ungovernedInTarget"
            : cur ? "missingInTarget"
              : "extraInTarget";
        rows.push(Object.freeze({ principalId: p.principalId, objectKey, verb, current: cur, proposed: prop, verdict }));
      }
    }
  }

  const count = (v: EquivalenceVerdict) => rows.filter((r) => r.verdict === v).length;
  const missingInTarget = count("missingInTarget");
  const extraInTarget = count("extraInTarget");
  const ungovernedInTarget = count("ungovernedInTarget");
  return Object.freeze({
    rows: Object.freeze(rows),
    equivalent: count("equivalent"),
    missingInTarget,
    extraInTarget,
    // A CONFLICT is a row where both sides have an opinion and they differ. With positive-only
    // grants on both sides that is exactly missing + extra; it is reported separately because the
    // Owner's cutover gate names it, and collapsing it into one number would hide which direction
    // the disagreement runs.
    conflict: missingInTarget + extraInTarget,
    ungovernedInTarget,
    cutoverSafe: missingInTarget === 0 && extraInTarget === 0 && ungovernedInTarget === 0,
  });
}
