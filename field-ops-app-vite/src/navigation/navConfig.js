import { ROLES, EMPLOYMENT_STATUS, OPERATIONAL_ROLE } from "../domain/constants.js";
import { REPORT_WAVE1_OBJECT_READ_CAPABILITIES, REPORT_DEFINITION_CAPABILITIES } from "../access/reportAccess.js";
import {
  TRANSFER_SURFACE_CAPABILITIES,
  CYCLE_COUNT_SURFACE_CAPABILITIES,
  CATALOG_SURFACE_CAPABILITIES,
  RECEIVING_SURFACE_CAPABILITIES,
  WAREHOUSE_HANDHELD_CAPABILITIES,
} from "../access/governedSurfaceCapabilities.js";

// Sprint 2.0.1 -- Navigation Foundation. Single source of truth for the
// business-domain nav tree: top-level domains + their sub-nav, and
// which existing screen (if any) each sub-item re-homes.
//
// This REPLACES App.jsx's old flat `NAV` array as the navigation
// source of truth (see docs/architecture/SYSTEM_AUTHORITIES.md's
// "Navigation" row -- the canonical location, not CLAUDE_CONTEXT.md).
// Unlike PR #22's
// domain-routing scaffold (torn out on the same PR for being
// aspirational/not wired in -- see that PR's body), this one is wired
// into App.jsx's real <Routes> and is meant to stay.
//
// Every `legacyKey` below corresponds 1:1 to one of the 9 keys that
// used to live in App.jsx's NAV array -- every existing screen is
// re-homed, none deleted (Sprint 2.0.1 requirement #1/#2). Items with
// no `legacyKey` are net-new placeholders for business areas that
// don't exist yet (requirement #4).
//
// Role gating (requirement #7 -- role-aware, but NOT an overhaul):
// - Items with a `legacyKey` are gated exactly as before, by looking
//   that key up in `ROLE_NAV_ACCESS` (domain/constants.js) -- zero
//   change to who can see an existing screen.
// - Placeholder items (no `legacyKey`) have no pre-existing permission
//   concept to preserve, so they default to admin/dispatcher only,
//   not technician -- consistent with the existing, deliberately
//   narrow technician role scope, without inventing new granular
//   permission plumbing. This default is a judgment call, not a
//   product decision from the brief; revisit when Roles &
//   Permissions (Administration) is actually built.
// - `alwaysVisible: true` items are visible (and thus routable) to
//   every authenticated role regardless of the two rules above --
//   used only for "My Dashboard", whose content itself (App.jsx's
//   DashboardIndex) already branches per role. Gating the item's
//   *visibility* by `technicianDashboard`'s legacyKey as well would
//   hide the index route entirely for admin/dispatcher, leaving
//   "/dashboard" with no matching route at all -- caught via manual
//   browser testing (blank page for the dispatcher role) before this
//   shipped.
export const PLACEHOLDER_DEFAULT_ROLES = ["admin", "dispatcher"];

