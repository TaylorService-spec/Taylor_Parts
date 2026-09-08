// The session-identity projection — "which employee am I", resolved server-side.
//
// This replaced the browser's own read of users/{uid} and employees/{employeeId}. The properties
// worth pinning are all about what the CALLER cannot influence and what the three linkage states
// must keep meaning, because both are the kind of thing a later simplification collapses.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildEmployeeSessionProjection,
  linkageIsReciprocal,
  resolveEmployeeSessionProjection,
} from "../lib/access/employeeSessionProjection.js";

const UID = "uid-1";
const EMP = "emp-1";

function fakeDb({ users = {}, employees = {}, captured = {} } = {}) {
  captured.reads = [];
  return {
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              captured.reads.push(`${name}/${id}`);
              const store = name === "users" ? users : employees;
              const data = store[id];
              return { id, exists: Boolean(data), data: () => data };
            },
          };
        },
      };
    },
  };
}

const silent = () => {};

// ============================ the three linkage states ============================

test("no employeeId is a valid migration state, not an error", async () => {
  const captured = {};
  const db = fakeDb({ captured, users: { [UID]: { role: "technician" } } });
  const out = await resolveEmployeeSessionProjection(UID, { db, warn: silent });
  assert.deepEqual(out, {
    role: "technician",
    employeeId: null,
    displayName: null,
    operationalRoles: [],
    employmentStatus: null,
  });
  // No Employee read is even attempted: there is nothing to look up.
  assert.deepEqual(captured.reads, [`users/${UID}`]);
});

test("a BROKEN LINK keeps the employeeId and grants no operational identity", async () => {
  // Deliberately NOT collapsed into the state above. "Never provisioned" and "provisioned, and the
  // record is gone" are different facts, and hiding the second behind the first turns a data fault
  // into something that looks like an ordinary un-migrated account.
  const warnings = [];
  const db = fakeDb({ users: { [UID]: { role: "admin", employeeId: EMP } }, employees: {} });
  const out = await resolveEmployeeSessionProjection(UID, { db, warn: (m) => warnings.push(m) });
  assert.equal(out.employeeId, EMP, "the broken link stays visible");
  assert.deepEqual(out.operationalRoles, []);
  assert.equal(out.employmentStatus, null);
  assert.equal(warnings.length, 1, "a broken link is discoverable, not silently swallowed");
  assert.ok(warnings[0].includes(EMP));
});

test("a resolved link returns the identity", async () => {
  const db = fakeDb({
    users: { [UID]: { role: "dispatcher", employeeId: EMP } },
    employees: {
      [EMP]: {
        userId: UID,
        displayName: "Dana",
        operationalRoles: ["PARTS_MANAGER"],
        employmentStatus: "ACTIVE",
      },
    },
  });
  assert.deepEqual(await resolveEmployeeSessionProjection(UID, { db, warn: silent }), {
    role: "dispatcher",
    employeeId: EMP,
    displayName: "Dana",
    operationalRoles: ["PARTS_MANAGER"],
    employmentStatus: "ACTIVE",
  });
});

// ============================ reciprocity ============================

test("a record naming a DIFFERENT principal grants nothing", async () => {
  const warnings = [];
  const db = fakeDb({
    users: { [UID]: { role: "admin", employeeId: EMP } },
    employees: { [EMP]: { userId: "somebody-else", displayName: "Not You", operationalRoles: ["PARTS_MANAGER"], employmentStatus: "ACTIVE" } },
  });
  const out = await resolveEmployeeSessionProjection(UID, { db, warn: (m) => warnings.push(m) });
  assert.equal(out.displayName, null, "one person's identity must never resolve for another");
  assert.deepEqual(out.operationalRoles, []);
  assert.equal(warnings.length, 1);
  // The diagnostic names the id and nothing else: a warning about a record must not become a way
  // to read it.
  assert.ok(!warnings[0].includes("Not You"));
});

test("a record with NO userId is the un-migrated shape, and still resolves", () => {
  // Refusing it would log people out of their own operational roles to tighten a check against a
  // field nothing had written yet. Absence is not contradiction.
  assert.equal(linkageIsReciprocal({}, UID), true);
  assert.equal(linkageIsReciprocal({ userId: null }, UID), true);
  assert.equal(linkageIsReciprocal({ userId: "" }, UID), true);
  assert.equal(linkageIsReciprocal({ userId: UID }, UID), true);
  assert.equal(linkageIsReciprocal({ userId: "other" }, UID), false);
});

// ============================ the caller says nothing ============================

test("the projection is built from the STORED record, never from a caller's claim", () => {
  // Every field comes from the two documents. There is no parameter for a role, an employmentStatus
  // or an operationalRoles list anywhere in the input shape, and the builder type-checks what it
  // finds rather than trusting it.
  const out = buildEmployeeSessionProjection(42, EMP, {
    displayName: 7,
    operationalRoles: "PARTS_MANAGER",
    employmentStatus: { forged: true },
  });
  assert.deepEqual(out, {
    role: null,
    employeeId: EMP,
    displayName: null,
    operationalRoles: [],
    employmentStatus: null,
  });
});

test("the callable accepts no payload at all", () => {
  // Asserted on the SOURCE: the adapter must not grow a uid, an employeeId or anything else it
  // could be talked into trusting. A mocked test would pass while the real one read request.data.
  const src = readFileSync(new URL("../src/access/employeeSessionCallable.ts", import.meta.url), "utf8");
  assert.ok(src.includes("request.auth?.uid"), "the uid comes from authentication");
  assert.ok(!/request\.data/.test(src), "the callable must never read a payload");
});

test("an empty employeeId string is treated as absent, not as an id", async () => {
  const captured = {};
  const db = fakeDb({ captured, users: { [UID]: { role: "admin", employeeId: "" } } });
  const out = await resolveEmployeeSessionProjection(UID, { db, warn: silent });
  assert.equal(out.employeeId, null);
  assert.deepEqual(captured.reads, [`users/${UID}`], "no lookup of an empty id");
});
