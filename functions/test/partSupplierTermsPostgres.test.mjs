// SUP-1: GOVERNED PART-SUPPLIER TERMS over the real /operations/inventory transport and a real PostgreSQL.
//
// Firebase retirement F2 removed createPartSupplierItem / updatePartSupplierItem / changePartSupplierItemStatus /
// setPreferredSupplier and left only a repository behind them. This suite proves the governed replacement
// (functions/src/eosOps/partSupplierTerms.ts): the Firebase authority preserved exactly (inventory.catalog.manage for
// read / create / update / preferred, inventory.catalog.activate for status), the Firebase term rules ported, optimistic
// concurrency, replay, the one-preferred invariant, tenant isolation, and ONE audit row per successful write -- none on a
// refusal. No Firebase. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { partSupplierTermsDatabase } from "./support/partSupplierTermsFixture.mjs";

const require = createRequire(import.meta.url);
const terms = require("../lib/eosOps/partSupplierTerms.js");
const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const MANAGE = "inventory.catalog.manage";
const ACTIVATE = "inventory.catalog.activate";

test("authority is REUSED, not invented, and the module carries no Firebase", () => {
  assert.equal(terms.PART_SUPPLIER_TERMS_MANAGE_CAPABILITY, MANAGE);
  assert.equal(terms.PART_SUPPLIER_TERMS_STATUS_CAPABILITY, ACTIVATE);
  const src = readFileSync(new URL("../src/eosOps/partSupplierTerms.ts", import.meta.url), "utf8");
  assert.equal(/from ["'][^"']*firebase/i.test(src), false);
  // The ported term keys are exactly the retired Firebase TERM_KEYS (partSupplierItems.ts before 322db5b5).
  assert.deepEqual([...terms.PART_SUPPLIER_TERM_KEYS].sort(), ["availability", "contractEnd", "contractStart", "conversionToStockingUnit", "cost",
    "currency", "lastVerifiedAt", "leadTimeDays", "minOrderQty", "orderMultiple", "purchaseUnit", "supplierSku"]);
  assert.equal(terms.canonicalDecimal("012.5000"), "12.5");
  assert.equal(terms.canonicalDecimal("10.0000"), "10");
  assert.equal(terms.canonicalDecimal("0.0000"), "0");
});

test("part-supplier terms over the governed path", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, makeActor, part, supplier, call } = await partSupplierTermsDatabase(t, { urlBase: URL_BASE, prefix: "sup1_terms" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`); return r.body.result; };
  const refused = (r, status, category, message, what = "") => {
    assert.deepEqual([r.status, r.body.code], [status, category], `${what} ${JSON.stringify(r.body)}`);
    if (message) assert.match(r.body.message, message, what);
  };
  const audits = async (itemId) => (await q(
    `SELECT action, actor_uid, before, after, reason FROM eos_policy.audit_events WHERE tenant_id = 't1' AND target_kind = 'part_supplier_item' AND target_id = $1 ORDER BY occurred_at, id`,
    [itemId])).rows;
  const auditCount = async () => (await one(`SELECT count(*)::int AS n FROM eos_policy.audit_events WHERE target_kind = 'part_supplier_item'`)).n;

  // The people: a catalog manager (manage), a catalog administrator (manage + activate), a member holding neither, a
  // principal with NO tenant membership, and a manager in ANOTHER tenant.
  const manager = await makeActor("t1", "fb-sup1-manager", [MANAGE]);
  const administrator = await makeActor("t1", "fb-sup1-admin", [MANAGE, ACTIVATE]);
  const activatorOnly = await makeActor("t1", "fb-sup1-activator", [ACTIVATE]);
  const member = await makeActor("t1", "fb-sup1-member", ["inventory.catalog.read"]);
  const outsider = await makeActor("t1", "fb-sup1-outsider", [], { member: false });
  const otherTenant = await makeActor("t2", "fb-sup1-t2-manager", [MANAGE, ACTIVATE]);

  await part("t1", "P-100", "EACH");
  await part("t1", "P-GAL", "GALLON");
  await part("t2", "P-T2", "EACH");
  await supplier("t1", "sup-arctic", "Arctic Parts Supply");
  await supplier("t1", "sup-cold", "ColdChain Components");
  await supplier("t1", "sup-delta", "Delta Wholesale");
  await supplier("t1", "sup-gone", "Gone Vendor", "INACTIVE");
  await supplier("t2", "sup-arctic", "Arctic (other tenant)");

  const ARCTIC = { partId: "P-100", supplierId: "sup-arctic", supplierSku: "ARC-100", cost: "12.50", currency: "USD", leadTimeDays: 7,
    minOrderQty: "10", orderMultiple: "5", purchaseUnit: "BOX", conversionToStockingUnit: { numerator: 12, denominator: 1 },
    contractStart: "2026-01-01", contractEnd: "2026-12-31", availability: "AVAILABLE" };

  await t.test("list: an empty Part answers an empty list and the ACTIVE suppliers it can add, by name", async () => {
    const r = ok(await call(manager, "listPartSupplierItems", { partId: "P-100" }), "list");
    assert.deepEqual(r.items, []);
    assert.equal(r.stockingUnit, "EACH");
    assert.deepEqual(r.supplierOptions, [{ supplierId: "sup-arctic", name: "Arctic Parts Supply" }, { supplierId: "sup-cold", name: "ColdChain Components" },
      { supplierId: "sup-delta", name: "Delta Wholesale" }], "the INACTIVE supplier is not offered");
    refused(await call(manager, "listPartSupplierItems", { partId: "P-NOPE" }), 404, "NOT_FOUND", /no part/);
    refused(await call(manager, "listPartSupplierItems", { partId: "P-100", extra: 1 }), 400, "INVALID_INPUT", /does not accept: extra/);
  });

  await t.test("create: the terms are stored, never preferred, audited once with no before; the actor is the EOS Principal", async () => {
    const before = await auditCount();
    const r = ok(await call(manager, "createPartSupplierItem", ARCTIC), "create");
    assert.equal(r.outcome, "created");
    assert.deepEqual(r.item, {
      itemId: "P-100__sup-arctic", partId: "P-100", supplierId: "sup-arctic", supplierName: "Arctic Parts Supply", supplierStatus: "ACTIVE",
      supplierSku: "ARC-100", cost: "12.5", currency: "USD", leadTimeDays: 7, minOrderQty: "10", orderMultiple: "5", purchaseUnit: "BOX",
      conversionToStockingUnit: { numerator: 12, denominator: 1 }, contractStart: "2026-01-01", contractEnd: "2026-12-31",
      availability: "AVAILABLE", lastVerifiedAt: null, preferred: false, status: "ACTIVE", version: 1,
    });
    const rows = await audits("P-100__sup-arctic");
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].action, rows[0].actor_uid, rows[0].before], ["partSupplierItem.create", manager.principalId, null]);
    assert.equal(rows[0].after.supplierSku, "ARC-100");
    assert.notEqual(rows[0].actor_uid, manager.subject, "never the Firebase uid");
    const stored = await one(`SELECT created_by, updated_by FROM eos_ops.supplier_catalog_items WHERE tenant_id='t1' AND item_id='P-100__sup-arctic'`);
    assert.deepEqual([stored.created_by, stored.updated_by], [manager.principalId, manager.principalId]);
    assert.equal(await auditCount(), before + 1);
  });

  await t.test("replay: the identical create (decimals spelled differently) is REPLAYED and writes nothing", async () => {
    const before = await auditCount();
    const r = ok(await call(manager, "createPartSupplierItem", { ...ARCTIC, cost: "12.5000" }), "replay");
    assert.deepEqual([r.outcome, r.item.version], ["replayed", 1]);
    refused(await call(manager, "createPartSupplierItem", { ...ARCTIC, supplierSku: "ARC-OTHER" }), 409, "CONFLICT", /different terms/, "one item per (part, supplier)");
    assert.equal(await auditCount(), before, "a replay and a refusal write no audit row");
  });

  await t.test("create refusals: unknown part, unknown or INACTIVE supplier, and every Firebase term rule", async () => {
    const before = await auditCount();
    const base = { partId: "P-100", supplierId: "sup-cold", supplierSku: "CC-1", cost: "3", currency: "USD", leadTimeDays: 2 };
    refused(await call(manager, "createPartSupplierItem", { ...base, partId: "P-NOPE" }), 404, "NOT_FOUND", /no part/);
    refused(await call(manager, "createPartSupplierItem", { ...base, supplierId: "sup-nope" }), 404, "NOT_FOUND", /no supplier/);
    refused(await call(manager, "createPartSupplierItem", { ...base, supplierId: "sup-gone" }), 412, "PRECONDITION_FAILED", /not ACTIVE/);
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
      refused(await call(manager, "createPartSupplierItem", input), 400, "INVALID_INPUT", message, JSON.stringify(patch));
    }
    assert.equal(await auditCount(), before, "no refusal is audited");
    assert.equal((await one(`SELECT count(*)::int AS n FROM eos_ops.supplier_catalog_items WHERE supplier_id='sup-cold'`)).n, 0, "and none wrote");
  });

  await t.test("update: term fields only, optimistic concurrency, NO_CHANGES, replay, clear-with-null, merged contract window", async () => {
    const before = await auditCount();
    const u = ok(await call(manager, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: 1,
      changes: { cost: "11.75", leadTimeDays: 10, minOrderQty: null } }), "update");
    assert.deepEqual([u.outcome, u.item.cost, u.item.leadTimeDays, u.item.minOrderQty, u.item.version], ["updated", "11.75", 10, null, 2]);
    // The same request again: already applied -> replayed, nothing written.
    assert.equal(ok(await call(manager, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: 1,
      changes: { cost: "11.75", leadTimeDays: 10, minOrderQty: null } }), "replay").outcome, "replayed");
    refused(await call(manager, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: 1, changes: { supplierSku: "ARC-NEW" } }),
      409, "CONFLICT", /changed since/, "stale version");
    refused(await call(manager, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: 2, changes: { cost: "11.7500" } }),
      412, "PRECONDITION_FAILED", /already the stored/, "NO_CHANGES");
    refused(await call(manager, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: 2, changes: {} }), 412, "PRECONDITION_FAILED", /at least one/);
    for (const field of ["partId", "supplierId", "status", "preferred"]) {
      refused(await call(manager, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: 2, changes: { [field]: "x" } }),
        400, "INVALID_INPUT", new RegExp(`does not accept: ${field}`), `${field} is not updatable`);
    }
    refused(await call(manager, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: 2, changes: { contractStart: "2027-01-01" } }),
      400, "INVALID_INPUT", /must not precede/, "the window is checked against the merged record");
    refused(await call(manager, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: 2, changes: { supplierSku: null } }),
      400, "INVALID_INPUT", /cannot be cleared/);
    refused(await call(manager, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: 2,
      changes: { purchaseUnit: "FOOT", conversionToStockingUnit: { numerator: 1, denominator: 1 } } }), 400, "INVALID_INPUT", /not in the family/);
    refused(await call(manager, "updatePartSupplierItem", { itemId: "P-100__sup-nope", expectedVersion: 1, changes: { cost: "1" } }), 404, "NOT_FOUND");
    const cleared = ok(await call(manager, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: 2,
      changes: { purchaseUnit: null, conversionToStockingUnit: null, lastVerifiedAt: "2026-10-01T12:00:00Z" } }), "clear conversion");
    assert.deepEqual([cleared.item.purchaseUnit, cleared.item.conversionToStockingUnit, cleared.item.lastVerifiedAt, cleared.item.version],
      [null, null, "2026-10-01T12:00:00Z", 3]);
    const rows = (await audits("P-100__sup-arctic")).filter((a) => a.action === "partSupplierItem.update");
    assert.equal(rows.length, 2, "one row per applied update; none for replay or refusal");
    assert.deepEqual([rows[0].before.cost, rows[0].after.cost, rows[0].before.version, rows[0].after.version], ["12.5", "11.75", 1, 2]);
    assert.match(rows[0].reason, /cost, leadTimeDays, minOrderQty/);
    assert.equal(await auditCount(), before + 2);
  });

  await t.test("preferred: needs an ACTIVE item, clears the incumbent atomically, one audit row states both", async () => {
    ok(await call(manager, "createPartSupplierItem", { partId: "P-100", supplierId: "sup-cold", supplierSku: "CC-1", cost: "3", currency: "USD", leadTimeDays: 2 }), "cold");
    ok(await call(manager, "createPartSupplierItem", { partId: "P-100", supplierId: "sup-delta", supplierSku: "DW-1", cost: "4", currency: "USD", leadTimeDays: 1 }), "delta");
    const p1 = ok(await call(manager, "setPreferredPartSupplierItem", { partId: "P-100", itemId: "P-100__sup-cold", expectedVersion: 1 }), "prefer cold");
    assert.deepEqual([p1.outcome, p1.item.preferred, p1.item.version, p1.clearedItemId], ["preferred", true, 2, null]);
    assert.equal(ok(await call(manager, "setPreferredPartSupplierItem", { partId: "P-100", itemId: "P-100__sup-cold", expectedVersion: 2 }), "again").outcome, "unchanged");
    refused(await call(manager, "setPreferredPartSupplierItem", { partId: "P-100", itemId: "P-100__sup-delta", expectedVersion: 9 }), 409, "CONFLICT", /changed since/);
    refused(await call(manager, "setPreferredPartSupplierItem", { partId: "P-GAL", itemId: "P-100__sup-delta", expectedVersion: 1 }), 404, "NOT_FOUND",
      /for this part/, "the item must belong to the named part");
    const p2 = ok(await call(manager, "setPreferredPartSupplierItem", { partId: "P-100", itemId: "P-100__sup-delta", expectedVersion: 1 }), "prefer delta");
    assert.deepEqual([p2.item.preferred, p2.clearedItemId], [true, "P-100__sup-cold"]);
    const preferred = (await q(`SELECT item_id, version FROM eos_ops.supplier_catalog_items WHERE tenant_id='t1' AND part_id='P-100' AND preferred`)).rows;
    assert.deepEqual(preferred.map((r) => r.item_id), ["P-100__sup-delta"], "exactly one preferred");
    assert.equal((await one(`SELECT version FROM eos_ops.supplier_catalog_items WHERE tenant_id='t1' AND item_id='P-100__sup-cold'`)).version, 3, "the incumbent was released");
    const rows = (await audits("P-100__sup-delta")).filter((a) => a.action === "partSupplierItem.setPreferred");
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].before.clearedItem.preferred, rows[0].after.clearedItem.preferred, rows[0].after.item.preferred], [true, false, true]);
    assert.equal((await audits("P-100__sup-cold")).filter((a) => a.action === "partSupplierItem.setPreferred").length, 1, "cold's own preference, once");
  });

  await t.test("status: inventory.catalog.activate; deactivating the preferred item clears it; same status is UNCHANGED", async () => {
    const before = await auditCount();
    refused(await call(manager, "setPartSupplierItemStatus", { itemId: "P-100__sup-delta", expectedVersion: 2, status: "INACTIVE" }), 403, "FORBIDDEN",
      /inventory\.catalog\.activate/, "manage alone does not change status");
    const d = ok(await call(administrator, "setPartSupplierItemStatus", { itemId: "P-100__sup-delta", expectedVersion: 2, status: "INACTIVE", reason: "supplier stopped stocking it" }), "deactivate");
    assert.deepEqual([d.outcome, d.item.status, d.item.preferred, d.item.version], ["deactivated", "INACTIVE", false, 3]);
    assert.equal(ok(await call(administrator, "setPartSupplierItemStatus", { itemId: "P-100__sup-delta", expectedVersion: 3, status: "INACTIVE" }), "same").outcome, "unchanged");
    refused(await call(manager, "setPreferredPartSupplierItem", { partId: "P-100", itemId: "P-100__sup-delta", expectedVersion: 3 }), 412, "PRECONDITION_FAILED",
      /only ACTIVE/, "an INACTIVE item cannot be preferred");
    refused(await call(administrator, "setPartSupplierItemStatus", { itemId: "P-100__sup-delta", expectedVersion: 2, status: "ACTIVE" }), 409, "CONFLICT");
    refused(await call(administrator, "setPartSupplierItemStatus", { itemId: "P-100__sup-delta", expectedVersion: 3, status: "GONE" }), 400, "INVALID_INPUT");
    // A holder of activate ALONE may change status (the Firebase predicate), but may not read or edit terms.
    const r = ok(await call(activatorOnly, "setPartSupplierItemStatus", { itemId: "P-100__sup-delta", expectedVersion: 3, status: "ACTIVE" }), "reactivate");
    assert.deepEqual([r.outcome, r.item.status, r.item.preferred], ["activated", "ACTIVE", false]);
    refused(await call(activatorOnly, "listPartSupplierItems", { partId: "P-100" }), 403, "FORBIDDEN", /inventory\.catalog\.manage/);
    const rows = await audits("P-100__sup-delta");
    assert.deepEqual(rows.filter((a) => /activate$/.test(a.action)).map((a) => [a.action, a.reason]),
      [["partSupplierItem.deactivate", "supplier stopped stocking it"], ["partSupplierItem.activate", "part-supplier terms reactivated"]]);
    assert.equal(await auditCount(), before + 2);
  });

  await t.test("reactivation needs an ACTIVE supplier; the list shows INACTIVE items and supplier names", async () => {
    ok(await call(administrator, "setPartSupplierItemStatus", { itemId: "P-100__sup-cold", expectedVersion: 3, status: "INACTIVE" }), "deactivate cold");
    await q(`UPDATE eos_ops.suppliers SET status = 'INACTIVE' WHERE tenant_id='t1' AND supplier_id='sup-cold'`);
    refused(await call(administrator, "setPartSupplierItemStatus", { itemId: "P-100__sup-cold", expectedVersion: 4, status: "ACTIVE" }), 412, "PRECONDITION_FAILED", /supplier is not ACTIVE/);
    const list = ok(await call(manager, "listPartSupplierItems", { partId: "P-100" }), "list");
    assert.deepEqual(list.items.map((i) => [i.supplierName, i.status, i.supplierStatus]),
      [["Arctic Parts Supply", "ACTIVE", "ACTIVE"], ["ColdChain Components", "INACTIVE", "INACTIVE"], ["Delta Wholesale", "ACTIVE", "ACTIVE"]]);
    assert.deepEqual(list.supplierOptions, [], "every ACTIVE supplier already has terms for this part");
  });

  await t.test("authority: no manage = FORBIDDEN for every manage operation; a non-member is FORBIDDEN; nothing written or audited", async () => {
    const before = await auditCount();
    const asks = [
      ["listPartSupplierItems", { partId: "P-100" }],
      ["createPartSupplierItem", { partId: "P-GAL", supplierId: "sup-arctic", supplierSku: "X", cost: "1", currency: "USD", leadTimeDays: 1 }],
      ["updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: 3, changes: { cost: "1" } }],
      ["setPreferredPartSupplierItem", { partId: "P-100", itemId: "P-100__sup-arctic", expectedVersion: 3 }],
      ["setPartSupplierItemStatus", { itemId: "P-100__sup-arctic", expectedVersion: 3, status: "INACTIVE" }],
    ];
    for (const [operation, input] of asks) {
      refused(await call(member, operation, input), 403, "FORBIDDEN", /require inventory\.catalog\./, `member: ${operation}`);
      refused(await call(outsider, operation, input), 403, "FORBIDDEN", null, `non-member: ${operation}`);
      refused(await call(null, operation, input), 401, "UNAUTHENTICATED", null, `anonymous: ${operation}`);
    }
    assert.equal(await auditCount(), before);
    assert.equal((await one(`SELECT version FROM eos_ops.supplier_catalog_items WHERE tenant_id='t1' AND item_id='P-100__sup-arctic'`)).version, 3);
  });

  await t.test("TENANT ISOLATION: another tenant can neither read nor write this tenant's terms", async () => {
    const before = await auditCount();
    refused(await call(otherTenant, "listPartSupplierItems", { partId: "P-100" }), 404, "NOT_FOUND", /no part/);
    refused(await call(otherTenant, "updatePartSupplierItem", { itemId: "P-100__sup-arctic", expectedVersion: 3, changes: { cost: "0.01" } }), 404, "NOT_FOUND");
    refused(await call(otherTenant, "setPartSupplierItemStatus", { itemId: "P-100__sup-arctic", expectedVersion: 3, status: "INACTIVE" }), 404, "NOT_FOUND");
    refused(await call(otherTenant, "setPreferredPartSupplierItem", { partId: "P-100", itemId: "P-100__sup-arctic", expectedVersion: 3 }), 404, "NOT_FOUND");
    refused(await call(otherTenant, "createPartSupplierItem", { ...ARCTIC, partId: "P-100" }), 404, "NOT_FOUND", /no part/, "t1's part is not t2's");
    refused(await call(otherTenant, "createPartSupplierItem", { ...ARCTIC, partId: "P-T2", supplierId: "sup-cold" }), 404, "NOT_FOUND", /no supplier/, "t1's supplier is not t2's");
    assert.equal(await auditCount(), before, "no audit row in either tenant");
    // The same ids, in t2's OWN namespace, are t2's own records.
    const own = ok(await call(otherTenant, "createPartSupplierItem", { ...ARCTIC, partId: "P-T2" }), "t2 own");
    assert.equal(own.item.supplierName, "Arctic (other tenant)");
    assert.equal((await one(`SELECT tenant_id FROM eos_policy.audit_events WHERE target_id='P-T2__sup-arctic'`)).tenant_id, "t2");
    const t1 = ok(await call(manager, "listPartSupplierItems", { partId: "P-100" }), "t1 list");
    assert.equal(t1.items.some((i) => i.partId === "P-T2"), false);
    const t1Arctic = t1.items.find((i) => i.supplierId === "sup-arctic");
    assert.deepEqual([t1Arctic.cost, t1Arctic.version], ["11.75", 3], "t1's record is untouched");
  });

  await t.test("every audit row names an EOS Principal, never a Firebase uid", async () => {
    const actors = (await q(`SELECT DISTINCT actor_uid FROM eos_policy.audit_events WHERE target_kind = 'part_supplier_item'`)).rows.map((r) => r.actor_uid);
    const principals = new Set([manager, administrator, activatorOnly, otherTenant].map((a) => a.principalId));
    for (const a of actors) {
      assert.ok(principals.has(a), `${a} is an EOS principal`);
      assert.doesNotMatch(a, /^fb-/);
    }
  });
});
