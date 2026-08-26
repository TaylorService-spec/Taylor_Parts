import { accountEntity } from "../metadata/definitions/account.js";
import { accountStatusTone } from "./accountPortfolio.js";
import { resolveTaxStatus } from "./commercialProfile.js";

// THE ACCOUNT, DERIVED ONCE.
//
// ════════════════════ WHY THIS FILE IS SMALLER THAN ITS SIBLINGS ════════════════════
//
// `workOrderNorthStar.js` and `salesOrderNorthStar.js` each had to invent a spine, a status
// vocabulary and an attention model, because none existed for those records. The Account already
// has most of that: `accountAttentionProjection.js` derives real attention items from AR and past-due
// Work Orders, `accountPortfolio.js` owns the status tone, and `metadata/definitions/account.js`
// owns every enum label.
//
// So this file DELEGATES rather than re-deriving, and that is the whole point of NS-P4. A fourth
// copy of "CUSTOMER means Customer" would be the defect, not the fix — and there were already
// three: the metadata definition, `AccountDetail.jsx`'s own private maps, and
// `wholeUnitAssetDisplay.js`. This removes the page's copy by giving it somewhere canonical to
// read from.
//
// What is genuinely NEW here is the answer to a question the other two families never had to ask:
// what does a lifecycle band draw for a record that HAS no lifecycle.

// ═════════════════════════════════════════ THE MISSING LIFECYCLE (ND-11)

/**
 * AN ACCOUNT HAS NO GOVERNED LIFECYCLE, and this function exists to say so ONCE.
 *
 * NS-P1 requires a visible, navigable lifecycle spine on a record page. The Work Order has eleven
 * governed statuses behind `transitionWorkOrder`; the Sales Order has five behind
 * `transitionSalesOrder`. The Account has FOUR STATUS VALUES AND NO TRANSITION COMMAND AT ALL:
 * `status` is an ordinary editable field (it is in `accountRecordPage.editableFieldIds`), written
 * through `updateAccount` like `name` or `notes`.
 *
 * ACTIVE / INACTIVE / PROSPECT / ARCHIVED LOOK like a progression, which is exactly the trap. If
 * they were drawn as four chevrons, the page would assert that an account moves Prospect → Active →
 * Inactive → Archived and does not go back. Nothing enforces that. An archived account can be
 * edited straight to Prospect, and no guard anywhere would object.
 *
 * Drawing that spine would therefore be a fabricated claim about how the business works — the same
 * class of error as printing a stage time the record does not hold. So no spine is drawn, the state
 * is rendered as a sentence, and the page states the reason in words rather than leaving a reader
 * to wonder why this record type looks different from the other two.
 *
 * @returns {{ hasSpine: false, reason: string }}
 */
export function accountLifecycle() {
  return Object.freeze({
    hasSpine: false,
    reason:
      "An account has no lifecycle to show. Its status is a field someone sets, not a stage it moves through, so there is no ordered progression to draw.",
  });
}

// ═════════════════════════════════════════ VOCABULARY (delegated, never forked)

const FIELD = Object.fromEntries((accountEntity.fields ?? []).map((f) => [f.id, f]));

/** Read one enum label from the CANONICAL metadata definition. Never a local copy. */
function enumLabel(fieldId, value) {
  const labels = FIELD[fieldId]?.enumLabels ?? null;
  if (!labels) return null;
  return labels[value] ?? null;
}

/**
 * STATUS IN WORDS (NS R04).
 *
 * `accountStatusLabel` in domain/constants.js returns an unrecognised value VERBATIM, which is
 * right for a field grid and wrong here for the same reason it was wrong on the Sales Order: a
 * status the vocabulary cannot place must be reported as unplaceable, not echoed as if it were a
 * word. This returns null on a miss.
 */
export function accountStatusWords(status) {
  return enumLabel("status", status);
}

/**
 * STATUS AS A SENTENCE.
 *
 * Every clause states what the status MEANS for the business, not what happens next — because
 * nothing happens next on its own. There is no transition to be waiting on, which is precisely
 * ND-11, and a clause implying otherwise would smuggle the fabricated lifecycle back in through
 * the copy.
 */
const STATUS_CLAUSE = Object.freeze({
  ACTIVE: "trading normally",
  INACTIVE: "no longer trading, and kept for history",
  PROSPECT: "not yet a customer",
  ARCHIVED: "closed, and read-only by convention",
});

export function accountStatusSentence(status) {
  const words = accountStatusWords(status);
  if (!words) return null;
  const clause = STATUS_CLAUSE[status];
  return clause ? words + " — " + clause : words;
}

/**
 * THE CLASSIFICATION FACTS — relationship types and line of business, in words.
 *
 * Both are optional, additive, multi-valued and INFORMATIONAL: neither gates any authorization.
 * An account with none renders nothing, never a silent default to "Customer" or "Taylor" — the
 * rule the page's own badge components already followed, preserved here where it can be asserted.
 *
 * Ordered by the definition's own enum order rather than by whatever order the array happens to
 * hold, so two accounts with the same classification always read the same way.
 */
