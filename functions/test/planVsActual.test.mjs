// Finance — plan-vs-actual core (F6 / FIN-003). Pure tests. Proves invariant A mechanically: plans are
// versioned records with an EXPLICIT measurement basis; only APPROVED plans measure; a basis or currency
// mismatch is a thrown category error (compared, never blended); period/scope non-membership is a NAMED
// exclusion; variance = actual − plan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlanRecord, comparePlanToActual, PlanError, PLAN_TYPES, PLAN_STATUSES, MEASUREMENT_BASES } from "../lib/finance/planVsActual.js";

const planInput = (over = {}) => ({
  planType: "GOAL",
  version: 1,
  status: "APPROVED",
  measurementBasis: "BOOKED",
  currency: "USD",
  amountMinor: 1_000_000,
  periodStart: "2026-01-01",
  periodEnd: "2026-03-31",
  scope: { operatingCompanyId: "taylor", businessUnitId: null, creditedSalespersonId: null },
  ...over,
});
const factOf = (over = {}) => ({
  ref: "F1",
  basis: "BOOKED",
  currency: "USD",
  amountMinor: 250_000,
  eventDate: "2026-02-10",
  operatingCompanyId: "taylor",
  businessUnitId: "SERVICE",
  creditedSalespersonId: "emp-1",
  ...over,
});

test("closed vocabularies: GOAL≠BUDGET, DRAFT→APPROVED→SUPERSEDED, explicit bases", () => {
  assert.deepEqual([...PLAN_TYPES], ["GOAL", "BUDGET"]);
  assert.deepEqual([...PLAN_STATUSES], ["DRAFT", "APPROVED", "SUPERSEDED"]);
  assert.deepEqual([...MEASUREMENT_BASES], ["BOOKED", "BILLED", "COLLECTED", "COST"]);
});

test("a valid plan freezes with normalized scope; missing basis / bad period / bad amount refuse", () => {
  const p = buildPlanRecord(planInput());
  assert.equal(p.measurementBasis, "BOOKED");
  assert.equal(p.scope.businessUnitId, null);
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.scope));
  assert.throws(() => buildPlanRecord(planInput({ measurementBasis: "REVENUE" })), (e) => e instanceof PlanError && e.code === "BASIS_REQUIRED");
  assert.throws(() => buildPlanRecord(planInput({ periodEnd: "2025-12-31" })), (e) => e.code === "PERIOD_INVALID");
  assert.throws(() => buildPlanRecord(planInput({ amountMinor: 10.5 })), (e) => e.code === "AMOUNT_INVALID");
  assert.throws(() => buildPlanRecord(planInput({ version: 0 })), (e) => e.code === "VERSION_INVALID");
  assert.throws(() => buildPlanRecord(planInput({ scope: { operatingCompanyId: "  " } })), (e) => e.code === "SCOPE_INVALID");
});

test("only an APPROVED plan measures — DRAFT and SUPERSEDED refuse comparison", () => {
  for (const status of ["DRAFT", "SUPERSEDED"]) {
    const p = buildPlanRecord(planInput({ status }));
    assert.throws(() => comparePlanToActual(p, [factOf()]), (e) => e.code === "PLAN_NOT_APPROVED");
  }
});

test("in-period in-scope facts accumulate; variance = actual − plan (shortfall negative)", () => {
  const p = buildPlanRecord(planInput());
  const r = comparePlanToActual(p, [factOf(), factOf({ ref: "F2", amountMinor: 300_000, eventDate: "2026-03-31" })]);
  assert.equal(r.actualMinor, 550_000);
  assert.equal(r.planMinor, 1_000_000);
  assert.equal(r.varianceMinor, -450_000);
  assert.equal(r.includedCount, 2);
  assert.deepEqual(r.excluded, []);
});

test("BASIS MISMATCH is a thrown category error — collected cash never blends into a booked goal", () => {
  const p = buildPlanRecord(planInput());
  assert.throws(() => comparePlanToActual(p, [factOf({ basis: "COLLECTED" })]), (e) => e.code === "BASIS_MISMATCH");
});

test("currency mismatch is thrown, never converted silently", () => {
  const p = buildPlanRecord(planInput());
  assert.throws(() => comparePlanToActual(p, [factOf({ currency: "EUR" })]), (e) => e.code === "CURRENCY_MISMATCH");
});

test("out-of-period and out-of-scope facts are NAMED exclusions, not silent drops", () => {
  const p = buildPlanRecord(planInput());
  const r = comparePlanToActual(p, [
    factOf(),
    factOf({ ref: "LATE", eventDate: "2026-04-01" }),
    factOf({ ref: "OTHER-CO", operatingCompanyId: "ventana" }),
  ]);
  assert.equal(r.actualMinor, 250_000);
  assert.deepEqual(r.excluded.map((e) => e.ref).sort(), ["LATE", "OTHER-CO"]);
  assert.ok(r.excluded.find((e) => e.ref === "OTHER-CO").reason.includes("operatingCompanyId"));
});

test("unconstrained scope dimensions (null) admit any value — a company-wide goal counts every BU/person", () => {
  const p = buildPlanRecord(planInput());
  const r = comparePlanToActual(p, [factOf({ businessUnitId: "PARTS", creditedSalespersonId: "emp-9" })]);
  assert.equal(r.includedCount, 1);
});

test("person-scoped BUDGET on COST basis works the same way (a budget overrun is positive variance)", () => {
  const p = buildPlanRecord(planInput({ planType: "BUDGET", measurementBasis: "COST", amountMinor: 100_000, scope: { creditedSalespersonId: "emp-1" } }));
  const r = comparePlanToActual(p, [factOf({ basis: "COST", amountMinor: 120_000 })]);
  assert.equal(r.varianceMinor, 20_000);
  assert.equal(r.planType, "BUDGET");
});

test("malformed facts are thrown defects (missing ref / non-integer amount / bad date)", () => {
  const p = buildPlanRecord(planInput());
  assert.throws(() => comparePlanToActual(p, [factOf({ ref: "" })]), (e) => e.code === "FACT_INVALID");
  assert.throws(() => comparePlanToActual(p, [factOf({ amountMinor: 1.5 })]), (e) => e.code === "FACT_INVALID");
  assert.throws(() => comparePlanToActual(p, [factOf({ eventDate: "02/10/2026" })]), (e) => e.code === "FACT_INVALID");
});
