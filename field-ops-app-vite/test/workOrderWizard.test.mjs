import {
  WIZARD_STEPS,
  WIZARD_STEP_COUNT,
  getWizardCreateErrorMessage,
  stepBlockedReason,
  canAdvance,
  CREATE_UNAVAILABLE_MESSAGE,
  CREATE_FAILED_MESSAGE,
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

// ----- getWizardCreateErrorMessage: unavailable (A) vs failed (B) -----
ok("unavailable code -> service-not-available message",
  getWizardCreateErrorMessage({ code: "functions/not-found" }) === CREATE_UNAVAILABLE_MESSAGE);
ok("unavailable (functions/unavailable) -> service-not-available message",
  getWizardCreateErrorMessage({ code: "functions/unavailable" }) === CREATE_UNAVAILABLE_MESSAGE);
ok("rejected call with safe message -> failed + appended detail",
  getWizardCreateErrorMessage({ code: "functions/invalid-argument", message: "customerId is required." })
    === `${CREATE_FAILED_MESSAGE} customerId is required.`);
ok("rejected call without a message -> plain failed message",
  getWizardCreateErrorMessage({ code: "functions/internal" }) === CREATE_FAILED_MESSAGE);
ok("blank/whitespace message is not appended",
  getWizardCreateErrorMessage({ code: "functions/internal", message: "   " }) === CREATE_FAILED_MESSAGE);
ok("null error is handled -> plain failed message",
  getWizardCreateErrorMessage(null) === CREATE_FAILED_MESSAGE);
ok("unavailable code takes precedence even if a message is present",
  getWizardCreateErrorMessage({ code: "functions/unavailable", message: "ignored" }) === CREATE_UNAVAILABLE_MESSAGE);

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

console.log(`\n${passed} passed, ${process.exitCode ? "with failures" : "0 failed"}`);
