// DASHBOARD COMPOSITION -- which modules this principal's dashboard is made of, and why each one is
// in the state it is in.
//
// ============================ ONE FRAMEWORK, NOT SIX SCREENS ============================
//
// The Owner's direction is explicit: "Do NOT create separate one-off hardcoded dashboards for every
// role." So there is no technician dashboard and no parts dashboard here. There is one table of
// modules, each declaring what governed context it needs, and a resolver that asks. "The technician
// dashboard" is a DESCRIPTION of what a person with a technician binding and no management scope
// ends up seeing -- not a branch anyone wrote.
//
// NOTHING HERE READS A PERSONA NAME. The platform's own precedent is `deriveScanWorkflows`, which is
// capability-derived and cannot receive a persona; it also supplies the pattern for the unavailable
// case, returning the REASON for every unavailability rather than merely the absence.
//
// ============================ THIS IS NOT A PERMISSION LAYER ============================
//
// A module resolving to READY means "this viewer's governed context supplies the scope this module
// needs". It does NOT mean the data will arrive: every module still reads through its own domain's
// authority, at that domain's own scope, and a server-side denial is the authoritative answer. This
// resolver can only ever remove a module a viewer could not use -- it can never add reach.
//
// PURE. No fetch, no clock, no React.

export const SECTION = Object.freeze({
  CURRENT_WORK: "CURRENT_WORK",
  PERFORMANCE: "PERFORMANCE",
  TEAM_PERFORMANCE: "TEAM_PERFORMANCE",
  DRIVERS: "DRIVERS",
  BUSINESS_IMPACT: "BUSINESS_IMPACT",
});

/** Render order. Fixed here so every persona's dashboard reads in the same order -- a reader who
 *  learns where "what do I need to do" lives should not have to relearn it on another screen. */
export const SECTION_ORDER = Object.freeze([
  SECTION.CURRENT_WORK,
  SECTION.PERFORMANCE,
  SECTION.TEAM_PERFORMANCE,
  SECTION.DRIVERS,
  SECTION.BUSINESS_IMPACT,
]);

export const SECTION_LABEL = Object.freeze({
  CURRENT_WORK: "What needs you",
  PERFORMANCE: "Performance against goal",
  TEAM_PERFORMANCE: "Team performance",
  DRIVERS: "Drivers and exceptions",
  BUSINESS_IMPACT: "Business impact",
});

export const MODULE_STATE = Object.freeze({
  /** This viewer's governed context supplies the scope, and this dashboard reads it. */
  READY: "READY",
  /**
   * The authority exists, the scope resolves, and THIS SURFACE has not composed the read yet.
   *
   * Kept distinct from GATED and UNAVAILABLE deliberately, because the three imply completely
   * different next actions and collapsing them would make honest engineering debt look like a
   * governance blocker. GATED needs a grant or an activation -- someone must decide something.
   * UNAVAILABLE needs an authority that does not exist -- someone must define something. NOT_WIRED
   * needs neither: the fact is governed and readable today, and connecting it is implementation
   * work. Saying so is the difference between a known boundary and a silent gap.
   */
  NOT_WIRED: "NOT_WIRED",
  /**
   * The fact IS composed and live -- on the governed surface that owns it, which is not this one.
   *
   * Added by Owner Decision #172 s10. `myAssignedWork` and `myPerformanceAllTime` sat as NOT_WIRED,
   * which reads as "somebody still has to build this". Nobody does: a technician's assigned work is
   * live on TechnicianDashboard against a technician-scoped read (PT-002), and duplicating it here
   * would create the second implementation of a domain read this platform has been bitten by twice.
   *
   * The distinction matters because NOT_WIRED is a WORK QUEUE. Leaving a deliberately-delegated
   * module in it would keep proposing work that must never be done.
   */
  SATISFIED_ELSEWHERE: "SATISFIED_ELSEWHERE",
  /** The authority exists; a NAMED activation or grant does not. Renders with its blocker. */
  GATED: "GATED",
  /** No authority exists for this fact yet. Renders with what is missing. */
  UNAVAILABLE: "UNAVAILABLE",
});

const has = (ctx, capability) =>
  typeof ctx?.hasCapability === "function" && ctx.hasCapability(capability) === true;

