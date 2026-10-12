// PART-SUPPLIER TERMS (remediation SUP-1) -- PURE helpers for Part Detail's "Suppliers & terms" section. No I/O, no
// React; Node-importable, so functions/test/partSupplierTermsEmployeeContractPostgres.test.mjs builds its requests with
// EXACTLY these builders and pins the server's answers to them.
//
// These shape what the employee typed into the request the governed command takes (functions/src/eosOps/
// partSupplierTerms.ts) and turn the answer into words. They are NOT a second authority: the server validates every
// term, decides every capability and refuses what it refuses. Nothing here decides who may do what.
//
// GOVERNED FIELD GROUPS. The list answer carries `fieldAccess` -- the SERVER's per-group read / create / edit decision for
// the signed-in employee, from their effective Security Roles -- and each item a `withheld` list naming the groups whose
// fields were left out (never their values). The section renders from those two facts only: it never infers access from
// a Role, persona or title, and these builders never send a COMMERCIAL key the server said the employee cannot write.

/** The sensitive group (cost, currency, contract window) -- named by the server; mirrored here only to build requests. */
export const COMMERCIAL_GROUP = "COMMERCIAL";
export const COMMERCIAL_FIELDS = Object.freeze(["cost", "currency", "contractStart", "contractEnd"]);
/** What a withheld cell says. No value is ever on the wire to show instead. */
export const RESTRICTED_LABEL = "Restricted — requires cost visibility";

/** The server's decision for one group, fail closed: an absent answer is "no". */
export function groupAccess(fieldAccess, group) {
  const g = fieldAccess && typeof fieldAccess === "object" ? fieldAccess[group] : null;
  return { read: g?.read === true, create: g?.create === true, edit: g?.edit === true };
}
/** Did the server withhold this group from this item? */
export const isWithheld = (item, group) => Array.isArray(item?.withheld) && item.withheld.some((w) => w?.group === group);

export const AVAILABILITY_STATES = Object.freeze(["AVAILABLE", "UNAVAILABLE", "UNKNOWN"]);
export const AVAILABILITY_LABEL = Object.freeze({ AVAILABLE: "Available", UNAVAILABLE: "Unavailable", UNKNOWN: "Unknown" });
/** Client mirror of functions/src/partMaster/types.ts UNIT_CODES (the purchase-unit choices). */
export const PURCHASE_UNITS = Object.freeze(["EACH", "KIT", "BOTTLE", "TUBE", "BOX", "CASE", "FOOT", "ROLL", "GALLON", "OUNCE", "POUND"]);

/** The form an employee fills, as strings. */
export const EMPTY_TERMS_FORM = Object.freeze({
  supplierId: "", supplierSku: "", cost: "", currency: "USD", leadTimeDays: "", minOrderQty: "", orderMultiple: "",
  purchaseUnit: "", conversionNumerator: "", conversionDenominator: "", contractStart: "", contractEnd: "", availability: "UNKNOWN",
});

const str = (v) => (v === null || v === undefined ? "" : String(v));
const trimmed = (v) => str(v).trim();
/** An integer typed as digits becomes a number; anything else is sent as typed, so the SERVER says what is wrong with it. */
const intOrRaw = (v) => (/^\d+$/.test(trimmed(v)) ? Number(trimmed(v)) : trimmed(v));

/** The edit form, pre-filled from one item the list returned. */
export function termsFormFromItem(item) {
  return {
    supplierId: str(item?.supplierId), supplierSku: str(item?.supplierSku), cost: str(item?.cost), currency: str(item?.currency),
    leadTimeDays: str(item?.leadTimeDays), minOrderQty: str(item?.minOrderQty), orderMultiple: str(item?.orderMultiple),
    purchaseUnit: str(item?.purchaseUnit), conversionNumerator: str(item?.conversionToStockingUnit?.numerator),
    conversionDenominator: str(item?.conversionToStockingUnit?.denominator), contractStart: str(item?.contractStart),
    contractEnd: str(item?.contractEnd), availability: str(item?.availability) || "UNKNOWN",
  };
}

function conversionOf(form) {
  return { numerator: intOrRaw(form.conversionNumerator), denominator: intOrRaw(form.conversionDenominator) };
}

/** createPartSupplierItem's input. Optional terms left blank are OMITTED (the command refuses null on create). */
export function buildCreateTermsInput(partId, form) {
  const f = { ...EMPTY_TERMS_FORM, ...form };
  const out = {
    partId, supplierId: trimmed(f.supplierId), supplierSku: trimmed(f.supplierSku), cost: trimmed(f.cost),
    currency: trimmed(f.currency).toUpperCase(), leadTimeDays: intOrRaw(f.leadTimeDays),
  };
  if (trimmed(f.minOrderQty)) out.minOrderQty = trimmed(f.minOrderQty);
  if (trimmed(f.orderMultiple)) out.orderMultiple = trimmed(f.orderMultiple);
  if (trimmed(f.purchaseUnit)) {
    out.purchaseUnit = trimmed(f.purchaseUnit);
    out.conversionToStockingUnit = conversionOf(f);
  }
  if (trimmed(f.contractStart)) out.contractStart = trimmed(f.contractStart);
  if (trimmed(f.contractEnd)) out.contractEnd = trimmed(f.contractEnd);
  out.availability = f.availability || "UNKNOWN";
  return out;
}

/**
 * updatePartSupplierItem's `changes`: ONLY the terms the employee changed against the item they loaded. A blanked
 * optional term is sent as null (clear it); a blanked required term is sent blank so the server refuses it by name.
 * `fieldAccess` (the list answer's) decides whether COMMERCIAL terms are sent at all.
 */
