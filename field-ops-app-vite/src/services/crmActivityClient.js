// CRM Activity / Notes -- the EOS transport (Firebase exit F7b, DECISIONS #243).
//
//   browser -> services/crmApiClient.js -> POST /crm/customer (listAccountActivities / createAccountActivity) -> eos_crm.activities
//
// Replaces the getCrmActivities / createCrmActivity callable client, keeping its contract so the hooks and the Activity &
// Notes section are unchanged: each method returns { result } (the server's { status, activities } list or
// { success, replayed, activityId } answer) or { errorStatus }. No Firebase fallback. Never throws.
//
// The server decides: the list needs crm.activity.read AND the Account's own read (customer.record.read); create needs
// crm.activity.create. A refusal is DENIED, every other failure UNAVAILABLE -- never "this account has no activity".
import { CRM_ACTIVITY_VIEW_STATE } from "../domain/crmActivityView.js";

// LAZY, like the callable client it replaces: crmApiClient reaches adminPolicyApiClient, whose import initializes Firebase.
const call = async (operation, input) => {
  try {
    return await (await import("./crmApiClient.js")).callCrmApi(operation, input);
  } catch {
    return { ok: false, code: "UNREACHABLE" };
  }
};

/** A refusal is DENIED (the same rule the callable's permission-denied followed); anything else is UNAVAILABLE. */
const readStatus = (res) => (res.code === "FORBIDDEN" || res.code === "CAPABILITY_REQUIRED" || res.status === 403
  ? CRM_ACTIVITY_VIEW_STATE.DENIED : CRM_ACTIVITY_VIEW_STATE.UNAVAILABLE);

// A write refusal in the callable's own vocabulary, which useCrmActivityActions passes through as `errorStatus`.
const WRITE_STATUS_BY_STATUS = Object.freeze({ 400: "invalid-argument", 403: "permission-denied", 404: "not-found", 409: "aborted" });

export async function fetchCrmActivities(accountId, limit = 100) {
  const res = await call("listAccountActivities", { accountId, limit });
  return res.ok ? { result: res.result } : { errorStatus: readStatus(res) };
}

export async function createCrmActivity({ accountId, contactId, opportunityId, salesOrderId, type, body, occurredAtMillis, idempotencyKey }) {
  const input = { accountId, type, body, idempotencyKey };
  // Only what was stated is sent: an absent reference is absent, not an empty id.
  for (const [k, v] of Object.entries({ contactId, opportunityId, salesOrderId, occurredAtMillis })) if (v !== undefined && v !== null && v !== "") input[k] = v;
  const res = await call("createAccountActivity", input);
  return res.ok ? { result: res.result } : { errorStatus: WRITE_STATUS_BY_STATUS[res.status] ?? "internal" };
}

export const crmActivityClient = Object.freeze({ fetchCrmActivities, createCrmActivity });
