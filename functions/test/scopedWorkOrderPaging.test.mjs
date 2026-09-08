// The scoped Work Order seam's PAGING and the `assigned` mode's authority — proved by execution.
//
// Two things arrived together in the final read cutover and are tested together because they are
// the two ways this seam could have been widened while looking finished:
//
//   1. A CURSOR. The operations board and the analytics metrics need a COMPLETE population, and a
//      seam with no cursor can only be exhausted by raising the page size until it happens to fit
//      — which is a truncation waiting for the data to grow. The cursor is opaque, bound to the
//      mode that issued it, and carries no authority.
//   2. The `assigned` MODE, whose technicianId parameter names whose assignments are wanted. That
//      is a business input, and the whole question is whether it can be mistaken for authority.
import test from "node:test";
import assert from "node:assert/strict";
import {
  WORK_ORDER_MODES,
  readScopedWorkOrders,
} from "../lib/workOrder/scopedWorkOrderReadService.js";

const GLOBAL_UID = "uid-dispatcher";
const TECH_UID = "uid-technician";
const OTHER_TECH_UID = "uid-technician-2";
const TECH_ID = "tech-7";
const OTHER_TECH_ID = "tech-9";

const USERS = {
  [TECH_UID]: { technicianId: TECH_ID },
  [OTHER_TECH_UID]: { technicianId: OTHER_TECH_ID },
};

const ACCESS = async (uid, ids) => {
  const held = {
    [GLOBAL_UID]: { "workOrder.read": true, "workOrder.assigned.read": true },
    [TECH_UID]: { "workOrder.assigned.read": true },
    [OTHER_TECH_UID]: { "workOrder.assigned.read": true },
  };
  return Object.fromEntries(ids.map((i) => [i, Boolean(held[uid]?.[i])]));
};

/** A fake that records the query it was handed, INCLUDING the start position. */
function fakeDb({ docs = [], captured = {} } = {}) {
  captured.collections = [];
  const make = (name, clauses = []) => ({
    where(field, op, value) {
      const next = [...clauses, { field: String(field), op, value }];
      captured.clauses = next;
      return make(name, next);
    },
    orderBy(field, dir) {
      captured.orderBy = [...(captured.orderBy ?? []), [String(field), dir]];
      return make(name, clauses);
    },
    startAfter(...values) {
      captured.startAfter = values;
      return make(name, clauses);
    },
    limit(n) {
      captured.limit = n;
      return make(name, clauses);
    },
    async get() {
      return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
    },
  });
  return {
    collection(name) {
      captured.collections.push(name);
      return {
        ...make(name),
        doc(id) {
          return {
            async get() {
              const u = name === "users" ? USERS[id] : undefined;
              return { id, exists: Boolean(u), data: () => u };
            },
          };
        },
      };
    },
  };
}

const rows = (n, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({ id: `wo-${i}`, data: { woNumber: `W-${i}`, ...extra } }));

// ============================ the complete-population mode ============================

test("the `all` mode takes no parameters at all", () => {
  assert.deepEqual(Object.keys(WORK_ORDER_MODES.all.params), []);
});

test("`all` is ordered by DOCUMENT ID, so no work order can be silently excluded", async () => {
  // The reason this matters and is not stylistic: Firestore's orderBy drops documents missing the
  // ordered field. Paging the whole collection by createdAt would hand the analytics a population
  // short by exactly the work orders that lack one — a total that is wrong, not partial.
  const captured = {};
  const db = fakeDb({ captured, docs: rows(2) });
  await readScopedWorkOrders({ actorUid: GLOBAL_UID, mode: "all" }, { db, resolveAccess: ACCESS });
  assert.deepEqual(captured.orderBy, [["__name__", "asc"]]);
});

test("a mode ordered by id gets ONE ordering, not a duplicate __name__ tiebreak", async () => {
  const captured = {};
  const db = fakeDb({ captured, docs: rows(1) });
  await readScopedWorkOrders({ actorUid: GLOBAL_UID, mode: "all" }, { db, resolveAccess: ACCESS });
  assert.equal(captured.orderBy.length, 1);
});

// ============================ the cursor ============================

test("hasMore is OBSERVED, and a next cursor is issued only when there is a next page", async () => {
  const db = fakeDb({ docs: rows(3) });
  const full = await readScopedWorkOrders(
    { actorUid: GLOBAL_UID, mode: "all", pageSize: 2 },
    { db, resolveAccess: ACCESS },
  );
  assert.equal(full.hasMore, true);
  assert.equal(full.items.length, 2);
  assert.ok(full.nextCursor, "a page with more behind it must hand back a way to continue");

  const last = await readScopedWorkOrders(
    { actorUid: GLOBAL_UID, mode: "all", pageSize: 5 },
    { db: fakeDb({ docs: rows(3) }), resolveAccess: ACCESS },
  );
  assert.equal(last.hasMore, false);
  assert.equal(last.nextCursor, null, "a final page must not offer a cursor to nothing");
});

test("the cursor resumes AFTER the last row of the previous page", async () => {
  const first = await readScopedWorkOrders(
    { actorUid: GLOBAL_UID, mode: "all", pageSize: 2 },
    { db: fakeDb({ docs: rows(3) }), resolveAccess: ACCESS },
  );
  const captured = {};
  await readScopedWorkOrders(
    { actorUid: GLOBAL_UID, mode: "all", pageSize: 2, cursor: first.nextCursor },
    { db: fakeDb({ captured, docs: rows(1) }), resolveAccess: ACCESS },
  );
  // Ordered by id, so the start position is the id alone — not a value plus a tiebreak.
  assert.deepEqual(captured.startAfter, ["wo-1"]);
});

