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
// ════════════════════ THE ACCOUNTABILITY HALF IS A POSITIVE REACHABILITY PROOF ════════════════════
//
// IT USED TO BE A VACUITY GUARD, and that guard did its job: it asserted the accountability population was
// EMPTY and that the census document said `NO ACCOUNTABILITY WRITE PATH EXISTS YET`, so that when Wave 2C's
// S6 built the storage the test would FAIL and force the section to be rewritten. It failed. This is the
// rewrite, and it is deliberately a STRONGER assertion rather than a relaxed one.
//
// The vacuity guard could only ever say "nothing exists". The proof below says three things, and ALL THREE
// must hold:
//
//   1. AT LEAST ONE REAL ACCOUNTABILITY WRITE PATH EXISTS — and it is proved by EXECUTING it, not by
//      finding a file. A governed establishment runs against an Employee authority double, a real
//      commercial builder is called with the result, and the accountability field is asserted present in
//      the built record. A path that existed only as source would pass a file-scan and fail a business.
//   2. EVERY REACHABLE ACCOUNTABILITY WRITE PATH IS GOVERNED. The field-name LITERAL exists in exactly one
//      module, so every writer must import that module — which makes the import graph the population,
//      rather than a token scan that would silently miss a module naming the field through the constant.
//      Every member is classified, and no member is a BYPASS DEFECT.
//   3. ZERO PATHS MUST NEVER PASS. The population size is asserted NON-ZERO, and so is the count of
//      GOVERNED members. An empty accountability axis now FAILS this suite, which is the opposite of what
//      the old guard required and is the whole point of replacing it rather than deleting it.
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

/**
 * The STORED field names an accountability write must use, as string LITERALS.
 *
 * The population below is expected to be NON-EMPTY in `functions/src` and EMPTY in `functions/scripts` and
 * `firestore.rules`. Both halves of that are assertions.
 */
const ACCOUNTABILITY_FIELD_LITERALS = Object.freeze(["accountableEmployeeId", "accountablePersonSource"]);

/**
 * The ONE module allowed to contain those literals: the governed storage declaration. Everything else must
 * import them, which is what makes the import graph the complete population.
 */
const ACCOUNTABILITY_DECLARATION = "src/responsibility/accountablePersonStorage.ts";

/**
 * §5.2 of docs/security/ownership-accountability-bypass-census.md, pinned.
 *
 * Every module that imports the accountability storage declaration, with its classification. ADDING A
 * MODULE HERE IS A DECISION: it means somebody classified a new accountability write path.
 */
const CLASSIFIED_ACCOUNTABILITY_PATHS = Object.freeze({
  // The declaration itself: the field names, the source vocabulary, the scope, and the only mint.
  "src/responsibility/accountablePersonStorage.ts": "GOVERNED",
  // The creation rule (#181), over the Wave-2A Employee port.
  "src/responsibility/accountablePersonEstablishment.ts": "GOVERNED",
  // The store: stages, never commits; refuses an out-of-scope family.
  "src/responsibility/accountablePersonRecordStore.ts": "GOVERNED",
  // The change path (#184 option (e)).
  "src/responsibility/governedResponsibilityHandoff.ts": "GOVERNED",
  // The dedicated census (#187 §1). READ-ONLY -- it is in the population because it imports the
  // declaration, and its classification says it writes nothing.
  "src/responsibility/accountabilityCensus.ts": "NOT APPLICABLE",
  // The three creation builders. Each VERIFIES the governed mark and refuses an unmarked value.
  "src/opportunity/opportunityCommands.ts": "GOVERNED",
  "src/salesAgreement/salesAgreementCommands.ts": "GOVERNED",
  "src/salesOrder/salesOrderCommands.ts": "GOVERNED",
  // Owner ruling 2026-09-14, blocker #1: the PostgreSQL accountability audit authority. Accepts only a minted value;
  // mutation and append-only history in ONE transaction. Not imported by any callable (blocker #2 stays open).
  "src/eosCommercial/commercialAccountabilityRepository.ts": "GOVERNED",
  // Commercial wave C2: creation-time establishment, mint-gated, persisted only through the #1905 writer. Unwired.
  "src/eosCommercial/commands/commercialCreation.ts": "GOVERNED",
});