export const NAV_DOMAINS = [
  {
    key: "dashboard",
    label: "Dashboard",
    path: "dashboard",
    subnav: [
      { key: "my", label: "My Dashboard", path: "", alwaysVisible: true },
      // Platform Task 3 -- relabeled "Operations Dashboard" -> "Inventory & Supply
      // Overview" to prevent confusion with the new top-level Service Operations
      // area. Path/legacyKey UNCHANGED (still /dashboard/operations, legacyKey
      // "operations") -- only the user-facing label moved.
      { key: "operationsDashboard", label: "Inventory & Supply Overview", path: "operations", legacyKey: "operations" },
      // RETIRED (Owner decision, 2026-08-09). A standalone "Activity" destination had
      // no demonstrated unique product responsibility: the operational timeline is live
      // in Service Operations, each Work Order carries its own Operational History, the
      // Dispatcher Board has a session feed, and an Account has Service Activity --
      // four surfaces at four grains over three data sources. This destination was a
      // fifth name for none of them.
      //
      // Do NOT restore it without an explicit product decision. Reinstating it means
      // choosing what it IS ("my activity" or a cross-domain roll-up), and each is a new
      // product with its own authority and projection -- not a nav entry. See
      // docs/reviews/ux3-activity-destination-scope.md.
      // The existing activity/history surfaces are untouched: their grains and
      // authorities are genuinely distinct.
      { key: "notifications", label: "Notifications", path: "notifications", placeholderExplanation: "Current notifications appear in the bell at the top of every screen. This destination is for the full notification history, which is not built yet.", navHidden: true },
    ],
  },
  {
    // CRM/Sales top-level area. The domain KEY stays "customers" (routes,
    // legacyKey mappings, App.jsx's `domain.key === "customers"` gating, and
    // /customers[/:accountId] are all unchanged) -- only the user-facing
    // top-level LABEL is renamed to "CRM/Sales" so exactly ONE top-level entry
    // names the overall Customer platform area. The customer LIST/records keep
    // the "Customers"/"New Customer" terms (the subnav entry below, the
    // dashboard heading, Global Search), which are entity-level, not the
    // platform-area name.
    key: "customers",
    label: "CRM/Sales",
    path: "customers",
    subnav: [
      // Sprint 2.0.2 -- Customer Foundation: real screen now
      // (AccountsList, special-cased in App.jsx's renderSubnavItem
      // since it has no legacyKey -- this is a new screen, not a
      // re-homed one). Account Detail (/customers/:accountId) is a
      // sibling parameterized route added directly in App.jsx, not
      // representable in this static subnav list.
      //
      // Customer hierarchy nav cleanup: the global Contacts / Locations /
      // Equipment / Service History subnav entries were removed -- Contacts
      // and Locations belong to an individual Account (shown on Account
      // Detail), and Service History is not built. Their retired paths
      // (customers/contacts|locations|equipment|service-history) are
      // redirected to /customers in App.jsx so they can never be captured by
      // the :accountId detail route.
      //
      // Equipment is now BUILT (Issue #232) and has its own top-level area at
      // /equipment -- see the domain below. That does not resurrect this
      // subnav entry or its retired path: customers/equipment still redirects
      // to /customers, and the register deliberately lives outside the
      // Customer hierarchy because it spans customers.
      { key: "customers", label: "Customers", path: "" },
      // Sales Cycle 2 -- the Opportunity Operating Workspace (READ-FIRST). Opportunity Management is the
      // ratified Sales entry point, and it lives inside this CRM/Sales area rather than as a second top-level
      // "Sales" entry (Issue #288 removed the old `salesCrm` placeholder for exactly that one-area reason).
      // No legacyKey: brand-new screen, explicit App.jsx branch; nav access falls to PLACEHOLDER_DEFAULT_ROLES
      // (admin/dispatcher). It reads synthetic opportunities through an injected source seam and writes
      // nothing (Opportunity is pre-commitment; a governed write path arrives in a later cycle).
      { key: "opportunities", label: "Opportunities", path: "opportunities" },
      // Sales Orders -- the cross-account INDEX over the deployed listSalesOrderIndex
      // callable. Added because the capability was never the thing missing: admin holds
      // all four salesOrder.* ids, the sandbox activates all four, and an admin still saw
      // nothing about Sales Orders anywhere in the product -- the only surface was a
      // detail route reachable by first opening the Opportunity that created the order.
      // Sits beside Opportunities because that is the stage it follows (Opportunity -> WON
      // -> Sales Order), not as a new top-level area (Issue #288 removed the old salesCrm
      // placeholder for exactly that one-area reason).
      // No legacyKey: new screen, explicit App.jsx branch; nav access falls to
      // PLACEHOLDER_DEFAULT_ROLES (admin/dispatcher), and the read re-authorizes
      // server-side against salesOrder.read regardless of who the nav lets through.
      { key: "salesOrders", label: "Sales Orders", path: "sales-orders" },
    ],
  },
  // Platform Task 3 -- Service Operations, promoted from the former Service >
  // Control Tower sub-item to its own top-level area at /service-operations. Its
  // single index screen renders the SAME component (LEGACY_COMPONENTS
  // ["controlTower"] -> ControlTower) via the STABLE "controlTower" legacyKey, so
  // behavior, data access, and admin/dispatcher-only visibility are unchanged
  // (technician/unauthorized roles fail closed exactly as before -- the index
  // route isn't generated for them). Single-item sub-nav, same shape as the
  // Customers domain.
  //
  // ORDER: it sits ABOVE Equipment and Service deliberately (Owner, 2026-08-30).
  // Those two are expandable sections (Service carries three groups; Inventory
  // below is the same shape), and a single-destination area reading as a peer
  // *between* them made the rail look inconsistent -- one flat item wedged among
  // sections, with Inventory's section starting again underneath it. The one flat
  // destination goes first, then the sections. Nothing about visibility, paths or
  // legacyKeys changes with the position; NAV_DOMAINS order is presentation only.
  {
    key: "serviceOperations",
    label: "Service Operations",
    path: "service-operations",
    subnav: [
      { key: "serviceOperations", label: "Service Operations", path: "", legacyKey: "controlTower" },
    ],
  },
  {
    // Equipment & Installed Asset Management -- Issue #232 unit E5.
    //
    // A TOP-LEVEL area, not a CRM/Sales subnav item. The retired
    // `customers/equipment` path (redirected to /customers in App.jsx) was a
    // placeholder under the Customer hierarchy; this is the real register and it
    // spans customers, so it gets its own domain at /equipment. The two paths do not
    // collide -- that redirect stays exactly as it is.
    //
    // No `legacyKey`: per this file's own rule, an item without one defaults to
    // admin/dispatcher only and NOT technician. That default is exactly right here
    // rather than incidental -- it mirrors E3's Rules (#289), where admin/dispatcher
    // are the only principals with any Equipment authority and a technician is denied
    // outright. A technician's self-scoped Equipment view is E17's, and nav visibility
    // is not a security boundary in any case: Rules are.
    key: "equipment",
    label: "Equipment",
    path: "equipment",
    subnav: [{ key: "equipment", label: "Equipment", path: "" }],
  },
  {
    key: "service",
    label: "Service",
    path: "service",
    subnav: [
      // Sprint 2.0.3 -- "Work Orders" is now the real Work Order
      // workspace (WorkOrdersList, special-cased in App.jsx's
      // renderSubnavItem since it has no legacyKey -- new screen, not
      // a re-homed one). No legacyKey means this defaults to
      // admin/dispatcher visibility (PLACEHOLDER_DEFAULT_ROLES),
      // which is correct here -- technicians keep their own separate
      // Work Order view (Dashboard > My Dashboard /
      // TechnicianDashboard.jsx), untouched by this sprint.
      { key: "workOrders", label: "Work Orders", path: "" },
      // The legacy fieldops_jobs screen (Jobs.jsx), relocated from
      // the "Work Orders" slot above. Same legacyKey ("jobs") as
      // before, so existing role access (including technician) is
      // unchanged -- only its label/position moved, per explicit
      // instruction not to relabel this "Legacy" in user-facing UI.
      { key: "jobAssignments", label: "Job Assignments", path: "job-assignments", legacyKey: "jobs" },
      // Platform Task 2 -- "Dispatch" relabeled "Dispatch Queue" (its child slot
      // in the new Dispatch group). Path/legacyKey UNCHANGED, so its URL
      // (/service/dispatch) and role access are identical -- only the label moved.
      // KEPT AND RENAMED "Jobs" (Owner, 2026-08-30). It was nearly retired with Scheduling and
      // Dispatch Board as a third Schedule-only duplicate, and it is not one: `mobilePrimaryNav.js`
      // already routes the phone's **Jobs** tab at this exact route, so it is a screen someone uses
      // every day. The old label "Dispatch Queue" is what made it look like a spare dispatcher board.
      //
      // ONE SCREEN, ONE NAME. The same destination was called "Jobs" on the phone and "Dispatch
      // Queue" on the desktop, which is how a live surface gets mistaken for a duplicate — the label
      // now matches the mobile tab it shares a route with.
      //
      // Not to be confused with "Job Assignments" (/service/job-assignments) in Work Management:
      // that is a READ list over work orders and technicians. This one performs the governed
      // Dispatch transition and sets assignedTechId. Different jobs, similar words; the distinction
      // is the write.
      { key: "dispatch", label: "Jobs", path: "dispatch", legacyKey: "dispatch" },
      // Coordinated Operations — the user-consumable reads of the already-built coordinatedVisit /
      // coordinatedFieldMission projections (functions/src/fulfillment). NO new authority: the Sales Order is
      // the coordination anchor; Work Orders keep individual execution. Both read a SYNTHETIC source through
      // an injected seam and write nothing.
      //   • Coordinated Visits = the Service/Dispatch projection. No legacyKey → admin/dispatcher (PLACEHOLDER
      //     _DEFAULT_ROLES), grouped under Dispatch.
      //   • Coordinated Mission = the Technician projection. legacyKey "fieldMode" so it inherits the SAME
      //     visibility as the Technician Workspace (admin + technician), grouped under Technician Workspace.
      //     Reusing fieldMode avoids inventing a new ROLE_NAV_ACCESS key; nav visibility is not the security
      //     boundary (Rules are), and this surface is read-only synthetic.
      { key: "coordinatedVisits", label: "Coordinated Visits", path: "coordinated-visits" },
      { key: "coordinatedMission", label: "Coordinated Mission", path: "coordinated-mission", legacyKey: "fieldMode" },
      { key: "technicianWorkspace", label: "Technician Workspace", path: "technician-workspace", legacyKey: "fieldMode" },
      // THE SHARED SCAN WORKSPACE. Declares BOTH paths deliberately, which is the composition
      // isNavItemVisible already supports (an item may declare a capability set and a compatibility
      // path and admit either):
      //
      //   capabilityAccess -> a governed Parts/Warehouse persona holding inventory.stock.receive
      //     sees it WITHOUT any change to the legacy ROLE_NAV_ACCESS map. That map understands only
      //     admin/dispatcher/technician and cannot express those personas at all
      //     (docs/governance/parts-scanner-access-decision.md §3), so adding business roles to it
      //     would add keys nothing reads.
      //   legacyKey "fieldMode" -> technicians and admins keep seeing it through the SAME key the
      //     Technician Workspace already uses. No new ROLE_NAV_ACCESS key is invented.
      //
      // Nav visibility is not the security boundary (Rules and the governed commands are). The
      // workspace itself derives every workflow it offers from the trusted effective-access feed.
      { key: "scan", label: "Scan", path: "scan", legacyKey: "fieldMode", capabilityAccess: RECEIVING_SURFACE_CAPABILITIES },
      // Platform Task 3 -- Control Tower left the Service sub-nav: it is now the
      // top-level "Service Operations" area (NAV_DOMAINS' serviceOperations
      // below), still rendered by LEGACY_COMPONENTS["controlTower"] with the same
      // "controlTower" legacyKey (admin/dispatcher visibility unchanged). The
      // retired /service/control-tower URL redirects to /service-operations
      // (App.jsx).
      { key: "dispatcherBoard", label: "Dispatcher Board", path: "dispatcher-board", legacyKey: "dispatcherBoard" },

      // ════════ THREE DISPATCH ENTRIES RETIRED FROM THE RAIL (Owner, 2026-08-30) ════════
      //
      // The Dispatch group showed FIVE entries and a dispatcher needs one. Each was individually
      // justified when it was added and the justifications were true; what nobody did was ask
      // whether they still held once the next one shipped.
      //
      // `Scheduling` was built to expose "the SCHEDULED gate that had no UI". `Dispatch Board`
      // (dispatchScheduling) was Wave 7 PART 1, whose own comment said ADDITIVE, does NOT replace
      // Dispatcher Board or Scheduling -- correct on the day, and written BEFORE the North Star
      // board existed. The North Star Dispatcher Board (P1v1, Owner-accepted 2026-08-29) now reaches
      // Schedule, Reschedule, Reassign, Unschedule AND Dispatch. Measured, not assumed:
      //
      //     Dispatcher Board   Schedule · Reschedule · Reassign · Unschedule · Dispatch
      //     Scheduling         Schedule                                          <- subset
      //     Dispatch Board     Schedule                                          <- subset
      //     Dispatch Queue     Dispatch                                          <- subset
      //
      // NAVIGATION HONESTY, NOT CAPABILITY REMOVAL. `navHidden` is read by AppRail only; App.jsx's
      // route generator does not check it, so every URL still resolves and every component still
      // mounts. Nothing is deleted, no route redirects, no authority changes. Deleting the
      // components is a separate decision that needs its own evidence.
      { key: "scheduling", label: "Scheduling", path: "scheduling", navHidden: true },
      { key: "dispatchScheduling", label: "Dispatch Board", path: "dispatch-scheduling", navHidden: true },
      { key: "warranty", label: "Warranty", path: "warranty", navHidden: true },
    ],
  },
  {
    key: "inventory",
    label: "Inventory",
    path: "inventory",
    subnav: [
      // The catalog operating surface. Reachable by governed catalog authority (so an
      // inventoryCatalogAdministrator can exercise what it holds) OR by the unchanged compatibility path.
      //
      // LABELLED "Parts Catalog" (Owner, 2026-08-30) because that is what the repository already
      // calls this screen everywhere except the nav: `objectPermissionMap.js` registers the governed
      // object as "Parts Catalog", its view model is `domain/partsCatalogView.js`, PartsList.jsx
      // describes itself as the Parts Catalog, and the capability set gating this very line is
      // CATALOG_SURFACE_CAPABILITIES. The nav was the one place saying "Parts".
      //
      // That gap is not cosmetic: a screen whose menu name differs from its governed object name is
      // how a live surface gets mistaken for something else -- the same defect that nearly retired
      // the dispatch Jobs screen in this PR, pointed the other way.
      { key: "parts", label: "Parts Catalog", path: "", legacyKey: "inventory", capabilityAccess: CATALOG_SURFACE_CAPABILITIES },
      // ADR-009 G2 -- governed Part Master administration workspace (read + fail-closed write)
      // (no legacyKey: brand-new screen, explicit App.jsx branch; admin/dispatcher via the default).
      //
      // Wave 6 nav-convergence gate (2026-08-15, Decision #43's own UD-5): PartsList.jsx/PartDetail.jsx
      // now offer New Part / Edit Part Details / Change Status directly (the SAME governed commands this
      // screen already used -- see src/shared/partMaster/PartWriteModal.jsx), so the individual-part CRUD
      // workflow no longer needs this destination. The gate is NOT fully clear, though: this screen's
      // TABLE view (browse every Part by master-data status/control/class in one place) has no equivalent
      // inside Parts yet -- Parts Catalog shows category/available/risk, not master status. That is a
      // real, still-legitimate admin workflow, so this is demoted out of normal primary navigation
      // (`navHidden`, same mechanism as Cycle Counts/Back Orders below) rather than removed outright --
      // the route/component/commands/tests/audit are all unchanged and still reachable by direct URL for
      // whoever needs the bulk-catalog-review workflow. Re-promote to normal nav if that judgment is
      // wrong, or build the equivalent status-browse view inside Parts and then fully retire this route.
      //
      // PARTS STRUCTURED-LIST MIGRATION (2026-08-23): RE-PROMOTED to normal navigation, which is the
      // outcome the note above explicitly invited. The gate it named was that this table had no
      // equivalent inside Parts and no real way to work at catalogue scale. It now has one: the shared
      // Add Filter / Sort / active-filter controls read the Part field metadata, the query is ordered,
      // limited and cursored at Firestore, and list state lives in the URL. That is the master-data
      // browse workflow the comment was preserving, so hiding the only screen that offers it would be
      // keeping the workflow and hiding the door.
      //
      // LABELLED "Catalog Admin" (Owner, 2026-08-30). "Part Master" named the DATA rather than the
      // job, which left two screens over the same objects with no way to tell from the rail which
      // one you wanted. The pair now reads as what it is: Parts Catalog is the catalogue; this is
      // the administration OF it -- the catalogue-scale browse by master-data status/control/class
      // that the entry above deliberately does not offer (it shows category/available/risk).
      //
      // VISIBILITY DELIBERATELY UNCHANGED (Owner, 2026-08-30). Admin and dispatcher both keep it,
      // exactly as before. Restricting it to admin was considered and NOT taken: isNavItemVisible
      // gates the ROUTE TABLE as well as the rail (App.jsx), so a role restriction here would deny
      // dispatchers the screen rather than tidy their menu -- an authorization change, and one that
      // should not ride along with a rename. Revisit once it is known whether dispatchers use it.
      { key: "partMaster", label: "Catalog Admin", path: "part-master" },
      // Manufacturer administration workspace (catalog reference object Parts link to; read + fail-closed
      // write). No legacyKey: brand-new screen, explicit App.jsx branch; admin/dispatcher via the default.
      // NOTE: the `manufacturers` collection read is still Rules-closed (the governed read-authority
      // decision is DEFERRED to the Owner -- it interacts with the R-1 legacy-surface convergence gate),
      // so the workspace read fails closed to a denied state until resolved. Wave 6 (2026-08-15): hidden
      // from normal navigation for the SAME reason as Cycle Counts/Back Orders -- unlike Part Master, this
      // is not even a "still legitimate, just redundant" case: because the read is Rules-closed to EVERY
      // persona, no one can use this screen at all today (confirmed by repository audit). Route/component/
      // commands/Rules/tests unchanged; restore once the Manufacturer read-authority decision (see the
      // parts-ux-redesign-blueprint.md §14d architecture writeup) is made and built.
      { key: "manufacturers", label: "Manufacturers", path: "manufacturers", navHidden: true },
      // THE WAREHOUSE / PARTS HANDHELD. Its own nav item, gated by the union of the station
      // capabilities the workflows behind it actually use -- never a coarse "warehouse user" id.
      // Renders the handheld shell on a phone and the existing desktop surface on anything wider;
      // width chooses composition, never authority.
      { key: "warehouseWorkspace", label: "Warehouse Workspace", path: "warehouse-workspace", capabilityAccess: WAREHOUSE_HANDHELD_CAPABILITIES },
      { key: "warehouses", label: "Warehouses", path: "warehouses" },
      { key: "truckInventory", label: "Truck Inventory", path: "truck-inventory" },
      // Reachable by governed transfer authority OR by the existing compatibility path. `legacyKey`
      // "inventory" is the SAME admin/dispatcher set this item already had via PLACEHOLDER_DEFAULT_ROLES,
      // stated explicitly so the capability check has something to fall through to without widening access.
      { key: "transfers", label: "Transfers", path: "transfers", legacyKey: "inventory", capabilityAccess: TRANSFER_SURFACE_CAPABILITIES },
      { key: "receiving", label: "Receiving", path: "receiving" },
      // Wave 6 Owner decision (2026-08-15): hidden from normal navigation while these
      // remain pure route stubs with no backend capability behind them (confirmed by
      // repository audit -- no domain module, no Firestore collection, no engine).
      // Navigation honesty, NOT capability removal: the route/PlaceholderPage/spec stay
      // exactly as they were, reachable by direct URL; only isNavItemVisible-driven UI
      // presentation (the rail) is filtered separately via `navHidden` (see AppRail.jsx),
      // which App.jsx's route generator does NOT check, so nothing here changes what a
      // direct/deep link resolves to. Restore the nav entry (delete this flag) once a
      // real capability exists and is ready for user testing.
      // navHidden REMOVED (Owner decision 2026-08-16). The flag above was explicit that it should be
      // restored "once a real capability exists and is ready for user testing" -- that condition is now
      // met: four governed cycle-count callables are deployed and ACTIVE, the capabilities are activated
      // in this environment, and two governed Roles carry them. Keeping it hidden would now be the
      // dishonest state, not the honest one. Back Orders below stays hidden -- it still has no backend.
      { key: "cycleCounts", label: "Cycle Counts", path: "cycle-counts", legacyKey: "inventory", capabilityAccess: CYCLE_COUNT_SURFACE_CAPABILITIES },
      { key: "backOrders", label: "Back Orders", path: "back-orders", navHidden: true },
    ],
  },
  // Issue #100 PR 2b (docs/specifications/inventory-nav-access-alignment.md)
  // -- the first of three planned role-scoped Inventory surfaces for an
  // ACTIVE, reciprocally linked technician operationalRole. Domain key
  // "inventoryRole" is shared/future-shaped: PR 1b (PARTS_MANAGER, path
  // "manager") and PR 3b (PARTS_ASSOCIATE, path "mine") are each expected
  // to add their OWN sibling subnav item here, gated the same way. Every
  // item declares operationalRoleAccess, so isDomainVisible() is false
  // (and the whole domain doesn't render) for admin/dispatcher and for
  // any technician without a matching, ACTIVE operationalRole -- see the
  // explicit admin/dispatcher redirect to /inventory added in App.jsx;
  // every other ineligible case falls through to the existing top-level
  // catch-all (Navigate to="/dashboard"), same mechanism as every other
  // gated route.
  //
  // Issue #100 PR 1b -- adds "manager" (PARTS_MANAGER), the second item.
  // App.jsx's admin/dispatcher redirect and its top-level-tab index
  // redirect (both keyed off domain.key === "inventoryRole", not any
  // specific item) already generalize to this item with no further
  // App.jsx routing change -- see that file's own PR 2b comments.
  {
    key: "inventoryRole",
    label: "My Inventory Role",
    path: "inventory-role",
    subnav: [
      {
        key: "manager",
        label: "Parts Manager",
        path: "manager",
        operationalRoleAccess: [OPERATIONAL_ROLE.PARTS_MANAGER],
      },
      {
        key: "warehouse",
        label: "Warehouse Manager",
        path: "warehouse",
        operationalRoleAccess: [OPERATIONAL_ROLE.WAREHOUSE_MANAGER],
      },
      // Issue #100 PR 3b -- adds "mine" (PARTS_ASSOCIATE), the third and
      // final sibling item this domain was shaped for. Same generic
      // App.jsx routing (admin/dispatcher redirect, top-level-tab index
      // redirect) applies with no further App.jsx change.
      {
        key: "mine",
        label: "My Purchasing",
        path: "mine",
        operationalRoleAccess: [OPERATIONAL_ROLE.PARTS_ASSOCIATE],
      },
    ],
  },
  {
    key: "purchasing",
    label: "Purchasing",
    path: "purchasing",
    subnav: [
      { key: "purchaseOrders", label: "Purchase Orders", path: "" },
      { key: "suppliers", label: "Suppliers", path: "suppliers" },
      { key: "quotes", label: "Quotes", path: "quotes", navHidden: true },
      { key: "receipts", label: "Receipts", path: "receipts" },
      { key: "demandPlanning", label: "Demand Planning", path: "demand-planning", navHidden: true },
    ],
  },
  // ════════ FINANCIALS — FIRST-CLASS EOS DOMAIN (Frame 0, Owner-approved) ════════
  //
  // NAVIGATION / PRESENTATION STRUCTURE ONLY. This domain replaces the former
  // `future: true, navHidden: true` Financials stub with the approved information
  // architecture so FIN-001+ (docs/financials/FINANCIALS_AUTHORITY_AND_REPORTING_BASELINE.md)
  // can progressively compose governed authority into addressable sections. Nothing behind
  // any of these destinations exists yet: no financial collections, Functions, Rules,
  // calculations, or data were created with this structure, and every item renders the
  // honest PlaceholderPage via App.jsx's normal renderSubnavItem fall-through.
  //
  // ACCESS POSTURE. No item declares capabilityAccess — deliberately. The future Financial
  // Visibility capability model (financial.reporting.*, financial.revenue.read, ...) is a
  // FIN-001/FIN-004 design input, and inventing identifiers here would make navigation LOOK
  // governed without any authority behind it. Every item therefore takes the repository's
  // existing conservative no-legacyKey default (PLACEHOLDER_DEFAULT_ROLES: admin/dispatcher;
  // technicians excluded). NAVIGATION VISIBILITY IS NOT FINANCIAL DATA AUTHORITY: every
  // eventual Financials read/write must independently enforce governed financial visibility
  // and scope server-side, exactly as Report Builder does today.
  //
  // GOVERNING FINANCIAL INVARIANTS (recorded here so no surface built into this structure
  // can claim ignorance; full statement in the baseline doc above):
  //   A. ACTUAL != FORECAST != BUDGET != GOAL != RECONCILED ACCOUNTING FACT — comparable,
  //      never silently blended.
  //   B. HISTORICAL STAYS HISTORICAL — changing customer owner, employee assignment,
  //      business-unit/company ownership, sales credit, goals or budgets must not silently
  //      rewrite historical financial attribution.
  //   C. ISSUED FINANCIAL EVENTS ARE HISTORY — corrections are governed adjustment events,
  //      never in-place edits of the original event.
  //   D. REPORTING ATTRIBUTION MUST BE EXPLICIT — never infer Taylor/Ventana from
  //      warehouse/location names, salesperson from current Customer.owner, business unit
  //      from a route name, period from UI state, cost from retail price, or margin from
  //      incomplete cost sources.
  //   E. VISIBILITY FOLLOWS THE NUMBER EVERYWHERE — a principal denied a fact here must not
  //      receive it via Sales Order, Agreement, Customer, Work Order, dashboards, reports,
  //      exports, APIs, search, or notifications.
  {
    key: "financials",
    label: "Financials",
    path: "financials",
    subnav: [
      // Wave UX-1 (North Star P1): overview, invoices, accountsReceivable, payments and
      // customerFinancials render real compositions (App.jsx branches) — no
      // placeholderExplanation. Access posture unchanged: PLACEHOLDER_DEFAULT_ROLES for nav
      // visibility; financial DATA authorization stays server-side (FIN-004), fail-closed.
      { key: "overview", label: "Overview", path: "" },
      { key: "billingQueue", label: "Billing Queue", path: "billing-queue" },
      { key: "invoices", label: "Invoices", path: "invoices" },
      { key: "accountsReceivable", label: "Accounts Receivable", path: "accounts-receivable" },
      { key: "payments", label: "Payments", path: "payments" },
      { key: "creditsAdjustments", label: "Credits & Adjustments", path: "credits-adjustments" },
      { key: "customerFinancials", label: "Customer Financials", path: "customer-financials" },
      { key: "salesToGoal", label: "Sales to Goal", path: "sales-to-goal" },
      { key: "costToBudget", label: "Cost to Budget", path: "cost-to-budget" },
      { key: "forecasting", label: "Forecasting", path: "forecasting" },
      { key: "profitability", label: "Gross Margin & Profitability", path: "profitability" },
      { key: "budgets", label: "Budget Management", path: "budgets" },
      { key: "goals", label: "Goal Management", path: "goals" },
      { key: "companyPerformance", label: "Company & Business Unit Performance", path: "company-performance" },
      { key: "employeePerformance", label: "Salesperson & Employee Performance", path: "employee-performance" },
      { key: "reconciliation", label: "Reconciliation & Exceptions", path: "reconciliation" },
      { key: "intercompany", label: "Intercompany", path: "intercompany" },
      { key: "audit", label: "Financial Audit & History", path: "audit" },
      { key: "reports", label: "Reporting & Exports", path: "reports" },
      { key: "governance", label: "Financial Settings & Governance", path: "governance" },
    ],
  },
  {
    key: "reporting",
    label: "Reporting",
    path: "reporting",
    subnav: [
      // Issue #325 / ADR-007 W1 -- the governed report builder, activated for wave-1. Unlike the
      // placeholder items below (admin/dispatcher via PLACEHOLDER_DEFAULT_ROLES), this is
      // CAPABILITY-gated: visible only to a principal who effectively holds a wave-1 report
      // object-read capability -- today the Owner Role alone (governedBusinessRoles.ts). Nav
      // visibility is a preview, never the security boundary: the trusted Function (D-FN)
      // re-authorizes every run server-side.
      { key: "builder", label: "Report Builder", path: "builder", capabilityAccess: REPORT_WAVE1_OBJECT_READ_CAPABILITIES },
      // Issue #325 W-SAVE -- the Saved Reports surface, backed by the trusted saved-definition
      // callables. Capability-gated on report.definition.read (resolved by the trusted feed); shown
      // only to a principal the feed grants read, hidden/unavailable otherwise (incl. production,
      // where the callables are undeployed and the feed itself errors).
      { key: "savedReports", label: "Saved Reports", path: "saved", capabilityAccess: [REPORT_DEFINITION_CAPABILITIES.read] },
      { key: "executive", label: "Executive", path: "", placeholderExplanation: "Reporting is built — this domain has no report definitions yet. Build one in Report Builder, or open Saved Reports, if your role includes reporting.", navHidden: true },
      { key: "service", label: "Service", path: "service", placeholderExplanation: "Reporting is built — this domain has no report definitions yet. Build one in Report Builder, or open Saved Reports, if your role includes reporting.", navHidden: true },
      { key: "inventory", label: "Inventory", path: "inventory", placeholderExplanation: "Reporting is built — this domain has no report definitions yet. Build one in Report Builder, or open Saved Reports, if your role includes reporting.", navHidden: true },
      { key: "purchasing", label: "Purchasing", path: "purchasing", placeholderExplanation: "Reporting is built — this domain has no report definitions yet. Build one in Report Builder, or open Saved Reports, if your role includes reporting.", navHidden: true },
      { key: "warehouse", label: "Warehouse", path: "warehouse", placeholderExplanation: "Reporting is built — this domain has no report definitions yet. Build one in Report Builder, or open Saved Reports, if your role includes reporting.", navHidden: true },
      { key: "employees", label: "Employees", path: "employees", placeholderExplanation: "Reporting is built — this domain has no report definitions yet. Build one in Report Builder, or open Saved Reports, if your role includes reporting.", navHidden: true },
      { key: "customers", label: "Customers", path: "customers", placeholderExplanation: "Reporting is built — this domain has no report definitions yet. Build one in Report Builder, or open Saved Reports, if your role includes reporting.", navHidden: true },
      { key: "financial", label: "Financial", path: "financial", placeholderExplanation: "Reporting is built — this domain has no report definitions yet. Build one in Report Builder, or open Saved Reports, if your role includes reporting.", navHidden: true },
    ],
  },
  {
    key: "administration",
    label: "Administration",
    path: "administration",
    subnav: [
      // Issue #226 Row 10 -- Admin Portal foundation (Spec sec16 MVP surfaces:
      // Overview, Users, Roles & Permissions, Permission Preview, Audit Logs).
      // "Overview" is net-new and deliberately does NOT take path "" -- Employees
      // (docs/implementation-plans/enterprise-access-prototype-reconciliation.md
      // sec2) keeps its existing index route/legacyKey byte-for-byte untouched, so
      // the bare /administration URL still resolves to Employees exactly as
      // before; Overview is reached at /administration/overview like every other
      // named sub-item. Listed first only for tab-bar display order (array order
      // has no effect on routing/gating).
      { key: "overview", label: "Overview", path: "overview" },
      { key: "employees", label: "Employees", path: "", legacyKey: "technicians" },
      { key: "users", label: "Users", path: "users" },
      { key: "rolesPermissions", label: "Roles & Permissions", path: "roles-permissions" },
      // Objects -- the Role x Object x CRED grid (Owner, 2026-08-20). Sits beside Roles &
      // Permissions because it answers the other half of the same question: that screen is
      // about which PEOPLE hold a role; this one is what a ROLE can do to each object.
      { key: "objects", label: "Objects", path: "objects" },
      // Net-new per Spec sec16's "permission preview/explanation" MVP surface.
      // Real read-only content (effective-permission preview render) lands in
      // Row 11 (Task 16) -- this row only adds the reachable nav slot.
      { key: "permissionPreview", label: "Permission Preview", path: "permission-preview" },
      { key: "vehicles", label: "Vehicles", path: "vehicles", navHidden: true },
      { key: "regions", label: "Regions", path: "regions", navHidden: true },
      { key: "companySettings", label: "Company Settings", path: "company-settings", navHidden: true },
      // Issue #226 sweep -- IntegrationsFaq.jsx (App.jsx line ~355) is a real, complete
      // screen, not a placeholder; unlike vehicles/regions/companySettings above it must
      // stay reachable from the rail per this module's own README (Administration ->
      // Integrations). navHidden was left on from the original placeholder batch edit;
      // removed so the nav matches the built screen.
      // Duplicate Rules -- its own tab under Administration (Owner, 2026-08-19).
      // Configuration people read far more often than they edit, so it sits with
      // the other governed-configuration surfaces rather than in a workspace.
      { key: "duplicateRules", label: "Duplicate Rules", path: "duplicate-rules" },
      // Warehouse Racking -- the physical shape of a warehouse, alongside the other governed
      // configuration surfaces. Bins are places, not stock, so this is configuration and not an
      // Inventory workspace.
      { key: "warehouseRacking", label: "Warehouse Racking", path: "warehouse-racking" },
      { key: "integrations", label: "Integrations", path: "integrations" },
      { key: "auditLogs", label: "Audit Logs", path: "audit-logs" },
    ],
  },
  // Future placeholder top-level areas: NONE remain. Issue #288 removed the salesCrm stub;
  // Financials Frame 0 retired the last one (`future: true, navHidden: true` Financials) by
  // promoting it to the real first-class domain above. App.jsx's future-domain route loop
  // (NAV_DOMAINS.filter(d => d.future)) now emits nothing, which is correct — leave the
  // mechanism in place for any future top-level placeholder.
];

