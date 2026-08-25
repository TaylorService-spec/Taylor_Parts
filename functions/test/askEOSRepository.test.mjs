import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  parseAskEOSInput,
  projectAllowsAskEOS,
} from "../lib/ai/repositoryAnswerCallable.js";

test("Ask EOS is enabled only for emulator or the sandbox project", () => {
  assert.equal(projectAllowsAskEOS({ FUNCTIONS_EMULATOR: "true" }), true);
  assert.equal(projectAllowsAskEOS({ GCLOUD_PROJECT: "eos-platform-sandbox" }), true);
  assert.equal(projectAllowsAskEOS({ GOOGLE_CLOUD_PROJECT: "eos-platform-sandbox" }), true);
  assert.equal(projectAllowsAskEOS({ GCLOUD_PROJECT: "taylor-parts" }), false);
  assert.equal(projectAllowsAskEOS({ GCLOUD_PROJECT: "some-other-project" }), false);
  assert.equal(projectAllowsAskEOS({}), false);
});

test("Ask EOS input is bounded and defaults to the measured repository budget", () => {
  assert.deepEqual(parseAskEOSInput({ question: "  How does Cycle Count authority work?  " }), {
    question: "How does Cycle Count authority work?",
    contextBudget: 4000,
  });
  assert.deepEqual(parseAskEOSInput({ question: "Where is this implemented?", contextBudget: 8000 }), {
    question: "Where is this implemented?",
    contextBudget: 8000,
  });
});

test("Ask EOS rejects empty, oversized, malformed, and authority-shaped input", () => {
  for (const input of [
    null,
    {},
    { question: "" },
    { question: "x".repeat(2001) },
    { question: "ok", contextBudget: 999 },
    { question: "ok", contextBudget: 8001 },
    { question: "ok", contextBudget: 4000.5 },
    { question: "ok", role: "admin" },
    { question: "ok", uid: "someone-else" },
    { question: "ok", source: "another-repository" },
  ]) {
    assert.throws(() => parseAskEOSInput(input));
  }
});

test("Ask EOS callable source has no operational collection read surface", async () => {
  const source = await readFile(new URL("../src/ai/repositoryAnswerCallable.ts", import.meta.url), "utf8");
  assert.match(source, /collection\("users"\)/);
  for (const forbidden of [
    "fieldops_wos",
    "accounts",
    "inventory_transactions",
    "inventory_actions",
    "purchase_orders",
    "sales_orders",
    "invoices",
    "payments",
    "serialized_assets",
  ]) {
    assert.equal(source.includes(`collection(\"${forbidden}\")`), false, forbidden);
  }
  assert.match(source, /classification: "REPOSITORY"/);
  assert.match(source, /source: SOURCE_ID/);
});