const VALID_CLASSIFICATIONS = Object.freeze([
  "GOVERNED",
  "INERT",
  "LEGACY",
  "BYPASS DEFECT",
  "NOT APPLICABLE",
  // Owner ruling 2026-09-14 (synthetic nonprod seed). A NONPROD-ONLY persistence path whose accountable Employee
  // value was produced by the governed establishment + mint. NOT live write activation, NOT a production
  // accountability writer, NOT permission to bypass the mint, and NOT closure of activation blocker #2.
  "GOVERNED/SEED",
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
  // CRM cutover: the pure snapshot census. Reads legacy owner shapes; writes nothing; loaded only by scripts/crmCutover.js.
  "src/crm/crmCutoverSnapshot.ts": "INERT",
  // CRM cutover: copy once / verify. Carries the census-resolved owner verbatim at INSERT; never changes an owner. Operator tool only.
  "src/crm/crmCutoverCopy.ts": "INERT",
  "src/crm/customerRepository.ts": "INERT",
  "src/eosCommercial/commercialOwnershipAuthority.ts": "INERT",
  "src/eosCommercial/commercialOwnershipRepository.ts": "INERT",
  // Commercial wave C2: the governed PostgreSQL command layer. Unwired (no runtime entry point imports it) and behind
  // capabilities registered active:false. Its ONE owner-CHANGE path goes through stageCommercialOwnershipTransfer.
  "src/eosCommercial/commands/opportunityCommandService.ts": "GOVERNED",
  "src/eosCommercial/commands/salesAgreementCommandService.ts": "INERT",
  "src/eosCommercial/commands/salesOrderCommandService.ts": "INERT",
  "src/eosCommercial/commands/commercialRecordStore.ts": "INERT",
  "src/eosCommercial/commands/commercialCommandKernel.ts": "NOT APPLICABLE",
  "src/eosCommercial/commands/commercialCreation.ts": "NOT APPLICABLE",
  // CRM wave D1-A: the governed PostgreSQL CRM authority layer. Unwired. Owners are written only at creation (explicit
  // Account owner, or inherited by Contact / customer site); no update allowlist names an owner.
  "src/eosCrm/accountAuthority.ts": "INERT",
  "src/eosCrm/contactAuthority.ts": "INERT",
  "src/eosCrm/accountLocationAuthority.ts": "INERT",
  "src/eosCrm/crmAuthorityKernel.ts": "NOT APPLICABLE",
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
  // Owner ruling 2026-09-14: the fenced synthetic nonprod seed. Owners go through the governed CRM and commercial
  // writers; accountable persons through the mint (see the GOVERNED/SEED ratchet below).
  "scripts/seedSyntheticNonprodWorkforce.js": "GOVERNED/SEED",
});

/**
 * §5.2, pinned. Operator scripts that REACH accountability storage -- by importing the governed declaration or
 * establishment -- rather than by naming its field literals. Only GOVERNED/SEED is admissible here.
 */
const GOVERNED_SEED_ACCOUNTABILITY_SCRIPTS = Object.freeze(["scripts/seedSyntheticNonprodWorkforce.js"]);

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

// ════════════════════ 5. THE ACCOUNTABILITY REACHABILITY PROOF ════════════════════
//
// Replaces the Wave-2B vacuity guard. Three claims, all required. See the header.

/**
 * The ACCOUNTABILITY WRITE POPULATION: the governed storage declaration, plus every module under
 * `functions/src` that imports it.
 *
 * The declaration is a member by definition rather than by import — it cannot import itself, and it is
 * the module that holds the field literals and the mint, so leaving it out would exclude the one path
 * every other member depends on.
 */
function accountabilityPopulation() {
  const found = new Set([ACCOUNTABILITY_DECLARATION]);
  for (const file of walk(SRC_DIR, [".ts"])) {
    const code = stripComments(readFileSync(file, "utf8"));
    if (/from\s+["'][^"']*accountablePersonStorage["']/.test(code)) {
      found.add(relative(FUNCTIONS_DIR, file).split(sep).join("/"));
    }
  }
  return [...found].sort();
}

