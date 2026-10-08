// THE WORKFORCE ROSTER — Administration → Users (Administration control plane, DECISIONS #210).
//
// Built for MANY employees per Job Role: one row per Employee, from the governed listWorkforceRoster read — Job Role, Security
// Roles (with their scope), operating company, status, operational scopes (warehouse, reorder queue, the current truck), work
// eligibility and manager. Every value is a PostgreSQL row the server read; the page computes no authority (Effective Access is
// on the Employee's record, from the server resolver). Filters narrow by the existing dimensions and the facet counts are what
// the read returned — no number here is a product rule. A Security Role column the caller may not read says so.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState";
import { Field } from "../../shared/ui/form";
import { Button } from "../../shared/ui/primitives";
import Autocomplete from "../../shared/ui/Autocomplete.jsx";
import SortableHeader from "../../shared/ui/sorting/SortableHeader.jsx";
import { useTableSort } from "../../shared/ui/sorting/useTableSort.js";
import { identifierLabel, operatingCompanyLabel, titleCase } from "../../shared/display/displayLabels.js";
import { workforceApiClient } from "../../services/workforceApiClient.js";

// SORTING, SEARCH AND PAGES (UI corrections package items B, C, E, 2026-10-08).
//   * DEFAULT ORDER: Last Name A-Z, First Name A-Z, Employee id -- applied by the SERVER over the complete authorized match
//     set before its bound, so the first page is the first page of everybody you may see, not of an arbitrary 500.
//   * COLUMN SORT: every column header cycles ascending -> descending -> default; the server re-orders the whole set.
//   * PAGES: the sorted, filtered set is shown PAGE_SIZE rows at a time; a filter or sort change returns to page 1.
//   * SEARCH: the shared typeahead suggests matching people from the same governed read (reach-scoped by the server);
//     choosing one opens the record, Enter or "View All Results" filters the table to every match.
//   * STALE RESPONSES: each table read carries a sequence number; only the latest answer is drawn.
const PAGE_SIZE = 50;

const STATUS_WORDS = Object.freeze({ ACTIVE: "Employee Active", CONTRACTOR: "Contractor", ON_LEAVE: "On Leave", INACTIVE: "Employee Inactive", TERMINATED: "Terminated", RETIRED: "Retired" });
const SCOPE_WORDS = Object.freeze({ WAREHOUSE: "Warehouse", REORDER_QUEUE: "Reorder Queue", MOBILE: "Truck" });
const channelWords = (v) => (v === "NATIONAL_ACCOUNTS" ? "National Accounts" : v === "RETAIL" ? "Retail" : titleCase(v));

function roleWords(r) {
  const name = identifierLabel(r.roleKey, r.name);
  if (!r.scopeType || r.scopeType === "global") return name;
  return `${name} @ ${r.scopeType === "salesChannel" ? channelWords(r.scopeValue) : `${titleCase(r.scopeType)}: ${r.scopeValue}`}`;
}

const COLUMNS = Object.freeze([
  { key: "name", label: "Employee" },
  { key: "employeeNumber", label: "Employee ID" },
  { key: "jobRole", label: "Job Role" },
  { key: "securityRoles", label: "Security Roles" },
  { key: "operatingCompany", label: "Company" },
  { key: "status", label: "Status" },
  { key: "scope", label: "Scope / Assignment" },
  { key: "manager", label: "Manager" },
]);

