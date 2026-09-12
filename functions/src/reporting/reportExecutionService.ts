// Issue #325 / ADR-007 D-FN -- the trusted, field-projecting report
// execution service (ADR-007 sec2.1/sec2.3/sec2.4/sec2.5, Specification
// sec6/sec7/sec10). Server-side ONLY, reads governed collections with
// Admin SDK privilege and returns only the fields/rows the RUNNER is
// authorized to see -- there is no client-direct report read path
// (ADR-007 sec2.1). PURE-ish core: every side effect (Firestore reads,
// the Audit Event write) is confined to `runReportDefinition()`; every
// authorization/projection/limit DECISION is made by small, independently
// testable pure helper functions below it, none of which touch Firestore.
//
// Reuses reportQueryValidation.ts (the SAME F2 validator port
// reportCatalogParity.test.mjs proves matches Customer's client-side
// validator byte-for-semantics) to decide "is this definition
// structurally valid and in-catalog" BEFORE any Firestore read --
// exactly ADR-007 sec2.3's "client and server agree" requirement.
//
// Authorization is D-226: every object/field/relationship-traversal
// gate below is a resolveEffectivePermission() call against the
// runner's REAL RoleAssignments (Admin SDK read of roleAssignments +
// users/{uid}.accessVersion, same pattern as access/
// trustedWriterCommands.ts's resolvePrincipalPermission()) -- never a
// raw role-string check, never a client-supplied claim of access. Since
// this task adds NO Role grant for any report.* capability (see
// permissionCatalog.ts/compatibilityRoles.ts/governedBusinessRoles.ts,
// untouched by this PR), every real call today resolves every
// report.* capability to DENY -- this service is "unavailable-not-
// unsafe" by construction of the access layer it depends on, not
// because of any special-cased "not yet activated" flag in this file.
//
// Auditing is D-AUDIT: exactly one Audit Event per run
// (auditEventWriter.ts's "runReportDefinition" action), recording
// actor/objectId/Scope/accessVersion/rowCount/dropped-field+predicate/
// truncation facts -- NEVER row data. The summary string is a fixed,
// templated, row-data-free sentence (never interpolates a filter value,
// a field's actual content, or anything read from a document).
//
// No caching, anywhere, of any kind, across calls: every value this
// module holds in memory is a local variable or parameter scoped to a
// single `runReportDefinition()` invocation, freed when that call
// returns. There is no module-level `let`/mutable Map/Set/cache of any
// kind (grep this file: every top-level binding is `const` bound to a
// pure function or frozen constant). This is the simplest possible way
// to satisfy ADR-007 sec2.4's "no cross-principal result caching" --
// there is no cache to leak across principals because there is no
// cache, full stop. functions/test/reportExecutionService.test.mjs
// proves this structurally (source-text assertion) in addition to
// proving two different runners never observe each other's data.
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { COMPATIBILITY_ROLES } from "../access/compatibilityRoles";
import { GOVERNED_BUSINESS_ROLES } from "../access/governedBusinessRoles";
// ENG-E: TargetContext is deliberately NOT imported here any more. This file
// constructs no capability target of its own; reportRowScope.ts's
// operatingCompanyScope() builds the only ones this service uses, from a named
// governed company id. Nothing here can express "global" as a target.
import { resolveEffectivePermission } from "../access/resolveEffectivePermission";
import { resolveRuntimeCapabilityOverrides } from "../access/environmentCapabilityOverrides";
import { isValidAccessVersionValue } from "../access/compactClaims";
import { recordStandaloneAuditEvent } from "../access/auditEventWriter";
import type { Role } from "../types/access";
import {
  getReportObject,
  getReportField,
  type ReportField,
  type ReportObject,
} from "./reportCatalog";
import { validateReportDefinition, resolveDefinitionField, type ReportDefinition } from "./reportQueryValidation";
import {
  reportRowScopeForCollection,
  resolveCompanyReach,
  operatingCompanyScope,
  documentSatisfiesCompanyBound,
  MAX_IN_FILTER_VALUES,
  type ReportRowScope,
} from "./reportRowScope";
import { isFieldlessAggregate } from "./reportQueryModel";

// ---------------------------------------------------------------------
// Error taxonomy -- mirrors access/trustedWriterCommands.ts's own
// per-reason class-per-error convention, so a caller (and a test) can
// assert on the SPECIFIC failure.
// ---------------------------------------------------------------------
export class InvalidReportDefinitionError extends Error {
  constructor(public readonly errors: readonly string[]) {
    super(`Invalid report definition: ${errors.join("; ")}`);
  }
}
export class UnknownReportObjectError extends Error {}

// Truncation honesty (docs/assessments/eos-dashboard-reporting-authority-
// census.md X-9, a BINDING rule, and the FIN-004 precedent it cites):
//
//   "A bounded read may return a page and say so; a TOTAL may not --
//    bounding an aggregate produces a number smaller than the truth
//    while still labelled 'Total', which is worse than the slow
//    unbounded read it replaced."
//
// This service fetches at most `maxScanDocs` raw documents and then
// filters/groups/aggregates them IN MEMORY. That is a defensible way to
// page a LIST. It is not a defensible way to produce a SUM/AVG/MIN/MAX/
// COUNT: once the raw scan was cut, every aggregate computed from it is
// an arbitrary partial figure, and before this error existed it was
// returned as the aggregate's value with only a `truncated: true`
// boolean beside it. `kind` did not even reliably say so -- an
// aggregate run whose truncated slice matched no rows resolved to
// `"empty"`, and one with a dropped column to `"partially-authorized"`,
// both of which outrank `"truncated-widened"` in the kind ladder below.
// So the wrong number could arrive labelled "no results" or "partially
// authorized", never "this total is incomplete".
//
// The governed answer is FIN-004's: refuse. "A page that would truncate
// renders 'unavailable', never a partial 'ready'."
export class IncompleteAggregateScanError extends Error {}

export type ScanCompletenessVerdict = "complete" | "bounded-page" | "refuse-incomplete-total";

// PURE. The whole X-9 judgement, isolated so it is testable without
// Firestore (this file's stated design: every limit DECISION is a small
// pure helper).
//
// Only SCAN truncation can corrupt an aggregate's value, and this is
// why the other two caps are deliberately NOT refusals:
//
//   * rowCapTruncated -- caps the RETURNED rows. On an ungrouped run it
//     pages a list. On a grouped run it caps how many GROUP rows come
//     back; each returned group's total was still computed over that
//     group's complete matched row set (groupDocuments() runs over all
//     filtered docs, and only the resulting entry list is sliced).
//   * groupCardinalityTruncated -- same shape: whole groups are
//     omitted, but no returned total is understated.
//
// In both cases every number that IS returned is true, and `truncated`
// honestly reports that the SET is a page. Under scan truncation
// nothing of the sort holds: the population itself was cut before a
// single filter ran.
export function judgeScanCompleteness(input: {
  scanTruncated: boolean;
  hasAggregates: boolean;
}): ScanCompletenessVerdict {
  if (!input.scanTruncated) return "complete";
  return input.hasAggregates ? "refuse-incomplete-total" : "bounded-page";
}

