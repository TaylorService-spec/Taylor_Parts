// The technician create — the last direct client write, as a pure decision.
import test from "node:test";
import assert from "node:assert/strict";
import {
  TECHNICIAN_STATUS_AVAILABLE,
  buildTechnician,
} from "../lib/workOrder/technicianCommands.js";

test("the SERVER chooses the status; a caller cannot supply one at all", () => {
  // The retired rule was `isAdminOrDispatcher() && request.resource.data.status == 'available'`.
  // That second clause was part of the AUTHORITY, not a client convention -- it refused a create
  // starting a technician in any other state. The command does not validate a supplied status; it
  // does not read one, which removes the question of what happens when a caller sends something
  // else.
  for (const attempt of ["on_job", "off_shift", "superuser", "", null]) {
    const built = buildTechnician({ name: "Ada", status: attempt });
    assert.equal(built.status, TECHNICIAN_STATUS_AVAILABLE, `status "${String(attempt)}" must not survive`);
  }
});

test("the field set is CLOSED -- exactly what the client write produced, and nothing a caller adds", () => {
  // An open field set on a create is how a client starts populating fields no rule ever reviewed.
  const built = buildTechnician({
    name: "Ada",
    phone: "555",
    // None of these may reach the document.
    isAdmin: true,
    userId: "uid-someone",
    createdBy: "uid-someone",
  });
  assert.deepEqual(Object.keys(built).sort(), ["name", "phone", "status"]);
});

test("a name is required, and trimmed", () => {
  // Required HERE because this is now the only write path, and a bound only the UI applies is not
  // a bound.
  assert.equal(buildTechnician({ name: "  Ada  " }).name, "Ada");
  for (const bad of [{ name: "   " }, { name: "" }, {}, { name: 42 }, { name: null }]) {
    assert.throws(
      () => buildTechnician(bad),
      (e) => e.code === "NAME_REQUIRED",
      `${JSON.stringify(bad)} must be refused`,
    );
  }
});

test("an absent phone is stored as null, not as a missing key or an empty string", () => {
  // The client wrote `phone` straight through, undefined included. Normalising makes "we have no
  // phone for this technician" a stored fact rather than an absent one.
  assert.equal(buildTechnician({ name: "Ada" }).phone, null);
  assert.equal(buildTechnician({ name: "Ada", phone: "   " }).phone, null);
  assert.equal(buildTechnician({ name: "Ada", phone: " 555 " }).phone, "555");
});
