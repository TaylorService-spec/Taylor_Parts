// PERFORMANCE METRIC REGISTRY -- the closed vocabulary a goal may name.
//
// WHY A REGISTRY AND NOT A STRING. A manager typing "sales" into a target field would create a
// metric that no authority owns: nothing could compute its actual, nothing could say whether two
// people's numbers are comparable, and nothing could refuse a rollup that is mathematically wrong.
// Every one of those is a decision, and a decision made by typing is a decision nobody made. So a
// goal may reference ONLY an id that appears here, and this file is the only place a metric comes
// into existence.
//
// ============================ WHAT THIS FILE DOES NOT DO ============================
//
// It computes NOTHING. There is not one measurement in this module and there must never be one.
//
//     DOMAIN AUTHORITY OWNS THE ACTUAL.
//     THIS REGISTRY OWNS THE METRIC'S IDENTITY, ITS UNIT, AND WHAT MAY BE DONE WITH IT.
//     THE PERFORMANCE GOAL AUTHORITY OWNS THE TARGET.
//
// `actualAuthority` on every entry NAMES the canonical source rather than reproducing it. A second
// implementation of a domain derivation is the failure mode this platform has already been bitten
// by in both directions, so a registry entry that re-derived its own actual would be the bug, not
// the feature.
//
// ============================ REGISTERED IS NOT ACTIVE ============================
//
// `activeForGoals: false` is the NORMAL state here, and it is a feature. A metric is registered so
// that the platform can say out loud what it would measure and exactly what stands in the way --
// `blockedBy` names that blocker by its governed id. A goal may not be created against an inactive
// metric: a target whose actual cannot be computed is a promise the dashboard cannot keep, and
// "the goal exists" must never be mistaken for "the measurement exists".
//
// TWENTY-FIVE of the thirty-seven entries below are inactive. That ratio is the honest current
// state of the platform, not a gap in this file -- see the census (docs/assessments/
// eos-dashboard-reporting-authority-census.md) for each blocker's evidence. Both counts are PINNED
// by performanceGoal.test.mjs rather than only stated here, because a number in a comment is a
// number that drifts: these two already did, between the first draft of this file and its last
// entry.
//
// PURE. No Firestore, no clock, no throwing on lookup -- an unknown id resolves to undefined.
import type { MeasurementBasis } from "../finance/planVsActual";

/**
 * What a target is expressed in. The unit is part of the metric's identity, not a display choice:
 * a target of "5" means nothing until this says whether that is five jobs or five percent.
 */
export const METRIC_UNITS = Object.freeze([
  "COUNT",
  "PERCENT", // 0..100, stored as an integer percentage point
  "CURRENCY_MINOR", // integer minor units; requires a currency on the goal
  "DAYS",
  "HOURS",
  "RATIO_PER_WORKDAY",
] as const);
export type MetricUnit = (typeof METRIC_UNITS)[number];

/**
 * WHEN the actual is true.
 *
 *  POINT_IN_TIME  -- the answer is "right now" (a queue depth, a portfolio count). Needs no
 *                    reporting calendar, which is why these are the metrics that can be active
 *                    today.
 *  CUMULATIVE     -- a running total since the record began (all-time completions). Also needs no
 *                    calendar: there is no window to define.
 *  WINDOWED       -- the answer is "over a period". EVERY windowed metric is blocked by G-05: the
 *                    repository defines no fiscal calendar, no reporting timezone, no MTD/QTD/YTD,
 *                    no partial-period rule and no prior-period comparison. A windowed actual
 *                    cannot be computed without inventing all five.
 */
export const MEASUREMENT_KINDS = Object.freeze(["POINT_IN_TIME", "CUMULATIVE", "WINDOWED"] as const);
export type MeasurementKind = (typeof MEASUREMENT_KINDS)[number];

/**
 * The scopes a goal may target.
 *
 * A scope appears here only when the platform can PROVE which records belong to it. Two of the six
 * are registered and deliberately NOT bindable -- see GOAL_SCOPE_BINDINGS below, which is where the
 * proof (or its absence) is recorded.
 */
export const GOAL_SCOPE_TYPES = Object.freeze([
  "EMPLOYEE",
  "TEAM",
  "LOCATION",
  "BUSINESS_UNIT",
  "OPERATING_COMPANY",
  "FIRM",
] as const);
export type GoalScopeType = (typeof GOAL_SCOPE_TYPES)[number];

/**
 * Whether a scope type can be BOUND to real records today, and by what authority.
 *
 * The Owner's direction is explicit: "Do not activate a scope whose binding cannot be proven by
 * existing authority." This is that proof, written down, so a later session does not quietly
 * activate TEAM because a screen would look better with it.
 */
