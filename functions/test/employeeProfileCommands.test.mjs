// ADMINISTRATION USERS CONSOLIDATION -- the trusted Employee profile writer, under test.
//
// NO EMULATOR. The command takes its Firestore through `deps.db`, and the audit writer's
// document-ref helper now takes one too, so the entire path -- validation, authorization, the
// transaction, the per-field Audit Events -- runs against the in-memory double below. That is not a
// convenience: an emulator-gated test is a test that does not run in the suite everyone actually
// runs, and the properties asserted here (which fields are refused, that a denial writes nothing,
// that a no-op writes nothing) are exactly the ones a change would break silently.
//
// What the double is NOT: a Firestore implementation. It supports the four operations this command
// performs -- doc get, a two-clause equality query on roleAssignments, transactional get, and
// transactional set with merge -- and nothing else, so a command that started doing something more
// would fail here loudly rather than be quietly approximated.
//
// Prerequisite: npm run build (this imports from ../lib).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const {
  updateEmployeeProfile,
  EDITABLE_EMPLOYEE_FIELDS,
  EMPLOYMENT_STATUS_VALUES,
  OPERATIONAL_ROLE_VALUES,
  EMPLOYEE_PROFILE_CAPABILITY,
  EMPLOYEE_TARGET_TYPE,
  InvalidInputError,
  UnauthorizedActorError,
  EmployeeNotFoundError,
  UnknownManagerError,
} = await import("../lib/access/employeeProfileCommands.js");

const HERE = dirname(fileURLToPath(import.meta.url));

// ════════════════════ the in-memory double ════════════════════

function makeDb(seed = {}) {
  // collection -> id -> data
  const store = new Map(Object.entries(seed).map(([c, docs]) => [c, new Map(Object.entries(docs))]));
  const col = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  };
  const snap = (name, id) => ({
    id,
    exists: col(name).has(id),
    data: () => col(name).get(id),
  });
  // A reference is both a handle the transaction stages writes against AND, outside a transaction,
  // something the command reads directly (the actor's users/{uid} document). Both, here.
  const docRef = (name, id) => ({
    __collection: name,
    __id: id,
    id,
    async get() {
      return snap(name, id);
    },
  });

  const writes = [];
  // Firestore mints an id when .doc() is called with none -- the auto-id path stageAuditEvent uses.
  let autoId = 0;
  const db = {
    __store: store,
    __writes: writes,
    collection(name) {
      return {
        doc: (id) => docRef(name, id ?? `auto-${(autoId += 1)}`),
        where(field, op, value) {
          assert.equal(op, "==", "the double only serves equality clauses");
          const clauses = [[field, value]];
          const q = {
            where(f, o, v) {
              assert.equal(o, "==");
              clauses.push([f, v]);
              return q;
            },
            async get() {
              const docs = [...col(name).entries()]
                .filter(([, data]) => clauses.every(([f, v]) => data?.[f] === v))
                .map(([id, data]) => ({ id, data: () => data }));
              return { docs };
            },
          };
          return q;
        },
      };
    },
    // A batch of one, which is how the writer records a standalone (audit-only) event.
    batch() {
      const staged = [];
      return {
        set(ref, data) {
          staged.push({ ref, data });
        },
        async commit() {
          for (const { ref, data } of staged) {
            writes.push({ collection: ref.__collection, id: ref.__id, data });
            col(ref.__collection).set(ref.__id, data);
          }
        },
      };
    },
    async runTransaction(fn) {
      const txn = {
        async get(ref) {
          return snap(ref.__collection, ref.__id);
        },
        set(ref, data, options) {
          writes.push({ collection: ref.__collection, id: ref.__id, data, options });
          const existing = options?.merge ? (col(ref.__collection).get(ref.__id) ?? {}) : {};
          col(ref.__collection).set(ref.__id, { ...existing, ...data });
        },
      };
      return fn(txn);
    },
  };
  return db;
}

