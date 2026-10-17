from ed import edit
edit("test/eosOpsApiShape.test.mjs", [
("""      "listTruckRoster", "readTruckStock"]);""",
"""      "listTruckRoster", "readTruckStock",
      // Returns intake (Firebase exit F7a, DECISIONS #242): the caller's companies and receiving warehouses.
      "listReturnIntakeOptions"]);"""),
("""    "createPartSupplierItem", "updatePartSupplierItem", "setPartSupplierItemStatus", "setPreferredPartSupplierItem",
  ]);""",
"""    "createPartSupplierItem", "updatePartSupplierItem", "setPartSupplierItemStatus", "setPreferredPartSupplierItem",
    // Returns intake (Firebase exit F7a, DECISIONS #242): intake only, no ledger movement (#118).
    "recordReturnIntake",
  ]);"""),
("""  const reorderOps = [...OPERATIONS_READ_OPERATIONS, ...OPERATIONS_MUTATION_OPERATIONS].filter((o) => !/^resolveMy/.test(o));""",
"""  // Returns intake is its OWN authority (F7a, #242), deliberately not behind the Reorder activation boundary.
  const RETURNS = ["listReturnIntakeOptions", "recordReturnIntake"];
  const reorderOps = [...OPERATIONS_READ_OPERATIONS, ...OPERATIONS_MUTATION_OPERATIONS].filter((o) => !/^resolveMy/.test(o) && !RETURNS.includes(o));
  for (const operation of RETURNS) {
    const r = await executeOperation({ reader: untouchable, pool: untouchable, reorderPostgresActive: false },
      { caller: { externalSubject: "x", identityProvider: "firebase", requestedTenantId: null }, operation, input: {} }).catch((e) => e);
    assert.notEqual(r && r.code, "PRECONDITION_FAILED", `${operation} must not be behind the Reorder boundary`);
  }"""),
])
edit("test/roleCapabilityAuthorityBaselinePostgres.test.mjs", [
("""  // 451 -> 481 (MIGRATION_BACKED 393 -> 423): migration 1764520000000, Rental (#207) -- the six rental capabilities to their analog Roles.
  assert.equal(AUTHORITY_BASELINE_GRANTS.length, 481);
  assert.deepEqual(counts, {
    MIGRATION_BACKED: 423, CANONICAL_CATALOG: 53, NONPROD_ACTIVATION: 5, FIXTURE_ONLY: 0, UNEXPLAINED: 0,
  });""",
"""  // 451 -> 481 (MIGRATION_BACKED 393 -> 423): migration 1764520000000, Rental (#207) -- the six rental capabilities to their analog Roles.
  // 481 -> 482 (MIGRATION_BACKED 423 -> 424): migration 1764580000000, Returns intake (F7a, #242) -- inventoryReturnsIntakeClerk ->
  // inventory.returns.intake, the one memberless Role the Owner ruling names.
  assert.equal(AUTHORITY_BASELINE_GRANTS.length, 482);
  assert.deepEqual(counts, {
    MIGRATION_BACKED: 424, CANONICAL_CATALOG: 53, NONPROD_ACTIVATION: 5, FIXTURE_ONLY: 0, UNEXPLAINED: 0,
  });"""),
])
