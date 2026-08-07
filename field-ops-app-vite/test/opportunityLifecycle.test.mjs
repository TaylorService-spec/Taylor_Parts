import test from "node:test";
import assert from "node:assert/strict";
import {
  OPPORTUNITY_STAGES,
  commercialState,
  deriveAttention,
  buildPipelineRow,
  buildOpportunityPipeline,
  stageLabel,
  channelLabel,
} from "../src/domain/opportunityLifecycle.js";

const NOW = new Date(2026, 7, 8, 12, 0, 0, 0).getTime(); // fixed "now" = Aug 8 2026
const day = 24 * 60 * 60 * 1000;

test("lifecycle vocabulary is the ratified ordered set", () => {
  assert.deepEqual(OPPORTUNITY_STAGES, ["IDENTIFIED", "QUALIFYING", "SOLUTION", "QUOTING", "CUSTOMER_REVIEW", "DECISION"]);
});

test("commercialState reads by outcome once closed, by stage while open", () => {
  assert.deepEqual(commercialState({ outcome: "WON", stage: "DECISION" }), { label: "Won", tone: "positive", closed: true });
  assert.deepEqual(commercialState({ outcome: "LOST", stage: "DECISION" }), { label: "Lost", tone: "muted", closed: true });
  assert.deepEqual(commercialState({ stage: "QUOTING" }), { label: "Quoting", tone: "info", closed: false });
  // DECISION draws attention tone while still open
  assert.equal(commercialState({ stage: "DECISION" }).tone, "attention");
});

test("deriveAttention: closed opportunities never need attention", () => {
  assert.deepEqual(deriveAttention({ outcome: "WON", stage: "DECISION", nextAction: "" }, NOW), []);
  assert.deepEqual(deriveAttention({ outcome: "LOST", stage: "DECISION", expectedCloseAt: NOW - day }, NOW), []);
});

test("deriveAttention flags missing next action, overdue/soon close, and pending decision", () => {
  const kinds = (o) => deriveAttention(o, NOW).map((a) => a.kind);
  assert.deepEqual(kinds({ stage: "QUOTING", nextAction: "", expectedCloseAt: NOW + 30 * day }), ["NO_NEXT_ACTION"]);
  assert.ok(kinds({ stage: "QUOTING", nextAction: "call", expectedCloseAt: NOW - day }).includes("CLOSE_OVERDUE"));
  assert.ok(kinds({ stage: "QUOTING", nextAction: "call", expectedCloseAt: NOW + 3 * day }).includes("CLOSE_SOON"));
  assert.ok(kinds({ stage: "DECISION", nextAction: "call", expectedCloseAt: NOW + 30 * day }).includes("DECISION_PENDING"));
});

test("attention tones: overdue/no-action/decision are 'attention', close-soon is 'info'", () => {
  const a = deriveAttention({ stage: "QUOTING", nextAction: "call", expectedCloseAt: NOW + 3 * day }, NOW);
  assert.equal(a.find((x) => x.kind === "CLOSE_SOON").tone, "info");
  const b = deriveAttention({ stage: "DECISION", nextAction: "" }, NOW);
  assert.ok(b.every((x) => x.tone === "attention"));
});

test("buildPipelineRow resolves customer name from the injected map, then snapshot, then id", () => {
  const withMap = buildPipelineRow({ id: "O1", accountId: "A1", customerName: "Snap" }, { accountNameById: { A1: "Mapped Co" }, nowMillis: NOW });
  assert.equal(withMap.customerName, "Mapped Co");
  const snapOnly = buildPipelineRow({ id: "O2", accountId: "A2", customerName: "Snap Co" }, { nowMillis: NOW });
  assert.equal(snapOnly.customerName, "Snap Co");
  const idOnly = buildPipelineRow({ id: "O3", accountId: "A3" }, { nowMillis: NOW });
  assert.equal(idOnly.customerName, "A3");
});

test("buildOpportunityPipeline excludes closed from the queue but counts them", () => {
  const opps = [
    { id: "open1", stage: "QUOTING", nextAction: "x", expectedCloseAt: NOW + 30 * day },
    { id: "won1", stage: "DECISION", outcome: "WON" },
    { id: "lost1", stage: "DECISION", outcome: "LOST" },
  ];
  const p = buildOpportunityPipeline(opps, { nowMillis: NOW });
  assert.deepEqual(p.rows.map((r) => r.id), ["open1"]);
  assert.equal(p.counts.open, 1);
  assert.equal(p.counts.won, 1);
  assert.equal(p.counts.lost, 1);
  assert.equal(p.all.length, 3);
});

test("pipeline sorts attention-first, then by nearest expected close", () => {
  const opps = [
    { id: "calm-late", stage: "QUALIFYING", nextAction: "x", expectedCloseAt: NOW + 40 * day },
    { id: "attention", stage: "DECISION", nextAction: "x", expectedCloseAt: NOW + 60 * day }, // DECISION_PENDING => attention
    { id: "calm-soon", stage: "QUALIFYING", nextAction: "x", expectedCloseAt: NOW + 20 * day },
  ];
  const p = buildOpportunityPipeline(opps, { nowMillis: NOW });
  assert.equal(p.rows[0].id, "attention");
  assert.deepEqual(p.rows.slice(1).map((r) => r.id), ["calm-soon", "calm-late"]);
});

test("stage/channel labels are humanized with a safe fallback", () => {
  assert.equal(stageLabel("CUSTOMER_REVIEW"), "Customer review");
  assert.equal(channelLabel("NATIONAL_ACCOUNTS"), "National Accounts");
  assert.equal(stageLabel("WEIRD"), "WEIRD");
  assert.equal(channelLabel(undefined), "—");
});
