// MY DASHBOARD -- the personalized surface, composed from governed authority.
//
// Replaces the role-aware launcher (`LandingPage`) as the dashboard index for every non-technician
// principal. The launcher's behaviour is NOT lost: it becomes the GO TO section, computed by the
// same `isDomainVisible`/`isNavItemVisible` functions the rail and route table use, so a destination
// is still either genuinely reachable right now or not listed.
//
// ============================ WHAT THIS COMPONENT DECIDES ============================
//
// Nothing, about authority. `composeDashboard()` resolves which modules this principal's governed
// context supplies a scope for, and every module then reads through its OWN domain's authority at
// that domain's own scope. This file arranges; it does not permit.
//
// ============================ WHY CURRENT WORK IS COMPOSED, NOT REBUILT ============================
//
// The work surfaces already exist and are already governed -- the technician's assigned work, the
// parts manager's queues. Rebuilding their data layer here would create a SECOND implementation of
// each domain's read, which is the failure this platform has been bitten by in both directions. So
// the technician keeps `TechnicianDashboard` (which gains the performance section rather than being
// replaced), and this surface links into the existing queues rather than re-querying them.
//
// A section with no modules is OMITTED. An empty "Team performance" heading on a screen with no team
// would imply one.
import { useEffect, useMemo, useState } from "react";
import { Compass } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext.jsx";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import RuledSection from "../../shared/ui/RuledSection.jsx";
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState.jsx";
import StatusIndicator from "../../shared/ui/primitives/StatusIndicator.jsx";
import CompactMetric from "../../shared/ui/primitives/CompactMetric.jsx";
import EmptyState from "../../shared/ui/EmptyState.jsx";
// THE TWO BANDS THE DESIGN NAMES (North Star section 8: "WorkspaceShell with ContextBand for the
// situation line and AttentionBand for ACTION_ITEMs"). Both existed and neither was used: the
// situation line was a generic one-sentence StatusIndicator, and the attention signals were rendered
// as ordinary counts among the other counts -- so nothing on the screen said "this one needs you".
import ContextBand from "../../shared/ui/ContextBand.jsx";
import AttentionBand from "../../shared/ui/AttentionBand.jsx";
import { ReachableDestinations, buildReachableGroups } from "../../navigation/LandingPage.jsx";
import { composeDashboard, goalTargetsFor, resolvedModuleKeys, MODULE_STATE, SECTION } from "../../domain/dashboardComposition.js";
import { usePerformanceGoals, goalKey } from "../../hooks/usePerformanceGoals.js";
import { useCanonicalPartNames } from "../../hooks/useCanonicalPartNames.js";
import { useAccountPortfolioSummary } from "../../hooks/useAccountPortfolioSummary.js";
import { fetchReorderWarehouseOptions } from "../../services/reorderCallableClient.js";

import { useWorkOrders } from "../../hooks/useWorkOrders.js";
import {
  workOrderAttentionItems,
  groupWorkOrderAttentionItemsBySection,
} from "../../domain/workOrderAttentionProjection.js";
import { dashboardGoalActuals, actualsByGoalKey } from "../../domain/dashboardGoalActuals.js";
import { boundedPreview, reachableHref } from "../../domain/dashboardPreview.js";
import { useReorderRequests } from "../../hooks/useReorderRequests.js";
import { useOpportunities } from "../../hooks/useOpportunities.js";
import { useCoordinatedOperations } from "../../hooks/useCoordinatedOperations.js";
import { useSubmissionQueue } from "../../hooks/useSubmissionQueue.js";
// THE GOVERNED SOURCE, NAMED EXPLICITLY. `DEFAULT_OPPORTUNITY_SOURCE` is the SYNTHETIC fixture
// source, so `useOpportunities()` with no argument would put sample opportunities on a real person's
// dashboard -- the precise "trade truth for visual completeness" failure Decision #172 forbids.
import { governedOpportunitySource } from "../../access/opportunitySource.js";
import { fetchReceivablePurchaseOrders } from "../../services/receivingCallableClient.js";
import { privilegedApprovalClient } from "../../services/privilegedApprovalClient.js";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection.js";
import { TECHNICIANS_COLLECTION } from "../../domain/constants.js";
import { useTechnicianAvailability } from "../../hooks/useTechnicianAvailability.js";
import { resolveTechnicianIdentity } from "../../domain/actorDisplayName.js";
import { useFinancialFacts } from "../../hooks/useFinancialFacts.js";
import { resolveReportingPeriod, reportingDayIso, TAYLOR_VENTANA_REPORTING_CALENDAR } from "../../domain/reportingPeriod.js";
import {
  workOrdersByStatus as projectWorkOrdersByStatus,
  technicianComparison as projectTechnicianComparison,
  TECHNICIAN_QUALITY_UNAVAILABLE,
} from "../../domain/dashboardTeamProjections.js";
import GoalGrid from "./GoalGrid.jsx";
import PreviewList from "./PreviewList.jsx";

/**
 * One-shot governed callable read.
 *
 * Small on purpose. Two dashboard modules need "call this once when the module resolves, and tell me
 * whether it answered" and nothing more -- no cache, no refetch, no dedupe. A generic data layer for
 * two call sites would be more code to read than the two call sites.
 *
 * `resolved` is the whole contract: false means the answer is UNKNOWN, and #172 forbids rendering
 * that as an empty queue.
 */
