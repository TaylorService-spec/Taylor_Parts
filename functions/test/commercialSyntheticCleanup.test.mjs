// THE GOVERNED COMMERCIAL SYNTHETIC CLEANUP -- what it may delete, and what it may never delete.
//
// The environment fence (production refused twice, EOS_ENVIRONMENT, the frozen Certification world, --apply,
// --confirmExactIds, and every discover-and-delete option refused by name) is proved BY SUBPROCESS in
// functions/test/operatorScriptEnvironmentFence.test.mjs, because "refused before any client existed" is a claim
// about a whole process's history and cannot be proved by importing a function.
//
// What is proved HERE is the part a fence cannot reach: the identity set itself, the classification rule behind it,
// the precondition decisions, and the absence of any predicate-shaped SQL anywhere in the file.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_PATH = resolve(FUNCTIONS_DIR, "scripts/commercialSyntheticCleanup.js");
const C = require_(SCRIPT_PATH);
const C5 = require_(resolve(FUNCTIONS_DIR, "scripts/commercialC5.js"));
const SOURCE = readFileSync(SCRIPT_PATH, "utf8");
/** The file with every `//` comment line removed, so a static claim is about CODE rather than about prose. */
const CODE = SOURCE.split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");
/**
 * Every statement the tool actually sends -- a string literal that OPENS with a SQL verb, so an ordinary sentence
 * that merely mentions one is not mistaken for a query. A claim about "the SQL" must be about these, not the file.
 */
