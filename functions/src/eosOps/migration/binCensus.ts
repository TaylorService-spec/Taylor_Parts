// THE FIREBASE BIN CENSUS -- PURE (no pg, no Firebase, no clock, no network). Firebase exit B3; Owner ruling 6 of the Firebase-exit batch plan
// (2026-10-17): "A read-only census reconciled against PostgreSQL and warehouse references. Classify each record as synthetic, duplicate or
// unmatched. Preserve them pending an evidence-based disposition; the copy stays held."
//
// It reads two snapshots it is HANDED -- the Firestore `warehouses` / `bins` / `bin_code_claims` export (scripts/exportBinSnapshot.js,
// operator-run) and the EOS reference (the warehouses and bins the Warehouse Racking read returns) -- and answers, for every Firebase bin,
// exactly ONE classification with its reasons. It writes nothing, copies nothing and moves nothing: a classification is evidence for a later
// disposition, never a decision to import, delete or merge.
//
//   SYNTHETIC   the bin's warehouse is a known fixture / acceptance identity (wh-main, wh-north, the Sample Company and the synthetic
//               acceptance warehouse), or its id or name states that it is test data. Firebase held no real Taylor data in nonprod
//               (inventoryBaselineCutover.ts), so this is expected to be the large class.
//   DUPLICATE   a bin that is not synthetic and repeats something: another Firebase bin at the same rack position or code of the same
//               warehouse (the planner's key and WarehouseMasters' key are different schemes), or a bin EOS already holds at that position
//               (or code) in the warehouse the Firebase one maps to.
//   UNMATCHED   everything else: no EOS warehouse corresponds to its warehouse (it cannot be reconciled), or the warehouse maps but EOS holds
//               no bin there. These are the only records a later import could ever concern -- and only after the Owner rules on them.
//
// PRECEDENCE: SYNTHETIC, then DUPLICATE, then UNMATCHED. A warehouse maps to EOS by an explicit manifest entry first, else by the same id,
// else not at all -- a name is NEVER used to match one (names are text; the id is the identity).
import { FORBIDDEN_WAREHOUSE_IDS, SYNTHETIC_ACCEPTANCE_WAREHOUSE } from "../syntheticAcceptanceWarehouse";

export const BIN_CENSUS_CLASSES = Object.freeze(["SYNTHETIC", "DUPLICATE", "UNMATCHED"] as const);
export type BinCensusClass = (typeof BIN_CENSUS_CLASSES)[number];

export interface FirebaseWarehouseRow { readonly id: string; readonly name?: string | null }
export interface FirebaseBinRow {
  readonly id: string;
  readonly warehouseId: string;
  readonly area?: string | null;
  readonly aisle?: string | null;
  readonly bay?: number | null;
  readonly position?: number | null;
  readonly code?: string | null;
  readonly status?: string | null;
}
export interface EosWarehouseRow { readonly warehouseId: string; readonly name?: string | null }
export interface EosBinRow {
  readonly binId: string;
  readonly warehouseId: string;
  readonly area: string;
  readonly aisle: string;
  readonly bay: number;
  readonly position: number;
  readonly code: string;
}

export interface BinCensusInput {
  readonly firebase: { readonly warehouses: readonly FirebaseWarehouseRow[]; readonly bins: readonly FirebaseBinRow[] };
  readonly eos: { readonly warehouses: readonly EosWarehouseRow[]; readonly bins: readonly EosBinRow[] };
  /** Firestore warehouse id -> EOS warehouse id, stated by the operator. Never inferred from a name. */
  readonly warehouseMap?: Readonly<Record<string, string>>;
}

export interface BinCensusRow {
  readonly firebaseBinId: string;
  readonly firebaseWarehouseId: string;
  readonly classification: BinCensusClass;
  /** Why, as stable tokens (a bin may satisfy several; the first by precedence decides the class). */
  readonly reasons: readonly string[];
  readonly eosWarehouseId: string | null;
  /** The EOS bin it duplicates, when it duplicates one. */
  readonly eosBinId: string | null;
  /** The other Firebase bins it duplicates, when it duplicates any. */
  readonly duplicateOfFirebaseBinIds: readonly string[];
}

export interface BinCensusReport {
  readonly counts: Readonly<Record<BinCensusClass, number>> & { readonly total: number };
  readonly byWarehouse: Readonly<Record<string, Readonly<Record<BinCensusClass, number>>>>;
  readonly rows: readonly BinCensusRow[];
}

const SYNTHETIC_ID = /(^|[-_\s])(test|testing|sample|synthetic|fixture|demo|dummy|sandbox)([-_\s]|$)/i;
const FIXTURE_IDS: ReadonlySet<string> = new Set([...FORBIDDEN_WAREHOUSE_IDS, SYNTHETIC_ACCEPTANCE_WAREHOUSE.warehouseId]);

const rackKey = (b: { area?: unknown; aisle?: unknown; bay?: unknown; position?: unknown }) =>
  `${String(b.area ?? "").trim().toUpperCase()}\u0000${String(b.aisle ?? "").trim().toUpperCase()}\u0000${String(b.bay ?? "")}\u0000${String(b.position ?? "")}`;
