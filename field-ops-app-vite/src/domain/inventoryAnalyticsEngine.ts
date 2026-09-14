// Client mirror of functions/src/inventoryAnalyticsService.ts's pure
// FORECASTING logic (Epic 3) -- same "client + server mirrors" pattern
// as data/partsCatalog.ts. functions/src/inventoryAnalyticsService.ts
// is authoritative for that forecasting math; if the two drift, that
// file wins.
//
// THE ON-HAND DERIVATION AT THE BOTTOM OF THIS FILE IS NOT A MIRROR.
// It used to be, and that is what went wrong: mirroring a rule means
// owning a copy of it, and copies of THIS rule are what
// locationOnHand.ts was created to end. computeAvailableStockByPart
// now imports signedQuantity from that file directly rather than
// restating it. The paragraph that used to stand here said there was
// "no existing precedent in this repo for a cross-package source
// import"; the precedents are scripts/syncAccessContracts.mjs (which
// GENERATES src/access/*.ts from functions/src/access/) and
// functions/test/operationalMovementLedger.test.mjs (which imports
// this package's domain/inventoryLedgerEvent.js). A direct import is
// available here because locationOnHand.ts's only dependency is an
// `import type`, erased at transform -- see the import below.
//
// Only the synchronous, non-provider functions are mirrored -- the
// server file's *WithProvider wrappers exist for a lazy-fetch caller
// this dashboard doesn't need (it already has all StockSnapshots in
// hand from one batch Firestore read).

// THE ONE SIGN AUTHORITY, imported rather than restated.
//
// functions/src/inventoryLedger/locationOnHand.ts is the single place a ledger movement's effect on
// physical on-hand is decided, and it exists because that rule had been written out FIVE times and
// the copies drifted: when Decision #171 made WORK_ORDER_CONSUMPTION physical, only one of the five
// learned about it. This file held the sixth copy and had drifted exactly the same way.
//
// It is imported ACROSS THE PACKAGE BOUNDARY on purpose. The file header below used to say there
// was "no existing precedent in this repo for a cross-package source import" -- that was true of
// SOURCE imports at the time and is no longer the whole picture: functions/test/
// operationalMovementLedger.test.mjs already imports this package's domain/inventoryLedgerEvent.js,
// and scripts/syncAccessContracts.mjs generates src/access/*.ts from functions/src/access/. What
// makes a direct import the right answer HERE rather than a generated mirror is that
// locationOnHand.ts's only import is `import type`, erased at transform: it pulls in no
// firebase-admin, no Firestore, no server runtime, nothing. Vite/vitest resolve and transpile it,
// `tsc --noEmit` typechecks it, and the production bundle contains the same nine-entry frozen
// table the server enforces.
//
// The point is not tidiness. A mirror -- generated or hand-written -- is still a second artifact
// that a new movement type can reach one at a time. An import cannot be a seventh copy.
import { isPhysicalMovementType, signedQuantity } from "../../../functions/src/inventoryLedger/locationOnHand";
import { isOperatingCompanyIdShape } from "./operatingCompanyAuthority";

export type LedgerTransaction = {
  id: string;
  workOrderId: string;
  partId: string;
  // The legacy Work-Order reservation vocabulary PLUS the governed operational movement types. Both
  // live in the SAME append-only `inventory_transactions` ledger.
  //
  // DELIBERATELY WIDENED TO `string`. This used to be a closed union that named seven types, and
  // that union was itself a copy of the movement vocabulary -- one that had gone stale exactly like
  // the sign rule it sat next to (no RETURNED, no SCRAPPED, no RELOCATION pair, no
  // WORK_ORDER_CONSUMPTION). Enumerating them here a second time would re-create the drift this
  // change removes. Which types move stock, and in which direction, is decided ONCE by
  // MOVEMENT_SIGN in locationOnHand.ts, reached through signedQuantity(); a type it does not name
  // contributes nothing. The legacy reservation types are handled explicitly below and are
  // deliberately disjoint from that set.
  type: string;
  quantity: number;
  timestamp: number;
  // Ownership Model v1 (Owner ruling D-2). Present on ledger rows written after the 2026-08-30
  // ownership backfill; absent on everything older. `operatingCompanyId` is NEVER INFERRED -- an
  // absent one means unattributed, not "ours".
  operatingCompanyId?: string;
};

export type StockSnapshot = {
  partId: string;
  availableStock: number;
};

export type UsageStats = {
  partId: string;
  totalConsumed: number;
  avgDailyUsage: number;
  volatility: number;
  volatilityModel: "HEURISTIC_SIMPLE";
};

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