test("CLAIM 2a: the accountability field LITERALS exist in exactly ONE module", () => {
  // This is what makes the import graph the complete population. If a second module spelled
  // "accountableEmployeeId" itself, it could write the field without importing the declaration, and the
  // reachability proof below would have a blind spot.
  for (const literal of ACCOUNTABILITY_FIELD_LITERALS) {
    const holders = [];
    for (const file of walk(SRC_DIR, [".ts"])) {
      const code = stripComments(readFileSync(file, "utf8"));
      if (new RegExp(`["']${literal}["']`).test(code)) {
        holders.push(relative(FUNCTIONS_DIR, file).split(sep).join("/"));
      }
    }
    assert.deepEqual(
      holders,
      [ACCOUNTABILITY_DECLARATION],
      `the literal "${literal}" appears outside the governed storage declaration. Every accountability ` +
        "writer must IMPORT the field name, because that is what makes the import graph the complete " +
        `population this suite classifies: ${holders.join(", ")}`,
    );
  }
});

test("CLAIM 2b: every module reaching accountability storage is CLASSIFIED, and none is a BYPASS DEFECT", () => {
  const discovered = accountabilityPopulation();
  const unclassified = discovered.filter((m) => !(m in CLASSIFIED_ACCOUNTABILITY_PATHS));
  assert.deepEqual(
    unclassified,
    [],
    "A NEW module can reach accountability storage and is NOT classified in " +
      "docs/security/ownership-accountability-bypass-census.md §5.2. Per #184 every mutation path capable " +
      "of changing governed ACCOUNTABILITY must be classified GOVERNED / INERT / LEGACY / BYPASS DEFECT / " +
      `NOT APPLICABLE — classify it there and pin it here: ${unclassified.join(", ")}`,
  );
  const vanished = Object.keys(CLASSIFIED_ACCOUNTABILITY_PATHS)
    .filter((m) => !discovered.includes(m))
    .sort();
  assert.deepEqual(
    vanished,
    [],
    "A classified accountability path no longer reaches the storage declaration. That may be a genuine " +
      `change, but the census must be updated rather than left describing a path that is gone: ${vanished.join(", ")}`,
  );
  for (const [module, classification] of Object.entries(CLASSIFIED_ACCOUNTABILITY_PATHS)) {
    assert.ok(
      VALID_CLASSIFICATIONS.includes(classification),
      `${module} carries "${classification}", which is not one of: ${VALID_CLASSIFICATIONS.join(" · ")}`,
    );
    assert.notEqual(
      classification,
      "BYPASS DEFECT",
      `${module} is an accountability BYPASS DEFECT. #184: "eliminate or refuse the bypass" — this axis ` +
        "was built after that ruling, so a bypass here is a new defect rather than an inherited one.",
    );
  }
});

test("CLAIM 3: ZERO PATHS CANNOT PASS — the population and the GOVERNED count are both non-zero", () => {
  const discovered = accountabilityPopulation();
  assert.ok(
    discovered.length > 0,
    "THE ACCOUNTABILITY WRITE POPULATION IS EMPTY. That is the vacuous pass this proof exists to refuse: " +
      "an axis with no write path satisfies 'every path is governed' trivially and measures nothing. " +
      "Wave 2C S6 built the path; if it is gone, this suite must fail.",
  );
  const governed = Object.entries(CLASSIFIED_ACCOUNTABILITY_PATHS).filter(([, c]) => c === "GOVERNED");
  assert.ok(
    governed.length >= 1,
    "NO path is classified GOVERNED. 'All reachable accountability write paths are governed' is then " +
      "vacuously true over an empty set, which is exactly the claim this proof refuses to accept.",
  );
  // And the four load-bearing ones are named individually, so a rename cannot quietly reduce the set.
  for (const required of [
    "src/responsibility/accountablePersonStorage.ts",
    "src/responsibility/accountablePersonEstablishment.ts",
    "src/responsibility/accountablePersonRecordStore.ts",
    "src/responsibility/governedResponsibilityHandoff.ts",
  ]) {
    assert.ok(discovered.includes(required), `${required} is no longer in the accountability population`);
    assert.equal(CLASSIFIED_ACCOUNTABILITY_PATHS[required], "GOVERNED");
  }
});

