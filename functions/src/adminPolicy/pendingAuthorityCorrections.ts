// THE OWNER-RULED AUTHORITY CORRECTIONS -- NOW ACTIVATED, AND THE RESIDUAL THAT IS NOT.
//
// ════════════════════ WHAT THIS FILE WAS, AND WHAT CHANGED ════════════════════
//
// Lane BK recorded ten Owner-approved grants, two capabilities and four CRED read wirings as
// APPROVED_NOT_APPLIED, in their own manifest with their own guard, because
// `roleCapabilityAuthorityBaseline` was a MEASUREMENT of nonprod's 387 rows and writing an
// unapplied grant into it would have asserted an authority nonprod did not have (Owner ruling AN2:
// DO NOT BLESS LIVE DRIFT). BK authored NO migration for a mechanical reason: the rebuild guard's
// phase C replays every migration, so a grant-bearing migration alone would have produced 397
// against a baseline declaring 387 and the guard would have reported ten MISSING DECLARATIONs.
//
// Owner ruling E closes that loop from the other end: the migration and the baseline that explains
// it must land as ONE change. Migration 1762300800000 is that change, and this manifest is now the
// ACTIVATION RECORD rather than the approval one:
//
//     pendingGrants / pendingCapabilities   EMPTY. Everything BK approved is live in the
//                                           repository's canonical authority.
//     activatedGrants / activatedCapabilities
//                                           26 grants and 3 capabilities, each carrying the ruling
//                                           that authorized it and the migration that wrote it.
//     refusedGrants / refusedCapabilities   the authorities considered and NOT AUTHORIZED. A
//                                           refusal that is merely absent is indistinguishable from
//                                           an oversight; these are asserted.
//     editWithoutReadReconciliation         ruling B, 13 rows in, 0 left, each with its disposition.
//     residualEditWithoutRead               the 10 rows of the wider census this activation does not
//                                           close, each classified and each with the reason the
//                                           action was not taken.
//
// `assertPendingIsNotAuthority` is the structural reason the pending lists are empty rather than
// duplicated: it refuses any pair that is BOTH pending here AND declared in the measured baseline.
// A grant that has been applied must move out of the pending set; it may not live in both.
//
// ════════════════════ APPLIED TO THE REPOSITORY IS NOT APPLIED TO AN ENVIRONMENT ════════════════════
//
// `appliedToEnvironments` is still EMPTY, and that is not in tension with `status: "ACTIVATED"`.
// The migration exists, the baseline declares its output, and a clean rebuild reproduces both
// exactly -- but nothing has RUN it against nonprod or production. The deploy does that. Keeping
// the two facts in separate fields is what stops "the repository says so" from being read as "the
// database does so".
import manifest from "./seed/pendingAuthorityCorrections.json";

/** The rulings this manifest carries. `B` and `C` joined S1-S6 with the activation. */
export type CorrectionRuling = "S1" | "S2" | "S3" | "S4" | "S6" | "B" | "C";

export interface ActivatedCapability {
  readonly capabilityKey: string;
  readonly objectKey: string;
  readonly actionKey: string;
  readonly actionKind: string;
  readonly label: string;
  readonly ruling: CorrectionRuling;
  readonly registeredBy: string;
  readonly why: string;
}

export interface ActivatedGrant {
  readonly roleKey: string;
  readonly capabilityKey: string;
  readonly ruling: CorrectionRuling;
  /** True when the Role catalog ALREADY declared the pair (baseline `catalogDeclaredNotActivated`). */
  readonly alreadyCatalogDeclared: boolean;
  readonly grantedBy: string;
  readonly why: string;
}

export interface RefusedGrant {
  readonly roleKey: string;
  readonly capabilityKey: string;
  readonly ruling: CorrectionRuling;
  readonly why: string;
}

export interface RefusedCapability {
  readonly capabilityKey: string;
  readonly objectKey: string;
  readonly ruling: CorrectionRuling;
  readonly why: string;
}