const codeKey = (code: unknown) => (typeof code === "string" && code.trim() !== "" ? code.trim().toUpperCase() : null);

/** Why a Firebase warehouse is synthetic, or null. */
function syntheticReason(warehouse: FirebaseWarehouseRow | undefined, warehouseId: string): string | null {
  if (FIXTURE_IDS.has(warehouseId)) return "fixture_warehouse_identity";
  if (SYNTHETIC_ID.test(warehouseId)) return "warehouse_id_states_test_data";
  if (warehouse?.name && SYNTHETIC_ID.test(warehouse.name)) return "warehouse_name_states_test_data";
  return null;
}

export function classifyFirebaseBins(input: BinCensusInput): BinCensusReport {
  const fbWarehouses = new Map(input.firebase.warehouses.map((w) => [w.id, w]));
  const eosWarehouseIds = new Set(input.eos.warehouses.map((w) => w.warehouseId));
  const map = input.warehouseMap ?? {};
  const resolveEos = (fbId: string): string | null => {
    const mapped = Object.prototype.hasOwnProperty.call(map, fbId) ? map[fbId] : fbId;
    return eosWarehouseIds.has(mapped) ? mapped : null;
  };

  // Firebase-side groups: the same rack position, or the same code, within one warehouse.
  const byRack = new Map<string, string[]>();
  const byCode = new Map<string, string[]>();
  for (const b of input.firebase.bins) {
    const rk = `${b.warehouseId}\u0001${rackKey(b)}`;
    byRack.set(rk, [...(byRack.get(rk) ?? []), b.id]);
    const ck = codeKey(b.code);
    if (ck !== null) { const k = `${b.warehouseId}\u0001${ck}`; byCode.set(k, [...(byCode.get(k) ?? []), b.id]); }
  }
  const eosByRack = new Map<string, EosBinRow>();
  const eosByCode = new Map<string, EosBinRow>();
  for (const b of input.eos.bins) {
    eosByRack.set(`${b.warehouseId}\u0001${rackKey(b)}`, b);
    const ck = codeKey(b.code);
    if (ck !== null) eosByCode.set(`${b.warehouseId}\u0001${ck}`, b);
  }

  const rows: BinCensusRow[] = [...input.firebase.bins].sort((a, b) => (a.warehouseId + a.id < b.warehouseId + b.id ? -1 : 1)).map((b) => {
    const eosWarehouseId = resolveEos(b.warehouseId);
    const synthetic = syntheticReason(fbWarehouses.get(b.warehouseId), b.warehouseId);
    const reasons: string[] = [];
    if (synthetic !== null) reasons.push(synthetic);

    const twins = new Set<string>();
    for (const id of byRack.get(`${b.warehouseId}\u0001${rackKey(b)}`) ?? []) if (id !== b.id) twins.add(id);
    const ck = codeKey(b.code);
    if (ck !== null) for (const id of byCode.get(`${b.warehouseId}\u0001${ck}`) ?? []) if (id !== b.id) twins.add(id);
    if (twins.size > 0) reasons.push("repeats_another_firebase_bin");

    let eosBin: EosBinRow | null = null;
    if (eosWarehouseId !== null) {
      eosBin = eosByRack.get(`${eosWarehouseId}\u0001${rackKey(b)}`) ?? (ck === null ? null : eosByCode.get(`${eosWarehouseId}\u0001${ck}`) ?? null) ?? null;
      if (eosBin !== null) reasons.push("eos_holds_a_bin_at_this_position_or_code");
    } else {
      reasons.push("no_eos_warehouse_for_this_firebase_warehouse");
    }
    if (eosWarehouseId !== null && eosBin === null && twins.size === 0 && synthetic === null) reasons.push("eos_holds_no_bin_here");

    const classification: BinCensusClass = synthetic !== null ? "SYNTHETIC" : twins.size > 0 || eosBin !== null ? "DUPLICATE" : "UNMATCHED";
    return Object.freeze({
      firebaseBinId: b.id, firebaseWarehouseId: b.warehouseId, classification, reasons: Object.freeze(reasons),
      eosWarehouseId, eosBinId: eosBin?.binId ?? null, duplicateOfFirebaseBinIds: Object.freeze([...twins].sort()),
    });
  });

  const zero = (): Record<BinCensusClass, number> => ({ SYNTHETIC: 0, DUPLICATE: 0, UNMATCHED: 0 });
  const counts = zero();
  const byWarehouse: Record<string, Record<BinCensusClass, number>> = {};
  for (const r of rows) {
    counts[r.classification] += 1;
    (byWarehouse[r.firebaseWarehouseId] ??= zero())[r.classification] += 1;
  }
  return Object.freeze({ counts: Object.freeze({ ...counts, total: rows.length }), byWarehouse: Object.freeze(byWarehouse), rows: Object.freeze(rows) });
}
