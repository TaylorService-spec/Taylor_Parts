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
import { useAuth } from "../../auth/AuthContext.jsx";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import RuledSection from "../../shared/ui/RuledSection.jsx";
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState.jsx";
import StatusIndicator from "../../shared/ui/primitives/StatusIndicator.jsx";
import CompactMetric from "../../shared/ui/primitives/CompactMetric.jsx";
import EmptyState from "../../shared/ui/EmptyState.jsx";
import { ReachableDestinations, buildReachableGroups } from "../../navigation/LandingPage.jsx";
import { composeDashboard, goalTargetsFor, resolvedModuleKeys, MODULE_STATE, SECTION } from "../../domain/dashboardComposition.js";
import { usePerformanceGoals, goalKey } from "../../hooks/usePerformanceGoals.js";
import { useAccountPortfolioSummary } from "../../hooks/useAccountPortfolioSummary.js";
import { fetchReorderWarehouseOptions } from "../../services/reorderCallableClient.js";
import { reportingDayIso } from "../../domain/reportingPeriod.js";
import { useWorkOrders } from "../../hooks/useWorkOrders.js";
import {
  workOrderAttentionItems,
  groupWorkOrderAttentionItemsBySection,
} from "../../domain/workOrderAttentionProjection.js";
import { dashboardGoalActuals, actualsByGoalKey } from "../../domain/dashboardGoalActuals.js";
import GoalGrid from "./GoalGrid.jsx";

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
  const { employeeId, displayName, operationalRoles } = useAuth();
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
  const { data: workOrders, loading: workOrdersLoading, error: workOrdersError } = useWorkOrders(
    moduleKeys.has("serviceAttention"),
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

  const destinationGroups = useMemo(
    () => buildReachableGroups(role, allowedLegacyKeys, operationalContext),
    [role, allowedLegacyKeys, operationalContext],
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
      context={
        <StatusIndicator
          tone="info"
          label="Every figure here comes from the same authority that governs its own workspace"
        />
      }
    >
      {sections.map(({ section, label, modules }) => (
        <RuledSection key={section} title={label} id={`dashboard-${section.toLowerCase()}`}>
          {section === SECTION.GO_TO ? (
            <ReachableDestinations groups={destinationGroups} operationalContext={operationalContext} />
          ) : (
            modules.map((m) => {
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
            })
          )}
        </RuledSection>
      ))}
    </WorkspaceShell>
  );
}
