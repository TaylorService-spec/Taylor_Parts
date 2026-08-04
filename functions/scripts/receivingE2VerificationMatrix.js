"use strict";

// EI Phase-2 Receiving -- Gate E2-V production-verification matrix. Pure data + helpers (no I/O, no
// self-execution): the exact two callables, the region, the receiving_orders client-denial cases, and the
// callable unauthenticated-denial cases the verifier core drives. Consumed by
// verifyReceivingE2Deployment.js (core) and receivingE2VerifierCli.js (operator). Nothing here deploys,
// invokes, or accesses production. E2 verification is deliberately NEGATIVE-only (discovery + denial +
// receiving_orders-unchanged); it NEVER executes a receipt.

// The exact two trusted callables (functions/src/index.ts export aliases), in deploy-allowlist order.
const CALLABLES = Object.freeze(["receiveInventoryStock", "listReceivingLocationOptions"]);
const REGION = "us-central1";

// receiving_orders is deny-all (firestore.rules: allow read,create,update,delete: if false). EVERY client
// access -- read or write, unauthenticated OR authenticated (any role, including admin) -- must be denied
// with HTTP 403. `e2probe` is a doc id that is never created (all attempts are denied, so zero writes).
const RECEIVING_ORDERS_DOC = "receiving_orders/e2probe";
const RULES_DENIAL_CASES = Object.freeze([
  { label: "rules:unauth:read", principal: "unauthenticated", method: "GET", expectedStatus: 403 },
  { label: "rules:unauth:write", principal: "unauthenticated", method: "PATCH", expectedStatus: 403 },
  { label: "rules:auth:read", principal: "authenticated", method: "GET", expectedStatus: 403 },
  { label: "rules:auth:write", principal: "authenticated", method: "PATCH", expectedStatus: 403 },
]);

// Each callable must reject an UNAUTHENTICATED caller (auth is the first guard, before any read/write), so
// a well-formed-envelope call with no token returns the callable-protocol UNAUTHENTICATED error. Proves
// deployed + enforcing with zero writes and no receipt.
const CALLABLE_DENIAL_CASES = Object.freeze(
  CALLABLES.map((callable) => ({ label: `callable:unauth:${callable}`, callable, expectedCode: "UNAUTHENTICATED" })),
);

// The authorized deployment delta: EXACTLY the two receiving callables added @ region, with EVERY
// pre-existing function unchanged and NOTHING removed. Proven by comparing a hash-bound complete pre-deploy
// Functions inventory against the complete post-deploy inventory (unfiltered) -- not by name-filtered
// presence, so an unexpected/changed/removed function halts the gate.
const EXPECTED_DEPLOY_ADDED = Object.freeze(CALLABLES.map((name) => ({ name, region: REGION })));

// Total governed assertions: 2 discovery + 1 deployment-delta + 4 rules-denial + 2 callable-denial
// + 1 receiving_orders-unchanged.
const MATRIX_TOTAL = CALLABLES.length + 1 + RULES_DENIAL_CASES.length + CALLABLE_DENIAL_CASES.length + 1;

function buildCrosswalk() {
  return {
    region: REGION,
    callables: [...CALLABLES],
    discovery: CALLABLES.map((name) => ({ label: `discovery:${name}`, requires: `present@${REGION}` })),
    deploymentDelta: { label: "deployment:exact-delta", requires: `+${CALLABLES.join(",")} @ ${REGION}; all pre-existing functions unchanged; none removed` },
    rulesDenial: RULES_DENIAL_CASES.map((r) => ({ label: r.label, expectedStatus: r.expectedStatus })),
    callableDenial: CALLABLE_DENIAL_CASES.map((r) => ({ label: r.label, expectedCode: r.expectedCode })),
    receivingOrdersUnchanged: { label: "receiving_orders:unchanged", requires: "identity-set + count unchanged vs pre-probe baseline" },
    matrix_total: MATRIX_TOTAL,
  };
}

module.exports = {
  CALLABLES,
  REGION,
  RECEIVING_ORDERS_DOC,
  RULES_DENIAL_CASES,
  CALLABLE_DENIAL_CASES,
  EXPECTED_DEPLOY_ADDED,
  MATRIX_TOTAL,
  buildCrosswalk,
};
