#!/usr/bin/env node
// EOS-ISSUE-1062 -- sandbox Functions deployment verification, CLI.
//
// Repeatable replacement for manually running `gcloud functions describe`
// against a list of named callables one at a time. For every supplied
// function, verifies it EXISTS, its state is ACTIVE, and its runtime is
// nodejs22 -- against the live Gen-2 estate via the supported
// `gcloud functions list --v2` path.
//
// STRICTLY VERIFICATION ONLY: one read-only `gcloud functions list --v2`
// call. No deploy, no cloud-state mutation, no secret access, no permission
// change.
//
// Usage:
//   node scripts/verifySandboxFunctions.mjs --project <id> <fn1> [fn2 ...]
//   node scripts/verifySandboxFunctions.mjs --project <id> --function <fn1> --function <fn2>
//
// Exit codes:
//   0 = every named callable is ACTIVE and on nodejs22
//   1 = at least one callable is missing, not ACTIVE, on the wrong runtime,
//       or the underlying gcloud query failed
//   2 = usage error (missing --project or no callable names supplied)
import { execFileSync } from 'node:child_process';

import {
  parseArgs,
  parseFunctionsListPayload,
  evaluateAll,
  formatResults,
  overallExitCode,
} from './sandboxFunctionsVerification.mjs';

function usage() {
  return [
    'Usage: node scripts/verifySandboxFunctions.mjs --project <id> <fn1> [fn2 ...]',
    '   or: node scripts/verifySandboxFunctions.mjs --project <id> --function <fn1> --function <fn2>',
  ].join('\n');
}

function main() {
  const { project, functions, errors } = parseArgs(process.argv.slice(2));
  if (errors.length > 0) {
    for (const e of errors) console.error(`ERROR: ${e}`);
    console.error(usage());
    process.exit(2);
  }

  let stdout;
  try {
    stdout = execFileSync(
      'gcloud',
      ['functions', 'list', '--project', project, '--v2', '--format=json'],
      { encoding: 'utf8' },
    );
  } catch (err) {
    console.error(`FAIL: gcloud functions list --v2 --project ${project} failed: ${err.message}`);
    for (const name of functions) console.log(`FAIL  ${name}: query failed`);
    process.exit(1);
  }

  const parsed = parseFunctionsListPayload(stdout);
  if (!parsed.ok) {
    console.error(`FAIL: ${parsed.error}`);
    for (const name of functions) console.log(`FAIL  ${name}: query failed`);
    process.exit(1);
  }

  const results = evaluateAll(functions, parsed.functions);
  console.log(`Project: ${project}`);
  console.log(formatResults(results));
  process.exit(overallExitCode(results));
}

main();
