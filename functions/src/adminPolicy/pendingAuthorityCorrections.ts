// OWNER-APPROVED AUTHORITY CORRECTIONS THAT ARE **NOT YET APPLIED** TO ANY ENVIRONMENT.
//
// ════════════════════ WHY THIS IS A SEPARATE FILE ════════════════════
//
// `roleCapabilityAuthorityBaseline.ts` is a MEASUREMENT. It records the 387 role_capability rows
// nonprod actually holds, classified by reconstruction source, and
// `roleCapabilityAuthorityBaselinePostgres.test.mjs` proves a clean rebuild reproduces exactly
// those 387 -- 0 missing, 0 unexplained extra. That guard's entire purpose is that the repository
// can reproduce REALITY. Writing an approved-but-unapplied grant into it would make the repository
// assert an authority nonprod does not have, which is the drift the guard exists to catch
// (Owner ruling AN2: DO NOT BLESS LIVE DRIFT).
//
// So the corrections live HERE, in their own manifest, with their own guard. The arrangement keeps
// two different questions separately answerable:
//
//     roleCapabilityAuthorityBaseline   WHAT IS TRUE NOW          387, == nonprod, provable
//     pendingAuthorityCorrections       WHAT IS APPROVED NEXT     10 grants, 2 capabilities,
//                                                                 4 CRED wirings, applied nowhere
//
// The two sets are DISJOINT by construction and `assertPendingIsNotAuthority` makes that
// structural: the moment a pending grant also appears in the measured baseline it has been applied,
// and it must move out of this file rather than be duplicated in both.
//
// ════════════════════ WHY THERE IS NO MIGRATION ════════════════════
//
// A grant-bearing migration is the normal vehicle for global canonical authority, and it is the
// WRONG vehicle here, for a mechanical reason rather than a stylistic one. The rebuild guard's
// phase C replays EVERY migration in `migrations/`. A new migration that inserted these ten rows
// would make the rebuild produce 397 against a baseline that declares 387, and the guard would
// report ten MISSING DECLARATIONs. The only way to make it green again would be to add the ten
// rows to the measured baseline -- asserting that nonprod holds grants it does not hold.
//
// Therefore the migration is the ACTIVATION artifact, not the approval artifact. It is authored
// when applying to an environment is authorized, and this manifest is shaped so that it can be
// derived mechanically from these rows rather than retyped. Until then the honest end state is
// exactly this one: approved, recorded, provable, applied nowhere.
//
// ════════════════════ TWO OF THE FOUR S1 OBJECTS NEED NO AUTHORITY AT ALL ════════════════════
//
// `employee` and `rolesPermissions` already have a READ capability (`employee.record.read` and
// `admin.securityPolicy.read`) and the Owner already HOLDS both. Their measured `can_read = false`
// is therefore NOT a withheld grant -- it is a CRED projection defect. Object CRED is derived, not
// authored: `deriveObjectCred` sets R true only when the Role holds one of the read-verb capability
// ids the seed snapshot lists for that Object, and the snapshot lists NONE for these two, because
// the frontend matrix (field-ops-app-vite/src/access/objectPermissionMap.js, generated into the
// snapshot) declares `R: []` for them. With an empty list the verb is UNGOVERNED and R stays false
// for every Role however much READ authority it holds.
//
// So the correction for those two is a WIRING change, not a grant, and this manifest records it as
// such. Writing a grant for them would invent authority that already exists and would misreport
// the defect. `receivingOrder` and `workOrder` are the genuinely ungoverned pair: no READ
// capability exists for them anywhere, which is why they need `pendingCapabilities` first.
//
// ════════════════════ WHAT IS DELIBERATELY NOT HERE ════════════════════
//
// `refusedGrants` records the authorities that were considered and REFUSED, each with the control
// it would have defeated. A refusal that is only absent is indistinguishable from an oversight; a
// refusal that is written down and asserted is a control. `assertRefusedGrantsAreNotHeld` proves
// none of them is held today and none is smuggled into the pending set.
import manifest from "./seed/pendingAuthorityCorrections.json";

export type CorrectionRuling = "S1" | "S2" | "S3" | "S4" | "S6";

export interface PendingCapability {
  readonly capabilityKey: string;
  readonly objectKey: string;
  readonly actionKey: string;
  readonly actionKind: string;
  readonly label: string;
  readonly ruling: CorrectionRuling;
  readonly why: string;
}

export interface PendingGrant {
  readonly roleKey: string;
  readonly capabilityKey: string;
  readonly ruling: CorrectionRuling;
  /** True when the grant also needs a capability this manifest has not registered yet. */
  readonly requiresPendingCapability: boolean;
  /** True when the Role catalog ALREADY declares the pair (baseline `catalogDeclaredNotActivated`). */
  readonly alreadyCatalogDeclared: boolean;
  readonly measuredHoldersToday: readonly string[];
  readonly why: string;
}

export interface RefusedGrant {
  readonly roleKey: string;
  readonly capabilityKey: string;
  readonly ruling: CorrectionRuling;
  readonly why: string;
}

export interface PendingCredReadWiring {
  readonly objectKey: string;
  readonly matrixObject: string;
  readonly readCapabilityKey: string;
  readonly ruling: CorrectionRuling;
  readonly capabilityAlreadyExists: boolean;
  readonly ownerAlreadyHolds: boolean;
  readonly holdersToday: readonly string[];
  readonly why: string;
}

