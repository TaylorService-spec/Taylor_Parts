// ACQUIRE AN EXISTING UNIT — the exceptional stock-entry path, beside the normal one.
//
// ============================ WHAT THIS IS FOR, AND WHY IT IS NOT RECEIVING ============================
//
// The normal way a serialized unit joins company stock is Purchase Order → Receive. This is for the
// units that never took that road: an opening balance, a legacy migration, a machine that has been
// in the van for three years. Quantity stock could always say "we already hold 571 of these" through
// an ADJUSTED movement; serialized stock could not, because its only creator was receipt against a
// purchase order — so the platform could not say "we already own THIS machine" without inventing a
// purchase that never happened.
//
// IT IS NOT "receive without a PO" and it is not "manual receive". Those names blur two authorities:
// receiving records that a delivery ARRIVED, and this records that the company ALREADY OWNS
// something. The acquired unit carries `acquisitionProvenance: NON_PO_ACQUISITION` and NO
// `activatedByReceivingId`, so no report asking "what did we receive?" can ever answer with one.
//
// ============================ WHY IT IS DELIBERATE AND SLOW ============================
//
// This asserts ownership with no supplier document to check it against. There is no purchase order,
// no receipt, no delivery note — only a person saying so, and the audit record naming them. So the
// last screen before the write reads the whole thing back, the button names the act, and the reason
// comes from a closed set in which "we bought it" does not appear.
//
// ============================ WHAT IT DOES NOT DO ============================
//
// It creates no Equipment and no customer relationship. A unit acquired here enters AVAILABLE
// company stock; placing it at a customer is the separate, differently-held `equipment.install`
// authority, and no single person holds both. There is deliberately no field for a supplier, a PO,
// a receipt, a customer or an owner — the command would refuse every one of them.
import { Fragment, useMemo, useState } from "react";
import {
  ACQUIRE_CONSEQUENCE,
  ACQUIRE_SUBMIT,
  EMPTY_ACQUIRE_FORM,
  acquireConfirmationSummary,
  buildAcquireRequest,
  deriveAcquireAction,
  interpretAcquireResult,
  selectLocation,
  selectPart,
  selectReason,
  setProvenanceNote,
  setSerialNo,
  validateAcquireForm,
} from "../../domain/serializedAssetAcquireForm";
import {
  ACQUIRE_REASON_HINT,
  ACQUIRE_REASON_LABEL,
  ACQUIRE_REASON_VALUES,
} from "../../domain/serializedAssetAcquireVocabulary";
import { callAcquireSerializedAsset } from "../../services/serializedAssetAcquireCallableClient";
import { SERIAL_PARTS_STATUS, useSerialTrackedParts } from "../../hooks/useSerialTrackedParts";
import { Button } from "../../shared/ui/primitives";

/**
 * One attempt token, minted when the dialog opens.
 *
 * Stable for the life of this attempt so a network retry is recognisably the same request. It is
 * combined with the part, serial and location in deriveIdempotencyKey, so correcting any of those
 * produces a genuinely new request rather than a replay of the earlier, wrong one.
 */
function useAttemptToken() {
  return useMemo(() => `acq-${Date.now().toString(36)}`, []);
}

