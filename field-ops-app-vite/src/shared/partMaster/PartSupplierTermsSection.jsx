import { useCallback, useEffect, useState } from "react";
import RuledSection from "../ui/RuledSection.jsx";
import { Button } from "../ui/primitives/index.js";
import {
  createPartSupplierTerms, fetchPartSupplierItems, setPartSupplierTermsStatus, setPreferredPartSupplierTerms, updatePartSupplierTerms,
} from "../../services/partsOperationsReads.js";
import {
  AVAILABILITY_LABEL, AVAILABILITY_STATES, EMPTY_TERMS_FORM, PURCHASE_UNITS, buildCreateTermsInput, buildTermsChanges,
  formatCost, formatPurchaseUnit, outcomeFromError, outcomeFromResult, termsFormFromItem,
} from "../../domain/partSupplierTerms.js";

// PART MASTER > SUPPLIERS & TERMS (remediation SUP-1).
//
// The procurement terms each Supplier offers for THIS Part -- supplier SKU, unit cost, currency, lead time, minimum order
// quantity, order multiple, purchase unit and its conversion to the stocking unit, contract window, availability -- and
// which supplier is preferred. The authority is PostgreSQL (eos_ops.supplier_catalog_items) through the governed command
// layer on /operations/inventory (functions/src/eosOps/partSupplierTerms.ts); Firebase retirement F2 removed the old
// writers and nothing replaced them on a screen until this section.
//
// THE SERVER DECIDES. Reading and maintaining terms needs inventory.catalog.manage (unit cost is commercially sensitive);
// deactivating / reactivating needs inventory.catalog.activate. This section invents no capability: it asks, and renders
// the answer. A FORBIDDEN list hides every control and says why; a FORBIDDEN status change hides the status controls
// after the server has said no -- never before.
//
// FOUR LOAD STATES, never collapsed (PartIdentifiersSection's grammar):
//   loading      -- the read is in flight;
//   denied       -- the caller may not read supplier terms (a denial, NOT an empty list);
//   failed       -- the read broke;
//   ready        -- the answer, which may genuinely be "no supplier terms yet".
//
// SUCCESS RE-READS. After every governed write the list is read again from the server: the new version token is the
// server's, and a locally patched row would fail the next change with a conflict nobody could explain.

