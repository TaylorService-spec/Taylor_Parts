/**
 * Sandbox PERFORMANCE STORY pack -- an operating story for the Performance Goal Authority.
 *
 * THE ONE RULE, and it is the whole point of this file:
 *
 *     SEED BUSINESS EVENTS. DO NOT SEED DASHBOARD ANSWERS.
 *
 * Nothing here writes `dashboard.*`, `booked`, `wasteSaved`, `jobsPerDay`, `attainment`,
 * `goalPercent` or any other precomputed summary. Every number a persona dashboard could ever
 * show (a completed-count, an open-reorder-count, a past-due-count) is DERIVABLE from the
 * lifecycle records this pack creates -- Work Orders, reorder requests, purchase orders, stock
 * positions -- and from nothing else. `sandboxPerformanceStory.test.mjs` enforces this by
 * scanning every record this file's pure spec produces against a forbidden-key list.
 *
 * ============================ WHAT THIS SEEDS ============================
 *
 *  1. TECHNICIAN / SERVICE STORY -- five technicians producing five genuinely different
 *     operating patterns (steady/on-time, high throughput, parts-blocked, past-due scheduled
 *     work, and a clean unremarkable lane), plus an unassigned backlog and a deliberate
 *     scheduling-conflict pair. Every Work Order is specified as an ACTION CHAIN (the sequence
 *     of transitionEngine.ts actions that produced it), never as a bare terminal status --
 *     `resolveWorkOrderActionChain` REPLAYS that chain against the real governed
 *     TRANSITIONS/ACTION_TO_STATUS/ACTION_ALLOWED_FROM tables and throws if it is not a legal
 *     walk, so a seeded status is provably one the real engine could have produced.
 *
 *  2. PARTS / INVENTORY STORY -- reorder requests across statuses at TWO warehouses (wh-main,
 *     wh-north), deliberately unequal, so a LOCATION-scoped goal has something real to measure
 *     and the two locations do not read identically.
 *
 *  3. GOALS -- created through the GOVERNED COMMANDS in performanceGoalCommands.ts, never by
 *     writing `performance_goals` directly. The authority rules (performanceGoalAuthority.ts)
 *     require the approver to differ from the author and the actor to hold the right capability
 *     AT THE GOAL'S OWN SCOPE, so this pack acts as several DISTINCT synthetic principals
 *     (general managers, a field/service manager, parts managers) rather than one. Only metrics
 *     whose `activeForGoals` is true are targeted -- the registry itself throws on the rest, and
 *     that throw is correct, not a bug to route around.
 *
 * ============================ HONEST BOUNDARIES (recorded, not faked) ============================
 *
 *  - transitionWorkOrder.ts is an `onCall` Cloud Function wrapped around getCallerContext(request)
 *    -- there is no plain exported function this Admin-SDK script could invoke without simulating
 *    an HTTPS callable request. Exactly like seedSandboxTransactional.js before it, this pack
 *    writes `fieldops_wos` documents directly rather than replaying the engine over the network --
 *    but unlike that file, it does not just assert a terminal status: `resolveWorkOrderActionChain`
 *    is the SAME transitionEngine.ts data the real callable reads, so every status/timestamp this
 *    pack writes is one the real engine's table says is reachable by that exact action sequence.
 *  - The scheduling-CONFLICT pair (wo-perf-conflict-a/b) is the one deliberate exception, and it
 *    is called out where it is built below: two governed `Schedule` calls in sequence could never
 *    produce it (the engine's own overlap guard would refuse the second), so it exists to give the
 *    `service.workOrder.schedulingConflict.count` metric something to detect at all -- the same
 *    posture as seedSandboxTransactional.js's own "R23 LOSSLESS COMPOSITION FIXTURE".
 *  - Receiving itself is NOT seeded. Two reorder requests are left ORDERED with a receivable
 *    purchase order, exactly like SBX-SCN-001 -- the receipt is the governed trusted-callable
 *    write the platform exists to exercise, and seeding it would fake the step this pack means to
 *    leave for a persona.
 *  - `purchasing.purchaseOrder.open.count` and `crm.account.active.count` are ACTIVE metrics this
 *    pack deliberately does NOT seed toward. The former reads the canonical multi-line
 *    `purchase_orders` collection (procurementService.ts), a shape this pack has not verified and
 *    will not invent; the latter is already exercised by the two Accounts in seedSandboxBaseline.js
 *    and adding more would not change what the metric demonstrates.
 *
 * ============================ SAFETY ============================
 *   - refuses `role === "production"` (config/environments.json is the authority);
 *   - refuses `taylor-parts` explicitly;
 *   - requires --projectId, no default;
 *   - deterministic ids, idempotent writes (`set(..., { merge: true })`), goal commands replay
 *     safely on a matching re-run (their own idempotencyKey/fingerprint machinery);
 *   - `--dry-run` prints what WOULD be created -- record counts by type, never a dashboard figure
 *     -- and performs no writes and no goal-command calls.
 *
 * Prerequisite: seedSandboxBaseline.js (warehouses wh-main/wh-north, parts PRT-1001.., accounts,
 * locations, equipment). This pack reuses those ids rather than inventing a second baseline, the
 * same way seedSandboxTransactional.js does.
 *
 * Usage:
 *   cd functions
 *   npm run build
 *   node scripts/seedSandboxPerformanceStory.mjs --projectId eos-platform-sandbox [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

import { TRANSITIONS, ACTION_TO_STATUS, ACTION_ALLOWED_FROM, canTransition } from "../lib/transitionEngine.js";
import { createPerformanceGoalDraft, approvePerformanceGoal } from "../lib/performance/performanceGoalCommands.js";
import { findMetric } from "../lib/performance/performanceMetricRegistry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================================
// FORBIDDEN-KEY GUARD -- the mechanical enforcement of the one rule. Exported so the pure test
// can assert it against every record the spec produces, not just the ones this file remembers to
// check by hand.
// ============================================================================================
export const FORBIDDEN_DASHBOARD_KEYS = Object.freeze([
  "dashboard", "booked", "wassaved", "wastesaved", "jobsperday", "attainment", "goalpercent",
]);

/** Recursively scans an object's keys for a forbidden dashboard-answer term (case-insensitive,
 *  substring match so `attainmentPercent` and `dashboardSummary` are caught too, not just an
 *  exact-name match). Returns the first offending path found, or null. PURE. */
