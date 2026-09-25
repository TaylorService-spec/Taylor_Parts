// WAVE 16 / LANE BQ -- SALES AGREEMENTS IA (Owner ruling D) + THE EOS NAVIGATION CUTOVER (ruling F).
//
// Pure and offline: no React, no network, no emulator, no database. Everything asserted here is a
// property of navConfig.js, access/experienceContext.js, domain/salesAgreementIndex.js and
// services/commercialApiClient.js, read as data.
//
// WHAT THIS FILE IS FOR. The two rulings are one change and their evidence belongs in one place:
//
//   1. Sales Agreements is a first-class destination earned by the EXISTING salesAgreement.read,
//      and by nothing else -- no new capability, no legacy key, no placeholder row, no capability
//      feed. The door is visible exactly when the governed source grants `commercial.agreements`.
//   2. Under the EOS source, NO legacy navigation authority runs: not ROLE_NAV_ACCESS, not
//      operationalRoles, not PLACEHOLDER_DEFAULT_ROLES. Each of those paths is shown to fail closed
//      individually, by being fed a value that WOULD have opened the door under the legacy source.
//   3. The twenty placeholder rows are gone and the register is 42, with the before/after
//      consequence measured rather than described.
//
// It is NOT registered in package.json by this lane -- see the lane report's
// SUITES_ADDED_NEEDING_REGISTRATION. `npm test` (scripts/runSuites.mjs) discovers test/*.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import {
  NAV_DOMAINS,
  NAV_SURFACE_ACCESS,
  NAV_LEGACY_PLACEHOLDER_DESTINATIONS,
  NAV_LEGACY_PLACEHOLDER_CEILING,
  PLACEHOLDER_DEFAULT_ROLES,
  isDomainVisible,
  isNavItemVisible,
  isEosNavigationSource,
  eosNavigationAuthorityFor,
  navigationSurfaceMapViolations,
  legacyPlaceholderRegisterViolations,
  containerRegisterViolations,
} from "../src/navigation/navConfig.js";
import {
  EXPERIENCE_STATE,
  EXPERIENCE_SURFACE_KEYS,
  buildNavigationAuthority,
  isNavigationAuthority,
  navigationAuthorityGrantsAnything,
  navigationAuthoritySourceState,
} from "../src/access/experienceContext.js";
import {
  SALES_AGREEMENT_INDEX_STATE,
  salesAgreementHref,
  salesAgreementIndexView,
} from "../src/domain/salesAgreementIndex.js";
import {
  COMMERCIAL_READ_OPERATIONS,
  COMMERCIAL_ROUTE,
  callCommercialApi,
  commercialFailureCategory,
  isCommercialReadOperation,
} from "../src/services/commercialApiClient.js";
import { ROLE_NAV_ACCESS, ROLES } from "../src/domain/constants.js";

const destinations = () =>
  NAV_DOMAINS.flatMap((d) => (d.subnav ?? []).map((i) => [`${d.key}/${i.key}`, i]));
const itemAt = (destination) => destinations().find(([key]) => key === destination)?.[1];
const legacy = { operationalRoles: [], employmentStatus: "ACTIVE" };
const keysFor = (role) => ROLE_NAV_ACCESS[role] ?? [];

const eosAuthority = (surfaces, state = EXPERIENCE_STATE.READY) => buildNavigationAuthority({
  state,
  context: state === EXPERIENCE_STATE.READY
    ? {
      tenantId: "t", principalId: "p", securityRoleKeys: [], employeeId: null,
      workEligibility: [], operationalScopes: [], surfaces,
    }
    : null,
});
const eosContext = (authority, extra = {}) => ({ ...legacy, ...extra, eosNavigationAuthority: authority });

// ════════════════════ RULING D -- THE DESTINATION AND ITS AUTHORITY ════════════════════

test("Sales Agreements is a CRM/Sales destination with a screen, a route and a surface row", () => {
  const item = itemAt("customers/salesAgreements");
  assert.ok(item, "the Sales Agreements nav item does not exist");
  assert.equal(item.label, "Sales Agreements");
  assert.equal(item.path, "sales-agreements");
  assert.deepEqual(NAV_SURFACE_ACCESS["customers/salesAgreements"], ["commercial.agreements"]);
  // The client mirrors the server catalog, so the key must be in BOTH or the projection drops it.
  assert.ok(EXPERIENCE_SURFACE_KEYS.includes("commercial.agreements"),
    "the client vocabulary does not know commercial.agreements, so the server's grant would be dropped");
  // It sits between Opportunities and nothing -- one area, per Issue #288's rule.
  const crm = NAV_DOMAINS.find((d) => d.key === "customers");
  assert.deepEqual(crm.subnav.map((i) => i.key), ["customers", "opportunities", "salesOrders", "salesAgreements"]);
});

