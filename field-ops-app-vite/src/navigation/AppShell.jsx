import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { X } from "lucide-react";
import AppRail, { RailBrand, RailIdentity } from "./AppRail";
import { NAV_DOMAINS, isNavItemVisible } from "./navConfig";
import AppHeader from "../shared/ui/AppHeader";
import NotificationControl from "../shared/ui/NotificationControl.jsx";
import MobileTabBar from "./MobileTabBar.jsx";
import { buildMobileNav } from "./mobilePrimaryNav.js";
import Icon from "../shared/ui/Icon";

// Sprint 2.0.1 -- real <NavLink> anchors (not onClick + setState) so the
// browser's native back/forward + address bar all work without any custom
// history plumbing. Still true; the links now live in AppRail.
//
// Gate 2 -- the shell is a persistent left rail plus a workspace column, and
// the rail is the ONLY navigation axis. Previously there were two horizontal
// axes (domain row inside the dark header, then a per-domain sub-nav row
// beneath it); both overflowed independently and neither could absorb growth.
// The taxonomy itself is untouched -- see AppRail's comment.
//
// Breakpoints, and why:
//   >= 1200px  persistent full rail
//   900-1199   persistent compact rail (narrower, same hierarchy)
//   < 900px    off-canvas drawer, opened from the utility bar
// Below 900 the full hierarchy cannot be squeezed into a permanent rail
// without becoming unreadable, so it becomes a drawer -- same structure, same
// selected-state semantics, different presentation.
//
// The single breakpoint value lives in CSS (--rail-drawer-max). This query is
// the one place JS needs to agree with it, so that the drawer's focus and
// Escape handling only run when the drawer is actually the active treatment.
const DRAWER_QUERY = "(max-width: 899.98px)";

