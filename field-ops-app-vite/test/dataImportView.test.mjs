// Administration -> Data Import -- the view model.
//
// The rules worth testing here are all about what an operator is TOLD. An import screen has
// five different ways to look empty and they mean completely different things; conflating
// any two of them is the failure this file exists to stop.
import test from "node:test";
import assert from "node:assert/strict";

import { buildDataImportView, dataImportSubtitle, rowTone, IMPORT_STAGE } from "../src/domain/dataImportView.js";

const GATED = { canStage: true, canExecute: true };

// CUSTOMERS, not PARTS: under an ACTIVE PostgreSQL catalog a Part file is refused outright (see the
// Catalog-authority tests at the bottom), so the generic preview rules are exercised on an entity that
// reaches no Catalog collection.
function stagedJob({ ready = 2, warnings = 0, errors = 0, entityType = "CUSTOMERS" } = {}) {
  return {
    staged: true,
    job: {
      jobId: "IMP-1",
      entityType,
      fileName: "seeded-customers.csv",
      mapping: { NAME: "name" },
      summary: { total: ready + warnings + errors, ready, warnings, errors },
      rows: [],
    },
  };
}

test("no staging capability is its own state, and it NAMES what is missing", () => {
  const view = buildDataImportView({ canStage: false });
  assert.equal(view.stage, IMPORT_STAGE.UNGATED);
  // "Contact your administrator" is useless on the administrator's own screen. The
  // capability id is the actionable fact.
  assert.match(view.detail, /admin\.dataImport\.stage/);
});

test("no file chosen is NOT the same state as a file with nothing importable", () => {
  const idle = buildDataImportView(GATED);
  const nothing = buildDataImportView({ ...GATED, staged: stagedJob({ ready: 0, errors: 3 }) });

  assert.equal(idle.stage, IMPORT_STAGE.IDLE);
  assert.equal(nothing.stage, IMPORT_STAGE.PREVIEWED);
  assert.notEqual(idle.headline, nothing.headline);
  assert.match(nothing.headline, /No row in this file can be imported/);
});

test("an unmappable file is its own state, not an empty preview", () => {
  const view = buildDataImportView({
    ...GATED,
    staged: { staged: false, entityType: "CUSTOMERS", validation: { valid: false, findings: [] }, suggestions: [] },
  });
  assert.equal(view.stage, IMPORT_STAGE.MAPPING_INCOMPLETE);
  assert.match(view.headline, /cannot be imported as mapped/);
});

test("the preview says how many rows WILL be written, counting warnings as importable", () => {
  const view = buildDataImportView({ ...GATED, staged: stagedJob({ ready: 3, warnings: 2, errors: 1 }) });
  assert.equal(view.stage, IMPORT_STAGE.PREVIEWED);
  assert.equal(view.importable, 5);
  assert.match(view.headline, /5 of 6 rows will be imported/);
  assert.match(view.detail, /1 row is shown but will not be written/);
  assert.equal(view.approvalBlockedReason, null);
});

test("staging says nothing has been written; executing says do not close the tab", () => {
  const staging = buildDataImportView({ ...GATED, busy: true });
  const executing = buildDataImportView({ ...GATED, busy: true, staged: stagedJob() });
  assert.equal(staging.stage, IMPORT_STAGE.STAGING);
  assert.match(staging.detail, /Nothing has been written yet/);
  assert.equal(executing.stage, IMPORT_STAGE.EXECUTING);
});

test("approval is blocked WITH A REASON rather than the control disappearing", () => {
  const noExecute = buildDataImportView({ canStage: true, canExecute: false, staged: stagedJob() });
  // A control that vanishes reads as a missing feature; one that explains itself reads as
  // a permission the operator can go and ask for.
  assert.match(noExecute.approvalBlockedReason, /admin\.dataImport\.execute/);

  const nothingToDo = buildDataImportView({ ...GATED, staged: stagedJob({ ready: 0, errors: 2 }) });
  assert.equal(nothingToDo.approvalBlockedReason, "There is nothing to approve.");
});

test("a partial import is reported as partial, never rounded up to success", () => {
  const view = buildDataImportView({
    ...GATED,
    result: { result: { created: 8, replayed: 0, failed: 2, rows: [] } },
  });
  assert.equal(view.stage, IMPORT_STAGE.DONE);
  assert.match(view.headline, /Imported 8, and 2 rows could not be written/);
});

test("a replay counts toward what the import ended up with, and a clean run says so plainly", () => {
  const view = buildDataImportView({ ...GATED, result: { result: { created: 3, replayed: 2, failed: 0, rows: [] } } });
  assert.match(view.headline, /Imported 5 records/);
  assert.match(view.detail, /Every approved row was written/);
});

test("an error replaces the flow rather than sitting quietly beside a stale preview", () => {
  const view = buildDataImportView({ ...GATED, staged: stagedJob(), error: { code: "X", message: "boom" } });
  assert.equal(view.stage, IMPORT_STAGE.FAILED);
  assert.equal(view.detail, "boom");
});

