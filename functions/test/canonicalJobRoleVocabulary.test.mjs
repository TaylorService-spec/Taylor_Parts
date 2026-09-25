// THE ONE CANONICAL JOB ROLE VOCABULARY -- the guard for Owner ruling 2026-09-25.
//
// Firebase-free and database-free: Job Role vocabulary carries no PostgreSQL authority, so there is nothing here that
// needs a database and nothing here that touches the capability catalog. It pins four things a reviewer would otherwise
// have to check by reading three files and a fixture:
//
//   1  MEMBERSHIP. Exactly sixteen keys, the ruling's own sixteen, unique, with a sorted deterministic id list.
//   2  ONE SOURCE OF TRUTH. Both former Job Role catalogs PROJECT from src/eosWorkforce/jobRoleVocabulary.ts, and
//      NEITHER FILE STILL CONTAINS A LIST OF ITS OWN. The second half is what makes the first half durable: a
//      projection plus a leftover literal list is how the drift this ruling ended got started.
//   3  THE SECURITY BOUNDARY. No canonical key is a Security Role key, and the four terms the ruling refuses by name
//      are absent in every casing.
//   4  THE PERSONA MAPPING. P01-P16 is total, single-valued, and lands inside the vocabulary.
//
// WHY THE LITERAL SIXTEEN ARE WRITTEN OUT BELOW. A guard that derived its expectation from the module under test would
// pass whatever that module said. The list in RULED_JOB_ROLE_IDS is a transcription of the Owner's ruling, in the
// ruling's own order, and it is the ONE place in this repository other than the canonical module where the membership
// appears -- deliberately, because that is what a pin is.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const vocabulary = require("../lib/eosWorkforce/jobRoleVocabulary.js");
const launchSeed = require("../lib/eosWorkforce/migration/jobRoleCatalogSeed.js");
const sampleCompanySeed = require("../scripts/seedSampleCompany.js");
const personaDimensions = require("../scripts/sampleCompany/personaAuthorityDimensions.js");
const SAMPLE_COMPANY = require("../scripts/fixtures/sampleCompany.v2.json");
const PERSONA_MANIFEST = require("../scripts/fixtures/personaAuthorityDimensions.v1.json");
const SYNTHETIC_V1 = require("../scripts/fixtures/syntheticNonprodWorkforceSeed.v1.json");
const { COMPATIBILITY_ROLES } = require("../lib/access/compatibilityRoles.js");
const { GOVERNED_BUSINESS_ROLES } = require("../lib/access/governedBusinessRoles.js");

const source = (rel) => readFileSync(join(FUNCTIONS_DIR, rel), "utf8");

/** The Owner's ruling, transcribed in its own order. Not derived from anything. */
const RULED_JOB_ROLE_IDS = [
  "owner-executive",
  "general-manager",
  "office-manager",
  "office-administration",
  "service-manager",
  "service-coordinator-dispatcher",
  "service-technician",
  "parts-associate",
  "parts-manager",
  "warehouse-associate",
  "warehouse-manager",
  "retail-sales",
  "national-accounts-sales",
  "finance-accounting",
  "reporting-analyst",
  "general-employee",
];

/** The ruling's P01-P16 table, transcribed. One Job Role per persona, no persona omitted. */
const RULED_PERSONA_JOB_ROLES = {
  P01: "owner-executive",
  P02: "office-administration",
  P03: "general-manager",
  P04: "service-manager",
  P05: "service-coordinator-dispatcher",
  P06: "service-technician",
  P07: "service-technician",
  P08: "parts-associate",
  P09: "parts-manager",
  P10: "warehouse-associate",
  P11: "warehouse-manager",
  P12: "retail-sales",
  P13: "national-accounts-sales",
  P14: "finance-accounting",
  P15: "reporting-analyst",
  P16: "general-employee",
};

/** Every live Security Role key: the governed business Roles plus the three compatibility Roles. */
const SECURITY_ROLE_KEYS = [...Object.keys(GOVERNED_BUSINESS_ROLES), ...Object.keys(COMPATIBILITY_ROLES)];

/** `warehouseManager` -> `warehouse-manager`. Used only to compare STEMS, never to rename anything. */
const kebab = (camel) => camel.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

// ════════════════════════════ 1. MEMBERSHIP ════════════════════════════

