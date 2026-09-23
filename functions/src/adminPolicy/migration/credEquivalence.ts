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

/**
 * CRED-ONLY COMPARISON SCOPE. Exactly the four canonical CRED kinds are comparable.
 *
 * BUSINESS_ACTION and ADMIN_ACTION are NEVER counted as satisfying a CRED verb, and that is not a
 * technicality. `workOrder.lifecycle.cancel` is not DELETE -- cancelling a Work Order releases its
 * inventory commitment and leaves the record standing. `workOrder.transition` is not EDIT -- it
 * moves a state machine along edges the business defined, which is the opposite of arbitrary edit.
 * Letting either satisfy a CRED cell would report the model as equivalent while silently changing
 * what an administrator is granting.
 */
export const COMPARABLE_CRED_KINDS: ReadonlySet<string> = Object.freeze(new Set(["CREATE", "READ", "EDIT", "DELETE"]));

/**
 * (Object.verb) cells that are governed, but NOT by a CRED capability -- so they are excluded from
 * the comparison rather than scored against it. Each names the governed action that replaced the
 * generic verb, which is why the cell is not a gap.
 *
 * Measured, not assumed: every entry below was read from the Object's own `capabilitiesByVerb` in
 * policySeedSnapshot.json and confirmed to resolve to a BUSINESS_ACTION capability that exists.
 */
export const SEMANTIC_REPLACEMENTS: Readonly<Record<string, string>> = Object.freeze({
  "workOrder.E": "workOrder.transition and the lifecycle actions -- a Work Order changes by governed transition, never by generic edit",
  "salesOrder.C": "opportunity.createSalesOrder -- a Sales Order is created FROM an Opportunity",
  "inventoryAction.E": "inventory.cycleCount.submit / .reconcile / .cancel",
  "inventoryTransaction.E": "inventory.stock.receive -- the stock ledger is append-only",
  "receivingOrder.E": "inventory.stock.receive",
  "transferOrder.E": "inventory.transfer.dispatch / .receive / .cancel",
  // Registered as named acts by migration 1761609600000 rather than minted as generic CRUD.
  "invoice.C": "finance.invoice.issue -- an Invoice is ISSUED, not created",
  "invoice.E": "finance.adjustment.record -- an issued Invoice is immutable; adjustments are their own records",
  "payment.C": "finance.payment.apply",
  "payment.E": "finance.refund.record -- a Payment is immutable; refunds are their own records",
  "employee.E": "admin.userStatus.write / admin.credentialReset.initiate -- named administration acts, not a generic edit",
  // CROSS-OBJECT. The CRUD matrix governs "create an Inventory Adjustment" with
  // inventory.cycleCount.create, whose canonical Object is cycleCount -- an adjustment is raised BY
  // counting, not created on its own. The act is governed; it simply belongs to another Object.
  "inventoryAction.C": "inventory.cycleCount.create, whose Object is cycleCount -- an adjustment is raised by a count",
  "rolesPermissions.E": "admin.roleAssignment.write / admin.accessRequest.decide, plus the anti-lockout invariant",
});

/**
 * SECURITY POLICY BLOCKERS -- an Owner ruling about what the model should say.
 *
 * Empty today. Finance was the whole of this category and the Owner ruled it: a capability names
 * ONE Object, so `finance.read` split into `finance.invoice.read` and `finance.payment.read`, and
 * the four named Finance acts were registered as BUSINESS ACTIONS rather than minted as generic
 * create/edit. Kept as a named, empty category so the next one has somewhere to go.
 */
export const SECURITY_POLICY_BLOCKERS: Readonly<Record<string, string>> = Object.freeze({});

/**
 * SCOPE MODEL BLOCKERS -- the capability could be registered, but its GATE cannot be.
 *
 * These keys carry an `operationalRoleActive` condition in the governed Role catalog. Under the
 * accepted ConditionKind dispositions that Kind is BUSINESS_ELIGIBILITY_SCOPE -- answered by Work
 * Eligibility and Operational Scope, and explicitly never a security condition. `role_capabilities`
 * has no scope column and `capabilitiesForRoleKeys` returns a flat Set, so registering these flat
 * would silently drop the gate that limits them today. Registering them is a WIDENING, and the
 * Owner's instruction is not to flatten or broaden.
 *
 * REORDER_READ_SCOPE_MODEL_MISSING is exactly this: EOS cannot yet represent OWN vs QUEUE on a
 * capability grant.
 */
