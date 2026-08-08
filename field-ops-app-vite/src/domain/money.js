// Money — the deterministic AUTHORITATIVE monetary representation for EOS Finance (Owner §8). A Money value is
// an INTEGER count of a currency's minor units + the currency code. NEVER binary floating point. All arithmetic
// is exact integer math; the ONE place rounding happens (applying a rate — tax/discount) is centralized and
// deterministic (HALF_UP by default). Currency mismatches fail closed (throw), never silently coerce.
//
// This is a value object, not an accounting engine: it computes exact amounts; it decides no tax/revenue/policy.

export class MoneyError extends Error {
  constructor(message) { super(message); this.name = "MoneyError"; }
}

export const DEFAULT_CURRENCY = "USD";
// Minor units per one major unit, by currency (USD cents = 2). Extensible; unknown currencies default to 2 but
// callers should pass a known currency for authoritative amounts.
const CURRENCY_EXPONENT = Object.freeze({ USD: 2, EUR: 2, GBP: 2, CAD: 2, JPY: 0 });
export const currencyExponent = (currency) => CURRENCY_EXPONENT[currency] ?? 2;

// Canonical constructor — the authority stores minor units directly. `minor` must be a safe integer.
export function money(minor, currency = DEFAULT_CURRENCY) {
  if (!Number.isSafeInteger(minor)) throw new MoneyError(`money minor units must be a safe integer, got ${minor}`);
  if (typeof currency !== "string" || currency.length === 0) throw new MoneyError("money requires a currency code");
  return Object.freeze({ minor, currency });
}
export const zeroMoney = (currency = DEFAULT_CURRENCY) => money(0, currency);
export const isMoney = (m) => !!m && typeof m === "object" && Number.isSafeInteger(m.minor) && typeof m.currency === "string";

// Parse a MAJOR amount given as a STRING (never a float literal) into exact minor units. "12.34"/"USD" → 1234.
// Rejects more fractional digits than the currency allows (no silent rounding of input). Accepts optional
// leading "-". Use this to bring human/keyed amounts into the exact representation.
export function fromMajorString(str, currency = DEFAULT_CURRENCY) {
  if (typeof str !== "string") throw new MoneyError("fromMajorString requires a string amount");
  const s = str.trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new MoneyError(`invalid money amount "${str}"`);
  const exp = currencyExponent(currency);
  const [, sign, whole, frac = ""] = m;
  if (frac.length > exp) throw new MoneyError(`"${str}" has more than ${exp} fractional digits for ${currency}`);
  const paddedFrac = (frac + "0".repeat(exp)).slice(0, exp);
  const minor = Number(whole) * 10 ** exp + (exp > 0 ? Number(paddedFrac) : 0);
  if (!Number.isSafeInteger(minor)) throw new MoneyError(`"${str}" exceeds the safe money range`);
  return money(sign === "-" ? -minor : minor, currency);
}

function sameCurrency(a, b) {
  if (!isMoney(a) || !isMoney(b)) throw new MoneyError("expected two Money values");
  if (a.currency !== b.currency) throw new MoneyError(`currency mismatch: ${a.currency} vs ${b.currency}`);
  return a.currency;
}
export const isSameCurrency = (a, b) => isMoney(a) && isMoney(b) && a.currency === b.currency;

export function addMoney(a, b) { return money(a.minor + b.minor, sameCurrency(a, b)); }
export function subtractMoney(a, b) { return money(a.minor - b.minor, sameCurrency(a, b)); }
export function negateMoney(a) { if (!isMoney(a)) throw new MoneyError("expected Money"); return money(-a.minor, a.currency); }

// Multiply a unit amount by an integer QUANTITY (exact — unitPrice × qty). qty must be a non-negative integer.
export function multiplyMoneyByQuantity(m, qty) {
  if (!isMoney(m)) throw new MoneyError("expected Money");
  if (!Number.isSafeInteger(qty) || qty < 0) throw new MoneyError(`quantity must be a non-negative integer, got ${qty}`);
  return money(m.minor * qty, m.currency);
}

// Central deterministic rounding for a division of integers. HALF_UP (round half away from zero) by default;
// HALF_EVEN (banker's) available. This is the ONE rounding site for money.
export function roundedDiv(numerator, denominator, mode = "HALF_UP") {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator === 0) {
    throw new MoneyError("roundedDiv requires integers and a non-zero denominator");
  }
  const negative = (numerator < 0) !== (denominator < 0);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const q = Math.floor(n / d);
  const r2 = (n % d) * 2;
  let up;
  if (mode === "HALF_EVEN") up = r2 > d || (r2 === d && q % 2 === 1);
  else up = r2 >= d; // HALF_UP
  const mag = q + (up ? 1 : 0);
  return negative ? -mag : mag;
}

// Apply a RATE (a tax or discount rate) to a Money, expressed as an exact integer ratio {numerator, denominator}
// (e.g. 8.25% = {numerator:825, denominator:10000}) or basis points via rateFromBasisPoints. Rounds once,
// deterministically. Rates are integers to keep the whole computation float-free.
export function multiplyMoneyByRate(m, { numerator, denominator }, mode = "HALF_UP") {
  if (!isMoney(m)) throw new MoneyError("expected Money");
  return money(roundedDiv(m.minor * numerator, denominator, mode), m.currency);
}
export const rateFromBasisPoints = (bps) => {
  if (!Number.isInteger(bps)) throw new MoneyError("basis points must be an integer");
  return { numerator: bps, denominator: 10000 };
};

// Allocate a Money across integer weights, distributing the remainder deterministically (largest-remainder) so
// the parts sum EXACTLY to the whole — for proration/splits with no lost or invented minor units.
export function allocateMoney(m, weights) {
  if (!isMoney(m)) throw new MoneyError("expected Money");
  const w = Array.isArray(weights) ? weights.map((x) => (Number.isInteger(x) && x >= 0 ? x : 0)) : [];
  const total = w.reduce((s, x) => s + x, 0);
  if (total === 0) return w.map(() => zeroMoney(m.currency));
  const base = w.map((x) => Math.trunc((m.minor * x) / total));
  let remainder = m.minor - base.reduce((s, x) => s + x, 0);
  // hand out the remaining minor units to the largest fractional remainders first
  const order = w
    .map((x, i) => ({ i, frac: (m.minor * x) % total }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = base.slice();
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) out[order[k].i] += 1;
  return out.map((minor) => money(minor, m.currency));
}

export const compareMoney = (a, b) => { sameCurrency(a, b); return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0; };
export const isZeroMoney = (m) => isMoney(m) && m.minor === 0;
export const isNegativeMoney = (m) => isMoney(m) && m.minor < 0;
export const sumMoney = (list, currency = DEFAULT_CURRENCY) =>
  (Array.isArray(list) ? list : []).reduce((acc, m) => addMoney(acc, m), zeroMoney(currency));

// Presentation ONLY (never used for authoritative math): render minor units as a major-unit string.
export function formatMoneyMajor(m) {
  if (!isMoney(m)) return "—";
  const exp = currencyExponent(m.currency);
  const sign = m.minor < 0 ? "-" : "";
  const abs = Math.abs(m.minor);
  if (exp === 0) return `${sign}${abs}`;
  const factor = 10 ** exp;
  return `${sign}${Math.trunc(abs / factor)}.${String(abs % factor).padStart(exp, "0")}`;
}
