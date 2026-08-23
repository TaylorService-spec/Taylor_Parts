// FINISHING AN INSTALLATION JOB — the decisions, with no network and no React.
//
// ============================ TWO CALLS, ONE OUTCOME, ONE ORDER ============================
//
// Recording the installation and completing the Work Order are two separate trusted commands, and
// two callables cannot share a transaction. The order is what keeps them honest:
//
//   1. record the installation
//   2. complete the Work Order
//
// A completed job whose installation failed is therefore impossible — completion is never attempted
// until the installation has already succeeded. The cost is a visible, recoverable in-between state:
// the machine is installed and the job is not yet closed. That state has a name here, a message, and
// a resume path, because the alternative is a technician who cannot tell what happened.
//
// ============================ THE INSTALL IS NEVER ROLLED BACK ============================
//
// If completion fails after a successful install, the machine stays installed. It really is at the
// customer; undoing the record to tidy up a failed second step would make the platform disagree with
// the physical world, and there is no uninstall authority to do it with anyway.
//
// ============================ THE OFFLINE SEAM ============================
//
// This module models a PENDING_SYNC intent so the workflow is compatible with the technician offline
// runtime that does not exist yet. A pending intent is a RECORD OF WHAT THE TECHNICIAN DID, never a
// claim about what the platform accepted: it must never display as INSTALLED or COMPLETED, because
// only the server can say those words. Authority is re-resolved on sync; being offline never grants
// anything.
//
// PURE: no firebase, no React, no clock of its own. Tested in workOrderInstallCloseout.test.mjs.

/** Where a closeout attempt has actually got to. */
export const CLOSEOUT_STATE = Object.freeze({
  IDLE: "IDLE",
  UNIT_SELECTED: "UNIT_SELECTED",
  INSTALLING: "INSTALLING",
  /** Installed, job still open. The recoverable middle — visible, never silent. */
  INSTALLED_COMPLETION_PENDING: "INSTALLED_COMPLETION_PENDING",
  COMPLETING: "COMPLETING",
  DONE: "DONE",
  FAILED: "FAILED",
  /** Captured offline. NOT installed, NOT completed — only the server may say those. */
  PENDING_SYNC: "PENDING_SYNC",
});

/** What a sync attempt concluded. Never inferred from the absence of an error. */
export const SYNC_OUTCOME = Object.freeze({
  SYNCED: "SYNCED",
  CONFLICT: "CONFLICT",
  REFUSED: "REFUSED",
  NEEDS_ATTENTION: "NEEDS_ATTENTION",
});

/** Backend refusal codes this flow treats as specific rather than generic. */
export const CLOSEOUT_FAILURE = Object.freeze({
  NOT_ASSIGNED_TECHNICIAN: "NOT_ASSIGNED_TECHNICIAN",
  WORK_ORDER_NOT_INSTALL_TYPE: "WORK_ORDER_NOT_INSTALL_TYPE",
  WORK_ORDER_STATE_INVALID: "WORK_ORDER_STATE_INVALID",
  ASSET_INSTALLED_ELSEWHERE: "ASSET_INSTALLED_ELSEWHERE",
  ASSET_NOT_INSTALLABLE: "ASSET_NOT_INSTALLABLE",
  ASSET_NOT_WHOLE_UNIT: "ASSET_NOT_WHOLE_UNIT",
  ASSET_NOT_FOUND: "ASSET_NOT_FOUND",
  PERMISSION_DENIED: "PERMISSION_DENIED",
});

/** What each refusal means to the person holding the machine. */
const FAILURE_MESSAGE = Object.freeze({
  [CLOSEOUT_FAILURE.NOT_ASSIGNED_TECHNICIAN]: "This work order is not assigned to you.",
  [CLOSEOUT_FAILURE.WORK_ORDER_NOT_INSTALL_TYPE]: "This work order is not an installation job.",
  [CLOSEOUT_FAILURE.WORK_ORDER_STATE_INVALID]: "This work order is not in progress, so an installation cannot be recorded on it.",
  [CLOSEOUT_FAILURE.ASSET_INSTALLED_ELSEWHERE]: "That unit is already installed for another customer. Check the serial.",
  [CLOSEOUT_FAILURE.ASSET_NOT_INSTALLABLE]: "That unit is not in a state that can be installed.",
  [CLOSEOUT_FAILURE.ASSET_NOT_WHOLE_UNIT]: "That serial is a part, not a machine.",
  [CLOSEOUT_FAILURE.ASSET_NOT_FOUND]: "That serial could not be found.",
  [CLOSEOUT_FAILURE.PERMISSION_DENIED]: "You are not authorized to record an equipment installation.",
});

