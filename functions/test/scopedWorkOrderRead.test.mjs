// The scoped Work Order read seam — proved by EXECUTION.
//
// This is the one read in the system whose authority is NOT global. Two populations, two
// predicates, and a scope the server derives rather than accepts. Every property below is about
// what the caller CANNOT do, so each is exercised against a fake Firestore that records the query
// actually built — a dropped predicate and an applied one both return rows, and only the recorded
// clauses tell them apart.
import test from "node:test";
import assert from "node:assert/strict";
import {
  WORK_ORDER_COUNT_CEILING,
  WORK_ORDER_MODES,
  countScopedWorkOrders,
  readScopedWorkOrderById,
  readScopedWorkOrders,
  resolveWorkOrderScope,
} from "../lib/workOrder/scopedWorkOrderReadService.js";

const GLOBAL_UID = "uid-dispatcher";
const TECH_UID = "uid-technician";
const TECH_ID = "tech-7";

function fakeDb({ docs = [], users = {}, countOverride = null, captured = {} } = {}) {
  captured.collections = [];
  const makeQuery = (name, clauses = []) => ({
    where(field, op, value) {
      const next = [...clauses, { field: String(field), op, value }];
      captured.clauses = next;
      return makeQuery(name, next);
    },
    orderBy(field, dir) {
      captured.orderBy = [...(captured.orderBy ?? []), [String(field), dir]];
      return makeQuery(name, clauses);
    },
    limit(n) {
      captured.limit = n;
      return makeQuery(name, clauses);
    },
    count() {
      return { async get() { return { data: () => ({ count: countOverride ?? docs.length }) }; } };
    },
    async get() {
      return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
    },
  });
  return {
    collection(name) {
      captured.collections.push(name);
      return {
        ...makeQuery(name),
        doc(id) {
          return {
            async get() {
              if (name === "users") {
                const u = users[id];
                return { exists: Boolean(u), data: () => u };
              }
              const found = docs.find((d) => d.id === id);
              // `id` included: a real DocumentSnapshot carries it, and the service reads snap.id to
              // put the authoritative document id LAST over the stored data.
              return { id, exists: Boolean(found), data: () => found?.data };
            },
          };
        },
      };
    },
  };
}

const grants = (map) => async (uid, ids) => Object.fromEntries(ids.map((i) => [i, Boolean(map[uid]?.[i])]));

const ACCESS = grants({
  [GLOBAL_UID]: { "workOrder.read": true },
  [TECH_UID]: { "workOrder.assigned.read": true },
  // Admin holds BOTH by derivation -- the case the global-first ordering exists for.
  "uid-admin": { "workOrder.read": true, "workOrder.assigned.read": true },
});

const USERS = { [TECH_UID]: { technicianId: TECH_ID }, "uid-admin": {} };

// ════════════════════ SCOPE RESOLUTION ════════════════════

test("an unauthorized actor is refused, and NEVER touches fieldops_wos", async () => {
  // Not merely "is refused". A refusal that had already run the query still ran it -- and the cost,
  // latency and logs of that query disclose the size of a set the caller may not see.
  const captured = {};
  const db = fakeDb({ captured, users: USERS });
  await assert.rejects(
    () => readScopedWorkOrders({ actorUid: "stranger", mode: "index" }, { db, resolveAccess: ACCESS }),
    /may not read work orders/,
  );
  assert.ok(!captured.collections.includes("fieldops_wos"), `touched: ${captured.collections.join(", ")}`);
});

test("global is resolved BEFORE self, so an admin holding both is not scoped to a technician", async () => {
  // Admin derives the entire catalogue and therefore holds workOrder.assigned.read too. Resolving
  // self first would scope an administrator to a technician identity they do not have -- returning
  // nothing, with no error. This is the ordering that prevents it.
  const db = fakeDb({ users: USERS });
  assert.deepEqual(await resolveWorkOrderScope("uid-admin", { db, resolveAccess: ACCESS }), { kind: "GLOBAL" });
});