const ROLES = Object.freeze({
  profileAdmin: {
    id: "profileAdmin",
    name: "x",
    description: "x",
    permissions: [EMPLOYEE_PROFILE_CAPABILITY],
  },
  nobody: { id: "nobody", name: "x", description: "x", permissions: [] },
});

const EMPLOYEE = {
  employeeId: "emp-1",
  displayName: "John Smith",
  employmentStatus: "ACTIVE",
  operationalRoles: ["TECHNICIAN"],
  securityRole: "technician",
  userId: "uid-john",
  jobTitle: "Service Technician",
};

function seeded({ roleId = "profileAdmin", employee = EMPLOYEE, extraEmployees = {} } = {}) {
  return makeDb({
    users: { "actor-1": { accessVersion: 1 } },
    roleAssignments: {
      "assign-1": {
        id: "assign-1",
        principalUid: "actor-1",
        roleId,
        scope: { type: "global" },
        status: "active",
        accessVersionAtGrant: 1,
      },
    },
    employees: { "emp-1": { ...employee }, ...extraEmployees },
  });
}

const DEPS = (db) => ({ db, roles: ROLES });
const KEY = "profilekey-0001";

const auditEvents = (db) => [...(db.__store.get("auditEvents") ?? new Map()).entries()];

async function rejects(fn, ErrorClass) {
  await assert.rejects(fn, (err) => err instanceof ErrorClass, `expected ${ErrorClass.name}`);
}

// ════════════════════ the refusals ════════════════════

test("securityRole, userId and account status are refused BY NAME, never silently ignored", async () => {
  // Silently ignoring them is the dangerous failure: an administrator changes a security role,
  // sees no error, and believes the person's access changed.
  const db = seeded();
  for (const key of ["securityRole", "role", "userId", "employeeId", "accountStatus", "disabled"]) {
    await assert.rejects(
      () => updateEmployeeProfile({ actorUid: "actor-1", employeeId: "emp-1", changes: { [key]: "x" }, idempotencyKey: KEY }, DEPS(db)),
      (err) => err instanceof InvalidInputError && err.message.includes(key),
      `${key} must be refused by name`,
    );
  }
  assert.equal(db.__writes.length, 0, "a refused request writes nothing at all");
});

test("an unknown field is refused rather than dropped", async () => {
  const db = seeded();
  await rejects(
    () => updateEmployeeProfile({ actorUid: "actor-1", employeeId: "emp-1", changes: { salary: 1 }, idempotencyKey: KEY }, DEPS(db)),
    InvalidInputError,
  );
});

// ════════════════════ validation ════════════════════

test("employmentStatus is single-valued, closed, and not clearable", async () => {
  const db = seeded();
  await rejects(
    () => updateEmployeeProfile({ actorUid: "actor-1", employeeId: "emp-1", changes: { employmentStatus: "PROBATION" }, idempotencyKey: KEY }, DEPS(db)),
    InvalidInputError,
  );
  await rejects(
    () => updateEmployeeProfile({ actorUid: "actor-1", employeeId: "emp-1", changes: { employmentStatus: "" }, idempotencyKey: KEY }, DEPS(db)),
    InvalidInputError,
  );
});

test("operationalRoles accepts only the canonical vocabulary, and never free text", async () => {
  const db = seeded();
  await rejects(
    () => updateEmployeeProfile({ actorUid: "actor-1", employeeId: "emp-1", changes: { operationalRoles: ["SUPERVISOR"] }, idempotencyKey: KEY }, DEPS(db)),
    InvalidInputError,
  );
  await rejects(
    () => updateEmployeeProfile({ actorUid: "actor-1", employeeId: "emp-1", changes: { operationalRoles: "TECHNICIAN" }, idempotencyKey: KEY }, DEPS(db)),
    InvalidInputError,
  );
});

