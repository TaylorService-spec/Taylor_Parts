// THE RATCHET — a test that fails when a NEW ungoverned ownership writer appears (Owner ruling #184).
//
// ════════════════════ WHY A RATCHET AND NOT A SNAPSHOT ════════════════════
//
// #184 rules that "any runtime mutation path capable of changing governed RECORD OWNERSHIP or
// ACCOUNTABILITY without passing through the governed orchestration boundary is a DEFECT", and requires
// "an end-to-end call-path census" with every path classified. A census written only as a document is
// true on the day it is written and silently false afterwards — the next module that names an ownership
// field arrives with no classification and nothing notices.
//
// So the population is PINNED HERE, in code, with its classification, and this suite fails when it
// changes. A new writer cannot land without either being classified or breaking the build, which is the
// only mechanism that makes the census's §2 stay true.
//
// ════════════════════ WHY THE SCAN IS BY FIELD NAME, AND WHY `owner` IS HANDLED DIFFERENTLY ════════════════════
//
// `accountOwner` and `ownerEmployeeId` are unambiguous: the token appears in a module only because that
// module is about record ownership. `owner` is not — it is a role name in `roleHierarchy.ts`, a lease
// token in `nativeResetSender.ts`, and a prose noun in a dozen headers. A scan on the bare token would
// be mostly false positives, and a checker whose alarms are usually wrong is one people learn to ignore
// (the lesson `ciTriggerCoverage.test.mjs` records from a tool that shipped exactly that defect).
//
// So `owner` is scanned by its STORED SHAPE instead — the typed-owner literal `owner: { type: …` that
// `ownershipBackfillRules.ts` authors and the backfill scripts write. That is precise, and it is the only
// form in which the `contact`/`location` owner field is ever constructed in this repository.
//
// ════════════════════ THE ACCOUNTABILITY HALF IS A VACUITY GUARD ════════════════════
//
// The accountability population is EMPTY, and the honest reason is that the storage does not exist yet.
// An empty population asserted as "no bypasses" would be a false claim; asserted as "nothing exists to
// classify" it is true and it is checkable. So the guard below asserts the emptiness AND asserts that the
// census document says `NO ACCOUNTABILITY WRITE PATH EXISTS YET` — so that when S6 lands the accountability
// storage, this test FAILS and forces the census section to be rewritten with a real population.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { ALL_FAMILIES } from "../lib/ownership/ownershipCensus.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(FUNCTIONS_DIR, "..");
const SRC_DIR = join(FUNCTIONS_DIR, "src");
const SCRIPTS_DIR = join(FUNCTIONS_DIR, "scripts");
const RULES = join(REPO_ROOT, "firestore.rules");
const CENSUS_DOC = join(REPO_ROOT, "docs", "security", "ownership-accountability-bypass-census.md");

/** The PERSON-axis record-ownership fields, as `ownershipMatrix` declares them. #180 keeps
 *  OPERATING COMPANY a separate axis, so `operatingCompanyId` is deliberately not here. */
const PERSON_OWNERSHIP_FIELDS = Object.freeze(["accountOwner", "owner", "ownerEmployeeId"]);

/** Field names an accountability write would have to use. The population is expected to be EMPTY. */
const ACCOUNTABILITY_FIELDS = Object.freeze([
  "accountablePerson",
  "accountablePersonId",
  "accountableEmployeeId",
  "accountablePersonEmployeeId",
]);

const VALID_CLASSIFICATIONS = Object.freeze([
  "GOVERNED",
  "INERT",
  "LEGACY",
  "BYPASS DEFECT",
  "NOT APPLICABLE",
]);

/**
 * §2 of docs/security/ownership-accountability-bypass-census.md, pinned. Every module in
 * `functions/src/**` that names a person-axis ownership field, with its classification.
 *
 * ADDING A MODULE HERE IS A DECISION, not a chore: it means somebody classified a new ownership writer.
 */
