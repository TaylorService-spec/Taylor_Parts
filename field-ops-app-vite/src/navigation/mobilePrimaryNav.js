// PRIMARY MOBILE NAVIGATION -- which destinations a phone shows, and to whom.
//
// PURE. No JSX, no routing, no window. Unit-tested without a browser.
//
// ============================ WHY A SEPARATE SHELL AT ALL ============================
//
// The existing shell already degrades: a full rail above 1200px, a compact rail to 900px, and an
// off-canvas drawer below that. The drawer works, but it is the WHOLE hierarchy behind a hamburger at
// the top of the screen -- two taps and a scroll to reach the one thing a technician does forty times
// a day, using the hand that is holding the phone.
//
// This adds a thumb-reachable primary bar at phone widths ONLY. It does not replace the drawer:
// everything remains reachable exactly as before, and the drawer is where "everything else" still
// lives. Nothing is stranded on tablet or desktop, which keep the rail untouched.
//
// ============================ THE TWO SHELLS ARE NOT THE SAME ============================
//
// Copying the technician's four tabs to the warehouse floor would have been the easy move and the
// wrong one. Derived from what the sandbox personas can ACTUALLY do:
//
//   A TECHNICIAN'S day is a sequence of JOBS, with scanning as one action inside a job. Home, Jobs
//   and Scan are three genuinely different destinations.
//
//   A WAREHOUSE OR PARTS OPERATOR'S day is entirely inside the Scan workspace. Lookup, put-away,
//   pick, transfer, counting and returns are ALL scan workflows -- the persona validation confirmed
//   every one of them resolves through that single surface. A "Tasks" or "Inventory" tab would
//   therefore be a second door into the same room, which on a phone is worse than no door: the
//   operator has to work out which one they are supposed to use.
//
// So the warehouse shell is deliberately SMALLER. Three destinations, not four. The brief allowed a
// fourth; the evidence did not justify one.
//
// ============================ ONLY WHAT THE PERSON CAN USE ============================
//
// Every candidate below is filtered through the EXISTING `isNavItemVisible` authority -- the same
// function the rail and drawer use. This module invents no visibility rule of its own, so a
// destination can never appear here that the rail would have hidden.

/** A phone, not a small tablet. Below the drawer breakpoint (900px) on purpose: a 700px tablet has
 *  room for the drawer and does not need a thumb bar competing with it. */
export const PHONE_QUERY = "(max-width: 639.98px)";

export const MOBILE_NAV_SHELL = Object.freeze({
  TECHNICIAN: "TECHNICIAN",
  WAREHOUSE: "WAREHOUSE",
  NONE: "NONE",
});

/**
 * Which shell a person gets.
 *
 * ════════════════════ UNDER THE EOS SOURCE, NO ROLE STRING IS CONSULTED ════════════════════
 *
 * When an EOS navigation authority is supplied, the shell is derived from the SAME governed surfaces
 * that decide every other destination: the field workspace shell is the one for a person who holds
 * `field.myWorkOrders` (capability plus the SERVICE_TECHNICIAN Work Eligibility), and the warehouse
 * shell is for a person who holds a warehouse or receiving surface. This is the third place
 * `role === "technician"` was written independently -- App.jsx's dashboard branch and navConfig's
 * operational-role check were the other two -- and it is the one that was choosing a whole phone
 * experience from a Firestore string.
 *
 * ════════════════════ THE LEGACY PATH, UNCHANGED ════════════════════
 *
 * Without an EOS authority the answer is exactly what it was. The technician shell is keyed on the
 * legacy `technician` role because that journey's own server-side rule is role-based; the warehouse
 * shell is keyed on holding ANY scanner capability, because that is what makes the Scan workspace
 * their workplace rather than an occasional tool. Someone with neither gets NO phone shell: a bar
 * whose every destination is a refusal is worse than the drawer they already had.
 */