test("the canonical vocabulary is exactly the sixteen ruled Job Roles, in the ruling's order", () => {
  assert.equal(vocabulary.CANONICAL_JOB_ROLES.length, 16);
  assert.deepEqual(vocabulary.CANONICAL_JOB_ROLES.map((r) => r.jobRoleId), RULED_JOB_ROLE_IDS);
});

test("the ids are unique, well-shaped, and exposed in one stable sorted order", () => {
  const ids = vocabulary.CANONICAL_JOB_ROLE_IDS;
  assert.equal(ids.length, 16);
  assert.equal(new Set(ids).size, 16, "two positions may never collapse onto one governed id");
  assert.deepEqual([...ids], [...ids].sort(), "CANONICAL_JOB_ROLE_IDS is the SORTED form; a reader relies on that");
  assert.deepEqual([...ids], [...RULED_JOB_ROLE_IDS].sort());
  for (const id of ids) {
    // The shape the governed writer (commands/employeeJobRoleCommands.ts) accepts, asserted from the module's own
    // exported regex so the writer and the vocabulary cannot disagree about it.
    assert.match(id, vocabulary.JOB_ROLE_ID_SHAPE, id);
  }
});

test("every entry carries a display name and a manifest key, and both are as unique as the id", () => {
  const names = vocabulary.CANONICAL_JOB_ROLES.map((r) => r.displayName);
  const keys = vocabulary.CANONICAL_JOB_ROLE_MANIFEST_KEYS;
  assert.equal(new Set(names).size, 16, "two positions may never share a display name");
  assert.equal(new Set(keys).size, 16);
  assert.deepEqual([...keys], [...keys].sort());
  for (const r of vocabulary.CANONICAL_JOB_ROLES) {
    assert.ok(r.displayName.trim() === r.displayName && r.displayName !== "");
    assert.match(r.manifestKey, /^[A-Z][A-Z_]*[A-Z]$/, r.jobRoleId);
    // The manifest key is the SAME position under a different spelling, not a second vocabulary.
    assert.equal(r.manifestKey, r.jobRoleId.replace(/-/g, "_").toUpperCase());
    assert.equal(vocabulary.CANONICAL_JOB_ROLE_BY_MANIFEST_KEY[r.manifestKey], r);
    assert.equal(vocabulary.CANONICAL_JOB_ROLE_BY_ID[r.jobRoleId], r);
    assert.ok(vocabulary.isCanonicalJobRoleId(r.jobRoleId));
  }
  assert.ok(!vocabulary.isCanonicalJobRoleId("owner"), "a retired id is not canonical");
  assert.ok(!vocabulary.isCanonicalJobRoleId("toString"), "inherited property names are not Job Roles");
});

test("there is no generic SALES position, and Retail Sales is not National Accounts Sales", () => {
  for (const r of vocabulary.CANONICAL_JOB_ROLES) {
    assert.notEqual(r.jobRoleId, "sales");
    assert.notEqual(r.displayName.trim().toUpperCase(), "SALES");
  }
  // The distinction the catalog is the ONLY place to record: both positions hold the identical `salesperson`
  // Security Role by design, so if these two ever collapse, nothing separates retail from national accounts.
  assert.notEqual("retail-sales", "national-accounts-sales");
  assert.ok(vocabulary.isCanonicalJobRoleId("retail-sales"));
  assert.ok(vocabulary.isCanonicalJobRoleId("national-accounts-sales"));
  assert.notEqual(
    vocabulary.CANONICAL_JOB_ROLE_BY_ID["retail-sales"].manifestKey,
    vocabulary.CANONICAL_JOB_ROLE_BY_ID["national-accounts-sales"].manifestKey,
  );
  assert.equal(GOVERNED_BUSINESS_ROLES.salesperson === undefined, false, "the shared Security Role must be real");
});

// ════════════════════════════ 2. ONE SOURCE OF TRUTH ════════════════════════════

test("FORMER CATALOG 1: LAUNCH_JOB_ROLES is the canonical vocabulary, projected", () => {
  assert.deepEqual(
    launchSeed.LAUNCH_JOB_ROLES.map((r) => [r.jobRoleId, r.displayName]),
    vocabulary.CANONICAL_JOB_ROLES.map((r) => [r.jobRoleId, r.displayName]),
  );
  assert.deepEqual(
    [...launchSeed.LAUNCH_JOB_ROLES.map((r) => r.jobRoleId)].sort(),
    [...vocabulary.CANONICAL_JOB_ROLE_IDS],
  );
});