export const SCOPE_MODEL_BLOCKERS: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Cells where the capability EXISTS and the scope model can now carry the gate, but the grant is
 * deliberately withheld because the evidence that would justify it does not exist yet.
 *
 * technician's Purchase Order grants are conditioned on PARTS_ASSOCIATE. The qualification is now
 * governed vocabulary, but NO governed Employee holds it -- the five legacy holders live in the
 * Firestore employees collection and none of them is in eos_workforce.employees. Granting the plain
 * capability would drop the gate; granting it with an action-level eligibility predicate would
 * impose that gate on the eleven Roles that hold PO read UNCONDITIONED. Withholding reproduces
 * today's effective access exactly, and the grant follows the real employee migration.
 */
export const WITHHELD_PENDING_ELIGIBILITY_EVIDENCE: Readonly<Record<string, string>> = Object.freeze({
  "purchaseOrder.R": "technician's grant is conditioned on PARTS_OPERATIONS eligibility (the governed code for that legacy gate); no governed Employee holds it yet",
  "purchaseOrder.C": "technician's grant is conditioned on PARTS_OPERATIONS eligibility (the governed code for that legacy gate); no governed Employee holds it yet",
});

/**
 * DATA AUTHORITY MIGRATION BLOCKERS -- there is no PostgreSQL authority to govern.
 *
 * Registering a capability over an Object with no table would claim an enforcement that does not
 * exist. These wait on the domain's own migration, not on a security ruling.
 */
export const DATA_AUTHORITY_MIGRATION_BLOCKERS: Readonly<Record<string, string>> = Object.freeze({
  // manufacturer.R is GONE from this list: migration 1761782400000 built eos_ops.manufacturers and
  // split inventory.manufacturer.read out of the Catalog read, so the model and the tooling exist.
  // That is not a claim that Manufacturer is cut over -- the source collection holds ZERO documents
  // in the environment this workstation may read, nothing has been copied, and the client still
  // reads Firestore. See MANUFACTURER_REFERENCE_RECONCILIATION_REQUIRED.
  "notifications.R": "no PostgreSQL table; the CRUD matrix governs it with reorder.request.read.queue, which is not a notification authority at all",
  "dispatchSchedule.R": "no PostgreSQL table; governed by fulfillment.coordinatedVisit.read",
});

/**
 * WORKFORCE ELIGIBILITY DATA MIGRATION BLOCKER -- the model is complete, the DATA is not.
 *
 * PARTS_OPERATIONS exists as governed Work Eligibility vocabulary, and the contextual evaluator can
 * prove it. But the five legacy PARTS_ASSOCIATE holders are Firestore employees and
 * eos_workforce.employees is a disjoint synthetic population, so there are ZERO target assignments.
 *
 * This is NOT a scope-model blocker. It is an Employee data-migration and identity-reconciliation
 * dependency, and it is tracked separately so that closing the scope model is not mistaken for
 * closing the workforce data gap. operationalRoleActive stays un-retired until assignments exist.
 */
export const WORKFORCE_ELIGIBILITY_DATA_MIGRATION_BLOCKER = Object.freeze({
  qualification: "PARTS_OPERATIONS",
  legacyHolders: 5,
  targetAssignments: 0,
  reason: "the legacy and PostgreSQL Employee populations have disjoint identities; no governed Employee can receive the eligibility yet",
});

/** Every cell that blocks cutover, whatever the reason. */
export const CRED_POLICY_DECISION_CELLS: Readonly<Record<string, string>> = Object.freeze({
  ...SECURITY_POLICY_BLOCKERS, ...SCOPE_MODEL_BLOCKERS, ...DATA_AUTHORITY_MIGRATION_BLOCKERS,
  ...WITHHELD_PENDING_ELIGIBILITY_EVIDENCE,
});

