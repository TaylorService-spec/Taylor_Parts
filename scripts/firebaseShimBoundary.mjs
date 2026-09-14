// FIREBASE SHIM BOUNDARY RATCHET. Governs the GROWTH of the transitional Firestore/Functions
// re-export shims' consumer sets. Companion to scripts/firebaseExitGuard.mjs; re-derived against
// main at 64008d5ae0bdd9532909671b15a91122400accf1.
//
// ======================== WHY THIS EXISTS, AND WHAT IT DELIBERATELY DOES NOT DO ================
//
// scripts/firebaseExitGuard.mjs fences DIRECT imports of a Firebase business-runtime dependency.
// It is a direct-import fence by design, so a Firestore handle obtained in one module and
// re-exported from it is invisible to the guard in every module downstream: those modules reach
// Firestore without naming a single forbidden specifier.
//
// Measured at 64008d5a: 50 of 428 functions/src source files import something from a module that
// itself imports "firebase-admin/firestore", and on the frontend 71 field-ops-app-vite/src files
// import from field-ops-app-vite/src/firebase/firebase.js, whose `db` IS a Firestore instance.
//
// OWNER RULING, and this module obeys it: approved transitional Firestore re-export shims MAY
// REMAIN temporarily. Recursively marking every existing consumer a violation is explicitly NOT
// the remedy -- it would produce hundreds of findings that identify no new authority, exactly the
// failure mode that a naive widening of the guard's roots already produced once (239 false
// violations, recorded in firebaseExitGuard.mjs's categoryOwnsPath).
//
// THE DISTINCTION THIS MODULE HOLDS. The dependency IS fenced at the shim: the shim itself is a
// guard baseline entry, it cannot move, and it cannot be joined by a new one. What is UNFENCED is
// the GROWTH of the shim's consumer set -- nothing today stops a new business module from reaching
// Firestore through `import { db } from "../firebase/firebase"` and never appearing anywhere in
// the Firebase-exit ledger. So this ratchet governs GROWTH, NOT EXISTENCE:
//
//   * the shim registry is DERIVED from the code, never hand-listed (see discoverShims);
//   * every consumer observed today is recorded in the committed census and tolerated;
//   * the census is SHRINK-ONLY, exactly like the guard's own baseline -- a NEW consumer is a
//     violation, a removed consumer is the ratchet working;
//   * a stale census entry is a violation too, for the same reason the guard treats one that way:
//     a tolerated path that no longer consumes the shim would silently re-tolerate it later.
//
// RETIREMENT. These shims are retired WITH the underlying Firebase exit, not separately. When a
// shim's own guard baseline entry goes (because the shim stops importing Firestore), the shim
// stops being discovered here and its whole census section must be deleted in the same change --
// the stale-entry check enforces that. There is no separate shim-retirement milestone to schedule
// and none should be created; see docs/architecture/firebase-exit-ratchet.md.
//
// USAGE
//   node scripts/firebaseShimBoundary.mjs                              # enforce committed census
//   node scripts/firebaseShimBoundary.mjs --previous-census=<path>      # + growth ratchet
//   node scripts/firebaseShimBoundary.mjs --write                       # regenerate the census
//
// UNLIKE the guard, a bare run of THIS script ENFORCES -- it never bootstraps a census. Writing
// the census requires --write, explicitly, so that "it passed" can never mean "it wrote itself a
// new floor". (--previous-census is the second, independent check: it stops a change from adding
// a consumer and widening the census in the same commit, the same hole evaluateRatchet closes for
// the guard.)

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { classifyFile, SCAN_EXTENSIONS, SKIP_DIRECTORIES } from "./firebaseExitGuard.mjs";

const REPO_ROOT = process.cwd();
export const CENSUS_RELATIVE_PATH = "docs/architecture/firebase-shim-consumer-census.json";

/** The roots this boundary covers. The integrations root carries no Firebase dependency at all at
 * 64008d5a, so it contributes no shims -- it is scanned anyway so that gaining one is caught. */
export const SHIM_SCAN_ROOTS = ["field-ops-app-vite/src", "functions/src", "integrations"];

