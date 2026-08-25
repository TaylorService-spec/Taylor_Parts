import { formatMinorUnits, currencyExponent } from "./money.js";

// THE ONE MONEY DISPLAY PATH.
//
// ════════════════════ THE DEFECT THIS CLOSES ════════════════════
//
// Two Sales Orders worth the same fifty dollars rendered differently:
//
//     SO-2026-000007    USD 50.00
//     SO-2026-000006        50.00
//
// Neither is normal US currency presentation, and the difference was not cosmetic — it was a
// reader being shown two different things about two identical amounts. `formatMinor` prefixed the
// ISO code when the record carried a currency and printed bare digits when it did not, so the
// display was reporting a metadata gap as though it were a fact about the money.
//
// ════════════════════ WHAT THIS FUNCTION WILL AND WILL NOT ASSUME ════════════════════
//
// A KNOWN currency renders in that currency's normal presentation for the reader's locale — USD
// 5000 minor units becomes `$50.00`.
//
// AN ABSENT CURRENCY RENDERS BARE DIGITS, and that is deliberate. This module is reusable EOS
// domain code: if a missing currency silently became USD here, "no currency means dollars" would
// become a system-wide financial invariant established by a formatter, which is the wrong place
// for a monetary decision and the wrong reason to make one. A caller that KNOWS its records are
// denominated in a particular currency says so — see domain/salesOrderDisplayCurrency.js, which is
// explicitly scoped to this Taylor implementation and names its evidence.
//
// ════════════════════ INTEGER MINOR UNITS REMAIN THE AUTHORITY ════════════════════
//
// This is presentation only. It reads stored money and returns a string; it never writes, rounds,
// or hands a float back to anything. `money.js`'s exponent table stays the authority for how many
// digits follow the decimal point — pinned into the formatter options rather than left to Intl's
// own table, so the two can never disagree about a currency. `moneyDisplayDigitsMatchExactMath`
// in the tests holds that line: the digits Intl produces must equal `formatMinorUnits`' exact
// integer math for every value checked.

const FALLBACK_LOCALE = "en-US";

/** Intl formatters are expensive to construct and are pure for a (locale, currency) pair. */
const cache = new Map();

function formatterFor(locale, currency, exp) {
  const key = `${locale}|${currency}|${exp}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      // PINNED FROM money.js, not left to Intl's own table. A currency the two disagree about
      // would otherwise render with a different number of decimals than the system stores.
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    });
    cache.set(key, f);
  }
  return f;
}

/**
 * Render integer minor units for display.
 *
 * @param {number|null|undefined} minor integer minor units
 * @param {string|null|undefined} currency ISO 4217 alphabetic code, or null when genuinely unknown
 * @returns {string} `$50.00` with a known currency, `50.00` without one, `—` when there is no amount
 */
export function formatMoneyDisplay(minor, currency, { locale = FALLBACK_LOCALE } = {}) {
  // Exact integer math first. This is also the fallback shape, so a currency Intl cannot handle
  // degrades to a truthful number rather than throwing in the middle of a render.
  const exact = formatMinorUnits(minor, currency);
  if (exact === "—") return exact;

  const code = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  // NO CURRENCY, NO SYMBOL. See the header: this module does not decide what an unlabelled
  // amount is denominated in.
  if (code.length !== 3) return exact;

  const exp = currencyExponent(code);
  try {
    return formatterFor(locale, code, exp).format(Number(minor) / 10 ** exp);
  } catch {
    // An unrecognised code is a data problem, not a reason to render nothing. Falling back to the
    // exact digits keeps the amount readable and keeps the unknown code from being presented as
    // though the system understood it.
    return exact;
  }
}
