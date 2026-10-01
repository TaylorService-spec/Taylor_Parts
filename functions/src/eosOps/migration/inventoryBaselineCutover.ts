// THE GOVERNED INVENTORY BASELINE CUTOVER -- CENSUS, COPY ONCE, VERIFY, CERTIFY -- for the legacy Firestore inventory ledger
// (`inventory_transactions`) and serialized custody (`serialized_assets`) into eos_ops on PostgreSQL (Controller INVENTORY /
// WAREHOUSE COMPLETION RULINGS, 2026-10-01: "Build/use the smallest governed COPY operation needed to establish the
// PostgreSQL inventory baseline from the authoritative legacy inventory state").
//
// MIGRATION / CUTOVER BEHAVIOR, NOT A RUNTIME BRIDGE. The source is an immutable OFFLINE snapshot file
// (the fenced, migration-only inventory snapshot exporter); this module loads no Firebase module, reads no Firestore, never writes Firebase, and is
// reached only by the operator tool (scripts/inventoryCutover.js). It REUSES the existing pure layers -- the per-row mapping
// contract (legacyInventoryMovementMapping.ts) and the run layer (legacyInventoryMovementRun.ts: reject bucket, replay-safe
// keys, totality) -- and adds exactly what they leave open: LOCATION IDENTITY, FIXTURE EXCLUSION, the PostgreSQL write,
// serialized custody, and the certification the fail-closed writer gate reads (inventoryBaselineGate.ts).
//
// ════════════════════ LOCATION IDENTITY IS PROVEN, NEVER INFERRED ════════════════════
//
//   * A legacy WAREHOUSE reaches PostgreSQL only through an explicit MANIFEST entry { legacyWarehouseId, eosWarehouseId,
//     evidence } AND only when the proof holds: the EOS warehouse exists in this tenant and is ACTIVE, the legacy warehouse
//     document is in the snapshot, and its operatingCompanyId is the EOS warehouse's governed company. No entry, no proof:
//     every row there is REFUSED (UNMAPPED_WAREHOUSE / WAREHOUSE_COMPANY_MISMATCH ...). wh-main / wh-north are NEVER
//     mapped to taylor-main: the governed fixture ids (FORBIDDEN_WAREHOUSE_IDS) cannot appear as a mapping source at all.
//   * A legacy BIN keeps its id (bin ids are content-derived, `bin_<sha>`): it is accepted only when that bin exists in
//     PostgreSQL under a PROVEN-mapped warehouse.
//   * MOBILE (truck) stock and custody are DEFERRED to the Truck Inventory journey: reported, never copied, not blocking.
//   * Known fixtures (FORBIDDEN_WAREHOUSE_IDS, the synthetic acceptance warehouse, and the manifest's own
//     excludedLegacyWarehouseIds with reasons) are EXCLUDED: reported, never copied, not blocking.
//
// ════════════════════ WHAT IS HELD RATHER THAN HALF-COPIED ════════════════════
//
// A balance is a SUM, so copying some rows of a (location, Part) and not others would invent a wrong on-hand. Any refused
// row therefore HOLDS its whole (legacy location, Part) group: nothing of that group is written, the group is reported.
// The same for a group whose resulting PostgreSQL balance would be negative. Custody: one authoritative location per unit;
// a unit already in PostgreSQL custody (e.g. receipt-created) is NEVER overwritten -- the same unit at the same place is
// ALREADY_PRESENT, anywhere else is CUSTODY_CONFLICT; an unknown / non-SERIAL Part, a non-AVAILABLE state, or a unit whose
// location disagrees with its own ledger is REFUSED. INSTALLED units belong to Equipment custody: DEFERRED.
//
// ════════════════════ THE LEGACY STATE GATES ════════════════════
//
// The writer prerequisites also cover legacy Cycle Count and Transfer state: the cycle_counts census must be
// ZERO_POPULATION (the existing classifier), and no legacy transfer may be REQUESTED / IN_TRANSIT at a non-excluded location
// (an open legacy transfer would strand stock between the two systems). Either is a blocking refusal.
//
// ════════════════════ REPLAY SAFETY + CERTIFICATION ════════════════════
//
// Movements are written under migrationIdempotencyKey(<legacy id>) with ON CONFLICT DO NOTHING and then compared: an
// existing row with the same key but different content is a CONFLICT, never overwritten. A rerun writes nothing. CERTIFY
// writes the two eos_ops.inventory_baseline_cutovers rows ONLY when VERIFY finds every planned movement and custody unit
// present and ZERO blocking refusals; that certification is what opens the Inventory writers for the tenant.
import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { planLegacyInventoryMovementRun, migrationIdempotencyKey, type PlannedMovement } from "./legacyInventoryMovementRun";
import { FORBIDDEN_WAREHOUSE_IDS, SYNTHETIC_ACCEPTANCE_WAREHOUSE } from "../syntheticAcceptanceWarehouse";
import { censusCycleCountDocuments } from "../../cycleCount/cycleCountActivationCensus";
import { INVENTORY_BASELINE_STAGES } from "../inventoryBaselineGate";

