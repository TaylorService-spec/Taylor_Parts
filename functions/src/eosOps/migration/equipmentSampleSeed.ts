// THE EQUIPMENT REGISTER SAMPLE_DATA_SEED -- census, classify, copy once, verify (Controller EQUIPMENT ACTIVATION
// AUTHORIZED, 2026-10-01; GLOBAL OWNER RULING 2026-10-01: nothing stored in Firebase is real Taylor business data).
//
// The Firestore `equipment` collection, exported by the fenced migration-only inventory snapshot exporter (snapshot
// key `equipment`), seeded into eos_ops.equipment as SAMPLE data with lineage. This is NOT a production migration and
// mints NO production identity: every seeded record carries a `SAMPLE_DATA_SEED` CREATED event naming its Firestore
// document id, and its own deterministic EOS id.
//
// WHAT IS NEVER WEAKENED FOR SAMPLE DATA. A seeded record must satisfy the register's integrity exactly as a created
// one does: its customer is a PostgreSQL CRM Account, its site is a CRM site OF THAT Account, its operating company is a
// governed ACTIVE key of the tenant. A document that cannot is EXCLUDED_SAMPLE and reported by code -- never repaired
// by guessing a customer or a site.
//
// WHAT IS NOT CARRIED. Firestore `manufacturer` / `model` are free text with no governed Equipment Model mapping, so
// they are kept as lineage on the event, never forced onto equipment_model_id. A Firestore record installed from stock
// has no PostgreSQL custody to point at (the Firebase serialized units were not seeded as installed), so it seeds as a
// register record without an installed unit; its legacy linkage is lineage only.
//
// Replay-safe: the ids and the event keys derive from the tenant and the Firestore id, so a second COPY is NO_CHANGES.
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export const EQUIPMENT_SEED_MANIFEST_FORMAT = "EOS_EQUIPMENT_SAMPLE_SEED_MANIFEST";
export const SAMPLE_SEED_SOURCE = "SAMPLE_DATA_SEED";
const STATUSES = new Set(["ACTIVE", "INACTIVE", "RETIRED"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class EquipmentSeedError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "EquipmentSeedError";
  }
}

export interface EquipmentSeedManifest {
  readonly format: typeof EQUIPMENT_SEED_MANIFEST_FORMAT;
  readonly version: 1;
  readonly ruling: string;
  /** The operating company the sample register is held under. Firestore Equipment carries none; never inferred. */
  readonly operatingCompanyKey: string;
  /** Firestore ids deliberately left out, each with a reason. */
  readonly excluded: readonly { readonly legacyId: string; readonly reason: string }[];
}

export function validateEquipmentSeedManifest(raw: unknown): EquipmentSeedManifest {
  const m = raw as Record<string, unknown>;
  if (!m || m.format !== EQUIPMENT_SEED_MANIFEST_FORMAT || m.version !== 1) throw new EquipmentSeedError("MANIFEST_INVALID", `not an ${EQUIPMENT_SEED_MANIFEST_FORMAT} v1`);
  if (typeof m.ruling !== "string" || m.ruling.trim() === "") throw new EquipmentSeedError("MANIFEST_INVALID", "the manifest names its ruling");
  if (typeof m.operatingCompanyKey !== "string" || m.operatingCompanyKey.trim() === "") {
    throw new EquipmentSeedError("MANIFEST_INVALID", "operatingCompanyKey is stated: Firestore Equipment carries no company and none is inferred");
  }
  const excluded = Array.isArray(m.excluded) ? m.excluded : [];
  for (const e of excluded) {
    if (!e || typeof e.legacyId !== "string" || typeof e.reason !== "string" || e.reason.trim() === "") {
      throw new EquipmentSeedError("MANIFEST_INVALID", "every exclusion names a legacyId and a reason");
    }
  }
  return Object.freeze({ format: EQUIPMENT_SEED_MANIFEST_FORMAT, version: 1, ruling: m.ruling, operatingCompanyKey: m.operatingCompanyKey,
    excluded: Object.freeze(excluded.map((e: { legacyId: string; reason: string }) => Object.freeze({ legacyId: e.legacyId, reason: e.reason }))) });
}