const SQL = [
  ...(CODE.match(/`\s*(SELECT|DELETE|INSERT|UPDATE|WITH)\b[^`]*`/gi) || []),
  ...(CODE.match(/"\s*(SELECT|DELETE|INSERT|UPDATE|BEGIN|COMMIT|ROLLBACK)\b[^"]*"/gi) || []),
];
/** The DELETEs actually sent. The report's `statement` labels read `DELETE <relation> ... IN (:exactIds)` and are prose. */
const DELETES = SQL.filter((s) => /^.\s*DELETE FROM\b/i.test(s));

// ════════════════════════════ the identity set ════════════════════════════

test("the delete set is EXACTLY the twelve records the Owner authorized, by id and by number", () => {
  assert.equal(C.DELETE_SET.length, 12);
  assert.deepEqual(C.AUTHORIZED_POPULATION, { opportunity: 6, salesAgreement: 3, salesOrder: 3, total: 12 });
  assert.deepEqual(
    C.DELETE_SET.map((r) => `${r.family}|${r.id}|${r.number}`).sort(),
    [
      "opportunity|opp_16ea0f86-3aea-4da4-8017-02dd4b1f12af|SYN-NP-OPP-0002",
      "opportunity|opp_3b79d076-09c1-43bf-86c1-7b3ba4e6bd82|SYN-NP-OPP-0003",
      "opportunity|opp_3d1fdd30-9b0a-4344-983a-3598ca909494|SYN-NP-OPP-0001",
      "opportunity|opp_5880fb7c-55c7-4bc9-8fbe-bde55bfd96e1|SAMPLE-CO-OPP-0005",
      "opportunity|opp_61eeeb83-1518-48b9-b181-65b6174cfe8b|SAMPLE-CO-OPP-0006",
      "opportunity|opp_e481459d-12f2-4dab-8b2b-d574bd7a034e|SYN-NP-OPP-0004",
      "salesAgreement|sag_3f17be2a-d728-473a-b54d-efaba417362b|SYN-NP-SA-0001",
      "salesAgreement|sag_c7e8d9d6-e4b8-4504-82bf-4781b9bf0510|SAMPLE-CO-SA-0003",
      "salesAgreement|sag_faf8952b-c50b-4654-b013-6d8484972e3f|SYN-NP-SA-0002",
      "salesOrder|sor_2d2e1715-9e18-4e50-8d80-776890011440|SAMPLE-CO-SO-0003",
      "salesOrder|sor_aa480123-e315-4b0e-8da4-c73dd90ab9ef|SYN-NP-SO-0002",
      "salesOrder|sor_d86545ba-167e-4dcd-8d70-06a958748cc8|SYN-NP-SO-0001",
    ].sort(),
  );
  assert.equal(C.assertDeleteSetIntegrity().deleteSetSha256, C.deleteSetFingerprint());
});

test("the fingerprint is stable and covers family, id AND number -- editing any of them invalidates a runbook confirmation", () => {
  assert.match(C.deleteSetFingerprint(), /^[0-9a-f]{64}$/);
  assert.equal(C.deleteSetFingerprint(), C.deleteSetFingerprint(), "the fingerprint must not depend on iteration order");
  assert.equal(C.deleteSetFingerprint(), "2fd32bd199605c8c2524f0783ef4e47dfc3c39ec6e142d906620d614613919c0");
});

// ════════════════════════════ classification is by DECLARATION, never by shape ════════════════════════════

test("every id in the delete set is declared-synthetic by a governed fixture manifest", () => {
  const declared = new Set(C5.declaredSyntheticSeedNumbers());
  for (const record of C.DELETE_SET) {
    assert.ok(declared.has(record.number), `${record.number} is not declared by any governed manifest`);
  }
  assert.equal(C.CLASSIFICATION, "SYNTHETIC_NONBUSINESS");
});

test("the manifest union is what makes the four SAMPLE-CO-* fixtures declared rather than unknown", () => {
  const provenance = C5.declaredSyntheticSeedProvenance();
  assert.equal(provenance.length, 12, "the union of both manifests declares exactly twelve Commercial numbers");
  const sampleCo = provenance.filter((p) => p.number.startsWith("SAMPLE-CO-"));
  assert.equal(sampleCo.length, 4);
  for (const p of sampleCo) assert.deepEqual(p.declaredBy, ["SAMPLE_COMPANY_V2"]);
  const v1 = provenance.filter((p) => p.declaredBy.includes("SYNTHETIC_NONPROD_WORKFORCE_SEED"));
  assert.equal(v1.length, 8, "v2 supersedes v1 byte-identically, so the eight v1 numbers are declared twice");
  for (const p of v1) assert.deepEqual(p.declaredBy, ["SYNTHETIC_NONPROD_WORKFORCE_SEED", "SAMPLE_COMPANY_V2"]);
});

test("classification is never inferred from the number's shape", () => {
  // No prefix test in the code, and no pattern matching in any statement the tool sends.
  assert.doesNotMatch(CODE, /startsWith\(\s*["']SYN/i, "a SYN- prefix test would make classification a heuristic");
  assert.doesNotMatch(CODE, /startsWith\(\s*["']SAMPLE/i, "a SAMPLE-CO- prefix test would make classification a heuristic");
  assert.ok(SQL.length > 0, "the SQL extraction must actually find the statements it is asserting about");
  for (const statement of SQL) {
    assert.doesNotMatch(statement, /\bLIKE\b|\bSIMILAR TO\b|~\*?\s*\$/i, `pattern matching in a sent statement: ${statement}`);
  }
});

// ════════════════════════════ no production path, no broad predicate ════════════════════════════

test("the tool contains no production execution path at all", () => {
  // The customer production project is never NAMED in code -- only in the header prose explaining the delegated
  // refusals -- so there is no string this tool could compare against or connect to.
  assert.doesNotMatch(CODE, /taylor-parts(?!-nonprod)/, "the customer production project is never named as anything this tool can reach");
  assert.doesNotMatch(CODE, /firebase-admin|@google-cloud|google-auth-library|firestore/i, "no Firebase or GCP client is reachable from this tool");
  // `confirmProduction` exists only in the refused-by-name list; it is never read as a value.
  assert.doesNotMatch(CODE, /args\.confirmProduction/, "there is no production confirmation this tool can satisfy");
  assert.equal(C.REQUIRED_ENVIRONMENT, "platform-sandbox");
  assert.equal(C.REQUIRED_TENANT_KEY, "taylor-nonprod");
  assert.equal(C.REQUIRED_TENANT_ID, "tenant-6ce59be1-1979-45cd-9d17-a4969037fb25");
});

test("every DELETE is bound to the exact id set; none carries a free predicate", () => {
  assert.equal(DELETES.length, 2, "the tool must contain exactly the two delete statements it documents (child, then family)");
  for (const statement of DELETES) {
    assert.match(statement, /= ANY\(\$\d::text\[\]\)/, `a DELETE without an exact id array: ${statement}`);
    assert.doesNotMatch(statement, /\bLIKE\b|\bOR\b/i, `a DELETE with a widening predicate: ${statement}`);
  }
  // The family delete is additionally tenant-scoped, so it cannot reach another tenant's row even by id collision.
  assert.equal(DELETES.filter((s) => /tenant_id = \$1/.test(s)).length, 1);
  // TRUNCATE, DROP and an unqualified DELETE are absent outright.
  for (const statement of SQL) assert.doesNotMatch(statement, /\bTRUNCATE\b|\bDROP\b/i);
  assert.doesNotMatch(CODE, /DELETE FROM [a-z_.]+\s*`/i, "an unqualified DELETE would remove a whole relation");
});