/**
 * EVERY top-level `export`, value or not. Non-value exports (`export interface`, `export type`,
 * `export default`, a bare `export {}` re-export) are matched too, and that matters: a binding's
 * body is taken as the text up to the NEXT top-level export, so an unmatched export form silently
 * extends the previous binding's body across it. That defect made
 * `export function resolveEmployeeLinkFacts` -- a pure function over plain inputs -- absorb four
 * hundred lines of unrelated Firestore code because the `export interface` twelve lines below it
 * was not a boundary. Match everything; capture a name only for the forms that can carry a value.
 */
const EXPORT_DECLARATION_PATTERN =
  /^[ \t]*export\b[ \t]*(?:(?:async[ \t]+)?(const|let|var|function|class)[ \t]+([A-Za-z0-9_$]+))?/gm;

/**
 * An expression that IS a Firestore/Functions handle -- anchored at BOTH ends, deliberately.
 *
 * `export const db = getFirestore(app)` hands its caller the database. `return
 * getFirestore().collection("x").doc(id)` does NOT: that is a DocumentReference, one document
 * wide, and the caller cannot reach anything else with it. An unanchored "contains getFirestore("
 * test conflated the two and pulled in every `xCounterDocId()` helper in functions/src. Anchoring
 * is what distinguishes handing over the database from handing over one reference into it.
 */
const HANDLE_EXPRESSION_PATTERN =
  /^\s*(?:await\s+)?(?:getFirestore|getFunctions|admin\s*\.\s*firestore)\s*\([^()]*\)\s*$/;

/**
 * A Firestore WRITE, including this repository's own gate wrappers (lib/firebaseSafe.js wraps the
 * four mutating APIs). Used by rule R3.
 */
