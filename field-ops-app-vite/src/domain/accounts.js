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
 * Update an Account's governed business fields. Changing the owner is not available (ACCOUNT_OWNER_HANDOFF_PENDING):
 * an edit that states a different owner is refused rather than silently saved without it.
 */
export async function updateAccount(id, data) {
  if (isWriteBlocked()) return { blocked: true };
  const statedOwner = ownerFromForm(data);
  if (statedOwner !== null) {
    const current = await requireCrmApi("getAccount", { accountId: id });
    if (current.ownerEmployeeId !== statedOwner) {
      const err = new Error("Changing a customer's owner is not available yet.");
      err.code = "ACCOUNT_OWNER_HANDOFF_PENDING";
      throw err;
    }
  }
  const input = accountInputFromForm(data);
  if (Object.keys(input).length === 0) return { id };
  return accountRowFromCrm(await requireCrmApi("updateAccount", { accountId: id, ...input }));
}
