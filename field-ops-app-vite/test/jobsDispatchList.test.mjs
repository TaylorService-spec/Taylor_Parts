// FIX JOBS AND DISPATCH (Owner 2026-10-16): the Jobs page groups the governed Work Order list by what can be done next.
// Run: node --test test/jobsDispatchList.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { JOB_SECTION, groupJobs, jobSectionFor } from "../src/domain/jobsDispatchList.js";

const at = (iso) => ({ toMillis: () => Date.parse(iso) });
const wo = (id, status, extra = {}) => ({ id, woNumber: id, status, ...extra });

test("every governed status lands in exactly one section; unknown is shown but never actionable", () => {
  assert.equal(jobSectionFor("SCHEDULED"), JOB_SECTION.READY_TO_DISPATCH);
  assert.equal(jobSectionFor("READY_TO_DISPATCH"), JOB_SECTION.TO_SCHEDULE);
  for (const s of ["DISPATCHED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS"]) assert.equal(jobSectionFor(s), JOB_SECTION.IN_FIELD, s);
  for (const s of ["COMPLETED", "CLOSED", "CANCELLED"]) assert.equal(jobSectionFor(s), JOB_SECTION.FINISHED, s);
  assert.equal(jobSectionFor("CREATED"), JOB_SECTION.NOT_READY);
  assert.equal(jobSectionFor("SOMETHING_NEW"), JOB_SECTION.NOT_READY);
});

test("sections come in working order and each is ordered for its purpose", () => {
  const groups = groupJobs([
    wo("done-old", "COMPLETED", { updatedAt: at("2030-10-01T10:00:00Z") }),
    wo("sch-late", "SCHEDULED", { scheduledStart: at("2030-10-02T15:00:00Z"), scheduledEnd: at("2030-10-02T17:00:00Z") }),
    wo("ready-low", "READY_TO_DISPATCH", { priority: 4, createdAt: at("2030-09-01T00:00:00Z") }),
    wo("created", "CREATED", { createdAt: at("2030-09-05T00:00:00Z") }),
    wo("sch-early", "SCHEDULED", { scheduledStart: at("2030-10-01T15:00:00Z"), scheduledEnd: at("2030-10-01T17:00:00Z") }),
    wo("ready-urgent", "READY_TO_DISPATCH", { priority: 1, createdAt: at("2030-09-20T00:00:00Z") }),
    wo("done-new", "CANCELLED", { updatedAt: at("2030-10-03T10:00:00Z") }),
    wo("field", "EN_ROUTE", { scheduledStart: at("2030-10-01T13:00:00Z"), scheduledEnd: at("2030-10-01T14:00:00Z") }),
  ]);
  assert.deepEqual(groups.map((g) => g.section),
    [JOB_SECTION.READY_TO_DISPATCH, JOB_SECTION.TO_SCHEDULE, JOB_SECTION.IN_FIELD, JOB_SECTION.NOT_READY, JOB_SECTION.FINISHED]);
  const ids = (k) => groups.find((g) => g.section === k).items.map((w) => w.id);
  assert.deepEqual(ids(JOB_SECTION.READY_TO_DISPATCH), ["sch-early", "sch-late"], "earliest start first");
  assert.deepEqual(ids(JOB_SECTION.TO_SCHEDULE), ["ready-urgent", "ready-low"], "highest priority first");
  assert.deepEqual(ids(JOB_SECTION.FINISHED), ["done-new", "done-old"], "most recently changed first");
});

test("ties keep the server's order and empty sections are omitted — nothing is promoted by name", () => {
  const groups = groupJobs([wo("Ordinary Customer", "SCHEDULED"), wo("Beacon Manufacturing", "SCHEDULED")]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].items.map((w) => w.id), ["Ordinary Customer", "Beacon Manufacturing"]);
  assert.deepEqual(groupJobs([]), []);
  assert.deepEqual(groupJobs(undefined), []);
});