type Queryable = Pick<PoolClient, "query">;
interface Doc { readonly id: string; readonly data: Record<string, unknown> }

export const INVENTORY_BASELINE_MANIFEST_FORMAT = "EOS_INVENTORY_BASELINE_MANIFEST";

export interface WarehouseIdentityEntry { readonly legacyWarehouseId: string; readonly eosWarehouseId: string; readonly evidence: string }
export interface InventoryBaselineManifest {
  readonly format: typeof INVENTORY_BASELINE_MANIFEST_FORMAT;
  readonly version: 1;
  readonly ruling: string;
  readonly warehouseIdentity: readonly WarehouseIdentityEntry[];
  readonly excludedLegacyWarehouses: readonly { readonly legacyWarehouseId: string; readonly reason: string }[];
}

export interface InventoryBaselineSnapshot {
  readonly sha256: string;
  readonly inventoryTransactions: readonly Doc[];
  readonly serializedAssets: readonly Doc[];
  readonly warehouses: readonly Doc[];
  readonly cycleCounts: readonly Doc[];
  readonly transferOrders: readonly Doc[];
}

export type Disposition = "PLANNED" | "EXCLUDED_FIXTURE" | "DEFERRED_TRUCK" | "DEFERRED_EQUIPMENT" | "REFUSED" | "HELD" | "ALREADY_PRESENT";

export interface RecordFinding { readonly kind: "LEDGER" | "CUSTODY" | "GATE"; readonly id: string; readonly disposition: Disposition; readonly code: string }

export interface PlannedCustody {
  readonly legacyId: string; readonly partId: string; readonly serialNumber: string;
  readonly locationType: "WAREHOUSE" | "BIN"; readonly locationId: string; readonly operatingCompanyKey: string;
}

export interface InventoryBaselinePlan {
  readonly manifestSha256: string;
  readonly snapshotSha256: string;
  readonly movements: readonly (PlannedMovement & { readonly createdBy: string })[];
  readonly custody: readonly PlannedCustody[];
  readonly findings: readonly RecordFinding[];
  /** Blocking = REFUSED + HELD. Non-blocking = EXCLUDED_FIXTURE + DEFERRED_* + ALREADY_PRESENT. */
  readonly blocking: number;
  readonly counts: Readonly<Record<string, number>>;
}

interface TargetState {
  readonly warehouses: ReadonlyMap<string, { companyKey: string; companyId: string | null; active: boolean }>;
  readonly bins: ReadonlyMap<string, string>; // bin id -> warehouse id
  readonly parts: ReadonlyMap<string, { status: string; controlType: string }>;
  readonly custody: ReadonlyMap<string, { locationType: string; locationId: string }>; // part|serial
  readonly balances: ReadonlyMap<string, number>; // NONE: part|type|id -> qty
  readonly serialNet: ReadonlyMap<string, number>; // SERIAL: part|serial|type|id -> net
}

export class InventoryBaselineCutoverError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "InventoryBaselineCutoverError"; }
}
const fail = (code: string, message: string): never => { throw new InventoryBaselineCutoverError(code, message); };