// Spec sec10's proposed conservative starting bounds (ADR-007 sec4 open
// decision 3 -- the EXACT values remain an open Owner decision; these
// are enforced as a maximum regardless, since a stricter cap can only
// under-serve, never leak -- tightening later is always safe).
export const MAX_RESULT_ROWS = 10_000;
export const MAX_GROUP_CARDINALITY = 1_000;
// Defense-in-depth beyond Spec sec10's stated row cap: a hard ceiling on
// how many raw documents this service will ever fetch from a single
// collection in one run, independent of the (lower) returned-row cap.
// Filters are applied IN-MEMORY (see the module header's index-free
// design note below) rather than pushed to Firestore, specifically so
// this PR introduces NO new composite index (a hard stop of this task)
// -- this fetch cap bounds the cost of that trade-off. Generous
// headroom (2x the result cap) so an ordinary filtered query is never
// starved before it can find its authorized/matching rows.
export const MAX_SCAN_DOCS = MAX_RESULT_ROWS * 2;

export interface RunReportParams {
  runnerUid: string;
  definition: unknown;
  // No saved-report collection exists yet (D-RULES, a separate, later
  // row) -- every run in this PR is of an ad hoc, unsaved definition.
  // A caller may supply a definitionId (e.g. a client-generated draft
  // id) for audit correlation; otherwise one is minted per call, never
  // persisted, never reused across calls (see the no-caching note
  // above -- this is generated fresh every call, not memoized).
  definitionId?: string;
}

export interface RunReportServiceOptions {
  // Injectable for tests -- defaults to the real Admin SDK Firestore.
  db?: Firestore;
  // Injectable for tests ONLY -- defaults to the real, hand-authored
  // COMPATIBILITY_ROLES + GOVERNED_BUSINESS_ROLES merge (allRoles()
  // below). This PR grants no report.* capability to any real Role
  // (see index.ts's own gating comment), so exercising the ALLOW path
  // in a test requires a synthetic test-only Role map -- this seam
  // makes that possible WITHOUT mutating the real, frozen Role catalogs
  // (which would throw; Object.freeze) and without weakening the
  // production default (a caller that omits this option always gets
  // the real merged catalog).
  roles?: Readonly<Record<string, Role>>;
  // Injectable for tests ONLY -- defaults to MAX_RESULT_ROWS/
  // MAX_GROUP_CARDINALITY/MAX_SCAN_DOCS. Lets truncation/row-cap
  // behavior be tested deterministically against a handful of seeded
  // documents instead of the real 10,000+-document limits. A caller
  // that omits these always gets the real, exported production bounds.
  maxResultRows?: number;
  maxGroupCardinality?: number;
  maxScanDocs?: number;
}

export type RunReportOutcomeKind =
  | "permission-denied"
  // ENG-E requirement 3. A TENANCY failure, deliberately DISTINCT from
  // "permission-denied" so an operator cannot mistake it for a missing grant and
  // go and grant a Role (which would not fix a valueless binding, and may
  // over-grant while trying to). Fires when the runner's operating company
  // cannot be resolved, or when the collection has no governed company bound at
  // all. In every case the target collection is NEVER READ: no scan query and no
  // join read is issued, which reportRowScopeBound.test.mjs proves from the
  // recorded query log rather than from the returned row count.
  | "company-unresolved"
  | "empty"
  | "partially-authorized"
  | "truncated-widened"
  | "results";

