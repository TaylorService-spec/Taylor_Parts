// PRIMARY MOBILE NAVIGATION -- who gets a thumb bar, and what is on it. PURE.
// Run: node --test test/mobilePrimaryNav.test.mjs
//
// ============================ THE DECISION THIS FILE PROTECTS ============================
//
// The two shells are deliberately DIFFERENT SIZES, and that is the thing most likely to be
// "corrected" later by someone tidying up.
//
// A technician's day is a sequence of JOBS, with scanning as one action inside a job. Home, Jobs and
// Scan are three genuinely different places to be.
//
// A warehouse or parts operator's day is entirely INSIDE the Scan workspace. Lookup, put-away, pick,
// transfer, counting and returns are all scan workflows -- the sandbox persona validation confirmed
// every one of them resolves through that single surface. A second "Tasks" or "Inventory" tab would
// be another door into the same room, and on a phone that is worse than no door: the operator has to
// work out which one they are meant to use.
//
// So the warehouse shell has THREE destinations, not four. The brief permitted a fourth; the
// evidence did not justify one.
import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveMobileShell, buildMobileNav, activeDestination,
  MOBILE_NAV_SHELL, SHELL_DESTINATIONS, PHONE_QUERY,
} from "../src/navigation/mobilePrimaryNav.js";

const allVisible = () => true;
const caps = (...ids) => (id) => ids.includes(id);

// ═══════════════════════════════════════════ who gets which shell

test("a technician gets the technician shell", () => {
  assert.equal(resolveMobileShell({ role: "technician" }), MOBILE_NAV_SHELL.TECHNICIAN);
});

test("a scanner-capable operator gets the warehouse shell", () => {
  for (const id of [
    "inventory.placement.record", "inventory.cycleCount.create",
    "inventory.transfer.dispatch", "inventory.returns.intake", "inventory.balance.read",
  ]) {
    assert.equal(resolveMobileShell({ role: null, hasCapability: caps(id) }), MOBILE_NAV_SHELL.WAREHOUSE, id);
  }
});

test("SOMEBODY WITH NO SCANNER CAPABILITY GETS NO BAR AT ALL", () => {
  // A bar whose every destination is a refusal is worse than the drawer they already had. An
  // office user on a phone keeps the existing navigation, unchanged.
  assert.equal(resolveMobileShell({ role: null, hasCapability: () => false }), MOBILE_NAV_SHELL.NONE);
  assert.deepEqual(buildMobileNav({ role: null, hasCapability: () => false, isVisible: allVisible }).destinations, []);
});

// ═══════════════════════════════════════════ the two shells differ, on purpose

test("THE WAREHOUSE SHELL IS SMALLER THAN THE TECHNICIAN'S -- three, not four", () => {
  const tech = SHELL_DESTINATIONS[MOBILE_NAV_SHELL.TECHNICIAN];
  const wh = SHELL_DESTINATIONS[MOBILE_NAV_SHELL.WAREHOUSE];
  assert.equal(tech.length, 4);
  assert.equal(wh.length, 3);
  assert.ok(wh.length < tech.length, "copying the technician bar to the floor would be the easy, wrong move");
});

test("the warehouse bar offers NO second door into the scan workspace", () => {
  // Every warehouse workflow lives inside Scan. A Tasks/Inventory/Parts tab would route to the same
  // surface under a different name, which on a phone is a source of hesitation, not convenience.
  const keys = SHELL_DESTINATIONS[MOBILE_NAV_SHELL.WAREHOUSE].map((d) => d.key);
  assert.deepEqual(keys, ["home", "scan", "more"]);
  for (const forbidden of ["tasks", "inventory", "parts", "work"]) {
    assert.equal(keys.includes(forbidden), false, `${forbidden} would duplicate Scan`);
  }
});

test("the technician bar is Home / Jobs / Scan / More, in thumb order", () => {
  assert.deepEqual(SHELL_DESTINATIONS[MOBILE_NAV_SHELL.TECHNICIAN].map((d) => d.key), ["home", "jobs", "scan", "more"]);
});

test("MORE IS NOT A DESTINATION -- it opens the drawer that already exists", () => {
  // This is what stops the bar becoming a second navigation model to keep in step with the rail.
  for (const shell of [MOBILE_NAV_SHELL.TECHNICIAN, MOBILE_NAV_SHELL.WAREHOUSE]) {
    const more = SHELL_DESTINATIONS[shell].find((d) => d.key === "more");
    assert.equal(more.drawer, true);
    assert.equal(more.to, undefined, "More must not be a route");
  }
});

// ═══════════════════════════════════════════ only what the person can use

test("a destination the rail would HIDE is dropped from the bar too", () => {
  // The bar delegates to the EXISTING isNavItemVisible and invents no visibility rule of its own,
  // so it can never expose a surface the rail refuses.
  const nav = buildMobileNav({
    role: "technician",
    isVisible: (to) => to !== "/service/scan",
  });
  assert.equal(nav.destinations.some((d) => d.key === "scan"), false);
  assert.equal(nav.destinations.some((d) => d.key === "home"), true);
});

test("if everything real is hidden, the bar renders nothing rather than a lone More", () => {
  // A bar containing only "More" is a hamburger wearing a costume.
  const nav = buildMobileNav({ role: "technician", isVisible: () => false });
  assert.deepEqual(nav.destinations, []);
});

// ═══════════════════════════════════════════ the selected tab

test("the LONGEST match wins, so a prefix cannot steal the selection", () => {
  const tech = SHELL_DESTINATIONS[MOBILE_NAV_SHELL.TECHNICIAN];
  assert.equal(activeDestination(tech, "/service/scan"), "scan");
  assert.equal(activeDestination(tech, "/service/technician-workspace"), "home");
  assert.equal(activeDestination(tech, "/service/dispatch"), "jobs");
});

test("a child route keeps its parent tab selected", () => {
  const tech = SHELL_DESTINATIONS[MOBILE_NAV_SHELL.TECHNICIAN];
  assert.equal(activeDestination(tech, "/service/scan/put-away"), "scan");
});

test("somewhere else selects NOTHING rather than guessing", () => {
  // Lighting the wrong tab is worse than lighting none: it tells the operator they are somewhere
  // they are not.
  const tech = SHELL_DESTINATIONS[MOBILE_NAV_SHELL.TECHNICIAN];
  assert.equal(activeDestination(tech, "/administration/users"), null);
});

test("a near-miss path does not select -- /service/scanner is not /service/scan", () => {
  const tech = SHELL_DESTINATIONS[MOBILE_NAV_SHELL.TECHNICIAN];
  assert.equal(activeDestination(tech, "/service/scanner-something"), null);
});

// ═══════════════════════════════════════════ the breakpoint

test("the bar is a PHONE treatment, below the drawer breakpoint", () => {
  // 640px, not the drawer's 900px. A 700px tablet has room for the drawer and does not need a thumb
  // bar competing with it.
  assert.match(PHONE_QUERY, /max-width:\s*639\.98px/);
});