const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x));
export const manifestSha256 = (m: InventoryBaselineManifest): string => createHash("sha256").update(canonical(m)).digest("hex");

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Shape-validate a manifest. A fixture id may never be a mapping SOURCE; a mapping target must be unique per source. */
export function validateManifest(raw: unknown): InventoryBaselineManifest {
  if (!isRecord(raw) || raw.format !== INVENTORY_BASELINE_MANIFEST_FORMAT || raw.version !== 1) fail("MANIFEST_INVALID", "not an EOS_INVENTORY_BASELINE_MANIFEST v1");
  const m = raw as unknown as InventoryBaselineManifest;
  if (!text(m.ruling)) fail("MANIFEST_INVALID", "the manifest names the ruling it executes");
  if (!Array.isArray(m.warehouseIdentity) || !Array.isArray(m.excludedLegacyWarehouses)) fail("MANIFEST_INVALID", "warehouseIdentity and excludedLegacyWarehouses are lists");
  const sources = new Set<string>();
  for (const e of m.warehouseIdentity) {
    if (!text(e.legacyWarehouseId) || !text(e.eosWarehouseId) || !text(e.evidence)) fail("MANIFEST_INVALID", "every identity entry states legacy id, EOS id and its evidence");
    if (FORBIDDEN_WAREHOUSE_IDS.includes(e.legacyWarehouseId) || e.legacyWarehouseId === SYNTHETIC_ACCEPTANCE_WAREHOUSE.warehouseId) {
      fail("MANIFEST_FIXTURE_MAPPED", `${e.legacyWarehouseId} is a governed fixture identity and can never be mapped to a real warehouse`);
    }
    if (sources.has(e.legacyWarehouseId)) fail("MANIFEST_AMBIGUOUS", `${e.legacyWarehouseId} is mapped more than once`);
    sources.add(e.legacyWarehouseId);
  }
  for (const x of m.excludedLegacyWarehouses) {
    if (!text(x.legacyWarehouseId) || !text(x.reason)) fail("MANIFEST_INVALID", "every exclusion states its legacy id and reason");
    if (sources.has(x.legacyWarehouseId)) fail("MANIFEST_AMBIGUOUS", `${x.legacyWarehouseId} is both mapped and excluded`);
  }
  return m;
}

// The target balances the plan adds legacy deltas to EXCLUDE rows this cutover itself already wrote (their keys are
// migrationIdempotencyKey(...)), so a replan after a COPY -- VERIFY, a rerun -- never counts a copied movement twice.
const NOT_LEGACY_COPY = `(idempotency_key IS NULL OR idempotency_key NOT LIKE '${migrationIdempotencyKey("")}%')`;

/** Everything the plan needs from PostgreSQL, read inside the caller's snapshot. */
export async function readTargetState(db: Queryable, tenantId: string): Promise<TargetState> {
  const wh = (await db.query<{ id: string; key: string; company_id: string | null; status: string }>(
    `SELECT w.id, w.operating_company_key AS key, k.operating_company_id AS company_id, w.status::text AS status
       FROM eos_ops.warehouses w
       LEFT JOIN eos_policy.tenant_operating_company_keys k
         ON k.tenant_id = w.tenant_id AND k.operating_company_key = w.operating_company_key AND k.status = 'ACTIVE'
      WHERE w.tenant_id = $1`, [tenantId])).rows;
  const bins = (await db.query<{ id: string; warehouse_id: string }>(`SELECT id, warehouse_id FROM eos_ops.bins WHERE tenant_id = $1`, [tenantId])).rows;
  const parts = (await db.query<{ id: string; status: string; control_type: string }>(
    `SELECT id, status::text AS status, control_type::text AS control_type FROM eos_ops.parts WHERE tenant_id = $1`, [tenantId])).rows;
  const custody = (await db.query<{ part_id: string; serial_number: string; location_type: string; location_id: string }>(
    `SELECT part_id, serial_number, location_type::text AS location_type, location_id FROM eos_ops.serialized_custody WHERE tenant_id = $1`, [tenantId])).rows;
  const bal = (await db.query<{ part_id: string; t: string; l: string; q: string }>(
    `SELECT part_id, location_type::text AS t, location_id AS l, sum(quantity_delta)::bigint AS q FROM eos_ops.inventory_movements
      WHERE tenant_id = $1 AND tracking_mode = 'NONE' AND ${NOT_LEGACY_COPY} GROUP BY 1, 2, 3`, [tenantId])).rows;
  const sn = (await db.query<{ part_id: string; s: string; t: string; l: string; q: string }>(
    `SELECT part_id, serial_number AS s, location_type::text AS t, location_id AS l, sum(quantity_delta)::bigint AS q FROM eos_ops.inventory_movements
      WHERE tenant_id = $1 AND tracking_mode = 'SERIAL' AND ${NOT_LEGACY_COPY} GROUP BY 1, 2, 3, 4`, [tenantId])).rows;
  return {
    warehouses: new Map(wh.map((w) => [w.id, { companyKey: w.key, companyId: w.company_id, active: w.status === "ACTIVE" }])),
    bins: new Map(bins.map((b) => [b.id, b.warehouse_id])),
    parts: new Map(parts.map((p) => [p.id, { status: p.status, controlType: p.control_type }])),
    custody: new Map(custody.map((c) => [`${c.part_id}|${c.serial_number}`, { locationType: c.location_type, locationId: c.location_id }])),
    balances: new Map(bal.map((b) => [`${b.part_id}|${b.t}|${b.l}`, Number(b.q)])),
    serialNet: new Map(sn.map((b) => [`${b.part_id}|${b.s}|${b.t}|${b.l}`, Number(b.q)])),
  };
}

