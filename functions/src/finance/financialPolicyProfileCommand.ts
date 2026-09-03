// CERT-FIN-02 -- the trusted command service for a company's financial policy profile.
//
// Admin-SDK only. `financial_policy_profiles` has NO firestore.rules match block, so it is DENY-ALL
// to every client including admin -- the same posture `bins`, `bin_code_claims` and `part_aliases`
// use, and the reason this needed no Rules change at all. A callable runs on the Admin SDK, which
// Rules do not govern; there is deliberately no client-direct write path to smuggle configuration
// authority through.
//
// ============================ THE LOCK IS ENFORCED HERE, NOT IN THE UI ============================
//
// The screen disables its controls when a profile is LOCKED. That is a courtesy to the operator and
// it is not the rule. EVERY write in this module re-reads the stored status INSIDE the transaction
// and calls assertProfileMutable before staging anything, so a crafted request, a stale tab, a
// replayed call or a direct callable invocation all hit the same refusal. A test asserts exactly
// that: a locked profile refuses a well-formed configure request from an authorized principal.
//
// There is no unlock command, no force flag and no admin bypass. Admin can do most operational
// things in EOS; it deliberately cannot do this one. Coming back from LOCKED is an accounting-policy
// migration -- approval, effective date, impact assessment, conversion, activation -- and that does
// not exist. Adding a `--force` here would be building the dangerous half of it and none of the safe
// half.
//
// ============================ WHAT IT DOES NOT DO ============================
//
// It never touches an acquisition-cost fact. Selecting or changing a policy must not mutate the
// historical facts the policy is applied TO -- that is the whole point of keeping the two apart, and
// this module imports nothing that can write one.

import type { Firestore, Transaction } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import {
  validateFinancialPolicyProfile,
  assertProfileMutable,
  isLegalTransition,
  FinancialPolicyError,
  type FinancialPolicyProfile,
  type ProfileStatus,
} from "./financialPolicyProfile.js";

export const FINANCIAL_POLICY_PROFILES_COLLECTION = "financial_policy_profiles";

/** One profile per operating company. The company IS the identity -- there is no second profile. */
export function financialPolicyProfileDocId(operatingCompanyId: string): string {
  return operatingCompanyId;
}

export interface FinancialPolicyProfileDeps {
  readonly db: Firestore;
  readonly now: Date;
  readonly actorUid: string;
}

export interface StoredFinancialPolicyProfile extends FinancialPolicyProfile {
  readonly version: number;
  readonly updatedAtMillis: number;
  readonly updatedByUid: string;
}

export type ProfileOutcome = {
  readonly outcome: "applied" | "unchanged";
  readonly profile: StoredFinancialPolicyProfile;
};

const STORED_KEYS = new Set([
  "operatingCompanyId",
  "status",
  "inventoryCostMethod",
  "serializedInventoryCostMethod",
  "cogsRecognitionPointId",
  "freightTreatment",
  "landedCostTreatment",
  "approval",
  "version",
  "updatedAt",
  "updatedByUid",
]);

/**
 * Read a stored profile back, fail-closed. A stored document that does not satisfy the current
 * contract is refused rather than normalized into validity -- the same posture the operational
 * ledger's deserializer takes.
 */
export function deserializeStoredProfile(data: unknown): StoredFinancialPolicyProfile {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new FinancialPolicyError("PROFILE_MALFORMED", "stored financial policy is not an object");
  }
  const d = data as Record<string, unknown>;
  const unknownKey = Object.keys(d).find((k) => !STORED_KEYS.has(k));
  if (unknownKey !== undefined) {
    throw new FinancialPolicyError("PROFILE_MALFORMED", `stored financial policy has unknown field: ${unknownKey}`);
  }
  const { version, updatedAt, updatedByUid, ...policy } = d;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
    throw new FinancialPolicyError("PROFILE_MALFORMED", "stored financial policy has an invalid version");
  }
  if (typeof updatedByUid !== "string" || updatedByUid.trim() === "") {
    throw new FinancialPolicyError("PROFILE_MALFORMED", "stored financial policy has no updatedByUid");
  }
  // A LOCKED stored profile must still be READABLE -- validate() refuses an unavailable recognition
  // point, and a point could become unavailable after a profile was locked under it. Reading history
  // is not configuring it, so the lock path deserializes without re-running availability.
  const validated = validateStoredPolicyShape(policy);
  const millis =
    updatedAt instanceof Timestamp
      ? updatedAt.toDate().getTime()
      : (() => {
          throw new FinancialPolicyError("PROFILE_MALFORMED", "stored updatedAt is not a server Timestamp");
        })();
  return Object.freeze({ ...validated, version, updatedAtMillis: millis, updatedByUid });
}

/**
 * Shape-validate a STORED policy without the "is this recognition point still available today"
 * check. See deserializeStoredProfile -- a locked historical choice must remain readable even if the
 * platform later withdraws that option, and refusing to read it would be worse than reading it.
 */
function validateStoredPolicyShape(policy: Record<string, unknown>): FinancialPolicyProfile {
  try {
    return validateFinancialPolicyProfile(policy);
  } catch (err) {
    if (err instanceof FinancialPolicyError && err.code === "RECOGNITION_UNAVAILABLE") {
      // Re-validate with the availability gate lifted by substituting a currently-available point,
      // then restore the stored id, so the shape is still fully checked.
      const probe = validateFinancialPolicyProfile({ ...policy, cogsRecognitionPointId: "INVOICE_ISSUE" });
      return Object.freeze({ ...probe, cogsRecognitionPointId: String(policy.cogsRecognitionPointId) });
    }
    throw err;
  }
}

