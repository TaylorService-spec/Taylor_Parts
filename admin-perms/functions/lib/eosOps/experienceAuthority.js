"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXPERIENCE_SURFACE_KEYS = exports.EXPERIENCE_SURFACE_GAPS = exports.EXPERIENCE_SURFACES = void 0;
exports.experienceSurfaceGapViolations = experienceSurfaceGapViolations;
exports.grantedSurfaceKeys = grantedSurfaceKeys;
exports.resolveExperienceContext = resolveExperienceContext;
exports.surfaceCatalogViolations = surfaceCatalogViolations;
exports.surfaceCatalogCapabilityKeys = surfaceCatalogCapabilityKeys;
const capabilityAuthority_1 = require("./capabilityAuthority");
const entitledActionAuthority_1 = require("./entitledActionAuthority");
const contextualAuthorization_1 = require("./contextualAuthorization");
const surface = (key, label, grants) => Object.freeze({ key, label, grants: Object.freeze(grants.map((g) => Object.freeze(g))) });
/** A surface earned ONLY by reaching one of `children`. No grant path, so nothing opens it directly. */
const container = (key, label, children) => Object.freeze({ key, label, grants: Object.freeze([]), containerOf: Object.freeze([...children]) });
const WORK_ELIGIBILITY = (qualificationCode) => Object.freeze({ kind: "WORK_ELIGIBILITY", qualificationCode });
/** Scope with NO scopeId: the navigation-grain question is "may you work in ANY warehouse/queue at all". */
const OPERATIONAL_SCOPE = (scopeType) => Object.freeze({ kind: "OPERATIONAL_SCOPE", scopeType });
/**
 * THE SURFACE CATALOG.
 *
 * Every `capabilityKey` below is an id that `eos_policy.capabilities` already declares -- asserted
 * against the real table by experienceAuthorityPostgres.test.mjs, so a surface cannot be invented by
 * naming a capability that does not exist.
 *
 * The predicates are not new policy either. Each mirrors a ruling that is already in a migration or
 * already asserted by the persona authority manifest:
 *   - REORDER_QUEUE scope on the queue        migration 1761696000000, ruling 2 (CX-03 / CX-04)
 *   - WAREHOUSE_OPERATIONS + WAREHOUSE scope  personaAuthorityDimensions.v1 CX-11 / CX-12
 *   - SERVICE_TECHNICIAN on own field work    employee_work_eligibility's founding vocabulary
 * Nothing here narrows a capability that the governed model does not already narrow.
 */
