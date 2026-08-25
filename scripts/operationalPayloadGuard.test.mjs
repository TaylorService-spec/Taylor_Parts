// OPERATIONAL PAYLOAD GUARD. What it must catch, and what it must never catch.
//
// ============================ WHAT IS BEING PROVEN ============================
//
//   * the shape of the file that caused this guard to exist is REFUSED -- a header of record-identity
//     fields with two hundred rows underneath, declaring nothing;
//
//   * an audit narrative that discusses that file BY NAME, at length, is not flagged. A guard that
//     fired on prose describing an export would be deleted by the first person it inconvenienced,
//     and it would deserve to be;
//
//   * a synthetic fixture is accepted because of what is IN it, not because of what it is called.
//     Renaming a production export must not launder it;
//
//   * the repository is clean right now, so the guard has a baseline rather than a to-do list.
//
// A failure here means somebody committed an operational record snapshot. That is the whole point.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ALLOWLIST, classifyFile, scanRepository } from "./operationalPayloadGuard.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(HERE, "..");

function rows(count, prefix = "TST-") {
  const body = [];
  for (let i = 0; i < count; i += 1) {
    body.push(`${prefix}${1000 + i},NOT_EXPOSED_IN_SOURCE,Widget ${i},EACH,DRAFT`);
  }
  return body.join("\n");
}

// ---------------------------------------------------------------------------------------------
// It catches the shape that caused it to exist
// ---------------------------------------------------------------------------------------------

test("a record snapshot with no declared provenance is refused", () => {
  const csv = `partId,internalPartNumber,name,stockingUnit,status\n${rows(190, "PRD-")}`;
  const verdict = classifyFile(csv, "docs/audits/whatever.csv");
  assert.equal(verdict.payload, true);
  assert.ok(verdict.recordFields.includes("partid"));
});

test("renaming a payload does not launder it", () => {
  // The filename is exactly what survives a mistake untouched, so it is not consulted.
  const csv = `accountId,email,name\n${Array.from({ length: 80 }, (_, i) =>
    `ACC-${i},person${i}@example.invalid,Name ${i}`).join("\n")}`;
  for (const name of ["notes.csv", "data.csv", "totally-fine.csv", "ticket-4821.csv"]) {
    assert.equal(classifyFile(csv, name).payload, true, name);
  }
});

test("several kinds of operational record are recognised", () => {
  const shapes = [
    "workOrderNumber,status,assignedTo",
    "employeeId,email,role",
    "invoiceNumber,accountId,amount",
    "serialNumber,equipmentId,locationId",
    "salesOrderId,accountId,total",
  ];
  for (const header of shapes) {
    const csv = `${header}\n${Array.from({ length: 60 }, (_, i) => `a${i},b${i},c${i}`).join("\n")}`;
    assert.equal(classifyFile(csv, "x.csv").payload, true, header);
  }
});

// ---------------------------------------------------------------------------------------------
// It does not catch what it must not
// ---------------------------------------------------------------------------------------------

test("an audit narrative that names an export is never inspected", () => {
  // Prose is not a structured payload, and this file discusses the removed export at length.
  const review = join(REPO_ROOT, "docs", "audits", "inv-convergence-b", "evidence-review.md");
  assert.ok(existsSync(review), "the audit narrative is missing, so this proves nothing");
  const text = readFileSync(review, "utf8");
  assert.ok(text.includes("production-parts-export"),
    "the narrative no longer names the export, so this test is no longer testing anything");

  const violations = scanRepository(REPO_ROOT).map((violation) => violation.path);
  assert.ok(!violations.some((path) => path.endsWith(".md")),
    "a markdown document was flagged as a payload");
});

test("the metadata evidence artifact that replaced the export is not a payload", () => {
  const evidence = join(REPO_ROOT, "docs", "audits", "inv-convergence-b",
    "production-parts-export.evidence.json");
  assert.ok(existsSync(evidence), "the replacement evidence artifact is missing");
  const parsed = JSON.parse(readFileSync(evidence, "utf8"));

  // Schema and counts, never values.
  assert.equal(parsed.recordCount, 190);
  assert.ok(Array.isArray(parsed.schema) && parsed.schema.includes("partId"));
  assert.equal(parsed.status, "REMOVED_FROM_REPOSITORY");
  assert.equal(parsed.aiIngestion.indexed, false);
  assert.ok(parsed.historyNote.includes("history"),
    "the artifact does not disclose that git history still holds the blob");
});

test("a synthetic fixture is accepted for what is in it, not what it is called", () => {
  const csv = `partId,name,provenance\n${Array.from({ length: 200 }, (_, i) =>
    `SYN-${i},Widget ${i},synthetic-fixture`).join("\n")}`;
  const verdict = classifyFile(csv, "production-customer-export.csv");
  assert.equal(verdict.payload, false, verdict.reason);
  assert.match(verdict.reason, /synthetic/);
});

test("a small diagnostic table is not a snapshot", () => {
  // Analyzer output with a handful of rejected rows is a finding, not a record dump.
  const csv = `rowNumber,proposedPartId,reasonCode\n${Array.from({ length: 6 }, (_, i) =>
    `${i},PART-${i},MALFORMED`).join("\n")}`;
  assert.equal(classifyFile(csv, "invalid-rows.csv").payload, false);
});

test("a matrix of roles and capabilities is not a record snapshot", () => {
  const csv = `role,object,create,read,update,delete\n${Array.from({ length: 120 }, (_, i) =>
    `ROLE_${i},object_${i},Y,Y,N,N`).join("\n")}`;
  assert.equal(classifyFile(csv, "3-detailed-crud.csv").payload, false,
    "governance matrices must not be treated as operational records");
});

// ---------------------------------------------------------------------------------------------
// The repository itself
// ---------------------------------------------------------------------------------------------

test("the repository currently contains no committed operational payload", () => {
  const violations = scanRepository(REPO_ROOT);
  assert.deepEqual(violations, [],
    `committed operational payload(s):\n${violations.map((v) => `  ${v.path} — ${v.reason}`).join("\n")}`);
});

test("the removed production export is gone from the tree", () => {
  const removed = join(REPO_ROOT, "docs", "audits", "inv-convergence-b", "production-parts-export.csv");
  assert.ok(!existsSync(removed), "the production export is still committed");
});

test("every allowlist entry names a file that exists and states a reason", () => {
  // An allowlist that accumulates dead entries becomes a place to put things.
  for (const [path, reason] of ALLOWLIST) {
    assert.ok(existsSync(join(REPO_ROOT, path)), `allowlisted but missing: ${path}`);
    assert.ok(reason && reason.length > 20, `allowlist entry lacks a real reason: ${path}`);
  }
});
