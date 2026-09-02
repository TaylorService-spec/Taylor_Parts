import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Wrench,
  ClipboardList,
  Radar,
  Package,
  PackageCheck,
  ShoppingCart,
  BarChart3,
  Settings,
  DollarSign,
} from "lucide-react";
import {
  NAV_DOMAINS,
  isDomainVisible,
  isNavItemVisible,
  buildServiceNavGroups,
  buildFinancialsNavGroups,
  findActiveServiceGroupKey,
} from "./navConfig";
import VerenwardMark from "../shared/brand/VerenwardMark";
import Icon from "../shared/ui/Icon";
import { useAuth } from "../auth/AuthContext";
import { Button } from "../shared/ui/primitives/index.js";

// One glyph per operational domain, so the rail reads by shape as well as by
// label -- a keyboard/mouse-agnostic scan aid, not a substitute for the text.
// Kept here (not in navConfig.js) because navConfig is the pure, framework-free
// nav-tree/permission source of truth; icon choice is presentation. Every
// glyph goes through the Icon wrapper at the "nav" size token (20px, the scale
// this system reserves specifically for rail/navigation icons) so every
// domain row carries an icon of the exact same size -- never an ad-hoc one.
const DOMAIN_ICONS = {
  dashboard: LayoutDashboard,
  customers: Users,
  equipment: Wrench,
  service: ClipboardList,
  serviceOperations: Radar,
  inventory: Package,
  inventoryRole: PackageCheck,
  purchasing: ShoppingCart,
  reporting: BarChart3,
  administration: Settings,
  financials: DollarSign,
};

function DomainIcon({ domainKey }) {
  const glyph = DOMAIN_ICONS[domainKey];
  if (!glyph) return null;
  // flexShrink:0 keeps the glyph at its fixed token size even when a long
  // domain label is fighting it for space in the same flex row -- the row's
  // own layout (display:flex, gap) already comes from .fo-rail__domain-row.
  return (
    <span className="fo-rail__domain-icon">
      <Icon icon={glyph} size="nav" />
    </span>
  );
}

/**
 * AppRail — Gate 2's unified navigation surface.
 *
 * Replaces the previous two-axis model (a horizontal domain row in the dark
 * header PLUS a horizontal per-domain sub-nav below it). Both axes overflowed
 * independently: eleven domains already wrapped to two rows, and a growing
 * domain would have hit the same wall inside its own row. One vertical rail
 * absorbs growth by scrolling instead of wrapping.
 *
 * WHAT THIS DOES NOT CHANGE. Every destination, path, ordering and access rule
 * comes from navConfig exactly as before — isDomainVisible / isNavItemVisible
 * are called with the same arguments the horizontal shell passed, and the
 * Service two-level model still comes from buildServiceNavGroups. This is a
 * presentation of the existing taxonomy, not a new one.
 *
 * Hierarchy rendered:
 *   DOMAIN                       (toggle — expanding never navigates)
 *     Item                       (destination)
 *     GROUP LABEL                (Service only; organisational, not a route)
 *       Item                     (destination)
 *
 * Domain rows are buttons, not links, so expanding to see what a domain
 * contains cannot move you off the page you are on. Every route stays
 * reachable because each domain's landing route is itself a child with
 * `path: ""` (e.g. Inventory > Parts === /inventory). The exception is a
 * `future` placeholder domain, which has no visible children at all — that row
 * stays a link so the placeholder remains reachable.
 */

// A domain row is a LEAF LINK (not an accordion) when expanding it could not
// tell the user anything they do not already know:
//   - a future/placeholder domain has no children at all, so the row must itself
//     be the destination;
//   - a domain with exactly ONE destination and no groups would expand to a
//     restatement of its own label (Equipment -> "Equipment", Service Operations
//     -> "Service Operations"). A disclosure that costs a click and reveals
//     nothing new is IA generated from a route table, not designed. Persona
//     review flagged all three.
// Returns the single destination when there is one, so the caller can link
// straight to it.
function leafDestination(children) {
  const total = children.groups.length + children.ungrouped.length;
  if (total === 0) return { isLeaf: true, item: null };
  if (children.groups.length === 0 && children.ungrouped.length === 1) {
    return { isLeaf: true, item: children.ungrouped[0] };
  }
  return { isLeaf: false, item: null };
}

function ItemLink({ domainPath, item, onNavigate, depth = 1, activeRef = null }) {
  const to = `/${domainPath}${item.path ? `/${item.path}` : ""}`;
  return (
    <NavLink
      to={to}
      end={item.path === ""}
      onClick={onNavigate}
      ref={(el) => {
        // Only the active item claims the ref, so the shell can scroll the
        // current location back into view without tracking indices.
        if (el && activeRef && el.classList.contains("fo-rail__item--active")) activeRef.current = el;
      }}
      className={({ isActive }) =>
        `fo-rail__item fo-rail__item--d${depth}${isActive ? " fo-rail__item--active" : ""}`
      }
    >
      {item.label}
    </NavLink>
  );
}

