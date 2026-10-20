// A6 CUSTOMER-BALANCE SUMMARY -- the OFFLINE contracts (Owner decision A6, 2026-10-19; migration 1764680000000). No database.
//
// The Owner's ruling, exactly and nothing beyond it: customer-balance visibility is restored to the eligible operational roles as a SUMMARY -- distinct from invoice detail, individual
// payments, settlement commands and financial policy authority -- inside company isolation and the sales credited-salesperson / team restrictions, with NO new receivable write authority.
//   one new READ capability   finance.accountBalance.read
//   one new operation         readAccountBalanceSummary { crmAccountId } on /operations/finance
//   eight grants              fieldManager, partsAssociate, partsManager, purchasingManager, salesManager, salesperson, shopAssociate, shopManager
// The Postgres half (reach union, company isolation, salesperson self / team, the summary-only shape, the absence of a write path) is a6AccountBalanceSummaryPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const { PERMISSION_CATALOG } = require("../lib/access/permissionCatalog.js");
const finance = require("../lib/eosFinance/financeOperations.js");

const MIGRATION_FILE = "1764680000000_account-balance-summary.sql";
const STAMP = "migration:1764680000000";
const KEY = "finance.accountBalance.read";
const OWNER_ROLES = Object.freeze(["fieldManager", "partsAssociate", "partsManager", "purchasingManager", "salesManager", "salesperson", "shopAssociate", "shopManager"]);
const OWNER_PAIRS = OWNER_ROLES.map((r) => `${r}|${KEY}`);
// The roles that keep their FULL Finance reads and that A6 must not touch, plus the protected pair.
const FINANCE_AND_PROTECTED = Object.freeze(["accountingManager", "controller", "financeManager", "generalManager", "owner", "admin"]);

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const BASELINE = JSON.parse(read(join(FUNCTIONS_DIR, "src", "adminPolicy", "seed", "roleCapabilityAuthorityBaseline.json")));
// A6_MIGRATION_SQL lets the lane review the controller's DRAFT before the file is written into migrations/ (CI never sets it).
const migrationSql = () => read(process.env.A6_MIGRATION_SQL ?? join(FUNCTIONS_DIR, "migrations", MIGRATION_FILE));
const upOf = (sql) => sql.slice(0, sql.indexOf("-- Down Migration")).replace(/^\s*--.*$/gm, "");
const downOf = (sql) => sql.slice(sql.indexOf("-- Down Migration"));
const pairId = (roleKey, key) => `${roleKey}|${key}`;

/** The function body of the operation, from the doc block's function to the next top-level declaration. */
const FINANCE_SRC = read(join(FUNCTIONS_DIR, "src", "eosFinance", "financeOperations.ts"));
const opBody = () => {
  const start = FINANCE_SRC.indexOf("async function readAccountBalanceSummary(");
  const end = FINANCE_SRC.indexOf("const consolidatedRefused", start);
  assert.ok(start > 0 && end > start, "the operation is where the proof expects it");
  return FINANCE_SRC.slice(start, end);
};

