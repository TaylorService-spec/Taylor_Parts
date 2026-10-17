import re
from ed import edit
F = "D:/eos-fb-exit/functions/"
edit(F + "src/adminPolicy/roleCapabilityAdministration.ts", [
(""" * The compiled Role catalog (admin composes the whole legacy permission catalog) declares these eight (Role, capability)""",
 """ * The compiled Role catalog (admin composes the whole legacy permission catalog) declares these (Role, capability)"""),
("""  ["technician", "reorder.purchaseOrder.create"], ["technician", "reorder.purchaseOrder.read"],
].map(""",
"""  ["technician", "reorder.purchaseOrder.create"], ["technician", "reorder.purchaseOrder.read"],
  // Owner ruling 3, #242 (F7a, 2026-10-17): inventory.returns.intake is held by ONE Role, the memberless
  // inventoryReturnsIntakeClerk (migration 1764580000000). admin's whole-catalog composition is not a default; the
  // Administrator gets it the way anyone does, through a governed, audited assignment.
  ["admin", "inventory.returns.intake"],
].map("""),
])
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
NOTE = " // 139 -> 140: inventory.returns.intake (#242, 1764580000000)."
edit(F + "test/credConvergencePostgres.test.mjs", [("""    assert.equal(total, 139, //""", """    assert.equal(total, 140, // 139 -> 140: inventory.returns.intake (#242, 1764580000000), granted to the memberless clerk Role. //""")])
edit(F + "test/governedPrincipalProvisioningPostgres.test.mjs", [
("""    assert.equal(counts["eos_policy.capabilities"], 139, //""", """    assert.equal(counts["eos_policy.capabilities"], 140, // + inventory.returns.intake (#242, 1764580000000). //"""),
("""      "the capability catalog is not the measured 139 (""", """      "the capability catalog is not the measured 140 (inventory.returns.intake, 1764580000000, + """),
("""    assert.equal((await q("SELECT count(*)::int AS n FROM eos_policy.capabilities")).rows[0].n, 139); //""", """    assert.equal((await q("SELECT count(*)::int AS n FROM eos_policy.capabilities")).rows[0].n, 140); // 139 -> 140 (#242, 1 key, the clerk Role). //"""),
("""    assert.equal(after["eos_policy.capabilities"], 139, "the capability catalog changed");""", """    assert.equal(after["eos_policy.capabilities"], 140, "the capability catalog changed");"""),
])
edit(F + "test/pendingAuthorityCorrectionsPostgres.test.mjs", [
("""  assert.equal(AUTHORITY_BASELINE_GRANTS.length, 481,
    "387 measured""", """  assert.equal(AUTHORITY_BASELINE_GRANTS.length, 482,
    "1 returns-intake clerk grant (1764580000000) + 387 measured"""),
("""    MIGRATION_BACKED: 423, CANONICAL_CATALOG: 53,""", """    MIGRATION_BACKED: 424, CANONICAL_CATALOG: 53,"""),
("""  assert.equal(globalAuthorityGrants().length, 476);
  assert.equal(nonprodAuthorityGrants().length, 481);""", """  assert.equal(globalAuthorityGrants().length, 477);
  assert.equal(nonprodAuthorityGrants().length, 482);"""),
("""      assert.equal(rebuilt.length, 481);""", """      assert.equal(rebuilt.length, 482);"""),
])
edit(F + "test/personaBusinessAccessRegression.test.mjs", [
("""    assert.equal(rebuilt.length, 481, "the repository rebuild total"); //""", """    assert.equal(rebuilt.length, 482, "the repository rebuild total"); // 481 -> 482: the returns-intake clerk grant (1764580000000). //"""),
("""    assert.equal(baselineDeployment.rebuildTotal, 481);""", """    assert.equal(baselineDeployment.rebuildTotal, 482);"""),
("""    assert.equal(await one("SELECT count(*)::int n FROM eos_policy.capabilities"), 139); //""", """    assert.equal(await one("SELECT count(*)::int n FROM eos_policy.capabilities"), 140); // 139 -> 140: inventory.returns.intake (#242). //"""),
])