test("CLAIM 1: a REAL accountability write path exists — proved by RUNNING it", async () => {
  // The strongest form available without a database: the governed creation rule runs against an Employee
  // authority double, and a REAL commercial builder is called with its result. A source scan cannot tell a
  // working path from a dead one; this can.
  const { establishCreationAccountablePerson } = await import(
    "../lib/responsibility/accountablePersonEstablishment.js"
  );
  const { ACCOUNTABLE_PERSON_FIELD, ACCOUNTABLE_PERSON_SOURCE_FIELD } = await import(
    "../lib/responsibility/accountablePersonStorage.js"
  );
  const { buildCreateOpportunity } = await import("../lib/opportunity/opportunityCommands.js");

  const authority = {
    async resolveEmployeeReference(reference) {
      return {
        outcome: "RESOLVED",
        reference,
        employee: {
          employeeId: reference.employeeId,
          tenantId: reference.tenantId,
          employmentStatus: "ACTIVE",
          operatingCompanyId: "taylor",
        },
      };
    },
  };
  const established = await establishCreationAccountablePerson(
    { employeeAuthority: authority },
    {
      tenantId: "tenant-a",
      family: "opportunity",
      explicitAccountableEmployeeId: "emp-accountable",
      eligibilityPolicy: { policyId: "RATCHET-PROOF", eligibleStatuses: ["ACTIVE"] },
    },
  );
  const built = buildCreateOpportunity(
    {
      accountId: "acct-1",
      ownerEmployeeId: "emp-owner",
      operatingCompanyId: "taylor",
      salesChannel: "RETAIL",
      lines: [{ kind: "PART", ref: "p-1", qty: 1 }],
      accountablePerson: established,
    },
    { actorUid: "uid-actor", nowMillis: 1000 },
  );
  assert.equal(
    built[ACCOUNTABLE_PERSON_FIELD],
    "emp-accountable",
    "the executed accountability write path produced no accountability field — the path is source only",
  );
  assert.equal(built[ACCOUNTABLE_PERSON_SOURCE_FIELD], "EXPLICIT");
  // AND THE OWNER IS UNTOUCHED AND DIFFERENT, so the executed path is not the collapse #187 §1 forbids.
  assert.equal(built.ownerEmployeeId, "emp-owner");
  assert.notEqual(built.ownerEmployeeId, built[ACCOUNTABLE_PERSON_FIELD]);
});

test("CLAIM 2c: the path is governed at RUNTIME — an unmarked value cannot reach storage", async () => {
  // The other half of claim 2. A classification is a statement about a file; this is a statement about
  // what the code accepts. An accountability write that took a bare id would be governed only by
  // convention, and convention is what #184 says not to rely on.
  const { buildCreateOpportunity } = await import("../lib/opportunity/opportunityCommands.js");
  const input = {
    accountId: "acct-1",
    ownerEmployeeId: "emp-owner",
    operatingCompanyId: "taylor",
    salesChannel: "RETAIL",
    lines: [{ kind: "PART", ref: "p-1", qty: 1 }],
  };
  for (const forgery of [
    "emp-accountable",
    { accountableEmployeeId: "emp-accountable", source: "EXPLICIT", eligibilityPolicyId: "x", employmentStatus: "ACTIVE" },
  ]) {
    assert.throws(
      () => buildCreateOpportunity({ ...input, accountablePerson: forgery }, { actorUid: "u", nowMillis: 1 }),
      (e) => e.code === "ACCOUNTABLE_PERSON_NOT_GOVERNED",
      `${JSON.stringify(forgery)} reached a commercial record as an accountable person`,
    );
  }
});