/** The legacy admin/dispatcher surface several Work Order reads are still governed by in Rules. */
const isOperationsViewer = (ctx) => ctx?.role === "admin" || ctx?.role === "dispatcher";

const hasTechnicianBinding = (ctx) => typeof ctx?.technicianId === "string" && ctx.technicianId.length > 0;

const hasLocationScope = (ctx) => Array.isArray(ctx?.warehouseIds) && ctx.warehouseIds.length > 0;

const hasOperationalRole = (ctx, ...roles) => {
  const held = Array.isArray(ctx?.operationalRoles) ? ctx.operationalRoles : [];
  return roles.some((r) => held.includes(r));
};

/**
 * THE MODULE TABLE.
 *
 * `needs`   -- does this viewer's governed context supply the scope this module requires. A module
 *              whose answer is false is ABSENT, not empty: showing an empty "my assigned work" to
 *              someone with no technician binding would state that they have no work, which is a
 *              different claim from "this does not apply to you".
 * `state`   -- READY, or GATED/UNAVAILABLE WITH ITS BLOCKER NAMED. A blocker sentence is the whole
 *              value of an unavailable tile: "Cost authority not available" tells a reader what
 *              would have to change; "Unavailable" tells them nothing.
 * `census`  -- the fact family, so every module traces to the evidence that classified it.
 *
 * Order within a section is the order below.
 */
