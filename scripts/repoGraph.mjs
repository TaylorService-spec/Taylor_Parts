// Repository structure graph — PURE CORE.
//
// WHY THIS EXISTS: answering "where does X live / what covers Y / is Z still real"
// was costing a full grep-and-read sweep every time, per session, per AI. Almost all
// of that work is mechanical and the answers only change when the repo changes. This
// module derives those relationships ONCE, deterministically, so a reader looks them
// up instead of rediscovering them.
//
// It is deliberately STRUCTURAL, not semantic. It knows that a file imports another
// and that a doc cites a path; it does not know whether either is a good idea. Use it
// to find WHAT to read, not as a substitute for reading.
//
// PURE: no filesystem, network, or process access. The caller supplies the file list
// and a `read(path) -> string` function, which is what makes this testable.

/** Directories that are never repository content. */
/**
 * Paths that are repository content but explicitly NOT authoritative, so their
 * references must not generate hygiene findings. docs/ai/memory-archive holds retired
 * AI working notes retained verbatim (see its README) -- their citations were true when
 * written and are expected to rot.
 */
export const NON_AUTHORITATIVE = ["docs/ai/memory-archive/"];
export const isNonAuthoritative = (p) => NON_AUTHORITATIVE.some((n) => p.startsWith(n));

export const IGNORED_SEGMENTS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", ".next", ".cache", ".claude", ".codex",
]);

const CODE_RE = /\.(m?[jt]sx?)$/;
const DOC_RE = /\.md$/;

/** Windows paths reach this module too; normalize separators without a literal escape. */
const BACKSLASH = String.fromCharCode(92);
export const toPosix = (p = "") => p.split(BACKSLASH).join("/");

export const isCode = (p) => CODE_RE.test(p);
export const isDoc = (p) => DOC_RE.test(p);
export const isIgnored = (p) => p.split("/").some((s) => IGNORED_SEGMENTS.has(s));

/** Normalize "a/b/../c" and "./x" to a canonical repo-relative path. */
export function normalizePath(p) {
  const out = [];
  for (const seg of toPosix(p).split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") { out.pop(); continue; }
    out.push(seg);
  }
  return out.join("/");
}

const dirOf = (p) => toPosix(p).split("/").slice(0, -1).join("/");

/**
 * Resolve a relative import specifier against the importing file, trying the
 * extension/index candidates Node and bundlers actually use.
 * Returns the matching path from `known`, or null when it resolves outside the repo.
 */
export function resolveImport(fromFile, spec, known) {
  if (!spec.startsWith(".")) return null;           // bare specifier = dependency, not repo content
  const base = normalizePath(`${dirOf(fromFile)}/${spec}`);
  const candidates = [
    base,
    ...[".ts", ".tsx", ".js", ".jsx", ".mjs"].flatMap((e) => [`${base}${e}`, `${base}/index${e}`]),
  ];
  return candidates.find((c) => known.has(c)) ?? null;
}

/** Import/require/dynamic-import specifiers in a source file. */
export function parseImportSpecifiers(content = "") {
  const specs = new Set();
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s+["']([^"']+)["']/g,
  ];
  for (const re of patterns) for (const m of content.matchAll(re)) specs.add(m[1]);
  return [...specs];
}

/**
 * Repo paths a document points at: markdown link targets plus paths named in
 * backticks. Both are how this repo's docs actually cite code, and both go stale.
 */