// Issue #100 (docs/specifications/inventory-nav-access-alignment.md,
// PR 0) -- capability-scoped nav access for an ACTIVE, eligible
// operationalRoles Employee whose security role is technician. Mirrors
// firestore.rules' isActiveOperationalRole() at the presentation
// layer: technician-only (admin/dispatcher already have full access
// via their own legacyKey/PLACEHOLDER_DEFAULT_ROLES path above and
// must never additionally need this branch), ACTIVE employment
// required, and at least one of the item's operationalRoleAccess
// values must be present in operationalContext.operationalRoles.
// Fails closed on every edge case without a separate branch: a
// missing/null operationalContext, an empty operationalRoles array
// (unresolved or broken Employee linkage -- AuthContext's
// resolveEmployeeSession() already resolves both to []), and a
// non-ACTIVE employmentStatus (undefined/null/any other enum value)
// all simply fail the checks below and return false.
function hasEligibleOperationalRole(operationalRoleAccess, role, operationalContext) {
  if (role !== ROLES.TECHNICIAN) return false;
  const { operationalRoles = [], employmentStatus = null } = operationalContext ?? {};
  if (employmentStatus !== EMPLOYMENT_STATUS.ACTIVE) return false;
  return operationalRoleAccess.some((required) => operationalRoles.includes(required));
}

