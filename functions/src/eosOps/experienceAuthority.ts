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
 * exact reason no governed grant can earn it today. A surface listed here is invisible under the EOS
 * navigation authority -- which is the honest answer, and is the blocker list for the cutover.
 *
 * DO NOT "fix" one of these by pointing it at an unrelated capability. `administration.rolesPermissions`
 * gated by `admin.roleAssignment.write` would mean a reader could not read and a writer could not be
 * told apart from a reader; that is how a navigation model stops meaning anything.
 */
export const EXPERIENCE_SURFACE_GAPS: readonly { readonly key: string; readonly reason: string }[] = Object.freeze([
  Object.freeze({
    key: "crm.contacts",
    reason: "Contact read has no capability of its own -- crm.createContact is a write, and customer.record.read governs the Account. A separate Contacts destination cannot be earned distinctly today.",
  }),
  Object.freeze({
    key: "commercial.agreements",
    reason: "No salesAgreement.* capability is registered in eos_policy.capabilities; the national-accounts persona's North Star names a surface the governed vocabulary cannot express.",
  }),
  Object.freeze({
    key: "dashboard.myPipeline",
    reason: "The salesperson dashboard is composed client-side by domain/dashboardComposition.js from role literals and hasCapability; it is not a navigable destination with a governing capability.",
  }),
  Object.freeze({
    key: "service.scheduling",
    reason: "dispatchSchedule was retired as a policy Object; no capability governs a Scheduling destination distinct from service.dispatch.",
  }),
  Object.freeze({
    key: "purchasing.suppliers",
    reason: "Supplier master reads are Firestore-authoritative and no supplier.* capability is registered.",
  }),
]);

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
