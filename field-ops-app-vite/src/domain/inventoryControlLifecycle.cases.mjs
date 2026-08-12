// CANONICAL decision-table for the two-condition inventory-control projection. This is the
// SINGLE source of parity truth: the client authority
// (field-ops-app-vite/src/domain/inventoryControlLifecycle.js) and the trusted-read mirror
// (functions/src/fulfillment/inventoryControlLifecycle.ts) are each tested against THIS table,
// so a divergence in either mirror fails a test. Every row also documents which required proof
// (Ventana spec §4 / task step 8) it establishes.

export const CANONICAL_CASES = Object.freeze([
  // Happy-path waypoints — the lifecycle progresses but control does NOT exit until BOTH.
  {
    name: "received (control began), nothing else ⇒ CONTROLLED (both unmet)",
    input: { controlBegan: true, installationComplete: false, saleClosed: false },
    expect: { state: "CONTROLLED", unmet: ["INSTALLATION_INCOMPLETE", "SALE_OPEN"] },
  },
  {
    name: "allocation is NOT an exit — allocated but not installed/closed ⇒ CONTROLLED",
    input: { controlBegan: true, installationComplete: false, saleClosed: false, context: { allocated: true } },
    expect: { state: "CONTROLLED", unmet: ["INSTALLATION_INCOMPLETE", "SALE_OPEN"] },
  },
  {
    name: "delivery is NOT an exit — delivered but not installed/closed ⇒ CONTROLLED",
    input: { controlBegan: true, installationComplete: false, saleClosed: false, context: { allocated: true, delivered: true } },
    expect: { state: "CONTROLLED", unmet: ["INSTALLATION_INCOMPLETE", "SALE_OPEN"] },
  },
  {
    name: "invoicing is NOT an exit — invoiced but conditions unmet ⇒ CONTROLLED",
    input: { controlBegan: true, installationComplete: false, saleClosed: true, context: { invoiced: true } },
    expect: { state: "CONTROLLED", unmet: ["INSTALLATION_INCOMPLETE"] },
  },
  // The two legible partial states.
  {
    name: "installed + sale OPEN ⇒ CONTROLLED (sale open)",
    input: { controlBegan: true, installationComplete: true, saleClosed: false },
    expect: { state: "CONTROLLED", unmet: ["SALE_OPEN"] },
  },
  {
    name: "sale CLOSED + not installed ⇒ CONTROLLED (installation incomplete)",
    input: { controlBegan: true, installationComplete: false, saleClosed: true },
    expect: { state: "CONTROLLED", unmet: ["INSTALLATION_INCOMPLETE"] },
  },
  // The ONLY exit: both conditions met.
  {
    name: "installed AND sale closed ⇒ EXITED",
    input: { controlBegan: true, installationComplete: true, saleClosed: true, context: { allocated: true, delivered: true, invoiced: true } },
    expect: { state: "EXITED", unmet: [] },
  },
  // Drop-ship / no receipt into Taylor control.
  {
    name: "no receipt into Taylor control ⇒ NOT_STARTED (drop-ship)",
    input: { controlBegan: false, installationComplete: false, saleClosed: false },
    expect: { state: "NOT_STARTED", unmet: [] },
  },
  {
    name: "drop-ship then later installed/closed elsewhere still ⇒ NOT_STARTED",
    input: { controlBegan: false, installationComplete: true, saleClosed: true },
    expect: { state: "NOT_STARTED", unmet: [] },
  },
  // Fail-closed on unknown signals — never assume false.
  {
    name: "unknown controlBegan ⇒ UNKNOWN",
    input: { controlBegan: null, installationComplete: true, saleClosed: true },
    expect: { state: "UNKNOWN", unmet: [] },
  },
  {
    name: "control began but unknown install signal ⇒ UNKNOWN (not a fabricated exit)",
    input: { controlBegan: true, installationComplete: null, saleClosed: true },
    expect: { state: "UNKNOWN", unmet: [] },
  },
  {
    name: "control began but unknown sale signal ⇒ UNKNOWN",
    input: { controlBegan: true, installationComplete: true, saleClosed: undefined },
    expect: { state: "UNKNOWN", unmet: [] },
  },
  // Malformed-call parity (both mirrors must FAIL CLOSED, never throw).
  {
    name: "null argument ⇒ UNKNOWN (never throws)",
    input: null,
    expect: { state: "UNKNOWN", unmet: [] },
  },
  {
    name: "null context with both conditions met ⇒ EXITED (context is display-only)",
    input: { controlBegan: true, installationComplete: true, saleClosed: true, context: null },
    expect: { state: "EXITED", unmet: [] },
  },
]);