export type EquivalenceVerdict =
  | "equivalent"
  | "missingInTarget"        // current allows, capability model does not
  | "extraInTarget"          // capability model allows, current does not
  | "ungovernedInTarget"     // no capability of that kind exists on the Object at all
  | "semanticReplacement"    // governed, but by a named action rather than a CRED verb
  | "policyDecisionRequired";// resolvable only by an Owner ruling, never by this tool

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
  /**
   * Which (objectKey -> verbs) the LEGACY CRED matrix actually governs, from each Object's own
   * `capabilitiesByVerb`. Supplied so the comparison can tell "the legacy model denies this" from
   * "the legacy model has no opinion about this".
   *
   * Without it, every canonical grant on an Object or verb the CRUD matrix never covered reads as
   * an OVERGRANT. Measured: seven such grants exist today -- admin.principalAccess.read on the new
   * `principal` Object, inventory.cycleCount.create on the new `cycleCount` Object,
   * employee.record.read, equipment.model.manage -- and not one of them is an overgrant. They are
   * capabilities on cells the CRUD matrix simply never had a column for.
   */
  readonly legacyGovernedVerbs?: ReadonlyMap<string, ReadonlySet<CredVerb>>;
}

export interface EquivalenceReport {
  readonly rows: readonly EquivalenceRow[];
  /** Cells actually compared: CRED kinds only, excluding semantic replacements. */
  readonly totalComparableCells: number;
  readonly equivalent: number;
  readonly missingInTarget: number;
  readonly extraInTarget: number;
  readonly conflict: number;
  readonly ungovernedInTarget: number;
  /** Governed by a named action instead of a CRED verb -- reported, never scored as a gap. */
  readonly semanticReplacement: number;
  /** Cells only an Owner ruling can settle. Blocks cutover; never guessed at. */
  readonly policyDecisionRequired: number;
  /** True only when every COMPARABLE CRED cell agrees and nothing awaits a ruling. */
  readonly cutoverSafe: boolean;
}

/** Cells the tool refuses to decide. Supplied by the caller from measured evidence. */
export type PolicyDecisionCells = ReadonlySet<string>;

const VERBS: readonly CredVerb[] = ["C", "R", "E", "D"];

export function measureCredEquivalence(
  input: EquivalenceInput,
  policyDecisionCells: PolicyDecisionCells = new Set(),
): EquivalenceReport {
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
        const cell = `${objectKey}.${verb}`;
        // OUTSIDE CRED SCOPE: the legacy matrix has no opinion here, so there is nothing to compare
        // against and a canonical grant is not an overgrant.
        if (input.legacyGovernedVerbs && !input.legacyGovernedVerbs.get(objectKey)?.has(verb)) continue;
        // ORDER MATTERS. A semantic replacement is not a gap at all, and a cell awaiting an Owner
        // ruling must not be scored as agreement or disagreement -- either would be a claim the
        // evidence does not support.
        const verdict: EquivalenceVerdict = SEMANTIC_REPLACEMENTS[cell] !== undefined ? "semanticReplacement"
          : policyDecisionCells.has(cell) ? "policyDecisionRequired"
            : cur && prop ? "equivalent"
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
  const semanticReplacement = count("semanticReplacement");
  const policyDecisionRequired = count("policyDecisionRequired");
  return Object.freeze({
    rows: Object.freeze(rows),
    totalComparableCells: rows.length - semanticReplacement,
    semanticReplacement,
    policyDecisionRequired,
    equivalent: count("equivalent"),
    missingInTarget,
    extraInTarget,
    // A CONFLICT is a row where both sides have an opinion and they differ. With positive-only
    // grants on both sides that is exactly missing + extra; it is reported separately because the
    // Owner's cutover gate names it, and collapsing it into one number would hide which direction
    // the disagreement runs.
    conflict: missingInTarget + extraInTarget,
    ungovernedInTarget,
    cutoverSafe: missingInTarget === 0 && extraInTarget === 0
      && ungovernedInTarget === 0 && policyDecisionRequired === 0,
  });
}