export interface CredReadWiring {
  readonly objectKey: string;
  readonly matrixObject: string;
  readonly readCapabilityKey: string;
  readonly ruling: CorrectionRuling;
  readonly capabilityAlreadyExists: boolean;
  readonly disposition: string;
  readonly action: string;
  readonly holdersToday: readonly string[];
  readonly why: string;
}

/** The three dispositions ruling B allows. An edit-without-read row gets exactly one. */
export type EditWithoutReadDisposition =
  | "WRITE_LEGITIMATE_READ_REQUIRED"
  | "WRITE_NOT_LEGITIMATE"
  | "PROJECTION_DEFECT";

export interface EditWithoutReadRow {
  readonly objectKey: string;
  readonly roleKey: string;
  readonly holdsModifyCapability: string;
  readonly disposition: EditWithoutReadDisposition;
  readonly action: string;
  readonly why: string;
}

export interface RoleCapabilityPair {
  readonly roleKey: string;
  readonly capabilityKey: string;
}

export class PendingCorrectionsError extends Error {}

const SUPPORTED_VERSION = 2;
if (manifest.version !== SUPPORTED_VERSION) {
  throw new PendingCorrectionsError(
    `pendingAuthorityCorrections.json is version ${manifest.version}; this module understands ${SUPPORTED_VERSION}`,
  );
}

const freezeAll = <T>(xs: readonly T[]): readonly T[] => Object.freeze(xs.map((x) => Object.freeze({ ...x })));

/**
 * APPROVED AND NOT YET IN THE CANONICAL AUTHORITY. EMPTY today, and kept as a named empty list
 * rather than deleted: the next approval that arrives before its activation belongs here, and
 * `assertPendingIsNotAuthority` is what keeps it from also being claimed as live.
 */
export const PENDING_GRANTS: readonly ActivatedGrant[] =
  freezeAll(manifest.pendingGrants as ActivatedGrant[]);
export const PENDING_CAPABILITIES: readonly ActivatedCapability[] =
  freezeAll(manifest.pendingCapabilities as ActivatedCapability[]);

/** Written into the canonical authority by the migration this manifest names. */
export const ACTIVATED_GRANTS: readonly ActivatedGrant[] =
  freezeAll(manifest.activatedGrants as ActivatedGrant[]);
export const ACTIVATED_CAPABILITIES: readonly ActivatedCapability[] =
  freezeAll(manifest.activatedCapabilities as ActivatedCapability[]);

/** Considered and REFUSED, each naming the control it would have defeated. */
export const REFUSED_GRANTS: readonly RefusedGrant[] =
  freezeAll(manifest.refusedGrants as RefusedGrant[]);

/** Capability keys deliberately NOT REGISTERED, so they cannot be granted by anyone. */
export const REFUSED_CAPABILITIES: readonly RefusedCapability[] =
  freezeAll(manifest.refusedCapabilities as RefusedCapability[]);

/** Object READ-verb wirings the S1 and C reconciliations required. */
export const CRED_READ_WIRING: readonly CredReadWiring[] =
  freezeAll(manifest.credReadWiring as CredReadWiring[]);

/** Ruling B, executed: 13 rows in, 0 left, each row carrying its disposition and action. */
export const EDIT_WITHOUT_READ_RECONCILED: readonly EditWithoutReadRow[] =
  freezeAll(manifest.editWithoutReadReconciliation.rows as EditWithoutReadRow[]);
export const EDIT_WITHOUT_READ_BEFORE: number = manifest.editWithoutReadReconciliation.before;
export const EDIT_WITHOUT_READ_AFTER: number = manifest.editWithoutReadReconciliation.after;

/**
 * MEASURED, CLASSIFIED, NOT CLOSED. The wider census rows this activation leaves standing, each
 * with the reason the action was not taken. "Unexplained" is the state this list exists to end; a
 * row without a disposition and a reason is a defect in the list, not an acceptable entry.
 */
