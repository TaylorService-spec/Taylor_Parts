// Deterministic unit tests for the pure planning core of publish-artifacts.
// Uses node:test + node:assert only. NEVER runs git, pushes, or hits the network.
// Run: node --test skills/publish-artifacts/scripts/

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeRepoPath,
  validatePath,
  resolvePaths,
  slugify,
  buildBranchName,
  buildCommitMessage,
  buildPlan,
  ALLOWED_PREFIXES,
} from './publish-artifacts.mjs';

// A mock existence predicate — a fixed set of "present" files. No filesystem.
const present = new Set([
  'docs/reviews/project-integrity-review.md',
  'docs/specifications/issue-100-spec.md',
  'docs/assessments/inv-1-assessment.md',
]);
const mockExists = (p) => present.has(p);

test('normalizeRepoPath strips ./ and backslashes and leading slashes', () => {
  assert.equal(normalizeRepoPath('./docs/a.md'), 'docs/a.md');
  assert.equal(normalizeRepoPath('docs\\reviews\\a.md'), 'docs/reviews/a.md');
  assert.equal(normalizeRepoPath('/docs/a.md'), 'docs/a.md');
});

test('normalizeRepoPath rejects empty', () => {
  assert.throws(() => normalizeRepoPath(''), /non-empty/);
  assert.throws(() => normalizeRepoPath('   '), /non-empty/);
  assert.throws(() => normalizeRepoPath('.'), /invalid path/);
});

test('validatePath accepts an existing doc under an allowed prefix', () => {
  assert.equal(
    validatePath('docs/reviews/project-integrity-review.md', mockExists),
    'docs/reviews/project-integrity-review.md',
  );
});

test('validatePath rejects path traversal', () => {
  assert.throws(() => validatePath('docs/../secrets.md', mockExists), /escapes repo/);
});

test('validatePath rejects absolute and drive paths', () => {
  assert.throws(() => validatePath('/etc/passwd', () => true), /allowed artifact prefix|repo-relative/);
  assert.throws(() => validatePath('C:/Windows/x.md', () => true), /repo-relative|allowed artifact prefix/);
});

test('validatePath rejects paths outside allowed prefixes', () => {
  assert.throws(() => validatePath('field-ops-app-vite/README.md', () => true), /allowed artifact prefix/);
  assert.throws(() => validatePath('src/App.jsx', () => true), /allowed artifact prefix/);
});

test('validatePath rejects denied paths even under docs/', () => {
  assert.throws(() => validatePath('docs/firestore.rules', () => true), /denied/);
  assert.throws(() => validatePath('docs/.claude/x.md', () => true), /denied/);
});

test('validatePath rejects a missing file when exists predicate says so', () => {
  assert.throws(() => validatePath('docs/reviews/nope.md', mockExists), /does not exist/);
});

test('resolvePaths de-duplicates and preserves order', () => {
  const r = resolvePaths(
    [
      'docs/reviews/project-integrity-review.md',
      './docs/reviews/project-integrity-review.md',
      'docs/specifications/issue-100-spec.md',
    ],
    mockExists,
  );
  assert.deepEqual(r, [
    'docs/reviews/project-integrity-review.md',
    'docs/specifications/issue-100-spec.md',
  ]);
});

test('resolvePaths requires at least one path', () => {
  assert.throws(() => resolvePaths([], mockExists), /at least one/);
});

test('slugify normalizes to branch-safe segments', () => {
  assert.equal(slugify('Issue #100: Inventory Role Access!'), 'issue-100-inventory-role-access');
  assert.equal(slugify('  --Trailing--  '), 'trailing');
});

test('buildBranchName uses topic when given', () => {
  assert.equal(
    buildBranchName({ topic: 'Issue 100 spec', paths: ['docs/x.md'] }),
    'docs/issue-100-spec-artifacts',
  );
});

test('buildBranchName derives from first path basename when topic empty', () => {
  assert.equal(
    buildBranchName({ topic: '', paths: ['docs/reviews/project-integrity-review.md'] }),
    'docs/project-integrity-review-artifacts',
  );
});

test('buildBranchName throws with no topic and no paths', () => {
  assert.throws(() => buildBranchName({ topic: '', paths: [] }), /cannot derive/);
});

test('buildCommitMessage lists paths and ends with Co-Authored-By', () => {
  const msg = buildCommitMessage({
    topic: 'integrity review',
    paths: ['docs/reviews/project-integrity-review.md'],
  });
  assert.match(msg, /^docs: publish integrity review artifacts\n/);
  assert.match(msg, /- docs\/reviews\/project-integrity-review\.md/);
  assert.match(msg, /Co-Authored-By: Claude Opus 4\.8/);
});

test('buildCommitMessage falls back to count subject with no topic', () => {
  const msg = buildCommitMessage({ topic: '', paths: ['docs/a.md', 'docs/b.md'] });
  assert.match(msg, /^docs: publish 2 artifacts\n/);
});

test('buildPlan produces a deterministic, non-merging plan', () => {
  const plan = buildPlan(
    {
      paths: [
        'docs/reviews/project-integrity-review.md',
        'docs/specifications/issue-100-spec.md',
      ],
      topic: 'issue 100',
    },
    mockExists,
  );
  assert.equal(plan.base, 'origin/main');
  assert.equal(plan.branch, 'docs/issue-100-artifacts');
  assert.equal(plan.merge, false);
  assert.deepEqual(plan.paths, [
    'docs/reviews/project-integrity-review.md',
    'docs/specifications/issue-100-spec.md',
  ]);
  // steps never contain a merge or a push to main
  const flat = plan.steps.map((s) => s.join(' ')).join('\n');
  assert.doesNotMatch(flat, /merge/);
  assert.doesNotMatch(flat, /push .*origin main\b/);
  assert.match(flat, /push -u origin docs\/issue-100-artifacts/);
  // one staging step per path, staging explicit paths (never -A / .)
  const addSteps = plan.steps.filter((s) => s.includes('add') && s.includes('--'));
  assert.equal(addSteps.length, 2);
  for (const s of addSteps) {
    assert.ok(!s.includes('-A'), 'must not stage broadly');
    assert.ok(!s.includes('.') || s.includes('.md'), 'must not stage the whole tree');
  }
});

test('buildPlan respects a custom base', () => {
  const plan = buildPlan(
    { paths: ['docs/a.md'], topic: 't', base: 'origin/release' },
    () => true,
  );
  assert.equal(plan.base, 'origin/release');
});

test('ALLOWED_PREFIXES is docs-scoped', () => {
  assert.ok(ALLOWED_PREFIXES.includes('docs/'));
});
