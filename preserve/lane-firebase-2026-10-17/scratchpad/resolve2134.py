import re, subprocess
R = "D:/eos-fb-exit/"

def hunks(path):
    raw = open(R + path, encoding="utf-8", newline="").read()
    nl = "\r\n" if "\r\n" in raw else "\n"
    lines = raw.split(nl)
    return lines, nl

def resolve(path, fns):
    lines, nl = hunks(path)
    out, i, k = [], 0, 0
    while i < len(lines):
        l = lines[i]
        if l.startswith("<<<<<<< "):
            ours, theirs, j = [], [], i + 1
            while not lines[j].startswith("======="):
                ours.append(lines[j]); j += 1
            j += 1
            while not lines[j].startswith(">>>>>>> "):
                theirs.append(lines[j]); j += 1
            fn = fns[k] if k < len(fns) else fns[-1]
            out.extend(fn(ours, theirs)); k += 1; i = j + 1
        else:
            out.append(l); i += 1
    assert k == len(fns) or len(fns) == 1, (path, k, len(fns))
    open(R + path, "w", encoding="utf-8", newline="").write(nl.join(out))

union = lambda o, t: t + o
theirs = lambda o, t: t
def lit(*ls): return lambda o, t: list(ls)
def comma_union(o, t):  # JSON list items: theirs gets a trailing comma
    return [t[0] + ","] + o
def sub(fn_lines, pairs):
    def f(o, t):
        src = fn_lines(o, t)
        res = []
        for l in src:
            for a, b in pairs: l = l.replace(a, b)
            res.append(l)
        return res
    return f

# ── keep both, F7a (main) first ──
for p in [".github/ci/eos-admin-policy-paths.txt", ".github/workflows/access-operator-scripts-tests.yml"]:
    resolve(p, [union])
F7B_100_101 = ("// 99 -> 100: 1764590000000", "// 100 -> 101: 1764590000000")
resolve("functions/test/administrationReadEnforcement.test.mjs", [sub(union, [F7B_100_101])])
resolve("functions/test/personaBusinessAccessRegression.test.mjs", [
    sub(union, [F7B_100_101]),
    lambda o, t: [
        t[0].replace("rebuilt.length, 482,", "rebuilt.length, 488,").replace("// 481 -> 482:", "// 482 -> 488: the six CRM activity grants (1764590000000). // 481 -> 482:"),
        t[1].replace("482", "488")],
    lambda o, t: [t[0].replace("capabilities\"), 140); // 139 -> 140", "capabilities\"), 142); // 140 -> 142: crm.activity.read / .create (#243). // 139 -> 140")],
])
resolve("functions/test/migrationLedgerOrderGuard.test.mjs", [
    sub(union, [("// 99 -> 100: 1764590000000", "// 100 -> 101: 1764590000000")]),
    union,
])
resolve("docs/DECISIONS.md", [lambda o, t: t + ([""] if t and t[-1] != "" else []) + o])
resolve("docs/architecture/frontend-dormant-firebase-client-retirement-ledger.md",
        [lambda o, t: t + ([""] if t and t[-1] != "" else []) + [l.replace("exit baseline 245 → 244", "exit baseline 243 → 242") for l in o]])
resolve("functions/test/adminPolicySeedCoverage.test.mjs",
        [sub(union, [("// 49 -> 50, objectsFromCapabilityAuthority 15 -> 16: CRM activity", "// 50 -> 51, objectsFromCapabilityAuthority 16 -> 17: CRM activity")])])
resolve("functions/src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json", [
    lambda o, t: ["  \"totalGrants\": 488,", "  \"countsBySource\": {", "    \"MIGRATION_BACKED\": 430,"],
    comma_union,
    lambda o, t: ["    \"rebuildTotal\": 488,"],
    comma_union,
])
resolve("functions/test/financialPolicyFoundationPostgres.test.mjs", [theirs])
resolve("functions/src/adminPolicy/seed/policySeedSnapshot.json", [theirs])   # regenerated below
resolve("docs/governance/precedence-sweep.json", [theirs])                     # regenerated later

# ── numbers ──
resolve("functions/test/ownerCapabilityContract.test.mjs", [lambda o, t: [
    t[0], o[0].replace("139 -> 141", "140 -> 142"), "  assert.equal(VOCABULARY.size, 142);"]])
resolve("functions/test/sampleCompanyPostgres.test.mjs", [lambda o, t: [
    t[0], o[0].replace("// 99 -> 100: 1764590000000", "// 100 -> 101: 1764590000000"), o[1]]])
def replay(o, t):
    res = []
    for l in t:
        l = re.sub(r"(await count\(\), )(\d+)", lambda m: m.group(1) + str(int(m.group(2)) + 6), l)
        l = re.sub(r"(\)\), )(\d+)(\)|,)", lambda m: m.group(1) + str(int(m.group(2)) + 6) + m.group(3), l)
        l = l.replace("(+1: the returns-intake grant, migration 1764580000000)", "(+1: the returns-intake grant, migration 1764580000000; +6: the CRM-activity parity grants, migration 1764590000000)")
        l = l.replace("assert.equal(migrations, 100); // 99 -> 100: 1764580000000", "assert.equal(migrations, 101); // 100 -> 101: 1764590000000 -- CRM activity on EOS Core (Firebase exit F7b, DECISIONS #243): eos_crm.activities + crm.activity.read / .create, mirrored to admin, owner and crmActivityContributor (2 capabilities, 6 grants). // 99 -> 100: 1764580000000")
        l = l.replace(".rows[0].n, 140); // 139 -> 140:", ".rows[0].n, 142); // 140 -> 142: crm.activity.read / .create (#243, 1764590000000). // 139 -> 140:")
        res.append(l)
    return res
