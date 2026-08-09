import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { CUSTOMER_IDENTITY, resolveCustomerIdentity } from "../src/domain/fieldCurrentJob.js";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const SURFACES = {
  "dispatcher preview": read("../src/modules/dispatcherBoard/WorkOrderPreview.jsx"),
  "technician card": read("../src/modules/technicianDashboard/TechnicianWorkOrderCard.jsx"),
  "technician detail": read("../src/modules/technicianDashboard/TechnicianWorkOrderDetail.jsx"),
};
const component = read("../src/shared/ui/CustomerIdentity.jsx");

test("no Work Order surface renders the raw customerId as the customer", () => {
  for (const [name, src] of Object.entries(SURFACES)) {
    assert.doesNotMatch(src, /Customer: \{workOrder\.customerId\}/, `${name} must not print the raw id as the name`);
    assert.match(src, /<CustomerIdentity/, `${name} must render through the shared identity component`);
  }
});

test("each surface resolves through its OWN authorized transport", () => {
  // Technicians have no accounts read; they must use the F1 trusted projection.
  for (const name of ["technician card", "technician detail"]) {
    assert.match(SURFACES[name], /useWorkOrderFieldContext/, `${name} must use the trusted WorkOrder-keyed projection`);
    assert.doesNotMatch(SURFACES[name], /useAccountNames/, `${name} must NOT read accounts directly`);
  }
  // Dispatcher holds canonical accounts read.
  assert.match(SURFACES["dispatcher preview"], /useAccountNames/);
});

test("a denial passes NO resolver, so it can never be mistaken for absence", () => {
  for (const name of ["technician card", "technician detail"]) {
    assert.match(SURFACES[name], /contextDenied && fieldContext/, `${name} must withhold the resolver on denial`);
  }
});

test("the four states stay distinct and none renders blank", () => {
  const seen = new Set();
  for (const state of Object.values(CUSTOMER_IDENTITY)) {
    if (state === CUSTOMER_IDENTITY.RESOLVED) continue;
    const key = `[CUSTOMER_IDENTITY.${state}]:`;
    const at = component.indexOf(key);
    assert.notEqual(at, -1, `${state} must have its own copy`);
    const line = component.slice(at + key.length, component.indexOf(String.fromCharCode(10), at));
    const copy = line.slice(line.indexOf('"') + 1, line.lastIndexOf('"'));
    assert.ok(copy.trim().length > 0, `${state} must not be blank`);
    assert.ok(!seen.has(copy), `${state} must not reuse another state's wording`);
    seen.add(copy);
  }
  assert.equal(seen.size, 3, "NOT_AUTHORIZED, ABSENT and UNRESOLVED must each read differently");
});

test("RESOLVED renders the name; every other state routes to labelled copy", () => {
  const resolved = resolveCustomerIdentity({ customerId: "acct-harbor" }, () => "Harbor Grill Restaurant Group");
  assert.equal(resolved.state, CUSTOMER_IDENTITY.RESOLVED);
  assert.equal(resolved.name, "Harbor Grill Restaurant Group");

  assert.equal(resolveCustomerIdentity({ customerId: "acct-harbor" }, null).state, CUSTOMER_IDENTITY.NOT_AUTHORIZED);
  assert.equal(resolveCustomerIdentity({}, () => "x").state, CUSTOMER_IDENTITY.ABSENT);
  assert.equal(resolveCustomerIdentity({ customerId: "acct-harbor" }, () => null).state, CUSTOMER_IDENTITY.UNRESOLVED);
});

test("the id may appear only as an explicitly labelled reference, never as the name", () => {
  assert.match(component, /reference: \{identity\.customerId\}/, "the id must be labelled a reference");
  assert.match(component, /showReference = false/, "referencing the id must be opt-in");
  // ABSENT has no id to show, and must never invent one.
  assert.match(component, /identity\.state !== CUSTOMER_IDENTITY\.ABSENT/);
});

test("the stale guidance that this needed denormalization or a Rules grant is corrected", () => {
  const hook = read("../src/hooks/useAccountNames.js");
  assert.match(hook, /useWorkOrderFieldContext/, "must point technician surfaces at the governed path");
  assert.doesNotMatch(hook, /needs a WorkOrder\s*\n?\/\/ customerName denormalization/, "stale advice must be gone");
});
