#!/usr/bin/env node
// UAT SCOPE CHECK (lane U01 / RO-01). Offline: no census, no database, no network. Exit 0 = the scope-gate table still matches the server code AND the
// evaluator gives the expected answer for the RO-01 shapes. Usage: node docs/uat/tools/uatScopeCheck.mjs
import assert from "node:assert/strict";
import { PROBES } from "./uatProbes.mjs";
import { scopeProblems, scopeGateFor, applyOperationGate, applyReadReach } from "./uatScope.mjs";

const problems = scopeProblems(PROBES);
assert.deepEqual(problems, [], `server scope gates moved:\n${problems.join("\n")}`);

const persona = (o) => ({ employeeId: "e", standing: false, declaredEligibility: [], operationalScopes: [], ...o });
const tech = persona({ operationalScopes: ["MOBILE:truck-1"], declaredEligibility: ["SERVICE_TECHNICIAN"] });
const partsMgr = persona({ operationalScopes: ["REORDER_QUEUE:taylor"] });
const admin = persona({ standing: true });
const whMgr = persona({ operationalScopes: ["WAREHOUSE:w1"], declaredEligibility: ["WAREHOUSE_OPERATIONS"] });
const whNoElig = persona({ operationalScopes: ["WAREHOUSE:w1"] });
const gate = (route, op) => scopeGateFor(route, op) ?? assert.fail(`no gate for ${route}:${op}`);
const q = gate("/operations/inventory", "readReorderQueue");

// RO-01: the technician holds the capability and no queue reach -> DENY with the SCOPE refusal, never CAPABILITY_REQUIRED.
let r = applyOperationGate(tech, q, { expected: "ALLOW" });
assert.equal(r.expected, "DENY");
assert.match(r.expectedRefusal, /^OUTSIDE_OPERATIONAL_SCOPE \(FORBIDDEN\)/);
// A persona with the queue scope, and the protected Administrator, keep ALLOW; a missing capability stays DENY untouched.
assert.equal(applyOperationGate(partsMgr, q, { expected: "ALLOW" }).expected, "ALLOW");
assert.equal(applyOperationGate(admin, q, { expected: "ALLOW" }).expected, "ALLOW");
assert.equal(applyOperationGate(tech, q, { expected: "DENY" }).expectedRefusal, undefined);
// The same reach decides the search and analysis doors (a scoped-only holding is not honoured there).
assert.equal(applyReadReach(tech, "search", "reorderRequest", { expected: "ALLOW" }).expected, "DENY");
assert.equal(applyReadReach(tech, "analysis", "reorderRequest", { expected: "ALLOW" }).expected, "DENY");
assert.equal(applyReadReach(partsMgr, "analysis", "reorderRequest", { expected: "ALLOW" }).expected, "ALLOW");
assert.equal(applyReadReach(partsMgr, "analysis", "reorderRequest", { expected: "SCOPED" }).expected, "DENY");
assert.equal(applyReadReach(tech, "search", "workOrder", { expected: "ALLOW" }).expected, "ALLOW"); // no reach on other kinds
// Warehouse scope + eligibility, in the server's order; the Administrator's reach does NOT satisfy an execution gate.
const create = gate("/operations/inventory", "createReorderRequest");
assert.equal(applyOperationGate(whMgr, create, { expected: "ALLOW" }).expected, "ALLOW");
assert.equal(applyOperationGate(admin, create, { expected: "ALLOW" }).expected, "DENY");
const count = gate("/operations/cycle-count", "createCycleCountSheet");
assert.match(applyOperationGate(whNoElig, count, { expected: "ALLOW" }).expectedRefusal, /^WORK_ELIGIBILITY_MISSING/);
assert.match(applyOperationGate(persona({}), count, { expected: "ALLOW" }).expectedRefusal, /^WORK_ELIGIBILITY_MISSING \(FORBIDDEN\) \[also fails: OUTSIDE_OPERATIONAL_SCOPE\]/);
// Receiving a transfer: the Technician's own-truck path is CONDITIONAL, not ALLOW and not DENY.
assert.equal(applyOperationGate(tech, gate("/operations/transfer", "receiveTransfer"), { expected: "ALLOW" }).expected, "CONDITIONAL");
assert.equal(applyOperationGate(tech, gate("/operations/transfer", "createTransfer"), { expected: "ALLOW" }).expected, "DENY");
console.log("uatScopeCheck: ok");
