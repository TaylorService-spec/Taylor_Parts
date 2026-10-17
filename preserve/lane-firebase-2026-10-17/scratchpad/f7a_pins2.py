from ed import edit
F = "D:/eos-fb-exit/functions/"
edit(F + "test/financialPolicyFoundationPostgres.test.mjs", [
("""    "--migrations-dir", "migrations", "--no-check-order", String(count)], { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "pipe" });
""",
"""    "--migrations-dir", "migrations", "--no-check-order", String(count)], { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "pipe" });
  // Later lanes' migrations sit above #232's. The MIG proofs below are about #232's own two migrations, so each one peels the
  // later ones first -- counted from the tree, not pinned -- and restores them after.
  const NEWER = readdirSync(resolve(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql") && f > `${PHASE3_MIGRATION}.sql`).length;
  const peelNewer = () => { if (NEWER) migrate("down", NEWER); };
  const restoreNewer = () => { if (NEWER) migrate("up", NEWER); };
"""),
("""    // Later lanes' migrations sit above #232's; peel them first, measured from the tree rather than pinned, and restore
    // them last, so the before/after comparisons below are about #232's two migrations alone.
    const newer = readdirSync(resolve(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql") && f > "1764570000000_financial-policy-withdraw-cancel.sql").length;
    if (newer) migrate("down", newer);
""", """    peelNewer();
"""),
("""    if (newer) migrate("up", newer);
""", """    restoreNewer();
"""),
("""    const caps = await capCount();
    migrate("down", 1); // the Phase 3 migration: no WITHDRAWN / CANCELLED row, so its Down proceeds
    try {""", """    peelNewer();
    const caps = await capCount();
    migrate("down", 1); // the Phase 3 migration: no WITHDRAWN / CANCELLED row, so its Down proceeds
    try {"""),
("""    } finally {
      migrate("up", 1);
    }""", """    } finally {
      migrate("up", 1);
      restoreNewer();
    }"""),
("""    // The newest (#232 Phase 3) refuses while a WITHDRAWN or CANCELLED version exists: the old CHECKs could not hold them.
    assert.throws(() => migrate("down", 1), (e) => /FINANCIAL_POLICY_WITHDRAW_CANCEL: refuses to reverse/.test(String(e.stderr ?? e.message)));""",
"""    // #232 Phase 3 refuses while a WITHDRAWN or CANCELLED version exists: the old CHECKs could not hold them.
    peelNewer();
    try {
      assert.throws(() => migrate("down", 1), (e) => /FINANCIAL_POLICY_WITHDRAW_CANCEL: refuses to reverse/.test(String(e.stderr ?? e.message)));
    } finally {
      restoreNewer();
    }"""),
])
edit(F + "test/pendingAuthorityCorrectionsPostgres.test.mjs", [
("""GOVERNED_CONFIGURATION, "migration:1764510000000", "migration:1764520000000"],
    "the activation vehicle""", """GOVERNED_CONFIGURATION, "migration:1764510000000", "migration:1764520000000",
    "migration:1764580000000"],
    "the activation vehicle"""),
])
edit(F + "test/personaBusinessAccessRegression.test.mjs", [
("""      "migration:1763078400000", "migration:1764500000000", "migration:1764510000000", "migration:1764520000000"]);
    assert.equal(rebuilt.length - baselineDeployment.measuredInNonprodTotal, 94);""",
"""      "migration:1763078400000", "migration:1764500000000", "migration:1764510000000", "migration:1764520000000", "migration:1764580000000"]);
    assert.equal(rebuilt.length - baselineDeployment.measuredInNonprodTotal, 95);"""),
("""    assert.equal(await stampedBy("migration:1764520000000"), 30); // Rental: six keys to their analog Roles""",
"""    assert.equal(await stampedBy("migration:1764520000000"), 30); // Rental: six keys to their analog Roles
    assert.equal(await stampedBy("migration:1764580000000"), 1); // Returns intake (#242): the one memberless clerk Role"""),
])
