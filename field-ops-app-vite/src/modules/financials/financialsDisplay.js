// Display words + sort values for the /financials family (UI corrections package, items A and C). Pure presentation:
// governed identifiers stay as they are; only what a person reads, and the order a person chose, change here.
import { BUSINESS_UNIT_FILTER_OPTIONS } from "../../domain/financialsSurface.js";
import { operatingCompanyLabel, titleCase, titleCasePhrase } from "../../shared/display/displayLabels.js";

// ─── Display words for governed identifiers (UI corrections package, item A). ───
// The identifiers stay what they are; only what a person reads changes.
const BUSINESS_UNIT_WORDS = new Map(BUSINESS_UNIT_FILTER_OPTIONS.filter((o) => o.key !== "all").map((o) => [o.key, o.label]));

/** Operating company for a person: "taylor" -> "Taylor" (short) / "Taylor Freezer of Arizona" (full). */
export function companyWords(companyId, { short = true, absent = "Not attributed" } = {}) {
  return companyId ? operatingCompanyLabel(companyId, { short }) : absent;
}

/** Business unit for a person: "EQUIPMENT_SALES" -> "Equipment Sales"; words ("Mixed") pass through. */
export function businessUnitWords(unit) {
  if (unit === null || unit === undefined || unit === "") return "Not attributed";
  if (BUSINESS_UNIT_WORDS.has(unit)) return BUSINESS_UNIT_WORDS.get(unit);
  return /^[A-Z0-9_]+$/.test(unit) ? titleCase(unit) : unit;
}

/**
 * Title Case for a vocabulary label that is already words ("Billable now" -> "Billable Now"). Words that already carry
 * a capital (A/R, GM, FIN-006) are kept exactly as written -- the shared titleCasePhrase would turn "A/R" into "A/r".
 */
export function labelWords(text) {
  if (typeof text !== "string") return text;
  return text
    .split(" ")
    .map((word) => (/[A-Z]/.test(word) ? word : titleCasePhrase(word)))
    .join(" ")
    .replace(/ (A|An|And|As|At|By|For|From|In|Into|Of|On|Or|Per|The|To|Vs|Via|With) (?=\S)/g, (m, w) => ` ${w.toLowerCase()} `);
}

/**
 * Sort value for a per-currency amount map. One currency sorts by its minor units; a mixed-currency
 * figure has no single comparable amount (currencies are never added together), so it sorts last.
 */
export function byCurrencySortValue(byCurrency) {
  const entries = Object.entries(byCurrency ?? {}).filter(([, v]) => typeof v === "number");
  return entries.length === 1 ? entries[0][1] : null;
}
