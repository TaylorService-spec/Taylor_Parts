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
import { isAbsolute, join, relative, resolve } from "node:path";

export const MANIFEST_RELATIVE_PATH = "docs/architecture/firebase-capability-equivalence.json";
export const INDEX_RELATIVE_PATH = "functions/src/index.ts";
export const DECISIONS_RELATIVE_PATH = "docs/DECISIONS.md";
export const WORKFLOW_RELATIVE_PATH = ".github/workflows/firebase-capability-equivalence.yml";
export const GUARD_RELATIVE_PATH = "scripts/firebaseCapabilityEquivalenceGuard.mjs";
export const GUARD_TEST_RELATIVE_PATH = "scripts/firebaseCapabilityEquivalenceGuard.test.mjs";
// Evidence may never cite the gate's own machinery or the decision register: those files always contain whatever a
// record quotes from them, so a citation of them proves nothing about the capability.
const SELF_EVIDENCE = new Set([MANIFEST_RELATIVE_PATH, DECISIONS_RELATIVE_PATH, WORKFLOW_RELATIVE_PATH,
  GUARD_RELATIVE_PATH, GUARD_TEST_RELATIVE_PATH, "docs/architecture/firebase-capability-equivalence-gate.md"]);
const TEST_FILE_PATTERN = /\.test\.(?:mjs|cjs|js|jsx|ts|tsx)$/;
const MIN_CONTAINS = 12;
export const CANDIDATE_DISPOSITIONS = Object.freeze(["REPLACED", "SUPERSEDED"]);

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
// Export enumeration -- a WHITELIST, not a best-effort scan.
//
// functions/src/index.ts is the Cloud Functions entry point, and the only thing it contains (outside
// comments) is the firebase-admin initialization and `export { name, other as alias } from "./module";`
// blocks. The parser accepts EXACTLY that grammar and refuses everything else, because a best-effort scan
// can be desynchronized: an earlier version blanked comments and strings with a lexer that did not know
// regex literals or template literals, so `const m = /'/; // ' ; export { x } from "./x";` made a REMOVED
// export look present -- the guard passed, tsc passed, and the deploy silently dropped the function
// (adversarial review of #2057, finding B1). Refused, with the line number:
//   - any `/` that does not open a comment (regex literals, division),
//   - any template literal, and any string that crosses a line,
//   - any top-level statement other than the firebase-admin import, `initializeApp();` and
//     `export { ... } from "...";` -- so `export const`, `export *`, `export default`, `export =`,
//     destructuring, namespaces, function-group objects and `module.exports` can never hide an export.
// A refusal is not a policy decision about index.ts style: it says the guard cannot PROVE the export set,
// and a gate that cannot prove it must not pass.
// ---------------------------------------------------------------------------------------------------

function lineAt(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function blankCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const refuse = (what, at) => {
    throw new Error(`${INDEX_RELATIVE_PATH}:${lineAt(source, at)}: ${what} -- the equivalence guard accepts only ` +
      "comments, the firebase-admin initialization and `export { ... } from \"...\";` blocks, and refuses to guess.");
  };
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") { out += " "; i++; }
    } else if (c === "/" && next === "*") {
      const close = source.indexOf("*/", i + 2);
      if (close < 0) refuse("an unterminated block comment", i);
      for (; i < close + 2; i++) out += source[i] === "\n" ? "\n" : " ";
    } else if (c === "/") {
      refuse("a `/` outside a comment (regex literal or division)", i);
    } else if (c === "`") {
      refuse("a template literal", i);
    } else if (c === '"' || c === "'") {
      const at = i;
      out += c; i++;
      while (i < source.length && source[i] !== c) {
        if (source[i] === "\n") refuse("a string that crosses a line", at);
        if (source[i] === "\\") { out += "  "; i += 2; continue; }
        out += " "; i++;
      }
      if (i >= source.length) refuse("an unterminated string", at);
      out += c; i++;
    } else {
      out += c; i++;
    }
  }
  return out;
}

const IDENT = "[A-Za-z_$][A-Za-z0-9_$]*";
const ALLOWED_STATEMENTS = [
  { kind: "init-import", re: /^import\s*\{\s*initializeApp\s*\}\s*from\s*"\s*"$/ },
  { kind: "init-call", re: /^initializeApp\s*\(\s*\)$/ },
  { kind: "export", re: /^export\s*\{([^{}]*)\}\s*from\s*"\s*"$/ },
];