export const RESIDUAL_EDIT_WITHOUT_READ: readonly EditWithoutReadRow[] =
  freezeAll(manifest.residualEditWithoutRead.rows as EditWithoutReadRow[]);
export const EDIT_WITHOUT_READ_CENSUS_BEFORE: number = manifest.residualEditWithoutRead.censusBefore;
/**
 * The census with the matrix READ verbs wired and the migration NOT applied. It is not the same
 * number as `EDIT_WITHOUT_READ_CENSUS_BEFORE` because the activation has two halves and only one of
 * them is a migration: the two `employee` rows close on the wiring alone. A test can rerun the
 * migration and cannot un-wire a committed matrix, so this is the one it can measure against.
 */
export const EDIT_WITHOUT_READ_CENSUS_WIRING_ONLY: number = manifest.residualEditWithoutRead.censusWithMatrixWiringOnly;
export const EDIT_WITHOUT_READ_CENSUS_AFTER: number = manifest.residualEditWithoutRead.censusAfter;

export const ACTIVATION_STATUS = manifest.status;
export const ACTIVATED_BY = manifest.activatedBy;
export const PENDING_STATUS = manifest.status;
export const PENDING_APPLIED_ENVIRONMENTS: readonly string[] =
  Object.freeze([...manifest.appliedToEnvironments]);

const pairKey = (roleKey: string, capabilityKey: string): string => `${roleKey}\u0000${capabilityKey}`;

/** The pending grants as bare pairs, for set comparison against an authority list. */
export function pendingGrantPairs(): readonly RoleCapabilityPair[] {
  return Object.freeze(PENDING_GRANTS.map((g) => Object.freeze({ roleKey: g.roleKey, capabilityKey: g.capabilityKey })));
}

/** The activated grants as bare pairs. Every one of these MUST be in the measured baseline. */
export function activatedGrantPairs(): readonly RoleCapabilityPair[] {
  return Object.freeze(ACTIVATED_GRANTS.map((g) => Object.freeze({ roleKey: g.roleKey, capabilityKey: g.capabilityKey })));
}

export function countsByRuling(): Readonly<Record<CorrectionRuling, number>> {
  const counts: Record<CorrectionRuling, number> = { S1: 0, S2: 0, S3: 0, S4: 0, S6: 0, B: 0, C: 0 };
  for (const g of ACTIVATED_GRANTS) counts[g.ruling] += 1;
  return Object.freeze(counts);
}

/**
 * FAIL CLOSED ON A SILENT APPLICATION. A pending grant that already appears in the measured
 * authority is no longer pending -- it has been applied, and leaving it here would let the
 * repository claim a correction is outstanding when it is live, or double-count it as both.
 *
 * This is what made the pending lists EMPTY when migration 1762300800000 landed: the ten BK grants
 * entered the baseline, so they had to leave this manifest in the same change.
 */
export function assertPendingIsNotAuthority(
  measuredAuthority: readonly RoleCapabilityPair[],
  pending: readonly RoleCapabilityPair[] = pendingGrantPairs(),
): void {
  const held = new Set(measuredAuthority.map((p) => pairKey(p.roleKey, p.capabilityKey)));
  const alreadyApplied = pending.filter((p) => held.has(pairKey(p.roleKey, p.capabilityKey)));
  if (alreadyApplied.length > 0) {
    throw new PendingCorrectionsError(
      "a PENDING correction is already held by the measured authority: " +
        alreadyApplied.map((p) => `${p.roleKey}/${p.capabilityKey}`).join(", ") +
        "; it has been applied -- move it out of the pending manifest rather than declaring it twice",
    );
  }
}

/**
 * THE OTHER DIRECTION, AND IT IS NOT THE SAME CHECK. Every ACTIVATED pair must be declared by the
 * measured baseline. A row that claims to be activated and is absent from the authority is a
 * manifest describing a change the repository does not actually make -- the failure mode that
 * "APPROVED, NOT APPLIED" was invented to avoid, arriving from the opposite side.
 */