// THE AUTHORITY PROOF, STATED AS THE ABSENCE OF EVERY ALTERNATIVE.
//
// A destination can be opened by exactly five things in this file: a container derivation, a granted
// EOS surface, the Firestore capability feed, an operational role, a legacyKey, or a placeholder
// row. Sales Agreements declares exactly ONE of them. Listing the other five by name is the proof:
// if any is ever added, this fails, and the "visible only with salesAgreement.read" claim would
// otherwise have quietly stopped being true.
test("Sales Agreements declares a governed surface and NO other authority of any kind", () => {
  const item = itemAt("customers/salesAgreements");
  assert.deepEqual(item.surfaceAccess, ["commercial.agreements"]);
  assert.equal(item.legacyKey, undefined);
  assert.equal(item.capabilityAccess, undefined);
  assert.equal(item.operationalRoleAccess, undefined);
  assert.equal(item.legacyPlaceholder, undefined);
  assert.equal(item.containerScope, undefined);
  assert.equal(item.alwaysVisible, undefined);
  assert.equal(NAV_LEGACY_PLACEHOLDER_DESTINATIONS.includes("customers/salesAgreements"), false);
});

test("the Sales Agreements index appears ONLY for a caller the governed source grants the surface", () => {
  const item = itemAt("customers/salesAgreements");

  // GRANTED -> visible. Nothing else in the context says anything helpful: the role is null, the
  // legacy key list is empty, and there are no operational roles. The surface is doing all of it.
  const granted = eosContext(eosAuthority(["commercial.agreements"]));
  assert.equal(isNavItemVisible(item, null, [], granted), true);
  assert.equal(isDomainVisible(NAV_DOMAINS.find((d) => d.key === "customers"), null, [], granted), true);

  // NOT GRANTED -> invisible, even holding every OTHER commercial surface. `salesAgreement.read` is
  // not implied by opportunity.read or salesOrder.read, and this is where that would show.
  const neighbours = eosContext(eosAuthority(["crm.accounts", "commercial.opportunities", "commercial.salesOrders"]));
  assert.equal(isNavItemVisible(item, null, [], neighbours), false);
  // ...and the neighbours themselves still open, so this is a per-surface answer rather than a
  // wholesale refusal.
  assert.equal(isNavItemVisible(itemAt("customers/salesOrders"), null, [], neighbours), true);

  // AND NO LEGACY INPUT CAN SUBSTITUTE FOR THE GRANT. Each of these would have opened SOMETHING
  // under the legacy source; none opens this.
  for (const role of [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.TECHNICIAN, "salesperson", "owner", null]) {
    assert.equal(isNavItemVisible(item, role, keysFor(role), legacy), false,
      `the legacy role "${role}" opened Sales Agreements`);
    assert.equal(isNavItemVisible(item, role, ["inventory", "jobs", "controlTower", "fieldMode"], legacy), false,
      `a legacy key set opened Sales Agreements for "${role}"`);
  }
  const withCapabilityFeed = { ...legacy, hasCapability: () => true };
  assert.equal(isNavItemVisible(item, ROLES.ADMIN, keysFor(ROLES.ADMIN), withCapabilityFeed), false,
    "the Firestore capability feed opened Sales Agreements -- it declares no capabilityAccess");
});

// ════════════════════ RULING D -- THE SCREEN'S HONEST STATES ════════════════════
//
// The index ships showing its EMPTY state, because eos_commercial.sales_agreements is empty in
// nonprod. These assertions exist so that state can never be reached by accident: a refusal, a
// transport failure or a body this bundle cannot parse must each produce their OWN state.

test("an EMPTY governed answer is EMPTY -- an answer, distinct from every failure", () => {
  const view = salesAgreementIndexView({ ok: true, operation: "listSalesAgreements", result: { items: [], truncated: false, nextCursor: null } });
  assert.equal(view.state, SALES_AGREEMENT_INDEX_STATE.EMPTY);
  assert.deepEqual(view.rows, []);
  assert.match(view.reason, /No Sales Agreements exist/);
});