function StatusLine({ tone, children }) {
  const cls = tone === "ok" ? "fo-muted" : tone === "attention" ? "fo-warning" : "fo-inline-error";
  return (
    <p className={cls} role={tone === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}

function Field({ id, label, children }) {
  return (
    <div className="fo-identifier-form__row">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

function TermsForm({ mode, item, supplierOptions, stockingUnit, busy, onSubmit, onCancel }) {
  const [values, setValues] = useState(() => (mode === "edit" ? termsFormFromItem(item) : { ...EMPTY_TERMS_FORM }));
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));
  const submit = (e) => {
    e.preventDefault();
    onSubmit(values);
  };
  const input = (id, k, extra = {}) => (
    <input id={id} className="fo-input" type="text" autoComplete="off" value={values[k]} onChange={set(k)} {...extra} />
  );
  return (
    <form className="fo-identifier-form" onSubmit={submit} aria-label={mode === "edit" ? "Edit supplier terms" : "Add supplier terms"}>
      {mode === "create" ? (
        <Field id="pst-supplier" label="Supplier">
          <select id="pst-supplier" className="fo-input" value={values.supplierId} onChange={set("supplierId")}>
            <option value="">{supplierOptions.length === 0 ? "No active supplier without terms" : "Select…"}</option>
            {supplierOptions.map((s) => (
              <option key={s.supplierId} value={s.supplierId}>{s.name}</option>
            ))}
          </select>
        </Field>
      ) : (
        <p className="fo-muted"><strong>{item.supplierName}</strong> · version {item.version}</p>
      )}
      <Field id="pst-sku" label="Supplier SKU">{input("pst-sku", "supplierSku")}</Field>
      <Field id="pst-cost" label="Unit cost">{input("pst-cost", "cost", { inputMode: "decimal" })}</Field>
      <Field id="pst-currency" label="Currency">{input("pst-currency", "currency", { maxLength: 3 })}</Field>
      <Field id="pst-lead" label="Lead time (days)">{input("pst-lead", "leadTimeDays", { inputMode: "numeric" })}</Field>
      <Field id="pst-moq" label="Minimum order quantity">{input("pst-moq", "minOrderQty", { inputMode: "decimal" })}</Field>
      <Field id="pst-multiple" label="Order multiple">{input("pst-multiple", "orderMultiple", { inputMode: "decimal" })}</Field>
      <Field id="pst-unit" label="Purchase unit">
        <select id="pst-unit" className="fo-input" value={values.purchaseUnit} onChange={set("purchaseUnit")}>
          <option value="">None (bought in the stocking unit)</option>
          {PURCHASE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </Field>
      {values.purchaseUnit !== "" && (
        <>
          <Field id="pst-conv-num" label={`Stocking units${stockingUnit ? ` (${stockingUnit})` : ""} per conversion`}>
            {input("pst-conv-num", "conversionNumerator", { inputMode: "numeric" })}
          </Field>
          <Field id="pst-conv-den" label="Purchase units per conversion">
            {input("pst-conv-den", "conversionDenominator", { inputMode: "numeric" })}
          </Field>
        </>
      )}
      <Field id="pst-contract-start" label="Contract start">{input("pst-contract-start", "contractStart", { type: "date" })}</Field>
      <Field id="pst-contract-end" label="Contract end">{input("pst-contract-end", "contractEnd", { type: "date" })}</Field>
      <Field id="pst-availability" label="Availability">
        <select id="pst-availability" className="fo-input" value={values.availability} onChange={set("availability")}>
          {AVAILABILITY_STATES.map((a) => <option key={a} value={a}>{AVAILABILITY_LABEL[a]}</option>)}
        </select>
      </Field>
      <div className="fo-chip-row">
        <Button type="submit" variant="primary" loading={busy}>{mode === "edit" ? "Save Terms" : "Add Supplier Terms"}</Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}

function TermsTable({ items, label, stockingUnit, busy, statusControls, onEdit, onStatus, onPreferred }) {
  return (
    <div className="fo-table-scroll">
      <table className="fo-table" aria-label={`Supplier terms for ${label}`}>
        <thead>
          <tr>
            <th scope="col">Supplier</th>
            <th scope="col">Supplier SKU</th>
            <th scope="col">Unit cost</th>
            <th scope="col">Lead time</th>
            <th scope="col">Min. order</th>
            <th scope="col">Multiple</th>
            <th scope="col">Purchase unit</th>
            <th scope="col">Contract</th>
            <th scope="col">Availability</th>
            <th scope="col">Status</th>
            <th scope="col"><span className="fo-sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const active = item.status === "ACTIVE";
            return (
              <tr key={item.itemId} className={active ? undefined : "is-inactive"}>
                <td>
                  {item.supplierName}
                  {item.preferred && <strong> · Preferred</strong>}
                  {item.supplierStatus === "INACTIVE" && <span className="fo-muted"> · supplier inactive</span>}
                </td>
                <td><code>{item.supplierSku}</code></td>
                <td>{formatCost(item)}</td>
                <td>{item.leadTimeDays} days</td>
                <td>{item.minOrderQty ?? "—"}</td>
                <td>{item.orderMultiple ?? "—"}</td>
                <td>{formatPurchaseUnit(item, stockingUnit)}</td>
                <td>{item.contractStart || item.contractEnd ? `${item.contractStart ?? "…"} – ${item.contractEnd ?? "…"}` : "—"}</td>
                <td>{AVAILABILITY_LABEL[item.availability] ?? item.availability}</td>
                {/* Named, not bare (ADR-012 §2.2a): beside Part status, a bare ACTIVE would read as the Part's. */}
                <td>{active ? "Terms Active" : <span className="fo-muted">Terms Inactive</span>}</td>
                <td>
                  <div className="fo-chip-row">
                    <Button type="button" variant="tertiary" disabled={!!busy} onClick={() => onEdit(item)}
                      aria-label={`Edit terms from ${item.supplierName}`}>
                      Edit
                    </Button>
                    {active && !item.preferred && (
                      <Button type="button" variant="tertiary" disabled={!!busy} onClick={() => onPreferred(item)}
                        aria-label={`Make ${item.supplierName} preferred`}>
                        {busy === `preferred:${item.itemId}` ? "Working…" : "Set Preferred"}
                      </Button>
                    )}
                    {statusControls && (
                      <Button type="button" variant="tertiary" disabled={!!busy} onClick={() => onStatus(item)}
                        aria-label={`${active ? "Deactivate" : "Reactivate"} terms from ${item.supplierName}`}>
                        {busy === `status:${item.itemId}` ? "Working…" : active ? "Deactivate" : "Reactivate"}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function PartSupplierTermsSection({ partId, partNumber, deps }) {
  // TEST SEAM ONLY: the transport options the real client passes to callReorderApi (baseUrl, getIdToken, fetchImpl).
  const callOptions = deps?.callOptions;
  const [state, setState] = useState({ status: "loading", items: [], supplierOptions: [], stockingUnit: null, message: null });
  const [outcome, setOutcome] = useState(null);
  const [busy, setBusy] = useState(null);
  const [form, setForm] = useState(null); // null | { mode: "create" } | { mode: "edit", item }
  const [statusControls, setStatusControls] = useState(true);
  const label = partNumber || partId || "this part";

  const load = useCallback(async () => {
    if (!partId) {
      setState({ status: "ready", items: [], supplierOptions: [], stockingUnit: null, message: null });
      return;
    }
    try {
      const result = await fetchPartSupplierItems(partId, callOptions);
      setState({
        status: "ready", items: Array.isArray(result?.items) ? result.items : [],
        supplierOptions: Array.isArray(result?.supplierOptions) ? result.supplierOptions : [],
        stockingUnit: result?.stockingUnit ?? null, message: null,
      });
    } catch (err) {
      // A denial is NOT an empty list, and never rendered as one.
      setState({ status: err?.code === "FORBIDDEN" ? "denied" : "failed", items: [], supplierOptions: [], stockingUnit: null,
        message: err?.code === "FORBIDDEN" ? null : outcomeFromError(err, "read").message });
    }
  }, [partId, callOptions]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (busyKey, action, call) => {
    setBusy(busyKey);
    setOutcome(null);
    try {
      const result = await call();
      const o = outcomeFromResult(result);
      setOutcome(o);
      setForm(null);
      await load();
      return o;
    } catch (err) {
      const o = outcomeFromError(err, action);
      // The server has said this person may not change status: stop offering it. Nothing is hidden BEFORE that answer.
      if (o.kind === "denied" && action === "status") setStatusControls(false);
      setOutcome(o);
      return o;
    } finally {
      setBusy(null);
    }
  };

  const submitForm = (values) => {
    if (form?.mode === "edit") {
      const changes = buildTermsChanges(values, form.item);
      return run("form", "update", () => updatePartSupplierTerms({ itemId: form.item.itemId, expectedVersion: form.item.version, changes }, callOptions));
    }
    return run("form", "create", () => createPartSupplierTerms(buildCreateTermsInput(partId, values), callOptions));
  };
  const changeStatus = (item) => run(`status:${item.itemId}`, "status", () => setPartSupplierTermsStatus({
    itemId: item.itemId, expectedVersion: item.version, status: item.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
  }, callOptions));
  const makePreferred = (item) => run(`preferred:${item.itemId}`, "preferred", () => setPreferredPartSupplierTerms({
    partId, itemId: item.itemId, expectedVersion: item.version,
  }, callOptions));

  return (
    <RuledSection title="Suppliers & Terms">
      {state.status === "loading" && <p className="fo-muted">Loading supplier terms…</p>}

      {state.status === "denied" && (
        <p className="fo-warning" role="status">
          Supplier terms are not shown: reading and maintaining them needs catalog management authority, which is
          governed in Administration. This is a denial, not an empty list.
        </p>
      )}

      {state.status === "failed" && (
        <p className="fo-inline-error" role="alert">
          {state.message}{" "}
          <button type="button" className="fo-link-btn" onClick={load}>Retry</button>
        </p>
      )}

      {state.status === "ready" && (
        <>
          {state.items.length === 0 ? (
            <p className="fo-muted">No supplier terms are recorded for {label} yet.</p>
          ) : (
            <TermsTable
              items={state.items}
              label={label}
              stockingUnit={state.stockingUnit}
              busy={busy}
              statusControls={statusControls}
              onEdit={(item) => { setOutcome(null); setForm({ mode: "edit", item }); }}
              onStatus={changeStatus}
              onPreferred={makePreferred}
            />
          )}

          {outcome && (
            <StatusLine tone={outcome.kind === "applied" || outcome.kind === "replayed" ? "ok" : outcome.kind === "conflict" ? "attention" : "error"}>
              {outcome.message}
            </StatusLine>
          )}

          {form ? (
            <TermsForm
              key={form.mode === "edit" ? form.item.itemId : "create"}
              mode={form.mode}
              item={form.item}
              supplierOptions={state.supplierOptions}
              stockingUnit={state.stockingUnit}
              busy={busy === "form"}
              onSubmit={submitForm}
              onCancel={() => setForm(null)}
            />
          ) : (
            <div className="fo-chip-row">
              <Button type="button" variant="secondary" disabled={!!busy} onClick={() => { setOutcome(null); setForm({ mode: "create" }); }}>
                Add Supplier Terms
              </Button>
            </div>
          )}
        </>
      )}
    </RuledSection>
  );
}
