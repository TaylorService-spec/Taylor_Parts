// A STORED PHONE NUMBER, HANDED TO THE DEVICE. Nothing more.
//
// ════════════════════ WHAT THIS IS, AND WHAT IT IS NOT ════════════════════
//
// Account North Star P1 (mobile addendum) asks the phone composition for a working "Call"
// affordance beside the governed primary contact. That affordance is a `tel:` URI and nothing
// else: EOS supplies the number, and the operating system owns the dialer, the confirmation and
// the call itself. There is no telephony integration here, no automated dialing, no command, no
// callable, no write, and no second phone-number authority — the ONLY input this module ever
// accepts is a Contact's own stored `phone` value.
//
// ════════════════════ WHY IT DOES NOT REFORMAT ANYTHING ════════════════════
//
// This repository has no phone-number formatter, and this is deliberately not the place to
// introduce one. The number a person READS stays exactly the string that is stored (a formatter
// here would become a second rendering of a fact the record already states, the NS-P4 defect).
// What a `tel:` URI needs is narrower than a format: a dial string. So this performs the MINIMUM
// presentation-safe conversion — keep the digits, keep a leading `+` — and returns null when
// there is nothing dialable, so the caller renders its honest unavailable state rather than a
// link to nowhere. Nothing is persisted, and no Contact document is touched.

/**
 * The `tel:` href for a stored phone value, or null when the value carries no dialable digits.
 *
 * @param {unknown} phone the Contact's OWN stored `phone` value — never an account-level number,
 *   never another contact's number, never a value derived from anywhere else.
 * @returns {string|null} `tel:+16025550144` / `tel:6025550144`, or null.
 */
export function telHref(phone) {
  if (typeof phone !== "string") return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;
  const international = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  return `tel:${international ? "+" : ""}${digits}`;
}

export default telHref;