export interface RoleCapabilityPair {
  readonly roleKey: string;
  readonly capabilityKey: string;
}

export class PendingCorrectionsError extends Error {}

const SUPPORTED_VERSION = 1;
if (manifest.version !== SUPPORTED_VERSION) {
  throw new PendingCorrectionsError(
    `pendingAuthorityCorrections.json is version ${manifest.version}; this module understands ${SUPPORTED_VERSION}`,
  );
}

const freezeAll = <T>(xs: readonly T[]): readonly T[] => Object.freeze(xs.map((x) => Object.freeze({ ...x })));

/** APPROVED, APPLIED NOWHERE. Never merge into any authority list. */
export const PENDING_GRANTS: readonly PendingGrant[] =
  freezeAll(manifest.pendingGrants as PendingGrant[]);

/** New capability vocabulary the corrections require. Also applied nowhere. */
export const PENDING_CAPABILITIES: readonly PendingCapability[] =
  freezeAll(manifest.pendingCapabilities as PendingCapability[]);

/** Considered and REFUSED, each naming the control it would have defeated. */
export const REFUSED_GRANTS: readonly RefusedGrant[] =
  freezeAll(manifest.refusedGrants as RefusedGrant[]);

/** Object READ-verb wirings the S1 reconciliation requires. */
export const PENDING_CRED_READ_WIRING: readonly PendingCredReadWiring[] =
  freezeAll(manifest.pendingCredReadWiring as PendingCredReadWiring[]);

/** MEASURED, NOT GRANTED -- edit-without-read the Owner ruling did not scope to this lane. */
export const RESIDUAL_EDIT_WITHOUT_READ: readonly {
  readonly objectKey: string; readonly roleKey: string; readonly holdsModifyCapability: string;
}[] = freezeAll(manifest.residualEditWithoutRead.rows);

export const PENDING_STATUS = manifest.status;
export const PENDING_APPLIED_ENVIRONMENTS: readonly string[] =
  Object.freeze([...manifest.appliedToEnvironments]);

const pairKey = (roleKey: string, capabilityKey: string): string => `${roleKey}\u0000${capabilityKey}`;

/** The pending grants as bare pairs, for set comparison against an authority list. */
export function pendingGrantPairs(): readonly RoleCapabilityPair[] {
  return Object.freeze(PENDING_GRANTS.map((g) => Object.freeze({ roleKey: g.roleKey, capabilityKey: g.capabilityKey })));
}

export function countsByRuling(): Readonly<Record<CorrectionRuling, number>> {
  const counts: Record<CorrectionRuling, number> = { S1: 0, S2: 0, S3: 0, S4: 0, S6: 0 };
  for (const g of PENDING_GRANTS) counts[g.ruling] += 1;
  return Object.freeze(counts);
}

/**
 * FAIL CLOSED ON A SILENT APPLICATION. A pending grant that already appears in the measured
 * authority is no longer pending -- it has been applied, and leaving it here would let the
 * repository claim a correction is outstanding when it is live, or double-count it as both.
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
 * FAIL CLOSED ON A SMUGGLED REFUSAL. A refused pair must be held by nobody and must never appear
 * in the pending set. This is what keeps `fieldManager -> workOrder.lifecycle.complete` and
 * `inventoryCycleCountCounter -> inventory.cycleCount.close` refusals enforceable rather than
 * merely documented.
 */
export function assertRefusedGrantsAreNotHeld(
  measuredAuthority: readonly RoleCapabilityPair[],
  refused: readonly RefusedGrant[] = REFUSED_GRANTS,
): void {
  const held = new Set(measuredAuthority.map((p) => pairKey(p.roleKey, p.capabilityKey)));
  const pending = new Set(pendingGrantPairs().map((p) => pairKey(p.roleKey, p.capabilityKey)));
  const violations: string[] = [];
  for (const r of refused) {
    const k = pairKey(r.roleKey, r.capabilityKey);
    if (held.has(k)) violations.push(`${r.roleKey}/${r.capabilityKey} is HELD in the measured authority`);
    if (pending.has(k)) violations.push(`${r.roleKey}/${r.capabilityKey} appears in the PENDING set`);
  }
  if (violations.length > 0) {
    throw new PendingCorrectionsError(`a REFUSED grant is present: ${violations.join("; ")}`);
  }
}

/**
 * FAIL CLOSED ON A MUTUALLY EXCLUSIVE PAIR. Given the separation-of-duty pairs and a resolver from
 * Role to the capabilities it would hold AFTER the pending set is applied, refuse any capability
 * both sides of an exclusive pair would hold. The pairs are passed in so this module stays a pure
 * data module and the check is provable against a synthetic pair list too.
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
 * ONLY -- it is not authority, nothing reads it at runtime, and no applier consumes it. Callers
 * that build a real grant list must use the measured baseline.
 */
export function projectedAuthorityIfApplied(
  measuredAuthority: readonly RoleCapabilityPair[],
): readonly RoleCapabilityPair[] {
  return Object.freeze([
    ...measuredAuthority.map((p) => Object.freeze({ roleKey: p.roleKey, capabilityKey: p.capabilityKey })),
    ...pendingGrantPairs(),
  ]);
}