function useOneShot(load, enabled) {
  const [state, setState] = useState({ data: null, resolved: false });
  useEffect(() => {
    if (!enabled) { setState({ data: null, resolved: false }); return undefined; }
    let cancelled = false;
    setState({ data: null, resolved: false });
    Promise.resolve()
      .then(load)
      .then((data) => { if (!cancelled) setState({ data, resolved: true }); })
      // A failure stays UNRESOLVED rather than becoming an empty list. "Nothing waiting" and
      // "nobody could read it" must never render the same.
      .catch(() => { if (!cancelled) setState({ data: null, resolved: false }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return state;
}

/**
 * The warehouses this principal is governed to.
 *
 * Deliberately the SAME list the reorder create authority offers -- "the picker filters by the same
 * authority the create enforces". Reusing it means a location goal can only ever be asked about a
 * warehouse this person genuinely holds authority at, with no new read and no second scope model.
 * An empty list is a real answer: a principal may legitimately be governed to no warehouse.
 */
function useGovernedWarehouseIds() {
  const [ids, setIds] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetchReorderWarehouseOptions()
      .then(({ options }) => { if (!cancelled) setIds(options.map((o) => o.value)); })
      // A failure here narrows the dashboard (no location goals) rather than widening it or
      // breaking the screen. Fail closed, quietly: the person still sees everything else.
      .catch(() => { if (!cancelled) setIds([]); });
    return () => { cancelled = true; };
  }, []);
  return ids;
}

/**
 * The date targets are resolved as of.
 *
 * REPLACED BY G-05 (Decision #163). This used to read the BROWSER's calendar date, which made the
 * business day a property of where the viewer was sitting: a manager in Auckland asking for "today's"
 * goals would have got tomorrow's window, and nothing anywhere would have said so. The reporting day
 * is now the governed one -- America/Phoenix for Taylor and Ventana -- resolved by the same authority
 * the server uses.
 *
 * The clock itself still belongs to the caller; only its INTERPRETATION moved.
 */
function reportingToday() {
  return reportingDayIso(Date.now());
}

/**
 * Every module wears its own label.
 *
 * Measured on the real screen at 1440 and 375: without this, a section became a run of
 * unattributed sentences and a reader could not tell which module each one described. HonestState's
 * NOT_ENABLED branch substitutes `detail` FOR its subject sentence -- correctly, that is its
 * "one sentence, once" contract -- so the subject has to live outside it.
 */
function ModuleFrame({ label, children, blocked = false }) {
  return (
    <div className={blocked ? "fo-dashboard-module fo-dashboard-module--blocked" : "fo-dashboard-module"}>
      <span className="fo-dashboard-module__label">{label}</span>
      {children}
    </div>
  );
}

/**
 * Account portfolio -- a complete server-side count over the authorized scope.
 *
 * The read is LIFTED to the dashboard and passed in, because the same aggregate answers two things:
 * this module's tiles and the `crm.account.active.count` goal actual. Fetching it twice would put two
 * subscriptions on one number and could show a goal actual that disagrees with the tile beside it.
 */
function AccountPortfolioModule({ summary, state }) {
  if (state === "LOADING") {
    return <ModuleFrame label="Account portfolio"><HonestState state={HONEST_STATE.LOADING} subject="Account portfolio" /></ModuleFrame>;
  }
  if (state !== "READY" || !summary) {
    return (
      <ModuleFrame label="Account portfolio" blocked>
        <HonestState state={HONEST_STATE.UNAVAILABLE} detail="The portfolio count could not be read." />
      </ModuleFrame>
    );
  }
  // A complete server-side count over the authorized scope -- never a page, never a sample. Unknown
  // status values surface as `unclassified` rather than vanishing from the total.
  return (
    <ModuleFrame label="Account portfolio">
    <div className="fo-stat-grid">
      {/* Every label NAMES THE CONCEPT rather than standing alone -- ADR-012 section 2.2a, enforced
          by activeLabelConformance. The rule earns its keep on this screen specifically: a dashboard
          also surfaces role-assignment state and capability state, and three different things
          sharing one unqualified status word on one page is the ambiguity the ADR exists to stop.
          (The conformance gate skips line comments but not JSX ones, so this note is worded to avoid
          quoting the bare word it is about -- tripping the guard that proves the point would be a
          poor joke to leave in the build.) */}
      <CompactMetric value={summary.total ?? "—"} label="All accounts" />
      <CompactMetric value={summary.active ?? "—"} label="Active accounts" />
      <CompactMetric value={summary.prospect ?? "—"} label="Prospect accounts" />
      <CompactMetric value={summary.inactive ?? "—"} label="Inactive accounts" />
      {typeof summary.unclassified === "number" && summary.unclassified > 0 && (
        <CompactMetric value={summary.unclassified} label="Unclassified accounts" />
      )}
    </div>
    </ModuleFrame>
  );
}

/**
 * Service attention -- the ONE current-work module this surface composes itself.
 *
 * It re-derives nothing. `workOrderAttentionItems` composes the existing scheduling primitives
 * (SCHEDULABLE_STATUS, the past-due predicate, detectDayOverlaps) and refuses to emit what it cannot
 * support, so the sections that appear are exactly the ones the projection can stand behind.
 *
 * PARTS-BLOCKED IS ABSENT HERE, and deliberately rather than accidentally: that signal composes a
 * caller-supplied `buildWorkOrderPartsReadiness()` output, which this dashboard does not hold. The
 * projection's own rule is that a job with nothing planned is not "blocked" and an UNKNOWN readiness
 * is never escalated -- passing it nothing would be indistinguishable from "no work is blocked",
 * which is a claim. So the module says what it covers instead of implying it covers everything.
 *
 * The four counts are INDEPENDENT, never stacked or summed. One work order can be past due AND in
 * conflict; a total would double-count it, and a stacked bar would assert a mutual exclusivity
 * nobody has proven.
 */
// The projection output is computed ONCE at the dashboard and passed in, because the same sections
// answer both this module's tiles and three FIRM goal actuals. Two derivations of one projection is
// how a tile and the goal beside it come to disagree.
function ServiceAttentionModule({ grouped, loading, error }) {
  if (loading) return <HonestState state={HONEST_STATE.LOADING} subject="Service attention" />;
  if (error) {
    return <HonestState state={HONEST_STATE.UNAVAILABLE} subject="Service attention" detail="Work orders could not be read just now." />;
  }

  if (grouped.length === 0) {
    // A CONFIRMED clean state, not an unknown one: the read succeeded and the projection found
    // nothing. Absence IS the signal here, and saying so is different from saying nothing.
    return <StatusIndicator tone="positive" label="Nothing needs scheduling attention right now" />;
  }

  return (
    <>
      <div className="fo-stat-grid">
        {grouped.map((g) => (
          <CompactMetric key={g.sectionLabel} value={g.items.length} label={g.sectionLabel} />
        ))}
      </div>
      <p className="fo-muted">
        Counted independently — one work order can appear in more than one of these, so they are not a total.
        Past due is measured across all scheduled work, not only this week&apos;s.
      </p>
    </>
  );
}

/**
 * A module that is not showing a number, and the reason it is not.
 *
 * THREE DIFFERENT SENTENCES, because the three imply different next actions and a reader deserves
 * to know which one they are looking at:
 *   GATED      someone must decide something (a grant, an activation)   -> NOT_ENABLED
 *   UNAVAILABLE someone must define something (an authority that does not exist) -> UNAVAILABLE
 *   NOT_WIRED  nobody must decide anything; this surface has not composed the read -> NOT_ENABLED
 *              with a sentence that says where the live surface is, so the reader is not stranded.
 */
function BlockedModule({ label, blocker }) {
  return (
    <div className="fo-dashboard-module fo-dashboard-module--blocked">
      <span className="fo-dashboard-module__label">{label}</span>
      {/* ALL THREE non-ready module states render as NOT_ENABLED, and that is a correction made
          after looking at the real screen rather than a shortcut.

          UNAVAILABLE was mapped to HonestState's UNAVAILABLE branch first, which draws a red warning
          glyph and centred alert copy. On the page that made "no governed cost fact exists anywhere
          in the platform" read as a FAULT -- something broken, something to retry -- when it is a
          designed, permanent, Owner-level absence that the platform is stating deliberately. The red
          treatment is right for a read that FAILED and wrong for a figure that was never offered.

          So the alert styling stays where it belongs -- on genuine read failures, which is where the
          portfolio and goal modules still use it -- and every "the platform does not offer this,
          here is why" case gets NOT_ENABLED's quiet single sentence. The DISTINCTION between the
          three states is not lost: it lives in the blocker sentence, which names whether someone
          must decide something, define something, or wire something. */}
      <HonestState state={HONEST_STATE.NOT_ENABLED} detail={blocker} />
    </div>
  );
}

export default function MyDashboard({ role, allowedLegacyKeys = [], operationalContext = {} }) {
  const { user, employeeId, displayName, operationalRoles } = useAuth();
  const authUid = user?.uid ?? null;
  const warehouseIds = useGovernedWarehouseIds();

  const ctx = useMemo(
    () => ({
      role,
      employeeId: employeeId ?? null,
      // A technician reaching THIS surface is already out of the technician branch in App.jsx, so
      // the binding is deliberately absent here rather than re-resolved.
      technicianId: null,
      operationalRoles: operationalRoles ?? [],
      warehouseIds,
      hasCapability: operationalContext?.hasCapability,
    }),
    [role, employeeId, operationalRoles, warehouseIds, operationalContext],
  );

  const sections = useMemo(() => composeDashboard(ctx), [ctx]);
  const targets = useMemo(() => goalTargetsFor(ctx), [ctx]);
  const onDate = useMemo(() => reportingToday(), []);
  const goalFeed = usePerformanceGoals(targets, onDate);

  // ---- the governed reads this surface composes, LIFTED so one read serves both its module and its
  // goal actual. Each is gated on the module actually resolving: a viewer with no service scope must
  // not open an unfiltered work-order subscription their Rules would deny.
  const moduleKeys = useMemo(() => new Set(resolvedModuleKeys(ctx)), [ctx]);
  // ONE subscription serving three modules and three goal actuals. Enabled if ANY of them resolved --
  // all three happen to need operations scope today, but tying the gate to one module's key would
  // silently disable the others the moment that stops being true.
  const { data: workOrders, loading: workOrdersLoading, error: workOrdersError } = useWorkOrders(
    moduleKeys.has("serviceAttention") || moduleKeys.has("workOrdersByStatus") || moduleKeys.has("technicianComparison"),
  );
  const { summary: portfolio, state: portfolioState } = useAccountPortfolioSummary({
    enabled: moduleKeys.has("accountPortfolio"),
  });

  // The projection runs once. `null` while the read is unresolved -- NOT an empty array, which would
  // become four confirmed zeros on the goal tiles.
  const attentionSections = useMemo(() => {
    if (!moduleKeys.has("serviceAttention") || workOrdersLoading || workOrdersError) return null;
    return groupWorkOrderAttentionItemsBySection(workOrderAttentionItems({ workOrders: workOrders ?? [] }));
  }, [moduleKeys, workOrders, workOrdersLoading, workOrdersError]);

  // ---- BOUNDED ACTIONABLE PREVIEWS (Owner Decision #172). Rows of real work, never a count.
  //
  // Each read is gated on its module resolving, so no viewer opens a query their Rules would deny.
  // Nothing below sorts: every list keeps its domain's own order, because a priority invented on the
  // dashboard would disagree with the workspace the "View all" link leads to.
  const reorder = useReorderRequests(moduleKeys.has("reorderQueue"));
  // A reorder request stores a partId, not a part name. THE SAME RESOLVER the notification panel
  // uses turns it into the canonical name -- reused rather than re-derived, and never falling back
  // to the raw id, which #172 s8 forbids and which nobody could match to a shelf label anyway.
  const { resolveName: resolvePartName } = useCanonicalPartNames({
    uid: authUid,
    accessVersion: operationalContext?.accessVersion,
    enabled: moduleKeys.has("reorderQueue"),
  });
  const opportunityFeed = useOpportunities(governedOpportunitySource);
  const coordinated = useCoordinatedOperations();
  // DEVICE-LOCAL, and therefore genuinely COMPLETE (#172 §9). This is the one queue whose whole
  // truth lives on this device, so no server count is needed and none is invented for it.
  const { queue: submissionQueue } = useSubmissionQueue();

  // Receiving and the admin decision queue: existing governed callables, called once each.
  const receiving = useOneShot(fetchReceivablePurchaseOrders, moduleKeys.has("receivingQueue"));
  const adminDecisions = useOneShot(() => privilegedApprovalClient.listPending(), moduleKeys.has("adminDecisions"));

  // Technician names for the comparison, through the GOVERNED resolver. Ten surfaces in this repo
  // once hand-rolled this lookup and nine rendered a raw document id where a person's name belongs.
  const wantsTeam = moduleKeys.has("technicianComparison") || moduleKeys.has("technicianAvailability");
  // THE TECHNICIAN COLLECTION, in the shape the resolver actually takes.
  //
  // This first passed the employee directory's byUserId MAP and read `.displayName`. The resolver
  // takes `{ technicians: [{id, name}] }` and returns `.name`, so every row silently fell through
  // to its unresolved label -- the exact "raw id where a person's name belongs" family of defect
  // this resolver exists to prevent, arriving as a wrong-but-plausible label instead. Caught on the
  // rendered screen: two rows both read "Name not resolved".
  //
  // A technician id is NOT a user id. Same collection ControlTower reads, same resolver, same shape.
  const { data: technicians, loading: techniciansLoading, error: techniciansError } =
    useFirestoreCollection(TECHNICIANS_COLLECTION, wantsTeam);
  const resolveTechName = useMemo(
    () => (technicianId) =>
      resolveTechnicianIdentity(technicianId, {
        technicians: technicians ?? [],
        loading: techniciansLoading,
        error: techniciansError,
      }).name,
    [technicians, techniciansLoading, techniciansError],
  );

  // FINANCIALS. The reporting period is the GOVERNED one (G-05) -- month to date on the
  // America/Phoenix calendar -- never browser-local date arithmetic.
  const wantsFinance = moduleKeys.has("firmBilled") || moduleKeys.has("firmCollected");
  const financePeriod = useMemo(
    // periodType (not "type"), and the CALENDAR is required -- the resolver refuses to guess a
    // timezone, which is the whole point of G-05. The window is half-open: [start, endExclusive).
    () =>
      wantsFinance
        ? resolveReportingPeriod({
            periodType: "MTD",
            asOfMillis: Date.now(),
            calendar: TAYLOR_VENTANA_REPORTING_CALENDAR,
          }).current
        : null,
    [wantsFinance],
  );
  const financeFilters = useMemo(
    () =>
      financePeriod
        ? { periodStartMillis: financePeriod.startMillis, periodEndMillis: financePeriod.endInclusiveMillis }
        : {},
    [financePeriod],
  );
  const finance = useFinancialFacts(financeFilters, { enabled: wantsFinance });

  // TECHNICIAN AVAILABILITY -- recorded working hours for the governed reporting day.
  //
  // The technicians asked about are exactly those with work assigned in this viewer's governed
  // reach, taken from the SAME subscription: no second scope model, and no technician outside that
  // reach can appear. Availability itself is a server READ (both collections deny client reads).
  const wantsAvailability = moduleKeys.has("technicianAvailability");
  const availabilityWindow = useMemo(() => {
    if (!wantsAvailability) return null;
    const day = resolveReportingPeriod({
      periodType: "DAY",
      asOfMillis: Date.now(),
      calendar: TAYLOR_VENTANA_REPORTING_CALENDAR,
    }).current;
    // The availability read takes an INCLUSIVE end; the reporting window is half-open. Passing
    // endExclusive here would reach one millisecond into tomorrow.
    return { startMillis: day.startMillis, endMillis: day.endInclusiveMillis };
  }, [wantsAvailability]);
  const assignedTechnicianIds = useMemo(() => {
    if (!wantsAvailability || workOrdersLoading || workOrdersError) return [];
    return [...new Set((workOrders ?? []).map((w) => w?.assignedTechId).filter((id) => typeof id === "string" && id))];
  }, [wantsAvailability, workOrders, workOrdersLoading, workOrdersError]);
  const availability = useTechnicianAvailability({
    startMillis: availabilityWindow?.startMillis ?? 0,
    endMillis: availabilityWindow?.endMillis ?? 0,
    technicianIds: assignedTechnicianIds,
    enabled: wantsAvailability && assignedTechnicianIds.length > 0,
  });

  const teamProjections = useMemo(() => {
    const resolvedWorkOrders = !workOrdersLoading && !workOrdersError ? workOrders ?? null : null;
    return {
      byStatus: moduleKeys.has("workOrdersByStatus") ? projectWorkOrdersByStatus(resolvedWorkOrders) : null,
      technicians: wantsTeam ? projectTechnicianComparison(resolvedWorkOrders, resolveTechName) : null,
    };
  }, [moduleKeys, wantsTeam, workOrders, workOrdersLoading, workOrdersError, resolveTechName]);

  const previews = useMemo(() => {
    const showOpportunities = moduleKeys.has("myOpportunities");
    const showOrders = moduleKeys.has("ordersRequiringAction");
    return {
      reorderQueue: boundedPreview({
        rows: reorder.data ?? [],
        resolved: !reorder.loading && !reorder.error,
      }),
      unverifiedSubmissions: boundedPreview({
        rows: (submissionQueue ?? []).filter((s) => s?.status !== "CONFIRMED"),
        resolved: Array.isArray(submissionQueue),
      }),
      myOpportunities: boundedPreview({
        rows: showOpportunities ? opportunityFeed.opportunities ?? [] : [],
        // "unavailable" is a read failure, not an empty pipeline. Synthetic rows are refused
        // outright: a dashboard is the last place a sample may be mistaken for the book of business.
        resolved: showOpportunities && !opportunityFeed.loading && opportunityFeed.status === "ready" && !opportunityFeed.synthetic,
      }),
      receivingQueue: boundedPreview({
        rows: receiving.data?.purchaseOrders ?? [],
        // The client returns READY only for a well-formed answer; anything else -- denied, transport
        // off, malformed -- is UNAVAILABLE and must not read as an empty queue.
        resolved: receiving.resolved && receiving.data?.status === "READY",
      }),
      adminDecisions: boundedPreview({
        rows: Array.isArray(adminDecisions.data) ? adminDecisions.data : [],
        resolved: adminDecisions.resolved && Array.isArray(adminDecisions.data),
      }),
      ordersRequiringAction: boundedPreview({
        // ATTENTION is the domain's own blocked-state readiness, and `visits` already arrives
        // sorted attention-first by the hook. Filtering preserves that order; nothing re-sorts.
        rows: showOrders ? (coordinated.visits ?? []).filter((v) => v?.readiness === "ATTENTION") : [],
        resolved: showOrders && !coordinated.loading && coordinated.status === "ready" && !coordinated.synthetic,
      }),
    };
  }, [moduleKeys, reorder, submissionQueue, opportunityFeed, coordinated, receiving, adminDecisions]);

  /**
   * The situation line, as label/value pairs rather than one sentence.
   *
   * A dashboard's context is WHAT GOVERNS WHAT YOU ARE SEEING -- the reporting calendar the dated
   * figures use, and the scope that decided which modules are here at all. The previous single
   * sentence ("every figure here comes from the same authority...") was true of the whole platform
   * and told this reader nothing about their own screen.
   */
  const contextItems = useMemo(() => {
    const items = [
      { key: "period", label: "Reporting day", value: onDate },
      { key: "calendar", label: "Calendar", value: TAYLOR_VENTANA_REPORTING_CALENDAR.reportingTimeZone },
    ];
    if (warehouseIds.length > 0) {
      items.push({ key: "locations", label: warehouseIds.length === 1 ? "Location" : "Locations", value: String(warehouseIds.length) });
    }
    return items;
  }, [onDate, warehouseIds]);

  /**
   * ACTION ITEMS -- and only genuine ones.
   *
   * AttentionBand renders NOTHING when the list is empty, deliberately: "a band that says 'no
   * issues' every time trains people not to look at it". So this emits only signals that mean
   * something is wrong, never merely-true information. Ready-to-schedule work is work, not a
   * blocker, and is left to its module.
   *
   * The counts come from the SAME projection the module below renders, so the band and the module
   * can never disagree.
   */
  // DECLARED BEFORE THE ATTENTION ITEMS THAT READ IT. `const` is not hoisted: leaving this below
  // the memo that derives its action links would throw on first render, and the error boundary
  // would swallow it into a blank dashboard.
  const destinationGroups = useMemo(
    () => buildReachableGroups(role, allowedLegacyKeys, operationalContext),
    [role, allowedLegacyKeys, operationalContext],
  );

  const attentionItems = useMemo(() => {
    // DESTINATIONS ARE DERIVED, NEVER WRITTEN DOWN. `reachableHref` asks the same function the nav
    // rail and Go To section ask, and returns null when this principal cannot open the surface -- in
    // which case the row carries no link rather than a door that does not open.
    const serviceOps = reachableHref(destinationGroups, "serviceOperations", "serviceOperations");
    const dispatcherBoard = reachableHref(destinationGroups, "service", "dispatcherBoard");
    const linkTo = (href, label) => (href ? <Link to={href}>{label}</Link> : null);

    const items = [];
    for (const s of attentionSections ?? []) {
      if (s.sectionLabel === "Past Due") {
        items.push({
          key: "past-due",
          severity: "BLOCKING",
          fact: `${s.items.length} scheduled work order${s.items.length === 1 ? " is" : "s are"} past due`,
          // NO OWNER. An aggregate over many work orders has no single responsible person, and
          // inventing one to fill the optional field would attribute other people's work.
          link: linkTo(serviceOps, "Open Service Operations"),
        });
      }
      if (s.sectionLabel === "Scheduling Conflict") {
        items.push({
          key: "conflict",
          severity: "ATTENTION",
          fact: `${s.items.length} scheduling conflict${s.items.length === 1 ? "" : "s"} to resolve`,
          // The board is where a conflict is actually resolved, which is what makes this a link
          // worth having rather than a second way to read the same number.
          link: linkTo(dispatcherBoard, "Open Dispatcher Board"),
        });
      }
    }
    return items;
  }, [attentionSections, destinationGroups]);

  const actualsByKey = useMemo(
    () =>
      actualsByGoalKey(
        dashboardGoalActuals({
          attentionSections,
          portfolio: portfolioState === "READY" ? portfolio : null,
        }),
        goalKey,
      ),
    [attentionSections, portfolio, portfolioState],
  );

  if (sections.length === 0) {
    return (
      <WorkspaceShell title="My dashboard">
        <EmptyState
          icon={Compass}
          variant="database"
          title="Nothing to show yet"
          message="Your account doesn't currently resolve access to any business area. If this looks wrong, ask an administrator to check your role and employment status in Administration > Employees."
        />
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      title={displayName ? `Hi, ${displayName}` : "My dashboard"}
      context={<ContextBand items={contextItems} />}
    >
      {/* ACTION ITEMS FIRST, above every section. Renders nothing when there is nothing wrong --
          which is what makes it worth looking at when it does appear. */}
      <AttentionBand items={attentionItems} ariaLabel="Work needing attention" />
      {sections.map(({ section, label, modules }) => (
        <RuledSection key={section} title={label} id={`dashboard-${section.toLowerCase()}`}>
          {section === SECTION.GO_TO ? (
            <ReachableDestinations groups={destinationGroups} operationalContext={operationalContext} />
          ) : (
            // MODULES SIT IN A GRID, not a stack. At 1440 a one-module-per-row dashboard leaves two
            // thirds of the width empty and reads as a column of unrelated sentences; the section
            // rules stop doing their job because everything inside them is equally spaced. This is
            // NOT a card farm -- the modules remain unboxed, exactly as the design requires. It is
            // the same auto-fit grid the goal tiles already use, applied one level up.
            <div className="fo-dashboard-grid">
            {modules.map((m) => {
              if (m.state !== MODULE_STATE.READY) {
                return <BlockedModule key={m.key} label={m.label} blocker={m.blocker} />;
              }
              if (m.key === "serviceAttention") {
                return (
                  <ModuleFrame key={m.key} label={m.label}>
                    <ServiceAttentionModule grouped={attentionSections ?? []} loading={workOrdersLoading} error={workOrdersError} />
                  </ModuleFrame>
                );
              }
              if (m.key === "accountPortfolio") return <AccountPortfolioModule key={m.key} summary={portfolio} state={portfolioState} />;
              // ---- BOUNDED PREVIEWS (#172). Rows of real work; no counts, ever.
              if (m.key === "reorderQueue") {
                return (
                  <ModuleFrame key={m.key} label={m.label}>
                    <PreviewList
                      preview={previews.reorderQueue}
                      subject="Reorder requests"
                      emptyCopy="No reorder requests are waiting for review"
                      viewAll={{ href: reachableHref(destinationGroups, "inventory", "parts"), label: "View in Parts" }}
                      renderRow={(r) => ({
                        key: r.id,
                        // BUSINESS IDENTITY, never the document id (#172 s8). The canonical part
                        // name comes through the domain's OWN resolver -- the same one the
                        // notification panel uses -- and if it has not resolved the row SAYS SO
                        // rather than falling back to an id nobody can match to a shelf label.
                        primary: resolvePartName(r.partId) || "Part name not resolved",
                        // `requestedQty` is absent on legacy-shape requests, which is a real state
                        // and not an error -- the row simply carries no quantity.
                        secondary: r.requestedQty != null ? `Qty ${r.requestedQty}` : null,
                      })}
                    />
                  </ModuleFrame>
                );
              }
              if (m.key === "unverifiedSubmissions") {
                return (
                  <ModuleFrame key={m.key} label={m.label}>
                    <PreviewList
                      preview={previews.unverifiedSubmissions}
                      subject="Queued submissions"
                      emptyCopy="Everything you submitted has been confirmed"
                      viewAll={null}
                      renderRow={(s) => ({
                        key: s.id ?? s.commandKey,
                        primary: s.label || s.kind || "Queued submission",
                        secondary: s.status || null,
                      })}
                    />
                  </ModuleFrame>
                );
              }
              if (m.key === "myOpportunities") {
                return (
                  <ModuleFrame key={m.key} label={m.label}>
                    <PreviewList
                      preview={previews.myOpportunities}
                      subject="Opportunities"
                      emptyCopy="No opportunities are open in your reach"
                      viewAll={{ href: reachableHref(destinationGroups, "customers", "opportunities") }}
                      renderRow={(o) => ({
                        key: o.id,
                        primary: o.name || o.opportunityNumber || "Opportunity",
                        secondary: opportunityFeed.accountNameById?.[o.accountId] || o.stage || null,
                        href: reachableHref(destinationGroups, "customers", "opportunities")
                          ? `/customers/opportunities/${o.id}`
                          : null,
                      })}
                    />
                  </ModuleFrame>
                );
              }
              if (m.key === "receivingQueue") {
                return (
                  <ModuleFrame key={m.key} label={m.label}>
                    <PreviewList
                      preview={previews.receivingQueue}
                      subject="Purchase orders awaiting receipt"
                      emptyCopy="No purchase orders are awaiting receipt"
                      viewAll={{ href: reachableHref(destinationGroups, "inventory", "receiving"), label: "Open Receiving" }}
                      renderRow={(po) => ({
                        key: po.purchaseOrderId,
                        primary: po.purchaseOrderId,
                        secondary: `${po.storedStatus} · ${po.lineCount} line${po.lineCount === 1 ? "" : "s"}`,
                      })}
                    />
                  </ModuleFrame>
                );
              }
              if (m.key === "adminDecisions") {
                return (
                  <ModuleFrame key={m.key} label={m.label}>
                    <PreviewList
                      preview={previews.adminDecisions}
                      subject="Role requests"
                      emptyCopy="No role requests are waiting for your decision"
                      viewAll={{ href: reachableHref(destinationGroups, "administration", "users"), label: "Open Administration" }}
                      renderRow={(r) => ({
                        key: r.requestId,
                        primary: r.requestedForDisplayName || r.requestedForEmail || "Role request",
                        secondary: r.roleId || r.requestedRole || null,
                      })}
                    />
                    <p className="fo-muted">
                      {/* NAMED, not totalled. Role requests are ONE class of admin decision; access
                          requests and password resets have server callables but no governed client
                          list read, so folding them into one number would assert a completeness
                          nothing here can support. */}
                      Role requests only. Other administration queues are shown in Administration.
                    </p>
                  </ModuleFrame>
                );
              }
              if (m.key === "ordersRequiringAction") {
                return (
                  <ModuleFrame key={m.key} label={m.label}>
                    <PreviewList
                      preview={previews.ordersRequiringAction}
                      subject="Orders requiring action"
                      emptyCopy="No coordinated visits need attention right now"
                      viewAll={{ href: reachableHref(destinationGroups, "service", "coordinatedVisits") }}
                      renderRow={(v) => ({
                        key: v.salesOrderId,
                        primary: coordinated.salesOrderLabelById?.[v.salesOrderId] || "Sales order",
                        secondary: coordinated.accountNameById?.[v.customerId] || null,
                      })}
                    />
                  </ModuleFrame>
                );
              }
              if (m.key === "workOrdersByStatus") {
                const rows = teamProjections.byStatus;
                return (
                  <ModuleFrame key={m.key} label={m.label}>
                    {rows === null ? (
                      <HonestState state={HONEST_STATE.UNAVAILABLE} subject="Work orders by status" detail="Work orders could not be read just now." />
                    ) : rows.length === 0 ? (
                      <StatusIndicator tone="positive" label="No work orders in your scope" />
                    ) : (
                      <>
                        <div className="fo-stat-grid">
                          {rows.map((r) => <CompactMetric key={r.status} value={r.count} label={r.status} />)}
                        </div>
                        <p className="fo-muted">
                          {/* A COMPLETE count, and permitted for exactly that reason: the read is an
                              unbounded subscription narrowed only by Rules, not a page. Stored
                              statuses only -- past due and conflicts overlap each other and live in
                              Service attention, which says its counts are not a total. */}
                          Actual recorded statuses, counted across everything you can see.
                        </p>
                      </>
                    )}
                  </ModuleFrame>
                );
              }
              if (m.key === "technicianComparison") {
                const rows = teamProjections.technicians;
                return (
                  <ModuleFrame key={m.key} label={m.label}>
                    {rows === null ? (
                      <HonestState state={HONEST_STATE.UNAVAILABLE} subject="By technician" detail="Work orders could not be read just now." />
                    ) : rows.length === 0 ? (
                      <StatusIndicator tone="positive" label="No work is assigned to a technician in your scope" />
                    ) : (
                      <>
                        <ul className="fo-preview-list">
                          {rows.map((t) => (
                            <li key={t.technicianId} className="fo-preview-list__row">
                              <div className="fo-preview-list__line">
                                <span className="fo-preview-list__primary">{t.name}</span>
                                <span className="fo-preview-list__secondary">
                                  {t.open} open · {t.completed} completed
                                </span>
                              </div>
                            </li>
                          ))}
                        </ul>
                        {/* THE RESERVED HALF, STATED. Rows are in NAME order and carry no rank,
                            score or colour: a table sorted by completed count IS a leaderboard
                            whatever the headings say, and throughput alone is not the whole of the
                            job. An absent quality column would read as "nothing more to know". */}
                        <p className="fo-muted">{TECHNICIAN_QUALITY_UNAVAILABLE}</p>
                      </>
                    )}
                  </ModuleFrame>
                );
              }
              if (m.key === "technicianAvailability") {
                const rows = availability.data?.technicians ?? null;
                return (
                  <ModuleFrame key={m.key} label={m.label}>
                    {assignedTechnicianIds.length === 0 ? (
                      <StatusIndicator tone="info" label="No technicians have work assigned in your scope today" />
                    ) : availability.loading ? (
                      <HonestState state={HONEST_STATE.LOADING} subject="Technician availability" />
                    ) : availability.error || rows === null ? (
                      <HonestState state={HONEST_STATE.UNAVAILABLE} subject="Technician availability" detail="Recorded working hours could not be read just now." />
                    ) : (
                      <>
                        <ul className="fo-preview-list">
                          {rows.map((v) => (
                            <li key={v.technicianId} className="fo-preview-list__row">
                              <div className="fo-preview-list__line">
                                <span className="fo-preview-list__primary">{resolveTechName(v.technicianId) || "Name not resolved"}</span>
                                <span className="fo-preview-list__secondary">
                                  {/* ABSENT IS NOT EMPTY. `availableMinutes: null` means NO RECORDED
                                      SCHEDULE, and rendering it as 0 would state that someone is
                                      unavailable all day -- a claim about a person's working week
                                      that nobody made. */}
                                  {typeof v.availableMinutes === "number"
                                    ? `${Math.round(v.availableMinutes / 60)}h recorded today`
                                    : "No working hours recorded"}
                                </span>
                              </div>
                            </li>
                          ))}
                        </ul>
                        <p className="fo-muted">
                          Recorded working hours for today, on the company reporting calendar. A technician with no recorded schedule is not shown as unavailable — nothing has been recorded either way.
                        </p>
                      </>
                    )}
                  </ModuleFrame>
                );
              }
              if (m.key === "firmBilled" || m.key === "firmCollected") {
                const field = m.key === "firmBilled" ? "billedByCurrency" : "collectedByCurrency";
                const ready = !finance.loading && !finance.errorStatus && finance.result?.status === "ready";
                const companies = ready ? finance.result.byCompany ?? [] : null;
                return (
                  <ModuleFrame key={m.key} label={m.label}>
                    {companies === null ? (
                      <HonestState
                        state={HONEST_STATE.UNAVAILABLE}
                        subject={m.label}
                        // The server REFUSES to summarize a truncated page -- "a partial set
                        // summarized confidently is worse than no set". That refusal is preserved
                        // verbatim rather than being softened into a number.
                        detail="The governed period figure could not be read, or the period contains more records than the read will summarize."
                      />
                    ) : companies.length === 0 ? (
                      <StatusIndicator tone="info" label="Nothing recorded for this period" />
                    ) : (
                      <>
                        <div className="fo-stat-grid">
                          {companies.flatMap((row) =>
                            Object.entries(row[field] ?? {}).map(([currency, minor]) => (
                              <CompactMetric
                                key={`${row.key}-${currency}`}
                                value={`${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`}
                                label={`${row.key} — ${m.label.toLowerCase()}`}
                              />
                            )),
                          )}
                        </div>
                        <p className="fo-muted">
                          {/* PER COMPANY, PER CURRENCY, AND DELIBERATELY NOT SUMMED. Adding the two
                              operating companies together needs an intercompany elimination rule
                              that does not exist (FIN-BLOCK-004), and adding currencies needs an FX
                              policy that does not either. Both would be arithmetic the platform has
                              not authorized, performed in a browser. */}
                          Month to date on the company reporting calendar, shown per company and per currency. Not combined.
                        </p>
                      </>
                    )}
                  </ModuleFrame>
                );
              }
              if (m.key === "myGoals" || m.key === "teamGoals") {
                const scoped = targets.filter((t) =>
                  m.key === "myGoals" ? t.targetScopeType === "EMPLOYEE" : t.targetScopeType !== "EMPLOYEE",
                );
                if (scoped.length === 0) return null;
                return (
                  <ModuleFrame key={m.key} label={m.label}>
                    <GoalGrid targets={scoped} feed={goalFeed} actualsByKey={actualsByKey} />
                  </ModuleFrame>
                );
              }
              // Unreachable: every READY module is wired above. Kept as a loud failure rather than a
              // silent blank, so adding a module to the table without composing it is caught on the
              // screen instead of shipping as an empty card that looks intentional.
              return (
                <BlockedModule
                  key={m.key}
                  label={m.label}
                  blocker="This module is declared but not composed. That is a defect, not a governance limit."
                />
              );
          })}
            </div>
          )}
        </RuledSection>
      ))}
    </WorkspaceShell>
  );
}
