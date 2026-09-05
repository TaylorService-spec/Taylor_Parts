// Imported historical service -- the view model, and the separation it exists to keep.
//
// The single rule under test: an imported record must never be mistaken for a Work Order --
// not in the label, not in the counts, not in the shape of a row, and not by an absence that
// looks the same as a Work Order's absence.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildImportedServiceHistoryView,
  importedHistoryWorkOrderCount,
  IMPORTED_HISTORY_LABEL,
  IMPORTED_HISTORY_STATE,
  inertImportedServiceHistorySource,
} from "../src/domain/importedServiceHistoryView.js";

const ROW = {
  id: "SH-1",
  recordKind: "IMPORTED_SERVICE_HISTORY",
  serviceDate: "2019-06-14",
  summary: "Replaced evaporator fan motor",
  externalReference: "OLD-4471",
  technicianName: "R. Alvarez",
  equipmentSerialNumber: "SN-1001",
  locationName: "Main Plant",
  sourceSystem: "DATA_IMPORT",
  importJobId: "IMP-1",
};

const ok = (rows, over = {}) => ({ ok: true, rows, truncated: false, ...over });

// --------------------------------------------------------------- visibility

test("imported history IS visible: a record produces a rendered row", () => {
  const view = buildImportedServiceHistoryView({ source: ok([ROW]) });
  assert.equal(view.state, IMPORTED_HISTORY_STATE.READY);
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0].reference, "OLD-4471");
  assert.equal(view.rows[0].summary, "Replaced evaporator fan motor");
  assert.equal(view.rows[0].serviceDate, "2019-06-14");
});

test("it is labelled in THREE places -- heading, lede and every row", () => {
  const view = buildImportedServiceHistoryView({ source: ok([ROW, { ...ROW, id: "SH-2" }]) });
  assert.match(view.heading, /Imported historical service/i);
  // The lede says the thing outright rather than leaving the badge to imply it.
  assert.match(view.lede, /not Work Orders/i);
  // And every row carries it, because a row is what gets screenshotted and quoted back with
  // no heading attached.
  for (const row of view.rows) assert.equal(row.label, IMPORTED_HISTORY_LABEL);
  assert.equal(IMPORTED_HISTORY_LABEL, "IMPORTED HISTORY");
});

// --------------------------------------------------------------- not a Work Order

test("every row states, in the DATA, that it is not a Work Order", () => {
  const view = buildImportedServiceHistoryView({ source: ok([ROW]) });
  // A consumer asking the question gets a definite no rather than having to know. A code path
  // that had to remember would eventually forget.
  assert.equal(view.rows[0].isWorkOrder, false);
});

test("imported history contributes ZERO to Work Order counts", () => {
  // The Service Activity counts are Work Order counts. Imported history must not move them by
  // one, and this is that claim made executable rather than left as a comment.
  assert.equal(importedHistoryWorkOrderCount(), 0);
});

test("no imported row carries a Work Order's live fields", () => {
  const row = buildImportedServiceHistoryView({ source: ok([{ ...ROW, status: "COMPLETED", assignedTechId: "emp-1" }]) })
    .rows[0];
  // Even when the stored document somehow carried them, the view does not surface a status, a
  // schedule or an assignment -- the three things that would make a historical record read as
  // a job EOS ran.
  for (const forbidden of ["status", "scheduledStart", "assignedTechId", "woNumber"]) {
    assert.equal(row[forbidden], undefined, `${forbidden} must not reach a row`);
  }
});

// --------------------------------------------------------------- no false links

test("the technician is presented as recorded TEXT, never as an EOS employee", () => {
  const row = buildImportedServiceHistoryView({ source: ok([ROW]) }).rows[0];
  assert.equal(row.technician, "R. Alvarez");
  // No id reaches the view, so nothing downstream can resolve one by accident.
  assert.equal(row.technicianId, undefined);
});

test("the equipment serial is presented as recorded TEXT, never as an EOS equipment link", () => {
  const row = buildImportedServiceHistoryView({ source: ok([ROW]) }).rows[0];
  assert.equal(row.equipmentSerial, "SN-1001");
  assert.equal(row.equipmentId, undefined);
});