exports.EXPERIENCE_SURFACES = Object.freeze([
    // ── Service
    surface("service.workOrders", "Work Orders", [
        { capabilityKey: "workOrder.create" },
        { capabilityKey: "workOrder.transition" },
        { capabilityKey: "workOrder.lifecycle.dispatch" },
    ]),
    surface("service.dispatch", "Dispatch", [{ capabilityKey: "workOrder.lifecycle.dispatch" }]),
    surface("service.coordinatedVisits", "Coordinated Visits", [
        { capabilityKey: "fulfillment.coordinatedVisit.read" },
    ]),
    // Inbound Work review (Work Order cutover activation, 2026-09-30): earned by the governed PostgreSQL read
    // capability, replacing the Firebase-feed gate on service.inboundWork.read.
    surface("service.inboundWork", "Inbound Work", [{ capabilityKey: "inboundWork.request.read" }]),
    // The technician's OWN work. The capability alone is not the surface: the governed model says field
    // work needs the SERVICE_TECHNICIAN qualification, and that is a different authority from the Role.
    surface("field.myWorkOrders", "My Work Orders", [
        { capabilityKey: "workOrder.transition", predicates: [WORK_ELIGIBILITY("SERVICE_TECHNICIAN")] },
    ]),
    // ── CRM / Commercial
    surface("crm.accounts", "Customers", [{ capabilityKey: "customer.record.read" }]),
    surface("commercial.opportunities", "Opportunities", [{ capabilityKey: "opportunity.read" }]),
    surface("commercial.salesOrders", "Sales Orders", [{ capabilityKey: "salesOrder.read" }]),
    // SALES AGREEMENTS -- DECLARED NOW, ON THE READ THAT ALREADY GOVERNED IT, WITH A DOOR BUILT IN THE
    // SAME CHANGE (Owner ruling D, Wave 16 / Lane BQ).
    //
    // This key was `EXPERIENCE_SURFACE_GAPS["commercial.agreements"]`, kind DESTINATION, and that gap
    // has been DELETED rather than rewritten -- the same treatment the Wave 9 / Lane AH note below
    // gives the Administration entries, for the same reason: a gap whose stated reason is no longer
    // true is not a gap. Lane BL corrected that entry from a VOCABULARY claim ("No salesAgreement.*
    // capability is registered") that was measurably FALSE to a DESTINATION one -- "the authority is
    // here, the door is not" -- and deliberately did not build the door, because building it is an
    // Owner product decision. The Owner has now made it.
    //
    // NO NEW CAPABILITY AND NO NEW GRANT. `salesAgreement.read` is registered under Object
    // `salesAgreement` and is held by admin, dispatcher, generalManager, owner, salesManager and
    // salesperson (6 grants; measured read-only in nonprod 2026-09-24 and reproduced from
    // adminPolicy/seed/roleCapabilityAuthorityBaseline.json, which experienceAuthority.test.mjs pins).
    // Nothing about who holds it moved. What moved is that the product now has somewhere to offer it.
    //
    // THE READ, NEVER A WRITE. `.create`, `.updateDraft` and `.accept` are deliberately not grant
    // paths here -- the same rule the Administration block states about `admin.roleAssignment.write`.
    // An index is a read; gating it on a write would mean a reader could not read and a writer could
    // not be told apart from a reader. The governed cross-account read behind the door is
    // `listSalesAgreements` (eosCommercial/reads/salesAgreementReadProjection.ts, exposed by
    // commercialHttp.ts), capability-scoped on this exact key -- so the door and the data answer to
    // one authority rather than to two that can drift.
    //
    // NO PREDICATE. A Sales Agreement is a commercial record, not field work and not warehouse work:
    // the governed model attaches no Work Eligibility and no Operational Scope to reading one, and
    // inventing one here would be this file deciding policy rather than projecting it.
    surface("commercial.agreements", "Sales Agreements", [{ capabilityKey: "salesAgreement.read" }]),
    // ── Inventory
    surface("inventory.catalog", "Parts Catalog", [{ capabilityKey: "inventory.catalog.read" }]),
    surface("inventory.catalogAdmin", "Catalog Admin", [
        { capabilityKey: "inventory.catalog.manage" },
        { capabilityKey: "inventory.catalog.activate" },
    ]),
    surface("inventory.balances", "Stock Position", [
        { capabilityKey: "inventory.transaction.read" },
        { capabilityKey: "inventory.action.read" },
    ]),
    surface("inventory.transfers", "Transfers", [
        { capabilityKey: "inventory.transfer.create" },
        { capabilityKey: "inventory.transfer.dispatch" },
        { capabilityKey: "inventory.transfer.receive" },
        { capabilityKey: "warehouse.transferOrder.read" },
    ]),
    surface("inventory.cycleCount.count", "Cycle Counting", [
        {
            capabilityKey: "inventory.cycleCount.create",
            predicates: [WORK_ELIGIBILITY("WAREHOUSE_OPERATIONS"), OPERATIONAL_SCOPE("WAREHOUSE")],
        },
    ]),
    surface("inventory.cycleCount.review", "Cycle Count Review", [
        {
            capabilityKey: "inventory.cycleCount.reconcile",
            predicates: [WORK_ELIGIBILITY("WAREHOUSE_OPERATIONS"), OPERATIONAL_SCOPE("WAREHOUSE")],
        },
    ]),
    // TWO PATHS, NEITHER IMPLYING THE OTHER. The dedicated queue capability reaches it outright; the
    // unscoped read reaches it only with the governed REORDER_QUEUE scope. That is migration
    // 1761696000000's ruling 2, projected -- not re-decided.
    surface("inventory.reorderQueue", "Reorder Queue", [
        { capabilityKey: "reorder.request.read.queue" },
        { capabilityKey: "reorder.request.read", predicates: [OPERATIONAL_SCOPE("REORDER_QUEUE")] },
    ]),
    surface("receiving.checkIn", "Receiving", [{ capabilityKey: "inventory.stock.receive" }]),
    surface("warehouse.management", "Warehouses", [
        { capabilityKey: "warehouse.record.read", predicates: [OPERATIONAL_SCOPE("WAREHOUSE")] },
    ]),
    surface("warehouse.picking", "Warehouse Workspace", [
        { capabilityKey: "inventory.placement.record", predicates: [OPERATIONAL_SCOPE("WAREHOUSE")] },
        { capabilityKey: "inventory.stock.relocate", predicates: [OPERATIONAL_SCOPE("WAREHOUSE")] },
    ]),
    // ── Purchasing
    surface("purchasing.purchaseOrders", "Purchase Orders", [{ capabilityKey: "reorder.purchaseOrder.read" }]),
    // The Supplier master read moved to PostgreSQL (eos_ops.suppliers, supplier.record.read -- PARTS / PURCHASING /
    // RECEIVING RULINGS, 2026-10-01), which closed the purchasing.suppliers VOCABULARY gap; the door already existed.
    surface("purchasing.suppliers", "Suppliers", [{ capabilityKey: "supplier.record.read" }]),
    // ── Equipment
    // EQUIPMENT ACTIVATION (Controller OD-3, 2026-10-01): the register door is earned by the REGISTER authority. Installing
    // is not browsing: equipment.install opens no register (a Technician installs on the assigned INSTALL Work Order and
    // reads only that Work Order's Equipment). A seller's channel-scoped read is reached through the customer, not this door.
    surface("equipment.register", "Equipment", [
        { capabilityKey: "equipment.record.read" },
        { capabilityKey: "equipment.record.manage" },
        { capabilityKey: "equipment.model.manage" },
        { capabilityKey: "equipment.compatibility.view" },
    ]),
    // ── Rental (DECISIONS #207): the workspace door is earned by the rental READ only; every command is its own key.
    surface("rental.workspace", "Rental", [{ capabilityKey: "rental.agreement.read" }]),
    // ── Analysis & Reporting (DECISIONS #208): the door opens for anyone holding a read a measure is decided on (or the report
    // catalog read). It confers NO data: each measure is decided again on its own read capability inside the workspace.
    surface("analysis.workspace", "Analysis", [
        { capabilityKey: "finance.payment.read" }, { capabilityKey: "opportunity.read" }, { capabilityKey: "salesOrder.read" },
        { capabilityKey: "workOrder.record.read" }, { capabilityKey: "reorder.purchaseOrder.read" }, { capabilityKey: "reorder.request.read" },
        { capabilityKey: "receivingOrder.record.read" }, { capabilityKey: "inventory.transaction.read" }, { capabilityKey: "rental.agreement.read" },
        { capabilityKey: "reportDefinition.read" },
    ]),
    // ── Financials
    surface("financials.invoices", "Invoices", [{ capabilityKey: "finance.invoice.read" }]),
    surface("financials.payments", "Payments", [{ capabilityKey: "finance.payment.read" }]),
    // ── Administration
    surface("administration.users", "Users & Employees", [
        { capabilityKey: "admin.principalAccess.read" },
        { capabilityKey: "employee.record.read" },
    ]),
    surface("administration.dataImport", "Data Import", [{ capabilityKey: "admin.dataImport.execute" }]),
    surface("administration.auditLogs", "Audit Logs", [{ capabilityKey: "audit.event.read" }]),
    // ── Administration: the governed-configuration half (Owner ruling, Wave 9 / Lane AH)
    //
    // THESE WERE DECLARED GAPS AND ARE NOT ANY MORE, and exactly one thing changed: the READ
    // capability the gap text said did not exist now does. `admin.securityPolicy.read` and
    // `workflowDefinition.read` are registered in eos_policy.capabilities and granted to `admin` and
    // `owner` (measured read-only in nonprod 2026-09-24, 2 roles each). The gap entries below were
    // removed rather than rewritten, because a gap whose stated reason is false is not a gap.
    //
    // THE AUTHORITY IS THE OBJECT'S OWN READ, NEVER A WRITE AND NEVER A ROLE. The old gap text warned
    // that gating `administration.rolesPermissions` on `admin.roleAssignment.write` "would mean a
    // reader could not read and a writer could not be told apart from a reader"; nothing here does
    // that. `admin.roleAssignment.write` and the other Administration writes appear nowhere in this
    // catalog, and `users/{uid}.role` is not an input to any of it.
    //
    // `administration.objectsAndWorkflows` IS GONE, SPLIT, NOT RENAMED. It was one gap key over two
    // authorities -- the Object editors answer to `admin.securityPolicy.read` and the Workflow editors
    // to `workflowDefinition.read` -- so it could never have been earned as one surface without
    // conflating them. There is deliberately no surviving combined key: two names for one authority is
    // the drift this catalog's own invariants exist to refuse.
    surface("administration.rolesPermissions", "Roles & Permissions", [
        { capabilityKey: "admin.securityPolicy.read" },
    ]),
    surface("administration.objects", "Objects", [{ capabilityKey: "admin.securityPolicy.read" }]),
    // ONE KEY FOR BOTH OF THE ABOVE, and that is correct rather than a duplicate authority: Roles &
    // Permissions and Objects are the SAME Role x Object x action projection read from two sides, and
    // adminPolicy/administrationSurfaceAuthority.ts reaches the identical conclusion in its own words
    // ("ONE KEY FOR BOTH, because they are one authority seen from two sides"). Two surface KEYS over
    // one capability is two destinations; two capability keys over one authority would be the defect.
    //
    // WORKFLOWS IS READABLE BY NOBODY TODAY, AND IS STILL DECLARED. `workflowDefinition.read` is
    // granted to admin and owner in role_capabilities, so this surface is earnable -- but every other
    // `workflowDefinition.*` stands at zero grants by standing decision, and migrationChainSafety
    // refuses any migration that would grant one. Declaring the surface on its own true read is what
    // keeps it fail-closed HONESTLY: if the grant is ever withdrawn the door closes on the evidence,
    // rather than the surface being pointed at a key somebody happens to hold.
    surface("administration.workflows", "Workflows", [{ capabilityKey: "workflowDefinition.read" }]),
    // PERMISSION PREVIEW -- `admin.principalAccess.read`, AND THAT IS NOT THE SAME AUTHORITY AS THE
    // TWO SURFACES ABOVE (Owner ruling, Wave 10; this SUPERSEDES the Wave 9 line that read
    // `admin.securityPolicy.read` here).
    //
    // WHAT THE SURFACE ACTUALLY DOES is what decides its key. Permission Preview READS AND EVALUATES A
    // PRINCIPAL'S EFFECTIVE ACCESS -- it answers "what would THIS PERSON be able to do" -- so its
    // subject is the `principal` Object, and the Object's own read is `admin.principalAccess.read`.
    // That is the identical read `administration.users` is earned by, and that is correct: both
    // surfaces disclose one named Principal's effective access, seen from two sides. Roles &
    // Permissions and Objects are the other authority -- they read and edit the policy CONFIGURATION,
    // the Role x Object x action matrix, which is nobody's effective access -- and they keep
    // `admin.securityPolicy.read`.
    //
    // CURRENT GRANT POPULATIONS BEING COINCIDENTALLY IDENTICAL DOES NOT JUSTIFY CONFLATING THE
    // AUTHORITIES. Both keys stand at exactly {admin, owner} today, so no principal can presently
    // observe the difference -- and that is precisely the argument for getting the key right now
    // rather than the day one is granted without the other. The two keys also have DIFFERENT
    // PROVENANCE, which is the evidence that they are not one authority wearing two names:
    // `admin.securityPolicy.read` is granted by migration 1762041600000; `admin.principalAccess.read`
    // is reconciled from the Role catalog by the employee-capability-grants tool.
    //
    // adminPolicy/administrationSurfaceAuthority.ts reached this conclusion first and independently
    // ("permissionPreview: the same effective-access read"). Two files describing one authority must
    // not be able to hold two opinions, and administrationNavigationReadiness.test.mjs now pins their
    // AGREEMENT from both sides -- where it used to pin the divergence.
    //
    // THE DATA SOURCE IS UNTOUCHED AND SEPARATELY HELD. This line is about which authority reaches the
    // door, never about what is read behind it; the screen is unbuilt and no read moved here.
    surface("administration.permissionPreview", "Permission Preview", [
        { capabilityKey: "admin.principalAccess.read" },
    ]),
    // Email & Communications (Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30): the EOS provider runtime's
    // administration -- connections, OAuth, mailboxes, routing, delivery failures -- earned by the governed PostgreSQL
    // intake-administration capability, replacing the Firebase-feed gate on administration.emailIntake.read.
    surface("administration.emailCommunications", "Email & Communications", [{ capabilityKey: "inboundWork.intake.manage" }]),
    // ── THE CONTAINER, AND WHY IT IS NOT A DOOR
    //
    // Administration's index reads no governed data of its own -- it lists the destinations above. So
    // there is nothing on it to protect and nothing to name a capability after, and the two obvious
    // answers are both wrong: `alwaysVisible` would seat every principal on a page whose every link
    // refuses them, and a blanket `administration.read` would be a super-capability naming no Object.
    //
    // It is DERIVED instead. A principal who may read at least one governed Administration child may
    // see the menu over them; a principal who may read none has no reason to be there and does not get
    // it. That makes "holds the Overview and can open nothing" unrepresentable rather than merely
    // unlikely. adminPolicy/administrationSurfaceAuthority.ts already decided exactly this for the
    // same surface ("THE OVERVIEW IS A DISJUNCTION, NOT A GRANT"); this is that rule in the projection
    // model, not a second opinion about it.
    //
    // THE CHILD LIST IS THE GOVERNED-CONFIGURATION SET, deliberately. `administration.dataImport` is
    // absent: import authority says somebody may load a spreadsheet, and the Overview is the menu over
    // the ACCESS MODEL. Adding it would make a data-import grant open the policy-administration index.
    container("administration.overview", "Administration", [
        "administration.rolesPermissions",
        "administration.objects",
        "administration.workflows",
        "administration.permissionPreview",
        "administration.users",
        "administration.auditLogs",
    ]),
]);
exports.EXPERIENCE_SURFACE_GAPS = Object.freeze([
    Object.freeze({
        key: "crm.contacts",
        kind: "VOCABULARY",
        // `contact.` is the Object prefix a Contact read would have to be registered under. It is absent,
        // which is the whole gap. `crm.createContact` is a CRM command name (eosCrm/contactAuthority.ts),
        // not an eos_policy capability id, and is named below only to say what DOES exist.
        absentCapabilityPrefixes: Object.freeze(["contact."]),
        reason: "Contact read has no capability of its own -- crm.createContact is a write, and customer.record.read governs the Account. A separate Contacts destination cannot be earned distinctly today.",
    }),
    // ── `commercial.agreements` WAS HERE, AND IT IS CLOSED, NOT SUPPRESSED (Wave 16 / Lane BQ) ──
    //
    // It was the register's only DESTINATION gap: `salesAgreement.read` registered and held by six
    // Roles, `listSalesAgreements` built and capability-scoped on it, and no door in the client. Its
    // own text named the way out -- "THAT IS THE SALES ORDERS SITUATION, VERBATIM, AND IT IS THE
    // PRECEDENT FOR CLOSING IT ... An index screen was built and the surface followed" -- and said
    // that doing the same here was an Owner product decision rather than this file's. The Owner made
    // it, and the entry is deleted because the sentence it asserted is now false: there IS a Sales
    // Agreements index (modules/sales/SalesAgreementsList.jsx), a route
    // (/customers/sales-agreements), a nav item and a NAV_SURFACE_ACCESS row, and the surface is
    // declared above.
    //
    // THE ENTRY DID NOT LEAVE ON ITS OWN. Deleting a DESTINATION gap without building its door would
    // simply have hidden the surface instead of declaring it, and declaring the surface without the
    // door would have broken "every granted surface is reachable from SOME destination". Both halves
    // moved in one commit, which is the only order in which either assertion holds.
    Object.freeze({
        key: "dashboard.myPipeline",
        // NOT_A_DESTINATION, and deliberately carries no capability evidence of either kind. The pipeline
        // is tiles composed inside My Dashboard, so "which capability would earn it" has no answer --
        // and inventing one to satisfy a checker is how a gap register starts naming things that are not
        // there. domain/dashboardComposition.js keeps its OWN itemised register for those modules.
        kind: "NOT_A_DESTINATION",
        reason: "The salesperson dashboard is composed client-side by domain/dashboardComposition.js from role literals and hasCapability; it is not a navigable destination with a governing capability.",
    }),
    Object.freeze({
        key: "service.scheduling",
        kind: "VOCABULARY",
        absentCapabilityPrefixes: Object.freeze(["dispatchSchedule.", "schedule."]),
        reason: "dispatchSchedule was retired as a policy Object; no capability governs a Scheduling destination distinct from service.dispatch.",
    }),
    // `purchasing.suppliers` WAS HERE and is CLOSED (2026-10-01): supplier.record.read is registered, the Supplier list
    // reads eos_ops.suppliers through the EOS API, and the surface is declared above with its existing door.
]);
/**
 * The rules a GAP entry must satisfy. Pure and offline; the real-table half lives in
 * experienceAuthorityPostgres.test.mjs, which is the only place the claims can actually be measured.
 *
 * This exists because `surfaceCatalogViolations` guards the GRANTED half of the catalog and nothing
 * guarded the other half. A gap is a claim about the governed model exactly as a surface is, and an
 * unchecked claim is the one that goes stale: the entry corrected here survived a capability being
 * registered, granted to six Roles including the persona it named, and a read service being built
 * on it, still asserting that none of that existed.
 */
