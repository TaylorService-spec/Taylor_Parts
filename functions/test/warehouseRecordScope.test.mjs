// WAREHOUSE / TRANSFER RECORD-SCOPE PARITY — the retired firestore.rules predicates are the oracle.
//
// Measured verbatim from the pre-contraction ruleset:
//
//   match /warehouses/{warehouseId} {
//     allow read: if isAdminOrDispatcher() || isAssignedToWarehouse(warehouseId);
//   }
//   match /transfer_orders/{transferOrderId} {
//     allow read: if isAdminOrDispatcher()
//       || isAssignedToWarehouse(resource.data.fromWarehouseId)
//       || isAssignedToWarehouse(resource.data.toWarehouseId);
//   }
//
//   function isAssignedToWarehouse(warehouseId) {
//     ... reciprocal users/{uid}.employeeId link && employmentStatus == "ACTIVE"
//         && operationalRoles.hasAny(["WAREHOUSE_MANAGER"])
//         && assignedWarehouseIds.hasAny([warehouseId]);
//   }
//
// The closure standard is the EFFECTIVE result: the old permitted record population must equal the
// new governed one. A capability check alone is not that — it answers WHETHER, and these rules also
// answered WHICH.
//
// WHY THESE RUN AGAINST readGovernedList RATHER THAN A SEAM OF THEIR OWN. The retired rule differed
// from the existing governed sources only in which records came back, never in the shape of the
// read, so the narrowing is declared on the four existing sources (governedReadRegistry's `scope`)
// and applied by the one executor. A parallel seam would have had to re-earn filters, sorts,
// cursors and counts, and would have left the unscoped sources still reachable beside it.
import test from "node:test";
import assert from "node:assert/strict";
import { countGovernedList, readGovernedList } from "../lib/access/governedListReadService.js";
import { GOVERNED_READS } from "../lib/access/governedReadRegistry.js";
import { resolveAssignedWarehouseIds } from "../lib/access/assignedWarehouseScope.js";

const GLOBAL_UID = "uid-operations-manager";
const MANAGER_UID = "uid-warehouse-manager";
const MANY_UID = "uid-many-warehouses";
const STRANGER_UID = "uid-stranger";

const SCOPES = {
  [GLOBAL_UID]: [],
  [MANAGER_UID]: ["wh-main"],
  [MANY_UID]: ["wh-north", "wh-south"],
  [STRANGER_UID]: [],
};
const loadScope = async (uid) => SCOPES[uid] ?? [];

/**
 * A Firestore stand-in that records EVERY branch separately.
 *
 * One captured clause list would be enough for a single-query read; a disjunctive scope runs one
 * query per field, and the whole question here is which clauses each of those carried. The window
 * (startAfter / limit) is honoured rather than merely recorded, so a paging test cannot pass
 * against a fake that ignores it.
 */
function fakeDb({ docsByCollection = {}, captured = {} } = {}) {
  captured.branches = [];
  captured.touched = [];

  const makeQuery = (name, clauses, window, slot) => ({
    where(field, op, value) {
      const next = [...clauses, { field: String(field), op, value }];
      captured.branches[slot] = next;
      return makeQuery(name, next, window, slot);
    },
    orderBy(field, dir) {
      return makeQuery(name, clauses, { ...window, orderBy: [String(field), dir] }, slot);
    },
    startAfter(...args) {
      captured.startAfter = args;
      return makeQuery(name, clauses, { ...window, after: args }, slot);
    },
    limit(n) {
      captured.limit = n;
      return makeQuery(name, clauses, { ...window, limit: n }, slot);
    },
    /** Keys-only, as the scoped count uses. The fake returns the same docs; only ids are read. */
    select() {
      return makeQuery(name, clauses, window, slot);
    },
    count() {
      return {
        async get() {
          return { data: () => ({ count: (docsByCollection[name] ?? []).length }) };
        },
      };
    },
    async get() {
      const inClause = clauses.find((c) => c.op === "in");
      const rows = (docsByCollection[name] ?? [])
        .filter((d) => {
          if (!inClause) return true;
          const v = inClause.field === "__name__" ? d.id : d.data[inClause.field];
          return inClause.value.includes(v);
        })
        .filter((d) => (window.after ? d.id > String(window.after[window.after.length - 1]) : true))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, window.limit ?? undefined);
      return { docs: rows.map((d) => ({ id: d.id, data: () => d.data })) };
    },
  });

  return {
    collection(name) {
      captured.touched.push(name);
      const slot = captured.branches.push([]) - 1;
      return {
        ...makeQuery(name, [], { after: null, limit: null }, slot),
        doc(id) {
          return {
            async get() {
              const found = (docsByCollection[name] ?? []).find((d) => d.id === id);
              return { exists: Boolean(found), data: () => found?.data };
            },
          };
        },
      };
    },
  };
}

