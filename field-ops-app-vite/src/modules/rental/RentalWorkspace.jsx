// RENTAL WORKSPACE — on /rental (Rental, DECISIONS #207).
//
// The exception-first operational answers a rental desk needs: what is available, reserved, going out, on rent (where, and who
// holds it), needs service, is due back, is being returned, awaits inspection, and what has a billing exception -- plus the
// Rental Agreements themselves (versioned terms, assignments, charges and their receivables) and the governed commands.
//
// It decides nothing. Every figure is the server's (rental.agreement.read); every action is a governed command the server
// authorizes on its own capability (agreement / assign / return / charge / fleet) and refuses otherwise -- the refusal is
// rendered as its answer. Taylor keeps ownership throughout: nothing here sells, finances or transfers equipment.
import { useCallback, useEffect, useState } from "react";
import { PageHeader, SectionHeader, Button, StatusIndicator } from "../../shared/ui/primitives";
import { Field, FormError } from "../../shared/ui/form";
import { callRentalApi } from "../../services/rentalApiClient";
import { formatMinorUnits } from "../../domain/money.js";
import { toMinorUnits } from "../financials/FinancialsWorkspace";
import { useTableSort } from "../../shared/ui/sorting/useTableSort.js";
import SortableHeader from "../../shared/ui/sorting/SortableHeader.jsx";
import { operatingCompanyLabel, statusLabel } from "../../shared/display/displayLabels.js";

export const AVAILABILITY_WORDS = Object.freeze({ AVAILABLE: "Available", RESERVED: "Reserved", ON_RENT: "On Rent", SERVICE_HOLD: "Service Hold",
  RETURN_PENDING: "Return Pending", INSPECTION: "Awaiting Inspection", UNAVAILABLE: "Unavailable" });
