// THE THIRTEEN PROTECTED WORK ORDERS -- the classification and the read-only plan. No database, no network.
//
// Controller: "Do NOT delete, overwrite, repair, reassign, repoint or otherwise mutate these 13 rows yet." The tool
// that plans their replacement is held to exactly that: it can only read, and the plan only speaks about the pinned set.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const m = require("../lib/eosOps/migration/workOrderProtectedRows.js");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

const observedAll = (over = {}) => m.PROTECTED_WORK_ORDERS.map((w) => ({
  id: w.id, number: w.number, status: "CANCELLED", provenance: "MIGRATED", fingerprint: w.fingerprint,
  dependents: { work_order_transitions: 0, work_order_assignments: 0, work_order_parts_plan: 0 }, ...(over[w.id] ?? {}),
}));

test("exactly the thirteen: WO-2026-000001..000008 and WO-2026-000060..000064", () => {
  const numbers = m.PROTECTED_WORK_ORDERS.map((w) => w.number);
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 60, 61, 62, 63, 64].map((n) => `WO-2026-${String(n).padStart(6, "0")}`));
  assert.equal(new Set(m.PROTECTED_WORK_ORDERS.map((w) => w.id)).size, 13);
});

test("every one is OBSOLETE/BAD_COPY, with the evidence stated", () => {
  assert.deepEqual([...new Set(Object.values(m.PROTECTED_CLASSIFICATION))], ["OBSOLETE/BAD_COPY"]);
  assert.equal(Object.keys(m.PROTECTED_CLASSIFICATION).length, 13);
  assert.equal(m.BAD_COPY_EVIDENCE.length, 3);
});

test("the plan refuses anything outside the pinned set, a missing pin, a number mismatch or a non-MIGRATED row", () => {
  const all = observedAll();
  assert.throws(() => m.planProtectedWorkOrders([...all, { ...all[0], id: "other" }]), (e) => e.code === "UNPINNED_ROW");
  assert.throws(() => m.planProtectedWorkOrders(all.slice(1)), (e) => e.code === "PINNED_ROW_MISSING");
  assert.throws(() => m.planProtectedWorkOrders(observedAll({ [all[0].id]: { number: "WO-2026-000099" } })), (e) => e.code === "NUMBER_MISMATCH");
  assert.throws(() => m.planProtectedWorkOrders(observedAll({ [all[0].id]: { provenance: "NATIVE" } })), (e) => e.code === "PROVENANCE_MISMATCH");
  assert.throws(() => m.planProtectedWorkOrders(observedAll({ [all[0].id]: { fingerprint: "x" } })), (e) => e.code === "FINGERPRINT_INVALID");
  // DECISION 3: a row that changed since it was pinned refuses -- fail closed.
  assert.throws(() => m.planProtectedWorkOrders(observedAll({ [all[0].id]: { fingerprint: "b".repeat(64) } })), (e) => e.code === "FINGERPRINT_MISMATCH");
  assert.ok(m.PROTECTED_WORK_ORDERS.every((w) => /^[0-9a-f]{64}$/.test(w.fingerprint)), "every pin carries its observed fingerprint");
});

test("the plan names what blocks a delete, and offers options without executing any", () => {
  const first = m.PROTECTED_WORK_ORDERS[0].id;
  const plan = m.planProtectedWorkOrders(observedAll({ [first]: { dependents: { work_order_assignments: 1, work_order_parts_plan: 8 } } }));
  assert.equal(plan.rows.length, 13);
  assert.deepEqual(plan.rows.find((r) => r.id === first).deleteBlockedBy, ["work_order_assignments:1"]);
  assert.deepEqual(plan.options.map((o) => o.option), ["A_RETAIN_UNTOUCHED", "B_REMOVE_AND_RECOPY", "C_QUARANTINE"]);
});

test("the CLI and the module can only READ: a READ ONLY transaction, no write statement, no apply mode", () => {
  const cli = strip(readFileSync("scripts/workOrderProtectedRowsPlanCli.js", "utf8"));
  assert.match(cli, /BEGIN TRANSACTION READ ONLY/);
  assert.doesNotMatch(cli, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/);
  assert.doesNotMatch(cli, /--apply|apply\s*mode|process\.argv\[3\]/);
  const mod = strip(readFileSync("src/eosOps/migration/workOrderProtectedRows.ts", "utf8"));
  assert.doesNotMatch(mod, /\b(INSERT|UPDATE|DELETE)\s+(INTO|FROM|eos_)/);
  assert.doesNotMatch(mod, /from\s+["']pg["']|require\(["']pg["']\)/, "the planner performs no I/O");
});