test("a REFUSAL is never rendered as an empty list, and a FAILURE is never rendered as either", () => {
  for (const code of ["FORBIDDEN", "UNAUTHENTICATED", "NOT_SIGNED_IN"]) {
    const view = salesAgreementIndexView({ ok: false, code });
    assert.equal(view.state, SALES_AGREEMENT_INDEX_STATE.REFUSED, `${code} should be a refusal`);
    assert.match(view.reason, /salesAgreement\.read/);
    assert.deepEqual(view.rows, []);
  }
  for (const code of ["NOT_CONFIGURED", "UNREACHABLE", "INTERNAL", "INVALID_INPUT", "UNKNOWN_OPERATION"]) {
    const view = salesAgreementIndexView({ ok: false, code });
    assert.equal(view.state, SALES_AGREEMENT_INDEX_STATE.UNAVAILABLE, `${code} should be unavailable`);
    assert.deepEqual(view.rows, []);
  }
});

test("a MALFORMED success body is UNAVAILABLE, never EMPTY", () => {
  for (const result of [null, undefined, {}, { items: "no" }, 7]) {
    const view = salesAgreementIndexView({ ok: true, result });
    assert.equal(view.state, SALES_AGREEMENT_INDEX_STATE.UNAVAILABLE,
      `a body of ${JSON.stringify(result)} was read as a fact about the business`);
  }
});

test("rows are projected, unidentifiable rows are dropped, and the record href is the mounted route", () => {
  const view = salesAgreementIndexView({
    ok: true,
    result: {
      items: [
        { id: "sa-1", salesAgreementNumber: "SA-2026-000001", state: "DRAFT", accountName: "Acme", currency: "USD", totals: { totalMinor: null } },
        { id: "", salesAgreementNumber: "SA-2026-000002" },
        { salesAgreementNumber: "SA-2026-000003" },
      ],
      truncated: true,
    },
  });
  assert.equal(view.state, SALES_AGREEMENT_INDEX_STATE.READY);
  assert.deepEqual(view.rows.map((r) => r.id), ["sa-1"]);
  assert.equal(view.truncated, true);
  assert.equal(salesAgreementHref("sa-1"), "/customers/opportunities/sales-agreement/sa-1");
  assert.equal(salesAgreementHref("a/b"), "/customers/opportunities/sales-agreement/a%2Fb");
  // A page of nothing but unreadable rows is EMPTY, not an error: the read succeeded.
  assert.equal(salesAgreementIndexView({ ok: true, result: { items: [{}] } }).state, SALES_AGREEMENT_INDEX_STATE.EMPTY);
  // Nothing asked yet is LOADING, and is never confused with a settled answer.
  assert.equal(salesAgreementIndexView(null).state, SALES_AGREEMENT_INDEX_STATE.LOADING);
});

test("the Commercial transport mirrors the server's READ operations and refuses anything else", () => {
  assert.equal(COMMERCIAL_ROUTE, "/commercial/sales");
  assert.ok(COMMERCIAL_READ_OPERATIONS.includes("listSalesAgreements"));
  // WRITES ARE NOT REACHABLE THROUGH THIS CLIENT. A second write path to the Sales Agreement, over a
  // different transport from the existing command client, is how two surfaces start disagreeing.
  for (const mutation of ["createSalesAgreement", "acceptSalesAgreement", "updateSalesAgreementDraft", "transitionSalesOrder"]) {
    assert.equal(isCommercialReadOperation(mutation), false, `${mutation} is callable through the read client`);
  }
  assert.equal(commercialFailureCategory(403, null), "FORBIDDEN");
  assert.equal(commercialFailureCategory(200, "FORBIDDEN"), "FORBIDDEN");
  assert.equal(commercialFailureCategory(500, null), "INTERNAL");
});

test("the Commercial client never throws, and reaches no network without configuration or a token", async () => {
  const exploded = () => { throw new Error("the client must not reach the network here"); };
  assert.equal((await callCommercialApi("nope", { baseUrl: "https://x", fetchImpl: exploded })).code, "UNKNOWN_OPERATION");
  assert.equal((await callCommercialApi("listSalesAgreements", { baseUrl: "", fetchImpl: exploded })).code, "NOT_CONFIGURED");
  assert.equal(
    (await callCommercialApi("listSalesAgreements", { baseUrl: "https://x", getIdToken: async () => null, fetchImpl: exploded })).code,
    "NOT_SIGNED_IN",
  );
  const thrown = await callCommercialApi("listSalesAgreements", {
    baseUrl: "https://x", getIdToken: async () => "t", fetchImpl: async () => { throw new Error("offline"); },
  });
  assert.equal(thrown.code, "UNREACHABLE");
  assert.equal(thrown.ok, false);
});

