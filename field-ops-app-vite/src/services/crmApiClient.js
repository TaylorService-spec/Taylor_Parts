// The browser's ONLY route to CRM business data (Account, Contact, customer site).
//
//   browser -> THIS -> EOS trusted API (POST /crm/customer) -> resolveOperationalContext -> PostgreSQL eos_crm
//
// One business authority. There is no Firestore read or write for CRM records anywhere behind this module and no
// fallback: if the EOS API is not configured, unreachable or refuses, the caller renders that state. Firebase supplies
// the bearer token only; no claim it carries is read as authority.
import { auth } from "../firebase/firebase.js";
import { policyApiBaseUrl } from "./adminPolicyApiClient.js";

export const CRM_ROUTE = "/crm/customer";

export const CRM_OPERATIONS = Object.freeze([
  "createAccount", "updateAccount", "getAccount", "listAccounts",
  "createContact", "updateContact", "getContact", "listAccountContacts",
  "createAccountLocation", "updateAccountLocation", "getAccountLocation", "listAccountLocations",
]);
const KNOWN = new Set(CRM_OPERATIONS);

const failure = (code, message, status = null) => Object.freeze({ ok: false, code, message, status });

/** A random idempotency key for one create attempt. */
export function newIdempotencyKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Call one CRM operation. Returns `{ ok: true, result }` or `{ ok: false, code, message, status }`; never throws for a
 * refusal or a network failure.
 */
