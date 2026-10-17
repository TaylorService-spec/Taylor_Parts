import json
from ed import edit
R = "D:/eos-fb-exit/"
# test registration + CI relevance + operator-scripts paths
p = R + "functions/package.json"
s = open(p, encoding="utf-8", newline="").read()
line = [l for l in s.splitlines() if '"test:adminPolicyPostgres"' in l][0]
edit(p, [(line, line.replace("test/catalogReadAuthorizationPostgres.test.mjs", "test/catalogReadAuthorizationPostgres.test.mjs test/crmActivityPostgres.test.mjs"))])
edit(R + ".github/ci/eos-admin-policy-paths.txt", [
("functions/scripts/catalogCutover.js\n", "functions/scripts/catalogCutover.js\nfunctions/scripts/crmActivityCopy.js\nfunctions/scripts/exportCrmActivitySnapshot.js\n"),
("functions/test/catalogReadAuthorizationPostgres.test.mjs\n", "functions/test/catalogReadAuthorizationPostgres.test.mjs\nfunctions/test/crmActivityPostgres.test.mjs\n")])
edit(R + ".github/workflows/access-operator-scripts-tests.yml", [('      - "functions/scripts/catalogCutover.js"\n',
  '      - "functions/scripts/catalogCutover.js"\n      - "functions/scripts/crmActivityCopy.js"\n      - "functions/scripts/exportCrmActivitySnapshot.js"\n')], count=2)

# fence tests
edit(R + "functions/test/operatorScriptEnvironmentFence.test.mjs", [
("""// ============================ THE REORDER CUTOVER ============================""",
"""// ============================ THE CRM-ACTIVITY COPY (Firebase exit F7b) ============================
//
// scripts/crmActivityCopy.js inserts eos_crm.activities rows (copy). It must refuse before `pg` is resolved, has no production
// mode, and never copies without the Owner's go-ahead. Census is the default.
const CA_COPY = "scripts/crmActivityCopy.js";
const CA_ARGS = ["--environment", "platform-sandbox", "--databaseUrlEnv", "CA_FENCE_DB", "--tenantKey", "taylor-nonprod", "--snapshot", "/nonexistent/snapshot.json"];
const CA_ENV = { EOS_ENVIRONMENT: "nonprod", CA_FENCE_DB: "postgres://fence:fence@127.0.0.1:1/never" };
for (const [label, args, env, pattern] of [
  ["an unknown mode", ["--mode", "apply", ...CA_ARGS], CA_ENV, /--mode must be one of census \\| copy \\| verify/],
  ["no environment", ["--tenantKey", "t", "--snapshot", "x.json"], CA_ENV, /--environment is required/],
  ["production environment", CA_ARGS.map((a) => (a === "platform-sandbox" ? "taylor-parts-production" : a)), CA_ENV, /production/],
  ["EOS_ENVIRONMENT not nonprod", CA_ARGS, { ...CA_ENV, EOS_ENVIRONMENT: "production" }, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
  ["frozen Certification world", CA_ARGS.map((a) => (a === "platform-sandbox" ? "platform-certification" : a)), CA_ENV, /Certification world, which is frozen/],
  ["no snapshot", ["--environment", "platform-sandbox", "--databaseUrlEnv", "CA_FENCE_DB", "--tenantKey", "t"], CA_ENV, /--snapshot <file> is required/],
  ["copy without the Owner's go-ahead", ["--mode", "copy", ...CA_ARGS, "--principalId", "p", "--reviewedChecksum", "c"], CA_ENV, /--ownerAuthorization is required for copy/],
  ["copy without an EOS principal", ["--mode", "copy", ...CA_ARGS, "--reviewedChecksum", "c", "--ownerAuthorization", "o"], CA_ENV, /--principalId <EOS principal id> is required/],
]) {
  test(`CRM-activity copy: refuses (${label}) before any client library loads`, () => {
    const res = runCli(CA_COPY, args, env);
    const out = assertRefusedBeforeAnySdk(res, `CRM-activity copy, ${label}`);
    assert.match(out, pattern);
  });
}

// ============================ THE REORDER CUTOVER ============================"""),
])

