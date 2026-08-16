import { test } from "node:test";
import assert from "node:assert/strict";
import { crmActivityView, mapCrmActivityErrorToStatus, CRM_ACTIVITY_VIEW_STATE } from "../src/domain/crmActivityView.js";

test("loading takes priority over everything else", () => {
  assert.equal(crmActivityView({ loading: true, errorStatus: "denied" }).kind, CRM_ACTIVITY_VIEW_STATE.LOADING);
});

test("errorStatus surfaces denied distinctly from unavailable -- DENIED never renders as EMPTY", () => {
  assert.equal(crmActivityView({ errorStatus: "denied" }).kind, CRM_ACTIVITY_VIEW_STATE.DENIED);
  assert.equal(crmActivityView({ errorStatus: "unavailable" }).kind, CRM_ACTIVITY_VIEW_STATE.UNAVAILABLE);
});

test("a missing/non-ready result reads unavailable, never fabricated as empty", () => {
  assert.equal(crmActivityView({ result: null }).kind, CRM_ACTIVITY_VIEW_STATE.UNAVAILABLE);
  assert.equal(crmActivityView({ result: { status: "unavailable" } }).kind, CRM_ACTIVITY_VIEW_STATE.UNAVAILABLE);
});

test("a genuinely empty activity list reads empty, distinct from unavailable", () => {
  assert.equal(crmActivityView({ result: { status: "ready", activities: [] } }).kind, CRM_ACTIVITY_VIEW_STATE.EMPTY);
});

test("mapCrmActivityErrorToStatus maps permission-denied to denied, everything else to unavailable", () => {
  assert.equal(mapCrmActivityErrorToStatus({ code: "functions/permission-denied" }), CRM_ACTIVITY_VIEW_STATE.DENIED);
  assert.equal(mapCrmActivityErrorToStatus({ code: "permission-denied" }), CRM_ACTIVITY_VIEW_STATE.DENIED);
  assert.equal(mapCrmActivityErrorToStatus({ code: "internal" }), CRM_ACTIVITY_VIEW_STATE.UNAVAILABLE);
  assert.equal(mapCrmActivityErrorToStatus(new Error("boom")), CRM_ACTIVITY_VIEW_STATE.UNAVAILABLE);
});

test("ready projects a row per activity with type label, timestamps, and resolved actor name", () => {
  const view = crmActivityView({
    result: {
      status: "ready",
      activities: [
        {
          id: "ACT-1", accountId: "ACCT-1", type: "CALL", body: "Talked pricing.",
          occurredAtMillis: 1000, createdAtMillis: 1000, createdByUid: "uid-1",
          contactId: null, opportunityId: "OPP-1", salesOrderId: null,
        },
      ],
    },
    resolveActorName: (uid) => (uid === "uid-1" ? "Jane Smith" : "Unknown user"),
  });
  assert.equal(view.kind, CRM_ACTIVITY_VIEW_STATE.READY);
  assert.equal(view.rows.length, 1);
  const row = view.rows[0];
  assert.equal(row.type, "CALL");
  assert.equal(row.typeLabel, "Call");
  assert.equal(row.body, "Talked pricing.");
  assert.equal(row.actorName, "Jane Smith");
  assert.equal(row.backdated, false);
  assert.equal(row.hasLinkedContext, true);
  assert.equal(row.opportunityId, "OPP-1");
});

test("a backdated entry (occurredAt !== createdAt) is flagged distinctly, never silently collapsed", () => {
  const view = crmActivityView({
    result: {
      status: "ready",
      activities: [
        { id: "ACT-2", accountId: "ACCT-1", type: "GENERAL", body: "x", occurredAtMillis: 1000, createdAtMillis: 5000, createdByUid: "u" },
      ],
    },
  });
  assert.equal(view.rows[0].backdated, true);
});

test("when resolveActorName is not supplied, the raw uid is returned as a fallback (caller's responsibility to resolve -- never invented)", () => {
  const view = crmActivityView({
    result: {
      status: "ready",
      activities: [{ id: "ACT-3", accountId: "ACCT-1", type: "GENERAL", body: "x", occurredAtMillis: 1000, createdAtMillis: 1000, createdByUid: "raw-uid" }],
    },
  });
  assert.equal(view.rows[0].actorName, "raw-uid");
});

test("hasLinkedContext is false when no commercial context is linked", () => {
  const view = crmActivityView({
    result: {
      status: "ready",
      activities: [{ id: "ACT-4", accountId: "ACCT-1", type: "GENERAL", body: "x", occurredAtMillis: 1000, createdAtMillis: 1000, createdByUid: "u", contactId: null, opportunityId: null, salesOrderId: null }],
    },
  });
  assert.equal(view.rows[0].hasLinkedContext, false);
});