function experienceSurfaceGapViolations(gaps = exports.EXPERIENCE_SURFACE_GAPS) {
    const problems = [];
    const seen = new Set();
    for (const gap of gaps) {
        if (seen.has(gap.key))
            problems.push(`duplicate gap key: ${gap.key}`);
        seen.add(gap.key);
        if (gap.reason.trim().length <= 40)
            problems.push(`${gap.key} has no real reason`);
        const prefixes = gap.absentCapabilityPrefixes ?? [];
        switch (gap.kind) {
            case "VOCABULARY":
                if (prefixes.length === 0) {
                    problems.push(`${gap.key} is a VOCABULARY gap naming no absent capability prefix -- the claim cannot be measured, which is how a false one survives`);
                }
                if (gap.governedBy)
                    problems.push(`${gap.key} is a VOCABULARY gap AND names governedBy ${gap.governedBy} -- if a capability governs it, it is a DESTINATION gap`);
                break;
            case "DESTINATION":
                if (!gap.governedBy)
                    problems.push(`${gap.key} is a DESTINATION gap naming no governing capability -- the claim "the authority already exists" must name it`);
                if (prefixes.length > 0)
                    problems.push(`${gap.key} is a DESTINATION gap AND claims absent prefixes -- it cannot both have and lack its vocabulary`);
                break;
            case "NOT_A_DESTINATION":
                if (gap.governedBy || prefixes.length > 0) {
                    problems.push(`${gap.key} is NOT_A_DESTINATION and carries capability evidence -- there is nothing for it to be evidence about`);
                }
                break;
            default:
                problems.push(`${gap.key} declares unknown gap kind "${String(gap.kind)}"`);
        }
        if (gap.governedBy && !gap.governedBy.includes(".")) {
            problems.push(`${gap.key}: governedBy "${gap.governedBy}" is not a capability key`);
        }
    }
    return Object.freeze(problems);
}
/**
 * Which surfaces this actor may be offered.
 *
 * PURE with respect to the database: it takes the already-read capability set and the already-read
 * dimensions, and evaluates them through the SAME `authorizeObjectAction` every record action uses.
 * Reusing that evaluator is the point -- an offer and an authorization that disagree is exactly the
 * defect `readMyWorkforceCapabilities` was written to stop, one level up.
 */