test("a technician's identity is resolved SERVER-SIDE and is not an input", async () => {
  const db = fakeDb({ users: USERS });
  assert.deepEqual(await resolveWorkOrderScope(TECH_UID, { db, resolveAccess: ACCESS }), {
    kind: "ASSIGNED",
    technicianId: TECH_ID,
  });
  // No input shape accepts a technician id at all: supplying one is an unknown parameter.
  const captured = {};
  await assert.rejects(
    () =>
      readScopedWorkOrders(
        { actorUid: TECH_UID, mode: "index", params: { assignedTechId: "tech-someone-else" } },
        { db: fakeDb({ captured, users: USERS }), resolveAccess: ACCESS },
      ),
    /is not a parameter of mode "index"/,
  );
});

test("a principal holding the assigned capability with NO technician linkage sees nothing, and is told", async () => {
  // Falling back to an unscoped read here would be the entire defect this seam prevents.
  const db = fakeDb({ users: { [TECH_UID]: {} } });
  await assert.rejects(
    () => resolveWorkOrderScope(TECH_UID, { db, resolveAccess: ACCESS }),
    /no technician identity is linked/,
  );
});

test("a throwing resolver DENIES rather than allowing", async () => {
  const db = fakeDb({ users: USERS });
  await assert.rejects(
    () =>
      resolveWorkOrderScope(TECH_UID, {
        db,
        resolveAccess: async () => {
          throw new Error("feed down");
        },
      }),
    /authorization could not be resolved/,
  );
});

// ════════════════════ THE SCOPE IS FORCED IN ════════════════════

test("a technician's query is INTERSECTED with their assignment, never replaced by it", async () => {
  // "Work orders for equipment X" becomes "...that are also assigned to me" -- exactly what the
  // retired Rules produced. Widening it to all work orders for equipment X would expose other
  // technicians' work; replacing it with "all my work" would answer a different question.
  const captured = {};
  const db = fakeDb({ captured, users: USERS });
  await readScopedWorkOrders(
    { actorUid: TECH_UID, mode: "byEquipment", params: { equipmentId: "eq-1" } },
    { db, resolveAccess: ACCESS },
  );
  assert.deepEqual(captured.clauses, [
    { field: "equipmentId", op: "==", value: "eq-1" },
    { field: "assignedTechId", op: "==", value: TECH_ID },
  ]);
});

test("a global reader gets NO assignment predicate", async () => {
  const captured = {};
  const db = fakeDb({ captured, users: USERS });
  await readScopedWorkOrders(
    { actorUid: GLOBAL_UID, mode: "byEquipment", params: { equipmentId: "eq-1" } },
    { db, resolveAccess: ACCESS },
  );
  assert.deepEqual(captured.clauses, [{ field: "equipmentId", op: "==", value: "eq-1" }]);
});

test("the caller cannot omit, substitute or override the assignment predicate", async () => {
  const db = fakeDb({ users: USERS });
  // There is no parameter for it on any mode but ONE, and that one is the whole point of the
  // distinction: `assigned` names WHOSE assignments are wanted, which is a business input. It is
  // not authority, and it cannot be used as any -- a principal scoped to their own assignments
  // may name only themselves and is refused otherwise, proved by execution in
  // test/scopedWorkOrderPaging.test.mjs. Every OTHER mode must stay unable to mention the field
  // at all, because on those modes the predicate is the server's alone.
  const NAMED_EXCEPTION = "assigned";
  for (const [modeId, mode] of Object.entries(WORK_ORDER_MODES)) {
    if (modeId === NAMED_EXCEPTION) continue;
    for (const name of Object.keys(mode.params)) {
      assert.notEqual(mode.params[name].field, "assignedTechId", `mode "${modeId}" exposes the assignment field`);
    }
  }
  // And the exception is exactly one mode, so this contract cannot be widened by adding another.
  const exposing = Object.entries(WORK_ORDER_MODES)
    .filter(([, mode]) => Object.values(mode.params).some((param) => param.field === "assignedTechId"))
    .map(([modeId]) => modeId);
  assert.deepEqual(exposing, [NAMED_EXCEPTION]);
  // And an unknown parameter is refused by name rather than ignored.
  await assert.rejects(
    () =>
      readScopedWorkOrders(
        { actorUid: TECH_UID, mode: "byEquipment", params: { equipmentId: "eq-1", status: "OPEN" } },
        { db, resolveAccess: ACCESS },
      ),
    /"status" is not a parameter of mode "byEquipment"/,
  );
});