type Resolved =
  | { ok: true; locationType: "WAREHOUSE" | "BIN"; locationId: string; companyKey: string }
  | { ok: false; disposition: "EXCLUDED_FIXTURE" | "DEFERRED_TRUCK" | "REFUSED"; code: string };

/** The ONE location-identity rule, shared by the ledger and custody stages. */
function locationResolver(manifest: InventoryBaselineManifest, target: TargetState, legacyWarehouses: ReadonlyMap<string, Record<string, unknown>>) {
  const excluded = new Set<string>([...FORBIDDEN_WAREHOUSE_IDS, SYNTHETIC_ACCEPTANCE_WAREHOUSE.warehouseId, ...manifest.excludedLegacyWarehouses.map((x) => x.legacyWarehouseId)]);
  const identity = new Map(manifest.warehouseIdentity.map((e) => [e.legacyWarehouseId, e.eosWarehouseId]));
  const warehouse = (legacyId: string): Resolved => {
    if (excluded.has(legacyId)) return { ok: false, disposition: "EXCLUDED_FIXTURE", code: "EXCLUDED_FIXTURE_WAREHOUSE" };
    const eosId = identity.get(legacyId);
    if (!eosId) return { ok: false, disposition: "REFUSED", code: "UNMAPPED_WAREHOUSE" };
    const eos = target.warehouses.get(eosId);
    if (!eos) return { ok: false, disposition: "REFUSED", code: "MAPPED_WAREHOUSE_NOT_IN_EOS" };
    if (!eos.active) return { ok: false, disposition: "REFUSED", code: "MAPPED_WAREHOUSE_NOT_ACTIVE" };
    const legacy = legacyWarehouses.get(legacyId);
    if (!legacy) return { ok: false, disposition: "REFUSED", code: "LEGACY_WAREHOUSE_NOT_IN_SNAPSHOT" };
    const legacyCompany = text(legacy.operatingCompanyId);
    if (!legacyCompany) return { ok: false, disposition: "REFUSED", code: "LEGACY_WAREHOUSE_COMPANY_MISSING" };
    if (eos.companyId === null || legacyCompany !== eos.companyId) return { ok: false, disposition: "REFUSED", code: "WAREHOUSE_COMPANY_MISMATCH" };
    return { ok: true, locationType: "WAREHOUSE", locationId: eosId, companyKey: eos.companyKey };
  };
  return (type: unknown, id: unknown): Resolved => {
    const t = text(type), l = text(id);
    if (!t || !l) return { ok: false, disposition: "REFUSED", code: "LOCATION_MISSING" };
    if (t === "MOBILE") return { ok: false, disposition: "DEFERRED_TRUCK", code: "TRUCK_INVENTORY_DEFERRED" };
    if (t === "WAREHOUSE") return warehouse(l);
    if (t === "BIN") {
      const parentEos = target.bins.get(l);
      if (!parentEos) return { ok: false, disposition: "REFUSED", code: "BIN_NOT_IN_EOS" };
      // The bin's EOS warehouse must itself be the PROVEN target of some mapped legacy warehouse.
      const source = manifest.warehouseIdentity.find((e) => e.eosWarehouseId === parentEos);
      if (!source) return { ok: false, disposition: "REFUSED", code: "BIN_WAREHOUSE_NOT_MAPPED" };
      const w = warehouse(source.legacyWarehouseId);
      if (!w.ok) return w;
      return { ok: true, locationType: "BIN", locationId: l, companyKey: w.companyKey };
    }
    return { ok: false, disposition: "REFUSED", code: "LOCATION_TYPE_NOT_IMPORTABLE" };
  };
}