test("the fence refuses every way of widening or skipping the set", () => {
  const env = { EOS_ENVIRONMENT: "nonprod", DB: "postgres://fence:fence@127.0.0.1:1/never" };
  const base = {
    environment: "platform-sandbox", databaseUrlEnv: "DB", tenantKey: "taylor-nonprod",
    nonprodDataMutationAuthorized: "true", performedBy: "op",
  };
  assert.doesNotThrow(() => C.assertCleanupInvocation({ ...base }, env), "the documented plan invocation must be accepted");
  for (const option of ["all", "discover", "where", "prefix", "like", "pattern", "ids", "id", "number", "numbers", "family", "limit", "cascade", "truncate"]) {
    assert.throws(() => C.assertCleanupInvocation({ ...base, [option]: "x" }, env), /ARGUMENT_INVALID/, `--${option} must be refused`);
  }
  for (const option of ["force", "yes", "skipPreflight", "ignoreDependents", "allowDrift"]) {
    assert.throws(() => C.assertCleanupInvocation({ ...base, [option]: "true" }, env), /not a guard/, `--${option} must be refused`);
  }
  // plan is the default, and it is not a writing mode.
  assert.equal(C.assertCleanupInvocation({ ...base }, env).mode, "plan");
  assert.equal(C.assertCleanupInvocation({ ...base }, env).apply, false);
  assert.equal(C.assertCleanupInvocation({ ...base, mode: "apply", apply: "true", confirmExactIds: C.deleteSetFingerprint() }, env).apply, true);
});

// ════════════════════════════ FK order, measured rather than recited ════════════════════════════

test("the delete order puts every measured child relation before its parents", () => {
  assert.deepEqual(C.FAMILY_DELETE_ORDER, ["salesOrder", "salesAgreement", "opportunity"]);
  // The five child relations the nonprod schema actually declares, beyond the three families themselves.
  assert.deepEqual(
    [...new Set(C.CHILD_DELETE_ORDER.map((c) => c.relation))].sort(),
    ["eos_commercial.accountability_handoffs", "eos_commercial.opportunity_lines", "eos_commercial.sales_agreement_lines", "eos_commercial.sales_order_lines"],
  );
  // ownership_handoffs is APPEND-ONLY: measured, never deleted from.
  const ownership = C.DEPENDENTS.filter((d) => d.relation === "eos_commercial.ownership_handoffs");
  assert.equal(ownership.length, 3, "all three ownership_handoffs columns are measured");
  for (const d of ownership) {
    assert.equal(d.appendOnly, true);
    assert.equal(d.deletedHere, false, "refuse_ownership_history_mutation raises on DELETE; this tool never attempts it");
  }
  assert.ok(!C.CHILD_DELETE_ORDER.some((c) => c.relation === "eos_commercial.ownership_handoffs"));
});

