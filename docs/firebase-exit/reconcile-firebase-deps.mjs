#!/usr/bin/env node
// Firebase dependency reconciliation: READ-ONLY. Walks the working tree, builds the runtime import
// graph and prints the counts used by docs/firebase-exit/firebase-dependency-reconciliation-2026-10-20.md.
// It never writes, deletes or installs anything. Usage (from the repo root):
//   node docs/firebase-exit/reconcile-firebase-deps.mjs            # human-readable report
//   node docs/firebase-exit/reconcile-firebase-deps.mjs --json     # machine-readable, deterministic
//
// Method (all of it is regex over source text; no TypeScript compiler, no build):
//   * node  = every .ts/.tsx/.js/.jsx/.mjs/.cjs file under the roots below (node_modules, lib, dist skipped).
//   * edge  = a RELATIVE import/export-from/dynamic import()/require() with the `import type` / `export type`
//             forms EXCLUDED (type-only edges are erased by tsc, so they are not runtime dependencies).
//             `../lib/x.js` in a script resolves to functions/src/x.ts (lib/ is the tsc output of src/).
//   * client Firebase file = a field-ops-app-vite/src file that imports the `firebase` package (any subpath).
//   * server Firebase file = a functions/src file that names firebase-admin* or firebase-functions* in an
//             import/export-from/require/dynamic import. "runtime" = at least one non-`import type` naming.
//   * entry points = functions/src/index.ts (deployed Cloud Functions), functions/src/eosApi/server.ts
//             (Render EOS API; started by functions/scripts/serveEosApi.mjs); script entries = functions/scripts/**,
//             functions/_e2e.mjs, functions/authpr4/**, scripts/** (importers outside src); test entries = functions/test/**,
//             *.test.* anywhere, field-ops-app-vite test dirs.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKIP = new Set(["node_modules", "lib", "dist", ".git", ".claude"]);
const EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const rel = (p) => relative(ROOT, p).split(sep).join("/");

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (EXT.test(name)) yield p;
  }
}

function stripComments(t) {
  // Good enough for import scanning: drops /* */ and // comments (a // inside a string is rare in import lines).
  return t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"`])\/\/.*$/gm, "$1");
}