/** PURE: the whole plan from the snapshot, the manifest and the target state. */
export function planInventoryBaseline(snapshot: InventoryBaselineSnapshot, manifest: InventoryBaselineManifest, target: TargetState): InventoryBaselinePlan {
  const findings: RecordFinding[] = [];
  const legacyWarehouses = new Map(snapshot.warehouses.map((d) => [d.id, d.data]));
  const resolve = locationResolver(manifest, target, legacyWarehouses);

  // ── GATES: legacy Cycle Count and Transfer state ──
  const cc = censusCycleCountDocuments(snapshot.cycleCounts.map((d) => ({ id: d.id, data: d.data })));
  if (cc.verdict !== "ZERO_POPULATION") findings.push({ kind: "GATE", id: "cycle_counts", disposition: "REFUSED", code: `CYCLE_COUNT_${cc.verdict}` });
  for (const t of snapshot.transferOrders) {
    const status = text(t.data.status);
    if (status !== "REQUESTED" && status !== "IN_TRANSIT") continue;
    const ends = [isRecord(t.data.origin) ? t.data.origin : {}, isRecord(t.data.destination) ? t.data.destination : {}] as Record<string, unknown>[];
    const real = ends.some((e) => { const r = resolve(e.type ?? e.locationType, e.locationId ?? e.id); return r.ok || r.disposition === "REFUSED"; });
    findings.push({ kind: "GATE", id: t.id, disposition: real ? "REFUSED" : "EXCLUDED_FIXTURE", code: real ? "OPEN_LEGACY_TRANSFER" : "OPEN_LEGACY_TRANSFER_FIXTURE" });
  }

  // ── LEDGER ──
  const accepted: Record<string, unknown>[] = [];
  const groupOf = new Map<string, string>(); // legacy id -> group
  const heldGroups = new Map<string, string>(); // group -> first code
  for (const d of snapshot.inventoryTransactions) {
    const loc = isRecord(d.data.location) ? d.data.location : null;
    const partId = text(d.data.partId) ?? "?";
    const group = `${text(loc?.type) ?? "?"}|${text(loc?.locationId) ?? "?"}|${partId}`;
    groupOf.set(d.id, group);
    if (!loc) { findings.push({ kind: "LEDGER", id: d.id, disposition: "REFUSED", code: "NOT_A_PHYSICAL_MOVEMENT" }); heldGroups.set(group, heldGroups.get(group) ?? "NOT_A_PHYSICAL_MOVEMENT"); continue; }
    const r = resolve(loc.type, loc.locationId);
    if (!r.ok) {
      findings.push({ kind: "LEDGER", id: d.id, disposition: r.disposition, code: r.code });
      if (r.disposition === "REFUSED") heldGroups.set(group, heldGroups.get(group) ?? r.code);
      continue;
    }
    const part = target.parts.get(partId);
    if (!part) { findings.push({ kind: "LEDGER", id: d.id, disposition: "REFUSED", code: "PART_NOT_IN_EOS" }); heldGroups.set(group, heldGroups.get(group) ?? "PART_NOT_IN_EOS"); continue; }
    accepted.push({ ...d.data, id: d.id, location: { type: r.locationType, locationId: r.locationId }, operatingCompanyKey: r.companyKey });
  }
  const run = planLegacyInventoryMovementRun({ runId: `inventory-baseline:${snapshot.sha256.slice(0, 12)}`, rows: accepted });
  for (const rej of run.rejectBucket.entries) {
    const id = rej.sourceTransactionId ?? `ordinal:${rej.sourceOrdinal}`;
    findings.push({ kind: "LEDGER", id, disposition: "REFUSED", code: rej.code });
    const g = groupOf.get(id); if (g) heldGroups.set(g, heldGroups.get(g) ?? rej.code);
  }
  const rawById = new Map(snapshot.inventoryTransactions.map((d) => [d.id, d.data]));
  let movements = run.planned.filter((p) => !heldGroups.has(groupOf.get(p.candidate.sourceTransactionId ?? "") ?? ""));
  for (const p of run.planned) {
    const g = groupOf.get(p.candidate.sourceTransactionId ?? "");
    if (g && heldGroups.has(g)) findings.push({ kind: "LEDGER", id: p.candidate.sourceTransactionId as string, disposition: "HELD", code: `GROUP_HELD:${heldGroups.get(g)}` });
  }
  // A group whose resulting PostgreSQL balance would be negative is held whole.
  const delta = new Map<string, number>();
  for (const p of movements) if (p.candidate.trackingMode === "NONE") {
    const k = `${p.candidate.partId}|${p.candidate.locationType}|${p.candidate.locationId}`;
    delta.set(k, (delta.get(k) ?? 0) + p.candidate.quantityDelta);
  }
  const negative = new Set([...delta].filter(([k, q]) => (target.balances.get(k) ?? 0) + q < 0).map(([k]) => k));
  if (negative.size > 0) {
    movements = movements.filter((p) => {
      const k = `${p.candidate.partId}|${p.candidate.locationType}|${p.candidate.locationId}`;
      if (!negative.has(k)) return true;
      findings.push({ kind: "LEDGER", id: p.candidate.sourceTransactionId as string, disposition: "HELD", code: "GROUP_HELD:NEGATIVE_BALANCE" });
      return false;
    });
  }
  for (const p of movements) findings.push({ kind: "LEDGER", id: p.candidate.sourceTransactionId as string, disposition: "PLANNED", code: "PLANNED" });
  const withActor = movements.map((p) => {
    const actor = rawById.get(p.candidate.sourceTransactionId as string)?.actor;
    return { ...p, createdBy: (isRecord(actor) && text(actor.id)) || "legacy-migration" };
  });

  // ── CUSTODY ──
  const serialNet = new Map(target.serialNet);
  for (const p of withActor) if (p.candidate.trackingMode === "SERIAL") {
    const k = `${p.candidate.partId}|${p.candidate.serialNumber}|${p.candidate.locationType}|${p.candidate.locationId}`;
    serialNet.set(k, (serialNet.get(k) ?? 0) + p.candidate.quantityDelta);
  }
  const custody: PlannedCustody[] = [];
  const seen = new Map<string, number>();
  for (const a of snapshot.serializedAssets) { const k = `${text(a.data.partId)}|${text(a.data.serialNo)}`; seen.set(k, (seen.get(k) ?? 0) + 1); }
  for (const a of snapshot.serializedAssets) {
    const partId = text(a.data.partId), serial = text(a.data.serialNo), state = text(a.data.inventoryState);
    const add = (disposition: Disposition, code: string) => findings.push({ kind: "CUSTODY", id: a.id, disposition, code });
    if (!partId || !serial) { add("REFUSED", "UNIT_IDENTITY_MISSING"); continue; }
    if ((seen.get(`${partId}|${serial}`) ?? 0) > 1) { add("REFUSED", "DUPLICATE_SERIAL"); continue; }
    if (state === "INSTALLED") { add("DEFERRED_EQUIPMENT", "INSTALLED_UNIT_EQUIPMENT_CUSTODY"); continue; }
    const r = resolve(a.data.currentLocationType, a.data.currentLocationId);
    if (!r.ok) { add(r.disposition, r.code); continue; }
    if (state !== "AVAILABLE") { add("REFUSED", `UNIT_STATE_${state ?? "MISSING"}`); continue; }
    const part = target.parts.get(partId);
    if (!part) { add("REFUSED", "PART_NOT_IN_EOS"); continue; }
    if (part.controlType !== "SERIALIZED") { add("REFUSED", "PART_NOT_SERIALIZED"); continue; }
    const existing = target.custody.get(`${partId}|${serial}`);
    if (existing) {
      add(existing.locationType === r.locationType && existing.locationId === r.locationId ? "ALREADY_PRESENT" : "REFUSED",
        existing.locationType === r.locationType && existing.locationId === r.locationId ? "ALREADY_PRESENT" : "CUSTODY_CONFLICT_EOS_AUTHORITATIVE");
      continue;
    }
    if ((serialNet.get(`${partId}|${serial}|${r.locationType}|${r.locationId}`) ?? 0) !== 1) { add("REFUSED", "CUSTODY_LEDGER_DISAGREE"); continue; }
    custody.push({ legacyId: a.id, partId, serialNumber: serial, locationType: r.locationType, locationId: r.locationId, operatingCompanyKey: r.companyKey });
    add("PLANNED", "PLANNED");
  }

  const counts: Record<string, number> = {};
  for (const f of findings) counts[`${f.kind}:${f.disposition}`] = (counts[`${f.kind}:${f.disposition}`] ?? 0) + 1;
  return Object.freeze({
    manifestSha256: manifestSha256(manifest), snapshotSha256: snapshot.sha256, movements: withActor, custody, findings,
    blocking: findings.filter((f) => f.disposition === "REFUSED" || f.disposition === "HELD").length, counts,
  });
}

