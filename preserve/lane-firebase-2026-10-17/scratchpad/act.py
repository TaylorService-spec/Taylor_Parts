from ed import edit
p = "D:/eos-fb-exit/functions/test/adminPolicyActivation.test.mjs"
edit(p, [
("""import pg from "pg";
""", """import pg from "pg";
import { readFileSync } from "node:fs";
"""),
("""import { ADMINISTRATION_READ_CAPABILITY_KEYS } from "../lib/adminPolicy/administrationSurfaceAuthority.js";
""", """import { ADMINISTRATION_READ_CAPABILITY_KEYS } from "../lib/adminPolicy/administrationSurfaceAuthority.js";

// The governed Object registry's size, from the registry itself. These assertions are about the bootstrap (creates every
// Object once, a rerun creates none, a restart keeps them) -- not about how many Objects exist. That count is pinned BY NAME,
// one line per registration, in adminPolicySeedCoverage.test.mjs; a bare literal here was hand-raised for every one of them.
const SEED_OBJECTS = JSON.parse(readFileSync(new URL("../src/adminPolicy/seed/policySeedSnapshot.json", import.meta.url), "utf8")).objects.length;
"""),
("""  assert.equal(first.seed.created.objects, 49, "49 canonical objects");""",
 """  assert.equal(first.seed.created.objects, SEED_OBJECTS, "every governed Object, once");"""),
("""  assert.equal(objects.length, 49, "still 49 after the rerun, not 98");""",
 """  assert.equal(objects.length, SEED_OBJECTS, "the same count after the rerun, not double");"""),
("""    assert.equal(objects.length, 49);""", """    assert.equal(objects.length, SEED_OBJECTS);"""),
])