export const COMPLETION_PENDING_MESSAGE =
  "Installation recorded — Work Order completion still required.";

const str = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/**
 * The identity of ONE installation intent.
 *
 * Deterministic from the job and the machine, plus a token minted when the technician commits. Two
 * consequences, both deliberate:
 *
 *   a retry of the same intent carries the same key, so the server replays instead of installing twice
 *   choosing a DIFFERENT machine changes the key, so a correction is a new request rather than a
 *   replay that would return the earlier, wrong Equipment
 *
 * Deterministic also means an OFFLINE capture can mint it before there is any network, and the same
 * key survives to the eventual sync.
 */
export function deriveCloseoutIntentId(workOrderId, serializedAssetId, attemptToken) {
  const wo = str(workOrderId), sa = str(serializedAssetId), tok = str(attemptToken);
  if (!wo || !sa || !tok) return null;
  const safe = (v) => v.replace(/[^A-Za-z0-9_-]/g, "-");
  return `woinstall_${safe(wo)}_${safe(sa)}_${safe(tok)}`;
}

/**
 * Read the install call's answer.
 *
 * `already_installed_for_this_work_order` is a SUCCESS, not a failure: the machine is at the
 * customer. Treating it as an error would leave a technician retrying an installation that already
 * happened.
 */
export function interpretInstallStep(result) {
  const outcome = result?.outcome ?? null;
  if (outcome && (outcome.outcome === "installed" || outcome.outcome === "replayed"
    || outcome.outcome === "already_installed_for_this_work_order")) {
    return {
      ok: true,
      equipmentId: str(outcome.equipmentId),
      alreadyInstalled: outcome.outcome === "already_installed_for_this_work_order",
      completionRequired: outcome.completionRequired !== false,
      workOrderStatus: str(outcome.workOrderStatus),
    };
  }
  const code = str(result?.error?.details) ?? str(result?.error?.code) ?? null;
  return {
    ok: false,
    code,
    message: FAILURE_MESSAGE[code] ?? str(result?.error?.message) ?? "The installation could not be recorded.",
  };
}

/**
 * What to do after the install step succeeded.
 *
 * The completion call is skipped entirely when the server says it is not required — a job already
 * completed by a request whose response was lost must not be completed a second time, and
 * `transitionWorkOrder` is deliberately not idempotent.
 */
export function deriveCompletionStep(installStep) {
  if (!installStep?.ok) return { complete: false, reason: "the installation was not recorded" };
  if (installStep.completionRequired === false) {
    return { complete: false, reason: "this work order is already complete" };
  }
  return { complete: true, reason: null };
}

/**
 * The state after both steps have been attempted.
 *
 * The middle case is the one that matters: installed, not completed. It gets its own state and its
 * own message rather than being reported as a failure, because reporting it as a failure would
 * invite a technician to install again.
 */
export function deriveCloseoutState({ installStep, completionError, completionAttempted }) {
  if (!installStep) return { state: CLOSEOUT_STATE.IDLE, message: null, equipmentId: null };
  if (!installStep.ok) {
    return { state: CLOSEOUT_STATE.FAILED, message: installStep.message, equipmentId: null, code: installStep.code ?? null };
  }
  if (!completionAttempted || installStep.completionRequired === false) {
    return {
      state: installStep.completionRequired === false ? CLOSEOUT_STATE.DONE : CLOSEOUT_STATE.INSTALLED_COMPLETION_PENDING,
      message: installStep.completionRequired === false ? "Installed. This work order is already complete." : COMPLETION_PENDING_MESSAGE,
      equipmentId: installStep.equipmentId,
    };
  }
  if (completionError) {
    return {
      state: CLOSEOUT_STATE.INSTALLED_COMPLETION_PENDING,
      message: COMPLETION_PENDING_MESSAGE,
      equipmentId: installStep.equipmentId,
      // The install is NEVER undone because completion failed. The machine is at the customer.
      installRetained: true,
    };
  }
  return { state: CLOSEOUT_STATE.DONE, message: "Installed and work completed.", equipmentId: installStep.equipmentId };
}

