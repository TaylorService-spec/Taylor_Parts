// EOS API (PostgreSQL CRM) implementation. Selected by src/domain/accounts.js ONLY when CRM_VIA_EOS_API
// (domain/crmAuthorityRoute.js -- platform-sandbox builds); every other build uses the legacy Firestore implementation
// that stays in src/domain/accounts.js. Imports no Firebase SDK and no Firestore helper; never falls back.
//
import { isWriteBlocked } from "../../../config/env";
import { accountInputFromForm, accountRowFromCrm, newIdempotencyKey, ownerFromForm, requireCrmApi } from "../../../services/crmApiClient.js";
import { ACCOUNT_OWNER_CHANGE, accountOwnerChange } from "../../accountOwnershipChange.js";

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
 * Update an Account's governed business fields and, when the form names a different owner, its owner.
 *
 * OWNER CHANGES (domain/accountOwnershipChange.js mirrors the server authority):
 *   * owned -> different owner   OWNER_HANDOFF with the form's handoff source (default DIRECT_HANDOFF) and optional reason;
 *   * ownerless -> owner         INITIAL_OWNER_ASSIGNMENT: never a source, optional reason;
 *   * owned -> no owner          refused HERE with OWNER_REQUIRED before anything is sent (the server refuses it too).
 * The previous owner is the one the form was opened with (`ownershipChange.previousOwnerEmployeeId`); when a caller does
 * not state it, the Account is read first. The server re-reads the owner under lock and records the event itself.
 * Business fields and the owner go in ONE updateAccount call: one transaction, one result.
 */
export async function updateAccount(id, data) {
  if (isWriteBlocked()) return { blocked: true };
  const stated = data?.ownershipChange;
  const previousOwnerEmployeeId = stated && "previousOwnerEmployeeId" in stated
    ? stated.previousOwnerEmployeeId
    : (await requireCrmApi("getAccount", { accountId: id })).ownerEmployeeId;
  const change = accountOwnerChange({
    previousOwnerEmployeeId,
    nextOwnerEmployeeId: ownerFromForm(data),
    source: stated?.source ?? null,
    reason: stated?.reason ?? null,
  });
  if (change.kind === ACCOUNT_OWNER_CHANGE.CLEAR_REFUSED) {
    const err = new Error("an Account requires an explicit owner: an Employee of this tenant. Hand the customer off to another owner instead of clearing it");
    err.code = "OWNER_REQUIRED";
    err.status = 400;
    throw err;
  }
  const input = { ...accountInputFromForm(data), ...(change.input ?? {}) };
  if (Object.keys(input).length === 0) return { id };
  return accountRowFromCrm(await requireCrmApi("updateAccount", { accountId: id, ...input }));
}
