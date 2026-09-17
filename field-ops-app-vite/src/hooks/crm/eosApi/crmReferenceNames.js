// EOS API (PostgreSQL CRM) implementation of the batched Account / customer-site NAME reads. Selected -- by a top-level
// build-time ternary on CRM_VIA_EOS_API (domain/crmAuthorityRoute.js, platform-sandbox builds only) -- by:
//   hooks/useAccountNames.js              readAccountNameMap
//   hooks/useLocationReferenceResolver.js readLocationNameMap
//   hooks/useInstalledEquipmentPage.js    defaultReadNames
// Every other build keeps those modules' legacy Firestore `documentId() in` reads. Imports no Firebase SDK; never
// falls back.
//
// Each function has the SAME contract as the Firestore read it stands in for:
//   * resolves Map<id, name> for the ids that exist and carry a name (a confirmed absence is simply not in the map);
//   * a refusal THROWS an error whose `code` is "permission-denied", so callers keep DENIED distinct from ERROR;
//   * any other failure THROWS with the CRM refusal code, and the caller discards the partial map.
import { callCrmApi } from "../../../services/crmApiClient.js";
import { ACCOUNTS_COLLECTION, LOCATIONS_COLLECTION } from "../../../domain/constants";

const DENIED_CODES = /* @__PURE__ */ Object.freeze(["CAPABILITY_REQUIRED", "FORBIDDEN", "ACTOR_NOT_TENANT_MEMBER"]);

const ACCOUNT = /* @__PURE__ */ Object.freeze({ operation: "getAccount", idField: "accountId", notFound: "ACCOUNT_NOT_FOUND" });
const CUSTOMER_SITE = /* @__PURE__ */ Object.freeze({ operation: "getAccountLocation", idField: "accountLocationId", notFound: "ACCOUNT_LOCATION_NOT_FOUND" });

const nameOf = (record) => (typeof record?.name === "string" && record.name ? record.name : null);

async function readNames(spec, ids, batchSize, pickName, call) {
  const map = new Map();
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((id) => call(spec.operation, { [spec.idField]: id })));
    results.forEach((res, n) => {
      if (res.ok) {
        const name = res.result ? pickName(res.result) : null;
        if (name) map.set(batch[n], name);
        return;
      }
      if (res.code === spec.notFound || res.code === "RECORD_ID_REQUIRED") return;
      throw Object.assign(new Error(res.message), { code: DENIED_CODES.includes(res.code) ? "permission-denied" : res.code });
    });
  }
  return map;
}

/** Account ids -> Map<accountId, name>. */
export function readAccountNameMap(ids, { call = callCrmApi } = {}) {
  return readNames(ACCOUNT, ids, 10, nameOf, call);
}

/** Customer-site ids -> Map<accountLocationId, name>, named by the caller's picker (pickLocationName). */
export function readLocationNameMap(ids, pickName = nameOf, { call = callCrmApi } = {}) {
  return readNames(CUSTOMER_SITE, ids, 10, pickName, call);
}

/** useInstalledEquipmentPage's `readNames` seam. Only the two CRM collections are served; anything else is refused. */
export function readEquipmentReferenceNames({ collectionName, ids }, { call = callCrmApi } = {}) {
  if (collectionName === ACCOUNTS_COLLECTION) return readNames(ACCOUNT, ids, 10, nameOf, call);
  if (collectionName === LOCATIONS_COLLECTION) return readNames(CUSTOMER_SITE, ids, 10, nameOf, call);
  return Promise.reject(Object.assign(new Error(`${String(collectionName)} names are not served by the CRM`), { code: "unsupported" }));
}
