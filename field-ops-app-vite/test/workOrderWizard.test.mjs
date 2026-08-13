import {
  WIZARD_STEPS,
  WIZARD_STEP_COUNT,
  getWizardCreateErrorMessage,
  stepBlockedReason,
  canAdvance,
  CREATE_UNAVAILABLE_MESSAGE,
  CREATE_UNAUTHENTICATED_MESSAGE,
  CREATE_PERMISSION_DENIED_MESSAGE,
  CREATE_FAILED_MESSAGE,
  CREATE_INTERNAL_MESSAGE,
  makeWorkOrderIdempotencyKey,
  createIdempotencyKeyHolder,
} from "../src/domain/workOrderWizard.js";

let passed = 0;
function ok(name, cond, detail = "") {
  if (cond) {
    console.log(`PASS -- ${name}`);
    passed += 1;
  } else {
    console.log(`FAIL -- ${name} ${detail}`);
    process.exitCode = 1;
  }
}

// ----- step model -----
ok("step model has four ordered steps", WIZARD_STEP_COUNT === 4 && WIZARD_STEPS.map((s) => s.n).join(",") === "1,2,3,4");
ok("step labels are the four wizard stages",
  WIZARD_STEPS.map((s) => s.label).join("|") === "Customer|Location|Service Details|Review & Create");

// ----- getWizardCreateErrorMessage: explicit per-code mapping -----
ok("not-found -> service unavailable",
  getWizardCreateErrorMessage({ code: "functions/not-found" }) === CREATE_UNAVAILABLE_MESSAGE);
ok("unavailable -> service unavailable",
  getWizardCreateErrorMessage({ code: "functions/unavailable" }) === CREATE_UNAVAILABLE_MESSAGE);
ok("unauthenticated -> sign-in message",
  getWizardCreateErrorMessage({ code: "functions/unauthenticated" }) === CREATE_UNAUTHENTICATED_MESSAGE);
ok("permission-denied -> authorization message",
  getWizardCreateErrorMessage({ code: "functions/permission-denied" }) === CREATE_PERMISSION_DENIED_MESSAGE);
ok("invalid-argument -> failed + appended safe validation detail",
  getWizardCreateErrorMessage({ code: "functions/invalid-argument", message: "customerId is required." })
    === `${CREATE_FAILED_MESSAGE} customerId is required.`);
ok("invalid-argument with blank message -> plain failed (nothing appended)",
  getWizardCreateErrorMessage({ code: "functions/invalid-argument", message: "   " }) === CREATE_FAILED_MESSAGE);
ok("internal -> internal/no-record message, raw detail NOT appended",
  getWizardCreateErrorMessage({ code: "functions/internal", message: "TypeError: x is undefined at line 42" })
    === CREATE_INTERNAL_MESSAGE);
ok("unknown -> internal/no-record message, raw detail NOT appended",
  getWizardCreateErrorMessage({ code: "functions/unknown", message: "raw stack leak" }) === CREATE_INTERNAL_MESSAGE);
ok("internal message never contains the raw server detail",
  !getWizardCreateErrorMessage({ code: "functions/internal", message: "SECRET-RAW-DETAIL" }).includes("SECRET-RAW-DETAIL"));
ok("unrecognized code -> plain failed, nothing appended",
  getWizardCreateErrorMessage({ code: "functions/resource-exhausted", message: "should not leak" }) === CREATE_FAILED_MESSAGE);
ok("null error -> plain failed message", getWizardCreateErrorMessage(null) === CREATE_FAILED_MESSAGE);
ok("missing code -> plain failed message", getWizardCreateErrorMessage({ message: "no code" }) === CREATE_FAILED_MESSAGE);

// ----- stepBlockedReason: step 1 (customer) -----
ok("step1 blocked until a customer is selected",
  stepBlockedReason(1, { selectedAccountId: null }) === "Search for and select a customer to continue.");
ok("step1 clears once a customer is selected",
  stepBlockedReason(1, { selectedAccountId: "acct-1" }) === null);

// ----- stepBlockedReason: step 2 (location) -----
ok("step2 with no locations -> add-a-location guidance",
  stepBlockedReason(2, { hasLocations: false, selectedLocationId: "" })
    === "This customer has no locations yet. Add one from the Customer Detail page first.");
