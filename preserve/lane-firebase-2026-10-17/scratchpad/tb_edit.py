from ed import edit
F = "D:/eos-fb-exit/functions/"
# 1. the seed Objects: an exact, named list from the canonical registry, not a count
edit(F + "test/coordinatedVisitObjectRehome.test.mjs", [
("""  assert.equal(seed.objects.length, 40,
    "41 minus the two Objects that governed nothing, plus reportDefinition -- Reporting Slice 1, "
    + "migration 1762300800000. The retirement this file guards is unaffected: a later Object being "
    + "REGISTERED does not un-retire dispatchSchedule or notifications, and the two assertions "
    + "below still name them.");""",
"""  // THE CANONICAL REGISTRY, NAMED. policySeedSnapshot.json is the governed Object registry. This was a bare count (40,
  // correct at 9fa82e94, 2026-09-24) that drifted unseen because no workflow ran this file. Nine decided registrations
  // followed: inboundMailbox + inboundWorkRequest (bca7aa5f, Work Order activation), financeConfiguration (#203),
  // salesDiscountAuthority + systemConfiguration (#204), settlement (#206), rentalAgreement + rentalEquipment (#207),
  // financialPolicy (#232). Pinned as the exact key list, so a registration is a named change here, never a silent count.
  // The retirement this file guards is unaffected: registering a later Object does not un-retire dispatchSchedule or
  // notifications, and the assertions below still name them.
  assert.deepEqual(seed.objects.map((o) => o.key).sort(), [
    "account", "auditLog", "commissions", "contact", "cycleCount", "dataImport", "employee", "equipment", "equipmentModel",
    "financeConfiguration", "financialPolicy", "inboundMailbox", "inboundWorkRequest", "inventoryAction", "inventoryTransaction",
    "invoice", "location", "manufacturer", "marketingInitiatives", "mobileLocation", "opportunity", "part", "partAlias", "payment",
    "principal", "purchaseOrder", "purchaseOrderVoid", "receivingOrder", "rentalAgreement", "rentalEquipment", "reorderRequest",
    "reportDefinition", "rolesPermissions", "salesAgreement", "salesDiscountAuthority", "salesOrder", "salesTerritory",
    "serializedAssets", "settlement", "supplier", "supplierCatalogItem", "systemConfiguration", "technicianTimeNonWork",
    "transferOrder", "truck", "warehouse", "workOrder", "workflowDefinition", "workflowInstance",
  ]);"""),
("""    const total = await pool.query("SELECT count(*)::int n FROM eos_policy.objects");
    assert.equal(total.rows[0].n, 40, "the seed and the database agree on 40 Objects");""",
"""    const total = await pool.query("SELECT count(*)::int n FROM eos_policy.objects");
    const seedObjects = JSON.parse(readFileSync(resolve(FUNCTIONS_DIR, "src/adminPolicy/seed/policySeedSnapshot.json"), "utf8")).objects;
    assert.equal(total.rows[0].n, seedObjects.length, "the seed and the database agree on every registered Object");"""),
])
# 2. the newest-migration pin was the wrong assertion: raised by hand for ten unrelated lanes
edit(F + "test/manufacturerRuntimeAuthorityPostgres.test.mjs", [
("""test("this change adds no migration: the applied set is the one the base commit had", () => {
  const files = readdirSync(resolve(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  const manufacturerMigrations = files.filter((f) => /manufacturer/i.test(f));
  assert.deepEqual(manufacturerMigrations, ["1761782400000_manufacturer-catalog-authority.sql"],
    "the Manufacturer authority has exactly one migration and this lane adds none");""",
"""test("the Manufacturer authority has exactly one migration", () => {
  const files = readdirSync(resolve(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  const manufacturerMigrations = files.filter((f) => /manufacturer/i.test(f));
  assert.deepEqual(manufacturerMigrations, ["1761782400000_manufacturer-catalog-authority.sql"],
    "the Manufacturer authority has exactly one migration and this lane adds none");
  // A "newest migration <= X" pin used to follow here. It said nothing about Manufacturers and was raised by hand for ten
  // unrelated lanes, then went stale unseen because no workflow ran this file. The migration chain's order and count are
  // migrationLedgerOrderGuard's job; this file keeps the Manufacturer assertion only."""),
("""  // No file claims a slot after the last one the base commit carried.
  const newest = files[files.length - 1];
  // Raised 2026-09-26 for the Administration control plane (1762646400000) -- an unrelated lane's
  // migration; the Manufacturer assertion above is what this test is about.
  // Raised again for the workflow control plane (1762732800000), likewise unrelated.
  // Raised again for the Functional Role authority (1762819200000), likewise unrelated.
  // Raised again for the tenant sales channel activation (1762905600000, lane GA), likewise unrelated.
  // Raised again for the direct-exception cell lock (1762992000000, lane DX), likewise unrelated.
  // Raised again for the Administrator staffing capability (1763078400000, Owner ruling R1), likewise unrelated.
  // Raised again for the Catalog + Reorder activation candidate (1763164800000 .. 1763596800000), likewise unrelated.
  // Raised again for accepted main (#2001 multilane 1763683200000 .. 1764129600000; #2002 EOS identity 1764200000000),
  // likewise unrelated. The Catalog + Reorder reconciliation onto main adds no migration.
  assert.ok(Number(newest.split("_")[0]) <= 1764200000000, `an unexpected newest migration ${newest}`);
});""", """});"""),
])
# 3. the two side pools drain like every other pool (#2128)
edit(F + "test/authorityPreviewSafetyPostgres.test.mjs", [("""    for (const p of extraPools) await p.end();""", """    for (const p of extraPools) await endPoolAndDrain(p);""")])
edit(F + "test/authorityPreviewProtectedPostgres.test.mjs", [("""  t.after(async () => { await side?.end(); await endPoolAndDrain(world?.pool); await db.drop(); });""",
"""  t.after(async () => { await endPoolAndDrain(side); await endPoolAndDrain(world?.pool); await db.drop(); });""")])
# 4. CI coverage: the gated Postgres suite and its relevance list
p = F + "package.json"
s = open(p, encoding="utf-8", newline="").read()
line = [l for l in s.splitlines() if '"test:adminPolicyPostgres"' in l][0]
assert "coordinatedVisitObjectRehome" not in line and "manufacturerRuntimeAuthorityPostgres" not in line
edit(p, [(line, line.replace("test/catalogReadAuthorizationPostgres.test.mjs",
  "test/catalogReadAuthorizationPostgres.test.mjs test/coordinatedVisitObjectRehome.test.mjs test/manufacturerAuthorityPostgres.test.mjs test/manufacturerRuntimeAuthorityPostgres.test.mjs"))])
edit("D:/eos-fb-exit/.github/ci/eos-admin-policy-paths.txt", [("functions/test/catalogReadAuthorizationPostgres.test.mjs\n",
  "functions/test/catalogReadAuthorizationPostgres.test.mjs\nfunctions/test/coordinatedVisitObjectRehome.test.mjs\nfunctions/test/manufacturerAuthorityPostgres.test.mjs\nfunctions/test/manufacturerRuntimeAuthorityPostgres.test.mjs\n")])