test("FORMER CATALOG 1 no longer holds a list of its own", () => {
  const text = source("src/eosWorkforce/migration/jobRoleCatalogSeed.ts");
  assert.match(text, /from "\.\.\/jobRoleVocabulary"/, "it must import the one vocabulary");
  // A projection plus a leftover literal is the drift this ruling ended. Executable code only: the commentary
  // legitimately NAMES the three ids this file retired, and naming them is the record of the ruling.
  const executable = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const declared = [...executable.matchAll(/jobRoleId:\s*"([a-z][a-z0-9-]*)"/g)].map((m) => m[1]);
  assert.deepEqual(declared, [], "no Job Role id may be written out in this file; it projects");
  for (const id of RULED_JOB_ROLE_IDS) {
    assert.ok(!executable.includes(`"${id}"`), `${id} is written out as a literal in the former launch catalog`);
  }
});

test("FORMER CATALOG 2: the persona harness plans the canonical catalog, and the fixture declares none", () => {
  const plan = personaDimensions.planPersonaAuthorityDimensions();
  const catalog = plan.filter((s) => s.command === "createJobRole");
  assert.deepEqual(
    catalog.map((s) => [s.input.jobRoleId, s.input.displayName]),
    vocabulary.CANONICAL_JOB_ROLES.map((r) => [r.jobRoleId, r.displayName]),
  );
  // THE PROOF THE TWO CANNOT DIVERGE: the universes are the same SET, not merely the same size.
  assert.deepEqual(
    new Set(catalog.map((s) => s.input.jobRoleId)),
    new Set(launchSeed.LAUNCH_JOB_ROLES.map((r) => r.jobRoleId)),
  );
  assert.equal(SAMPLE_COMPANY.jobRoles, undefined, "sampleCompany.v2.json may not declare a Job Role catalog");
  assert.equal(PERSONA_MANIFEST.jobRoles, undefined);
  // Every catalog step is a TENANT fact and names no Employee; every assignment names one.
  for (const step of catalog) assert.equal("employeeId" in step.input, false);
  assert.equal(new Set(catalog.map((s) => s.input.jobRoleId)).size, catalog.length);
});

test("FORMER CATALOG 2 no longer holds a list of its own, in source or in fixture", () => {
  const harness = source("scripts/sampleCompany/personaAuthorityDimensions.js");
  assert.match(harness, /require\("\.\.\/\.\.\/lib\/eosWorkforce\/jobRoleVocabulary\.js"\)/);
  const executable = harness.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const id of RULED_JOB_ROLE_IDS) {
    assert.ok(!executable.includes(`"${id}"`), `${id} is written out as a literal in the persona harness`);
  }
  // The fixture's old rows carried a `pgJobRoleId` per entry; not one may remain as DATA. The `$`-prefixed
  // commentary keys legitimately explain what was removed and why, so they are stripped before the check --
  // the fixture's own convention is that a `$` key is prose and nothing reads it.
  const withoutCommentary = JSON.stringify(SAMPLE_COMPANY, (key, value) => (key.startsWith("$") ? undefined : value));
  assert.ok(!withoutCommentary.includes("pgJobRoleId"),
    "the fixture still carries a governed catalog id, which means it still declares a catalog");
  assert.ok(!withoutCommentary.includes("jobRoles"), "the fixture still carries a jobRoles member");
});

test("re-declaring a catalog is REFUSED, by both seeds, rather than silently ignored", () => {
  // An array nobody reads, sitting where a catalog used to be, is how the next drift starts. Both validators
  // refuse it outright, which is why this is a refusal test and not a "the field is unused" observation.
  const withCatalog = JSON.parse(JSON.stringify(SAMPLE_COMPANY));
  withCatalog.jobRoles = [{ key: "OWNER_EXECUTIVE", label: "Owner / Executive", pgJobRoleId: "owner-executive" }];
  assert.throws(() => sampleCompanySeed.validateManifest(withCatalog), /may not declare jobRoles/);
  assert.throws(
    () => personaDimensions.validateManifest(PERSONA_MANIFEST, withCatalog),
    /JOB_ROLE_CATALOG_NOT_FIXTURE_DECLARED/,
  );
});