test("row tone maps to the shared semantic vocabulary", () => {
  assert.equal(rowTone("ERROR"), "critical");
  assert.equal(rowTone("WARNING"), "attention");
  assert.equal(rowTone("READY"), "positive");
});

test("the approval sentence names what THIS entity's write actually does", async () => {
  const { APPROVAL_CONSEQUENCE } = await import("../src/domain/dataImportView.js");
  // The catalog-bound sentences are proven with the Catalog authority INJECTED inactive: the sentences
  // still exist for the day a PostgreSQL-backed import answers, but they are not offered today.
  const view = (entityType) =>
    buildDataImportView({
      ...GATED,
      catalogAuthorityPostgresActive: false,
      staged: { staged: true, job: { entityType, summary: { total: 1, ready: 1, warnings: 0, errors: 0 }, rows: [], mapping: {} } },
    }).consequence;

  // Each sentence names a real difference in what the write means. A screen that said
  // "writes the records shown above" for all five would be telling four of them something
  // slightly untrue.
  assert.match(view("PARTS"), /DRAFT/);
  assert.match(view("CUSTOMERS"), /tax status/i);
  assert.match(view("INVENTORY"), /ledger movement/i);
  assert.match(view("SERVICE_HISTORY"), /not Work Orders/i);
  assert.equal(Object.keys(APPROVAL_CONSEQUENCE).length, 5);
});

test("an entity with no sentence still gets a true one rather than nothing", () => {
  const view = buildDataImportView({
    ...GATED,
    staged: { staged: true, job: { entityType: "SOMETHING_NEW", summary: { total: 1, ready: 1, warnings: 0, errors: 0 }, rows: [], mapping: {} } },
  });
  assert.match(view.consequence, /never overwrites/i);
});

// ════════════════ the Catalog activation: PARTS and INVENTORY are refused, not offered ════════════════
// ACTIVE is INJECTED (catalogAuthorityPostgresActive: true): the committed constant stays INACTIVE until the activation
// flip, and the refusal must be proven without it.
const ACTIVE = { ...GATED, catalogAuthorityPostgresActive: true };

test("under the ACTIVE PostgreSQL catalog a staged PARTS or INVENTORY file is refused with its own truthful sentence", () => {
  for (const [entityType, why] of [["PARTS", /write Parts into the retired Firestore catalog/], ["INVENTORY", /Firestore catalog, which stopped being current/]]) {
    const view = buildDataImportView({ ...ACTIVE, staged: stagedJob({ entityType }) });
    assert.equal(view.stage, IMPORT_STAGE.CATALOG_REFUSED, entityType);
    assert.equal(view.canExecute, false);
    assert.match(view.detail, why);
    assert.match(view.detail, /PostgreSQL/);
    assert.ok(view.approvalBlockedReason, "approval is blocked WITH a reason");
    // It is not a preview: the preview was computed against the retired Firestore catalog.
    assert.equal(view.job, undefined);
    assert.equal(view.importable, undefined);
  }
});

test("the refusal comes BEFORE the mapping state: fixing columns of a file that can never run is a dead end", () => {
  const view = buildDataImportView({
    ...ACTIVE,
    staged: { staged: false, entityType: "PARTS", validation: { valid: false, findings: [] }, suggestions: [] },
  });
  assert.equal(view.stage, IMPORT_STAGE.CATALOG_REFUSED);
});

test("entity types that reach no Catalog collection are unaffected", () => {
  for (const entityType of ["CUSTOMERS", "EQUIPMENT", "SERVICE_HISTORY"]) {
    const view = buildDataImportView({ ...ACTIVE, staged: stagedJob({ entityType }) });
    assert.equal(view.stage, IMPORT_STAGE.PREVIEWED, entityType);
    assert.equal(view.approvalBlockedReason, null);
  }
});

test("the page does not offer what it will refuse", () => {
  assert.doesNotMatch(dataImportSubtitle(true), /Load Parts|Load[^.]*Inventory/);
  assert.match(dataImportSubtitle(true), /Parts and Inventory import are unavailable/);
  assert.match(dataImportSubtitle(false), /Load Parts, Customers, Equipment, Inventory and Service History/);
});

test("the refusal is DORMANT unless the Catalog authority is ACTIVE: it follows the committed constant", async () => {
  const { CATALOG_AUTHORITY_POSTGRES_ACTIVE } = await import("../src/config/catalogAuthority.js");
  for (const entityType of ["PARTS", "INVENTORY"]) {
    const inactive = buildDataImportView({ ...GATED, catalogAuthorityPostgresActive: false, staged: stagedJob({ entityType }) });
    assert.equal(inactive.stage, IMPORT_STAGE.PREVIEWED, `${entityType} previews while INACTIVE`);
    const committed = buildDataImportView({ ...GATED, staged: stagedJob({ entityType }) });
    assert.equal(committed.stage === IMPORT_STAGE.CATALOG_REFUSED, CATALOG_AUTHORITY_POSTGRES_ACTIVE, entityType);
  }
  assert.equal(dataImportSubtitle(), dataImportSubtitle(CATALOG_AUTHORITY_POSTGRES_ACTIVE));
});
