// THE EOS PRINCIPAL EXPERIENCE CONTEXT -- "who am I, and which SURFACES may I be offered?"
//
// ════════════════════ THE DEFECT THIS EXISTS TO CLOSE ════════════════════
//
// A governed EOS persona could authenticate, reach the Render API and hold real capabilities, and
// still could not navigate the client. `field-ops-app-vite/src/navigation/navConfig.js`'s
// `isNavItemVisible` decided from four things -- `alwaysVisible`, a Firestore-accessVersion-keyed
// callable feed, `employees/{id}.operationalRoles` + `employmentStatus`, and
// `ROLE_NAV_ACCESS[users/{uid}.role]` where role is one of admin|dispatcher|technician. It read no
// `eos_policy.role_capabilities`, no `employee_work_eligibility`, no `employee_operational_scopes`,
// and nothing in the client called `resolveMyCapabilities`. A partsAssociate holding
// `inventory.stock.receive` was not one of the three legacy roles, so the product had no doors for it.
//
// ════════════════════ NAVIGATION ANSWERS FROM A SURFACE, NOT FROM A ROLE STRING ════════════════════
//
// This module does NOT return "you are a dispatcher". It returns the set of SURFACE KEYS the caller
// may be offered, each one earned by a governed capability and -- where the governed model already
// says so -- by a Work Eligibility or an Operational Scope. The client projects that set onto its
// destinations. It does not decide anything, and it is never the security boundary: every read and
// every command behind every one of these surfaces re-authorizes server-side, exactly as before.
//
// That is deliberately NOT a second `role === "dispatcher"` behind a new name. A surface is granted
// by capability keys that already exist in `eos_policy.capabilities`; no identifier is invented here
// and no grant is made here.
//
// ════════════════════ EXTENDS, DOES NOT DUPLICATE ════════════════════
//
//   resolveOperationalContext   (capabilityAuthority.ts)  Principal -> tenant -> Roles -> capabilities
//   postgresPrincipalDimensionReader / authorizeObjectAction
//                               (contextualAuthorization.ts) Employee link -> eligibility -> scope
//
// Both already existed. This file composes them and adds exactly one new thing: the SURFACE CATALOG,
// which is the per-surface acceptance standard written down as data.
//
// ════════════════════ A SURFACE IS NOT A LANDING PAGE ════════════════════
//
// "North Star" in this repository is a PER-SURFACE standard with its own per-domain gates
// (dispatchNorthStarQuickGate.mjs, partsNorthStarQuickGate.mjs, ...). This catalog keeps that shape:
// one entry per surface, each independently earned and independently refusable. There is no single
// generic landing destination here and none should be added.
import type { Pool } from "pg";
import { resolveOperationalContext } from "./capabilityAuthority";
import {
  authorizeObjectAction,
  postgresPrincipalDimensionReader,
  snapshotContextualReader,
  type ContextPredicate,
  type CurrentOperationalScope,
  type PrincipalDimensionReader,
} from "./contextualAuthorization";
import type { ResolveContextInput } from "../adminPolicy/principalContext";
import type { PolicyReader } from "../adminPolicy/policyRepository";

/**
 * ONE way to reach a surface: a capability, plus the context predicates the governed model already
 * attaches to that kind of work. Several paths may reach the same surface, and holding ANY of them
 * is enough -- the same shape `authorizeAnyPath` uses for a record action.
 */
export interface SurfaceGrantPath {
  readonly capabilityKey: string;
  readonly predicates?: readonly ContextPredicate[];
}