export default function AppRail({
  role,
  allowedLegacyKeys,
  operationalContext,
  activeDomainPath,
  onNavigate,
  idPrefix = "fo-rail",
}) {
  // Visible domains, each paired with its visible children in the same shape
  // the horizontal shell used. Recomputed only when access inputs change.
  const domains = useMemo(() => {
    return NAV_DOMAINS.filter((d) =>
      isDomainVisible(d, role, allowedLegacyKeys, operationalContext),
    ).map((domain) => {
      const visibleSubnav = domain.future
        ? []
        : (domain.subnav ?? []).filter(
            (item) =>
              isNavItemVisible(item, role, allowedLegacyKeys, operationalContext) &&
              !item.navHidden,
          );
      const children =
        domain.key === "service"
          ? buildServiceNavGroups(visibleSubnav)
          : domain.key === "financials"
            ? buildFinancialsNavGroups(visibleSubnav)
            : { groups: [], ungrouped: visibleSubnav };
      return { domain, children };
    });
  }, [role, allowedLegacyKeys, operationalContext]);

  // MULTI-EXPAND, with the scroll problem solved directly rather than by
  // rationing expansion.
  //
  // Round 1 produced two OPPOSING findings. Admin measured multi-expand
  // scrolling the brand block and the current selection off the top (1462px of
  // nav in an 800px rail). Inventory then measured single-expand breaking the
  // Inventory<->Purchasing hot path: opening one collapsed the other, and an
  // inventory operator works those two together all day.
  //
  // Rationing fixed the symptom and broke the workflow. The real defects were
  // that the brand block scrolled away (now sticky) and that the rail never
  // scrolled your current location back into view (now it does). With both
  // fixed, several open domains cost only scroll depth -- which is what a
  // scrollable rail is for.
  const [expanded, setExpanded] = useState(() => new Set(activeDomainPath ? [activeDomainPath] : []));
  const lastDomain = useRef(activeDomainPath);
  useEffect(() => {
    if (activeDomainPath && activeDomainPath !== lastDomain.current) {
      lastDomain.current = activeDomainPath;
      setExpanded((prev) => new Set(prev).add(activeDomainPath));
    }
  }, [activeDomainPath]);

  const toggle = (path) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  // Keep "where am I" visible. Review found the selected destination sitting at
  // y=866 inside an 844px drawer that opened at scrollTop 0 -- off-screen. The
  // active item registers itself below and is scrolled into view on mount and
  // whenever the current route changes.
  //
  // This used to depend on [activeDomainPath] alone, so switching between two
  // items WITHIN the same already-expanded domain (e.g. Service > Scheduling
  // -> Service > Warranty) changed which item was active without the effect
  // ever re-running -- the newly active item never scrolled into view. Keying
  // on the full pathname instead fires the effect for every in-domain
  // selection too, not just a domain change.
  const location = useLocation();
  const activeItemRef = useRef(null);
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [location.pathname]);

  return (
    <nav className="fo-rail__nav" aria-label="Primary">
      <ul className="fo-rail__list">
        {domains.map(({ domain, children }) => {
          const isCurrent = domain.path === activeDomainPath;
          const { isLeaf, item: soleItem } = leafDestination(children);
          const open = expanded.has(domain.path);
          const panelId = `${idPrefix}-${domain.key}`;
          // Which of this domain's groups (if any) contains the current
          // route, so the group itself can carry an active/current visual
          // cue -- not just its child item. Only meaningful when the
          // current route is actually inside this domain; navConfig's
          // findActiveServiceGroupKey was exported and unit-tested but never
          // called from here, so the group heading never reflected "you are
          // in this group" the way the item link already does.
          const pathTail = isCurrent
            ? location.pathname.slice(domain.path.length + 1).replace(/^\//, "")
            : null;
          const activeGroupKey =
            isCurrent && children.groups.length > 0
              ? findActiveServiceGroupKey(pathTail, children.groups)
              : null;

          return (
            <li key={domain.key} className="fo-rail__domain">
              {isLeaf ? (
                <NavLink
                  // A single-destination domain links straight to that
                  // destination, so the row goes where its label promises.
                  to={soleItem ? `/${domain.path}${soleItem.path ? `/${soleItem.path}` : ""}` : `/${domain.path}`}
                  end={soleItem ? soleItem.path === "" : undefined}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `fo-rail__domain-row fo-rail__domain-row--leaf${isActive ? " fo-rail__domain-row--current" : ""}`
                  }
                >
                  <DomainIcon domainKey={domain.key} />
                  {/* Occupies the chevron's slot so a leaf row's label lands on the
                      same edge as an expandable row's. It must sit HERE, between the
                      icon and the label, because that is where the chevron sits --
                      the previous ::before spacer rendered before the icon and so
                      indented the whole row instead of aligning the label. */}
                  <span className="fo-rail__chevron-spacer" aria-hidden="true" />
                  <span className="fo-rail__domain-label">{domain.label}</span>
                </NavLink>
              ) : (
                <button
                  type="button"
                  className={`fo-rail__domain-row${isCurrent ? " fo-rail__domain-row--current" : ""}`}
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => toggle(domain.path)}
                >
                  <DomainIcon domainKey={domain.key} />
                  {/* Rotates via CSS; purely decorative next to a labelled
                      button whose aria-expanded already carries the state. */}
                  <span className="fo-rail__chevron" aria-hidden="true" />
                  <span className="fo-rail__domain-label">{domain.label}</span>
                </button>
              )}

              {/* The panel is ALWAYS rendered and hidden when collapsed, so
                  aria-controls never points at a missing element — a collapsed
                  domain previously referenced an id that was not in the DOM,
                  which some assistive tech announces as nothing at all. */}
              {!isLeaf && (
                <div className="fo-rail__panel" id={panelId} hidden={!open}>
                  {children.ungrouped.map((item) => (
                    <ItemLink
                      key={item.key}
                      domainPath={domain.path}
                      item={item}
                      onNavigate={onNavigate}
                      activeRef={activeItemRef}
                    />
                  ))}
                  {children.groups.map((group) => (
                    <div
                      key={group.key}
                      className={`fo-rail__group${group.key === activeGroupKey ? " fo-rail__group--active" : ""}`}
                      role="group"
                      aria-label={group.label}
                      aria-current={group.key === activeGroupKey ? "true" : undefined}
                    >
                      {/* Organisational hierarchy, deliberately not a link: the
                          group's landing is simply its first child, which is
                          already listed directly beneath it. findActiveServiceGroupKey
                          decides whether THIS group contains the current route, so the
                          heading itself can carry the same "you are here" cue its child
                          item already gets from fo-rail__item--active. */}
                      <p className="fo-rail__group-label">{group.label}</p>
                      {group.items.map((item) => (
                        <ItemLink
                          key={item.key}
                          domainPath={domain.path}
                          item={item}
                          onNavigate={onNavigate}
                          depth={2}
                          activeRef={activeItemRef}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The identity block at the FOOT of the rail: who is signed in, the role their access actually
 * resolves to, and the existing sign-out.
 *
 * IT REFLECTS, IT DOES NOT SELECT. There is no role switcher here and there must not be one: a
 * control that changed the displayed role would either be a lie (the label changing while authority
 * did not) or a privilege escalation (authority changing because a label did). The role shown is the
 * one `resolveEmployeeSession` already resolved for this principal, read through the same
 * `useAuth()` the header has always used.
 *
 * IT WIDENS NOTHING. No new read, no new capability, no new prop -- `useAuth()` is already the
 * source of `role` and `logout` for AppHeader, and this is a second consumer of the same context.
 * Sign-out behaviour is the existing one, unchanged.
 *
 * A principal whose session carries no role renders the ROLE LINE ABSENT rather than a guess or a
 * placeholder: "no role resolved" is a real state (an unlinked or inactive employee), and inventing
 * a label for it would hide exactly the condition an administrator needs to see.
 */
const ROLE_LABEL = Object.freeze({
  admin: "Administrator",
  dispatcher: "Dispatcher",
  technician: "Technician",
});

export function RailIdentity() {
  const { user, role, displayName, logout } = useAuth();
  if (!user) return null;
  const name = displayName || user.email || "Signed in";
  return (
    <div className="fo-rail-identity">
      <span className="fo-rail-identity__name" title={name}>{name}</span>
      {role ? <span className="fo-rail-identity__role">{ROLE_LABEL[role] ?? role}</span> : null}
      <Button variant="tertiary" onClick={logout} className="fo-rail-identity__signout">
        Sign out
      </Button>
    </div>
  );
}

/** The brand block that sits at the head of the rail, on evergreen chrome. */
export function RailBrand() {
  return (
    <div className="fo-rail__brand">
      <VerenwardMark variant="horizontal" tone="onDark" size={30} />
      <span className="fo-implementation">
        <span className="fo-implementation__name">Taylor Parts</span>
        {/* Company context, per the ruled brand hierarchy (Parent brand =
            Verenward, Platform = Enterprise Operations OS, Workspace = Taylor
            Parts, Company context = Taylor Freezer of Arizona). This used to
            read "Arizona Operations" -- a name that appears nowhere else in
            the ruled hierarchy or the wider docs corpus. */}
        <span className="fo-implementation__context">Taylor Freezer of Arizona</span>
      </span>
    </div>
  );
}
