// readGovernedList -- the governed read's own contract, proved by EXECUTION.
//
// No emulator: the service takes its Firestore handle as a dependency, so this drives it with a
// small fake. That is deliberate rather than lazy. The properties under test are decisions this
// module makes -- which id wins, whether an undeclared filter is refused, whether authorization
// runs before the query -- and none of them needs a real database to be wrong.
//
// WHY EXECUTION AND NOT INSPECTION. The  prefix sentinel in this service was once written as
// a literal character and silently STRIPPED in transit, quietly reducing a starts-with range to
// exact equality. The source looked right. Reading it would not have caught it; running it does.
// Anything escape-sensitive or precedence-sensitive in here gets executed, never eyeballed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readGovernedList } from "../lib/access/governedListReadService.js";
import { COMPATIBILITY_ROLES } from "../lib/access/compatibilityRoles.js";

const ACTOR = "actor-1";

/**
 * A Firestore stand-in.
 *
 * Records every where() it is handed so a test can assert on the query the service BUILT, not only
 * on the rows it returned -- a filter that is silently dropped and one that is correctly applied
 * both return rows, and only the recorded clauses tell them apart.
 */
function fakeDb({ docsByCollection = {}, capturedRef = null } = {}) {
  const makeQuery = (collectionName, clauses = []) => ({
    where(field, op, value) {
      const next = [...clauses, { field: String(field), op, value }];
      if (capturedRef) capturedRef.clauses = next;
      return makeQuery(collectionName, next);
    },
    orderBy(field, dir) {
      if (capturedRef) capturedRef.orderBy = [...(capturedRef.orderBy ?? []), [String(field), dir]];
      return makeQuery(collectionName, clauses);
    },
    limit(n) {
      if (capturedRef) capturedRef.limit = n;
      return makeQuery(collectionName, clauses);
    },
    startAfter(...args) {
      if (capturedRef) capturedRef.startAfter = args;
      return makeQuery(collectionName, clauses);
    },
    async get() {
      const docs = (docsByCollection[collectionName] ?? []).map((d) => ({
        id: d.id,
        data: () => d.data,
      }));
      return { docs };
    },
  });

  return {
    collection(name) {
      return {
        ...makeQuery(name),
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

/** An actor holding the compatibility `admin` Role, which carries every read under test. */
function authorizedFixture(extra = {}) {
  return {
    users: [{ id: ACTOR, data: { accessVersion: 0 } }],
    roleAssignments: [
      {
        id: "asg-1",
        data: {
          principalUid: ACTOR,
          roleId: "admin",
          scope: { type: "global" },
          status: "active",
          accessVersionAtGrant: 0,
        },
      },
    ],
    ...extra,
  };
}

// ════════════════════ THE STORAGE IDENTITY WINS ════════════════════

test("a stored `id` field can never override the Firestore document id", async () => {
  // THE REGRESSION THIS PINS. The projection used to build rows as `{ id, ...data }`, so a document
  // carrying its own `id` silently replaced the authoritative document id -- and every consumer
  // keys, links and navigates by that value. The truck registry separates { docId, data } precisely
  // because "the contract fails closed on a stored-id conflict"; the projection was resolving that
  // same conflict the other way round.
  const db = fakeDb({
    docsByCollection: authorizedFixture({
      employees: [{ id: "AUTHORITATIVE", data: { id: "CONFLICTING", displayName: "Jo" } }],
    }),
  });

  const page = await readGovernedList(
    { actorUid: ACTOR, sourceId: "employeeDirectory" },
    { db, roles: COMPATIBILITY_ROLES },
  );

  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, "AUTHORITATIVE", "the storage identity must win");
  assert.notEqual(page.items[0].id, "CONFLICTING");
  // The rest of the document still arrives -- this is about precedence, not about dropping data.
  assert.equal(page.items[0].displayName, "Jo");
});

// ════════════════════ THE CLIENT CANNOT WIDEN THE QUERY ════════════════════

test("an undeclared filter name is REFUSED, never silently dropped", async () => {
  // A dropped filter returns the whole collection where the caller asked for one account's
  // contacts: a wrong answer AND a disclosure. Refusing by name is the only safe failure.
  const db = fakeDb({ docsByCollection: authorizedFixture() });
  await assert.rejects(
    readGovernedList(
      { actorUid: ACTOR, sourceId: "accountContacts", filters: { secretField: "x" } },
      { db, roles: COMPATIBILITY_ROLES },
    ),
    /not a filter on this source/,
  );
});

test("an unregistered sourceId is refused", async () => {
  const db = fakeDb({ docsByCollection: authorizedFixture() });
  await assert.rejects(
    readGovernedList(
      { actorUid: ACTOR, sourceId: "users" },
      { db, roles: COMPATIBILITY_ROLES },
    ),
    /not a governed read source/,
  );
});

test("a required filter is enforced -- an account-scoped source cannot be read unscoped", async () => {
  const db = fakeDb({ docsByCollection: authorizedFixture() });
  await assert.rejects(
    readGovernedList(
      { actorUid: ACTOR, sourceId: "accountContacts" },
      { db, roles: COMPATIBILITY_ROLES },
    ),
    /is required on this source/,
  );
});

// ════════════════════ THE PREFIX RANGE, EXECUTED ════════════════════

test("a prefix filter builds a real starts-with range, not an equality", async () => {
  // THE  REGRESSION, pinned by behaviour. If the sentinel is ever lost again the upper bound
  // collapses onto the term itself and this fails -- which is the only way that defect is visible,
  // since a typeahead matching only exact names reads as "no results yet" rather than as a bug.
  const captured = {};
  const db = fakeDb({ docsByCollection: authorizedFixture({ accounts: [] }), capturedRef: captured });

  await readGovernedList(
    { actorUid: ACTOR, sourceId: "accountSearch", filters: { namePrefix: "acme" } },
    { db, roles: COMPATIBILITY_ROLES },
  );

  const range = captured.clauses.filter((c) => c.field === "name");
  assert.equal(range.length, 2, "a prefix must become TWO bounds");
  const lower = range.find((c) => c.op === ">=");
  const upper = range.find((c) => c.op === "<=");
  assert.equal(lower.value, "acme");
  assert.notEqual(upper.value, "acme", "an upper bound equal to the term is an EQUALITY, not a prefix");
  assert.ok(upper.value.startsWith("acme"));
  assert.ok(upper.value > "acmezzzz", "the upper bound must sort after any ordinary continuation");
});

// ════════════════════ PAGINATION IS OBSERVED, NOT INFERRED ════════════════════

test("hasMore is observed by over-fetching, and the page is trimmed to pageSize", async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: `e${i}`, data: { displayName: `n${i}` } }));
  const captured = {};
  const db = fakeDb({
    docsByCollection: authorizedFixture({ employees: rows }),
    capturedRef: captured,
  });

  const page = await readGovernedList(
    { actorUid: ACTOR, sourceId: "employeeDirectory", pageSize: 3 },
    { db, roles: COMPATIBILITY_ROLES },
  );

  assert.equal(captured.limit, 4, "must ask for pageSize + 1 -- a count equal to the limit cannot distinguish a full last page from a truncated one");
  assert.equal(page.items.length, 3, "the extra probe row must not reach the caller");
  assert.equal(page.hasMore, true);
  assert.ok(page.nextCursor, "a page with more must carry a cursor");
});