test("a missing technician states its absence rather than rendering blank", () => {
  const row = buildImportedServiceHistoryView({ source: ok([{ ...ROW, technicianName: "" }]) }).rows[0];
  // A blank cell reads as a rendering failure, and these rows genuinely often lack a technician.
  assert.equal(row.technician, null);
  assert.equal(row.reference, "OLD-4471");
});

test("a record with no source reference still renders, and says so", () => {
  const row = buildImportedServiceHistoryView({ source: ok([{ ...ROW, externalReference: null }]) }).rows[0];
  assert.equal(row.reference, "No reference recorded");
});

// --------------------------------------------------------------- fail closed

test("DENIED is its own state, distinct from an error and from empty", () => {
  const denied = buildImportedServiceHistoryView({ source: { ok: false, code: "denied" } });
  const failed = buildImportedServiceHistoryView({ source: { ok: false, code: "error" } });
  const empty = buildImportedServiceHistoryView({ source: ok([]) });

  // "You may not see this", "this could not be read" and "there is none" are three different
  // facts about the same empty space, and the thing to go and fix differs for each.
  assert.equal(denied.state, IMPORTED_HISTORY_STATE.DENIED);
  assert.equal(failed.state, IMPORTED_HISTORY_STATE.ERROR);
  assert.equal(empty.state, IMPORTED_HISTORY_STATE.EMPTY);
  assert.equal(denied.rows.length, 0);
  assert.equal(failed.rows.length, 0);
});

test("a denied or failed read yields NO rows -- it never falls back to showing something", () => {
  for (const code of ["denied", "error"]) {
    assert.deepEqual(buildImportedServiceHistoryView({ source: { ok: false, code, rows: [ROW] } }).rows, []);
  }
});

test("loading is distinct from every terminal state", () => {
  assert.equal(buildImportedServiceHistoryView({ loading: true, source: ok([ROW]) }).state, IMPORTED_HISTORY_STATE.LOADING);
});

test("INERT and EMPTY both render nothing, and are still different states", () => {
  // Nothing was asked vs asked-and-found-nothing. Both draw no UI -- a permanent "no imported
  // history" line on every customer page is noise about a migration that is over -- but they
  // are not the same fact and are not collapsed.
  assert.equal(buildImportedServiceHistoryView({ source: inertImportedServiceHistorySource() }).state, IMPORTED_HISTORY_STATE.INERT);
  assert.equal(buildImportedServiceHistoryView({ source: null }).state, IMPORTED_HISTORY_STATE.INERT);
  assert.equal(buildImportedServiceHistoryView({ source: ok([]) }).state, IMPORTED_HISTORY_STATE.EMPTY);
});

test("truncation is stated rather than implying the list is complete", () => {
  const view = buildImportedServiceHistoryView({ source: ok([ROW], { truncated: true }) });
  assert.equal(view.truncated, true);
});

// --------------------------------------------------------------- the Work Order path is untouched

test("the Work Order timeline and counts are read by code this feature did not touch", () => {
  // The integration is ADDITIVE. Service Activity's two counts and its Work Order timeline are
  // separate reads with separate state, and this asserts the module that owns them still names
  // only fieldops_wos -- an imported record must never reach a Work Order query.
  const src = readFileSync(new URL("../src/domain/accountWorkOrders.js", import.meta.url), "utf8");
  assert.ok(!/imported_service_history/.test(src), "the Work Order reads must not know this collection");
  assert.ok(!/IMPORTED/.test(src), "the Work Order reads must not branch on imported records");

  const view = readFileSync(new URL("../src/domain/serviceActivityView.js", import.meta.url), "utf8");
  assert.ok(!/imported/i.test(view), "the Work Order view model must be unchanged by this feature");
});

test("the section reads through the trusted callable, never a client query on the collection", () => {
  // `imported_service_history` is deny-all in Rules; a client query would be a second, weaker
  // path to records carrying another system's free text.
  const seam = readFileSync(new URL("../src/access/importedServiceHistorySource.js", import.meta.url), "utf8");
  assert.ok(/httpsCallable/.test(seam));
  assert.ok(!/collection\(/.test(seam), "no client Firestore query may exist for this collection");
});
