#!/usr/bin/env node
// SERVICE DISPATCH FIXTURE (lane SVC, UAT-R2) -- NONPROD-ONLY operator script. The controller runs it; Claude and Codex do not.
//
// WHAT IT BUILDS: ONE new Taylor SYNTHETIC-UAT-R2 Work Order, taken through the REAL governed commands to SCHEDULED for the synthetic
// technician (synthetic-np-emp-service-technician-a). SCHEDULED is the dispatch-ready state: the next governed edge is DISPATCH, which this
// script deliberately LEAVES to Codex. It never touches WO-2026-000081 (Codex's frozen data): it takes no Work Order id as input.
//
// THE GOVERNED PATH (source: functions/src/eosOps/workOrderLifecycle.ts TRANSITION_MATRIX, workOrderScheduling.ts, workOrderOperations.ts).
// Route /operations/work-orders unless noted. Persona keys are the 16 governed nonprod personas.
//   BUILT HERE (as dispatcher; serviceManager holds the same capabilities and is equally legitimate):
//     D1 createAccount            /crm/customer   customer.record.create             new SYNTHETIC Account (owner = the dispatcher Employee)
//     D2 createAccountLocation    /crm/customer   customer.record.create             its site
//     D3 createWorkOrder          workOrder.create + company authority (taylor)      -> CREATED
//     D4 markWorkOrderReady       workOrder.lifecycle.ready                          CREATED -> READY_TO_DISPATCH
//     D5 scheduleWorkOrder        workOrder.lifecycle.schedule                       READY_TO_DISPATCH -> SCHEDULED, window + assignee (technician-a)
//   LEFT FOR CODEX (the acceptance path):
//     dispatchWorkOrder           workOrder.lifecycle.dispatch (dispatcher | serviceManager)      SCHEDULED -> DISPATCHED
//     acceptWorkOrder             workOrder.transition + OWN assignment (serviceTechnician)       DISPATCHED -> ACCEPTED
//     startWorkOrderTravel        same                                                            ACCEPTED -> EN_ROUTE
//     arriveAtWorkOrder           same                                                            EN_ROUTE -> ARRIVED
//     startWorkOrderWork          same                                                            ARRIVED -> WORK_IN_PROGRESS
//     recordWorkOrderExecution    workOrder.execution.record + OWN assignment ({workOrderId, note, idempotencyKey}; no parts, no truck stock)
//     completeWorkOrder           workOrder.lifecycle.complete + OWN assignment                   WORK_IN_PROGRESS -> COMPLETED (no Sales Order: no fulfillment)
//     closeWorkOrder              workOrder.lifecycle.close (dispatcher | serviceManager)         COMPLETED -> CLOSED (optional)
//   Company boundary (DWO / PR #2200): every office command (create, ready, schedule, dispatch, close) needs the caller's operating-company
//   authority to reach the Work Order's company (taylor: the dispatcher's home company); a foreign Work Order reads as NOT FOUND. The field
//   edges (accept .. complete, execution) reach the Work Order through the technician's OPEN assignment alone.
//
// SAFETY (all enforced before any request is sent):
//   - DRY RUN by default: OFFLINE, sends nothing, needs no credential. --preview READS; --apply WRITES. Never both.
//   - The target must be the registered nonprod platform-sandbox EOS API (scripts/eosPersonaSession.mjs resolveEosTarget: exact match against
//     config/environments.json, production and unregistered URLs refused). An EOS_API_BASE_URL that differs is refused.
//   - Every text field carries "SYNTHETIC-UAT-R2"; every idempotency key starts "synthetic-uat-r2-svc-". Re-running is idempotent and resumes
//     from the Work Order's CURRENT status. It never forces a transition, writes no SQL, creates no grant, role or credential.
//   - If the Work Order is already past SCHEDULED (Codex dispatched it) the script STOPS and reports; it never rewinds.
//   - Output is one JSON line per step: step, outcome, code. No token, credential, header or request body is printed.
//
// Usage (repository root):
//   node docs/uat/tools/service-dispatch-fixture.mjs                                              # dry run: OFFLINE plan
//   EOS_PERSONA_ISSUER_CREDENTIAL=<set by the operator> node docs/uat/tools/service-dispatch-fixture.mjs --preview   # READ-ONLY: persona capability check
//   EOS_PERSONA_ISSUER_CREDENTIAL=<set by the operator> node docs/uat/tools/service-dispatch-fixture.mjs --apply [--day-offset 2]
// Exit: 0 = planned / previewed / applied / already present; 2 = refused, blocked or unsafe.
import { pathToFileURL } from "node:url";
import { resolveEosTarget, callEosApiAsPersona } from "../../../scripts/eosPersonaSession.mjs";

