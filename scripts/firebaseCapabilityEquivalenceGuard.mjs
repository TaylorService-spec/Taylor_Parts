// FIREBASE RETIREMENT -- BUSINESS CAPABILITY EQUIVALENCE GATE.
//
// Firebase retirement is a business-functionality migration, not code deletion. The exit ratchet
// (scripts/firebaseExitGuard.mjs) proves a Firebase DEPENDENCY went away; it cannot tell whether the
// BUSINESS CAPABILITY that dependency served went with it. This guard closes that gap: removing an
// export from functions/src/index.ts is refused unless the operation has a capability-equivalence
// record in docs/architecture/firebase-capability-equivalence.json that proves, gate by gate, that
// employees can still do the work in EOS -- or that an approved EOS workflow does it differently, or
// that the Owner explicitly accepted the gap.
//
// THE RULES (see docs/architecture/firebase-capability-equivalence-gate.md):
//
//   1. NEWLY RETIRED  = exports at the previously accepted commit minus exports now. Every one needs a
//      GATED record, and a GATED record must be retirement-complete:
//        REPLACED   -- gates A..E and audit VERIFIED (B and D may be NOT_APPLICABLE with a reason),
//        SUPERSEDED -- the same, plus an Owner decision when the business behaviour materially changes,
//        GAP        -- only with an Owner decision accepting the gap.
//      UNVERIFIED is a HISTORICAL-only disposition. A new retirement may not land unverified.
//   2. HISTORICAL records describe the retirements that predate this gate. Their names are pinned
//      below and cannot be extended -- a new retirement cannot be filed as "historical" to dodge the
//      gate. They may stay GAP/UNVERIFIED (reported, not failing), but they may not CLAIM more than
//      their evidence proves: a REPLACED claim is held to the same proof as a GATED one.
//   3. Records are append-only against the previously accepted manifest: a record may be improved,
//      never deleted.
//   4. Evidence is checked, not trusted: every cited path must exist and, where a `contains` string is
//      given, still contain it. A renamed or deleted test makes its record STALE and fails the guard.
//      Gate E needs at least one positive and one negative executable test. Gate B VERIFIED needs BOTH a
//      screen-level UI test and a recorded live persona run (UAT); a static route/grant reading is PARTIAL.
//   5. An Owner decision reference must name a real `## #NNN` heading in docs/DECISIONS.md. The guard
//      never infers one; it only checks the one a human cited.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const MANIFEST_RELATIVE_PATH = "docs/architecture/firebase-capability-equivalence.json";
export const INDEX_RELATIVE_PATH = "functions/src/index.ts";
export const DECISIONS_RELATIVE_PATH = "docs/DECISIONS.md";

// The retirements completed before this gate existed (main acc65f2e). Exact names, frozen. Adding a
// name here is a change to the gate itself and is pinned by its test.
export const HISTORICAL_BASELINE_SHA = "acc65f2efe4e68cca563f43fe81a3ef4f43f2722";
export const HISTORICAL_RETIREMENTS = Object.freeze([
  // recordPutAway -- retired to EOS put-away in 5d6a84ac (2026-10-01). That commit retired 18 other
  // inventory callables; they predate this gate's audit scope and are listed as backlog in the gate spec.
  "recordPutAway",
  // F2 #2052 (322db5b5) -- Supplier Master + Part-Supplier items
  "createSupplier", "updateSupplier", "activateSupplier", "deactivateSupplier", "setPreferredSupplier",
  "createPartSupplierItem", "updatePartSupplierItem", "changePartSupplierItemStatus",
  // F4 #2053 (a21c6472) -- Work Order Labor
  "recordWorkOrderLabor", "correctWorkOrderLabor", "getWorkOrderLabor",
  // F3a #2055 (0de3c06b) -- Part Master
  "createPart", "updatePart", "changePartStatus",
  // F3b #2056 (acc65f2e) -- Part Alias
  "createPartAlias", "deactivatePartAlias", "reactivatePartAlias", "listPartAliases", "probePartAlias",
  "lookupScannedPart", "resolveScannedPartIdentifier",
]);