export function parseDocReferences(content = "") {
  const refs = new Set();
  for (const m of content.matchAll(/\]\(([^)\s#]+)/g)) refs.add(m[1]);
  for (const m of content.matchAll(/`([A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,5})`/g)) refs.add(m[1]);
  return [...refs].filter((r) => !/^(https?:|mailto:|#)/.test(r));
}

/** Path prefixes a workflow's `paths:` filters select. Determines CI coverage. */
export function parseWorkflowPaths(content = "") {
  const out = new Set();
  for (const m of content.matchAll(/^\s*-\s*["']?([A-Za-z0-9_./*-]+)["']?\s*$/gm)) {
    const v = m[1];
    if (v.includes("/") || v.includes("*")) out.add(v.replace(/\/?\*\*.*$/, "").replace(/\/[^/]*\*.*$/, ""));
  }
  out.delete("");
  return [...out];
}

const coveredBy = (file, prefixes) => prefixes.some((p) => file === p || file.startsWith(`${p}/`));

/**
 * @param {object}   args
 * @param {string[]} args.files  repo-relative paths
 * @param {(p:string)=>string} args.read
 * @returns graph + hygiene findings
 */
export function buildGraph({ files = [], read = () => "" } = {}) {
  const present = files.filter((f) => !isIgnored(f));
  const known = new Set(present);
  const code = present.filter(isCode);
  const docs = present.filter(isDoc);
  const workflows = present.filter((f) => f.startsWith(".github/workflows/") && /\.ya?ml$/.test(f));

  const imports = {};
  const importedBy = {};
  for (const f of code) {
    const targets = [];
    for (const spec of parseImportSpecifiers(safeRead(read, f))) {
      const t = resolveImport(f, spec, known);
      if (t && t !== f) {
        targets.push(t);
        (importedBy[t] ??= []).push(f);
      }
    }
    if (targets.length) imports[f] = [...new Set(targets)].sort();
  }

  const topLevelDirs = new Set(present.map((f) => f.split("/")[0]).filter((s) => s.includes(".") === false || s.startsWith(".")));

  const docRefs = {};
  const staleRefs = [];
  for (const d of docs) {
    const refs = [];
    for (const raw of parseDocReferences(safeRead(read, d))) {
      // Only ./ and ../ are document-relative. A leading dot alone (".github/...")
      // is a root-anchored dotfile path, not a relative one.
      const relative = raw.startsWith("./") || raw.startsWith("../");
      const abs = relative ? normalizePath(`${dirOf(d)}/${raw}`) : normalizePath(raw);
      if (!abs || abs.startsWith("..")) continue;
      // Only judge references that look like repo paths; prose in backticks is not a claim.
      const looksRepoPath =
        abs.includes("/") && /[.][A-Za-z0-9]{1,5}$/.test(abs) && !abs.includes("...");
      if (!looksRepoPath) continue;
      refs.push(abs);
      // Only an UNAMBIGUOUS, root-anchored reference can be called stale. A bare
      // "src/x.js" exists under more than one app root here, so guessing produces
      // noise that makes the whole report ignorable. Archived notes are exempt --
      // their citations were true when written and are expected to rot.
      const anchored = topLevelDirs.has(abs.split("/")[0]);
      if (anchored && !known.has(abs) && !isNonAuthoritative(d)) {
        staleRefs.push({ doc: d, ref: abs });
      }
    }
    if (refs.length) docRefs[d] = [...new Set(refs)].sort();
  }

  const inboundDocLinks = {};
  for (const [d, refs] of Object.entries(docRefs)) {
    for (const r of refs) if (isDoc(r)) (inboundDocLinks[r] ??= []).push(d);
  }
  const orphanDocs = docs.filter((d) => !inboundDocLinks[d] && !/README\.md$/i.test(d));

  const workflowPaths = {};
  for (const w of workflows) workflowPaths[w] = parseWorkflowPaths(safeRead(read, w));
  const allPrefixes = Object.values(workflowPaths).flat();
  const tests = code.filter((f) => /\.test\.m?[jt]sx?$/.test(f));
  // NOT "never run in CI" -- a workflow can invoke a test in a `run:` step without
  // path-filtering on it. This is the narrower, provable claim: editing ONLY this file
  // triggers no workflow, so a change to it ships without its own suite running.
  const testsNoPathTrigger = tests.filter((t) => !coveredBy(t, allPrefixes));

  const deadCode = code.filter(
    (f) => !importedBy[f] && !tests.includes(f) && !/\/(index|main)\.[mjt]/.test(f) && !f.startsWith("scripts/"),
  );

  return {
    schema: "taylor.repo-graph/1",
    counts: {
      files: present.length, code: code.length, docs: docs.length,
      workflows: workflows.length, tests: tests.length,
      importEdges: Object.values(imports).reduce((a, b) => a + b.length, 0),
    },
    imports, importedBy, docRefs, inboundDocLinks, workflowPaths,
    hygiene: {
      staleRefs: staleRefs.sort((a, b) => a.doc.localeCompare(b.doc)),
      orphanDocs: orphanDocs.sort(),
      testsNoPathTrigger: testsNoPathTrigger.sort(),
      unimportedCode: deadCode.sort(),
    },
  };
}

function safeRead(read, p) { try { return read(p) ?? ""; } catch { return ""; } }
