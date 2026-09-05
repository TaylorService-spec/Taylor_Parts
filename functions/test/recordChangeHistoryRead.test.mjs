// ADMINISTRATION USERS CONSOLIDATION -- the record-scoped Change History read, under test.
//
// The read is the half of this feature that decides what LEAVES the server, so what it does NOT
// return matters at least as much as what it does. The projection is an allow-list, and the test
// that proves it is the one asserting a field added to the Audit Event contract later does not
// appear here by default.
//
// Same in-memory double approach as employeeProfileCommands.test.mjs, and no emulator, for the
// same reason: a test that only runs when somebody remembers to start an emulator is a test that
// does not guard the property.
//
// Prerequisite: npm run build (this imports from ../lib).
import assert from "node:assert/strict";
import test from "node:test";

const {
  listRecordChangeHistory,
  READABLE_TARGET_TYPES,
  AUDIT_READ_CAPABILITY,
  InvalidInputError,
  UnauthorizedActorError,
} = await import("../lib/access/recordChangeHistoryReadService.js");

// A Firestore double supporting exactly what the service does: a two-clause equality query with an
// orderBy and a limit, plus getAll and one equality query with `in`.
function makeDb({ users = {}, roleAssignments = {}, auditEvents = {}, employees = {} } = {}) {
  const store = {
    users: new Map(Object.entries(users)),
    roleAssignments: new Map(Object.entries(roleAssignments)),
    auditEvents: new Map(Object.entries(auditEvents)),
    employees: new Map(Object.entries(employees)),
  };
  const asDocs = (map) => [...map.entries()].map(([id, data]) => ({ id, data: () => data }));

  function query(name, clauses = []) {
    return {
      where(field, op, value) {
        return query(name, [...clauses, [field, op, value]]);
      },
      orderBy(field, direction) {
        return {
          limit(n) {
            return {
              async get() {
                const rows = asDocs(store[name]).filter((d) =>
                  clauses.every(([f, op, v]) =>
                    op === "in" ? v.includes(d.data()[f]) : d.data()[f] === v,
                  ),
                );
                rows.sort((a, b) => {
                  const x = a.data()[field] ?? 0;
                  const y = b.data()[field] ?? 0;
                  return direction === "desc" ? y - x : x - y;
                });
                return { docs: rows.slice(0, n) };
              },
            };
          },
        };
      },
      async get() {
        return {
          docs: asDocs(store[name]).filter((d) =>
            clauses.every(([f, op, v]) => (op === "in" ? v.includes(d.data()[f]) : d.data()[f] === v)),
          ),
        };
      },
    };
  }

  return {
    collection(name) {
      return {
        doc: (id) => ({
          __collection: name,
          __id: id,
          id,
          async get() {
            return { id, exists: store[name].has(id), data: () => store[name].get(id) };
          },
        }),
        where: (f, op, v) => query(name).where(f, op, v),
        orderBy: (f, d) => query(name).orderBy(f, d),
      };
    },
    async getAll(...refs) {
      return refs.map((r) => ({
        id: r.__id,
        exists: store[r.__collection].has(r.__id),
        data: () => store[r.__collection].get(r.__id),
      }));
    },
  };
}

const ROLES = Object.freeze({
  auditor: { id: "auditor", name: "x", description: "x", permissions: [AUDIT_READ_CAPABILITY] },
  nobody: { id: "nobody", name: "x", description: "x", permissions: [] },
});

const EVENTS = {
  e1: {
    at: 1_000,
    actorUid: "actor-1",
    action: "updateEmployeeProfile",
    targetType: "employee",
    targetId: "emp-1",
    outcome: "applied",
    summary: 'Updated employee profile field "jobTitle".',
    fieldKey: "jobTitle",
    previousValue: "Service Technician",
    newValue: "Senior Service Technician",
    // Access-model internals that must NOT cross the wire.
    scope: { type: "global" },
    accessVersionAfter: 7,
    approverUid: "approver-9",
  },
  e2: {
    at: 3_000,
    actorUid: "actor-2",
    action: "setUserStatus",
    targetType: "employee",
    targetId: "emp-1",
    outcome: "applied",
    summary: "Set account status.",
  },
  other: {
    at: 9_000,
    actorUid: "actor-1",
    action: "updateEmployeeProfile",
    targetType: "employee",
    targetId: "emp-OTHER",
    outcome: "applied",
    summary: "Someone else's record.",
    fieldKey: "jobTitle",
    previousValue: null,
    newValue: "x",
  },
};