export async function callCrmApi(operation, input = {}, options = {}) {
  if (!KNOWN.has(operation)) return failure("UNKNOWN_OPERATION", `"${operation}" is not a CRM operation`);
  const base = options.baseUrl ?? policyApiBaseUrl();
  if (!base) return failure("NOT_CONFIGURED", "no EOS API is configured for this environment (VITE_EOS_API_BASE_URL)");

  let token = null;
  try {
    token = await (options.getIdToken ? options.getIdToken() : auth?.currentUser?.getIdToken?.());
  } catch {
    token = null;
  }
  if (!token) return failure("NOT_SIGNED_IN", "sign in to reach customer records");

  const fetchImpl = options.fetch ?? globalThis.fetch;
  let response;
  try {
    response = await fetchImpl(`${base}${CRM_ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ operation, input }),
      signal: options.signal,
    });
  } catch {
    return failure("UNREACHABLE", "the EOS API could not be reached");
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") return failure("INTERNAL", `the EOS API returned ${response.status}`, response.status);
  if (body.ok === true) return Object.freeze({ ok: true, result: body.result, operation });
  return failure(typeof body.code === "string" ? body.code : "INTERNAL",
    typeof body.message === "string" ? body.message : "the request could not be completed", response.status);
}

/** The same call, for writers whose callers already handle a thrown error. */
export async function requireCrmApi(operation, input) {
  const res = await callCrmApi(operation, input);
  if (!res.ok) {
    const err = new Error(res.message);
    err.code = res.code;
    err.status = res.status;
    throw err;
  }
  return res.result;
}

/** A failed read, as a safe sentence for the screen. */
export function crmReadErrorMessage(res, entity = "customer records") {
  switch (res?.code) {
    case "NOT_CONFIGURED": return `Customer records are unavailable: the EOS service is not configured for this environment.`;
    case "NOT_SIGNED_IN": return `Sign in to view ${entity}.`;
    case "FORBIDDEN":
    case "CAPABILITY_REQUIRED":
    case "ACTOR_NOT_TENANT_MEMBER": return `You do not have permission to view these ${entity}.`;
    case "UNREACHABLE": return `Can't reach the server right now. Check your connection and try again.`;
    default: return `Couldn't load ${entity}. Please try again.`;
  }
}

// ════════════════════ record shapes ════════════════════
//
// The screens were written against the legacy document shapes. These adapters translate the PostgreSQL projections into
// those shapes, and the form payloads into the governed CRM inputs, in ONE place.

export function accountRowFromCrm(a) {
  if (!a) return null;
  return {
    id: a.accountId,
    name: a.name,
    nameLower: typeof a.name === "string" ? a.name.trim().toLowerCase() : null,
    status: a.status,
    notes: a.notes,
    billingAddress: a.billingAddress,
    customerNumber: a.customerNumber,
    erpId: a.erpId,
    accountingId: a.accountingId,
    legacyId: a.legacyId,
    defaultCurrency: a.defaultCurrency,
    purchaseOrderRequired: a.purchaseOrderRequired,
    invoiceDeliveryMethod: a.invoiceDeliveryMethod,
    paymentTerms: a.paymentTerms,
    taxStatus: a.taxStatus,
    billingContact: a.billingContactId ? { contactId: a.billingContactId } : null,
    ownerEmployeeId: a.ownerEmployeeId,
    accountOwner: a.ownerEmployeeId ? { assignedToEmployeeId: a.ownerEmployeeId, source: "EOS_CRM" } : null,
    tags: a.tags ?? [],
    relationshipTypes: a.relationshipTypes ?? [],
    lineOfBusiness: a.lineOfBusiness ?? [],
    createdBy: a.createdBy,
    updatedBy: a.updatedBy,
    createdAt: Date.parse(a.createdAt),
    updatedAt: Date.parse(a.updatedAt),
  };
}

export function contactRowFromCrm(c) {
  if (!c) return null;
  return {
    id: c.contactId, accountId: c.accountId, name: c.name, email: c.email, phone: c.phone, role: c.contactRole,
    isPrimary: c.isPrimary, ownerEmployeeId: c.ownerEmployeeId, createdBy: c.createdBy, updatedBy: c.updatedBy,
    createdAt: Date.parse(c.createdAt), updatedAt: Date.parse(c.updatedAt),
  };
}

export function locationRowFromCrm(l) {
  if (!l) return null;
  return {
    id: l.accountLocationId, accountId: l.accountId, name: l.name,
    address: { street: l.addressStreet ?? "", city: l.addressCity ?? "", state: l.addressState ?? "", zip: l.addressPostalCode ?? "" },
    accessNotes: l.accessNotes, ownerEmployeeId: l.ownerEmployeeId, createdBy: l.createdBy, updatedBy: l.updatedBy,
    createdAt: Date.parse(l.createdAt), updatedAt: Date.parse(l.updatedAt),
  };
}

const ACCOUNT_FIELDS = ["name", "status", "notes", "billingAddress", "customerNumber", "erpId", "accountingId", "legacyId",
  "defaultCurrency", "purchaseOrderRequired", "invoiceDeliveryMethod", "paymentTerms", "taxStatus", "tags", "relationshipTypes", "lineOfBusiness"];

/** The Account form's payload as governed CRM fields. Derived, display and ownership-map fields are not sent. */
export function accountInputFromForm(values = {}) {
  const input = {};
  for (const field of ACCOUNT_FIELDS) if (values[field] !== undefined) input[field] = values[field];
  if (input.billingAddress) {
    const { street = null, city = null, state = null, zip = null } = input.billingAddress;
    input.billingAddress = { street, city, state, zip };
  }
  if (values.billingContact !== undefined) input.billingContactId = values.billingContact?.contactId ?? null;
  return input;
}

/** The owner an Account form states, as an Employee id. */
export const ownerFromForm = (values = {}) => values.ownerEmployeeId ?? values.accountOwner?.assignedToEmployeeId ?? null;

export function contactInputFromForm(values = {}) {
  const input = {};
  for (const [from, to] of [["name", "name"], ["email", "email"], ["phone", "phone"], ["role", "contactRole"], ["isPrimary", "isPrimary"]]) {
    if (values[from] !== undefined) input[to] = values[from];
  }
  return input;
}

export function locationInputFromForm(values = {}) {
  const input = {};
  if (values.name !== undefined) input.name = values.name;
  if (values.accessNotes !== undefined) input.accessNotes = values.accessNotes;
  if (values.address !== undefined) {
    const a = values.address ?? {};
    input.addressStreet = a.street ?? null;
    input.addressCity = a.city ?? null;
    input.addressState = a.state ?? null;
    input.addressPostalCode = a.zip ?? null;
  }
  return input;
}

// ════════════════════ bounded reads ════════════════════

export const CRM_PAGE_LIMIT = 200;

/**
 * Read every page of an Account-scoped list (contacts, customer sites), bounded by `maxItems`. Resolves
 * `{ ok: true, rows, truncated }` or the failure result.
 */
export async function readAllPages(operation, input, mapRow, { maxItems = 1000, call = callCrmApi } = {}) {
  const rows = [];
  let cursor;
  for (;;) {
    const res = await call(operation, { ...input, limit: CRM_PAGE_LIMIT, ...(cursor ? { cursor } : {}) });
    if (!res.ok) return res;
    rows.push(...res.result.items.map(mapRow));
    cursor = res.result.nextCursor;
    if (!cursor) return { ok: true, rows, truncated: false };
    if (rows.length >= maxItems) return { ok: true, rows, truncated: true };
  }
}