# exit baseline + pins
p = R + "docs/architecture/firebase-exit-baseline.json"
s = open(p, encoding="utf-8", newline="").read()
s = s.replace('        "field-ops-app-vite/src/services/crmActivityCallableClient.js",\n', "")
json.loads(s); open(p, "w", encoding="utf-8", newline="").write(s)
edit(R + "scripts/firebaseExitGuard.test.mjs", [
("  assert.equal(total, 245); // 247 -> 245: Firebase exit F3", "  assert.equal(total, 244); // 245 -> 244: Firebase exit F7b (2026-10-17), the CRM-activity callable client (EOS /crm/customer now); 247 -> 245: Firebase exit F3"),
("""    // mounted list or RELATED section resolves is an EOS Commercial list -- 18 -> 17.
    "frontend.firebase_functions_client": 17,""", """    // mounted list or RELATED section resolves is an EOS Commercial list -- 18 -> 17.
    // Firebase exit F7b (2026-10-17): services/crmActivityCallableClient.js is deleted; CRM activity is the EOS CRM route
    // (services/crmActivityClient.js) -- 17 -> 16.
    "frontend.firebase_functions_client": 16,"""),
])

C = "1764590000000 -- CRM activity on EOS Core (Firebase exit F7b, DECISIONS #243): eos_crm.activities + crm.activity.read / .create, mirrored to admin, owner and crmActivityContributor (2 capabilities, 6 grants)."
F = R + "functions/"
edit(F + "test/administrationReadEnforcement.test.mjs", [("""  assert.equal(migrations.length, 99, "a migration was added or removed by the read enforcement");""",
f"""  // 99 -> 100: {C}
  assert.equal(migrations.length, 100, "a migration was added or removed by the read enforcement");""")])
edit(F + "test/governedNonprodReplayPostgres.test.mjs", [("""  assert.equal(migrations, 99); // 98 -> 99:""", f"""  assert.equal(migrations, 100); // 99 -> 100: {C} // 98 -> 99:""")])
edit(F + "test/personaBusinessAccessRegression.test.mjs", [("""  assert.equal(files.length, 99, "the migration chain moved; re-measure before trusting anything below");""",
f"""  // 99 -> 100: {C}
  assert.equal(files.length, 100, "the migration chain moved; re-measure before trusting anything below");""")])
edit(F + "test/sampleCompanyPostgres.test.mjs", [("""const PINNED_LAST_MIGRATION = "1764570000000_financial-policy-withdraw-cancel";
const PINNED_MIGRATION_COUNT = 99;""", f"""// 99 -> 100: {C} No Sample Company data.
const PINNED_LAST_MIGRATION = "1764590000000_crm-activity";
const PINNED_MIGRATION_COUNT = 100;""")])
edit(F + "test/migrationLedgerOrderGuard.test.mjs", [("""const RUNNABLE_MIGRATION_COUNT = 99;
const TRACKED_MIGRATION_COUNT = 100; // the 99 runnable + the one deferred file""", f"""// 99 -> 100: {C} APPENDED, an EXPLAINED pending migration.
const RUNNABLE_MIGRATION_COUNT = 100;
const TRACKED_MIGRATION_COUNT = 101; // the 100 runnable + the one deferred file"""),
("""  "1764570000000_financial-policy-withdraw-cancel",
]);""", """  "1764570000000_financial-policy-withdraw-cancel",
  "1764590000000_crm-activity",
]);""")])
edit(F + "test/authorityActivationVehiclePostgres.test.mjs", [
("""    "1764570000000_financial-policy-withdraw-cancel.sql"],""", """    "1764570000000_financial-policy-withdraw-cancel.sql",
    // CRM activity (F7b, #243): eos_crm.activities + crm.activity.read / .create; 2 capabilities, 6 grants (admin, owner, crmActivityContributor).
    "1764590000000_crm-activity.sql"],"""),
("""    assert.deepEqual(await counts(), { caps: 139, grants: 481, mine: 26 });
    runMigrate(url, "down", 1); // Financial Policy withdraw / cancel (1764570000000): schema only, nothing moves; its down refuses only while a WITHDRAWN / CANCELLED version exists""",
"""    // CRM activity (1764590000000): -2 capabilities, -6 grants -- peeled first.
    assert.deepEqual(await counts(), { caps: 141, grants: 487, mine: 26 });
    runMigrate(url, "down", 1); // CRM activity (-2 capabilities, -6 grants; its down refuses while an activity or a decision exists)
    assert.deepEqual(await counts(), { caps: 139, grants: 481, mine: 26 });
    runMigrate(url, "down", 1); // Financial Policy withdraw / cancel (1764570000000): schema only, nothing moves; its down refuses only while a WITHDRAWN / CANCELLED version exists"""),
("""    runMigrate(url, "down", 1); // peel the Financial Policy withdraw / cancel (1764570000000) first -- schema only""",
"""    runMigrate(url, "down", 1); // peel the CRM activity (1764590000000) first -- 2 capabilities, 6 grants
    runMigrate(url, "down", 1); // then the Financial Policy withdraw / cancel (1764570000000) -- schema only"""),
])

