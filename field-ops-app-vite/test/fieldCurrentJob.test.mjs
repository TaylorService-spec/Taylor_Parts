import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCurrentJob,
  resolveCustomerIdentity,
  CUSTOMER_IDENTITY,
} from "../src/domain/fieldCurrentJob.js";

const TECH = "tech-1";
const wo = (over = {}) => ({
  id: "wo-1",
  woNumber: "WO-2026-000001",
  status: "ARRIVED",
  assignedTechId: TECH,
  customerId: "acct-harbor",
  locationId: "loc-1",
  complaint: "Ice machine not producing",
  ...over,
});

// ---------------------------------------------------------------- customer

test("an authorised resolver produces a real name", () => {
  const r = resolveCustomerIdentity(wo(), () => "Harbor Grill");
  assert.equal(r.state, CUSTOMER_IDENTITY.RESOLVED);
  assert.equal(r.name, "Harbor Grill");
});

test("NO resolver means NOT_AUTHORIZED -- never ABSENT", () => {
  // The distinction is the whole point: "you may not see this" must never be
  // rendered as "there is nothing here".
  const r = resolveCustomerIdentity(wo(), null);
  assert.equal(r.state, CUSTOMER_IDENTITY.NOT_AUTHORIZED);
  assert.equal(r.name, null);
  assert.equal(r.customerId, "acct-harbor");
});

test("a missing customerId is ABSENT -- a data gap, not a denial", () => {
  const r = resolveCustomerIdentity(wo({ customerId: null }), () => "Nope");
  assert.equal(r.state, CUSTOMER_IDENTITY.ABSENT);
  assert.equal(r.customerId, null);
});

test("a resolver that returns nothing usable is UNRESOLVED, not a fabricated name", () => {
  for (const bad of [null, undefined, "", "   ", 42, {}]) {
    const r = resolveCustomerIdentity(wo(), () => bad);
    assert.equal(r.state, CUSTOMER_IDENTITY.UNRESOLVED, String(bad));
    assert.equal(r.name, null);
  }
});

test("the customerId is never presented as a name", () => {
  const r = resolveCustomerIdentity(wo(), null);
  assert.notEqual(r.name, r.customerId);
  assert.equal(r.name, null);
});

// ------------------------------------------------------------- composition

test("buildCurrentJob returns null without a work order", () => {
  assert.equal(buildCurrentJob({ workOrder: null, technicianId: TECH }), null);
});

test("the rhythm is present: context, state, attention, readiness, next action", () => {
  const job = buildCurrentJob({ workOrder: wo(), technicianId: TECH });
  for (const key of ["context", "state", "attention", "readiness", "nextAction"]) {
    assert.ok(key in job, `missing ${key}`);
  }
  assert.equal(job.reference, "WO-2026-000001");
});

test("the next action comes from governed authority, and only for the assignee", () => {
  assert.equal(buildCurrentJob({ workOrder: wo(), technicianId: TECH }).nextAction.action, "WorkStart");
  // Someone else's work order yields no action at all.
  assert.equal(
    buildCurrentJob({ workOrder: wo({ assignedTechId: "other" }), technicianId: TECH }).nextAction,
    null,
  );
});

test("readiness is the SHARED projection's vocabulary, not a field-local one", () => {
  const job = buildCurrentJob({ workOrder: wo(), technicianId: TECH, plannedParts: [] });
  // No parts planned reads differently from "everything ready".
  assert.equal(job.readiness.jobReadiness, "NO_PLAN");
  assert.deepEqual(Object.keys(job.readiness.counts).sort(), ["ATTENTION", "READY", "UNKNOWN"]);
  assert.ok(Array.isArray(job.readiness.degraded));
  assert.ok("plannedCount" in job.readiness);
});

test("planned parts flow through to the shared projection unchanged", () => {
  const job = buildCurrentJob({
    workOrder: wo(),
    technicianId: TECH,
    plannedParts: [{ partId: "PRT-1", qtyPlanned: 2 }],
  });
  assert.equal(job.readiness.plannedCount, 1);
  assert.notEqual(job.readiness.jobReadiness, "NO_PLAN");
  // Field code must not invent a readiness value of its own.
  assert.ok(["READY", "ATTENTION", "UNKNOWN"].includes(job.readiness.jobReadiness));
});

// ----------------------------------------------------------------- attention

test("an unauthorised customer surfaces as attention, not as silence", () => {
  const job = buildCurrentJob({ workOrder: wo(), technicianId: TECH });
  assert.ok(job.attention.some((a) => a.key === "customer-not-authorized"));
});

test("a missing customer is reported distinctly from an unauthorised one", () => {
  const job = buildCurrentJob({ workOrder: wo({ customerId: null }), technicianId: TECH });
  assert.ok(job.attention.some((a) => a.key === "customer-absent"));
  assert.ok(!job.attention.some((a) => a.key === "customer-not-authorized"));
});

test("degraded capabilities are explained rather than hidden", () => {
  const job = buildCurrentJob({
    workOrder: wo(),
    technicianId: TECH,
    plannedParts: [{ partId: "PRT-1", qtyPlanned: 1 }],
  });
  // truckInventory is OFF by default in the shared projection today.
  assert.ok(job.readiness.degraded.includes("truckInventory"));
  assert.ok(job.attention.some((a) => a.key === "degraded-truckInventory"));
});