const FREQUENCY_WORDS = Object.freeze({ DAY: "per day", WEEK: "per week", MONTH: "per month" });
const money = (minor, currency = "USD") => (minor === null || minor === undefined ? "—" : formatMinorUnits(Number(minor), currency));
const key = (k) => `rental-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const custodianWords = (u) => (u.custodian?.kind === "CUSTOMER"
  ? `${u.custodian.name ?? u.custodian.accountId} (customer)`
  : `${operatingCompanyLabel(u.ownerOperatingCompanyKey)} (owner)`);

// HEADER SORTING over the units already read; no sort = the server's order.
const UNIT_SORT_COLUMNS = Object.freeze({
  unit: { value: (u) => u.displayName },
  serial: { value: (u) => u.serialNumber },
  status: { value: (u) => statusLabel(u.availability, AVAILABILITY_WORDS) },
  where: { value: (u) => u.location?.label ?? u.location?.id ?? null },
  holder: { value: custodianWords },
  agreement: { value: (u) => u.agreement?.number ?? null },
});

function UnitTable({ title, units, empty, children }) {
  const { sort, toggle, sorted } = useTableSort({ rows: units, columns: UNIT_SORT_COLUMNS });
  const th = (k, label) => <SortableHeader columnKey={k} label={label} sort={sort} onSort={toggle} />;
  return (
    <section className="fo-panel" aria-label={title}>
      <SectionHeader title={title} description={units.length === 0 ? empty : `${units.length} unit${units.length === 1 ? "" : "s"}`} />
      {units.length > 0 && (
        <table className="fo-table">
          <thead><tr>{th("unit", "Unit")}{th("serial", "Serial")}{th("status", "Status")}{th("where", "Where")}{th("holder", "Who Holds It")}{th("agreement", "Agreement")}{children ? <th>Action</th> : null}</tr></thead>
          <tbody>
            {sorted.map((u) => (
              <tr key={u.id}>
                <td>{u.displayName}</td><td>{u.serialNumber}</td><td>{statusLabel(u.availability, AVAILABILITY_WORDS)}</td>
                <td>{u.location?.label ?? u.location?.id ?? "—"}</td>
                <td>{custodianWords(u)}</td>
                <td>{u.agreement?.number ?? "—"}</td>
                {children ? <td>{children(u)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const dueBackWords = (d) => (d.overdue ? `Overdue by ${-d.daysUntilDue} day(s)` : `Due in ${d.daysUntilDue} day(s)`);
const DUE_BACK_SORT_COLUMNS = Object.freeze({
  agreement: { value: (d) => d.number },
  expectedEnd: { value: (d) => d.expectedEndDate },
  unitsOut: { value: (d) => (typeof d.unitsOut === "number" ? d.unitsOut : null) },
  status: { value: (d) => (typeof d.daysUntilDue === "number" ? d.daysUntilDue : null) },
});

function DueBackTable({ rows, onOpen }) {
  const { sort, toggle, sorted } = useTableSort({ rows, columns: DUE_BACK_SORT_COLUMNS });
  const th = (k, label) => <SortableHeader columnKey={k} label={label} sort={sort} onSort={toggle} />;
  return (
    <table className="fo-table">
      <thead><tr>{th("agreement", "Agreement")}{th("expectedEnd", "Expected End")}{th("unitsOut", "Units Out")}{th("status", "Status")}</tr></thead>
      <tbody>{sorted.map((d) => (
        <tr key={d.agreementId}><td><Button size="sm" variant="secondary" onClick={() => onOpen(d.agreementId)}>{d.number}</Button></td><td>{d.expectedEndDate}</td><td>{d.unitsOut}</td>
          <td>{dueBackWords(d)}</td></tr>))}</tbody>
    </table>
  );
}

const exceptionWords = (x) => (x.kind === "RENTAL_PACKAGE_HELD"
  ? `Charge held — ${x.reasons.join(", ")}`
  : `Equipment out, charged only through ${x.chargedThrough ?? "nothing yet"}`);
const EXCEPTION_SORT_COLUMNS = Object.freeze({
  agreement: { value: (x) => x.number },
  exception: { value: exceptionWords },
});

function BillingExceptionTable({ rows, onOpen }) {
  const { sort, toggle, sorted } = useTableSort({ rows, columns: EXCEPTION_SORT_COLUMNS });
  return (
    <table className="fo-table">
      <thead><tr><SortableHeader columnKey="agreement" label="Agreement" sort={sort} onSort={toggle} /><SortableHeader columnKey="exception" label="Exception" sort={sort} onSort={toggle} /></tr></thead>
      <tbody>{sorted.map((x) => (
        <tr key={`${x.kind}-${x.agreementId}-${x.chargeId ?? ""}`}><td><Button size="sm" variant="secondary" onClick={() => onOpen(x.agreementId)}>{x.number}</Button></td>
          <td>{exceptionWords(x)}</td></tr>))}</tbody>
    </table>
  );
}

const AGREEMENT_SORT_COLUMNS = Object.freeze({
  number: { value: (a) => a.number },
  customer: { value: (a) => a.customer.name ?? a.customer.accountId },
  status: { value: (a) => statusLabel(a.status) },
  rate: { value: (a) => (a.rateMinor === null || a.rateMinor === undefined ? null : Number(a.rateMinor)) },
  expectedEnd: { value: (a) => a.expectedEndDate },
  unitsOut: { value: (a) => (typeof a.unitsOut === "number" ? a.unitsOut : null) },
});

function AgreementTable({ rows, onOpen }) {
  const { sort, toggle, sorted } = useTableSort({ rows, columns: AGREEMENT_SORT_COLUMNS });
  const th = (k, label) => <SortableHeader columnKey={k} label={label} sort={sort} onSort={toggle} />;
  return (
    <table className="fo-table">
      <thead><tr>{th("number", "Number")}{th("customer", "Customer")}{th("status", "Status")}{th("rate", "Rate")}{th("expectedEnd", "Expected End")}{th("unitsOut", "Units Out")}</tr></thead>
      <tbody>{sorted.map((a) => (
        <tr key={a.id}><td><Button size="sm" variant="secondary" onClick={() => onOpen(a.id)}>{a.number}</Button></td><td>{a.customer.name ?? a.customer.accountId}</td><td>{statusLabel(a.status)}</td>
          <td>{money(a.rateMinor, a.currency)} {FREQUENCY_WORDS[a.billingFrequency] ?? ""}</td><td>{a.expectedEndDate}</td><td>{a.unitsOut}</td></tr>))}</tbody>
    </table>
  );
}

export default function RentalWorkspace({ callApi = callRentalApi }) {
  const [ws, setWs] = useState(null);
  const [agreements, setAgreements] = useState([]);
  const [detail, setDetail] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ operatingCompanyId: "taylor", accountId: "", customerLocationId: "", startDate: "", expectedEndDate: "", rate: "", billingFrequency: "WEEK", delivery: "" });
  const [charge, setCharge] = useState({ kind: "PERIOD", periodStart: "", periodEnd: "", tax: "", taxNotDetermined: false });
  const [act, setAct] = useState({ fleetUnitId: "", warehouseId: "", notes: "", extendTo: "", reason: "" });

  const load = useCallback(async () => {
    const res = await callApi("readRentalWorkspace", {});
    if (!res.ok) { setWs(null); setRefusal(res.code === "FORBIDDEN" ? "The Rental workspace is not available to you. It needs Rental Agreement read access." : (res.message ?? "Rental could not be read.")); return; }
    setRefusal(null);
    setWs(res.result);
    const list = await callApi("listRentalAgreements", {});
    if (list.ok) setAgreements(list.result.items);
  }, [callApi]);
  useEffect(() => { load(); }, [load]);

  const open = async (agreementId) => {
    const res = await callApi("readRentalAgreement", { agreementId });
    if (res.ok) setDetail(res.result); else setNotice({ tone: "danger", text: res.message ?? "The agreement could not be read." });
  };
  const run = async (operation, input) => {
    setBusy(true); setNotice(null);
    const res = await callApi(operation, input);
    setBusy(false);
    if (!res.ok) { setNotice({ tone: "danger", text: res.message ?? "The request was refused." }); return null; }
    setNotice({ tone: "positive", text: "Recorded." });
    await load();
    if (detail) await open(detail.id);
    return res.result;
  };

  const createAgreement = async () => {
    const rateMinor = toMinorUnits(draft.rate);
    const deliveryMinor = draft.delivery === "" ? undefined : toMinorUnits(draft.delivery);
    if (rateMinor === null || deliveryMinor === null) { setNotice({ tone: "danger", text: "Enter the rate (and any delivery charge) as an amount, e.g. 700.00." }); return; }
    const out = await run("createRentalAgreement", { operatingCompanyId: draft.operatingCompanyId, accountId: draft.accountId.trim(), customerLocationId: draft.customerLocationId.trim(),
      startDate: draft.startDate, expectedEndDate: draft.expectedEndDate, rateMinor, billingFrequency: draft.billingFrequency,
      ...(deliveryMinor === undefined ? {} : { deliveryChargeMinor: deliveryMinor }), idempotencyKey: key("ra") });
    if (out) await open(out.agreement.id);
  };
  const recordCharge = async () => {
    const taxMinor = charge.taxNotDetermined ? null : toMinorUnits(charge.tax);
    if (!charge.taxNotDetermined && taxMinor === null) { setNotice({ tone: "danger", text: "State the tax amount, or mark it not yet determined — tax is never assumed." }); return; }
    await run("recordRentalCharge", { agreementId: detail.id, kind: charge.kind, ...(charge.kind === "PERIOD" ? { periodStart: charge.periodStart, periodEnd: charge.periodEnd } : {}),
      taxEvidence: charge.taxNotDetermined ? { status: "NOT_DETERMINED" } : { status: "DETERMINED", amountMinor: taxMinor }, idempotencyKey: key("charge") });
  };

  if (refusal) return (<div className="fo-workspace"><PageHeader title="Rental" /><FormError>{refusal}</FormError></div>);
  if (!ws) return (<div className="fo-workspace"><PageHeader title="Rental" /><p className="fo-muted">Loading the rental fleet…</p></div>);
  const c = ws.counts;
  return (
    <div className="fo-workspace">
      <PageHeader title="Rental" description={`${c.fleet} fleet units · ${ws.utilization.unitsOut} at customers · ${c.AVAILABLE} available · ${c.billingExceptions} billing exception${c.billingExceptions === 1 ? "" : "s"}`} />
      {notice && <StatusIndicator tone={notice.tone}>{notice.text}</StatusIndicator>}

      <section className="fo-panel" aria-label="Needs Attention">
        <SectionHeader title="Needs Attention" description={ws.dueBack.length + ws.billingExceptions.length === 0 ? "Nothing due back and no billing exceptions." : "Due back and billing exceptions first."} />
        {ws.dueBack.length > 0 && <DueBackTable rows={ws.dueBack} onOpen={open} />}
        {ws.billingExceptions.length > 0 && <BillingExceptionTable rows={ws.billingExceptions} onOpen={open} />}
      </section>

      <UnitTable title="Available" units={ws.available} empty="No unit is available to rent." />
      <UnitTable title="Reserved" units={ws.reserved} empty="Nothing reserved." />
      <section className="fo-panel" aria-label="Going Out">
        <SectionHeader title="Going Out" description={ws.goingOut.length === 0 ? "No delivery scheduled." : "Reserved units with an open delivery / install Work Order."} />
        {ws.goingOut.length > 0 && (<ul>{ws.goingOut.map((g) => <li key={g.workOrderId}>{g.workOrderNumber} — {statusLabel(g.status)}</li>)}</ul>)}
      </section>
      <UnitTable title="On Rent" units={ws.onRent} empty="Nothing is out on rent." />
      <UnitTable title="Return Pending" units={ws.returnPending} empty="No return in progress." />
      <UnitTable title="Awaiting Inspection" units={ws.inspection} empty="Nothing waits for inspection.">
        {(u) => (
          <span>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => run("inspectRentalUnit", { fleetUnitId: u.id, outcome: "READY", conditionNotes: act.notes || "inspected: ready", idempotencyKey: key("ins") })}>Ready</Button>{" "}
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => run("inspectRentalUnit", { fleetUnitId: u.id, outcome: "NEEDS_SERVICE", conditionNotes: act.notes || "needs service", idempotencyKey: key("ins") })}>Needs Service</Button>
          </span>
        )}
      </UnitTable>
      <UnitTable title="Service Hold" units={ws.serviceHold} empty="No unit is held for service.">
        {(u) => <Button size="sm" variant="secondary" disabled={busy || !act.reason} onClick={() => run("setFleetUnitAvailability", { fleetUnitId: u.id, availability: "AVAILABLE", reason: act.reason })}>Release Hold</Button>}
      </UnitTable>
      <UnitTable title="Unavailable" units={ws.unavailable} empty="No unit is out of service." />
      <Field id="rental-notes-reason-for-the-actions-above" label="Notes / Reason for the Actions Above"><input className="fo-input" value={act.reason} onChange={(e) => setAct({ ...act, reason: e.target.value, notes: e.target.value })} /></Field>

      <section className="fo-panel" aria-label="Rental Agreements">
        <SectionHeader title="Rental Agreements" description={agreements.length === 0 ? "No Rental Agreement yet." : `${agreements.length} agreement(s)`} />
        {agreements.length > 0 && <AgreementTable rows={agreements} onOpen={open} />}
        <h3>New Rental Agreement</h3>
        <Field id="rental-operating-company" label="Operating Company"><select className="fo-input" value={draft.operatingCompanyId} onChange={(e) => setDraft({ ...draft, operatingCompanyId: e.target.value })}><option value="taylor">{operatingCompanyLabel("taylor")}</option><option value="ventana">{operatingCompanyLabel("ventana")}</option></select></Field>
        <Field id="rental-customer-account" label="Customer Account"><input className="fo-input" value={draft.accountId} onChange={(e) => setDraft({ ...draft, accountId: e.target.value })} /></Field>
        <Field id="rental-customer-site" label="Customer Site"><input className="fo-input" value={draft.customerLocationId} onChange={(e) => setDraft({ ...draft, customerLocationId: e.target.value })} /></Field>
        <Field id="rental-start-date" label="Start Date"><input className="fo-input" type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} /></Field>
        <Field id="rental-expected-end" label="Expected End"><input className="fo-input" type="date" value={draft.expectedEndDate} onChange={(e) => setDraft({ ...draft, expectedEndDate: e.target.value })} /></Field>
        <Field id="rental-rate" label="Rate"><input className="fo-input" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} /></Field>
        <Field id="rental-billing-frequency" label="Billing Frequency"><select className="fo-input" value={draft.billingFrequency} onChange={(e) => setDraft({ ...draft, billingFrequency: e.target.value })}><option value="DAY">Daily</option><option value="WEEK">Weekly</option><option value="MONTH">Monthly</option></select></Field>
        <Field id="rental-delivery-charge-optional" label="Delivery Charge (Optional)"><input className="fo-input" value={draft.delivery} onChange={(e) => setDraft({ ...draft, delivery: e.target.value })} /></Field>
        <Button disabled={busy} onClick={createAgreement}>Create Rental Agreement</Button>
      </section>

      {detail && (
        <section className="fo-panel" aria-label={`Rental Agreement ${detail.number}`}>
          <SectionHeader title={`${detail.number} — ${statusLabel(detail.status)}`} description={`${detail.customer.name ?? detail.customer.accountId} · ${detail.site.name ?? detail.site.id} · owned by ${operatingCompanyLabel(detail.operatingCompanyKey, { short: false })}; ownership never transfers`} />
          {detail.status === "DRAFT" && <Button disabled={busy} onClick={() => run("activateRentalAgreement", { agreementId: detail.id })}>Activate</Button>}
          <h3>Terms History</h3>
          <table className="fo-table">
            <thead><tr><th>Version</th><th>Change</th><th>Rate</th><th>Expected End</th><th>Delivery</th><th>Reason</th></tr></thead>
            <tbody>{detail.termsHistory.map((t) => (<tr key={t.version}><td>{t.version}</td><td>{statusLabel(t.changeKind)}</td><td>{money(t.rateMinor, detail.currency)} {FREQUENCY_WORDS[t.billingFrequency]}</td><td>{t.expectedEndDate}</td><td>{money(t.deliveryChargeMinor, detail.currency)}</td><td>{t.reason}</td></tr>))}</tbody>
          </table>
          <Field id="rental-extend-to" label="Extend To"><input className="fo-input" type="date" value={act.extendTo} onChange={(e) => setAct({ ...act, extendTo: e.target.value })} /></Field>
          <Button disabled={busy || !act.extendTo || !act.reason} onClick={() => run("amendRentalAgreementTerms", { agreementId: detail.id, changeKind: "EXTENSION", expectedEndDate: act.extendTo, reason: act.reason })}>Extend</Button>
          <h3>Equipment</h3>
          <table className="fo-table">
            <thead><tr><th>Unit</th><th>Status</th><th>Deployed</th><th>Action</th></tr></thead>
            <tbody>{detail.assignments.map((s) => (
              <tr key={s.id}><td>{s.displayName} ({s.serialNumber}){s.replacesAssignmentId ? " — exchange" : ""}</td><td>{statusLabel(s.status)}</td><td>{s.deployedAt ?? "—"}</td>
                <td>
                  {s.status === "DEPLOYED" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => run("initiateRentalReturn", { assignmentId: s.id, reason: act.reason || undefined })}>Start Return</Button>}
                  {(s.status === "DEPLOYED" || s.status === "RETURN_PENDING") && (
                    <Button size="sm" variant="secondary" disabled={busy || !act.warehouseId} onClick={() => run("receiveRentalReturn", { assignmentId: s.id, warehouseId: act.warehouseId, conditionNotes: act.notes || "received", idempotencyKey: key("rcv") })}>Receive Into Warehouse</Button>
                  )}
                  {s.status === "RESERVED" && <Button size="sm" variant="secondary" disabled={busy || !act.reason} onClick={() => run("releaseRentalReservation", { assignmentId: s.id, reason: act.reason })}>Release</Button>}
                </td></tr>))}</tbody>
          </table>
          <Field id="rental-receiving-warehouse" label="Receiving Warehouse"><input className="fo-input" value={act.warehouseId} onChange={(e) => setAct({ ...act, warehouseId: e.target.value })} /></Field>
          <Field id="rental-reserve-an-available-unit" label="Reserve an Available Unit">
            <select className="fo-input" value={act.fleetUnitId} onChange={(e) => setAct({ ...act, fleetUnitId: e.target.value })}>
              <option value="">Choose a unit…</option>
              {ws.available.map((u) => <option key={u.id} value={u.id}>{u.displayName} ({u.serialNumber})</option>)}
            </select>
          </Field>
          <Button disabled={busy || !act.fleetUnitId} onClick={() => run("reserveRentalUnit", { agreementId: detail.id, fleetUnitId: act.fleetUnitId, idempotencyKey: key("rsv") })}>Reserve</Button>
          <h3>Charges</h3>
          <table className="fo-table">
            <thead><tr><th>Kind</th><th>Period</th><th>Amount</th><th>Tax</th><th>Billing</th><th>Receivable</th></tr></thead>
            <tbody>{detail.charges.map((x) => (
              <tr key={x.id}><td>{statusLabel(x.kind)}</td><td>{x.periodStart ? `${x.periodStart} → ${x.periodEnd} (${x.periodCount})` : "—"}</td><td>{money(x.amountMinor, x.currency)}</td>
                <td>{x.taxEvidence.status === "DETERMINED" ? money(x.taxEvidence.amountMinor, x.currency) : "Not Determined"}</td>
                <td>{x.billingPackage ? `${statusLabel(x.billingPackage.status)}${x.billingPackage.readinessExceptions.length ? ` — ${x.billingPackage.readinessExceptions.join(", ")}` : ""}` : "—"}</td>
                <td>{x.receivable ? `${statusLabel(x.receivable.status)} · ${money(x.receivable.outstandingMinor, x.currency)} outstanding` : "—"}</td></tr>))}</tbody>
          </table>
          <Field id="rental-charge" label="Charge"><select className="fo-input" value={charge.kind} onChange={(e) => setCharge({ ...charge, kind: e.target.value })}><option value="PERIOD">Rental Period</option><option value="DELIVERY">Agreed Delivery Charge</option><option value="INSTALL">Agreed Install Charge</option></select></Field>
          {charge.kind === "PERIOD" && (<>
            <Field id="rental-period-start" label="Period Start"><input className="fo-input" type="date" value={charge.periodStart} onChange={(e) => setCharge({ ...charge, periodStart: e.target.value })} /></Field>
            <Field id="rental-period-end-exclusive" label="Period End (Exclusive)"><input className="fo-input" type="date" value={charge.periodEnd} onChange={(e) => setCharge({ ...charge, periodEnd: e.target.value })} /></Field>
          </>)}
          <Field id="rental-tax" label="Tax"><input className="fo-input" disabled={charge.taxNotDetermined} value={charge.tax} onChange={(e) => setCharge({ ...charge, tax: e.target.value })} /></Field>
          <label><input type="checkbox" checked={charge.taxNotDetermined} onChange={(e) => setCharge({ ...charge, taxNotDetermined: e.target.checked })} /> Tax not yet determined (the charge is held)</label>
          <Button disabled={busy} onClick={recordCharge}>Record Charge</Button>
          {detail.status === "ACTIVE" && <Button variant="secondary" disabled={busy || !act.reason} onClick={() => run("endRentalAgreement", { agreementId: detail.id, outcome: "CLOSED", reason: act.reason })}>Close Agreement</Button>}
        </section>
      )}
    </div>
  );
}