export interface ExperienceSurface {
  /** Stable key the client projects onto its destinations. Never a role name. */
  readonly key: string;
  /** What a person would call it. For refusal copy and Administration screens, never for matching. */
  readonly label: string;
  readonly grants: readonly SurfaceGrantPath[];
  /**
   * CONTAINER SURFACES ONLY -- the child surface keys this one is the menu over.
   *
   * A container is earned by REACHING AT LEAST ONE CHILD and by nothing else. It declares NO grant
   * path of its own, so there is no capability that opens it directly and no way to hold it while
   * holding nothing behind it. That is the opposite of an `alwaysVisible` door and the opposite of a
   * blanket `administration.read`: both of those can seat a principal on a page where every link
   * refuses them, which is how a navigation model starts lying about access.
   *
   * DERIVED, NEVER ASSERTED. The children are evaluated first, through the SAME
   * `authorizeObjectAction` every other surface uses, and the container is then read off that
   * result. It adds no authority of its own -- it can only ever be a disjunction of decisions
   * already made, which is why it cannot widen anything.
   *
   * Nesting is REFUSED by `surfaceCatalogViolations`: a child may not itself be a container. One
   * level means the evaluation is a single ordered pass with no cycle to detect and no dependence on
   * declaration order, and a container of containers is a hierarchy nobody asked this model to have.
   */
  readonly containerOf?: readonly string[];
}

const surface = (key: string, label: string, grants: readonly SurfaceGrantPath[]): ExperienceSurface =>
  Object.freeze({ key, label, grants: Object.freeze(grants.map((g) => Object.freeze(g))) });

/** A surface earned ONLY by reaching one of `children`. No grant path, so nothing opens it directly. */
const container = (key: string, label: string, children: readonly string[]): ExperienceSurface =>
  Object.freeze({ key, label, grants: Object.freeze([]), containerOf: Object.freeze([...children]) });

const WORK_ELIGIBILITY = (qualificationCode: string): ContextPredicate =>
  Object.freeze({ kind: "WORK_ELIGIBILITY", qualificationCode });