export interface RunReportOutcome {
  kind: RunReportOutcomeKind;
  objectId: string;
  // Authorized, projected rows -- null only for permission-denied (the
  // whole object was refused, nothing was ever read).
  rows: Array<Record<string, unknown>> | null;
  // Present only when the definition has at least one aggregate.
  aggregates: Array<Record<string, unknown>> | null;
  rowCount: number;
  rowCap: number;
  truncated: boolean;
  widened: boolean;
  // UI-safe labels (never a raw field id, matching reportResultState.js's
  // own safeLabels() convention on the client) for columns dropped from
  // the SELECTED fields (droppedFieldIds is the audit-facing, real-id
  // form of the same fact).
  droppedColumnLabels: string[];
  droppedFieldIds: string[];
  droppedPredicateFieldIds: string[];
  droppedPredicateCount: number;
  // ENG-E. The governed operating companies this run was bound to, and how the
  // row bound was expressed. Present so a caller (and an auditor) can see the
  // bound that was actually applied rather than inferring it.
  companyReach: string[];
  rowScopeKind: ReportRowScope["kind"] | "unresolved";
  // Non-null ONLY for kind "company-unresolved": why the run was refused on
  // tenancy grounds. Never a row value, never a filter value.
  companyBoundRefusal: string | null;
  // ENG-E axis 3. Related objects whose one-hop join was REFUSED because their
  // backing collection has no governed company bound (e.g. `employees`, which the
  // ownership matrix classifies EXCLUDED). Those documents are never fetched.
  refusedJoinObjectIds: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The merged Role catalog D-FN authorizes against -- report.* capabilities
// are eligible to be granted to EITHER a compatibility Role or a governed
// business Role (unlike access/trustedWriterCommands.ts, which only ever
// checks COMPATIBILITY_ROLES because ITS actions are compatibility-only
// by the Enterprise Access Specification's own design). No id collision
// exists between the two maps (proved by functions/test/
// resolveEffectivePermission.test.mjs's own "share no id" check), so a
// plain spread-merge is safe and complete.
function allRoles(): Readonly<Record<string, Role>> {
  return { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
}

const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";

function readAuthoritativeAccessVersion(data: Record<string, unknown> | undefined): number {
  if (!data) return 0;
  if (data.accessVersion === undefined || data.accessVersion === null) return 0;
  if (!isValidAccessVersionValue(data.accessVersion)) return 0; // fail closed: treat as unversioned, never trust a malformed value upward
  return data.accessVersion as number;
}

// Resolves the runner's REAL access state ONCE per run (not once per
// capability) -- both Firestore reads happen exactly once, and the
// resulting {assignments, accessVersion} pair is reused (as ordinary
// function parameters, never module-level state) for every subsequent
// resolveEffectivePermission() call this run makes.
// ENG-E axis 4 (the ROOT CAUSE). This used to return `{accessVersion,
// assignments}` and nothing else -- the run carried NO company identity, so
// there was nothing available to bound anything with, which is why axes 1-3
// were all unbounded at once. `companyReachFor()` below derives the reach for a
// given capability from these assignments through the canonical resolver ONLY.
// The operating company is NEVER inferred (not from a profile, a warehouse, a
// job title, a display name, or the uid): `operatingCompanyId` is a governed
// ACCESS-SCOPE fact and there is no uid->company resolver in this codebase.
interface RunnerAccessState {
  accessVersion: number;
  assignments: never[];
}

async function loadRunnerAccessState(db: Firestore, runnerUid: string): Promise<RunnerAccessState> {
  const [userSnap, assignmentsSnap] = await Promise.all([
    db.collection(USERS_COLLECTION).doc(runnerUid).get(),
    db.collection(ROLE_ASSIGNMENTS_COLLECTION).where("principalUid", "==", runnerUid).where("status", "==", "active").get(),
  ]);
  const accessVersion = readAuthoritativeAccessVersion(userSnap.data());
  const assignments = assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as never[];
  return { accessVersion, assignments };
}

// The runner's governed company reach for one capability -- finance/
// financeReadCallables.ts:119-123's pattern, delegated to reportRowScope.ts.
function companyReachFor(
  capabilityId: string,
  runner: RunnerAccessState,
  roles: Readonly<Record<string, Role>>,
) {
  return resolveCompanyReach({
    capabilityId,
    assignments: runner.assignments,
    roles,
    currentAccessVersion: runner.accessVersion,
    activationOverrides: resolveRuntimeCapabilityOverrides() as ReadonlySet<string>,
  });
}

// ENG-E: there is deliberately NO `target: TargetContext` parameter here any
// more, and no TargetContext literal anywhere in this file. A capability is
// checked AT A NAMED OPERATING COMPANY, and the target is constructed from that
// company id by operatingCompanyScope() in reportRowScope.ts. That is what makes
// the axis-1 defect (one hardcoded `{ scope: { type: "global" } }` reused for
// every gate in the run) structurally unreachable rather than merely fixed:
// there is no single target parameter left for a future edit to pin back to
// global. reportRowScopeBound.test.mjs ratchets this as source text.
function isAllowedAtCompany(
  permissionId: string,
  runner: RunnerAccessState,
  companyId: string,
  roles: Readonly<Record<string, Role>>,
): boolean {
  return (
    resolveEffectivePermission({
      permissionId,
      assignments: runner.assignments,
      roles,
      currentAccessVersion: runner.accessVersion,
      target: { scope: operatingCompanyScope(companyId), condition: {} },
      // 2C.6C (DECISIONS #167): the report.* family is ENVIRONMENT-ACTIVATED.
      // Without the runtime activation set this service would deny every report
      // capability in EVERY environment because the catalog registers them
      // active:false. Resolved from the runtime's own trusted project identity,
      // exactly as effectiveAccessFeed.ts does.
      //
      // ENG-E CORRECTION (main @ 64008d5a). The previous sentence here read
      // "Production carries no overrides, so Reporting stays fail-closed there
      // until a separate activation ruling." THAT IS FALSE AND WAS FALSE WHEN
      // WRITTEN AGAINST THIS BASELINE. config/environments.json declares
      // `productionCapabilityActivations` on taylor-parts-production -- a field
      // DELIBERATELY DISTINCT from capabilityActivationOverrides
      // (environmentCapabilityOverrides.ts:306) -- holding 25 ids, ALL of them
      // report.*, and resolveRuntimeCapabilityOverrides() composes that
      // production adoption set in (environmentCapabilityOverrides.ts:747-760).
      // The reporting family IS production-activated. Reporting is NOT
      // fail-closed in production by activation, and this service must not be
      // written as though it were.
      activationOverrides: resolveRuntimeCapabilityOverrides(),
    }).decision === "ALLOW"
  );
}

// ENG-E: a capability is usable for a run only if it holds at EVERY company in
// the run's reach. A run reads rows from all of `reach` at once, so a field
// authorized at only one of them would put the other company's values in the
// payload. Intersection semantics are the non-widening reading; the existing
// column-drop/predicate-drop machinery then reports the narrowing honestly.
function isAllowedAcrossReach(
  permissionId: string,
  runner: RunnerAccessState,
  reach: readonly string[],
  roles: Readonly<Record<string, Role>>,
): boolean {
  if (reach.length === 0) return false; // fail closed: no reach authorizes nothing
  return reach.every((companyId) => isAllowedAtCompany(permissionId, runner, companyId, roles));
}

// Every field id (and, when the field is reached via a relationship, its
// traversal capability too) referenced ANYWHERE in the definition --
// fields/filters/groupBy/sort/aggregates -- resolved ONCE each (memoized
// by capability id WITHIN this single call via a local Map, never a
// module-level one) and classified authorized/denied. Returns the
// authorized-field-id set and the denied-field-id set (with labels) so
// every later step (projection, predicate application, grouping) can
// answer "is this field id usable in this run" with a plain Set lookup.
function resolveFieldAuthorization(
  baseObjectId: string,
  referencedFieldIds: readonly string[],
  runner: RunnerAccessState,
  // ENG-E: the run's governed company reach, NOT a target. Every field
  // capability is checked at every company the run reads from.
  reach: readonly string[],
  roles: Readonly<Record<string, Role>>,
) {
  const authorized = new Set<string>();
  const deniedLabels = new Map<string, string>(); // fieldId -> label, for audit-safe UI copy
  const capabilityCache = new Map<string, boolean>(); // capabilityId -> allowed, scoped to THIS call only

  const checkCapability = (capabilityId: string): boolean => {
    if (!capabilityCache.has(capabilityId)) {
      capabilityCache.set(capabilityId, isAllowedAcrossReach(capabilityId, runner, reach, roles));
    }
    return capabilityCache.get(capabilityId) as boolean;
  };

  for (const fieldId of new Set(referencedFieldIds)) {
    const resolved = resolveDefinitionField(baseObjectId, fieldId);
    if (!resolved) continue; // already refused by the validator; nothing to authorize
    const fieldAllowed = checkCapability(resolved.field.readCapability);
    const traversalAllowed = resolved.relationship
      ? checkCapability(resolved.relationship.traversalCapability ?? "")
      : true;
    if (fieldAllowed && traversalAllowed) {
      authorized.add(fieldId);
    } else {
      deniedLabels.set(fieldId, resolved.field.label);
    }
  }

  return { authorized, deniedLabels };
}

// Every field id referenced anywhere in a (already structurally valid)
// definition -- the exhaustive set resolveFieldAuthorization() must
// check. Order doesn't matter (the caller de-duplicates via Set).
function collectReferencedFieldIds(def: ReportDefinition): string[] {
  const ids: string[] = [];
  if (Array.isArray(def.fields)) ids.push(...(def.fields as string[]));
  if (Array.isArray(def.filters)) {
    for (const flt of def.filters as Array<{ fieldId?: unknown }>) {
      if (typeof flt?.fieldId === "string") ids.push(flt.fieldId);
    }
  }
  if (Array.isArray(def.groupBy)) ids.push(...(def.groupBy as string[]));
  if (Array.isArray(def.sort)) {
    for (const s of def.sort as Array<{ fieldId?: unknown }>) {
      if (typeof s?.fieldId === "string") ids.push(s.fieldId);
    }
  }
  if (Array.isArray(def.aggregates)) {
    for (const a of def.aggregates as Array<{ fieldId?: unknown }>) {
      if (typeof a?.fieldId === "string") ids.push(a.fieldId);
    }
  }
  return ids;
}

// Raw Firestore field path for a fieldId on ITS OWN object (never
// cross-object -- a related-object field is read from the RELATED
// document, whose own raw path is computed the same way against ITS
// object id). fieldId is always `${objectId}.${rawPath}` by catalog
// construction (reportCatalog.ts), so this is a plain prefix strip, not
// a lookup table that could drift from the catalog.
function rawFieldPath(field: ReportField): string {
  return field.fieldId.slice(field.objectId.length + 1);
}

function getAtPath(doc: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && !Array.isArray(acc)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, doc);
}

// Independent-review finding (round 1): the original design read a
// related-object field's value ONLY in projectDoc() (final projection),
// but matchesFilter()/groupDocuments()/computeAggregate() ran BEFORE the
// relationship join and read only the base document -- so a filter/
// group/aggregate on an AUTHORIZED related-object field (e.g.
// `location.name` from an `equipment` report) silently produced wrong
// results (an `eq` filter dropped every row; grouping bucketed
// everything together) instead of actually applying against the joined
// value. Fixed by: (a) joining EVERY referenced related field -- not
// just ones in `fields[]` -- BEFORE filtering/grouping/aggregation/sort
// run (see the reordered pipeline in runReportDefinition below), and
// (b) this single shared getFieldValue() used by every execution-time
// consumer (filter/group/aggregate/sort/project), so there is exactly
// ONE place that knows how to resolve a field id (own or joined) to a
// value, never two independently-written copies that can drift.
function getFieldValue(doc: Record<string, unknown>, baseObjectId: string, field: ReportField): unknown {
  if (field.objectId === baseObjectId) return getAtPath(doc, rawFieldPath(field));
  const related = doc[`__related__${field.objectId}`] as Record<string, unknown> | undefined;
  return related ? getAtPath(related, rawFieldPath(field)) : undefined;
}

// ---------------------------------------------------------------------
// The public entry point.
// ---------------------------------------------------------------------
export async function runReportDefinition(
  params: RunReportParams,
  options: RunReportServiceOptions = {},
): Promise<RunReportOutcome> {
  const db = options.db ?? getFirestore();
  const roles = options.roles ?? allRoles();
  const maxResultRows = options.maxResultRows ?? MAX_RESULT_ROWS;
  const maxGroupCardinality = options.maxGroupCardinality ?? MAX_GROUP_CARDINALITY;
  const maxScanDocs = options.maxScanDocs ?? MAX_SCAN_DOCS;
  const definitionId = params.definitionId ?? `adhoc-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Structural validation FIRST (Spec sec6/sec7): a structurally invalid
  // definition is refused outright, before any Firestore read and
  // before any Audit Event -- this is "never valid," not "no longer
  // fully authorized" (F2's own documented distinction).
  const validationErrors = validateReportDefinition(params.definition);
  if (validationErrors.length > 0) {
    throw new InvalidReportDefinitionError(validationErrors);
  }
  const def = params.definition as ReportDefinition;
  const objectId = def.objectId as string;
  const object = getReportObject(objectId) as ReportObject; // non-null: validator already proved it exists and is activated
  if (!object.collection) {
    // serviceHistory-shaped derived objects have no backing collection
    // yet (Spec sec4) -- not reachable today since no derived object is
    // wave-1/fieldsPopulated, but fails closed rather than crashing on
    // a null collection() call if that ever changes.
    throw new UnknownReportObjectError(`objectId "${objectId}" has no backing collection`);
  }

  const runner = await loadRunnerAccessState(db, params.runnerUid);

  // ===================== ENG-E: THE TENANCY AXIS =====================
  //
  // Resolved BEFORE any read of the reported collection, because both the
  // authorization decision and the row predicate depend on it. Nothing below
  // touches `object.collection` until this block has passed.
  //
  // Axis 1 is closed here: there is no `{ scope: { type: "global" } }` target any
  // more. Reach is probed per governed company id through the canonical resolver
  // (finance/financeReadCallables.ts:119-123's pattern), so an
  // operatingCompany-scoped grant NOW WORKS -- at 64008d5a it was DENIED,
  // because scopeMatches() value-matches operatingCompany exactly and such an
  // assignment could never satisfy a global target. There was no such thing as a
  // company-bounded report runner: the only way to run a report was a global
  // grant, and a global grant returned everything.
  const rowScope = reportRowScopeForCollection(object.collection);
  const { reach: companyReach, heldSomewhere } = companyReachFor(
    object.objectReadCapability,
    runner,
    roles,
  );

  // Shared refusal, so the two refusal kinds cannot drift apart in shape.
  const refuse = async (
    kind: "permission-denied" | "company-unresolved",
    summary: string,
    refusal: string | null,
  ): Promise<RunReportOutcome> => {
    await recordStandaloneAuditEvent({
      actorUid: params.runnerUid,
      action: "runReportDefinition",
      targetType: "reportDefinition",
      targetId: definitionId,
      outcome: "denied",
      summary,
      objectId,
      accessVersionAfter: runner.accessVersion,
    }, db);
    return {
      kind,
      objectId,
      rows: null,
      aggregates: null,
      rowCount: 0,
      rowCap: maxResultRows,
      truncated: false,
      widened: false,
      droppedColumnLabels: [],
      droppedFieldIds: [],
      droppedPredicateFieldIds: [],
      droppedPredicateCount: 0,
      companyReach: [...companyReach],
      rowScopeKind: kind === "company-unresolved" ? "unresolved" : rowScope.kind,
      companyBoundRefusal: refusal,
      refusedJoinObjectIds: [],
    };
  };

  // --- Object gate (Spec sec6: "a run requires the object's
  // objectReadCapability; without it, nothing is read") ---
  //
  // A non-empty reach IS the object gate: reach is populated only by companies at
  // which resolveEffectivePermission() returned ALLOW for the object capability.
  if (companyReach.length === 0 && !heldSomewhere) {
    return refuse(
      "permission-denied",
      `Report run denied: object-level read capability not held for "${objectId}".`,
      null,
    );
  }

  // ENG-E requirement 3 -- FAIL CLOSED ON TENANCY, with a kind of its own.
  //
  // The grant EXISTS (heldSomewhere) but bound to no governed operating company:
  // finance's "a valueless grant confers no reach", reported as a tenancy failure
  // rather than a missing grant. The reported collection is never read.
  if (companyReach.length === 0) {
    return refuse(
      "company-unresolved",
      `Report run refused: the runner's operating company could not be resolved for "${objectId}"; ` +
        "a grant exists but binds to no governed operating company, so no row bound can be applied.",
      "the runner holds the object read capability, but no operatingCompany-scoped binding resolves " +
        "for this principal; a valueless grant confers no reach, and an unbounded read is never the " +
        "fallback",
    );
  }

  // The collection itself may have no governed company bound. Refused for the
  // same reason and with the same kind: the bound cannot be stated, so the read
  // does not happen. `why` comes from the ownership matrix, never from this file.
  if (rowScope.kind === "unsupported") {
    return refuse(
      "company-unresolved",
      `Report run refused: no governed operating-company row bound exists for "${objectId}".`,
      rowScope.why,
    );
  }

  // A reach wider than Firestore's `in` cap cannot be expressed as one bounded
  // query. Refuse rather than issue an invalid query (an opaque Firestore error)
  // or trim the predicate to fit (which would silently under-report).
  if (rowScope.kind === "company-bound" && companyReach.length > MAX_IN_FILTER_VALUES) {
    return refuse(
      "company-unresolved",
      `Report run refused: the runner's company reach for "${objectId}" is too wide to express as a single bounded query.`,
      `reach of ${companyReach.length} operating companies exceeds Firestore's ${MAX_IN_FILTER_VALUES}-value ` +
        "`in` limit; the bound cannot be expressed in one query and will not be approximated by trimming it",
    );
  }

  // --- Field/relationship gate (Spec sec6/sec2.5) ---
  const referencedFieldIds = collectReferencedFieldIds(def);
  const { authorized: authorizedFieldIds, deniedLabels } = resolveFieldAuthorization(
    objectId,
    referencedFieldIds,
    runner,
    companyReach,
    roles,
  );

  const activeFields = ((def.fields as string[] | undefined) ?? []).filter((id) => authorizedFieldIds.has(id));
  const droppedFieldIds = ((def.fields as string[] | undefined) ?? []).filter((id) => !authorizedFieldIds.has(id));
  const droppedColumnLabels = droppedFieldIds.map((id) => deniedLabels.get(id) ?? id);

  // Predicate-drop rule (ADR-007 sec2.4): a filter/group/sort/aggregate
  // that REFERENCES a field the runner may not read is DROPPED, never
  // applied -- widens the result rather than leaking membership.
  const activeFilters = ((def.filters as Array<{ fieldId: string; op: string; value: unknown }> | undefined) ?? []).filter((flt) =>
    authorizedFieldIds.has(flt.fieldId),
  );
  const droppedFilterFieldIds = ((def.filters as Array<{ fieldId: string }> | undefined) ?? [])
    .filter((flt) => !authorizedFieldIds.has(flt.fieldId))
    .map((flt) => flt.fieldId);

  const activeGroupBy = ((def.groupBy as string[] | undefined) ?? []).filter((id) => authorizedFieldIds.has(id));
  const droppedGroupByFieldIds = ((def.groupBy as string[] | undefined) ?? []).filter(
    (id) => !authorizedFieldIds.has(id),
  );

  const activeSort = ((def.sort as Array<{ fieldId: string; direction: "asc" | "desc" }> | undefined) ?? []).filter(
    (s) => authorizedFieldIds.has(s.fieldId),
  );

  const activeAggregates = ((def.aggregates as Array<{ fieldId?: string; fn: string }> | undefined) ?? []).filter(
    (a) => isFieldlessAggregate(a.fn) || (typeof a.fieldId === "string" && authorizedFieldIds.has(a.fieldId)),
  );
  const droppedAggregateFieldIds = ((def.aggregates as Array<{ fieldId?: string; fn: string }> | undefined) ?? [])
    .filter((a) => !isFieldlessAggregate(a.fn) && typeof a.fieldId === "string" && !authorizedFieldIds.has(a.fieldId))
    .map((a) => a.fieldId as string);

  const droppedPredicateFieldIds = Array.from(
    new Set([...droppedFilterFieldIds, ...droppedGroupByFieldIds, ...droppedAggregateFieldIds]),
  );
  const widened = droppedPredicateFieldIds.length > 0;

  // ================== ENG-E AXIS 2: THE BOUNDED FETCH ==================
  //
  // At 64008d5a this line read
  //   `db.collection(object.collection).limit(maxScanDocs + 1).get()`
  // with NO where() of any kind, and its comment said so proudly:
  // "index-free: no server-side where()". A recorded run issued
  // `query equipment predicates=[] limit=51` -- every document of every
  // operating company plus the documents carrying no company at all.
  //
  // THE PREDICATE MUST BE SERVER-SIDE. An in-memory post-filter would satisfy a
  // row-count assertion while leaving the defect fully intact, because Firestore
  // applies the scan cap BEFORE any in-memory pass: with 20,000 Taylor documents
  // ahead of them, a Ventana runner's own rows would never be inside the page,
  // and the runner would see a silently wrong report rather than a bounded one.
  // That distinction is the difference between proving the fix and laundering it,
  // so the test asserts on the QUERY ISSUED, not on the rows returned.
  //
  // STILL COMPOSITE-INDEX-FREE, which was the real constraint behind the old
  // comment. A single-field equality (or a single-field `in`, which is a
  // disjunction of equalities over one field) is served by Firestore's AUTOMATIC
  // single-field index. No composite index is added by this change; every other
  // filter/group/aggregate/sort stays in memory exactly as before.
  const baseCollection = db.collection(object.collection);
  const boundedQuery = rowScope.kind === "company-bound"
    ? (companyReach.length === 1
        ? baseCollection.where(rowScope.field, "==", companyReach[0])
        : baseCollection.where(rowScope.field, "in", [...companyReach]))
    // COMPANY_NEUTRAL (ruling R-15): the documents carry no company field, so
    // there is no predicate to apply and inventing one would assert a fact the
    // data does not contain -- `where("operatingCompanyId","==",x)` on `accounts`
    // matches ZERO documents. The run is still gated on a non-empty reach above.
    // This is OWNER QUESTION Q-ENGE-3 and is NOT decided here; see the lane
    // verdict. It is recorded honestly in `rowScopeKind` rather than presented as
    // a bound that exists.
    : baseCollection;
  const snap = await boundedQuery.limit(maxScanDocs + 1).get();
  const scanTruncated = snap.size > maxScanDocs;

  // --- Truncation honesty (census X-9) -- decided BEFORE any join read
  // and before a single aggregate is computed, so a refused run never
  // produces a partial figure that some later branch could return. See
  // judgeScanCompleteness()/IncompleteAggregateScanError above. ---
  if (judgeScanCompleteness({ scanTruncated, hasAggregates: activeAggregates.length > 0 }) === "refuse-incomplete-total") {
    // The run really happened (documents were read), so unlike a
    // structurally invalid definition this IS an auditable outcome --
    // recorded the same way the object-gate denial above is, with a
    // fixed, row-data-free summary.
    await recordStandaloneAuditEvent({
      actorUid: params.runnerUid,
      action: "runReportDefinition",
      targetType: "reportDefinition",
      targetId: definitionId,
      outcome: "denied",
      summary: `Report run refused: aggregates over "${objectId}" would be computed from a truncated scan and would understate the true totals.`,
      objectId,
      truncated: true,
      accessVersionAfter: runner.accessVersion,
    }, db);
    throw new IncompleteAggregateScanError(
      `Aggregates for "${objectId}" cannot be computed: the scan exceeded ${maxScanDocs} documents, so any total would be lower than the truth. Narrow the report with filters, or run it without aggregates.`,
    );
  }

  const rawDocs = snap.docs.slice(0, maxScanDocs).map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown>);

  // --- One-hop relationship join, BEFORE filtering/grouping/aggregation/
  // sort -- for EVERY authorized field referenced ANYWHERE in the
  // definition (not only the selected `fields[]`). Independent-review
  // finding (round 1): the original code joined only `activeFields` and
  // joined AFTER filtering, so a filter/groupBy/aggregate/sort on an
  // authorized related-object field (e.g. `location.name` from an
  // `equipment` report) always read `undefined` (nothing had been
  // joined yet) and silently produced wrong results (an `eq` filter
  // dropped every row; grouping bucketed everything together) instead
  // of a real error OR a leak -- fixed by joining first, from the full
  // authorized-and-referenced field set. Spec sec2.5's own authorization
  // rule is unaffected: which related fields are ELIGIBLE to join here
  // was already decided by resolveFieldAuthorization() above (BOTH the
  // traversal capability AND the related object's own field capability
  // required) -- this only fixes WHEN the already-authorized join
  // happens, not what is authorized to join. ---
  const authorizedReferencedFields = Array.from(authorizedFieldIds)
    .map((id) => resolveDefinitionField(objectId, id))
    .filter((r): r is NonNullable<typeof r> => !!r);
  const relatedFieldsByBase = authorizedReferencedFields.filter((r) => !!r.relationship);
  // ENG-E AXIS 3. The join is now company-bounded too -- see joinRelatedDocs().
  // Closing axis 2 alone would have left this route open for every base row that
  // survives the predicate.
  const joinResult = relatedFieldsByBase.length > 0
    ? await joinRelatedDocs(db, objectId, rawDocs, relatedFieldsByBase, companyReach)
    : { docs: rawDocs, refusedObjectIds: [] as string[] };
  const joinedRaw = joinResult.docs;
  const refusedJoinObjectIds = joinResult.refusedObjectIds;

  // --- Apply active filters in-memory (now against joined docs, so a
  // related-object predicate actually has a value to compare) ---
  const filtered = joinedRaw.filter((doc) => activeFilters.every((flt) => matchesFilter(doc, objectId, flt)));

  // --- Sort (ungrouped path only -- Spec's own field-catalog `sort`
  // operator is declared per-field for RAW column sort; sorting grouped/
  // aggregated output by a group key is a distinct, un-specified
  // feature not implemented here) ---
  const sorted = sortRows(filtered, objectId, activeSort);

  // --- Grouping + aggregation ---
  let resultRows: Array<Record<string, unknown>>;
  let aggregateRows: Array<Record<string, unknown>> | null = null;
  let groupCardinalityTruncated = false;

  if (activeGroupBy.length > 0 || activeAggregates.length > 0) {
    const groups = groupDocuments(filtered, objectId, activeGroupBy);
    groupCardinalityTruncated = groups.size > maxGroupCardinality;
    const cappedGroupEntries = Array.from(groups.entries()).slice(0, maxGroupCardinality);
    aggregateRows = cappedGroupEntries.map(([, rows]) => {
      const row: Record<string, unknown> = {};
      for (const fieldId of activeGroupBy) {
        const field = getReportField(fieldId);
        if (field) row[fieldId] = getFieldValue(rows[0], objectId, field);
      }
      for (const agg of activeAggregates) {
        row[aggregateResultKey(agg)] = computeAggregate(rows, objectId, agg);
      }
      return row;
    });
    resultRows = []; // grouped/aggregated runs return aggregateRows, not raw rows
  } else {
    resultRows = sorted;
  }

  const rowCountBeforeCap = activeGroupBy.length > 0 || activeAggregates.length > 0
    ? (aggregateRows as Array<Record<string, unknown>>).length
    : resultRows.length;
  const rowCapTruncated = rowCountBeforeCap > maxResultRows;
  const truncated = scanTruncated || groupCardinalityTruncated || rowCapTruncated;

  const cappedRows = resultRows.slice(0, maxResultRows);
  const cappedAggregateRows = aggregateRows ? aggregateRows.slice(0, maxResultRows) : null;

  // --- Project rows down to authorized fields only (Spec sec6: "A
  // field the runner may not read is absent from the response payload
  // -- never blanked, never returned-then-hidden") ---
  const projectedRows = (activeGroupBy.length > 0 || activeAggregates.length > 0)
    ? null
    : cappedRows.map((doc) => projectDoc(doc, objectId, activeFields));

  const rowCount = (activeGroupBy.length > 0 || activeAggregates.length > 0)
    ? (cappedAggregateRows as Array<Record<string, unknown>>).length
    : (projectedRows as Array<Record<string, unknown>>).length;

  const finalDroppedPredicateFieldIds = droppedPredicateFieldIds;
  const finalDroppedFieldIds = droppedFieldIds;

  await recordStandaloneAuditEvent({
    actorUid: params.runnerUid,
    action: "runReportDefinition",
    targetType: "reportDefinition",
    targetId: definitionId,
    outcome: "applied",
    summary: `Report run applied for object "${objectId}".`,
    objectId,
    rowCount,
    droppedFieldIds: finalDroppedFieldIds.length > 0 ? finalDroppedFieldIds : undefined,
    droppedPredicateFieldIds: finalDroppedPredicateFieldIds.length > 0 ? finalDroppedPredicateFieldIds : undefined,
    truncated,
    accessVersionAfter: runner.accessVersion,
  }, db);

  const kind: RunReportOutcomeKind =
    rowCount === 0
      ? "empty"
      : droppedColumnLabels.length > 0
        ? "partially-authorized"
        : truncated || widened
          ? "truncated-widened"
          : "results";

  return {
    kind,
    objectId,
    rows: projectedRows,
    aggregates: cappedAggregateRows,
    rowCount,
    rowCap: maxResultRows,
    truncated,
    widened,
    droppedColumnLabels,
    droppedFieldIds: finalDroppedFieldIds,
    droppedPredicateFieldIds: finalDroppedPredicateFieldIds,
    droppedPredicateCount: finalDroppedPredicateFieldIds.length,
    companyReach: [...companyReach],
    rowScopeKind: rowScope.kind,
    companyBoundRefusal: null,
    refusedJoinObjectIds,
  };
}