// Returns [{ spec, type }]; type=true for `import type` / `export type` (erased at compile time).
function importsOf(text) {
  const t = stripComments(text);
  const out = [];
  for (const m of t.matchAll(/(?:^|[\n;])\s*(import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/g)) {
    // `import "x"` (side effect) and `import a from "x"`; `export {a} from "x"`; skip `export const x = "y"` (no `from`)
    const whole = m[0];
    if (m[1] === "export" && !/\sfrom\s*['"]/.test(whole)) continue;
    out.push({ spec: m[3], type: !!m[2] });
  }
  for (const m of t.matchAll(/(?:\bimport|\brequire)\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push({ spec: m[1], type: false });
  return out;
}

function resolveRel(fromFile, spec, index) {
  if (!spec.startsWith(".")) return null;
  let target = resolve(dirname(fromFile), spec);
  const r = rel(target);
  // scripts import the tsc output: functions/lib/<x>.js -> functions/src/<x>.ts
  let cands = [r];
  if (r.startsWith("functions/lib/")) cands = ["functions/src/" + r.slice("functions/lib/".length)];
  const tries = [];
  for (const c of cands) {
    const base = c.replace(/\.(js|mjs|cjs)$/, "");
    tries.push(c, base + ".ts", base + ".tsx", base + ".js", base + ".mjs", base + "/index.ts", base + "/index.js", c + ".ts", c + ".js", c + ".mjs", c + "/index.ts", c + "/index.js");
  }
  return tries.find((c) => index.has(c)) ?? null;
}

const roots = ["functions/src", "functions/scripts", "functions/test", "functions/authpr4", "functions/migrations", "functions/_e2e.mjs", "scripts", "integrations", "field-ops-app-vite/src", "field-ops-app-vite/test"];
const files = new Map(); // rel -> text
for (const r of roots) {
  const p = join(ROOT, r);
  if (existsSync(p) && statSync(p).isFile()) files.set(r, readFileSync(p, "utf8"));
  else for (const f of walk(p)) files.set(rel(f), readFileSync(f, "utf8"));
}
const index = new Set(files.keys());

const isTest = (f) => /\.test\.|(^|\/)test\/|(^|\/)__tests__\//.test(f) || /^field-ops-app-vite\/test\//.test(f);
const isScript = (f) => /^functions\/(scripts|authpr4|migrations)\//.test(f) || f === "functions/_e2e.mjs" || /^scripts\//.test(f) || /^integrations\//.test(f);

const importers = new Map(); // target -> Set(importer) for RUNTIME edges only
const edges = new Map(); // file -> Set(target)
const fbNames = new Map(); // file -> {runtime:bool, specs:Set}
for (const [f, text] of files) {
  const es = new Set();
  for (const { spec, type } of importsOf(text)) {
    if (/^(firebase-admin|firebase-functions)(\/|$)/.test(spec) && f.startsWith("functions/src/")) {
      const e = fbNames.get(f) ?? { runtime: false, specs: new Set() };
      e.specs.add(spec);
      if (!type) e.runtime = true;
      fbNames.set(f, e);
    }
    if (type) continue;
    const t = resolveRel(join(ROOT, f), spec, index);
    if (!t || t === f) continue;
    es.add(t);
    if (!importers.has(t)) importers.set(t, new Set());
    importers.get(t).add(f);
  }
  // Path-string references to compiled output, used by scripts/tests that load modules through a helper
  // (for example L("functions/lib/access/x.js") or path.join(..., "lib", ...)): "(functions/|../)lib/<path>.js" -> src/<path>.ts.
  if (!f.startsWith("functions/src/") && !f.startsWith("field-ops-app-vite/")) {
    for (const m of stripComments(text).matchAll(/['"`](?:functions\/|(?:\.\.\/)+)lib\/([A-Za-z0-9_\/.-]+?)\.m?js['"`]/g)) {
      const t = ["functions/src/" + m[1] + ".ts", "functions/src/" + m[1] + "/index.ts"].find((c) => index.has(c));
      if (!t || t === f) continue;
      es.add(t);
      if (!importers.has(t)) importers.set(t, new Set());
      importers.get(t).add(f);
    }
  }
  edges.set(f, es);
}

function reach(entries) {
  const seen = new Set();
  const stack = entries.filter((e) => index.has(e));
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    for (const t of edges.get(n) ?? []) stack.push(t);
  }
  return seen;
}

const fnReach = reach(["functions/src/index.ts"]);
const apiReach = reach(["functions/src/eosApi/server.ts"]);
const scriptEntries = [...index].filter((f) => isScript(f) && !isTest(f));
const scriptReach = reach(scriptEntries);
const testEntries = [...index].filter((f) => isTest(f));
const testReach = reach(testEntries);

// ---------- client ----------
const clientFb = [];
for (const [f, text] of files) {
  if (!f.startsWith("field-ops-app-vite/src/")) continue;
  if (importsOf(text).some((i) => /^firebase(\/|$)/.test(i.spec))) clientFb.push(f);
}
clientFb.sort();
// Files that reach Firebase only through the in-repo shim (field-ops-app-vite/src/firebase/firebase.js).
const clientShim = [];
for (const [f, text] of files) {
  if (!f.startsWith("field-ops-app-vite/src/") || isTest(f) || clientFb.includes(f)) continue;
  if (importsOf(text).some((i) => /(^|\/)firebase\/firebase(\.js)?$/.test(i.spec) || i.spec === "./firebase" || i.spec === "./firebase.js")) clientShim.push(f);
}
clientShim.sort();

// ---------- server ----------
const server = [...fbNames.keys()].sort();
function classify(f) {
  const inFn = fnReach.has(f);
  const inApi = apiReach.has(f);
  if (inFn && inApi) return "callable+eosApi";
  if (inFn) return "callable-only";
  if (inApi) return "eosApi-only";
  if (scriptReach.has(f)) return "script-only";
  if (testReach.has(f)) return "test-only";
  return "orphan";
}
const rows = server.map((f) => {
  const imp = [...(importers.get(f) ?? [])];
  return { file: f, dir: f.split("/").slice(0, 3).join("/").replace(/\.[a-z]+$/, ""), class: classify(f), runtime: fbNames.get(f).runtime, importers: imp.length, testImporters: imp.filter(isTest).length };
});
const tally = (key) => rows.reduce((a, r) => ((a[r[key]] = (a[r[key]] ?? 0) + 1), a), {});

const summary = {
  clientFirebaseFiles: clientFb.length,
  clientShimOnlyConsumers: clientShim.length,
  serverFirebaseNamingFiles: server.length,
  serverRuntimeNaming: rows.filter((r) => r.runtime).length,
  serverTypeOnlyNaming: rows.filter((r) => !r.runtime).length,
  byClass: tally("class"),
  functionsIndexReachable: fnReach.size,
  eosApiReachable: apiReach.size,
};
const orphans = rows.filter((r) => r.class === "orphan" || r.class === "test-only");

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ summary, client: clientFb, clientShim, rows, orphans: orphans.map((r) => r.file) }, null, 1));
} else {
  console.log("SUMMARY", JSON.stringify(summary, null, 1));
  console.log("\nCLIENT FILES IMPORTING firebase\n" + clientFb.join("\n"));
  console.log("\nCLIENT FILES REACHING FIREBASE ONLY THROUGH THE SHIM\n" + clientShim.join("\n"));
  const dirs = {};
  for (const r of rows) {
    const parts = r.file.split("/");
    const d = parts.length > 3 ? parts[2] : "(root)";
    (dirs[d] ??= {})[r.class] = (dirs[d][r.class] ?? 0) + 1;
  }
  console.log("\nPER-DIRECTORY (class counts)");
  for (const d of Object.keys(dirs).sort()) console.log(d, JSON.stringify(dirs[d]));
  console.log("\nORPHAN / TEST-ONLY FILES");
  for (const r of orphans) console.log(`${r.class}\t${r.file}\timporters=${r.importers}\ttestImporters=${r.testImporters}\truntimeFirebase=${r.runtime}`);
}

// ---------- deployed functions (optional): node reconcile-firebase-deps.mjs --functions <inventory-dir> ----------
// <inventory-dir> holds the read-only `firebase functions:list --json` captures
// (functions-taylor-parts.json, functions-eos-platform-sandbox.json, functions-eos-platform-certification.json).
const fi = process.argv.indexOf("--functions");
if (fi > 0) {
  const dir = process.argv[fi + 1];
  const names = (f) => JSON.parse(readFileSync(join(dir, f), "utf8")).result.map((x) => x.id).sort();
  const P = names("functions-taylor-parts.json"), S = names("functions-eos-platform-sandbox.json"), C = names("functions-eos-platform-certification.json");
  const idx = stripComments(files.get("functions/src/index.ts"));
  const exported = new Set();
  for (const m of idx.matchAll(/export\s*\{([^}]*)\}\s*from/g)) for (const n of m[1].split(",")) { const x = n.trim().split(/\s+as\s+/).pop().trim(); if (x) exported.add(x); }
  for (const m of idx.matchAll(/export\s+(?:const|function|async function)\s+(\w+)/g)) exported.add(m[1]);
  const notIn = (L) => L.filter((n) => !exported.has(n));
  console.log("\nDEPLOYED FUNCTIONS vs functions/src/index.ts exports");
  console.log(JSON.stringify({
    sourceExports: exported.size,
    production: { deployed: P.length, notInSource: notIn(P).length },
    sandbox: { deployed: S.length, notInSource: notIn(S).length, productionIsSubset: P.every((n) => S.includes(n)), sandboxOnly: S.filter((n) => !P.includes(n)).length },
    certification: { deployed: C.length, names: C },
    sourceNotDeployedInProduction: [...exported].filter((n) => !P.includes(n)).length,
  }, null, 1));
  console.log("production notInSource:", notIn(P).join(","));
  console.log("sandbox notInSource:", notIn(S).join(","));
}
