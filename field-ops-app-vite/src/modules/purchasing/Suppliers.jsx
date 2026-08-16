import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSuppliers } from "../../hooks/useSuppliers";
import { loadErrorMessage } from "../../domain/loadErrorMessage";
import {
  buildSuppliersView,
  SUPPLIER_FILTERS,
  DEFAULT_SUPPLIER_FILTER,
  filterSuppliers,
  countForSupplierFilter,
  supplierStatusLabel,
  supplierStatusTone,
} from "../../domain/suppliersView";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import FilterBar from "../../shared/ui/FilterBar";
import LoadingState from "../../shared/ui/LoadingState";
import FailureState from "../../shared/ui/FailureState";
import EmptyState from "../../shared/ui/EmptyState";

// Purchasing > Suppliers -- the first-class registry workspace for the governed Supplier business
// object (Supplier Master, functions/src/supplierMaster/*), replacing the prior PlaceholderPage for
// this existing nav item. READ-ONLY: `suppliers` is Admin-SDK-write-only (the S2 trusted commands
// createSupplier/updateSupplier/activate/deactivate are the ONLY writers; no client/deployed write
// path). It REUSES the shared read (useSuppliers -> operationsQueries.fetchSuppliers -- the same
// `suppliers` read the Operations ProcurementPanel uses) and the pure domain view (suppliersView.js).
//
// Honesty: the workspace reports the stored governed STATUS (ACTIVE/INACTIVE); it does NOT re-run the
// backend governed validator. Legacy Epic-5 demo supplier docs (no status) surface as "ungoverned"
// -- truthfully not governed Supplier records -- rather than being silently counted active. Access:
// the Purchasing > Suppliers nav item is admin/dispatcher (PLACEHOLDER_DEFAULT_ROLES), matching the
// suppliers read rule's isAdminOrDispatcher(); a denied read fails closed to a FailureState. No
// Rules/deploy/grant/production.
export default function Suppliers({ accessVersion }) {
  const read = useSuppliers(accessVersion);
  const { rows, summary } = useMemo(() => buildSuppliersView(read.suppliers), [read.suppliers]);
  const [filterKey, setFilterKey] = useState(DEFAULT_SUPPLIER_FILTER);

  const intro = <p className="fo-muted">The company's governed suppliers and their status. <strong>Active</strong> suppliers are selectable for purchasing; <strong>inactive</strong> ones are retained for history but not selectable.</p>;

  if (read.loading) {
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Suppliers" />
        {intro}
        <LoadingState>Loading suppliers…</LoadingState>
      </div>
    );
  }
  if (read.error) {
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Suppliers" />
        {intro}
        <FailureState title="Suppliers unavailable" message={loadErrorMessage({ code: read.error }, { entity: "suppliers" })} />
      </div>
    );
  }

  const visibleRows = filterSuppliers(rows, filterKey);
  const filterOptions = SUPPLIER_FILTERS.map((f) => ({ key: f.key, label: f.label, count: countForSupplierFilter(rows, f.key) }));

  return (
    <div className="fo-panel">
      <WorkspaceHeader title="Suppliers" />
      {intro}
      {summary.total > 0 && (
        <p className="fo-muted" role="status">
          {summary.total} supplier{summary.total === 1 ? "" : "s"} · {summary.active} active
          {summary.inactive > 0 ? ` · ${summary.inactive} inactive` : ""}.
        </p>
      )}
      {summary.ungoverned > 0 && (
        <p className="fo-warning" role="alert">
          {summary.ungoverned} supplier{summary.ungoverned === 1 ? "" : "s"} {summary.ungoverned === 1 ? "has" : "have"} no governed status (legacy record{summary.ungoverned === 1 ? "" : "s"} predating Supplier Master) — not selectable for governed purchasing until governed. Use the “Ungoverned” filter to review.
        </p>
      )}
      <FilterBar options={filterOptions} activeKey={filterKey} onChange={setFilterKey} />

      {rows.length === 0 ? (
        <EmptyState
          variant="database"
          title="No suppliers"
          message="No suppliers are recorded yet."
          guidance="Suppliers are the vendors parts are purchased from. Each carries a status showing whether it is active for purchasing. Suppliers are recorded outside this read-only screen."
        />
      ) : visibleRows.length === 0 ? (
        <EmptyState variant="filtered" title="No matching suppliers" message="No suppliers match this filter." />
      ) : (
        <div className="fo-table-scroll">
          <table className="fo-table" aria-label="Suppliers">
            <thead>
              <tr>
                <th scope="col">Supplier</th>
                <th scope="col">Vendor #</th>
                <th scope="col">Contact</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.vendorNumber ?? "—"}</td>
                  <td>{row.contact ?? "—"}</td>
                  <td>
                    <span className={`fo-sup-status fo-sup-status--${supplierStatusTone(row.status)}`}>
                      {supplierStatusLabel(row.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="fo-muted fo-sup-footnote">
        Purchase orders placed with these suppliers appear under <Link to="/dashboard/purchasing">Purchase Orders</Link>.
      </p>
    </div>
  );
}