export function accountClassification(account) {
  const read = (fieldId, values) => {
    const list = Array.isArray(values) ? values : [];
    const labels = FIELD[fieldId]?.enumLabels ?? {};
    return Object.keys(labels)
      .filter((key) => list.includes(key))
      .map((key) => ({ key, label: labels[key] }));
  };
  return {
    relationships: read("relationshipTypes", account?.relationshipTypes),
    linesOfBusiness: read("lineOfBusiness", account?.lineOfBusiness),
    // A value stored but not in the vocabulary is reported rather than dropped: silently rendering
    // nothing is how a data problem becomes invisible.
    unrecognised: [
      ...(Array.isArray(account?.relationshipTypes) ? account.relationshipTypes : []),
      ...(Array.isArray(account?.lineOfBusiness) ? account.lineOfBusiness : []),
    ].filter((v) => !enumLabel("relationshipTypes", v) && !enumLabel("lineOfBusiness", v)),
  };
}

/**
 * THE TERMS DIGEST — the commercial terms, as one header fact.
 *
 * Account North Star P1 puts the commercial terms in the record header's fact row, beside the
 * status and the owner, because "Net 30 · Taxable · PO required" is part of who this customer is
 * to the business, not a detail to go hunting for in the rail. The rail's Commercial profile still
 * states each field on its own; this is the SAME derivation read once for the header, not a second
 * one — every word comes from accountCommercialVocabulary.js through the metadata definition's own
 * enumLabels, which is the same place the rail reads.
 *
 * THREE RULES IT KEEPS, all of them pre-existing:
 *   * Tax status is ALWAYS stated. An absent value resolves to Unknown (resolveTaxStatus), NEVER
 *     silently to Taxable — the safe default commercialProfile.js exists to protect.
 *   * PO required only appears when a REAL boolean is stored. A malformed stored value is left to
 *     the edit form to surface; it is never shown here as a confident Yes or No.
 *   * Payment terms only appear when set. There is no default term to imply.
 *
 * @returns {string|null} the digest, or null when the account carries none of these facts.
 */
export function accountTermsDigest(account) {
  const parts = [];
  const terms = enumLabel("paymentTerms", account?.paymentTerms ?? null);
  if (terms) parts.push(terms);
  // Always stated, and resolved through the SAME safe default the rail applies.
  const tax = enumLabel("taxStatus", resolveTaxStatus(account?.taxStatus));
  if (tax) parts.push(tax);
  if (account?.purchaseOrderRequired === true) parts.push("PO required");
  else if (account?.purchaseOrderRequired === false) parts.push("No PO required");
  return parts.length > 0 ? parts.join(" · ") : null;
}

// ═════════════════════════════════════════ IDENTITY

/**
 * The single header derivation.
 *
 * ════════════ AN ACCOUNT'S IDENTITY IS ITS NAME ════════════
 *
 * The Work Order and the Sales Order are titled by a governed reference (WO-YYYY-######,
 * SO-YYYY-######) because a human never calls them anything else. An Account is called by its NAME.
 * `customerNumber`, `erpId`, `accountingId` and `legacyId` are all EXTERNAL identifiers — they live
 * in the definition's "Notes & Identifiers" section, they come from other systems, and not one of
 * them is what anybody here calls the customer.
 *
 * So the title is the name, and the absence of a reference is not a gap to be filled. What DECISIONS
 * #106 forbids is unchanged and still applies: the Firestore document id is never displayed, under
 * any circumstance, including as a fallback for a nameless account.
 */
export function accountHeader(account) {
  if (!account) return null;
  const status = account.status ?? null;
  const name = typeof account.name === "string" && account.name.trim() ? account.name.trim() : null;
  return {
    name,
    statusWords: accountStatusWords(status),
    statusSentence: accountStatusSentence(status),
    statusTone: accountStatusTone(status),
    rawStatus: status,
    // Stated so the page can say "this account has no name recorded" rather than rendering an empty
    // heading — and so it never reaches for the id.
    unnamed: name === null,
    isArchived: status === "ARCHIVED",
  };
}

// ═════════════════════════════════════════ ATTENTION — DELIBERATELY NOT DERIVED HERE
//
// There is no accountAttention() in this file, and its absence is a decision rather than an
// omission.
//
// The other two families needed one because nothing decided what deserved attention on a Work
// Order or a Sales Order. The Account already has `accountAttentionProjection.js`, which composes
// the AR view and `workOrderAttentionProjection.js`'s own past-due predicate, and is the authority.
//
// The first draft of this file adapted its items into the flat `AttentionBand` shape the other two
// families use. That was wrong, and the projection's own header says why:
//
//   "AR and WO past-due are DELIBERATELY never merged into one ranked list -- each renders under
//    its own section with its own fields."
//
// Flattening them into one band would have overridden a behavioral rule to satisfy a visual
// pattern, which is exactly what the three-authority model forbids. It would also have discarded
// the per-source honest notes: a source that could not be confirmed renders its own note rather
// than contributing a fake zero, and a flat list of facts has nowhere to put that.
//
// So the Account's attention problem was never that it lacked a band. It was that the section sat
// at the BOTTOM of the page, below every related list — an NS-P2 ordering defect. The composition
// moves it to its correct position and changes nothing about what it says.
