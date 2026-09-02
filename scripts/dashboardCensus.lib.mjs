// EOS Dashboard Reporting Authority Census — the ONE parser.
//
// The markdown census (docs/assessments/eos-dashboard-reporting-authority-census.md) is the
// human-readable authority. The JSON companion is DERIVED from it by this module, so the two
// cannot drift: the generator writes what this parses, and the validator asserts that the
// committed JSON equals what this parses. There is no second transcription of the census.
//
// This module establishes NO authority. It reads a document; it decides nothing.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..");
export const CENSUS_MD = join(REPO_ROOT, "docs/assessments/eos-dashboard-reporting-authority-census.md");
export const CENSUS_JSON = join(REPO_ROOT, "docs/assessments/eos-dashboard-reporting-authority-census.json");

/** The seven classification states from §C of the census brief. `UNKNOWN` is included and must stay. */
export const CLASSIFICATIONS = Object.freeze({
  NOW: "REPORTABLE_NOW",
  ACT: "REPORTABLE_EXISTING_ACTIVATION_REQUIRED",
  FORM: "FORMALIZATION_REQUIRED",
  DEF: "DEFINITION_GAP",
  AUTH: "AUTHORITY_GAP",
  DEP: "BLOCKED_BY_DEPENDENCY",
  NO: "NOT_REPORTABLE",
  UNKNOWN: "UNKNOWN_EVIDENCE_INSUFFICIENT",
});

/** Domain sections of §3, keyed by their heading. §3.12 (global search) has its own shape and is not a fact table. */
const DOMAIN_HEADINGS = Object.freeze({
  "3.1": "CUSTOMER_CRM",
  "3.2": "SALES",
  "3.3": "SERVICE",
  "3.4": "TECHNICIAN_FIELD",
  "3.5": "INVENTORY",
  "3.6": "PARTS_WAREHOUSE_RECEIVING",
  "3.7": "PURCHASING",
  "3.8": "EQUIPMENT",
  "3.9": "FINANCIALS",
  "3.10": "ADMIN_GOVERNANCE",
  "3.11": "CROSS_DOMAIN",
});

const EMPTY = new Set(["", "—", "-", "–"]);
const blank = (cell) => EMPTY.has(cell.trim());

/**
 * Split one markdown table row into its cells.
 *
 * `\|` inside a cell is an escaped literal pipe, not a column break — `OPEN\|CLOSED` in the
 * FIN-008 row is one cell, and splitting on it silently drops that row from the census. Split on
 * an unescaped pipe only, then unescape.
 */
function cells(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
}

const isSeparator = (line) => /^\|[\s:|-]+\|$/.test(line.trim());

/**
 * Parse the §3 fact tables into census entries.
 *
 * A row qualifies when it has 11 cells and its first cell looks like a fact id (`C-1`, `W-5b`).
 * Section sub-heading rows inside a table (`| **A. …** |`) have one cell and are skipped, which
 * is why the cell count is part of the test rather than the id shape alone.
 */
export function parseCensus(markdown = readFileSync(CENSUS_MD, "utf8")) {
  const lines = markdown.split(/\r?\n/);
  const entries = [];
  let domain = null;

  for (const line of lines) {
    const heading = /^### (3\.\d+)\b/.exec(line);
    if (heading) {
      domain = DOMAIN_HEADINGS[heading[1]] ?? null;
      continue;
    }
    if (!domain || !line.trim().startsWith("|") || isSeparator(line)) continue;

    const c = cells(line);
    if (c.length !== 11) continue;
    if (!/^[A-Z]{1,2}-\d+[a-z]?$/.test(c[0])) continue;

    const [id, label, definition, clsCell, sourceAuthority, readAuthority, scopes, roles, timeBasis, dependencies, evidence] = c;
    const clsKey = (/^(NOW|ACT|FORM|DEF|AUTH|DEP|NO|UNKNOWN)\b/.exec(clsCell) ?? [])[1];
    if (!clsKey) throw new Error(`${id}: unrecognized classification cell ${JSON.stringify(clsCell)}`);
    const classification = CLASSIFICATIONS[clsKey];

    entries.push({
      id,
      domain,
      label,
      classification,
      sourceAuthority: blank(sourceAuthority) ? null : sourceAuthority,
      readAuthority: blank(readAuthority) ? null : readAuthority,
      scopes: blank(scopes) ? [] : [scopes],
      roles: blank(roles) ? [] : [roles],
      timeBasis: blank(timeBasis) ? null : timeBasis,
      dependencies: blank(dependencies) ? [] : [dependencies],
      evidence: blank(evidence) ? null : evidence,
      // Eligibility is a statement about whether a dashboard may render this fact family at all
      // today. It is derived from the classification, never asserted independently — a second
      // hand-maintained field is a second opinion waiting to drift.
      dashboardEligibility:
        classification === CLASSIFICATIONS.NOW
          ? "SAFE_NOW"
          : classification === CLASSIFICATIONS.ACT
            ? "SAFE_AFTER_EXISTING_ACTIVATION"
            : "DO_NOT_IMPLEMENT_YET",
      definition: blank(definition) ? null : definition,
    });
  }
  return entries;
}

/** The seventeen known authorities from §2, by id, with the classification word the table gives. */
export function parseKnownSeventeen(markdown = readFileSync(CENSUS_MD, "utf8")) {
  const ids = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim().startsWith("| K-")) continue;
    const c = cells(line);
    if (c.length < 3) continue;
    ids.push({ id: c[0], authority: c[1], classification: c[2] });
  }
  return ids;
}

export function tally(entries) {
  const counts = Object.fromEntries(Object.values(CLASSIFICATIONS).map((v) => [v, 0]));
  for (const e of entries) counts[e.classification] += 1;
  return counts;
}

export function buildCensusDocument(markdown = readFileSync(CENSUS_MD, "utf8")) {
  const entries = parseCensus(markdown);
  return {
    $comment: [
      "DERIVED ARTIFACT — generated from docs/assessments/eos-dashboard-reporting-authority-census.md",
      "by scripts/generateDashboardCensusJson.mjs. Do not hand-edit: edit the markdown and regenerate.",
      "scripts/dashboardCensus.test.mjs asserts this file equals what the markdown parses to.",
      "This file establishes no authority. It records where authority already lives.",
    ],
    schema: 1,
    source: "docs/assessments/eos-dashboard-reporting-authority-census.md",
    recordedAt: "2026-09-02",
    repositoryCommit: "d65bbf01",
    classifications: Object.values(CLASSIFICATIONS),
    totals: tally(entries),
    knownSeventeen: parseKnownSeventeen(markdown),
    entries,
  };
}
