#!/usr/bin/env node
// publish-artifacts — deterministic git publish of named docs to a NEW branch
// off origin/main, committing ONLY those paths, pushing, without merging.
//
// DESIGN: the pure/deterministic planning core (path validation, branch-name +
// commit-message construction, dry-run plan) has NO side effects and is exported
// for unit testing. The side-effecting git execution runs child_process only
// behind the --execute flag. Node stdlib only — runnable by any agent (Codex too).

import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// ---------------------------------------------------------------------------
// PURE CORE (no side effects) — exported for tests
// ---------------------------------------------------------------------------

const CO_AUTHOR = 'Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>';

// Directories artifacts are allowed to come from. Publishing outside these is
// refused: never product code, Rules, identity, deploy config, or parked work.
export const ALLOWED_PREFIXES = ['docs/'];

// Paths that must never be published, even under an allowed prefix.
export const DENY_SUBSTRINGS = [
  'firestore.rules',
  '.claude/',
  'functions/',
  'field-ops-app-vite/src/',
];

// Normalize a caller-supplied path to a repo-relative POSIX path.
export function normalizeRepoPath(p) {
  if (typeof p !== 'string' || p.trim() === '') {
    throw new Error('path must be a non-empty string');
  }
  let s = p.trim().replace(/\\/g, '/');
  // strip a leading ./ and any leading slashes -> repo-relative
  s = s.replace(/^\.\//, '').replace(/^\/+/, '');
  if (s === '' || s === '.') throw new Error(`invalid path: ${p}`);
  return s;
}

// Validate a single path against allow/deny policy. Returns normalized path.
// `exists` is an injected predicate so the core stays pure/testable.
export function validatePath(p, exists) {
  const norm = normalizeRepoPath(p);
  if (norm.includes('..')) {
    throw new Error(`path escapes repo (contains ".."): ${p}`);
  }
  if (path.isAbsolute(norm) || /^[A-Za-z]:/.test(norm)) {
    throw new Error(`path must be repo-relative, not absolute: ${p}`);
  }
  const allowed = ALLOWED_PREFIXES.some((pre) => norm.startsWith(pre));
  if (!allowed) {
    throw new Error(
      `path not under an allowed artifact prefix (${ALLOWED_PREFIXES.join(', ')}): ${norm}`,
    );
  }
  for (const bad of DENY_SUBSTRINGS) {
    if (norm.includes(bad)) {
      throw new Error(`path is denied (matches "${bad}"): ${norm}`);
    }
  }
  if (typeof exists === 'function' && !exists(norm)) {
    throw new Error(`file does not exist in working copy: ${norm}`);
  }
  return norm;
}

// Validate and de-duplicate the full list. Throws on the first invalid path.
export function resolvePaths(paths, exists) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('at least one artifact path is required');
  }
  const out = [];
  const seen = new Set();
  for (const p of paths) {
    const norm = validatePath(p, exists);
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

// Slugify a topic into a git-branch-safe segment.
export function slugify(topic) {
  const s = String(topic || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return s;
}

// Build a deterministic branch name. If topic is empty, derive from the first
// path's basename. Prefix defaults to docs/.
export function buildBranchName({ topic, paths, prefix = 'docs' } = {}) {
  let slug = slugify(topic);
  if (!slug && Array.isArray(paths) && paths.length) {
    const base = path.basename(paths[0]).replace(/\.[^.]+$/, '');
    slug = slugify(base);
  }
  if (!slug) throw new Error('cannot derive a branch name (no topic and no paths)');
  return `${prefix}/${slug}-artifacts`;
}

// Build a deterministic docs: commit message listing the paths.
export function buildCommitMessage({ topic, paths } = {}) {
  const resolved = Array.isArray(paths) ? paths : [];
  const subjectTopic = slugify(topic).replace(/-/g, ' ').trim();
  const subject = subjectTopic
    ? `docs: publish ${subjectTopic} artifacts`
    : `docs: publish ${resolved.length} artifact${resolved.length === 1 ? '' : 's'}`;
  const body = resolved.map((p) => `- ${p}`).join('\n');
  return `${subject}\n\n${body}\n\n${CO_AUTHOR}`;
}

// Produce the full deterministic plan. `exists` injected for purity.
export function buildPlan({ paths, topic, base = 'origin/main', prefix = 'docs' }, exists) {
  const resolved = resolvePaths(paths, exists);
  const branch = buildBranchName({ topic, paths: resolved, prefix });
  const message = buildCommitMessage({ topic, paths: resolved });
  return {
    base,
    branch,
    paths: resolved,
    message,
    steps: [
      ['git', 'fetch', 'origin'],
      ['git', 'worktree', 'add', '<worktree>', '-b', branch, base],
      ...resolved.map((p) => ['git', '-C', '<worktree>', 'add', '--', p]),
      ['git', '-C', '<worktree>', 'commit', '-m', '<message>'],
      ['git', '-C', '<worktree>', 'push', '-u', 'origin', branch],
    ],
    merge: false,
  };
}

// ---------------------------------------------------------------------------
// SIDE-EFFECTING SHELL (only reached under --execute)
// ---------------------------------------------------------------------------

function git(args, opts = {}) {
  const r = spawnSync('git', args, { encoding: 'utf8', ...opts });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${r.stderr || r.stdout}`);
  }
  return (r.stdout || '').trim();
}

function execute(plan, worktree) {
  git(['fetch', 'origin']);
  const baseSha = git(['rev-parse', plan.base]);
  git(['worktree', 'add', worktree, '-b', plan.branch, plan.base]);
  try {
    // stage ONLY the named paths — copy from the dirty tree into the clean worktree
    for (const p of plan.paths) {
      const src = path.resolve(process.cwd(), p);
      const dst = path.resolve(worktree, p);
      spawnSync('mkdir', ['-p', path.dirname(dst)]);
      const cp = spawnSync('cp', [src, dst]);
      if (cp.status !== 0) throw new Error(`copy failed for ${p}`);
      git(['-C', worktree, 'add', '--', p]);
    }
    const porcelain = git(['-C', worktree, 'status', '--porcelain']);
    const staged = porcelain.split('\n').filter(Boolean).map((l) => l.slice(3));
    const unexpected = staged.filter((p) => !plan.paths.includes(p));
    if (unexpected.length) {
      throw new Error(`unexpected staged paths: ${unexpected.join(', ')}`);
    }
    git(['-C', worktree, 'commit', '-m', plan.message]);
    const commit = git(['-C', worktree, 'rev-parse', 'HEAD']);
    git(['-C', worktree, 'push', '-u', 'origin', plan.branch]);
    return { baseSha, commit, branch: plan.branch, pushed: true };
  } finally {
    git(['worktree', 'remove', worktree, '--force']);
    git(['worktree', 'prune']);
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { paths: [], topic: '', base: 'origin/main', execute: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--execute') out.execute = true;
    else if (a === '--dry-run') out.execute = false;
    else if (a === '--topic') out.topic = argv[++i];
    else if (a === '--base') out.base = argv[++i];
    else out.paths.push(a);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const exists = (p) => existsSync(p) && statSync(p).isFile();
  const plan = buildPlan(args, exists);
  if (!args.execute) {
    console.log(JSON.stringify({ mode: 'dry-run', ...plan }, null, 2));
    console.log('\n[dry-run] no git commands executed. Re-run with --execute to publish.');
    return;
  }
  const wt = path.resolve(process.cwd(), `.publish-wt-${Date.now()}`);
  const result = execute(plan, wt);
  console.log(JSON.stringify({ mode: 'executed', ...plan, result }, null, 2));
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  try {
    main();
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
}