// ════════════════════ RULING F -- THE CUTOVER ════════════════════

test("the EOS source is TOTAL: every legacy path is dead when an authority is present", () => {
  // Inventory > Parts is the strongest possible control. It is gated by legacyKey "inventory", so
  // under the legacy source `allowedLegacyKeys` alone opens it -- which is exactly why it is the
  // destination that proves the legacy path is not consulted.
  const parts = itemAt("inventory/parts");
  const adminKeys = ["inventory", "jobs", "controlTower", "fieldMode", "operations", "dispatch", "dispatcherBoard", "technicians"];
  assert.equal(isNavItemVisible(parts, ROLES.ADMIN, adminKeys, legacy), true, "the control itself is broken");

  // Now the same destination, the same role, the same keys -- plus an EOS authority granting NOTHING.
  const refusedEos = eosContext(eosAuthority([]), { operationalRoles: ["PARTS_MANAGER"], hasCapability: () => true });
  assert.equal(isNavItemVisible(parts, ROLES.ADMIN, adminKeys, refusedEos), false,
    "ROLE_NAV_ACCESS answered under the EOS source -- the legacy fallback is back");

  // EVERY legacy path, one at a time, each fed the value that WOULD have opened it.
  const cases = [
    ["legacyKey / ROLE_NAV_ACCESS", itemAt("inventory/parts"), { role: ROLES.ADMIN, keys: adminKeys, extra: {} }],
    ["operationalRoleAccess", itemAt("inventoryRole/warehouse"), { role: ROLES.TECHNICIAN, keys: [], extra: { operationalRoles: ["WAREHOUSE_MANAGER"], employmentStatus: "ACTIVE" } }],
    ["the Firestore capability feed", itemAt("reporting/builder"), { role: ROLES.ADMIN, keys: adminKeys, extra: { hasCapability: () => true } }],
    ["PLACEHOLDER_DEFAULT_ROLES", itemAt("administration/vehicles"), { role: ROLES.ADMIN, keys: adminKeys, extra: {} }],
  ];
  for (const [label, item, { role, keys, extra }] of cases) {
    assert.ok(item, `${label}: the control destination is missing`);
    assert.equal(isNavItemVisible(item, role, keys, { ...legacy, ...extra }), true,
      `${label}: the control does not open under the legacy source, so this proves nothing`);
    assert.equal(isNavItemVisible(item, role, keys, { ...legacy, ...extra, eosNavigationAuthority: eosAuthority([]) }), false,
      `${label} still answers when the EOS source is the source`);
  }
});

// FAIL CLOSED, IN EVERY STATE THE SOURCE CAN BE IN. A LOADING, REFUSED or UNAVAILABLE authority is
// still THE SOURCE -- that is what makes the cutover total -- and it grants nothing.
test("an EOS authority that is not READY grants nothing AND does not hand navigation back to the role", () => {
  const parts = itemAt("inventory/parts");
  const adminKeys = ["inventory", "jobs", "controlTower", "fieldMode"];
  for (const state of [EXPERIENCE_STATE.LOADING, EXPERIENCE_STATE.REFUSED, EXPERIENCE_STATE.UNAVAILABLE]) {
    const authority = eosAuthority([], state);
    assert.equal(isNavigationAuthority(authority), true,
      `a ${state} authority stopped being recognised as the source -- navigation would fall back to the legacy role`);
    assert.equal(isEosNavigationSource({ eosNavigationAuthority: authority }), true);
    assert.equal(navigationAuthorityGrantsAnything(authority), false);
    assert.equal(navigationAuthoritySourceState(authority), state);
    assert.equal(isNavItemVisible(parts, ROLES.ADMIN, adminKeys, eosContext(authority)), false);
    assert.equal(NAV_DOMAINS.some((d) => isDomainVisible(d, ROLES.ADMIN, adminKeys, eosContext(authority))), false,
      `a ${state} EOS session reached a domain`);
  }
  // Junk in the slot is NOT the source, which is the one case that must fall through rather than
  // silently disabling navigation for a session that never had an EOS read at all.
  for (const junk of [null, undefined, {}, { source: "EOS" }, { grants: () => true }]) {
    assert.equal(isEosNavigationSource({ eosNavigationAuthority: junk }), false);
    assert.equal(eosNavigationAuthorityFor({ eosNavigationAuthority: junk }), null);
  }
  assert.equal(isNavItemVisible(parts, ROLES.ADMIN, adminKeys, { ...legacy, eosNavigationAuthority: {} }), true,
    "a context with junk in the EOS slot stopped using the legacy source -- that is not a cutover, it is an outage");
});

