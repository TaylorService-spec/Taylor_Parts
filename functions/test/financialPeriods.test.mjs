// Finance — period & close core (F9 / FIN-008). Pure tests. Proves: periods are per-company explicit
// records; a close carries who/why/when and reopening is unmodeled; a CLOSED period refuses events dated
// inside it; an uncovered date is allowed (closing is explicit, absence closes nothing); overlapping
// periods are a thrown configuration defect; one company's close never blocks the other company.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFinancialPeriod, assertEventDateOpen, PeriodError, PERIOD_STATUSES } from "../lib/finance/financialPeriods.js";

const openPeriod = (over = {}) => buildFinancialPeriod({
  operatingCompanyId: "taylor",
  periodStart: "2026-01-01",
  periodEnd: "2026-01-31",
  status: "OPEN",
  ...over,
});
const closedPeriod = (over = {}) => buildFinancialPeriod({
  operatingCompanyId: "taylor",
  periodStart: "2026-01-01",
  periodEnd: "2026-01-31",
  status: "CLOSED",
  closedByUid: "uid-controller",
  closeReason: "January operational close",
  closedAtMillis: 1_700_000_000_000,
  ...over,
});
const ev = (over = {}) => ({ operatingCompanyId: "taylor", eventDate: "2026-01-15", label: "payment application", ...over });

test("statuses are OPEN|CLOSED only — REOPEN is deliberately unmodeled", () => {
  assert.deepEqual([...PERIOD_STATUSES], ["OPEN", "CLOSED"]);
});

test("a CLOSED period must carry who/why/when; an OPEN one must not; records freeze", () => {
  const c = closedPeriod();
  assert.ok(Object.isFrozen(c));
  assert.equal(c.closedByUid, "uid-controller");
  assert.throws(() => closedPeriod({ closedByUid: null }), (e) => e instanceof PeriodError && e.code === "CLOSE_FACTS_REQUIRED");
  assert.throws(() => closedPeriod({ closeReason: " " }), (e) => e.code === "CLOSE_FACTS_REQUIRED");
  assert.throws(() => closedPeriod({ closedAtMillis: null }), (e) => e.code === "CLOSE_FACTS_REQUIRED");
  assert.throws(() => openPeriod({ closedByUid: "uid-x" }), (e) => e.code === "CLOSE_FACTS_FORBIDDEN");
  assert.throws(() => openPeriod({ periodEnd: "2025-12-01" }), (e) => e.code === "PERIOD_INVALID");
  assert.throws(() => openPeriod({ operatingCompanyId: " " }), (e) => e.code === "COMPANY_REQUIRED");
});

test("an event dated inside a CLOSED period is refused — closed history is not writable", () => {
  assert.throws(() => assertEventDateOpen([closedPeriod()], ev()), (e) => e.code === "PERIOD_CLOSED");
});

test("an OPEN period admits events; boundary dates are inclusive on the closed window", () => {
  assert.doesNotThrow(() => assertEventDateOpen([openPeriod()], ev()));
  assert.throws(() => assertEventDateOpen([closedPeriod()], ev({ eventDate: "2026-01-01" })), (e) => e.code === "PERIOD_CLOSED");
  assert.throws(() => assertEventDateOpen([closedPeriod()], ev({ eventDate: "2026-01-31" })), (e) => e.code === "PERIOD_CLOSED");
  assert.doesNotThrow(() => assertEventDateOpen([closedPeriod()], ev({ eventDate: "2026-02-01" })));
});

test("an uncovered date is ALLOWED — closing is an explicit act; no declared period closes nothing", () => {
  assert.doesNotThrow(() => assertEventDateOpen([], ev()));
  assert.doesNotThrow(() => assertEventDateOpen([closedPeriod()], ev({ eventDate: "2026-03-10" })));
});

test("periods are PER COMPANY — Taylor's close never blocks a Ventana event", () => {
  assert.doesNotThrow(() => assertEventDateOpen([closedPeriod()], ev({ operatingCompanyId: "ventana" })));
});

test("overlapping declared periods for one company are a thrown configuration defect", () => {
  const a = closedPeriod();
  const b = openPeriod({ periodStart: "2026-01-20", periodEnd: "2026-02-20" });
  assert.throws(() => assertEventDateOpen([a, b], ev({ eventDate: "2026-02-10" })), (e) => e.code === "PERIODS_OVERLAP");
  // same windows on DIFFERENT companies do not overlap
  const v = buildFinancialPeriod({ operatingCompanyId: "ventana", periodStart: "2026-01-01", periodEnd: "2026-01-31", status: "OPEN" });
  assert.doesNotThrow(() => assertEventDateOpen([a, v], ev({ operatingCompanyId: "ventana" })));
});

test("malformed event inputs are thrown defects", () => {
  assert.throws(() => assertEventDateOpen([], ev({ eventDate: "01/15/2026" })), (e) => e.code === "EVENT_DATE_INVALID");
  assert.throws(() => assertEventDateOpen([], ev({ operatingCompanyId: "" })), (e) => e.code === "COMPANY_REQUIRED");
});