// `allowedLegacyKeys` is ROLE_NAV_ACCESS[role] (domain/constants.js) --
// passed in rather than imported here so this stays pure/testable and
// the actual permission source of truth stays in one place.
// `operationalContext` (optional -- omitted entirely for a role/item
// combination that doesn't use it, per Issue #100's design) is
// `{ operationalRoles, employmentStatus }` from AuthContext -- only
// consulted when an item declares `operationalRoleAccess`, so every
// existing legacyKey/PLACEHOLDER_DEFAULT_ROLES/alwaysVisible item's
// behavior is byte-for-byte unchanged regardless of whether this
// argument is passed at all.
function holdsDeclaredCapability(item, operationalContext) {
  const hasCapability = operationalContext?.hasCapability;
  // Fails closed when no previewer is supplied, and when the feed is loading/errored/unknown --
  // buildHasCapability() only ever returns true for a current, version-matched positive decision.
  return typeof hasCapability === "function"
    && item.capabilityAccess.some((cap) => hasCapability(cap) === true);
}

export function isNavItemVisible(item, role, allowedLegacyKeys, operationalContext) {
  if (item.alwaysVisible) return true;

  // GOVERNED CAPABILITY IS THE FINAL ACCESS AUTHORITY FOR GOVERNED SURFACES (Owner decision
  // 2026-08-16, closing #1065). A positive governed decision grants visibility OUTRIGHT and is never
  // overridden by the compatibility-role checks below -- that is the whole point: a principal holding
  // only a governed business Role (inventoryTransferOperator, inventoryCycleCountCounter, ...) used to
  // resolve ALLOW for the capability and still be redirected away from the surface it was for.
  //
  // A NEGATIVE decision, by contrast, falls THROUGH to the paths below rather than denying outright,
  // so an item may declare both a capability set and a compatibility path and admit either. That is
  // what keeps today's admin/dispatcher users working unchanged while the governed model converges.
  if (item.capabilityAccess && holdsDeclaredCapability(item, operationalContext)) return true;

  if (item.operationalRoleAccess) {
    return hasEligibleOperationalRole(item.operationalRoleAccess, role, operationalContext);
  }
  if (item.legacyKey) {
    return (allowedLegacyKeys ?? []).includes(item.legacyKey);
  }
  // A capability-gated item that declares NO compatibility path stays fail-closed: reaching here means
  // its capability decision was not positive, and it must NOT fall back to the default role list.
  // (Report Builder / Saved Reports rely on exactly this -- byte-for-byte their previous behaviour.)
  if (item.capabilityAccess) return false;

  return PLACEHOLDER_DEFAULT_ROLES.includes(role);
}