export const DASHBOARD_MODULES = Object.freeze([
  // ---------------------------------------------------------------- CURRENT WORK
  {
    key: "myAssignedWork",
    section: SECTION.CURRENT_WORK,
    label: "My work",
    census: "T-1 / T-2",
    needs: hasTechnicianBinding,
    // SATISFIED ON THE TECHNICIAN SURFACE (#172 s10) -- deliberately, not pending. Duplicating a
    // technician-scoped read here would be the second implementation of one domain read.
    state: () => MODULE_STATE.SATISFIED_ELSEWHERE,
    blocker:
      "Your assigned work is live on the technician screen, read against your own technician identity. This dashboard deliberately does not duplicate it.",
  },
  {
    key: "unverifiedSubmissions",
    section: SECTION.CURRENT_WORK,
    label: "Waiting to sync",
    census: "T-9",
    // Every persona that submits from a handheld, not only technicians. UNVERIFIED is a first-class
    // state and never a spinner, so it belongs where a person will act on it.
    needs: (ctx) => hasTechnicianBinding(ctx) || hasOperationalRole(ctx, "PARTS_ASSOCIATE", "WAREHOUSE_ASSOCIATE", "PARTS_MANAGER", "WAREHOUSE_MANAGER"),
    // DEVICE-LOCAL, and therefore genuinely COMPLETE (#172 s9): the whole truth about this queue
    // lives on this device, so no server count is needed and none is invented for it.
    state: () => MODULE_STATE.READY,
  },
  {
    key: "serviceAttention",
    section: SECTION.CURRENT_WORK,
    label: "Service attention",
    // SV-6 (parts-blocked) is deliberately NOT included. That signal composes a caller-supplied
    // parts-readiness output this surface does not hold, and passing the projection nothing would be
    // indistinguishable from "no work is blocked" -- which is a claim, not an absence.
    census: "SV-2 / SV-4 / SV-5",
    needs: isOperationsViewer,
    state: () => MODULE_STATE.READY,
  },
  {
    key: "reorderQueue",
    section: SECTION.CURRENT_WORK,
    label: "Reorder requests",
    census: "W-6 / P-5",
    needs: (ctx) => hasLocationScope(ctx) || isOperationsViewer(ctx),
    // BOUNDED ACTIONABLE PREVIEW (#172). Rows of pending-review requests in the domain's own
    // order, with no count -- the tile shows work, and "View all" leads to the Parts workspace.
    state: () => MODULE_STATE.READY,
  },
  {
    key: "receivingQueue",
    section: SECTION.CURRENT_WORK,
    label: "Awaiting receipt",
    census: "W-1 / W-2 / P-6",
    needs: (ctx) => has(ctx, "inventory.stock.receive") || isOperationsViewer(ctx),
    // BOUNDED ACTIONABLE PREVIEW (#172) over the EXISTING governed callable seam
    // (fetchReceivablePurchaseOrders). No new receiving authority, no client-direct collection read.
    state: () => MODULE_STATE.READY,
  },
  {
    key: "adminDecisions",
    section: SECTION.CURRENT_WORK,
    label: "Decisions for you",
    census: "A-1 / A-2 / A-3",
    needs: (ctx) => ctx?.role === "admin",
    // BOUNDED PREVIEW of ROLE REQUESTS ONLY, named as such. Access requests and password resets
    // have server callables but no governed client list read, so folding them into one tile would
    // assert a completeness nothing here can support (#172 s4: never flatten distinct classes).
    state: () => MODULE_STATE.READY,
  },
  {
    key: "myOpportunities",
    section: SECTION.CURRENT_WORK,
    label: "My opportunities",
    census: "S-1 / S-2 / S-3",
    needs: (ctx) => has(ctx, "opportunity.read"),
    // BOUNDED ACTIONABLE PREVIEW (#172), read through the GOVERNED source -- never the synthetic
    // fixture source, which is what an unqualified useOpportunities() would have supplied.
    state: () => MODULE_STATE.READY,
  },
  {
    key: "ordersRequiringAction",
    section: SECTION.CURRENT_WORK,
    label: "Orders requiring action",
    census: "S-18 / SV-15",
    // Composed only where the capability actually resolved. Not listed as GATED for everyone else:
    // a person with no sales or fulfillment function should not be told a sales surface is locked.
    needs: (ctx) => has(ctx, "fulfillment.coordinatedVisit.read"),
    // BOUNDED ACTIONABLE PREVIEW (#172): coordinated visits whose readiness is ATTENTION, in the
    // attention-first order the domain already sorts them into.
    state: () => MODULE_STATE.READY,
  },

  // ---------------------------------------------------------------- PERFORMANCE
  {
    key: "myGoals",
    section: SECTION.PERFORMANCE,
    label: "My goals",
    census: "Decision #162",
    // Everyone with an employee identity has a place for a target, whether or not one is set. The
    // module's own NO_GOAL state is what says "nobody has set one" -- and that absence is worth
    // showing, because it is a management gap rather than a system limitation.
    needs: (ctx) => typeof ctx?.employeeId === "string" && ctx.employeeId.length > 0,
    state: () => MODULE_STATE.READY,
  },
  {
    key: "myPerformanceAllTime",
    section: SECTION.PERFORMANCE,
    label: "My record",
    census: "T-4",
    needs: hasTechnicianBinding,
    // SATISFIED ON THE TECHNICIAN SURFACE (#172 s10).
    state: () => MODULE_STATE.SATISFIED_ELSEWHERE,
    blocker:
      "Your all-time record is live on the technician screen, where it is read against your own technician identity.",
  },
  {
    key: "technicianQualityMetrics",
    section: SECTION.PERFORMANCE,
    label: "Quality and timeliness",
    census: "SV-11 / SV-12 / T-5",
    // RESERVED AND VISIBLY EMPTY, deliberately. Only productivity is governed today, and a
    // technician dashboard showing a completion count ALONE reads as though throughput is the whole
    // of the job. The empty slots are the design's statement that the platform knows the picture is
    // incomplete -- the Owner's "do not reward throughput alone", expressed as a shape.
    needs: hasTechnicianBinding,
    state: () => MODULE_STATE.UNAVAILABLE,
    blocker:
      "On-time completion, first-time fix and jobs per workday are not measured yet. Each needs a business definition that does not exist: what counts as on time, how a repeat visit is linked to its original, and what a workday is when a working schedule may be unrecorded.",
  },
  {
    key: "myBooked",
    section: SECTION.PERFORMANCE,
    label: "My booked",
    census: "S-9",
    needs: (ctx) => has(ctx, "opportunity.read") || has(ctx, "salesOrder.read"),
    // UNAVAILABLE, not GATED. Nobody can activate their way to this: there is no read to switch on.
    state: () => MODULE_STATE.UNAVAILABLE,
    // CORRECTED. This said "no reporting period to total them over", which stopped being true when
    // G-05 landed: DAY, MTD, QTD, YTD and T12M are governed, on the America/Phoenix reporting
    // calendar, and `resolveReportingPeriod` is the same authority the server uses. The period was
    // never the real obstruction anyway -- AB-2 is that booked has no read AT ALL, at any period.
    blocker:
      "Booked has no governed read of its own — there is nothing to total, over any period. Summing order lines in the browser would invent the figure rather than report it. The reporting calendar exists and is not the blocker.",
  },

  // ---------------------------------------------------------------- TEAM PERFORMANCE
  {
    key: "workOrdersByStatus",
    section: SECTION.TEAM_PERFORMANCE,
    label: "Work orders by status",
    census: "SV-1",
    needs: isOperationsViewer,
    // A COMPLETE count, permitted because the read is an UNBOUNDED subscription narrowed only by
    // Rules -- not a page. Stored statuses only; past-due and conflict overlap and live in Service
    // attention, which states its counts are not a total.
    state: () => MODULE_STATE.READY,
  },
  {
    key: "teamGoals",
    section: SECTION.TEAM_PERFORMANCE,
    label: "Goals for your area",
    census: "Decision #162",
    // FIRM and LOCATION goals. A viewer with neither operations scope nor a location assignment has
    // no area, so the module is absent rather than empty.
    needs: (ctx) => isOperationsViewer(ctx) || hasLocationScope(ctx),
    state: () => MODULE_STATE.READY,
  },
  {
    key: "technicianComparison",
    section: SECTION.TEAM_PERFORMANCE,
    label: "By technician",
    census: "SV-10 / T-4",
    needs: isOperationsViewer,
    // COMPOSED, AND DELIBERATELY NOT A LEADERBOARD. Rows come back in NAME order with no rank,
    // score or colour, and the quality measures the platform does not define are shown as an
    // explicit reserved absence rather than omitted -- throughput alone is not the whole of the job.
    state: () => MODULE_STATE.READY,
  },

  // ---------------------------------------------------------------- DRIVERS
  {
    key: "stockForecast",
    section: SECTION.DRIVERS,
    label: "Stock forecast",
    census: "I-5 / I-7",
    // DERIVED INFORMATION, permitted on a dashboard by Decision #161 and labelled as such by the
    // component. It may never be called On hand or Available.
    needs: (ctx) => isOperationsViewer(ctx) || hasLocationScope(ctx),
    // RECLASSIFIED after tracing the authority (#172 s2: NOT_WIRED must not hide a real gap).
    //
    // The forecast engine is real and governed, but it answers PER PART, from that part's own ledger
    // and usage history. A dashboard section has no part in hand: composing one would mean reading
    // the catalogue and every part's ledger to pick which parts to show, and any location-level
    // figure built that way would be an aggregate of derived per-part predictions -- a number with
    // no authority behind it wearing the name of a stock position. There is no governed
    // forecast-exception read to preview instead.
    state: () => MODULE_STATE.UNAVAILABLE,
    // TWO SENTENCES ON THE TILE, THE FULL REASONING IN `blocker`.
    //
    // The live dashboard gave this a paragraph, and Cost and waste avoided another. Both were exact
    // and both were too long to sit among six other modules: the screen became prose. `blocker`
    // remains the authoritative statement -- docs, tests and the North Star read it -- and
    // `displayBlocker` is what the tile shows. Neither overstates readiness.
    displayBlocker: "Forecasts are produced per part, not as a governed location total.",
    blocker:
      "Stock forecasts are produced for one part at a time, from that part's own history, and are shown on the part record where they are labelled as derived. There is no governed forecast for a whole location, and building one by adding up per-part predictions would produce a figure with no authority behind it.",
  },
  {
    key: "governedStockPosition",
    section: SECTION.DRIVERS,
    label: "On hand, reserved and available",
    census: "I-1 / I-2 / I-3 / I-4",
    needs: (ctx) => has(ctx, "inventory.balance.read"),
    state: () => MODULE_STATE.GATED,
    // CORRECTED, AND STILL BLOCKED -- for two reasons, neither of which is the one this used to give.
    //
    // "The governed balance read is not switched on for this environment yet" is wrong on its face:
    // `inventory.balance.read` IS activated in platform-sandbox, and `getPartBalance` is deployed.
    // Naming activation as the blocker sent a reader to check a box that is already ticked.
    //
    // What actually blocks it: (1) the client transport flag INVENTORY_BALANCE_READ_READY is false,
    // a deliberate separate gate whose flip needs its own authorization and its own bundle release;
    // and (2) even with it on, the governed reads answer PER PART. A section headed "on hand,
    // reserved and available" is a claim about a whole location, and totalling a page of parts into
    // one would be exactly the partial-number-under-a-complete-name failure this platform has
    // already been bitten by.
    blocker:
      "Stock balances are governed per part, and this section would state a position for a whole location — an aggregate that does not exist yet. The per-part read is also still switched off in the browser bundle, which is a separate release decision. The stock forecast above remains derived information and is not a stock position.",
  },
  {
    key: "technicianAvailability",
    section: SECTION.DRIVERS,
    label: "Technician availability",
    census: "SV-7",
    needs: isOperationsViewer,
    // COMPOSED from the Scheduling READ (both availability collections deny client reads, so this
    // is a windowed callable, not a subscription). The technicians asked about are exactly those
    // with work assigned in this viewer's governed reach -- no second scope model. A technician with
    // NO recorded schedule is shown as unrecorded, never as zero hours: rendering null as 0 would
    // state that someone is unavailable all day, which is a claim nobody made.
    state: () => MODULE_STATE.READY,
  },

  // ---------------------------------------------------------------- BUSINESS IMPACT
  {
    key: "accountPortfolio",
    section: SECTION.BUSINESS_IMPACT,
    label: "Account portfolio",
    census: "C-1",
    needs: (ctx) => has(ctx, "customer.record.read") || isOperationsViewer(ctx),
    state: () => MODULE_STATE.READY,
  },
  // THREE FACTS, THREE MODULES -- split from one "Booked, billed and collected" tile.
  //
  // They had one shared GATED state and one shared blocker sentence, so the least-ready fact
  // suppressed the other two: billed and collected have a governed period read with SERVER-SIDE
  // rollups today, and were being reported as unavailable because booked is not. One module cannot
  // hold three readiness states honestly, and collapsing them hid two available figures behind one
  // missing one.
  {
    key: "firmBilled",
    section: SECTION.BUSINESS_IMPACT,
    label: "Billed",
    census: "S-10",
    needs: (ctx) => has(ctx, "finance.read"),
    // COMPOSED from the server's OWN per-company, per-currency rollup. The dashboard performs no
    // money arithmetic: it renders what the server rolled up, and never adds the two operating
    // companies together (that needs an intercompany elimination rule -- FIN-BLOCK-004) nor two
    // currencies (that needs an FX policy). A truncated read is REFUSED by the server and stays
    // refused here.
    state: () => MODULE_STATE.READY,
  },
  {
    key: "firmCollected",
    section: SECTION.BUSINESS_IMPACT,
    label: "Collected",
    census: "S-11",
    needs: (ctx) => has(ctx, "finance.read"),
    // Same authority and same refusals as Billed. Booked's absence does not suppress it.
    state: () => MODULE_STATE.READY,
  },
  {
    key: "firmBooked",
    section: SECTION.BUSINESS_IMPACT,
    label: "Booked",
    census: "S-9 / S-17",
    needs: (ctx) => has(ctx, "finance.read"),
    state: () => MODULE_STATE.UNAVAILABLE,
    blocker:
      "Booked has no governed read of its own — there is nothing to total, over any period. Consolidated firm figures additionally have no elimination rule yet, so a group total would double-count business the two companies do with each other. The reporting calendar exists and is not the blocker.",
  },
  {
    key: "costImpact",
    section: SECTION.BUSINESS_IMPACT,
    label: "Cost and waste avoided",
    census: "I-15 / G-01",
    needs: (ctx) => isOperationsViewer(ctx) || hasLocationScope(ctx),
    state: () => MODULE_STATE.UNAVAILABLE,
    // CORRECTED. "No governed cost fact exists anywhere in the platform" stopped being true with
    // FIN-BLOCK-003A: an immutable acquisition-cost fact is written at receipt, on the
    // PURCHASE_ORDER_LINE_PRICE basis, with explicit company and currency.
    //
    // ACQUISITION COST IS NOT VALUATION, and the distinction is the whole reason this stays
    // unavailable. Knowing what one receipt cost does not say what stock is worth (no valuation
    // method has been chosen -- standard, average, FIFO and LIFO give different answers from the
    // same facts), what a consumed part cost (no COGS recognition point), what holding it costs
    // (no carrying rate), or what was saved by not scrapping it (waste avoided needs a prevention
    // event AND a statement of what would otherwise have happened). Each is an Owner decision, not
    // a missing query.
    displayBlocker:
      "Purchase costs are recorded, but stock valuation, carrying cost and waste avoided are not governed yet.",
    blocker:
      "Purchase costs are now recorded at receipt, but a value for stock on hand is a different question: it needs a costing method nobody has chosen yet. Carrying cost needs a holding rate, and waste avoided needs both a prevention event to count and a statement of what would otherwise have happened.",
  },

]);

