"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRED_POLICY_DECISION_CELLS = exports.COORDINATED_VISIT_RUNTIME_CUTOVER_BLOCKER = exports.WORKFORCE_ELIGIBILITY_DATA_MIGRATION_BLOCKER = exports.DATA_AUTHORITY_MIGRATION_BLOCKERS = exports.WITHHELD_PENDING_ELIGIBILITY_EVIDENCE = exports.SCOPE_MODEL_BLOCKERS = exports.SECURITY_POLICY_BLOCKERS = exports.SEMANTIC_REPLACEMENTS = exports.COMPARABLE_CRED_KINDS = exports.CRED_VERB_KIND = void 0;
exports.measureCredEquivalence = measureCredEquivalence;
exports.CRED_VERB_KIND = Object.freeze({
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
exports.COMPARABLE_CRED_KINDS = Object.freeze(new Set(["CREATE", "READ", "EDIT", "DELETE"]));
/**
 * (Object.verb) cells that are governed, but NOT by a CRED capability -- so they are excluded from
 * the comparison rather than scored against it. Each names the governed action that replaced the
 * generic verb, which is why the cell is not a gap.
 *
 * Measured, not assumed: every entry below was read from the Object's own `capabilitiesByVerb` in
 * policySeedSnapshot.json and confirmed to resolve to a BUSINESS_ACTION capability that exists.
 */
exports.SEMANTIC_REPLACEMENTS = Object.freeze({
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
exports.SECURITY_POLICY_BLOCKERS = Object.freeze({});
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
exports.SCOPE_MODEL_BLOCKERS = Object.freeze({});
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
exports.WITHHELD_PENDING_ELIGIBILITY_EVIDENCE = Object.freeze({
    "purchaseOrder.R": "technician's grant is conditioned on PARTS_OPERATIONS eligibility (the governed code for that legacy gate); no governed Employee holds it yet",
    "purchaseOrder.C": "technician's grant is conditioned on PARTS_OPERATIONS eligibility (the governed code for that legacy gate); no governed Employee holds it yet",
});
/**
 * DATA AUTHORITY MIGRATION BLOCKERS -- there is no PostgreSQL authority to govern.
 *
 * Registering a capability over an Object with no table would claim an enforcement that does not
 * exist. These wait on the domain's own migration, not on a security ruling.
 */
exports.DATA_AUTHORITY_MIGRATION_BLOCKERS = Object.freeze({
// manufacturer.R is GONE from this list: migration 1761782400000 built eos_ops.manufacturers and
// split inventory.manufacturer.read out of the Catalog read, so the model and the tooling exist.
// That is not a claim that Manufacturer is cut over -- the source collection holds ZERO documents
// in the environment this workstation may read, nothing has been copied, and the client still
// reads Firestore. See MANUFACTURER_REFERENCE_RECONCILIATION_REQUIRED.
//
// notifications.R and dispatchSchedule.R are GONE from this list, and NOT because a table was
// built for them (Owner ruling 2026-09-23, migration 1761955200000). Both Objects were retired:
// each described a data authority that does not exist -- no table, no collection, no document, no
// field -- so the honest resolution was to stop governing a record that is not there, not to
// manufacture one. Their CRED cells are not "resolved", they are no longer cells.
//
// What survived is the one capability that governs something real:
// `fulfillment.coordinatedVisit.read`, re-homed onto the Sales Order as the BUSINESS_ACTION
// `readCoordinatedVisits`. Notification recipient visibility got NO successor capability -- it is
// a property of the underlying record, never a Security Role -- and `reorder.request.read.queue`
// stays exactly where it was, in its SUPERSEDED posture on the Reorder Request.
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
exports.WORKFORCE_ELIGIBILITY_DATA_MIGRATION_BLOCKER = Object.freeze({
    qualification: "PARTS_OPERATIONS",
    legacyHolders: 5,
    targetAssignments: 0,
    reason: "the legacy and PostgreSQL Employee populations have disjoint identities; no governed Employee can receive the eligibility yet",
});
/**
 * COORDINATED VISIT RUNTIME CUTOVER BLOCKER -- the AUTHORITY moved, the READ did not.
 *
 * `fulfillment.coordinatedVisit.read` is now governed under salesOrder as the BUSINESS_ACTION
 * `readCoordinatedVisits` (migration 1761955200000). What it governs has NOT moved:
 * `listCoordinatedOperations` still reads the legacy `fieldops_wos` collection through
 * `coordinatedVisitReadService.ts`, and the projection is assembled there.
 *
 * Tracked as its own named blocker rather than folded into a CRED cell, because it is not one: the
 * capability is a business act, BUSINESS_ACTION is excluded from COMPARABLE_CRED_KINDS, and no CRED
 * cell is waiting on it. Governing an act in PostgreSQL while the read it governs still reaches the
 * old backend is a real gap, and this is where it is written down instead of implied by silence.
 *
 * THE TARGET-SIDE READ NOW EXISTS AND IS PROVEN AT PARITY (`postgresSeam` below,
 * test/coordinatedVisitPostgresParity.test.mjs). That does NOT close this blocker: the seam is
 * reached by no callable, transport or client, so the capability still governs a read that reaches
 * `fieldops_wos`. `remaining` is what is actually left, stated so nobody reads "a seam exists" as
 * "the read moved".
 */
exports.COORDINATED_VISIT_RUNTIME_CUTOVER_BLOCKER = Object.freeze({
    capability: "fulfillment.coordinatedVisit.read",
    objectKey: "salesOrder",
    actionKey: "readCoordinatedVisits",
    readService: "functions/src/fulfillment/coordinatedVisitReadService.ts",
    sourceCollection: "fieldops_wos",
    // NAMES THE COLLECTION, NOT THE VENDOR -- and not only to satisfy the no-Firebase guard on this
    // module. `fieldops_wos` is the thing a reader has to go and look at; "the old backend" is not.
    reason: "the capability is governed in PostgreSQL, but listCoordinatedOperations still reads the legacy fieldops_wos collection; moving that read is a separately authorized slice",
    /** The governed PostgreSQL read that reproduces the projection. Built and parity-proven; wired to nothing. */
    postgresSeam: "functions/src/eosOps/coordinatedVisitPostgresRead.ts",
    parityProof: "functions/test/coordinatedVisitPostgresParity.test.mjs",
    // NAMES THE MECHANISM, NOT THE VENDOR, for the same reason `sourceCollection` does.
    remaining: "the client read is switched to the seam on the Commercial transport (Work Order cutover completion pass, 2026-09-30: an EOS Principal caller, eos_ops.work_orders with the pinned quarantine excluded); what is left is retiring the undeployed legacy listCoordinatedOperations callable with the final legacy retirement",
});
/** Every cell that blocks cutover, whatever the reason. */
exports.CRED_POLICY_DECISION_CELLS = Object.freeze({
    ...exports.SECURITY_POLICY_BLOCKERS, ...exports.SCOPE_MODEL_BLOCKERS, ...exports.DATA_AUTHORITY_MIGRATION_BLOCKERS,
    ...exports.WITHHELD_PENDING_ELIGIBILITY_EVIDENCE,
});
const VERBS = ["C", "R", "E", "D"];
function measureCredEquivalence(input, policyDecisionCells = new Set()) {
    const capById = new Map(input.capabilities.map((c) => [c.id, c]));
    const kindsByObject = new Map();
    for (const c of input.capabilities) {
        if (!kindsByObject.has(c.objectKey))
            kindsByObject.set(c.objectKey, new Set());
        kindsByObject.get(c.objectKey).add(c.actionKind);
    }
    const capsByRole = new Map();
    for (const g of input.roleCapabilities) {
        if (!capsByRole.has(g.roleId))
            capsByRole.set(g.roleId, []);
        capsByRole.get(g.roleId).push(g.capabilityId);
    }
    const directByPrincipal = new Map();
    for (const g of input.principalCapabilities) {
        if (!directByPrincipal.has(g.principalId))
            directByPrincipal.set(g.principalId, []);
        directByPrincipal.get(g.principalId).push(g.capabilityId);
    }
    const objectKeys = [...new Set(input.objectKeyById.values())].sort();
    const rows = [];
    for (const p of input.principals) {
        // CURRENT: the union of every Role's stored CRED, exactly as effectiveObjectAccess.ts unions it.
        const currentByObject = new Map();
        for (const perm of input.objectPermissions) {
            if (!p.roleIds.includes(perm.roleId))
                continue;
            const key = input.objectKeyById.get(perm.objectId);
            if (!key)
                continue;
            const acc = currentByObject.get(key) ?? { C: false, R: false, E: false, D: false };
            for (const v of VERBS)
                acc[v] = acc[v] || perm.cred[v] === true;
            currentByObject.set(key, acc);
        }
        // PROPOSED: the capability union -- role-derived plus direct -- projected back to verbs.
        const heldCapIds = new Set([
            ...p.roleIds.flatMap((r) => capsByRole.get(r) ?? []),
            ...(directByPrincipal.get(p.principalId) ?? []),
        ]);
        const proposedByObject = new Map();
        for (const id of heldCapIds) {
            const cap = capById.get(id);
            if (!cap)
                continue;
            if (!proposedByObject.has(cap.objectKey))
                proposedByObject.set(cap.objectKey, new Set());
            proposedByObject.get(cap.objectKey).add(cap.actionKind);
        }
        for (const objectKey of objectKeys) {
            const current = currentByObject.get(objectKey) ?? { C: false, R: false, E: false, D: false };
            const proposedKinds = proposedByObject.get(objectKey) ?? new Set();
            const governedKinds = kindsByObject.get(objectKey) ?? new Set();
            for (const verb of VERBS) {
                const kind = exports.CRED_VERB_KIND[verb];
                const cur = current[verb] === true;
                const prop = proposedKinds.has(kind);
                // An UNGOVERNED verb is reported, never scored as a disagreement: the target cannot express
                // it at all, which is a different finding from the target answering differently.
                const ungoverned = !governedKinds.has(kind);
                if (!cur && !prop && !ungoverned)
                    continue; // both deny a governed verb: nothing to report
                if (!cur && !prop && ungoverned)
                    continue; // nobody had it and nothing governs it
                const cell = `${objectKey}.${verb}`;
                // OUTSIDE CRED SCOPE: the legacy matrix has no opinion here, so there is nothing to compare
                // against and a canonical grant is not an overgrant.
                if (input.legacyGovernedVerbs && !input.legacyGovernedVerbs.get(objectKey)?.has(verb))
                    continue;
                // ORDER MATTERS. A semantic replacement is not a gap at all, and a cell awaiting an Owner
                // ruling must not be scored as agreement or disagreement -- either would be a claim the
                // evidence does not support.
                const verdict = exports.SEMANTIC_REPLACEMENTS[cell] !== undefined ? "semanticReplacement"
                    : policyDecisionCells.has(cell) ? "policyDecisionRequired"
                        : cur && prop ? "equivalent"
                            : cur && ungoverned ? "ungovernedInTarget"
                                : cur ? "missingInTarget"
                                    : "extraInTarget";
                rows.push(Object.freeze({ principalId: p.principalId, objectKey, verb, current: cur, proposed: prop, verdict }));
            }
        }
    }
    const count = (v) => rows.filter((r) => r.verdict === v).length;
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
//# sourceMappingURL=credEquivalence.js.map