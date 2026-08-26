// THE tel: DERIVATION, ASSERTED OFFLINE.
//
// domain/phoneLink.js is the whole of what Account North Star P1's mobile Call affordance does:
// take a Contact's OWN stored phone value and produce a dial string for the device. There is no
// write, no callable, no telephony service and no second phone-number authority anywhere behind
// it, which is exactly why the module is this small and why its rules are worth pinning:
//
//   * a stored value with no dialable digits produces NOTHING, so the caller renders its honest
//     unavailable state rather than a link to nowhere;
//   * the digits that come out are the digits that went in, in order — this is a dial string, not
//     a reformatting, and nothing here is ever persisted back to a Contact.
import test from "node:test";
import assert from "node:assert/strict";
import { telHref } from "../src/domain/phoneLink.js";

test("a stored US number becomes a dialable tel: URI", () => {
  assert.equal(telHref("(602) 555-0144"), "tel:6025550144");
  assert.equal(telHref("602-555-0144"), "tel:6025550144");
  assert.equal(telHref("602.555.0144"), "tel:6025550144");
  assert.equal(telHref("6025550144"), "tel:6025550144");
});

test("a leading + is preserved — an international number stays international", () => {
  assert.equal(telHref("+1 602-555-0144"), "tel:+16025550144");
  assert.equal(telHref("  +44 20 7946 0958 "), "tel:+442079460958");
  // A + anywhere OTHER than the front is not a country-code marker and must not become one.
  assert.equal(telHref("602-555-0144 +ext"), "tel:6025550144");
});

test("a value with no dialable digits produces NOTHING, never a broken link", () => {
  for (const value of [null, undefined, "", "   ", "n/a", "call the office", 6025550144, {}]) {
    assert.equal(telHref(value), null, `expected no href for ${JSON.stringify(value)}`);
  }
});

test("the digits out are the digits in, in order — this formats nothing", () => {
  // The mutation this guards: a "helpful" normaliser that added a country code, dropped an
  // extension, or reordered anything would be inventing a number the record does not hold.
  const stored = "1 (602) 555-0144 x12";
  assert.equal(telHref(stored), "tel:1602555014412");
});

test("the input is never mutated", () => {
  const contact = { phone: "(602) 555-0144" };
  telHref(contact.phone);
  assert.equal(contact.phone, "(602) 555-0144");
});