// "Recommendation readiness" is a different concept from "inventory
// risk" and must not be folded into RiskLevel (ChatGPT's REQUEST
// CHANGES on this sprint's Specification, twice) -- NEEDS_PLANNING
// means "the analytics engine had nothing to compute," not "risk is
// unknown/low/high." urgency is null exactly when
// recommendationStatus is NEEDS_PLANNING; RiskLevel/URGENCY_ORDER
// below are deliberately unchanged by this type.
export type RecommendationStatus = "READY" | "NEEDS_PLANNING";

export type StockoutPrediction = {
  partId: string;
  daysRemaining: number;
  estimatedStockoutDate: Date | null;
  riskLevel: RiskLevel;
};

export type ReplenishmentRecommendation = {
  partId: string;
  availableStock: number;
  reorderPoint: number;
  daysRemaining: number;
  recommendedOrderQty: number;
  recommendationStatus: RecommendationStatus;
  urgency: RiskLevel | null;
  modelVersion: "EPIC3_LINEAR_V1";
};

export type InventoryHealthEntry = {
  partId: string;
  usage: UsageStats;
  stock: StockSnapshot;
  recommendation: ReplenishmentRecommendation;
};

// Sprint 2.1.2 -- Inventory Operational Queue. Moved here from
// modules/operations/panels/InventoryHealthPanel.jsx so this file is
// the canonical home for inventory-domain presentation constants and
// derived models, not just raw analytics math -- InventoryHealthPanel
// (Operations) and PartsList's queue section (Inventory workspace)
// both import this one constant instead of each defining their own
// copy. No logic change from the original.
export const URGENCY_ORDER: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function filterTransactionsByPart(transactions: LedgerTransaction[], partId: string): LedgerTransaction[] {
  return transactions.filter((t) => t.partId === partId);
}

function getConsumedTransactions(transactions: LedgerTransaction[]): LedgerTransaction[] {
  return transactions.filter((t) => t.type === "CONSUMED");
}

// `avgDailyUsage === 0` is ambiguous: it means either "genuinely no
// demand" or "no CONSUMED transactions exist for this part in the
// window" (indistinguishable from each other in the math -- see
// calculateUsageRate below). This flag lets callers render an honest
// "insufficient usage history" state instead of a numeric 0 that reads
// as "no reorder needed," without changing recommendedOrderQty's
// value or any consumer that already depends on it being a number.
export function hasUsageHistory(usage: UsageStats): boolean {
  return usage.totalConsumed > 0;
}

export function calculateUsageRate(
  partId: string,
  transactions: LedgerTransaction[],
  windowDays: number = 30
): UsageStats {
  const now = Date.now();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;

  const filtered = getConsumedTransactions(filterTransactionsByPart(transactions, partId)).filter(
    (t) => now - t.timestamp <= windowMs
  );

  const totalConsumed = filtered.reduce((sum, t) => sum + t.quantity, 0);
  const avgDailyUsage = totalConsumed / windowDays;

  const variance =
    filtered.length > 0
      ? filtered.reduce((acc, t) => acc + Math.pow(t.quantity - avgDailyUsage, 2), 0) / filtered.length
      : 0;

  return {
    partId,
    totalConsumed,
    avgDailyUsage,
    volatility: Math.sqrt(variance),
    volatilityModel: "HEURISTIC_SIMPLE",
  };
}

export function predictStockout(partId: string, availableStock: number, usage: UsageStats): StockoutPrediction {
  const daysRemaining = usage.avgDailyUsage === 0 ? Infinity : availableStock / usage.avgDailyUsage;

  const now = Date.now();
  const estimatedStockoutDate =
    daysRemaining === Infinity ? null : new Date(now + daysRemaining * 24 * 60 * 60 * 1000);

  let riskLevel: RiskLevel = "LOW";
  if (daysRemaining < 3) riskLevel = "CRITICAL";
  else if (daysRemaining < 7) riskLevel = "HIGH";
  else if (daysRemaining < 14) riskLevel = "MEDIUM";

  return { partId, daysRemaining, estimatedStockoutDate, riskLevel };
}

export function calculateReorderPoint(
  usage: UsageStats,
  leadTimeDays: number = 7,
  safetyFactor: number = 1.5
): number {
  const safetyStock = usage.avgDailyUsage * safetyFactor;
  return usage.avgDailyUsage * leadTimeDays + safetyStock;
}