export const ERAS = Object.freeze(["HISTORICAL", "GATED"]);
export const DISPOSITIONS = Object.freeze(["REPLACED", "SUPERSEDED", "GAP", "UNVERIFIED"]);
export const GATES = Object.freeze(["A", "B", "C", "D", "E"]);
export const GATE_NAMES = Object.freeze({
  A: "functional equivalence",
  B: "employee accessibility",
  C: "authority equivalence",
  D: "persistence and integration",
  E: "regression evidence",
});
export const GATE_STATUSES = Object.freeze(["VERIFIED", "PARTIAL", "UNVERIFIED", "GAP", "NOT_APPLICABLE"]);
export const EVIDENCE_KINDS = Object.freeze(["test", "ui-test", "uat", "source", "doc"]);
const NOT_APPLICABLE_ALLOWED = new Set(["B", "D"]);
const OWNER_DECISION_PATTERN = /^DECISIONS #(\d+)$/;

// ---------------------------------------------------------------------------------------------------
// Export enumeration.
//
// The index is parsed after blanking comments and string contents, so an export inside a comment is
// never counted and a `}` inside a string never ends a block. Multi-line `export { ... }` blocks are
// the common form in index.ts -- a single-line matcher finds a fraction of them (see the WHY comment in
// scripts/sandboxDeployableFunctions.mjs). Anything the parser does not understand (`export *`,
// `export default`) is REFUSED rather than skipped: an enumerator that under-counts would let a
// retirement through unseen.
// ---------------------------------------------------------------------------------------------------

function blankCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") { out += " "; i++; }
    } else if (c === "/" && next === "*") {
      out += "  "; i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " "; i++;
      }
      out += "  "; i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      out += c; i++;
      while (i < source.length && source[i] !== c) {
        if (source[i] === "\\") { out += "  "; i += 2; continue; }
        out += source[i] === "\n" ? "\n" : " "; i++;
      }
      out += c; i++;
    } else {
      out += c; i++;
    }
  }
  return out;
}

