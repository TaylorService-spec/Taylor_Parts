// Issue #214 PR-1 -- deterministic unit test for the pure a11y-wiring helpers
// that back the shared form primitives (src/shared/ui/form/fieldA11y.js). The
// primitive COMPONENTS (Field / FormActions / FormError / FormStatus) are JSX
// and are verified in a real browser by the driver's
// `verify-account-form-consistency`; this file covers the framework-free id /
// aria-describedby / required-suffix logic that both Field and its callers rely
// on to stay in sync.
//
// Run: node test/formPrimitives.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { hintId, errorId, describedBy, requiredLabelSuffix } from "../src/shared/ui/form/fieldA11y.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// --- id derivation ----------------------------------------------------
ok("hintId / errorId derive stable suffixed ids from a control id", () => {
  assert.equal(hintId("cp-currency"), "cp-currency-hint");
  assert.equal(errorId("cp-currency"), "cp-currency-error");
});
ok("hintId / errorId return undefined without an id (attribute omitted, not empty)", () => {
  assert.equal(hintId(undefined), undefined);
  assert.equal(hintId(""), undefined);
  assert.equal(errorId(undefined), undefined);
});

// --- describedBy composition -----------------------------------------
ok("describedBy: hint only -> the hint id", () => {
  assert.equal(describedBy("account-tags", { hasHint: true }), "account-tags-hint");
});
ok("describedBy: error only -> the error id", () => {
  assert.equal(describedBy("cp-currency", { hasError: true }), "cp-currency-error");
});
ok("describedBy: both -> hint before error, space separated (reading order)", () => {
  assert.equal(describedBy("f", { hasHint: true, hasError: true }), "f-hint f-error");
});
ok("describedBy: neither -> undefined (so aria-describedby is omitted)", () => {
  assert.equal(describedBy("f", {}), undefined);
  assert.equal(describedBy("f"), undefined);
});
ok("describedBy: no id -> undefined regardless of flags", () => {
  assert.equal(describedBy("", { hasHint: true, hasError: true }), undefined);
  assert.equal(describedBy(undefined, { hasError: true }), undefined);
});

// --- required indicator is TEXT, never colour alone -------------------
ok("requiredLabelSuffix: required -> ' (required)' text; otherwise empty", () => {
  assert.equal(requiredLabelSuffix(true), " (required)");
  assert.equal(requiredLabelSuffix(false), "");
  assert.equal(requiredLabelSuffix(undefined), "");
});

console.log(`\n${passed} passed, 0 failed`);