test("a malformed email, date or idempotency key is refused before anything is read", async () => {
  const db = seeded();
  await rejects(
    () => updateEmployeeProfile({ actorUid: "actor-1", employeeId: "emp-1", changes: { workEmail: "not-an-email" }, idempotencyKey: KEY }, DEPS(db)),
    InvalidInputError,
  );
  await rejects(
    () => updateEmployeeProfile({ actorUid: "actor-1", employeeId: "emp-1", changes: { hireDate: "3 March" }, idempotencyKey: KEY }, DEPS(db)),
    InvalidInputError,
  );
  await rejects(
    () => updateEmployeeProfile({ actorUid: "actor-1", employeeId: "emp-1", changes: { jobTitle: "x" }, idempotencyKey: "short" }, DEPS(db)),
    InvalidInputError,
  );
});

// ════════════════════ authorization ════════════════════

test("an actor without the capability is DENIED and writes no employee data", async () => {
  const db = seeded({ roleId: "nobody" });
  await rejects(
    () => updateEmployeeProfile({ actorUid: "actor-1", employeeId: "emp-1", changes: { jobTitle: "Manager" }, idempotencyKey: KEY }, DEPS(db)),
    UnauthorizedActorError,
  );
  assert.equal(
    db.__writes.filter((w) => w.collection === "employees").length,
    0,
    "a denied request must not touch the employee record",
  );
  assert.equal(db.__store.get("employees").get("emp-1").jobTitle, "Service Technician");

  // AND THE REFUSAL IS ON THE TRAIL. A refused attempt to change somebody's employment record is
  // exactly what an auditor comes looking for, and it is recorded on the SAME immutable trail as
  // the change it refused -- with no field facts, because no field changed.
  const denial = auditEvents(db).map(([, d]) => d).find((e) => e.outcome === "denied");
  assert.ok(denial, "a denied profile edit must produce an Audit Event");
  assert.equal(denial.action, "updateEmployeeProfile");
  assert.equal(denial.targetType, EMPLOYEE_TARGET_TYPE);
  assert.equal(denial.targetId, "emp-1");
  assert.equal(denial.actorUid, "actor-1");
  assert.equal(denial.fieldKey, undefined);
});

test("authorization is re-resolved server-side on every call, from roleAssignments", async () => {
  // The same input, the same actor, two different grant states, two different answers -- so the
  // decision provably comes from the access records rather than from anything the caller sent.
  const denied = seeded({ roleId: "nobody" });
  await rejects(
    () => updateEmployeeProfile({ actorUid: "actor-1", employeeId: "emp-1", changes: { jobTitle: "Manager" }, idempotencyKey: KEY }, DEPS(denied)),
    UnauthorizedActorError,
  );
  const allowed = seeded();
  const outcome = await updateEmployeeProfile(
    { actorUid: "actor-1", employeeId: "emp-1", changes: { jobTitle: "Manager" }, idempotencyKey: KEY },
    DEPS(allowed),
  );
  assert.equal(outcome.status, "applied");
});

// ════════════════════ the write, and its audit ════════════════════

test("each changed field produces its OWN Audit Event carrying previous and new values", async () => {
  const db = seeded();
  const outcome = await updateEmployeeProfile(
    {
      actorUid: "actor-1",
      employeeId: "emp-1",
      changes: { jobTitle: "Senior Service Technician", employmentStatus: "ON_LEAVE" },
      idempotencyKey: KEY,
    },
    DEPS(db),
  );

  assert.equal(outcome.status, "applied");
  assert.deepEqual([...outcome.changedFields].sort(), ["employmentStatus", "jobTitle"]);

  const events = auditEvents(db).map(([, data]) => data);
  assert.equal(events.length, 2, "one event per changed field, not one bundled event");

  const jobTitle = events.find((e) => e.fieldKey === "jobTitle");
  assert.ok(jobTitle, "the jobTitle change must be its own event");
  assert.equal(jobTitle.action, "updateEmployeeProfile");
  assert.equal(jobTitle.targetType, EMPLOYEE_TARGET_TYPE);
  assert.equal(jobTitle.targetId, "emp-1");
  assert.equal(jobTitle.actorUid, "actor-1");
  assert.equal(jobTitle.outcome, "applied");
  assert.equal(jobTitle.previousValue, "Service Technician");
  assert.equal(jobTitle.newValue, "Senior Service Technician");

  const status = events.find((e) => e.fieldKey === "employmentStatus");
  assert.equal(status.previousValue, "ACTIVE");
  assert.equal(status.newValue, "ON_LEAVE");

  // And the record itself moved.
  const stored = db.__store.get("employees").get("emp-1");
  assert.equal(stored.jobTitle, "Senior Service Technician");
  assert.equal(stored.employmentStatus, "ON_LEAVE");
});