test("references no foreign key enforces are measured too -- they are the ones that would silently dangle", () => {
  const unenforced = C.DEPENDENTS.filter((d) => !d.fkBacked).map((d) => `${d.relation}.${d.column}`).sort();
  assert.deepEqual(unenforced, [
    "eos_commercial.command_receipts.target_id",
    "eos_finance.invoice_totals.sales_order_id",
    "eos_finance.invoices.sales_order_id",
    "eos_ops.work_order_sales_order_lines.sales_order_id",
    "eos_ops.work_orders.sales_order_id",
  ]);
});

// ════════════════════════════ the precondition decision ════════════════════════════

const familiesOf = (rows) => ({
  opportunity: { tenantRows: rows.filter((r) => r.id.startsWith("opp_")), instanceTotal: rows.filter((r) => r.id.startsWith("opp_")).length },
  salesAgreement: { tenantRows: rows.filter((r) => r.id.startsWith("sag_")), instanceTotal: rows.filter((r) => r.id.startsWith("sag_")).length },
  salesOrder: { tenantRows: rows.filter((r) => r.id.startsWith("sor_")), instanceTotal: rows.filter((r) => r.id.startsWith("sor_")).length },
});
const exactRows = () => C.DELETE_SET.map((r) => ({ id: r.id, number: r.number }));
const zeroDependents = () => C.DEPENDENTS.map((d) => ({ relation: d.relation, column: d.column, fkBacked: d.fkBacked, appendOnly: d.appendOnly === true, inbound: 0 }));
const agreeingFks = () => ({
  constraints: [...new Set(C.DEPENDENTS.filter((d) => d.fkBacked).map((d) => d.relation))].map((child) => ({ child, constraint: `${child}_fkey`, definition: "FOREIGN KEY (x) REFERENCES y(z)" })),
  cascading: [], missing: [], unencoded: [], agrees: true,
});

test("the exact expected state passes every precondition", () => {
  assert.deepEqual(C.decidePreconditions(familiesOf(exactRows()), zeroDependents(), agreeingFks()), []);
});

test("a thirteenth record in the tenant STOPS the cleanup -- it is never deleted around", () => {
  const rows = [...exactRows(), { id: "opp_real-customer-deal", number: "OPP-2026-0042" }];
  const findings = C.decidePreconditions(familiesOf(rows), zeroDependents(), agreeingFks());
  assert.ok(findings.some((f) => f.code === "TENANT_HOLDS_A_RECORD_OUTSIDE_THE_REVIEWED_SET"));
  assert.ok(!findings.some((f) => JSON.stringify(f).includes("deleted")), "an unreviewed row is reported, never removed");
});

test("a reviewed record that is absent, or carries a different number, STOPS the cleanup", () => {
  const missing = exactRows().filter((r) => r.number !== "SYN-NP-SO-0001");
  assert.ok(C.decidePreconditions(familiesOf(missing), zeroDependents(), agreeingFks()).some((f) => f.code === "REVIEWED_RECORD_ABSENT"));

  const renumbered = exactRows().map((r) => (r.number === "SYN-NP-OPP-0001" ? { ...r, number: "OPP-2026-0001" } : r));
  const findings = C.decidePreconditions(familiesOf(renumbered), zeroDependents(), agreeingFks());
  assert.ok(findings.some((f) => f.code === "NUMBER_DIFFERS_FROM_REVIEWED_SET"));
  assert.ok(findings.some((f) => f.code === "EXACT_SET_NOT_CONFIRMED"));
});

test("any inbound reference STOPS the cleanup, and append-only history says so by name", () => {
  const withWorkOrder = zeroDependents().map((d) => (d.relation === "eos_ops.work_orders" ? { ...d, inbound: 1 } : d));
  const findings = C.decidePreconditions(familiesOf(exactRows()), withWorkOrder, agreeingFks());
  assert.deepEqual(findings.map((f) => f.code), ["UNEXPECTED_DEPENDENT_ROWS"]);

  const withHistory = zeroDependents().map((d) => (d.relation === "eos_commercial.ownership_handoffs" && d.column === "sales_order_id" ? { ...d, inbound: 2 } : d));
  const historyFindings = C.decidePreconditions(familiesOf(exactRows()), withHistory, agreeingFks());
  assert.deepEqual(historyFindings.map((f) => f.code), ["APPEND_ONLY_HISTORY_REFERENCES_THE_SET"]);
});

