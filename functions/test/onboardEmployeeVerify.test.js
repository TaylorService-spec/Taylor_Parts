const assert = require("node:assert/strict");
const test = require("node:test");

const {
  validatePlan,
  verifyEntry,
} = require("../scripts/onboardEmployeeVerify.js");

function employeeOnlyDb(employee, linkedUserCount = 0) {
  return {
    collection(name) {
      if (name === "employees") {
        return { doc: () => ({ get: async () => ({ exists: true, data: () => employee }) }) };
      }
      if (name === "users") {
        return {
          where(field, operator, employeeId) {
            assert.equal(field, "employeeId");
            assert.equal(operator, "==");
            assert.equal(employeeId, "emp-1");
            return { get: async () => ({ empty: linkedUserCount === 0, size: linkedUserCount }) };
          },
        };
      }
      throw new Error(`Unexpected collection: ${name}`);
    },
  };
}

test("Employee-only verification accepts no operational roles", async () => {
  const result = await verifyEntry(
    employeeOnlyDb({ employmentStatus: "ACTIVE", userId: null, operationalRoles: [] }),
    null,
    { employeeId: "emp-1", linked: false },
  );
  assert.deepEqual(result, { pass: true });
});

test("Employee-only verification accepts an approved expected operational role", async () => {
  const result = await verifyEntry(
    employeeOnlyDb({ employmentStatus: "ACTIVE", userId: null, operationalRoles: ["PARTS_ASSOCIATE"] }),
    null,
    { employeeId: "emp-1", linked: false, operationalRoles: ["PARTS_ASSOCIATE"] },
  );
  assert.deepEqual(result, { pass: true });
});

test("Employee-only verification rejects unexpected or missing operational roles", async (t) => {
  for (const scenario of [
    { stored: ["PARTS_ASSOCIATE"], expected: [] },
    { stored: [], expected: ["PARTS_ASSOCIATE"] },
  ]) {
    await t.test(JSON.stringify(scenario), async () => {
      const result = await verifyEntry(
        employeeOnlyDb({ employmentStatus: "ACTIVE", userId: null, operationalRoles: scenario.stored }),
        null,
        { employeeId: "emp-1", linked: false, operationalRoles: scenario.expected },
      );
      assert.equal(result.pass, false);
      assert.match(result.reason, /does not match expected/);
    });
  }
});

test("Employee-only verification rejects a users document that references the Employee", async () => {
  const result = await verifyEntry(
    employeeOnlyDb({ employmentStatus: "ACTIVE", userId: null, operationalRoles: [] }, 1),
    null,
    { employeeId: "emp-1", linked: false },
  );
  assert.equal(result.pass, false);
  assert.match(result.reason, /users document/);
});

test("validatePlan accepts complete linked and Employee-only entries", () => {
  const plan = [
    { employeeId: "emp-1", linked: false, operationalRoles: ["PARTS_ASSOCIATE"] },
    { employeeId: "emp-2", linked: true, email: "operator@example.com", securityRole: "dispatcher", operationalRoles: [] },
  ];
  assert.equal(validatePlan(plan), plan);
});

test("validatePlan rejects malformed plans before callers can initialize Firebase", async (t) => {
  const malformedPlans = [
    null,
    [],
    [{}],
    [{ employeeId: "", linked: false }],
    [{ employeeId: "emp-1" }],
    [{ employeeId: "emp-1", linked: "false" }],
    [{ employeeId: "emp-1", linked: true, securityRole: "dispatcher" }],
    [{ employeeId: "emp-1", linked: true, email: "a@example.com" }],
    [{ employeeId: "emp-1", linked: true, email: "a@example.com", securityRole: "owner" }],
    [{ employeeId: "emp-1", linked: false, operationalRoles: "PARTS_ASSOCIATE" }],
    [{ employeeId: "emp-1", linked: false, operationalRoles: ["NOT_A_ROLE"] }],
    [{ employeeId: "emp-1", linked: false, email: "a@example.com" }],
    [{ employeeId: "emp-1", linked: false, securityRole: "dispatcher" }],
    [{ employeeId: "emp-1", linked: false }, { employeeId: "emp-1", linked: false }],
  ];

  for (const [index, plan] of malformedPlans.entries()) {
    await t.test(`malformed plan ${index + 1}`, () => {
      assert.throws(() => validatePlan(plan));
    });
  }
});