test("the seedSampleCompany vocabulary is the canonical one, and its projection matches entry for entry", () => {
  assert.deepEqual([...sampleCompanySeed.JOB_ROLE_VOCABULARY], [...vocabulary.CANONICAL_JOB_ROLE_MANIFEST_KEYS]);
  assert.deepEqual(
    sampleCompanySeed.MANIFEST_JOB_ROLES.map((r) => [r.key, r.label, r.pgJobRoleId]),
    vocabulary.CANONICAL_JOB_ROLES.map((r) => [r.manifestKey, r.displayName, r.jobRoleId]),
  );
});

test("every fixture that names a Job Role names a canonical one", () => {
  const canonical = new Set(vocabulary.CANONICAL_JOB_ROLE_MANIFEST_KEYS);
  for (const e of SAMPLE_COMPANY.employees) {
    assert.ok(canonical.has(e.jobRole), `sampleCompany.v2 employee ${e.key} names ${e.jobRole}`);
  }
  for (const [key, persona] of Object.entries(PERSONA_MANIFEST.personas)) {
    assert.ok(canonical.has(persona.jobRole), `persona ${key} names ${persona.jobRole}`);
  }
  // THE THIRD LIST. syntheticNonprodWorkforceSeed.v1.json is superseded and writes nothing to eos_workforce, so it is
  // not a catalog -- but it still declares Job Role keys, and without this pin it could grow a position the canonical
  // vocabulary has never heard of. It is a SUBSET, not an equal: v1 predates five of the sixteen.
  for (const r of SYNTHETIC_V1.jobRoles) {
    assert.ok(canonical.has(r.key), `the superseded v1 manifest declares non-canonical Job Role ${r.key}`);
  }
  for (const e of SYNTHETIC_V1.employees) assert.ok(canonical.has(e.jobRole), `v1 employee ${e.key}`);
});

test("the retired ids are recorded, point at canonical replacements, and are not canonical themselves", () => {
  const retired = Object.entries(vocabulary.SUPERSEDED_JOB_ROLE_IDS);
  // Both former catalogs are accounted for: three ids retired from each.
  assert.deepEqual(retired.map(([id]) => id).sort(),
    ["accounting", "administrator", "dispatcher", "finance-manager", "owner", "parts-warehouse"]);
  for (const [id, entry] of retired) {
    assert.ok(!vocabulary.isCanonicalJobRoleId(id), `${id} is retired and must not also be canonical`);
    assert.ok(entry.formerCatalogs.length >= 1 && entry.why.length > 24, id);
    assert.ok(entry.replacedBy.length >= 1, id);
    for (const to of entry.replacedBy) assert.ok(vocabulary.isCanonicalJobRoleId(to), `${id} -> ${to}`);
  }
  // parts-warehouse was a SPLIT, not a rename: one entry that could not say which of four positions was held.
  assert.equal(vocabulary.SUPERSEDED_JOB_ROLE_IDS["parts-warehouse"].replacedBy.length, 4);
  for (const [from, to] of Object.entries(vocabulary.SUPERSEDED_JOB_ROLE_MANIFEST_KEYS)) {
    assert.ok(!vocabulary.CANONICAL_JOB_ROLE_MANIFEST_KEYS.includes(from), `${from} is retired`);
    assert.ok(vocabulary.CANONICAL_JOB_ROLE_MANIFEST_KEYS.includes(to), `${from} -> ${to}`);
  }
});

// ════════════════════════════ 3. THE SECURITY BOUNDARY ════════════════════════════

test("NO Job Role key is a Security Role key", () => {
  assert.ok(SECURITY_ROLE_KEYS.length >= 40, "the live Security Role vocabulary must actually be loaded");
  const securityKeys = new Set(SECURITY_ROLE_KEYS);
  for (const id of vocabulary.CANONICAL_JOB_ROLE_IDS) {
    assert.ok(!securityKeys.has(id), `${id} is a Security Role key; a business position may never be one`);
  }
  for (const key of vocabulary.CANONICAL_JOB_ROLE_MANIFEST_KEYS) {
    assert.ok(!securityKeys.has(key));
  }
  // THE ONE THE RULING CALLS OUT. `owner` is live in GOVERNED_BUSINESS_ROLES, which is exactly why the Owner's
  // POSITION is owner-executive. If this ever stops being true the ruling has lost its stated reason.
  assert.ok(securityKeys.has("owner"), "`owner` must still be a Security Role key");
  assert.ok(!vocabulary.isCanonicalJobRoleId("owner"));
  assert.ok(vocabulary.isCanonicalJobRoleId("owner-executive"));
});