export function generateReplenishmentRecommendation(
  partId: string,
  availableStock: number,
  usage: UsageStats,
  leadTimeDays: number = 7
): ReplenishmentRecommendation {
  const reorderPoint = calculateReorderPoint(usage, leadTimeDays, 1.5);
  const daysRemaining = usage.avgDailyUsage === 0 ? Infinity : availableStock / usage.avgDailyUsage;
  const recommendedOrderQty = Math.max(reorderPoint * 2 - availableStock, 0);

  if (!hasUsageHistory(usage)) {
    return {
      partId,
      availableStock,
      reorderPoint,
      daysRemaining,
      recommendedOrderQty,
      recommendationStatus: "NEEDS_PLANNING",
      urgency: null,
      modelVersion: "EPIC3_LINEAR_V1",
    };
  }

  let urgency: RiskLevel = "LOW";
  if (availableStock <= reorderPoint * 0.5) urgency = "CRITICAL";
  else if (availableStock <= reorderPoint) urgency = "HIGH";
  else if (daysRemaining < 14) urgency = "MEDIUM";

  return {
    partId,
    availableStock,
    reorderPoint,
    daysRemaining,
    recommendedOrderQty,
    recommendationStatus: "READY",
    urgency,
    modelVersion: "EPIC3_LINEAR_V1",
  };
}

// Normalization boundary between a raw Firestore inventory_transactions
// doc (Firestore Timestamp) and this engine's plain-epoch-ms
// LedgerTransaction -- same role as functions/src/ledgerNormalizer.ts
// server-side, just on the client's read path instead.
export function normalizeLedgerTransaction(doc: {
  id: string;
  workOrderId: string;
  partId: string;
  type: LedgerTransaction["type"];
  quantity: number;
  timestamp: { toMillis?: () => number } | number;
  operatingCompanyId?: unknown;
}): LedgerTransaction {
  const timestamp =
    typeof doc.timestamp === "number" ? doc.timestamp : (doc.timestamp?.toMillis?.() ?? 0);
  return {
    id: doc.id,
    workOrderId: doc.workOrderId,
    partId: doc.partId,
    type: doc.type,
    quantity: doc.quantity,
    timestamp,
    // CARRIED, NOT DROPPED. This boundary previously discarded `operatingCompanyId`, which is why
    // no downstream derivation could filter by operating company even in principle -- the field is
    // on the stored row (operationalMovementRepository.ts accepts and shape-checks it) and the
    // client read spreads the whole document, so the information reached here and was thrown away
    // one line before it was needed. Only a WELL-SHAPED id survives: an unrecognised value is
    // dropped rather than passed along as though it were governed.
    ...(isOperatingCompanyIdShape(doc.operatingCompanyId) ? { operatingCompanyId: doc.operatingCompanyId as string } : {}),
  };
}

export function generateInventoryHealthDashboard(
  transactions: LedgerTransaction[],
  stockSnapshots: StockSnapshot[]
): InventoryHealthEntry[] {
  return stockSnapshots.map((stock) => {
    const usage = calculateUsageRate(stock.partId, transactions);
    return {
      partId: stock.partId,
      usage,
      stock,
      recommendation: generateReplenishmentRecommendation(stock.partId, stock.availableStock, usage),
    };
  });
}

