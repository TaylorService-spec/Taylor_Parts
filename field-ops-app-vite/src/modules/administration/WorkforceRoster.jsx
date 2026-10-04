// THE WORKFORCE ROSTER — Administration → Users (Administration control plane, DECISIONS #210).
//
// Built for MANY employees per Job Role: one row per Employee, from the governed listWorkforceRoster read — Job Role, Security
// Roles (with their scope), operating company, status, operational scopes (warehouse, reorder queue, the current truck), work
// eligibility and manager. Every value is a PostgreSQL row the server read; the page computes no authority (Effective Access is
// on the Employee's record, from the server resolver). Filters narrow by the existing dimensions and the facet counts are what
// the read returned — no number here is a product rule. A Security Role column the caller may not read says so.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState";
import { Field } from "../../shared/ui/form";
import { workforceApiClient } from "../../services/workforceApiClient.js";

const STATUS_WORDS = Object.freeze({ ACTIVE: "Active", CONTRACTOR: "Contractor", ON_LEAVE: "On leave", INACTIVE: "Inactive", TERMINATED: "Terminated", RETIRED: "Retired" });
const SCOPE_WORDS = Object.freeze({ WAREHOUSE: "Warehouse", REORDER_QUEUE: "Reorder queue", MOBILE: "Truck" });
const channelWords = (v) => (v === "NATIONAL_ACCOUNTS" ? "National Accounts" : v === "RETAIL" ? "Retail" : v);

function roleWords(r) {
  if (!r.scopeType || r.scopeType === "global") return r.name;
  return `${r.name} @ ${r.scopeType === "salesChannel" ? channelWords(r.scopeValue) : `${r.scopeType}:${r.scopeValue}`}`;
}

export default function WorkforceRoster({ workforce = workforceApiClient }) {
  const [filters, setFilters] = useState({});
  const [state, setState] = useState({ status: "LOADING", roster: null, message: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: "LOADING" }));
    const input = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== "" && v !== undefined && v !== false));
    const res = await workforce.call("listWorkforceRoster", input);
    if (!res.ok) { setState({ status: res.code === "FORBIDDEN" ? "DENIED" : "FAILED", roster: null, message: res.message }); return; }
    setState({ status: "READY", roster: res.result, message: null });
  }, [workforce, filters]);
  useEffect(() => { load(); }, [load]);

  const [facets, setFacets] = useState(null);
  useEffect(() => { if (state.roster && Object.keys(filters).length === 0) setFacets(state.roster.facets); }, [state.roster, filters]);
  const f = facets ?? state.roster?.facets;
  const set = (k) => (e) => setFilters((prev) => ({ ...prev, [k]: e.target.value }));
  const summary = useMemo(() => (f ? f.jobRoles.map((j) => `${j.label} ${j.count}`).join(" · ") : null), [f]);

  return (
    <section className="fo-roster" aria-label="Workforce roster">
      <h2 className="ns-section__title">Workforce</h2>
      {summary && <p className="fo-muted" data-testid="roster-jobrole-counts">{summary}</p>}
      {f?.securityRoles && (
        <p className="fo-muted" data-testid="roster-securityrole-counts">
          Security Roles: {f.securityRoles.map((r) => `${r.name} ${r.count}`).join(" · ")}
        </p>
      )}
      <div className="fo-roster__filters">
        <Field id="roster-q" label="Search">
          <input className="fo-input" value={filters.query ?? ""} onChange={set("query")} placeholder="Name or employee number" />
        </Field>
        <Field id="roster-jobrole" label="Job Role">
          <select className="fo-input" value={filters.jobRoleId ?? ""} onChange={set("jobRoleId")}>
            <option value="">All Job Roles</option>
            {(f?.jobRoles ?? []).map((j) => <option key={j.id} value={j.id}>{j.label} ({j.count})</option>)}
          </select>
        </Field>
        {f?.securityRoles && (
          <Field id="roster-securityrole" label="Security Role">
            <select className="fo-input" value={filters.securityRoleKey ?? ""} onChange={set("securityRoleKey")}>
              <option value="">All Security Roles</option>
              {f.securityRoles.map((r) => <option key={r.roleKey} value={r.roleKey}>{r.name} ({r.count})</option>)}
            </select>
          </Field>
        )}
        <Field id="roster-status" label="Status">
          <select className="fo-input" value={filters.employmentStatus ?? ""} onChange={set("employmentStatus")}>
            <option value="">All statuses</option>
            {(f?.statuses ?? []).map((s) => <option key={s.status} value={s.status}>{STATUS_WORDS[s.status] ?? s.status} ({s.count})</option>)}
          </select>
        </Field>
        <Field id="roster-scope" label="Operational scope">
          <select className="fo-input" value={filters.scopeType ?? ""} onChange={set("scopeType")}>
            <option value="">Any</option>
            {Object.entries(SCOPE_WORDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
      {state.status === "LOADING" && !state.roster && <HonestState state={HONEST_STATE.LOADING} subject="The workforce" />}
      {state.status === "DENIED" && <HonestState state={HONEST_STATE.DENIED} subject="The workforce roster" detail={state.message} />}
      {state.status === "FAILED" && <HonestState state={HONEST_STATE.UNAVAILABLE} subject="The workforce roster" detail={state.message} onRetry={load} />}
      {state.roster && (
        <>
          <p className="fo-muted" aria-live="polite">{state.roster.total} employee{state.roster.total === 1 ? "" : "s"}{state.roster.truncated ? ` (first ${state.roster.items.length} shown)` : ""}</p>
          {state.roster.securityRolesWithheld && <p className="fo-muted">{state.roster.securityRolesWithheld}.</p>}
          <table className="fo-table fo-table--stack">
            <thead><tr><th>Employee</th><th>Job Role</th><th>Security Roles</th><th>Company</th><th>Status</th><th>Scope / assignment</th><th>Manager</th></tr></thead>
            <tbody>
              {state.roster.items.map((e) => (
                <tr key={e.employeeId}>
                  <td data-label="Employee"><Link to={`/administration/users/${e.employeeId}`}>{e.displayName ?? e.employeeId}</Link>
                    <span className="fo-muted"> · {e.employeeNumber ?? e.employeeId}{e.applicationUser === "UNLINKED" ? " · no application user" : ""}</span></td>
                  <td data-label="Job Role">{e.jobRole?.label ?? <span className="fo-muted">None</span>}</td>
                  <td data-label="Security Roles">{e.securityRoles === null ? <span className="fo-muted">withheld</span>
                    : e.securityRoles.length === 0 ? <span className="fo-muted">None</span> : e.securityRoles.map(roleWords).join(", ")}</td>
                  <td data-label="Company">{e.operatingCompanyId}</td>
                  <td data-label="Status">{STATUS_WORDS[e.employmentStatus] ?? e.employmentStatus}</td>
                  <td data-label="Scope / assignment">{[...e.operationalScopes.map((s) => `${SCOPE_WORDS[s.scopeType] ?? s.scopeType}: ${s.label ?? s.scopeId}`),
                    ...e.workEligibility.map((q) => `Eligible: ${q}`)].join(" · ") || <span className="fo-muted">—</span>}</td>
                  <td data-label="Manager">{e.manager ? <Link to={`/administration/users/${e.manager.employeeId}`}>{e.manager.displayName ?? e.manager.employeeId}</Link> : <span className="fo-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
