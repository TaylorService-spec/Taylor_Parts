import { NavLink, useLocation } from "react-router-dom";
import {
  NAV_DOMAINS,
  isDomainVisible,
  isNavItemVisible,
  buildServiceNavGroups,
  findActiveServiceGroupKey,
} from "./navConfig";

// Sprint 2.0.1 -- top-level domain tabs + the active domain's sub-nav.
// Real <NavLink> anchors (not onClick + setState) so the browser's
// native back/forward + address bar all work without any custom
// history plumbing -- see App.jsx's header comment for why that's the
// whole point of this sprint.
//
// Platform Task 2 -- the Service domain's sub-nav is a two-level hierarchy
// (Work Management / Dispatch / Technician Workspace groups + children, plus
// standalone items like Control Tower). Every OTHER domain keeps the flat
// sub-nav below, byte-for-byte unchanged. The grouping is presentation-only --
// see navConfig.js's buildServiceNavGroups.

function navLinkClass({ isActive }) {
  return isActive ? "fo-nav-btn fo-nav-btn-active" : "fo-nav-btn";
}

// Two-level Service sub-nav. Each group is a labelled section whose header links
// to the group's landing (its first visible child); the active group (the one
// containing the current route) is marked for the active-group highlight.
function ServiceSubnav({ domainPath, groups, ungrouped, activeGroupKey }) {
  const href = (item) => `/${domainPath}${item.path ? `/${item.path}` : ""}`;
  return (
    <nav className="fo-nav fo-subnav fo-service-subnav" aria-label="Service sections">
      {groups.map((group) => (
        <div
          key={group.key}
          className={`fo-nav-group${group.key === activeGroupKey ? " fo-nav-group-active" : ""}`}
          role="group"
          aria-label={group.label}
        >
          {/* Group header -> the group landing (first reachable child). */}
          <NavLink to={href(group.landing)} end={group.landing.path === ""} className="fo-nav-group-header">
            {group.label}
          </NavLink>
          <div className="fo-nav-group-items">
            {group.items.map((item) => (
              <NavLink key={item.key} to={href(item)} end={item.path === ""} className={navLinkClass}>
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
      {ungrouped.map((item) => (
        <div key={item.key} className="fo-nav-group fo-nav-group-standalone">
          <NavLink to={href(item)} end={item.path === ""} className={navLinkClass}>
            {item.label}
          </NavLink>
        </div>
      ))}
    </nav>
  );
}

export default function AppShell({ role, allowedLegacyKeys, operationalContext, children }) {
  const location = useLocation();
  const activeDomainPath = location.pathname.split("/").filter(Boolean)[0];
  const activeDomain = NAV_DOMAINS.find((d) => d.path === activeDomainPath);

  const visibleDomains = NAV_DOMAINS.filter((d) => isDomainVisible(d, role, allowedLegacyKeys, operationalContext));
  const visibleSubnav = activeDomain?.future
    ? []
    : (activeDomain?.subnav ?? []).filter((item) => isNavItemVisible(item, role, allowedLegacyKeys, operationalContext));

  const isService = activeDomain?.key === "service";
  const serviceGroups = isService ? buildServiceNavGroups(visibleSubnav) : null;
  const activeServiceGroupKey = isService
    ? findActiveServiceGroupKey(location.pathname.split("/").slice(2).join("/"), serviceGroups.groups)
    : null;

  return (
    <>
      <header className="fo-header">
        <h1>Field Ops</h1>
        <nav className="fo-nav" aria-label="Primary">
          {visibleDomains.map((domain) => (
            <NavLink
              key={domain.key}
              to={`/${domain.path}`}
              className={({ isActive }) => (isActive ? "fo-nav-btn fo-nav-btn-active" : "fo-nav-btn")}
            >
              {domain.label}
            </NavLink>
          ))}
        </nav>
      </header>

      {visibleSubnav.length > 0 &&
        (isService ? (
          <ServiceSubnav
            domainPath={activeDomain.path}
            groups={serviceGroups.groups}
            ungrouped={serviceGroups.ungrouped}
            activeGroupKey={activeServiceGroupKey}
          />
        ) : (
          <nav className="fo-nav fo-subnav" aria-label={`${activeDomain.label} sections`}>
            {visibleSubnav.map((item) => (
              <NavLink
                key={item.key}
                to={`/${activeDomain.path}${item.path ? `/${item.path}` : ""}`}
                end={item.path === ""}
                className={({ isActive }) => (isActive ? "fo-nav-btn fo-nav-btn-active" : "fo-nav-btn")}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        ))}

      <main className="fo-main">{children}</main>
    </>
  );
}