ok("step2 with locations but none chosen -> select-a-location",
  stepBlockedReason(2, { hasLocations: true, selectedLocationId: "" }) === "Select a location to continue.");
ok("step2 clears once a location is chosen",
  stepBlockedReason(2, { hasLocations: true, selectedLocationId: "loc-1" }) === null);

// ----- stepBlockedReason: step 3 (type OR complaint) -----
ok("step3 blocked with neither type nor complaint",
  stepBlockedReason(3, { type: "", complaint: "" }) === "Choose a Type, or enter a Complaint, to continue.");
ok("step3 blocked when complaint is only whitespace",
  stepBlockedReason(3, { type: "", complaint: "   " }) === "Choose a Type, or enter a Complaint, to continue.");
ok("step3 clears with a type", stepBlockedReason(3, { type: "PM", complaint: "" }) === null);
ok("step3 clears with a complaint only", stepBlockedReason(3, { type: "", complaint: "No heat" }) === null);
ok("step3 tolerates an undefined complaint", stepBlockedReason(3, { type: "PM" }) === null);

// ----- step 4 and canAdvance -----
ok("step4 has no field requirement (gates on submit)", stepBlockedReason(4, {}) === null);
ok("canAdvance mirrors reason === null",
  canAdvance(3, { type: "PM" }) === true && canAdvance(3, { type: "", complaint: "" }) === false);

// ----- site-work #2: wo-wizard-missing-idempotency-key -----
// Regression for the defect: the wizard's Create button (and any Cloud Functions SDK
// retry underneath it) must submit the SAME idempotencyKey on every call for one
// submission, never a fresh one per call -- a fresh one per call is exactly what
// let a double-submit/network-retry mint a duplicate Work Order and burn a WO number.
ok("makeWorkOrderIdempotencyKey returns a non-empty string",
  typeof makeWorkOrderIdempotencyKey() === "string" && makeWorkOrderIdempotencyKey().length > 0);
ok("makeWorkOrderIdempotencyKey generates a DIFFERENT value each call (so a genuinely new key exists)",
  makeWorkOrderIdempotencyKey() !== makeWorkOrderIdempotencyKey());

{
  // Simulates WorkOrderWizard.jsx's one-holder-per-mount usage: getKey() called on the
  // first Create click AND again on a retry (e.g. after a transient failure, or a
  // network-level double-submit) must return the identical key both times -- not
  // a freshly generated one.
  const holder = createIdempotencyKeyHolder();
  const firstAttemptKey = holder.getKey();
  const retryKey = holder.getKey();
  const thirdCallKey = holder.getKey();
  ok("stable holder: key is reused on retry, not regenerated",
    firstAttemptKey === retryKey && retryKey === thirdCallKey,
    `first=${firstAttemptKey} retry=${retryKey} third=${thirdCallKey}`);
}

{
  // Two SEPARATE wizard sessions (two holders, matching two separate component mounts,
  // i.e. two genuinely distinct Work Orders the user intends to create) must not collide.
  const sessionA = createIdempotencyKeyHolder();
  const sessionB = createIdempotencyKeyHolder();
  ok("two independent holders (two wizard mounts) get DIFFERENT keys",
    sessionA.getKey() !== sessionB.getKey());
}

{
  // Injected factory + reset(): proves getKey() only calls the factory once until reset(),
  // the exact "generate once, reuse on retry" contract the component depends on.
  let calls = 0;
  const holder = createIdempotencyKeyHolder(() => {
    calls += 1;
    return `fixed-key-${calls}`;
  });
  const k1 = holder.getKey();
  const k2 = holder.getKey();
  ok("factory invoked exactly once across repeated getKey() calls before reset()",
    calls === 1 && k1 === "fixed-key-1" && k2 === "fixed-key-1");
  holder.reset();
  const k3 = holder.getKey();
  ok("reset() allows a genuinely new key on the NEXT explicit reset (not on retry)",
    calls === 2 && k3 === "fixed-key-2" && k3 !== k1);
}

console.log(`\n${passed} passed, ${process.exitCode ? "with failures" : "0 failed"}`);