export interface LegacyEquipmentDoc { readonly id: string; readonly data: Record<string, unknown> }

export type SeedDisposition = "PLANNED" | "PRESENT" | "EXCLUDED_SAMPLE" | "MANIFEST_EXCLUDED";

export interface SeedFinding {
  readonly legacyId: string;
  readonly equipmentId: string;
  readonly disposition: SeedDisposition;
  readonly code: string | null;
}

export interface SeedRow {
  readonly equipmentId: string;
  readonly legacyId: string;
  readonly accountId: string;
  readonly customerLocationId: string;
  readonly name: string;
  readonly status: string;
  readonly serialNumber: string | null;
  readonly assetTag: string | null;
  readonly installedOn: string | null;
  readonly warrantyExpiresOn: string | null;
  readonly notes: string | null;
  readonly lineage: Record<string, unknown>;
}

export interface SeedPlan {
  readonly seedKind: typeof SAMPLE_SEED_SOURCE;
  readonly snapshotSha256: string;
  readonly manifestSha256: string;
  readonly rows: readonly SeedRow[];
  readonly findings: readonly SeedFinding[];
  readonly counts: Readonly<Record<string, number>>;
}

/** The deterministic EOS id of a seeded Firestore document, per tenant. */
export function sampleSeedEquipmentId(tenantId: string, legacyId: string): string {
  return "eq_sampleseed_" + createHash("sha256").update(JSON.stringify(["equipmentSampleSeed", tenantId, legacyId])).digest("hex").slice(0, 32);
}
export const sampleSeedEventKey = (legacyId: string): string => `sample-seed:equipment:${legacyId}`;

const text = (v: unknown, max = 4000): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null;

interface TargetState {
  readonly accounts: ReadonlyMap<string, string>;
  readonly sites: ReadonlyMap<string, string>;
  readonly companyKeyActive: boolean;
  readonly present: ReadonlySet<string>;
}