test("the last page reports hasMore false and no cursor", async () => {
  const db = fakeDb({
    docsByCollection: authorizedFixture({
      employees: [{ id: "e1", data: { displayName: "n1" } }],
    }),
  });
  const page = await readGovernedList(
    { actorUid: ACTOR, sourceId: "employeeDirectory", pageSize: 3 },
    { db, roles: COMPATIBILITY_ROLES },
  );
  assert.equal(page.hasMore, false);
  assert.equal(page.nextCursor, null);
});

test("a cursor issued for one source is refused against another", async () => {
  // Otherwise a page token becomes a start position in a different collection's ordering.
  const db = fakeDb({
    docsByCollection: authorizedFixture({
      employees: Array.from({ length: 3 }, (_, i) => ({ id: `e${i}`, data: { displayName: `n${i}` } })),
    }),
  });
  const first = await readGovernedList(
    { actorUid: ACTOR, sourceId: "employeeDirectory", pageSize: 1 },
    { db, roles: COMPATIBILITY_ROLES },
  );
  assert.ok(first.nextCursor);

  await assert.rejects(
    readGovernedList(
      { actorUid: ACTOR, sourceId: "accountDirectory", cursor: first.nextCursor },
      { db, roles: COMPATIBILITY_ROLES },
    ),
    /cursor does not belong to this source/,
  );
});