/**
 * Resuming after a partial success.
 *
 * The technician does not choose the serial again. The install is re-attempted only in the sense that
 * the same command is called with the same intent — the server answers from the database, recognises
 * the existing installation, and the flow moves straight to completion.
 */
export function deriveResumePlan(state) {
  if (state?.state !== CLOSEOUT_STATE.INSTALLED_COMPLETION_PENDING) {
    return { resumable: false, action: null };
  }
  return {
    resumable: true,
    action: "COMPLETE_ONLY",
    // Said out loud so the button does not imply a second installation.
    label: "Complete work order",
    note: "The installation is already recorded. Only the work order still has to be completed.",
  };
}

// ── THE OFFLINE SEAM ──────────────────────────────────────────────────────────────────────────

/**
 * Capture an installation intent without a network.
 *
 * Everything needed to execute it later, and NOTHING that claims it happened. `capturedAtLocal` is
 * explicitly local: the authoritative timestamp is the server's, and a device clock must never be
 * mistaken for one.
 */
export function captureOfflineIntent({ workOrderId, serializedAssetId, serialNo, notes, attemptToken, capturedAtLocal }) {
  const intentId = deriveCloseoutIntentId(workOrderId, serializedAssetId ?? serialNo, attemptToken);
  if (!intentId) return null;
  return {
    intentId,
    workOrderId: str(workOrderId),
    // Either identity is enough to capture; the scan may have produced only a serial.
    serializedAssetId: str(serializedAssetId),
    serialNo: str(serialNo),
    notes: str(notes),
    capturedAtLocal: capturedAtLocal ?? null,
    state: CLOSEOUT_STATE.PENDING_SYNC,
  };
}

/**
 * What a pending intent may say on screen.
 *
 * Never INSTALLED, never COMPLETED. A device that has not spoken to the server does not know whether
 * the technician still holds the capability, whether the work order still exists, or whether somebody
 * else installed that unit an hour ago.
 */
export function describePendingIntent(intent) {
  if (intent?.state !== CLOSEOUT_STATE.PENDING_SYNC) return null;
  return {
    label: "Waiting to sync",
    detail: "Recorded on this device. It is not installed or completed until the server confirms it.",
    claimsInstalled: false,
    claimsCompleted: false,
  };
}

/**
 * The steps a sync must perform, in order.
 *
 * Written down rather than left to the future runtime, because the order IS the safety: authority and
 * state are re-resolved server-side before anything is executed, so an intent captured while
 * authorized cannot execute after that authority is gone.
 */
export const SYNC_PLAN = Object.freeze([
  "authenticate",
  "re-resolve equipment.install",
  "re-read the work order",
  "re-read the serialized asset",
  "verify state and authority",
  "record the installation",
  "complete the work order",
  "reconcile local state",
]);

/** Interpret a sync attempt. An unrecognised answer is NEEDS_ATTENTION, never SYNCED. */
export function interpretSync({ installStep, completionError, completionAttempted }) {
  if (!installStep) return { outcome: SYNC_OUTCOME.NEEDS_ATTENTION, message: "The installation was not attempted." };
  if (!installStep.ok) {
    const refused = installStep.code === CLOSEOUT_FAILURE.PERMISSION_DENIED
      || installStep.code === CLOSEOUT_FAILURE.NOT_ASSIGNED_TECHNICIAN;
    const conflict = installStep.code === CLOSEOUT_FAILURE.ASSET_INSTALLED_ELSEWHERE
      || installStep.code === CLOSEOUT_FAILURE.ASSET_NOT_INSTALLABLE;
    return {
      outcome: refused ? SYNC_OUTCOME.REFUSED : conflict ? SYNC_OUTCOME.CONFLICT : SYNC_OUTCOME.NEEDS_ATTENTION,
      message: installStep.message,
    };
  }
  const derived = deriveCloseoutState({ installStep, completionError, completionAttempted });
  return derived.state === CLOSEOUT_STATE.DONE
    ? { outcome: SYNC_OUTCOME.SYNCED, message: derived.message, equipmentId: derived.equipmentId }
    : { outcome: SYNC_OUTCOME.NEEDS_ATTENTION, message: derived.message, equipmentId: derived.equipmentId };
}