const WRITE_API_PATTERN =
  /(?<![.\w$])(safeAddDoc|safeSetDoc|safeUpdateDoc|safeDeleteDoc|addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\s*\(/;

/**
 * The object literal a body `return`s, brace-matched, or "" when it returns no literal.
 *
 * Brace matching rather than a regex because the distinction R3 rests on is INSIDE the literal:
 * `return { add, update }` whose properties are FUNCTIONS is a capability object; `return {
 * created, skipped, errors }` is a result. A regex that ran past the literal's close would see the
 * rest of the module and stop distinguishing them, which it did -- `importContacts` and
 * `assignJob`, both ordinary domain commands returning a result summary, were discovered as shims
 * until this was brace-matched.
 */
export function returnedObjectLiteral(body) {
  const start = body.search(/\breturn\s*\{/);
  if (start === -1) return "";
  const open = body.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < body.length; index += 1) {
    if (body[index] === "{") depth += 1;
    else if (body[index] === "}") {
      depth -= 1;
      if (depth === 0) return body.slice(open, index + 1);
    }
  }
  return body.slice(open);
}

/** A property whose value is callable -- what makes a returned literal a CAPABILITY object. */
const CALLABLE_PROPERTY_PATTERN = /=>|\bfunction\b|\basync\b/;

/** A declared return type that IS a handle: `export function db(): Firestore`. */
const HANDLE_RETURN_TYPE_PATTERN = /\)\s*:\s*(Firestore|Functions)\s*(\{|$)/m;

/**
 * Firestore/Functions APIs whose FIRST argument is a Firebase OBJECT -- a Firestore instance, a
 * CollectionReference, or a DocumentReference. Used by rule R2 below.
 *
 * The `(?<![.\w$])` lookbehind is not cosmetic: it restricts this to a FREE function call, the
 * modular web-SDK style (`addDoc(ref, data)`, `collection(db, name)`) where argument zero really is
 * a Firebase object. Without it, `col.doc(technicianId)` matched -- the admin SDK's METHOD style,
 * whose argument zero is a document ID string, not a handle. That one missing lookbehind
 * discovered 65 "shims" across functions/src, nearly all of them ordinary
 * `readX(db, someId)` helpers, which is the false-positive explosion this artifact exists to
 * avoid producing. Measured, then fixed.
 */
const REF_CONSUMING_API_PATTERN =
  /(?<![.\w$])(collection|collectionGroup|doc|getDoc|getDocs|getCountFromServer|setDoc|addDoc|updateDoc|deleteDoc|onSnapshot|runTransaction|writeBatch|query|httpsCallable)\s*\(\s*([A-Za-z0-9_$]+)/g;

/**
 * ================== WHAT COUNTS AS A SHIM, AND WHAT IS MERELY INSULATION ==================
 *
 * This is the single most consequential judgement in this file, and the first attempt got it
 * wrong in a way worth recording, because it is the same mistake the Owner ruling forbids.
 *
 * REJECTED RULE: "an export whose body touches a Firestore API, in a module that imports
 * Firestore". Measured at 64008d5a that rule discovered 190 shims with 146 consumers, and almost
 * every one of them was a React hook or a query service -- `useAccount(accountId)`,
 * `fetchPartMasterList()`, `useWorkOrder(id)`. Those modules do not hand their callers Firestore.
 * They hand their callers DOMAIN DATA, having used Firestore internally and kept it. That is
 * INSULATION, and it is the shape the migration wants: the module is itself a guard baseline
 * entry, so its Firestore dependency is already fenced, already immovable, and already unable to
 * be joined by a new one. Recording its callers as shim consumers would have produced ~146
 * findings that identify no new authority -- the outcome the ruling explicitly rules out.
 *
 * THE RULE USED: an export confers authority only when the FIREBASE OBJECT ITSELF crosses the
 * module boundary.
 *
 *   R1 HANDLE -- the export's value is, or returns, a Firestore/Functions instance.
 *      `export const db = getFirestore(app)`; `export function db(): Firestore`.
 *      A caller holding it can read or write anything, with no narrowing whatsoever.
 *
 *   R2 REF PASS-THROUGH -- the export forwards one of ITS OWN PARAMETERS into a Firestore API as
 *      that API's Firebase-object argument. `safeAddDoc = (ref, data) => addDoc(ref, data)`: the
 *      caller supplies the CollectionReference, so the caller already holds Firestore authority
 *      and this module only relays it.
 *      Contrast `doc(db, "accounts", id)` inside a hook: argument zero is the MODULE'S OWN handle,
 *      not a parameter, so nothing crosses the boundary but the result.
 *
 * Bindings whose value is an identity object are excluded by construction: `getAuth(...)` is not a
 * handle producer here, so `export const auth = getAuth(app)` is not a shim export. Firebase Auth
 * is IDENTITY_ONLY per Owner ruling and is outside this boundary exactly as it is outside the
 * guard's.
 *
 * KNOWN AND DELIBERATE RESIDUAL: a module that re-wraps Firestore into a NARROWED domain API and
 * exports that (field-ops-app-vite/src/firebase/collectionStore.js's `makeCollectionStore`, which
 * returns an object bound to one collection) is treated as insulation, not as a shim. It is not
 * zero authority -- a caller gets unrestricted access to that one collection -- but it is
 * collection-scoped, it is itself a guard baseline entry, and it appears in this census in the
 * role that matters: as a CONSUMER of firebase.js's `db`. Widening R1/R2 to cover it could not be
 * done without readmitting the hook class, which is the worse error. Recorded rather than hidden.
 */
export function authorityExports(text) {
  const found = [];
  const marks = [];
  EXPORT_DECLARATION_PATTERN.lastIndex = 0;
  let match;
  while ((match = EXPORT_DECLARATION_PATTERN.exec(text)) !== null) {
    marks.push({ index: match.index, kind: match[1], name: match[2] });
    if (match[0].length === 0) EXPORT_DECLARATION_PATTERN.lastIndex += 1;
  }
  for (let position = 0; position < marks.length; position += 1) {
    const mark = marks[position];
    if (!mark.name) continue; // a boundary-only export form (interface/type/default/re-export)
    const end = position + 1 < marks.length ? marks[position + 1].index : text.length;
    const body = text.slice(mark.index, end);

    // R1. The binding's VALUE is a handle: a `const` initialized to one, a function whose declared
    // return type is one, or a function that `return`s one. A default parameter value such as
    // `firestoreImportJobStore(db: Firestore = getFirestore())` is deliberately NOT a match -- the
    // handle is being RECEIVED there, with a fallback, not handed onward -- which is why only the
    // initializer after the first `=` of a value binding, and only `return` expressions of a
    // function, are tested rather than the declaration line as a whole.
    const isValueBinding = mark.kind === "const" || mark.kind === "let" || mark.kind === "var";
    const firstLine = body.split("\n")[0];
    const initializer = isValueBinding ? firstLine.slice(firstLine.indexOf("=") + 1).replace(/;\s*$/, "") : "";
    const returnExpressions = [...body.matchAll(/\breturn\s+([^;\n]+)/g)].map((entry) => entry[1]);
    if ((isValueBinding && HANDLE_EXPRESSION_PATTERN.test(initializer)) ||
        (!isValueBinding && HANDLE_RETURN_TYPE_PATTERN.test(firstLine)) ||
        returnExpressions.some((expression) => HANDLE_EXPRESSION_PATTERN.test(expression))) {
      found.push({ name: mark.name, reason: "handle" });
      continue;
    }

    // R2. A parameter of this export is forwarded as a Firestore API's Firebase-object argument.
    const parameterList = body.match(/\(([^)]*)\)/);
    const parameters = new Set(
      (parameterList?.[1] ?? "")
        .split(",")
        .map((part) => part.trim().split(/[:=\s]/)[0].replace(/^\.\.\./, ""))
        .filter((name) => /^[A-Za-z0-9_$]+$/.test(name)));
    REF_CONSUMING_API_PATTERN.lastIndex = 0;
    let call;
    let refPassThrough = false;
    let bindsModuleHandle = false;
    while ((call = REF_CONSUMING_API_PATTERN.exec(body)) !== null) {
      if (parameters.has(call[2])) refPassThrough = true;
      else bindsModuleHandle = true;
    }
    if (refPassThrough) { found.push({ name: mark.name, reason: "ref-pass-through" }); continue; }

    // R3 BOUND-COLLECTION FACTORY. An export that binds a Firestore reference off the MODULE'S own
    // handle and returns an OBJECT LITERAL containing writes is handing its caller a Firestore-backed
    // write capability, not data. field-ops-app-vite/src/firebase/collectionStore.js's
    // `makeCollectionStore` is exactly this, and four unfenced field-ops-app-vite/src/domain modules
    // (accounts, contacts, locations, equipmentRepository) reach Firestore writes through it and
    // through nothing else -- measured at 64008d5a.
    //
    // Each conjunct is what keeps the INSULATION classes out. A read hook such as `useAccount(id)`
    // also builds `doc(db, "accounts", id)` off the module handle and also returns an object
    // literal -- but that literal holds STATE and the hook performs no write; requiring a write
    // INSIDE the returned literal excludes it, and without that conjunct this rule readmits
    // roughly fifty hooks and query services. A domain command such as `importContacts(rows)`
    // writes and returns a literal too -- but a literal of COUNTS, not of functions; requiring
    // callable properties excludes it. Read-only insulation, and commands that return results, are
    // deliberately NOT governed here: see the header.
    const literal = returnedObjectLiteral(body);
    if (bindsModuleHandle && CALLABLE_PROPERTY_PATTERN.test(literal) && WRITE_API_PATTERN.test(literal)) {
      found.push({ name: mark.name, reason: "bound-collection-factory" });
    }
  }
  return found;
}

function walk(directory, found = []) {
  let entries;
  try { entries = readdirSync(directory); } catch { return found; }
  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const full = join(directory, entry);
    let info;
    try { info = statSync(full); } catch { continue; }
    if (info.isDirectory()) walk(full, found);
    else if (SCAN_EXTENSIONS.some((extension) => entry.endsWith(extension))) found.push(full);
  }
  return found;
}

export function scanFiles(absoluteRoot = REPO_ROOT) {
  const files = new Map();
  for (const root of SHIM_SCAN_ROOTS) {
    for (const file of walk(join(absoluteRoot, root))) {
      const relativePath = relative(absoluteRoot, file).split(sep).join("/");
      if (files.has(relativePath)) continue;
      try { files.set(relativePath, readFileSync(file, "utf8")); } catch { /* unreadable */ }
    }
  }
  return files;
}

/** Resolve a relative specifier to a scanned file, honouring TS's extensionless and ".js"-meaning-
 * ".ts" import styles and index files. Returns null for a bare package specifier. */
export function resolveLocalSpecifier(fromRelativePath, specifier, files) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve("/", dirname(fromRelativePath), specifier).slice(1).replace(/\.js$/, "");
  const candidates = [
    ...SCAN_EXTENSIONS.map((extension) => base + extension),
    ...SCAN_EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ];
  for (const candidate of candidates) if (files.has(candidate)) return candidate;
  return null;
}

