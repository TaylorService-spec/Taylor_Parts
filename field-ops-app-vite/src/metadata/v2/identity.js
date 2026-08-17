// EOS identity model — four concepts that must not collapse into one another.
//
// This is the foundation everything else in v2 references, and it is separate from the
// field contract because entities, views and actions need the same rule.
//
//   INTERNAL RECORD ID   opaque, immutable, platform primary identity. Storage
//                        references, relationships, canonical backend operations, bulk
//                        update identity. NEVER rendered as a record's human label.
//   ENTITY systemName    stable machine identity for the entity TYPE: account, workOrder.
//   BUSINESS REFERENCE   human-readable immutable record reference where the business
//                        needs one: WO-2026-000127. Not every entity has one.
//   HUMAN NAME / LABEL   mutable description: "Desert Ridge Store #14".
//
// WHY FOUR AND NOT FEWER. Each has a different mutability and a different consumer.
// Collapsing reference into id makes the reference format a database key, so changing a
// numbering scheme breaks relationships. Collapsing name into reference makes a rename
// break every quoted document. Collapsing id into name is the defect this program has
// already corrected twice, on Opportunity (#1099) and Sales Order (#1124): a document id
// reaching a user as a label.
//
// EOS TERMS, NOT VENDOR TERMS. `systemName`, deliberately not "API Name". No __c, no __r,
// no object prefixes, no logical/schema naming conventions. The CONCEPT of a stable
// machine identity is universal; a particular platform's spelling of it is theirs.

/** A systemName is a lowerCamelCase identifier: stable, typeable, never decorated. */
const SYSTEM_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

/** Suffixes and prefixes that would import another platform's conventions. */
const VENDOR_CONVENTIONS = [/__c$/i, /__r$/i, /__pc$/i, /^cf_/i, /^new_/i, /^msdyn_/i];

export const MAX_SYSTEM_NAME_LENGTH = 64;

/**
 * Is this a valid EOS systemName?
 *
 * Returns problems rather than a boolean, because "invalid" is not actionable and
 * "starts with a digit" is.
 */
export function validateSystemName(systemName, { at = "systemName" } = {}) {
  const problems = [];
  if (typeof systemName !== "string" || systemName.length === 0) {
    problems.push(`${at}: a systemName is required`);
    return problems;
  }
  if (systemName.length > MAX_SYSTEM_NAME_LENGTH) {
    problems.push(`${at}: systemName exceeds ${MAX_SYSTEM_NAME_LENGTH} characters`);
  }
  if (!SYSTEM_NAME_PATTERN.test(systemName)) {
    problems.push(`${at}: systemName "${systemName}" must be lowerCamelCase, starting with a letter`);
  }
  for (const pattern of VENDOR_CONVENTIONS) {
    if (pattern.test(systemName)) {
      problems.push(`${at}: systemName "${systemName}" uses another platform's naming convention`);
      break;
    }
  }
  return problems;
}

/**
 * Derive a systemName from a human label, for CUSTOM fields at creation time.
 *
 * Generated ONCE and then immutable. The whole point is that renaming "Preferred Service
 * Window" to "Preferred Appointment Window" leaves `preferredServiceWindow` untouched —
 * a label is what a business changes its mind about, and every formula, report column and
 * tool contract bound to it would otherwise break on a wording change.
 *
 * Returns null when nothing usable can be derived, rather than inventing a name: a field
 * labelled only with punctuation needs a human to supply an identity, not a guess.
 */
export function deriveSystemName(label) {
  if (typeof label !== "string") return null;
  const words = label
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return null;

  // A leading digit cannot start an identifier, and dropping it would silently change
  // "2026 Target" into "target". Prefixing preserves the information.
  const head = words[0].toLowerCase();
  const rest = words.slice(1).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  const candidate = (/^[0-9]/.test(head) ? `n${head[0].toUpperCase()}${head.slice(1)}` : head) + rest.join("");
  return candidate.slice(0, MAX_SYSTEM_NAME_LENGTH);
}

/**
 * systemNames EOS reserves. A tenant field may not shadow one.
 *
 * Shadowing is not a naming annoyance: a CUSTOM `status` would make every formula,
 * automation and report referencing `status` ambiguous, and the resolution would depend
 * on load order.
 */
export const PROTECTED_SYSTEM_NAMES = Object.freeze([
  "id",
  "recordId",
  "systemName",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "status",
  "lifecycleState",
  "ownerId",
]);

export function isProtectedSystemName(systemName) {
  return PROTECTED_SYSTEM_NAMES.includes(systemName);
}

/**
 * A record's identity, assembled for display and for machines.
 *
 * `recordId` is present and is never `display`. That is the contract: a caller that needs
 * to route or relate has it, and a caller that renders cannot reach for it by accident,
 * because `display` already answers the question they were asking.
 */
export function recordIdentity({ recordId, businessReference = null, humanName = null } = {}) {
  return Object.freeze({
    recordId,
    businessReference,
    humanName,
    // Reference first: it is immutable and unambiguous, which is what someone reading a
    // list of similar records needs. Falling back to the name is correct; falling back to
    // the recordId is the defect, so it is not in this chain at all.
    display: humanName ?? businessReference ?? null,
  });
}

/**
 * Reference-number policy, as declarable entity metadata.
 *
 * The seam only — WO-YYYY-###### and OPP-YYYY-###### remain generated by their existing
 * approved services. Rewriting working numbering to prove a metadata point would risk
 * live business references for no benefit.
 */
export function makeReferencePolicy({ prefix, includeYear = true, sequenceLength = 6 } = {}) {
  return Object.freeze({ prefix, includeYear, sequenceLength });
}

export function validateReferencePolicy(policy, { at = "referencePolicy" } = {}) {
  const problems = [];
  if (!policy) return problems; // Not every entity has a business reference.
  if (!/^[A-Z]{2,5}$/.test(policy.prefix ?? "")) {
    problems.push(`${at}: prefix "${policy.prefix}" must be 2-5 uppercase letters`);
  }
  if (!Number.isInteger(policy.sequenceLength) || policy.sequenceLength < 4 || policy.sequenceLength > 10) {
    problems.push(`${at}: sequenceLength must be an integer between 4 and 10`);
  }
  return problems;
}