test("high severity is surfaced for attention", () => {
  const job = buildCurrentJob({ workOrder: wo({ severity: "CRITICAL" }), technicianId: TECH });
  assert.ok(job.attention.some((a) => a.key === "severity" && a.severity === "high"));
});

test("attention is empty of customer/severity noise when everything resolves", () => {
  const job = buildCurrentJob({
    workOrder: wo({ severity: "LOW" }),
    technicianId: TECH,
    customerResolver: () => "Harbor Grill",
  });
  assert.ok(!job.attention.some((a) => a.key.startsWith("customer-")));
  assert.ok(!job.attention.some((a) => a.key === "severity"));
});

// --------------------------------------------------------------------- state

test("state exposes governed status and lifecycle position, never invents one", () => {
  const job = buildCurrentJob({ workOrder: wo({ status: "EN_ROUTE" }), technicianId: TECH });
  assert.equal(job.state.status, "EN_ROUTE");
  assert.equal(job.state.totalSteps, 5);
  assert.ok(job.state.step > 0 && job.state.step < job.state.totalSteps);
});

// ---------------------------------------------------------------------------
// F1 completion — the trusted projection is wired through the EXISTING seam.
// A denial passes no resolver (=> NOT_AUTHORIZED); an allowed-but-unusable
// canonical value returns null (=> UNRESOLVED). These must never collapse.
// ---------------------------------------------------------------------------

test("a resolved customer removes the customer-identity Attention warning", () => {
  const job = buildCurrentJob({
    workOrder: wo(), technicianId: TECH,
    customerResolver: () => "Harbor Grill Restaurant Group",
  });
  assert.equal(job.context.customer.state, CUSTOMER_IDENTITY.RESOLVED);
  assert.ok(!job.attention.some((a) => a.key.startsWith("customer-")));
});

test("an authorization DENIAL renders as NOT_AUTHORIZED, never ABSENT", () => {
  // A denial supplies no resolver -- the seam's whole point.
  const job = buildCurrentJob({ workOrder: wo(), technicianId: TECH, customerResolver: null });
  assert.equal(job.context.customer.state, CUSTOMER_IDENTITY.NOT_AUTHORIZED);
  assert.notEqual(job.context.customer.state, CUSTOMER_IDENTITY.ABSENT);
  assert.ok(job.attention.some((a) => a.key === "customer-not-authorized"));
});

test("missing canonical data renders as UNRESOLVED, never as a denial", () => {
  const job = buildCurrentJob({
    workOrder: wo(), technicianId: TECH,
    customerResolver: () => null, // authorised, but nothing usable came back
  });
  assert.equal(job.context.customer.state, CUSTOMER_IDENTITY.UNRESOLVED);
  assert.notEqual(job.context.customer.state, CUSTOMER_IDENTITY.NOT_AUTHORIZED);
});

test("site identity resolves with the same four states", () => {
  const resolved = buildCurrentJob({
    workOrder: wo(), technicianId: TECH, siteResolver: () => "Harbor Grill — Downtown, Phoenix, AZ",
  });
  assert.equal(resolved.context.site.state, CUSTOMER_IDENTITY.RESOLVED);
  assert.equal(resolved.context.site.label, "Harbor Grill — Downtown, Phoenix, AZ");

  assert.equal(
    buildCurrentJob({ workOrder: wo(), technicianId: TECH, siteResolver: null }).context.site.state,
    CUSTOMER_IDENTITY.NOT_AUTHORIZED);
  assert.equal(
    buildCurrentJob({ workOrder: wo(), technicianId: TECH, siteResolver: () => "  " }).context.site.state,
    CUSTOMER_IDENTITY.UNRESOLVED);
  assert.equal(
    buildCurrentJob({ workOrder: wo({ locationId: null }), technicianId: TECH, siteResolver: () => "X" })
      .context.site.state,
    CUSTOMER_IDENTITY.ABSENT);
});

test("neither raw id is ever used as a display value", () => {
  const job = buildCurrentJob({
    workOrder: wo(), technicianId: TECH,
    customerResolver: () => null, siteResolver: () => null,
  });
  assert.equal(job.context.customer.name, null);
  assert.equal(job.context.site.label, null);
  assert.notEqual(job.context.customer.name, job.context.customer.customerId);
  assert.notEqual(job.context.site.label, job.context.site.locationId);
});

test("while the trusted read is in flight, no identity claim is asserted", () => {
  const job = buildCurrentJob({ workOrder: wo(), technicianId: TECH, contextPending: true });
  // Reporting "unavailable to your role" before the answer is known would be a
  // lie that corrects itself.
  assert.ok(!job.attention.some((a) => a.key.startsWith("customer-")));
  assert.equal(job.context.contextPending, true);
});

test("the resolver output creates no second authority -- readiness and next action are untouched", () => {
  const withCustomer = buildCurrentJob({
    workOrder: wo(), technicianId: TECH,
    plannedParts: [{ partId: "PRT-1", qtyPlanned: 1 }],
    customerResolver: () => "Harbor Grill", siteResolver: () => "Downtown",
  });
  const without = buildCurrentJob({
    workOrder: wo(), technicianId: TECH,
    plannedParts: [{ partId: "PRT-1", qtyPlanned: 1 }],
  });
  // Customer identity is CONTEXT, never mixed into parts-readiness semantics.
  assert.deepEqual(withCustomer.readiness, without.readiness);
  assert.deepEqual(withCustomer.nextAction, without.nextAction);
  assert.equal(withCustomer.state.status, without.state.status);
});