export const GOAL_SCOPE_BINDINGS: Readonly<Record<GoalScopeType, { bindable: boolean; authority: string }>> =
  Object.freeze({
    EMPLOYEE: Object.freeze({
      bindable: true,
      authority:
        "employees/{employeeId}, joined to a principal by users/{uid}.employeeId -- the same join hierarchicalVisibility.ts already performs server-side.",
    }),
    TEAM: Object.freeze({
      bindable: false,
      authority:
        "NO TEAM ENTITY EXISTS. There is no `teams` collection and no reportsTo edge on the employee record. The nearest governed structure is the Role subtree in roleHierarchy.ts, and that file records its own limitation by name: with role-only hierarchy EVERY salesManager sees EVERY salesperson, so 'the team beneath manager X' is not distinguishable from 'the team beneath manager Y'. A TEAM goal therefore has no durable target id to point at. NOTE the deliberate asymmetry: a manager may still VIEW a rollup across the employees hierarchicalVisibility grants them, because that is a visibility set resolved per viewer -- it is not a team, and it cannot be the durable target of a stored goal.",
    }),
    LOCATION: Object.freeze({
      bindable: true,
      authority:
        "warehouses/{warehouseId} with status ACTIVE (the governed location-eligibility authority, I-LA C2), matched by a RoleAssignment at { type: 'location', value: warehouseId }.",
    }),
    BUSINESS_UNIT: Object.freeze({
      bindable: true,
      authority:
        "BUSINESS_UNITS in finance/financialAttribution.ts, matched by a RoleAssignment at { type: 'businessUnit' } (DECISIONS #157). Bindable as a TARGET, but note that only FINANCIAL facts carry businessUnitId -- an operational record does not -- so a business-unit goal is only measurable on a metric whose actual is a financial fact.",
    }),
    OPERATING_COMPANY: Object.freeze({
      bindable: true,
      authority:
        "OPERATING_COMPANY_IDS in ownership/operatingCompanyAuthority.ts (taylor/ventana), matched by a RoleAssignment at { type: 'operatingCompany' } (DECISIONS #157). Same caveat as BUSINESS_UNIT, and sharper: census X-7 records that operational records have NO governed company provenance (WO NO_GOVERNED_COMPANY_SOURCE, the ownership model inert), so an operating-company goal on an OPERATIONAL metric would be measured against a population nothing can attribute.",
    }),
    FIRM: Object.freeze({
      bindable: true,
      authority:
        "The whole authorized population -- no binding value is required, which is what makes it bindable. A FIRM goal is still READ at the viewer's own governed scope; it is a target for everyone, not a licence to see everything.",
    }),
  });

/** How a metric behaves when viewed above the scope its actual is measured at. */
export type RollupRule =
  | { readonly allowed: false; readonly reason: string }
  /**
   * SUM        -- the higher scope's actual is the sum of the lower ones. Exact for counts.
   * RATIO_OF_SUMS -- sum(valid numerator) / sum(valid denominator). NEVER average(percentages),
   *                  which silently weights a technician who closed two jobs equally with one who
   *                  closed forty.
   * UNELIMINATED_SUM -- a sum across entities that transact with each other. Legal, but must render
   *                  with its caveat (the governed precedent is FIN-009's Consolidated column).
   */
  | { readonly allowed: true; readonly kind: "SUM" | "RATIO_OF_SUMS" | "UNELIMINATED_SUM"; readonly exact: boolean };

export interface PerformanceMetric {
  readonly metricId: string;
  readonly displayName: string;
  readonly domain: string;
  readonly unit: MetricUnit;
  /** The direction a goal on this metric must take. A metric where "more" is unambiguously better
   *  admits only AT_LEAST; forcing the choice here stops a manager creating an AT_MOST past-due
   *  goal of 500 and calling it met. */
  readonly allowedDirections: readonly ("AT_LEAST" | "AT_MOST" | "EXACT")[];
  readonly measurementKind: MeasurementKind;
  /** Prose naming the canonical source of the ACTUAL. Never a formula -- this file computes nothing. */
  readonly actualAuthority: string;
  /** Non-null ⇒ this metric's actual is a FIN-002 financial fact, so a goal on it IS a FIN-003 plan
   *  and is compared by finance/planVsActual.ts's own core rather than by a second money path. */
  readonly financialBasis: MeasurementBasis | null;
  readonly supportedScopes: readonly GoalScopeType[];
  readonly rollup: RollupRule;
  /** May a goal be CREATED against this metric today. */
  readonly activeForGoals: boolean;
  /** Names the blocker by its governed id when activeForGoals is false. Null only when active. */
  readonly blockedBy: string | null;
  /** The census fact-family id this metric measures, so every entry is traceable to its evidence. */
  readonly censusRef: string;
}

// The two direction sets every metric here uses. Named constants rather than repeated literals so a
// metric cannot be given a direction the registry does not intend -- and so the const assertion that
// keeps them narrowly typed is written once.
// Typed constructor for a metric's scope list. A helper rather than a bare array literal so a
// mistyped scope name is a compile error here, where it is cheap, instead of a silent runtime
// mismatch against GOAL_SCOPE_BINDINGS later.
const scopes = (...s: GoalScopeType[]): readonly GoalScopeType[] => Object.freeze(s);

// Typed constructors for the two rollup shapes, for the same reason as scopes() above: a literal
// widens to boolean/string and stops being checkable against RollupRule.
const rollsUp = (kind: "SUM" | "RATIO_OF_SUMS" | "UNELIMINATED_SUM", exact: boolean): RollupRule =>
  Object.freeze({ allowed: true as const, kind, exact });
const noRollup = (reason: string): RollupRule => Object.freeze({ allowed: false as const, reason });

const UP: readonly ("AT_LEAST" | "AT_MOST" | "EXACT")[] = Object.freeze(["AT_LEAST"] as const);
const DOWN: readonly ("AT_LEAST" | "AT_MOST" | "EXACT")[] = Object.freeze(["AT_MOST"] as const);

const ACTIVE = Object.freeze({ activeForGoals: true, blockedBy: null } as const);
const blocked = (blockedBy: string) => Object.freeze({ activeForGoals: false, blockedBy } as const);

