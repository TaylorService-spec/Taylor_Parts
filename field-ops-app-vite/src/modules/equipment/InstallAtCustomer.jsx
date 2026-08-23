// INSTALL A UNIT AT A CUSTOMER — the confirm-before-permanent surface.
//
// ============================ WHY THIS IS A DELIBERATE, SLOW FLOW ============================
//
// Installation cannot be undone. Equipment accountId and locationId are immutable after create,
// nothing clears the serialized asset's link, and recovery is an authority that does not exist yet.
// So the last screen before the write reads the whole thing back -- unit, serial, model, customer,
// location -- and the button says what it does rather than "Save".
//
// ============================ WHAT IS PREVENTED, AND WHERE ============================
//
//   choices that cannot work      the location list is filtered to the chosen customer's own sites,
//                                 and changing customer CLEARS the location so a stale pairing
//                                 cannot survive the switch
//   a mismatch anyway             validateInstallForm refuses it before the call
//   the same one twice            one idempotency key per attempt: a retry replays and returns the
//                                 SAME Equipment; a corrected attempt gets a new key
//   an unauthorized attempt       the action is gated on equipment.install, and the server checks
//                                 again inside its transaction
//
// The server is the authority for all of it. This exists so a person is not walked into a refusal.
import { useMemo, useState } from "react";
import { useLocationsForAccount } from "../../hooks/useLocationsForAccount";
import {
  EMPTY_INSTALL_FORM, INSTALL_SUBMIT,
  buildInstallRequest, deriveInstallAction, interpretInstallResult,
  selectCustomer, selectLocation, validateInstallForm,
} from "../../domain/equipmentInstallForm";
import { callInstallSerializedAsset } from "../../services/equipmentInstallCallableClient";
import { Button } from "../../shared/ui/primitives";

/**
 * One attempt token, minted when the dialog opens.
 *
 * Stable for the life of this attempt so a network retry is recognisably the same request. It is
 * combined with the unit, customer and location in deriveIdempotencyKey, so correcting any of those
 * produces a genuinely new request rather than a replay of the earlier, wrong one.
 */
function useAttemptToken(seed) {
  return useMemo(() => `${seed}-${Date.now().toString(36)}`, [seed]);
}

