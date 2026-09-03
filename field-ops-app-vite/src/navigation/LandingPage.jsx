// feat/visual-today-page -- the role-aware "what needs me right now" landing surface.
//
// SCOPE OF THIS SURFACE: today, `DashboardIndex` in App.jsx renders a real screen
// (`TechnicianDashboard`) for a technician, but for admin/dispatcher it renders a bare
// hand-styled grid of five HARD-CODED links (`LANDING_AREAS`), unrelated to what that
// specific signed-in person can actually reach -- an admin/dispatcher with no Reporting
// capability sees the same five links as one who has it, and a dispatcher without the
// Field Mode legacyKey would still see it if it were ever added to that list. This
// component replaces that hard-coded list with the person's REAL, currently-visible
// destination set, computed the exact same way the navigation rail computes its own
// visibility -- so "what needs me right now" can never show a destination this role/
// capability combination cannot actually open, and never omits one it can.
//
// DATA SOURCE, and why it is honest: `isDomainVisible`/`isNavItemVisible` (./navConfig.js)
// are the SAME functions AppRail/AppRoutes already use to decide the rail and the route
// table for this exact signed-in principal (role, allowedLegacyKeys, operationalContext,
// including the trusted `hasCapability` feed for governed surfaces like Report Builder).
// Reusing them here means this screen shows literally the person's own real access, not a
// fabricated number or a second opinion about what they can do. No metric, no count -- a
// destination is either genuinely reachable right now, or it is not listed.
//
// TECHNICIAN IS OUT OF SCOPE FOR THIS COMPONENT. A technician already has a real,
// data-backed landing screen (`TechnicianDashboard`) that this program did not touch or
// need to touch. This component is not a technician-capable replacement for it -- it
// covers the admin/dispatcher gap only. See this branch's PR body / agent report for the
// one-line App.jsx wiring this still needs (out of this component's file scope).
import { Link } from "react-router-dom";
import {
  Users,
  Wrench,
  ClipboardList,
  Radar,
  Boxes,
  ShoppingCart,
  BarChart3,
  Settings,
  Compass,
} from "lucide-react";
import { NAV_DOMAINS, isDomainVisible, isNavItemVisible } from "./navConfig.js";
import PageHeader from "../shared/ui/primitives/PageHeader.jsx";
import SectionHeader from "../shared/ui/primitives/SectionHeader.jsx";
import StatusIndicator from "../shared/ui/primitives/StatusIndicator.jsx";
import Icon from "../shared/ui/Icon.jsx";
import EmptyState from "../shared/ui/EmptyState.jsx";

const ROLE_LABEL = {
  admin: "Admin",
  dispatcher: "Dispatcher",
};

// Decoration only -- picking a glyph per domain communicates nothing about data or
// counts. A domain absent from this map (there is always one: "dashboard" is filtered
// out before rendering) simply gets no icon rather than a wrong one.
const DOMAIN_ICON = {
  customers: Users,
  equipment: Wrench,
  service: ClipboardList,
  serviceOperations: Radar,
  inventory: Boxes,
  purchasing: ShoppingCart,
  reporting: BarChart3,
  administration: Settings,
};

function itemHref(domain, item) {
  return item.path ? `/${domain.path}/${item.path}` : `/${domain.path}`;
}

// True only when THIS principal's session actually resolved a positive governed
// capability decision for the item -- never merely because the item declares
// `capabilityAccess`. Several governed items (e.g. Inventory > Parts, > Transfers, >
// Cycle Counts) also carry a `legacyKey` compatibility fallback and can be visible via
// that path with no governed grant at all; badging those "capability granted" would be
// exactly the fabricated claim this program forbids. This mirrors navConfig.js's own
// private `holdsDeclaredCapability` check (not imported -- that helper is internal to
// the module) against the same `operationalContext.hasCapability` feed every visibility
// decision on this screen already uses.
function hasGrantedCapability(item, operationalContext) {
  const hasCapability = operationalContext?.hasCapability;
  if (typeof hasCapability !== "function" || !item.capabilityAccess) return false;
  return item.capabilityAccess.some((cap) => hasCapability(cap) === true);
}

