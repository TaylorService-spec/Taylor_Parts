// NONPROD QA -- PRINCIPAL INSPECTION (UI corrections package §15, 2026-10-08).
//
// WHAT THIS REPLACES. Administration → Permission Preview listed every tenant Principal (most of them synthetic personas
// and test fixtures) as buttons and drew getPrincipalEffectiveAccess, an older projection that is NOT the runtime
// evaluator. Its legitimate business function now lives on Users → Employee → Roles & Access (explainEffectiveAccess,
// with ROLE / DIRECT / ROLE_AND_DIRECT provenance). Two things only the old page could do are kept HERE, for QA:
//   * inspect a Principal with NO linked Employee (non-login Principals, orphaned sample Principals), which no Employee
//     record can reach;
//   * pick any Principal, including a synthetic persona, by name.
//
// WHERE IT IS. Not in normal Administration navigation (the item is navHidden) and NOT RENDERED in a production bundle:
// production gets a plain "not available in this environment". The server still re-authorizes every read
// (listTenantPrincipals; explainEffectiveAccess under admin.principalAccess.read) -- the environment check only decides
// whether the QA tool is offered, never what anyone may read.
//
// ONE EVALUATOR. The selected Principal is drawn by EmployeeEffectiveAccess -- the same component and the same
// explainEffectiveAccess call as the Employee record. There is no second permission calculation on this page.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { usePolicyStore } from "./usePolicyStore.js";
import EmployeeEffectiveAccess from "./EmployeeEffectiveAccess.jsx";
import Autocomplete from "../../shared/ui/Autocomplete.jsx";
import { adminControlPlaneClient } from "../../services/adminControlPlaneClient.js";
import { workforceApiClient } from "../../services/workforceApiClient.js";
import { isNonprodEnvironment } from "../../config/environmentRole.js";
import { principalLabel } from "./principalDisplay.js";

export const PRINCIPAL_QA_PATH = "/administration/qa/principal-inspection";

export default function PrincipalQaInspection({ nonprod = isNonprodEnvironment(), api = adminControlPlaneClient, workforce = workforceApiClient }) {
  if (!nonprod) {
    return (
      <div className="fo-panel" data-principal-qa="PRODUCTION">
        <h2>Principal Inspection</h2>
        <p className="fo-muted">This QA tool is not available in this environment. Inspect a person&apos;s access on their Employee record under Users → Roles &amp; Access.</p>
        <p><Link to="/administration/users">Go to Users</Link></p>
      </div>
    );
  }
  return <NonprodInspection api={api} workforce={workforce} />;
}

function NonprodInspection({ api, workforce }) {
  const principals = usePolicyStore("listTenantPrincipals");
  const [selected, setSelected] = useState(null);
  const [showAll, setShowAll] = useState(false);
  // Which Principals are linked to an Employee THIS CALLER CAN SEE (the governed roster, Security Role column holders
  // only). A Principal not in it is "no Employee you can see" -- never claimed to be unlinked tenant-wide.
  const [links, setLinks] = useState({ status: "idle", byPrincipal: new Map() });
  useEffect(() => {
    let alive = true;
    setLinks({ status: "loading", byPrincipal: new Map() });
    workforce.call("listWorkforceRoster", {}).then((res) => {
      if (!alive) return;
      if (!res.ok) { setLinks({ status: "failed", byPrincipal: new Map() }); return; }
      setLinks({ status: "ready", byPrincipal: new Map(res.result.items.filter((i) => i.principalId).map((i) => [i.principalId, i])) });
    });
    return () => { alive = false; };
  }, [workforce]);

  const all = principals.data ?? [];
  const unlinked = all.filter((p) => links.status === "ready" && !links.byPrincipal.has(p.id));
  const listed = showAll ? all : unlinked;

  const search = async (q) => {
    const needle = q.toLowerCase();
    const items = all.filter((p) => principalLabel(p).toLowerCase().includes(needle));
    return { ok: true, items, total: items.length };
  };

  return (
    <div className="fo-panel" data-principal-qa="NONPROD">
      <h2>Principal Inspection <span className="fo-cp-tag">QA · Non-production</span></h2>
      <p className="fo-muted">
        Non-production QA tooling. Inspect any Principal — including sample personas and Principals with no linked
        Employee — through the server&apos;s runtime evaluator. To see or change a person&apos;s access, use their Employee
        record under Users → Roles &amp; Access.
      </p>
      {principals.status === "loading" ? <p className="fo-muted" role="status">Reading Principals…</p> : null}
      {principals.status === "failed" ? <p className="fo-warning" role="status">{principals.error?.description ?? "The Principal list could not be read."}</p> : null}
      {principals.status === "ready" ? (
        <>
          <Autocomplete
            id="principal-qa-search"
            label="Find a Principal"
            placeholder="Type at least 2 characters"
            search={search}
            getKey={(p) => p.id}
            getLabel={(p) => principalLabel(p)}
            getContext={(p) => [links.byPrincipal.has(p.id) ? `Employee: ${links.byPrincipal.get(p.id).displayName ?? "linked"}` : "No Employee you can see", p.status === "active" ? null : "Disabled"].filter(Boolean).join(" · ")}
            selected={selected}
            onSelect={setSelected}
          />
          <section className="fo-panel--nested" aria-label="Principals">
            <h3>{showAll ? "All Principals" : "Principals Without a Visible Employee"}</h3>
            {links.status === "failed" ? <p className="fo-muted">Employee links could not be read, so every Principal is listed.</p> : null}
            <p className="fo-muted">
              <button type="button" className="fo-linkbutton" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show Only Principals Without a Visible Employee" : `Show All ${all.length} Principals`}
              </button>
            </p>
            <ul className="fo-pill-row" data-principal-list={showAll || links.status === "failed" ? "ALL" : "UNLINKED"}>
              {(links.status === "failed" ? all : listed).map((p) => (
                <li key={p.id}>
                  <button type="button" className={`fo-btn ${selected?.id === p.id ? "fo-btn--primary" : "fo-btn--secondary"}`}
                    aria-pressed={selected?.id === p.id} onClick={() => setSelected(selected?.id === p.id ? null : p)}>
                    {principalLabel(p)}{p.status === "active" ? "" : " · Disabled"}
                  </button>
                </li>
              ))}
            </ul>
            {listed.length === 0 && links.status === "ready" ? <p className="fo-muted">Every Principal is linked to an Employee you can see.</p> : null}
          </section>
        </>
      ) : null}
      {selected ? (
        <section className="fo-panel--nested" aria-label="Selected Principal" data-principal-qa-selected>
          <h3>{principalLabel(selected)}</h3>
          {links.byPrincipal.has(selected.id) ? (
            <p>
              Linked Employee:{" "}
              <Link to={`/administration/users/${links.byPrincipal.get(selected.id).employeeId}?tab=access`}>
                {links.byPrincipal.get(selected.id).displayName ?? "Open Employee record"}
              </Link>
            </p>
          ) : (
            <p className="fo-muted">No Employee you can see is linked to this Principal.</p>
          )}
          <EmployeeEffectiveAccess api={api} principalId={selected.id} key={selected.id} />
        </section>
      ) : null}
    </div>
  );
}
