// FINANCE DETECTOR WIRING RATCHET (P2-K, 2026-09-12).
//
// ════════════════════ THE FAILURE THIS EXISTS TO PREVENT ════════════════════
//
// financialReconciliation.ts sat in the tree for months as a "detector" that no production module
// imported and whose own suite was in no package.json script. Two separate audit lanes read the
// comments in invoiceCommands.ts and eosOps/invoiceTotals.ts, which asserted the reconciler was
// live, and concluded a guard was running that has never run once. Nothing in the build noticed,
// because nothing in the build was looking.
//
// ════════════════════ WHAT THIS CHECKS, AND WHY IT IS NOT A REGEX SWEEP ════════════════════
//
// This is a REGISTRY, not a heuristic. DETECTORS below is an explicit, hand-maintained list. The
// test does not guess what a "detector" is, does not parse prose, and does not scan comments for
// claims. It reads two facts that a machine can read exactly — the import graph under
// functions/src, and the test files named in functions/package.json scripts — and asserts the
// registry matches them. A registry entry is a statement an engineer made on purpose; this test
// only refuses to let reality drift away from it.
//
// It fails in BOTH directions, which is the point:
//   • status DORMANT + a production importer appears  ⇒ FAIL (someone wired it; say so, and deal
//     with the Owner questions that dormancy was recording).
//   • status LIVE + no production importer            ⇒ FAIL (the claim is false).
//   • any declared suite missing from every package.json script ⇒ FAIL (unrun again).
//   • a file listed in citedBy stops naming the module ⇒ FAIL (the comment and the code parted ways).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const FUNCTIONS_ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(FUNCTIONS_ROOT, "src");

/**
 * Every entry is a deliberate declaration. Adding a detector module here is cheap; the cost of
 * NOT adding one is another module that looks like a guard and is not.
 *
 *   module   — path under functions/, the detector itself.
 *   status   — "LIVE" (a production module imports it) or "DORMANT" (none does, on purpose).
 *   reason   — required for DORMANT. Why it is not wired, and who has to decide.
 *   suites   — test files that exercise it. Each MUST be named in a functions/package.json script.
 *   citedBy  — production files whose comments discuss it. Each MUST still name it.
 */
const DETECTORS = [
  {
    module: "src/finance/financialReconciliation.ts",
    status: "DORMANT",
    reason:
      "Not wired pending two Owner rulings recorded in the module header: (1) invoice lifecycle " +
      "state after a full write-off / credit memo — reconcileInvoiceProjection derives PAID where " +
      "adjustmentCommands.ts deliberately leaves ISSUED, so wiring it as-is would report DRIFT on " +
      "healthy invoices (pinned in financialReconciliation.test.mjs); (2) whether a discovered " +
      "cache/fact divergence should BLOCK, WARN, or reconcile asynchronously (FIN-010 §3 defers it).",
    suites: ["test/financialReconciliation.test.mjs", "test/invoiceTotalsAuthority.test.mjs"],
    citedBy: ["src/finance/invoiceCommands.ts", "src/eosOps/invoiceTotals.ts"],
  },
];

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
  });

const SRC_FILES = walk(SRC);

// Import specifiers only — `from "..."`, `import("...")`, `require("...")`. A mention inside a
// comment is not an import and must not count as one; that confusion is what caused this whole
// episode.
const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

function productionImportersOf(moduleRelPath) {
  const absolute = path.join(FUNCTIONS_ROOT, moduleRelPath);
  const importers = [];
  for (const file of SRC_FILES) {
    if (file === absolute) continue;
    const text = readFileSync(file, "utf8");
    for (const [, spec] of text.matchAll(IMPORT_SPECIFIER)) {
      if (!spec.startsWith(".")) continue;
      const resolved = path.resolve(path.dirname(file), spec.replace(/\.js$/, ""));
      if (resolved === absolute.replace(/\.ts$/, "")) {
        importers.push(path.relative(FUNCTIONS_ROOT, file));
        break;
      }
    }
  }
  return importers;
}

const SCRIPT_TEXT = Object.values(
  JSON.parse(readFileSync(path.join(FUNCTIONS_ROOT, "package.json"), "utf8")).scripts ?? {},
).join("\n");

for (const d of DETECTORS) {
  test(`${d.module}: the registry matches the import graph`, () => {
    assert.ok(statSync(path.join(FUNCTIONS_ROOT, d.module)).isFile(), `${d.module} does not exist`);
    const importers = productionImportersOf(d.module);
    if (d.status === "LIVE") {
      assert.ok(
        importers.length > 0,
        `${d.module} is declared LIVE but NO module under functions/src imports it. Either wire it or declare it DORMANT with a reason.`,
      );
    } else {
      assert.equal(d.status, "DORMANT", `unknown status ${d.status}`);
      assert.deepEqual(
        importers,
        [],
        `${d.module} is declared DORMANT but is now imported by ${importers.join(", ")}. If it has been wired, change status to LIVE and resolve the dormancy reason:\n${d.reason}`,
      );
      assert.ok(
        typeof d.reason === "string" && d.reason.trim().length > 0,
        `${d.module} is DORMANT without a recorded reason — "we forgot" and "we decided" must not look the same.`,
      );
    }
  });

  test(`${d.module}: every suite that exercises it is registered in package.json`, () => {
    assert.ok(d.suites.length > 0, `${d.module} declares no suite — an unexercised detector proves nothing.`);
    for (const suite of d.suites) {
      assert.ok(statSync(path.join(FUNCTIONS_ROOT, suite)).isFile(), `${suite} does not exist`);
      assert.ok(
        SCRIPT_TEXT.includes(suite),
        `${suite} exercises ${d.module} but is named in NO functions/package.json script, so nothing runs it.`,
      );
    }
  });

  test(`${d.module}: the production comments that discuss it still name it`, () => {
    const name = path.basename(d.module, ".ts");
    for (const cited of d.citedBy ?? []) {
      const text = readFileSync(path.join(FUNCTIONS_ROOT, cited), "utf8");
      assert.ok(
        text.includes(name),
        `${cited} is registered as discussing ${d.module} but no longer mentions ${name}. If the module moved or was retired, fix the comment in the same change.`,
      );
    }
  });
}
