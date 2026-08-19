// DUPLICATE RULES -- the seeded ruleset, as DATA.
//
// docs/specifications/duplicate-detection.md is explicit that no matching
// behaviour is compiled in: every rule is a record an admin can edit, deactivate
// or delete from Administration -> Duplicate Rules, and "a rule that cannot be
// changed from that screen is a defect" (acceptance criterion 2).
//
// This module is therefore the SEED, not the implementation. It holds the initial
// values the governed `matching_rules` / `duplicate_rules` collections are created
// with. Once those collections and their trusted read service exist, this file
// stops being the source the screen reads and becomes only what seeds an empty
// environment. Nothing here evaluates a match.
//
// The shape mirrors the specification exactly, because the screen, the seed and
// the eventual stored document all have to agree:
//
//   MatchingRule  -- HOW two records are compared: ordered criteria, each a field
//                    plus a match METHOD, plus whether blanks count, combined by
//                    boolean logic.
//   DuplicateRule -- WHAT HAPPENS on a match, configured SEPARATELY for create and
//                    for edit: allow or block, alert (with admin-authored text),
//                    report to the queue.
//
// HOW MANY RULES PER OBJECT, AND HOW THEY COMBINE.
//
// Conceptually there is ONE rule per object -- "how do we decide two Accounts are
// the same" is usually one answer. The model nevertheless holds a LIST per object,
// left open deliberately so it can expand without a schema change (Owner,
// 2026-08-19), and because one object already needs two: an exact
// internalPartNumber collision must BLOCK, while a manufacturer part number
// matching on the same manufacturer only ALERTS. The action belongs to the rule,
// so two actions require two rules.
//
// WHEN AN OBJECT HAS SEVERAL RULES THEY COMBINE WITH **OR**: the pair is a
// suspected duplicate if ANY active rule matches. Rules are alternative ways of
// recognising the same thing, not conditions that must all hold -- an Account is a
// duplicate if the company name matches OR the address does. (AND lives INSIDE a
// rule, across its criteria, where "same manufacturer part number AND same
// manufacturer" belongs.)
//
// So evaluation is not first-match-wins, and `order` is presentation only. When
// several rules match at once the STRONGEST action applies -- block beats allow --
// because the alternative is letting a permissive rule quietly cancel a blocking
// one an admin added on purpose.

/** Match methods. A bounded, named set -- never free-form fuzzy or a user-entered
 *  expression, so every verdict stays explainable as "these fields matched by
 *  these methods". */
export const MATCH_METHODS = Object.freeze({
  exact: {
    id: "exact",
    label: "Exact",
    description: "Identical after trimming whitespace.",
  },
  normalized: {
    id: "normalized",
    label: "Normalized",
    description: "Ignores case, punctuation and extra spaces. TST-1234 matches tst 1234.",
  },
  companyName: {
    id: "companyName",
    label: "Company name",
    description:
      "Normalized, and ignores legal suffixes. Taylor Freezer of Arizona matches TAYLOR FREEZER OF ARIZONA, LLC.",
  },
  address: {
    id: "address",
    label: "Address",
    description:
      "Normalized, and treats common abbreviations as equal. 123 Main St matches 123 North Main Street.",
  },
  phone: {
    id: "phone",
    label: "Phone",
    description: "Compares digits only. (602) 555-0134 matches 6025550134.",
  },
  email: {
    id: "email",
    label: "Email",
    description: "Whole address, ignoring case.",
  },
  acronym: {
    id: "acronym",
    label: "Acronym",
    description: "Initials of the significant words. TFA matches Taylor Freezer Arizona.",
  },
});

/** What a rule does when it matches. Separate settings for create and for edit --
 *  editing a record into collision is "becoming a duplicate" too. */
export const RULE_ACTIONS = Object.freeze({
  allow: { id: "allow", label: "Allow", description: "The record is saved." },
  block: { id: "block", label: "Block", description: "The record is not saved." },
});

/** Objects that carry duplicate rules. Any registered object can have them; these
 *  are simply the ones that ship seeded. */
export const RULE_OBJECTS = Object.freeze([
  { id: "account", label: "Accounts", singular: "Account" },
  { id: "contact", label: "Contacts", singular: "Contact" },
  { id: "location", label: "Locations", singular: "Location" },
  { id: "part", label: "Parts", singular: "Part" },
  { id: "opportunity", label: "Opportunities", singular: "Opportunity" },
]);