export const MARKER = "SYNTHETIC-UAT-R2";
const KEY = "synthetic-uat-r2-svc-";
const OFFICE = "dispatcher";
const TECH_PERSONA = "serviceTechnician";
const TECH_EMPLOYEE = "synthetic-np-emp-service-technician-a";
const OWNER_EMPLOYEE = "synthetic-np-emp-dispatcher";
const COMPANY = "taylor";
const WO = "/operations/work-orders";
const CRM = "/crm/customer";
const MAX_WINDOW_TRIES = 8;

// Capabilities each persona must hold (readMyWorkOrderCapabilities, read-only). Source: role-capability-grants.csv.
export const NEEDS = {
  [OFFICE]: ["workOrder.create", "workOrder.lifecycle.ready", "workOrder.lifecycle.schedule", "workOrder.lifecycle.dispatch", "workOrder.record.read"],
  [TECH_PERSONA]: ["workOrder.transition", "workOrder.execution.record", "workOrder.lifecycle.complete", "workOrder.record.read"],
};

export const PLAN = [
  { step: "D1", operation: "createAccount", route: CRM, persona: OFFICE, capability: "customer.record.create", effect: "new SYNTHETIC Account" },
  { step: "D2", operation: "createAccountLocation", route: CRM, persona: OFFICE, capability: "customer.record.create", effect: "its site" },
  { step: "D3", operation: "createWorkOrder", route: WO, persona: OFFICE, capability: "workOrder.create", effect: "-> CREATED (company taylor)" },
  { step: "D4", operation: "markWorkOrderReady", route: WO, persona: OFFICE, capability: "workOrder.lifecycle.ready", effect: "CREATED -> READY_TO_DISPATCH" },
  { step: "D5", operation: "scheduleWorkOrder", route: WO, persona: OFFICE, capability: "workOrder.lifecycle.schedule", effect: `READY_TO_DISPATCH -> SCHEDULED, assignee ${TECH_EMPLOYEE}` },
];
export const LEFT_FOR_CODEX = [
  "dispatchWorkOrder (dispatcher|serviceManager, workOrder.lifecycle.dispatch): SCHEDULED -> DISPATCHED",
  "acceptWorkOrder / startWorkOrderTravel / arriveAtWorkOrder / startWorkOrderWork (serviceTechnician, workOrder.transition + own assignment): -> WORK_IN_PROGRESS",
  "recordWorkOrderExecution (serviceTechnician, workOrder.execution.record + own assignment; note only)",
  "completeWorkOrder (serviceTechnician, workOrder.lifecycle.complete + own assignment): WORK_IN_PROGRESS -> COMPLETED",
  "closeWorkOrder (dispatcher|serviceManager, workOrder.lifecycle.close): COMPLETED -> CLOSED (optional)",
];

