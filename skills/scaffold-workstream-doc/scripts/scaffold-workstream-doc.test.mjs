import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  normalizeType,
  resolveArtifact,
  normalizeSlug,
  computeOutputPath,
  todayISO,
  setFrontMatterField,
  fillFrontMatter,
  planScaffold,
  runScaffold,
} from './scaffold-workstream-doc.mjs';

const FAKE_TEMPLATE = `---
artifact_type: assessment
gate: Repository Assessment
status: Draft
date: YYYY-MM-DD
owner: Claude Code
related_pr:
---

# Assessment Report: <topic>

Body content with a stray "date:" line that must NOT be rewritten.
`;

// --- normalizeType / resolveArtifact -------------------------------------

test('normalizeType maps aliases to canonical types', () => {
  assert.equal(normalizeType('spec'), 'specification');
  assert.equal(normalizeType('Assessment'), 'assessment');
  assert.equal(normalizeType('review'), 'architecture-review');
  assert.equal(normalizeType('plan'), 'implementation-plan');
});

test('normalizeType rejects unknown types', () => {
  assert.throws(() => normalizeType('adr'), /unknown artifact type/);
  assert.throws(() => normalizeType(''), /unknown artifact type|required/);
});

test('resolveArtifact returns template, home and default owner', () => {
  assert.deepEqual(resolveArtifact('spec'), {
    type: 'specification',
    template: 'specification-template.md',
    home: 'docs/specifications',
    owner: 'Claude Code',
  });
  assert.equal(resolveArtifact('review').owner, 'ChatGPT');
});

// --- normalizeSlug -------------------------------------------------------

test('normalizeSlug accepts kebab-case and strips .md', () => {
  assert.equal(normalizeSlug('employee-foundation'), 'employee-foundation');
  assert.equal(normalizeSlug('employee-foundation.md'), 'employee-foundation');
});

test('normalizeSlug rejects unsafe or non-kebab slugs', () => {
  assert.throws(() => normalizeSlug('Employee Foundation'), /invalid slug/);
  assert.throws(() => normalizeSlug('../escape'), /invalid slug/);
  assert.throws(() => normalizeSlug('sub/dir'), /invalid slug/);
  assert.throws(() => normalizeSlug(''), /required/);
});

// --- computeOutputPath ---------------------------------------------------

test('computeOutputPath joins home and slug deterministically', () => {
  assert.equal(
    computeOutputPath('docs/assessments', 'foo-bar'),
    'docs/assessments/foo-bar.md'
  );
});

// --- setFrontMatterField -------------------------------------------------

test('setFrontMatterField only rewrites inside the front-matter block', () => {
  const out = setFrontMatterField(FAKE_TEMPLATE, 'date', '2026-08-05');
  const lines = out.split('\n');
  // front-matter date updated
  assert.ok(lines.includes('date: 2026-08-05'));
  // the body "date:" mention is untouched
  assert.ok(out.includes('stray "date:" line that must NOT be rewritten'));
});

test('setFrontMatterField leaves content unchanged when key absent', () => {
  const out = setFrontMatterField(FAKE_TEMPLATE, 'nonexistent', 'x');
  assert.equal(out, FAKE_TEMPLATE);
});

// --- fillFrontMatter -----------------------------------------------------

test('fillFrontMatter sets status Draft, date and owner', () => {
  const out = fillFrontMatter(FAKE_TEMPLATE, {
    date: '2026-08-05',
    owner: 'ChatGPT',
  });
  assert.ok(out.includes('status: Draft'));
  assert.ok(out.includes('date: 2026-08-05'));
  assert.ok(out.includes('owner: ChatGPT'));
});

// --- todayISO ------------------------------------------------------------

test('todayISO formats an injected date as YYYY-MM-DD', () => {
  assert.equal(todayISO(new Date('2026-08-05T23:59:00Z')), '2026-08-05');
});

// --- planScaffold (pure) -------------------------------------------------

test('planScaffold computes the full plan without side effects', () => {
  const plan = planScaffold({
    type: 'assessment',
    slug: 'my-workstream',
    templateContent: FAKE_TEMPLATE,
    now: new Date('2026-08-05T12:00:00Z'),
  });
  assert.equal(plan.type, 'assessment');
  assert.equal(plan.slug, 'my-workstream');
  assert.equal(plan.outputPath, 'docs/assessments/my-workstream.md');
  assert.equal(plan.templatePath, 'docs/ai/templates/assessment-template.md');
  assert.equal(plan.date, '2026-08-05');
  assert.equal(plan.owner, 'Claude Code');
  assert.ok(plan.content.includes('date: 2026-08-05'));
  assert.ok(plan.content.includes('status: Draft'));
});

test('planScaffold honors owner override and review default', () => {
  assert.equal(
    planScaffold({ type: 'review', slug: 's', templateContent: FAKE_TEMPLATE }).owner,
    'ChatGPT'
  );
  assert.equal(
    planScaffold({ type: 'assessment', slug: 's', templateContent: FAKE_TEMPLATE, owner: 'Codex' }).owner,
    'Codex'
  );
});

// --- runScaffold (side-effecting, temp dir only) -------------------------

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-test-'));
  const tplDir = path.join(root, 'docs', 'ai', 'templates');
  fs.mkdirSync(tplDir, { recursive: true });
  fs.writeFileSync(path.join(tplDir, 'assessment-template.md'), FAKE_TEMPLATE, 'utf8');
  return root;
}

test('runScaffold writes the filled artifact into its standard home', () => {
  const root = makeRepo();
  try {
    const res = runScaffold({
      type: 'assessment',
      slug: 'temp-flow',
      repoRoot: root,
      date: '2026-08-05',
    });
    assert.equal(res.written, true);
    assert.equal(res.outputPath, 'docs/assessments/temp-flow.md');
    const written = fs.readFileSync(res.outputAbs, 'utf8');
    assert.ok(written.includes('status: Draft'));
    assert.ok(written.includes('date: 2026-08-05'));
    assert.ok(written.includes('owner: Claude Code'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runScaffold --dry-run computes the plan but writes nothing', () => {
  const root = makeRepo();
  try {
    const res = runScaffold({
      type: 'assessment',
      slug: 'dry-one',
      repoRoot: root,
      date: '2026-08-05',
      dryRun: true,
    });
    assert.equal(res.written, false);
    assert.equal(fs.existsSync(res.outputAbs), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runScaffold refuses to overwrite an existing artifact', () => {
  const root = makeRepo();
  try {
    runScaffold({ type: 'assessment', slug: 'dup', repoRoot: root, date: '2026-08-05' });
    assert.throws(
      () => runScaffold({ type: 'assessment', slug: 'dup', repoRoot: root, date: '2026-08-05' }),
      /refusing to overwrite/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