test("a field that had no value audits previousValue as null, never as a placeholder", async () => {
  const db = seeded();
  await updateEmployeeProfile(
    { actorUid: "actor-1", employeeId: "emp-1", changes: { employeeNumber: "TAZ-0042" }, idempotencyKey: KEY },
    DEPS(db),
  );
  const event = auditEvents(db).map(([, d]) => d).find((e) => e.fieldKey === "employeeNumber");
  assert.equal(event.previousValue, null);
  assert.equal(event.newValue, "TAZ-0042");
});

test("an array field audits as words, not as JSON", async () => {
  const db = seeded();
  await updateEmployeeProfile(
    {
      actorUid: "actor-1",
      employeeId: "emp-1",
      changes: { operationalRoles: ["TECHNICIAN", "PARTS_ASSOCIATE"] },
      idempotencyKey: KEY,
    },
    DEPS(db),
  );
  const event = auditEvents(db).map(([, d]) => d).find((e) => e.fieldKey === "operationalRoles");
  assert.equal(event.previousValue, "TECHNICIAN");
  // Stored (and therefore audited) in the declared vocabulary order, so a reorder is never a change.
  assert.equal(event.newValue, "PARTS_ASSOCIATE, TECHNICIAN");
  assert.deepEqual(db.__store.get("employees").get("emp-1").operationalRoles, ["PARTS_ASSOCIATE", "TECHNICIAN"]);
});

test("a nested address key audits as its own field", async () => {
  const db = seeded();
  await updateEmployeeProfile(
    { actorUid: "actor-1", employeeId: "emp-1", changes: { "address.city": "Phoenix" }, idempotencyKey: KEY },
    DEPS(db),
  );
  const event = auditEvents(db).map(([, d]) => d).find((e) => e.fieldKey === "address.city");
  assert.ok(event, "a city change is a city change in the trail, not an opaque object diff");
  assert.equal(db.__store.get("employees").get("emp-1").address.city, "Phoenix");
});

test("a save that changes nothing writes NOTHING -- no document, no Audit Event", async () => {
  const db = seeded();
  const outcome = await updateEmployeeProfile(
    { actorUid: "actor-1", employeeId: "emp-1", changes: { jobTitle: "  Service Technician  " }, idempotencyKey: KEY },
    DEPS(db),
  );
  assert.equal(outcome.status, "unchanged");
  assert.deepEqual(outcome.changedFields, []);
  assert.equal(db.__writes.length, 0, "a no-op must not create a misleading change event");
});

test("only the CHANGED keys are written, so a concurrent edit to another field survives", async () => {
  const db = seeded();
  await updateEmployeeProfile(
    {
      actorUid: "actor-1",
      employeeId: "emp-1",
      // employmentStatus resubmitted unchanged alongside a real change.
      changes: { jobTitle: "Lead Technician", employmentStatus: "ACTIVE" },
      idempotencyKey: KEY,
    },
    DEPS(db),
  );
  const write = db.__writes.find((w) => w.collection === "employees");
  assert.deepEqual(Object.keys(write.data).sort(), ["jobTitle", "updatedAt"]);
  assert.equal(write.options.merge, true);
});

test("a replayed idempotency key applies nothing a second time", async () => {
  const db = seeded();
  const first = await updateEmployeeProfile(
    { actorUid: "actor-1", employeeId: "emp-1", changes: { jobTitle: "Lead Technician" }, idempotencyKey: KEY },
    DEPS(db),
  );
  assert.equal(first.status, "applied");
  const writesAfterFirst = db.__writes.length;

  const second = await updateEmployeeProfile(
    { actorUid: "actor-1", employeeId: "emp-1", changes: { jobTitle: "Something Else" }, idempotencyKey: KEY },
    DEPS(db),
  );
  assert.equal(second.status, "replayed");
  assert.equal(db.__writes.length, writesAfterFirst, "a replay writes nothing");
  assert.equal(db.__store.get("employees").get("emp-1").jobTitle, "Lead Technician");
});