export function parseIndexExports(source) {
  const code = blankCommentsAndStrings(source);
  const names = new Set();
  const unsupported = [];
  for (const m of code.matchAll(/\bexport\s*\*/g)) unsupported.push(`export * at offset ${m.index}`);
  for (const m of code.matchAll(/\bexport\s+default\b/g)) unsupported.push(`export default at offset ${m.index}`);
  if (unsupported.length) {
    throw new Error(`${INDEX_RELATIVE_PATH}: unsupported export form(s) -- the equivalence guard cannot ` +
      `enumerate them and refuses to guess: ${unsupported.join("; ")}`);
  }
  for (const m of code.matchAll(/\bexport\s+(type\s+)?\{([^}]*)\}/g)) {
    if (m[1]) continue; // `export type { ... }` deploys nothing
    for (const raw of m[2].split(",")) {
      const part = raw.trim();
      if (!part || /^type\s/.test(part)) continue;
      const as = part.match(/^[A-Za-z_$][\w$]*\s+as\s+([A-Za-z_$][\w$]*)$/);
      const plain = part.match(/^([A-Za-z_$][\w$]*)$/);
      if (as) names.add(as[1]);
      else if (plain) names.add(plain[1]);
      else throw new Error(`${INDEX_RELATIVE_PATH}: cannot parse export specifier "${part}"`);
    }
  }
  for (const m of code.matchAll(/\bexport\s+(?:declare\s+)?(?:const|let|var|function\*?|async\s+function\*?|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  return [...names].sort();
}

// ---------------------------------------------------------------------------------------------------
// Record validation.
// ---------------------------------------------------------------------------------------------------

function isNonEmptyString(v) { return typeof v === "string" && v.trim().length > 0; }

function readRepoFile(repoRoot, path, cache) {
  if (!cache.has(path)) {
    const full = resolve(repoRoot, path);
    if (!full.startsWith(resolve(repoRoot))) { cache.set(path, null); return null; }
    cache.set(path, existsSync(full) ? readFileSync(full, "utf8") : null);
  }
  return cache.get(path);
}

export function decisionNumbers(decisionsText) {
  const numbers = new Set();
  for (const m of (decisionsText ?? "").matchAll(/^## #(\d+)\b/gm)) numbers.add(m[1]);
  return numbers;
}

function checkEvidenceList(problems, where, list, { repoRoot, fileCache }) {
  if (!Array.isArray(list)) { problems.push(`${where}: evidence must be an array`); return []; }
  const ok = [];
  list.forEach((ev, i) => {
    const at = `${where}.evidence[${i}]`;
    if (!ev || typeof ev !== "object") { problems.push(`${at}: must be an object`); return; }
    if (!EVIDENCE_KINDS.includes(ev.kind)) {
      problems.push(`${at}: kind "${ev.kind}" is not one of ${EVIDENCE_KINDS.join(", ")}`); return;
    }
    if (!isNonEmptyString(ev.path)) { problems.push(`${at}: path is required`); return; }
    const text = readRepoFile(repoRoot, ev.path, fileCache);
    if (text === null) {
      problems.push(`${at}: STALE -- ${ev.path} does not exist in this tree. Re-point the evidence at what ` +
        "now proves the capability, or downgrade the gate; never delete the citation to make CI pass.");
      return;
    }
    if (ev.kind === "test" || ev.kind === "ui-test") {
      if (!isNonEmptyString(ev.contains)) { problems.push(`${at}: a test citation needs "contains" (the test name)`); return; }
      if (!["positive", "negative"].includes(ev.polarity)) {
        problems.push(`${at}: a test citation needs polarity "positive" or "negative"`); return;
      }
    }
    if (ev.contains !== undefined) {
      if (!isNonEmptyString(ev.contains)) { problems.push(`${at}: "contains" must be a non-empty string`); return; }
      if (!text.includes(ev.contains)) {
        problems.push(`${at}: STALE -- ${ev.path} no longer contains "${ev.contains}". The cited test or ` +
          "symbol was renamed or removed; update the citation to the current proof.");
        return;
      }
    }
    ok.push(ev);
  });
  return ok;
}

function checkGate(problems, where, gateKey, gate, ctx) {
  if (!gate || typeof gate !== "object") { problems.push(`${where}: gate ${gateKey} is missing`); return null; }
  if (!GATE_STATUSES.includes(gate.status)) {
    problems.push(`${where}: status "${gate.status}" is not one of ${GATE_STATUSES.join(", ")}`); return null;
  }
  const evidence = checkEvidenceList(problems, where, gate.evidence ?? [], ctx);
  if (gate.status === "NOT_APPLICABLE") {
    if (!NOT_APPLICABLE_ALLOWED.has(gateKey)) {
      problems.push(`${where}: gate ${gateKey} (${GATE_NAMES[gateKey]}) can never be NOT_APPLICABLE`);
    }
    if (!isNonEmptyString(gate.reason)) problems.push(`${where}: NOT_APPLICABLE needs a "reason"`);
    return gate.status;
  }
  if (gate.status === "VERIFIED") {
    if (!evidence.length) problems.push(`${where}: VERIFIED with no valid evidence is an unsupported claim`);
    if (gateKey === "B" && !(evidence.some((e) => e.kind === "ui-test") && evidence.some((e) => e.kind === "uat"))) {
      problems.push(`${where}: employee accessibility is VERIFIED only by BOTH an executable screen-level test ` +
        `(kind "ui-test": the employee's screen calls the EOS operation and renders its real result shape) AND a ` +
        `recorded live run by the persona against a deployed environment (kind "uat"). A route + capability + ` +
        "grant reading proves reachability on paper -- record it as PARTIAL with a limitation.");
    }
    if (gateKey === "E") {
      const tests = evidence.filter((e) => e.kind === "test" || e.kind === "ui-test");
      if (!tests.some((e) => e.polarity === "positive") || !tests.some((e) => e.polarity === "negative")) {
        problems.push(`${where}: regression evidence needs at least one positive AND one negative executable ` +
          "test. A source citation alone is not regression evidence.");
      }
    }
  } else if (!isNonEmptyString(gate.limitation)) {
    problems.push(`${where}: a ${gate.status} gate must say what is missing ("limitation")`);
  }
  return gate.status;
}

function gatesSatisfied(statuses) {
  return GATES.every((g) => statuses[g] === "VERIFIED" || (statuses[g] === "NOT_APPLICABLE" && NOT_APPLICABLE_ALLOWED.has(g)))
    && statuses.audit === "VERIFIED";
}

export function validateRecord(record, ctx) {
  const problems = [];
  const name = isNonEmptyString(record?.legacyOperation) ? record.legacyOperation : "<unnamed>";
  const where = `record ${name}`;
  for (const field of ["legacyOperation", "capabilityId", "domain", "era", "disposition", "verificationStatus"]) {
    if (!isNonEmptyString(record?.[field])) problems.push(`${where}: "${field}" is required`);
  }
  if (problems.length) return { problems, complete: false };
  if (!ERAS.includes(record.era)) problems.push(`${where}: era "${record.era}" is not one of ${ERAS.join(", ")}`);
  if (!DISPOSITIONS.includes(record.disposition)) {
    problems.push(`${where}: disposition "${record.disposition}" is not one of ${DISPOSITIONS.join(", ")}`);
  }
  if (!["VERIFIED", "UNVERIFIED"].includes(record.verificationStatus)) {
    problems.push(`${where}: verificationStatus must be VERIFIED or UNVERIFIED`);
  }
  if (!record.retiredIn || !isNonEmptyString(record.retiredIn.commit)) {
    problems.push(`${where}: retiredIn.commit is required`);
  }
  for (const field of ["personas", "requiredCapabilities"]) {
    if (!Array.isArray(record[field])) problems.push(`${where}: "${field}" must be an array (empty if none)`);
  }
  if (record.disposition !== "GAP") {
    for (const field of ["eosReplacement", "entryPoint", "postgresImplementation"]) {
      if (!isNonEmptyString(record[field])) {
        problems.push(`${where}: "${field}" is required unless the disposition is GAP`);
      }
    }
  }
  if (typeof record.materialBehaviorChange !== "boolean") {
    problems.push(`${where}: materialBehaviorChange must be true or false`);
  }
  if (!Array.isArray(record.gaps)) problems.push(`${where}: "gaps" must be an array`);

  // Owner decision: never inferred, only checked.
  let ownerDecisionValid = false;
  if (record.ownerDecision !== null && record.ownerDecision !== undefined) {
    const m = typeof record.ownerDecision === "string" && record.ownerDecision.match(OWNER_DECISION_PATTERN);
    if (!m) problems.push(`${where}: ownerDecision must look like "DECISIONS #NNN" or be null`);
    else if (!ctx.decisions.has(m[1])) {
      problems.push(`${where}: ownerDecision ${record.ownerDecision} has no "## #${m[1]}" heading in ` +
        `${DECISIONS_RELATIVE_PATH}. Record the Owner's decision there first; never cite one that does not exist.`);
    } else ownerDecisionValid = true;
  }

  const statuses = {};
  const gates = record.gates ?? {};
  for (const g of GATES) statuses[g] = checkGate(problems, `${where} gate ${g}`, g, gates[g], ctx);
  statuses.audit = checkGate(problems, `${where} audit`, "audit", record.audit, ctx);

  const satisfied = gatesSatisfied(statuses);
  const blockers = GATES.filter((g) => !(statuses[g] === "VERIFIED" || statuses[g] === "NOT_APPLICABLE"))
    .map((g) => `gate ${g} (${GATE_NAMES[g]}) is ${statuses[g]}`);
  if (statuses.audit !== "VERIFIED") blockers.push(`audit is ${statuses.audit}`);

  if (record.verificationStatus === "VERIFIED" && !satisfied) {
    problems.push(`${where}: verificationStatus VERIFIED is unsupported -- ${blockers.join("; ")}`);
  }
  if (record.verificationStatus === "UNVERIFIED" && satisfied) {
    problems.push(`${where}: every gate is VERIFIED, so verificationStatus must say VERIFIED`);
  }

  let complete = false;
  switch (record.disposition) {
    case "REPLACED":
      if (!satisfied) {
        problems.push(`${where}: REPLACED is an unsupported claim -- ${blockers.join("; ")}. An unverified ` +
          "replacement is UNVERIFIED (historical) or GAP, never REPLACED.");
      }
      if (record.materialBehaviorChange) {
        problems.push(`${where}: REPLACED means the same business outcome; a material behaviour change is SUPERSEDED`);
      }
      complete = satisfied;
      break;
    case "SUPERSEDED":
      if (record.materialBehaviorChange && !ownerDecisionValid) {
        problems.push(`${where}: SUPERSEDED with a material business-behaviour change needs the Owner's ` +
          "acceptance (ownerDecision \"DECISIONS #NNN\")");
      }
      complete = satisfied && (!record.materialBehaviorChange || ownerDecisionValid);
      break;
    case "GAP":
      complete = ownerDecisionValid; // only an Owner-accepted gap may retire
      break;
    case "UNVERIFIED":
      complete = false;
      break;
    default:
      break;
  }
  return { problems, complete, blockers, satisfied };
}

// ---------------------------------------------------------------------------------------------------
// The guard.
// ---------------------------------------------------------------------------------------------------

export function evaluateEquivalence({
  manifest, currentExports, previousExports, previousManifest, decisions, repoRoot,
  historicalRetirements = HISTORICAL_RETIREMENTS,
}) {
  const errors = [];
  const report = [];
  const ctx = { repoRoot, decisions, fileCache: new Map() };

  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.records)) {
    return { errors: [`${MANIFEST_RELATIVE_PATH}: must be an object with a "records" array`], report, newlyRetired: [] };
  }

  const byName = new Map();
  for (const record of manifest.records) {
    const key = record?.legacyOperation;
    if (byName.has(key)) { errors.push(`record ${key}: duplicate record`); continue; }
    byName.set(key, record);
  }

  const current = new Set(currentExports);
  const historical = new Set(historicalRetirements);

  // Every historical retirement is recorded, as HISTORICAL, and none has quietly come back.
  for (const name of historicalRetirements) {
    const record = byName.get(name);
    if (!record) errors.push(`record ${name}: the historical retirement has no equivalence record`);
    else if (record.era !== "HISTORICAL") errors.push(`record ${name}: a pre-gate retirement must be era HISTORICAL`);
  }

  for (const [name, record] of byName) {
    const { problems, complete, blockers } = validateRecord(record, ctx);
    errors.push(...problems);
    if (record?.era === "HISTORICAL" && !historical.has(name)) {
      errors.push(`record ${name}: era HISTORICAL is reserved for the ${historicalRetirements.length} retirements ` +
        `completed before the gate (main ${HISTORICAL_BASELINE_SHA.slice(0, 8)}). A new retirement is GATED.`);
    }
    if (record?.era === "GATED" && record.disposition === "UNVERIFIED") {
      errors.push(`record ${name}: UNVERIFIED is a historical-only disposition; a new retirement must prove ` +
        "REPLACED or SUPERSEDED, or carry an Owner-accepted GAP");
    }
    if (current.has(name) && historical.has(name)) {
      errors.push(`record ${name}: the operation is exported again from ${INDEX_RELATIVE_PATH}. A retired ` +
        "Firebase operation may not return (Firebase retirement only).");
    }
    report.push({ name, era: record?.era, disposition: record?.disposition, complete, blockers: blockers ?? [] });
  }

  // Records are append-only against the previously accepted manifest.
  for (const old of previousManifest?.records ?? []) {
    if (old?.legacyOperation && !byName.has(old.legacyOperation)) {
      errors.push(`record ${old.legacyOperation}: deleted -- equivalence records may be improved, never removed`);
    }
  }

  // The gate itself: every export removed since the previously accepted commit.
  const newlyRetired = previousExports ? previousExports.filter((n) => !current.has(n)).sort() : [];
  for (const name of newlyRetired) {
    const record = byName.get(name);
    if (!record) {
      errors.push(`RETIREMENT BLOCKED: ${name} was removed from ${INDEX_RELATIVE_PATH} with no capability-` +
        `equivalence record. Add a GATED record to ${MANIFEST_RELATIVE_PATH} proving gates A-E (see ` +
        "docs/architecture/firebase-capability-equivalence-gate.md), or keep the export.");
      continue;
    }
    if (record.era !== "GATED") {
      errors.push(`RETIREMENT BLOCKED: ${name} is a new retirement and must be recorded as era GATED`);
      continue;
    }
    const { complete, blockers } = validateRecord(record, ctx);
    if (!complete) {
      const why = record.disposition === "GAP"
        ? "it is a GAP the Owner has not accepted (ownerDecision)"
        : record.disposition === "SUPERSEDED" && record.materialBehaviorChange && blockers.length === 0
          ? "the material behaviour change has no Owner decision"
          : blockers.join("; ") || `disposition ${record.disposition}`;
      errors.push(`RETIREMENT BLOCKED: ${name} is not retirement-complete -- ${why}. A business capability ` +
        "may not disappear with its Firebase implementation.");
    }
  }

  return { errors, report, newlyRetired };
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function loadJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} ${path}: unreadable or malformed JSON (${error.message}). Failing closed.`);
  }
}

export function run(argv, repoRoot = process.cwd()) {
  const manifest = loadJson(join(repoRoot, MANIFEST_RELATIVE_PATH), "manifest");
  const currentExports = parseIndexExports(readFileSync(join(repoRoot, INDEX_RELATIVE_PATH), "utf8"));
  // A SUPPLIED previous file that is missing or malformed fails closed. Only an absent flag (no previous
  // commit expected, or the previous commit predates the manifest) is bootstrap.
  const previousIndexPath = argValue(argv, "--previous-index");
  const previousManifestPath = argValue(argv, "--previous-manifest");
  const previousExports = previousIndexPath ? parseIndexExports(readFileSync(previousIndexPath, "utf8")) : null;
  const previousManifest = previousManifestPath ? loadJson(previousManifestPath, "previous manifest") : null;
  const decisions = decisionNumbers(readFileSync(join(repoRoot, DECISIONS_RELATIVE_PATH), "utf8"));
  return { ...evaluateEquivalence({ manifest, currentExports, previousExports, previousManifest, decisions, repoRoot }), currentExports };
}

if (process.argv[1]?.endsWith("firebaseCapabilityEquivalenceGuard.mjs")) {
  const argv = process.argv.slice(2);
  let result;
  try {
    result = run(argv);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
  const { errors, report, newlyRetired, currentExports } = result;
  if (argv.includes("--report")) {
    for (const row of report.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`${row.name.padEnd(30)} ${String(row.era).padEnd(10)} ${String(row.disposition).padEnd(10)} ` +
        `${row.complete ? "retirement-complete" : "OPEN: " + row.blockers.join("; ")}`);
    }
  }
  if (errors.length) {
    for (const error of errors) console.error(`::error file=${MANIFEST_RELATIVE_PATH}::${error}`);
    console.error(`\n${errors.length} capability-equivalence problem(s). Firebase retirement is a business-` +
      "functionality migration: see docs/architecture/firebase-capability-equivalence-gate.md.");
    process.exit(1);
  }
  const open = report.filter((r) => !r.complete).length;
  console.log(`${currentExports.length} exports; ${report.length} equivalence records ` +
    `(${report.length - open} retirement-complete, ${open} open historical findings); ` +
    `${newlyRetired.length} newly retired operation(s), all retirement-complete`);
}
