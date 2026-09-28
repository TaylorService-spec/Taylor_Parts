// GOVERNED RUNTIME AUTHORITY, PROVED AGAINST A REAL POSTGRESQL -- the shared capability feed (Pass 11 Fix Wave 1).
//
// `resolveEffectiveAccess` is the ONE resolver every Firebase read callable asks (Opportunities, Sales Orders,
// Coordinated Visits, Receiving, Cycle Counts, account summaries, ...). In a governed environment it must answer every
// capability Administration governs from PostgreSQL alone. The world (support/governedRuntimeHarness.mjs) gives every
// caller a legacy Firestore admin role that the governed path must ignore. Conditions and direct exceptions are made
// through the governed Administration operations themselves, never by SQL.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { SKIP, buildGovernedWorld } from "./support/governedRuntimeHarness.mjs";

const require = createRequire(import.meta.url);
const { resolveEffectiveAccess } = require("../lib/access/effectiveAccessFeed.js");
const { __resetRuntimeCapabilityOverridesCacheForTest, resolveRuntimeCapabilityOverrides } = require("../lib/access/environmentCapabilityOverrides.js");
const { findPermission } = require("../lib/access/permissionCatalog.js");

test("governed capability feed: the Firebase runtime answers from PostgreSQL Administration", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { db, governed, admin, subjectOf, prnOf } = await buildGovernedWorld(t);
  const feed = (k, ids, g = governed) => resolveEffectiveAccess({ principalUid: subjectOf(k), permissionIds: ids }, { db, governed: g });
  process.env.GCLOUD_PROJECT = "eos-platform-sandbox";
  __resetRuntimeCapabilityOverridesCacheForTest();

  await t.test("the resolver answers every persona from PostgreSQL (NOT_A_PRINCIPAL for an unknown subject)", async () => {
    const tech = await governed(subjectOf("service-technician-a"));
    assert.equal(tech.status, "RESOLVED");
    assert.ok(tech.governedKeys.has("workOrder.record.read"));
    assert.equal((await governed("uid-nobody")).status, "NOT_A_PRINCIPAL");
  });

  await t.test("SALES READ: Retail and National Accounts hold customer, opportunity, agreement and order reads -- through PG", async () => {
    for (const k of ["retail-sales-a", "national-accounts-sales"]) {
      const { decisions } = await feed(k, ["customer.record.read", "opportunity.read", "salesAgreement.read", "salesOrder.read"]);
      assert.deepEqual(decisions, { "customer.record.read": true, "opportunity.read": true, "salesAgreement.read": true, "salesOrder.read": true }, k);
    }
  });

  await t.test("NEGATIVE: the legacy Firestore admin role no longer opens anything a PG Role does not grant", async () => {
    const { decisions } = await feed("retail-sales-a", ["admin.roleAssignment.write", "admin.securityPolicy.write", "admin.principalAccess.read"]);
    assert.deepEqual(Object.values(decisions), [false, false, false], "Sales gains no Administration authority");
  });

  await t.test("NEGATIVE: General Employee (restricted-user) remains refused", async () => {
    const ids = ["customer.record.read", "workOrder.record.read", "salesOrder.read", "finance.invoice.read", "inventory.catalog.read"];
    const { decisions } = await feed("restricted-user", ids);
    assert.deepEqual(Object.values(decisions), ids.map(() => false));
  });

  await t.test("NEGATIVE: Parts and Warehouse personas gain no Finance authority", async () => {
    for (const k of ["parts-associate", "warehouse-associate", "warehouse-manager"]) {
      const { decisions } = await feed(k, ["finance.adjustment.record", "finance.invoice.issue", "finance.payment.apply", "finance.refund.record"]);
      assert.deepEqual(Object.values(decisions), [false, false, false, false], k);
    }
  });

  await t.test("NEGATIVE: Finance gains no operational write authority", async () => {
    const writes = ["workOrder.create", "workOrder.lifecycle.dispatch", "inventory.stock.receive", "inventory.transfer.create",
      "inventory.cycleCount.reconcile", "salesOrder.write", "opportunity.write", "admin.roleAssignment.write"];
    const { decisions } = await feed("finance-controller", writes);
    assert.deepEqual(Object.values(decisions), writes.map(() => false));
  });

  await t.test("PARTS READ: the receiving clerk's governed grants reach the receiving reads", async () => {
    const { decisions } = await feed("parts-associate", ["receivingOrder.record.read", "inventory.stock.receive", "reorder.purchaseOrder.read"]);
    assert.deepEqual(decisions, { "receivingOrder.record.read": true, "inventory.stock.receive": true, "reorder.purchaseOrder.read": false });
  });

  await t.test("CONDITION: a RECORD_ASSIGNMENT-conditioned grant is never a flat capability-level ALLOW", async () => {
    assert.equal((await feed("service-technician-a", ["workOrder.record.read"])).decisions["workOrder.record.read"], true, "unconditioned (deployed) state");
    const set = await admin("setGrantCondition", { objectKey: "workOrder", actionKey: "read", roleKey: "technician",
      reason: "TEST: assignment-limited technician read",
      condition: { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" } });
    assert.equal(set.ok, true, JSON.stringify(set));
    assert.equal((await feed("service-technician-a", ["workOrder.record.read"])).decisions["workOrder.record.read"], false);
    assert.equal((await feed("service-manager", ["workOrder.record.read"])).decisions["workOrder.record.read"], true, "managers untouched");
  });

  await t.test("DIRECT EXCEPTION flows through the same resolver", async () => {
    assert.equal((await feed("records-clerk", ["customer.record.read"])).decisions["customer.record.read"], false);
    const g = await admin("grantObjectActionToPrincipal", { objectKey: "account", actionKey: "read",
      principalId: prnOf("records-clerk"), reason: "TEST: direct exception" });
    assert.equal(g.ok, true, JSON.stringify(g));
    assert.equal((await feed("records-clerk", ["customer.record.read"])).decisions["customer.record.read"], true);
  });

  await t.test("DOMAIN PREREQUISITE: a legacy-inactive capability stays refused even when PG grants it", async () => {
    const adminAccess = await governed(subjectOf("administrator"));
    const overrides = resolveRuntimeCapabilityOverrides();
    const held = [...adminAccess.actor.capabilities].filter((k) => findPermission(k)?.active === false && !overrides.has(k));
    const activated = [...adminAccess.actor.capabilities].filter((k) => findPermission(k)?.active === false && overrides.has(k));
    assert.ok(held.length + activated.length > 0, "the fixture exercises at least one legacy-inactive governed key");
    if (held.length) assert.deepEqual(Object.values((await feed("administrator", held)).decisions), held.map(() => false), held.join(","));
    if (activated.length) assert.deepEqual(Object.values((await feed("administrator", activated)).decisions), activated.map(() => true), activated.join(","));
  });

  await t.test("NON-GOVERNED ENVIRONMENT: production resolves exactly as before and never asks PostgreSQL", async () => {
    process.env.GCLOUD_PROJECT = "taylor-parts";
    __resetRuntimeCapabilityOverridesCacheForTest();
    let asked = 0;
    await feed("restricted-user", ["customer.record.read"], async (uid) => { asked += 1; return governed(uid); });
    assert.equal(asked, 0);
    process.env.GCLOUD_PROJECT = "eos-platform-sandbox";
    __resetRuntimeCapabilityOverridesCacheForTest();
  });

  await t.test("FAIL CLOSED: an unavailable policy database denies everything, legacy admin role or not", async () => {
    const { decisions } = await feed("administrator", ["customer.record.read", "finance.read"], async () => ({ status: "UNAVAILABLE", detail: "down" }));
    assert.deepEqual(decisions, { "customer.record.read": false, "finance.read": false });
  });
});