// ════════════════════ AUTHORIZATION ════════════════════

test("a principal holding no qualifying Role is denied, and no query is built", async () => {
  // Ordered deliberately: authorization runs BEFORE the query, so an unauthorized caller cannot
  // measure a collection through timing or through an error only a real query could produce.
  const captured = {};
  const db = fakeDb({
    docsByCollection: {
      users: [{ id: ACTOR, data: { accessVersion: 0 } }],
      roleAssignments: [],
      employees: [{ id: "e1", data: { displayName: "n1" } }],
    },
    capturedRef: captured,
  });

  await assert.rejects(
    readGovernedList(
      { actorUid: ACTOR, sourceId: "employeeDirectory" },
      { db, roles: COMPATIBILITY_ROLES },
    ),
    /not authorized/,
  );
  assert.equal(captured.limit, undefined, "no data query may be built for an unauthorized caller");
});

test("an absent actorUid is an input error, never an anonymous read", async () => {
  const db = fakeDb({ docsByCollection: authorizedFixture() });
  await assert.rejects(
    readGovernedList({ actorUid: "", sourceId: "employeeDirectory" }, { db, roles: COMPATIBILITY_ROLES }),
    /actorUid is required/,
  );
});

// ════════════════════ THE SORT ALLOWLIST ════════════════════
//
// The UI lets a person choose how a list is ordered, and that must keep working -- but the browser
// names a TOKEN, never a field. These prove the resolution happens server-side and that the
// caller's string is compared, never used.

test("a sort token resolves to the field the REGISTRY chose, not to the caller's string", async () => {
  const captured = {};
  const db = fakeDb({ docsByCollection: authorizedFixture({ accounts: [] }), capturedRef: captured });

  await readGovernedList(
    { actorUid: ACTOR, sourceId: "metadataAccounts", sortKey: "nameAsc" },
    { db, roles: COMPATIBILITY_ROLES },
  );

  // The ordering applied is the registry's field for that token -- and the token itself never
  // appears as a field anywhere in the query.
  const ordered = captured.orderBy.map(([field]) => field);
  assert.ok(ordered.includes("name"), "the registry's field must be used");
  assert.ok(!ordered.includes("nameAsc"), "the caller's token must never reach Firestore as a field");
});

test("an unregistered sort token is REFUSED, not silently replaced by the default", async () => {
  // Silently defaulting would show the user a list that is not in the order they asked for, with
  // nothing saying so. And accepting the string would let the browser order by any field it names.
  const db = fakeDb({ docsByCollection: authorizedFixture({ accounts: [] }) });
  await assert.rejects(
    readGovernedList(
      { actorUid: ACTOR, sourceId: "metadataAccounts", sortKey: "ssn" },
      { db, roles: COMPATIBILITY_ROLES },
    ),
    /is not an offered sort/,
  );
});

test("a source with ONE ordering refuses a sort request rather than ignoring it", async () => {
  const db = fakeDb({ docsByCollection: authorizedFixture() });
  await assert.rejects(
    readGovernedList(
      { actorUid: ACTOR, sourceId: "employeeDirectory", sortKey: "anything" },
      { db, roles: COMPATIBILITY_ROLES },
    ),
    /does not offer a choice of sort/,
  );
});

test("omitting the sort uses the source's declared default", async () => {
  const captured = {};
  const db = fakeDb({ docsByCollection: authorizedFixture({ accounts: [] }), capturedRef: captured });
  await readGovernedList(
    { actorUid: ACTOR, sourceId: "metadataAccounts" },
    { db, roles: COMPATIBILITY_ROLES },
  );
  const ordered = captured.orderBy.map(([field, dir]) => `${field}:${dir}`);
  assert.ok(ordered.includes("updatedAt:desc"), "the declared default sort must apply");
});