test("a cursor issued for one mode is REFUSED against another", async () => {
  const first = await readScopedWorkOrders(
    { actorUid: GLOBAL_UID, mode: "all", pageSize: 1 },
    { db: fakeDb({ docs: rows(3) }), resolveAccess: ACCESS },
  );
  await assert.rejects(
    () =>
      readScopedWorkOrders(
        { actorUid: GLOBAL_UID, mode: "index", cursor: first.nextCursor },
        { db: fakeDb({ docs: rows(1) }), resolveAccess: ACCESS },
      ),
    /cursor does not belong to this mode/,
    "a page token replayed against a different ordering is a start position in the wrong query",
  );
});

test("a malformed cursor is an input error, never a silently ignored one", async () => {
  await assert.rejects(
    () =>
      readScopedWorkOrders(
        { actorUid: GLOBAL_UID, mode: "all", cursor: "not-a-token" },
        { db: fakeDb({ docs: rows(1) }), resolveAccess: ACCESS },
      ),
    /not a valid page token/,
  );
});

test("a forged cursor cannot widen scope: the predicate is still applied", async () => {
  // The cursor carries a position, never authority. The scope is re-resolved from the uid on every
  // call, so the worst a tampered token can do is start the page somewhere else INSIDE a result the
  // caller was already entitled to.
  const forged = Buffer.from(JSON.stringify({ m: "all", v: null, d: "wo-0" }), "utf8").toString("base64url");
  const captured = {};
  await readScopedWorkOrders(
    { actorUid: TECH_UID, mode: "all", cursor: forged },
    { db: fakeDb({ captured, docs: rows(1) }), resolveAccess: ACCESS },
  );
  assert.deepEqual(captured.clauses, [{ field: "assignedTechId", op: "==", value: TECH_ID }]);
});

// ============================ the assigned mode's authority ============================

test("a technician reading their own assignments gets the SERVER-derived predicate, once", async () => {
  const captured = {};
  await readScopedWorkOrders(
    { actorUid: TECH_UID, mode: "assigned", params: { technicianId: TECH_ID } },
    { db: fakeDb({ captured, docs: rows(1) }), resolveAccess: ACCESS },
  );
  // Exactly one equality on assignedTechId: the parameter is not added alongside the scope
  // predicate, which would be a second filter saying the same thing.
  assert.deepEqual(captured.clauses, [{ field: "assignedTechId", op: "==", value: TECH_ID }]);
});

test("a technician naming ANOTHER technician is REFUSED, not silently answered about themselves", async () => {
  // Refused rather than intersected into an empty page: an empty list reads as "you have no work",
  // which is a claim about the business rather than about permission — and answering a question
  // nobody asked, under the name of the one they did, is worse than saying no.
  const captured = {};
  await assert.rejects(
    () =>
      readScopedWorkOrders(
        { actorUid: TECH_UID, mode: "assigned", params: { technicianId: OTHER_TECH_ID } },
        { db: fakeDb({ captured, docs: rows(1) }), resolveAccess: ACCESS },
      ),
    /may only read their own assignments/,
  );
  assert.ok(!captured.collections?.includes("fieldops_wos"), "refused before any work order was read");
});

test("a technician who omits the id still gets their own, and cannot get everyone's", async () => {
  const captured = {};
  await readScopedWorkOrders(
    { actorUid: TECH_UID, mode: "assigned" },
    { db: fakeDb({ captured, docs: rows(1) }), resolveAccess: ACCESS },
  );
  assert.deepEqual(captured.clauses, [{ field: "assignedTechId", op: "==", value: TECH_ID }]);
});

test("a GLOBAL reader may name another technician — that is what workOrder.read is for", async () => {
  const captured = {};
  await readScopedWorkOrders(
    { actorUid: GLOBAL_UID, mode: "assigned", params: { technicianId: OTHER_TECH_ID } },
    { db: fakeDb({ captured, docs: rows(1) }), resolveAccess: ACCESS },
  );
  assert.deepEqual(captured.clauses, [{ field: "assignedTechId", op: "==", value: OTHER_TECH_ID }]);
});

test("a GLOBAL reader must NAME somebody: an omitted id is not 'everyone'", async () => {
  // Without this, "this technician's assignments" would quietly become "every work order" under the
  // same function name, for the one population broad enough not to notice.
  await assert.rejects(
    () =>
      readScopedWorkOrders(
        { actorUid: GLOBAL_UID, mode: "assigned" },
        { db: fakeDb({ docs: rows(1) }), resolveAccess: ACCESS },
      ),
    /requires a technicianId/,
  );
});

test("global authority resolves BEFORE assigned, so an admin is never scoped to a technician", async () => {
  // GLOBAL_UID holds both capabilities, because admin derives the whole catalogue. Resolving self
  // first would scope them to a technician identity they do not have and return nothing, silently.
  const captured = {};
  await readScopedWorkOrders(
    { actorUid: GLOBAL_UID, mode: "all" },
    { db: fakeDb({ captured, docs: rows(1) }), resolveAccess: ACCESS },
  );
  assert.deepEqual(captured.clauses ?? [], []);
});