// ---------------------------------------------------------------------
// In-memory query helpers -- pure functions over already-fetched docs.
// ---------------------------------------------------------------------

function matchesFilter(doc: Record<string, unknown>, objectId: string, flt: { fieldId: string; op: string; value: unknown }): boolean {
  const field = getReportField(flt.fieldId);
  if (!field) return true; // unresolvable somehow; validator already guarantees this never happens for an active filter
  const raw = getFieldValue(doc, objectId, field);
  switch (flt.op) {
    case "eq":
      if (field.dataType === "date") {
        const r = toComparableDate(raw);
        const v = toComparableDate(flt.value);
        return r !== null && v !== null && r === v;
      }
      return raw === flt.value;
    case "ne":
      if (field.dataType === "date") {
        const r = toComparableDate(raw);
        const v = toComparableDate(flt.value);
        // Mirror `eq`'s complement exactly: unresolvable dates never match
        // either "equal" or "not equal" (fail closed, consistent with
        // `before`/`after`/`between` below, which also require both
        // sides to normalize before comparing).
        return r !== null && v !== null && r !== v;
      }
      return raw !== flt.value;
    case "gt": return typeof raw === "number" && typeof flt.value === "number" && raw > flt.value;
    case "gte": return typeof raw === "number" && typeof flt.value === "number" && raw >= flt.value;
    case "lt": return typeof raw === "number" && typeof flt.value === "number" && raw < flt.value;
    case "lte": return typeof raw === "number" && typeof flt.value === "number" && raw <= flt.value;
    case "contains":
      // List-typed fields (e.g. tags, relationshipTypes) store `raw` as an
      // array (reportQueryModel.ts's FILTER_COMPARATORS_BY_TYPE.list
      // legitimately allows "contains" alongside "containsAny" -- the
      // validator has always accepted this combination). Mirror the
      // sibling "containsAny" case's Array.isArray(raw) handling so a
      // list field's "contains" filter actually matches instead of
      // silently dropping every row (raw is never a string for a list
      // field, so the string branch below could never have matched it).
      if (Array.isArray(raw)) return typeof flt.value === "string" && (raw as unknown[]).includes(flt.value);
      return typeof raw === "string" && typeof flt.value === "string" && raw.includes(flt.value);
    case "startsWith": return typeof raw === "string" && typeof flt.value === "string" && raw.startsWith(flt.value);
    case "in": return Array.isArray(flt.value) && flt.value.includes(raw);
    case "before": return toComparableDate(raw) !== null && toComparableDate(flt.value) !== null && (toComparableDate(raw) as number) < (toComparableDate(flt.value) as number);
    case "after": return toComparableDate(raw) !== null && toComparableDate(flt.value) !== null && (toComparableDate(raw) as number) > (toComparableDate(flt.value) as number);
    case "between": {
      if (!Array.isArray(flt.value) || flt.value.length !== 2) return false;
      const r = toComparableDate(raw);
      const lo = toComparableDate(flt.value[0]);
      const hi = toComparableDate(flt.value[1]);
      return r !== null && lo !== null && hi !== null && r >= lo && r <= hi;
    }
    case "containsAny":
      return Array.isArray(raw) && Array.isArray(flt.value) && flt.value.some((v) => (raw as unknown[]).includes(v));
    default:
      return false; // unknown operator -- fail closed, never match
  }
}