export function parseIndexExports(source) {
  const code = blankCommentsAndStrings(source);
  const names = new Set();
  let offset = 0;
  for (const raw of code.split(";")) {
    const statement = raw.trim().replace(/\s+/g, " ");
    const at = offset + (raw.length - raw.trimStart().length);
    offset += raw.length + 1;
    if (!statement) continue;
    const match = ALLOWED_STATEMENTS.map((a) => ({ a, m: statement.match(a.re) })).find((x) => x.m);
    if (!match) {
      throw new Error(`${INDEX_RELATIVE_PATH}:${lineAt(source, at)}: unsupported statement "${statement.slice(0, 80)}" -- the ` +
        "equivalence guard accepts only the firebase-admin initialization and `export { ... } from \"...\";` blocks, " +
        "and refuses to guess an export set it cannot prove.");
    }
    if (match.a.kind !== "export") continue;
    for (const part of match.m[1].split(",")) {
      const spec = part.trim();
      if (!spec) continue;
      const m = spec.match(new RegExp(`^(${IDENT})(?:\\s+as\\s+(${IDENT}))?$`));
      if (!m || m[1] === "type") {
        throw new Error(`${INDEX_RELATIVE_PATH}:${lineAt(source, at)}: cannot parse export specifier "${spec}"`);
      }
      const name = m[2] ?? m[1];
      if (names.has(name)) throw new Error(`${INDEX_RELATIVE_PATH}:${lineAt(source, at)}: "${name}" is exported twice`);
      names.add(name);
    }
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
    const rel = relative(resolve(repoRoot), full);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) { cache.set(path, null); return null; }
    cache.set(path, existsSync(full) ? readFileSync(full, "utf8") : null);
  }
  return cache.get(path);
}