resolve("functions/test/governedNonprodReplayPostgres.test.mjs", [replay])
resolve("functions/test/roleCapabilityAuthorityBaselinePostgres.test.mjs", [lambda o, t: [
    t[0], t[1],
    o[0].replace("481 -> 487 (MIGRATION_BACKED 423 -> 429)", "482 -> 488 (MIGRATION_BACKED 424 -> 430)"), o[1],
    "  assert.equal(AUTHORITY_BASELINE_GRANTS.length, 488);", t[3], t[4].replace("424", "430")]])
resolve("functions/test/authorityActivationVehiclePostgres.test.mjs", [
    lambda o, t: [t[0], t[1].replace("\"],", "\","), o[0], o[1]],
    lambda o, t: [
        "    // CRM activity (1764590000000): -2 capabilities, -6 grants -- peeled first. Returns intake (1764580000000): -1 capability, -1 grant -- next.",
        "    assert.deepEqual(await counts(), { caps: 142, grants: 488, mine: 26 });",
        o[2],
        "    assert.deepEqual(await counts(), { caps: 140, grants: 482, mine: 26 });",
        t[2]],
    lambda o, t: [o[0], t[0].replace("peel the returns intake (1764580000000) first", "then the returns intake (1764580000000)")],
])
resolve("scripts/firebaseExitGuard.test.mjs", [
    lambda o, t: t[:-1] + [o[0], o[1].replace("-- 17 -> 16.", "-- 15 -> 14."), "    \"frontend.firebase_functions_client\": 14,"],
    lambda o, t: [t[0].replace("assert.equal(total, 243); // 244 -> 243:", "assert.equal(total, 242); // 243 -> 242: Firebase exit F7b (2026-10-17), the CRM-activity callable client (EOS /crm/customer now); 244 -> 243:")],
])
resolve("functions/test/credConvergencePostgres.test.mjs", [lambda o, t: [
    t[0].replace("assert.equal(total, 140, // 139 -> 140:", "assert.equal(total, 142, // 140 -> 142: crm.activity.read / .create (#243, 1764590000000). // 139 -> 140:")]])
resolve("functions/test/governedPrincipalProvisioningPostgres.test.mjs", [
    lambda o, t: [t[0].replace("capabilities\"], 140, // + inventory.returns.intake", "capabilities\"], 142, // + crm.activity.read / .create (#243, 1764590000000). // + inventory.returns.intake"),
                  t[1].replace("the measured 140 (inventory.returns.intake", "the measured 142 (crm.activity.read / .create, 1764590000000, + inventory.returns.intake")],
    lambda o, t: [t[0].replace(".rows[0].n, 140); // 139 -> 140", ".rows[0].n, 142); // 140 -> 142 (#243, 2 keys, admin / owner / crmActivityContributor). // 139 -> 140")],
    lambda o, t: [t[0].replace("140", "142")],
])
resolve("functions/test/pendingAuthorityCorrectionsPostgres.test.mjs", [
    lambda o, t: [t[0].replace("482", "488"), t[1].replace("\"1 returns-intake clerk grant (1764580000000) + ", "\"6 CRM activity grants (1764590000000) + 1 returns-intake clerk grant (1764580000000) + "),
                  t[2], t[3].replace("424", "430"), t[4], t[5].replace("477", "483"), t[6].replace("482", "488")],
    lambda o, t: [t[0].replace("482", "488")],
])
resolve("functions/scripts/fixtures/sampleCompany.v2.json", [lambda o, t: [t[0].replace("these 140 ids", "these 142 ids")]])

# capabilityGovernedObjects: main's catalog + F7b's crmActivity object appended after inventoryReturn
resolve("functions/src/adminPolicy/seed/capabilityGovernedObjects.json", [theirs])
# package.json: main's line plus F7b's additions
resolve("functions/package.json", [lambda o, t: [t[0].replace("test/returnIntakePostgres.test.mjs", "test/returnIntakePostgres.test.mjs test/crmActivityPostgres.test.mjs")
                                                 if "crmActivityPostgres" not in t[0] else t[0]]])
# operatorScriptEnvironmentFence: main's file + F7b's CRM section before THE REORDER CUTOVER
p = "functions/test/operatorScriptEnvironmentFence.test.mjs"
subprocess.run(["git", "-C", R, "checkout", "--theirs", "--", p], check=True)
head = subprocess.run(["git", "-C", R, "show", "HEAD:" + p], capture_output=True, check=True).stdout.decode("utf-8")
hnl = "\r\n" if "\r\n" in head else "\n"
hl = head.split(hnl)
s0 = next(i for i, l in enumerate(hl) if "THE CRM-ACTIVITY COPY (Firebase exit F7b)" in l)
s1 = next(i for i in range(s0 + 1, len(hl)) if hl[i].startswith("// ===="))
section = hl[s0:s1]
lines, nl = hunks(p)
at = next(i for i, l in enumerate(lines) if "THE REORDER CUTOVER" in l)
lines[at:at] = section
open(R + p, "w", encoding="utf-8", newline="").write(nl.join(lines))
print("resolved")