function toComparableDate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (value && typeof value === "object" && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

function groupDocuments(
  docs: Array<Record<string, unknown>>,
  objectId: string,
  groupBy: readonly string[],
): Map<string, Array<Record<string, unknown>>> {
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const doc of docs) {
    const key = groupBy
      .map((fieldId) => {
        const field = getReportField(fieldId);
        if (!field) return "";
        return JSON.stringify(getFieldValue(doc, objectId, field) ?? null);
      })
      .join(" ");
    const bucket = groups.get(key);
    if (bucket) bucket.push(doc);
    else groups.set(key, [doc]);
  }
  return groups;
}

function aggregateResultKey(agg: { fieldId?: string; fn: string }): string {
  return isFieldlessAggregate(agg.fn) ? agg.fn : `${agg.fn}(${agg.fieldId})`;
}

function computeAggregate(rows: Array<Record<string, unknown>>, objectId: string, agg: { fieldId?: string; fn: string }): number {
  if (isFieldlessAggregate(agg.fn)) return rows.length; // countRows: bounded by the runner's own authorized/filtered row set
  const field = getReportField(agg.fieldId as string);
  if (!field) return 0;
  const values = rows
    .map((doc) => getFieldValue(doc, objectId, field))
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  switch (agg.fn) {
    case "count": return values.length;
    case "sum": return values.reduce((a, b) => a + b, 0);
    case "avg": return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    case "min": return values.length > 0 ? Math.min(...values) : 0;
    case "max": return values.length > 0 ? Math.max(...values) : 0;
    default: return 0;
  }
}

