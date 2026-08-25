// THE COORDINATED SURFACES NAME THE SALES ORDER, NOT ITS KEY.
// Run: node --test test/serviceAnchorReference.test.mjs
//
// ════════════════════ THE DEFECT THIS CLOSES ════════════════════
//
// Coordinated Visits and Coordinated Mission each rendered:
//
//     ctx.salesOrderLabelById[id] || id
//
// and `coordinatedOperationsSource.js` built that label map EMPTY — its own comment said so:
// "every id renders via its raw value (the UI's own `nameOr` fallback) until name resolution is
// connected". So both surfaces printed `cIk3hlPDTXH5IB3VHdLy` at the top of the screen.
//
// DECISIONS #106: a document id is a routing key, not a name, and a missing reference is not
// permission to display one.
//
// The Sales Order already owns SO-YYYY-######. Nothing needed inventing — the read simply never
// carried it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { salesOrderAnchorLabel, SALES_ORDER_ANCHOR_UNRESOLVED } from "../src/domain/coordinatedVisit.js";
import { mapCoordinatedOperationsReadResult } from "../src/access/coordinatedOperationsSource.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "..", "src");
const RAW_ID = /\b[A-Za-z0-9]{20}\b/;
const DOC_ID = "cIk3hlPDTXH5IB3VHdLy"; // the real one, observed live on all three Service routes

// ═════════════════════════════════════════ the label itself

test("A RESOLVED REFERENCE IS RENDERED", () => {
  assert.equal(salesOrderAnchorLabel({ [DOC_ID]: "SO-2026-000003" }, DOC_ID), "SO-2026-000003");
  assert.equal(salesOrderAnchorLabel({ [DOC_ID]: "  SO-2026-000003  " }, DOC_ID), "SO-2026-000003", "trimmed");
});

test("AN UNRESOLVED REFERENCE NEVER FALLS BACK TO THE KEY", () => {
  // The exact substitution that shipped. Every one of these used to render the document id.
  for (const map of [{}, null, undefined, { [DOC_ID]: "" }, { [DOC_ID]: "   " }, { [DOC_ID]: null }, { [DOC_ID]: 42 }, { other: "SO-1" }]) {
    const label = salesOrderAnchorLabel(map, DOC_ID);
    assert.equal(label, SALES_ORDER_ANCHOR_UNRESOLVED, `map ${JSON.stringify(map)}`);
    assert.notEqual(label, DOC_ID);
    assert.doesNotMatch(label, RAW_ID, "the fallback must not itself be id-shaped");
  }
});

test("the fallback says WHAT it is, and does not imply a number exists", () => {
  // "Sales Order — reference unavailable" names the entity and states the gap. It does not invent a
  // number, abbreviate the key, or dress a hash as a reference.
  assert.match(SALES_ORDER_ANCHOR_UNRESOLVED, /Sales Order/);
  assert.match(SALES_ORDER_ANCHOR_UNRESOLVED, /unavailable/i);
  assert.doesNotMatch(SALES_ORDER_ANCHOR_UNRESOLVED, /SO-\d/, "it must not look like an allocated reference");
});

test("a missing salesOrderId is still not an excuse to render something id-shaped", () => {
  for (const id of [null, undefined, ""]) {
    assert.equal(salesOrderAnchorLabel({ [DOC_ID]: "SO-2026-000003" }, id), SALES_ORDER_ANCHOR_UNRESOLVED);
  }
});

// ═════════════════════════════════════════ both backend shapes

test("THE CURRENTLY DEPLOYED PROJECTION — no salesOrderReferences at all", () => {
  // Functions are intentionally behind Hosting. Today's read returns no reference map, and the
  // surface must degrade to the truthful fallback rather than to the key it used to print.
  const snapshot = mapCoordinatedOperationsReadResult({
    ok: true,
    payload: { workOrders: [{ id: "wo-1", salesOrderId: DOC_ID }] },
  });
  assert.equal(snapshot.status, "ready");
  assert.deepEqual(snapshot.salesOrderLabelById, {}, "absent means empty, never fabricated");
  assert.equal(salesOrderAnchorLabel(snapshot.salesOrderLabelById, DOC_ID), SALES_ORDER_ANCHOR_UNRESOLVED);
});

test("THE CURRENT-MAIN PROJECTION — references carried through and rendered", () => {
  // When the richer read ships, the SAME client code shows real references with no further change.
  const snapshot = mapCoordinatedOperationsReadResult({
    ok: true,
    payload: {
      workOrders: [{ id: "wo-1", salesOrderId: DOC_ID }],
      salesOrderReferences: { [DOC_ID]: "SO-2026-000003" },
    },
  });
  assert.deepEqual(snapshot.salesOrderLabelById, { [DOC_ID]: "SO-2026-000003" });
  assert.equal(salesOrderAnchorLabel(snapshot.salesOrderLabelById, DOC_ID), "SO-2026-000003");
});

test("a malformed reference map cannot become the label source", () => {
  // A projection that returned the wrong shape must degrade, not throw and not leak.
  for (const bad of [null, "SO-1", 7, []]) {
    const snapshot = mapCoordinatedOperationsReadResult({
      ok: true,
      payload: { workOrders: [], salesOrderReferences: bad },
    });
    assert.equal(typeof snapshot.salesOrderLabelById, "object");
    assert.equal(salesOrderAnchorLabel(snapshot.salesOrderLabelById, DOC_ID), SALES_ORDER_ANCHOR_UNRESOLVED);
  }
});

test("denied and unavailable still carry an empty map, never a partial one", () => {
  for (const errorCode of ["permission-denied", "unavailable", "internal"]) {
    const snapshot = mapCoordinatedOperationsReadResult({ ok: false, errorCode });
    assert.deepEqual(snapshot.salesOrderLabelById, {});
  }
});

// ═════════════════════════════════════════ neither surface can regress alone

test("BOTH COORDINATED SURFACES USE THE SHARED HELPER", () => {
  // They had the identical defect in two files. A shared helper is what stops one being fixed and
  // the other quietly keeping the fallback — which is exactly how the Opportunity owner label
  // survived two rounds of fixes on the same page.
  for (const file of [
    ["modules", "service", "CoordinatedVisitsWorkspace.jsx"],
    ["modules", "mobile", "CoordinatedMissionView.jsx"],
  ]) {
    const text = readFileSync(path.join(src, ...file), "utf8");
    assert.match(text, /salesOrderAnchorLabel\(ctx\.salesOrderLabelById/, `${file.join("/")} must use the shared helper`);
    assert.doesNotMatch(
      text,
      /salesOrderLabelById\[[^\]]+\]\s*\|\|\s*\w+\.salesOrderId/,
      `${file.join("/")} must not fall back to the document id`,
    );
  }
});

test("MUTATION PROOF: the fallback would be caught if it returned the id", () => {
  // The guard above is a source assertion; this proves the BEHAVIOUR the detector hunts. If
  // salesOrderAnchorLabel ever returned the key again, a Firestore-shaped id would reach the screen
  // and the repaired RAW_ID detector would fire on it — as it now does, having been repaired from
  // literal 0x08 bytes this session.
  const wouldRegress = (map, id) => map?.[id] || id;      // the old implementation, verbatim
  assert.match(wouldRegress({}, DOC_ID), RAW_ID, "the old behaviour is exactly what the detector catches");
  assert.doesNotMatch(salesOrderAnchorLabel({}, DOC_ID), RAW_ID, "the new behaviour is not");
});
