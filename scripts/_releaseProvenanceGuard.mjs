// The pre-deploy provenance gate. Called by _sandboxRefresh.run.sh BEFORE anything is built or
// shipped, alongside _sandboxDeployGuard.mjs: that one proves WHERE the release is going, this one
// proves WHAT it was built from. Both must pass.
//
//   node scripts/_releaseProvenanceGuard.mjs [--allow-commit <sha>]
//
// Exits non-zero to ABORT the pipeline, matching the existing guard's contract.
import { readRepoState, evaluateReleaseProvenance, DEFAULT_RELEASE_BRANCH } from "./releaseProvenance.mjs";

const argv = process.argv.slice(2);
const at = argv.indexOf("--allow-commit");
const allowCommit = at >= 0 && at + 1 < argv.length ? argv[at + 1] : null;

const state = readRepoState();
const verdict = evaluateReleaseProvenance(state, { releaseBranch: DEFAULT_RELEASE_BRANCH, allowCommit });

for (const d of verdict.detail) console.log(`  ${d}`);
if (!verdict.ok) {
  console.error(`ABORT: release provenance refused — ${verdict.failures.join(", ")}`);
  // 3 = refused before any deploy step ran. See _sandboxDeployGuard.mjs.
  process.exit(3);
}
console.log(`PROVENANCE OK: HEAD ${state.head.slice(0, 8)} is origin/${DEFAULT_RELEASE_BRANCH}${allowCommit ? " (explicitly allowed)" : ""}`);