/**
 * The seeded rules.
 *
 * `order` is DISPLAY order only. Rules on one object are OR'd -- every active rule
 * is evaluated, and the strongest action among those that match applies. Reordering
 * changes the screen, never the outcome.
 *
 * `matchBlanks` defaults false everywhere and is stated explicitly rather than
 * omitted -- two records that are both missing a phone number are not thereby
 * similar, and that assumption is the single most common source of false
 * positives in duplicate matching.
 */
export const SEEDED_RULES = Object.freeze([
  {
    id: "part-internal-number",
    objectId: "part",
    order: 1,
    name: "Same catalog part number",
    active: true,
    criteria: [{ fieldId: "internalPartNumber", label: "Part number", method: "normalized", matchBlanks: false }],
    logic: "1",
    onCreate: { action: "block", alert: true, report: true },
    onEdit: { action: "block", alert: true, report: true },
    alertText:
      "A part with this number already exists. If this is the same part from a new manufacturer, add a supplier item to the existing part rather than creating a new one.",
    // Blocking is safe here specifically because internalPartNumber is THIS
    // catalog's own number and the Part Master command already rejects a
    // collision. The rule turns a confusing post-submit failure into a clear
    // pre-submit message; it prevents nothing that was previously possible.
    rationale:
      "The catalog's own part number must be unique, and the Part Master service already rejects a duplicate.",
  },
  {
    id: "part-manufacturer-number",
    objectId: "part",
    order: 2,
    name: "Same manufacturer part number, same manufacturer",
    active: true,
    criteria: [
      { fieldId: "manufacturerPartNumber", label: "Manufacturer part number", method: "normalized", matchBlanks: false },
      { fieldId: "manufacturerId", label: "Manufacturer", method: "exact", matchBlanks: false },
    ],
    logic: "1 AND 2",
    onCreate: { action: "allow", alert: true, report: true },
    onEdit: { action: "allow", alert: true, report: true },
    alertText: "Another part from this manufacturer already uses this manufacturer part number.",
    // Deliberately requires BOTH criteria. A manufacturer part number alone means
    // nothing: two manufacturers can independently ship a part numbered X-100, and
    // those are genuinely different parts with different catalog numbers.
    rationale:
      "A manufacturer's number is only meaningful alongside the manufacturer -- two makers can use the same number for different parts.",
  },
  {
    id: "account-company-name",
    objectId: "account",
    order: 1,
    name: "Same company name",
    active: true,
    criteria: [{ fieldId: "name", label: "Account name", method: "companyName", matchBlanks: false }],
    logic: "1",
    onCreate: { action: "allow", alert: true, report: true },
    onEdit: { action: "allow", alert: true, report: true },
    alertText: "An account with a very similar name already exists.",
    rationale: "Company names vary by punctuation and legal suffix far more often than they collide genuinely.",
  },
  {
    id: "account-address-phone",
    objectId: "account",
    order: 2,
    name: "Same billing address or phone",
    active: true,
    criteria: [
      { fieldId: "billingAddress", label: "Billing address", method: "address", matchBlanks: false },
      { fieldId: "phone", label: "Phone", method: "phone", matchBlanks: false },
    ],
    logic: "1 OR 2",
    onCreate: { action: "allow", alert: true, report: true },
    onEdit: { action: "allow", alert: true, report: true },
    alertText: "An existing account shares this address or phone number.",
    rationale: "Catches the same customer entered under a trading name.",
  },
  {
    id: "contact-email",
    objectId: "contact",
    order: 1,
    name: "Same email address",
    active: true,
    criteria: [{ fieldId: "email", label: "Email", method: "email", matchBlanks: false }],
    logic: "1",
    onCreate: { action: "allow", alert: true, report: true },
    onEdit: { action: "allow", alert: true, report: true },
    alertText: "A contact with this email address already exists.",
    // This and the rule below are the existing CSV import rule, seeded verbatim so
    // import behaviour is unchanged on day one and diverges only if an admin
    // deliberately edits it.
    rationale: "Matches the rule contact import has always used.",
  },
  {
    id: "contact-name-phone",
    objectId: "contact",
    order: 2,
    name: "Same name and phone",
    active: true,
    criteria: [
      { fieldId: "name", label: "Name", method: "normalized", matchBlanks: false },
      { fieldId: "phone", label: "Phone", method: "phone", matchBlanks: false },
    ],
    logic: "1 AND 2",
    onCreate: { action: "allow", alert: true, report: true },
    onEdit: { action: "allow", alert: true, report: true },
    alertText: "A contact with this name and phone number already exists.",
    rationale: "Used when a contact has no email address.",
  },
  {
    id: "location-address",
    objectId: "location",
    order: 1,
    name: "Same street address",
    active: true,
    criteria: [
      { fieldId: "street", label: "Street", method: "address", matchBlanks: false },
      { fieldId: "postalCode", label: "Postal code", method: "exact", matchBlanks: false },
    ],
    logic: "1 AND 2",
    onCreate: { action: "allow", alert: true, report: true },
    onEdit: { action: "allow", alert: true, report: true },
    alertText: "A location at this address already exists.",
    rationale: "Street alone is not enough -- the same street name appears in many towns.",
  },
  {
    id: "opportunity-open-same-account",
    objectId: "opportunity",
    order: 1,
    name: "Open opportunity of the same name on the same account",
    active: true,
    criteria: [
      { fieldId: "accountId", label: "Account", method: "exact", matchBlanks: false },
      { fieldId: "name", label: "Opportunity name", method: "normalized", matchBlanks: false },
    ],
    logic: "1 AND 2",
    onCreate: { action: "allow", alert: true, report: true },
    onEdit: { action: "allow", alert: true, report: true },
    alertText: "This account already has an open opportunity with a very similar name.",
    // Deliberately narrow: only concurrently OPEN opportunities. Two closed
    // opportunities of the same name on one account are ordinary repeat business,
    // not duplication, and flagging them would make the alert meaningless.
    rationale: "Only open opportunities are compared -- closed ones are normal repeat business.",
  },
]);

