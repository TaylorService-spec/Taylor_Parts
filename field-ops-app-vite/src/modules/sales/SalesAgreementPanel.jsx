import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import MetadataRecordPage from "../../metadata/MetadataRecordPage.jsx";
import { salesAgreementRecordPage } from "../../metadata/definitions/salesAgreementPage.js";
import { Button } from "../../shared/ui/primitives/index.js";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import { formatMinorUnits } from "../../domain/money.js";
import {
  SALES_AGREEMENT_VIEW_STATE as STATE,
  salesAgreementLabel,
  agreementIsEditable,
  agreementAcceptability,
} from "../../domain/salesAgreementView.js";
import {
  SALES_AGREEMENT_CREATE_CAPABILITY,
  SALES_AGREEMENT_UPDATE_DRAFT_CAPABILITY,
  SALES_AGREEMENT_ACCEPT_CAPABILITY,
  SALES_AGREEMENT_DISABLED_REASON,
  SALES_AGREEMENT_CAPABILITY_REQUEST,
} from "../../access/salesAgreementCapabilityAccess.js";

// THE SALES AGREEMENT, ON THE OPPORTUNITY IT BELONGS TO.
//
// ════════════════════ WHY IT LIVES HERE AND NOT ON ITS OWN ROUTE ════════════════════
//
// An agreement is never reached in the abstract. A salesperson is standing on a negotiation and
// wants to write down what was agreed; the agreement has no meaning apart from that Opportunity,
// and a separate destination would mean navigating away from the thing they are looking at to
// record a fact about it.
//
// So the panel answers one question in place — "is there an agreement for this yet?" — and offers
// exactly the next step: CREATE if there is none, EDIT while it is a draft, ACCEPT once every line
// carries a price, and after that a link to the order it became.
//
// ════════════════════ ACCEPT IS NOT A PENCIL ════════════════════
//
// Owner §G. Acceptance binds the business to these prices and cannot be undone. It is a governed
// ACTION with its own capability, rendered as its own primary control with the consequence spelled
// out — never an edit affordance, and never in the field grid beside the reversible things.
//
// The button explains why it is unavailable rather than merely being disabled: "you cannot accept"
// with no reason sends somebody hunting for a permission problem when the real answer is that a
// line has no price. The pricing rule is stated here so the screen can explain itself before the
// round trip — never INSTEAD of the server's, which remains the control.
//
// ════════════════════ NO RAW ID IS EVER A LABEL ════════════════════
//
// DECISIONS #106. The heading is the allocated SA-YYYY-###### reference; when one is somehow
// absent, the truthful generic "Sales Agreement" — never the document id, which is a routing key
// wearing the costume of a name.

const money = (minor, currency) => (typeof minor === "number" ? formatMinorUnits(minor, currency) : "—");

const STATE_TONE = { DRAFT: "neutral", ACCEPTED: "positive", DECLINED: "negative" };
const STATE_LABEL = { DRAFT: "Draft", ACCEPTED: "Accepted", DECLINED: "Declined" };

const BLANK_LINE = { kind: "PART", ref: "", quantity: "1", unitPrice: "" };