async function grantedSurfaceKeys(actor, dimensions, catalog = exports.EXPERIENCE_SURFACES) {
    const reader = (0, contextualAuthorization_1.snapshotContextualReader)(dimensions);
    const granted = new Set();
    // PASS 1 -- the surfaces a capability can earn. Containers are skipped here and CANNOT be reached
    // by this loop at all: they declare no grant path, so there is nothing for it to evaluate.
    const containers = [];
    for (const entry of catalog) {
        if (entry.containerOf) {
            containers.push(entry);
            continue;
        }
        for (const path of entry.grants) {
            const decision = await (0, contextualAuthorization_1.authorizeObjectAction)(reader, {
                actor,
                capabilityKey: path.capabilityKey,
                predicates: path.predicates,
            });
            if (decision.allowed) {
                granted.add(entry.key);
                break;
            }
        }
    }
    // PASS 2 -- the containers, read off pass 1 and nothing else.
    //
    // No capability is consulted here and none could be: this pass sees only the set of surfaces the
    // governed evaluator already allowed. A container therefore cannot grant what its children did not,
    // and an empty child result is an empty container. `surfaceCatalogViolations` refuses a container
    // with no children and a child that is itself a container, so this single pass is complete --
    // there is no second order to resolve and no cycle to detect.
    for (const entry of containers) {
        if ((entry.containerOf ?? []).some((childKey) => granted.has(childKey)))
            granted.add(entry.key);
    }
    return Object.freeze([...granted].sort());
}
/**
 * Resolve one authenticated subject to its full EOS experience context.
 *
 * Refuses exactly as every other EOS read refuses -- `resolvePrincipalContext`'s own errors for an
 * unknown, disabled, unmembered or ambiguous principal. There is NO reduced-access fallback and no
 * default experience: a principal holding nothing resolves successfully with an EMPTY surface list,
 * and a principal that cannot be resolved gets an error the client must render as a refusal.
 */
