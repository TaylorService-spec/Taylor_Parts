// THE REORDER SOURCE WRITE FREEZE -- coverage, fail-closed behaviour, and what it must NOT freeze.
//
// The freeze is the half that Firestore Rules cannot provide: Rules do not constrain the Admin SDK,
// so a Rules-only freeze leaves every trusted callable free to keep changing the population being
// copied. This suite proves the gate exists in the server writers, that it is mechanically complete,
// and that it stops at the Reorder chain.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(REPO, "functions", "src");
const code = (rel) => readFileSync(join(SRC, rel), "utf8");
/** Executable text only: a gate named in a comment protects nothing. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

const freeze = await import("../lib/reorderRequest/reorderSourceFreeze.js");

test("the freeze is BUILT and INERT -- every legacy writer still answers today", () => {
  assert.equal(freeze.REORDER_SOURCE_FROZEN, false,
    "the copy has not been run against the real source, so the source is not frozen");
  assert.doesNotThrow(() => freeze.assertReorderSourceWritable("createReorderRequest"));
});

test("the writer list is the closed set of legacy Reorder SOURCE writers", () => {
  assert.deepEqual([...freeze.REORDER_SOURCE_WRITERS], [
    "createReorderRequest",
    "recordReorderPurchaseOrder",
    "receiveInventoryStockLegacyReorder",
  ]);
});

test("EVERY listed writer calls the gate, in executable code", () => {
  // The claim this suite exists to make. A writer that forgot the gate looks identical to one that
  // checked and proceeded, so the correspondence is derived from the source rather than trusted.
  const sites = {
    createReorderRequest: "reorderRequest/reorderCallables.ts",
    recordReorderPurchaseOrder: "reorderRequest/reorderCallables.ts",
    receiveInventoryStockLegacyReorder: "inventoryReceiving/receiveInventoryStockCommand.ts",
  };
  for (const writer of freeze.REORDER_SOURCE_WRITERS) {
    const src = strip(code(sites[writer]));
    assert.match(src, new RegExp(`assertReorderSourceWritable\\(\\s*["']${writer}["']\\s*\\)`),
      `${writer} does not call the cutover gate`);
  }
});

test("a frozen writer FAILS CLOSED and says why, rather than returning a generic denial", () => {
  // Proven against the error the gate throws, so the message is a tested fact rather than a comment.
  const err = new freeze.ReorderSourceFrozenError("recordReorderPurchaseOrder");
  assert.equal(err.code, "REORDER_SOURCE_FROZEN");
  assert.equal(err.category, "PRECONDITION_FAILED");
  assert.equal(err.writer, "recordReorderPurchaseOrder");
  assert.match(err.message, /frozen for the PostgreSQL cutover/);
  assert.match(err.message, /invisible to it/, "an operator must not read this as a broken deployment");
});

test("the freeze does NOT reach the canonical PURCHASE_ORDER authority", () => {
  // Canonical purchasing is a different business authority with its own Firebase-exit cutover. It
  // shares the receiving command, so the gate is on the LEGACY BRANCH -- never at the entry point.
  const receiving = strip(code("inventoryReceiving/receiveInventoryStockCommand.ts"));
  // The CALL SITE, not the import -- an import sits at the top of the file and would satisfy any
  // ordering assertion while the gate itself was anywhere at all.
  const gate = receiving.indexOf('assertReorderSourceWritable("receiveInventoryStockLegacyReorder")');
  assert.ok(gate > 0, "the legacy branch is gated");
  const legacyBranch = receiving.indexOf("if (!resolved.isCanonical)");
  assert.ok(legacyBranch > 0 && legacyBranch < gate,
    "the gate must sit INSIDE the legacy branch, so a canonical receipt never reaches it");

  // And no canonical-only module is gated at all.
  for (const rel of ["inventoryReceiving/receivingSourceResolver.ts", "inventoryReceiving/purchaseOrderProgressRead.ts",
    "procurementService.ts"]) {
    assert.equal(/assertReorderSourceWritable/.test(strip(code(rel))), false,
      `${rel} serves canonical purchasing and must not be frozen by the Reorder cutover`);
  }
});

test("nothing else in the repository invents its own freeze", () => {
  // One gate, one constant. A second predicate somewhere would mean the source could be half frozen,
  // with no single place that says so.
  const declarers = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".ts") && /REORDER_SOURCE_FROZEN\s*=/.test(strip(readFileSync(p, "utf8")))) {
        declarers.push(p.slice(SRC.length + 1).replace(/\\/g, "/"));
      }
    }
  };
  walk(SRC);
  assert.deepEqual(declarers, ["reorderRequest/reorderSourceFreeze.ts"]);
});
