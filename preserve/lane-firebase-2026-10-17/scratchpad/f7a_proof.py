from ed import edit
F = "D:/eos-fb-exit/functions/"
p = F + "test/returnIntakePostgres.test.mjs"
s = open(p, encoding="utf-8", newline="").read()
nl = "\r\n" if "\r\n" in s else "\n"
s = s.rstrip("\r\n") + nl + nl + """// ════════════ ADMINISTRATION PROJECTS IT, AND ITS GRANT CONTROL WORKS (Owner, #2133 guard fix) ════════════
//
// The seed runs AFTER migrations in every real environment, so this world is built the way a live tenant is: migrate, seed
// (buildPreviewWorld bootstraps the tenant), then re-run this migration onto the seeded Roles -- exactly the rebuild order the
// authority baseline uses. Then: the Object is in the catalog Administration reads, the capability sits under it, the clerk
// Role holds it and has NO members, and assigning it goes through the governed preview -> assignRole path.
test("returns intake: Administration projects it under inventoryReturn; the clerk Role is assignable and held by no one", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { privateDatabase, buildPreviewWorld, tableHashes } = await import("./support/authorityPreviewFixture.mjs");
  const { actionsForObject } = require("../lib/adminPolicy/objectSecurityAuthority.js");
  const db = await privateDatabase(URL_BASE, "ret_admin");
  let world;
  t.after(async () => { await endPoolAndDrain(world?.pool); await db.drop(); });
  world = await buildPreviewWorld(db.url);
  const { q, repo, call, T, P, roleId } = world;
  const A = T.a;
  const files = (await import("node:fs")).readdirSync(resolve(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  const steps = String(files.length - files.indexOf("1764580000000_inventory-returns-intake.sql"));
  const migrate = (dir) => execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", dir, steps, "--migrations-dir", "migrations", "--no-check-order"],
    { maxBuffer: 256 * 1024 * 1024, cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: db.url }, stdio: "pipe" });
  migrate("down");
  migrate("up");

  await t.test("(2) Administration projects inventory.returns.intake under the inventoryReturn Object", async () => {
    const objects = await repo.listObjects(A);
    assert.ok(objects.some((o) => o.key === "inventoryReturn"), "the tenant's Administration has the Object");
    const under = actionsForObject(await repo.listCapabilities(), "inventoryReturn");
    assert.deepEqual(under.map((c) => [c.key, c.actionKey, c.actionKind]), [["inventory.returns.intake", "intake", "BUSINESS_ACTION"]]);
  });

  await t.test("(3) the clerk Role holds it, has no members, and is assignable through preview -> assignRole", async () => {
    const clerk = await roleId(A, "inventoryReturnsIntakeClerk");
    const held = await q(`SELECT c.key FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id
                           WHERE rc.tenant_id = $1 AND rc.role_id = $2`, [A, clerk]);
    assert.deepEqual(held.rows.map((r) => r.key), ["inventory.returns.intake"], "the clerk Role carries exactly the intake capability");
    const members = async () => (await q(`SELECT count(*)::int n FROM eos_policy.user_role_assignments WHERE tenant_id = $1 AND role_id = $2 AND status = 'active'`,
      [A, clerk])).rows[0].n;
    assert.equal(await members(), 0, "held by no one automatically");
    const input = { principalId: P.a.plain, roleId: clerk, reason: "returns intake proof" };
    const hashes = await tableHashes(q);
    const previewed = await call("gip-admin-a", "previewAuthorityChange", { change: { operation: "assignRole", input } });
    assert.equal(previewed.ok, true, JSON.stringify(previewed));
    assert.equal(previewed.data.outcome, "WOULD_APPLY", JSON.stringify(previewed.data.refusal));
    assert.deepEqual(await tableHashes(q), hashes, "the preview left no trace");
    assert.equal(await members(), 0);
    const assigned = await call("gip-admin-a", "assignRole", input);
    assert.equal(assigned.ok, true, JSON.stringify(assigned));
    assert.equal(await members(), 1, "the governed assignRole is what grants it, and only to the principal named");
    const audited = await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id = $1 AND target_id = $2`, [A, P.a.plain]);
    assert.ok(audited.rows[0].n > 0, "the assignment is audited");
  });
});
""".replace("\n", nl)
open(p, "w", encoding="utf-8", newline="").write(s)