test("GOVERNED/SEED: an operator script reaching accountability storage is classified, nonprod-fenced and mint-gated", () => {
  const reaching = [];
  for (const file of walk(SCRIPTS_DIR, [".js", ".mjs", ".cjs"])) {
    const code = stripComments(readFileSync(file, "utf8"));
    if (/responsibility\/(accountablePersonStorage|accountablePersonEstablishment)(\.js)?["']/.test(code)) {
      reaching.push(relative(FUNCTIONS_DIR, file).split(sep).join("/"));
    }
  }
  assert.deepEqual(
    reaching.sort(),
    [...GOVERNED_SEED_ACCOUNTABILITY_SCRIPTS].sort(),
    "an operator script now reaches accountability storage and is not a classified GOVERNED/SEED path. Classify it " +
      "in the census §5.2 -- an unclassified script writing a responsibility axis is the bypass #184 calls a defect.",
  );
  for (const script of GOVERNED_SEED_ACCOUNTABILITY_SCRIPTS) {
    assert.equal(CLASSIFIED_SCRIPTS[script], "GOVERNED/SEED");
    const code = stripComments(readFileSync(join(FUNCTIONS_DIR, script), "utf8"));
    // Nonprod-only: the shared production refusal AND the positive nonprod runtime marker.
    assert.ok(code.includes("assertMeasurementTarget(") && code.includes("assertNonprodRuntime("), `${script} is not nonprod-fenced`);
    // Mint-gated: the persisted value comes from the governed establishment + mint, never a manifest id.
    assert.ok(code.includes("establishCreationAccountablePerson(") && code.includes("accountablePersonFields("), `${script} does not go through the mint`);
    for (const literal of ACCOUNTABILITY_FIELD_LITERALS) {
      assert.ok(!namesToken(code, literal), `${script} names ${literal} instead of importing it from the declaration`);
    }
    // Unavailable to the runtime: no source module imports it.
    const name = script.split("/").pop().replace(/\.[cm]?js$/, "");
    for (const file of walk(SRC_DIR, [".ts"])) {
      assert.ok(!readFileSync(file, "utf8").includes(name), `${relative(FUNCTIONS_DIR, file)} reaches the GOVERNED/SEED script`);
    }
  }
});

test("accountability storage reaches NO operator script and NO Rules statement", () => {
  // These two populations ARE empty, and unlike the old guard the emptiness here is a finding rather than
  // the whole claim: §5.2 classifies both as NOT APPLICABLE, and this is what keeps that true.
  const inScripts = scan(SCRIPTS_DIR, [".js", ".mjs", ".cjs"], ACCOUNTABILITY_FIELD_LITERALS, {
    includeTypedOwner: false,
  });
  assert.deepEqual(
    [...inScripts.keys()].sort(),
    [],
    "an operator script now names an accountability field. Classify it in the census §5.2 — an unclassified " +
      "script writing a responsibility axis is the bypass #184 calls a defect.",
  );
  const rules = readFileSync(RULES, "utf8");
  const inRules = ACCOUNTABILITY_FIELD_LITERALS.filter((f) => rules.includes(f));
  assert.deepEqual(
    inRules,
    [],
    "firestore.rules now names an accountability field. Rules are Tier-2 HOLD, so this change did not come " +
      `from this lane, and the census §5.4 must be re-measured: ${inRules.join(", ")}`,
  );
});

test("#187 §1: the accountability census is its OWN census, not a column in the ownership one", () => {
  // The structural half of MI-Y option (ii). Two separate modules, and the ownership census does not
  // import the accountability one.
  const ownershipCensus = stripComments(readFileSync(join(SRC_DIR, "ownership", "ownershipCensus.ts"), "utf8"));
  assert.ok(
    !/accountab/i.test(ownershipCensus),
    "the ownership census now knows about accountability. #187 §1 ruled AGAINST expanding it into a " +
      "generic mega-census: ownership integrity remains ownership integrity.",
  );
  const accountabilityCensus = stripComments(
    readFileSync(join(SRC_DIR, "responsibility", "accountabilityCensus.ts"), "utf8"),
  );
  assert.ok(
    !/ownerFields|ownershipMatrix/.test(accountabilityCensus),
    "the accountability census reads the ownership matrix's owner fields. #186 §9: that mechanism must " +
      "not be made to carry this multi-axis model.",
  );
});

test("the census document RECORDS that the vacuity guard was replaced, not deleted", () => {
  const doc = readFileSync(CENSUS_DOC, "utf8");
  // The old required phrase must be gone as a CLAIM and present only as the sentence that is now false --
  // a census that simply dropped it would lose the record of why the section changed.
  assert.match(
    doc,
    /previous revision of this section read `NO ACCOUNTABILITY WRITE PATH EXISTS YET`/,
    "the census must record that the vacuity statement is now false, rather than silently dropping it",
  );
  assert.match(doc, /now FALSE/, "the census must say so in those words");
  assert.match(
    doc,
    /POSITIVE REACHABILITY PROOF/,
    "the census must say the guard was REPLACED by a stronger proof, not deleted",
  );
  // And the vacuity trap itself must still not be committed: an empty population must never be reported
  // as "no bypasses proven".
  assert.ok(
    !/no bypasses (were )?proven/i.test(doc),
    "the census claims 'no bypasses proven', which is the vacuity trap the previous revision named",
  );
  // Every classification word the ruling names appears, and the accountability population is classified.
  for (const module of Object.keys(CLASSIFIED_ACCOUNTABILITY_PATHS)) {
    assert.ok(doc.includes(module), `${module} is pinned here but is not named in the census document`);
  }
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