test("an unregistered mode is refused", async () => {
  const db = fakeDb({ users: USERS });
  await assert.rejects(
    () => readScopedWorkOrders({ actorUid: GLOBAL_UID, mode: "everything" }, { db, resolveAccess: ACCESS }),
    /is not a work order query mode/,
  );
});

// ════════════════════ THE QUERY VOCABULARY IS THE SERVER'S ════════════════════

test("accountScheduled fixes its own status -- the caller cannot choose it", async () => {
  const captured = {};
  const db = fakeDb({ captured, users: USERS });
  await readScopedWorkOrders(
    { actorUid: GLOBAL_UID, mode: "accountScheduled", params: { accountId: "acct-1" } },
    { db, resolveAccess: ACCESS },
  );
  assert.deepEqual(captured.clauses, [
    { field: "customerId", op: "==", value: "acct-1" },
    { field: "status", op: "==", value: "SCHEDULED" },
  ]);
});

test("a sort TOKEN resolves to the field the SERVER chose, and an unregistered token is refused", async () => {
  const captured = {};
  const db = fakeDb({ captured, users: USERS });
  await readScopedWorkOrders({ actorUid: GLOBAL_UID, mode: "index", sortKey: "woNumberAsc" }, { db, resolveAccess: ACCESS });
  assert.equal(captured.orderBy[0][0], "woNumber");
  assert.ok(!JSON.stringify(captured.orderBy).includes("woNumberAsc"), "the token must never reach orderBy");

  await assert.rejects(
    () => readScopedWorkOrders({ actorUid: GLOBAL_UID, mode: "index", sortKey: "secretField" }, { db, resolveAccess: ACCESS }),
    /is not an offered sort/,
  );
  // A mode with one fixed ordering refuses a sort request rather than ignoring it.
  await assert.rejects(
    () =>
      readScopedWorkOrders(
        { actorUid: GLOBAL_UID, mode: "byEquipment", params: { equipmentId: "e" }, sortKey: "woNumberAsc" },
        { db, resolveAccess: ACCESS },
      ),
    /does not offer a choice of sort/,
  );
});

test("the search prefix builds a REAL starts-with range, executed not eyeballed", async () => {
  // The  sentinel was written as a literal character in this file's first draft and had to be
  // converted to an escape. If it is ever lost the upper bound collapses onto the term and this
  // fails -- which is the only way that defect is visible, since a search matching only exact
  // numbers reads as "no results yet" rather than as a bug.
  const captured = {};
  const db = fakeDb({ captured, users: USERS });
  await readScopedWorkOrders({ actorUid: GLOBAL_UID, mode: "search", params: { term: "WO-12" } }, { db, resolveAccess: ACCESS });
  const range = captured.clauses.filter((c) => c.field === "woNumber");
  assert.equal(range.length, 2, "a prefix must become TWO bounds");
  assert.equal(range.find((c) => c.op === ">=").value, "WO-12");
  const upper = range.find((c) => c.op === "<=").value;
  assert.notEqual(upper, "WO-12", "an upper bound equal to the term is an EQUALITY, not a prefix");
  assert.ok(upper.startsWith("WO-12"));
  assert.ok(upper > "WO-12zzzz", "the upper bound must sort after any ordinary continuation");
});

test("hasMore is OBSERVED with a probe row, and the probe never reaches the caller", async () => {
  const docs = Array.from({ length: 4 }, (_, i) => ({ id: `wo-${i}`, data: { woNumber: `WO-${i}` } }));
  const captured = {};
  const db = fakeDb({ docs, captured, users: USERS });
  const page = await readScopedWorkOrders({ actorUid: GLOBAL_UID, mode: "index", pageSize: 3 }, { db, resolveAccess: ACCESS });
  assert.equal(captured.limit, 4, "one MORE than the page");
  assert.equal(page.items.length, 3);
  assert.equal(page.hasMore, true);
});

