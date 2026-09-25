// WAVE C3, offline -- the governed PostgreSQL Commercial read projections' boundaries. The live-server proof of every
// projection is functions/test/commercialReadProjectionsPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { opaqueFirestoreAccess, namesFirestoreCollection } from "./support/firestoreCollectionFence.mjs";
import { stripComments, moduleSpecifiers, resolveSpecifier, importsModule, namesInCode } from "./support/executableReferenceFence.mjs";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(FUNCTIONS_DIR, "src");
const READS = join(SRC, "eosCommercial", "reads");
const require = createRequire(import.meta.url);
const kernel = require("../lib/eosCommercial/reads/commercialReadKernel.js");
const oppRead = require("../lib/eosCommercial/reads/opportunityReadProjection.js");
const saRead = require("../lib/eosCommercial/reads/salesAgreementReadProjection.js");
const soRead = require("../lib/eosCommercial/reads/salesOrderReadProjection.js");
const { getAccountCommercialProjection } = require("../lib/eosCommercial/reads/accountCommercialProjection.js");

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
function walk(dir, exts) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => full.endsWith(e))) out.push(full);
  }
  return out;
}
const readSources = () => walk(READS, [".ts"]);
const rel = (f) => relative(FUNCTIONS_DIR, f).split("\\").join("/");
const READ_CAPS = new Set(["opportunity.read", "salesAgreement.read", "salesOrder.read"]);
const ACTOR = Object.freeze({ tenantId: "t1", principalId: "p1", capabilities: READ_CAPS });