function serialize(profile: FinancialPolicyProfile, version: number, deps: FinancialPolicyProfileDeps): Record<string, unknown> {
  return {
    operatingCompanyId: profile.operatingCompanyId,
    status: profile.status,
    inventoryCostMethod: profile.inventoryCostMethod,
    serializedInventoryCostMethod: profile.serializedInventoryCostMethod,
    cogsRecognitionPointId: profile.cogsRecognitionPointId,
    freightTreatment: profile.freightTreatment,
    landedCostTreatment: profile.landedCostTreatment,
    approval: profile.approval === null ? null : { ...profile.approval },
    version,
    updatedAt: Timestamp.fromDate(deps.now),
    updatedByUid: deps.actorUid,
  };
}

async function readStored(
  txn: Transaction,
  db: Firestore,
  operatingCompanyId: string,
): Promise<StoredFinancialPolicyProfile | null> {
  const ref = db.collection(FINANCIAL_POLICY_PROFILES_COLLECTION).doc(financialPolicyProfileDocId(operatingCompanyId));
  const snap = await txn.get(ref);
  return snap.exists ? deserializeStoredProfile(snap.data() ?? {}) : null;
}

/**
 * Configure (create or replace) a company's DRAFT/APPROVED financial policy.
 *
 * The stored status is re-read inside the transaction and the lock re-checked there, so a profile
 * locked between the operator opening the screen and pressing save is still refused.
 */
export async function configureFinancialPolicyProfile(
  request: unknown,
  deps: FinancialPolicyProfileDeps,
): Promise<ProfileOutcome> {
  const desired = validateFinancialPolicyProfile(request);
  if (desired.status === "LOCKED") {
    throw new FinancialPolicyError(
      "TRANSITION_ILLEGAL",
      "activation is not an ordinary configuration write -- use activateFinancialPolicyProfile",
    );
  }
  return deps.db.runTransaction(async (txn) => {
    const stored = await readStored(txn, deps.db, desired.operatingCompanyId);
    assertProfileMutable(stored);
    if (stored !== null && !isLegalTransition(stored.status, desired.status) && stored.status !== desired.status) {
      throw new FinancialPolicyError(
        "TRANSITION_ILLEGAL",
        `a ${stored.status} financial policy cannot become ${desired.status}`,
      );
    }
    const version = (stored?.version ?? 0) + 1;
    const ref = deps.db
      .collection(FINANCIAL_POLICY_PROFILES_COLLECTION)
      .doc(financialPolicyProfileDocId(desired.operatingCompanyId));
    const data = serialize(desired, version, deps);
    txn.set(ref, data);
    return {
      outcome: "applied" as const,
      profile: Object.freeze({
        ...desired,
        version,
        updatedAtMillis: deps.now.getTime(),
        updatedByUid: deps.actorUid,
      }),
    };
  });
}

/**
 * Activate: APPROVED -> LOCKED. The one-way door.
 *
 * Idempotent by state rather than by a key: activating an already-LOCKED profile reports `unchanged`
 * instead of throwing, because a retried activation is not an attempt to edit a locked policy. Every
 * OTHER path into a locked profile still refuses.
 */
export async function activateFinancialPolicyProfile(
  input: { readonly operatingCompanyId?: unknown },
  deps: FinancialPolicyProfileDeps,
): Promise<ProfileOutcome> {
  const companyId = typeof input?.operatingCompanyId === "string" ? input.operatingCompanyId.trim() : "";
  if (companyId === "") {
    throw new FinancialPolicyError("COMPANY_REQUIRED", "activation names exactly one operating company");
  }
  return deps.db.runTransaction(async (txn) => {
    const stored = await readStored(txn, deps.db, companyId);
    if (stored === null) {
      throw new FinancialPolicyError(
        "PROFILE_MALFORMED",
        "no financial policy profile exists for this operating company",
      );
    }
    if (stored.status === "LOCKED") {
      return { outcome: "unchanged" as const, profile: stored };
    }
    if (!isLegalTransition(stored.status, "LOCKED")) {
      throw new FinancialPolicyError(
        "TRANSITION_ILLEGAL",
        `a ${stored.status} financial policy cannot be activated -- accounting approval must be recorded first`,
      );
    }
    if (stored.approval === null) {
      throw new FinancialPolicyError("APPROVAL_REQUIRED", "activation requires recorded accounting approval");
    }
    const locked: FinancialPolicyProfile = { ...stored, status: "LOCKED" as ProfileStatus };
    const version = stored.version + 1;
    const ref = deps.db.collection(FINANCIAL_POLICY_PROFILES_COLLECTION).doc(financialPolicyProfileDocId(companyId));
    txn.set(ref, serialize(locked, version, deps));
    return {
      outcome: "applied" as const,
      profile: Object.freeze({ ...locked, version, updatedAtMillis: deps.now.getTime(), updatedByUid: deps.actorUid }),
    };
  });
}

/** Read one company's profile. Returns null when none is configured -- never a fabricated default. */
export async function readFinancialPolicyProfile(
  operatingCompanyId: string,
  db: Firestore,
): Promise<StoredFinancialPolicyProfile | null> {
  const snap = await db
    .collection(FINANCIAL_POLICY_PROFILES_COLLECTION)
    .doc(financialPolicyProfileDocId(operatingCompanyId))
    .get();
  return snap.exists ? deserializeStoredProfile(snap.data() ?? {}) : null;
}
