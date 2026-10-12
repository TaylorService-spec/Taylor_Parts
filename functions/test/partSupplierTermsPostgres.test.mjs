// SUP-1: GOVERNED PART-SUPPLIER TERMS over the real /operations/inventory transport and a real PostgreSQL.
//
// Firebase retirement F2 removed createPartSupplierItem / updatePartSupplierItem / changePartSupplierItemStatus /
// setPreferredSupplier and left only a repository behind them. This suite proves the governed replacement
// (functions/src/eosOps/partSupplierTerms.ts): NARROW record keys (DECISIONS #230: inventory.supplierTerms.read / .create /
// .edit / .changeStatus -- never inventory.catalog.manage / .activate), the Firebase term rules ported, optimistic
// concurrency, replay, the one-preferred invariant, tenant isolation, and ONE audit row per successful write -- none on a
// refusal. No Firebase.
//
// GOVERNED FIELD GROUPS (Owner field-permission directive 2026-10-11): the COMMERCIAL group (cost, currency, contract
// window) is governed by inventory.catalog.cost.read (+ inventory.catalog.read, r1, + the record doorway) / .cost.create /
// .cost.edit, held
// through REAL Roles and REAL role_capabilities rows, resolved by the REAL operational resolver. The role matrix below
// proves projection on every surface, unauthorized-write refusal, the additive multi-Role union, no equality oracle,
// audit protection (append-only intact), tenant isolation, that broad catalog.manage / .activate no longer reach supplier
// terms, the Protected Administrator reading operational terms but NOT inferring cost or any write, and that
// registration granted nothing.
// Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { partSupplierTermsDatabase } from "./support/partSupplierTermsFixture.mjs";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const terms = require("../lib/eosOps/partSupplierTerms.js");
const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const MANAGE = "inventory.catalog.manage"; // broad catalog maintenance: must NOT reach supplier terms (#230)
const ACTIVATE = "inventory.catalog.activate";
const READ = "inventory.supplierTerms.read";
const CREATE = "inventory.supplierTerms.create";
const EDIT = "inventory.supplierTerms.edit";
const STATUS = "inventory.supplierTerms.changeStatus";
const RECORD_KEYS = [READ, CREATE, EDIT, STATUS];
const CATALOG_READ = "inventory.catalog.read";
const COST_READ = "inventory.catalog.cost.read";
const COST_CREATE = "inventory.catalog.cost.create";
const COST_EDIT = "inventory.catalog.cost.edit";
const COST_KEYS = [COST_READ, COST_CREATE, COST_EDIT];
const ALL_SEVEN = [...RECORD_KEYS, ...COST_KEYS];
/** The PROPOSED Purchasing bundle (docs/architecture/governed-field-groups.md) -- proposed, not granted anywhere. */
const PURCHASING_BUNDLE = [...RECORD_KEYS, CATALOG_READ, ...COST_KEYS];
const COMMERCIAL = ["cost", "currency", "contractStart", "contractEnd"];
const WITHHELD_COMMERCIAL = { group: "COMMERCIAL", fields: COMMERCIAL, requires: [READ, CATALOG_READ, COST_READ] };

// Distinctive commercial values, so "no audit row / no refusal ever carries one" is a meaningful text search. Every value
// the suite ever stores in a COMMERCIAL field is listed here (both spellings of each decimal).
const VALUES = {
  arcticCost: "4321.1234", arcticCost2: "4567.8912", coldCost: "777.7701", deltaCost: "888.8802", blindCost: "5555.4444",
  currency: "CHF", currency2: "JPY", start: "2031-03-03", end: "2031-11-29", start2: "2032-02-02", end2: "2032-12-12",
};
const COMMERCIAL_TEXT = Object.values(VALUES);

/** Does this JSON-able value carry any stored COMMERCIAL value anywhere? */
const carriesCommercialValue = (value) => {
  const text = JSON.stringify(value);
  return COMMERCIAL_TEXT.filter((v) => text.includes(v));
};
const assertNoCommercialKeys = (item, what) => {
  for (const k of COMMERCIAL) assert.equal(Object.prototype.hasOwnProperty.call(item, k), false, `${what}: ${k} is ABSENT, not null`);
  assert.deepEqual(item.withheld, [WITHHELD_COMMERCIAL], `${what}: the withheld marker names the group and its keys`);
  assert.deepEqual(carriesCommercialValue(item), [], `${what}: no commercial value anywhere`);
};