/**
 * The domain index item (path "") when the current session may NOT see it -- otherwise null.
 *
 * Three independent persona missions landed on a blank page at /inventory and /purchasing.
 * The index item is gated (Inventory > Parts by legacyKey "inventory"), so for a role without
 * it no index route is emitted, the parent route matches with no child, and the user gets the
 * shell with an empty body. The screen they were denied never rendered, so it could not say so.
 *
 * DENIED must never be presented as EMPTY. This decides where a refusal has to be stated. It
 * grants nothing: visibility is still isNavItemVisible(), unchanged.
 */
export function deniedDomainIndexItem(domain, role, allowedLegacyKeys, operationalContext) {
  const indexItem = (domain?.subnav ?? []).find((item) => item.path === "");
  if (!indexItem) return null;
  return isNavItemVisible(indexItem, role, allowedLegacyKeys, operationalContext) ? null : indexItem;
}

export function isDomainVisible(domain, role, allowedLegacyKeys, operationalContext) {
  if (domain.future) {
    return PLACEHOLDER_DEFAULT_ROLES.includes(role);
  }
  return domain.subnav.some((item) => isNavItemVisible(item, role, allowedLegacyKeys, operationalContext));
}

// Platform Task 2 -- Group Service navigation. The Service domain's flat subnav
// is presented as a two-level hierarchy. This is PRESENTATION-ONLY metadata:
// the `service` subnav array above (paths, legacyKeys, order) is unchanged, so
// every route/permission/legacy mapping and App.jsx's route generator are
// untouched. `itemKeys` is the DISPLAY order within a group (independent of the
// subnav array order). Any service subnav item NOT listed here (e.g.
// controlTower) renders as a standalone item, preserving its access + URL.
export const SERVICE_NAV_GROUPS = [
  { key: "workManagement", label: "Work Management", itemKeys: ["workOrders", "jobAssignments", "warranty"] },
  { key: "dispatch", label: "Dispatch", itemKeys: ["dispatcherBoard", "scheduling", "dispatchScheduling", "dispatch", "coordinatedVisits"] },
  { key: "technicianWorkspace", label: "Technician Workspace", itemKeys: ["technicianWorkspace", "coordinatedMission"] },
  // SCANNING IS ITS OWN GROUP, not a child of Technician Workspace.
  //
  // The shared Scan workspace serves warehouse and Parts personas as well as technicians, and a
  // Parts Associate who can see only this one item should not be told they are inside "Technician
  // Workspace" -- the group label is the only context they would get, and it would be wrong.
  { key: "scanning", label: "Scanning", itemKeys: ["scan"] },
];