/**
 * Resolve one principal's dashboard.
 *
 * @param ctx {
 *   role, employeeId, technicianId, operationalRoles, warehouseIds, hasCapability
 * } -- every field a governed fact the client already holds. There is no persona input and there
 *   must never be one.
 *
 * @returns ordered sections, each with its resolved modules. A section with no modules is OMITTED:
 *   an empty "Team performance" heading on a technician's screen would imply a team they do not have.
 */
export function composeDashboard(ctx) {
  const resolved = DASHBOARD_MODULES.filter((m) => {
    try {
      return m.needs(ctx) === true;
    } catch {
      // A malformed context removes the module rather than crashing the screen. Fail closed: the
      // dashboard shows less, never more.
      return false;
    }
  }).map((m) => ({
    key: m.key,
    section: m.section,
    label: m.label,
    census: m.census,
    state: m.state(ctx),
    blocker: m.blocker ?? null,
    // What the TILE shows. Falls back to the full blocker, so a module without a concise variant
    // is unchanged and nothing is ever left without a reason.
    displayBlocker: m.displayBlocker ?? m.blocker ?? null,
  }));

  return SECTION_ORDER.map((section) => ({
    section,
    label: SECTION_LABEL[section],
    modules: resolved.filter((m) => m.section === section),
  })).filter((s) => s.modules.length > 0);
}