async function resolveExperienceContext(reader, pool, input, options = {}) {
    // Conditions from PostgreSQL -- the source Administration writes and the effective-access explanation reads
    // (lane DX). A surface is a flat projection, so a capability reached ONLY through a conditioned grant (Role or
    // direct exception) is withheld from it exactly as every other flat gate withholds it; with no condition row
    // the set is unchanged.
    const ctx = await (0, capabilityAuthority_1.resolveOperationalContext)(reader, pool, input, (0, entitledActionAuthority_1.postgresGrantConditionProvider)(pool));
    const dimensionReader = options.dimensionReader ?? (0, contextualAuthorization_1.postgresPrincipalDimensionReader)(pool);
    const tenantId = ctx.principalContext.tenantId;
    const principalId = ctx.principalContext.uid;
    const employeeId = await dimensionReader.linkedEmployeeId(tenantId, principalId);
    const workEligibility = employeeId ? await dimensionReader.listWorkEligibility(tenantId, employeeId) : [];
    const operationalScopes = employeeId ? await dimensionReader.listOperationalScopes(tenantId, employeeId) : [];
    const dimensions = { employeeId, workEligibility, operationalScopes };
    const surfaces = await grantedSurfaceKeys({ tenantId, principalId, capabilities: ctx.capabilities }, dimensions);
    return Object.freeze({
        tenantId,
        principalId,
        securityRoleKeys: Object.freeze([...ctx.principalContext.heldRoleKeys]),
        employeeId,
        workEligibility: Object.freeze([...workEligibility]),
        operationalScopes: Object.freeze([...operationalScopes]),
        surfaces,
    });
}
// ════════════════════ catalog invariants ════════════════════
/**
 * The rules a surface entry must satisfy, checked as a function rather than trusted.
 *
 * RECORD_ASSIGNMENT is refused outright: navigation has no record, so a surface predicated on one
 * could only ever be evaluated against a record the caller did not name. That is not a narrower
 * grant, it is an unanswerable question -- and an unanswerable question must never open a door.
 */