const seeded = (roleId = "auditor") =>
  makeDb({
    users: { "actor-1": { accessVersion: 1, displayName: "Admin User" } },
    roleAssignments: {
      a1: {
        id: "a1",
        principalUid: "actor-1",
        roleId,
        scope: { type: "global" },
        status: "active",
        accessVersionAtGrant: 1,
      },
    },
    auditEvents: EVENTS,
    // actor-2 has no users document with a name; the employee record carries one.
    employees: { "emp-9": { userId: "actor-2", displayName: "Mike Jones" } },
  });

const DEPS = (db) => ({ db, roles: ROLES });
const INPUT = { actorUid: "actor-1", targetType: "employee", targetId: "emp-1" };

test("an actor without audit.event.read is denied, and reads nothing", async () => {
  await assert.rejects(
    () => listRecordChangeHistory(INPUT, DEPS(seeded("nobody"))),
    (err) => err instanceof UnauthorizedActorError,
  );
});

test("a denied READ writes no Audit Event of its own", async () => {
  // Deliberate, and the reason is sharper than "reads are not mutations": an audited denied read of
  // the audit trail would let an unauthorized caller append to the trail they were refused. The
  // double has no batch(), so any attempt to write would throw rather than pass quietly.
  const db = seeded("nobody");
  await assert.rejects(() => listRecordChangeHistory(INPUT, DEPS(db)), UnauthorizedActorError);
});

test("targetType is a CLOSED list -- not whatever the caller sends", async () => {
  assert.deepEqual([...READABLE_TARGET_TYPES], ["employee"]);
  await assert.rejects(
    () => listRecordChangeHistory({ ...INPUT, targetType: "user" }, DEPS(seeded())),
    (err) => err instanceof InvalidInputError,
  );
  await assert.rejects(
    () => listRecordChangeHistory({ ...INPUT, targetId: "" }, DEPS(seeded())),
    (err) => err instanceof InvalidInputError,
  );
  await assert.rejects(
    () => listRecordChangeHistory({ ...INPUT, limit: 5000 }, DEPS(seeded())),
    (err) => err instanceof InvalidInputError,
  );
});

test("only THIS record's events are returned, newest first", async () => {
  const rows = await listRecordChangeHistory(INPUT, DEPS(seeded()));
  assert.deepEqual(rows.map((r) => r.id), ["e2", "e1"]);
  assert.ok(rows.every((r) => r.id !== "other"), "another record's history must never be returned");
});

test("the field-change facts survive the projection, and the access internals do not", async () => {
  const [, jobTitle] = await listRecordChangeHistory(INPUT, DEPS(seeded()));
  assert.equal(jobTitle.fieldKey, "jobTitle");
  assert.equal(jobTitle.previousValue, "Service Technician");
  assert.equal(jobTitle.newValue, "Senior Service Technician");
  assert.equal(jobTitle.eventType, "updateEmployeeProfile");
  assert.equal(jobTitle.outcome, "applied");
  assert.equal(jobTitle.occurredAt, 1_000);

  // THE ALLOW-LIST. Scope, accessVersion and the approver are access-model internals with no place
  // in a record's change history, and a field added to the Audit Event contract later must not
  // arrive here by default.
  assert.deepEqual(Object.keys(jobTitle).sort(), [
    "changedById",
    "changedByLabel",
    "eventType",
    "fieldKey",
    "id",
    "newValue",
    "occurredAt",
    "outcome",
    "previousValue",
    "summary",
  ]);
});

test("an event that changed no single field is still returned, with a null fieldKey", async () => {
  // An account enable/disable belongs in this person's history, and dropping it would make the
  // trail read as though it never happened.
  const [status] = await listRecordChangeHistory(INPUT, DEPS(seeded()));
  assert.equal(status.eventType, "setUserStatus");
  assert.equal(status.fieldKey, null);
  assert.equal(status.previousValue, null);
});

test("an actor resolves to a NAME, from users first and the employee record second", async () => {
  const rows = await listRecordChangeHistory(INPUT, DEPS(seeded()));
  const byActor = Object.fromEntries(rows.map((r) => [r.changedById, r.changedByLabel]));
  assert.equal(byActor["actor-1"], "Admin User");
  // actor-2 has no users displayName; the authoritative workforce record supplies it.
  assert.equal(byActor["actor-2"], "Mike Jones");
});

test("an unresolvable actor is null, never the raw uid", async () => {
  const db = makeDb({
    users: { "actor-1": { accessVersion: 1 } },
    roleAssignments: {
      a1: { id: "a1", principalUid: "actor-1", roleId: "auditor", scope: { type: "global" }, status: "active", accessVersionAtGrant: 1 },
    },
    auditEvents: { e1: { ...EVENTS.e1, actorUid: "ghost-uid" } },
  });
  const [row] = await listRecordChangeHistory(INPUT, DEPS(db));
  assert.equal(row.changedByLabel, null, "a uid shown to a person as a name is the defect, not the fallback");
  assert.equal(row.changedById, "ghost-uid");
});
