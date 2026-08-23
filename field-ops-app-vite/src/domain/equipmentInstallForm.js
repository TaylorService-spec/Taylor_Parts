// INSTALLING A UNIT AT A CUSTOMER — the pure decision layer behind the form.
//
// ============================ WHAT THIS IS FOR ============================
//
// Installation is irreversible. Equipment accountId and locationId are immutable after create and
// nothing clears the asset's link, so a unit placed against the wrong customer stays there, and
// recovery is an authority that does not exist yet.
//
// That makes the form's job unusually specific: make the wrong choice hard to make, and the right
// one impossible to make twice.
//
// ============================ THE CLIENT IS NOT THE AUTHORITY ============================
//
// The backend re-checks that the chosen location belongs to the chosen customer, and its answer is
// the one that counts. Everything here is about not WASTING that check -- narrowing the choices so a
// person is not offered a combination that will be refused, and telling them why when it would be.
//
// A UI that only filtered, and did not also validate, would be trusting its own filter. A UI that
// only validated would be offering choices it knows are wrong. Both are done, and neither replaces
// the server.
//
// PURE: no firebase, no React. Tested in equipmentInstallForm.test.mjs.

export const INSTALL_STEP = Object.freeze({
  UNIT: "unit",             // which machine
  CUSTOMER: "customer",     // whose
  LOCATION: "location",     // where, among that customer's sites
  CONFIRM: "confirm",       // read it back before it becomes permanent
});

export const INSTALL_SUBMIT = Object.freeze({
  IDLE: "idle",
  SUBMITTING: "submitting",
  INSTALLED: "installed",
  ALREADY_INSTALLED: "already_installed",
  FAILED: "failed",
});

/** Backend refusal codes the form treats as SPECIFIC rather than generic. */
export const INSTALL_FAILURE = Object.freeze({
  ALREADY_INSTALLED: "ALREADY_INSTALLED",
  LOCATION_NOT_OF_ACCOUNT: "LOCATION_NOT_OF_ACCOUNT",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  STATE_NOT_INSTALLABLE: "STATE_NOT_INSTALLABLE",
});

export const INSTALL_DISABLED_REASON =
  "You are not authorized to install equipment at a customer.";

const str = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** The empty form. `idempotencyToken` is minted per attempt by the caller -- see deriveIdempotencyKey. */
export const EMPTY_INSTALL_FORM = Object.freeze({
  serialNo: null,
  serializedAssetId: null,
  accountId: null,
  locationId: null,
  notes: null,
});

/**
 * Locations offered for a customer.
 *
 * Filtered on accountId, and the filter is the same predicate the backend enforces. A location list
 * that included another customer's sites would be offering a choice the server will refuse -- after
 * the user has already committed to it in their head.
 */
export function locationsForAccount(locations, accountId) {
  const wanted = str(accountId);
  if (!wanted) return [];
  return (Array.isArray(locations) ? locations : []).filter((l) => str(l?.accountId) === wanted);
}

/**
 * Is this form complete and internally consistent?
 *
 * Returns the reasons, not just a boolean, because "Install" being disabled without saying why is
 * the failure mode this whole surface exists to avoid.
 */
export function validateInstallForm(form, { locations = [] } = {}) {
  const problems = [];
  const serializedAssetId = str(form?.serializedAssetId);
  const accountId = str(form?.accountId);
  const locationId = str(form?.locationId);

  if (!serializedAssetId) problems.push({ field: "unit", message: "Choose a unit to install." });
  if (!accountId) problems.push({ field: "customer", message: "Choose the customer this unit is for." });
  if (!locationId) problems.push({ field: "location", message: "Choose the customer location where it is installed." });

  if (accountId && locationId) {
    const match = (Array.isArray(locations) ? locations : []).find((l) => str(l?.id) === locationId);
    // A location the form does not recognise is NOT treated as valid-until-proven-otherwise. The
    // server would refuse it, and refusing here says so before the user commits.
    if (!match) {
      problems.push({ field: "location", message: "That location is not one of this customer's locations." });
    } else if (str(match.accountId) !== accountId) {
      problems.push({ field: "location", message: "That location belongs to a different customer." });
    }
  }
  return { valid: problems.length === 0, problems };
}

/** Which step the form is on, derived from what has been chosen rather than tracked separately. */
export function deriveInstallStep(form) {
  if (!str(form?.serializedAssetId)) return INSTALL_STEP.UNIT;
  if (!str(form?.accountId)) return INSTALL_STEP.CUSTOMER;
  if (!str(form?.locationId)) return INSTALL_STEP.LOCATION;
  return INSTALL_STEP.CONFIRM;
}

