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
}

const surface = (key: string, label: string, grants: readonly SurfaceGrantPath[]): ExperienceSurface =>
  Object.freeze({ key, label, grants: Object.freeze(grants.map((g) => Object.freeze(g))) });

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
    key: "administration.rolesPermissions",
    reason: "No READ capability governs the Roles & Permissions surface. eos_policy.capabilities declares admin.roleAssignment.write (a write) and nothing that means 'may read the policy model'.",
  }),
  Object.freeze({
    key: "administration.objectsAndWorkflows",
    reason: "Same gap as rolesPermissions: the Administration Object and Workflow editors are served by /admin/policy operations whose authority is the Administration capability set, none of which is a registered READ id.",
  }),
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
  const granted: string[] = [];
  for (const entry of catalog) {
    for (const path of entry.grants) {
      const decision = await authorizeObjectAction(reader, {
        actor,
        capabilityKey: path.capabilityKey,
        predicates: path.predicates,
      });
      if (decision.allowed) {
        granted.push(entry.key);
        break;
      }
    }
  }
  return Object.freeze(granted.sort());
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
  for (const entry of catalog) {
    if (seen.has(entry.key)) problems.push(`duplicate surface key: ${entry.key}`);
    seen.add(entry.key);
    if (gapKeys.has(entry.key)) problems.push(`${entry.key} is declared BOTH granted and a gap`);
    if (entry.grants.length === 0) problems.push(`${entry.key} declares no grant path, so nothing can ever earn it`);
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
