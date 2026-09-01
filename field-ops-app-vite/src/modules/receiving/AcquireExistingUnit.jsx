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
// ============================ TWO STAGES, NOT ONE SCROLL ============================
//
// Review assembles; Confirm commits. The read-back used to sit inline beneath the fields, appearing
// the moment the last one was filled — so completing the form silently armed the write, and the
// summary a person was meant to CHECK shared a scroll with the controls they were still editing.
// Nothing distinguished "I am filling this in" from "I have read this back and I mean it". Only the
// second stage calls the backend, and Back returns to the form with every answer intact.
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
  ACQUIRE_STAGE,
  ACQUIRE_SUBMIT,
  EMPTY_ACQUIRE_FORM,
  acquireConfirmationSummary,
  buildAcquireRequest,
  deriveAcquireAction,
  deriveAcquireReviewAction,
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
import {
  ACQUIRE_LOCATION_STATE,
  deriveAcquireLocationState,
  retainedLocationId,
} from "../../domain/acquireLocationState";
import { callAcquireSerializedAsset } from "../../services/serializedAssetAcquireCallableClient";
import { SERIAL_PARTS_STATUS, useSerialTrackedParts } from "../../hooks/useSerialTrackedParts";
import { Button } from "../../shared/ui/primitives";
import Modal from "../../shared/ui/Modal.jsx";

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

/** The governed order, which is also the order a person moves through. */
const FIELD_ORDER = Object.freeze(["part", "serialNo", "location", "reason", "note"]);

/** One stacked field: label above, full-width control, its own message beneath. Nothing inline. */
function Field({ id, label, optional = false, hint = null, problem = null, children }) {
  return (
    <div className="fo-form-field" data-acquire-field={id}>
      <label className="fo-wizard-field-label" htmlFor={id}>
        {label}
        {optional ? <span className="fo-field-required"> (optional)</span> : null}
      </label>
      {children}
      {hint ? <p className="fo-wizard-hint">{hint}</p> : null}
      {problem ? (
        <p className="fo-wizard-error fo-error" role="alert" data-acquire-problem={id}>{problem}</p>
      ) : null}
    </div>
  );
}

