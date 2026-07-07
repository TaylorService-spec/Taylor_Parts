import { NavLink, useLocation } from "react-router-dom";
import { NAV_DOMAINS, isDomainVisible, isNavItemVisible } from "./navConfig";

// Sprint 2.0.1 -- top-level domain tabs + the active domain's sub-nav.
// Real <NavLink> anchors (not onClick + setState) so the browser's
// native back/forward + address bar all work without any custom
// history plumbing -- see App.jsx's header comment for why that's the
// whole point of this sprint.
export default function AppShell({ role, allowedLegacyKeys, children }) {
  const location = useLocation();
  const activeDomainPath = location.pathname.split("/").filter(Boolean)[0];
  const activeDomain = NAV_DOMAINS.find((d) => d.path === activeDomainPath);

  const visibleDomains = NAV_DOMAINS.filter((d) => isDomainVisible(d, role, allowedLegacyKeys));
  const visibleSubnav = activeDomain?.future
    ? []
    : (activeDomain?.subnav ?? []).filter((item) => isNavItemVisible(item, role, allowedLegacyKeys));

  return (
    <>
      <header className="fo-header">
        <h1>Field Ops</h1>
        <nav className="fo-nav">
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

      {visibleSubnav.length > 0 && (
        <nav className="fo-nav fo-subnav">
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
      )}

      <main className="fo-main">{children}</main>
    </>
  );
}
