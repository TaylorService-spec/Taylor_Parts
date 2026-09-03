// =================================================================================================
// THE INSTALLED DEPENDENCY TREE MUST BE THE ONE THE RELEASE DECLARES
//
// The sandbox refresh of 2026-09-03 (second attempt) got past Functions and died in
// `[3a/5] verify the build-base contract` with sixty lines of Rolldown stack ending in
// `aggregateBindingErrorsIntoJsError`. The actual cause was one line buried in the middle:
//
//     [vite]: Rolldown failed to resolve import "jsbarcode" from src/shared/ui/BinBarcode.jsx
//
// `jsbarcode` is declared in field-ops-app-vite/package.json and pinned in its lockfile. It entered
// in #1774 (0f9a7c60), which is INSIDE the undeployed release gap. The operator checkout's
// node_modules predated that commit, so the package simply was not on disk. Nothing was wrong with
// the verifier, the build config, Vite, Rolldown, execSync, Windows, memory or the filesystem --
// the release was being built against a dependency tree that was not the one it declares.
//
// THE HOLE THIS CLOSES IS BIGGER THAN THE FAILURE THAT REVEALED IT.
//
// The runbook builds `functions` and `field-ops-app-vite` and installs NEITHER. A stale tree is
// therefore free to do one of two things, and this incident was the lucky one:
//
//   LOUD  -- a declared package is missing, the build fails, the release stops. What happened.
//   QUIET -- a declared package is present at the WRONG version, the build SUCCEEDS, and the
//            release ships an artifact built from dependencies nobody approved. Nothing fails.
//
// The second is the one worth a guard. This repository already refuses to deploy an artifact whose
// COMMIT provenance it cannot prove (scripts/_releaseProvenanceGuard.mjs, _releaseIdentityGate.mjs);
// its DEPENDENCY provenance was simply never asked about.
//
// THIS REFUSES; IT DOES NOT INSTALL. Running `npm ci` from a release script would delete and
// rebuild the operator's node_modules as a side effect of a deploy -- a large, slow, surprising
// mutation in the middle of a protected action. A named refusal before anything is built is this
// runbook's own established pattern (see its toolchain preflight) and leaves the operator in
// control of when their machine changes.
//
// Direct dependencies only, compared against the LOCKFILE'S EXACT VERSIONS -- no semver range
// evaluation, and so no semver dependency. Transitive and platform-optional packages (a Rolldown
// native binding, say) are deliberately not walked: they are npm's business, they differ
// legitimately per platform, and checking them would produce false refusals on a correct install.
//
// Usage: node scripts/verifyInstalledDeps.mjs <packageDir> [...more]
// =================================================================================================

import { readFileSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";

/** Read JSON, or return null when the file is absent. */
function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Compare a package's declared direct dependencies against what is installed.
 *
 * Returns a list of problems, each naming the package and what is wrong. An empty list means the
 * installed tree satisfies every direct dependency at the exact version the lockfile pins.
 */
export function checkInstalledDeps(packageDir, { readJson: read = readJson } = {}) {
  const manifest = read(join(packageDir, "package.json"));
  if (!manifest) return [{ kind: "NO_MANIFEST", detail: `no package.json in ${packageDir}` }];

  const lock = read(join(packageDir, "package-lock.json"));
  if (!lock) return [{ kind: "NO_LOCKFILE", detail: `no package-lock.json in ${packageDir}` }];

  const declared = { ...manifest.dependencies, ...manifest.devDependencies };
  const problems = [];

  for (const name of Object.keys(declared).sort()) {
    const pinned = lock.packages?.[`node_modules/${name}`]?.version ?? null;
    const installed = read(join(packageDir, "node_modules", name, "package.json"))?.version ?? null;

    if (installed === null) {
      problems.push({ kind: "MISSING", name, expected: pinned, detail: "declared but not installed" });
      continue;
    }
    // A package the lockfile does not pin cannot be version-checked. Say so rather than pass it
    // silently -- an unpinned direct dependency is its own release-provenance problem.
    if (pinned === null) {
      problems.push({ kind: "UNPINNED", name, installed, detail: "installed but absent from the lockfile" });
      continue;
    }
    if (installed !== pinned) {
      problems.push({ kind: "VERSION", name, expected: pinned, installed, detail: "wrong version installed" });
    }
  }
  return problems;
}

/** One human-readable refusal naming every problem and the exact command that fixes it. */
export function formatRefusal(packageDir, problems) {
  const lines = [
    `ABORT: ${basename(packageDir)} is not installed as this release declares it.`,
    "",
  ];
  for (const p of problems) {
    if (p.kind === "MISSING") lines.push(`  MISSING  ${p.name}  (lockfile pins ${p.expected})`);
    else if (p.kind === "VERSION") lines.push(`  VERSION  ${p.name}  installed ${p.installed}, lockfile pins ${p.expected}`);
    else if (p.kind === "UNPINNED") lines.push(`  UNPINNED ${p.name}  installed ${p.installed}, not in the lockfile`);
    else lines.push(`  ${p.kind}  ${p.detail}`);
  }
  lines.push(
    "",
    "  The build would either fail with an unrelated-looking bundler stack, or -- worse -- succeed",
    "  and ship an artifact built from dependencies this release does not declare.",
    "",
    "  Fix it, then re-run the refresh from the beginning:",
    "",
    `      cd ${packageDir}`,
    "      npm ci",
    "",
    "  Nothing has been built, deployed or changed.",
  );
  return lines.join("\n");
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]).endsWith("verifyInstalledDeps.mjs");
if (invokedDirectly) {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error("usage: node scripts/verifyInstalledDeps.mjs <packageDir> [...more]");
    process.exit(2);
  }
  let failed = false;
  for (const dir of dirs) {
    const packageDir = resolve(dir);
    const problems = checkInstalledDeps(packageDir);
    if (problems.length === 0) {
      const count = Object.keys({
        ...readJson(join(packageDir, "package.json"))?.dependencies,
        ...readJson(join(packageDir, "package.json"))?.devDependencies,
      }).length;
      console.log(`  ok - ${basename(packageDir)}: ${count} direct dependencies installed at lockfile versions`);
    } else {
      console.error(formatRefusal(packageDir, problems));
      failed = true;
    }
  }
  process.exit(failed ? 2 : 0);
}
