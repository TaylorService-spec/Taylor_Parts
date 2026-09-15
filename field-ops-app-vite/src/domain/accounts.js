import { isWriteBlocked } from "../config/env";
import { accountInputFromForm, accountRowFromCrm, newIdempotencyKey, ownerFromForm, requireCrmApi } from "../services/crmApiClient.js";

// Customer (Account) writers. Internal naming is "Account"; the UI says "Customer".
//
// CRM CUTOVER. Account writes go to the governed PostgreSQL CRM authority through the EOS API (POST /crm/customer).
// There is no Firestore write here any more and no fallback: a refusal (owner required, missing capability,
// governed field, not configured) is thrown to the form, which already renders a thrown save error.

/** Create an Account. The owner is REQUIRED and explicit (the form's owner assignment); it is never the signed-in user. */
export async function createAccount(data) {
  if (isWriteBlocked()) return { blocked: true };
  const result = await requireCrmApi("createAccount", {
    idempotencyKey: newIdempotencyKey(),
    ownerEmployeeId: ownerFromForm(data),
    ...accountInputFromForm(data),
  });
  return accountRowFromCrm(result);
}

/**
 * Update an Account's governed business fields, including its owner.
 *
 * OWNERSHIP follows the governed PostgreSQL rule (eosCrm/accountAuthority.ts), never a client rule: a stated owner that
 * differs from the current one is sent as `ownerEmployeeId`, and the SERVER records it as an OWNER_HANDOFF (or the
 * INITIAL_OWNER_ASSIGNMENT of a legacy ownerless Account) in the same transaction, with the Principal as actor. The
 * owner the form was loaded with is sent as `expectedCurrentOwnerEmployeeId`, so a stale form is refused
 * (ACCOUNT_OWNER_CHANGED_SINCE_READ) rather than turning an intended first assignment into a handoff. Clearing the
 * owner is refused by the server (OWNER_REQUIRED).
 */
export async function updateAccount(id, data) {
  if (isWriteBlocked()) return { blocked: true };
  const input = accountInputFromForm(data);
  const statedOwner = ownerFromForm(data);
  if (statedOwner !== null) {
    const current = await requireCrmApi("getAccount", { accountId: id });
    if (current.ownerEmployeeId !== statedOwner) {
      input.ownerEmployeeId = statedOwner;
      input.expectedCurrentOwnerEmployeeId = current.ownerEmployeeId ?? null;
    }
  }
  if (Object.keys(input).length === 0) return { id };
  return accountRowFromCrm(await requireCrmApi("updateAccount", { accountId: id, ...input }));
}
