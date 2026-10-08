// THE GOVERNED EMPLOYEE NAME DIRECTORY (UI corrections integration readiness, 2026-10-08) -- the EOS replacement for the
// Firestore `employees` listener (hooks/useEmployeeDirectory.js) on the Opportunity, Sales Order, Sales Agreement and Account
// pages. Same result shape, so name resolution at every call site is unchanged:
//
//   byEmployeeId  Map<employeeId, { id, employeeId, displayName, employmentStatus, operatingCompanyId }>
//                 from EMP-RT-01 listEmployees -- the governed PostgreSQL Employee directory. The SERVER applies
//                 employee.record.read and operating-company reach: an Employee outside the caller's reach is simply absent
//                 (and renders as unresolved, exactly like before), and every employment status is listed, so a historical
//                 owner who has since left still resolves by name.
//   byUserId      Map<principalId, { id, displayName }> -- the ACTING Principals recorded on EOS records (created_by /
//                 accepted_by are EOS Principal ids), named by the governed, minimally scoped resolvePrincipalDisplayNames
//                 read (/operations/workspace): ONLY the keys passed in `actorIds` (EOS Principal ids) / `actorSubjects` (the
//                 external subject a record written outside EOS stores) -- which the page took from records it was
//                 allowed to read -- display names only, for Principals of the caller's tenant, to any caller who reads the
//                 record kinds that show actors. No Principal administration access is needed or granted. A refusal leaves
//                 it empty and the actor renders as "Unknown user".
//   loading / error
//
// One read per session window, shared by every section on a page (a page composes several sections), re-read after
// CACHE_MS. No Firebase. No Principal-to-Employee link is exposed (that read stays admin.principalAccess.read, Owner ruling B).
import { useEffect, useState } from "react";
import { workforceApiClient } from "../services/workforceApiClient.js";
import { callWorkspaceApi } from "../services/workspaceApiClient.js";

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

async function readActors(call, principalIds, actorSubjects) {
  const byUserId = new Map();
  const all = [...principalIds.map((id) => ["principalIds", id]), ...actorSubjects.map((id) => ["actorSubjects", id])];
  for (let i = 0; i < all.length; i += 100) {
    const chunk = all.slice(i, i + 100);
    const input = {};
    for (const [field, id] of chunk) (input[field] ??= []).push(id);
    const res = await call("resolvePrincipalDisplayNames", input);
    if (!res?.ok) return byUserId;
    for (const n of res.result?.names ?? []) byUserId.set(n.key, { id: n.key, displayName: n.displayName ?? null });
  }
  return byUserId;
}

function load(key, client, actorCall, actorIds, actorSubjects) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = Promise.all([readEmployees(client), actorIds.length + actorSubjects.length
    ? readActors(actorCall, actorIds, actorSubjects).catch(() => new Map()) : Promise.resolve(new Map())])
    .then(([employees, byUserId]) => ({ ...employees, byUserId }));
  cache.set(key, { at: Date.now(), promise });
  promise.then((r) => { if (r.error) cache.delete(key); });
  return promise;
}

/** Test seam: forget the shared read. */
export function resetGovernedEmployeeDirectory() { cache.clear(); }

export function useGovernedEmployeeDirectory({ enabled = true, actorIds = [], actorSubjects = [], client = workforceApiClient, actorCall = callWorkspaceApi } = {}) {
  const [state, setState] = useState({ byEmployeeId: new Map(), byUserId: new Map(), loading: enabled, error: null, truncated: false });
  const clean = (xs) => [...new Set((xs ?? []).filter((v) => typeof v === "string" && v !== ""))].sort();
  const ids = clean(actorIds);
  const subjects = clean(actorSubjects);
  const idsKey = `${ids.join("|")}#${subjects.join("|")}`;
  useEffect(() => {
    if (!enabled) { setState({ byEmployeeId: new Map(), byUserId: new Map(), loading: false, error: null, truncated: false }); return undefined; }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    const shared = client === workforceApiClient && actorCall === callWorkspaceApi;
    const [pIds, sIds] = idsKey.split("#");
    load(shared ? `d:${idsKey}` : `d:${idsKey}:${Math.random()}`, client, actorCall, pIds ? pIds.split("|") : [], sIds ? sIds.split("|") : []).then((r) => {
      if (!alive) return;
      setState({ byEmployeeId: r.byEmployeeId, byUserId: r.byUserId, loading: false, error: r.error, truncated: r.truncated });
    });
    return () => { alive = false; };
  }, [enabled, idsKey, client, actorCall]);
  return state;
}