// G-05 IS CLOSED (Decision #163). This constant used to say that no fiscal calendar, reporting
// timezone, MTD/QTD/YTD, partial-period rule or prior-period comparison existed, and that a windowed
// actual could not be computed without inventing all five. All five now exist in
// reportingPeriod/reportingPeriod.ts.
//
// It is KEPT, re-pointed, rather than deleted: several metrics below were blocked by G-05 AND by
// something else, and deleting the constant would have quietly promoted "also blocked by the
// calendar" to "unblocked". Each remaining use now records that the window is available and names
// the blocker that actually survives.
const G05_CLOSED =
  "The reporting period itself is no longer a blocker -- G-05 closed it (Decision #163): MTD/QTD/YTD/T12M, the America/Phoenix reporting timezone, half-open boundaries and the prior-comparable rule are all governed now. What remains below is this metric's OWN missing authority.";

export const PERFORMANCE_METRICS: readonly PerformanceMetric[] = Object.freeze([
  // ======================= SERVICE / DISPATCH =======================
  Object.freeze({
    metricId: "service.workOrder.pastDue.count",
    displayName: "Past due scheduled work",
    domain: "service",
    unit: "COUNT",
    allowedDirections: DOWN,
    measurementKind: "POINT_IN_TIME",
    actualAuthority:
      "workOrderPastDueItem() in field-ops-app-vite/src/domain/workOrderAttentionProjection.js, applied GLOBALLY (not week-bound). scheduledStart is the only date authority and exists only once scheduled.",
    financialBasis: null,
    supportedScopes: scopes("FIRM"),
    rollup: rollsUp("SUM", true),
    censusRef: "SV-4",
    ...ACTIVE,
  }),
  Object.freeze({
    metricId: "service.workOrder.readyToSchedule.count",
    displayName: "Ready to schedule",
    domain: "service",
    unit: "COUNT",
    allowedDirections: DOWN,
    measurementKind: "POINT_IN_TIME",
    actualAuthority:
      "workOrderReadyUnscheduledItem() over SCHEDULABLE_STATUS -- the one status from which Schedule is a valid transition, derived from the transition table rather than listed.",
    financialBasis: null,
    supportedScopes: scopes("FIRM"),
    rollup: rollsUp("SUM", true),
    censusRef: "SV-2",
    ...ACTIVE,
  }),
  Object.freeze({
    metricId: "service.workOrder.schedulingConflict.count",
    displayName: "Scheduling conflicts",
    domain: "service",
    unit: "COUNT",
    allowedDirections: DOWN,
    measurementKind: "POINT_IN_TIME",
    actualAuthority: "detectDayOverlaps() via workOrderOverlapItems() -- the same primitives the scheduling workspace uses.",
    financialBasis: null,
    supportedScopes: scopes("FIRM"),
    rollup: rollsUp("SUM", true),
    censusRef: "SV-5",
    ...ACTIVE,
  }),
  Object.freeze({
    metricId: "service.workOrder.partsBlocked.count",
    displayName: "Work blocked on parts",
    domain: "service",
    unit: "COUNT",
    allowedDirections: DOWN,
    measurementKind: "POINT_IN_TIME",
    actualAuthority:
      "workOrderPartsBlockerItem() composing buildWorkOrderPartsReadiness() OUTPUT. NO_PLAN is never surfaced (a job with nothing planned is not blocked) and UNKNOWN readiness is never escalated.",
    financialBasis: null,
    supportedScopes: scopes("FIRM"),
    rollup: rollsUp("SUM", true),
    censusRef: "SV-6",
    ...ACTIVE,
  }),
  Object.freeze({
    metricId: "service.onTimeCompletion.rate",
    displayName: "On-time completion",
    domain: "service",
    unit: "PERCENT",
    allowedDirections: UP,
    measurementKind: "WINDOWED",
    actualAuthority: "NONE. No governed definition of 'on time' exists.",
    financialBasis: null,
    supportedScopes: scopes("EMPLOYEE", "FIRM"),
    rollup: rollsUp("RATIO_OF_SUMS", true),
    censusRef: "SV-12",
    ...blocked(
      "G-14 service metrics -- 'on time' has no governed definition. scheduledStart is the only date authority and a Work Order records no promise, commitment or SLA; obligationAttention.js states by name that it does not invent SLA, risk score, customer promise, severity or ETA. Both the predicate and the eligible population are undecided. Additionally " +
        G05_CLOSED,
    ),
  }),
  Object.freeze({
    metricId: "service.scheduleAdherence.rate",
    displayName: "Schedule adherence",
    domain: "service",
    unit: "PERCENT",
    allowedDirections: UP,
    measurementKind: "WINDOWED",
    actualAuthority: "NONE.",
    financialBasis: null,
    supportedScopes: scopes("EMPLOYEE", "FIRM"),
    rollup: rollsUp("RATIO_OF_SUMS", true),
    censusRef: "SV-12",
    ...blocked(
      "G-14 service metrics -- adherence requires a committed plan to adhere TO. A Work Order stores a scheduled window, not a commitment, and no re-schedule history is retained to measure drift against. " +
        G05_CLOSED,
    ),
  }),
  Object.freeze({
    metricId: "service.firstTimeFix.rate",
    displayName: "First-time fix",
    domain: "service",
    unit: "PERCENT",
    allowedDirections: UP,
    measurementKind: "WINDOWED",
    actualAuthority: "NONE.",
    financialBasis: null,
    supportedScopes: scopes("EMPLOYEE", "FIRM"),
    rollup: rollsUp("RATIO_OF_SUMS", true),
    censusRef: "SV-11",
    ...blocked(
      "G-14 service metrics -- no revisit, callback or repeat-visit LINKAGE exists in the model. Two Work Orders at one Account for one machine are two independent records; nothing relates them, so the denominator of a first-time-fix rate cannot be formed at all.",
    ),
  }),
  Object.freeze({
    metricId: "service.callback.rate",
    displayName: "Callback / repeat visit rate",
    domain: "service",
    unit: "PERCENT",
    allowedDirections: DOWN,
    measurementKind: "WINDOWED",
    actualAuthority: "NONE.",
    financialBasis: null,
    supportedScopes: scopes("EMPLOYEE", "FIRM"),
    rollup: rollsUp("RATIO_OF_SUMS", true),
    censusRef: "SV-13",
    ...blocked("G-14 service metrics -- no callback concept exists anywhere in the model."),
  }),

  // ======================= TECHNICIAN =======================
  Object.freeze({
    metricId: "technician.workOrder.completed.cumulative.count",
    displayName: "Work orders completed (all time)",
    domain: "technician",
    unit: "COUNT",
    allowedDirections: UP,
    measurementKind: "CUMULATIVE",
    actualAuthority:
      "getTechnicianExecutionStats().totalWorkOrdersCompleted -- the honest all-time total. This is the one technician performance figure that needs no reporting calendar, because it names no window.",
    financialBasis: null,
    supportedScopes: scopes("EMPLOYEE"),
    rollup: noRollup("A cumulative lifetime total does not roll up: summing two technicians' all-time counts answers no question a manager asked, and the sum grows with tenure rather than with performance."),
    censusRef: "T-4",
    ...ACTIVE,
  }),
  Object.freeze({
    metricId: "technician.workOrder.open.count",
    displayName: "My open assigned work",
    domain: "technician",
    unit: "COUNT",
    allowedDirections: DOWN,
    measurementKind: "POINT_IN_TIME",
    actualAuthority:
      "subscribeAssignedWorkOrders() (PT-002) bucketed by the real 11-value WorkOrderStatus enum, excluding the terminal statuses -- the same grouping TechnicianDashboard.jsx already performs.",
    financialBasis: null,
    supportedScopes: scopes("EMPLOYEE"),
    rollup: noRollup("Summing open assignments across technicians double-counts nothing but measures backlog, not performance; the dispatch-side queue metrics already answer the backlog question at FIRM scope."),
    censusRef: "T-2",
    ...ACTIVE,
  }),
  Object.freeze({
    metricId: "technician.workOrder.completedPerWorkday.ratio",
    displayName: "Jobs completed per workday",
    domain: "technician",
    unit: "RATIO_PER_WORKDAY",
    allowedDirections: UP,
    measurementKind: "WINDOWED",
    actualAuthority: "NONE.",
    financialBasis: null,
    supportedScopes: scopes("EMPLOYEE", "FIRM"),
    rollup: rollsUp("RATIO_OF_SUMS", true),
    censusRef: "T-5 / SV-8",
    ...blocked(
      "Two blockers, either sufficient. (1) The DENOMINATOR is undecided: 'workday' would have to be derived from technician_working_availability, whose governing rule is ABSENT IS NOT EMPTY -- a technician with no recorded working schedule renders 'no working schedule recorded', never zero days and never a default. (2) " +
        G05_CLOSED,
    ),
  }),
  Object.freeze({
    metricId: "technician.utilization.rate",
    displayName: "Utilisation",
    domain: "technician",
    unit: "PERCENT",
    allowedDirections: UP,
    measurementKind: "WINDOWED",
    actualAuthority: "NONE.",
    financialBasis: null,
    supportedScopes: scopes("EMPLOYEE", "FIRM"),
    rollup: rollsUp("RATIO_OF_SUMS", true),
    censusRef: "SV-8",
    ...blocked(
      "F-04 / ND-21 -- a utilisation percentage would be computed over estimatedDurationMinutes, which is OPTIONAL and whose ABSENCE IS THE NORMAL CASE and must never be read as zero, divided by recorded working hours that may themselves be unrecorded. Both halves are optional, so the quotient is undefined far more often than it is defined. Whether such a figure may exist at all is the open question, not merely how to compute it.",
    ),
  }),
  Object.freeze({
    metricId: "technician.jobCycleTime.days",
    displayName: "Average job cycle time",
    domain: "technician",
    unit: "DAYS",
    allowedDirections: DOWN,
    measurementKind: "WINDOWED",
    actualAuthority: "NONE.",
    financialBasis: null,
    supportedScopes: scopes("EMPLOYEE", "FIRM"),
    rollup: rollsUp("RATIO_OF_SUMS", false),
    censusRef: "SV-9 / T-5",
    ...blocked(
      "F-03 Work Order aging is unformalized: which timestamp starts the clock is undecided, and no governed aging threshold exists, so the comparison POPULATION is undefined as well as the window. " +
        G05_CLOSED,
    ),
  }),
  Object.freeze({
    metricId: "technician.sameDayDocumentation.rate",
    displayName: "Same-day documentation completion",
    domain: "technician",
    unit: "PERCENT",
    allowedDirections: UP,
    measurementKind: "WINDOWED",
    actualAuthority: "NONE.",
    financialBasis: null,
    supportedScopes: scopes("EMPLOYEE", "FIRM"),
    rollup: rollsUp("RATIO_OF_SUMS", true),
    censusRef: "T-9",
    ...blocked(
      "No documentation-completeness authority exists: nothing defines which fields make a Work Order 'documented', and the offline submission queue that would supply the timing is CLIENT-LOCAL per device -- it is not a server-side fact and cannot be measured for anyone but the person holding the device. " +
        G05_CLOSED,
    ),
  }),

  // ======================= SALES =======================
  Object.freeze({
    metricId: "sales.booked.amount",
    displayName: "Booked",
    domain: "sales",
    unit: "CURRENCY_MINOR",
    allowedDirections: UP,
    measurementKind: "WINDOWED",
    actualAuthority:
      "FIN-002 booked facts, stamped bookedAtMillis at Sales Agreement acceptance, ctx-supplied only and frozen thereafter. BOOKED is a distinct basis from BILLED and the two are never blended (FIN-003 invariant A).",
    financialBasis: "BOOKED",
    supportedScopes: scopes("EMPLOYEE", "BUSINESS_UNIT", "OPERATING_COMPANY", "FIRM"),
    rollup: rollsUp("SUM", true),
    censusRef: "S-9",
    ...blocked(
      "AB-2 -- no bounded read for booked facts exists at all: listFinancialFacts serves persisted fact types only and excludes booked BY CONSTRUCTION, test-guarded. This blocker is independent of reach and of the period -- even a principal with CONSOLIDATED reach has nothing to read. G-05 blocks the window separately. FIN-004 reach EXISTS today: corrected 2026-09-02, the census claim that no Role carried a finance.visibility.* scope was WITHDRAWN (#1743) because it was measured by grepping Role sources, which cannot see admin's DERIVED grants. Measured by resolver: admin and owner carry all five scopes, salesManager TEAM, salesperson SELF (#1744).",
    ),
  }),
  Object.freeze({
    metricId: "sales.billed.amount",
    displayName: "Billed",
    domain: "sales",
    unit: "CURRENCY_MINOR",
    allowedDirections: UP,
    measurementKind: "WINDOWED",
    actualAuthority: "Issued invoices with server-recomputed amounts, read through listFinancialFacts.",
    financialBasis: "BILLED",
    supportedScopes: scopes("EMPLOYEE", "BUSINESS_UNIT", "OPERATING_COMPANY", "FIRM"),
    rollup: rollsUp("SUM", true),
    censusRef: "S-10",
    // ACTIVATED by G-05 (Decision #163). Each leg was checked individually rather than assumed:
    //   READ        listFinancialFacts, which serves persisted INVOICE facts.
    //   EVENT TIME  the governed eventAtMillis -- not a creation timestamp.
    //   REACH       exists since #1744: admin/owner hold all five scopes, salesManager TEAM,
    //               salesperson SELF. The census's "no Role carries one" was withdrawn (#1743).
    //   WINDOW      now governed.
    // ACTIVATION IS STILL PER-ENVIRONMENT and still enforced at RUNTIME by the goal authority's
    // factor 2: a principal whose finance capabilities are inactive in their environment resolves
    // DENY. That is the correct answer, and it is not this flag's business -- this flag says the
    // metric is measurable in principle, not that any given person may see it.
    ...ACTIVE,
  }),
  Object.freeze({
    metricId: "sales.collected.amount",
    displayName: "Collected",
    domain: "sales",
    unit: "CURRENCY_MINOR",
    allowedDirections: UP,
    measurementKind: "WINDOWED",
    actualAuthority: "Payment applications, F3-attributed, read through listFinancialFacts at recordedAtMillis.",
    financialBasis: "COLLECTED",
    supportedScopes: scopes("EMPLOYEE", "BUSINESS_UNIT", "OPERATING_COMPANY", "FIRM"),
    rollup: rollsUp("SUM", true),
    censusRef: "S-11",
    // ACTIVATED by G-05 (Decision #163), on the same evidence as sales.billed.amount: a real read
    // (payment applications through listFinancialFacts), a governed event time (recordedAtMillis),
    // existing reach, and now a governed window.
    ...ACTIVE,
  }),
  Object.freeze({
    metricId: "sales.consolidatedBilled.amount",
    displayName: "Billed, consolidated",
    domain: "sales",
    unit: "CURRENCY_MINOR",
    allowedDirections: UP,
    measurementKind: "WINDOWED",
    actualAuthority: "summarizeByCompany over FIN-002 dimensions.",
    financialBasis: "BILLED",
    supportedScopes: scopes("FIRM"),
    rollup: rollsUp("UNELIMINATED_SUM", false),
    censusRef: "S-17 / F-7",
    ...blocked(
      "FIN-BLOCK-004 -- intercompany treatment and elimination are undecided, so this figure is typed UNELIMINATED_SUM and must render with that caveat rather than as a company total. G-05 blocks the window independently. FIN-004 reach EXISTS today and the blocker is elsewhere. Corrected 2026-09-02: the census claim that no Role carried a finance.visibility.* scope was WITHDRAWN (#1743) -- it was measured by grepping Role sources, which cannot see admin's DERIVED grants. Measured by resolver: admin and owner carry all five scopes, salesManager carries TEAM, salesperson carries SELF (#1744). Only finance.visibility.consolidated is activated for platform-sandbox, so admin/owner resolve CONSOLIDATED reach there while the SELF/TEAM holders resolve nothing anywhere -- an ACTIVATION gap, not a missing grant.",
    ),
  }),
  Object.freeze({
    metricId: "sales.opportunity.open.count",
    displayName: "Open opportunities",
    domain: "sales",
    unit: "COUNT",
    allowedDirections: UP,
    measurementKind: "POINT_IN_TIME",
    actualAuthority: "listOpportunityContext (opportunity.read) at the caller's whole authorized scope.",
    financialBasis: null,
    supportedScopes: scopes("EMPLOYEE", "FIRM"),
    rollup: rollsUp("SUM", true),
    censusRef: "S-1 / S-2",
    ...blocked(
      "AB-3 activation -- opportunity.read is registered active:false in the permission catalog and lifted for platform-sandbox only. Registered here so a sandbox activation makes it available without a second decision; production remains blocked by design.",
    ),
  }),
  Object.freeze({
    metricId: "sales.pipeline.value",
    displayName: "Pipeline value",
    domain: "sales",
    unit: "CURRENCY_MINOR",
    allowedDirections: UP,
    measurementKind: "POINT_IN_TIME",
    actualAuthority: "NONE.",
    financialBasis: null,
    supportedScopes: scopes("EMPLOYEE", "FIRM"),
    rollup: rollsUp("SUM", false),
    censusRef: "S-4",
    ...blocked(
      "G-18 -- an Opportunity's expectedValue is a CURRENCY-LESS forecast-flavoured number that flows nowhere (FIN-001 §1.6), and no probability or weighting model exists. Summing it would produce a figure in no unit at all.",
    ),
  }),
  Object.freeze({
    metricId: "sales.averageOrderValue.amount",
    displayName: "Average order value",
    domain: "sales",
    unit: "CURRENCY_MINOR",
    allowedDirections: UP,
    measurementKind: "WINDOWED",
    actualAuthority: "NONE.",
    financialBasis: null,
    supportedScopes: scopes("EMPLOYEE", "FIRM"),
    rollup: rollsUp("RATIO_OF_SUMS", true),
    censusRef: "S-12",
    ...blocked(
      "G-08 -- no AOV definition exists, and FIN-003 invariant A forbids blending bases, so WHICH basis forms the numerator (booked, billed, collected) is a required decision before the metric has meaning. " +
        G05_CLOSED,
    ),
  }),

  // ======================= CRM =======================
  Object.freeze({
    metricId: "crm.account.active.count",
    displayName: "Active accounts",
    domain: "crm",
    unit: "COUNT",
    allowedDirections: UP,
    measurementKind: "POINT_IN_TIME",
    actualAuthority:
      "getAccountPortfolioSummary -- a complete server-side count() over the authorized scope; never a page, never a sample. Unknown status values surface as `unclassified` rather than vanishing.",
    financialBasis: null,
    supportedScopes: scopes("FIRM"),
    rollup: rollsUp("SUM", true),
    censusRef: "C-1",
    ...ACTIVE,
  }),

  // ======================= PARTS / INVENTORY =======================
  Object.freeze({
    metricId: "parts.reorderRequest.open.count",
    displayName: "Open reorder requests",
    domain: "parts",
    unit: "COUNT",
    allowedDirections: DOWN,
    measurementKind: "POINT_IN_TIME",
    actualAuthority:
      "useReorderRequestsByStatuses over the live governed reorder workflow, at the location authority reorder.request.create.manual resolves against -- the picker filters by the same authority the create enforces (offered == accepted).",
    financialBasis: null,
    supportedScopes: scopes("LOCATION", "FIRM"),
    rollup: rollsUp("SUM", true),
    censusRef: "W-6 / P-5",
    ...ACTIVE,
  }),
  Object.freeze({
    metricId: "receiving.purchaseOrder.receivable.count",
    displayName: "Purchase orders awaiting receipt",
    domain: "receiving",
    unit: "COUNT",
    allowedDirections: DOWN,
    measurementKind: "POINT_IN_TIME",
    actualAuthority:
      "listReceivablePurchaseOrders (inventory.stock.receive, active -- needs no override). Receipts apply only against an ORDERED source, discriminated by an explicit closed-set source.type with no fallback lookup.",
    financialBasis: null,
    supportedScopes: scopes("LOCATION", "FIRM"),
    rollup: rollsUp("SUM", true),
    censusRef: "W-1",
    ...ACTIVE,
  }),
  Object.freeze({
    metricId: "purchasing.purchaseOrder.open.count",
    displayName: "Open purchase orders",
    domain: "purchasing",
    unit: "COUNT",
    allowedDirections: DOWN,
    measurementKind: "POINT_IN_TIME",
    actualAuthority: "fetchProcurementPurchaseOrders over the canonical multi-line purchase_orders collection.",
    financialBasis: null,
    supportedScopes: scopes("FIRM"),
    rollup: rollsUp("SUM", true),
    censusRef: "P-1",
    ...ACTIVE,
  }),
  Object.freeze({
    metricId: "inventory.partsAvailability.rate",
    displayName: "Parts availability",
    domain: "inventory",
    unit: "PERCENT",
    allowedDirections: UP,
    measurementKind: "POINT_IN_TIME",
    actualAuthority: "NONE as a rate. The per-part governed position exists; the rate over it does not.",
    financialBasis: null,
    supportedScopes: scopes("LOCATION", "FIRM"),
    rollup: rollsUp("RATIO_OF_SUMS", true),
    censusRef: "I-3 / I-8",
    ...blocked(
      "TWO blockers. (1) AB-1: the governed balance read is gated by the client transport flag INVENTORY_BALANCE_READ_READY, currently false. (2) G-10: 'available' as a RATE needs a denominator population nobody has defined, and UNKNOWN is INFECTIOUS in the ATP computation -- an unknown on-hand yields an unknown available, so a rate over a population containing one unknown part is itself unknown, not merely smaller.",
    ),
  }),
  Object.freeze({
    metricId: "inventory.stockout.rate",
    displayName: "Stockout rate",
    domain: "inventory",
    unit: "PERCENT",
    allowedDirections: DOWN,
    measurementKind: "WINDOWED",
    actualAuthority: "NONE. The stockout PREDICTION is derived information (I-7); a governed stockout STATE does not exist.",
    financialBasis: null,
    supportedScopes: scopes("LOCATION", "FIRM"),
    rollup: rollsUp("RATIO_OF_SUMS", true),
    censusRef: "I-8",
    ...blocked(
      "G-10 -- no stockout definition authority exists: the threshold and the quantity basis are both undecided. Note the ordering trap this entry exists to prevent: I-7's StockoutPrediction is DERIVED INFORMATION and its NEEDS_PLANNING value means 'the engine had nothing to compute', not 'risk is low' -- it may never be counted as a governed stockout state. " +
        G05_CLOSED,
    ),
  }),
  Object.freeze({
    metricId: "inventory.accuracy.rate",
    displayName: "Inventory accuracy",
    domain: "inventory",
    unit: "PERCENT",
    allowedDirections: UP,
    measurementKind: "WINDOWED",
    actualAuthority: "NONE as a rate. Cycle count variances exist as governed events; an accuracy rate over them does not.",
    financialBasis: null,
    supportedScopes: scopes("LOCATION", "FIRM"),
    rollup: rollsUp("RATIO_OF_SUMS", true),
    censusRef: "I-14",
    ...blocked(
      "AB-4 activation (inventory.cycleCount.* is catalog-inactive, sandbox-overridden) AND an undefined rate: whether accuracy is counted by line, by part, by unit or by value is a decision, and the value option additionally requires the VALUATION policy that FIN-BLOCK-003A deliberately left open (it closed cost SUPPLY, not which cost a unit on hand carries). " +
        G05_CLOSED,
    ),
  }),
  Object.freeze({
    metricId: "receiving.discrepancy.rate",
    displayName: "Receipt discrepancy rate",
    domain: "receiving",
    unit: "PERCENT",
    allowedDirections: DOWN,
    measurementKind: "WINDOWED",
    actualAuthority:
      "getPurchaseOrderReceivingProgress surfaces over-received lines with reconciliation reasons -- the numerator's events are governed and live. The denominator population and the window are not.",
    financialBasis: null,
    supportedScopes: scopes("LOCATION", "FIRM"),
    rollup: rollsUp("RATIO_OF_SUMS", true),
    censusRef: "P-6",
    ...blocked(
      "The numerator exists; the DENOMINATOR does not. Whether the rate is per receipt, per PO, per line or per unit is undecided, and " +
        G05_CLOSED,
    ),
  }),
  Object.freeze({
    metricId: "inventory.value.amount",
    displayName: "Inventory value",
    domain: "inventory",
    unit: "CURRENCY_MINOR",
    allowedDirections: DOWN,
    measurementKind: "POINT_IN_TIME",
    actualAuthority: "NONE.",
    financialBasis: "COST",
    supportedScopes: scopes("LOCATION", "FIRM"),
    rollup: rollsUp("SUM", true),
    censusRef: "I-15",
    ...blocked(
      "VALUATION_POLICY_REQUIRED. FIN-BLOCK-003A closed cost SUPPLY for purchased goods -- a receipt against a priced purchase order now records a governed acquisition-cost fact. It did NOT close valuation, and this metric needs valuation, not supply: WHICH cost the units on hand carry is a policy nobody has chosen (ND-27, and DECISIONS #145's external accounting authority of record). Two further gaps survive independently: the inventory ledger carries no operatingCompanyId, so a per-company value has no lineage; and units received before this authority, or against an unpriced purchase order, have cost UNKNOWN -- which a total must not silently treat as zero. unitCost remains blocked displayable/reportable/exportable together.",
    ),
  }),
  Object.freeze({
    metricId: "inventory.turns.ratio",
    displayName: "Inventory turns",
    domain: "inventory",
    unit: "RATIO_PER_WORKDAY",
    allowedDirections: UP,
    measurementKind: "WINDOWED",
    actualAuthority: "NONE.",
    financialBasis: "COST",
    supportedScopes: scopes("LOCATION", "FIRM"),
    rollup: noRollup("Turns is a ratio of a flow to a level; neither term is defined, so no rollup rule can be stated."),
    censusRef: "I-16",
    ...blocked(
      "COGS_COST_FLOW_REQUIRED and VALUATION_POLICY_REQUIRED -- BOTH terms are still missing, and acquisition cost supplies neither. " +
        "The FLOW is COGS over a period: consumption is still a quantity-only ledger event, and deciding WHICH receipt's cost leaves inventory on a sale is a cost-flow policy that does not exist. " +
        "The LEVEL is average inventory value, which needs the valuation policy inventory.value.amount is blocked on, plus a periodic inventory snapshot -- no snapshot of any kind exists. " +
        G05_CLOSED,
    ),
  }),
  Object.freeze({
    metricId: "inventory.carryingCost.amount",
    displayName: "Carrying cost",
    domain: "inventory",
    unit: "CURRENCY_MINOR",
    allowedDirections: DOWN,
    measurementKind: "WINDOWED",
    actualAuthority: "NONE.",
    financialBasis: "COST",
    supportedScopes: scopes("LOCATION", "FIRM"),
    rollup: rollsUp("SUM", true),
    censusRef: "I-17",
    ...blocked(
      "CARRYING_RATE_REQUIRED and VALUATION_POLICY_REQUIRED. Carrying cost is a RATE applied to a VALUE, and acquisition cost supplies neither. " +
        "No governed carrying rate exists anywhere -- no cost of capital, storage, insurance, shrink or obsolescence rate -- and adopting an industry-standard percentage is expressly refused: the number would be invented, not measured. " +
        "The value it would apply to is blocked on the same valuation policy as inventory.value.amount. " +
        G05_CLOSED,
    ),
  }),
  Object.freeze({
    metricId: "inventory.wasteAvoided.amount",
    displayName: "Waste avoided",
    domain: "inventory",
    unit: "CURRENCY_MINOR",
    allowedDirections: UP,
    measurementKind: "WINDOWED",
    actualAuthority: "NONE.",
    financialBasis: "COST",
    supportedScopes: scopes("LOCATION", "FIRM"),
    rollup: rollsUp("SUM", false),
    censusRef: "I-11 / G-01",
    ...blocked(
      "PREVENTION_EVENT_REQUIRED and COUNTERFACTUAL_REQUIRED. Three things were missing; FIN-BLOCK-003A closed ONE of them and the other two are untouched, which is why this metric did not move. " +
        "(1) A governed PREVENTION event, or a deterministic derivation of one -- nothing in the model records that waste was avoided. STILL MISSING, and it is the binding constraint. " +
        "(2) A governed COST basis -- NOW PARTIALLY AVAILABLE for purchased goods via acquisition cost, though not for anything acquired unpriced or before that authority. " +
        "(3) A stated COUNTERFACTUAL: 'avoided' is a claim about what would otherwise have happened, and which alternative history is being asserted is an Owner decision, not an implementation detail. STILL MISSING. " +
        "A manually-entered wasteSaved figure is expressly refused.",
    ),
  }),
  Object.freeze({
    metricId: "inventory.slowMoving.count",
    displayName: "Slow / dead stock",
    domain: "inventory",
    unit: "COUNT",
    allowedDirections: DOWN,
    measurementKind: "POINT_IN_TIME",
    actualAuthority: "NONE.",
    financialBasis: null,
    supportedScopes: scopes("LOCATION", "FIRM"),
    rollup: rollsUp("SUM", true),
    censusRef: "I-11 / I-12",
    ...blocked(
      "G-09 -- no aging implementation exists; the thresholds AND the clock-start event are both undecided. The per-part UsageStats that would feed a ranking exist, but the ranking window and population do not (F-06).",
    ),
  }),

  // ======================= PURCHASING =======================
  Object.freeze({
    metricId: "purchasing.emergencyPurchase.rate",
    displayName: "Emergency purchase rate",
    domain: "purchasing",
    unit: "PERCENT",
    allowedDirections: DOWN,
    measurementKind: "WINDOWED",
    actualAuthority: "NONE.",
    financialBasis: null,
    supportedScopes: scopes("LOCATION", "FIRM"),
    rollup: rollsUp("RATIO_OF_SUMS", true),
    censusRef: "P-3 / P-4",
    ...blocked(
      "No 'emergency' classification exists on a purchase. A reorder request carries an urgency, but urgency is a requester's assertion at creation time, not a governed property of the resulting purchase -- reading one as the other would relabel a field to mean something nobody entered. " +
        G05_CLOSED,
    ),
  }),
  Object.freeze({
    metricId: "purchasing.poCycleTime.days",
    displayName: "PO processing cycle time",
    domain: "purchasing",
    unit: "DAYS",
    allowedDirections: DOWN,
    measurementKind: "WINDOWED",
    actualAuthority: "NONE.",
    financialBasis: null,
    supportedScopes: scopes("FIRM"),
    rollup: rollsUp("RATIO_OF_SUMS", false),
    censusRef: "P-3 / P-4",
    ...blocked(
      "G-12 -- procurementService.ts's create/approve/send remain UNEXPORTED: no capability, actor, audit or idempotency, and no approval policy. There are no governed stage timestamps between which a cycle time could be measured. " +
        G05_CLOSED,
    ),
  }),
  Object.freeze({
    metricId: "purchasing.supplierOnTime.rate",
    displayName: "Supplier on-time supply",
    domain: "purchasing",
    unit: "PERCENT",
    allowedDirections: UP,
    measurementKind: "WINDOWED",
    actualAuthority: "NONE.",
    financialBasis: null,
    supportedScopes: scopes("FIRM"),
    rollup: rollsUp("RATIO_OF_SUMS", true),
    censusRef: "P-3",
    ...blocked(
      "G-12 -- no expected receipt date, promise date or supplier SLA exists on a purchase order, so 'on time' has nothing to be on time AGAINST. Inventing an expected date is expressly refused. " +
        G05_CLOSED,
    ),
  }),
]);

const BY_ID: ReadonlyMap<string, PerformanceMetric> = new Map(PERFORMANCE_METRICS.map((m) => [m.metricId, m]));

/** Lookup. Returns undefined for an unregistered id -- never throws, never invents. */
export function findMetric(metricId: unknown): PerformanceMetric | undefined {
  return typeof metricId === "string" ? BY_ID.get(metricId) : undefined;
}

/** The metrics a goal may be created against today. */
export function metricsActiveForGoals(): readonly PerformanceMetric[] {
  return PERFORMANCE_METRICS.filter((m) => m.activeForGoals);
}

/** Is this scope type bindable to real records at all? Fail-closed on an unknown value. */
export function isScopeBindable(scopeType: unknown): boolean {
  return typeof scopeType === "string" && GOAL_SCOPE_BINDINGS[scopeType as GoalScopeType]?.bindable === true;
}
