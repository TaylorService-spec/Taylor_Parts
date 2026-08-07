import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  NAV_DOMAINS,
  isDomainVisible,
  isNavItemVisible,
  buildServiceNavGroups,
} from "./navConfig";
import VerenwardMark from "../shared/brand/VerenwardMark";

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

function ItemLink({ domainPath, item, onNavigate, depth = 1 }) {
  const to = `/${domainPath}${item.path ? `/${item.path}` : ""}`;
  return (
    <NavLink
      to={to}
      end={item.path === ""}
      onClick={onNavigate}
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
        : (domain.subnav ?? []).filter((item) =>
            isNavItemVisible(item, role, allowedLegacyKeys, operationalContext),
          );
      const children =
        domain.key === "service"
          ? buildServiceNavGroups(visibleSubnav)
          : { groups: [], ungrouped: visibleSubnav };
      return { domain, children };
    });
  }, [role, allowedLegacyKeys, operationalContext]);

  // SINGLE-EXPAND. Exactly one domain is open at a time, and it defaults to the
  // domain you are actually in.
  //
  // This was multi-expand, and persona review measured the consequence: with
  // three domains open at 1440x800 the rail needed 1462px in an 800px column,
  // scrolling the brand block AND the currently-selected item off the top. A
  // rail that cannot show you where you are has stopped doing its job. Capping
  // it at one open domain bounds worst-case height instead of relying on the
  // user to tidy up after themselves.
  const [openDomain, setOpenDomain] = useState(activeDomainPath ?? null);
  const lastDomain = useRef(activeDomainPath);
  useEffect(() => {
    if (activeDomainPath && activeDomainPath !== lastDomain.current) {
      lastDomain.current = activeDomainPath;
      setOpenDomain(activeDomainPath);
    }
  }, [activeDomainPath]);

  // Collapsing the domain you are in is allowed; it simply closes.
  const toggle = (path) => setOpenDomain((prev) => (prev === path ? null : path));

  return (
    <nav className="fo-rail__nav" aria-label="Primary">
      <ul className="fo-rail__list">
        {domains.map(({ domain, children }) => {
          const isCurrent = domain.path === activeDomainPath;
          const { isLeaf, item: soleItem } = leafDestination(children);
          const open = openDomain === domain.path;
          const panelId = `${idPrefix}-${domain.key}`;

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
                    />
                  ))}
                  {children.groups.map((group) => (
                    <div
                      key={group.key}
                      className="fo-rail__group"
                      role="group"
                      aria-label={group.label}
                    >
                      {/* Organisational hierarchy, deliberately not a link: the
                          group's landing is simply its first child, which is
                          already listed directly beneath it. */}
                      <p className="fo-rail__group-label">{group.label}</p>
                      {group.items.map((item) => (
                        <ItemLink
                          key={item.key}
                          domainPath={domain.path}
                          item={item}
                          onNavigate={onNavigate}
                          depth={2}
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

/** The brand block that sits at the head of the rail, on evergreen chrome. */
export function RailBrand() {
  return (
    <div className="fo-rail__brand">
      <VerenwardMark variant="horizontal" tone="onDark" size={30} />
      <span className="fo-implementation">
        <span className="fo-implementation__name">Taylor Parts</span>
        <span className="fo-implementation__context">Arizona Operations</span>
      </span>
    </div>
  );
}
