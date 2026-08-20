// Opportunity SECTION SAVE — pure draft→command mapping. No emulator, no React.
// Run: node --test test/opportunitySectionSave.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildSectionSaveInput,
  isOpportunityEditable,
  COMMAND_EDITABLE_FIELDS,
} from "../src/domain/opportunitySectionSave.js";
import { opportunityDetailModel, sectionDraft } from "../src/domain/opportunityFieldModel.js";

const BASE = { opportunityId: "opp-1", expectedUpdatedAtMillis: 1700, idempotencyKey: "k1" };

// ------------------------------------------------------------------ the rename

test("channel is renamed to salesChannel — the one place the two vocabularies disagree", () => {
  const { input } = buildSectionSaveInput({ ...BASE, draft: { channel: "RETAIL", expectedValue: 500 } });
  assert.equal(input.salesChannel, "RETAIL");
  assert.equal(input.channel, undefined, "the field-model name must not survive into the command input");
  assert.equal(input.expectedValue, 500, "everything else passes through unrenamed");
});

test("the version token and idempotency key are always carried", () => {
  const { input } = buildSectionSaveInput({ ...BASE, draft: { need: "two units" } });
  assert.equal(input.opportunityId, "opp-1");
  assert.equal(input.expectedUpdatedAtMillis, 1700, "without this the command rejects the call outright");
  assert.equal(input.idempotencyKey, "k1");
});

test("only the edited section's fields are sent — absent means leave alone", () => {
  const { input } = buildSectionSaveInput({ ...BASE, draft: { need: "two units" } });
  assert.deepEqual(Object.keys(input).sort(), ["expectedUpdatedAtMillis", "idempotencyKey", "need", "opportunityId"]);
});

test("an explicit null is preserved — clearing a value is not the same as omitting it", () => {
  const { input } = buildSectionSaveInput({ ...BASE, draft: { expectedValue: null } });
  assert.ok("expectedValue" in input, "a cleared field must be SENT as null, not dropped");
  assert.equal(input.expectedValue, null);
});

// ------------------------------------------------------- the failure that must be loud

test("a draft key the command cannot write is REPORTED, never silently dropped", () => {
  // The command ignores unknown keys by design. So a mismapped field would produce a save that
  // succeeded and changed nothing the user asked for -- the worst available outcome.
  const out = buildSectionSaveInput({ ...BASE, draft: { need: "x", stage: "DECISION" } });
  assert.ok(out.unsupported, "must report rather than return an input");
  assert.deepEqual(out.unsupported, ["stage"]);
  assert.equal(out.input, undefined, "nothing is sent when part of the draft cannot be honoured");
});

test("lifecycle fields are not writable through an ordinary edit", () => {
  for (const key of ["stage", "outcome", "salesOrderId", "opportunityNumber"]) {
    const out = buildSectionSaveInput({ ...BASE, draft: { [key]: "anything" } });
    assert.ok(out.unsupported?.includes(key), `${key} must not be sendable as an ordinary field edit`);
  }
});

// ----------------------------------------------------------------- drift, both ways

test("EVERY editable field the workspace offers has somewhere to go in the command", () => {
  // The real defect this prevents: the field model classified `nextAction` USER_MAINTAINED and
  // rendered an Edit affordance for it, while the command had no such field. The surface offered
  // an edit the system could not accept. This asserts over the ACTUAL rendered sections rather
  // than a hand-copied list, so adding a field to the model without a command fails here.
  const model = opportunityDetailModel({
    id: "o", channel: "RETAIL", expectedValue: 1, expectedCloseAt: 2, ownerEmployeeId: "e1",
    need: "n", lines: [], nextAction: "call", attention: [],
  });
  const offered = model.sections.filter((s) => s.editable);
  assert.ok(offered.length > 0);
  for (const section of offered) {
    const draft = sectionDraft(section);
    if (Object.keys(draft).length === 0) continue; // the qualification seam has no fields yet
    const out = buildSectionSaveInput({ ...BASE, draft });
    assert.equal(out.unsupported, undefined, `section "${section.id}" offers ${out.unsupported?.join(", ")} which no command can write`);
  }
});

test("the mirrored field list matches the server's own EDITABLE_OPPORTUNITY_FIELDS", () => {
  // Read from the authority's source rather than trusting a copy. If someone adds an editable
  // field server-side, this fails until the client mirror is updated -- which is the point.
  const src = readFileSync(new URL("../../functions/src/opportunity/opportunityCommands.ts", import.meta.url), "utf8");
  const block = src.split("export const EDITABLE_OPPORTUNITY_FIELDS = Object.freeze([")[1]?.split("]);")[0];
  assert.ok(block, "could not locate EDITABLE_OPPORTUNITY_FIELDS in the command source");
  const server = [...block.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...server].sort(), [...COMMAND_EDITABLE_FIELDS].sort());
});

// -------------------------------------------------------------- the record-level rule

test("a closed Opportunity is not editable — the mirror of the command's CLOSED guard", () => {
  assert.equal(isOpportunityEditable({ outcome: null }), true);
  assert.equal(isOpportunityEditable({ outcome: "WON" }), false, "editing WON terms would disagree with the Sales Order derived from them");
  assert.equal(isOpportunityEditable({ outcome: "LOST" }), false);
  assert.equal(isOpportunityEditable(null), false, "no row is not an editable row");
});