/** Rules for one object, in DISPLAY order. Every active one is evaluated; see the
 *  header on why this ordering carries no precedence. */
export function rulesForObject(objectId, rules = SEEDED_RULES) {
  return rules.filter((r) => r.objectId === objectId).sort((a, b) => a.order - b.order);
}

/** The action that applies when a set of rules all match the same pair.
 *
 *  Rules OR together, so more than one can fire at once. The strongest action wins:
 *  a permissive rule must never cancel a blocking one an admin added deliberately.
 *  Inactive rules are ignored entirely -- deactivating is how an admin turns a rule
 *  off, and it has to actually turn it off. */
export function resolveAction(matchedRules, phase = "onCreate") {
  const active = (matchedRules ?? []).filter((r) => r.active);
  if (active.length === 0) return null;
  const blocks = active.some((r) => r[phase]?.action === "block");
  return {
    action: blocks ? "block" : "allow",
    alert: active.some((r) => r[phase]?.alert),
    report: active.some((r) => r[phase]?.report),
    // Every rule that fired, so the alert can say what matched rather than
    // asserting "possible duplicate" with no reason.
    matchedRuleIds: active.map((r) => r.id),
  };
}

/** How many objects have at least one active rule -- the honest headline number
 *  for the screen, rather than a count of rules that may all be switched off. */
export function objectsWithActiveRules(rules = SEEDED_RULES) {
  return new Set(rules.filter((r) => r.active).map((r) => r.objectId)).size;
}

/** Human summary of a rule's criteria, e.g. "Part number (Normalized) AND
 *  Manufacturer (Exact)". Built from the rule's own logic so an OR never reads as
 *  an AND -- a rule that says the wrong thing on screen is worse than no summary. */
export function describeCriteria(rule) {
  const parts = (rule.criteria ?? []).map((c) => {
    const method = MATCH_METHODS[c.method];
    return `${c.label} (${method ? method.label : c.method})`;
  });
  if (parts.length === 0) return "No criteria";
  if (parts.length === 1) return parts[0];
  const joiner = /\bOR\b/i.test(rule.logic ?? "") && !/\bAND\b/i.test(rule.logic ?? "") ? " or " : " and ";
  return parts.join(joiner);
}

/** The strongest action a SINGLE rule takes, for the list summary. A rule that
 *  blocks on either create or edit is presented as blocking -- understating it
 *  would be the dangerous direction. For several rules at once, use resolveAction. */
export function strongestAction(rule) {
  return rule.onCreate?.action === "block" || rule.onEdit?.action === "block" ? "block" : "allow";
}