test("the four terms the ruling refuses by name are not Job Roles, in any casing or hyphenation", () => {
  assert.deepEqual([...vocabulary.SECURITY_ROLE_NAMES_REFUSED_AS_JOB_ROLES].sort(),
    ["administrator", "purchasingManager", "reportViewer", "technician"]);
  const ruledOut = new Set(vocabulary.SECURITY_ROLE_NAMES_REFUSED_AS_JOB_ROLES.flatMap((name) => [
    name, name.toLowerCase(), kebab(name), name.replace(/-/g, "_").toUpperCase(), kebab(name).replace(/-/g, "_").toUpperCase(),
  ]));
  for (const r of vocabulary.CANONICAL_JOB_ROLES) {
    assert.ok(!ruledOut.has(r.jobRoleId), `${r.jobRoleId} is a refused Security term`);
    assert.ok(!ruledOut.has(r.manifestKey), `${r.manifestKey} is a refused Security term`);
  }
  // The two the ruling's own wording turns on: a position that is NEAR one of these is fine, being one is not.
  assert.ok(vocabulary.isCanonicalJobRoleId("office-administration") && !vocabulary.isCanonicalJobRoleId("administrator"));
  assert.ok(vocabulary.isCanonicalJobRoleId("service-technician") && !vocabulary.isCanonicalJobRoleId("technician"));
  assert.ok(vocabulary.isCanonicalJobRoleId("reporting-analyst") && !vocabulary.isCanonicalJobRoleId("report-viewer"));
  // P09's purchasing AUTHORITY stays out of the vocabulary. It is a grant the parts manager holds, not a position,
  // and a Job Role mirroring it would make the grant look like a consequence of the job.
  assert.ok(!vocabulary.isCanonicalJobRoleId("purchasing-manager"));
  assert.ok(GOVERNED_BUSINESS_ROLES.purchasingManager, "the purchasing AUTHORITY must still exist as a Security Role");
  assert.equal(vocabulary.P09_PURCHASING_AUTHORITY_IS_NOT_A_JOB_ROLE, "parts-manager");
  assert.equal(vocabulary.CANONICAL_PERSONA_JOB_ROLES.P09, "parts-manager");
});

test("every Job Role that shares a STEM with a Security Role is on the ruled, enumerated list", () => {
  const securityStems = new Set(SECURITY_ROLE_KEYS.map(kebab));
  const shared = vocabulary.CANONICAL_JOB_ROLE_IDS.filter((id) => securityStems.has(id));
  // Exactly the seven the ruling accepts, and no eighth. A new key that collides with a Security Role stem has to be
  // added to SECURITY_ROLE_STEMS_SHARED_BY_RULING to pass, which is a decision somebody has to take on purpose.
  assert.deepEqual([...shared].sort(), [...vocabulary.SECURITY_ROLE_STEMS_SHARED_BY_RULING].sort());
  assert.equal(vocabulary.SECURITY_ROLE_STEMS_SHARED_BY_RULING.length, 7);
  // Each one independently denotes a position -- which is the ruling's test, and is what none of the four refused
  // terms satisfies. Sanity-check that the refused four are NOT quietly on this allowance.
  for (const name of vocabulary.SECURITY_ROLE_NAMES_REFUSED_AS_JOB_ROLES) {
    assert.ok(!vocabulary.SECURITY_ROLE_STEMS_SHARED_BY_RULING.includes(kebab(name)), name);
  }
});

