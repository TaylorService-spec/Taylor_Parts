import { useEffect, useState } from "react";
import { PHONE_QUERY } from "./mobilePrimaryNav.js";

// ARE WE ON A PHONE? One answer, one breakpoint, one place.
//
// Extracted rather than copied a third time. MobileTabBar already had this exact hook, and WO-03A
// needed it again to choose the technician composition — two independent copies of "what counts as a
// phone" is how a thumb bar and a shell end up disagreeing at 640px.
//
// ============================ WIDTH CHOOSES COMPOSITION, NEVER AUTHORITY ============================
//
// This decides which SHAPE of a surface renders. It must never decide what a person may do. Every
// surface reached through it resolves capability exactly as it does at any other width, on the
// server, and rotating a phone cannot change what a technician is allowed to record.
//
// A hook rather than a CSS media query wherever a surface should genuinely UNMOUNT: a
// hidden-but-mounted shell still occupies the tab order and the accessibility tree, and still runs
// its effects.

export function useIsPhone() {
  const [isPhone, setIsPhone] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.(PHONE_QUERY).matches === true,
  );
  useEffect(() => {
    const mq = typeof window === "undefined" ? null : window.matchMedia?.(PHONE_QUERY);
    if (!mq) return undefined;
    const onChange = (e) => setIsPhone(e.matches);
    mq.addEventListener("change", onChange);
    // Re-read on mount: the query may have changed between the initial state and the listener being
    // attached, and a shell that renders the wrong composition until the first resize is a bug
    // nobody sees on a desktop.
    setIsPhone(mq.matches);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isPhone;
}

export default useIsPhone;