/**
 * DISCOVER the approved transitional shims -- never a hand-maintained list, because a hand list
 * goes stale silently and a stale allow-list is a bypass.
 *
 * A module is a shim when BOTH hold:
 *   1. the FIREBASE EXIT GUARD already classifies it as carrying a fenced business-runtime
 *      dependency (so the dependency is genuinely FENCED at this module -- it is a guard baseline
 *      entry, it cannot move, and no new one can join it); AND
 *   2. it exports at least one authority-conferring binding (see authorityExports).
 *
 * Condition 1 is what ties retirement to the Firebase exit: a module that stops importing
 * Firestore stops being a shim here, automatically and in the same change.
 */
export function discoverShims(files) {
  const shims = [];
  for (const [relativePath, text] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const categories = classifyFile(text, relativePath);
    if (categories.size === 0) continue;
    const exportsFound = authorityExports(text);
    if (exportsFound.length === 0) continue;
    shims.push({
      shim: relativePath,
      guardCategories: [...categories].sort(),
      authorityExports: exportsFound.map((entry) => entry.name).sort(),
    });
  }
  return shims;
}

const NAMED_IMPORT_PATTERN = /import\s+(type\s+)?([\s\S]*?)\s+from\s*["']([^"']+)["']/g;

/** The distinct specifiers in `text` that resolve to `target`. Collected in ONE pass and returned
 * as a plain array, so no caller ever interleaves another scan over the shared /g regex. */