// Build the two-level Service nav model from the ALREADY-VISIBILITY-FILTERED
// service subnav items (i.e. the caller has already applied isNavItemVisible, so
// access rules -- including the narrow technician scope -- are never broadened
// here). For each group in order: its visible children (in SERVICE_NAV_GROUPS
// order) and a `landing` = the FIRST VISIBLE child (so a group whose usual
// first child is hidden for this role lands on the first child that role can
// actually reach, never a hidden route). Empty groups are omitted. Items that
// belong to no group are returned as `ungrouped`, in their original order. Pure.
export function buildServiceNavGroups(visibleItems = []) {
  return buildNavGroups(SERVICE_NAV_GROUPS, visibleItems);
}

// FINANCIALS is grouped for the same reason Service is, and the measurement is specific: at
// 1440x800 -- an ordinary laptop -- "Salesperson & Employee Performance" sat at y=875 in a flat
// twenty-item rail whose scrollHeight was 1189. It was reachable only by scrolling a list that
// gave no sign there was more below it, which is exactly why the Owner could not find a page that
// was working the whole time.
//
// PRESENTATION-ONLY, like SERVICE_NAV_GROUPS: the financials subnav array, every path, every
// legacyKey and App.jsx's route generator are untouched. Overview is deliberately ungrouped -- it
// is the domain index, not a member of a section.
export const FINANCIALS_NAV_GROUPS = [
  { key: "billing", label: "Billing & Receivables", itemKeys: ["billingQueue", "invoices", "accountsReceivable", "payments", "creditsAdjustments"] },
  { key: "customers", label: "Customers", itemKeys: ["customerFinancials"] },
  { key: "planning", label: "Planning & Targets", itemKeys: ["salesToGoal", "costToBudget", "forecasting", "budgets", "goals"] },
  { key: "performance", label: "Performance", itemKeys: ["profitability", "companyPerformance", "employeePerformance"] },
  { key: "integrity", label: "Integrity & Governance", itemKeys: ["reconciliation", "intercompany", "audit", "reports", "governance"] },
];