export function resolveMobileShell({ role, hasCapability, eosNavigationAuthority } = {}) {
  if (eosNavigationAuthority && typeof eosNavigationAuthority.grants === "function") {
    const grants = (key) => eosNavigationAuthority.grants(key) === true;
    if (grants("field.myWorkOrders")) return MOBILE_NAV_SHELL.TECHNICIAN;
    if (grants("warehouse.picking") || grants("receiving.checkIn") || grants("inventory.cycleCount.count")) {
      return MOBILE_NAV_SHELL.WAREHOUSE;
    }
    // Fail closed, and no fall-through to the role: an EOS answer that grants neither shell means
    // this person has no phone shell, not that the legacy rule should be asked instead.
    return MOBILE_NAV_SHELL.NONE;
  }
  if (role === "technician") return MOBILE_NAV_SHELL.TECHNICIAN;
  const holds = (id) => typeof hasCapability === "function" && hasCapability(id) === true;
  const scannerish = [
    "inventory.placement.record", "inventory.location.bin.read",
    "inventory.cycleCount.create", "inventory.cycleCount.submit",
    "inventory.transfer.dispatch", "inventory.transfer.receive",
    "inventory.returns.intake", "inventory.stock.receive",
    "inventory.balance.read",
  ];
  return scannerish.some(holds) ? MOBILE_NAV_SHELL.WAREHOUSE : MOBILE_NAV_SHELL.NONE;
}

/**
 * The candidate destinations per shell, in thumb order.
 *
 * `more` is not a destination — it opens the existing drawer, so secondary work stays exactly where
 * it already was and this bar never becomes a second navigation model to maintain.
 */
export const SHELL_DESTINATIONS = Object.freeze({
  [MOBILE_NAV_SHELL.TECHNICIAN]: Object.freeze([
    { key: "home", label: "Home", to: "/service/technician-workspace", match: ["/service/technician-workspace"] },
    { key: "jobs", label: "Jobs", to: "/service/dispatch", match: ["/service/dispatch", "/service/coordinated-mission"] },
    { key: "scan", label: "Scan", to: "/service/scan", match: ["/service/scan"] },
    { key: "more", label: "More", drawer: true },
  ]),
  // THREE, not four. See the note above: every warehouse workflow lives inside Scan, so a second
  // inventory destination would be a duplicate entry point into the same surface.
  [MOBILE_NAV_SHELL.WAREHOUSE]: Object.freeze([
    { key: "home", label: "Home", to: "/dashboard", match: ["/dashboard"] },
    { key: "scan", label: "Scan", to: "/service/scan", match: ["/service/scan"] },
    { key: "more", label: "More", drawer: true },
  ]),
  [MOBILE_NAV_SHELL.NONE]: Object.freeze([]),
});

/**
 * Which destination is selected for a path.
 *
 * LONGEST MATCH WINS, so `/service/scan` selects Scan rather than anything that merely prefixes it.
 * Returns null when nothing matches -- an honest "you are somewhere else", which the bar renders as
 * no tab selected rather than guessing and lighting the wrong one.
 */
export function activeDestination(destinations, pathname) {
  let best = null;
  let bestLength = -1;
  for (const d of destinations) {
    for (const m of d.match ?? []) {
      if ((pathname === m || pathname.startsWith(`${m}/`)) && m.length > bestLength) {
        best = d.key;
        bestLength = m.length;
      }
    }
  }
  return best;
}

/**
 * The bar a given person actually sees.
 *
 * @param isVisible (to) => boolean -- delegated to the caller, which wires it to the EXISTING
 *                  isNavItemVisible. A destination the rail would hide is dropped here too.
 */
export function buildMobileNav({ role, hasCapability, isVisible, eosNavigationAuthority } = {}) {
  const shell = resolveMobileShell({ role, hasCapability, eosNavigationAuthority });
  const candidates = SHELL_DESTINATIONS[shell] ?? [];
  const destinations = candidates.filter((d) => d.drawer || (typeof isVisible === "function" ? isVisible(d.to) : true));

  // A bar containing nothing but "More" is a hamburger wearing a costume. Render none.
  const realDestinations = destinations.filter((d) => !d.drawer);
  return Object.freeze({
    shell,
    destinations: Object.freeze(realDestinations.length === 0 ? [] : destinations),
  });
}