test("a. the migration registers ONE READ capability and its VALUES are the Owner's eight pairs exactly", () => {
  const sql = upOf(migrationSql());
  const caps = [...sql.matchAll(/\('cap_[a-z0-9_]+',\s*'([A-Za-z0-9_.]+)',[\s\S]*?'([A-Za-z]+)',\s*'([A-Za-z]+)',\s*'([A-Z_]+)',\s*'([^']+)'\)/g)];
  assert.equal(caps.length, 1, "one capability is registered");
  assert.deepEqual(caps[0].slice(1, 5), [KEY, "payment", "readBalanceSummary", "READ"]);
  const start = sql.indexOf("JOIN (VALUES");
  const end = sql.indexOf(") AS g(role_key, capability_key)");
  assert.ok(start > 0 && end > start, "the migration's VALUES list is where the proof expects it");
  const pairs = [...sql.slice(start, end).matchAll(/\('([A-Za-z]+)',\s*'([A-Za-z0-9_.]+)'\)/g)].map((m) => pairId(m[1], m[2]));
  assert.equal(pairs.length, 8);
  assert.equal(new Set(pairs).size, 8, "no duplicate pair");
  assert.deepEqual([...pairs].sort(), [...OWNER_PAIRS].sort(), "the migration writes exactly the Owner's list -- no other holder, no other key");
  for (const role of FINANCE_AND_PROTECTED) assert.equal(pairs.some((p) => p.startsWith(`${role}|`)), false, `${role} is not granted (it keeps its full Finance read)`);
});

test("a. the migration writes nothing else: no schema, no other table, no other capability; ADMIN_REVOKED is honoured; the stamp is the migration's", () => {
  const sql = migrationSql();
  const up = upOf(sql);
  assert.deepEqual([...up.matchAll(/\b(INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE|CREATE TABLE|CREATE INDEX|DROP)\s+([a-z_.]+)/gi)].map((m) => `${m[1].toUpperCase()} ${m[2]}`),
    ["INSERT INTO capabilities", "INSERT INTO role_capabilities"]);
  assert.match(up, /SET search_path = eos_policy, public;/);
  assert.match(up, /d\.decision = 'ADMIN_REVOKED'/);
  assert.match(up, /r\.key NOT IN \('owner', 'admin'\) OR r\.protected = TRUE/);
  assert.match(up, /ON CONFLICT \(tenant_id, role_id, capability_id\) DO NOTHING/);
  assert.ok(up.includes(`'${STAMP}'`) && up.includes("'rc_a6_'"));
  assert.equal([...up.matchAll(/'migration:(\d+)'/g)].every((m) => m[1] === "1764680000000"), true, "only this migration's stamp");
  const down = downOf(sql);
  assert.match(down, /DELETE FROM eos_policy\.role_capabilities WHERE granted_by = 'migration:1764680000000'/);
  assert.match(down, /DELETE FROM eos_policy\.capabilities WHERE key = 'finance\.accountBalance\.read'/);
  assert.equal((down.match(/RAISE EXCEPTION/g) ?? []).length, 3, "the down refuses on an Administration decision, a direct grant, and a Role grant it did not write");
});

test("b. the baseline carries exactly the eight pairs, each MIGRATION_BACKED and explained by this migration; the totals moved by eight", () => {
  const stamped = BASELINE.grants.filter((g) => g.evidence === STAMP);
  assert.deepEqual(stamped.map((g) => pairId(g.roleKey, g.capabilityKey)).sort(), [...OWNER_PAIRS].sort());
  for (const g of stamped) assert.deepEqual([g.source, g.observedGrantedBy], ["MIGRATION_BACKED", STAMP], pairId(g.roleKey, g.capabilityKey));
  assert.deepEqual(BASELINE.grants.filter((g) => g.capabilityKey === KEY).map((g) => g.roleKey).sort(), [...OWNER_ROLES].sort(), "no other Role holds the key");
  // 729 -> 732 (671 -> 674): the 3 S1c salesOrder.fulfill grants (1764714000000).
  // 689 -> 697 (MIGRATION_BACKED 631 -> 639); then 697 -> 729 (639 -> 671) with the 32 G-1 performance goal authoring grants (1764690000000).
  assert.equal(BASELINE.grants.length, 732);
  assert.equal(BASELINE.totalGrants, 732);
  assert.equal(BASELINE.deployment.rebuildTotal, 732);
  assert.deepEqual(BASELINE.countsBySource, { MIGRATION_BACKED: 674, CANONICAL_CATALOG: 53, NONPROD_ACTIVATION: 5, FIXTURE_ONLY: 0, UNEXPLAINED: 0 });
  assert.ok(BASELINE.grantBearingMigrations.includes(STAMP));
  assert.ok(BASELINE.deployment.notYetAppliedToNonprod.includes(STAMP));
  assert.equal(new Set(BASELINE.grants.map((g) => pairId(g.roleKey, g.capabilityKey))).size, 732, "no duplicate baseline pair");
});

test("b. the evidence file equals the Owner's list and the measured counts", () => {
  const EVIDENCE = JSON.parse(read(join(FUNCTIONS_DIR, "..", "docs", "architecture", "a6-account-balance-summary.json")));
  assert.deepEqual([...EVIDENCE.grants.roles].sort(), [...OWNER_ROLES].sort());
  assert.deepEqual([EVIDENCE.capability.key, EVIDENCE.capability.object, EVIDENCE.capability.action, EVIDENCE.capability.kind], [KEY, "payment", "readBalanceSummary", "READ"]);
  assert.deepEqual(EVIDENCE.grants.migration, { file: `functions/migrations/${MIGRATION_FILE}`, stamp: STAMP, idPrefix: "rc_a6_", capabilitiesRegistered: 1, newGrantsWritten: 8 });
  assert.deepEqual(EVIDENCE.counts, {
    baseline: { before: 689, after: 697, migrationBackedBefore: 631, migrationBackedAfter: 639 },
    capabilities: { before: 194, after: 195 }, migrations: { before: 109, after: 110 }, shellRequestSet: { before: 65, after: 66 },
  });
  assert.equal(EVIDENCE.operation.name, "readAccountBalanceSummary");
});

test("c. the key is PostgreSQL-native (absent from the in-repo catalog) and no write capability travels with it", () => {
  assert.equal(JSON.stringify(PERMISSION_CATALOG).includes(KEY), false, "registered by the migration only, like the other EOS-only keys");
  assert.equal(finance.ACCOUNT_BALANCE_READ_CAPABILITY, KEY);
  // The Owner's list names ONE key. No settlement, reconciliation, policy or invoice key is granted to any of the eight Roles by this change.
  const byRole = (r) => BASELINE.grants.filter((g) => g.roleKey === r && g.evidence === STAMP).map((g) => g.capabilityKey);
  for (const role of OWNER_ROLES) assert.deepEqual(byRole(role), [KEY], role);
});

test("d. the operation exists on the Finance table, is a READ, and is the ONLY consumer of the key", () => {
  assert.equal(typeof finance.EOS_FINANCE_OPERATIONS.readAccountBalanceSummary, "function");
  assert.ok(finance.FINANCE_OPERATIONS.includes("readAccountBalanceSummary"));
  assert.doesNotMatch("readAccountBalanceSummary", /export|csv|download|report/i);
  const total = FINANCE_SRC.split("ACCOUNT_BALANCE_READ_CAPABILITY").length - 1;
  const inOp = opBody().split("ACCOUNT_BALANCE_READ_CAPABILITY").length - 1;
  // the declaration (1) + the header-free uses inside the operation: no other operation, read or command, is opened by the key.
  assert.equal(total, inOp + 1, "the key is consulted by readAccountBalanceSummary and by nothing else");
  assert.ok(inOp >= 2, "the operation checks the key before it reads anything");
});

test("d. the operation is summary-only by construction: it selects five numbers, returns no id and no row, and has no write path", () => {
  const body = opBody();
  const from = body.indexOf("`SELECT x.company");
  const sql = body.slice(from, body.indexOf("params);", from));
  // The select list: company, currency and the four aggregates -- nothing else.
  const outer = sql.slice(0, sql.indexOf("FROM (SELECT"));
  assert.deepEqual([...outer.matchAll(/\bAS ([a-z_]+)/g)].map((m) => m[1]), ["open_count", "outstanding", "overdue_count", "overdue_minor"]);
  assert.match(outer, /SELECT x\.company, x\.currency,/);
  // No identifying column anywhere in the statement, and no table beyond the three it joins.
  assert.ok(sql.includes("FROM (SELECT o.operating_company_id AS company, o.currency, b.outstanding_minor AS outstanding, (${OVERDUE_SQL}) AS overdue\n"), "the inner select list is company, currency, the balance and the overdue flag");
  assert.doesNotMatch(sql, /source_record_id|source_domain|settlement|handoff|billing_package|invoice|payable|funding|intercompany|counterparty_name/i);
  assert.deepEqual([...sql.matchAll(/\bFROM (eos_[a-z]+\.[a-z_]+)|\bJOIN (eos_[a-z]+\.[a-z_]+)/g)].map((m) => m[1] ?? m[2]).sort(),
    ["eos_finance.financial_counterparties", "eos_finance.obligation_balances", "eos_finance.obligations"]);
  // The returned object: status, asOf, restricted and the summaries -- the five numbers and the company/currency they belong to.
  assert.match(body, /summaries: Object\.freeze\(rows\.map\(\(r\) => Object\.freeze\(\{\s*operatingCompanyId: String\(r\.company\), currency: String\(r\.currency\), openReceivableCount: Number\(r\.open_count\), outstandingMinor: String\(r\.outstanding\),\s*overdueCount: Number\(r\.overdue_count\), overdueMinor: String\(r\.overdue_minor\),\s*\}\)\)\)/);
  // Read-only: no write verb, no transaction, no audit write, no call into a command.
  assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE)\b|\bBEGIN\b|recordFinancialSettlement|applyFinancialSettlement|reverseSettlement|voidFinancialSettlement|reconcileFinancialSettlement|openObligation|recordFinancialFact/);
  // Foreign / unreached company: the same empty answer as an account that owes nothing (no refusal that says the account exists).
  assert.match(body, /if \(companies\.length === 0\) return Object\.freeze\(\{ status: "READY", asOf, restricted: false, summaries: Object\.freeze\(\[\]\) \}\);/);
  // The inner reach is the ONE decision every Finance read asks, and the outer limit is the caller's own authority UNION the explicit Finance assignments.
  assert.match(body, /visibilityOver\(deps, caller, companies\)/);
  assert.match(body, /obligationVisibilityClause\(vis, "o", params\)/);
  assert.match(body, /resolveInventoryCompanyAuthority\(deps\.pool, tenantId, caller\.actor\.principalId\)/);
  assert.match(body, /financeCompanyReach\(reachActor\(caller\), ACCOUNT_BALANCE_READ_CAPABILITY\)/);
  // A truncated visible set is UNAVAILABLE, never a confident partial balance.
  assert.match(body, /status: "UNAVAILABLE", reason: "VISIBILITY_TOO_WIDE"/);
});

test("e. the client mirrors the server's table and declares the gate once (shell request set)", async () => {
  const gates = await import(new URL("../../field-ops-app-vite/src/access/shellCapabilityGates.js", import.meta.url));
  assert.deepEqual({ ...gates.ACCOUNT_BALANCE_GATE }, { read: KEY });
  assert.ok(gates.SHELL_GATED_CAPABILITY_IDS.includes(KEY));
  const api = await import(new URL("../../field-ops-app-vite/src/services/financeApiClient.js", import.meta.url));
  assert.ok(api.FINANCE_READ_OPERATIONS.includes("readAccountBalanceSummary"));
  assert.ok(!api.FINANCE_COMMAND_OPERATIONS.includes("readAccountBalanceSummary"));
});
