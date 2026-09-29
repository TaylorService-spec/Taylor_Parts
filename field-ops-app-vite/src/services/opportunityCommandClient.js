// Opportunity commands -- over the governed PostgreSQL Commercial transport (Pass 11 Retail Sales journey).
//
// createOpportunity / transitionOpportunity / closeOpportunityAsWon / updateOpportunity were Firebase callables. They are
// now POST /commercial/sales commands (functions/src/eosCommercial/commands/opportunityCommandService.ts): one
// transaction each, the caller's governed capability, the governed ownership handoff for an owner change, the edit
// version check, idempotent on the caller's key. The input fields are the same pure builders' (opportunityCommands.ts)
// as before, except the concurrency token: `expectedEditVersion`, the edit_version the screen read.
//
// Never throws. `{ result }` or `{ errorStatus, errorDetail }` in the error vocabulary the screens already render
// ("aborted" = the record changed since it was read; "failed-precondition" = not allowed in its current state).
import { commercialApiClient } from "./commercialApiClient.js";
import { legacyErrorStatus } from "./commercialEosAdapters.js";

// `errorDetail` is the server's GOVERNED REFUSAL CODE (VERSION_CONFLICT, CLOSED, NO_CHANGES, ...), the same contract the
// callable-era `details` carried and domain/opportunityCommandOutcome.js keys its specific messages on -- never the
// server's human message, which would match none of them and turn a version conflict into a generic failure.
async function run(operation, input, client) {
  const answer = await client.call(operation, { input });
  if (answer.ok) return { result: answer.result };
  return { errorStatus: legacyErrorStatus(answer), errorDetail: typeof answer.reason === "string" && answer.reason ? answer.reason : null };
}

const present = (entries) => Object.fromEntries(Object.entries(entries).filter(([, v]) => v !== undefined));

export async function createOpportunity(input, { client = commercialApiClient } = {}) {
  return run("createOpportunity", input, client);
}

export async function transitionOpportunity({ opportunityId, toStage, outcome, idempotencyKey }, { client = commercialApiClient } = {}) {
  return run("transitionOpportunity", present({ opportunityId, idempotencyKey, toStage, outcome }), client);
}

export async function closeOpportunityAsWon(
  { opportunityId, ownerEmployeeId, salesChannel, locationId, customerPO, idempotencyKey },
  { client = commercialApiClient } = {},
) {
  return run("closeOpportunityAsWon", present({ opportunityId, ownerEmployeeId, salesChannel, idempotencyKey, locationId, customerPO }), client);
}

export async function updateOpportunity(
  { opportunityId, expectedEditVersion, idempotencyKey, accountId, ownerEmployeeId, salesChannel, need, expectedValue, expectedCloseAt, nextAction, lines },
  { client = commercialApiClient } = {},
) {
  return run("updateOpportunity", present({
    opportunityId, expectedEditVersion, idempotencyKey, accountId, ownerEmployeeId, salesChannel, need, expectedValue, expectedCloseAt, nextAction, lines,
  }), client);
}

export const opportunityCommandClient = Object.freeze({
  createOpportunity,
  transitionOpportunity,
  closeOpportunityAsWon,
  updateOpportunity,
});