function surfaceCatalogViolations(catalog = exports.EXPERIENCE_SURFACES) {
    const problems = [];
    const seen = new Set();
    const gapKeys = new Set(exports.EXPERIENCE_SURFACE_GAPS.map((g) => g.key));
    const containerKeys = new Set(catalog.filter((e) => e.containerOf).map((e) => e.key));
    const allKeys = new Set(catalog.map((e) => e.key));
    for (const entry of catalog) {
        if (seen.has(entry.key))
            problems.push(`duplicate surface key: ${entry.key}`);
        seen.add(entry.key);
        if (gapKeys.has(entry.key))
            problems.push(`${entry.key} is declared BOTH granted and a gap`);
        if (entry.containerOf) {
            // A CONTAINER IS A DISJUNCTION OF ITS CHILDREN AND NOTHING ELSE. Each rule below removes one
            // way it could stop being that, and every one of them fails the catalog rather than degrading.
            if (entry.grants.length > 0) {
                problems.push(`${entry.key} is a container AND declares grant paths -- a container is earned only through its children`);
            }
            if (entry.containerOf.length === 0) {
                problems.push(`${entry.key} is a container of nothing, so nothing can ever earn it`);
            }
            for (const childKey of entry.containerOf) {
                if (childKey === entry.key)
                    problems.push(`${entry.key} contains itself`);
                else if (!allKeys.has(childKey))
                    problems.push(`${entry.key} contains unknown surface ${childKey}`);
                else if (containerKeys.has(childKey)) {
                    problems.push(`${entry.key} contains container ${childKey} -- containers may not nest`);
                }
            }
        }
        else if (entry.grants.length === 0) {
            problems.push(`${entry.key} declares no grant path, so nothing can ever earn it`);
        }
        for (const path of entry.grants) {
            if (!path.capabilityKey.includes("."))
                problems.push(`${entry.key}: "${path.capabilityKey}" is not a capability key`);
            for (const predicate of path.predicates ?? []) {
                if (predicate.kind === "RECORD_ASSIGNMENT") {
                    problems.push(`${entry.key}: RECORD_ASSIGNMENT cannot gate a surface -- navigation has no record`);
                }
            }
        }
    }
    return Object.freeze(problems);
}
/** Every capability key the catalog names, for the "these all exist" proof against the real table. */
function surfaceCatalogCapabilityKeys(catalog = exports.EXPERIENCE_SURFACES) {
    return Object.freeze([...new Set(catalog.flatMap((s) => s.grants.map((g) => g.capabilityKey)))].sort());
}
/** Every surface key, for the client-side mirror parity proof. */
exports.EXPERIENCE_SURFACE_KEYS = Object.freeze(exports.EXPERIENCE_SURFACES.map((s) => s.key));
//# sourceMappingURL=experienceAuthority.js.map