test("a schema whose FK graph no longer matches the encoded order STOPS the cleanup", () => {
  const drifted = { ...agreeingFks(), missing: ["eos_commercial.sales_order_lines"], agrees: false };
  assert.ok(C.decidePreconditions(familiesOf(exactRows()), zeroDependents(), drifted).some((f) => f.code === "FK_GRAPH_DIFFERS_FROM_THE_ENCODED_ORDER"));

  const newChild = { ...agreeingFks(), unencoded: ["eos_commercial.sales_order_commissions"], agrees: false };
  assert.ok(C.decidePreconditions(familiesOf(exactRows()), zeroDependents(), newChild).some((f) => f.code === "FK_GRAPH_DIFFERS_FROM_THE_ENCODED_ORDER"));

  const cascading = { ...agreeingFks(), cascading: [{ child: "eos_commercial.sales_order_lines", constraint: "sol_cascade", definition: "... ON DELETE CASCADE" }] };
  assert.ok(C.decidePreconditions(familiesOf(exactRows()), zeroDependents(), cascading).some((f) => f.code === "CASCADING_FOREIGN_KEY_PRESENT"),
    "a cascade would remove rows this tool never counted");
});

test("a record of these families in another tenant STOPS the cleanup", () => {
  const families = familiesOf(exactRows());
  families.opportunity.instanceTotal += 1;
  assert.ok(C.decidePreconditions(families, zeroDependents(), agreeingFks()).some((f) => f.code === "RECORDS_EXIST_OUTSIDE_THE_AUTHORIZED_TENANT"));
});

// ════════════════════════════ the fingerprints ════════════════════════════

test("the state fingerprint changes when the state changes, and is empty-stable afterwards", () => {
  const before = C.fingerprintState(familiesOf(exactRows()), zeroDependents());
  const after = C.fingerprintState(familiesOf([]), zeroDependents());
  assert.match(before, /^[0-9a-f]{64}$/);
  assert.notEqual(before, after);
  assert.equal(after, C.fingerprintState(familiesOf([]), zeroDependents()));
});

// ════════════════════════════ the transaction ════════════════════════════

test("plan opens a READ ONLY transaction; apply takes the SAME advisory lock key C5 copy takes", () => {
  assert.match(CODE, /BEGIN READ ONLY/, "the database itself must refuse a write in plan mode");
  assert.match(CODE, /pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)/);
  const c5Source = readFileSync(resolve(FUNCTIONS_DIR, "src/commercialMigration/commercialC5Target.ts"), "utf8");
  assert.match(c5Source, /`commercial-c5\|\$\{tenantId\}`/, "the C5 copy's lock key is the one this tool must share");
  assert.match(CODE, /`commercial-c5\|\$\{REQUIRED_TENANT_ID\}`/, "a cleanup and a C5 copy must not interleave");
});

test("every failure path rolls back, and nothing is committed before the post-state is re-measured", () => {
  assert.match(CODE, /await client\.query\("ROLLBACK"\)/);
  const commitAt = CODE.indexOf('await client.query("COMMIT")');
  const postAt = CODE.indexOf("const after = await measureCommercial");
  assert.ok(postAt > 0 && commitAt > postAt, "the post-fingerprint must be measured before the COMMIT, never after it");
});

test("no connection string, host, password or Render identifier is ever printed", () => {
  assert.doesNotMatch(SOURCE, /postgres(ql)?:\/\//, "no connection string literal");
  assert.doesNotMatch(SOURCE, /dpg-[a-z0-9]/i, "no Render database identifier");
  assert.doesNotMatch(CODE, /console\.log\([^)]*connectionString/);
});