// ════════════════════ the manager relationship ════════════════════

test("a manager must be an EXISTING employee, and never the person themselves", async () => {
  const db = seeded();
  await rejects(
    () => updateEmployeeProfile({ actorUid: "actor-1", employeeId: "emp-1", changes: { managerEmployeeId: "emp-nobody" }, idempotencyKey: KEY }, DEPS(db)),
    UnknownManagerError,
  );
  await rejects(
    () => updateEmployeeProfile({ actorUid: "actor-1", employeeId: "emp-1", changes: { managerEmployeeId: "emp-1" }, idempotencyKey: KEY }, DEPS(db)),
    InvalidInputError,
  );

  const withManager = seeded({ extraEmployees: { "emp-2": { displayName: "Mike Jones" } } });
  const outcome = await updateEmployeeProfile(
    { actorUid: "actor-1", employeeId: "emp-1", changes: { managerEmployeeId: "emp-2" }, idempotencyKey: KEY },
    DEPS(withManager),
  );
  assert.equal(outcome.status, "applied");
});

test("a missing employee is a not-found, not a create", async () => {
  const db = seeded();
  await rejects(
    () => updateEmployeeProfile({ actorUid: "actor-1", employeeId: "emp-ghost", changes: { jobTitle: "x" }, idempotencyKey: KEY }, DEPS(db)),
    EmployeeNotFoundError,
  );
  assert.equal(db.__store.get("employees").has("emp-ghost"), false);
});

// ════════════════════ the mirrors ════════════════════

test("operationalRoles mirrors provisionEmployeeAccess.js, the collection's other writer", () => {
  // A mirror kept in prose stays a mirror only until somebody edits one side. This is the check
  // that makes the drift a failure rather than a surprise.
  const script = readFileSync(join(HERE, "../scripts/provisionEmployeeAccess.js"), "utf8");
  const block = /VALID_OPERATIONAL_ROLES\s*=\s*\[([^\]]*)\]/.exec(script);
  assert.ok(block, "VALID_OPERATIONAL_ROLES must still exist in provisionEmployeeAccess.js");
  const fromScript = [...block[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...OPERATIONAL_ROLE_VALUES], fromScript);
});

test("employmentStatus mirrors domain/constants.js EMPLOYMENT_STATUS, its canonical home", () => {
  // The employment vocabulary has never lived in the provisioning script -- that script only ever
  // writes ACTIVE. Its canonical machine values are domain/constants.js's EMPLOYMENT_STATUS, which
  // is what the employee specification's Data model names, so that is what this is checked against.
  const constants = readFileSync(
    join(HERE, "../../field-ops-app-vite/src/domain/constants.js"),
    "utf8",
  );
  const block = /export const EMPLOYMENT_STATUS = \{([^}]*)\}/.exec(constants);
  assert.ok(block, "EMPLOYMENT_STATUS must still exist in domain/constants.js");
  const fromConstants = [...block[1].matchAll(/([A-Z_]+):\s*"([A-Z_]+)"/g)].map((m) => m[2]);
  assert.deepEqual([...EMPLOYMENT_STATUS_VALUES], fromConstants);
});

test("the editable field set matches the client's, so the form cannot offer what the command refuses", () => {
  const clientSrc = readFileSync(
    join(HERE, "../../field-ops-app-vite/src/domain/employeeProfile.js"),
    "utf8",
  );
  const clientKeys = [...clientSrc.matchAll(/\{ key: "([a-zA-Z.]+)", label:/g)].map((m) => m[1]);
  assert.deepEqual(
    EDITABLE_EMPLOYEE_FIELDS.map((f) => f.key).sort(),
    clientKeys.sort(),
    "the enforcing list and the form's list must name the same fields",
  );
});