test("Job Role vocabulary touches no capability: the module is pure and registers nothing", () => {
  const text = source("src/eosWorkforce/jobRoleVocabulary.ts");
  const executable = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // Pure data. No import at all, so no Firebase, no `pg`, no capability catalog, nothing to grant with.
  assert.doesNotMatch(executable, /^\s*import\s/m, "the canonical vocabulary must stay dependency-free");
  assert.doesNotMatch(executable, /require\(/);
  // It names no capability and no grant. `admin.employeeJobRole.write` is the capability that GOVERNS this
  // vocabulary; it already exists, it is not registered here, and this module must not mention it as data.
  assert.doesNotMatch(executable, /capabilit/i);
  assert.doesNotMatch(executable, /admin\.employeeJobRole\.write/);
  assert.doesNotMatch(executable, /role_capabilities/);
});

// ════════════════════════════ 4. THE PERSONA MAPPING ════════════════════════════

test("P01-P16 is TOTAL: sixteen personas, each mapped to exactly one canonical Job Role", () => {
  const mapping = vocabulary.CANONICAL_PERSONA_JOB_ROLES;
  assert.deepEqual([...vocabulary.CENSUS_PERSONA_IDS], Object.keys(RULED_PERSONA_JOB_ROLES));
  assert.deepEqual(Object.keys(mapping).sort(), [...vocabulary.CENSUS_PERSONA_IDS].sort());
  assert.equal(Object.keys(mapping).length, 16, "no persona may be left without a position");
  assert.deepEqual(mapping, RULED_PERSONA_JOB_ROLES);
  for (const [persona, jobRoleId] of Object.entries(mapping)) {
    assert.equal(typeof jobRoleId, "string", persona);
    assert.ok(vocabulary.isCanonicalJobRoleId(jobRoleId), `${persona} -> ${jobRoleId} is not canonical`);
  }
});

test("the persona mapping keeps the distinctions the ruling exists to keep", () => {
  const m = vocabulary.CANONICAL_PERSONA_JOB_ROLES;
  // P06/P07 SHARE a position on purpose: they differ by RECORD ASSIGNMENT, a separate authority entirely.
  assert.equal(m.P06, m.P07);
  assert.equal(m.P06, "service-technician");
  // P12/P13 stay DISTINCT although both hold the identical `salesperson` Security Role.
  assert.notEqual(m.P12, m.P13);
  // P01/P02 are two positions, which is the whole point of the P01/P02 split.
  assert.notEqual(m.P01, m.P02);
  assert.equal(m.P02, "office-administration", "the Administrator persona's POSITION is office administration");
  // P16 implies NO business authority, and its position is not a reduced form of any other persona's.
  assert.equal(m.P16, "general-employee");
  const others = Object.entries(m).filter(([p]) => p !== "P16").map(([, id]) => id);
  assert.ok(!others.includes("general-employee"), "the no-authority position belongs to the negative control alone");
});

test("a position exists whether or not anyone currently holds it", () => {
  // P14 and P15 have no Employee and no Principal in the census, and P16's Security Role has no holder at all
  // (recorded defect D-13). None of that is a reason for the POSITION to be absent from the vocabulary: Job Role is
  // a business fact about the job, and a catalog that only listed filled positions could not describe a vacancy.
  for (const persona of ["P14", "P15", "P16"]) {
    assert.ok(vocabulary.isCanonicalJobRoleId(vocabulary.CANONICAL_PERSONA_JOB_ROLES[persona]), persona);
  }
  // Correspondingly, the fixture population fills fifteen of the sixteen positions and leaves general-employee
  // empty ON PURPOSE. The obvious holder would be restricted-user, the signed-in negative control -- and that
  // persona holds the `generalEmployee` Security Role, so giving it the GENERAL_EMPLOYEE Job Role would put the
  // position and the Role on one persona under one word, which reads as a Job Role DERIVED from a Security Role.
  // restricted-user keeps OFFICE_MANAGER instead, which is also what carries the fixture's
  // same-Job-Role-different-Security-Role proof against the office-manager persona.
  const held = new Set(SAMPLE_COMPANY.employees.map((e) => e.jobRole));
  const unheld = vocabulary.CANONICAL_JOB_ROLES.filter((r) => !held.has(r.manifestKey)).map((r) => r.jobRoleId);
  assert.deepEqual(unheld, ["general-employee"]);
  const restricted = SAMPLE_COMPANY.employees.find((e) => e.key === "restricted-user");
  const officeManager = SAMPLE_COMPANY.employees.find((e) => e.key === "office-manager");
  assert.equal(restricted.jobRole, officeManager.jobRole);
});