export function specifiersTargeting(text, relativePath, target, files) {
  const specifiers = new Set();
  NAMED_IMPORT_PATTERN.lastIndex = 0;
  let match;
  while ((match = NAMED_IMPORT_PATTERN.exec(text)) !== null) {
    if (resolveLocalSpecifier(relativePath, match[3], files) === target) specifiers.add(match[3]);
  }
  return [...specifiers];
}

/** The identifiers a file imports as VALUES from `specifier`. `import type` clauses and
 * `type`-prefixed members are excluded: a type import carries no runtime authority. */
export function valueImportsFrom(text, specifier) {
  const names = new Set();
  NAMED_IMPORT_PATTERN.lastIndex = 0;
  let match;
  while ((match = NAMED_IMPORT_PATTERN.exec(text)) !== null) {
    if (match[1]) continue;
    if (match[3] !== specifier) continue;
    const clause = match[2].trim();
    const braced = clause.match(/\{([\s\S]*)\}/);
    if (braced) {
      for (const part of braced[1].split(",")) {
        const raw = part.trim();
        if (!raw || /^type\s/.test(raw)) continue;
        names.add(raw.split(/\s+as\s+/)[0].trim());
      }
    }
    const namespace = clause.match(/^\*\s+as\s+([A-Za-z0-9_$]+)/);
    if (namespace) names.add("*");
    const defaultBinding = clause.match(/^([A-Za-z0-9_$]+)\s*(,|$)/);
    if (defaultBinding) names.add("default");
  }
  return names;
}

/**
 * Census the consumers of each discovered shim: files that import one of the shim's
 * authority-conferring bindings as a VALUE.
 *
 * A consumer that ALSO carries the fenced dependency directly is excluded -- it is already a guard
 * baseline entry and already ratcheted; recording it here would double-govern it and make the two
 * ratchets disagree about the same file. A namespace import (`import * as repo`) counts, because
 * it necessarily includes every authority export.
 */
export function censusConsumers(files, shims) {
  const byShim = new Map(shims.map((shim) => [shim.shim, new Set()]));
  for (const [relativePath, text] of files) {
    if (classifyFile(text, relativePath).size > 0) continue;
    for (const shim of shims) {
      for (const specifier of specifiersTargeting(text, relativePath, shim.shim, files)) {
        const imported = valueImportsFrom(text, specifier);
        if (imported.has("*") ||
            shim.authorityExports.some((name) => imported.has(name))) {
          byShim.get(shim.shim).add(relativePath);
          break;
        }
      }
    }
  }
  return byShim;
}

/**
 * How many shim importers are skipped by censusConsumers because they are guard baseline entries in
 * their own right. Reported, never enforced: the point is that the exclusion is a deliberate
 * hand-off to the guard's ratchet, not an oversight, and its size should be visible.
 */