# authority baseline +6
p = F + "src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json"
raw = open(p, encoding="utf-8", newline="").read(); nl = "\r\n" if "\r\n" in raw else "\n"
b = json.loads(raw); g = b["grants"]
key = lambda x: (x["roleKey"].lower(), x["capabilityKey"].lower())
for role in ["admin", "owner", "crmActivityContributor"]:
    for cap in ["crm.activity.create", "crm.activity.read"]:
        new = {"roleKey": role, "capabilityKey": cap, "source": "MIGRATION_BACKED", "evidence": "migration:1764590000000", "observedGrantedBy": "migration:1764590000000"}
        assert not any(x["roleKey"] == role and x["capabilityKey"] == cap for x in g), (role, cap)
        i = next((i for i, x in enumerate(g) if key(x) > key(new)), len(g)); g.insert(i, new)
b["totalGrants"] += 6; b["countsBySource"]["MIGRATION_BACKED"] += 6
b["grantBearingMigrations"].append("migration:1764590000000")
b["deployment"]["rebuildTotal"] += 6
b["deployment"]["notYetAppliedToNonprod"].append("migration:1764590000000")
b["catalogDeclaredNotActivated"] = [x for x in b["catalogDeclaredNotActivated"] if not x["capabilityKey"].startswith("crm.activity.")]
open(p, "w", encoding="utf-8", newline="").write((json.dumps(b, indent=2, ensure_ascii=False) + "\n").replace("\n", nl))
edit(F + "test/roleCapabilityAuthorityBaselinePostgres.test.mjs", [("""  assert.equal(AUTHORITY_BASELINE_GRANTS.length, 481);
  assert.deepEqual(counts, {
    MIGRATION_BACKED: 423, CANONICAL_CATALOG: 53, NONPROD_ACTIVATION: 5, FIXTURE_ONLY: 0, UNEXPLAINED: 0,
  });""", """  // 481 -> 487 (MIGRATION_BACKED 423 -> 429): migration 1764590000000, CRM activity (F7b, #243) -- crm.activity.read / .create mirrored
  // to the current Firebase holders admin, owner and crmActivityContributor; no new holder.
  assert.equal(AUTHORITY_BASELINE_GRANTS.length, 487);
  assert.deepEqual(counts, {
    MIGRATION_BACKED: 429, CANONICAL_CATALOG: 53, NONPROD_ACTIVATION: 5, FIXTURE_ONLY: 0, UNEXPLAINED: 0,
  });""")])

# vocabulary
p = F + "scripts/fixtures/sampleCompany.v2.json"
edit(p, [('      "audit.event.read",\n      "customer.governedField.write",\n', '      "audit.event.read",\n      "crm.activity.create",\n      "crm.activity.read",\n      "customer.governedField.write",\n'),
("currently holds these 139 ids and no others (the Financial Policy foundation", "currently holds these 141 ids and no others (CRM activity, 2026-10-17, DECISIONS #243, adds crm.activity.read / .create on the crmActivity Object, migration 1764590000000, mirrored to the current Firebase holders admin, owner and crmActivityContributor and asserted for no persona; the Financial Policy foundation")])
edit(F + "test/ownerCapabilityContract.test.mjs", [("""  assert.equal(VOCABULARY.size, 139);""", """  // 139 -> 141: crm.activity.read / .create (CRM activity on EOS Core, #243, 1764590000000), mirrored to admin, owner, crmActivityContributor.
  assert.equal(VOCABULARY.size, 141);""")])
