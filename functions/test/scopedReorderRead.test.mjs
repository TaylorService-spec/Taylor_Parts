// REORDER READ PARITY — the retired firestore.rules predicate is the test oracle.
//
// The measured rule, verbatim from the pre-contraction ruleset:
//
//   allow read: if isAdminOrDispatcher()
//     || (isActiveOperationalRole("PARTS_MANAGER") && resource.data.status == "READY_FOR_PARTS_MANAGER")
//     || (isActiveOperationalRole("PARTS_MANAGER") && resource.data.status in ["ASSIGNED_TO_PARTS_ASSOCIATE", "PURCHASING_IN_PROGRESS"])
//     || (isActiveOperationalRole("PARTS_MANAGER") && (resource.data.reviewedBy == request.auth.uid || resource.data.assignedBy == request.auth.uid))
//     || (isActiveOperationalRole("PARTS_ASSOCIATE") && resource.data.assignedToUserId == request.auth.uid);
//
// Three populations, and the closure standard is the EFFECTIVE result: the old permitted record
// population must equal the new governed one. Every case below is that comparison, asserted against
// the query the service actually builds -- because a dropped predicate and an applied one both
// return rows, and only the recorded clauses tell them apart.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MANAGED_STATUSES,
  REORDER_MODES,
  readScopedReorderRequests,
  resolveReorderScope,
} from "../lib/reorderRequest/scopedReorderReadService.js";

const GLOBAL_UID = "uid-dispatcher";
const MANAGER_UID = "uid-parts-manager";
const ASSOCIATE_UID = "uid-parts-associate";
const OTHER_UID = "uid-somebody-else";

const HELD = {
  [GLOBAL_UID]: { "reorder.request.read.queue": true },
  [MANAGER_UID]: { "reorder.request.read.managed": true },
  [ASSOCIATE_UID]: { "reorder.request.read.own": true },
  // A person who genuinely holds both. The retired model had no way to express this; the governed
  // one does, and it is the case most likely to be silently narrowed.
  "uid-ops-and-parts": { "reorder.request.read.queue": true, "reorder.request.read.managed": true },
};

const ACCESS = async (uid, ids) => Object.fromEntries(ids.map((i) => [i, Boolean(HELD[uid]?.[i])]));

/** Records the clauses of EVERY branch the service builds, in order. */
function fakeDb({ docs = [], captured = {} } = {}) {
  captured.branches = [];
  captured.collections = [];
  const make = (name, clauses, window) => ({
    where(field, op, value) {
      const next = [...clauses, { field: String(field), op, value }];
      // The last write wins per branch: each chained where() replaces the record for that branch.
      captured.branches[captured.branches.length - 1] = next;
      return make(name, next, window);
    },
    orderBy(field, dir) {
      captured.orderBy = [...(captured.orderBy ?? []), [String(field), dir]];
      return make(name, clauses, window);
    },
    startAfter(...args) {
      captured.startAfter = args;
      return make(name, clauses, { ...window, after: args });
    },
    limit(n) {
      captured.limit = n;
      return make(name, clauses, { ...window, limit: n });
    },
    async get() {
      // The window is APPLIED, not merely recorded. Only the document-id ordering is modelled --
      // it is the one every paging test below uses, and a fake that silently returned everything
      // would let a broken cursor pass.
      const afterId = window.after ? String(window.after[window.after.length - 1]) : null;
      const kept = docs
        .filter((d) => (afterId === null ? true : d.id > afterId))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, window.limit ?? undefined);
      return { docs: kept.map((d) => ({ id: d.id, data: () => d.data })) };
    },
  });
  return {
    collection(name) {
      captured.collections.push(name);
      captured.branches.push([]);
      return make(name, [], { after: null, limit: null });
    },
  };
}

const rows = (n, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({ id: `req-${i}`, data: { partId: "P-1", ...extra } }));

const read = (actorUid, params, opts = {}) =>
  readScopedReorderRequests(
    { actorUid, mode: opts.mode ?? "index", params, pageSize: opts.pageSize },
    { db: opts.db ?? fakeDb({ captured: opts.captured ?? {}, docs: opts.docs ?? rows(1) }), resolveAccess: ACCESS },
  );

