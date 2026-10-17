from ed import edit
F = "D:/eos-fb-exit/functions/"
edit(F + "test/financialPolicyFoundationPostgres.test.mjs", [
("""    const grantsBefore = await grantSnapshot();
    const directBefore = await directSnapshot();
    const capCount = async () => Number((await one(`SELECT count(*) AS n FROM eos_policy.capabilities`)).n);
    const capsUp = await capCount();""",
"""    // Later lanes' migrations sit above #232's; peel them first, measured from the tree rather than pinned, and restore
    // them last, so the before/after comparisons below are about #232's two migrations alone.
    const newer = readdirSync(resolve(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql") && f > "1764570000000_financial-policy-withdraw-cancel.sql").length;
    if (newer) migrate("down", newer);
    const grantsBefore = await grantSnapshot();
    const directBefore = await directSnapshot();
    const capCount = async () => Number((await one(`SELECT count(*) AS n FROM eos_policy.capabilities`)).n);
    const capsUp = await capCount();"""),
("""    assert.deepEqual(await directSnapshot(), directBefore);
    // The existing Finance read""", """    assert.deepEqual(await directSnapshot(), directBefore);
    if (newer) migrate("up", newer);
    // The existing Finance read"""),
("""import { readFileSync } from "node:fs";""", """import { readFileSync, readdirSync } from "node:fs";"""),
])
edit(F + "test/credConvergencePostgres.test.mjs", [("""    assert.equal(total, 139, //""", """    assert.equal(total, 141, // 139 -> 141: crm.activity.read / .create (#243, 1764590000000). //""")])
edit(F + "test/governedPrincipalProvisioningPostgres.test.mjs", [
("""    assert.equal(counts["eos_policy.capabilities"], 139, //""", """    assert.equal(counts["eos_policy.capabilities"], 141, // + crm.activity.read / .create (#243, 1764590000000). //"""),
("""      "the capability catalog is not the measured 139 (""", """      "the capability catalog is not the measured 141 (crm.activity.read / .create, 1764590000000, + """),
("""    assert.equal((await q("SELECT count(*)::int AS n FROM eos_policy.capabilities")).rows[0].n, 139); //""", """    assert.equal((await q("SELECT count(*)::int AS n FROM eos_policy.capabilities")).rows[0].n, 141); // 139 -> 141 (#243, 2 keys, admin / owner / crmActivityContributor). //"""),
("""    assert.equal(after["eos_policy.capabilities"], 139, "the capability catalog changed");""", """    assert.equal(after["eos_policy.capabilities"], 141, "the capability catalog changed");"""),
])
edit(F + "test/pendingAuthorityCorrectionsPostgres.test.mjs", [
("""  assert.equal(AUTHORITY_BASELINE_GRANTS.length, 481,
    "387 measured""", """  assert.equal(AUTHORITY_BASELINE_GRANTS.length, 487,
    "6 CRM activity grants (1764590000000) + 387 measured"""),
("""    MIGRATION_BACKED: 423, CANONICAL_CATALOG: 53,""", """    MIGRATION_BACKED: 429, CANONICAL_CATALOG: 53,"""),
("""  assert.equal(globalAuthorityGrants().length, 476);
  assert.equal(nonprodAuthorityGrants().length, 481);""", """  assert.equal(globalAuthorityGrants().length, 482);
  assert.equal(nonprodAuthorityGrants().length, 487);"""),
("""      assert.equal(rebuilt.length, 481);""", """      assert.equal(rebuilt.length, 487);"""),
("""  // MEASURED BEFORE: owner was a STRICT SUBSET of admin -- 47 of admin's 66, 19 admin-only, 0 owner-only.
  assert.equal(adminBefore.size, 66);
  assert.equal(ownerBefore.size, 47);""", """  // MEASURED BEFORE: owner was a STRICT SUBSET of admin -- 47 of admin's 66, 19 admin-only, 0 owner-only.
  // 66 / 47 -> 68 / 49: crm.activity.read / .create (#243, 1764590000000) land on BOTH Roles, so the 19 stay the 19.
  assert.equal(adminBefore.size, 68);
  assert.equal(ownerBefore.size, 49);"""),
])
edit(F + "test/personaBusinessAccessRegression.test.mjs", [
("""    assert.equal(rebuilt.length, 481, "the repository rebuild total"); //""", """    assert.equal(rebuilt.length, 487, "the repository rebuild total"); // 481 -> 487: the six CRM activity grants (1764590000000). //"""),
("""    assert.equal(baselineDeployment.rebuildTotal, 481);""", """    assert.equal(baselineDeployment.rebuildTotal, 487);"""),
("""    assert.equal(await one("SELECT count(*)::int n FROM eos_policy.capabilities"), 139); //""", """    assert.equal(await one("SELECT count(*)::int n FROM eos_policy.capabilities"), 141); // 139 -> 141: crm.activity.read / .create (#243). //"""),
("""    assert.equal(admin.capabilities.size, 73);""", """    // 73 -> 75: crm.activity.read / .create (#243, 1764590000000), mirrored onto admin AND owner.
    assert.equal(admin.capabilities.size, 75);"""),
("""    assert.equal(owner.capabilities.size, 65);""", """    // 65 -> 67: crm.activity.read / .create (#243), the same two keys admin gained -- neither Role gains anything the other lacks.
    assert.equal(owner.capabilities.size, 67);"""),
])
edit(F + "test/crmCustomerPostgres.test.mjs", [
("""test("eos_crm stands beside eos_policy and eos_ops, with its three record tables and nothing else\"""", """test("eos_crm stands beside eos_policy and eos_ops, with its record tables and nothing else\""""),
("""  // ownership history. Still no location or inventory table of any kind.
  assert.deepEqual(tables.rows.map((r) => r.table_name), [
    "account_lines_of_business", "account_locations", "account_ownership_history", "account_relationship_types", "account_tags", "accounts",
    "command_receipts", "contacts",""", """  // ownership history, plus migration 1764590000000's Account activity log (#243, F7b). Still no location or inventory
  // table of any kind.
  assert.deepEqual(tables.rows.map((r) => r.table_name), [
    "account_lines_of_business", "account_locations", "account_ownership_history", "account_relationship_types", "account_tags", "accounts",
    "activities", "command_receipts", "contacts","""),
])
edit(F + "test/crmTransportPostgres.test.mjs", [
("""    "createAccount", "createAccountLocation", "createContact", "getAccount", "getAccountLocation", "getContact",
    "importAccountContacts", "listAccountContacts", "listAccountLocations", "listAccountOwnershipHistory", "listAccounts",
    "updateAccount", "updateAccountLocation", "updateContact",
  ]);
  assert.equal(http.CRM_OPERATIONS.length, 14);""", """    "createAccount", "createAccountActivity", "createAccountLocation", "createContact", "getAccount", "getAccountLocation", "getContact",
    "importAccountContacts", "listAccountActivities", "listAccountContacts", "listAccountLocations", "listAccountOwnershipHistory", "listAccounts",
    "updateAccount", "updateAccountLocation", "updateContact",
  ]);
  assert.equal(http.CRM_OPERATIONS.length, 16); // 14 -> 16: the Account activity read and create (#243, F7b)."""),
])