const CLASSIFIED_SOURCE_MODULES = Object.freeze({
  // The one ownership-CHANGE path in the callable surface, and it does not reach the governed boundary.
  "src/opportunity/opportunityCallables.ts": "BYPASS DEFECT",
  "src/opportunity/opportunityCommands.ts": "BYPASS DEFECT",
  // Creation-time establishment behind capabilities registered active:false.
  "src/opportunity/closeOpportunityAsWon.ts": "INERT",
  "src/opportunity/createSalesOrderFromOpportunity.ts": "INERT",
  "src/salesAgreement/salesAgreementCallables.ts": "INERT",
  "src/salesAgreement/salesAgreementCommands.ts": "NOT APPLICABLE",
  "src/salesOrder/salesOrderCommands.ts": "NOT APPLICABLE",
  "src/salesAgreement/agreementToSalesOrder.ts": "NOT APPLICABLE",
  "src/ownership/creationOwnerResolution.ts": "NOT APPLICABLE",
  // The pure rule the bounded backfill scripts consume.
  "src/ownership/ownershipBackfillRules.ts": "LEGACY",
  // PostgreSQL / migration modules no callable can reach.
  "src/crm/customerIdentity.ts": "INERT",
  "src/crm/customerMigrationSource.ts": "INERT",
  "src/crm/customerRepository.ts": "INERT",
  "src/eosCommercial/commercialOwnershipAuthority.ts": "INERT",
  "src/eosCommercial/commercialOwnershipRepository.ts": "INERT",
  // The model, the measurement, and the read projections.
  "src/ownership/ownershipMatrix.ts": "NOT APPLICABLE",
  "src/ownership/typedOwner.ts": "NOT APPLICABLE",
  "src/ownership/ownershipCensus.ts": "NOT APPLICABLE",
  "src/opportunity/opportunityReadService.ts": "NOT APPLICABLE",
  "src/salesAgreement/salesAgreementReadService.ts": "NOT APPLICABLE",
  "src/salesOrder/salesOrderReadService.ts": "NOT APPLICABLE",
  "src/reporting/reportCatalog.ts": "NOT APPLICABLE",
  "src/access/permissionCatalog.ts": "NOT APPLICABLE",
});

/** §4, pinned. Operator scripts that write a person-axis ownership field, or read one. */
const CLASSIFIED_SCRIPTS = Object.freeze({
  "scripts/ownershipSandboxBackfill.js": "LEGACY",
  "scripts/certificationWorld/seedAccountOwners.mjs": "LEGACY",
  "scripts/financialReviewFixtures.mjs": "LEGACY",
  "scripts/ownershipBackfillSimulation.js": "NOT APPLICABLE",
  "scripts/governance/effectiveAuthority.mjs": "NOT APPLICABLE",
});

function walk(dir, exts) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "lib") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