export function buildTermsChanges(form, item, fieldAccess) {
  const loaded = termsFormFromItem(item);
  const f = { ...loaded, ...form };
  const changes = {};
  // `fieldAccess` is the list answer's: a COMMERCIAL key the server says this employee cannot edit is never sent (and
  // an absent answer is "cannot" -- fail closed).
  const commercial = groupAccess(fieldAccess, COMMERCIAL_GROUP);
  const blind = isWithheld(item, COMMERCIAL_GROUP);
  const changed = (k) => trimmed(f[k]) !== trimmed(loaded[k]);
  if (changed("supplierSku")) changes.supplierSku = trimmed(f.supplierSku);
  if (commercial.edit) {
    // A withheld group loaded blank: blank stays "not stated", never "clear it".
    if (changed("cost")) changes.cost = trimmed(f.cost);
    if (changed("currency")) changes.currency = trimmed(f.currency).toUpperCase();
    const window = ["contractStart", "contractEnd"];
    if (blind) {
      // The server needs BOTH ends from an employee who cannot see the stored window (it never checks a stated end
      // against a stored date they cannot see).
      if (window.some(changed)) for (const k of window) changes[k] = trimmed(f[k]) === "" ? null : trimmed(f[k]);
    } else {
      for (const k of window) if (changed(k)) changes[k] = trimmed(f[k]) === "" ? null : trimmed(f[k]);
    }
  }
  if (changed("leadTimeDays")) changes.leadTimeDays = intOrRaw(f.leadTimeDays);
  for (const k of ["minOrderQty", "orderMultiple"]) {
    if (changed(k)) changes[k] = trimmed(f[k]) === "" ? null : trimmed(f[k]);
  }
  if (changed("purchaseUnit") || changed("conversionNumerator") || changed("conversionDenominator")) {
    if (trimmed(f.purchaseUnit) === "") {
      changes.purchaseUnit = null;
      changes.conversionToStockingUnit = null;
    } else {
      changes.purchaseUnit = trimmed(f.purchaseUnit);
      changes.conversionToStockingUnit = conversionOf(f);
    }
  }
  if (f.availability !== loaded.availability) changes.availability = f.availability;
  return changes;
}

/** "12.5 USD" -- the cost exactly as the server states it, with its currency; the restriction when it was withheld. */
export const formatCost = (item) => (!item ? "" : isWithheld(item, COMMERCIAL_GROUP) ? RESTRICTED_LABEL : `${item.cost} ${item.currency}`);
/** The contract window, the restriction when withheld, or a dash when there is none. */
export function formatContract(item) {
  if (!item) return "";
  if (isWithheld(item, COMMERCIAL_GROUP)) return RESTRICTED_LABEL;
  return item.contractStart || item.contractEnd ? `${item.contractStart ?? "…"} – ${item.contractEnd ?? "…"}` : "—";
}
/** "BOX = 12 EACH" style: one purchase unit converts to numerator/denominator stocking units. */
export function formatPurchaseUnit(item, stockingUnit) {
  if (!item?.purchaseUnit || !item.conversionToStockingUnit) return "—";
  const { numerator, denominator } = item.conversionToStockingUnit;
  const qty = denominator === 1 ? `${numerator}` : `${numerator}/${denominator}`;
  return `1 ${item.purchaseUnit} = ${qty}${stockingUnit ? ` ${stockingUnit}` : ""}`;
}

const SAVED = Object.freeze({
  created: "Supplier terms added.",
  replayed: "Already recorded (no change).",
  updated: "Supplier terms saved.",
  activated: "Supplier terms reactivated.",
  deactivated: "Supplier terms deactivated.",
  preferred: "Preferred supplier set.",
  unchanged: "Nothing to change -- it was already that way.",
});

/** What the employee is told after a governed SUCCESS (`result.outcome` is the server's own word). */
export function outcomeFromResult(result) {
  const outcome = result?.outcome;
  return { kind: outcome === "replayed" || outcome === "unchanged" ? "replayed" : "applied", message: SAVED[outcome] ?? "Saved." };
}

/**
 * What the employee is told after a governed REFUSAL. `err.code` is the transport category (FORBIDDEN, CONFLICT, ...);
 * the server's message carries the specific reason, and is shown for the refusals the employee can act on.
 */
export function outcomeFromError(err, action) {
  const code = err?.code;
  const reason = typeof err?.message === "string" && err.message ? err.message : null;
  switch (code) {
    case "FORBIDDEN":
      if (err?.details?.refusal === "FIELD_GROUP_FORBIDDEN") {
        return { kind: "denied", message: "You're not authorized to set or change cost & contract terms. That permission is governed in Administration." };
      }
      return { kind: "denied", message: "You're not authorized to make this change. Supplier terms are governed in Administration." };
    case "CONFLICT":
      return action === "create"
        ? { kind: "conflict", message: "This supplier already has terms for this part. Reload and edit them instead." }
        : { kind: "conflict", message: "These supplier terms changed since you loaded them. Reload and try again." };
    case "NOT_FOUND":
      return { kind: "notFound", message: reason ? `Not found: ${reason}.` : "That record no longer exists." };
    case "INVALID_INPUT":
    case "PRECONDITION_FAILED":
      return { kind: "invalid", message: reason ? `Refused: ${reason}.` : "The change was refused." };
    case "UNAUTHENTICATED":
    case "NOT_SIGNED_IN":
      return { kind: "unauthenticated", message: "Sign in again to continue." };
    default:
      return { kind: "failed", message: "The change could not be completed. Try again." };
  }
}
