// THE GOVERNED EMPLOYEE NAME DIRECTORY (UI corrections integration readiness, 2026-10-08) -- the EOS replacement for the
// Firestore `employees` listener (hooks/useEmployeeDirectory.js) on the Opportunity, Sales Order, Sales Agreement and Account
// pages. Same result shape, so name resolution at every call site is unchanged:
//
//   byEmployeeId  Map<employeeId, { id, employeeId, displayName, employmentStatus, operatingCompanyId }>
//                 from EMP-RT-01 listEmployees -- the governed PostgreSQL Employee directory. The SERVER applies
//                 employee.record.read and operating-company reach: an Employee outside the caller's reach is simply absent
//                 (and renders as unresolved, exactly like before), and every employment status is listed, so a historical
//                 owner who has since left still resolves by name.
//   byUserId      Map<principalId, { id, displayName }> -- the ACTING Principal recorded on EOS records (created_by /
//                 updated_by are EOS Principal ids), from the Administration read listTenantPrincipals, which the server gates
//                 on admin.principalAccess.read (the same audience the Firestore directory had: administrators). Asked ONLY
//                 when `actors: true`; a refusal leaves it empty and the actor renders as "Unknown user".
//   loading / error
//
// One read per session window, shared by every section on a page (a page composes several sections), re-read after
// CACHE_MS. No Firebase. No Principal-to-Employee link is exposed (that read stays admin.principalAccess.read, Owner ruling B).
import { useEffect, useState } from "react";
import { workforceApiClient } from "../services/workforceApiClient.js";
import { callPolicyApi } from "../services/adminPolicyApiClient.js";

export { resolveActorDisplayName, UNKNOWN_ACTOR_DISPLAY_NAME } from "../domain/actorDisplayName";

const PAGE = 200;
const MAX_PAGES = 25; // 5,000 employees; a tenant beyond that reports `truncated`
const CACHE_MS = 60_000;
const cache = new Map(); // key -> { at, promise }

async function readEmployees(client) {
  const byEmployeeId = new Map();
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await client.call("listEmployees", { limit: PAGE, ...(cursor ? { cursor } : {}) });
    if (!res?.ok) return { byEmployeeId: new Map(), error: res ?? { ok: false, code: "INTERNAL" }, truncated: false };
    for (const e of res.result?.items ?? []) {
      byEmployeeId.set(e.employeeId, { id: e.employeeId, employeeId: e.employeeId, displayName: e.displayName ?? null,
        employmentStatus: e.employmentStatus ?? null, operatingCompanyId: e.operatingCompanyId ?? null });
    }
    cursor = res.result?.nextCursor ?? null;
    if (!cursor) return { byEmployeeId, error: null, truncated: false };
  }
  return { byEmployeeId, error: null, truncated: true };
}

async function readActors(policyCall) {
  const res = await policyCall("listTenantPrincipals", {});
  const rows = res?.ok ? res.data ?? res.result ?? [] : Array.isArray(res) ? res : [];
  const byUserId = new Map();
  for (const p of Array.isArray(rows) ? rows : []) {
    if (p?.id) byUserId.set(p.id, { id: p.id, displayName: p.displayName ?? null });
  }
  return byUserId;
}

function load(key, client, policyCall, actors) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = Promise.all([readEmployees(client), actors ? readActors(policyCall).catch(() => new Map()) : Promise.resolve(new Map())])
    .then(([employees, byUserId]) => ({ ...employees, byUserId }));
  cache.set(key, { at: Date.now(), promise });
  promise.then((r) => { if (r.error) cache.delete(key); });
  return promise;
}

/** Test seam: forget the shared read. */
export function resetGovernedEmployeeDirectory() { cache.clear(); }

export function useGovernedEmployeeDirectory({ enabled = true, actors = false, client = workforceApiClient, policyCall = callPolicyApi } = {}) {
  const [state, setState] = useState({ byEmployeeId: new Map(), byUserId: new Map(), loading: enabled, error: null, truncated: false });
  useEffect(() => {
    if (!enabled) { setState({ byEmployeeId: new Map(), byUserId: new Map(), loading: false, error: null, truncated: false }); return undefined; }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    const key = `${actors ? "a" : "e"}`;
    load(client === workforceApiClient && policyCall === callPolicyApi ? key : `${key}:${Math.random()}`, client, policyCall, actors).then((r) => {
      if (!alive) return;
      setState({ byEmployeeId: r.byEmployeeId, byUserId: r.byUserId, loading: false, error: r.error, truncated: r.truncated });
    });
    return () => { alive = false; };
  }, [enabled, actors, client, policyCall]);
  return state;
}