/** Comments stripped FIRST — a field merely discussed in a header is not a writer of it. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const namesToken = (code, token) =>
  new RegExp(`(?<![A-Za-z0-9_])${token}(?![A-Za-z0-9_])`).test(code);

/** The `owner` field, by its STORED SHAPE rather than by its far-too-common name. */
const namesTypedOwnerLiteral = (code) => /owner:\s*\{\s*type/.test(code);

function scan(dir, exts, tokens, { includeTypedOwner = true } = {}) {
  const found = new Map();
  for (const file of walk(dir, exts)) {
    const code = stripComments(readFileSync(file, "utf8"));
    const hits = tokens.filter((t) => namesToken(code, t));
    if (includeTypedOwner && namesTypedOwnerLiteral(code)) hits.push("owner");
    if (hits.length > 0) found.set(relative(FUNCTIONS_DIR, file).split(sep).join("/"), hits);
  }
  return found;
}

// ════════════════════ 1. THE FIELD SET ITSELF ════════════════════

test("the PERSON-axis ownership fields are exactly the ones the matrix declares", () => {
  const declared = new Set();
  for (const family of ALL_FAMILIES) {
    if (family.ownerClass !== "PERSON") continue;
    for (const field of family.ownerFields) declared.add(field);
  }
  assert.deepEqual(
    [...declared].sort(),
    [...PERSON_OWNERSHIP_FIELDS].sort(),
    "the ownership matrix's PERSON-axis ownership fields changed. The census's scope section and this " +
      "ratchet's field list must both be updated, and the new field's writers classified.",
  );
});

test("#187 §1: accountablePerson is NOT in ownershipMatrix.ownerFields, and never becomes so", () => {
  for (const family of ALL_FAMILIES) {
    for (const field of family.ownerFields) {
      assert.ok(
        !/accountab/i.test(field),
        `${family.family} declares "${field}" as an ownership field. #187 §1: "accountablePerson must ` +
          `NOT be placed into ownershipMatrix.ownerFields", and accountability must not be redefined as ownership.`,
      );
    }
  }
});

// ════════════════════ 2. THE RATCHET ON SOURCE MODULES ════════════════════

test("RATCHET: no source module names a person-axis ownership field without a classification", () => {
  const found = scan(SRC_DIR, [".ts"], ["accountOwner", "ownerEmployeeId"]);
  const discovered = [...found.keys()].sort();
  const classified = Object.keys(CLASSIFIED_SOURCE_MODULES).sort();

  const unclassified = discovered.filter((m) => !(m in CLASSIFIED_SOURCE_MODULES));
  assert.deepEqual(
    unclassified,
    [],
    "A NEW module writes or names a person-axis record-ownership field and is NOT classified in " +
      "docs/security/ownership-accountability-bypass-census.md §2. Per #184 every ownership mutation path " +
      "must be classified GOVERNED / INERT / LEGACY / BYPASS DEFECT / NOT APPLICABLE — classify it there " +
      `and pin it here: ${unclassified.join(", ")}`,
  );

  const vanished = classified.filter((m) => !found.has(m));
  assert.deepEqual(
    vanished,
    [],
    "A classified module no longer names an ownership field. That may be a genuine fix, but the census " +
      `must be updated rather than left describing a path that is gone: ${vanished.join(", ")}`,
  );
});

test("every classification is one of the five the ruling names", () => {
  for (const [module, classification] of [
    ...Object.entries(CLASSIFIED_SOURCE_MODULES),
    ...Object.entries(CLASSIFIED_SCRIPTS),
  ]) {
    assert.ok(
      VALID_CLASSIFICATIONS.includes(classification),
      `${module} carries "${classification}", which is not one of: ${VALID_CLASSIFICATIONS.join(" · ")}`,
    );
  }
});

test("RATCHET: no operator script writes a person-axis ownership field without a classification", () => {
  const found = scan(SCRIPTS_DIR, [".js", ".mjs", ".cjs"], ["accountOwner", "ownerEmployeeId"]);
  const unclassified = [...found.keys()].filter((m) => !(m in CLASSIFIED_SCRIPTS)).sort();
  assert.deepEqual(
    unclassified,
    [],
    "A NEW operator script touches a person-axis record-ownership field and is not classified in the " +
      `census §4: ${unclassified.join(", ")}`,
  );
});

test("the ONE governed ownership writer in the tree still stages its handoff in one transaction", () => {
  // assignWarehouseRootCompany.js is the census's single GOVERNED row and the shape S4 follows. If it
  // stopped staging the handoff, or stopped doing it inside a transaction, the census would be wrong.
  const src = readFileSync(join(SCRIPTS_DIR, "assignWarehouseRootCompany.js"), "utf8");
  assert.ok(src.includes("stageOwnershipHandoff"), "the governed script no longer stages an OWNERSHIP_HANDOFF");
  assert.ok(src.includes("runTransaction"), "the governed script no longer commits atomically");
});

// ════════════════════ 3. THE RECORDED BYPASS DEFECT ════════════════════

test("RECORDED DEFECT: updateOpportunity changes ownership and still emits no OWNERSHIP_HANDOFF", () => {
  // This pins the DEFECT, not the desired behaviour. When it is fixed the test fails, which is correct:
  // the census entry must be reclassified from BYPASS DEFECT to GOVERNED at the same time.
  const commands = readFileSync(join(SRC_DIR, "opportunity", "opportunityCommands.ts"), "utf8");
  assert.ok(
    stripComments(commands).includes('"ownerEmployeeId"'),
    "ownerEmployeeId is no longer an editable Opportunity field — the census entry must be reclassified",
  );

  const callables = readFileSync(join(SRC_DIR, "opportunity", "opportunityCallables.ts"), "utf8");
  const code = stripComments(callables);
  assert.ok(
    !code.includes("OWNERSHIP_HANDOFF") && !code.includes("stageOwnershipHandoff"),
    "updateOpportunity's module now emits an ownership handoff. That is the FIX this census asks for — " +
      "reclassify entry #1 in docs/security/ownership-accountability-bypass-census.md §2 from " +
      "BYPASS DEFECT to GOVERNED and update this test.",
  );

  // And it is INERT today because the capability is registered active:false. If that flips, the bypass
  // becomes live and the census's "not a live production bypass today" sentence stops being true.
  const catalog = readFileSync(join(SRC_DIR, "access", "permissionCatalog.ts"), "utf8");
  const entry = catalog.slice(catalog.indexOf('id: "opportunity.write"'));
  const activeLine = entry.slice(0, entry.indexOf("}")).match(/active:\s*(true|false)/);
  assert.ok(activeLine, "opportunity.write no longer declares an `active` flag");
  assert.equal(
    activeLine[1],
    "false",
    "opportunity.write is now ACTIVE, which makes updateOpportunity a LIVE ownership bypass. The census " +
      "must be re-read and #184's 'eliminate or refuse the bypass' acted on before this is granted.",
  );
});

// ════════════════════ 4. THE RULES FINDINGS — RECORDED, NOT FIXED (Tier-2 HOLD) ════════════════════

test("RECORDED: the four firestore.rules findings are unchanged, and accountOwner is unconstrained", () => {
  const rules = readFileSync(RULES, "utf8");

  // The single most load-bearing measurement in §3: accountOwner appears NOWHERE in Rules, so no Rules
  // constraint of any kind applies to record ownership on accounts.
  assert.equal(
    (rules.match(/accountOwner/g) ?? []).length,
    0,
    "accountOwner now appears in firestore.rules. The census's accounts finding must be re-measured — and " +
      "Rules are Tier-2 HOLD, so this change did not come from this lane.",
  );

  // locations and contacts: create/update with NO field constraint at all.
  for (const collection of ["locations", "contacts"]) {
    const at = rules.indexOf(`match /${collection}/{`);
    assert.ok(at > 0, `the ${collection} Rules block is gone — the census must be re-measured`);
    const block = rules.slice(at, rules.indexOf("}", rules.indexOf("allow delete", at)));
    assert.ok(
      /allow create, update: if isAdminOrDispatcher\(\);/.test(block),
      `the ${collection} write statement changed. The census recorded it as unconstrained on the owner ` +
        "field; re-measure before trusting §3.",
    );
  }

  // The commercial three stay Admin-SDK-only, which is why they have no client bypass.
  for (const collection of ["opportunities", "sales_orders", "sales_agreements"]) {
    const at = rules.indexOf(`match /${collection}/{`);
    assert.ok(at > 0, `the ${collection} Rules block is gone`);
    assert.ok(
      /allow read, write: if false;/.test(rules.slice(at, at + 200)),
      `${collection} is no longer Admin-SDK-only — a client-direct ownership write path may now exist`,
    );
  }
});

// ════════════════════ 5. THE ACCOUNTABILITY VACUITY GUARD ════════════════════

test("VACUITY GUARD: the accountability write population is empty because NOTHING EXISTS to classify", () => {
  const inSrc = scan(SRC_DIR, [".ts"], ACCOUNTABILITY_FIELDS, { includeTypedOwner: false });
  const inScripts = scan(SCRIPTS_DIR, [".js", ".mjs", ".cjs"], ACCOUNTABILITY_FIELDS, {
    includeTypedOwner: false,
  });
  const rules = readFileSync(RULES, "utf8");
  const inRules = ACCOUNTABILITY_FIELDS.filter((f) => rules.includes(f));

  // ONE module is expected to name these: the S4 governed boundary, whose `AccountabilityStore` and
  // `AccountabilityAuditPort` are the SEAM the ruled sequence needs. A seam is not storage — it declares
  // what the future storage must do and nothing about where it lives. It is allow-listed by name so that
  // a SECOND module naming an accountability field still fails this guard.
  const GOVERNED_SEAM = "src/responsibility/governedResponsibilityHandoff.ts";
  assert.ok(
    inSrc.has(GOVERNED_SEAM),
    `${GOVERNED_SEAM} no longer names an accountability field — the governed accountability seam is gone`,
  );

  const population = [
    ...[...inSrc.keys()].filter((m) => m !== GOVERNED_SEAM),
    ...inScripts.keys(),
    ...inRules.map((f) => `firestore.rules:${f}`),
  ];
  assert.deepEqual(
    population.sort(),
    [],
    "ACCOUNTABILITY STORAGE NOW EXISTS. The census's §5 currently states NO ACCOUNTABILITY WRITE PATH " +
      "EXISTS YET, which is no longer true. Rewrite §5 with a real population, classify every path " +
      "GOVERNED / INERT / LEGACY / BYPASS DEFECT / NOT APPLICABLE, and update this guard: " +
      `${population.join(", ")}`,
  );
});

test("the census document states the accountability truth in the required words", () => {
  const doc = readFileSync(CENSUS_DOC, "utf8");
  // The brief's explicit anti-vacuity instruction: an empty population must NOT be reported as
  // "no bypasses proven". Both halves are asserted — the required phrase present, the false one absent.
  assert.ok(
    doc.includes("NO ACCOUNTABILITY WRITE PATH EXISTS YET"),
    "the census must state NO ACCOUNTABILITY WRITE PATH EXISTS YET rather than implying the paths were audited",
  );
  assert.ok(
    !/no bypasses (were )?proven/i.test(doc.replace(/\*\*"No accountability bypasses were proven"\*\*/g, "")),
    "the census claims 'no bypasses proven' from an empty population, which is the vacuity trap",
  );
});

test("the census classifies every module and script this ratchet pins", () => {
  const doc = readFileSync(CENSUS_DOC, "utf8");
  for (const module of [...Object.keys(CLASSIFIED_SOURCE_MODULES), ...Object.keys(CLASSIFIED_SCRIPTS)]) {
    assert.ok(
      doc.includes(module),
      `${module} is pinned in this ratchet but is not named in the census document — a classification ` +
        "that exists only in a test is not a census",
    );
  }
  for (const classification of VALID_CLASSIFICATIONS) {
    assert.ok(doc.includes(classification), `the census never uses the classification ${classification}`);
  }
});

// ════════════════════ 6. THE GOVERNED BOUNDARY STAYS UNEXPORTED ════════════════════

test("the S4 boundary is not exported from index.ts — no capability was activated by this wave", () => {
  const index = readFileSync(join(SRC_DIR, "index.ts"), "utf8");
  assert.ok(
    !/responsibility\//.test(index),
    "the governed responsibility boundary is now exported as a callable. Every capability that would gate " +
      "it is registered active:false, so exporting it means one was activated — which is a separate, " +
      "separately-authorized decision. Re-read the census §1 before landing this.",
  );
});