export function buildFinancialsNavGroups(visibleItems = []) {
  return buildNavGroups(FINANCIALS_NAV_GROUPS, visibleItems);
}

// The shared two-level builder both domains use. Extracted rather than copied: two hand-maintained
// copies of this logic would drift, and the grouping rules (hide empty groups, land on the first
// VISIBLE child, keep ungrouped items in their original order) are exactly the rules that must not.
export function buildNavGroups(groupsDef = [], visibleItems = []) {
  const byKey = new Map(visibleItems.map((it) => [it.key, it]));
  const groupedKeys = new Set();
  const groups = [];
  for (const g of groupsDef) {
    const items = g.itemKeys.map((k) => byKey.get(k)).filter(Boolean);
    for (const it of items) groupedKeys.add(it.key);
    if (items.length === 0) continue; // hide empty group
    groups.push({ key: g.key, label: g.label, items, landing: items[0] });
  }
  const ungrouped = visibleItems.filter((it) => !groupedKeys.has(it.key));
  return { groups, ungrouped };
}

// Which group is active for a given in-domain path tail (the part AFTER
// "/service/", e.g. "" for /service, "scheduling" for /service/scheduling), or
// null when the active route is a standalone/ungrouped item or not a subnav
// item. Pure -- drives the active-group highlight and is directly testable.
export function findActiveServiceGroupKey(pathTail, groups = []) {
  const match = groups.find((g) => g.items.some((it) => it.path === pathTail));
  return match ? match.key : null;
}