export function assertActivatedIsAuthority(
  measuredAuthority: readonly RoleCapabilityPair[],
  activated: readonly RoleCapabilityPair[] = activatedGrantPairs(),
): void {
  const held = new Set(measuredAuthority.map((p) => pairKey(p.roleKey, p.capabilityKey)));
  const orphaned = activated.filter((p) => !held.has(pairKey(p.roleKey, p.capabilityKey)));
  if (orphaned.length > 0) {
    throw new PendingCorrectionsError(
      "an ACTIVATED correction is NOT declared by the measured authority: " +
        orphaned.map((p) => `${p.roleKey}/${p.capabilityKey}`).join(", ") +
        "; the manifest claims an activation the baseline does not carry",
    );
  }
}

/**
 * FAIL CLOSED ON A SMUGGLED REFUSAL. A refused pair must be held by nobody and must never appear
 * in the pending or activated sets. This is what keeps
 * `fieldManager -> workOrder.lifecycle.complete`,
 * `inventoryCycleCountCounter -> inventory.cycleCount.close` and
 * `reportFinanceViewer -> reportDefinition.read` enforceable rather than merely documented.
 */
export function assertRefusedGrantsAreNotHeld(
  measuredAuthority: readonly RoleCapabilityPair[],
  refused: readonly RefusedGrant[] = REFUSED_GRANTS,
): void {
  const held = new Set(measuredAuthority.map((p) => pairKey(p.roleKey, p.capabilityKey)));
  const declared = new Set([...pendingGrantPairs(), ...activatedGrantPairs()].map((p) => pairKey(p.roleKey, p.capabilityKey)));
  const violations: string[] = [];
  for (const r of refused) {
    const k = pairKey(r.roleKey, r.capabilityKey);
    if (held.has(k)) violations.push(`${r.roleKey}/${r.capabilityKey} is HELD in the measured authority`);
    if (declared.has(k)) violations.push(`${r.roleKey}/${r.capabilityKey} appears in the PENDING or ACTIVATED set`);
  }
  if (violations.length > 0) {
    throw new PendingCorrectionsError(`a REFUSED grant is present: ${violations.join("; ")}`);
  }
}

/**
 * FAIL CLOSED ON A MUTUALLY EXCLUSIVE PAIR. Given the separation-of-duty pairs and a resolver from
 * Role to the capabilities it holds, refuse any capability both sides of an exclusive pair hold.
 * The pairs are passed in so this module stays a pure data module and the check is provable against
 * a synthetic pair list too.
 */
export function assertSeparationOfDutyPreserved(
  exclusivePairs: readonly (readonly [string, string, string])[],
  capabilitiesOf: (roleKey: string) => ReadonlySet<string>,
): void {
  const violations: string[] = [];
  for (const [a, b, why] of exclusivePairs) {
    const ca = capabilitiesOf(a);
    const cb = capabilitiesOf(b);
    const shared = [...ca].filter((c) => cb.has(c)).sort();
    if (shared.length > 0) {
      violations.push(`${a} and ${b} would both hold ${shared.join(", ")} -- ${why}`);
    }
  }
  if (violations.length > 0) {
    throw new PendingCorrectionsError(`separation of duty defeated: ${violations.join("; ")}`);
  }
}

/**
 * The authority that WOULD exist if the pending set were applied. Returned for analysis and proof
 * ONLY -- it is not authority, nothing reads it at runtime, and no applier consumes it. With the
 * pending set empty this is the measured authority unchanged, which is the point: there is nothing
 * approved-but-missing left to project.
 */
export function projectedAuthorityIfApplied(
  measuredAuthority: readonly RoleCapabilityPair[],
): readonly RoleCapabilityPair[] {
  return Object.freeze([
    ...measuredAuthority.map((p) => Object.freeze({ roleKey: p.roleKey, capabilityKey: p.capabilityKey })),
    ...pendingGrantPairs(),
  ]);
}