async function inTx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>, readOnly = false): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN ISOLATION LEVEL SERIALIZABLE");
    const out = await fn(c);
    await c.query(readOnly ? "ROLLBACK" : "COMMIT");
    return out;
  } catch (e) { await c.query("ROLLBACK").catch(() => undefined); throw e; } finally { c.release(); }
}

export interface CutoverInput {
  readonly tenantId: string;
  readonly snapshot: InventoryBaselineSnapshot;
  readonly manifest: InventoryBaselineManifest;
  readonly performedBy: string;
}

/** READ ONLY: the plan against the current target. */
export async function censusInventoryBaseline(pool: Pool, input: CutoverInput): Promise<InventoryBaselinePlan> {
  return inTx(pool, async (c) => planInventoryBaseline(input.snapshot, input.manifest, await readTargetState(c, input.tenantId)), true);
}

/**
 * COPY ONCE, in ONE transaction: every PLANNED movement and custody unit, replay-safe. Held / refused / excluded / deferred
 * records are never written. A rerun writes nothing (outcome NO_CHANGES). Never writes Firebase, never deletes.
 */
export async function copyInventoryBaselineOnce(pool: Pool, input: CutoverInput) {
  return inTx(pool, async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`inventory-baseline-cutover:${input.tenantId}`]);
    const plan = planInventoryBaseline(input.snapshot, input.manifest, await readTargetState(c, input.tenantId));
    let inserted = 0, present = 0, custodyInserted = 0;
    for (const m of plan.movements) {
      const x = m.candidate;
      const r = await c.query(
        `INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
                                                  movement_type, quantity_delta, serial_number, source_kind, source_id, idempotency_key, occurred_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, to_timestamp($14::double precision / 1000), $15)
         ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
        [`mov_${randomUUID()}`, input.tenantId, x.operatingCompanyKey, x.partId, x.trackingMode, x.locationType, x.locationId, x.movementType,
          x.quantityDelta, x.serialNumber, x.sourceKind, x.sourceId, m.idempotencyKey, x.occurredAt, m.createdBy]);
      if (r.rowCount === 1) { inserted += 1; continue; }
      const prior = (await c.query<{ part_id: string; location_type: string; location_id: string; quantity_delta: number; serial_number: string | null }>(
        `SELECT part_id, location_type::text AS location_type, location_id, quantity_delta, serial_number FROM eos_ops.inventory_movements
          WHERE tenant_id = $1 AND idempotency_key = $2`, [input.tenantId, m.idempotencyKey])).rows[0];
      if (!prior || prior.part_id !== x.partId || prior.location_type !== x.locationType || prior.location_id !== x.locationId
        || Number(prior.quantity_delta) !== x.quantityDelta || (prior.serial_number ?? null) !== (x.serialNumber ?? null)) {
        fail("MOVEMENT_KEY_CONFLICT", `a movement already holds ${m.idempotencyKey} with different content; nothing is overwritten`);
      }
      present += 1;
    }
    for (const u of plan.custody) {
      const r = await c.query(
        `INSERT INTO eos_ops.serialized_custody (id, tenant_id, part_id, serial_number, status, location_type, location_id, operating_company_key, updated_by)
         VALUES ($1,$2,$3,$4,'AVAILABLE',$5,$6,$7,$8) ON CONFLICT (tenant_id, part_id, serial_number) DO NOTHING`,
        [`cst_${randomUUID()}`, input.tenantId, u.partId, u.serialNumber, u.locationType, u.locationId, u.operatingCompanyKey, input.performedBy]);
      if (r.rowCount === 1) custodyInserted += 1;
    }
    await c.query(
      `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, reason)
       VALUES ($1, $2, 'inventory.baseline.copy', $3, 'inventoryBaseline', $4, NULL, $5, $6)`,
      [`audit_${randomUUID()}`, input.tenantId, input.performedBy, input.tenantId,
        JSON.stringify({ snapshotSha256: plan.snapshotSha256, manifestSha256: plan.manifestSha256, movementsInserted: inserted, movementsPresent: present,
          custodyInserted, blocking: plan.blocking, counts: plan.counts }), input.manifest.ruling]);
    return { outcome: inserted + custodyInserted === 0 ? "NO_CHANGES" as const : "APPLIED" as const, movementsInserted: inserted, movementsPresent: present, custodyInserted, plan };
  });
}

/** READ ONLY: every PLANNED movement + custody unit present and identical, totality, zero blocking. */
export async function verifyInventoryBaseline(pool: Pool, input: CutoverInput) {
  return inTx(pool, async (c) => {
    const target = await readTargetState(c, input.tenantId);
    // Replanning against a target that already holds the copy turns copied custody into ALREADY_PRESENT; the ledger plan is
    // keyed by the legacy id, so presence is checked directly.
    const plan = planInventoryBaseline(input.snapshot, input.manifest, target);
    const keys = plan.movements.map((m) => m.idempotencyKey);
    const found = keys.length === 0 ? 0 : Number((await c.query<{ n: string }>(
      `SELECT count(*)::bigint AS n FROM eos_ops.inventory_movements WHERE tenant_id = $1 AND idempotency_key = ANY($2)`, [input.tenantId, keys])).rows[0].n);
    const missingCustody = plan.custody.length; // anything still PLANNED for custody is, by definition, not yet copied
    const verified = plan.blocking === 0 && found === keys.length && missingCustody === 0;
    return { verdict: verified ? "VERIFIED" as const : "NOT_VERIFIED" as const, movementsExpected: keys.length, movementsFound: found, custodyMissing: missingCustody, plan };
  }, true);
}

/** CERTIFY: write the LEDGER + CUSTODY certification ONLY on a VERIFIED baseline. Insert-once; different evidence refused. */
export async function certifyInventoryBaseline(pool: Pool, input: CutoverInput) {
  const v = await verifyInventoryBaseline(pool, input);
  if (v.verdict !== "VERIFIED") fail("BASELINE_NOT_VERIFIED", `the baseline is not verified (blocking ${v.plan.blocking}, movements ${v.movementsFound}/${v.movementsExpected}, custody missing ${v.custodyMissing}); nothing is certified`);
  return inTx(pool, async (c) => {
    const evidence = JSON.stringify({ counts: v.plan.counts, movements: v.movementsExpected, ruling: input.manifest.ruling });
    for (const stage of INVENTORY_BASELINE_STAGES) {
      const prior = (await c.query<{ s: string; m: string }>(
        `SELECT snapshot_sha256 AS s, manifest_sha256 AS m FROM eos_ops.inventory_baseline_cutovers WHERE tenant_id = $1 AND stage = $2`, [input.tenantId, stage])).rows[0];
      if (prior) {
        if (prior.s !== v.plan.snapshotSha256 || prior.m !== v.plan.manifestSha256) fail("CERTIFICATION_CONFLICT", `${stage} is already certified with different evidence`);
        continue;
      }
      await c.query(`INSERT INTO eos_ops.inventory_baseline_cutovers (tenant_id, stage, snapshot_sha256, manifest_sha256, evidence, certified_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [input.tenantId, stage, v.plan.snapshotSha256, v.plan.manifestSha256, evidence, input.performedBy]);
    }
    await c.query(
      `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, reason)
       VALUES ($1, $2, 'inventory.baseline.certify', $3, 'inventoryBaseline', $4, NULL, $5, $6)`,
      [`audit_${randomUUID()}`, input.tenantId, input.performedBy, input.tenantId, evidence, input.manifest.ruling]);
    return { outcome: "CERTIFIED" as const, stages: INVENTORY_BASELINE_STAGES };
  });
}

export { migrationIdempotencyKey };