/**
 * Changing the customer CLEARS the location.
 *
 * Not a nicety. Without it, picking customer A, then a location of A, then switching to customer B
 * leaves B selected with A's location still in state -- a combination that looks complete, passes a
 * careless glance, and is exactly the mismatch the backend exists to catch.
 */
export function selectCustomer(form, accountId) {
  return { ...form, accountId: str(accountId), locationId: null };
}

export function selectUnit(form, asset) {
  return {
    ...form,
    serializedAssetId: str(asset?.serializedAssetId) ?? str(asset?.id) ?? null,
    serialNo: str(asset?.serialNo) ?? null,
  };
}

export function selectLocation(form, locationId) {
  return { ...form, locationId: str(locationId) };
}

/**
 * The idempotency key for ONE installation intent.
 *
 * Derived from WHAT is being installed and WHERE, plus a token the caller mints once when the
 * confirm step is entered. Two consequences, both deliberate:
 *
 *   a network retry of the same attempt reuses the same key, so the server replays and returns the
 *   SAME Equipment rather than creating a second machine
 *
 *   changing the customer or location changes the key, so a corrected attempt is a genuinely new
 *   request rather than a replay that would return the earlier, wrong Equipment
 */
export function deriveIdempotencyKey(form, attemptToken) {
  const token = str(attemptToken);
  const assetId = str(form?.serializedAssetId);
  const accountId = str(form?.accountId);
  const locationId = str(form?.locationId);
  if (!token || !assetId || !accountId || !locationId) return null;
  // The command accepts letters, digits, underscore and hyphen only -- a colon was rejected once
  // already on the grant path, and the fix belongs where the key is minted.
  const safe = (v) => v.replace(/[^A-Za-z0-9_-]/g, "-");
  return `install_${safe(assetId)}_${safe(accountId)}_${safe(locationId)}_${safe(token)}`;
}

/** The request the callable receives. Built from the form so no caller assembles it by hand. */
export function buildInstallRequest(form, { attemptToken, name } = {}) {
  const idempotencyKey = deriveIdempotencyKey(form, attemptToken);
  if (!idempotencyKey) return null;
  const notes = str(form?.notes);
  return {
    serializedAssetId: str(form.serializedAssetId),
    accountId: str(form.accountId),
    locationId: str(form.locationId),
    // `name` is what appears in the Equipment register. The command requires one and deliberately
    // does not generate a placeholder nobody chose.
    name: str(name) ?? `${str(form.serialNo) ?? "Unit"}`,
    idempotencyKey,
    ...(notes ? { notes } : {}),
  };
}

/**
 * Interpret what came back.
 *
 * ALREADY_INSTALLED is NOT flattened into failure. The unit is at a customer; that is a true state,
 * and the honest response is to say so and offer the Equipment that exists -- not to leave a retry
 * button in front of someone for a machine that has already been placed.
 */
export function interpretInstallResult({ outcome, error } = {}) {
  if (outcome && (outcome.outcome === "installed" || outcome.outcome === "replayed")) {
    return {
      status: INSTALL_SUBMIT.INSTALLED,
      equipmentId: outcome.equipmentId ?? null,
      replayed: outcome.outcome === "replayed",
      message: outcome.outcome === "replayed"
        ? "This installation was already recorded. Opening the existing Equipment record."
        : "Installed.",
    };
  }
  const code = str(error?.details) ?? str(error?.code) ?? null;
  if (code === INSTALL_FAILURE.ALREADY_INSTALLED) {
    return {
      status: INSTALL_SUBMIT.ALREADY_INSTALLED,
      equipmentId: null,
      message: "That unit is already installed at a customer. It cannot be installed again.",
    };
  }
  return {
    status: INSTALL_SUBMIT.FAILED,
    equipmentId: null,
    code,
    message: str(error?.message) ?? "The installation could not be completed.",
  };
}

/**
 * May the Install control be pressed right now?
 *
 * Four independent reasons it may not, each with its own message. Collapsing them into one disabled
 * button teaches the user nothing about which one applies.
 */
export function deriveInstallAction({ canInstall, form, locations, submitStatus, unitAvailable }) {
  if (!canInstall) return { enabled: false, reason: INSTALL_DISABLED_REASON };
  if (submitStatus === INSTALL_SUBMIT.SUBMITTING) {
    return { enabled: false, reason: "Installing…" };
  }
  if (submitStatus === INSTALL_SUBMIT.INSTALLED) {
    return { enabled: false, reason: "Already installed in this session." };
  }
  if (unitAvailable === false) {
    return { enabled: false, reason: "That unit is no longer available to install." };
  }
  const { valid, problems } = validateInstallForm(form, { locations });
  if (!valid) return { enabled: false, reason: problems[0].message };
  return { enabled: true, reason: null };
}