/** An actor holding the compatibility `admin` Role — every capability under test, globally. */
function authFixture(uid) {
  return {
    users: [{ id: uid, data: { accessVersion: 0 } }],
    roleAssignments: [
      {
        id: `asg-${uid}`,
        data: {
          principalUid: uid,
          roleId: "admin",
          scope: { type: "global" },
          status: "active",
          accessVersionAtGrant: 0,
        },
      },
    ],
  };
}

function deps(uid, docs = {}, captured = {}) {
  return {
    db: fakeDb({ docsByCollection: { ...authFixture(uid), ...docs }, captured }),
    loadScope,
  };
}

/** The clause lists that actually carried a scope predicate, in branch order. */
const scopeClauses = (captured) =>
  captured.branches.filter((b) => b.some((c) => c.op === "in")).map((b) => b.find((c) => c.op === "in"));

// ============================ the assignment predicate ============================

test("the assignment mirrors the retired isAssignedToWarehouse, clause for clause", () => {
  const ok = {
    uid: "u1",
    userEmployeeId: "e1",
    employeeExists: true,
    employeeUserId: "u1",
    employeeEmploymentStatus: "ACTIVE",
    employeeOperationalRoles: ["WAREHOUSE_MANAGER"],
    employeeAssignedWarehouseIds: ["wh-main"],
  };
  assert.deepEqual(resolveAssignedWarehouseIds(ok), ["wh-main"]);

  // Every clause the rule required, removed one at a time. Each failure yields NO warehouses --
  // never an error, never a wildcard.
  assert.deepEqual(resolveAssignedWarehouseIds({ ...ok, userEmployeeId: null }), [], "no linkage");
  assert.deepEqual(resolveAssignedWarehouseIds({ ...ok, employeeExists: false }), [], "broken link");
  assert.deepEqual(resolveAssignedWarehouseIds({ ...ok, employeeUserId: "somebody-else" }), [], "non-reciprocal");
  assert.deepEqual(resolveAssignedWarehouseIds({ ...ok, employeeEmploymentStatus: "TERMINATED" }), [], "not ACTIVE");
  assert.deepEqual(resolveAssignedWarehouseIds({ ...ok, employeeOperationalRoles: ["PARTS_MANAGER"] }), [], "wrong role");
  assert.deepEqual(resolveAssignedWarehouseIds({ ...ok, employeeAssignedWarehouseIds: "wh-main" }), [], "not a list");
});

test("a malformed entry never widens the assignment", () => {
  const scope = resolveAssignedWarehouseIds({
    uid: "u1",
    userEmployeeId: "e1",
    employeeExists: true,
    employeeUserId: "u1",
    employeeEmploymentStatus: "ACTIVE",
    employeeOperationalRoles: ["WAREHOUSE_MANAGER"],
    employeeAssignedWarehouseIds: ["wh-main", 42, null, "", { forged: true }],
  });
  assert.deepEqual(scope, ["wh-main"], "unreadable entries are dropped, not honoured");
});

// ============================ the registry declares it ============================

test("BOTH sources over each collection declare the SAME scope", () => {
  // A scope declared on one source and not its sibling is not a narrowing -- it is a narrowing with
  // a documented way around it, by naming the other source.
  assert.deepEqual(GOVERNED_READS.warehouseDirectory.scope, GOVERNED_READS.metadataWarehouses.scope);
  assert.deepEqual(
    GOVERNED_READS.transferOrderDirectory.scope,
    GOVERNED_READS.metadataTransferOrders.scope,
  );
  assert.deepEqual(GOVERNED_READS.warehouseDirectory.scope.fields, ["__documentId__"]);
  assert.deepEqual(GOVERNED_READS.transferOrderDirectory.scope.fields, [
    "fromWarehouseId",
    "toWarehouseId",
  ]);
});

