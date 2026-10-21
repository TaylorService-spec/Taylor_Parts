// UAT census -- OPERATIONAL-SCOPE requirements of the server (lane U01, UAT-01 / RO-01).
//
// WHY THIS EXISTS. A capability answers "may this Principal perform this TYPE of act". Several operations ALSO require an Operational Scope
// (eos_workforce.employee_operational_scopes: REORDER_QUEUE, WAREHOUSE, MOBILE) and sometimes a Work Eligibility, decided AFTER the capability
// (functions/src/eosOps/contextualAuthorization.ts). Computing an expectation from the capability alone said ALLOW for personas the server refuses
// (RO-01: serviceTechnician holds reorder.request.read but no REORDER_QUEUE scope, so readReorderQueue refuses OUTSIDE_OPERATIONAL_SCOPE).
//
// HOW IT IS DERIVED. Each gate below names the operation, the scope reach the SERVER applies, and the refusal the SERVER raises. Nothing is trusted
// on its own: `scopeProblems()` re-reads the cited server function and fails the generator unless the gate call and the refusal code are still there,
// and it scans functions/src for ANY file that gates on a scope and is not either cited by a gate or listed in NOT_AN_OPERATION_GATE with the reason
// it produces no refusal at operation level. A new scope gate in the server therefore breaks the build of this manifest instead of drifting silently.
// The Work Eligibility codes are READ from the server constants, not retyped.
//
// WHAT IT DOES NOT DO. It never changes a grant, and it never pre-encodes a pending grant: the manifest reflects the CURRENT census. A persona that
// holds the capability AND a reaching scope keeps its ALLOW (the target warehouse / company is then decided per request: the basis says which).
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./uatExtract.mjs";

// UAT_SERVER_SRC lets the mutation proofs point the checker at a scratch copy of functions/src (never set it in normal use).
const SRC = process.env.UAT_SERVER_SRC ? path.resolve(process.env.UAT_SERVER_SRC) : path.join(REPO_ROOT, "functions", "src");
const text = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

/** The source of ONE top-level function, from its declaration to the next top-level declaration. */
export function fnSlice(src, name) {
  const re = new RegExp(`(?:^|\\n)(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`);
  const m = re.exec(src);
  if (!m) return null;
  const rest = src.slice(m.index + m[0].length);
  const next = /\n(?:export\s+)?(?:async\s+)?function\s|\nexport\s+(?:const|class|interface|type)\s/.exec(rest);
  return src.slice(m.index, m.index + m[0].length + (next ? next.index : rest.length));
}

// ---- Work Eligibility codes, READ from the server constants.
const eligOf = (rel, constName) => new RegExp(`${constName}\\s*=\\s*"([A-Z_]+)"`).exec(text(rel))?.[1];
const ELIG = Object.freeze({
  WAREHOUSE: eligOf("eosOps/cycleCountOperations.ts", "WAREHOUSE_WORK_ELIGIBILITY"),
  MOBILE: eligOf("eosOps/mobileStockAuthority.ts", "MOBILE_WORK_ELIGIBILITY"),
});

const INV = "/operations/inventory";
const S = (type) => ({ k: "S", type });
const E = (code) => ({ k: "E", code });
// Predicate sets, as the server builds them (order is the order the server evaluates: eligibility, then scope).
const WH_ONLY = [S("WAREHOUSE")];                      // reorder create, supplier PO, receipts, allocation, rental return, serialized acquire
const WH_ELIG = () => [E(ELIG.WAREHOUSE), S("WAREHOUSE")]; // warehousePredicates(): cycle count, transfer, relocation, put-away
const MOBILE = () => [E(ELIG.MOBILE), S("MOBILE")];

