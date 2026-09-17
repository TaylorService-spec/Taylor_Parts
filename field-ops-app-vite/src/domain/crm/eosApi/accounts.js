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
 * `ownershipChange.previousOwnerEmployeeId` is the owner the edit was OPENED with. It is sent as the precondition
 * `expectedCurrentOwnerEmployeeId` with every owner change; the server compares it with the locked current owner and
 * refuses the whole command with 412 ACCOUNT_OWNER_CHANGED_SINCE_READ if they differ. No pre-read is made here: the
 * server check is the authority. An owner named WITHOUT the edit's starting owner is refused (OWNER_CHANGE_UNSTATED)
 * rather than guessed. Business fields and the owner go in ONE updateAccount call: one transaction, one result.
 */
export async function updateAccount(id, data) {
  if (isWriteBlocked()) return { blocked: true };
  const stated = data?.ownershipChange;
  let ownerInput = {};
  if (stated && "previousOwnerEmployeeId" in stated) {
    const change = accountOwnerChange({
      previousOwnerEmployeeId: stated.previousOwnerEmployeeId,
      nextOwnerEmployeeId: ownerFromForm(data),
      source: stated.source ?? null,
      reason: stated.reason ?? null,
    });
    if (change.kind === ACCOUNT_OWNER_CHANGE.CLEAR_REFUSED) {
      throw Object.assign(new Error("an Account requires an explicit owner: an Employee of this tenant. Hand the customer off to another owner instead of clearing it"),
        { code: "OWNER_REQUIRED", status: 400 });
    }
    ownerInput = change.input ?? {};
  } else if (data && (data.accountOwner !== undefined || data.ownerEmployeeId !== undefined)) {
    throw Object.assign(new Error("an owner change must state the owner the edit started from (ownershipChange.previousOwnerEmployeeId)"),
      { code: "OWNER_CHANGE_UNSTATED", status: 400 });
  }
  const input = { ...accountInputFromForm(data), ...ownerInput };
  if (Object.keys(input).length === 0) return { id };
  return accountRowFromCrm(await requireCrmApi("updateAccount", { accountId: id, ...input }));
}