// ENG-E AXIS 3 -- the one-hop join, now company-bounded.
//
// At 64008d5a this fetched every related document by id with NO company check at
// all. A recorded run over `equipment` selecting `location.name` and
// `customer.name` issued six extra reads: `locations/loc-1`, `locations/loc-2`,
// `locations/loc-3`, `accounts/acc-1`, `accounts/acc-2`, `accounts/acc-3` --
// including the OTHER company's rows and the ownerless row's parents. A separate
// leak route from the base query, and one that closing the base query alone
// leaves wide open.
//
// Two closures, both read from the ownership matrix, never re-decided here:
//   * `unsupported` related collection (e.g. `employees`, which the matrix
//     classifies ownerClass EXCLUDED) -> the join is REFUSED and the documents
//     are NEVER FETCHED. Reported in `refusedJoinObjectIds`.
//   * `company-bound` related collection -> fetched by id (a `where` on document
//     id PLUS a company field would require a composite index this task must not
//     introduce), then VERIFIED against the run's reach and DROPPED rather than
//     attached when it fails. No other company's field value can reach the
//     caller, and an ownerless related document is never attached either.
//   * `company-neutral` -> attached; no company predicate exists to apply (R-15).
async function joinRelatedDocs(
  db: Firestore,
  baseObjectId: string,
  docs: Array<Record<string, unknown>>,
  relatedFields: Array<{ field: ReportField; relationship: NonNullable<ReturnType<typeof resolveDefinitionField>>["relationship"] }>,
  reach: readonly string[],
): Promise<{ docs: Array<Record<string, unknown>>; refusedObjectIds: string[] }> {
  // Group the related fields by the relationship they traverse (usually
  // one relationship, but a definition could select fields from more
  // than one related object).
  const byRelationship = new Map<string, { toObjectId: string; toCollection: string; viaField: ReportField; fields: ReportField[]; rowScope: ReportRowScope }>();
  const refusedObjectIds = new Set<string>();
  for (const { field, relationship } of relatedFields) {
    if (!relationship) continue;
    const toObject = getReportObject(relationship.toObjectId);
    if (!toObject?.collection) continue;
    const viaField = getReportField(relationship.viaField);
    if (!viaField) continue;
    // ENG-E: decided BEFORE the fetch loop, so a refused related collection is
    // never read at all rather than read-then-discarded.
    const relatedRowScope = reportRowScopeForCollection(toObject.collection);
    if (relatedRowScope.kind === "unsupported") {
      refusedObjectIds.add(relationship.toObjectId);
      continue;
    }
    const key = relationship.relationshipId;
    if (!byRelationship.has(key)) {
      byRelationship.set(key, { toObjectId: relationship.toObjectId, toCollection: toObject.collection, viaField, fields: [], rowScope: relatedRowScope });
    }
    byRelationship.get(key)!.fields.push(field);
  }
  if (byRelationship.size === 0) return { docs, refusedObjectIds: [...refusedObjectIds] };

  const joinedDocs = docs.map((d) => ({ ...d }));
  for (const { toObjectId, toCollection, viaField, rowScope: relatedRowScope } of byRelationship.values()) {
    const refIds = new Set<string>();
    for (const doc of joinedDocs) {
      const rawRef = getAtPath(doc, rawFieldPath(viaField));
      if (typeof rawRef === "string" && rawRef) refIds.add(rawRef);
    }
    if (refIds.size === 0) continue;
    const refDocs = await Promise.all(
      Array.from(refIds).map((id) => db.collection(toCollection).doc(id).get()),
    );
    const byId = new Map<string, Record<string, unknown>>();
    const refIdList = Array.from(refIds);
    refDocs.forEach((snap, i) => {
      if (!snap.exists) return;
      const related = { id: snap.id, ...snap.data() } as Record<string, unknown>;
      // ENG-E: the related document is admitted ONLY if it satisfies the same
      // company bound the base query was given. A company-bound related document
      // outside the run's reach -- or carrying no company at all -- is dropped
      // here and never attached, so its field values cannot reach the caller.
      if (relatedRowScope.kind === "company-bound"
        && !documentSatisfiesCompanyBound(related, relatedRowScope.field, reach)) {
        return;
      }
      byId.set(refIdList[i], related);
    });
    for (const doc of joinedDocs) {
      const rawRef = getAtPath(doc, rawFieldPath(viaField));
      if (typeof rawRef === "string" && byId.has(rawRef)) {
        doc[`__related__${toObjectId}`] = byId.get(rawRef);
      }
    }
  }
  return { docs: joinedDocs, refusedObjectIds: [...refusedObjectIds] };
}