const QUEUE_NF = { code: "REORDER_NOT_FOUND", category: "NOT_FOUND" };
// `ev` = [{ file, fn?, must: RegExp[] }]: what must still be true of the server for the gate to stand.
const q = (op, refusal, ev, extra = {}) => ({ route: INV, op, reach: "QUEUE", refusal, ev, ...extra });
const w = (route, op, preds, ev, extra = {}) => ({ route, op, reach: "PREDICATES", preds: typeof preds === "function" ? preds : () => preds, refusal: { code: "OUTSIDE_OPERATIONAL_SCOPE", category: "FORBIDDEN" }, ev, ...extra });
const queueHelper = { file: "eosOps/reorderLifecycleCommands.ts", fn: "lockReorderInQueueReach", must: [/queueReachKeys\(/, /refuse\("REORDER_NOT_FOUND", "NOT_FOUND"/] };
const whPred = /kind:\s*"OPERATIONAL_SCOPE"(?:\s+as const)?,\s*scopeType:\s*"WAREHOUSE"/;
// The call site names the act; the HELPER body is what builds the predicates, so it is cited too (a helper that stops using warehousePredicates changes every row).
const ccHelper = { file: "eosOps/cycleCountOperations.ts", fn: "authorizeAtWarehouse", must: [/warehousePredicates\(/] };
const trHelper = { file: "eosOps/transferOperations.ts", fn: "authorizeAct", must: [/warehousePredicates\(/] };
const cc = (op, fnName, cap) => w("/operations/cycle-count", op, WH_ELIG, [{ file: "eosOps/cycleCountOperations.ts", fn: fnName, must: [new RegExp(`authorizeAtWarehouse\\(db, actor, EOS_CYCLE_COUNT_CAPABILITY\\.${cap}\\b`)] }, ccHelper]);
const tr = (op, fnName, act, extra = {}) => w("/operations/transfer", op, WH_ELIG, [{ file: "eosOps/transferOperations.ts", fn: fnName, must: [new RegExp(`authorizeAct\\(db, actor, "${act}"`)] }, trHelper], extra);

export const SCOPE_GATES = Object.freeze([
  // ---- REORDER_QUEUE reach (reorderQueueReach.ts: own REORDER_QUEUE scopes UNION protected Administrator standing; company-keyed)
  q("readReorderQueue", { code: "OUTSIDE_OPERATIONAL_SCOPE", category: "FORBIDDEN" }, [
    { file: "eosOps/reorderLifecycleCommands.ts", fn: "readReorderQueue", must: [/requireQueueReach\(/] },
    { file: "eosOps/reorderLifecycleCommands.ts", fn: "requireQueueReach", must: [/queueReachKeys\(/, /refuse\("OUTSIDE_OPERATIONAL_SCOPE", "FORBIDDEN"/] }]),
  q("reviewReorderRequest", QUEUE_NF, [{ file: "eosOps/reorderLifecycleCommands.ts", fn: "reviewReorderRequest", must: [/lockReorderInQueueReach\(/] }, queueHelper]),
  q("cancelReorderRequest", QUEUE_NF, [{ file: "eosOps/reorderLifecycleCommands.ts", fn: "cancelReorderRequest", must: [/lockReorderInQueueReach\(/] }, queueHelper]),
  q("assignReorderRequest", QUEUE_NF, [{ file: "eosOps/reorderAssignmentAuthority.ts", fn: "assignReorderRequestToEmployee", must: [/queueReachKeys\(/, /refuse\("REORDER_NOT_FOUND", "NOT_FOUND"/] }]),
  q("voidReorderPurchaseOrder", { code: "OUTSIDE_VOID_REACH", category: "FORBIDDEN" }, [{ file: "eosOps/reorderLifecycleCommands.ts", fn: "voidReorderPurchaseOrder", must: [/queueReachKeys\(/, /refuse\("OUTSIDE_VOID_REACH", "FORBIDDEN"/] }]),
  // ---- WAREHOUSE scope (the call sites do NOT opt in to Administrator reach: only experienceAuthority.ts does, and the reorder-receipt VOID)
  w(INV, "createReorderRequest", WH_ONLY, [{ file: "eosOps/reorderLifecycleCommands.ts", fn: "createGovernedReorderRequest", must: [whPred, /refuse\(scoped\.reason, "FORBIDDEN"/] }]),
  w(INV, "createSupplierPurchaseOrder", WH_ONLY, [{ file: "eosOps/supplierPurchaseOrderAuthoring.ts", fn: "createSupplierPurchaseOrder", must: [whPred, /refuse\(scoped\.reason, "FORBIDDEN"/] }]),
  w(INV, "receiveSupplierPurchaseOrder", WH_ONLY, [{ file: "eosOps/supplierPurchaseOrderReceiving.ts", fn: "receiveSupplierPurchaseOrder", must: [whPred, /refuse\(scoped\.reason, "FORBIDDEN"/] }]),
  w(INV, "correctSupplierPurchaseOrderReceipt", WH_ONLY, [{ file: "eosOps/supplierReceiptCorrection.ts", fn: "correctSupplierPurchaseOrderReceipt", must: [/voidWithin\(/] },
    { file: "eosOps/supplierReceiptCorrection.ts", fn: "voidWithin", must: [whPred, /refuse\(scoped\.reason, "FORBIDDEN"/] }]),
  w(INV, "allocateSalesOrderLine", WH_ONLY, [{ file: "eosOps/salesOrderAllocation.ts", fn: "allocateSalesOrderLine", must: [/requireWarehouseScope\(/] }, { file: "eosOps/salesOrderAllocation.ts", fn: "requireWarehouseScope", must: [whPred, /refuse\(decision\.reason, "FORBIDDEN"/] }]),
  w("/operations/rental", "receiveRentalReturn", WH_ONLY, [{ file: "eosRental/rental.ts", fn: "receiveRentalReturn", must: [whPred, /refuse\(scoped\.reason, "FORBIDDEN"/] }]),
  w("/operations/serialized-asset", "acquireSerializedAsset", WH_ONLY, [{ file: "eosOps/serializedAssetAcquireOperations.ts", fn: "acquireEosSerializedAsset", must: [/acquirePredicates\(/] },
    { file: "eosOps/serializedAssetAcquireOperations.ts", fn: "acquirePredicates", must: [whPred] }]),
  // ---- WAREHOUSE scope + Work Eligibility (warehousePredicates)
  w("/operations/placement", "recordPutAway", WH_ELIG, [{ file: "eosOps/binPlacementOperations.ts", fn: "recordEosPutAway", must: [/warehousePredicates\(/] }]),
  w("/operations/relocation", "relocateStock", WH_ELIG, [{ file: "eosOps/stockRelocationOperations.ts", fn: "relocateEosStock", must: [/warehousePredicates\(/] }]),
  cc("createCycleCountSheet", "createEosCycleCountSheet", "create"),
  cc("submitCycleCountLine", "submitEosCycleCountLine", "submit"),
  cc("reconcileCycleCountLine", "reconcileEosCycleCountLine", "reconcile"),
  cc("closeCycleCountSheet", "closeEosCycleCountSheet", "close"),
  cc("cancelCycleCountSheet", "cancelEosCycleCountSheet", "cancel"),
  tr("createTransfer", "createEosTransfer", "create"),
  tr("dispatchTransfer", "dispatchEosTransfer", "dispatch"),
  tr("cancelTransfer", "cancelEosTransfer", "cancel"),
  // receive has a SECOND, Technician path: into a MOBILE destination only, with SERVICE_TECHNICIAN eligibility and a current MOBILE scope over that truck
  tr("receiveTransfer", "receiveEosTransfer", "receive", { alt: MOBILE, altNote: "or, ONLY for a MOBILE (truck) destination, SERVICE_TECHNICIAN eligibility plus a current MOBILE scope over that truck" }),
]);

/** Families the analysis door and the search door decide on the SAME reach as the record reads (no refusal code: a kind is not searched / a measure is refused in prose). */
export const READ_REACH = Object.freeze({
  search: { reorderRequest: { reach: "QUEUE", result: "kind absent from results (not searched): requires the REORDER_QUEUE Operational Scope",
    ev: [{ file: "eosExperience/myWork.ts", must: [/kind:\s*"reorderRequest"[^\n]*reach:\s*"REORDER_QUEUE"/, /keys\.length === 0\) \{ notSearched\.push/] }] } },
  analysis: {
    reorderRequest: { reach: "QUEUE", result: "measure refused: requires the REORDER_QUEUE Operational Scope over the company in view", ev: [{ file: "eosAnalysis/measures.ts", must: [/id: "purchasing\.reorders\.open"[\s\S]{0,900}?reach:\s*"REORDER_QUEUE"/] }, { file: "eosAnalysis/analysis.ts", must: [/m\.reach === "REORDER_QUEUE"[\s\S]{0,200}queueReachKeys\(/, /requires the REORDER_QUEUE Operational Scope over the company in view/] }] },
    purchaseOrder: { reach: "QUEUE", result: "measure refused: requires the REORDER_QUEUE Operational Scope over the company in view", ev: [{ file: "eosAnalysis/measures.ts", must: [/id: "purchasing\.orders\.placed"[\s\S]{0,900}?reach:\s*"REORDER_QUEUE"/] }] },
    receivingOrder: { reach: "WAREHOUSE", result: "measure refused: requires a WAREHOUSE Operational Scope", ev: [{ file: "eosAnalysis/measures.ts", must: [/readCapabilities:\s*\["receivingOrder\.record\.read"\],\s*\n?\s*channelScopedBy: null, reach:\s*"WAREHOUSE"/] }, { file: "eosAnalysis/analysis.ts", must: [/m\.reach === "WAREHOUSE"[\s\S]{0,200}scopedWarehouseIds\(/, /requires a WAREHOUSE Operational Scope/] }] },
    inventoryTransaction: { reach: "WAREHOUSE", result: "measure refused: requires a WAREHOUSE Operational Scope", ev: [{ file: "eosAnalysis/measures.ts", must: [/readCapabilities:\s*\["inventory\.transaction\.read"\],\s*channelScopedBy: null, reach:\s*"WAREHOUSE"/] }] },
  },
});

/** Files that match the scope-gate scan but yield NO operation-level refusal in the manifest (or are the evaluator itself). Each reason is checked by review, not by regex. */
export const NOT_AN_OPERATION_GATE = Object.freeze({
  "eosOps/contextualAuthorization.ts": "the evaluator itself (capability, then eligibility, then scope)",
  "eosOps/mobileStockAuthority.ts": "MOBILE predicate builder; callers are listed below",
  "eosOps/reorderQueueReach.ts": "queueReachKeys: the reach function the QUEUE gates cite",
  "eosOps/administrationReach.ts": "Administrator reach rules (read reach + the experience surface + reorder-receipt VOID)",
  "adminPolicy/adminPolicyApi.ts": "predicate-kind catalogue shown in Administration (no operation refusal)",
  "adminPolicy/inventoryWarehouseActivationDelta.ts": "activation metadata (no operation refusal)",
  "eosOps/experienceAuthority.ts": "navigation-surface scope evaluation; covered by the navigation tier (surfaceGranted)",
  "eosOps/partsReads.ts": "READ reach filters (scopedWarehouseIds): an empty scope returns an empty list, not a refusal; analysis WAREHOUSE reach is modelled in READ_REACH",
  "eosOps/performanceGoalReads.ts": "READ reach filter (empty result, not a refusal)",
  "eosOps/equipmentOperations.ts": "READ reach filter (empty result, not a refusal)",
  "eosOps/returnIntake.ts": "the warehouse is OPTIONAL on a return; a named warehouse outside reach reads as WAREHOUSE_NOT_FOUND (no scope refusal)",
  "eosWorkforce/reads/assignedWorkReads.ts": "Administration read of ANOTHER Employee's assigned work (not a probe operation)",
  "eosOps/costEvidenceSupplyCommand.ts": "WAREHOUSE-scoped, but supplyCostEvidence is not in the probe table, so the manifest holds no row for it",
  "eosOps/intercompanyInventoryRelief.ts": "WAREHOUSE-scoped, but it is not in the probe table, so the manifest holds no row for it",
  "eosOps/receiptCorrectionCommand.ts": "WAREHOUSE-scoped (the VOID opts in to Administrator reach), but correctReorderReceipt is not in the probe table, so the manifest holds no row for it",
  "eosOps/receiveReorderStockCommand.ts": "WAREHOUSE-scoped, but receiveReorderStock is not in the probe table, so the manifest holds no row for it",
  "eosOps/workOrderEquipmentInstall.ts": "MOBILE scope applies ONLY when the unit is drawn from a truck: conditional on the target, not on the operation",
  "eosOps/workOrderExecution.ts": "MOBILE scope applies ONLY when parts are consumed from a truck: conditional on the target, not on the operation",
});

const CITED = new Set([...SCOPE_GATES.flatMap((g) => g.ev.map((e) => e.file)), ...Object.values(READ_REACH).flatMap((o) => Object.values(o).flatMap((f) => f.ev.map((e) => e.file)))]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/__tests__|node_modules/.test(e.name)) walk(p, out); } else if (/\.ts$/.test(e.name) && !/\.(test|spec)\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}
const SCAN = /kind:\s*"OPERATIONAL_SCOPE"|scopeType:\s*"(?:WAREHOUSE|MOBILE|REORDER_QUEUE)"|queueReachKeys\(|requireQueueReach\(|scopedWarehouseIds\(|warehousePredicates\(|mobilePredicates\(|authorizeMobileAct\(|acquirePredicates\(/;

/**
 * Facts every gate above relies on but no single gate cites. If one stops being true, rows would be wrong in bulk.
 *  - warehousePredicates still builds eligibility THEN warehouse scope (the order the refusal codes assume);
 *  - queueReachKeys still unions the Employee's REORDER_QUEUE scopes with the protected Administrator reach (what reachQueue() models).
 */
const INVARIANTS = Object.freeze([
  { label: "warehousePredicates order", file: "eosOps/cycleCountOperations.ts", fn: "warehousePredicates", must: [/WORK_ELIGIBILITY[\s\S]*OPERATIONAL_SCOPE[\s\S]*scopeType:\s*"WAREHOUSE"/] },
  { label: "queueReachKeys unions own scopes and Administrator reach", file: "eosOps/reorderQueueReach.ts", fn: "queueReachKeys",
    must: [/scopeType === REORDER_QUEUE_SCOPE_TYPE/, /administrationReachTargets\(db, actor\.tenantId, actor\.principalId, REORDER_QUEUE_SCOPE_TYPE\)/, /new Set\(\[\.\.\.own, \.\.\.administered\]\)/] },
]);

/**
 * The ONLY call sites that let the protected Administrator's reach satisfy an OPERATIONAL_SCOPE predicate (`administrationReach:` set to anything but false).
 * The gates above assume NO other site does (uatScope models the Administrator as reaching only the queue, and read doors). A new or moved site fails the generator.
 */
const ADMIN_REACH_OPT_IN = Object.freeze({
  "eosOps/experienceAuthority.ts": { count: 1, reason: "navigation-surface evaluation (warehouse.record.read / reorder.request.read inspection)" },
  "eosOps/receiptCorrectionCommand.ts": { count: 1, reason: "correctReorderReceipt VOID only (G2); not a probe operation" },
});

/** Problems that must stop the generator: a gate whose server evidence has moved, an unaccounted scope-gating file, a gate that names no probe. */
export function scopeProblems(probes) {
  const problems = [];
  if (!ELIG.WAREHOUSE || !ELIG.MOBILE) problems.push(`work-eligibility constants not found (warehouse=${ELIG.WAREHOUSE}, mobile=${ELIG.MOBILE})`);
  const check = (label, ev) => {
    for (const e of ev) {
      let src;
      try { src = text(e.file); } catch { problems.push(`${label}: ${e.file} is not readable`); continue; }
      const body = e.fn ? fnSlice(src, e.fn) : src;
      if (body === null) { problems.push(`${label}: function ${e.fn} not found in ${e.file}`); continue; }
      for (const re of e.must) if (!re.test(body)) problems.push(`${label}: ${e.file}${e.fn ? "#" + e.fn : ""} no longer matches ${re} (the server gate moved: re-derive this gate)`);
    }
  };
  for (const g of SCOPE_GATES) {
    if (!probes.some((p) => p.route === g.route && p.op === g.op)) problems.push(`scope gate ${g.route}:${g.op} names no probe`);
    check(`${g.route}:${g.op}`, g.ev);
  }
  for (const [door, fams] of Object.entries(READ_REACH)) for (const [f, d] of Object.entries(fams)) check(`${door}/${f}`, d.ev);
  for (const iv of INVARIANTS) check(`invariant: ${iv.label}`, [iv]);
  const optIns = new Map();
  for (const f of walk(SRC)) {
    const rel = path.relative(SRC, f).replace(/\\/g, "/");
    const src = fs.readFileSync(f, "utf8");
    if (SCAN.test(src) && !CITED.has(rel) && !(rel in NOT_AN_OPERATION_GATE)) problems.push(`${rel} gates on an Operational Scope but no scope gate cites it and it is not in NOT_AN_OPERATION_GATE`);
    // `administrationReach: false` and the type declaration (`administrationReach?: boolean`) are not opt-ins; a comment is not code.
    const n = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && /(?:^\s*|[{,]\s*)administrationReach\s*:\s*(?!false\b)\S/.test(l)).length;
    if (n) optIns.set(rel, n);
  }
  for (const [rel, n] of optIns) {
    const ok = ADMIN_REACH_OPT_IN[rel];
    if (!ok) problems.push(`${rel} sets administrationReach (${n}x) but is not a listed opt-in site: a new Administrator-reach site changes the expectations in bulk`);
    else if (ok.count !== n) problems.push(`${rel} sets administrationReach ${n}x, listed ${ok.count}x`);
  }
  for (const rel of Object.keys(ADMIN_REACH_OPT_IN)) if (!optIns.has(rel)) problems.push(`${rel} is a listed Administrator-reach opt-in but no longer sets administrationReach (re-derive)`);
  return problems;
}

const gateByKey = new Map(SCOPE_GATES.map((g) => [`${g.route}:${g.op}`, g]));
export const scopeGateFor = (route, op) => gateByKey.get(`${route}:${op}`) ?? null;

const heldOf = (p, type) => p.operationalScopes.filter((s) => s.startsWith(type + ":"));
const hasEmployee = (p) => !!p.employeeId;

/** Does the persona hold the predicates, in the server's order? */
function evalPreds(p, preds) {
  // The server stops at the FIRST failing predicate (eligibility, then scope). The others are listed so a run is not misread when the first is a declared (fixture) value.
  const fails = [];
  for (const x of preds) {
    if (!hasEmployee(p)) { fails.push({ code: "EMPLOYEE_LINK_REQUIRED", why: "it has no linked Employee" }); break; }
    if (x.k === "E" && !p.declaredEligibility.includes(x.code)) fails.push({ code: "WORK_ELIGIBILITY_MISSING", why: `it lacks the ${x.code} work eligibility (declared in the authority-dimension fixture: ${p.declaredEligibility.join(",") || "none"}; confirm with explainEffectiveAccess)` });
    if (x.k === "S" && heldOf(p, x.type).length === 0) fails.push({ code: "OUTSIDE_OPERATIONAL_SCOPE", why: `it holds no ${x.type} Operational Scope (held: ${p.operationalScopes.join(", ") || "none"})` });
  }
  if (fails.length === 0) return { ok: true, held: preds.filter((x) => x.k === "S").flatMap((x) => heldOf(p, x.type)) };
  return { ok: false, code: fails[0].code, why: fails.map((f) => f.why).join("; and "), also: fails.slice(1).map((f) => f.code) };
}
const reachQueue = (p) => {
  const own = heldOf(p, "REORDER_QUEUE");
  return own.length || p.standing ? { ok: true, held: [...own, ...(p.standing ? ["protected Administrator reach"] : [])] } : { ok: false, why: `it holds no REORDER_QUEUE Operational Scope and no protected Administrator standing (held: ${p.operationalScopes.join(", ") || "none"})` };
};
const reachWarehouseRead = (p) => {
  const own = heldOf(p, "WAREHOUSE");
  return own.length || p.standing ? { ok: true, held: [...own, ...(p.standing ? ["protected Administrator reach"] : [])] } : { ok: false, why: `it holds no WAREHOUSE Operational Scope and no protected Administrator standing (held: ${p.operationalScopes.join(", ") || "none"})` };
};

/**
 * Apply an operation's scope requirement to a base expectation {expected, basis}. Only a base ALLOW/SCOPED can change (a missing capability is refused first).
 * Returns { expected, scopeNote?, expectedRefusal?, scopeRequirement }; `basis` (who holds the capability) is the caller's and is not touched.
 */
export function applyOperationGate(p, g, base) {
  const requirement = g.reach === "QUEUE" ? "REORDER_QUEUE Operational Scope (company-keyed) or protected Administrator reach"
    : `${g.preds().map((x) => (x.k === "E" ? `${x.code} work eligibility` : `${x.type} Operational Scope`)).join(" + ")}${g.alt ? ` ${g.altNote}` : ""}`;
  if (!["ALLOW", "SCOPED"].includes(base.expected)) return { expected: base.expected, scopeRequirement: requirement };
  if (g.reach === "QUEUE") {
    const r = reachQueue(p);
    if (r.ok) return { expected: base.expected, scopeNote: `REORDER_QUEUE reach: ${r.held.join(", ")}`, scopeRequirement: requirement };
    return { expected: "DENY", expectedRefusal: `${g.refusal.code} (${g.refusal.category}): capability held, ${r.why}`, scopeRequirement: requirement };
  }
  const r = evalPreds(p, g.preds());
  if (r.ok) return { expected: base.expected, scopeNote: `scope reach: ${r.held.join(", ")} (the request's own warehouse must be among them)`, scopeRequirement: requirement };
  if (g.alt) {
    const a = evalPreds(p, g.alt());
    if (a.ok) return { expected: "CONDITIONAL", scopeNote: `no warehouse path (${r.why}); the Technician path holds: only a receipt into a MOBILE destination within ${a.held.join(", ")}`, scopeRequirement: requirement };
  }
  return { expected: "DENY", expectedRefusal: `${r.code} (${g.refusal.category})${r.also.length ? ` [also fails: ${r.also.join(", ")}]` : ""}: capability held, ${r.why}`, scopeRequirement: requirement };
}

/** The same decision for a read door (search / analysis): an unreached kind is absent / a measure is refused. */
export function applyReadReach(p, door, family, base) {
  const d = READ_REACH[door]?.[family];
  if (!d) return base;
  const requirement = d.reach === "QUEUE" ? "REORDER_QUEUE Operational Scope (company-keyed) or protected Administrator reach" : "WAREHOUSE Operational Scope or protected Administrator read reach";
  if (!["ALLOW", "SCOPED"].includes(base.expected)) return { ...base, scopeRequirement: requirement };
  // These doors honour a FLAT read capability only (no channelScopedBy / companyScopedBy on these kinds and measures): a scoped-only holding is refused on the capability.
  if (base.expected === "SCOPED") return { expected: "DENY", basis: "only a scoped (not flat) holding of the read capability, which this door does not honour; the reach is also required", expectedRefusal: d.result, scopeRequirement: requirement };
  const r = d.reach === "QUEUE" ? reachQueue(p) : reachWarehouseRead(p);
  if (r.ok) return { ...base, scopeRequirement: requirement, basis: `${base.basis}; ${d.reach} reach: ${r.held.join(", ")}` };
  return { expected: "DENY", basis: `capability held but ${r.why}`, expectedRefusal: d.result, scopeRequirement: requirement };
}