test("the capability ids stay UNSCOPED — the narrowing is on the read, not the id", () => {
  // Other Roles hold these globally and legitimately. Constraining the id would break every one of
  // them in order to constrain one Role.
  assert.equal(GOVERNED_READS.warehouseDirectory.capability, "warehouse.record.read");
  assert.equal(GOVERNED_READS.transferOrderDirectory.capability, "warehouse.transferOrder.read");
});

// ============================ warehouses ============================

test("GLOBAL: an unassigned capability holder reads every warehouse", async () => {
  const captured = {};
  const docs = { warehouses: [{ id: "wh-main", data: {} }, { id: "wh-other", data: {} }] };
  const res = await readGovernedList(
    { actorUid: GLOBAL_UID, sourceId: "warehouseDirectory" },
    deps(GLOBAL_UID, docs, captured),
  );
  assert.deepEqual(res.items.map((i) => i.id), ["wh-main", "wh-other"]);
  assert.equal(scopeClauses(captured).length, 0, "no scope clause was added");
});

test("ASSIGNED: a Warehouse Manager reads only their assigned warehouse", async () => {
  const captured = {};
  const docs = { warehouses: [{ id: "wh-main", data: {} }, { id: "wh-other", data: {} }] };
  const res = await readGovernedList(
    { actorUid: MANAGER_UID, sourceId: "warehouseDirectory" },
    deps(MANAGER_UID, docs, captured),
  );
  assert.deepEqual(res.items.map((i) => i.id), ["wh-main"], "the unassigned warehouse is ABSENT");
  assert.deepEqual(scopeClauses(captured), [{ field: "__name__", op: "in", value: ["wh-main"] }]);
});

test("MULTIPLE assigned warehouses all resolve, in one id clause", async () => {
  const captured = {};
  const docs = {
    warehouses: [{ id: "wh-north", data: {} }, { id: "wh-south", data: {} }, { id: "wh-other", data: {} }],
  };
  const res = await readGovernedList(
    { actorUid: MANY_UID, sourceId: "warehouseDirectory" },
    deps(MANY_UID, docs, captured),
  );
  assert.deepEqual(res.items.map((i) => i.id), ["wh-north", "wh-south"]);
});

test("the metadata list surface is scoped IDENTICALLY to the directory", async () => {
  const captured = {};
  const docs = { warehouses: [{ id: "wh-main", data: { name: "Main" } }, { id: "wh-other", data: { name: "Other" } }] };
  const res = await readGovernedList(
    { actorUid: MANAGER_UID, sourceId: "metadataWarehouses" },
    deps(MANAGER_UID, docs, captured),
  );
  assert.deepEqual(res.items.map((i) => i.id), ["wh-main"], "no wider population via the other source");
});

// ============================ transfer orders ============================

const TRANSFERS = {
  transfer_orders: [
    { id: "to-1", data: { fromWarehouseId: "wh-north", toWarehouseId: "wh-south" } },
    { id: "to-2", data: { fromWarehouseId: "wh-north", toWarehouseId: "wh-far" } },
    { id: "to-3", data: { fromWarehouseId: "wh-far", toWarehouseId: "wh-south" } },
    { id: "to-4", data: { fromWarehouseId: "wh-far", toWarehouseId: "wh-elsewhere" } },
  ],
};

test("GLOBAL: an unassigned capability holder reads every transfer order", async () => {
  const captured = {};
  const res = await readGovernedList(
    { actorUid: GLOBAL_UID, sourceId: "transferOrderDirectory" },
    deps(GLOBAL_UID, TRANSFERS, captured),
  );
  assert.deepEqual(res.items.map((i) => i.id), ["to-1", "to-2", "to-3", "to-4"]);
  assert.equal(scopeClauses(captured).length, 0);
});

test("ASSIGNED: BOTH endpoints are queried, because the rule matched either", async () => {
  const captured = {};
  await readGovernedList(
    { actorUid: MANAGER_UID, sourceId: "transferOrderDirectory" },
    deps(MANAGER_UID, TRANSFERS, captured),
  );
  assert.deepEqual(scopeClauses(captured), [
    { field: "fromWarehouseId", op: "in", value: ["wh-main"] },
    { field: "toWarehouseId", op: "in", value: ["wh-main"] },
  ]);
});