export function findForbiddenDashboardKey(record, pathPrefix = "") {
  if (record === null || typeof record !== "object") return null;
  for (const [key, value] of Object.entries(record)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_DASHBOARD_KEYS.some((bad) => lower.includes(bad))) {
      return pathPrefix ? `${pathPrefix}.${key}` : key;
    }
    if (value !== null && typeof value === "object") {
      const nested = findForbiddenDashboardKey(value, pathPrefix ? `${pathPrefix}.${key}` : key);
      if (nested) return nested;
    }
  }
  return null;
}

// ============================================================================================
// CLI / safety guard -- same shape and same reasoning as seedSandboxBaseline.js /
// seedSandboxTransactional.js, deliberately not factored into a shared module (no
// shared/monorepo tooling exists in this repo -- see environmentCapabilityOverrides.ts's own note).
// ============================================================================================
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      out[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "true";
    }
  }
  return out;
}

function assertNonProductionTarget(projectId) {
  if (!projectId || projectId === "true") {
    throw new Error("--projectId is required. There is no default target.");
  }
  if (projectId === "taylor-parts") {
    throw new Error("REFUSING: taylor-parts is the customer production project.");
  }
  const registryPath = path.resolve(__dirname, "../../config/environments.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const env = registry.environments.find((e) => e.firebase && e.firebase.projectId === projectId);
  if (!env) {
    throw new Error(
      `REFUSING: '${projectId}' is not a known provisioned environment in config/environments.json. Unknown projects fail closed.`,
    );
  }
  if (env.role === "production") {
    throw new Error(`REFUSING: environment '${env.id}' has role 'production'.`);
  }
  return env;
}

// ============================================================================================
// PURE ACTION-CHAIN RESOLUTION -- proves a seeded Work Order status is one the real engine's
// table could have produced. Reuses transitionEngine.ts's own TRANSITIONS/ACTION_TO_STATUS/
// ACTION_ALLOWED_FROM rather than re-declaring a second, driftable copy of the state machine.
//
// "Schedule" and "Dispatch" get special handling because transitionEngine.ts deliberately excludes
// them from ACTION_TIMESTAMP_FIELD (see that file's own comment): Schedule writes caller-chosen
// PLANNING fields, not a serverTimestamp "this happened now"; Dispatch additionally sets
// assignedTechId, the technician actually being sent, alongside its dispatchedAt execution stamp.
// ============================================================================================
export function resolveWorkOrderActionChain(actionChain, { technicianId, scheduledStartMillis, scheduledEndMillis } = {}) {
  let status = "CREATED";
  const fields = {};
  for (const action of actionChain) {
    const allowedFrom = ACTION_ALLOWED_FROM[action];
    if (allowedFrom && !allowedFrom.includes(status)) {
      throw new Error(`illegal action "${action}" from status "${status}" -- not in ACTION_ALLOWED_FROM`);
    }
    const nextStatus = ACTION_TO_STATUS[action];
    if (!nextStatus) throw new Error(`unknown action "${action}"`);
    if (!canTransition(status, nextStatus)) {
      throw new Error(`illegal transition ${status} -> ${nextStatus} via "${action}" -- not in TRANSITIONS`);
    }
    status = nextStatus;
    if (action === "Schedule") {
      if (!technicianId || scheduledStartMillis == null || scheduledEndMillis == null) {
        throw new Error(`"Schedule" requires technicianId, scheduledStartMillis and scheduledEndMillis`);
      }
      fields.scheduledTechId = technicianId;
      fields.scheduledStartMillis = scheduledStartMillis;
      fields.scheduledEndMillis = scheduledEndMillis;
    } else if (action === "Dispatch") {
      if (!technicianId) throw new Error(`"Dispatch" requires technicianId`);
      fields.assignedTechId = technicianId;
      fields.reachedTimestamps = [...(fields.reachedTimestamps ?? []), "dispatchedAt"];
    } else {
      const tsField = ({
        Accept: "acceptedAt", Travel: "enRouteAt", Arrive: "arrivedAt",
        WorkStart: "workStartedAt", Complete: "completedAt", Close: "closedAt", Cancel: "closedAt",
      })[action];
      if (tsField) fields.reachedTimestamps = [...(fields.reachedTimestamps ?? []), tsField];
    }
  }
  return { status, fields: { reachedTimestamps: [], ...fields } };
}

// ============================================================================================
// THE PURE SCENARIO SPEC. No Firestore, no clock read (a `nowMillis` is supplied, exactly like
// sandboxDispatchFixtures.js's own window builders), no randomness. This is what
// sandboxPerformanceStory.test.mjs imports and exercises directly.
// ============================================================================================
const DAY_MS = 24 * 60 * 60 * 1000;

export function buildScenarioSpec({ nowMillis }) {
  if (typeof nowMillis !== "number" || !Number.isFinite(nowMillis)) {
    throw new Error("buildScenarioSpec requires a numeric nowMillis");
  }

  // --- authority principals -------------------------------------------------------------
  // Distinct synthetic actors so authorship and approval are genuinely different principals, not
  // the same uid wearing two hats. Scope choices mirror what each Role's own governed binding
  // requires (see governedBusinessRoles.ts): generalManager and fieldManager grants are
  // unrestricted (a global assignment reaches any target scope); partsManager's
  // reorder.request.create.manual -- and therefore its goal reach over a LOCATION metric whose
  // actual it doesn't own without that capability -- is restricted to LOCATION-scoped assignments
  // by that Role's own scopesByPermission, so PM-A/PM-B are granted at wh-main specifically rather
  // than globally.
  const principals = [
    { uid: "perfstory-gm-a", roleId: "generalManager", scope: { type: "global" } },
    { uid: "perfstory-gm-b", roleId: "generalManager", scope: { type: "global" } },
    { uid: "perfstory-fm-a", roleId: "fieldManager", scope: { type: "global" } },
    { uid: "perfstory-pm-a", roleId: "partsManager", scope: { type: "location", value: "wh-main" } },
    { uid: "perfstory-pm-b", roleId: "partsManager", scope: { type: "location", value: "wh-main" } },
  ];

  // --- technicians -----------------------------------------------------------------------
  // Five technicians, five different operating patterns. Alpha and Bravo are additionally GOAL
  // SUBJECTS (their employeeId doubles as their technicianId, exactly the identity mapping
  // seedSandboxTransactional.js records as a real gap it had to close for sbx-tech). Charlie,
  // Delta and Echo are dispatch targets only -- no goal is authored against them, which is part of
  // the deliberate spread (not every technician has a target set).
  const technicians = [
    { technicianId: "perfstory-tech-alpha", uid: "perfstory-tech-alpha-uid", employeeId: "perfstory-tech-alpha", name: "Alpha (steady)", isGoalSubject: true },
    { technicianId: "perfstory-tech-bravo", uid: "perfstory-tech-bravo-uid", employeeId: "perfstory-tech-bravo", name: "Bravo (high throughput)", isGoalSubject: true },
    { technicianId: "perfstory-tech-charlie", uid: null, employeeId: null, name: "Charlie (parts-blocked)", isGoalSubject: false },
    { technicianId: "perfstory-tech-delta", uid: null, employeeId: null, name: "Delta (past-due scheduled work)", isGoalSubject: false },
    { technicianId: "perfstory-tech-echo", uid: null, employeeId: null, name: "Echo (clean)", isGoalSubject: false },
  ];

  // Baseline entities this pack reuses rather than duplicating (see seedSandboxBaseline.js).
  const SITES = [
    { customerId: "acct-harbor", locationId: "loc-harbor-downtown", equipmentId: "eq-ice-001" },
    { customerId: "acct-harbor", locationId: "loc-harbor-airport", equipmentId: "eq-ice-002" },
    { customerId: "acct-summit", locationId: "loc-summit-flag", equipmentId: "eq-cool-001" },
  ];
  const site = (n) => SITES[n % SITES.length];

  const woBase = (id, n, over) => ({
    id, woNumber: `WO-PERF-${String(n).padStart(3, "0")}`, priority: 2, type: "SERVICE",
    scenarioId: "SBX-PERFSTORY-001", ...site(n), ...over,
  });

  const workOrders = [
    // ALPHA -- steady, on-time completions. Two full lifecycles, MarkReady through Complete.
    woBase("wo-perf-alpha-001", 1, { technicianId: "perfstory-tech-alpha", complaint: "Routine filter service.", actionChain: ["MarkReady", "Schedule", "Dispatch", "Accept", "Travel", "Arrive", "WorkStart", "Complete"], scheduledStartMillis: nowMillis - 6 * DAY_MS, scheduledEndMillis: nowMillis - 6 * DAY_MS + 2 * 3600_000 }),
    woBase("wo-perf-alpha-002", 2, { technicianId: "perfstory-tech-alpha", complaint: "Compressor relay check.", actionChain: ["MarkReady", "Schedule", "Dispatch", "Accept", "Travel", "Arrive", "WorkStart", "Complete"], scheduledStartMillis: nowMillis - 3 * DAY_MS, scheduledEndMillis: nowMillis - 3 * DAY_MS + 2 * 3600_000 }),

    // BRAVO -- higher throughput. Five completions, same lifecycle shape, more of them.
    ...[1, 2, 3, 4, 5].map((k) =>
      woBase(`wo-perf-bravo-${String(k).padStart(3, "0")}`, 10 + k, {
        technicianId: "perfstory-tech-bravo", complaint: `Scheduled maintenance visit ${k}.`,
        actionChain: ["MarkReady", "Schedule", "Dispatch", "Accept", "Travel", "Arrive", "WorkStart", "Complete"],
        scheduledStartMillis: nowMillis - (10 - k) * DAY_MS, scheduledEndMillis: nowMillis - (10 - k) * DAY_MS + 90 * 60_000,
      }),
    ),

    // CHARLIE -- parts-blocked. Stops at ARRIVED: on site, diagnosis started, and the plan needs
    // PRT-1001, which this pack seeds as SHORT (0 on hand) at wh-main below. This is the SAME
    // honest boundary SBX-SCN-001 draws for its own canonical shortage case (wo-sbx-001): the
    // technician has not started work because the part is not there, and nothing here fakes a
    // WorkStart/Complete that never happened.
    woBase("wo-perf-charlie-001", 20, {
      technicianId: "perfstory-tech-charlie", complaint: "Ice machine down; evaporator fan suspected.",
      requiredPartId: "PRT-1001",
      inventorySnapshot: [{ partId: "PRT-1001", sku: "PRT-1001", qtyPlanned: 1, qtyUsed: 0 }],
      actionChain: ["MarkReady", "Schedule", "Dispatch", "Accept", "Travel", "Arrive"],
      scheduledStartMillis: nowMillis - 2 * DAY_MS, scheduledEndMillis: nowMillis - 2 * DAY_MS + 3600_000,
    }),

    // DELTA -- past-due scheduled work. Stops at SCHEDULED, with a window already in the past.
    // service.workOrder.pastDue.count's own actualAuthority names scheduledStart as the sole date
    // authority, applied globally rather than week-bound -- exactly what this record gives it.
    woBase("wo-perf-delta-001", 30, {
      technicianId: "perfstory-tech-delta", complaint: "Walk-in cooler running warm.",
      actionChain: ["MarkReady", "Schedule"],
      scheduledStartMillis: nowMillis - 2 * DAY_MS, scheduledEndMillis: nowMillis - 2 * DAY_MS + 3600_000,
    }),

    // ECHO -- clean, unremarkable. One dispatched job, nothing anomalous.
    woBase("wo-perf-echo-001", 40, {
      technicianId: "perfstory-tech-echo", complaint: "Noisy prep unit, routine callout.",
      actionChain: ["MarkReady", "Schedule", "Dispatch"],
      scheduledStartMillis: nowMillis + DAY_MS, scheduledEndMillis: nowMillis + DAY_MS + 3600_000,
    }),

    // SCHEDULING CONFLICT PAIR -- see the file header's "HONEST BOUNDARIES" note. Two SCHEDULED
    // Work Orders for Echo with OVERLAPPING windows on the same day. No sequence of two governed
    // Schedule calls could legitimately produce this (the engine's own double-booking/overlap
    // guard, enforced in transitionWorkOrder.ts, would refuse the second) -- it exists purely so
    // service.workOrder.schedulingConflict.count has a real overlap to detect, the same posture as
    // SBX-SCN-001's own R23 windowless-scheduling fixture.
    woBase("wo-perf-conflict-a", 41, {
      technicianId: "perfstory-tech-echo", complaint: "Conflict fixture A -- see file header.",
      actionChain: ["MarkReady", "Schedule"],
      scheduledStartMillis: nowMillis + 2 * DAY_MS, scheduledEndMillis: nowMillis + 2 * DAY_MS + 2 * 3600_000,
    }),
    woBase("wo-perf-conflict-b", 42, {
      technicianId: "perfstory-tech-echo", complaint: "Conflict fixture B -- see file header.",
      actionChain: ["MarkReady", "Schedule"],
      scheduledStartMillis: nowMillis + 2 * DAY_MS + 3600_000, scheduledEndMillis: nowMillis + 2 * DAY_MS + 3 * 3600_000,
    }),

    // UNASSIGNED BACKLOG -- ready to schedule, nobody assigned yet. Feeds
    // service.workOrder.readyToSchedule.count.
    woBase("wo-perf-backlog-001", 50, { technicianId: null, complaint: "New service request, awaiting scheduling.", actionChain: ["MarkReady"] }),
    woBase("wo-perf-backlog-002", 51, { technicianId: null, complaint: "New service request, awaiting scheduling.", actionChain: ["MarkReady"] }),
  ];

  // --- parts / inventory story: two warehouses, deliberately unequal ---------------------
  // wh-main is the busier, worse-performing location (three open requests, two of them ORDERED
  // and therefore receivable); wh-north is lean (one open request). PRT-1001's shortage at
  // wh-main is what drives Charlie's parts-blocked Work Order above -- one shortage, two honest
  // consequences, not two unrelated fixtures.
  const stock = [
    { warehouseId: "wh-main", partId: "PRT-1001", qty: 0, note: "SHORTAGE -- drives wo-perf-charlie-001" },
    { warehouseId: "wh-main", partId: "PRT-1003", qty: 4, note: "low stock" },
    { warehouseId: "wh-main", partId: "PRT-1006", qty: 30, note: "healthy stock" },
    { warehouseId: "wh-north", partId: "PRT-1004", qty: 25, note: "healthy stock" },
    { warehouseId: "wh-north", partId: "PRT-1005", qty: 2, note: "low stock" },
  ];

  const reorderRequests = [
    { id: "ro-perf-001", warehouseId: "wh-main", partId: "PRT-1001", status: "ORDERED", urgency: "HIGH", recommendedQty: 4, requestedQty: 4 },
    { id: "ro-perf-002", warehouseId: "wh-main", partId: "PRT-1003", status: "ORDERED", urgency: "MEDIUM", recommendedQty: 6, requestedQty: 6 },
    { id: "ro-perf-003", warehouseId: "wh-main", partId: "PRT-1006", status: "PENDING_REVIEW", urgency: "LOW", recommendedQty: 8, requestedQty: 8 },
    { id: "ro-perf-004", warehouseId: "wh-main", partId: "PRT-1002", status: "REJECTED", urgency: "LOW", recommendedQty: 2, requestedQty: 2 },
    { id: "ro-perf-005", warehouseId: "wh-north", partId: "PRT-1004", status: "ORDERED", urgency: "MEDIUM", recommendedQty: 5, requestedQty: 5 },
    { id: "ro-perf-006", warehouseId: "wh-north", partId: "PRT-1005", status: "REJECTED", urgency: "LOW", recommendedQty: 3, requestedQty: 3 },
  ];

  // Purchase orders for every ORDERED request -- the receiving candidates, receipt deliberately
  // NOT seeded (see file header).
  const purchaseOrders = reorderRequests
    .filter((r) => r.status === "ORDERED")
    .map((r, i) => ({
      reorderRequestId: r.id, externalPoNumber: `po-perf-${String(i + 1).padStart(3, "0")}`,
      partId: r.partId, supplierId: r.partId === "PRT-1005" ? "sup-arcticparts" : "sup-arcticparts",
      orderedQuantity: r.requestedQty, status: "ORDERED",
    }));

  // --- goals, through the governed commands only --------------------------------------------
  // A deliberate SPREAD: two goals meeting/near target, three sitting on the wrong side of theirs,
  // and several ACTIVE metrics (technician.workOrder.open.count, service.workOrder.readyToSchedule.count,
  // service.workOrder.schedulingConflict.count, receiving.purchaseOrder.receivable.count, and the
  // wh-north parts.reorderRequest.open.count scope) with NO goal authored at all. "The sandbox
  // should not make everybody green" -- so it doesn't.
  const goals = [
    {
      goalId: "pg-firm-partsblocked", metricId: "service.workOrder.partsBlocked.count",
      targetScopeType: "FIRM", targetScopeId: null, targetValue: 0, unit: "COUNT", direction: "AT_MOST",
      authorUid: "perfstory-gm-a", approverUid: "perfstory-gm-b",
      reason: "Firm target: no Work Order should ever sit blocked on parts.",
    },
    {
      goalId: "pg-firm-pastdue", metricId: "service.workOrder.pastDue.count",
      targetScopeType: "FIRM", targetScopeId: null, targetValue: 2, unit: "COUNT", direction: "AT_MOST",
      authorUid: "perfstory-gm-a", approverUid: "perfstory-gm-b",
      reason: "Firm target: at most two scheduled jobs past due at any time.",
    },
    {
      goalId: "pg-emp-alpha-completed", metricId: "technician.workOrder.completed.cumulative.count",
      targetScopeType: "EMPLOYEE", targetScopeId: "perfstory-tech-alpha", targetValue: 10, unit: "COUNT", direction: "AT_LEAST",
      authorUid: "perfstory-fm-a", approverUid: "perfstory-gm-b",
      reason: "Service Manager's target for Alpha's all-time completed count.",
    },
    {
      goalId: "pg-emp-bravo-completed", metricId: "technician.workOrder.completed.cumulative.count",
      targetScopeType: "EMPLOYEE", targetScopeId: "perfstory-tech-bravo", targetValue: 5, unit: "COUNT", direction: "AT_LEAST",
      authorUid: "perfstory-fm-a", approverUid: "perfstory-gm-b",
      reason: "Service Manager's target for Bravo's all-time completed count.",
    },
    {
      goalId: "pg-loc-whmain-reorderopen", metricId: "parts.reorderRequest.open.count",
      targetScopeType: "LOCATION", targetScopeId: "wh-main", targetValue: 2, unit: "COUNT", direction: "AT_MOST",
      authorUid: "perfstory-pm-a", approverUid: "perfstory-pm-b",
      reason: "Parts Manager's target: keep wh-main's open reorder queue at two or fewer.",
    },
  ].map((g) => ({ effectiveFrom: "2026-01-01", effectiveTo: null, ...g }));

  return { principals, technicians, workOrders, stock, reorderRequests, purchaseOrders, goals };
}

// ============================================================================================
// IO -- Firestore writes and governed goal-command calls. Kept apart from the pure spec above,
// matching sandboxDispatchFixtures.js's own "pure planning, separate IO" split.
// ============================================================================================
async function applyScenario(db, spec, { dryRun }) {
  const now = Timestamp.now();
  const by = "sandbox-performance-story-seed";
  const counts = {};
  const bump = (k, n = 1) => { counts[k] = (counts[k] || 0) + n; };
  const set = async (collection, id, data) => {
    bump(collection);
    if (dryRun) return;
    await db.collection(collection).doc(id).set(data, { merge: true });
  };

  // --- principals (users + roleAssignments) -----------------------------------------------
  // Written directly rather than through trustedWriterCommands.grantRole: that command's own
  // two-person control and admin-bootstrap requirements are a real, separate authority this
  // privileged, sandbox-only seed pack does not stand up. This is the same posture
  // seedSandboxTransactional.js takes for technician_working_availability -- writing the EXACT
  // shape the governed writer would have produced, deliberately outside its own machinery,
  // because that machinery is not what a deterministic fixture pack is for.
  for (const p of spec.principals) {
    await set("users", p.uid, { createdAt: now, createdBy: by, updatedAt: now });
    await set("roleAssignments", `${p.uid}__${p.roleId}`, {
      id: `${p.uid}__${p.roleId}`, principalUid: p.uid, roleId: p.roleId, scope: p.scope,
      grantedBy: by, grantedAt: now, status: "active", accessVersionAtGrant: 0,
    });
  }

  // --- technicians (dispatch targets + goal-subject identity mapping) ----------------------
  for (const t of spec.technicians) {
    await set("fieldops_technicians", t.technicianId, {
      name: t.name, status: "available", skills: ["refrigeration", "ice-machines"],
      userId: t.uid, createdAt: now, updatedAt: now, updatedBy: by,
    });
    if (t.isGoalSubject) {
      // Same identity-mapping gap seedSandboxTransactional.js records for sbx-tech: the goal
      // authority resolves an EMPLOYEE scope through users/{uid}.employeeId, and a technician
      // dashboard resolves an actual through users/{uid}.technicianId -- both must be present for
      // the goal and the Work Orders below to be talking about the SAME person.
      await set("users", t.uid, { employeeId: t.employeeId, technicianId: t.technicianId, createdAt: now, updatedAt: now });
      await set("roleAssignments", `${t.uid}__technician`, {
        id: `${t.uid}__technician`, principalUid: t.uid, roleId: "technician",
        scope: { type: "global" }, grantedBy: by, grantedAt: now, status: "active", accessVersionAtGrant: 0,
      });
    }
  }

  // --- work orders: replay each action chain, write only the fields it actually reached ----
  for (const wo of spec.workOrders) {
    const { status, fields } = resolveWorkOrderActionChain(wo.actionChain, {
      technicianId: wo.technicianId ?? undefined,
      scheduledStartMillis: wo.scheduledStartMillis, scheduledEndMillis: wo.scheduledEndMillis,
    });
    const doc = {
      woNumber: wo.woNumber, priority: wo.priority, type: wo.type, scenarioId: wo.scenarioId,
      complaint: wo.complaint, customerId: wo.customerId, locationId: wo.locationId, equipmentId: wo.equipmentId,
      status, createdAt: now, updatedAt: now,
      requiredPartId: wo.requiredPartId ?? null, inventorySnapshot: wo.inventorySnapshot ?? null,
    };
    if (fields.scheduledTechId) {
      doc.scheduledTechId = fields.scheduledTechId;
      doc.scheduledStart = Timestamp.fromMillis(fields.scheduledStartMillis);
      doc.scheduledEnd = Timestamp.fromMillis(fields.scheduledEndMillis);
    }
    if (fields.assignedTechId) doc.assignedTechId = fields.assignedTechId;
    for (const tsField of fields.reachedTimestamps) doc[tsField] = now;
    await set("fieldops_wos", wo.id, doc);
  }

  // --- inventory position ------------------------------------------------------------------
  for (const s of spec.stock) {
    await set("stock_locations", `${s.warehouseId}__${s.partId}`, {
      warehouseId: s.warehouseId, partId: s.partId, quantityOnHand: s.qty,
      note: s.note, scenarioId: "SBX-PERFSTORY-001", updatedAt: now, updatedBy: by,
    });
  }

  // --- reorder requests (canonical shape -- every governed key present) --------------------
  for (const r of spec.reorderRequests) {
    await set("reorder_requests", r.id, {
      partId: r.partId, recommendationStatus: "RECOMMENDED", urgency: r.urgency, quantitySource: "RECOMMENDED",
      recommendedQty: r.recommendedQty, requestedQty: r.requestedQty, status: r.status, currentOwner: null,
      requestedBy: by, createdAt: now,
      reviewedBy: r.status === "REJECTED" || r.status === "ORDERED" ? "perfstory-pm-a" : null,
      reviewedAt: r.status === "REJECTED" || r.status === "ORDERED" ? now : null,
      reviewDecision: r.status === "REJECTED" ? "REJECTED" : r.status === "ORDERED" ? "APPROVED" : null,
      reviewNotes: null, assignedToUserId: null, assignedBy: null, assignedAt: null,
      purchasingStartedAt: null, purchasingStartedBy: null, purchasingNotes: null, vendorContacted: r.status === "ORDERED" ? true : null,
      expectedAvailabilityDate: null, lastPurchasingUpdateAt: null, lastPurchasingUpdateBy: null,
      // Must equal the reorder request id (receiveInventoryStockCommand.ts's coherence rule),
      // same as SBX-SCN-001's own reorder requests.
      purchaseOrderId: r.status === "ORDERED" ? r.id : null,
      orderedBy: r.status === "ORDERED" ? by : null, orderedAt: r.status === "ORDERED" ? now : null,
      receivedBy: null, receivedAt: null, cancelledBy: null, cancelledAt: null, cancellationReason: null,
      voidedBy: null, voidedAt: null, voidReason: null,
      // Not a canonical reorder-request key -- carried so the LOCATION-scoped goal and the stock
      // story above resolve against the same warehouse without a second lookup.
      warehouseId: r.warehouseId,
    });
  }
  for (const po of spec.purchaseOrders) {
    await set("reorder_purchase_orders", po.reorderRequestId, {
      reorderRequestId: po.reorderRequestId, externalPoNumber: po.externalPoNumber, purchaseOrderId: po.reorderRequestId,
      partId: po.partId, supplierId: po.supplierId, orderedQuantity: po.orderedQuantity, status: po.status,
      scenarioId: "SBX-PERFSTORY-001", recordedBy: by, recordedAt: now, createdAt: now, updatedAt: now,
    });
  }

  // --- goals, through createPerformanceGoalDraft / approvePerformanceGoal only -------------
  for (const g of spec.goals) {
    bump("performanceGoalsDrafted");
    bump("performanceGoalsApproved");
    if (dryRun) continue;
    await createPerformanceGoalDraft(
      {
        actorUid: g.authorUid, idempotencyKey: `perfstory-draft-${g.goalId}`, goalId: g.goalId,
        metricId: g.metricId, targetScopeType: g.targetScopeType, targetScopeId: g.targetScopeId,
        targetValue: g.targetValue, unit: g.unit, direction: g.direction,
        effectiveFrom: g.effectiveFrom, effectiveTo: g.effectiveTo,
      },
      { db },
    );
    await approvePerformanceGoal(
      { actorUid: g.approverUid, idempotencyKey: `perfstory-approve-${g.goalId}`, goalId: g.goalId, reason: g.reason },
      { db },
    );
  }

  return counts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args["dry-run"] === "true";
  let env;
  try {
    env = assertNonProductionTarget(args.projectId);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }
  console.log(`Seeding SBX-PERFSTORY-001 into '${env.id}' (${args.projectId}, role=${env.role})${dryRun ? " [DRY RUN]" : ""}`);

  // Every ACTIVE-for-goals metric this pack targets is gated `active:false` in the permission
  // catalog and lifted only per-environment (environmentCapabilityOverrides.ts). Set BEFORE any
  // goal-command call -- resolveRuntimeCapabilityOverrides() caches on first read.
  process.env.GCLOUD_PROJECT = args.projectId;

  initializeApp({ credential: applicationDefault(), projectId: args.projectId });
  const db = getFirestore();

  const spec = buildScenarioSpec({ nowMillis: Date.now() });
  const counts = await applyScenario(db, spec, { dryRun });

  console.log(`${dryRun ? "Would create" : "Created"}:`, JSON.stringify(counts));
  console.log("Receiving-ready candidates: ro-perf-001, ro-perf-002 (wh-main), ro-perf-005 (wh-north).");
  console.log("The receipt itself is NOT seeded -- it is the governed write this pack leaves for a persona.");
}

// Guard main() so this module can be `import`ed for its pure functions (as the test does)
// without running the seeder itself.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error("Seed failed:", err && err.message ? err.message : err);
    process.exitCode = 1;
  });
}
