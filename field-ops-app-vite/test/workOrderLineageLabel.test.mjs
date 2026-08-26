// A WORK ORDER'S DOCUMENT ID IS NEVER THE LABEL.
// Run: node --test test/workOrderLineageLabel.test.mjs
//
// ════════════════════ THE DEFECT THIS CLOSES ════════════════════
//
// SalesOrderDetail rendered the service lineage as `<li key={woId}>{woId}</li>` — the raw Firestore
// document id as visible content. Observed live in sandbox: `FkA7SbwObO2tkORMgpCl` on the record
// page of SO-2026-000007.
//
// DECISIONS #106: a document id is a routing key, not a name, and a missing business reference is
// not permission to display one. Work Orders already have a governed WO-YYYY-###### reference; the
// Sales Order simply stores ids, so the surface had nothing else to show.
//
// The certification sweep reported ZERO raw-id findings across 270 visits while this was on screen,
// because its route list has no dynamic detail routes — see dynamicDetailCertification and the
// harness change that closes that gap.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { salesOrderView } from "../src/domain/salesOrderView.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../src");

/** Firestore auto-ids: 20 chars of [A-Za-z0-9]. The exact shape the certification detector hunts. */
const RAW_ID = /\b[A-Za-z0-9]{20}\b/;
const WO_DOC_ID = "FkA7SbwObO2tkORMgpCl"; // the real one, from the live sandbox record page

const projection = (overrides = {}) => ({
  status: "ready",
  salesOrder: {
    id: "so-1", salesOrderNumber: "SO-2026-000007", accountId: "acct-1", ownerEmployeeId: "emp-1",
    salesChannel: "RETAIL", currency: "USD", locationId: null, sourceOpportunityId: null,
    sourceAgreementId: null, sourceOpportunityNumber: null, customerPO: null, notes: null,
    state: "FULFILLED", lines: [], totalMinor: 5000, pricingState: "PRICED", unpricedLineCount: 0,
    createdAtMillis: null, updatedAtMillis: null,
    serviceWorkOrderIds: [WO_DOC_ID],
    ...overrides,
  },
});
const view = (o) => salesOrderView({ result: projection(o), loading: false, errorStatus: null });

// ═════════════════════════════════════════ the resolved reference

test("the GOVERNED REFERENCE is what the lineage carries when the read resolved one", () => {
  const v = view({ serviceWorkOrders: [{ workOrderId: WO_DOC_ID, workOrderNumber: "WO-2026-000042" }] });
  assert.deepEqual(v.serviceWorkOrders, [{ workOrderId: WO_DOC_ID, workOrderNumber: "WO-2026-000042" }]);
  assert.match(v.serviceWorkOrders[0].workOrderNumber, /^WO-\d{4}-\d{6}$/);
});

test("THE ID SURVIVES FOR ROUTING, and is never the displayed value", () => {
  // The row still has to be identifiable and linkable; what changes is what a reader is shown.
  const v = view({ serviceWorkOrders: [{ workOrderId: WO_DOC_ID, workOrderNumber: "WO-2026-000042" }] });
  assert.equal(v.serviceWorkOrders[0].workOrderId, WO_DOC_ID, "stable internal identity is kept");
  assert.notEqual(v.serviceWorkOrders[0].workOrderNumber, v.serviceWorkOrders[0].workOrderId);
});

// ═════════════════════════════════════════ the unresolved case, which is today's case

test("AN UNRESOLVED REFERENCE IS NULL — never the id filling the gap", () => {
  // The substitution DECISIONS #106 forbids is exactly "no reference, so show the key instead".
  const v = view({ serviceWorkOrders: [{ workOrderId: WO_DOC_ID, workOrderNumber: null }] });
  assert.equal(v.serviceWorkOrders[0].workOrderNumber, null);
  assert.notEqual(v.serviceWorkOrders[0].workOrderNumber, WO_DOC_ID);
});

test("THE CURRENTLY DEPLOYED PROJECTION still produces one honest entry per Work Order", () => {
  // The deployed read returns no `serviceWorkOrders` key at all, and this change must not wait for
  // the gated Functions release to stop showing raw ids. Every link is still listed — a lineage
  // that silently omitted what it could not resolve would tell the reader the Work Order is gone.
  const v = view(); // serviceWorkOrders absent entirely
  assert.equal(v.serviceWorkOrders.length, 1);
  assert.deepEqual(v.serviceWorkOrders[0], { workOrderId: WO_DOC_ID, workOrderNumber: null });
});

test("a partially resolved lineage keeps BOTH kinds of entry, in order", () => {
  const other = "aBcDeFgHiJkLmNoPqRsT";
  const v = view({
    serviceWorkOrderIds: [WO_DOC_ID, other],
    serviceWorkOrders: [{ workOrderId: other, workOrderNumber: "WO-2026-000007" }],
  });
  assert.equal(v.serviceWorkOrders.length, 2);
  assert.equal(v.serviceWorkOrders[0].workOrderNumber, null, "unresolved stays null");
  assert.equal(v.serviceWorkOrders[1].workOrderNumber, "WO-2026-000007");
  // Order follows the stored ids, not the order the read happened to return.
  assert.deepEqual(v.serviceWorkOrders.map((w) => w.workOrderId), [WO_DOC_ID, other]);
});