test("(1) no Firebase: no read module imports it, and loading every one resolves no Firebase module", () => {
  assert.equal(readSources().length, 5, "the C3 read module set changed; review this ratchet");
  for (const file of readSources()) {
    const code = strip(readFileSync(file, "utf8"));
    for (const forbidden of [/firebase/i, /firestore/i, /getFirestore/, /onCall\b/, /HttpsError/, /resolveEffectiveAccess/, /collection\(/]) {
      assert.doesNotMatch(code, forbidden, `${rel(file)} reaches for ${forbidden}`);
    }
  }
  const sentinel = "C3_LOADED_FIREBASE";
  const preload = join(mkdtempSync(join(tmpdir(), "c3-")), "preload.cjs");
  writeFileSync(preload, `const M=require("module");const l=M._load;M._load=function(r,...a){if(/firebase/i.test(r)){process.stderr.write("${sentinel}:"+r);process.exit(97);}return l.call(this,r,...a);};`);
  const modules = readSources().map((f) => join(FUNCTIONS_DIR, "lib", relative(SRC, f)).replace(/\.ts$/, ".js"));
  const probe = spawnSync(process.execPath, ["--require", preload, "-e", modules.map((m) => `require(${JSON.stringify(m)});`).join("")], { cwd: FUNCTIONS_DIR, encoding: "utf8" });
  assert.equal(probe.status, 0, `a C3 module transitively loaded Firebase: ${probe.stderr}`);
});

const REPO = resolve(FUNCTIONS_DIR, "..");
const CLIENT_SRC = join(REPO, "field-ops-app-vite", "src");
const crel = (f) => relative(REPO, f).split("\\").join("/");
const PATH = { relative, resolve, dirname };

/** The approved Sales Agreements read path, and nothing else, may reach a Commercial read. */
const APPROVED_TRANSPORT_CLIENT = "field-ops-app-vite/src/services/commercialApiClient.js";
const APPROVED_INDEX_HOOK = "field-ops-app-vite/src/hooks/useSalesAgreementIndex.js";
const APPROVED_INDEX_SCREEN = "field-ops-app-vite/src/modules/sales/SalesAgreementsList.jsx";
const APPROVED_INDEX_DOMAIN = "field-ops-app-vite/src/domain/salesAgreementIndex.js";
const APPROVED_CLIENT_PATH = [APPROVED_TRANSPORT_CLIENT, APPROVED_INDEX_HOOK, APPROVED_INDEX_SCREEN, APPROVED_INDEX_DOMAIN];
/** The C3 operations the C4 transport serves. Exact names: listOpportunitiesForAccount is a LEGACY callable, not one of these. */
const C3_OPERATIONS = ["getAccountCommercialProjection", "getOpportunityDetail", "getSalesAgreementDetail", "getSalesOrderDetail", "listOpportunities", "listSalesAgreements", "listSalesOrders"];

test("(2) the only runtime entry point to the read projections is the C4 Commercial transport", () => {
  // ANCHORED TO A MODULE SPECIFIER, not to raw text.
  //
  // This assertion used to read the whole file and look for "eosCommercial/reads/" anywhere in it. It
  // then failed on src/eosOps/experienceAuthority.ts, which imports nothing from the read layer and
  // merely NAMES it in a comment explaining which governed read backs the Sales Agreements surface --
  // the fifth time a bare-substring boundary probe in this repository has fired on the prose that
  // documents the boundary. A module is reached when it sits in a specifier position; a sentence
  // about it is not a dependency, and deleting the sentence to appease a grep would delete the note
  // saying why the boundary exists. A relative "./reads/" import is resolved rather than pattern-
  // matched, so src/eosWorkforce/reads (a different domain's reads) is distinguished by path.
  const importsReadLayer = (f) => moduleSpecifiers(readFileSync(f, "utf8"))
    .some((spec) => /^eosCommercial\/reads\//.test(resolveSpecifier(f, spec, SRC, PATH)));
  const importers = walk(SRC, [".ts"]).filter((f) => !f.startsWith(READS) && importsReadLayer(f));
  assert.deepEqual(importers.map(rel), ["src/eosCommercial/commercialHttp.ts"], "a module other than the C4 transport imports the read layer");
  assert.ok(importsReadLayer(join(SRC, "eosCommercial", "commercialHttp.ts")), "the specifier scan stopped seeing the transport's own imports and would now pass for the wrong reason");
  for (const surface of ["index.ts", "eosOps/eosOpsHttp.ts", "adminPolicy/adminPolicyHttp.ts"]) {
    assert.doesNotMatch(strip(readFileSync(join(SRC, surface), "utf8")), /eosCommercial|ReadProjection|commercialReadKernel/, `${surface} reaches Commercial reads`);
  }
  assert.doesNotMatch(strip(readFileSync(join(SRC, "eosApi", "server.ts"), "utf8")), /ReadProjection|commercialReadKernel|eosCommercial\/reads/, "server.ts reaches reads without the transport");

  // THE CLIENT MAY NEVER REACH THE READ LAYER ITSELF. This is unchanged and deliberately not loosened:
  // the approved path's allowance (below) is for an OPERATION NAME sent over the governed transport,
  // never for the projection modules.
  const client = walk(CLIENT_SRC, [".js", ".jsx", ".ts", ".tsx"]);
  const reaching = client.filter((f) => {
    const source = readFileSync(f, "utf8");
    return importsModule(source, /eosCommercial\/reads|ReadProjection|commercialReadKernel/)
      || namesInCode(source, /eosCommercial\/reads|(?:opportunity|salesAgreement|salesOrder)ReadProjection|commercialReadKernel/);
  }).map(crel);
  assert.deepEqual(reaching, [], "a client module reaches a C3 read projection module");

  // PINNED BOTH WAYS. experienceAuthority.ts is the module that failed this assertion before the
  // anchor: it NAMES the governed read in a comment and IMPORTS nothing from it. Both halves are
  // asserted, so this can never be "fixed" by rewording the comment to slip past a scan -- that
  // would leave the defective probe in place and delete the note saying which read backs the surface.
  const experience = readFileSync(join(SRC, "eosOps", "experienceAuthority.ts"), "utf8");
  assert.match(experience, /eosCommercial\/reads\/salesAgreementReadProjection\.ts/, "the comment naming the governed read was edited away instead of the guard being fixed");
  assert.equal(importsReadLayer(join(SRC, "eosOps", "experienceAuthority.ts")), false, "experienceAuthority.ts now really imports the C3 read layer");
});

test("(2b) the approved Sales Agreements index is the ONE client Commercial read, pinned to the transport and to salesAgreement.read", () => {
  // RECOGNISED, NOT LOOSENED. Lane BQ built the governed client path the C4 transport was always for,
  // so a Commercial read operation named in the browser is no longer automatically a defect. The
  // allowance is pinned to the approved files and to the operations they are approved to name; every
  // other way a Commercial projection could appear in the client is still a failure.
  const client = walk(CLIENT_SRC, [".js", ".jsx", ".ts", ".tsx"]);
  const naming = new Map();
  for (const f of client) {
    const source = readFileSync(f, "utf8");
    const hits = C3_OPERATIONS.filter((op) => namesInCode(source, new RegExp(`\\b${op}\\b`)));
    if (hits.length) naming.set(crel(f), hits.sort());
  }
  assert.deepEqual([...naming.keys()].sort(), [APPROVED_INDEX_HOOK, APPROVED_TRANSPORT_CLIENT].sort(),
    "an unapproved client module names a Commercial read operation");
  assert.deepEqual(naming.get(APPROVED_TRANSPORT_CLIENT), [...C3_OPERATIONS].sort(),
    "the transport client's mirrored read list drifted from the transport's READ_RUNNERS");
  assert.deepEqual(naming.get(APPROVED_INDEX_HOOK), ["listSalesAgreements"],
    "the Sales Agreements hook names a Commercial read other than its own index");

  // NO WRITE MASQUERADING AS A READ. The C2 mutations stay absent from the whole approved path.
  const C2_MUTATIONS = ["createOpportunity", "updateOpportunity", "transitionOpportunity", "closeOpportunityAsWon", "createSalesAgreement",
    "updateSalesAgreementDraft", "acceptSalesAgreement", "createSalesOrder", "createSalesOrderFromOpportunity", "transitionSalesOrder"];
  for (const file of APPROVED_CLIENT_PATH) {
    const code = stripComments(readFileSync(join(REPO, file), "utf8"));
    for (const mutation of C2_MUTATIONS) assert.doesNotMatch(code, new RegExp(`\\b${mutation}\\b`), `${file} names the C2 mutation ${mutation}`);

    // NO DIRECT FIRESTORE READ. Lane AO's shared fence, not a fifth bare-string variant.
    assert.equal(opaqueFirestoreAccess(code), false, `${file} holds a Firestore accessor`);
    for (const collection of ["sales_agreements", "salesAgreements", "opportunities", "salesOrders", "sales_orders"]) {
      assert.equal(namesFirestoreCollection(code, collection), false, `${file} reads ${collection} from Firestore`);
    }

    // NO ALTERNATE PERMISSION VOCABULARY AND NO ROLE-STRING AUTHORIZATION. The client states no
    // capability at all: authority is resolved server-side from the bearer, and the screen only
    // renders the answer. A capability literal here would be a second, client-stated vocabulary.
    assert.deepEqual([...code.matchAll(/["'`]([a-z][A-Za-z]*\.[a-z][A-Za-z]*(?:\.[a-z][A-Za-z]*)?)["'`]/g)].map((m) => m[1]), [],
      `${file} states a capability-shaped permission literal`);
    for (const forbidden of [/\bsecurityRole\b/, /\boperationalRoles\b/, /\bcustomClaims\b/, /\bgetIdTokenResult\b/, /\bROLE_[A-Z_]+\b/]) {
      assert.doesNotMatch(code, forbidden, `${file} authorizes from a role or a claim: ${forbidden}`);
    }
  }

  // The Firestore door the client must not fall back through is still shut, read AND write.
  const rules = readFileSync(join(REPO, "firestore.rules"), "utf8");
  const at = rules.indexOf("match /sales_agreements/{salesAgreementId}");
  assert.ok(at > 0, "the sales_agreements rule is gone; the no-fallback claim is unproven");
  assert.match(rules.slice(at, at + 200), /allow read, write: if false;/, "sales_agreements is no longer deny-all in firestore.rules");
});

test("(3) no Commercial capability is activated, and no read capability id is invented", () => {
  const catalog = readFileSync(join(SRC, "access", "permissionCatalog.ts"), "utf8");
  assert.deepEqual(Object.values(kernel.COMMERCIAL_READ_CAPABILITIES), ["opportunity.read", "salesAgreement.read", "salesOrder.read"]);
  for (const id of [...Object.values(kernel.COMMERCIAL_READ_CAPABILITIES), "opportunity.write", "opportunity.createSalesOrder", "salesAgreement.create", "salesAgreement.updateDraft", "salesAgreement.accept", "salesOrder.write"]) {
    const at = catalog.indexOf(`id: "${id}"`);
    assert.ok(at > 0, `${id} is not registered`);
    assert.match(catalog.slice(at, catalog.indexOf("}", at)), /active:\s*false/, `${id} became active`);
  }
  const used = new Set(readSources().flatMap((f) => [...strip(readFileSync(f, "utf8")).matchAll(/"((?:opportunity|salesAgreement|salesOrder|account|customer)\.[A-Za-z.]+)"/g)].map((m) => m[1])));
  assert.deepEqual([...used].sort(), ["opportunity.read", "salesAgreement.read", "salesOrder.read"]);
  // C4 registers the VOCABULARY (migration 023) and nothing else may name a Commercial capability in SQL; no migration grants one.
  // REGISTERED OR GRANTED -- not merely NAMED. Migration 1761350400000's canonical Object <- action
  // backfill names every capability by its own key, which is the opposite of prefix inference and
  // must not read as a registration. The scan therefore looks only inside statements that INSERT a
  // capability or touch a grant table.
  // GRANTS ARE NOW EXPECTED, FROM NAMED MIGRATIONS ONLY. Migrations 1761523200000 and 1761609600000
  // PRESERVE existing authorization decisions into role_capabilities -- the first from stored CRED
  // where the mapping is exact, the second from the governed Role catalog. They register no
  // Commercial capability; they grant ones migration 023 already registered. Registration and
  // granting are therefore scanned separately: registration outside 023 is still forbidden, while
  // granting is allowed only from this explicit list.
  // ONE file, not two. Migration 1761523200000 also preserves Commercial grants, but it derives
  // them by JOINING role_object_permissions to capabilities on object_key -- it never spells a
  // capability key, so a text scan cannot see it and should not pretend to. 1761609600000 lists
  // (Role, capability) pairs literally, which is exactly what this scan is for.
  const PRESERVATION_MIGRATIONS = ["1761609600000_finance-administration-reorder-vocabulary.sql"];
  const registersOrGrants = (sql, table) => sql
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .filter((stmt) => new RegExp(`INSERT\\s+INTO\\s+${table}`, "i").test(stmt))
    .some((stmt) => /'(opportunity|salesAgreement|salesOrder)\.[A-Za-z]+'/.test(stmt));
  const naming = readdirSync(join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql"))
    .filter((f) => registersOrGrants(readFileSync(join(FUNCTIONS_DIR, "migrations", f), "utf8"), "capabilities"));
  assert.deepEqual(naming, ["1759536000000_commercial-capability-vocabulary.sql"], "a Commercial capability was registered or granted outside migration 023");
  const granting = readdirSync(join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql"))
    .filter((f) => registersOrGrants(readFileSync(join(FUNCTIONS_DIR, "migrations", f), "utf8"), "role_capabilities"));
  assert.deepEqual(granting, PRESERVATION_MIGRATIONS, "a Commercial capability was granted outside the named preservation migrations");
  assert.ok(registersOrGrants(readFileSync(join(FUNCTIONS_DIR, "migrations", "1759536000000_commercial-capability-vocabulary.sql"), "utf8"), "capabilities"),
    "the scan stopped recognising migration 023 and would now pass for the wrong reason");
  assert.doesNotMatch(readFileSync(join(FUNCTIONS_DIR, "migrations", naming[0]), "utf8").split("-- Down Migration")[0].replace(/^\s*--.*$/gm, ""), /role_capabilities/, "migration 023 grants a Commercial capability");
});

test("(4) READ-ONLY: no read module contains write SQL, locks, sequence use, or reaches a writer", () => {
  for (const file of readSources()) {
    const code = strip(readFileSync(file, "utf8"));
    for (const forbidden of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+[a-z_]+\.[a-z_]+\s+SET\b/i, /\bUPDATE\s+eos_/i, /\bDELETE\s+FROM\b/i, /\bMERGE\s+INTO\b/i, /\bTRUNCATE\b/i,
      /FOR\s+UPDATE/i, /nextval|setval/i, /pg_advisory/i, /allocateCommercialNumber|commercialNumbering/, /command_receipts/, /commercialRecordStore/,
      /commercialOwnershipRepository|commercialAccountabilityRepository|stageCommercial|transferCommercialOwnership|createCommercialRecord/, /CommandService/, /runCommercialCommand/]) {
      assert.doesNotMatch(code, forbidden, `${rel(file)} contains ${forbidden}`);
    }
    for (const [, spec] of code.matchAll(/from\s+"([^"]+)"/g)) {
      if (spec.startsWith("../commands/")) assert.equal(spec, "../commands/commercialCommandKernel", `${rel(file)} imports ${spec}`);
    }
  }
  assert.match(readFileSync(join(READS, "commercialReadKernel.ts"), "utf8"), /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
});

test("(49) SQL is parameterized: the only interpolations are module constants, and ordering is fixed", () => {
  const ALLOWED = new Set(["SUMMARY_COLUMNS", "OPPORTUNITY_IS_COMPLETE", "SALES_AGREEMENT_IS_COMPLETE", "SALES_ORDER_IS_COMPLETE"]);
  for (const file of readSources()) {
    const code = strip(readFileSync(file, "utf8"));
    for (const [, sql] of code.matchAll(/query(?:<[^>]*>)?\(\s*`([\s\S]*?)`/g)) {
      for (const [, expr] of sql.matchAll(/\$\{([^}]*)\}/g)) assert.ok(ALLOWED.has(expr.trim()), `${rel(file)} interpolates ${expr} into SQL`);
      for (const [, ordering] of sql.matchAll(/ORDER BY ([^\n]*)/g)) assert.doesNotMatch(ordering, /\$/, `${rel(file)} parameterizes an ORDER BY: ${ordering}`);
    }
    for (const [, name, value] of code.matchAll(/const\s+([A-Z_]+)\s*=\s*`([\s\S]*?)`/g)) {
      if (ALLOWED.has(name)) assert.doesNotMatch(value, /\$\{/, `${name} is not a constant`);
    }
    assert.doesNotMatch(code, /query\(\s*[a-zA-Z_]+\s*[+,]/, `${rel(file)} builds a query from a variable`);
  }
});

test("(33) no D2 execution field is named by the read layer", () => {
  for (const file of readSources()) {
    const code = strip(readFileSync(file, "utf8"));
    for (const forbidden of [/allocated_?qty/i, /fulfilled_?qty/i, /billed_?qty/i, /service_?work_?order/i, /reservation/i, /invoice/i, /work_orders|workOrder/, /readiness/i]) {
      assert.doesNotMatch(code, forbidden, `${rel(file)} reaches D2 execution: ${forbidden}`);
    }
  }
});

test("refusals of context, capability and caller input happen before any database connection", async () => {
  const deps = { pool: { connect: () => { throw new Error("the read touched the database before refusing"); } } };
  const refuse = (promise, c) => assert.rejects(promise, (e) => e.code === c);
  await refuse(oppRead.listOpportunities(deps, { ...ACTOR, principalId: "" }), "ACTOR_CONTEXT_REQUIRED");
  await refuse(oppRead.listOpportunities(deps, { ...ACTOR, capabilities: ["opportunity.read"] }), "ACTOR_CONTEXT_REQUIRED");
  await refuse(oppRead.listOpportunities(deps, { ...ACTOR, capabilities: new Set(["opportunity.write"]) }), "CAPABILITY_REQUIRED");
  await refuse(soRead.getSalesOrderDetail(deps, { ...ACTOR, capabilities: new Set(["salesOrder.write", "opportunity.read"]) }, { salesOrderId: "s" }), "CAPABILITY_REQUIRED");
  await refuse(saRead.getSalesAgreementDetail(deps, ACTOR, {}), "RECORD_ID_REQUIRED");
  await refuse(oppRead.listOpportunities(deps, ACTOR, { limit: 1000 }), "PAGE_SIZE_INVALID");
  await refuse(oppRead.listOpportunities(deps, ACTOR, { stage: "WON" }), "FILTER_INVALID");
  await refuse(soRead.listSalesOrders(deps, ACTOR, { cursor: 7 }), "CURSOR_INVALID");
  await refuse(getAccountCommercialProjection(deps, ACTOR, { accountId: "" }), "RECORD_ID_REQUIRED");
});

test("(5) a pool that cannot connect, or a query that fails, yields only READ_FAILED", async () => {
  const raw = Object.assign(new Error("connect ECONNREFUSED 10.0.0.7:5432 for postgres://eos_app:S3cr3t@db.internal:5432/eos_policy"), { code: "ECONNREFUSED" });
  const err = await oppRead.listOpportunities({ pool: { connect: async () => { throw raw; } } }, ACTOR).then(() => null, (e) => e);
  assert.deepEqual([err?.name, err?.code, err?.category, err?.message], ["CommercialCommandError", "READ_FAILED", "FAILED", "the read could not be completed"]);
  assert.ok(!JSON.stringify(err).includes("S3cr3t") && !JSON.stringify(err).includes("10.0.0.7"));
  let released = false;
  const client = { query: async (text) => { if (/FROM eos_commercial/.test(text)) throw Object.assign(new Error('relation "eos_commercial.opportunities" does not exist'), { code: "42P01" }); return { rows: [{ ok: 1 }] }; }, release: () => { released = true; } };
  const failed = await oppRead.listOpportunities({ pool: { connect: async () => client } }, ACTOR).then(() => null, (e) => e);
  assert.deepEqual([failed?.code, failed?.message], ["READ_FAILED", "the read could not be completed"]);
  assert.ok(released, "the client was not released");
});

test("cursors are opaque, family-bound and strict", () => {
  const c = kernel.encodeCommercialCursor("salesOrder", { number: "SO-2026-000010", id: "sor_1" });
  assert.deepEqual(kernel.decodeCommercialCursor("salesOrder", c), { number: "SO-2026-000010", id: "sor_1" });
  assert.equal(kernel.decodeCommercialCursor("salesOrder", undefined), null);
  const bad = (family, raw) => assert.throws(() => kernel.decodeCommercialCursor(family, raw), (e) => e.code === "CURSOR_INVALID");
  bad("opportunity", c);
  bad("salesOrder", "");
  bad("salesOrder", Buffer.from(JSON.stringify({ v: 1, f: "salesOrder", n: "x", id: "y", extra: 1 })).toString("base64url"));
  bad("salesOrder", Buffer.from(JSON.stringify({ v: 2, f: "salesOrder", n: "x", id: "y" })).toString("base64url"));
  bad("salesOrder", "x".repeat(2000));
});

test("Sales Order pricing follows the Firestore reader's governed rule exactly", () => {
  const legacy = require("../lib/salesOrder/salesOrderReadService.js");
  const cases = [[], [2500], [2500, 4000], [2500, null], [null, null], [0]];
  for (const prices of cases) {
    const lines = prices.map((unitPrice, i) => ({ lineId: `line-${i + 1}`, kind: "PART", ref: `p${i}`, orderedQty: 2, ...(unitPrice === null ? {} : { unitPrice }) }));
    const old = legacy.projectSalesOrder("x", { state: "CONFIRMED", lines });
    const next = soRead.salesOrderPricingOf(prices.map((p) => ({ extendedMinor: p === null ? null : p * 2 })));
    assert.deepEqual(next, { pricingState: old.pricingState, totalMinor: old.totalMinor, unpricedLineCount: old.unpricedLineCount }, `prices ${JSON.stringify(prices)}`);
  }
});

test("legacy defects are not reproduced: no name, no client clock, no stored backlink, no salesOrders collection", () => {
  const code = readSources().map((f) => strip(readFileSync(f, "utf8"))).join("\n");
  for (const forbidden of [/\bname:\s*r\.name/, /createdAtMillis|updatedAtMillis/, /"salesOrders"/, /acceptedByUid/, /serviceWorkOrderIds/, /displayName:\s*r\./]) {
    assert.doesNotMatch(code, forbidden);
  }
  const kernelCode = strip(readFileSync(join(READS, "commercialReadKernel.ts"), "utf8"));
  assert.match(kernelCode, /readonly displayName: null/, "a person display name source was introduced");
});