/** DECISIONS.md headings -> the text of each decision section (heading to the next `## #`). */
export function decisionNumbers(decisionsText) {
  const sections = new Map();
  const text = decisionsText ?? "";
  const heads = [...text.matchAll(/^## #(\d+)\b/gm)];
  heads.forEach((m, i) => sections.set(m[1], text.slice(m.index, i + 1 < heads.length ? heads[i + 1].index : text.length)));
  return sections;
}

// The identifiers a decision must name to be relevant to a record: the retired operation, its capability id, or an
// EOS operation named in the replacement. A decision number that exists but is about something else accepts nothing.
function recordIdentifiers(record) {
  const ids = new Set([record.legacyOperation, record.capabilityId].filter(isNonEmptyString));
  for (const m of String(record.eosReplacement ?? "").matchAll(/\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/g)) ids.add(m[0]);
  return [...ids];
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
    const normalized = relative(resolve(repoRoot), resolve(repoRoot, ev.path)).split("\\").join("/");
    if (SELF_EVIDENCE.has(normalized)) {
      problems.push(`${at}: ${ev.path} is the gate's own machinery or the decision register -- it proves nothing about ` +
        "the capability. Cite the test, source, screen or UAT record that does.");
      return;
    }
    if ((ev.kind === "test" || ev.kind === "ui-test") && !TEST_FILE_PATTERN.test(ev.path)) {
      problems.push(`${at}: a ${ev.kind} citation must point at a test file (*.test.*), not ${ev.path}`);
      return;
    }
    if (ev.contains !== undefined && (typeof ev.contains !== "string" || ev.contains.trim().length < MIN_CONTAINS)) {
      problems.push(`${at}: "contains" must quote at least ${MIN_CONTAINS} characters -- a fragment that matches ` +
        "anything proves nothing");
      return;
    }
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
    } else {
      const section = String(ctx.decisions.get(m[1]) ?? "");
      const ids = recordIdentifiers(record);
      if (!ids.some((id) => section.includes(id))) {
        problems.push(`${where}: ${record.ownerDecision} does not name this capability (${ids.join(", ")}). An unrelated ` +
          "decision accepts nothing; cite the decision that rules on this operation.");
      } else ownerDecisionValid = true;
    }
  }
  if (record.candidateDisposition !== undefined && !CANDIDATE_DISPOSITIONS.includes(record.candidateDisposition)) {
    problems.push(`${where}: candidateDisposition must be one of ${CANDIDATE_DISPOSITIONS.join(", ")} (it names what the ` +
      "record would be once its open gates close; it is informational and never makes a record complete)");
  }
  if (record.materialBehaviorChange === true && !ownerDecisionValid && !["GAP", "SUPERSEDED"].includes(record.disposition)) {
    problems.push(`${where}: a material business-behaviour change without an Owner decision is a GAP (or a SUPERSEDED ` +
      `claim awaiting the Owner), never ${record.disposition}`);
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
  manifest.records.forEach((record, i) => {
    const key = record?.legacyOperation;
    if (!isNonEmptyString(key)) { errors.push(`records[${i}]: "legacyOperation" is required`); return; }
    if (byName.has(key)) { errors.push(`record ${key}: duplicate record`); return; }
    byName.set(key, record);
  });

  const current = new Set(currentExports);
  const historical = new Set(historicalRetirements);
  const why = (record, result) => (record.disposition === "GAP"
    ? "it is a GAP the Owner has not accepted (ownerDecision)"
    : record.disposition === "SUPERSEDED" && record.materialBehaviorChange && result.blockers.length === 0
      ? "the material behaviour change has no Owner decision"
      : result.blockers.join("; ") || `disposition ${record.disposition}`);

  // THE EXPORT BASELINE: the export set at the gate's introduction, frozen. It makes the gate independent of which
  // commit a run compares against -- a cancelled or superseded main run, a direct push, or a workflow_dispatch can
  // no longer let a removal through unseen, because EVERY baseline export that is gone must be accounted for on
  // EVERY run, and nothing outside the baseline may be exported (Firebase retirement only).
  const baseline = manifest.exportBaseline;
  if (!baseline || !Array.isArray(baseline.exports) || !isNonEmptyString(baseline.sha)) {
    errors.push(`${MANIFEST_RELATIVE_PATH}: "exportBaseline" { sha, exports[] } is required`);
  } else {
    const baselineSet = new Set(baseline.exports);
    for (const name of current) {
      if (!baselineSet.has(name)) {
        errors.push(`${name} is exported from ${INDEX_RELATIVE_PATH} but is not in the export baseline -- a new Firebase ` +
          "Function is not permitted (Firebase retirement only), and a retired one may not return.");
      }
    }
    for (const name of baseline.exports) {
      if (current.has(name)) continue;
      const record = byName.get(name);
      if (!record) {
        errors.push(`RETIREMENT BLOCKED: ${name} (export baseline ${baseline.sha.slice(0, 8)}) is no longer exported and ` +
          `has no capability-equivalence record. Add a GATED record to ${MANIFEST_RELATIVE_PATH} proving gates A-E (see ` +
          "docs/architecture/firebase-capability-equivalence-gate.md), or keep the export.");
      } else if (record.era !== "GATED") {
        errors.push(`RETIREMENT BLOCKED: ${name} is a retirement after the gate and must be recorded as era GATED`);
      }
    }
    const old = previousManifest?.exportBaseline;
    if (old && JSON.stringify([...old.exports].sort()) + old.sha !== JSON.stringify([...baseline.exports].sort()) + baseline.sha) {
      errors.push(`${MANIFEST_RELATIVE_PATH}: exportBaseline changed -- it is frozen at the gate's introduction`);
    }
  }

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
    if (record?.era === "GATED" && current.has(name)) {
      errors.push(`record ${name}: a GATED record describes a retirement, but ${name} is still exported. Record it in ` +
        "the change that removes the export -- and a retired operation may not return.");
    }
    // A GATED retirement must STAY complete: a later change may improve its record, never weaken it.
    if (record?.era === "GATED" && !current.has(name) && !complete) {
      errors.push(`RETIREMENT BLOCKED: ${name} is not retirement-complete -- ${why(record, { blockers: blockers ?? [] })}. ` +
        "A business capability may not disappear with its Firebase implementation.");
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
    // Completeness of a GATED record is enforced for every unexported operation above, on every run.
  }
  // Nothing may be ADDED relative to the previously accepted commit either (also covered by the baseline).
  for (const name of current) {
    if (previousExports && !previousExports.includes(name)) {
      errors.push(`${name} is newly exported from ${INDEX_RELATIVE_PATH} -- a new or returning Firebase Function is not ` +
        "permitted (Firebase retirement only).");
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
  const historicalOpen = report.filter((r) => r.era === "HISTORICAL" && !r.complete).length;
  const gated = report.filter((r) => r.era === "GATED").length;
  console.log(`${currentExports.length} exports; ${report.length} equivalence records ` +
    `(${gated} GATED, all retirement-complete; ${historicalOpen} open historical findings); ` +
    `${newlyRetired.length} operation(s) removed since the previous commit`);
}
