// SHARED DISPLAY LABELS (UI corrections package, 2026-10-08, item A / H).
//
// ONE place that turns an internal identifier into the words a person reads. Internal identifiers -- capability keys,
// role keys, object keys, enum values, operating-company ids -- are never changed; only their DISPLAY is.
//
//   Title Case     navigation, page titles, section headings, field labels, table headers, buttons, Job Roles,
//                  Security Roles, Object names, Workflow names, status labels      -> titleCase / identifierLabel
//   Sentence case  help text, instructions, validation messages, notifications       -> sentenceCase
//
// A server-supplied display name (a Security Role's `name`, a Job Role's `label`) is preferred over the identifier;
// these helpers are the fallback and the normaliser, never a second vocabulary.
import { OPERATING_COMPANIES } from "../../domain/operatingCompanyAuthority.js";

// Words that stay upper case wherever they appear.
const ACRONYMS = new Set([
  "ai", "api", "ar", "ap", "crm", "csv", "eos", "erp", "eta", "gl", "id", "ids", "kpi", "mfa", "pdf", "po", "pos", "qa",
  "ra", "rma", "sku", "skus", "sla", "sms", "ui", "uom", "url", "usa", "vin", "wo", "ytd", "uat", "iso",
]);
// Minor words that stay lower case inside a title (never first or last).
const MINOR = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or", "per", "the", "to", "vs", "via", "with"]);

// Operating companies come from the ONE governed table (domain/operatingCompanyAuthority.js), never a local map.
const COMPANY_BY_ID = new Map(OPERATING_COMPANIES.map((c) => [c.id, c]));

function capitalizeWord(word, index, count) {
  if (word === "") return word;
  const lower = word.toLowerCase();
  if (ACRONYMS.has(lower)) return lower.toUpperCase();
  // A word that already carries deliberate inner capitals (iPad, McDonald) or digits-with-letters (2FA) is kept.
  if (/[a-z][A-Z]/.test(word) && word !== word.toUpperCase()) return word.charAt(0).toUpperCase() + word.slice(1);
  if (index > 0 && index < count - 1 && MINOR.has(lower)) return lower;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Splits an identifier (camelCase, PascalCase, snake_case, SCREAMING_CASE, kebab-case, dotted) into words. */
export function splitIdentifier(value) {
  if (value === null || value === undefined) return [];
  return String(value)
    .replace(/[._\-/]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Title Case for a phrase or an identifier: "workOrder" -> "Work Order", "IN_PROGRESS" -> "In Progress". */
export function titleCase(value) {
  const words = splitIdentifier(value);
  return words.map((w, i) => capitalizeWord(w, i, words.length)).join(" ");
}

/**
 * Title Case for a phrase that is already words ("operational scope" -> "Operational Scope"); unlike titleCase it does
 * not split camelCase, so a proper noun such as "iPad" survives.
 */
export function titleCasePhrase(value) {
  if (value === null || value === undefined) return "";
  const words = String(value).trim().split(/\s+/).filter(Boolean);
  return words.map((w, i) => {
    // A token with inner punctuation ("A/R", "P&L") or already all-capitals is kept as written: it is an abbreviation.
    if (/[A-Za-z][/&.][A-Za-z]/.test(w) || (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w))) return w;
    const m = /^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/.exec(w);
    return m ? `${m[1]}${capitalizeWord(m[2], i, words.length)}${m[3]}` : w;
  }).join(" ");
}

/** Sentence case: first letter upper, the rest as written (acronyms and proper nouns are left alone). */
export function sentenceCase(value) {
  if (value === null || value === undefined) return "";
  const s = String(value).trim();
  return s === "" ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The display label for an internal identifier. A server-supplied `name`/`label` wins; the identifier is the fallback.
 * Never returns the raw camelCase/snake_case key to a person.
 */
export function identifierLabel(identifier, displayName) {
  if (typeof displayName === "string" && displayName.trim() !== "") {
    const trimmed = displayName.trim();
    // A display name that is itself an identifier (no spaces, has an inner capital or underscore) is humanised too.
    return /\s/.test(trimmed) || !/[a-z][A-Z]|_|^[a-z]/.test(trimmed) ? trimmed : titleCase(trimmed);
  }
  return titleCase(identifier);
}

/**
 * Operating company. `short` (tables, filters, chips): the governed code in Title Case -- "taylor" -> "Taylor".
 * Full (record headers, detail facts): the governed displayName -- "Taylor Freezer of Arizona". An id the governed table
 * does not know is humanised, never shown raw.
 */
export function operatingCompanyLabel(id, { short = true } = {}) {
  if (id === null || id === undefined || id === "") return "";
  const company = COMPANY_BY_ID.get(String(id));
  if (!company) return titleCase(id);
  return short ? titleCase(company.code) : company.displayName;
}

/** Status enum: "ON_LEAVE" -> "On Leave". Pass a domain map for statuses whose words differ from the enum. */
export function statusLabel(status, words) {
  if (status === null || status === undefined) return "";
  return words?.[status] ?? titleCase(status);
}

/** Security Role / Job Role / Object / Workflow label from its record ({ name | label | displayName, key | id }). */
export function recordLabel(record) {
  if (!record) return "";
  if (typeof record === "string") return identifierLabel(record);
  return identifierLabel(record.key ?? record.roleKey ?? record.id ?? record.objectKey ?? record.workflowKey,
    record.name ?? record.label ?? record.displayName ?? record.displayLabel);
}