// The person's real, currently-open destinations, grouped by domain, in the same order
// the navigation rail presents them. "dashboard" is excluded (this screen IS that
// domain's index); a `navHidden` item is excluded too, for the same reason it is hidden
// from the rail -- this screen does not surface a destination the rail itself keeps out
// of normal navigation. A domain with no subnav (the `future` placeholders) or with no
// currently-visible item is omitted entirely rather than shown empty.
export function buildReachableGroups(role, allowedLegacyKeys, operationalContext) {
  const groups = [];
  for (const domain of NAV_DOMAINS) {
    if (domain.key === "dashboard") continue;
    if (!Array.isArray(domain.subnav) || domain.subnav.length === 0) continue;
    if (!isDomainVisible(domain, role, allowedLegacyKeys, operationalContext)) continue;
    const items = domain.subnav.filter(
      (item) => !item.navHidden && isNavItemVisible(item, role, allowedLegacyKeys, operationalContext),
    );
    if (items.length === 0) continue;
    groups.push({ domain, items });
  }
  return groups;
}

/**
 * The destination grid, extracted so My Dashboard's GO TO section is the SAME component rather than
 * a second rendering of the same idea.
 *
 * That extraction is the whole reason it exists: two implementations of "which destinations can this
 * person open" would agree on the day they were written and drift on the first nav change, and the
 * drift would be silent in the direction that matters -- a dashboard offering a door that does not
 * open. One component, one answer.
 */
export function ReachableDestinations({ groups, operationalContext }) {
  return groups.map(({ domain, items }) => {
    const DomainIcon = DOMAIN_ICON[domain.key];
    return (
      <section key={domain.key} className="fo-landing-group">
        <SectionHeader
          title={
            <span className="fo-landing-group__title">
              {DomainIcon && <Icon icon={DomainIcon} size="dense" />}
              {domain.label}
            </span>
          }
        />
        <div className="fo-landing-grid">
          {items.map((item) => (
            <Link key={item.key} to={itemHref(domain, item)} className="fo-landing-card">
              <span className="fo-landing-card-title">{item.label}</span>
              {hasGrantedCapability(item, operationalContext) && (
                <StatusIndicator tone="info" label="Capability granted" />
              )}
            </Link>
          ))}
        </div>
      </section>
    );
  });
}

export default function LandingPage({ role, allowedLegacyKeys = [], operationalContext = {} }) {
  const groups = buildReachableGroups(role, allowedLegacyKeys, operationalContext);
  const roleLabel = ROLE_LABEL[role] ?? "your";

  return (
    <div className="fo-panel fo-landing">
      <PageHeader
        eyebrow="My Dashboard"
        title="What needs you right now"
        description={`Every destination below is one your ${roleLabel} access already opens. Nothing here is a placeholder, and nothing here is a count you can't otherwise see.`}
      />

      {groups.length === 0 ? (
        <EmptyState
          icon={Compass}
          variant="database"
          title="Nothing to show yet"
          message="Your account doesn't currently resolve access to any business area. If this looks wrong, ask an administrator to check your role and employment status in Administration > Employees."
        />
      ) : (
        <ReachableDestinations groups={groups} operationalContext={operationalContext} />
      )}
    </div>
  );
}

// WIRING NOTE, RESOLVED. This previously said App.jsx still needed `allowedLegacyKeys` and
// `operationalContext` threaded into `DashboardIndex`. That wiring landed, and the note had gone
// stale -- corrected here rather than left to mislead the next reader into re-doing it.
//
// SUPERSEDED AS THE DASHBOARD INDEX. `MyDashboard` is now the non-technician dashboard, and this
// component's destination grid is its GO TO section via `ReachableDestinations` above. This file
// remains the authority for WHICH destinations are reachable; it is no longer the whole screen.