export default function AcquireExistingUnit({
  canAcquire,
  locationOptions = [],
  locationsStatus = null,
  onClose,
  onAcquired,
  onRetryLocations = null,
  deps = {},
}) {
  const [form, setForm] = useState(EMPTY_ACQUIRE_FORM);
  const [stage, setStage] = useState(ACQUIRE_STAGE.FORM);
  // A FIELD IS NOT WRONG BEFORE IT HAS BEEN VISITED. Rendering all four messages on the first frame
  // opened the dialog in red — four accusations about a form nobody had touched, which teaches a
  // person to read past the colour rather than to trust it. The messages are exact and they stay;
  // they simply wait until the field has been used and left incomplete. What is outstanding overall
  // is never hidden: the action says so from the first frame, in its own words.
  const [touched, setTouched] = useState(() => new Set());
  const touch = (field) => setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
  const [submit, setSubmit] = useState({ status: ACQUIRE_SUBMIT.IDLE, message: null, serializedAssetId: null });
  const attemptToken = useAttemptToken();
  const call = deps.callAcquire ?? callAcquireSerializedAsset;

  // The parts this command will actually accept: SERIAL-tracked, offered by name, never by key.
  const parts = (deps.useParts ?? useSerialTrackedParts)({ enabled: canAcquire });

  // ONE governed location state, derived rather than compared against by hand. Everything the picker
  // needs — the options, whether it may be used, and the single sentence that goes with it — comes
  // from here, so a chosen location and a failure message cannot both be on screen.
  const locations = deriveAcquireLocationState({ status: locationsStatus, options: locationOptions });

  // THE INVARIANT, APPLIED BEFORE ANYTHING READS THE FORM. If the governed read stopped being READY,
  // a previously chosen id is not a default worth keeping — nothing currently vouches for it.
  const governedForm = useMemo(() => {
    const retained = retainedLocationId(form.locationId, locations);
    return retained === form.locationId ? form : { ...form, locationId: retained };
  }, [form, locations]);

  const { problems } = validateAcquireForm(governedForm);
  // A field is answerable once it has been used OR once the person has moved PAST it. Without the
  // second half the reason message would be unreachable: a radio group with no default is only ever
  // "used" by choosing one, which is exactly the act that resolves it — so skipping it could never
  // be pointed at. What is outstanding overall is never hidden either way; the action says so from
  // the first frame.
  const reached = (field) => {
    const at = FIELD_ORDER.indexOf(field);
    return at >= 0 && FIELD_ORDER.some((other, index) => index >= at && touched.has(other));
  };
  const problemFor = (field) => (reached(field) ? problems.find((p) => p.field === field)?.message ?? null : null);

  const review = deriveAcquireReviewAction({ canAcquire, form: governedForm });
  const confirm = deriveAcquireAction({ canAcquire, form: governedForm, submitStatus: submit.status });

  const chosenPart = parts.options.find((o) => o.value === governedForm.partId) ?? null;
  const chosenLocation = locations.options.find((o) => o.value === governedForm.locationId) ?? null;
  const readback = acquireConfirmationSummary({ form: governedForm, part: chosenPart, location: chosenLocation });

  const busy = submit.status === ACQUIRE_SUBMIT.SUBMITTING;
  const controlsDisabled = !canAcquire || busy;

  async function acquire() {
    // GUARDED AGAINST THE DOUBLE-CLICK before anything else. The idempotency key makes a duplicate
    // harmless, but a second in-flight request is still a second request, and the person watching
    // two spinners has no way to know which they are waiting for.
    if (!confirm.enabled) return;
    setSubmit({ status: ACQUIRE_SUBMIT.SUBMITTING, message: null, serializedAssetId: null });

    const request = buildAcquireRequest(governedForm, { attemptToken });
    if (!request) {
      setSubmit({ status: ACQUIRE_SUBMIT.FAILED, message: "That request is incomplete.", serializedAssetId: null });
      return;
    }
    const result = interpretAcquireResult(await call(request));
    setSubmit(result);
    if (result.status === ACQUIRE_SUBMIT.ACQUIRED) {
      // THE FORM IS GONE, not merely disabled. A completed acquisition leaves no controls to press
      // again — the replay would be governed and harmless, but a surface that still looks armed
      // after it has fired is how somebody comes to press it twice.
      setStage(ACQUIRE_STAGE.DONE);
      // Reconcile the governed reads that now have a new unit to show. It does NOT navigate into an
      // Equipment record: acquiring creates none, and sending somebody to one that does not exist
      // would be the most confusing possible success.
      onAcquired?.(result.serializedAssetId, { replayed: result.replayed });
    }
  }

  const partsUnavailable = parts.status === SERIAL_PARTS_STATUS.DENIED
    || parts.status === SERIAL_PARTS_STATUS.UNAVAILABLE;
  const partsProblem = partsUnavailable
    ? (parts.status === SERIAL_PARTS_STATUS.DENIED
      ? "You are not able to read the parts catalogue, so no part can be chosen."
      : "The parts catalogue could not be read. Try again later.")
    : problemFor("part");

  // NORTH STAR FRAME 1c — the flow is HOSTED in the shared Modal overlay as a side sheet. The
  // sheet has ONE identity (the Modal's own title); the stage renders a subordinate heading only
  // where it changes the act (Confirm), and the lede tells the truth of the CURRENT stage — after
  // success the surface stops looking armed, so the consequence sentence is replaced by the
  // post-state. Closing is the Modal contract (Escape / ✕ / backdrop / Cancel): before Confirm it
  // discards only local draft input; while the write is in flight it is inert, because a sheet
  // that vanishes mid-command leaves the operator unable to see the answer.
  return (
    <Modal
      title="Add existing unit"
      variant="sheet"
      closeLabel="Close the sheet"
      onClose={busy ? () => {} : onClose}
    >
      <div className="fo-acquire" data-acquire-stage={stage}>
      {stage === ACQUIRE_STAGE.CONFIRM ? (
        <h3 className="fo-acquire__stage">Confirm acquisition</h3>
      ) : null}
      <p className="fo-muted fo-acquire__lede">
        {stage === ACQUIRE_STAGE.FORM
          ? "This records a serialized unit the company already owns. It does not create a purchase order or supplier receipt."
          : stage === ACQUIRE_STAGE.CONFIRM
            ? ACQUIRE_CONSEQUENCE
            : "The unit is recorded as company-owned, AVAILABLE stock at the chosen company location. No purchase order, supplier receipt, Equipment record, or customer assignment was created."}
      </p>

      {/* THE CAPABILITY IS SAID OUT LOUD, not implied by a greyed control. The server re-checks it
          inside the transaction regardless; this only decides what to render. */}
      {!canAcquire ? <p className="fo-error" role="alert">{review.reason}</p> : null}

      {stage === ACQUIRE_STAGE.FORM ? (
        <div className="fo-acquire__form">
          <Field id="acquire-part" label="Part" problem={partsProblem}>
            <select
              id="acquire-part"
              className="fo-wizard-control"
              value={governedForm.partId}
              onChange={(e) => { touch("part"); setForm((prev) => selectPart(prev, e.target.value)); }}
              onBlur={() => touch("part")}
              disabled={controlsDisabled || partsUnavailable}
              aria-invalid={partsProblem ? "true" : undefined}
            >
              <option value="">
                {parts.status === SERIAL_PARTS_STATUS.LOADING ? "Loading parts…" : "Select serial-tracked part…"}
              </option>
              {parts.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {/* An empty catalogue is a fact about the catalogue, not a failed read, and says so in
                its own words rather than borrowing the error's. */}
            {parts.status === SERIAL_PARTS_STATUS.READY && parts.options.length === 0 ? (
              <p className="fo-wizard-hint">
                No serial-tracked parts are recorded. Only serial-tracked parts have individual units.
              </p>
            ) : null}
          </Field>

          <Field id="acquire-serial" label="Serial number" problem={problemFor("serialNo")}>
            <input
              id="acquire-serial"
              className="fo-wizard-control"
              type="text"
              value={governedForm.serialNo}
              onChange={(e) => { touch("serialNo"); setForm((prev) => setSerialNo(prev, e.target.value)); }}
              onBlur={() => touch("serialNo")}
              disabled={controlsDisabled}
              placeholder="The serial stamped on the unit"
              aria-invalid={problemFor("serialNo") ? "true" : undefined}
            />
          </Field>

          {/* ── THE GOVERNED LOCATION. One state, one message, and no selection unless it is READY. */}
          <Field
            id="acquire-location"
            label="Company location"
            problem={locations.selectable ? problemFor("location") : null}
          >
            <select
              id="acquire-location"
              className="fo-wizard-control"
              value={governedForm.locationId}
              onChange={(e) => { touch("location"); setForm((prev) => selectLocation(prev, e.target.value)); }}
              onBlur={() => touch("location")}
              disabled={controlsDisabled || locations.disabled}
              data-acquire-location-state={locations.state}
              aria-invalid={problemFor("location") && locations.selectable ? "true" : undefined}
            >
              <option value="">{locations.placeholder}</option>
              {/* The SAME governed warehouse options Receiving uses. A customer's location is not in
                  this list and the command would refuse one anyway — a unit is not installed merely
                  by being acquired. In every non-READY state this list is empty by construction, so
                  a value cannot be displayed beside a message saying it could not be read. */}
              {locations.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {locations.message ? (
              <p
                className={locations.state === ACQUIRE_LOCATION_STATE.LOADING ? "fo-wizard-hint" : "fo-wizard-error fo-error"}
                role={locations.state === ACQUIRE_LOCATION_STATE.LOADING ? undefined : "alert"}
                data-acquire-location-message={locations.state}
              >
                {locations.message}
              </p>
            ) : null}
            {locations.retryable && onRetryLocations ? (
              <Button variant="secondary" onClick={onRetryLocations}>Try again</Button>
            ) : null}
          </Field>

          {/* RADIOS, NOT A SELECT, and stacked rather than run together. Three mutually exclusive
              reasons a person has to read and choose between — each with what it MEANS on its own
              line, because three labels in a row read as one sentence. A closed set with no default:
              there is no reason that would be true by omission. */}
          <fieldset className="fo-form-field fo-acquire__reasons" data-acquire-field="reason">
            <legend className="fo-wizard-field-label">Reason</legend>
            {ACQUIRE_REASON_VALUES.map((value) => (
              <label key={value} className="fo-acquire__reason" data-acquire-reason={value}>
                <input
                  type="radio"
                  name="acquire-reason"
                  value={value}
                  checked={governedForm.reason === value}
                  onChange={() => { touch("reason"); setForm((prev) => selectReason(prev, value)); }}
                  disabled={controlsDisabled}
                />
                <span className="fo-acquire__reason-body">
                  <span className="fo-acquire__reason-label">{ACQUIRE_REASON_LABEL[value]}</span>
                  <span className="fo-acquire__reason-hint">{ACQUIRE_REASON_HINT[value]}</span>
                </span>
              </label>
            ))}
            {problemFor("reason") ? (
              <p className="fo-wizard-error fo-error" role="alert" data-acquire-problem="reason">
                {problemFor("reason")}
              </p>
            ) : null}
          </fieldset>

          <Field
            id="acquire-note"
            label="Provenance note"
            optional
            hint="Supporting context only. It does not replace the required reason."
          >
            <input
              id="acquire-note"
              className="fo-wizard-control"
              type="text"
              value={governedForm.provenanceNote}
              onChange={(e) => { touch("note"); setForm((prev) => setProvenanceNote(prev, e.target.value)); }}
              onBlur={() => touch("note")}
              disabled={controlsDisabled}
              placeholder="Where it came from, who confirmed it"
            />
          </Field>
        </div>
      ) : null}

      {/* ══════════════ THE READ-BACK, on its own screen, before a write with no undo ══════════════
          Labelled rows rather than one sentence a reader skims. It is built from the same form the
          fields wrote, so nothing here can disagree with what was entered. */}
      {stage !== ACQUIRE_STAGE.FORM && readback ? (
        <section className="fo-confirm-readback" aria-labelledby="acquire-confirm-heading">
          <h4 id="acquire-confirm-heading" className="fo-visually-hidden">Acquisition details</h4>
          <dl className="fo-detail-list">
            {readback.map((row) => (
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
          className={submit.status === ACQUIRE_SUBMIT.ACQUIRED ? "fo-acquire__result" : "fo-error"}
          role={submit.status === ACQUIRE_SUBMIT.ACQUIRED ? "status" : "alert"}
          data-acquire-result={submit.status}
        >
          {submit.message}
        </p>
      ) : null}

      <div className="fo-form-actions">
        {stage === ACQUIRE_STAGE.FORM ? (
          <Button variant="primary" onClick={() => setStage(ACQUIRE_STAGE.CONFIRM)} disabled={!review.enabled}>
            Review acquisition
          </Button>
        ) : null}
        {stage === ACQUIRE_STAGE.CONFIRM ? (
          <>
            <Button variant="primary" onClick={acquire} disabled={!confirm.enabled}>
              {busy ? "Adding…" : "Confirm acquisition"}
            </Button>
            <Button variant="secondary" onClick={() => setStage(ACQUIRE_STAGE.FORM)} disabled={busy}>
              Back
            </Button>
          </>
        ) : null}
        {/* Cancel belongs to the form, where leaving means abandoning what you typed. On the
            confirm screen Back is the way out, and a third button beside an irreversible one is a
            place to misclick. */}
        {stage === ACQUIRE_STAGE.FORM ? (
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        ) : null}
        {stage === ACQUIRE_STAGE.DONE ? (
          <Button variant="secondary" onClick={onClose}>Close</Button>
        ) : null}
      </div>

      {/* WHY THE NEXT STEP IS UNAVAILABLE, in words, beside the control it is about. Not the same
          sentence the fields already carry — those say what to type; this says what is outstanding.
          Suppressed once the form is complete, and on the confirm stage, where the only reasons left
          are the capability and a write already in flight. */}
      {stage === ACQUIRE_STAGE.FORM && canAcquire && !review.enabled && review.reason ? (
        <p className="fo-muted" data-acquire-blocking>{review.reason}</p>
      ) : null}
      </div>
    </Modal>
  );
}