function useIsDrawer() {
  const [isDrawer, setIsDrawer] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.(DRAWER_QUERY).matches === true,
  );
  useEffect(() => {
    const mq = window.matchMedia?.(DRAWER_QUERY);
    if (!mq) return undefined;
    const onChange = (e) => setIsDrawer(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isDrawer;
}

export default function AppShell({ role, allowedLegacyKeys, operationalContext, children }) {
  const location = useLocation();
  const activeDomainPath = location.pathname.split("/").filter(Boolean)[0];
  // The shell's <h1>. The rail rewrite dropped it, leaving every page with NO
  // level-one heading at all -- screen-reader users lost the primary document
  // landmark and heading navigation had nothing to land on. It names the
  // current DOMAIN rather than the product, so it changes as you navigate and
  // actually says where you are.
  const activeDomainLabel =
    NAV_DOMAINS.find((d) => d.path === activeDomainPath)?.label ?? "Field Ops";

  // THE PHONE BAR. Derived from the SAME visibility authority the rail uses -- a destination the
  // rail would hide is dropped here too, so this can never become a second access model.
  const mobileNav = buildMobileNav({
    role,
    hasCapability: (id) => operationalContext?.hasCapability?.(id) === true,
    isVisible: (to) => {
      const [, domainPath, itemPath = ""] = to.split("/");
      const domain = NAV_DOMAINS.find((d) => d.path === domainPath);
      const item = domain?.subnav?.find((n) => n.path === itemPath);
      return item ? isNavItemVisible(item, role, allowedLegacyKeys, operationalContext) : false;
    },
  });

  const isDrawer = useIsDrawer();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const toggleRef = useRef(null);
  const drawerRef = useRef(null);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Choosing a destination closes the drawer; on desktop the rail is
  // persistent and there is nothing to close.
  const handleNavigate = useCallback(() => {
    if (isDrawer) setDrawerOpen(false);
  }, [isDrawer]);

  // Leaving drawer widths must not strand an open overlay on a desktop layout.
  useEffect(() => {
    if (!isDrawer) setDrawerOpen(false);
  }, [isDrawer]);

  // Close the drawer on ANY navigation to a new location, not just the ones
  // that go through a rail <NavLink>'s onClick. Browser back/forward, a
  // <Navigate replace> redirect, and an in-content <Link> all change
  // location.pathname without ever calling handleNavigate, and each one used
  // to strand the drawer open over the new page. This is location-driven
  // rather than click-driven, so it closes regardless of how the navigation
  // happened.
  useEffect(() => {
    if (isDrawer) setDrawerOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on pathname only; re-running for isDrawer flips is already covered by the effect above.
  }, [location.pathname]);

  // Escape closes, and focus returns to the control that opened it.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        setDrawerOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // Move focus into the drawer when it opens so keyboard and screen-reader
  // users are not left behind on the page underneath.
  useEffect(() => {
    if (drawerOpen) drawerRef.current?.focus();
  }, [drawerOpen]);

  const rail = (
    <AppRail
      role={role}
      allowedLegacyKeys={allowedLegacyKeys}
      operationalContext={operationalContext}
      activeDomainPath={activeDomainPath}
      onNavigate={handleNavigate}
      idPrefix={isDrawer ? "fo-drawer" : "fo-rail"}
    />
  );

  return (
    <div className={`fo-shell${drawerOpen ? " fo-shell--drawer-open" : ""}`}>
      {/* First focusable element: lets a keyboard user reach the workspace
          without traversing the entire navigation rail. */}
      <a className="fo-skip-link" href="#fo-main">Skip to content</a>
      {/* Persistent rail. Hidden by CSS at drawer widths; the drawer below
          renders the same component so there is one navigation implementation. */}
      <aside className="fo-rail" aria-label="Application navigation">
        <RailBrand />
        {rail}
        {/* THE RAIL FOOTER: the things that are about YOU rather than about where you are going.
            Both sit OUTSIDE the <nav> deliberately -- neither your notifications nor your identity
            is a destination, and putting either inside navigation would announce it as one.

            Notifications sits ABOVE identity, and is NOT part of it: RailIdentity states who you
            are and how to leave. Folding a live queue into that component would put changing state
            inside the one block that must never be anything but a name, a role and a way out.

            MOUNTED ON `!isDrawer`, NOT HIDDEN BY CSS. At drawer widths this rail is
            `display: none` -- and a hidden component is still a MOUNTED one. Left unconditional,
            an authorized principal with the drawer open would hold TWO NotificationControls and
            therefore two copies of every governed reorder subscription: double the reads, two
            listeners racing the same data, for a surface nobody can see. `isDrawer` is real state
            rather than a media query's opinion, so the mount can follow the shell mode exactly. */}
        {!isDrawer && (
          <div className="fo-rail__footer">
            <NotificationControl accessVersion={operationalContext?.accessVersion} />
            <RailIdentity />
          </div>
        )}
      </aside>

      {isDrawer && drawerOpen && (
        <>
          <div className="fo-drawer__scrim" onClick={closeDrawer} aria-hidden="true" />
          <aside
            className="fo-drawer"
            ref={drawerRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Application navigation"
          >
            <div className="fo-drawer__head">
              <RailBrand />
              <button
                type="button"
                className="fo-drawer__close"
                onClick={closeDrawer}
              >
                {/* Icon is decorative -- "Close" is still the button's whole
                    accessible name, unchanged. */}
                <Icon icon={X} size="dense" />
                Close
              </button>
            </div>
            {rail}
            {/* THE SAME FOOTER, and it is not optional. The docked rail is off-canvas at these
                widths, so without this the notification control would have no reachable home at
                all once it left the top strip -- moving the bell would have DELETED it on a
                handheld. Identity comes with it: the drawer is the rail here, and the rail's
                footer is where a person's own things live.

                This is the ONLY footer mounted at drawer widths: the docked one above is gated on
                `!isDrawer`, so exactly one NotificationControl exists per shell mode and the
                governed reads are never instantiated twice. */}
            <div className="fo-rail__footer">
              <NotificationControl accessVersion={operationalContext?.accessVersion} />
              <RailIdentity />
            </div>
          </aside>
        </>
      )}

      <div className="fo-workspace">
        <AppHeader
          onOpenNav={isDrawer ? () => setDrawerOpen(true) : null}
          navToggleRef={toggleRef}
          navOpen={drawerOpen}
        />
        <main className="fo-main" id="fo-main" tabIndex={-1}>
          <h1 className="fo-visually-hidden">{activeDomainLabel}</h1>
          {children}
        </main>
        {/* Phone only, and it unmounts above 640px rather than hiding -- a hidden-but-mounted bar
            still lands in the tab order. "More" opens the drawer that already exists. */}
        <MobileTabBar destinations={mobileNav.destinations} onOpenDrawer={() => setDrawerOpen(true)} />
      </div>
    </div>
  );
}