// Moved here from modules/operations/Operations.jsx (Sprint 2.1.1) so the new Inventory domain
// workspace and the Operations dashboard share one computation instead of each maintaining its own
// copy of the same formula.
/**
 * Available stock per Part, from the append-only inventory_transactions ledger.
 *
 * available = SUM(signedQuantity(governed movement)) - (RESERVED - RELEASED)
 *
 * THE SIXTH COPY OF THE SIGN RULE WAS HERE, and this is what it looked like:
 *
 *   RECEIVED / TRANSFER_IN  +qty     TRANSFER_OUT  -qty     ADJUSTED  +qty (signed)
 *
 * Five of those branches were correct and five movement types were missing -- RETURNED, SCRAPPED,
 * RELOCATION_IN, RELOCATION_OUT and WORK_ORDER_CONSUMPTION. That is not a coincidence, it is the
 * documented failure mode: locationOnHand.ts's header records that this exact rule had been written
 * out five times, and that when Decision #171 made Work Order physical consumption live, only one
 * of the five learned about it. The consequence on this side of the wire was that a part fitted to
 * a machine, scrapped, or relocated still read as AVAILABLE on three surfaces -- Inventory Health,
 * Part Detail and Warehouse Manager Home -- which is how a planner reorders stock that is gone and
 * ignores stock that came back.
 *
 * The fix is NOT to add the five missing branches. Adding them would make this a seventh copy that
 * is briefly correct and drifts on the next movement type. signedQuantity() is imported from the
 * one authority, MOVEMENT_SIGN is TOTAL over the movement vocabulary (a new type without a sign
 * fails the SERVER build), and a type the authority does not name contributes nothing here -- so
 * the legacy reservation vocabulary below stays disjoint and cannot be double-counted.
 *
 * THE STATIC CATALOG BASELINE IS GONE. This used to start from data/partsCatalog.ts's
 * `warehouseQty` -- 200 rows generated from synthetic_parts_test_data.csv, in a file whose own
 * header says "METADATA ONLY -- NO STOCK AUTHORITY" -- and add real ledger movement on top. So a
 * catalogued part read as its fixture number plus its real stock, and a governed part (baseline 0)
 * read as its real stock: two different meanings behind one column heading. DECISIONS #165 already
 * removed exactly this baseline on the server ("a fixture quantity may not decide a real
 * dispatch"), deleting sumGovernedLedger and retiring the two tests that asserted the baseline
 * still composed. This side had not followed. It has now: the ledger is the only input.
 *
 * SCOPE -- what this number covers, stated rather than assumed.
 *
 * Part-level and estate-wide by default: summed across every location, so a warehouse-to-truck
 * transfer nets to zero because the stock still exists. Per-location balances are a separate
 * projection and this is not it.
 *
 * `scope.operatingCompanyId` narrows it to ONE operating company, FAIL-CLOSED: a physical row is
 * counted only if it carries that exact company id. A row with no company is EXCLUDED -- never
 * attributed to the company being asked about. operatingCompanyId is never inferred, so an
 * unattributed row is evidence of an unmigrated write, not of ownership, and an id nothing matches
 * yields nothing rather than falling back to the estate-wide total.
 *
 * The scope is validated by SHAPE, not membership, because operatingCompanyAuthority.js is explicit
 * that a shape-valid id which is not one of the two seeded records is well-formed-but-UNKNOWN
 * rather than malformed -- a company must be addable without a schema change. A non-shape value is
 * a caller error and throws; it must never degrade into "no filter".
 *
 * Omitting `scope` keeps the estate-wide reading, which is what all callers get today. That is a
 * DECLARED reading and not a silent one, and it is open: see the Owner question recorded in
 * test/onHandSignAuthority.test.jsx. Until it is ruled, no caller may obtain a number without the
 * scope being visible in the call.
 */
export type AvailableStockScope = {
  /** A governed operating company id ("taylor" | "ventana"), or omitted for an estate-wide figure. */
  operatingCompanyId?: string;
};

export function computeAvailableStockByPart(
  transactions: LedgerTransaction[],
  scope: AvailableStockScope = {},
): Map<string, number> {
  // Fail closed on a MALFORMED scope: refuse rather than quietly widen back to every company, which
  // is the failure this parameter exists to prevent. A well-formed id nothing matches is not an
  // error -- it simply counts nothing, which is the same fail-closed direction.
  const wanted = scope.operatingCompanyId;
  if (wanted !== undefined && !isOperatingCompanyIdShape(wanted)) {
    throw new Error("computeAvailableStockByPart: operatingCompanyId is not a well-formed operating company id");
  }

  const byPart = new Map<string, { reserved: number; released: number; governed: number }>();
  for (const t of transactions) {
    // Which rows the company filter applies to is also the authority's call, not ours:
    // isPhysicalMovementType() is true for exactly the types MOVEMENT_SIGN names. A commitment
    // event (RESERVED/RELEASED/CONSUMED) carries no location and no company -- it is scoped by its
    // Work Order, not by custody -- so narrowing to a company must not silently delete it.
    if (wanted !== undefined && isPhysicalMovementType(t.type) && t.operatingCompanyId !== wanted) continue;

    const entry = byPart.get(t.partId) ?? { reserved: 0, released: 0, governed: 0 };
    if (t.type === "RESERVED") entry.reserved += t.quantity;
    else if (t.type === "RELEASED") entry.released += t.quantity;
    // Every physical movement, one rule, no branches of our own.
    else entry.governed += signedQuantity(t);
    byPart.set(t.partId, entry);
  }

  const result = new Map<string, number>();
  for (const [partId, { reserved, released, governed }] of byPart) {
    result.set(partId, governed - (reserved - released));
  }
  return result;
}