// Independent-review finding (round 1): `sort` was authorization-filtered
// into `activeSort` but never actually applied anywhere -- a definition
// with a `sort` clause silently returned Firestore's raw fetch order
// (and the row cap then truncated an arbitrary, not a sorted, set).
// Fixed: applied to the ungrouped row list before capping/projecting
// (see runReportDefinition below). Stable (Array.prototype.sort's
// documented guarantee since ES2019) so a multi-key sort composes
// correctly across successive single-key comparisons.
function sortRows(
  rows: Array<Record<string, unknown>>,
  objectId: string,
  sort: readonly { fieldId: string; direction: "asc" | "desc" }[],
): Array<Record<string, unknown>> {
  if (sort.length === 0) return rows;
  const sorted = [...rows];
  // Apply sort keys in REVERSE order with a stable sort, so the FIRST
  // key in `sort` ends up the primary key (each later stable pass only
  // breaks ties left by the previous one).
  for (const s of [...sort].reverse()) {
    const field = getReportField(s.fieldId);
    if (!field) continue;
    sorted.sort((a, b) => {
      const av = getFieldValue(a, objectId, field);
      const bv = getFieldValue(b, objectId, field);
      const cmp = compareValues(av, bv);
      return s.direction === "desc" ? -cmp : cmp;
    });
  }
  return sorted;
}

// A field's declared dataType (from the catalog) isn't threaded through
// to this comparator, so it infers by RUNTIME shape instead: two numbers
// compare numerically; a Firestore Timestamp-shaped value (has
// `.toMillis()`, e.g. a `date` field's raw stored value) compares by
// millis; everything else compares as a string. `null`/`undefined`
// (a field genuinely absent on a document, or the runner-authorized-but-
// unset case) always sorts last, regardless of asc/desc, matching the
// conventional "nulls last" sort convention.
function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const aMillis = toTimestampMillis(a);
  const bMillis = toTimestampMillis(b);
  if (aMillis !== null && bMillis !== null) return aMillis - bMillis;
  return String(a).localeCompare(String(b));
}

function toTimestampMillis(value: unknown): number | null {
  if (value && typeof value === "object" && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

function projectDoc(
  doc: Record<string, unknown>,
  baseObjectId: string,
  activeFields: readonly string[],
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const fieldId of activeFields) {
    const field = getReportField(fieldId);
    if (!field) continue;
    projected[fieldId] = getFieldValue(doc, baseObjectId, field) ?? null;
  }
  return projected;
}