// ============================ scope resolution ============================

test("GLOBAL: a queue-capability holder reads the complete authorized population", async () => {
  const captured = {};
  const res = await read(GLOBAL_UID, undefined, { captured });
  assert.equal(res.scope, "GLOBAL");
  // ONE branch, and no scope predicate on it: the retired isAdminOrDispatcher() arm was unfiltered.
  assert.equal(captured.branches.filter((b) => b.length > 0).length, 0, "a global read adds no scope clause");
  assert.equal(captured.collections.length, 1, "a global read is one query, not a union");
});

test("MANAGED: a Parts Manager gets EXACTLY the retired population, as three branches", async () => {
  const captured = {};
  const res = await read(MANAGER_UID, undefined, { captured });
  assert.equal(res.scope, "MANAGED");
  const branches = captured.branches.filter((b) => b.length > 0);
  assert.equal(branches.length, 3, "the retired rule was a three-way disjunction");
  assert.deepEqual(
    branches,
    [
      [{ field: "status", op: "in", value: [...MANAGED_STATUSES] }],
      [{ field: "reviewedBy", op: "==", value: MANAGER_UID }],
      [{ field: "assignedBy", op: "==", value: MANAGER_UID }],
    ],
    "each branch must be one of the retired rule's arms, with the actor derived server-side",
  );
});

test("MANAGED: the status set is exactly the three the rule named, and no other", () => {
  assert.deepEqual([...MANAGED_STATUSES], [
    "READY_FOR_PARTS_MANAGER",
    "ASSIGNED_TO_PARTS_ASSOCIATE",
    "PURCHASING_IN_PROGRESS",
  ]);
});

test("MANAGED does NOT reach unrelated queue records", async () => {
  // Proven structurally rather than by fixture: every branch carries a predicate, so a record in
  // PENDING_REVIEW that this actor never touched matches none of them. A fourth, unfiltered branch
  // would be the defect, and there is no branch without a clause.
  const captured = {};
  await read(MANAGER_UID, undefined, { captured });
  for (const branch of captured.branches.filter((b) => b.length > 0)) {
    assert.ok(branch.length > 0, "no MANAGED branch may be unfiltered");
  }
  assert.equal(captured.branches.filter((b) => b.length === 0).length, 0);
});

test("OWN: a Parts Associate reads their own assigned requests, server-derived", async () => {
  const captured = {};
  const res = await read(ASSOCIATE_UID, undefined, { captured });
  assert.equal(res.scope, "OWN");
  assert.deepEqual(
    captured.branches.filter((b) => b.length > 0),
    [[{ field: "assignedToUserId", op: "==", value: ASSOCIATE_UID }]],
  );
});

test("OWN: naming SOMEBODY ELSE's assignment is REFUSED, not silently emptied", async () => {
  // An empty list would read as "you have no requests" -- a claim about the business made out of a
  // permission decision.
  await assert.rejects(
    () => read(ASSOCIATE_UID, { assignedToUserId: OTHER_UID }),
    /may only read their own assigned requests/,
  );
});

test("OWN: naming THEMSELVES is accepted, and adds no duplicate clause", async () => {
  const captured = {};
  await read(ASSOCIATE_UID, { assignedToUserId: ASSOCIATE_UID }, { captured });
  assert.deepEqual(
    captured.branches.filter((b) => b.length > 0),
    [[{ field: "assignedToUserId", op: "==", value: ASSOCIATE_UID }]],
    "the scope predicate is the only assignee clause",
  );
});

// ============================ precedence ============================

test("a person holding a GLOBAL and a scoped Role resolves GLOBALLY", async () => {
  // The failure this prevents: an Operations Manager who is also a Parts Manager silently narrowed
  // to the Parts Manager subset, with no error to notice.
  const scope = await resolveReorderScope("uid-ops-and-parts", { resolveAccess: ACCESS });
  assert.deepEqual(scope, { kind: "GLOBAL" });
});