// ════════════════════ RULING F -- THE TWENTY ROWS ════════════════════

const REMOVED_ROWS = Object.freeze([
  "customers/customers", "customers/opportunities", "customers/salesOrders",
  "equipment/equipment",
  "service/workOrders", "service/coordinatedVisits",
  "inventory/partMaster", "inventory/warehouses", "inventory/truckInventory", "inventory/receiving",
  "purchasing/purchaseOrders", "purchasing/receipts",
  "financials/invoices", "financials/payments",
  "administration/users", "administration/rolesPermissions", "administration/objects",
  "administration/workflows", "administration/permissionPreview", "administration/auditLogs",
]);

test("the placeholder register is 42, the ceiling moved with it, and the twenty are the mapped ones", () => {
  assert.equal(NAV_LEGACY_PLACEHOLDER_DESTINATIONS.length, 42);
  assert.equal(NAV_LEGACY_PLACEHOLDER_CEILING, 42);
  assert.equal(new Set(NAV_LEGACY_PLACEHOLDER_DESTINATIONS).size, 42);
  assert.equal(NAV_LEGACY_PLACEHOLDER_DESTINATIONS.includes("administration/overview"), false,
    "the container is back in the register -- a placeholder is the one thing a menu may never be");

  // THE CRITERION, RE-DERIVED RATHER THAN TRUSTED. The rows that left are exactly the destinations
  // NAV_SURFACE_ACCESS maps; the rows that stayed are exactly the ones it does not. Nobody had to
  // keep two lists equal -- if a 43rd destination earns a surface tomorrow and keeps its row, this
  // fails on the criterion rather than on a count.
  for (const destination of NAV_LEGACY_PLACEHOLDER_DESTINATIONS) {
    assert.equal(Object.prototype.hasOwnProperty.call(NAV_SURFACE_ACCESS, destination), false,
      `${destination} holds BOTH a governed surface and an ungoverned placeholder row`);
  }
  for (const destination of REMOVED_ROWS) {
    assert.ok(Object.prototype.hasOwnProperty.call(NAV_SURFACE_ACCESS, destination),
      `${destination} lost its placeholder row without having a governed surface -- it is now unreachable by anyone`);
    assert.equal(NAV_LEGACY_PLACEHOLDER_DESTINATIONS.includes(destination), false);
  }

  // Every guard in navConfig is clean against the real registers.
  assert.deepEqual(navigationSurfaceMapViolations(EXPERIENCE_SURFACE_KEYS), []);
  assert.deepEqual(legacyPlaceholderRegisterViolations(), []);
  assert.deepEqual(containerRegisterViolations(), []);

  // THE RATCHET RE-ARMED AT THE NEW SIZE. A forty-third row is refused now, not in twenty rows' time.
  const regrown = [...NAV_LEGACY_PLACEHOLDER_DESTINATIONS, "service/warranty"];
  assert.ok(legacyPlaceholderRegisterViolations({ register: regrown })
    .some((p) => p.includes("above the shrink-only ceiling")));
});