/** Scope with NO scopeId: the navigation-grain question is "may you work in ANY warehouse/queue at all". */
const OPERATIONAL_SCOPE = (scopeType: string): ContextPredicate =>
  Object.freeze({ kind: "OPERATIONAL_SCOPE", scopeType });

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
export const EXPERIENCE_SURFACES: readonly ExperienceSurface[] = Object.freeze([
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
  // The technician's OWN work. The capability alone is not the surface: the governed model says field
  // work needs the SERVICE_TECHNICIAN qualification, and that is a different authority from the Role.
  surface("field.myWorkOrders", "My Work Orders", [
    { capabilityKey: "workOrder.transition", predicates: [WORK_ELIGIBILITY("SERVICE_TECHNICIAN")] },
  ]),

  // ── CRM / Commercial
  surface("crm.accounts", "Customers", [{ capabilityKey: "customer.record.read" }]),
  surface("commercial.opportunities", "Opportunities", [{ capabilityKey: "opportunity.read" }]),
  surface("commercial.salesOrders", "Sales Orders", [{ capabilityKey: "salesOrder.read" }]),

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

  // ── Equipment
  surface("equipment.register", "Equipment", [
    { capabilityKey: "equipment.install" },
    { capabilityKey: "equipment.model.manage" },
    { capabilityKey: "equipment.compatibility.view" },
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

/**
 * SURFACES THE PERSONA CATALOG ASKS FOR AND THIS PLATFORM CANNOT YET GOVERN.
 *
 * Declared, never silently omitted. Each names a destination a persona's North Star expects and the
 * exact reason it cannot be a granted surface today. A surface listed here is invisible under the EOS
 * navigation authority -- which is the honest answer, and is the blocker list for the cutover.
 *
 * THERE ARE TWO KINDS OF BLOCKER HERE AND THEY MUST NOT BE WRITTEN AS ONE (Wave 15 / Lane BL).
 * This register used to say every reason was "a property of the governed vocabulary", and
 * `commercial.agreements` carried a reason of that shape which was measurably FALSE (see its entry).
 * The kinds are:
 *
 *   VOCABULARY    no capability exists that could earn the surface, so no grant could ever open it.
 *                 The fix is a capability decision. crm.contacts, service.scheduling and
 *                 purchasing.suppliers are these.
 *   DESTINATION   the capability exists AND IS GRANTED, and the product has no door to offer. The
 *                 fix is a product decision about information architecture, not a policy one, and
 *                 the grant population is evidence FOR building the door rather than against it.
 *                 commercial.agreements is this one.
 *
 * A DESTINATION-KIND GAP IS NOT AN EXCUSE TO DECLARE THE SURFACE ANYWAY. experienceAuthority.test.mjs
 * asserts that every key in EXPERIENCE_SURFACES is reachable from some entry in the client's
 * NAV_SURFACE_ACCESS, and that assertion is the reason the surface stays here rather than being added
 * with no door: a persona that earns something the product cannot offer is the defect this whole
 * catalog exists to remove, pointed the other way.
 *
 * DO NOT "fix" one of these by pointing it at an unrelated capability. `administration.rolesPermissions`
 * gated by `admin.roleAssignment.write` would mean a reader could not read and a writer could not be
 * told apart from a reader; that is how a navigation model stops meaning anything. The same refusal
 * applies to closing a DESTINATION gap by mapping its surface onto a neighbouring door: adding
 * `commercial.agreements` to `customers/opportunities` would mean holding `salesAgreement.read` and
 * nothing else opened the Opportunities list, which is a grant the governed model never made.
 */
export type ExperienceSurfaceGapKind = "VOCABULARY" | "DESTINATION" | "NOT_A_DESTINATION";

/**
 * A GAP, WITH THE PART THAT CAN BE CHECKED SEPARATED FROM THE PART THAT CAN ONLY BE READ.
 *
 * `reason` is prose and prose cannot be verified -- which is exactly how `commercial.agreements`
 * carried a false one past every suite in this repository for as long as it did. The discriminator
 * and the two evidence fields below are the same claim in a form the real table can refuse:
 *
 *   VOCABULARY        `absentCapabilityPrefixes` -- NOTHING in eos_policy.capabilities may start
 *                     with any of them. The day somebody registers one, the gap's reason has become
 *                     false and experienceAuthorityPostgres.test.mjs says so.
 *   DESTINATION       `governedBy` -- a capability that MUST be registered and MUST be HELD. A
 *                     destination gap claims the authority is already there; if it is not, this is a
 *                     vocabulary gap wearing the wrong label. The two halves are checked in the two
 *                     different places they are measurable: REGISTRATION against the real table in
 *                     experienceAuthorityPostgres.test.mjs, and the GRANT population against the
 *                     recorded nonprod measurement in adminPolicy/seed/roleCapabilityAuthorityBaseline.json
 *                     in experienceAuthority.test.mjs. The PostgreSQL suite migrates from clean and
 *                     carries no seed grants, so asking it about holders would measure the absence
 *                     of a seed rather than the truth of the gap.
 *   NOT_A_DESTINATION neither field. The North Star names something that is not a navigable
 *                     destination at all (a dashboard composed in-page), so there is no capability
 *                     the claim could be checked against and none should be invented to check it.
 */
export interface ExperienceSurfaceGap {
  readonly key: string;
  readonly kind: ExperienceSurfaceGapKind;
  /** VOCABULARY only. Capability-key prefixes whose ABSENCE is what makes the reason true. */
  readonly absentCapabilityPrefixes?: readonly string[];
  /** DESTINATION only. The registered, granted capability that already governs this surface's work. */
  readonly governedBy?: string;
  readonly reason: string;
}

export const EXPERIENCE_SURFACE_GAPS: readonly ExperienceSurfaceGap[] = Object.freeze([
  Object.freeze({
    key: "crm.contacts",
    kind: "VOCABULARY" as const,
    // `contact.` is the Object prefix a Contact read would have to be registered under. It is absent,
    // which is the whole gap. `crm.createContact` is a CRM command name (eosCrm/contactAuthority.ts),
    // not an eos_policy capability id, and is named below only to say what DOES exist.
    absentCapabilityPrefixes: Object.freeze(["contact."]),
    reason: "Contact read has no capability of its own -- crm.createContact is a write, and customer.record.read governs the Account. A separate Contacts destination cannot be earned distinctly today.",
  }),
  // ── A DESTINATION GAP, AND IT USED TO BE WRITTEN AS A VOCABULARY ONE ──
  //
  // THE OLD REASON WAS FALSE, NOT MERELY STALE: "No salesAgreement.* capability is registered in
  // eos_policy.capabilities". Four are, under Object `salesAgreement`, and they are GRANTED.
  // Measured read-only against nonprod on 2026-09-24
  // (`render psql <eos-policy> --command "SELECT ..."`, eos_policy.capabilities JOIN
  // role_capabilities JOIN roles) and reproduced from
  // adminPolicy/seed/roleCapabilityAuthorityBaseline.json:
  //
  //     salesAgreement.read        READ             6 grants  admin, dispatcher, generalManager,
  //     salesAgreement.create      CREATE           6 grants  owner, salesManager, salesperson
  //     salesAgreement.updateDraft EDIT             6 grants  (same six)
  //     salesAgreement.accept      BUSINESS_ACTION  4 grants  admin, dispatcher, generalManager,
  //                                                           salesperson
  //
  // `salesperson` is the exact Security Role the persona this gap names holds
  // (scripts/fixtures/personaAuthorityDimensions.v1.json, "national-accounts-sales"), so the sentence
  // that was here said the vocabulary could not express a surface the vocabulary had already
  // expressed and granted to the very persona it was written about. A gap whose stated reason is
  // false is not a gap -- the Wave 9 / Lane AH note above says exactly that about the Administration
  // entries, and it is why THAT reason had to go whatever replaced it.
  //
  // WHAT IS ACTUALLY MISSING IS THE DOOR. The governed cross-account read exists too --
  // `listSalesAgreements` (eosCommercial/reads/salesAgreementReadProjection.ts, exposed by
  // eosCommercial/commercialHttp.ts) is capability-scoped on `salesAgreement.read`. What does not
  // exist anywhere in the client is a Sales Agreements INDEX: there is no list screen beside
  // SalesOrdersList.jsx, no route, and no NAV_SURFACE_ACCESS row. The only Agreement destination is
  // the RECORD page at /customers/opportunities/sales-agreement/:salesAgreementId, reached by first
  // opening the Opportunity that created it.
  //
  // THAT IS THE SALES ORDERS SITUATION, VERBATIM, AND IT IS THE PRECEDENT FOR CLOSING IT. The
  // `customers/salesOrders` nav item in navConfig.js says so about itself: "the capability was never
  // the thing missing: admin holds all four salesOrder.* ids ... and an admin still saw nothing about
  // Sales Orders anywhere in the product -- the only surface was a detail route reachable by first
  // opening the Opportunity that created the order." An index screen was built and the surface
  // followed. Doing the same here is a PRODUCT decision -- whether Sales Agreements gets its own door
  // under CRM/Sales -- and it is the Owner's, not this catalog's. It is not made by editing this
  // file, and it must not be faked by mapping the surface onto a door that is not it.
  Object.freeze({
    key: "commercial.agreements",
    kind: "DESTINATION" as const,
    governedBy: "salesAgreement.read",
    reason: "DESTINATION GAP, NOT A VOCABULARY ONE. salesAgreement.read/.create/.updateDraft/.accept are registered under Object salesAgreement and granted (6/6/6/4 grants; .read is held by admin, dispatcher, generalManager, owner, salesManager, salesperson -- measured read-only in nonprod 2026-09-24), and the governed cross-account read listSalesAgreements already exists. The client has no Sales Agreements index destination: the Agreement is reachable only as a record page from its Opportunity, so there is no door for the surface to be offered through. Declaring the surface without one would break the invariant that every granted surface is reachable from some destination. Building the index is an Owner product decision, not a capability one.",
  }),
  Object.freeze({
    key: "dashboard.myPipeline",
    // NOT_A_DESTINATION, and deliberately carries no capability evidence of either kind. The pipeline
    // is tiles composed inside My Dashboard, so "which capability would earn it" has no answer --
    // and inventing one to satisfy a checker is how a gap register starts naming things that are not
    // there. domain/dashboardComposition.js keeps its OWN itemised register for those modules.
    kind: "NOT_A_DESTINATION" as const,
    reason: "The salesperson dashboard is composed client-side by domain/dashboardComposition.js from role literals and hasCapability; it is not a navigable destination with a governing capability.",
  }),
  Object.freeze({
    key: "service.scheduling",
    kind: "VOCABULARY" as const,
    absentCapabilityPrefixes: Object.freeze(["dispatchSchedule.", "schedule."]),
    reason: "dispatchSchedule was retired as a policy Object; no capability governs a Scheduling destination distinct from service.dispatch.",
  }),
  Object.freeze({
    key: "purchasing.suppliers",
    kind: "VOCABULARY" as const,
    absentCapabilityPrefixes: Object.freeze(["supplier."]),
    reason: "Supplier master reads are Firestore-authoritative and no supplier.* capability is registered.",
  }),
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
export function experienceSurfaceGapViolations(
  gaps: readonly ExperienceSurfaceGap[] = EXPERIENCE_SURFACE_GAPS,
): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const gap of gaps) {
    if (seen.has(gap.key)) problems.push(`duplicate gap key: ${gap.key}`);
    seen.add(gap.key);
    if (gap.reason.trim().length <= 40) problems.push(`${gap.key} has no real reason`);
    const prefixes = gap.absentCapabilityPrefixes ?? [];
    switch (gap.kind) {
      case "VOCABULARY":
        if (prefixes.length === 0) {
          problems.push(`${gap.key} is a VOCABULARY gap naming no absent capability prefix -- the claim cannot be measured, which is how a false one survives`);
        }
        if (gap.governedBy) problems.push(`${gap.key} is a VOCABULARY gap AND names governedBy ${gap.governedBy} -- if a capability governs it, it is a DESTINATION gap`);
        break;
      case "DESTINATION":
        if (!gap.governedBy) problems.push(`${gap.key} is a DESTINATION gap naming no governing capability -- the claim "the authority already exists" must name it`);
        if (prefixes.length > 0) problems.push(`${gap.key} is a DESTINATION gap AND claims absent prefixes -- it cannot both have and lack its vocabulary`);
        break;
      case "NOT_A_DESTINATION":
        if (gap.governedBy || prefixes.length > 0) {
          problems.push(`${gap.key} is NOT_A_DESTINATION and carries capability evidence -- there is nothing for it to be evidence about`);
        }
        break;
      default:
        problems.push(`${gap.key} declares unknown gap kind "${String((gap as { kind?: unknown }).kind)}"`);
    }
    if (gap.governedBy && !gap.governedBy.includes(".")) {
      problems.push(`${gap.key}: governedBy "${gap.governedBy}" is not a capability key`);
    }
  }
  return Object.freeze(problems);
}

// ════════════════════ the projection ════════════════════

export interface PrincipalDimensions {
  readonly employeeId: string | null;
  readonly workEligibility: readonly string[];
  readonly operationalScopes: readonly CurrentOperationalScope[];
}

/**
 * Which surfaces this actor may be offered.
 *
 * PURE with respect to the database: it takes the already-read capability set and the already-read
 * dimensions, and evaluates them through the SAME `authorizeObjectAction` every record action uses.
 * Reusing that evaluator is the point -- an offer and an authorization that disagree is exactly the
 * defect `readMyWorkforceCapabilities` was written to stop, one level up.
 */
export async function grantedSurfaceKeys(
  actor: { readonly tenantId: string; readonly principalId: string; readonly capabilities: ReadonlySet<string> },
  dimensions: PrincipalDimensions,
  catalog: readonly ExperienceSurface[] = EXPERIENCE_SURFACES,
): Promise<readonly string[]> {
  const reader = snapshotContextualReader(dimensions);
  const granted = new Set<string>();

  // PASS 1 -- the surfaces a capability can earn. Containers are skipped here and CANNOT be reached
  // by this loop at all: they declare no grant path, so there is nothing for it to evaluate.
  const containers: ExperienceSurface[] = [];
  for (const entry of catalog) {
    if (entry.containerOf) {
      containers.push(entry);
      continue;
    }
    for (const path of entry.grants) {
      const decision = await authorizeObjectAction(reader, {
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
    if ((entry.containerOf ?? []).some((childKey) => granted.has(childKey))) granted.add(entry.key);
  }

  return Object.freeze([...granted].sort());
}

/** Exactly what the transport returns. No SQL shapes, no row ids, no Firebase subject. */
export interface PrincipalExperienceContext {
  readonly tenantId: string;
  /** The EOS Principal id. Deliberately NOT the Firebase uid -- identity ends at the token. */
  readonly principalId: string;
  /** Security Role keys held through ACTIVE assignments. Disclosed so a refusal can be explained. */
  readonly securityRoleKeys: readonly string[];
  /** The governed Employee this Principal is linked to, or null for a Principal that is not one. */
  readonly employeeId: string | null;
  readonly workEligibility: readonly string[];
  readonly operationalScopes: readonly CurrentOperationalScope[];
  /** The projection the client navigates by. */
  readonly surfaces: readonly string[];
}

/**
 * Resolve one authenticated subject to its full EOS experience context.
 *
 * Refuses exactly as every other EOS read refuses -- `resolvePrincipalContext`'s own errors for an
 * unknown, disabled, unmembered or ambiguous principal. There is NO reduced-access fallback and no
 * default experience: a principal holding nothing resolves successfully with an EMPTY surface list,
 * and a principal that cannot be resolved gets an error the client must render as a refusal.
 */
export async function resolveExperienceContext(
  reader: PolicyReader,
  pool: Pool,
  input: ResolveContextInput,
  options: { readonly dimensionReader?: PrincipalDimensionReader } = {},
): Promise<PrincipalExperienceContext> {
  const ctx = await resolveOperationalContext(reader, pool, input);
  const dimensionReader = options.dimensionReader ?? postgresPrincipalDimensionReader(pool);
  const tenantId = ctx.principalContext.tenantId;
  const principalId = ctx.principalContext.uid;

  const employeeId = await dimensionReader.linkedEmployeeId(tenantId, principalId);
  const workEligibility = employeeId ? await dimensionReader.listWorkEligibility(tenantId, employeeId) : [];
  const operationalScopes = employeeId ? await dimensionReader.listOperationalScopes(tenantId, employeeId) : [];
  const dimensions: PrincipalDimensions = { employeeId, workEligibility, operationalScopes };

  const surfaces = await grantedSurfaceKeys(
    { tenantId, principalId, capabilities: ctx.capabilities },
    dimensions,
  );

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
export function surfaceCatalogViolations(
  catalog: readonly ExperienceSurface[] = EXPERIENCE_SURFACES,
): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const gapKeys = new Set(EXPERIENCE_SURFACE_GAPS.map((g) => g.key));
  const containerKeys = new Set(catalog.filter((e) => e.containerOf).map((e) => e.key));
  const allKeys = new Set(catalog.map((e) => e.key));
  for (const entry of catalog) {
    if (seen.has(entry.key)) problems.push(`duplicate surface key: ${entry.key}`);
    seen.add(entry.key);
    if (gapKeys.has(entry.key)) problems.push(`${entry.key} is declared BOTH granted and a gap`);
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
        if (childKey === entry.key) problems.push(`${entry.key} contains itself`);
        else if (!allKeys.has(childKey)) problems.push(`${entry.key} contains unknown surface ${childKey}`);
        else if (containerKeys.has(childKey)) {
          problems.push(`${entry.key} contains container ${childKey} -- containers may not nest`);
        }
      }
    } else if (entry.grants.length === 0) {
      problems.push(`${entry.key} declares no grant path, so nothing can ever earn it`);
    }
    for (const path of entry.grants) {
      if (!path.capabilityKey.includes(".")) problems.push(`${entry.key}: "${path.capabilityKey}" is not a capability key`);
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
export function surfaceCatalogCapabilityKeys(
  catalog: readonly ExperienceSurface[] = EXPERIENCE_SURFACES,
): readonly string[] {
  return Object.freeze([...new Set(catalog.flatMap((s) => s.grants.map((g) => g.capabilityKey)))].sort());
}

/** Every surface key, for the client-side mirror parity proof. */
export const EXPERIENCE_SURFACE_KEYS: readonly string[] =
  Object.freeze(EXPERIENCE_SURFACES.map((s) => s.key));
