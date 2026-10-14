#!/usr/bin/env node
// scaffold-workstream-doc — deterministic doc scaffolder.
//
// Given an artifact type + workstream slug, copy the matching
// docs/ai/templates/*.md into its standard docs/ home, filling only the
// front-matter fields known at creation time (status, date, owner). Refuses
// to overwrite an existing file.
//
// The PURE core (no side effects) is exported for unit testing. The
// side-effecting runner (reads template, writes output) lives in `runScaffold`
// and the CLI. `--dry-run` computes and prints the plan without writing.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// PURE CORE (no fs, no network, no git) — deterministic + unit-testable
// ---------------------------------------------------------------------------

// Canonical artifact map. `owner` is the template's default author; callers may
// override it. Keys accept a few common aliases via `normalizeType`.
export const ARTIFACTS = {
  assessment: {
    template: 'assessment-template.md',
    home: 'docs/assessments',
    owner: 'Claude Code',
  },
  specification: {
    template: 'specification-template.md',
    home: 'docs/specifications',
    owner: 'Claude Code',
  },
  'implementation-plan': {
    template: 'implementation-plan-template.md',
    home: 'docs/implementation-plans',
    owner: 'Claude Code',
  },
  'architecture-review': {
    template: 'review-template.md',
    home: 'docs/reviews',
    owner: 'ChatGPT',
  },
};

const TYPE_ALIASES = {
  assessment: 'assessment',
  assess: 'assessment',
  spec: 'specification',
  specification: 'specification',
  'implementation-plan': 'implementation-plan',
  'impl-plan': 'implementation-plan',
  plan: 'implementation-plan',
  review: 'architecture-review',
  'architecture-review': 'architecture-review',
  'arch-review': 'architecture-review',
};

export function normalizeType(rawType) {
  if (typeof rawType !== 'string') {
    throw new Error('artifact type is required');
  }
  const key = rawType.trim().toLowerCase();
  const canonical = TYPE_ALIASES[key];
  if (!canonical) {
    throw new Error(
      `unknown artifact type "${rawType}". Valid: ${Object.keys(ARTIFACTS).join(', ')}`
    );
  }
  return canonical;
}

export function resolveArtifact(rawType) {
  const type = normalizeType(rawType);
  return { type, ...ARTIFACTS[type] };
}

// Kebab-case slug validation. Reject anything with path separators, spaces,
// uppercase, or a `.md` suffix so the slug can never escape its home folder.
export function normalizeSlug(rawSlug) {
  if (typeof rawSlug !== 'string' || rawSlug.trim() === '') {
    throw new Error('slug is required');
  }
  let slug = rawSlug.trim();
  if (slug.endsWith('.md')) slug = slug.slice(0, -3);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(
      `invalid slug "${rawSlug}". Use lowercase kebab-case (e.g. employee-foundation).`
    );
  }
  return slug;
}

// Deterministic destination path (POSIX-style, repo-relative).
export function computeOutputPath(home, slug) {
  return `${home}/${slug}.md`;
}

// Today's date as YYYY-MM-DD. Injectable for deterministic tests.
export function todayISO(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// Replace a single `key: value` line inside the leading YAML front-matter block
// only. Lines after the closing `---` are never touched. If the key is absent
// from the front-matter, the content is returned unchanged.
export function setFrontMatterField(content, key, value) {
  const lines = content.split('\n');
  if (lines[0].trim() !== '---') {
    throw new Error('template has no leading front-matter block');
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error('template front-matter is not terminated');

  const re = new RegExp(`^${key}:(.*)$`);
  for (let i = 1; i < end; i++) {
    if (re.test(lines[i])) {
      lines[i] = `${key}: ${value}`;
      return lines.join('\n');
    }
  }
  return content;
}

// Fill status/date/owner into a template's front-matter. Pure string → string.
export function fillFrontMatter(templateContent, { date, owner, status = 'Draft' } = {}) {
  let out = templateContent;
  out = setFrontMatterField(out, 'status', status);
  if (date) out = setFrontMatterField(out, 'date', date);
  if (owner) out = setFrontMatterField(out, 'owner', owner);
  return out;
}

// Full deterministic plan: everything needed to write the artifact, computed
// from inputs with zero side effects. `templateContent` is injected so this is
// testable without touching the filesystem.
export function planScaffold({ type, slug, templateContent, date, owner, now }) {
  const artifact = resolveArtifact(type);
  const cleanSlug = normalizeSlug(slug);
  const outputPath = computeOutputPath(artifact.home, cleanSlug);
  const resolvedDate = date || todayISO(now);
  const resolvedOwner = owner || artifact.owner;
  const content = fillFrontMatter(templateContent, {
    date: resolvedDate,
    owner: resolvedOwner,
    status: 'Draft',
  });
  return {
    type: artifact.type,
    slug: cleanSlug,
    templatePath: `docs/ai/templates/${artifact.template}`,
    home: artifact.home,
    outputPath,
    date: resolvedDate,
    owner: resolvedOwner,
    content,
  };
}

// ---------------------------------------------------------------------------
// SIDE-EFFECTING RUNNER (fs only — no git, no network)
// ---------------------------------------------------------------------------

export function runScaffold({ type, slug, repoRoot, date, owner, dryRun = false }) {
  const artifact = resolveArtifact(type);
  const templateAbs = path.join(repoRoot, 'docs', 'ai', 'templates', artifact.template);
  if (!fs.existsSync(templateAbs)) {
    throw new Error(`template not found: ${templateAbs}`);
  }
  const templateContent = fs.readFileSync(templateAbs, 'utf8');
  const plan = planScaffold({ type, slug, templateContent, date, owner });
  const outputAbs = path.join(repoRoot, ...plan.outputPath.split('/'));

  if (fs.existsSync(outputAbs)) {
    throw new Error(
      `refusing to overwrite existing artifact: ${plan.outputPath}. ` +
        `Edit the existing file instead of scaffolding a new one.`
    );
  }

  if (!dryRun) {
    fs.mkdirSync(path.dirname(outputAbs), { recursive: true });
    fs.writeFileSync(outputAbs, plan.content, 'utf8');
  }

  return { ...plan, outputAbs, written: !dryRun };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { dryRun: false, repoRoot: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--type') args.type = argv[++i];
    else if (a === '--slug') args.slug = argv[++i];
    else if (a === '--owner') args.owner = argv[++i];
    else if (a === '--date') args.date = argv[++i];
    else if (a === '--repo-root') args.repoRoot = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

const USAGE = `Usage:
  node scaffold-workstream-doc.mjs --type <type> --slug <slug> [options]

Types: assessment | specification | implementation-plan | architecture-review
Options:
  --owner <name>    Override the default author (front-matter owner)
  --date <YYYY-MM-DD>  Override the creation date (default: today)
  --repo-root <dir> Repo root (default: cwd)
  --dry-run         Compute the plan and print it; write nothing
`;

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.type || !args.slug) {
    process.stdout.write(USAGE);
    process.exit(args.help ? 0 : 2);
  }
  try {
    const result = runScaffold(args);
    const verb = result.written ? 'Created' : 'DRY-RUN (nothing written)';
    process.stdout.write(
      `${verb}: ${result.outputPath}\n` +
        `  type:  ${result.type}\n` +
        `  slug:  ${result.slug}\n` +
        `  owner: ${result.owner}\n` +
        `  date:  ${result.date}\n`
    );
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  }
}

// Run main only when invoked directly, not when imported by the test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
