// THE GOVERNED EMPLOYEE CHANGE HISTORY (EMP-RT-H1), domain -- listEmployeeChangeHistory items as Change History rows.
//
// Run: node --test test/employeeChangeHistoryDomain.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  GOVERNED_EMPLOYEE_HISTORY_ACTION,
  GOVERNED_EMPLOYEE_HISTORY_EVENT_LABELS,
  GOVERNED_EMPLOYEE_HISTORY_FIELD_LABELS,
  governedHistoryRows,
} from "../src/domain/employeeChangeHistory.js";
import { normalizeHistoryRows } from "../src/domain/changeHistory.js";

const present = (items) => normalizeHistoryRows(governedHistoryRows(items), {
  fieldLabels: GOVERNED_EMPLOYEE_HISTORY_FIELD_LABELS,
  eventLabels: GOVERNED_EMPLOYEE_HISTORY_EVENT_LABELS,
});
const item = (action, before, after, extra = {}) => ({
  eventId: `ev-${action}`, action, occurredAt: "2026-09-10T12:00:00.000Z", before, after, reason: null, changedBy: null, ...extra,
});

test("the client's closed action list is exactly the server's", () => {
  const server = readFileSync(new URL("../../functions/src/eosWorkforce/reads/employeeChangeHistoryRead.ts", import.meta.url), "utf8");
  const block = server.slice(server.indexOf("const ACTIONS = Object.freeze({"), server.indexOf("} as const satisfies"));
  const names = [...block.matchAll(/"(employee\.[a-zA-Z]+\.[a-zA-Z]+)":/g)].map((m) => m[1]);
  assert.deepEqual(Object.values(GOVERNED_EMPLOYEE_HISTORY_ACTION), names);
  for (const action of names) assert.ok(GOVERNED_EMPLOYEE_HISTORY_EVENT_LABELS[action], action);
});

test("a profile update is one row per changed field, in profile order, with the existing field labels", () => {
  const rows = present([item(GOVERNED_EMPLOYEE_HISTORY_ACTION.PROFILE_UPDATE,
    { workEmail: null, jobTitle: "Tech", "address.city": "Mesa" },
    { workEmail: "bob@example.com", jobTitle: "Lead", "address.city": "Phoenix" },
    { changedBy: { displayName: "Avery Admin" }, reason: "promotion" })]);
  assert.deepEqual(rows.map((r) => [r.fieldLabel, r.previousValue, r.newValue, r.changedByLabel]), [
    ["Job Title", "Tech", "Lead", "Avery Admin"],
    ["Work Email", null, "bob@example.com", "Avery Admin"],
    ["City", "Mesa", "Phoenix", "Avery Admin"],
  ]);
  assert.deepEqual([rows[0].reason, rows[0].occurredAt], ["promotion", Date.parse("2026-09-10T12:00:00.000Z")]);
  assert.ok(rows.every((r) => r.reason === "promotion"), "every field row of one event carries that event's reason");
  assert.equal(new Set(rows.map((r) => r.id)).size, 3, "row ids collide");
});

test("manager, Employment Status, Operating Company and Job Role read as words -- never ids", () => {
  const rows = present([
    item(GOVERNED_EMPLOYEE_HISTORY_ACTION.MANAGER_ESTABLISH, null, { managerEmployeeId: "e-9", managerDisplayName: "Mary" }),
    item(GOVERNED_EMPLOYEE_HISTORY_ACTION.MANAGER_END, { managerEmployeeId: "e-9", managerDisplayName: null }, null),
    item(GOVERNED_EMPLOYEE_HISTORY_ACTION.EMPLOYMENT_STATUS_CHANGE, { employmentStatus: "ACTIVE" }, { employmentStatus: "ON_LEAVE" }),
    item(GOVERNED_EMPLOYEE_HISTORY_ACTION.OPERATING_COMPANY_CHANGE, { operatingCompanyId: "taylor" }, { operatingCompanyId: "zz-unknown" }),
    item(GOVERNED_EMPLOYEE_HISTORY_ACTION.JOB_ROLE_ASSIGN, { jobRoleId: "retail-sales", jobRoleDisplayName: "Retail Sales" }, { jobRoleId: "x", jobRoleDisplayName: "National Accounts Sales" }),
  ]);
  assert.deepEqual(rows.map((r) => [r.fieldLabel, r.previousValue, r.newValue]), [
    ["Manager", null, "Mary"],
    ["Manager", "Unnamed employee", null],
    ["Employment Status", "Active", "On Leave"],
    ["Operating Company", "Taylor Freezer of Arizona", "Unrecognised company (zz-unknown)"],
    ["Job Role", "Retail Sales", "National Accounts Sales"],
  ]);
  const text = JSON.stringify(rows.map((r) => [r.previousValue, r.newValue]));
  assert.doesNotMatch(text, /e-9|retail-sales|"taylor"/);
});

test("changedBy is shown only when the server returned a name; an unknown action is not a row", () => {
  const rows = present([
    item(GOVERNED_EMPLOYEE_HISTORY_ACTION.EMPLOYMENT_STATUS_CHANGE, { employmentStatus: "ACTIVE" }, { employmentStatus: "INACTIVE" }),
    item("tenant.operatingCompanies.reconcile", { x: 1 }, { x: 2 }),
    item("jobRole.catalog.update", null, null),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, null, "an absent reason is null, never an empty string or a generated sentence");
  assert.deepEqual([rows[0].changedByLabel, rows[0].changedById], [null, ""]);
  assert.deepEqual(governedHistoryRows(null), []);
  assert.deepEqual(governedHistoryRows([{ action: GOVERNED_EMPLOYEE_HISTORY_ACTION.PROFILE_UPDATE }]), [], "an item without an event id became a row");
});