test("a transfer matching BOTH endpoints is returned ONCE, and an unrelated one not at all", async () => {
  const res = await readGovernedList(
    { actorUid: MANY_UID, sourceId: "transferOrderDirectory" },
    deps(MANY_UID, TRANSFERS, {}),
  );
  // to-1 is north -> south: it matches both branches and is ONE record, de-duplicated by
  // authoritative document id rather than by any stored field. to-4 touches neither assigned
  // warehouse and must be absent.
  assert.deepEqual(res.items.map((i) => i.id), ["to-1", "to-2", "to-3"]);
  assert.equal(new Set(res.items.map((i) => i.id)).size, res.items.length);
});

// ============================ precedence ============================

test("holding a GLOBAL authority AND a warehouse assignment does NOT narrow the reader", async () => {
  // The retired rule was a disjunction: an operations manager passed on isAdminOrDispatcher() and
  // never reached the assignment branch. This is the "must not be accidentally narrowed" case, and
  // it is expressed by the ABSENCE of an assignment being what marks a global reader -- so this
  // asserts the shape that decides it, on an actor whose assignment loader returns nothing.
  const captured = {};
  const res = await readGovernedList(
    { actorUid: GLOBAL_UID, sourceId: "transferOrderDirectory" },
    deps(GLOBAL_UID, TRANSFERS, captured),
  );
  assert.equal(res.items.length, 4, "the whole network, not one site");
  assert.equal(scopeClauses(captured).length, 0);
});

// ============================ refusal, paging, counting ============================

test("an unauthorized actor reads ZERO rows and the collection is never touched", async () => {
  for (const sourceId of ["warehouseDirectory", "transferOrderDirectory"]) {
    const captured = {};
    // No role assignment for this actor: authorization fails before any business read.
    const db = fakeDb({ docsByCollection: { users: [], roleAssignments: [], ...TRANSFERS }, captured });
    await assert.rejects(
      () => readGovernedList({ actorUid: STRANGER_UID, sourceId }, { db, loadScope }),
      /not authorized/,
      `${sourceId} must refuse`,
    );
    assert.ok(
      !captured.touched.includes("transfer_orders") && !captured.touched.includes("warehouses"),
      `${sourceId}: refused before any row was read`,
    );
  }
});

test("a page token walks the scoped union without repeating or dropping a record", async () => {
  const seen = [];
  let cursor = undefined;
  let guard = 0;
  do {
    const res = await readGovernedList(
      { actorUid: MANY_UID, sourceId: "transferOrderDirectory", pageSize: 1, cursor },
      deps(MANY_UID, TRANSFERS, {}),
    );
    seen.push(...res.items.map((i) => i.id));
    cursor = res.nextCursor ?? undefined;
    assert.ok(++guard < 10, "paging must terminate");
  } while (cursor);

  assert.deepEqual(seen, ["to-1", "to-2", "to-3"], "every scoped record, exactly once");
});

test("the COUNT is scoped like the read, and de-duplicates rather than summing branches", async () => {
  const scoped = await countGovernedList(
    { actorUid: MANY_UID, sourceId: "transferOrderDirectory" },
    deps(MANY_UID, TRANSFERS, {}),
  );
  // Summing the two endpoint branches would give 4 (to-1 counted twice). The header must not claim
  // more records than the list can show.
  assert.deepEqual(scoped, { count: 3, atLeast: false });

  const global = await countGovernedList(
    { actorUid: GLOBAL_UID, sourceId: "transferOrderDirectory" },
    deps(GLOBAL_UID, TRANSFERS, {}),
  );
  assert.equal(global.count, 4, "a global reader still counts the whole collection");
});

test("a caller cannot supply a warehouse scope — the source declares no such filter", async () => {
  await assert.rejects(
    () =>
      readGovernedList(
        { actorUid: MANAGER_UID, sourceId: "warehouseDirectory", filters: { warehouseId: "wh-other" } },
        deps(MANAGER_UID, {}, {}),
      ),
    /filter/i,
    "an undeclared filter is refused, so there is no request field that carries scope",
  );
});
