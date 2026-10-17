p = "D:/eos-fb-exit/functions/test/crmActivityPostgres.test.mjs"
s = open(p, encoding="utf-8", newline="").read()
nl = "\r\n" if "\r\n" in s else "\n"
s = s.rstrip("\r\n") + nl + nl + """// ════════════ ADMINISTRATION PROJECTS IT, AND ITS GRANT CONTROL WORKS (Lane D, #2134 guard fix) ════════════
//
// Built the way a live tenant is: migrate, seed (buildPreviewWorld bootstraps the tenant), then re-run this migration onto
// the seeded Roles. Then: the Object is in the catalog Administration reads, both capabilities sit under it, the grants are
// exactly the migration's three Roles, the contributor Role has NO members, and it is assigned only through the governed
// preview -> assignRole path. Empty CRED verbs: nothing is derived onto crmActivity from a Role's catalog permissions.
test("CRM activity: Administration projects it under crmActivity; the contributor Role is assignable and held by no one", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { privateDatabase, buildPreviewWorld, tableHashes } = await import("./support/authorityPreviewFixture.mjs");
  const { actionsForObject } = require("../lib/adminPolicy/objectSecurityAuthority.js");
  const db = await privateDatabase(URL_BASE, "crm_admin");
  let world;
  t.after(async () => { await endPoolAndDrain(world?.pool); await db.drop(); });
  world = await buildPreviewWorld(db.url);
  const { q, repo, call, T, P, roleId } = world;
  const A = T.a;
  const files = (await import("node:fs")).readdirSync(resolve(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  const steps = String(files.length - files.indexOf("1764590000000_crm-activity.sql"));
  const migrate = (dir) => execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", dir, steps, "--migrations-dir", "migrations", "--no-check-order"],
    { maxBuffer: 256 * 1024 * 1024, cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: db.url }, stdio: "pipe" });
  migrate("down");
  migrate("up");

  await t.test("Administration projects crm.activity.read and crm.activity.create under the crmActivity Object", async () => {
    const objects = await repo.listObjects(A);
    const object = objects.find((o) => o.key === "crmActivity");
    assert.ok(object, "the tenant's Administration has the Object");
    const under = actionsForObject(await repo.listCapabilities(), "crmActivity");
    assert.deepEqual(under.map((c) => [c.key, c.actionKind]).sort(), [["crm.activity.create", "CREATE"], ["crm.activity.read", "READ"]]);
    const cells = await q(`SELECT count(*)::int n FROM eos_policy.role_object_permissions WHERE tenant_id = $1 AND object_id = $2`, [A, object.id]);
    assert.equal(cells.rows[0].n, 0, "no CRED cell is derived onto it");
  });

  await t.test("grants are exactly the migration's three Roles; the contributor has no members and is assignable through preview -> assignRole", async () => {
    const holders = await q(`SELECT r.key role, c.key cap FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id
                             JOIN eos_policy.roles r ON r.id = rc.role_id WHERE rc.tenant_id = $1 AND c.object_key = 'crmActivity' ORDER BY 1, 2`, [A]);
    assert.deepEqual(holders.rows.map((r) => `${r.role}:${r.cap}`), [
      "admin:crm.activity.create", "admin:crm.activity.read", "crmActivityContributor:crm.activity.create",
      "crmActivityContributor:crm.activity.read", "owner:crm.activity.create", "owner:crm.activity.read"]);
    const contributor = await roleId(A, "crmActivityContributor");
    const members = async () => (await q(`SELECT count(*)::int n FROM eos_policy.user_role_assignments WHERE tenant_id = $1 AND role_id = $2 AND status = 'active'`,
      [A, contributor])).rows[0].n;
    assert.equal(await members(), 0, "held by no one automatically");
    const input = { principalId: P.a.plain, roleId: contributor, reason: "crm activity proof" };
    const hashes = await tableHashes(q);
    const previewed = await call("gip-admin-a", "previewAuthorityChange", { change: { operation: "assignRole", input } });
    assert.equal(previewed.ok, true, JSON.stringify(previewed));
    assert.equal(previewed.data.outcome, "WOULD_APPLY", JSON.stringify(previewed.data.refusal));
    assert.deepEqual(await tableHashes(q), hashes, "the preview left no trace");
    const assigned = await call("gip-admin-a", "assignRole", input);
    assert.equal(assigned.ok, true, JSON.stringify(assigned));
    assert.equal(await members(), 1, "the governed assignRole is what grants it, and only to the principal named");
  });
});
""".replace("\n", nl)
open(p, "w", encoding="utf-8", newline="").write(s)