export async function readEquipmentSeedTarget(db: Pick<PoolClient, "query">, tenantId: string, companyKey: string, ids: readonly string[]): Promise<TargetState> {
  const accounts = new Map((await db.query(`SELECT id, status::text AS status FROM eos_crm.accounts WHERE tenant_id = $1`, [tenantId])).rows
    .map((r) => [String(r.id), String(r.status)] as [string, string]));
  const sites = new Map((await db.query(`SELECT id, account_id FROM eos_crm.account_locations WHERE tenant_id = $1`, [tenantId])).rows
    .map((r) => [String(r.id), String(r.account_id)] as [string, string]));
  const company = await db.query(`SELECT 1 FROM eos_policy.tenant_operating_company_keys WHERE tenant_id = $1 AND operating_company_key = $2 AND status = 'ACTIVE'`,
    [tenantId, companyKey]);
  const present = new Set((await db.query(`SELECT id FROM eos_ops.equipment WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, [...ids]])).rows
    .map((r) => String(r.id)));
  return { accounts, sites, companyKeyActive: company.rows.length > 0, present };
}

/** Classify every Firestore document. Pure: the target state is read by the caller. */
export function planEquipmentSeed(input: {
  readonly tenantId: string; readonly snapshotSha256: string; readonly manifestSha256: string;
  readonly manifest: EquipmentSeedManifest; readonly docs: readonly LegacyEquipmentDoc[]; readonly target: TargetState;
}): SeedPlan {
  if (!input.target.companyKeyActive) {
    throw new EquipmentSeedError("OPERATING_COMPANY_NOT_GOVERNED", `operating company key '${input.manifest.operatingCompanyKey}' is not an ACTIVE key of this tenant`);
  }
  const excluded = new Map(input.manifest.excluded.map((e) => [e.legacyId, e.reason]));
  const rows: SeedRow[] = [];
  const findings: SeedFinding[] = [];
  const seen = new Set<string>();
  for (const doc of [...input.docs].sort((a, b) => a.id.localeCompare(b.id))) {
    const equipmentId = sampleSeedEquipmentId(input.tenantId, doc.id);
    const finding = (disposition: SeedDisposition, code: string | null) => findings.push(Object.freeze({ legacyId: doc.id, equipmentId, disposition, code }));
    if (seen.has(doc.id)) { finding("EXCLUDED_SAMPLE", "DUPLICATE_DOCUMENT"); continue; }
    seen.add(doc.id);
    if (excluded.has(doc.id)) { finding("MANIFEST_EXCLUDED", "MANIFEST_EXCLUDED"); continue; }
    const d = doc.data ?? {};
    const accountId = text(d.accountId, 200);
    const locationId = text(d.locationId, 200);
    const name = text(d.name, 200);
    if (!name) { finding("EXCLUDED_SAMPLE", "NAME_MISSING"); continue; }
    if (!accountId) { finding("EXCLUDED_SAMPLE", "ACCOUNT_MISSING"); continue; }
    if (!locationId) { finding("EXCLUDED_SAMPLE", "SITE_MISSING"); continue; }
    if (!input.target.accounts.has(accountId)) { finding("EXCLUDED_SAMPLE", "ACCOUNT_UNRESOLVED"); continue; }
    if (!input.target.sites.has(locationId)) { finding("EXCLUDED_SAMPLE", "SITE_UNRESOLVED"); continue; }
    if (input.target.sites.get(locationId) !== accountId) { finding("EXCLUDED_SAMPLE", "SITE_NOT_OF_ACCOUNT"); continue; }
    const status = typeof d.status === "string" && STATUSES.has(d.status) ? d.status : null;
    if (!status) { finding("EXCLUDED_SAMPLE", "STATUS_INVALID"); continue; }
    if (input.target.present.has(equipmentId)) { finding("PRESENT", null); continue; }
    const installedOn = typeof d.installedDate === "string" && DATE.test(d.installedDate) ? d.installedDate : null;
    const warrantyExpiresOn = typeof d.warrantyExpiresDate === "string" && DATE.test(d.warrantyExpiresDate) ? d.warrantyExpiresDate : null;
    rows.push(Object.freeze({
      equipmentId, legacyId: doc.id, accountId, customerLocationId: locationId, name, status,
      serialNumber: text(d.serialNumber, 200), assetTag: text(d.assetTag, 200), installedOn, warrantyExpiresOn, notes: text(d.notes),
      lineage: {
        legacyFirestoreId: doc.id, manufacturer: text(d.manufacturer, 200), model: text(d.model, 200),
        legacySerializedAssetId: text(d.serializedAssetId, 200),
        droppedDates: [installedOn === null && d.installedDate != null ? "installedDate" : null,
          warrantyExpiresOn === null && d.warrantyExpiresDate != null ? "warrantyExpiresDate" : null].filter(Boolean),
      },
    }));
    finding("PLANNED", null);
  }
  const counts: Record<string, number> = { documents: input.docs.length };
  for (const f of findings) counts[f.disposition] = (counts[f.disposition] ?? 0) + 1;
  return Object.freeze({ seedKind: SAMPLE_SEED_SOURCE, snapshotSha256: input.snapshotSha256, manifestSha256: input.manifestSha256,
    rows: Object.freeze(rows), findings: Object.freeze(findings), counts: Object.freeze(counts) });
}

export interface SeedInput {
  readonly tenantId: string;
  readonly snapshotSha256: string;
  readonly manifestSha256: string;
  readonly manifest: EquipmentSeedManifest;
  readonly docs: readonly LegacyEquipmentDoc[];
  readonly performedBy: string;
}

async function plan(db: Pick<PoolClient, "query">, input: SeedInput): Promise<SeedPlan> {
  const ids = input.docs.map((d) => sampleSeedEquipmentId(input.tenantId, d.id));
  const target = await readEquipmentSeedTarget(db, input.tenantId, input.manifest.operatingCompanyKey, ids);
  return planEquipmentSeed({ ...input, target });
}

/** READ ONLY. */
export async function censusEquipmentSeed(pool: Pool, input: SeedInput): Promise<SeedPlan> {
  return plan(pool, input);
}

/** COPY ONCE, one transaction: every PLANNED row + its SAMPLE_DATA_SEED CREATED event. A rerun is NO_CHANGES. */
export async function copyEquipmentSeedOnce(pool: Pool, input: SeedInput): Promise<{ outcome: "COPIED" | "NO_CHANGES"; inserted: number; plan: SeedPlan }> {
  if (typeof input.performedBy !== "string" || input.performedBy.trim() === "" || input.performedBy === "census") {
    throw new EquipmentSeedError("PRINCIPAL_REQUIRED", "the seed is executed as a named EOS Principal");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`equipment-sample-seed:${input.tenantId}`]);
    const p = await plan(client, input);
    for (const r of p.rows) {
      await client.query(
        `INSERT INTO eos_ops.equipment (id, tenant_id, operating_company_key, account_id, customer_location_id, name, status,
           serial_number, asset_tag, installed_on, warranty_expires_on, notes, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7::eos_ops.ops_equipment_status,$8,$9,$10,$11,$12,$13,$13)`,
        [r.equipmentId, input.tenantId, input.manifest.operatingCompanyKey, r.accountId, r.customerLocationId, r.name, r.status,
          r.serialNumber, r.assetTag, r.installedOn, r.warrantyExpiresOn, r.notes, input.performedBy]);
      await client.query(
        `INSERT INTO eos_ops.equipment_events (id, tenant_id, equipment_id, event_type, operating_company_key, account_id, customer_location_id,
           source, reason, changes, idempotency_key, request_fingerprint, actor_principal_id)
         VALUES ($1,$2,$3,'CREATED',$4,$5,$6,'SAMPLE_DATA_SEED',$7,$8,$9,$10,$11)`,
        [`eqe_${randomUUID()}`, input.tenantId, r.equipmentId, input.manifest.operatingCompanyKey, r.accountId, r.customerLocationId,
          `${input.manifest.ruling}: SAMPLE_DATA_SEED of Firebase equipment ${r.legacyId} (not a production identity)`,
          JSON.stringify(r.lineage), sampleSeedEventKey(r.legacyId), `${input.snapshotSha256}:${input.manifestSha256}`, input.performedBy]);
    }
    await client.query("COMMIT");
    return { outcome: p.rows.length === 0 ? "NO_CHANGES" : "COPIED", inserted: p.rows.length, plan: p };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** READ ONLY. Every resolvable document is present with its lineage event; nothing PLANNED remains. */
export async function verifyEquipmentSeed(pool: Pool, input: SeedInput): Promise<{ verdict: "VERIFIED" | "NOT_VERIFIED"; expected: number; found: number; missingEvents: number; plan: SeedPlan }> {
  const p = await plan(pool, input);
  const present = p.findings.filter((f) => f.disposition === "PRESENT").map((f) => f.equipmentId);
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM eos_ops.equipment_events WHERE tenant_id = $1 AND source = 'SAMPLE_DATA_SEED' AND event_type = 'CREATED'
        AND equipment_id = ANY($2::text[])`, [input.tenantId, present]);
  const found = Number(rows[0]?.n ?? 0);
  const missingEvents = present.length - found;
  return { verdict: p.rows.length === 0 && missingEvents === 0 ? "VERIFIED" : "NOT_VERIFIED", expected: present.length + p.rows.length, found, missingEvents, plan: p };
}
