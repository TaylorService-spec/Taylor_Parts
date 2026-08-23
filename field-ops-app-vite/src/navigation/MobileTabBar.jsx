import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { activeDestination } from "./mobilePrimaryNav.js";
// Shared, so the thumb bar and the technician shell cannot disagree about what a phone is.
import { useIsPhone } from "./useIsPhone.js";

// THE PHONE'S PRIMARY NAVIGATION -- a thumb bar, at phone widths only.
//
// ============================ IT ADDS, IT DOES NOT REPLACE ============================
//
// The rail and the drawer are untouched. This appears below 640px and disappears above it, so
// tablet and desktop navigation is exactly what it was. "More" opens the SAME drawer rather than a
// second menu, which is what stops this becoming a parallel navigation model to keep in step.
//
// ============================ WHY IT SITS AT THE BOTTOM ============================
//
// The existing drawer opens from a control at the TOP of the screen. On a 6" phone held in one hand
// that is the least reachable corner there is, and it is where the primary action of the day
// currently lives. Destinations somebody uses forty times a shift belong under the thumb.
//
// ============================ THE KEYBOARD ============================
//
// A fixed bottom bar and an open on-screen keyboard fight over the same space, and the bar loses:
// on a phone it would sit ON TOP of the field being typed into, or push the submit button out of
// reach. So it HIDES while a text input has focus, and comes back when focus leaves.
//
// Detected by focus rather than by viewport height. Height heuristics are the usual approach and
// they are wrong on exactly the devices that matter -- a short landscape phone looks identical to a
// portrait phone with a keyboard open.

const TEXT_ENTRY = new Set(["INPUT", "TEXTAREA"]);
const NON_TEXT_INPUT = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "file"]);

function isTextEntry(el) {
  if (!el || !TEXT_ENTRY.has(el.tagName)) return el?.isContentEditable === true;
  if (el.tagName === "TEXTAREA") return true;
  return !NON_TEXT_INPUT.has((el.getAttribute("type") ?? "text").toLowerCase());
}

function useTypingHidden() {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const onFocus = (e) => { if (isTextEntry(e.target)) setTyping(true); };
    const onBlur = () => setTyping(false);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
    };
  }, []);
  return typing;
}

export default function MobileTabBar({ destinations = [], onOpenDrawer, deps }) {
  const location = useLocation();
  // BOTH HOOKS RUN UNCONDITIONALLY, then the test seams override the result. Writing this as
  // `deps?.forcePhone ?? useIsPhone()` reads naturally and is a rules-of-hooks violation: the hook
  // is skipped whenever the seam is supplied, so the hook ORDER changes between renders and React
  // starts handing state to the wrong hook. It happened to pass its tests, which is exactly why it
  // is worth stating.
  const detectedPhone = useIsPhone();
  const detectedTyping = useTypingHidden();
  const isPhone = deps?.forcePhone ?? detectedPhone;
  const typing = deps?.forceTyping ?? detectedTyping;

  if (!isPhone || destinations.length === 0 || typing) return null;

  const active = activeDestination(destinations, location.pathname);

  return (
    <nav className="fo-tabbar" aria-label="Primary">
      <ul className="fo-tabbar__list">
        {destinations.map((d) => (
          <li key={d.key} className="fo-tabbar__item">
            {d.drawer ? (
              // NOT a route. It opens the existing drawer, so everything secondary stays exactly
              // where it already lives and this bar never has to know about it.
              <button type="button" className="fo-tabbar__link" onClick={onOpenDrawer}>
                {d.label}
              </button>
            ) : (
              <NavLink
                to={d.to}
                className="fo-tabbar__link"
                // `aria-current="page"` rather than a styled class alone: the selected tab must be
                // announced, not merely coloured, or it says nothing to a screen-reader user.
                aria-current={active === d.key ? "page" : undefined}
                data-active={active === d.key ? "true" : undefined}
              >
                {d.label}
              </NavLink>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
