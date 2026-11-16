// THE ONE GATE FOR "MAY THIS SESSION ASK THE SERVER THIS OPERATION?" (Access map, Option A piece 1).
//
// The server decides every operation inside its command. This file answers the same question in the browser BEFORE a request is made, from the
// generated map of what the server requires (access/operationAccess.generated.js, built from the commands' own constants and proven against
// them). A page that asks only what it may be told never takes a background 403; a refusal the server still returns (company reach, record
// assignment) is a real answer the page renders, not a request that was certain to fail.
//
// A decision is THREE-VALUED, because the page must tell its states apart:
//   true   the session holds what the server requires (or EOS is not the session source: the legacy behaviour is unchanged) -- ask.
//   false  the session answer has arrived and does not hold it -- do not ask; STATE the absence (denied), never "empty" or "try again".
//   null   the session answer has not arrived -- do not ask yet; the page is LOADING.
//
// This gate reads; it grants nothing. A true is not an authorization -- the server re-decides every call.
import { OPERATION_ACCESS } from "./operationAccess.generated.js";
import { useSessionAccess } from "./sessionAccess.js";

/** The server's requirement for an operation. An operation that is not in the map is a programming error, never "allowed". */
export function operationRequirement(operation) {
  const row = OPERATION_ACCESS[operation];
  if (!row) throw new Error(`operation "${operation}" is not in the access map (field-ops-app-vite/src/access/operationAccess.generated.js)`);
  return row;
}

const holdsRequirement = (access, row) => {
  if (row.surface) return typeof access.grantsSurface === "function" && access.grantsSurface(row.surface) === true;
  return row.allOf.every((key) => access.holds(key) === true) && (!row.anyOf || row.anyOf.some((key) => access.holds(key) === true));
};

/** Pure, for tests and hooks: true | false | null for one operation and one session-access value. */
export function operationDecision(access, operation) {
  const row = operationRequirement(operation);
  if (!access?.eosSource) return true;
  if (holdsRequirement(access, row)) return true;
  return access.settled === true ? false : null;
}

/** true only on a positive answer -- loading and denied both read false. For callers that only need "may I ask now". */
export const operationAllowed = (access, operation) => operationDecision(access, operation) === true;

/** The decision for several operations that must ALL be askable (a hook that fires more than one read): false wins over null wins over true. */
export function operationsDecision(access, operations) {
  const decisions = operations.map((operation) => operationDecision(access, operation));
  if (decisions.includes(false)) return false;
  return decisions.includes(null) ? null : true;
}

/** `decide(...operations)` for the signed-in session: the one call a page makes for each read (or group of reads that fire together) it may fire. */
export function useOperationGate() {
  const access = useSessionAccess();
  return (...operations) => operationsDecision(access, operations);
}