/** @returns {Promise<number>} the exit code. `deps.callAs(persona, route, payload)` is injectable for offline tests. */
export async function run({ argv = [], env = process.env, callAs, now = () => new Date(), out = (o) => console.log(JSON.stringify(o)) } = {}) {
  const flag = (n) => argv.includes("--" + n);
  const val = (n) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : undefined; };
  const stop = (code, message) => { out({ outcome: "STOPPED", code, message }); return 2; };
  const APPLY = flag("apply");
  const PREVIEW = flag("preview");
  if (APPLY && PREVIEW) return stop("MODE_CONFLICT", "--apply and --preview are exclusive");
  const dayOffset = val("day-offset") === undefined ? 2 : Number(val("day-offset"));
  if (!Number.isInteger(dayOffset) || dayOffset < 1 || dayOffset > 30) return stop("DAY_OFFSET_INVALID", "--day-offset is a whole number of days, 1..30");

  // TARGET FENCE: the harness's own exact-match validator (production and unregistered URLs refused) before anything else.
  let base;
  try { base = resolveEosTarget({ env, environmentId: "platform-sandbox" }).base; } catch (e) { return stop(e?.code ?? "TARGET_REFUSED", "target is not the registered nonprod platform-sandbox EOS API"); }

  if (!APPLY && !PREVIEW) {
    out({ mode: "DRY_RUN", target: base, offline: true, marker: MARKER, note: "nothing is sent and no credential is read; --preview reads, --apply writes" });
    for (const p of PLAN) out({ step: p.step, outcome: "PLANNED", persona: p.persona, route: p.route, operation: p.operation, capability: p.capability, effect: p.effect });
    out({ leftForCodex: LEFT_FOR_CODEX, untouched: "WO-2026-000081 (Codex's frozen data; this tool takes no Work Order id)" });
    return 0;
  }
  if (!env.EOS_PERSONA_ISSUER_CREDENTIAL) return stop("NO_ISSUER_CREDENTIAL", "EOS_PERSONA_ISSUER_CREDENTIAL is not set (the operator sets it; this script never discovers it)");
  const send = callAs ?? ((persona, route, payload) => callEosApiAsPersona(persona, route, payload, { baseUrl: base, env }));
  const call = async (persona, route, operation, input) => {
    let res;
    try { res = await send(persona, route, { operation, input }); } catch (e) { return { ok: false, code: e?.code ?? "TRANSPORT" }; }
    const b = res?.body ?? {};
    return b.ok === true ? { ok: true, result: b.result ?? b.data ?? {} } : { ok: false, code: b.code ?? `HTTP_${res?.status}` };
  };

  // ---------------------------------------------------------------- preview (READ-ONLY): do the personas hold what the path needs?
  if (PREVIEW) {
    let bad = false;
    for (const [persona, needed] of Object.entries(NEEDS)) {
      const r = await call(persona, WO, "readMyWorkOrderCapabilities", {});
      if (!r.ok) { out({ step: `CAPS:${persona}`, outcome: "PREVIEW_ERROR", code: r.code }); bad = true; continue; }
      const held = new Set(r.result.capabilities ?? []);
      const missing = needed.filter((c) => !held.has(c));
      out({ step: `CAPS:${persona}`, outcome: missing.length ? "MISSING_CAPABILITY" : "OK", missing: missing.length ? missing : undefined });
      if (missing.length) bad = true;
    }
    return bad ? 2 : 0;
  }

  // ---------------------------------------------------------------- apply (ordered; stop on the first refusal)
  const refused = (step, code) => { out({ step, outcome: "REFUSED", code }); return 2; };
  const a = await call(OFFICE, CRM, "createAccount", { name: `${MARKER} Taylor Service Customer`, status: "ACTIVE", ownerEmployeeId: OWNER_EMPLOYEE, relationshipTypes: ["CUSTOMER"], lineOfBusiness: ["TAYLOR"], idempotencyKey: `${KEY}account` });
  if (!a.ok) return refused("D1", a.code);
  const accountId = a.result.accountId;
  if (!accountId) return refused("D1", "NO_ACCOUNT_ID");
  out({ step: "D1", outcome: "APPLIED" });

  const s = await call(OFFICE, CRM, "createAccountLocation", { accountId, name: `${MARKER} Taylor Service Site 1`, idempotencyKey: `${KEY}site` });
  if (!s.ok) return refused("D2", s.code);
  const locationId = s.result.accountLocationId;
  if (!locationId) return refused("D2", "NO_LOCATION_ID");
  out({ step: "D2", outcome: "APPLIED" });

  const c = await call(OFFICE, WO, "createWorkOrder", { operatingCompanyId: COMPANY, customerId: accountId, locationId, workOrderType: "SERVICE_CALL", priority: 3, complaint: `${MARKER} dispatch-ready service call for technician UAT`, idempotencyKey: `${KEY}workorder` });
  if (!c.ok) return refused("D3", c.code);
  const workOrderId = c.result.workOrderId;
  if (!workOrderId) return refused("D3", "NO_WORK_ORDER_ID");
  out({ step: "D3", outcome: c.result.replayed ? "PRESENT" : "APPLIED", workOrderNumber: c.result.workOrderNumber });

  const read = async () => {
    const r = await call(OFFICE, WO, "readWorkOrder", { workOrderId });
    return r.ok ? { ok: true, status: r.result.status, assignee: r.result.assigneeEmployeeId ?? null, start: r.result.scheduledStart ?? null, end: r.result.scheduledEnd ?? null } : r;
  };
  let w = await read();
  if (!w.ok) return refused("READ", w.code);

  if (w.status === "CREATED") {
    const r = await call(OFFICE, WO, "markWorkOrderReady", { workOrderId });
    if (!r.ok) return refused("D4", r.code);
    out({ step: "D4", outcome: "APPLIED" });
    w = { ...w, status: "READY_TO_DISPATCH" };
  } else out({ step: "D4", outcome: "PRESENT", status: w.status });

  if (w.status === "READY_TO_DISPATCH") {
    // The technician may already hold a window (WO-2026-000081): on SCHEDULE_CONFLICT only, retry the SAME command on a later day.
    let r;
    for (let k = 0; k < MAX_WINDOW_TRIES; k += 1) {
      const d = now();
      const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + dayOffset + k, 15, 0, 0));
      const end = new Date(start.getTime() + 2 * 3600 * 1000);
      r = await call(OFFICE, WO, "scheduleWorkOrder", { workOrderId, employeeId: TECH_EMPLOYEE, scheduledStart: start.toISOString(), scheduledEnd: end.toISOString(), note: `${MARKER} fixture` });
      if (r.ok || r.code !== "SCHEDULE_CONFLICT") break;
    }
    if (!r.ok) return refused("D5", r.code);
    out({ step: "D5", outcome: "APPLIED" });
    w = await read();
    if (!w.ok) return refused("READ", w.code);
  } else out({ step: "D5", outcome: w.status === "SCHEDULED" ? "PRESENT" : "SKIPPED", status: w.status });

  if (w.status !== "SCHEDULED") return stop("BEYOND_FIXTURE", `the Work Order is ${w.status}, not SCHEDULED; it is not rewound (Codex may already have dispatched it)`);
  if (w.assignee !== TECH_EMPLOYEE) return stop("ASSIGNEE_UNEXPECTED", `the SCHEDULED Work Order is assigned to ${w.assignee}, not ${TECH_EMPLOYEE}; nothing was changed`);

  // Informational only: does the assigned technician see it? (A SCHEDULED job may not be listed to the field yet; that is not a failure.)
  const t = await call(TECH_PERSONA, WO, "readWorkOrder", { workOrderId });
  out({ step: "TECH_VISIBILITY", outcome: t.ok ? "VISIBLE" : "NOT_VISIBLE", code: t.ok ? undefined : t.code });
  out({ outcome: "DISPATCH_READY", workOrderId, status: w.status, assigneeEmployeeId: w.assignee, scheduledStart: w.start, scheduledEnd: w.end, next: LEFT_FOR_CODEX });
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await run({ argv: process.argv.slice(2) }));
}