export function countAlreadyFencedConsumers(files, shims) {
  let count = 0;
  for (const [relativePath, text] of files) {
    if (classifyFile(text, relativePath).size === 0) continue;
    for (const shim of shims) {
      if (relativePath === shim.shim) continue;
      // NAMED_IMPORT_PATTERN is a module-level /g regex and valueImportsFrom resets its
      // lastIndex, so every specifier is collected BEFORE any is inspected. Interleaving the two
      // rewinds the outer scan on every iteration -- an infinite loop, observed here.
      const hit = specifiersTargeting(text, relativePath, shim.shim, files).some((specifier) => {
        const imported = valueImportsFrom(text, specifier);
        return imported.has("*") || shim.authorityExports.some((name) => imported.has(name));
      });
      if (hit) { count += 1; break; }
    }
  }
  return count;
}

export function buildCensus(absoluteRoot = REPO_ROOT) {
  const files = scanFiles(absoluteRoot);
  const shims = discoverShims(files);
  const consumers = censusConsumers(files, shims);
  const alreadyFenced = countAlreadyFencedConsumers(files, shims);
  return {
    schema: "eos.firebase-shim-consumer-census/1",
    derivedAtSha: "64008d5ae0bdd9532909671b15a91122400accf1",
    authority: {
      ownerRuling:
        "Approved transitional Firestore re-export shims may remain temporarily. Existing " +
        "consumers are NOT violations and must not be marked recursively.",
      ratchets: "consumer-set GROWTH, not shim existence",
      shrinkOnly: true,
      retirement:
        "With the underlying Firebase exit. A shim leaves this census when it stops carrying a " +
        "guard-fenced Firestore dependency; there is no separate shim-retirement milestone.",
      noNewBusinessAuthorityBehindAShim: true,
    },
    /**
     * NOT ENFORCED -- re-derived evidence, recorded so the numbers in this file can be checked
     * against the tree rather than trusted. `alreadyFencedConsumers` is the count of shim
     * importers that are EXCLUDED from the census because they carry the fenced dependency
     * directly and are therefore already governed by the guard's own baseline; recording it is
     * what makes "0 tolerated consumers" legible as "none unfenced" rather than "none looked".
     */
    observed: {
      scannedFiles: files.size,
      shimsDiscovered: shims.length,
      alreadyFencedConsumers: alreadyFenced,
      insulationNotGoverned:
        "Read hooks, query services and domain commands that use Firestore internally and return " +
        "data are NOT shims and their callers are NOT censused -- see authorityExports.",
    },
    shims: shims.map((shim) => ({
      ...shim,
      consumers: [...(consumers.get(shim.shim) ?? [])].sort(),
    })),
  };
}