/** Major-unit text -> integer minor units. Empty stays UNDEFINED, which is "no price yet", not zero. */
function toMinor(text) {
  const t = String(text ?? "").trim();
  if (t === "") return undefined;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN; // rejected by the caller; never silently coerced
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

function LinesEditor({ lines, onChange, disabled }) {
  const set = (i, patch) => onChange(lines.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  return (
    <div className="fo-agreement-lines">
      {lines.map((l, i) => (
        <div key={i} className="fo-agreement-line">
          <select aria-label={`Line ${i + 1} kind`} value={l.kind} disabled={disabled}
            onChange={(e) => set(i, { kind: e.target.value })}>
            <option value="EQUIPMENT_MODEL">Equipment model</option>
            <option value="PART">Part</option>
            <option value="SERVICE">Service</option>
          </select>
          <input aria-label={`Line ${i + 1} item`} placeholder="Item" value={l.ref} disabled={disabled}
            onChange={(e) => set(i, { ref: e.target.value })} />
          <input aria-label={`Line ${i + 1} quantity`} inputMode="numeric" value={l.quantity} disabled={disabled}
            onChange={(e) => set(i, { quantity: e.target.value })} />
          {/* Left empty this is an UNPRICED line, which a draft is allowed to carry. It becomes the
              thing that blocks acceptance, and the Accept control says so by name. */}
          <input aria-label={`Line ${i + 1} unit price`} inputMode="decimal" placeholder="Price" value={l.unitPrice}
            disabled={disabled} onChange={(e) => set(i, { unitPrice: e.target.value })} />
          {lines.length > 1 && (
            <Button variant="ghost" disabled={disabled} onClick={() => onChange(lines.filter((_, n) => n !== i))}>
              Remove
            </Button>
          )}
        </div>
      ))}
      <Button variant="ghost" disabled={disabled} onClick={() => onChange([...lines, { ...BLANK_LINE }])}>
        Add line
      </Button>
    </div>
  );
}

/** Turns the editor's text into the command's shape, or returns the reason it cannot. */
function buildLines(draftLines) {
  const out = [];
  for (const [i, l] of draftLines.entries()) {
    const ref = String(l.ref ?? "").trim();
    if (!ref) return { error: `Line ${i + 1} needs an item.` };
    const quantity = Number(l.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) return { error: `Line ${i + 1} needs a whole quantity above zero.` };
    const unitPrice = toMinor(l.unitPrice);
    if (Number.isNaN(unitPrice)) return { error: `Line ${i + 1}'s price must be an amount like 1250.00.` };
    // `unitPrice: undefined` is omitted by the transport, so an unpriced draft line stays unpriced
    // rather than arriving as a zero the server would read as "free".
    out.push(unitPrice === undefined ? { kind: l.kind, ref, quantity } : { kind: l.kind, ref, quantity, unitPrice });
  }
  return { lines: out };
}

function CreateForm({ onCreate, pending, canCreate }) {
  const [lines, setLines] = useState([{ ...BLANK_LINE }]);
  const [customerPO, setCustomerPO] = useState("");
  const [fulfillmentIntent, setIntent] = useState("");
  const [error, setError] = useState(null);

  const submit = async () => {
    const built = buildLines(lines);
    if (built.error) { setError(built.error); return; }
    setError(null);
    const res = await onCreate({
      lines: built.lines,
      customerPO: customerPO.trim() || undefined,
      fulfillmentIntent: fulfillmentIntent || undefined,
    });
    if (!res.ok) setError(null); // the hook surfaces the command error; not duplicated here
  };

  return (
    <div className="fo-agreement-create">
      <p className="fo-muted">
        No Sales Agreement yet. The agreement records what was actually agreed — what is being sold,
        at what price, on what terms. A Sales Order is created from an accepted one.
      </p>
      <LinesEditor lines={lines} onChange={setLines} disabled={pending || !canCreate} />
      <div className="fo-agreement-terms">
        <label>Customer PO
          <input value={customerPO} disabled={pending || !canCreate} onChange={(e) => setCustomerPO(e.target.value)} />
        </label>
        <label>Fulfillment
          <select value={fulfillmentIntent} disabled={pending || !canCreate} onChange={(e) => setIntent(e.target.value)}>
            <option value="">Not stated</option>
            <option value="DELIVER">Deliver</option>
            <option value="INSTALL">Install</option>
            <option value="BOTH">Deliver and install</option>
          </select>
        </label>
      </div>
      {error && <p role="alert" className="fo-error">{error}</p>}
      <Button variant="primary" disabled={pending || !canCreate} onClick={submit}>
        {pending === "create" ? "Saving…" : "Save draft agreement"}
      </Button>
      {!canCreate && <p className="fo-muted">{SALES_AGREEMENT_DISABLED_REASON.create}</p>}
    </div>
  );
}

// The bounded terms form. Every field here is on updateSalesAgreementDraft's allowlist, and nothing
// else is reachable: identity, currency, acceptance and the totals are not caller-supplied, and the
// command refuses them by name rather than ignoring them.
function TermsForm({ view, pending, onSave }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);

  const start = () => {
    setForm({
      customerPO: view.customerPO ?? "",
      fulfillmentIntent: view.fulfillmentIntent ?? "",
      shipVia: view.shipVia ?? "",
      shippingInstructions: view.shippingInstructions ?? "",
      specialInstructions: view.specialInstructions ?? "",
      isLease: view.isLease === true,
      // Charges are shown in MAJOR units because that is what a person types, and converted back to
      // integer minor units on submit. The stored value never leaves minor units.
      shippingMinor: view.shippingMinor === null ? "" : String(view.shippingMinor / 100),
      installChargeMinor: view.installChargeMinor === null ? "" : String(view.installChargeMinor / 100),
      taxMinor: view.taxMinor === null ? "" : String(view.taxMinor / 100),
      downPaymentMinor: view.downPaymentMinor === null ? "" : String(view.downPaymentMinor / 100),
      tradeInMinor: view.tradeInMinor === null ? "" : String(view.tradeInMinor / 100),
    });
    setError(null);
    setOpen(true);
  };

  const submit = async () => {
    const patch = {
      customerPO: form.customerPO.trim() || null,
      fulfillmentIntent: form.fulfillmentIntent || null,
      shipVia: form.shipVia.trim() || null,
      shippingInstructions: form.shippingInstructions.trim() || null,
      specialInstructions: form.specialInstructions.trim() || null,
      isLease: form.isLease,
    };
    for (const key of ["shippingMinor", "installChargeMinor", "taxMinor", "downPaymentMinor", "tradeInMinor"]) {
      const minor = toMinor(form[key]);
      if (Number.isNaN(minor)) { setError("Amounts must look like 1250.00."); return; }
      // An empty charge box means ZERO here, not "unknown": a charge that is not stated is not
      // charged. That is the opposite of a LINE price, where empty means "not priced yet" — the two
      // blanks mean different things and are deliberately not collapsed.
      patch[key] = minor ?? 0;
    }
    setError(null);
    const res = await onSave(patch);
    if (res.ok) setOpen(false);
  };

  if (!open) return <Button variant="ghost" onClick={start}>Edit terms</Button>;

  const field = (key, label, type = "text") => (
    <label key={key}>{label}
      <input type={type} value={form[key]} disabled={pending === "updateDraft"}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </label>
  );

  return (
    <div className="fo-agreement-terms-form">
      {field("customerPO", "Customer PO")}
      <label>Fulfillment
        <select value={form.fulfillmentIntent} disabled={pending === "updateDraft"}
          onChange={(e) => setForm({ ...form, fulfillmentIntent: e.target.value })}>
          <option value="">Not stated</option>
          <option value="DELIVER">Deliver</option>
          <option value="INSTALL">Install</option>
          <option value="BOTH">Deliver and install</option>
        </select>
      </label>
      <label>Lease
        <input type="checkbox" checked={form.isLease} disabled={pending === "updateDraft"}
          onChange={(e) => setForm({ ...form, isLease: e.target.checked })} />
      </label>
      {field("shipVia", "Ship via")}
      {field("shippingInstructions", "Shipping instructions")}
      {field("specialInstructions", "Special instructions")}
      {field("shippingMinor", "Shipping")}
      {field("installChargeMinor", "Install charge")}
      {field("taxMinor", "Tax")}
      {field("downPaymentMinor", "Down payment")}
      {field("tradeInMinor", "Trade-in")}
      {error && <p role="alert" className="fo-error">{error}</p>}
      <Button variant="primary" disabled={pending === "updateDraft"} onClick={submit}>Save terms</Button>
      <Button variant="ghost" disabled={pending === "updateDraft"} onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}

// `hasCapability` defaults to fail-closed, so any caller that injects nothing -- every unit and
// component test -- gets no live controls, exactly the convention SalesOrderDetail already follows.
export default function SalesAgreementPanel({ agreement, hasCapability = () => false, entityResolver = null }) {
  const { view, create, updateDraft, accept, pending, commandError } = agreement;
  const [editingLines, setEditingLines] = useState(null);
  const can = (id) => hasCapability(id) === true;
  const capabilityDecisions = useMemo(
    () => Object.fromEntries(SALES_AGREEMENT_CAPABILITY_REQUEST.map((id) => [id, hasCapability(id) === true])),
    [hasCapability],
  );

  const record = useMemo(() => (view.kind === STATE.READY ? view : null), [view]);
  const acceptability = useMemo(() => agreementAcceptability(view), [view]);

  if (view.kind === STATE.LOADING) return <p className="fo-muted">Loading the agreement…</p>;
  // Denied and unavailable stay apart: one says "you may not see this", the other "we could not
  // ask". Collapsing them tells a permitted user they lack permission whenever the network is down.
  // NOT DEPLOYED IS NOT DENIED. Saying "you do not have permission" about a feature that is simply
  // not live in this environment sends somebody to ask an administrator for access that would not
  // help them.
  if (view.kind === STATE.NOT_ENABLED) {
    return <p className="fo-muted">Sales Agreements are not enabled in this environment yet.</p>;
  }
  if (view.kind === STATE.DENIED) return <p className="fo-muted">You do not have permission to view Sales Agreements.</p>;
  if (view.kind === STATE.UNAVAILABLE) return <p role="alert" className="fo-error">The Sales Agreement could not be loaded.</p>;

  if (view.kind === STATE.NONE) {
    return (
      <section className="fo-agreement-panel">
        <h3>Sales Agreement</h3>
        {commandError && <p role="alert" className="fo-error">{commandError}</p>}
        <CreateForm onCreate={create} pending={pending} canCreate={can(SALES_AGREEMENT_CREATE_CAPABILITY)} />
      </section>
    );
  }

  const editable = agreementIsEditable(view) && can(SALES_AGREEMENT_UPDATE_DRAFT_CAPABILITY);
  const saveLines = async () => {
    const built = buildLines(editingLines);
    if (built.error) return;
    const res = await updateDraft(view.id, { lines: built.lines });
    if (res.ok) setEditingLines(null);
  };

  return (
    <section className="fo-agreement-panel">
      <header className="fo-agreement-header">
        {/* The allocated reference, never the document id. */}
        <h3>{salesAgreementLabel(view)}</h3>
        <StatusPill tone={STATE_TONE[view.state] ?? "neutral"} label={STATE_LABEL[view.state] ?? "Unknown"} />
        <span className="fo-agreement-total">{money(view.totalMinor, view.currency)}</span>
      </header>

      {commandError && <p role="alert" className="fo-error">{commandError}</p>}

      <MetadataRecordPage
        definition={salesAgreementRecordPage}
        record={record}
        embedded
        entityResolver={entityResolver}
        capabilityDecisions={capabilityDecisions}
        // NO PENCILS, AND THAT IS A CHOICE ABOUT SCOPE RATHER THAN AUTHORITY.
        //
        // Passing no handler means the shell renders none. Per-field editing would need a field
        // editor per type — currency in major units, a closed enum, a boolean — and Owner §G asks
        // for the minimum UI that makes the chain usable, not a form builder. Terms are edited
        // through the one bounded form below, which submits the SAME bounded command.
        onEditField={null}
      />

      {editable && (
        <TermsForm view={view} pending={pending} onSave={(patch) => updateDraft(view.id, patch)} />
      )}

      <div className="fo-agreement-lines-block">
        <h4>Lines</h4>
        {editingLines ? (
          <>
            <LinesEditor lines={editingLines} onChange={setEditingLines} disabled={pending === "updateDraft"} />
            <Button variant="primary" disabled={pending === "updateDraft"} onClick={saveLines}>Save lines</Button>
            <Button variant="ghost" disabled={pending === "updateDraft"} onClick={() => setEditingLines(null)}>Cancel</Button>
          </>
        ) : (
          <>
            <table className="fo-table">
              <thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Extended</th></tr></thead>
              <tbody>
                {view.lines.map((l) => (
                  <tr key={l.lineId}>
                    <td>{l.ref ?? "—"}</td>
                    <td>{l.quantity ?? "—"}</td>
                    {/* An unpriced line reads as "Not priced", not as an em dash that could be
                        mistaken for zero and not as a 0.00 that says the line is free. */}
                    <td>{l.unitPriceMinor === null ? <span className="fo-muted">Not priced</span> : money(l.unitPriceMinor, view.currency)}</td>
                    <td>{l.extendedMinor === null ? <span className="fo-muted">—</span> : money(l.extendedMinor, view.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {editable && (
              <Button variant="ghost" onClick={() => setEditingLines(view.lines.map((l) => ({
                kind: l.kind ?? "PART", ref: l.ref ?? "", quantity: String(l.quantity ?? 1),
                unitPrice: l.unitPriceMinor === null ? "" : String(l.unitPriceMinor / 100),
              })))}>
                Edit lines
              </Button>
            )}
          </>
        )}
      </div>

      {/* THE ACCEPTANCE ACTION. Deliberately its own block, visually apart from every editing
          affordance above, with its consequence written next to it. */}
      {view.state === "DRAFT" && (
        <div className="fo-agreement-accept">
          <Button
            variant="primary"
            disabled={!acceptability.canAccept || !can(SALES_AGREEMENT_ACCEPT_CAPABILITY) || pending === "accept"}
            onClick={() => accept(view.id)}
          >
            {pending === "accept" ? "Accepting…" : "Accept agreement"}
          </Button>
          <p className="fo-muted">
            Accepting commits these prices. The agreement cannot be edited afterwards, and the Sales
            Order created when this Opportunity is won will carry exactly these lines.
          </p>
          {/* The REASON, not a bare disabled control. */}
          {acceptability.reason && <p className="fo-muted">{acceptability.reason}</p>}
          {!can(SALES_AGREEMENT_ACCEPT_CAPABILITY) && <p className="fo-muted">{SALES_AGREEMENT_DISABLED_REASON.accept}</p>}
        </div>
      )}

      {view.salesOrderId && (
        <p>
          {/* The link's LABEL is what it is, not the id it routes by. */}
          <Link to={`/customers/opportunities/sales-order/${view.salesOrderId}`}>View the Sales Order this became</Link>
        </p>
      )}
    </section>
  );
}
