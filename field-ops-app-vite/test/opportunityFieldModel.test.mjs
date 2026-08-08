// Opportunity FIELD-CLASSIFICATION MODEL — pure unit tests (node:test). Proves the four data classes are
// kept distinct: USER_MAINTAINED is editable-by-design; SYSTEM_DERIVED (attention) and READ_ONLY (id/audit)
// are never editable; Stage / WON / LOST are NOT modeled as editable fields (they are governed lifecycle
// actions). Classification is independent of runtime write-readiness (that is the seam's job).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  opportunityDetailModel,
  editableSectionIds,
  sectionDraft,
  channelOptions,
  OPPORTUNITY_DATA_CLASS,
} from "../src/domain/opportunityFieldModel.js";
import { SALES_CHANNELS } from "../src/domain/opportunityLifecycle.js";

const ROW = {
  id: "SBX-OPP-1001",
  customerName: "Harbor Grill Downtown",
  channel: "RETAIL",
  stage: "QUOTING",
  outcome: null,
  expectedValue: 18500,
  expectedCloseAt: new Date(2026, 7, 20, 12).getTime(),
  ownerEmployeeId: "SBX-EMP-rivera",
  need: "Replace failed bar ice machine",
  lines: [{ kind: "EQUIPMENT_MODEL", ref: "Taylor-C723", qty: 1 }],
  nextAction: "Send revised quote",
  attention: [{ kind: "CLOSE_SOON", tone: "info", label: "Closing within a week" }],
};

const sectionById = (model, id) => model.sections.find((s) => s.id === id);
const fieldByKey = (section, key) => section.fields.find((f) => f.key === key);

test("commercial section: user-maintained editable fields with correct controls", () => {
  const model = opportunityDetailModel(ROW);
  const s = sectionById(model, "commercial");
  assert.equal(s.dataClass, OPPORTUNITY_DATA_CLASS.USER_MAINTAINED);
  assert.equal(s.editable, true);
  assert.equal(fieldByKey(s, "channel").control, "select");
  assert.equal(fieldByKey(s, "expectedValue").control, "currency");
  assert.equal(fieldByKey(s, "expectedCloseAt").control, "date");
  // Owner reassignment is user-maintained but GOVERNED (authorized change, not a free rename).
  const owner = fieldByKey(s, "ownerEmployeeId");
  assert.equal(owner.control, "owner");
  assert.equal(owner.governed, true);
});

test("need / solution / next-action are user-maintained editable sections", () => {
  const model = opportunityDetailModel(ROW);
  for (const id of ["need", "solution", "nextAction"]) {
    const s = sectionById(model, id);
    assert.equal(s.dataClass, OPPORTUNITY_DATA_CLASS.USER_MAINTAINED, `${id} class`);
    assert.equal(s.editable, true, `${id} editable`);
  }
  assert.equal(fieldByKey(sectionById(model, "solution"), "lines").control, "lines");
});

test("qualification is a preserved user-maintained SEAM (future, no invented fields)", () => {
  const model = opportunityDetailModel(ROW);
  const s = sectionById(model, "qualification");
  assert.equal(s.dataClass, OPPORTUNITY_DATA_CLASS.USER_MAINTAINED);
  assert.equal(s.editable, true);
  assert.equal(s.future, true);
  assert.equal(s.fields.length, 0);
});

test("attention is SYSTEM_DERIVED and never editable", () => {
  const model = opportunityDetailModel(ROW);
  const s = sectionById(model, "attention");
  assert.equal(s.dataClass, OPPORTUNITY_DATA_CLASS.SYSTEM_DERIVED);
  assert.equal(s.editable, false);
  assert.equal(s.fields.length, 1);
  assert.equal(s.fields[0].display, "Closing within a week");
});

test("record is READ_ONLY; absent audit timestamps render honestly, never fabricated", () => {
  const model = opportunityDetailModel(ROW); // ROW has no createdAt/updatedAt
  const s = sectionById(model, "record");
  assert.equal(s.dataClass, OPPORTUNITY_DATA_CLASS.READ_ONLY);
  assert.equal(s.editable, false);
  assert.equal(fieldByKey(s, "id").display, "SBX-OPP-1001");
  assert.equal(fieldByKey(s, "createdAt").display, "not recorded");
  assert.equal(fieldByKey(s, "updatedAt").display, "not recorded");
});

test("Stage / WON / LOST are NOT modeled as editable fields (governed lifecycle actions only)", () => {
  const model = opportunityDetailModel(ROW);
  const allFieldKeys = model.sections.flatMap((s) => s.fields.map((f) => f.key));
  assert.equal(allFieldKeys.includes("stage"), false);
  assert.equal(allFieldKeys.includes("outcome"), false);
  // and no LIFECYCLE_ACTION field leaks into the field model
  const anyLifecycleField = model.sections.some((s) =>
    s.fields.some((f) => f.dataClass === OPPORTUNITY_DATA_CLASS.LIFECYCLE_ACTION));
  assert.equal(anyLifecycleField, false);
});

test("editableSectionIds lists exactly the user-maintained sections", () => {
  const model = opportunityDetailModel(ROW);
  assert.deepEqual(editableSectionIds(model), ["commercial", "need", "solution", "nextAction", "qualification"]);
});

test("sectionDraft collects only user-maintained field values", () => {
  const model = opportunityDetailModel(ROW);
  const draft = sectionDraft(sectionById(model, "commercial"));
  assert.deepEqual(Object.keys(draft).sort(), ["channel", "expectedCloseAt", "expectedValue", "ownerEmployeeId"]);
  // a read-only section drafts to nothing (nothing is user-maintained there)
  assert.deepEqual(sectionDraft(sectionById(model, "record")), {});
});

test("channelOptions derives from the ratified SALES_CHANNELS (widens with capability #15, not hardcoded)", () => {
  assert.deepEqual(channelOptions().map((o) => o.value), SALES_CHANNELS);
});

test("null row yields an empty model (no crash)", () => {
  const model = opportunityDetailModel(null);
  assert.deepEqual(model.sections, []);
});

test("injected formatters produce display strings deterministically", () => {
  const model = opportunityDetailModel(ROW, { format: { currency: (v) => `$${v}`, date: () => "AUG" } });
  const s = sectionById(model, "commercial");
  assert.equal(fieldByKey(s, "expectedValue").display, "$18500");
  assert.equal(fieldByKey(s, "expectedCloseAt").display, "AUG");
});
