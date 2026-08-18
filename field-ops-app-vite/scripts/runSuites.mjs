#!/usr/bin/env node
// Runs the suite list in test/suites.json sequentially, preserving && semantics: stop at the
// first failure and exit non-zero with that suite's status.
//
// Why this exists: package.json's `test` script was a single `&&` chain of 180 invocations,
// 8155 characters long. Windows caps a command line near 8191, so adding one more suite broke
// `npm test` locally outright -- it failed with "The command line is too long" while CI on
// Linux kept passing, because Linux allows far longer command lines. A green CI and a broken
// local command is the worst shape of that failure: the machine you verify on disagrees with
// the machine that gates the merge.
//
// A manifest also makes the suite list reviewable. An 8000-character string in package.json
// was not something a reader could check for omissions.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../test/suites.json", import.meta.url), "utf8"));
const suites = manifest.suites ?? [];
if (suites.length === 0) {
  console.error("runSuites: no suites declared in test/suites.json");
  process.exit(1);
}

let run = 0;
for (const { file, runner } of suites) {
  const args = runner === "node --test" ? ["--test", file] : [file];
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  run += 1;
  // A signal death has no exit code; treat it as failure rather than letting `?? 0` pass it.
  if (result.status !== 0) {
    console.error(`\nrunSuites: FAILED in ${file} (${run}/${suites.length})`);
    process.exit(result.status ?? 1);
  }
}
console.log(`\nrunSuites: ${run} suites passed`);