export default function InstallAtCustomer({ unit, accounts, canInstall, onClose, onInstalled }) {
  const [form, setForm] = useState(() => ({
    ...EMPTY_INSTALL_FORM,
    serializedAssetId: unit?.serializedAssetId ?? null,
    serialNo: unit?.serialNo ?? null,
  }));
  const [submit, setSubmit] = useState({ status: INSTALL_SUBMIT.IDLE, message: null, equipmentId: null });
  const attemptToken = useAttemptToken(unit?.serializedAssetId ?? "unit");

  // The EXISTING scoped read -- locations for one account, already the app's only path to them.
  const { data: locations, loading: locationsLoading } = useLocationsForAccount(form.accountId);
  const locationOptions = Array.isArray(locations) ? locations : [];

  const action = deriveInstallAction({
    canInstall,
    form,
    locations: locationOptions,
    submitStatus: submit.status,
    unitAvailable: unit?.available !== false,
  });
  const { problems } = validateInstallForm(form, { locations: locationOptions });
  const problemFor = (field) => problems.find((p) => p.field === field)?.message ?? null;

  const chosenAccount = accounts?.find?.((a) => a.id === form.accountId) ?? null;
  const chosenLocation = locationOptions.find((l) => l.id === form.locationId) ?? null;

  async function install() {
    // GUARDED AGAINST THE DOUBLE-CLICK before anything else. The idempotency key makes a duplicate
    // harmless, but a second in-flight request is still a second request, and the user watching two
    // spinners has no way to know which one they are waiting for.
    if (!action.enabled) return;
    setSubmit({ status: INSTALL_SUBMIT.SUBMITTING, message: null, equipmentId: null });

    const request = buildInstallRequest(form, {
      attemptToken,
      name: unit?.title ? `${unit.title} (${form.serialNo})` : form.serialNo,
    });
    if (!request) {
      setSubmit({ status: INSTALL_SUBMIT.FAILED, message: "That installation request is incomplete.", equipmentId: null });
      return;
    }
    const result = interpretInstallResult(await callInstallSerializedAsset(request));
    setSubmit(result);
    if (result.status === INSTALL_SUBMIT.INSTALLED && result.equipmentId) {
      onInstalled?.(result.equipmentId, { replayed: result.replayed });
    }
  }

  return (
    <div className="fo-panel" role="dialog" aria-modal="true" aria-labelledby="install-title">
      <h3 id="install-title">Install at customer</h3>

      <dl className="fo-summary">
        <dt>Unit</dt>
        <dd>{unit?.title ?? "—"}</dd>
        <dt>Serial</dt>
        <dd>{unit?.serialNo ?? "—"}</dd>
        {unit?.modelNumber ? (<><dt>Model</dt><dd>{unit.manufacturer} {unit.modelNumber}</dd></>) : null}
        <dt>Line</dt>
        <dd>{unit?.lineLabel ?? "—"}</dd>
        <dt>Currently at</dt>
        <dd>{unit?.location ?? "—"}</dd>
      </dl>

      <label>
        Customer
        <select
          value={form.accountId ?? ""}
          onChange={(e) => setForm((prev) => selectCustomer(prev, e.target.value || null))}
          disabled={submit.status === INSTALL_SUBMIT.SUBMITTING}
        >
          <option value="">Choose a customer…</option>
          {(accounts ?? []).map((a) => (
            <option key={a.id} value={a.id}>{a.name ?? a.id}</option>
          ))}
        </select>
      </label>
      {problemFor("customer") ? <p className="fo-error" role="alert">{problemFor("customer")}</p> : null}

      <label>
        Customer location
        <select
          value={form.locationId ?? ""}
          onChange={(e) => setForm((prev) => selectLocation(prev, e.target.value || null))}
          disabled={!form.accountId || locationsLoading || submit.status === INSTALL_SUBMIT.SUBMITTING}
        >
          <option value="">
            {!form.accountId ? "Choose a customer first…" : locationsLoading ? "Loading locations…" : "Choose a location…"}
          </option>
          {/* Only this customer's locations are offered. The server enforces the same rule; this
              stops the user reaching a confirmation screen for a pairing it will refuse. */}
          {locationOptions.map((l) => (
            <option key={l.id} value={l.id}>{l.name ?? l.id}</option>
          ))}
        </select>
      </label>
      {form.accountId && !locationsLoading && locationOptions.length === 0 ? (
        <p className="fo-muted">This customer has no locations recorded. A unit can only be installed at a location.</p>
      ) : null}
      {problemFor("location") ? <p className="fo-error" role="alert">{problemFor("location")}</p> : null}

      {chosenAccount && chosenLocation ? (
        <p className="fo-confirm">
          Install <strong>{unit?.title}</strong> (S/N {unit?.serialNo}) at{" "}
          <strong>{chosenAccount.name ?? chosenAccount.id}</strong> — {chosenLocation.name ?? chosenLocation.id}.
          {" "}This cannot be undone.
        </p>
      ) : null}

      {submit.message ? (
        <p
          className={submit.status === INSTALL_SUBMIT.INSTALLED ? "fo-success" : "fo-error"}
          role={submit.status === INSTALL_SUBMIT.INSTALLED ? "status" : "alert"}
        >
          {submit.message}
        </p>
      ) : null}

      <div className="fo-actions">
        <Button onClick={install} disabled={!action.enabled} title={action.reason ?? undefined}>
          {submit.status === INSTALL_SUBMIT.SUBMITTING ? "Installing…" : "Install at customer"}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {submit.status === INSTALL_SUBMIT.INSTALLED ? "Close" : "Cancel"}
        </Button>
      </div>
      {/* The reason a disabled button is disabled, said out loud. A greyed control with no
          explanation is the thing this surface exists to avoid. */}
      {!action.enabled && action.reason ? <p className="fo-muted">{action.reason}</p> : null}
    </div>
  );
}
