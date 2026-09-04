// THE WORKSPACE'S NAVIGATION OPENER, and nothing else.
//
// This strip has been shedding responsibilities for three packages, and what is left is a single
// job. The history is worth keeping, because each removal was a duplicate the shell was carrying:
//
//   Gate 2   "Field Ops Platform" was a FIFTH product name on a screen already stating Verenward /
//            Enterprise Operations OS / Taylor Parts / Arizona Operations in the rail head. "Home"
//            was a genuine SECOND NAVIGATION AXIS (verified: it navigated /service -> /dashboard).
//            "Refresh" shipped a browser function as application chrome.
//
//   Account  the signed-in email and a Logout button, duplicating the rail's identity block. The
//            shell offered two sign-outs and stated the identity twice, once as a name and once as
//            an email address.
//
//   Bell     the notification control, which now sits in the rail footer beside the account block
//            where a person looks for their own things. Moved whole, not rebuilt.
//
// WHAT REMAINS is the opener for the off-canvas rail at drawer widths. At docked widths the rail is
// visible and there is no opener, so this component renders NOTHING AT ALL -- not an empty strip
// with a surface and a bottom border above every page, announcing a region that contains nothing.
// The page begins at the top of its own column.
//
// The layout/colour for the strip lives in index.css under .fo-appheader.
export default function AppHeader({ onOpenNav = null, navToggleRef = null, navOpen = false } = {}) {
  // THE STRIP IS ITS CONTENTS. The opener is built first, as a value, and the strip renders only if
  // it exists.
  //
  // Written this way on purpose. The obvious form -- `if (!onOpenNav) return null` -- restates the
  // render condition a second time, above the JSX that also states it. Add a second control later,
  // forget the guard, and the whole strip silently disappears for everyone who has only that second
  // thing. The guard below cannot drift from the markup because it IS the markup.
  const navToggle = onOpenNav ? (
    <button
      type="button"
      ref={navToggleRef}
      className="fo-navtoggle"
      onClick={onOpenNav}
      aria-expanded={navOpen}
      aria-label="Open navigation"
    >
      <span className="fo-navtoggle__bars" aria-hidden="true" />
    </button>
  ) : null;

  const contents = [navToggle].filter(Boolean);
  if (contents.length === 0) return null;

  return (
    <div className="fo-appheader">
      <div className="fo-appheader-left">{navToggle}</div>
    </div>
  );
}
