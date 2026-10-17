// Return intake -- the EOS transport (Firebase exit F7a, DECISIONS #242).
//
// WAS a thin httpsCallable over the Firebase `recordReturnIntake`. The authority is now EOS Core:
// POST /operations/inventory -- `recordReturnIntake` (eosOps/returnIntake.ts) and `listReturnIntakeOptions`, the caller's
// operating companies and the receiving warehouses each allows. The server decides everything: inventory.returns.intake,
// the company check (#237), the warehouse reach, idempotency, and #118 (no ledger movement). No Firebase fallback; a refusal
// is thrown as the platform's answer (EosOperationError: a transport `code` plus the server's own `details.code`).
import { EOS_OPERATIONS_ROUTES, eosOperationOrThrow } from "./eosOperationsClient.js";

export const RETURN_OPERATIONS = Object.freeze({
  intake: "recordReturnIntake",
  options: "listReturnIntakeOptions",
});

const call = (operation, input) =>
  eosOperationOrThrow(EOS_OPERATIONS_ROUTES.INVENTORY, operation, input, { serviceLabel: "the returns service" });

export const returnCommandClient = Object.freeze({
  recordReturnIntake: (request) => call(RETURN_OPERATIONS.intake, request),
  listReturnIntakeOptions: () => call(RETURN_OPERATIONS.options, {}),
});