export function loadCensusFromPath(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function censusConsumerMap(census) {
  return new Map((census?.shims ?? []).map((shim) => [shim.shim, new Set(shim.consumers ?? [])]));
}

/**
 * Enforce the committed census against the live tree. Three failure kinds, all of them real:
 *
 *   - newConsumers:  a file consumes a shim's authority and is not in the census. THE point of
 *                    this module: new business authority behind a shim, requiring explicit review.
 *   - staleEntries:  the census records a consumer that no longer consumes. Unsafe, not untidy --
 *                    the same reasoning as the guard's stale-entry check.
 *   - unregistered:  a shim exists in the tree with no census section at all, or a census section
 *                    names a shim that is no longer one. Either way the registry is out of date
 *                    and its coverage cannot be trusted.
 */
export function evaluateCensus(census, liveCensus) {
  const committed = censusConsumerMap(census);
  const live = censusConsumerMap(liveCensus);
  const newConsumers = [];
  const staleEntries = [];
  const unregistered = [];
  for (const [shim, liveSet] of live) {
    if (!committed.has(shim)) { unregistered.push({ shim, kind: "shim missing from census" }); continue; }
    const committedSet = committed.get(shim);
    for (const path of liveSet) if (!committedSet.has(path)) newConsumers.push({ shim, path });
    for (const path of committedSet) if (!liveSet.has(path)) staleEntries.push({ shim, path });
  }
  for (const shim of committed.keys()) {
    if (!live.has(shim)) unregistered.push({ shim, kind: "census names a module that is no longer a shim" });
  }
  return { newConsumers, staleEntries, unregistered };
}

/** Growth ratchet against the previously accepted census: the candidate's consumer sets must be a
 * SUBSET of the previous ones. Without this, one change could add a consumer AND widen the census
 * together -- the hole evaluateRatchet closes for the guard. */
export function evaluateGrowthRatchet(previousCensus, candidateCensus) {
  if (!previousCensus) return { additions: [], bootstrap: true };
  const previous = censusConsumerMap(previousCensus);
  const candidate = censusConsumerMap(candidateCensus);
  const additions = [];
  for (const [shim, candidateSet] of candidate) {
    const previousSet = previous.get(shim) ?? new Set();
    for (const path of candidateSet) if (!previousSet.has(path)) additions.push({ shim, path });
  }
  return { additions, bootstrap: false };
}

export function parseFlag(argv, flag) {
  for (const argument of argv) {
    if (argument.startsWith(`${flag}=`)) return argument.slice(flag.length + 1);
  }
  return undefined;
}

if (process.argv[1]?.endsWith("firebaseShimBoundary.mjs")) {
  const argv = process.argv.slice(2);
  const live = buildCensus();
  const censusPath = join(REPO_ROOT, CENSUS_RELATIVE_PATH);

  if (argv.includes("--write")) {
    writeFileSync(censusPath, `${JSON.stringify(live, null, 2)}\n`);
    const total = live.shims.reduce((sum, shim) => sum + shim.consumers.length, 0);
    console.log(`wrote ${CENSUS_RELATIVE_PATH}: ${live.shims.length} shim(s), ${total} consumer(s)`);
    process.exit(0);
  }

  if (!existsSync(censusPath)) {
    console.error(`::error::${CENSUS_RELATIVE_PATH} is missing -- regenerate it with --write and commit it`);
    process.exit(1);
  }
  const committed = loadCensusFromPath(censusPath);
  const { newConsumers, staleEntries, unregistered } = evaluateCensus(committed, live);
  const previousPath = parseFlag(argv, "--previous-census");
  const previous = previousPath ? loadCensusFromPath(previousPath) : null;
  const { additions, bootstrap } = evaluateGrowthRatchet(previous, committed);

  for (const entry of newConsumers) {
    console.error(
      `::error file=${entry.path}::NEW consumer of the transitional Firestore shim ${entry.shim} ` +
      `-- this file reaches Firestore without importing it. Existing consumers are tolerated by ` +
      `Owner ruling; growth is not. Either route this through the EOS API instead, or justify the ` +
      `addition in review and record it in ${CENSUS_RELATIVE_PATH}.`);
  }
  for (const entry of staleEntries) {
    console.error(
      `::error file=${entry.path}::stale ${CENSUS_RELATIVE_PATH} entry -- recorded as a consumer ` +
      `of ${entry.shim} but no longer consumes its authority exports. Remove the entry: a ` +
      `tolerated path that no longer uses the shim would silently re-tolerate it later.`);
  }
  for (const entry of unregistered) {
    console.error(`::error file=${entry.shim}::${entry.kind} -- regenerate ${CENSUS_RELATIVE_PATH} with --write`);
  }
  for (const entry of additions) {
    console.error(
      `::error file=${entry.path}::${CENSUS_RELATIVE_PATH} adds a consumer of ${entry.shim} not ` +
      `present in the previously accepted census -- census additions are not allowed in the same ` +
      `change as the consumer.`);
  }

  if (newConsumers.length || staleEntries.length || unregistered.length || additions.length) {
    console.error(
      `\n${newConsumers.length} new shim consumer(s), ${staleEntries.length} stale entr(ies), ` +
      `${unregistered.length} registry mismatch(es), ${additions.length} same-change census ` +
      "addition(s). The transitional shims themselves are permitted; their consumer sets may only " +
      "shrink. See the header of scripts/firebaseShimBoundary.mjs.");
    process.exit(1);
  }
  const total = live.shims.length;
  const consumers = live.shims.reduce((sum, shim) => sum + shim.consumers.length, 0);
  if (bootstrap) console.log("no previous census supplied -- growth ratchet not evaluated (committed census still enforced)");
  console.log(`shim boundary holds: ${total} transitional shim(s), ${consumers} tolerated consumer(s), 0 new`);
}
