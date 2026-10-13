// The VALUE-import closure of TypeScript source modules -- shared by the grant-impact preview purity guard
// (test/authorityPreviewPurity.test.mjs). Static and deliberately simple: it follows `import ... from` and
// `export ... from` specifiers that are not type-only, resolves relative ones to files under src/, and reports every
// non-relative specifier as EXTERNAL. A dynamic `import()` or a `require(` is reported too, so the closure cannot be
// escaped by spelling an import differently.
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

// A clause never contains `;`, so a match can never run past the end of one statement into the next.
const IMPORT = /(?:^|\n)[ \t]*(import|export)\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g;

/** Block comments and whole-line `//` comments: prose that says "import ... from" must not be read as an import. */
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const BARE_IMPORT = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
const DYNAMIC = /\bimport\s*\(\s*["']([^"']+)["']\s*\)|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Is every named binding in `{ ... }` type-only (`import { type A, type B }`)? Then nothing is imported at runtime. */
function allBindingsTypeOnly(clause) {
  const m = clause.match(/^\{([\s\S]*)\}$/);
  if (!m) return false;
  const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
  return names.length > 0 && names.every((n) => n.startsWith("type "));
}

function resolveRelative(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec.replace(/\.js$/, ""));
  for (const candidate of [`${base}.ts`, `${base}/index.ts`]) if (existsSync(candidate)) return candidate;
  throw new Error(`cannot resolve ${spec} from ${fromFile}`);
}

/** @returns {{ files: string[], external: Map<string, string[]> }} files relative to `root`, external spec -> importers. */
export function valueImportClosure(root, entries) {
  const seen = new Set();
  const external = new Map();
  const queue = entries.map((e) => resolve(root, e));
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = stripComments(readFileSync(file, "utf8"));
    const specs = [];
    for (const m of source.matchAll(IMPORT)) {
      if (m[2]) continue; // import type / export type
      if (allBindingsTypeOnly(m[3].trim())) continue;
      specs.push(m[4]);
    }
    for (const m of source.matchAll(BARE_IMPORT)) specs.push(m[1]);
    for (const m of source.matchAll(DYNAMIC)) specs.push(m[1] ?? m[2]);
    for (const spec of specs) {
      if (spec.startsWith(".")) queue.push(resolveRelative(file, spec));
      else {
        const rel = relative(root, file).replace(/\\/g, "/");
        external.set(spec, [...(external.get(spec) ?? []), rel].sort());
      }
    }
  }
  return { files: [...seen].map((f) => relative(root, f).replace(/\\/g, "/")).sort(), external };
}
