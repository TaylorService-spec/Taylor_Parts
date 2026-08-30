// EOS Ownership Model v1 — the REORDER REQUEST location authority (Owner ruling R-13, 2026-08-30).
//
// "A reorder is requesting replenishment for inventory at a specific stocking warehouse."
//
// This is a DOMAIN CORRECTION, not ownership plumbing. The derivation check measured 6/6 sandbox
// reorder requests carrying no location reference of any kind -- a request that says what to order
// and how much, and never says where it is needed. Ownership merely exposed it.
//
// THE PARENT IS THE WAREHOUSE, NOT THE STOCK LOCATION. A `stock_location` is a warehouse+part
// BALANCE (`wh-main__PRT-1001`), not a business place. Making a balance the location authority
// would repeat the exact category error the physical-root correction already had to undo once:
// the first plan called stock_locations a root, and they turned out to be rows in a ledger.
//
// Canonical shape:
//
//     reorder_request {
//       partId              what to replenish
//       warehouseId         WHERE it is needed          <- the addition
//       requestedBy         who asked. Never the owner.
//       operatingCompanyId  derived from the warehouse at trusted creation, then STORED
//     }
//
// STORED, NOT RESOLVED FOREVER. The company is materialized at creation for the same reason the
// Work Order stores its inherited company: a warehouse could later be reassigned, and a historical
// request must keep the company that actually bore the obligation.
//
// INERT AND BACKWARD-COMPATIBLE. Both fields are optional. Nothing enforces them, and a caller that
// supplies neither behaves exactly as before.

import { resolveOperatingCompany } from "./operatingCompanyAuthority";

export class ReorderLocationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ReorderLocationError";
  }
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export interface ReorderLocationResolution {
  warehouseId: string | null;
  operatingCompanyId: string | null;
}

/**
 * Resolve a reorder request's warehouse and the company that follows from it.
 *
 * @param warehouseId the warehouse the replenishment is for.
 * @param warehouseCompanyId that warehouse's stored operatingCompanyId, read by the caller from the
 *        warehouse document it already holds. Passed in so this stays pure.
 *
 * Absent warehouse -> both null, inert. A warehouse WITH an ungoverned company is an error rather
 * than a silent null: the reference exists and is wrong, which is a different fact from missing.
 */
export function resolveReorderLocation(warehouseId: unknown, warehouseCompanyId?: unknown): ReorderLocationResolution {
  if (!nonEmpty(warehouseId)) return { warehouseId: null, operatingCompanyId: null };
  if (!nonEmpty(warehouseCompanyId)) return { warehouseId: warehouseId.trim(), operatingCompanyId: null };

  const { state } = resolveOperatingCompany(warehouseCompanyId.trim());
  if (state !== "RESOLVED" && state !== "INACTIVE") {
    throw new ReorderLocationError(
      "WAREHOUSE_COMPANY_INVALID",
      `warehouse ${warehouseId} names an ungoverned operating company: ${String(warehouseCompanyId)}`,
    );
  }
  return { warehouseId: warehouseId.trim(), operatingCompanyId: warehouseCompanyId.trim() };
}

/**
 * A reorder purchase order is SINGLE-COMPANY (ruling R-13).
 *
 * "If requests from multiple operating companies are selected: REFUSE combined creation and require
 * separate POs. Do NOT turn reorder_purchase_orders into PARTICIPATING_COMPANIES merely to allow
 * mixed purchasing."
 *
 * The distinction matters: a transfer legitimately spans two companies because goods physically
 * move between them. A purchase order does not -- it is one company's commitment to a supplier, and
 * two companies' obligations in one document would be a single legal commitment nobody owns.
 */
export function resolvePurchaseOrderCompany(requestCompanyIds: readonly (string | null | undefined)[]): string {
  const present = requestCompanyIds.filter(nonEmpty).map((s) => s.trim());
  if (present.length === 0) {
    throw new ReorderLocationError("PO_COMPANY_UNRESOLVED", "no source request carries an operating company");
  }
  const distinct = [...new Set(present)];
  if (distinct.length > 1) {
    throw new ReorderLocationError(
      "PO_MIXED_COMPANY",
      `a purchase order cannot combine requests from more than one operating company (${distinct.sort().join(", ")}) -- issue separate per-company purchase orders`,
    );
  }
  return distinct[0];
}