export default function WorkforceRoster({ workforce = workforceApiClient }) {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({});
  const { sort, toggle } = useTableSort();
  const [page, setPage] = useState(0);
  const [state, setState] = useState({ status: "LOADING", roster: null, message: null });
  const seq = useRef(0);

  const load = useCallback(async () => {
    seq.current += 1;
    const mine = seq.current;
    setState((s) => ({ ...s, status: "LOADING" }));
    const input = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== "" && v !== undefined && v !== false));
    if (sort) input.sort = sort;
    const res = await workforce.call("listWorkforceRoster", input);
    if (mine !== seq.current) return; // a newer filter/sort owns the table
    if (!res.ok) { setState({ status: res.code === "FORBIDDEN" ? "DENIED" : "FAILED", roster: null, message: res.message }); return; }
    setState({ status: "READY", roster: res.result, message: null });
  }, [workforce, filters, sort]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [filters, sort]);

  const [facets, setFacets] = useState(null);
  useEffect(() => { if (state.roster && Object.keys(filters).length === 0) setFacets(state.roster.facets); }, [state.roster, filters]);
  const f = facets ?? state.roster?.facets;
  const set = (k) => (e) => setFilters((prev) => ({ ...prev, [k]: e.target.value }));
  const summary = useMemo(() => (f ? f.jobRoles.map((j) => `${j.label} ${j.count}`).join(" · ") : null), [f]);

  // The typeahead: the SAME governed read, asked for a handful of matches. The server applies capability and reach.
  const suggest = useCallback(async (query) => {
    const res = await workforce.call("listWorkforceRoster", { query, limit: 8 });
    return res.ok ? { ok: true, items: res.result.items, total: res.result.total } : { ok: false, code: res.code, message: res.message };
  }, [workforce]);

  const items = state.roster?.items ?? [];
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const shown = items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <section className="fo-roster" aria-label="Workforce roster">
      <h2 className="ns-section__title">Workforce</h2>
      {summary && <p className="fo-muted" data-testid="roster-jobrole-counts">{summary}</p>}
      {f?.securityRoles && (
        <p className="fo-muted" data-testid="roster-securityrole-counts">
          Security Roles: {f.securityRoles.map((r) => `${identifierLabel(r.roleKey, r.name)} ${r.count}`).join(" · ")}
        </p>
      )}
      <div className="fo-roster__filters">
        <Autocomplete
          id="roster-q"
          label="Search"
          placeholder="Name or employee number"
          search={suggest}
          getKey={(e) => e.employeeId}
          getLabel={(e) => e.displayName ?? e.employeeNumber ?? e.employeeId}
          getContext={(e) => [e.jobRole?.label, operatingCompanyLabel(e.operatingCompanyId), e.employeeNumber ? `Employee ${e.employeeNumber}` : null].filter(Boolean).join(" · ")}
          onSelect={(e) => { if (e) navigate(`/administration/users/${e.employeeId}`); }}
          onViewAll={(q) => setFilters((prev) => ({ ...prev, query: q }))}
          onQueryChange={(q) => { if (q.trim() === "" && filters.query) setFilters((prev) => ({ ...prev, query: "" })); }}
          initialQuery={filters.query ?? ""}
        />
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
              {f.securityRoles.map((r) => <option key={r.roleKey} value={r.roleKey}>{identifierLabel(r.roleKey, r.name)} ({r.count})</option>)}
            </select>
          </Field>
        )}
        <Field id="roster-status" label="Status">
          <select className="fo-input" value={filters.employmentStatus ?? ""} onChange={set("employmentStatus")}>
            <option value="">All Statuses</option>
            {(f?.statuses ?? []).map((s) => <option key={s.status} value={s.status}>{STATUS_WORDS[s.status] ?? titleCase(s.status)} ({s.count})</option>)}
          </select>
        </Field>
        <Field id="roster-scope" label="Operational Scope">
          <select className="fo-input" value={filters.scopeType ?? ""} onChange={set("scopeType")}>
            <option value="">Any</option>
            {Object.entries(SCOPE_WORDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
      {filters.query ? (
        <p className="fo-muted" data-roster-query={filters.query}>
          {`Showing every match for “${filters.query}”. `}
          <button type="button" className="fo-linkbutton" onClick={() => setFilters((prev) => ({ ...prev, query: "" }))}>Clear Search</button>
        </p>
      ) : null}
      {state.status === "LOADING" && !state.roster && <HonestState state={HONEST_STATE.LOADING} subject="The workforce" />}
      {state.status === "DENIED" && <HonestState state={HONEST_STATE.DENIED} subject="The workforce roster" detail={state.message} />}
      {state.status === "FAILED" && <HonestState state={HONEST_STATE.UNAVAILABLE} subject="The workforce roster" detail={state.message} action={<Button variant="secondary" onClick={load}>Try Again</Button>} />}
      {state.roster && (
        <>
          <p className="fo-muted" aria-live="polite" data-roster-sort={state.roster.sort ? `${state.roster.sort.key}:${state.roster.sort.direction}` : "name:asc"}>
            {state.roster.total} employee{state.roster.total === 1 ? "" : "s"}{state.roster.truncated ? ` (first ${state.roster.items.length} shown)` : ""}
            {" · "}{sort ? `Sorted by ${COLUMNS.find((c) => c.key === sort.key)?.label}, ${sort.direction === "asc" ? "ascending" : "descending"}` : "Sorted by last name, then first name"}
          </p>
          {state.roster.securityRolesWithheld && <p className="fo-muted">{state.roster.securityRolesWithheld}.</p>}
          <table className="fo-table fo-table--stack ns-table" data-roster-table>
            <thead><tr>{COLUMNS.map((c) => <SortableHeader key={c.key} columnKey={c.key} label={c.label} sort={sort} onSort={toggle} />)}</tr></thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.employeeId} data-employee-row={e.employeeId}>
                  <td data-label="Employee"><Link to={`/administration/users/${e.employeeId}`}>{e.displayName ?? e.employeeId}</Link>
                    {e.applicationUser === "UNLINKED" ? <span className="fo-muted"> · No application user</span> : null}</td>
                  <td data-label="Employee ID">{e.employeeNumber ?? <span className="fo-muted">—</span>}</td>
                  <td data-label="Job Role">{e.jobRole?.label ?? <span className="fo-muted">None</span>}</td>
                  <td data-label="Security Roles">{e.securityRoles === null ? <span className="fo-muted">Withheld</span>
                    : e.securityRoles.length === 0 ? <span className="fo-muted">None</span> : e.securityRoles.map(roleWords).join(", ")}</td>
                  <td data-label="Company">{operatingCompanyLabel(e.operatingCompanyId)}</td>
                  <td data-label="Status">{STATUS_WORDS[e.employmentStatus] ?? titleCase(e.employmentStatus)}</td>
                  <td data-label="Scope / Assignment">{[...e.operationalScopes.map((s) => `${SCOPE_WORDS[s.scopeType] ?? titleCase(s.scopeType)}: ${s.label ?? s.scopeId}`),
                    ...e.workEligibility.map((q) => `Eligible: ${titleCase(q)}`)].join(" · ") || <span className="fo-muted">—</span>}</td>
                  <td data-label="Manager">{e.manager ? <Link to={`/administration/users/${e.manager.employeeId}`}>{e.manager.displayName ?? e.manager.employeeId}</Link> : <span className="fo-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 ? (
            <nav className="fo-btn-row fo-roster__pager" aria-label="Workforce pages" data-roster-page={page + 1}>
              <Button variant="secondary" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous Page</Button>
              <span className="fo-muted" aria-live="polite">{`Page ${page + 1} of ${pages}`}</span>
              <Button variant="secondary" disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}>Next Page</Button>
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
