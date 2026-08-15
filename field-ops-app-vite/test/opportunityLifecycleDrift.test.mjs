// Opportunity lifecycle — DRIFT test (offline, node:test). The client mirror (domain/opportunityLifecycle.js)
// is a MIRROR, not a second authority, exactly like PLAN_TERMINAL_STATUSES in
// test/workOrderPartsPlan.test.mjs. This reads the SERVER'S source
// (functions/src/opportunity/opportunityLifecycle.ts) and asserts the client's stage/outcome vocabulary is
// identical, so a change to the server's ratified lifecycle fails HERE instead of silently letting the UI
// offer a stage/action the governed transitionOpportunity/createOpportunity commands would refuse.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { OPPORTUNITY_STAGES, OPPORTUNITY_OUTCOMES, SALES_CHANNELS } from "../src/domain/opportunityLifecycle.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVER_SRC = readFileSync(
  resolve(REPO_ROOT, "functions/src/opportunity/opportunityLifecycle.ts"),
  "utf8",
);

function readonlyArray(src, constName) {
  const block = src.match(new RegExp(`export const ${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`));
  assert.ok(block, `could not locate ${constName} in functions/src/opportunity/opportunityLifecycle.ts`);
  return [...block[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
}

test("OPPORTUNITY_STAGES stays in lockstep with the server's ratified OPPORTUNITY_STAGES (order matters)", () => {
  const serverStages = readonlyArray(SERVER_SRC, "OPPORTUNITY_STAGES");
  assert.deepEqual(OPPORTUNITY_STAGES, serverStages);
});

test("OPPORTUNITY_OUTCOMES stays in lockstep with the server's ratified OPPORTUNITY_OUTCOMES", () => {
  const serverOutcomes = readonlyArray(SERVER_SRC, "OPPORTUNITY_OUTCOMES");
  assert.deepEqual(OPPORTUNITY_OUTCOMES, serverOutcomes);
});

test("SALES_CHANNELS stays in lockstep with the server's ratified SALES_CHANNELS", () => {
  const serverChannels = readonlyArray(SERVER_SRC, "SALES_CHANNELS");
  assert.deepEqual(SALES_CHANNELS, serverChannels);
});
