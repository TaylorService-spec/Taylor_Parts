// node:test custom reporter. Writes ONE JSON manifest of what a `node --test` run actually executed, per test FILE:
//
//   node --test --test-reporter=tap --test-reporter-destination=stdout \
//               --test-reporter=./scripts/adminPolicyManifestReporter.mjs --test-reporter-destination=<manifest.json> <files...>
//
// stdout stays the ordinary TAP log. The manifest is what scripts/adminPolicyPartitions.mjs checks, so "every registered suite
// ran, none of them zero-test, none of them silently skipped" is asserted from the run itself and not from an exit code.
//
// A test counts the way node's own `# tests` summary counts it: suites (describe) are not tests.
import { relative, sep } from "node:path";

const FUNCTIONS_DIR = process.cwd();

export default async function* adminPolicyManifestReporter(source) {
  const files = {};
  for await (const { type, data } of source) {
    if (type !== "test:pass" && type !== "test:fail") continue;
    if (!data.file || data.details?.type === "suite") continue;
    const file = relative(FUNCTIONS_DIR, data.file).split(sep).join("/");
    const f = (files[file] ??= { tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0, cancelled: 0, skippedNames: [] });
    f.tests++;
    if (data.skip !== undefined && data.skip !== false) { f.skipped++; f.skippedNames.push(data.name); }
    else if (data.todo !== undefined && data.todo !== false) f.todo++;
    else if (type === "test:fail") { f.fail++; if (data.details?.error?.failureType === "cancelledByParent") f.cancelled++; }
    else f.pass++;
  }
  yield JSON.stringify({ files }, null, 1) + "\n";
}