/** Flat list, for callers that need to know whether one module is present without walking sections. */
export function resolvedModuleKeys(ctx) {
  return composeDashboard(ctx).flatMap((s) => s.modules.map((m) => m.key));
}

/**
 * The goal targets THIS viewer's dashboard should ask the goal read about.
 *
 * Bounded by construction and derived entirely from governed context: the viewer's own employee
 * identity, the warehouses their reorder authority already offers them (offered == accepted -- the
 * same list `listReorderWarehouseOptions` returns, which "filters by the same authority the create
 * enforces"), and the firm-scope service metrics an operations viewer can see.
 *
 * Asking is not seeing. Every target here is authorized SERVER-SIDE per target, so an over-broad ask
 * returns denials rather than data -- which is why this can be generous without being a widening.
 */
export function goalTargetsFor(ctx) {
  const targets = [];
  const employeeId = typeof ctx?.employeeId === "string" && ctx.employeeId.length > 0 ? ctx.employeeId : null;

  if (employeeId && hasTechnicianBinding(ctx)) {
    targets.push({ metricId: "technician.workOrder.completed.cumulative.count", targetScopeType: "EMPLOYEE", targetScopeId: employeeId });
    targets.push({ metricId: "technician.workOrder.open.count", targetScopeType: "EMPLOYEE", targetScopeId: employeeId });
  }

  if (isOperationsViewer(ctx)) {
    for (const metricId of [
      "service.workOrder.pastDue.count",
      "service.workOrder.readyToSchedule.count",
      "service.workOrder.schedulingConflict.count",
      "service.workOrder.partsBlocked.count",
      "crm.account.active.count",
      "purchasing.purchaseOrder.open.count",
    ]) {
      targets.push({ metricId, targetScopeType: "FIRM", targetScopeId: null });
    }
  }

  for (const warehouseId of Array.isArray(ctx?.warehouseIds) ? ctx.warehouseIds : []) {
    targets.push({ metricId: "parts.reorderRequest.open.count", targetScopeType: "LOCATION", targetScopeId: warehouseId });
    targets.push({ metricId: "receiving.purchaseOrder.receivable.count", targetScopeType: "LOCATION", targetScopeId: warehouseId });
  }

  return targets;
}