export default function AcquireExistingUnit({
  canAcquire,
  locationOptions = [],
  locationsStatus = null,
  onClose,
  onAcquired,
  deps = {},
}) {
  const [form, setForm] = useState(EMPTY_ACQUIRE_FORM);
  const [submit, setSubmit] = useState({ status: ACQUIRE_SUBMIT.IDLE, message: null, serializedAssetId: null });
  const attemptToken = useAttemptToken();
  const call = deps.callAcquire ?? callAcquireSerializedAsset;

  // The parts this command will actually accept: SERIAL-tracked, offered by name, never by key.
  const parts = (deps.useParts ?? useSerialTrackedParts)({ enabled: canAcquire });

  const action = deriveAcquireAction({ canAcquire, form, submitStatus: submit.status });
  const { problems } = validateAcquireForm(form);
  const problemFor = (field) => problems.find((p) => p.field === field)?.message ?? null;

  const chosenPart = parts.options.find((o) => o.value === form.partId) ?? null;
  const chosenLocation = locationOptions.find((o) => o.value === form.locationId) ?? null;
  const confirmation = acquireConfirmationSummary({ form, part: chosenPart, location: chosenLocation });

  async function acquire() {
    // GUARDED AGAINST THE DOUBLE-CLICK before anything else. The idempotency key makes a duplicate
    // harmless, but a second in-flight request is still a second request, and the person watching
    // two spinners has no way to know which they are waiting for.
    if (!action.enabled) return;
    setSubmit({ status: ACQUIRE_SUBMIT.SUBMITTING, message: null, serializedAssetId: null });

    const request = buildAcquireRequest(form, { attemptToken });
    if (!request) {
      setSubmit({ status: ACQUIRE_SUBMIT.FAILED, message: "That request is incomplete.", serializedAssetId: null });
      return;
    }
    const result = interpretAcquireResult(await call(request));
    setSubmit(result);
    if (result.status === ACQUIRE_SUBMIT.ACQUIRED) {
      // Reconcile the governed reads that now have a new unit to show. It does NOT navigate into an
      // Equipment record: acquiring creates none, and sending somebody to one that does not exist
      // would be the most confusing possible success.
      onAcquired?.(result.serializedAssetId, { replayed: result.replayed });
    }
  }

  const partsUnavailable = parts.status === SERIAL_PARTS_STATUS.DENIED
    || parts.status === SERIAL_PARTS_STATUS.UNAVAILABLE;

  return (
    <div className="fo-panel" role="dialog" aria-modal="true" aria-labelledby="acquire-title">
      <h3 id="acquire-title">Add existing unit</h3>
      <p className="fo-muted">
        This records a serialized unit the company already owns. It does not create a purchase order
        or supplier receipt.
      </p>

      {/* THE CAPABILITY IS SAID OUT LOUD, not implied by a greyed control. The server re-checks it
          inside the transaction regardless; this only decides what to render. */}
      {!canAcquire ? <p className="fo-error" role="alert">{action.reason}</p> : null}

      <label>
        Part
        <select
          value={form.partId}
          onChange={(e) => setForm((prev) => selectPart(prev, e.target.value))}
          disabled={!canAcquire || submit.status === ACQUIRE_SUBMIT.SUBMITTING}
        >
          <option value="">
            {parts.status === SERIAL_PARTS_STATUS.LOADING ? "Loading parts…" : "Choose a part…"}
          </option>
          {parts.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      {/* A picker that could not be read says so. An empty one that says nothing reads as "there are
          no serial-tracked parts", which would be a claim about the catalogue rather than the read. */}
      {partsUnavailable ? (
        <p className="fo-error" role="alert">
          {parts.status === SERIAL_PARTS_STATUS.DENIED
            ? "You are not able to read the parts catalogue, so no part can be chosen."
            : "The parts catalogue could not be read. Try again later."}
        </p>
      ) : null}
      {parts.status === SERIAL_PARTS_STATUS.READY && parts.options.length === 0 ? (
        <p className="fo-muted">No serial-tracked parts are recorded. Only serial-tracked parts have individual units.</p>
      ) : null}
      {problemFor("part") ? <p className="fo-error" role="alert">{problemFor("part")}</p> : null}

      <label>
        Serial number
        <input
          type="text"
          value={form.serialNo}
          onChange={(e) => setForm((prev) => setSerialNo(prev, e.target.value))}
          disabled={!canAcquire || submit.status === ACQUIRE_SUBMIT.SUBMITTING}
          placeholder="The serial stamped on the unit"
        />
      </label>
      {problemFor("serialNo") ? <p className="fo-error" role="alert">{problemFor("serialNo")}</p> : null}

      <label>
        Company location
        <select
          value={form.locationId}
          onChange={(e) => setForm((prev) => selectLocation(prev, e.target.value))}
          disabled={!canAcquire || submit.status === ACQUIRE_SUBMIT.SUBMITTING}
        >
          <option value="">Choose a company location…</option>
          {/* The SAME governed warehouse options Receiving uses. A customer's location is not in this
              list and the command would refuse one anyway — a unit is not installed merely by being
              acquired. */}
          {locationOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      {locationsStatus && locationsStatus !== "READY" ? (
        <p className="fo-error" role="alert">
          The company locations could not be read, so none can be chosen.
        </p>
      ) : null}
      {problemFor("location") ? <p className="fo-error" role="alert">{problemFor("location")}</p> : null}

      <fieldset>
        <legend>Why is this being added without a purchase?</legend>
        {/* RADIOS, NOT A SELECT. Three mutually exclusive reasons a person has to read and choose
            between — each with what it MEANS, because three labels alone do not distinguish them.
            A closed set with no default: there is no reason that would be true by omission. */}
        {ACQUIRE_REASON_VALUES.map((value) => (
          <label key={value}>
            <input
              type="radio"
              name="acquire-reason"
              value={value}
              checked={form.reason === value}
              onChange={() => setForm((prev) => selectReason(prev, value))}
              disabled={!canAcquire || submit.status === ACQUIRE_SUBMIT.SUBMITTING}
            />
            <span>{ACQUIRE_REASON_LABEL[value]}</span>
            <span className="fo-muted"> — {ACQUIRE_REASON_HINT[value]}</span>
          </label>
        ))}
      </fieldset>
      {problemFor("reason") ? <p className="fo-error" role="alert">{problemFor("reason")}</p> : null}

      <label>
        Provenance note <span className="fo-muted">(optional)</span>
        <input
          type="text"
          value={form.provenanceNote}
          onChange={(e) => setForm((prev) => setProvenanceNote(prev, e.target.value))}
          disabled={!canAcquire || submit.status === ACQUIRE_SUBMIT.SUBMITTING}
          placeholder="Supporting context — where it came from, who confirmed it"
        />
      </label>
      <p className="fo-muted">
        Supporting context only. It does not stand in for the reason above, which is what the record
        is filed under.
      </p>

      {/* ══════════════ THE READ-BACK, before a write with no undo ══════════════
          Four labelled rows rather than one sentence a reader skims. It is the same dialog and the
          same command — a read-back, not a second step — so nothing here can disagree with the form
          it is reading. */}
      {confirmation ? (
        <section className="fo-confirm-readback" aria-labelledby="acquire-confirm-heading">
          <h4 id="acquire-confirm-heading">Confirm acquisition</h4>
          <p className="fo-confirm-consequence fo-confirm-consequence--destructive">{ACQUIRE_CONSEQUENCE}</p>
          <dl className="fo-detail-list">
            {confirmation.map((row) => (
              <Fragment key={row.key}>
                <dt>{row.label}</dt>
                <dd data-acquire-confirm={row.key}>{row.value}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
      ) : null}

      {submit.message ? (
        <p
          className={submit.status === ACQUIRE_SUBMIT.ACQUIRED ? "fo-muted" : "fo-error"}
          role={submit.status === ACQUIRE_SUBMIT.ACQUIRED ? "status" : "alert"}
          data-acquire-result={submit.status}
        >
          {submit.message}
        </p>
      ) : null}

      <div className="fo-form-actions">
        <Button variant="primary" onClick={acquire} disabled={!action.enabled} title={action.reason ?? undefined}>
          {submit.status === ACQUIRE_SUBMIT.SUBMITTING ? "Adding…" : "Confirm acquisition"}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {submit.status === ACQUIRE_SUBMIT.ACQUIRED ? "Close" : "Cancel"}
        </Button>
      </div>
      {/* The reason a disabled control is disabled, said out loud. A greyed button with no
          explanation is the thing this surface exists to avoid. */}
      {!action.enabled && action.reason ? <p className="fo-muted">{action.reason}</p> : null}
    </div>
  );
}