test("the resolution order is global, then managed, then own, then deny", async () => {
  assert.deepEqual(await resolveReorderScope(GLOBAL_UID, { resolveAccess: ACCESS }), { kind: "GLOBAL" });
  assert.deepEqual(await resolveReorderScope(MANAGER_UID, { resolveAccess: ACCESS }), {
    kind: "MANAGED",
    actorUid: MANAGER_UID,
  });
  assert.deepEqual(await resolveReorderScope(ASSOCIATE_UID, { resolveAccess: ACCESS }), {
    kind: "OWN",
    actorUid: ASSOCIATE_UID,
  });
});

// ============================ what a caller cannot do ============================

test("an unauthorized caller queries ZERO reorder business rows", async () => {
  const captured = {};
  await assert.rejects(
    () =>
      readScopedReorderRequests(
        { actorUid: "stranger", mode: "index" },
        { db: fakeDb({ captured }), resolveAccess: ACCESS },
      ),
    /may not read reorder requests/,
  );
  assert.ok(!captured.collections.includes("reorder_requests"), "refused before any row was read");
});

test("a resolver that THROWS is a denial, never an allow", async () => {
  await assert.rejects(
    () =>
      readScopedReorderRequests(
        { actorUid: GLOBAL_UID, mode: "index" },
        { db: fakeDb({}), resolveAccess: async () => { throw new Error("backend down"); } },
      ),
    /authorization could not be resolved/,
  );
});

test("a forged filter cannot widen scope -- it intersects with it", async () => {
  // A MANAGED caller naming somebody else's assignedBy still gets their OWN three branches, each
  // narrowed by the filter. Smaller, never different.
  const captured = {};
  await read(MANAGER_UID, { assignedBy: OTHER_UID }, { captured });
  const branches = captured.branches.filter((b) => b.length > 0);
  for (const branch of branches) {
    assert.ok(
      branch.some((c) => c.field === "assignedBy" && c.value === OTHER_UID),
      "the display filter is applied to every branch",
    );
  }
  // And the scope clauses are STILL the actor's own.
  assert.ok(branches.some((b) => b.some((c) => c.field === "reviewedBy" && c.value === MANAGER_UID)));
  assert.ok(branches.some((b) => b.some((c) => c.field === "assignedBy" && c.value === MANAGER_UID)));
});

test("OMITTING every filter cannot widen scope", async () => {
  const captured = {};
  await read(MANAGER_UID, {}, { captured });
  assert.equal(captured.branches.filter((b) => b.length > 0).length, 3, "the scope is applied regardless");
});

test("an undeclared parameter is refused BY NAME rather than ignored", async () => {
  await assert.rejects(() => read(GLOBAL_UID, { collection: "anything" }), /is not a parameter of mode/);
  await assert.rejects(() => read(GLOBAL_UID, { orderBy: "createdAt" }), /is not a parameter of mode/);
});

test("an unregistered mode is refused", async () => {
  await assert.rejects(() => read(GLOBAL_UID, undefined, { mode: "everything" }), /is not a reorder query mode/);
});

// ============================ the union ============================

test("a record matching two branches is emitted ONCE", async () => {
  // A request in a managed status that this actor also personally assigned matches two queries.
  const captured = {};
  const res = await read(MANAGER_UID, undefined, {
    captured,
    docs: [{ id: "req-both", data: { status: "PURCHASING_IN_PROGRESS", assignedBy: MANAGER_UID } }],
  });
  assert.equal(res.items.length, 1, "de-duplicated by authoritative document id");
  assert.equal(res.items[0].id, "req-both");
});

test("the document id is authoritative over any stored id", async () => {
  const res = await read(GLOBAL_UID, undefined, {
    docs: [{ id: "REAL", data: { id: "EVIL", partId: "P-1" } }],
  });
  assert.equal(res.items[0].id, "REAL");
});