test("the storage identity wins over a stored `id` field", async () => {
  const db = fakeDb({
    docs: [{ id: "AUTHORITATIVE", data: { id: "CONFLICTING", woNumber: "WO-1" } }],
    users: USERS,
  });
  const page = await readScopedWorkOrders({ actorUid: GLOBAL_UID, mode: "index" }, { db, resolveAccess: ACCESS });
  assert.equal(page.items[0].id, "AUTHORITATIVE");
  assert.equal(page.items[0].woNumber, "WO-1");
});

// ════════════════════ BY ID ════════════════════

test("knowing a Work Order id does not bypass scope", async () => {
  const docs = [{ id: "wo-1", data: { assignedTechId: "tech-someone-else", woNumber: "WO-1" } }];
  const db = fakeDb({ docs, users: USERS });
  // DENIED, not "not found" -- the contract this replaces distinguished the two, and Rules produced
  // a permission-denied for an unassigned technician.
  await assert.rejects(
    () => readScopedWorkOrderById({ actorUid: TECH_UID, workOrderId: "wo-1" }, { db, resolveAccess: ACCESS }),
    /not assigned to you/,
  );
  // The same record is readable by a global actor.
  const seen = await readScopedWorkOrderById({ actorUid: GLOBAL_UID, workOrderId: "wo-1" }, { db, resolveAccess: ACCESS });
  assert.equal(seen.workOrder.id, "wo-1");
});

test("a technician CAN read a work order assigned to them", async () => {
  const docs = [{ id: "wo-2", data: { assignedTechId: TECH_ID, woNumber: "WO-2" } }];
  const db = fakeDb({ docs, users: USERS });
  const got = await readScopedWorkOrderById({ actorUid: TECH_UID, workOrderId: "wo-2" }, { db, resolveAccess: ACCESS });
  assert.equal(got.workOrder.id, "wo-2");
  assert.equal(got.scope, "ASSIGNED");
});

test("a confirmed absence is null with no error, distinct from a scope refusal", async () => {
  const db = fakeDb({ docs: [], users: USERS });
  const got = await readScopedWorkOrderById({ actorUid: TECH_UID, workOrderId: "missing" }, { db, resolveAccess: ACCESS });
  assert.equal(got.workOrder, null);
});

// ════════════════════ THE AGGREGATE ════════════════════

test("the count uses the SAME authority and the SAME scope as the read", async () => {
  const captured = {};
  const db = fakeDb({ captured, users: USERS, countOverride: 3 });
  const res = await countScopedWorkOrders(
    { actorUid: TECH_UID, mode: "openDemand", params: { statuses: ["OPEN"] } },
    { db, resolveAccess: ACCESS },
  );
  assert.equal(res.scope, "ASSIGNED");
  // The assignment predicate is in the COUNT's query too -- not a separate authorization path.
  assert.deepEqual(captured.clauses, [
    { field: "status", op: "in", value: ["OPEN"] },
    { field: "assignedTechId", op: "==", value: TECH_ID },
  ]);
  assert.equal(res.count, 3);
  assert.equal(res.atLeast, false);
});

test("an unauthorized count refuses before touching the collection", async () => {
  const captured = {};
  const db = fakeDb({ captured, users: USERS });
  await assert.rejects(
    () => countScopedWorkOrders({ actorUid: "stranger", mode: "index" }, { db, resolveAccess: ACCESS }),
    /may not read work orders/,
  );
  assert.ok(!captured.collections.includes("fieldops_wos"));
});

test("the count is bounded and says when it hit the bound", async () => {
  const captured = {};
  const db = fakeDb({ captured, users: USERS, countOverride: WORK_ORDER_COUNT_CEILING });
  const res = await countScopedWorkOrders({ actorUid: GLOBAL_UID, mode: "index" }, { db, resolveAccess: ACCESS });
  assert.equal(res.atLeast, true, "a capped number must never be rendered as an exact one");
  assert.equal(captured.limit, WORK_ORDER_COUNT_CEILING);
});
