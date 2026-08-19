// Emulator E2E harness -- suite aggregator.
//
// Runs every *Emulator.test.mjs file in this directory as its OWN child process (`node <file>`,
// inheriting stdio + env), sequentially, then exits non-zero if ANY of them exited non-zero. Separate
// processes -- not one shared process importing every file -- because each file calls
// admin.initializeApp() at import time (the pattern this repo's other emulator tests already use, see
// functions/test/receivingCallablesEmulator.test.mjs); running them in one process would collide on
// the default Admin app.
//
// This file assumes FIRESTORE_EMULATOR_HOST / GCLOUD_PROJECT are already set in its environment --
// normally by `firebase emulators:exec` (see functions/scripts/runE2eEmulatorSuite.mjs), which is the
// ONLY thing that should invoke this file in CI or via `npm run test:e2eEmulatorSuite`. Report the
// process exit status this script itself produces -- not a grep of any emulator log -- as the truth
// of whether the suite passed.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here)
  .filter((f) => f.endsWith("Emulator.test.mjs"))
  .sort();

if (files.length === 0) {
  console.error("No *Emulator.test.mjs files found in functions/test/e2e -- nothing to run.");
  process.exit(1);
}

console.log(`Emulator E2E suite: running ${files.length} file(s): ${files.join(", ")}`);

let overallFailed = false;
for (const file of files) {
  const full = path.join(here, file);
  console.log(`\n=== ${file} ===`);
  const result = spawnSync(process.execPath, [full], { stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    overallFailed = true;
    console.error(`=== ${file}: FAILED (exit ${result.status}) ===`);
  } else {
    console.log(`=== ${file}: passed ===`);
  }
}

console.log(`\nEmulator E2E suite: ${overallFailed ? "FAILED" : "PASSED"}`);
process.exit(overallFailed ? 1 : 0);