test("authority is the NARROW record keys -- no dependency on inventory.catalog.manage / .activate -- and no Firebase", () => {
  assert.deepEqual([terms.SUPPLIER_TERMS_READ_CAPABILITY, terms.SUPPLIER_TERMS_CREATE_CAPABILITY, terms.SUPPLIER_TERMS_EDIT_CAPABILITY,
    terms.SUPPLIER_TERMS_STATUS_CAPABILITY], RECORD_KEYS);
  assert.equal(terms.PART_SUPPLIER_TERMS_MANAGE_CAPABILITY, undefined, "the broad manage gate is gone");
  assert.equal(terms.PART_SUPPLIER_TERMS_STATUS_CAPABILITY, undefined, "the broad activate gate is gone");
  const src = readFileSync(new URL("../src/eosOps/partSupplierTerms.ts", import.meta.url), "utf8");
  const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(/inventory\.catalog\.(manage|activate)/.test(code), false, "no code path names catalog.manage or catalog.activate");
  assert.equal(/from ["'][^"']*firebase/i.test(src), false);
  // The ported term keys are exactly the retired Firebase TERM_KEYS (partSupplierItems.ts before 322db5b5).
  assert.deepEqual([...terms.PART_SUPPLIER_TERM_KEYS].sort(), ["availability", "contractEnd", "contractStart", "conversionToStockingUnit", "cost",
    "currency", "lastVerifiedAt", "leadTimeDays", "minOrderQty", "orderMultiple", "purchaseUnit", "supplierSku"]);
  assert.equal(terms.canonicalDecimal("012.5000"), "12.5");
  assert.equal(terms.canonicalDecimal("10.0000"), "10");
  assert.equal(terms.canonicalDecimal("0.0000"), "0");
});

test("the field groups: generic evaluator, registered keys, no persona or title anywhere in the command", () => {
  const def = terms.PART_SUPPLIER_TERMS_FIELD_GROUPS;
  assert.equal(def.objectKey, "supplierCatalogItem");
  assert.deepEqual({ ...def.record }, { read: READ, create: CREATE, edit: EDIT, changeStatus: STATUS }, "the record doorway");
  assert.deepEqual(def.groups.map((g) => [g.key, g.read, g.create, g.edit, g.sensitive]), [
    ["RELATIONSHIP", READ, CREATE, EDIT, false],
    ["OPERATIONAL", READ, CREATE, EDIT, false],
    ["COMMERCIAL", [READ, CATALOG_READ, COST_READ], COST_CREATE, COST_EDIT, true],
  ]);
  assert.deepEqual([...def.groups[2].fields], COMMERCIAL);
  // Every term key is governed by exactly one group (the evaluator refuses an ungoverned key).
  for (const k of terms.PART_SUPPLIER_TERM_KEYS) assert.equal(def.groups.filter((g) => g.fields.includes(k)).length, 1, k);
  const code = readFileSync(new URL("../src/eosOps/partSupplierTerms.ts", import.meta.url), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const word of [/\bowner\b/i, /generalManager/i, /\badmin\b/, /roleKey/, /jobRole/i, /persona/i]) {
    assert.equal(word.test(code), false, `${word} does not decide anything in the command`);
  }
});

test("part-supplier terms over the governed path", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, makeActor, part, supplier, call } = await partSupplierTermsDatabase(t, { urlBase: URL_BASE, prefix: "sup1_terms" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const refusals = []; // every refusal body the suite sees -- none may echo a stored commercial value
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`); return r.body.result; };
  const refused = (r, status, category, message, what = "") => {
    refusals.push(r.body);
    assert.deepEqual([r.status, r.body.code], [status, category], `${what} ${JSON.stringify(r.body)}`);
    if (message) assert.match(r.body.message, message, what);
  };
  const fieldGroupRefused = (r, group, requires, what) => {
    refused(r, 403, "FORBIDDEN", /^FIELD_GROUP_FORBIDDEN: /, what);
    assert.deepEqual([r.body.details.refusal, r.body.details.objectKey, r.body.details.group, r.body.details.requires],
      ["FIELD_GROUP_FORBIDDEN", "supplierCatalogItem", group, requires], what);
  };
  const audits = async (itemId) => (await q(
    `SELECT action, actor_uid, before, after, reason FROM eos_policy.audit_events WHERE tenant_id = 't1' AND target_kind = 'part_supplier_item' AND target_id = $1 ORDER BY occurred_at, id`,
    [itemId])).rows;
  const auditCount = async () => (await one(`SELECT count(*)::int AS n FROM eos_policy.audit_events WHERE target_kind = 'part_supplier_item'`)).n;
  const versionOf = async (itemId, tenant = "t1") => (await one(`SELECT version FROM eos_ops.supplier_catalog_items WHERE tenant_id=$1 AND item_id=$2`, [tenant, itemId])).version;
  const storedCost = async (itemId) => (await one(`SELECT cost::text AS cost FROM eos_ops.supplier_catalog_items WHERE tenant_id='t1' AND item_id=$1`, [itemId])).cost;

  // The people, each holding ONLY registered capabilities through real Roles:
  //   reader         supplierTerms.read                                (a)   relationship + operational read, no write
  //   manager        read + create + edit                              (i)   maintains terms, never commercial
  //   costReader     read + create + edit + catalog.read + cost.read   (ii)  sees commercial, cannot write it
  //   blindWriter    read + create + edit + cost.create + cost.edit    (iii)/(d) writes commercial without seeing it
  //   buyer          the PROPOSED Purchasing bundle                    (iv)/(c) everything
  //   costNoCatalog  read + cost.read (no catalog.read)                r1: the cost projection requires BOTH
  //   unionEmployee  Role A (read + edit) AND Role B (catalog.read + cost.read)   (b) the additive multi-Role union
  //   administrator  read + edit + changeStatus; activatorOnly changeStatus; editorOnly edit (review N2); member catalog.read; outsider no membership;
  //   legacyCatalog  inventory.catalog.manage + .activate + catalog.read  (f) broad catalog authority: REFUSED here
  //   otherTenant    EVERY key, in tenant t2                           (g)
  const reader = await makeActor("t1", "fb-sup1-reader", [READ]);
  const manager = await makeActor("t1", "fb-sup1-manager", [READ, CREATE, EDIT]);
  const costReader = await makeActor("t1", "fb-sup1-cost-reader", [READ, CREATE, EDIT, CATALOG_READ, COST_READ]);
  const blindWriter = await makeActor("t1", "fb-sup1-blind-writer", [READ, CREATE, EDIT, COST_CREATE, COST_EDIT]);
  const buyer = await makeActor("t1", "fb-sup1-buyer", PURCHASING_BUNDLE);
  const costNoCatalog = await makeActor("t1", "fb-sup1-cost-no-catalog", [READ, COST_READ]);
  const unionEmployee = await makeActor("t1", "fb-sup1-union", [[READ, EDIT], [CATALOG_READ, COST_READ]]);
  const administrator = await makeActor("t1", "fb-sup1-admin", [READ, EDIT, STATUS]);
  const activatorOnly = await makeActor("t1", "fb-sup1-activator", [STATUS]);
  const editorOnly = await makeActor("t1", "fb-sup1-editor-only", [EDIT]);
  const member = await makeActor("t1", "fb-sup1-member", [CATALOG_READ]);
  const legacyCatalog = await makeActor("t1", "fb-sup1-legacy-catalog", [MANAGE, ACTIVATE, CATALOG_READ]);
  const outsider = await makeActor("t1", "fb-sup1-outsider", [], { member: false });
  const otherTenant = await makeActor("t2", "fb-sup1-t2-buyer", [MANAGE, ACTIVATE, CATALOG_READ, ...ALL_SEVEN]);

  await part("t1", "P-100", "EACH");
  await part("t1", "P-200", "EACH");
  await part("t1", "P-GAL", "GALLON");
  await part("t2", "P-T2", "EACH");
  await supplier("t1", "sup-arctic", "Arctic Parts Supply");
  await supplier("t1", "sup-cold", "ColdChain Components");
  await supplier("t1", "sup-delta", "Delta Wholesale");
  await supplier("t1", "sup-gone", "Gone Vendor", "INACTIVE");
  await supplier("t2", "sup-arctic", "Arctic (other tenant)");

  const ARCTIC = { partId: "P-100", supplierId: "sup-arctic", supplierSku: "ARC-100", cost: VALUES.arcticCost, currency: VALUES.currency, leadTimeDays: 7,
    minOrderQty: "10", orderMultiple: "5", purchaseUnit: "BOX", conversionToStockingUnit: { numerator: 12, denominator: 1 },
    contractStart: VALUES.start, contractEnd: VALUES.end, availability: "AVAILABLE" };

  await t.test("list: an empty Part answers an empty list; supplierOptions only for a caller who may CREATE terms", async () => {
    const r = ok(await call(buyer, "listPartSupplierItems", { partId: "P-100" }), "list");
    assert.deepEqual(r.items, []);
    assert.equal(r.stockingUnit, "EACH");
    assert.deepEqual(r.fieldAccess, { RELATIONSHIP: { read: true, create: true, edit: true }, OPERATIONAL: { read: true, create: true, edit: true },
      COMMERCIAL: { read: true, create: true, edit: true } });
    assert.deepEqual(r.recordAccess, { read: true, create: true, edit: true, changeStatus: true });
    assert.deepEqual(r.supplierOptions, [{ supplierId: "sup-arctic", name: "Arctic Parts Supply" }, { supplierId: "sup-cold", name: "ColdChain Components" },
      { supplierId: "sup-delta", name: "Delta Wholesale" }], "the INACTIVE supplier is not offered");
    const m = ok(await call(manager, "listPartSupplierItems", { partId: "P-100" }), "manager list");
    assert.equal(m.supplierOptions, null, "supplierTerms.create without cost.create cannot create terms, so no supplier directory");
    assert.deepEqual(m.supplierOptionsWithheld.requires, [CREATE, COST_CREATE]);
    assert.deepEqual(m.recordAccess, { read: true, create: true, edit: true, changeStatus: false });
    assert.deepEqual(m.fieldAccess.COMMERCIAL, { read: false, create: false, edit: false });
    refused(await call(buyer, "listPartSupplierItems", { partId: "P-NOPE" }), 404, "NOT_FOUND", /no part/);
    refused(await call(buyer, "listPartSupplierItems", { partId: "P-100", extra: 1 }), 400, "INVALID_INPUT", /does not accept: extra/);
  });

  await t.test("create: stored, never preferred, audited once with no before; COMMERCIAL values never in the audit row", async () => {
    const before = await auditCount();
    const r = ok(await call(buyer, "createPartSupplierItem", ARCTIC), "create");
    assert.equal(r.outcome, "created");
    assert.deepEqual(r.item, {
      itemId: "P-100__sup-arctic", partId: "P-100", supplierId: "sup-arctic", supplierName: "Arctic Parts Supply", supplierStatus: "ACTIVE",
      supplierSku: "ARC-100", cost: VALUES.arcticCost, currency: VALUES.currency, leadTimeDays: 7, minOrderQty: "10", orderMultiple: "5", purchaseUnit: "BOX",
      conversionToStockingUnit: { numerator: 12, denominator: 1 }, contractStart: VALUES.start, contractEnd: VALUES.end,
      availability: "AVAILABLE", lastVerifiedAt: null, preferred: false, status: "ACTIVE", version: 1, withheld: [],
    });
    const rows = await audits("P-100__sup-arctic");
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].action, rows[0].actor_uid, rows[0].before], ["partSupplierItem.create", buyer.principalId, null]);
    assert.equal(rows[0].after.supplierSku, "ARC-100", "the audit still says what happened");
    for (const k of COMMERCIAL) assert.deepEqual(rows[0].after[k], { withheld: true }, `audit after.${k}`);
    assert.deepEqual(rows[0].after.sensitiveFieldsWithheld, ["contractEnd", "contractStart", "cost", "currency"]);
    assert.match(rows[0].reason, /cost & contract terms set: contractEnd, contractStart, cost, currency/);
    assert.notEqual(rows[0].actor_uid, buyer.subject, "never the Firebase uid");
    const stored = await one(`SELECT created_by, updated_by FROM eos_ops.supplier_catalog_items WHERE tenant_id='t1' AND item_id='P-100__sup-arctic'`);
    assert.deepEqual([stored.created_by, stored.updated_by], [buyer.principalId, buyer.principalId]);
    assert.equal(await auditCount(), before + 1);
  });

  await t.test("replay: the identical create (decimals spelled differently) is REPLAYED for a COMMERCIAL reader and writes nothing", async () => {
    const before = await auditCount();
    const r = ok(await call(buyer, "createPartSupplierItem", { ...ARCTIC, cost: `${VALUES.arcticCost}` }), "replay");
    assert.deepEqual([r.outcome, r.item.version], ["replayed", 1]);
    refused(await call(buyer, "createPartSupplierItem", { ...ARCTIC, supplierSku: "ARC-OTHER" }), 409, "CONFLICT", /different terms/, "one item per (part, supplier)");
    assert.equal(await auditCount(), before, "a replay and a refusal write no audit row");
  });

  await t.test("create refusals: unknown part, unknown or INACTIVE supplier, and every Firebase term rule", async () => {
    const before = await auditCount();
    const base = { partId: "P-100", supplierId: "sup-cold", supplierSku: "CC-1", cost: "3", currency: "USD", leadTimeDays: 2 };
    refused(await call(buyer, "createPartSupplierItem", { ...base, partId: "P-NOPE" }), 404, "NOT_FOUND", /no part/);
    refused(await call(buyer, "createPartSupplierItem", { ...base, supplierId: "sup-nope" }), 404, "NOT_FOUND", /no supplier/);
    refused(await call(buyer, "createPartSupplierItem", { ...base, supplierId: "sup-gone" }), 412, "PRECONDITION_FAILED", /not ACTIVE/);
    const invalid = [
      [{ supplierSku: undefined }, /supplierSku is required/], [{ supplierSku: "  " }, /supplierSku/], [{ supplierSku: "x".repeat(121) }, /max 120/],
      [{ cost: undefined }, /cost is required/], [{ cost: 3 }, /decimal string/], [{ cost: "1.23456" }, /max 4 dp/], [{ cost: "-1" }, /decimal/],
      [{ cost: "1234567890123456" }, /15 integer digits/],
      [{ currency: "usd" }, /3 uppercase/], [{ currency: "USDX" }, /3 uppercase/],
      [{ leadTimeDays: -1 }, /0\.\.3650/], [{ leadTimeDays: 3651 }, /0\.\.3650/], [{ leadTimeDays: 1.5 }, /integer/], [{ leadTimeDays: "7" }, /integer/],
      [{ minOrderQty: "0" }, /positive decimal/], [{ orderMultiple: "-2" }, /positive decimal/], [{ minOrderQty: null }, /omitted, not null/],
      [{ purchaseUnit: "CRATE", conversionToStockingUnit: { numerator: 1, denominator: 1 } }, /known unit code/],
      [{ purchaseUnit: "BOX" }, /requires conversionToStockingUnit/],
      [{ purchaseUnit: "BOX", conversionToStockingUnit: { numerator: 0, denominator: 1 } }, /positive integer ratio/],
      [{ purchaseUnit: "BOX", conversionToStockingUnit: { numerator: 1.5, denominator: 1 } }, /positive integer ratio/],
      [{ purchaseUnit: "GALLON", conversionToStockingUnit: { numerator: 1, denominator: 1 } }, /not in the family/],
      [{ contractStart: "2026/01/01" }, /YYYY-MM-DD/], [{ contractEnd: "2026-02-30" }, /YYYY-MM-DD/],
      [{ contractStart: "2026-06-01", contractEnd: "2026-05-31" }, /must not precede/],
      [{ availability: "MAYBE" }, /AVAILABLE\/UNAVAILABLE\/UNKNOWN/],
      [{ lastVerifiedAt: "yesterday" }, /UTC instant/],
      [{ preferred: true }, /does not accept: preferred/], [{ status: "INACTIVE" }, /does not accept: status/],
    ];
    for (const [patch, message] of invalid) {
      const input = { ...base, ...patch };
      for (const k of Object.keys(patch)) if (patch[k] === undefined) delete input[k];
      refused(await call(buyer, "createPartSupplierItem", input), 400, "INVALID_INPUT", message, JSON.stringify(patch));
    }
    assert.equal(await auditCount(), before, "no refusal is audited");
    assert.equal((await one(`SELECT count(*)::int AS n FROM eos_ops.supplier_catalog_items WHERE supplier_id='sup-cold'`)).n, 0, "and none wrote");
  });

  await t.test("update: term fields only, optimistic concurrency, NO_CHANGES, replay, clear-with-null, merged contract window", async () => {
    const before = await auditCount();
    const u = ok(await call(buyer, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: 1,
      changes: { cost: VALUES.arcticCost2, leadTimeDays: 10, minOrderQty: null } }), "update");
    assert.deepEqual([u.outcome, u.item.cost, u.item.leadTimeDays, u.item.minOrderQty, u.item.version], ["updated", VALUES.arcticCost2, 10, null, 2]);
    // The same request again: already applied -> replayed, nothing written (the caller can read COMMERCIAL).
    assert.equal(ok(await call(buyer, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: 1,
      changes: { cost: VALUES.arcticCost2, leadTimeDays: 10, minOrderQty: null } }), "replay").outcome, "replayed");
    refused(await call(buyer, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: 1, changes: { supplierSku: "ARC-NEW" } }),
      409, "CONFLICT", /changed since/, "stale version");
    refused(await call(buyer, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: 2, changes: { cost: `0${VALUES.arcticCost2}` } }),
      412, "PRECONDITION_FAILED", /already the stored/, "NO_CHANGES");
    refused(await call(buyer, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: 2, changes: {} }), 412, "PRECONDITION_FAILED", /at least one/);
    for (const field of ["partId", "supplierId", "status", "preferred"]) {
      refused(await call(buyer, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: 2, changes: { [field]: "x" } }),
        400, "INVALID_INPUT", new RegExp(`does not accept: ${field}`), `${field} is not updatable`);
    }
    refused(await call(buyer, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: 2, changes: { contractStart: "2033-01-01" } }),
      400, "INVALID_INPUT", /must not precede/, "the window is checked against the merged record (for a caller who can see it)");
    refused(await call(buyer, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: 2, changes: { supplierSku: null } }),
      400, "INVALID_INPUT", /cannot be cleared/);
    refused(await call(buyer, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: 2,
      changes: { purchaseUnit: "FOOT", conversionToStockingUnit: { numerator: 1, denominator: 1 } } }), 400, "INVALID_INPUT", /not in the family/);
    refused(await call(buyer, "updatePartSupplierItem", { itemId: "P-100__sup-nope", expectedVersion: 1, changes: { cost: "1" } }), 404, "NOT_FOUND");
    const cleared = ok(await call(buyer, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: 2,
      changes: { purchaseUnit: null, conversionToStockingUnit: null, lastVerifiedAt: "2026-10-01T12:00:00Z" } }), "clear conversion");
    assert.deepEqual([cleared.item.purchaseUnit, cleared.item.conversionToStockingUnit, cleared.item.lastVerifiedAt, cleared.item.version],
      [null, null, "2026-10-01T12:00:00Z", 3]);
    const rows = (await audits("P-100__sup-arctic")).filter((a) => a.action === "partSupplierItem.update");
    assert.equal(rows.length, 2, "one row per applied update; none for replay or refusal");
    assert.deepEqual([rows[0].before.cost, rows[0].after.cost, rows[0].before.version, rows[0].after.version], [{ withheld: true }, { withheld: true }, 1, 2]);
    assert.deepEqual([rows[0].before.leadTimeDays, rows[0].after.leadTimeDays], [7, 10], "non-sensitive changes stay readable in the audit");
    assert.match(rows[0].reason, /cost, leadTimeDays, minOrderQty/, "the changed COMMERCIAL field is NAMED");
    assert.equal(await auditCount(), before + 2);
  });

  await t.test("preferred: needs an ACTIVE item, clears the incumbent atomically, one audit row states both", async () => {
    ok(await call(buyer, "createPartSupplierItem", { partId: "P-100", supplierId: "sup-cold", supplierSku: "CC-1", cost: VALUES.coldCost, currency: VALUES.currency, leadTimeDays: 2 }), "cold");
    ok(await call(buyer, "createPartSupplierItem", { partId: "P-100", supplierId: "sup-delta", supplierSku: "DW-1", cost: VALUES.deltaCost, currency: VALUES.currency2, leadTimeDays: 1 }), "delta");
    const p1 = ok(await call(manager, "setPreferredPartSupplierItem", { partId: "P-100", itemId: "P-100__sup-cold", expectedVersion: 1 }), "prefer cold");
    assert.deepEqual([p1.outcome, p1.item.preferred, p1.item.version, p1.clearedItemId], ["preferred", true, 2, null]);
    assertNoCommercialKeys(p1.item, "manager's preferred echo");
    const again = ok(await call(manager, "setPreferredPartSupplierItem", { partId: "P-100", itemId: "P-100__sup-cold", expectedVersion: 2 }), "again");
    assert.equal(again.outcome, "unchanged");
    assertNoCommercialKeys(again.item, "manager's UNCHANGED echo");
    refused(await call(manager, "setPreferredPartSupplierItem", { partId: "P-100", itemId: "P-100__sup-delta", expectedVersion: 9 }), 409, "CONFLICT", /changed since/);
    refused(await call(manager, "setPreferredPartSupplierItem", { partId: "P-GAL", itemId: "P-100__sup-delta", expectedVersion: 1 }), 404, "NOT_FOUND",
      /for this part/, "the item must belong to the named part");
    const p2 = ok(await call(buyer, "setPreferredPartSupplierItem", { partId: "P-100", itemId: "P-100__sup-delta", expectedVersion: 1 }), "prefer delta");
    assert.deepEqual([p2.item.preferred, p2.clearedItemId, p2.item.cost], [true, "P-100__sup-cold", VALUES.deltaCost]);
    const preferred = (await q(`SELECT item_id, version FROM eos_ops.supplier_catalog_items WHERE tenant_id='t1' AND part_id='P-100' AND preferred`)).rows;
    assert.deepEqual(preferred.map((r) => r.item_id), ["P-100__sup-delta"], "exactly one preferred");
    assert.equal(await versionOf("P-100__sup-cold"), 3, "the incumbent was released");
    const rows = (await audits("P-100__sup-delta")).filter((a) => a.action === "partSupplierItem.setPreferred");
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].before.clearedItem.preferred, rows[0].after.clearedItem.preferred, rows[0].after.item.preferred], [true, false, true]);
    assert.deepEqual([rows[0].after.item.cost, rows[0].after.clearedItem.cost], [{ withheld: true }, { withheld: true }]);
    assert.equal((await audits("P-100__sup-cold")).filter((a) => a.action === "partSupplierItem.setPreferred").length, 1, "cold's own preference, once");
  });

  await t.test("status: inventory.supplierTerms.changeStatus; deactivating the preferred item clears it; same status is UNCHANGED", async () => {
    const before = await auditCount();
    refused(await call(manager, "setPartSupplierItemStatus", { itemId: "P-100__sup-delta", expectedVersion: 2, status: "INACTIVE" }), 403, "FORBIDDEN",
      /inventory\.supplierTerms\.changeStatus/, "read + create + edit do not change status");
    const d = ok(await call(administrator, "setPartSupplierItemStatus", { itemId: "P-100__sup-delta", expectedVersion: 2, status: "INACTIVE", reason: "supplier stopped stocking it" }), "deactivate");
    assert.deepEqual([d.outcome, d.item.status, d.item.preferred, d.item.version], ["deactivated", "INACTIVE", false, 3]);
    assertNoCommercialKeys(d.item, "status echo (changeStatus holds no cost key)");
    const same = ok(await call(administrator, "setPartSupplierItemStatus", { itemId: "P-100__sup-delta", expectedVersion: 3, status: "INACTIVE" }), "same");
    assert.equal(same.outcome, "unchanged");
    assertNoCommercialKeys(same.item, "status UNCHANGED echo");
    refused(await call(manager, "setPreferredPartSupplierItem", { partId: "P-100", itemId: "P-100__sup-delta", expectedVersion: 3 }), 412, "PRECONDITION_FAILED",
      /only ACTIVE/, "an INACTIVE item cannot be preferred");
    refused(await call(administrator, "setPartSupplierItemStatus", { itemId: "P-100__sup-delta", expectedVersion: 2, status: "ACTIVE" }), 409, "CONFLICT");
    refused(await call(administrator, "setPartSupplierItemStatus", { itemId: "P-100__sup-delta", expectedVersion: 3, status: "GONE" }), 400, "INVALID_INPUT");
    // A holder of changeStatus ALONE may change status, but may not read or edit terms.
    const r = ok(await call(activatorOnly, "setPartSupplierItemStatus", { itemId: "P-100__sup-delta", expectedVersion: 3, status: "ACTIVE" }), "reactivate");
    // Security review N1, generalized: a caller who may not READ terms gets the MINIMAL record -- never the terms.
    assert.deepEqual([r.outcome, r.item.status], ["activated", "ACTIVE"]);
    assert.deepEqual(Object.keys(r.item).sort(), ["itemId", "status", "version"], "no SKU, lead time or ordering terms");
    const u = ok(await call(activatorOnly, "setPartSupplierItemStatus", { itemId: "P-100__sup-delta", expectedVersion: 999, status: "ACTIVE" }), "unchanged");
    assert.deepEqual([u.outcome, Object.keys(u.item).sort()], ["unchanged", ["itemId", "status", "version"]]);
    refused(await call(activatorOnly, "listPartSupplierItems", { partId: "P-100" }), 403, "FORBIDDEN", /inventory\.supplierTerms\.read/);
    refused(await call(activatorOnly, "updatePartSupplierItem", { itemId: "P-100__sup-delta", expectedVersion: 4, changes: { leadTimeDays: 3 } }), 403, "FORBIDDEN",
      /inventory\.supplierTerms\.edit/);
    const rows = await audits("P-100__sup-delta");
    assert.deepEqual(rows.filter((a) => /activate$/.test(a.action)).map((a) => [a.action, a.reason]),
      [["partSupplierItem.deactivate", "supplier stopped stocking it"], ["partSupplierItem.activate", "part-supplier terms reactivated"]]);
    assert.equal(await auditCount(), before + 2);
  });

  await t.test("reactivation needs an ACTIVE supplier; the list shows INACTIVE items and supplier names", async () => {
    ok(await call(administrator, "setPartSupplierItemStatus", { itemId: "P-100__sup-cold", expectedVersion: 3, status: "INACTIVE" }), "deactivate cold");
    await q(`UPDATE eos_ops.suppliers SET status = 'INACTIVE' WHERE tenant_id='t1' AND supplier_id='sup-cold'`);
    refused(await call(administrator, "setPartSupplierItemStatus", { itemId: "P-100__sup-cold", expectedVersion: 4, status: "ACTIVE" }), 412, "PRECONDITION_FAILED", /supplier is not ACTIVE/);
    const list = ok(await call(buyer, "listPartSupplierItems", { partId: "P-100" }), "list");
    assert.deepEqual(list.items.map((i) => [i.supplierName, i.status, i.supplierStatus]),
      [["Arctic Parts Supply", "ACTIVE", "ACTIVE"], ["ColdChain Components", "INACTIVE", "INACTIVE"], ["Delta Wholesale", "ACTIVE", "ACTIVE"]]);
    assert.deepEqual(list.supplierOptions, [], "every ACTIVE supplier already has terms for this part");
  });

  // ════════════════════ the role matrix (governed field groups) ════════════════════

  await t.test("(i) read + create + edit: RELATIONSHIP + OPERATIONAL; COMMERCIAL withheld everywhere; commercial writes refused", async () => {
    const list = ok(await call(manager, "listPartSupplierItems", { partId: "P-100" }), "manager list");
    assert.equal(list.items.length, 3);
    for (const item of list.items) {
      assertNoCommercialKeys(item, `list ${item.itemId}`);
      for (const k of ["itemId", "partId", "supplierId", "supplierName", "supplierSku", "status", "preferred", "version", "leadTimeDays", "availability"]) {
        assert.ok(Object.prototype.hasOwnProperty.call(item, k), `${item.itemId}: ${k} is visible`);
      }
    }
    assert.equal(list.supplierOptions, null);
    const before = await auditCount();
    fieldGroupRefused(await call(manager, "createPartSupplierItem", { partId: "P-200", supplierId: "sup-arctic", supplierSku: "X", cost: "1", currency: "USD", leadTimeDays: 1 }),
      "COMMERCIAL", [COST_CREATE], "create needs cost.create (cost is mandatory)");
    fieldGroupRefused(await call(manager, "createPartSupplierItem", { partId: "P-200", supplierId: "sup-arctic", supplierSku: "X", leadTimeDays: 1 }),
      "COMMERCIAL", [COST_CREATE], "even when the cost is not stated -- refused before validation, before any read");
    const v = await versionOf("P-100__sup-arctic");
    const op = ok(await call(manager, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: v, changes: { leadTimeDays: 12, availability: "UNAVAILABLE" } }), "operational update");
    assert.deepEqual([op.outcome, op.item.leadTimeDays, op.item.version], ["updated", 12, v + 1]);
    assertNoCommercialKeys(op.item, "operational update echo");
    const replay = ok(await call(manager, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: v, changes: { leadTimeDays: 12, availability: "UNAVAILABLE" } }), "op replay");
    assert.equal(replay.outcome, "replayed");
    assertNoCommercialKeys(replay.item, "operational REPLAY echo");
    for (const changes of [{ cost: "1" }, { currency: "EUR" }, { contractStart: null }, { contractEnd: "2040-01-01" }, { leadTimeDays: 3, cost: "1" }]) {
      fieldGroupRefused(await call(manager, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: v + 1, changes }),
        "COMMERCIAL", [COST_EDIT], `commercial update ${JSON.stringify(changes)}`);
    }
    assert.equal(await auditCount(), before + 1, "only the operational update was audited");
    assert.equal(await storedCost("P-100__sup-arctic"), VALUES.arcticCost2, "no commercial value moved");
  });

  await t.test("r1: cost.read WITHOUT inventory.catalog.read projects nothing commercial", async () => {
    const list = ok(await call(costNoCatalog, "listPartSupplierItems", { partId: "P-100" }), "cost-no-catalog list");
    for (const item of list.items) assertNoCommercialKeys(item, `list ${item.itemId}`);
    assert.deepEqual(list.fieldAccess.COMMERCIAL, { read: false, create: false, edit: false });
  });

  await t.test("(ii) record keys + catalog.read + cost.read: sees COMMERCIAL; cannot write it", async () => {
    const list = ok(await call(costReader, "listPartSupplierItems", { partId: "P-100" }), "cost reader list");
    const arctic = list.items.find((i) => i.supplierId === "sup-arctic");
    assert.deepEqual([arctic.cost, arctic.currency, arctic.contractStart, arctic.contractEnd, arctic.withheld],
      [VALUES.arcticCost2, VALUES.currency, VALUES.start, VALUES.end, []]);
    assert.deepEqual(list.fieldAccess.COMMERCIAL, { read: true, create: false, edit: false });
    assert.equal(list.supplierOptions, null);
    const before = await auditCount();
    fieldGroupRefused(await call(costReader, "createPartSupplierItem", { partId: "P-200", supplierId: "sup-delta", supplierSku: "X", cost: "1", currency: "USD", leadTimeDays: 1 }),
      "COMMERCIAL", [COST_CREATE], "reading cost is not setting it");
    const v = await versionOf("P-100__sup-arctic");
    fieldGroupRefused(await call(costReader, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: v, changes: { cost: "1" } }),
      "COMMERCIAL", [COST_EDIT], "reading cost is not changing it");
    const op = ok(await call(costReader, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: v, changes: { orderMultiple: "6" } }), "op");
    assert.deepEqual([op.item.orderMultiple, op.item.cost], ["6", VALUES.arcticCost2], "the echo shows what they may read");
    assert.equal(await auditCount(), before + 1);
  });

  await t.test("(iii)/(d) cost.create + cost.edit WITHOUT cost.read: writes COMMERCIAL blind; no answer is decided by COMMERCIAL equality", async () => {
    const list = ok(await call(blindWriter, "listPartSupplierItems", { partId: "P-100" }), "blind list");
    for (const item of list.items) assertNoCommercialKeys(item, `blind list ${item.itemId}`);
    assert.deepEqual(list.fieldAccess.COMMERCIAL, { read: false, create: true, edit: true });
    assert.ok(Array.isArray(list.supplierOptions), "a creator gets the supplier directory");
    // An existing pair: even the EXACT stored terms are a conflict, never a content-addressed replay (that would confirm the cost).
    const stored = ok(await call(buyer, "listPartSupplierItems", { partId: "P-100" }), "buyer view").items.find((i) => i.supplierId === "sup-arctic");
    const exact = { partId: "P-100", supplierId: "sup-arctic", supplierSku: stored.supplierSku, cost: stored.cost, currency: stored.currency,
      leadTimeDays: stored.leadTimeDays, orderMultiple: stored.orderMultiple, contractStart: stored.contractStart, contractEnd: stored.contractEnd,
      availability: stored.availability };
    for (const k of Object.keys(exact)) if (exact[k] === null) delete exact[k]; // create omits, never nulls
    const conflict = await call(blindWriter, "createPartSupplierItem", exact);
    refused(conflict, 409, "CONFLICT", /already has terms for this part; edit them instead/, "exact stored terms");
    const differing = await call(blindWriter, "createPartSupplierItem", { ...exact, cost: "1" });
    refused(differing, 409, "CONFLICT", null, "different terms");
    assert.equal(conflict.body.message, differing.body.message, "the SAME answer whether or not the guess matches");
    // Creating new terms blind works, and the echo withholds what was just written.
    const created = ok(await call(blindWriter, "createPartSupplierItem", { partId: "P-200", supplierId: "sup-arctic", supplierSku: "B-1",
      cost: VALUES.blindCost, currency: VALUES.currency, leadTimeDays: 3, contractStart: VALUES.start2, contractEnd: VALUES.end2 }), "blind create");
    assert.equal(created.outcome, "created");
    assertNoCommercialKeys(created.item, "blind create echo");
    assert.equal(await storedCost("P-200__sup-arctic"), VALUES.blindCost);
    // Restating the STORED cost is applied (a version bump), never NO_CHANGES.
    const v = await versionOf("P-200__sup-arctic");
    const same = ok(await call(blindWriter, "updatePartSupplierItem", { itemId: "P-200__sup-arctic", expectedVersion: v, changes: { cost: VALUES.blindCost } }), "same cost");
    assert.deepEqual([same.outcome, same.item.version], ["updated", v + 1]);
    assertNoCommercialKeys(same.item, "blind update echo");
    // Its resend is NOT a replay either (a replay would confirm the stored value): the stale version answers.
    refused(await call(blindWriter, "updatePartSupplierItem", { itemId: "P-200__sup-arctic", expectedVersion: v, changes: { cost: VALUES.blindCost } }),
      409, "CONFLICT", /changed since/, "blind resend");
    const different = ok(await call(blindWriter, "updatePartSupplierItem", { itemId: "P-200__sup-arctic", expectedVersion: v + 1, changes: { cost: "4.5" } }), "different cost");
    assert.equal(different.outcome, "updated", "a real change and a restatement answer alike");
    assert.equal(await storedCost("P-200__sup-arctic"), "4.5000");
    ok(await call(buyer, "updatePartSupplierItem", { itemId: "P-200__sup-arctic", expectedVersion: v + 2, changes: { cost: VALUES.blindCost } }), "restore");
    // One end of the contract window alone is refused BEFORE any stored date is consulted: both ends, or nothing.
    for (const changes of [{ contractEnd: "2000-01-01" }, { contractEnd: "2099-01-01" }, { contractStart: "2099-01-01" }]) {
      refused(await call(blindWriter, "updatePartSupplierItem", { itemId: "P-200__sup-arctic", expectedVersion: v + 3, changes }), 400, "INVALID_INPUT",
        /state both contractStart and contractEnd/, `blind window ${JSON.stringify(changes)}`);
    }
    const window = ok(await call(blindWriter, "updatePartSupplierItem", { itemId: "P-200__sup-arctic", expectedVersion: v + 3,
      changes: { contractStart: VALUES.start2, contractEnd: VALUES.end2 } }), "both ends restated");
    assert.equal(window.outcome, "updated");
    // NO_CHANGES is still decided over the fields the writer CAN read.
    refused(await call(blindWriter, "updatePartSupplierItem", { itemId: "P-200__sup-arctic", expectedVersion: v + 4, changes: { leadTimeDays: 3 } }),
      412, "PRECONDITION_FAILED", /already the stored/, "readable NO_CHANGES");
    // review N3: the audit reason does not claim a blind restatement CHANGED the stored value -- it says it was STATED.
    const blindRows = (await audits("P-200__sup-arctic")).filter((a) => a.action === "partSupplierItem.update" && a.actor_uid === blindWriter.principalId);
    assert.deepEqual(blindRows.map((a) => a.reason), [
      "part-supplier terms stated without read access: cost",
      "part-supplier terms stated without read access: cost",
      "part-supplier terms stated without read access: contractEnd, contractStart",
    ], "a blind write names the fields it STATED, never 'updated'");
  });

  await t.test("(iv)/(c) the PROPOSED Purchasing bundle: reads, creates, edits COMMERCIAL, sets preferred and changes status", async () => {
    const list = ok(await call(buyer, "listPartSupplierItems", { partId: "P-200" }), "buyer list");
    assert.deepEqual(list.items.map((i) => [i.cost, i.contractStart, i.withheld]), [[VALUES.blindCost, VALUES.start2, []]]);
    const v = await versionOf("P-200__sup-arctic");
    const u = ok(await call(buyer, "updatePartSupplierItem", { itemId: "P-200__sup-arctic", expectedVersion: v, changes: { currency: VALUES.currency2 } }), "currency");
    assert.equal(u.item.currency, VALUES.currency2);
    ok(await call(buyer, "updatePartSupplierItem", { itemId: "P-200__sup-arctic", expectedVersion: v + 1, changes: { currency: VALUES.currency } }), "back");
    const off = ok(await call(buyer, "setPartSupplierItemStatus", { itemId: "P-200__sup-arctic", expectedVersion: v + 2, status: "INACTIVE" }), "status");
    assert.deepEqual([off.outcome, off.item.cost, off.item.withheld], ["deactivated", VALUES.blindCost, []], "the bundle's status echo is the full projection");
    const on = ok(await call(buyer, "setPartSupplierItemStatus", { itemId: "P-200__sup-arctic", expectedVersion: v + 3, status: "ACTIVE" }), "status back");
    const pref = ok(await call(buyer, "setPreferredPartSupplierItem", { partId: "P-200", itemId: "P-200__sup-arctic", expectedVersion: on.item.version }), "preferred");
    assert.deepEqual([pref.outcome, pref.item.preferred], ["preferred", true]);
  });

  await t.test("review N1: a cost.read granted UNDER A CONDITION is withheld on the supplier-terms transport (no COMMERCIAL read)", async () => {
    const conditioned = await makeActor("t1", "fb-sup1-conditioned", [READ, CATALOG_READ, COST_READ]);
    await q(`INSERT INTO eos_policy.capability_grant_conditions (id, tenant_id, grant_scope, grantor_key, capability_key, condition, established_by, updated_by)
             VALUES ('cgc-sup1-n1', 't1', 'ROLE', 'role-fb-sup1-conditioned', $1, $2::jsonb, 'fixture', 'fixture')`,
      [COST_READ, JSON.stringify({ paths: [[{ kind: "WORK_ELIGIBILITY", qualificationCode: "PARTS_OPERATIONS" }]] })]);
    const list = ok(await call(conditioned, "listPartSupplierItems", { partId: "P-100" }), "conditioned list");
    assert.equal(list.items.length, 3, "the unconditioned record read still answers");
    for (const item of list.items) assertNoCommercialKeys(item, `conditioned ${item.itemId}`);
    assert.deepEqual(list.fieldAccess.COMMERCIAL, { read: false, create: false, edit: false });
  });

  await t.test("review N2: an editor WITHOUT supplierTerms.read is not told which item was preferred before", async () => {
    ok(await call(buyer, "createPartSupplierItem", { partId: "P-200", supplierId: "sup-delta", supplierSku: "N2-1", cost: "2", currency: "USD", leadTimeDays: 1 }), "second item");
    // No write-free probe: with a wrong version the preferred item and a non-preferred one answer alike.
    const auditsBefore = await auditCount();
    const probePreferred = await call(editorOnly, "setPreferredPartSupplierItem", { partId: "P-200", itemId: "P-200__sup-arctic", expectedVersion: 999 });
    const probeOther = await call(editorOnly, "setPreferredPartSupplierItem", { partId: "P-200", itemId: "P-200__sup-delta", expectedVersion: 999 });
    refused(probePreferred, 409, "CONFLICT", /changed since/, "wrong version on the PREFERRED item");
    refused(probeOther, 409, "CONFLICT", /changed since/, "wrong version on another item");
    assert.deepEqual(probePreferred.body, probeOther.body, "the same answer whichever item is preferred");
    assert.equal(await auditCount(), auditsBefore, "the probes wrote nothing");
    const r = ok(await call(editorOnly, "setPreferredPartSupplierItem", { partId: "P-200", itemId: "P-200__sup-delta", expectedVersion: 1 }), "editor prefers");
    assert.deepEqual([r.outcome, r.clearedItemId], ["preferred", null], "the incumbent exists but is not disclosed");
    const back = ok(await call(buyer, "setPreferredPartSupplierItem", { partId: "P-200", itemId: "P-200__sup-arctic", expectedVersion: await versionOf("P-200__sup-arctic") }), "reader prefers back");
    assert.equal(back.clearedItemId, "P-200__sup-delta", "a reader is told");
  });

  await t.test("(a) supplierTerms.read ONLY: lists RELATIONSHIP + OPERATIONAL, COMMERCIAL withheld, every write refused", async () => {
    const list = ok(await call(reader, "listPartSupplierItems", { partId: "P-100" }), "reader list");
    assert.equal(list.items.length, 3);
    for (const item of list.items) {
      assertNoCommercialKeys(item, `reader ${item.itemId}`);
      for (const k of ["supplierSku", "leadTimeDays", "availability", "status", "preferred", "version"]) assert.ok(Object.hasOwn(item, k), `${k} is visible`);
    }
    assert.deepEqual(list.fieldAccess, { RELATIONSHIP: { read: true, create: false, edit: false }, OPERATIONAL: { read: true, create: false, edit: false },
      COMMERCIAL: { read: false, create: false, edit: false } });
    assert.deepEqual(list.recordAccess, { read: true, create: false, edit: false, changeStatus: false });
    assert.equal(list.supplierOptions, null);
    const before = await auditCount();
    const v = await versionOf("P-100__sup-arctic");
    for (const [operation, input, key] of [
      ["createPartSupplierItem", { partId: "P-GAL", supplierId: "sup-arctic", supplierSku: "X", cost: "1", currency: "USD", leadTimeDays: 1 }, CREATE],
      ["updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: v, changes: { leadTimeDays: 99 } }, EDIT],
      ["setPreferredPartSupplierItem", { partId: "P-100", itemId: "P-100__sup-arctic", expectedVersion: v }, EDIT],
      ["setPartSupplierItemStatus", { itemId: "P-100__sup-arctic", expectedVersion: v, status: "INACTIVE" }, STATUS],
    ]) {
      refused(await call(reader, operation, input), 403, "FORBIDDEN", new RegExp(key.replace(/\./g, "\\.")), `reader: ${operation}`);
    }
    assert.equal(await auditCount(), before);
    assert.equal(await versionOf("P-100__sup-arctic"), v);
  });

  await t.test("(b) MULTI-ROLE UNION: Role A (read + edit) + Role B (catalog.read + cost.read) is additive -- sees COMMERCIAL, edits operational, not commercial", async () => {
    // Two REAL Roles, two REAL global assignments: neither Role alone reads COMMERCIAL (A lacks cost.read; B lacks the doorway).
    const roles = (await q(`SELECT r.key, array_agg(c.key ORDER BY c.key) AS keys FROM eos_policy.user_role_assignments a
                             JOIN eos_policy.roles r ON r.id = a.role_id JOIN eos_policy.role_capabilities rc ON rc.role_id = r.id
                             JOIN eos_policy.capabilities c ON c.id = rc.capability_id
                            WHERE a.principal_id = $1 AND a.status = 'active' GROUP BY r.key ORDER BY r.key`, [unionEmployee.principalId])).rows;
    assert.deepEqual(roles.map((r) => [r.key, [...r.keys].sort()]), [["role-fb-sup1-union-1", [EDIT, READ].sort()], ["role-fb-sup1-union-2", [CATALOG_READ, COST_READ].sort()]]);
    const list = ok(await call(unionEmployee, "listPartSupplierItems", { partId: "P-100" }), "union list");
    const arctic = list.items.find((i) => i.supplierId === "sup-arctic");
    assert.deepEqual([arctic.cost, arctic.currency, arctic.withheld], [VALUES.arcticCost2, VALUES.currency, []], "the union reads COMMERCIAL");
    assert.deepEqual(list.fieldAccess.COMMERCIAL, { read: true, create: false, edit: false });
    assert.deepEqual(list.recordAccess, { read: true, create: false, edit: true, changeStatus: false });
    const v = await versionOf("P-100__sup-arctic");
    const op = ok(await call(unionEmployee, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: v, changes: { leadTimeDays: 13 } }), "union op");
    assert.deepEqual([op.outcome, op.item.leadTimeDays, op.item.cost], ["updated", 13, VALUES.arcticCost2]);
    fieldGroupRefused(await call(unionEmployee, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: v + 1, changes: { cost: "2" } }),
      "COMMERCIAL", [COST_EDIT], "the union holds no cost.edit");
    refused(await call(unionEmployee, "createPartSupplierItem", { partId: "P-GAL", supplierId: "sup-cold", supplierSku: "U", cost: "1", currency: "USD", leadTimeDays: 1 }),
      403, "FORBIDDEN", /inventory\.supplierTerms\.create/);
    assert.equal(await storedCost("P-100__sup-arctic"), VALUES.arcticCost2);
  });

  await t.test("(f) inventory.catalog.manage + .activate (+ catalog.read) are REFUSED every supplier-terms operation -- no dependency on broad manage", async () => {
    const before = await auditCount();
    const v = await versionOf("P-100__sup-arctic");
    for (const [operation, input, key] of [
      ["listPartSupplierItems", { partId: "P-100" }, READ],
      ["createPartSupplierItem", { partId: "P-GAL", supplierId: "sup-arctic", supplierSku: "X", cost: "1", currency: "USD", leadTimeDays: 1 }, CREATE],
      ["updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: v, changes: { leadTimeDays: 1 } }, EDIT],
      ["setPreferredPartSupplierItem", { partId: "P-100", itemId: "P-100__sup-arctic", expectedVersion: v }, EDIT],
      ["setPartSupplierItemStatus", { itemId: "P-100__sup-arctic", expectedVersion: v, status: "INACTIVE" }, STATUS],
    ]) {
      refused(await call(legacyCatalog, operation, input), 403, "FORBIDDEN", new RegExp(`require ${key.replace(/\./g, "\\.")}$`), `legacy catalog: ${operation}`);
    }
    assert.equal(await auditCount(), before);
    assert.equal(await versionOf("P-100__sup-arctic"), v);
  });

  await t.test("authority: no supplier-terms key = FORBIDDEN for every operation; a non-member is FORBIDDEN; nothing written or audited", async () => {
    const before = await auditCount();
    const v = await versionOf("P-100__sup-arctic");
    const asks = [
      ["listPartSupplierItems", { partId: "P-100" }],
      ["createPartSupplierItem", { partId: "P-GAL", supplierId: "sup-arctic", supplierSku: "X", cost: "1", currency: "USD", leadTimeDays: 1 }],
      ["updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: v, changes: { cost: "1" } }],
      ["setPreferredPartSupplierItem", { partId: "P-100", itemId: "P-100__sup-arctic", expectedVersion: v }],
      ["setPartSupplierItemStatus", { itemId: "P-100__sup-arctic", expectedVersion: v, status: "INACTIVE" }],
    ];
    for (const [operation, input] of asks) {
      refused(await call(member, operation, input), 403, "FORBIDDEN", /require inventory\.supplierTerms\./, `member: ${operation}`);
      refused(await call(outsider, operation, input), 403, "FORBIDDEN", null, `non-member: ${operation}`);
      refused(await call(null, operation, input), 401, "UNAUTHENTICATED", null, `anonymous: ${operation}`);
    }
    assert.equal(await auditCount(), before);
    assert.equal(await versionOf("P-100__sup-arctic"), v);
  });

  await t.test("(g) TENANT ISOLATION: another tenant's holder of EVERY key can neither read nor write this tenant's terms", async () => {
    const before = await auditCount();
    const v = await versionOf("P-100__sup-arctic");
    refused(await call(otherTenant, "listPartSupplierItems", { partId: "P-100" }), 404, "NOT_FOUND", /no part/);
    refused(await call(otherTenant, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: v, changes: { cost: "0.01" } }), 404, "NOT_FOUND");
    refused(await call(otherTenant, "setPartSupplierItemStatus", { itemId: "P-100__sup-arctic", expectedVersion: v, status: "INACTIVE" }), 404, "NOT_FOUND");
    refused(await call(otherTenant, "setPreferredPartSupplierItem", { partId: "P-100", itemId: "P-100__sup-arctic", expectedVersion: v }), 404, "NOT_FOUND");
    refused(await call(otherTenant, "createPartSupplierItem", { ...ARCTIC, partId: "P-100" }), 404, "NOT_FOUND", /no part/, "t1's part is not t2's");
    refused(await call(otherTenant, "createPartSupplierItem", { ...ARCTIC, partId: "P-T2", supplierId: "sup-cold" }), 404, "NOT_FOUND", /no supplier/, "t1's supplier is not t2's");
    assert.equal(await auditCount(), before, "no audit row in either tenant");
    // The same ids, in t2's OWN namespace, are t2's own records.
    const own = ok(await call(otherTenant, "createPartSupplierItem", { ...ARCTIC, partId: "P-T2" }), "t2 own");
    assert.equal(own.item.supplierName, "Arctic (other tenant)");
    assert.equal((await one(`SELECT tenant_id FROM eos_policy.audit_events WHERE target_id='P-T2__sup-arctic'`)).tenant_id, "t2");
    const t1 = ok(await call(buyer, "listPartSupplierItems", { partId: "P-100" }), "t1 list");
    assert.equal(t1.items.some((i) => i.partId === "P-T2"), false);
    const t1Arctic = t1.items.find((i) => i.supplierId === "sup-arctic");
    assert.deepEqual([t1Arctic.cost, t1Arctic.version], [VALUES.arcticCost2, v], "t1's record is untouched");
  });

  await t.test("(h) AUDIT: every operation above was audited, no audit row holds a COMMERCIAL value, and the trail is still append-only", async () => {
    const rows = (await q(`SELECT tenant_id, action, before, after, reason FROM eos_policy.audit_events WHERE target_kind = 'part_supplier_item'`)).rows;
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ["partSupplierItem.create", "partSupplierItem.update", "partSupplierItem.setPreferred", "partSupplierItem.activate", "partSupplierItem.deactivate"]) {
      assert.ok(actions.has(a), `${a} is audited`);
    }
    for (const r of rows) {
      assert.deepEqual(carriesCommercialValue([r.before, r.after, r.reason]), [], `${r.action}: no commercial value in the row`);
      for (const side of [r.before, r.after]) {
        if (!side) continue;
        const items = side.item !== undefined ? [side.item, side.clearedItem].filter(Boolean) : [side];
        for (const it of items) for (const k of COMMERCIAL) if (Object.prototype.hasOwnProperty.call(it, k)) assert.deepEqual(it[k], { withheld: true }, `${r.action} ${k}`);
      }
    }
    // The stored table, by contrast, holds them -- so the search above is meaningful.
    const table = JSON.stringify((await q(`SELECT cost::text, currency, contract_start::text, contract_end::text FROM eos_ops.supplier_catalog_items`)).rows);
    assert.ok(table.includes(VALUES.blindCost) && table.includes(VALUES.start2), "the values exist in the table the audit protects");
    // Append-only integrity is intact: no audit row of this record kind can be rewritten or removed.
    const target = rows.length;
    await assert.rejects(q(`UPDATE eos_policy.audit_events SET reason = 'rewritten' WHERE target_kind = 'part_supplier_item'`), /append-only/);
    await assert.rejects(q(`DELETE FROM eos_policy.audit_events WHERE target_kind = 'part_supplier_item'`), /append-only/);
    assert.equal((await q(`SELECT count(*)::int AS n FROM eos_policy.audit_events WHERE target_kind = 'part_supplier_item'`)).rows[0].n, target);
  });

  await t.test("(i) ERROR RESPONSES never echo a stored COMMERCIAL value", async () => {
    assert.ok(refusals.length > 60, `${refusals.length} refusals were observed`);
    for (const body of refusals) {
      // No refusal message, code or details carries any COMMERCIAL value the suite ever stored -- not even one the caller
      // sent (the messages name fields and keys, never values).
      assert.deepEqual(carriesCommercialValue(body), [], `${body.code}: ${body.message}`);
      assert.equal(JSON.stringify(body).includes("withheld"), false, "no projected record rides on a refusal");
    }
  });

  await t.test("every audit row names an EOS Principal, never a Firebase uid", async () => {
    const actors = (await q(`SELECT DISTINCT actor_uid FROM eos_policy.audit_events WHERE target_kind = 'part_supplier_item'`)).rows.map((r) => r.actor_uid);
    const principals = new Set([manager, costReader, blindWriter, buyer, unionEmployee, administrator, activatorOnly, editorOnly, otherTenant].map((a) => a.principalId));
    for (const a of actors) {
      assert.ok(principals.has(a), `${a} is an EOS principal`);
      assert.doesNotMatch(a, /^fb-/);
    }
  });
});

test("(e) the Protected Administrator reads operational terms only, and (j) registration granted nothing", { skip: SKIP, concurrency: false }, async (t) => {
  const T = "t-sup1-padmin";
  const { q, repo, pool, call } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: T, prefix: "sup1padmin" });
  const { resolveOperationalContext } = require("../lib/eosOps/capabilityAuthority.js");
  const ADMIN = { subject: "uid-sup1padmin-admin" }; // the bootstrapped Administrator: admin standing, no supplier-terms grant

  await t.test("(j) all seven keys are registered on supplierCatalogItem and held by NO Role, Principal or decision after migrate + seed + baseline", async () => {
    const caps = (await q(`SELECT key, object_key, action_key, action_kind FROM eos_policy.capabilities WHERE object_key = 'supplierCatalogItem' ORDER BY key`)).rows;
    assert.deepEqual(caps.map((c) => [c.key, c.object_key, c.action_key, c.action_kind]), [
      [COST_CREATE, "supplierCatalogItem", "createCost", "CREATE"],
      [COST_EDIT, "supplierCatalogItem", "editCost", "EDIT"],
      [COST_READ, "supplierCatalogItem", "readCost", "READ"],
      [STATUS, "supplierCatalogItem", "changeStatus", "BUSINESS_ACTION"],
      [CREATE, "supplierCatalogItem", "createTerms", "CREATE"],
      [EDIT, "supplierCatalogItem", "editTerms", "EDIT"],
      [READ, "supplierCatalogItem", "readTerms", "READ"],
    ]);
    const count = async (sql) => (await q(sql, [ALL_SEVEN])).rows[0].n;
    assert.equal(await count(`SELECT count(*)::int AS n FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE c.key = ANY($1::text[])`), 0,
      "no role_capabilities row references any of the seven keys");
    assert.equal(await count(`SELECT count(*)::int AS n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id WHERE c.key = ANY($1::text[])`), 0,
      "no direct grant either");
    assert.equal(await count(`SELECT count(*)::int AS n FROM eos_policy.role_capability_decisions WHERE capability_key = ANY($1::text[])`), 0,
      "no Administration decision names them");
  });

  await t.test("(e) standing implies supplierTerms.read + catalog.read, none of the COMMERCIAL keys and no record write -- by the REAL resolver; every surface agrees", async () => {
    // Resolved exactly as the transport resolves the actor (eosOpsHttp reorderActor).
    const ctx = await resolveOperationalContext(repo, pool, { identityProvider: "firebase", externalSubject: ADMIN.subject, requestedTenantId: null });
    assert.ok(ctx.protectedAdministratorKeys.size > 0, "the actor HAS standing");
    assert.equal(ctx.capabilities.has(CATALOG_READ), true, "READ kinds are implied (catalog.read)");
    assert.equal(ctx.protectedAdministratorKeys.has(READ), true, "supplierTerms.read is a READ: implied (DECISIONS #223 operational read)");
    for (const k of [...COST_KEYS, CREATE, EDIT, STATUS]) {
      assert.equal(ctx.protectedAdministratorKeys.has(k), false, `${k} is not implied by standing`);
      assert.equal(ctx.capabilities.has(k), false, `${k} is not held`);
    }
    await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
               expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
             VALUES ('P-PA', $1, 'fixture', 'P-PA', 'P-PA', 'ACTIVE', 'EACH', 'STANDARD', 'STOCKED', false, false, false, false, 1, 'fixture')`, [T]);
    await q(`INSERT INTO eos_ops.suppliers (tenant_id, supplier_id, name, normalized_key, status, version, created_by, updated_by)
             VALUES ($1, 'sup-pa', 'PA Supply', 'pa supply', 'ACTIVE', 1, 'fixture', 'fixture')`, [T]);
    await q(`INSERT INTO eos_ops.supplier_catalog_items (tenant_id, part_id, supplier_id, supplier_sku, cost, currency, lead_time_days, availability,
               status, version, contract_start, contract_end, created_by, updated_by)
             VALUES ($1, 'P-PA', 'sup-pa', 'PA-1', $2, $3, 4, 'AVAILABLE', 'ACTIVE', 1, $4, $5, 'fixture', 'fixture')`,
      [T, VALUES.arcticCost, VALUES.currency, VALUES.start, VALUES.end]);
    const route = "/operations/inventory";
    const list = await call(ADMIN, route, "listPartSupplierItems", { partId: "P-PA" });
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.deepEqual(list.body.result.fieldAccess.COMMERCIAL, { read: false, create: false, edit: false });
    assert.deepEqual(list.body.result.recordAccess, { read: true, create: false, edit: false, changeStatus: false });
    assert.equal(list.body.result.supplierOptions, null);
    assert.equal(list.body.result.items.length, 1);
    for (const item of list.body.result.items) {
      assertNoCommercialKeys(item, "Administrator list");
      assert.deepEqual([item.supplierSku, item.leadTimeDays, item.availability], ["PA-1", 4, "AVAILABLE"], "operational terms are read");
    }
    const refusedAs = (r, key, what) => {
      assert.deepEqual([r.status, r.body.code], [403, "FORBIDDEN"], `${what} ${JSON.stringify(r.body)}`);
      assert.match(r.body.message, new RegExp(key.replace(/\./g, "\\.")), what);
      assert.deepEqual(carriesCommercialValue(r.body), [], what);
    };
    refusedAs(await call(ADMIN, route, "updatePartSupplierItem", { itemId: "P-PA__sup-pa", expectedVersion: 1, changes: { leadTimeDays: 5 } }), EDIT, "operational edit");
    refusedAs(await call(ADMIN, route, "updatePartSupplierItem", { itemId: "P-PA__sup-pa", expectedVersion: 1, changes: { cost: "1" } }), EDIT, "cost edit");
    refusedAs(await call(ADMIN, route, "createPartSupplierItem", { partId: "P-PA", supplierId: "sup-pa", supplierSku: "PA-1", cost: VALUES.arcticCost,
      currency: VALUES.currency, leadTimeDays: 4 }), CREATE, "the exact stored terms answer a refusal, not a replay");
    refusedAs(await call(ADMIN, route, "setPartSupplierItemStatus", { itemId: "P-PA__sup-pa", expectedVersion: 1, status: "INACTIVE" }), STATUS, "status");
    refusedAs(await call(ADMIN, route, "setPreferredPartSupplierItem", { partId: "P-PA", itemId: "P-PA__sup-pa", expectedVersion: 1 }), EDIT, "preferred");
    assert.equal((await q(`SELECT count(*)::int AS n FROM eos_policy.audit_events WHERE tenant_id = $1 AND target_kind = 'part_supplier_item'`, [T])).rows[0].n, 0,
      "nothing was written, so nothing was audited");
    assert.equal((await q(`SELECT version FROM eos_ops.supplier_catalog_items WHERE tenant_id = $1 AND item_id = 'P-PA__sup-pa'`, [T])).rows[0].version, 1);
  });
});