test("an EMPTY result is distinct from a DENIAL", async () => {
  // Both are "no rows on screen", and they mean opposite things: one is a fact about the business,
  // the other about permission. The service returns one and throws the other.
  const res = await read(GLOBAL_UID, undefined, { docs: [] });
  assert.deepEqual(res.items, []);
  assert.equal(res.scope, "GLOBAL");
  await assert.rejects(
    () => readScopedReorderRequests({ actorUid: "stranger", mode: "index" }, { db: fakeDb({}), resolveAccess: ACCESS }),
    /may not read reorder requests/,
  );
});

test("the history mode is ordered createdAt DESC, and scoped like the queue", async () => {
  const captured = {};
  const res = await read(MANAGER_UID, { statuses: ["RECEIVED"] }, { mode: "history", captured });
  assert.equal(res.scope, "MANAGED");
  assert.deepEqual(REORDER_MODES.history.orderBy, ["createdAt", "desc"]);
  assert.equal(captured.branches.filter((b) => b.length > 0).length, 3, "history is scoped too");
});

// ============================ paging the union ============================
//
// The history surface and every complete-population read over this collection depend on the seam
// being EXHAUSTIBLE. A scoped reader bounded at one page would hand a total a truncated input, and
// a total over a truncated input is not partial -- it is wrong, presented as complete.

test("a page token walks the whole scoped population, once each", async () => {
  const docs = rows(5);
  const seen = [];
  let cursor = null;
  let guard = 0;
  do {
    const res = await readScopedReorderRequests(
      { actorUid: MANAGER_UID, mode: "index", pageSize: 2, cursor },
      { db: fakeDb({ docs }), resolveAccess: ACCESS },
    );
    seen.push(...res.items.map((i) => i.id));
    cursor = res.nextCursor;
    assert.equal(res.hasMore, cursor !== null, "hasMore and a token must agree");
    assert.ok(++guard < 10, "paging must terminate");
  } while (cursor !== null);

  assert.deepEqual(seen, ["req-0", "req-1", "req-2", "req-3", "req-4"]);
  assert.equal(new Set(seen).size, seen.length, "the union de-duplicates across pages too");
});

test("the token is a POSITION, not an authority -- the scope is re-resolved on the resumed page", async () => {
  const captured = {};
  const first = await readScopedReorderRequests(
    { actorUid: MANAGER_UID, mode: "index", pageSize: 1 },
    { db: fakeDb({ docs: rows(3) }), resolveAccess: ACCESS },
  );
  await readScopedReorderRequests(
    { actorUid: MANAGER_UID, mode: "index", pageSize: 1, cursor: first.nextCursor },
    { db: fakeDb({ captured, docs: rows(3) }), resolveAccess: ACCESS },
  );
  // Still three branches with their scope predicates: a cursor changes WHERE the window starts,
  // never WHICH records the window may contain.
  assert.equal(captured.branches.filter((b) => b.length > 0).length, 3, "the managed union survives the resume");
});

test("a token from ANOTHER mode is refused rather than replayed into a different ordering", async () => {
  const history = await readScopedReorderRequests(
    { actorUid: GLOBAL_UID, mode: "history", params: { statuses: ["COMPLETED"] }, pageSize: 1 },
    { db: fakeDb({ docs: rows(2, { createdAt: { _seconds: 1 } }) }), resolveAccess: ACCESS },
  );
  assert.ok(history.nextCursor, "the history page issued a token");
  await assert.rejects(
    () =>
      readScopedReorderRequests(
        { actorUid: GLOBAL_UID, mode: "index", pageSize: 1, cursor: history.nextCursor },
        { db: fakeDb({ docs: rows(2) }), resolveAccess: ACCESS },
      ),
    /different reorder query mode/,
  );
});

test("a forged token is REFUSED, never silently treated as page one", async () => {
  for (const [bad, pattern] of [
    ["not-a-token", /page token/],
    [Buffer.from('{"m":"index"}', "utf8").toString("base64url"), /page token/],
    [7, /cursor must be a string/],
  ]) {
    await assert.rejects(
      () =>
        readScopedReorderRequests(
          { actorUid: GLOBAL_UID, mode: "index", cursor: bad },
          { db: fakeDb({ docs: rows(1) }), resolveAccess: ACCESS },
        ),
      pattern,
    );
  }
});
