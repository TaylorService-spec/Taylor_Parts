// KNOWN NON-MIGRATED FIXTURES: the four Sample Company v2 synthetic Equipment Models the Taylor Catalog COPY preserves
// (Controller ruling "CATALOG/REORDER WINDOW BLOCKER RULINGS", 2026-09-30, Option 1(b)).
//
// The COPY refuses any tenant row the snapshot does not contain (catalogCutover.ts TARGET_HAS_UNKNOWN_RECORDS). The
// nonprod tenant `taylor-nonprod` also holds four synthetic Equipment Models seeded on 2026-09-16 by
// scripts/seedSampleCompany.js (sourceAuthority SAMPLE_COMPANY_V2). They are not Taylor Catalog data. The copy must
// neither migrate, modify nor delete them, and they must not block it.
//
// THIS IS NOT AN UNKNOWN-RECORD BYPASS. A target row is a known fixture only when ALL of these hold:
//   * the tenant is the pinned nonprod tenant;
//   * its kind is equipment_model and its id is one of the four pinned ids;
//   * its sourceAuthority is exactly SAMPLE_COMPANY_V2;
//   * its canonical fingerprint equals the pinned one (every EQUIPMENT_MODEL_FIELDS value, timestamps included).
// And the set must be exact: if the tenant holds ANY SAMPLE_COMPANY_V2 model, it must hold exactly these four,
// unchanged. A fifth fixture, a changed one, a missing one, or one in another tenant: REFUSE, nothing written. Every
// other target row the snapshot lacks is still TARGET_HAS_UNKNOWN_RECORDS.
import { createHash } from "node:crypto";
import { type CanonicalEquipmentModel, EQUIPMENT_MODEL_FIELDS } from "./catalogRows";

export const KNOWN_NON_MIGRATED_FIXTURE = "KNOWN_NON_MIGRATED_FIXTURE";
export const SAMPLE_COMPANY_V2_SOURCE_AUTHORITY = "SAMPLE_COMPANY_V2";
/** taylor-nonprod, measured read-only 2026-09-30. */
export const KNOWN_FIXTURE_TENANT_ID = "tenant-6ce59be1-1979-45cd-9d17-a4969037fb25";

export interface KnownFixture {
  readonly kind: "equipment_model";
  readonly id: string;
  readonly sourceAuthority: typeof SAMPLE_COMPANY_V2_SOURCE_AUTHORITY;
  readonly fingerprint: string;
}

/** Measured read-only on eos-api-nonprod 2026-09-30 with this module's fingerprint function. */
export const KNOWN_SAMPLE_COMPANY_EQUIPMENT_MODELS: readonly KnownFixture[] = Object.freeze([
  { kind: "equipment_model", id: "FIXTUREWORKS--FW-50", sourceAuthority: "SAMPLE_COMPANY_V2", fingerprint: "e239cd0a0c57f24fe93772f8c4a571e1a7eea599700deb6131a5dd057c6d5b29" },
  { kind: "equipment_model", id: "FIXTUREWORKS--FW-OLD", sourceAuthority: "SAMPLE_COMPANY_V2", fingerprint: "13dcda8c56eff1c89a7260d25c4351ee5cad1c4f3440ff35c3d221c00b22b872" },
  { kind: "equipment_model", id: "SAMPLECO--SC-100", sourceAuthority: "SAMPLE_COMPANY_V2", fingerprint: "9764da9d807587107ebdb0425a75e03cec7f10ed56866c22de60a09a2e1f07ac" },
  { kind: "equipment_model", id: "SAMPLECO--SC-200", sourceAuthority: "SAMPLE_COMPANY_V2", fingerprint: "8e71ea01b6aaad8ad5412152aad8dcbd45b641f1bde268ce9110fba1ef23ed73" },
].map((f) => Object.freeze(f as KnownFixture)));

export function equipmentModelFingerprint(m: CanonicalEquipmentModel): string {
  return createHash("sha256").update(JSON.stringify(EQUIPMENT_MODEL_FIELDS.map((f) => m[f]))).digest("hex");
}

export interface KnownFixtureClassification {
  /** Target models the snapshot lacks that ARE the pinned fixtures, unchanged. */
  readonly known: readonly { readonly kind: "equipment_model"; readonly id: string; readonly classification: typeof KNOWN_NON_MIGRATED_FIXTURE; readonly fingerprint: string }[];
  /** Target model ids the snapshot lacks that are NOT pinned fixtures: still unknown. */
  readonly unknown: readonly string[];
  /** Why the fixture set itself is not exactly the pinned one. Non-empty means REFUSE. */
  readonly refusals: readonly string[];
}

/**
 * Split the target models the snapshot lacks into pinned known fixtures and genuinely unknown rows, and check the
 * fixture set is exactly the pinned one.
 */
export function classifyKnownFixtures(
  tenantId: string,
  targetModels: readonly CanonicalEquipmentModel[],
  sourceModelIds: ReadonlySet<string>,
): KnownFixtureClassification {
  const pinned = new Map(KNOWN_SAMPLE_COMPANY_EQUIPMENT_MODELS.map((f) => [f.id, f]));
  const known: KnownFixtureClassification["known"][number][] = [];
  const unknown: string[] = [];
  const refusals: string[] = [];
  const fixtureRows = targetModels.filter((m) => m.sourceAuthority === SAMPLE_COMPANY_V2_SOURCE_AUTHORITY);
  for (const m of targetModels) {
    if (sourceModelIds.has(m.id)) continue;
    const pin = pinned.get(m.id);
    const isFixture = m.sourceAuthority === SAMPLE_COMPANY_V2_SOURCE_AUTHORITY;
    if (tenantId !== KNOWN_FIXTURE_TENANT_ID || (!pin && !isFixture)) { unknown.push(m.id); continue; }
    if (!pin) { refusals.push(`equipment_model ${m.id} is ${SAMPLE_COMPANY_V2_SOURCE_AUTHORITY} but not a pinned fixture`); continue; }
    if (!isFixture) { refusals.push(`equipment_model ${m.id} is a pinned fixture id but its sourceAuthority changed`); continue; }
    const fingerprint = equipmentModelFingerprint(m);
    if (fingerprint !== pin.fingerprint) { refusals.push(`equipment_model ${m.id} is a pinned fixture but its content changed`); continue; }
    known.push(Object.freeze({ kind: "equipment_model" as const, id: m.id, classification: KNOWN_NON_MIGRATED_FIXTURE, fingerprint }));
  }
  if (tenantId === KNOWN_FIXTURE_TENANT_ID && fixtureRows.length > 0) {
    const present = new Set(targetModels.map((m) => m.id));
    for (const id of pinned.keys()) if (!present.has(id)) refusals.push(`pinned fixture equipment_model ${id} is missing from the tenant`);
  }
  if (tenantId !== KNOWN_FIXTURE_TENANT_ID && fixtureRows.length > 0) {
    refusals.push(`${fixtureRows.length} ${SAMPLE_COMPANY_V2_SOURCE_AUTHORITY} equipment models are in a tenant that is not the pinned fixture tenant`);
  }
  return Object.freeze({ known: Object.freeze(known), unknown: Object.freeze(unknown), refusals: Object.freeze(refusals) });
}
