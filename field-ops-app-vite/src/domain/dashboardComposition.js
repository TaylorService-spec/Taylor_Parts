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
  GO_TO: "GO_TO",
});

/** Render order. Fixed here so every persona's dashboard reads in the same order -- a reader who
 *  learns where "what do I need to do" lives should not have to relearn it on another screen. */
export const SECTION_ORDER = Object.freeze([
  SECTION.CURRENT_WORK,
  SECTION.PERFORMANCE,
  SECTION.TEAM_PERFORMANCE,
  SECTION.DRIVERS,
  SECTION.BUSINESS_IMPACT,
  SECTION.GO_TO,
]);

export const SECTION_LABEL = Object.freeze({
  CURRENT_WORK: "What needs you",
  PERFORMANCE: "Performance against goal",
  TEAM_PERFORMANCE: "Team performance",
  DRIVERS: "Drivers and exceptions",
  BUSINESS_IMPACT: "Business impact",
  GO_TO: "Go to",
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
    state: () => MODULE_STATE.NOT_WIRED,
    blocker:
      "Your assigned work is live on the technician screen. This dashboard does not duplicate that read.",
  },
  {
    key: "unverifiedSubmissions",
    section: SECTION.CURRENT_WORK,
    label: "Waiting to sync",
    census: "T-9",
    // Every persona that submits from a handheld, not only technicians. UNVERIFIED is a first-class
    // state and never a spinner, so it belongs where a person will act on it.
    needs: (ctx) => hasTechnicianBinding(ctx) || hasOperationalRole(ctx, "PARTS_ASSOCIATE", "WAREHOUSE_ASSOCIATE", "PARTS_MANAGER", "WAREHOUSE_MANAGER"),
    state: () => MODULE_STATE.NOT_WIRED,
    blocker:
      "Queued submissions are held per device and are shown where you made them.",
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
    state: () => MODULE_STATE.NOT_WIRED,
    blocker:
      "The reorder queue is live in the Parts workspace. This dashboard does not yet compose its counts.",
  },
  {
    key: "receivingQueue",
    section: SECTION.CURRENT_WORK,
    label: "Awaiting receipt",
    census: "W-1 / W-2 / P-6",
    needs: (ctx) => has(ctx, "inventory.stock.receive") || isOperationsViewer(ctx),
    state: () => MODULE_STATE.NOT_WIRED,
    blocker:
      "The receiving queue is live in the Receiving workspace. This dashboard does not yet compose its counts.",
  },
  {
    key: "adminDecisions",
    section: SECTION.CURRENT_WORK,
    label: "Decisions for you",
    census: "A-1 / A-2 / A-3",
    needs: (ctx) => ctx?.role === "admin",
    state: () => MODULE_STATE.NOT_WIRED,
    blocker:
      "The decision queues are live in Administration. This dashboard does not yet compose their counts.",
  },
  {
    key: "myOpportunities",
    section: SECTION.CURRENT_WORK,
    label: "My opportunities",
    census: "S-1 / S-2 / S-3",
    needs: (ctx) => has(ctx, "opportunity.read"),
    state: () => MODULE_STATE.NOT_WIRED,
    blocker:
      "Opportunities are live in the Sales workspace. This dashboard does not yet compose them.",
  },
  {
    key: "ordersRequiringAction",
    section: SECTION.CURRENT_WORK,
    label: "Orders requiring action",
    census: "S-18 / SV-15",
    // Composed only where the capability actually resolved. Not listed as GATED for everyone else:
    // a person with no sales or fulfillment function should not be told a sales surface is locked.
    needs: (ctx) => has(ctx, "fulfillment.coordinatedVisit.read"),
    state: () => MODULE_STATE.NOT_WIRED,
    blocker:
      "Fulfillment exceptions are live in the Sales Order workspace. This dashboard does not yet compose them.",
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
    state: () => MODULE_STATE.NOT_WIRED,
    blocker:
      "Your all-time record is live on the technician screen.",
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
    state: () => MODULE_STATE.GATED,
    blocker:
      "Booked dollars have no bounded read of their own yet, and no reporting period to total them over. Financial reach itself is no longer the blocker.",
  },

  // ---------------------------------------------------------------- TEAM PERFORMANCE
  {
    key: "workOrdersByStatus",
    section: SECTION.TEAM_PERFORMANCE,
    label: "Work orders by status",
    census: "SV-1",
    needs: isOperationsViewer,
    state: () => MODULE_STATE.NOT_WIRED,
    blocker:
      "The status breakdown is live in Service Operations. This dashboard does not yet compose its chart.",
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
    state: () => MODULE_STATE.NOT_WIRED,
    blocker:
      "A per-technician comparison needs completed-count and open-count reads this dashboard does not yet make.",
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
    state: () => MODULE_STATE.NOT_WIRED,
    blocker:
      "The stock forecast is live on the part record, labelled as derived. This dashboard does not yet compose it.",
  },
  {
    key: "governedStockPosition",
    section: SECTION.DRIVERS,
    label: "On hand, reserved and available",
    census: "I-1 / I-2 / I-3 / I-4",
    needs: (ctx) => has(ctx, "inventory.balance.read"),
    state: () => MODULE_STATE.GATED,
    blocker:
      "The governed balance read is not switched on for this environment yet. Until it is, the stock forecast above is derived information and is not a stock position.",
  },
  {
    key: "technicianAvailability",
    section: SECTION.DRIVERS,
    label: "Technician availability",
    census: "SV-7",
    needs: isOperationsViewer,
    state: () => MODULE_STATE.NOT_WIRED,
    blocker:
      "Recorded working hours are live in Scheduling. This dashboard does not yet compose them.",
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
  {
    key: "firmRevenue",
    section: SECTION.BUSINESS_IMPACT,
    label: "Booked, billed and collected",
    census: "S-9 / S-10 / S-11 / S-17",
    needs: (ctx) => has(ctx, "finance.read"),
    state: () => MODULE_STATE.GATED,
    blocker:
      "Booked, billed and collected are period figures, and the platform has no reporting calendar to sum them over yet. Financial reach itself is no longer the blocker.",
  },
  {
    key: "costImpact",
    section: SECTION.BUSINESS_IMPACT,
    label: "Cost and waste avoided",
    census: "I-15 / G-01",
    needs: (ctx) => isOperationsViewer(ctx) || hasLocationScope(ctx),
    state: () => MODULE_STATE.UNAVAILABLE,
    blocker:
      "No governed cost fact exists anywhere in the platform, so inventory value, carrying cost and waste avoided cannot be computed. Waste avoided additionally needs a prevention event to count and a statement of what would otherwise have happened.",
  },

  // ---------------------------------------------------------------- GO TO
  {
    key: "goTo",
    section: SECTION.GO_TO,
    label: "Go to",
    census: "X-6 / T-7 / W-11",
    needs: () => true,
    state: () => MODULE_STATE.READY,
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
