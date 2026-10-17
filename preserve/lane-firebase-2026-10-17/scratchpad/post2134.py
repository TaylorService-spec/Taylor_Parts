from ed import edit
F = "D:/eos-fb-exit/functions/"
edit(F + "test/adminPolicySeedCoverage.test.mjs", [
    ("  assert.equal(ledger.seeded.objects, 50);", "  assert.equal(ledger.seeded.objects, 51);"),
    ("  assert.equal(ledger.seeded.objectsFromCapabilityAuthority, 16);", "  assert.equal(ledger.seeded.objectsFromCapabilityAuthority, 17);"),
])
# PROOF 6/6: CRM activity is a later, separately decided migration -- set aside on both sides like 1764510000000 / 1764520000000.
edit(F + "test/pendingAuthorityCorrectionsPostgres.test.mjs", [
    ("""      && g.evidence !== "migration:1764500000000" && g.evidence !== "migration:1764510000000" && g.evidence !== "migration:1764520000000")""",
     """      && g.evidence !== "migration:1764500000000" && g.evidence !== "migration:1764510000000" && g.evidence !== "migration:1764520000000"
      && g.evidence !== "migration:1764590000000")"""),
    ("""      && g.evidence !== GOVERNED_CONFIGURATION && g.evidence !== "migration:1764510000000" && g.evidence !== "migration:1764520000000")""",
     """      && g.evidence !== GOVERNED_CONFIGURATION && g.evidence !== "migration:1764510000000" && g.evidence !== "migration:1764520000000"
      && g.evidence !== "migration:1764590000000")"""),
    ("""  // 66 / 47 -> 68 / 49: crm.activity.read / .create (#243, 1764590000000) land on BOTH Roles, so the 19 stay the 19.
  assert.equal(adminBefore.size, 68);
  assert.equal(ownerBefore.size, 49);""", """  assert.equal(adminBefore.size, 66);
  assert.equal(ownerBefore.size, 47);"""),
    ("""    "migration:1764580000000"],
    "the activation vehicle""", """    "migration:1764580000000", "migration:1764590000000"],
    "the activation vehicle"""),
])
edit(F + "test/personaBusinessAccessRegression.test.mjs", [
    ("""      "migration:1763078400000", "migration:1764500000000", "migration:1764510000000", "migration:1764520000000", "migration:1764580000000"]);
    assert.equal(rebuilt.length - baselineDeployment.measuredInNonprodTotal, 95);""",
     """      "migration:1763078400000", "migration:1764500000000", "migration:1764510000000", "migration:1764520000000", "migration:1764580000000",
      "migration:1764590000000"]);
    assert.equal(rebuilt.length - baselineDeployment.measuredInNonprodTotal, 101);"""),
    ("""    assert.equal(await stampedBy("migration:1764580000000"), 1); // Returns intake (#242): the one memberless clerk Role
    // The whole 482-vs-387 difference carries the seven grant-bearing migrations' provenance.
    assert.equal(26 + 1 + 1 + 16 + 20 + 30 + 1, rebuilt.length""",
     """    assert.equal(await stampedBy("migration:1764580000000"), 1); // Returns intake (#242): the one memberless clerk Role
    assert.equal(await stampedBy("migration:1764590000000"), 6); // CRM activity (#243): two keys x admin, owner, crmActivityContributor
    // The whole 488-vs-387 difference carries the eight grant-bearing migrations' provenance.
    assert.equal(26 + 1 + 1 + 16 + 20 + 30 + 1 + 6, rebuilt.length"""),
    ("""  assert.equal(files.length, 100, "the migration chain moved""", """  assert.equal(files.length, 101, "the migration chain moved"""),
])
edit(F + "test/migrationLedgerOrderGuard.test.mjs", [
    ("const RUNNABLE_MIGRATION_COUNT = 100;", "const RUNNABLE_MIGRATION_COUNT = 101;"),
    ("const TRACKED_MIGRATION_COUNT = 101; // the 100 runnable + the one deferred file", "const TRACKED_MIGRATION_COUNT = 102; // the 101 runnable + the one deferred file"),
])
edit(F + "test/administrationReadEnforcement.test.mjs", [
    ("  assert.equal(migrations.length, 100, \"a migration was added", "  assert.equal(migrations.length, 101, \"a migration was added"),
])
edit(F + "test/sampleCompanyPostgres.test.mjs", [("const PINNED_MIGRATION_COUNT = 100;", "const PINNED_MIGRATION_COUNT = 101;")])
print("ok")