// THE PER-ENVIRONMENT CONSEQUENCE, MEASURED. This is the number the Owner asked for, computed rather
// than asserted from memory, so the report and the code cannot disagree.
test("where the flag is FALSE the twenty removals narrow admin and dispatcher by exactly 21 destinations", () => {
  const visibleUnderLegacy = (role) => destinations()
    .filter(([, item]) => isNavItemVisible(item, role, keysFor(role), legacy))
    .map(([key]) => key);

  const admin = visibleUnderLegacy(ROLES.ADMIN);
  const dispatcher = visibleUnderLegacy(ROLES.DISPATCHER);
  const technician = visibleUnderLegacy(ROLES.TECHNICIAN);

  // Measured on origin/main at b6a36b15 (52d4f24a with the Lane BL cherry-pick, which changed no
  // visibility): admin 75, dispatcher 72, technician 5.
  assert.equal(admin.length, 54, "admin's legacy destination count has moved from the measured 75 - 21");
  assert.equal(dispatcher.length, 51, "dispatcher's legacy destination count has moved from the measured 72 - 21");
  assert.equal(technician.length, 5, "the technician was narrowed -- no removed row was one of theirs");

  // TWENTY-ONE, NOT TWENTY, AND THE TWENTY-FIRST IS DERIVED. `administration/overview` is a pure
  // container over six of the removed destinations, so it closes with them. It was never a
  // placeholder row and must not become one to compensate.
  for (const destination of [...REMOVED_ROWS, "administration/overview"]) {
    assert.equal(admin.includes(destination), false, `admin still reaches ${destination} under the legacy source`);
    assert.equal(dispatcher.includes(destination), false, `dispatcher still reaches ${destination} under the legacy source`);
  }

  // NOTHING ELSE MOVED. Every destination still visible to admin is one with a real legacy authority
  // -- a legacyKey, or a placeholder row that was kept because nothing governs it.
  for (const destination of admin) {
    const item = itemAt(destination);
    const derived = Boolean(item.containerScope);
    assert.ok(derived || item.legacyKey || item.legacyPlaceholder,
      `${destination} is visible to admin under the legacy source with no legacy authority at all`);
  }

  // AND THE DOORS ARE NOT LOST, THEY MOVED SOURCE. Every removed destination opens under the EOS
  // source for a principal granted its surface -- which is the half of the ruling that makes the
  // narrowing a cutover rather than a deletion.
  for (const destination of REMOVED_ROWS) {
    const surfaces = NAV_SURFACE_ACCESS[destination];
    const ctx = eosContext(eosAuthority([surfaces[0]]));
    assert.equal(isNavItemVisible(itemAt(destination), null, [], ctx), true,
      `${destination} does not open under the EOS source either -- the door is gone, not moved`);
  }
});

// ════════════════════ RULING F -- THE SHELL SUPPLIES NO LEGACY INPUT EITHER ════════════════════
//
// navConfig cannot enforce this half: `isNavItemVisible` returning on the EOS branch makes the
// legacy ARGUMENTS unread, and App.jsx was still computing and passing them. Two of its route
// decisions were not behind that branch at all -- /service/work-orders/* and the /inventory-role/*
// redirect were gated on `role === "admin" || role === "dispatcher"` directly, which is a Firebase
// role literal deciding which addresses exist.
//
// Asserted against the SOURCE because the alternative is mounting the whole router. The check is
// narrow and mechanical: no visibility call may be passed the raw `role`/`allowedLegacyKeys`, and no
// raw-role comparison may survive outside the containment. The same technique this suite's
// neighbours already use to pin a route declaration against the router (crmSalesNav.test.mjs).
test("App.jsx supplies navigation NO legacy inputs under the EOS source", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "..", "src", "App.jsx"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  // It asks navConfig which source is answering, rather than re-deriving it.
  assert.match(code, /isEosNavigationSource\b/, "App.jsx no longer asks navConfig which source answers");

  // EVERY visibility call takes the contained values. A single `isNavItemVisible(item, role, ...)`
  // would put ROLE_NAV_ACCESS back in front of navigation under a cutover that forbids it.
  assert.equal(/isNavItemVisible\(\s*\w+\s*,\s*role\s*,/.test(code), false,
    "a visibility call is still passed the raw role");
  assert.equal(/isDomainVisible\(\s*\w+\s*,\s*role\s*,/.test(code), false,
    "a domain visibility call is still passed the raw role");
  assert.equal(/allowedLegacyKeys\s*,\s*operationalContext\s*\)/.test(code), false,
    "a visibility call is still passed the raw legacy key set");

  // NO RAW-ROLE NAVIGATION DECISION SURVIVES. `navRole` is null under the EOS source, so the two
  // route branches that used to read `role` directly cannot fire there.
  assert.equal(/[^v]role === "admin"/.test(code), false, "a route decision still reads the raw role literal");
  assert.match(code, /navRole === "admin" \|\| navRole === "dispatcher"/,
    "the inventory-role redirect is no longer behind the containment");
  assert.match(code, /previewHasPermission\("workOrder\.create", navRole/,
    "the work-order route preview is no longer behind the containment");
});

test("PLACEHOLDER_DEFAULT_ROLES is unchanged -- the rows left, the mechanism did not", () => {
  // The cutover removed DOORS from the Firebase-era role literal. It did not redefine the literal,
  // and it did not add a role to it. Both would be a different change wearing this one's name.
  assert.deepEqual(PLACEHOLDER_DEFAULT_ROLES, ["admin", "dispatcher"]);
  assert.equal(isNavItemVisible(itemAt("administration/vehicles"), ROLES.ADMIN, [], legacy), true);
  assert.equal(isNavItemVisible(itemAt("administration/vehicles"), ROLES.TECHNICIAN, [], legacy), false);
});