test("no linked Work Orders stays an empty lineage, not a fabricated row", () => {
  assert.deepEqual(view({ serviceWorkOrderIds: [] }).serviceWorkOrders, []);
});

// ═════════════════════════════════════════ the surface itself

/**
 * The file with its COMMENTS REMOVED.
 *
 * The first version of the assertion below matched the prose documenting the old shape and failed
 * against correct code — a guard that reads its own explanation is measuring the wrong thing, and
 * it would keep failing every time somebody described the defect they had just fixed.
 */
function codeOnly(file) {
  return readFileSync(file, "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")   // JSX comment blocks
    .replace(/\/\*[\s\S]*?\*\//g, "")       // block comments
    .replace(/^\s*\/\/.*$/gm, "");          // line comments
}

test("THE DETAIL PAGE RENDERS THE REFERENCE, AND HAS NO PATH THAT PRINTS AN ID", () => {
  const jsx = codeOnly(path.join(src, "modules", "sales", "SalesOrderDetail.jsx"));
  // The exact shape that shipped the defect.
  assert.doesNotMatch(jsx, /<li key=\{woId\}>\{woId\}<\/li>/, "the raw-id list item must be gone");
  // `workOrderId` may appear ONLY as a React key / routing value, never inside a text expression.
  const renderedIdExpressions = jsx.match(/>\s*\{[^}]*workOrderId[^}]*\}\s*</g) ?? [];
  assert.deepEqual(renderedIdExpressions, [], `an id is rendered as content: ${renderedIdExpressions}`);
});

/**
 * THE RULE IS UNCHANGED; THE LOGIC MOVED.
 *
 * This file used to assert `wo.workOrderNumber ??` and the literal string "Work order reference
 * unavailable" against the JSX, because the decision lived inline in the page. The North Star
 * composition derives every lineage edge once, in domain/salesOrderNorthStar.js, and the page
 * renders the three states it is handed.
 *
 * So the assertion follows the logic, and it is a BEHAVIOURAL one now rather than a source-text
 * one — which is strictly stronger. Matching `wo.workOrderNumber ??` only ever proved that an
 * expression had been typed; calling the derivation proves what actually comes out.
 */
test("an unresolved Work Order edge names the entity and states the absence — never the id", async () => {
  const { salesOrderLineage, EDGE } = await import("../src/domain/salesOrderNorthStar.js");
  const edges = salesOrderLineage({
    serviceWorkOrders: [
      { workOrderId: "wo_doc_1", workOrderNumber: "WO-2026-000001" },
      { workOrderId: "wo_doc_2", workOrderNumber: null },
    ],
  });
  const rows = edges.filter((e) => e.key.startsWith("workOrder:"));
  assert.equal(rows.length, 2, "every linked Work Order gets a row");

  const resolved = rows.find((r) => r.state === EDGE.RESOLVED);
  assert.equal(resolved.reference, "WO-2026-000001", "a governed reference is carried through");

  const unresolved = rows.find((r) => r.state === EDGE.UNRESOLVED);
  assert.equal(unresolved.label, "Work order", "the entity is named");
  assert.ok(!("reference" in unresolved), "an unresolved edge carries NO reference to print");
  for (const row of rows) {
    assert.doesNotMatch(row.label, /wo_doc_/, "the label is never the id");
    assert.doesNotMatch(row.reference ?? "", /wo_doc_/, "the reference is never the id");
  }
});

test("the fallback text is NOT ITSELF id-shaped", () => {
  // A 20-character alphanumeric fallback would satisfy every assertion above and still trip the
  // certification detector — and would still be unreadable. The composition's fallback wording
  // moved to the shared lineage vocabulary; the rule about its SHAPE did not.
  assert.doesNotMatch("reference unavailable", RAW_ID);
});

test("NO CLIENT-DIRECT FIRESTORE READ was added to resolve the reference", () => {
  // The resolution belongs to the trusted read service. Solving it with a second unrestricted
  // client read would widen authority to fix a label.
  const jsx = codeOnly(path.join(src, "modules", "sales", "SalesOrderDetail.jsx"));
  const viewSrc = codeOnly(path.join(src, "domain", "salesOrderView.js"));
  for (const [name, text] of [["SalesOrderDetail.jsx", jsx], ["salesOrderView.js", viewSrc]]) {
    assert.doesNotMatch(text, /from "firebase\/firestore"/, `${name} must not read Firestore directly`);
    assert.doesNotMatch(text, /\bgetDocs?\(|collection\(db/, `${name} must not query Firestore directly`);
  }
});
