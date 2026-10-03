// RENTAL -- the governed Rental lifecycle (EOS CONTROLLER Package B, DECISIONS #207; the model of #190 §13-§18). See migration
// 1764520000000 for the records and the invariants the database enforces.
//
//   fleet      designate a Taylor-owned serialized unit into the fleet; mark UNAVAILABLE; release a service hold
//   agreement  create (RA-YYYY-######) -> activate -> amend / extend (a NEW terms version, history kept) -> close / cancel
//   assign     reserve an AVAILABLE unit of the agreement's own company (double booking unrepresentable); release; exchange
//   deploy     the INSTALL Work Order linked to the agreement installs the RESERVED unit at the customer site (rentalDeployment.ts)
//   return     initiate (RETURN_PENDING) -> receive into a Taylor warehouse (customer custody ends, Taylor custody restored)
//   inspect    READY -> AVAILABLE, NEEDS_SERVICE -> SERVICE_HOLD, UNAVAILABLE -> UNAVAILABLE. Never automatic.
//   charge     one whole agreed period / one governed one-time charge -> the RENTAL Operational Billing Package (rentalBilling.ts)
//
// OWNERSHIP never moves: the fleet unit's owner key is fixed (a trigger refuses any change), the Equipment record minted at
// deployment carries the owner company's key with the customer as custodian / site user, and nothing here creates a Sales
// Order, a financing arrangement or an ownership transfer. NO INVENTED POLICY: no proration (a partial period is refused), no
// deposit / late fee / damage / minimum term / renewal, and tax is human-supplied evidence.
import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { authorizeObjectAction, postgresContextualReader } from "../eosOps/contextualAuthorization.js";
import { resolveOperatingCompanyKeyForCompany } from "../eosOps/operatingCompanyBinding.js";
import { businessDateOn } from "../eosOps/operatingCompanyBusinessTime";
import { resolveOperatingCompanyFromKey } from "../eosFinance/financeFoundation";
import { prepareRentalChargePackageOn } from "./rentalBilling";

type Queryable = Pick<PoolClient, "query">;

export const RENTAL_READ = "rental.agreement.read";
export const RENTAL_AGREEMENT_MANAGE = "rental.agreement.manage";
export const RENTAL_CHARGE_RECORD = "rental.charge.record";
export const RENTAL_UNIT_ASSIGN = "rental.unit.assign";
export const RENTAL_UNIT_RETURN = "rental.unit.return";
export const RENTAL_FLEET_MANAGE = "rental.fleet.manage";
export const RENTAL_CAPABILITIES = Object.freeze([RENTAL_READ, RENTAL_AGREEMENT_MANAGE, RENTAL_CHARGE_RECORD, RENTAL_UNIT_ASSIGN, RENTAL_UNIT_RETURN, RENTAL_FLEET_MANAGE]);

export const RENTAL_AVAILABILITY = Object.freeze(["AVAILABLE", "RESERVED", "ON_RENT", "SERVICE_HOLD", "RETURN_PENDING", "INSPECTION", "UNAVAILABLE"] as const);
export const BILLING_FREQUENCIES = Object.freeze(["DAY", "WEEK", "MONTH"] as const);
export const RENTAL_NUMBER_PATTERN = /^RA-[0-9]{4}-[0-9]{6,}$/;

export class RentalError extends Error {
  constructor(readonly code: string, readonly category: "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT" | "FORBIDDEN", message: string) {
    super(message);
    this.name = "RentalError";
  }
}
const refuse = (code: string, category: RentalError["category"], message: string): never => {
  throw new RentalError(code, category, message);
};

export interface RentalActor { readonly tenantId: string; readonly principalId: string; readonly capabilities: ReadonlySet<string> }

const requireCapability = (actor: RentalActor, key: string): void => {
  if (!actor?.capabilities?.has(key)) refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this operation requires ${key}`);
};
const only = (input: Record<string, unknown>, allowed: readonly string[]): void => {
  if (input === null || typeof input !== "object" || Array.isArray(input)) refuse("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
  const extra = Object.keys(input).filter((k) => !allowed.includes(k));
  if (extra.length) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
};
const text = (v: unknown, name: string, max = 200): string => {
  if (typeof v !== "string" || v.trim() === "" || v.length > max) refuse(`${name.replace(/([A-Z])/g, "_$1").toUpperCase()}_REQUIRED`, "INVALID_INPUT", `${name} is required`);
  return (v as string).trim();
};
const optText = (v: unknown, name: string, max = 2000): string | null => (v === undefined || v === null ? null : text(v, name, max));
const isoDate = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    refuse(`${name.replace(/([A-Z])/g, "_$1").toUpperCase()}_INVALID`, "INVALID_INPUT", `${name} is YYYY-MM-DD`);
  }
  return v as string;
};
const minor = (v: unknown, name: string, { positive = false, optional = false } = {}): bigint | null => {
  if (optional && (v === undefined || v === null)) return null;
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || (positive && v === 0)) {
    refuse("AMOUNT_INVALID", "INVALID_INPUT", `${name} is a ${positive ? "positive" : "non-negative"} integer number of minor units`);
  }
  return BigInt(v as number);
};
const dateText = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.slice(0, 10);
  const d = v as Date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fingerprintOf = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

async function inTransaction<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

async function audit(c: Queryable, actor: RentalActor, action: string, targetKind: string, targetId: string, after: unknown, reason: string | null) {
  await c.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, $7::jsonb, now(), $8)`,
    [`audit_${randomUUID()}`, actor.tenantId, action, actor.principalId, targetKind, targetId, JSON.stringify(after), reason]);
}

async function fleetEvent(c: Queryable, actor: RentalActor, unit: Record<string, any>, e: {
  readonly type: string; readonly to: string; readonly agreementId?: string | null; readonly assignmentId?: string | null; readonly workOrderId?: string | null;
  readonly equipmentId?: string | null; readonly locationType?: string | null; readonly locationId?: string | null; readonly reason?: string | null;
}) {
  await c.query(
    `INSERT INTO eos_rental.fleet_unit_events (id, tenant_id, fleet_unit_id, event_type, from_availability, to_availability, agreement_id, assignment_id,
        work_order_id, equipment_id, owner_operating_company_key, location_type, location_id, reason, actor_principal_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [`rfe_${randomUUID()}`, actor.tenantId, unit.id, e.type, unit.availability ?? null, e.to, e.agreementId ?? null, e.assignmentId ?? null,
      e.workOrderId ?? null, e.equipmentId ?? null, unit.owner_operating_company_key, e.locationType ?? null, e.locationId ?? null, e.reason ?? null, actor.principalId]);
}

async function moveUnit(c: Queryable, actor: RentalActor, unit: Record<string, any>, to: string, currentAssignmentId: string | null) {
  await c.query(`UPDATE eos_rental.fleet_units SET availability = $3, current_assignment_id = $4, version = version + 1, updated_at = now()
    WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, unit.id, to, currentAssignmentId]);
}

async function lockUnit(c: Queryable, tenantId: string, fleetUnitId: string) {
  const { rows } = await c.query(`SELECT * FROM eos_rental.fleet_units WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, fleetUnitId]);
  return rows[0] ?? refuse("FLEET_UNIT_NOT_FOUND", "NOT_FOUND", "no rental fleet unit with that id");
}
async function lockAgreement(c: Queryable, tenantId: string, agreementId: string) {
  const { rows } = await c.query(`SELECT * FROM eos_rental.rental_agreements WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, agreementId]);
  return rows[0] ?? refuse("RENTAL_AGREEMENT_NOT_FOUND", "NOT_FOUND", "no Rental Agreement with that id");
}
async function lockAssignment(c: Queryable, tenantId: string, assignmentId: string) {
  const { rows } = await c.query(`SELECT * FROM eos_rental.rental_assignments WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, assignmentId]);
  return rows[0] ?? refuse("RENTAL_ASSIGNMENT_NOT_FOUND", "NOT_FOUND", "no rental assignment with that id");
}
export async function currentTermsOn(db: Queryable, tenantId: string, agreementId: string) {
  const { rows } = await db.query(`SELECT * FROM eos_rental.rental_agreement_terms WHERE tenant_id = $1 AND agreement_id = $2 ORDER BY version DESC LIMIT 1`,
    [tenantId, agreementId]);
  return rows[0] ?? refuse("RENTAL_TERMS_MISSING", "PRECONDITION_FAILED", "the agreement has no terms");
}

/** RA-YYYY-######: the governed <PREFIX>-YYYY-###### convention, one counter row per tenant-year, allocated in the caller's tx. */
export async function allocateRentalAgreementNumber(c: Queryable, tenantId: string, at: Date): Promise<string> {
  const year = at.getUTCFullYear();
  const { rows } = await c.query(
    `INSERT INTO eos_rental.rental_number_counters (tenant_id, year, last_value) VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, year) DO UPDATE SET last_value = rental_number_counters.last_value + 1, updated_at = now()
     RETURNING last_value`, [tenantId, year]);
  return `RA-${year}-${String(rows[0].last_value).padStart(6, "0")}`;
}

// ════════════════════ fleet ════════════════════

export async function designateFleetUnit(pool: Pool, actor: RentalActor, input: Record<string, unknown>) {
  requireCapability(actor, RENTAL_FLEET_MANAGE);
  only(input, ["partId", "serialNumber", "displayName", "reason"]);
  const partId = text(input.partId, "partId"), serial = text(input.serialNumber, "serialNumber");
  const displayName = text(input.displayName, "displayName"), reason = text(input.reason, "reason", 1000);
  return inTransaction(pool, async (c) => {
    const { rows: existing } = await c.query(`SELECT * FROM eos_rental.fleet_units WHERE tenant_id = $1 AND part_id = $2 AND serial_number = $3`, [actor.tenantId, partId, serial]);
    if (existing[0]) return Object.freeze({ outcome: "replayed" as const, fleetUnit: await readFleetUnitOn(c, actor.tenantId, String(existing[0].id)) });
    const { rows: cu } = await c.query(`SELECT status::text AS status, location_type::text AS location_type, location_id, operating_company_key
      FROM eos_ops.serialized_custody WHERE tenant_id = $1 AND part_id = $2 AND serial_number = $3 FOR UPDATE`, [actor.tenantId, partId, serial]);
    const custody = cu[0] ?? refuse("UNIT_NOT_FOUND", "NOT_FOUND", `no serialized custody row for ${partId}/${serial}`);
    if (custody.status !== "AVAILABLE" || !["WAREHOUSE", "BIN"].includes(custody.location_type)) {
      refuse("UNIT_NOT_IN_TAYLOR_STOCK", "PRECONDITION_FAILED", `only an AVAILABLE unit in a company warehouse / bin can join the fleet (it is ${custody.status} at ${custody.location_type})`);
    }
    const id = `rfu_${randomUUID()}`;
    await c.query(`INSERT INTO eos_rental.fleet_units (id, tenant_id, part_id, serial_number, owner_operating_company_key, availability, display_name, designated_by)
      VALUES ($1,$2,$3,$4,$5,'AVAILABLE',$6,$7)`, [id, actor.tenantId, partId, serial, custody.operating_company_key, displayName, actor.principalId]);
    await fleetEvent(c, actor, { id, availability: null, owner_operating_company_key: custody.operating_company_key },
      { type: "DESIGNATED", to: "AVAILABLE", locationType: custody.location_type, locationId: custody.location_id, reason });
    await audit(c, actor, "rental.fleet.designate", "rental_fleet_unit", id, { partId, serial, owner: custody.operating_company_key }, reason);
    return Object.freeze({ outcome: "recorded" as const, fleetUnit: await readFleetUnitOn(c, actor.tenantId, id) });
  });
}

/** UNAVAILABLE (from AVAILABLE / SERVICE_HOLD / INSPECTION), or back to AVAILABLE (from SERVICE_HOLD / UNAVAILABLE) -- with a reason. */
export async function setFleetUnitAvailability(pool: Pool, actor: RentalActor, input: Record<string, unknown>) {
  requireCapability(actor, RENTAL_FLEET_MANAGE);
  only(input, ["fleetUnitId", "availability", "reason"]);
  const fleetUnitId = text(input.fleetUnitId, "fleetUnitId"), reason = text(input.reason, "reason", 1000);
  const to = input.availability;
  if (to !== "UNAVAILABLE" && to !== "AVAILABLE") refuse("AVAILABILITY_INVALID", "INVALID_INPUT", "availability is UNAVAILABLE or AVAILABLE (other states follow the lifecycle)");
  return inTransaction(pool, async (c) => {
    const unit = await lockUnit(c, actor.tenantId, fleetUnitId);
    const allowedFrom = to === "UNAVAILABLE" ? ["AVAILABLE", "SERVICE_HOLD", "INSPECTION"] : ["SERVICE_HOLD", "UNAVAILABLE"];
    if (!allowedFrom.includes(unit.availability)) {
      refuse("RENTAL_AVAILABILITY_TRANSITION_INVALID", "PRECONDITION_FAILED", `a unit ${unit.availability} cannot be set ${to as string} directly`);
    }
    if (to === "AVAILABLE") {
      const { rows: cu } = await c.query(`SELECT location_type::text AS lt FROM eos_ops.serialized_custody WHERE tenant_id = $1 AND part_id = $2 AND serial_number = $3`,
        [actor.tenantId, unit.part_id, unit.serial_number]);
      if (!["WAREHOUSE", "BIN"].includes(cu[0]?.lt)) refuse("UNIT_NOT_IN_TAYLOR_CUSTODY", "PRECONDITION_FAILED", "a unit becomes available only in Taylor custody");
    }
    await moveUnit(c, actor, unit, to as string, null);
    await fleetEvent(c, actor, unit, { type: to === "UNAVAILABLE" ? "MARKED_UNAVAILABLE" : unit.availability === "SERVICE_HOLD" ? "SERVICE_HOLD_RELEASED" : "AVAILABILITY_RESTORED", to: to as string, reason });
    await audit(c, actor, "rental.fleet.availability", "rental_fleet_unit", fleetUnitId, { from: unit.availability, to }, reason);
    return Object.freeze({ outcome: "recorded" as const, fleetUnit: await readFleetUnitOn(c, actor.tenantId, fleetUnitId) });
  });
}

// ════════════════════ agreement ════════════════════

export async function createRentalAgreement(pool: Pool, actor: RentalActor, input: Record<string, unknown>, now: () => Date = () => new Date()) {
  requireCapability(actor, RENTAL_AGREEMENT_MANAGE);
  only(input, ["operatingCompanyId", "accountId", "customerLocationId", "startDate", "currency", "rateMinor", "billingFrequency", "expectedEndDate",
    "deliveryChargeMinor", "installChargeMinor", "deliveryRequirements", "returnExpectations", "idempotencyKey"]);
  const companyId = text(input.operatingCompanyId, "operatingCompanyId");
  if (companyId.toLowerCase() === "consolidated") refuse("CONSOLIDATED_NOT_A_COMPANY", "INVALID_INPUT", "CONSOLIDATED owns no fleet and rents nothing");
  const accountId = text(input.accountId, "accountId"), siteId = text(input.customerLocationId, "customerLocationId");
  const start = isoDate(input.startDate, "startDate"), end = isoDate(input.expectedEndDate, "expectedEndDate");
  if (end <= start) refuse("RENTAL_TERM_INVALID", "INVALID_INPUT", "the expected end follows the start");
  const currency = input.currency === undefined ? "USD" : text(input.currency, "currency", 3);
  if (!/^[A-Z]{3}$/.test(currency)) refuse("CURRENCY_INVALID", "INVALID_INPUT", "currency is an ISO code");
  const rate = minor(input.rateMinor, "rateMinor", { positive: true }) as bigint;
  if (!BILLING_FREQUENCIES.includes(input.billingFrequency as never)) refuse("BILLING_FREQUENCY_INVALID", "INVALID_INPUT", `billingFrequency is one of ${BILLING_FREQUENCIES.join(", ")}`);
  const delivery = minor(input.deliveryChargeMinor, "deliveryChargeMinor", { optional: true });
  const install = minor(input.installChargeMinor, "installChargeMinor", { optional: true });
  const deliveryReq = optText(input.deliveryRequirements, "deliveryRequirements"), returnExp = optText(input.returnExpectations, "returnExpectations");
  const key = text(input.idempotencyKey, "idempotencyKey");
  const fp = fingerprintOf([companyId, accountId, siteId, start, end, currency, String(rate), input.billingFrequency, String(delivery), String(install), deliveryReq, returnExp]);
  return inTransaction(pool, async (c) => {
    const { rows: prior } = await c.query(`SELECT id, request_fingerprint FROM eos_rental.rental_agreements WHERE tenant_id = $1 AND idempotency_key = $2`, [actor.tenantId, key]);
    if (prior[0]) {
      if (prior[0].request_fingerprint !== fp) refuse("IDEMPOTENCY_KEY_REUSED", "CONFLICT", "that key created a different Rental Agreement");
      return Object.freeze({ outcome: "replayed" as const, agreement: await readRentalAgreementOn(c, actor.tenantId, String(prior[0].id)) });
    }
    let companyKey: string;
    try { companyKey = await resolveOperatingCompanyKeyForCompany(c, actor.tenantId, companyId); } catch {
      return refuse("OPERATING_COMPANY_KEY_NOT_BOUND", "PRECONDITION_FAILED", `operating company '${companyId}' has no ACTIVE key binding; it cannot own a rental fleet`);
    }
    const { rows: site } = await c.query(`SELECT a.status::text AS status FROM eos_crm.account_locations l JOIN eos_crm.accounts a ON a.tenant_id = l.tenant_id AND a.id = l.account_id
      WHERE l.tenant_id = $1 AND l.id = $2 AND l.account_id = $3`, [actor.tenantId, siteId, accountId]);
    if (!site[0]) refuse("CUSTOMER_SITE_MISMATCH", "PRECONDITION_FAILED", "the site is not a site of that customer");
    if (site[0].status !== "ACTIVE") refuse("CUSTOMER_NOT_ACTIVE", "PRECONDITION_FAILED", `the customer is ${String(site[0].status)}`);
    const id = `rag_${randomUUID()}`;
    const number = await allocateRentalAgreementNumber(c, actor.tenantId, now());
    await c.query(`INSERT INTO eos_rental.rental_agreements (id, tenant_id, rental_agreement_number, operating_company_key, account_id, customer_location_id, status,
        start_date, currency, delivery_requirements, return_expectations, idempotency_key, request_fingerprint, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9,$10,$11,$12,$13)`,
      [id, actor.tenantId, number, companyKey, accountId, siteId, start, currency, deliveryReq, returnExp, key, fp, actor.principalId]);
    await c.query(`INSERT INTO eos_rental.rental_agreement_terms (tenant_id, agreement_id, version, rate_minor, billing_frequency, expected_end_date,
        delivery_charge_minor, install_charge_minor, change_kind, reason, recorded_by) VALUES ($1,$2,1,$3,$4,$5,$6,$7,'ORIGINAL','original agreed terms',$8)`,
      [actor.tenantId, id, rate.toString(), input.billingFrequency, end, delivery?.toString() ?? null, install?.toString() ?? null, actor.principalId]);
    await audit(c, actor, "rental.agreement.create", "rental_agreement", id, { number, operatingCompanyKey: companyKey, accountId, siteId }, null);
    return Object.freeze({ outcome: "recorded" as const, agreement: await readRentalAgreementOn(c, actor.tenantId, id) });
  });
}

export async function activateRentalAgreement(pool: Pool, actor: RentalActor, input: Record<string, unknown>) {
  requireCapability(actor, RENTAL_AGREEMENT_MANAGE);
  only(input, ["agreementId"]);
  const agreementId = text(input.agreementId, "agreementId");
  return inTransaction(pool, async (c) => {
    const a = await lockAgreement(c, actor.tenantId, agreementId);
    if (a.status === "ACTIVE") return Object.freeze({ outcome: "replayed" as const, agreement: await readRentalAgreementOn(c, actor.tenantId, agreementId) });
    if (a.status !== "DRAFT") refuse("RENTAL_AGREEMENT_NOT_DRAFT", "PRECONDITION_FAILED", `a ${String(a.status)} agreement is not activated`);
    await c.query(`UPDATE eos_rental.rental_agreements SET status = 'ACTIVE', activated_by = $3, activated_at = now(), version = version + 1, updated_at = now()
      WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, agreementId, actor.principalId]);
    await audit(c, actor, "rental.agreement.activate", "rental_agreement", agreementId, { status: "ACTIVE" }, null);
    return Object.freeze({ outcome: "recorded" as const, agreement: await readRentalAgreementOn(c, actor.tenantId, agreementId) });
  });
}

/** EXTENSION (a later expected end) or AMENDMENT (any agreed term) -- a NEW terms version; earlier versions never change. */
export async function amendRentalAgreementTerms(pool: Pool, actor: RentalActor, input: Record<string, unknown>) {
  requireCapability(actor, RENTAL_AGREEMENT_MANAGE);
  only(input, ["agreementId", "changeKind", "expectedEndDate", "rateMinor", "billingFrequency", "deliveryChargeMinor", "installChargeMinor", "reason"]);
  const agreementId = text(input.agreementId, "agreementId"), reason = text(input.reason, "reason", 1000);
  if (input.changeKind !== "EXTENSION" && input.changeKind !== "AMENDMENT") refuse("CHANGE_KIND_INVALID", "INVALID_INPUT", "changeKind is EXTENSION or AMENDMENT");
  return inTransaction(pool, async (c) => {
    const a = await lockAgreement(c, actor.tenantId, agreementId);
    if (!["DRAFT", "ACTIVE"].includes(a.status)) refuse("RENTAL_AGREEMENT_ENDED", "PRECONDITION_FAILED", `a ${String(a.status)} agreement is not amended`);
    const t = await currentTermsOn(c, actor.tenantId, agreementId);
    const end = input.expectedEndDate === undefined ? dateText(t.expected_end_date) as string : isoDate(input.expectedEndDate, "expectedEndDate");
    if (input.changeKind === "EXTENSION") {
      const others = ["rateMinor", "billingFrequency", "deliveryChargeMinor", "installChargeMinor"].filter((k) => input[k] !== undefined);
      if (others.length) refuse("EXTENSION_CHANGES_TERMS", "INVALID_INPUT", `an extension changes only the expected end (use AMENDMENT for: ${others.join(", ")})`);
      if (end <= (dateText(t.expected_end_date) as string)) refuse("EXTENSION_NOT_LATER", "INVALID_INPUT", "an extension moves the expected end later");
    }
    if (end <= (dateText(a.start_date) as string)) refuse("RENTAL_TERM_INVALID", "INVALID_INPUT", "the expected end follows the start");
    const rate = input.rateMinor === undefined ? BigInt(t.rate_minor) : minor(input.rateMinor, "rateMinor", { positive: true }) as bigint;
    const freq = input.billingFrequency === undefined ? t.billing_frequency : input.billingFrequency;
    if (!BILLING_FREQUENCIES.includes(freq as never)) refuse("BILLING_FREQUENCY_INVALID", "INVALID_INPUT", `billingFrequency is one of ${BILLING_FREQUENCIES.join(", ")}`);
    const delivery = input.deliveryChargeMinor === undefined ? t.delivery_charge_minor : minor(input.deliveryChargeMinor, "deliveryChargeMinor", { optional: true })?.toString() ?? null;
    const install = input.installChargeMinor === undefined ? t.install_charge_minor : minor(input.installChargeMinor, "installChargeMinor", { optional: true })?.toString() ?? null;
    const version = Number(t.version) + 1;
    await c.query(`INSERT INTO eos_rental.rental_agreement_terms (tenant_id, agreement_id, version, rate_minor, billing_frequency, expected_end_date,
        delivery_charge_minor, install_charge_minor, change_kind, reason, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [actor.tenantId, agreementId, version, rate.toString(), freq, end, delivery, install, input.changeKind, reason, actor.principalId]);
    await c.query(`UPDATE eos_rental.rental_agreements SET version = version + 1, updated_at = now() WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, agreementId]);
    await audit(c, actor, "rental.agreement.amend", "rental_agreement", agreementId, { termsVersion: version, changeKind: input.changeKind, expectedEndDate: end }, reason);
    return Object.freeze({ outcome: "recorded" as const, termsVersion: version, agreement: await readRentalAgreementOn(c, actor.tenantId, agreementId) });
  });
}

/** CLOSED (an active agreement with every unit returned) or CANCELLED (never deployed) -- with a reason. */
export async function endRentalAgreement(pool: Pool, actor: RentalActor, input: Record<string, unknown>) {
  requireCapability(actor, RENTAL_AGREEMENT_MANAGE);
  only(input, ["agreementId", "outcome", "reason"]);
  const agreementId = text(input.agreementId, "agreementId"), reason = text(input.reason, "reason", 1000);
  if (input.outcome !== "CLOSED" && input.outcome !== "CANCELLED") refuse("OUTCOME_INVALID", "INVALID_INPUT", "outcome is CLOSED or CANCELLED");
  return inTransaction(pool, async (c) => {
    const a = await lockAgreement(c, actor.tenantId, agreementId);
    if (!["DRAFT", "ACTIVE"].includes(a.status)) refuse("RENTAL_AGREEMENT_ENDED", "PRECONDITION_FAILED", `the agreement is already ${String(a.status)}`);
    const { rows: live } = await c.query(`SELECT count(*)::int AS n FROM eos_rental.rental_assignments WHERE tenant_id = $1 AND agreement_id = $2
      AND status IN ('RESERVED', 'DEPLOYED', 'RETURN_PENDING')`, [actor.tenantId, agreementId]);
    if (Number(live[0].n) > 0) refuse("RENTAL_UNITS_STILL_ASSIGNED", "PRECONDITION_FAILED", "every unit is returned or released before the agreement ends");
    if (input.outcome === "CLOSED" && a.status !== "ACTIVE") refuse("RENTAL_AGREEMENT_NOT_ACTIVE", "PRECONDITION_FAILED", "only an active agreement closes; a draft is cancelled");
    if (input.outcome === "CANCELLED") {
      const { rows: deployed } = await c.query(`SELECT count(*)::int AS n FROM eos_rental.rental_assignments WHERE tenant_id = $1 AND agreement_id = $2 AND deployed_at IS NOT NULL`,
        [actor.tenantId, agreementId]);
      if (Number(deployed[0].n) > 0) refuse("RENTAL_AGREEMENT_WAS_DEPLOYED", "PRECONDITION_FAILED", "an agreement that deployed equipment is closed, not cancelled");
    }
    await c.query(`UPDATE eos_rental.rental_agreements SET status = $3, ended_by = $4, ended_at = now(), end_reason = $5, version = version + 1, updated_at = now()
      WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, agreementId, input.outcome, actor.principalId, reason]);
    await audit(c, actor, "rental.agreement.end", "rental_agreement", agreementId, { status: input.outcome }, reason);
    return Object.freeze({ outcome: "recorded" as const, agreement: await readRentalAgreementOn(c, actor.tenantId, agreementId) });
  });
}

// ════════════════════ assign ════════════════════

export async function reserveRentalUnit(pool: Pool, actor: RentalActor, input: Record<string, unknown>) {
  requireCapability(actor, RENTAL_UNIT_ASSIGN);
  only(input, ["agreementId", "fleetUnitId", "replacesAssignmentId", "idempotencyKey"]);
  const agreementId = text(input.agreementId, "agreementId"), fleetUnitId = text(input.fleetUnitId, "fleetUnitId"), key = text(input.idempotencyKey, "idempotencyKey");
  const replaces = optText(input.replacesAssignmentId, "replacesAssignmentId", 200);
  return inTransaction(pool, async (c) => {
    const { rows: prior } = await c.query(`SELECT * FROM eos_rental.rental_assignments WHERE tenant_id = $1 AND idempotency_key = $2`, [actor.tenantId, key]);
    if (prior[0]) {
      if (prior[0].agreement_id !== agreementId || prior[0].fleet_unit_id !== fleetUnitId) refuse("IDEMPOTENCY_KEY_REUSED", "CONFLICT", "that key reserved something else");
      return Object.freeze({ outcome: "replayed" as const, assignmentId: String(prior[0].id), agreement: await readRentalAgreementOn(c, actor.tenantId, agreementId) });
    }
    const a = await lockAgreement(c, actor.tenantId, agreementId);
    if (!["DRAFT", "ACTIVE"].includes(a.status)) refuse("RENTAL_AGREEMENT_ENDED", "PRECONDITION_FAILED", `a ${String(a.status)} agreement takes no equipment`);
    const unit = await lockUnit(c, actor.tenantId, fleetUnitId);
    if (unit.owner_operating_company_key !== a.operating_company_key) {
      refuse("RENTAL_COMPANY_MISMATCH", "PRECONDITION_FAILED", "a company rents only its own fleet; the unit is owned by another operating company");
    }
    if (unit.availability !== "AVAILABLE") refuse("RENTAL_UNIT_NOT_AVAILABLE", "CONFLICT", `the unit is ${String(unit.availability)}; it cannot be booked`);
    if (replaces !== null) {
      const r = await lockAssignment(c, actor.tenantId, replaces);
      if (r.agreement_id !== agreementId || r.status !== "DEPLOYED") refuse("EXCHANGE_TARGET_INVALID", "PRECONDITION_FAILED", "an exchange replaces a DEPLOYED unit of the same agreement");
    }
    const id = `ras_${randomUUID()}`;
    try {
      await c.query(`INSERT INTO eos_rental.rental_assignments (id, tenant_id, agreement_id, fleet_unit_id, status, replaces_assignment_id, reserved_by, idempotency_key)
        VALUES ($1,$2,$3,$4,'RESERVED',$5,$6,$7)`, [id, actor.tenantId, agreementId, fleetUnitId, replaces, actor.principalId, key]);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") refuse("RENTAL_UNIT_NOT_AVAILABLE", "CONFLICT", "the unit already has a live assignment");
      throw err;
    }
    await moveUnit(c, actor, unit, "RESERVED", id);
    await fleetEvent(c, actor, unit, { type: "RESERVED", to: "RESERVED", agreementId, assignmentId: id, reason: replaces ? `exchange for ${replaces}` : null });
    await audit(c, actor, "rental.unit.reserve", "rental_assignment", id, { agreementId, fleetUnitId, replacesAssignmentId: replaces }, null);
    return Object.freeze({ outcome: "recorded" as const, assignmentId: id, agreement: await readRentalAgreementOn(c, actor.tenantId, agreementId) });
  });
}

export async function releaseRentalReservation(pool: Pool, actor: RentalActor, input: Record<string, unknown>) {
  requireCapability(actor, RENTAL_UNIT_ASSIGN);
  only(input, ["assignmentId", "reason"]);
  const assignmentId = text(input.assignmentId, "assignmentId"), reason = text(input.reason, "reason", 1000);
  return inTransaction(pool, async (c) => {
    const s = await lockAssignment(c, actor.tenantId, assignmentId);
    if (s.status !== "RESERVED") refuse("RENTAL_ASSIGNMENT_NOT_RESERVED", "PRECONDITION_FAILED", `a ${String(s.status)} assignment is not released (a deployed unit is returned)`);
    const unit = await lockUnit(c, actor.tenantId, s.fleet_unit_id);
    await c.query(`UPDATE eos_rental.rental_assignments SET status = 'RELEASED', released_by = $3, released_at = now(), release_reason = $4 WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, assignmentId, actor.principalId, reason]);
    await moveUnit(c, actor, unit, "AVAILABLE", null);
    await fleetEvent(c, actor, unit, { type: "RESERVATION_RELEASED", to: "AVAILABLE", agreementId: s.agreement_id, assignmentId, reason });
    return Object.freeze({ outcome: "recorded" as const, agreement: await readRentalAgreementOn(c, actor.tenantId, String(s.agreement_id)) });
  });
}

// ════════════════════ return ════════════════════

export async function initiateRentalReturn(pool: Pool, actor: RentalActor, input: Record<string, unknown>) {
  requireCapability(actor, RENTAL_UNIT_RETURN);
  only(input, ["assignmentId", "expectedPickupDate", "returnWorkOrderId", "reason"]);
  const assignmentId = text(input.assignmentId, "assignmentId");
  const pickup = input.expectedPickupDate === undefined ? null : isoDate(input.expectedPickupDate, "expectedPickupDate");
  const woId = optText(input.returnWorkOrderId, "returnWorkOrderId", 200), reason = optText(input.reason, "reason", 1000);
  return inTransaction(pool, async (c) => {
    const s = await lockAssignment(c, actor.tenantId, assignmentId);
    if (s.status === "RETURN_PENDING") return Object.freeze({ outcome: "replayed" as const, agreement: await readRentalAgreementOn(c, actor.tenantId, String(s.agreement_id)) });
    if (s.status !== "DEPLOYED") refuse("RENTAL_ASSIGNMENT_NOT_DEPLOYED", "PRECONDITION_FAILED", `a ${String(s.status)} assignment has nothing to return`);
    if (woId !== null) {
      const { rows } = await c.query(`SELECT rental_agreement_id FROM eos_ops.work_orders WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, woId]);
      if (rows[0]?.rental_agreement_id !== s.agreement_id) refuse("RETURN_WORK_ORDER_MISMATCH", "PRECONDITION_FAILED", "the pickup Work Order is not one of this agreement's");
    }
    const unit = await lockUnit(c, actor.tenantId, s.fleet_unit_id);
    await c.query(`UPDATE eos_rental.rental_assignments SET status = 'RETURN_PENDING', return_initiated_by = $3, return_initiated_at = now(), expected_pickup_date = $4,
      return_work_order_id = $5 WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, assignmentId, actor.principalId, pickup, woId]);
    await moveUnit(c, actor, unit, "RETURN_PENDING", assignmentId);
    await fleetEvent(c, actor, unit, { type: "RETURN_INITIATED", to: "RETURN_PENDING", agreementId: s.agreement_id, assignmentId, workOrderId: woId, equipmentId: s.equipment_id, reason });
    return Object.freeze({ outcome: "recorded" as const, agreement: await readRentalAgreementOn(c, actor.tenantId, String(s.agreement_id)) });
  });
}

/**
 * The PHYSICAL RECEIPT: custody leaves the customer site (EQUIPMENT) for a warehouse of the OWNER company, the ledger records the
 * unit's return (RENTAL_RETURN +1 there, so stock and custody agree), the deployed Equipment record becomes INACTIVE with a
 * RENTAL_RETURNED event (its history kept), and the unit waits in INSPECTION -- never automatically AVAILABLE.
 */
export async function receiveRentalReturn(pool: Pool, actor: RentalActor, input: Record<string, unknown>) {
  requireCapability(actor, RENTAL_UNIT_RETURN);
  only(input, ["assignmentId", "warehouseId", "conditionNotes", "idempotencyKey"]);
  const assignmentId = text(input.assignmentId, "assignmentId"), warehouseId = text(input.warehouseId, "warehouseId");
  const notes = text(input.conditionNotes, "conditionNotes", 2000), key = text(input.idempotencyKey, "idempotencyKey");
  return inTransaction(pool, async (c) => {
    const s = await lockAssignment(c, actor.tenantId, assignmentId);
    if (s.status === "RETURNED") return Object.freeze({ outcome: "replayed" as const, agreement: await readRentalAgreementOn(c, actor.tenantId, String(s.agreement_id)) });
    if (!["DEPLOYED", "RETURN_PENDING"].includes(s.status)) refuse("RENTAL_ASSIGNMENT_NOT_DEPLOYED", "PRECONDITION_FAILED", `a ${String(s.status)} assignment has nothing to receive`);
    const unit = await lockUnit(c, actor.tenantId, s.fleet_unit_id);
    const { rows: wh } = await c.query(`SELECT operating_company_key, status::text AS status FROM eos_ops.warehouses WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, warehouseId]);
    const w = wh[0] ?? refuse("WAREHOUSE_NOT_FOUND", "NOT_FOUND", "no such warehouse");
    if (w.operating_company_key !== unit.owner_operating_company_key) {
      refuse("RETURN_WAREHOUSE_NOT_OWNERS", "PRECONDITION_FAILED", "a rental unit returns into a warehouse of the company that owns it");
    }
    const scoped = await authorizeObjectAction(postgresContextualReader(c), {
      actor, capabilityKey: RENTAL_UNIT_RETURN, predicates: [{ kind: "OPERATIONAL_SCOPE" as const, scopeType: "WAREHOUSE", scopeId: warehouseId }],
    });
    if (!scoped.allowed) refuse(scoped.reason, "FORBIDDEN", scoped.reason === "OUTSIDE_OPERATIONAL_SCOPE" ? "that warehouse is outside your warehouse scope" : "not authorized to receive into this warehouse");
    const { rows: cu } = await c.query(`SELECT * FROM eos_ops.serialized_custody WHERE tenant_id = $1 AND part_id = $2 AND serial_number = $3 FOR UPDATE`,
      [actor.tenantId, unit.part_id, unit.serial_number]);
    const custody = cu[0];
    if (!custody || custody.location_type !== "EQUIPMENT" || custody.location_id !== s.equipment_id) {
      refuse("RENTAL_CUSTODY_MISMATCH", "CONFLICT", "custody does not show the unit at its deployed Equipment; investigate before receiving");
    }
    const { rows: eq } = await c.query(`SELECT * FROM eos_ops.equipment WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, s.equipment_id]);
    const equipment = eq[0];
    // Customer custody ends; Taylor custody (the owner's warehouse) is restored. Status AVAILABLE is the physical stock state --
    // the fleet unit's INSPECTION, not custody, decides whether it can be rented again.
    await c.query(`UPDATE eos_ops.serialized_custody SET status = 'AVAILABLE', location_type = 'WAREHOUSE', location_id = $4, updated_by = $5, updated_at = now()
      WHERE tenant_id = $1 AND part_id = $2 AND serial_number = $3`, [actor.tenantId, unit.part_id, unit.serial_number, warehouseId, actor.principalId]);
    const movementId = `mov_${randomUUID()}`;
    await c.query(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
        movement_type, quantity_delta, serial_number, source_kind, source_id, idempotency_key, created_by)
      VALUES ($1,$2,$3,$4,'SERIAL','WAREHOUSE',$5,'RENTAL_RETURN',1,$6,'RENTAL_RETURN',$7,$8,$9)`,
      [movementId, actor.tenantId, unit.owner_operating_company_key, unit.part_id, warehouseId, unit.serial_number, assignmentId, `rentalReturn:${key}`, actor.principalId]);
    await c.query(`UPDATE eos_ops.equipment SET status = 'INACTIVE', version = version + 1, updated_by = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, s.equipment_id, actor.principalId]);
    await c.query(`INSERT INTO eos_ops.equipment_events (id, tenant_id, equipment_id, event_type, operating_company_key, account_id, customer_location_id, work_order_id,
        part_id, serial_number, ledger_movement_id, source, reason, changes, idempotency_key, actor_principal_id)
      VALUES ($1,$2,$3,'RENTAL_RETURNED',$4,$5,$6,$7,$8,$9,$10,'RENTAL_RETURN',$11,$12,$13,$14)`,
      [`eqe_${randomUUID()}`, actor.tenantId, s.equipment_id, equipment.operating_company_key, equipment.account_id, equipment.customer_location_id, s.return_work_order_id,
        unit.part_id, unit.serial_number, movementId, "rental equipment returned to Taylor custody", JSON.stringify({ status: { from: equipment.status, to: "INACTIVE" },
          returnedTo: { locationType: "WAREHOUSE", locationId: warehouseId }, assignmentId, conditionNotes: notes }), `rentalReturn:${key}`, actor.principalId]);
    await c.query(`UPDATE eos_rental.rental_assignments SET status = 'RETURNED', returned_by = $3, returned_at = now(), return_warehouse_id = $4,
        return_initiated_by = COALESCE(return_initiated_by, $3), return_initiated_at = COALESCE(return_initiated_at, now())
      WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, assignmentId, actor.principalId, warehouseId]);
    await moveUnit(c, actor, unit, "INSPECTION", null);
    await fleetEvent(c, actor, unit, { type: "RETURN_RECEIVED", to: "INSPECTION", agreementId: s.agreement_id, assignmentId, equipmentId: s.equipment_id,
      locationType: "WAREHOUSE", locationId: warehouseId, reason: notes });
    await audit(c, actor, "rental.unit.returnReceive", "rental_assignment", assignmentId, { warehouseId, movementId, equipmentId: s.equipment_id }, notes);
    return Object.freeze({ outcome: "recorded" as const, movementId, agreement: await readRentalAgreementOn(c, actor.tenantId, String(s.agreement_id)) });
  });
}

const INSPECTION_RESULT: Readonly<Record<string, string>> = Object.freeze({ READY: "AVAILABLE", NEEDS_SERVICE: "SERVICE_HOLD", UNAVAILABLE: "UNAVAILABLE" });

export async function inspectRentalUnit(pool: Pool, actor: RentalActor, input: Record<string, unknown>) {
  requireCapability(actor, RENTAL_UNIT_RETURN);
  only(input, ["fleetUnitId", "outcome", "conditionNotes", "idempotencyKey"]);
  const fleetUnitId = text(input.fleetUnitId, "fleetUnitId"), notes = text(input.conditionNotes, "conditionNotes", 2000), key = text(input.idempotencyKey, "idempotencyKey");
  const to = INSPECTION_RESULT[String(input.outcome)] ?? refuse("OUTCOME_INVALID", "INVALID_INPUT", "outcome is READY, NEEDS_SERVICE or UNAVAILABLE");
  return inTransaction(pool, async (c) => {
    const { rows: prior } = await c.query(`SELECT id FROM eos_rental.rental_inspections WHERE tenant_id = $1 AND idempotency_key = $2`, [actor.tenantId, key]);
    if (prior[0]) return Object.freeze({ outcome: "replayed" as const, inspectionId: String(prior[0].id), fleetUnit: await readFleetUnitOn(c, actor.tenantId, fleetUnitId) });
    const unit = await lockUnit(c, actor.tenantId, fleetUnitId);
    if (unit.availability !== "INSPECTION") refuse("RENTAL_UNIT_NOT_IN_INSPECTION", "PRECONDITION_FAILED", `a unit ${String(unit.availability)} is not awaiting inspection`);
    const { rows: last } = await c.query(`SELECT id FROM eos_rental.rental_assignments WHERE tenant_id = $1 AND fleet_unit_id = $2 AND status = 'RETURNED' ORDER BY returned_at DESC LIMIT 1`,
      [actor.tenantId, fleetUnitId]);
    const id = `rin_${randomUUID()}`;
    await c.query(`INSERT INTO eos_rental.rental_inspections (id, tenant_id, fleet_unit_id, assignment_id, outcome, condition_notes, inspected_by, idempotency_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, actor.tenantId, fleetUnitId, last[0]?.id ?? null, input.outcome, notes, actor.principalId, key]);
    await moveUnit(c, actor, unit, to, null);
    await fleetEvent(c, actor, unit, { type: "INSPECTED", to, assignmentId: last[0]?.id ?? null, reason: `${String(input.outcome)}: ${notes}` });
    return Object.freeze({ outcome: "recorded" as const, inspectionId: id, fleetUnit: await readFleetUnitOn(c, actor.tenantId, fleetUnitId) });
  });
}

// ════════════════════ charge ════════════════════

/** Whole periods between two dates for a frequency, or null when the span is not a whole number of periods. */
export function wholePeriods(start: string, end: string, frequency: string): number | null {
  const s = new Date(`${start}T00:00:00Z`), e = new Date(`${end}T00:00:00Z`);
  const days = Math.round((e.getTime() - s.getTime()) / 86_400_000);
  if (days <= 0) return null;
  if (frequency === "DAY") return days;
  if (frequency === "WEEK") return days % 7 === 0 ? days / 7 : null;
  const months = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth());
  const back = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + months, s.getUTCDate()));
  return months > 0 && back.getTime() === e.getTime() && back.getUTCDate() === s.getUTCDate() ? months : null;
}

/**
 * Record ONE charge's billing eligibility and prepare its RENTAL billing package in the same transaction. A PERIOD charge is
 * [periodStart, periodEnd) of WHOLE agreed periods inside the agreed term at the current terms' rate; a DELIVERY / INSTALL
 * charge is the agreed amount, once. Tax is the caller's evidence (DETERMINED amount or NOT_DETERMINED -> HELD).
 */
export async function recordRentalCharge(pool: Pool, actor: RentalActor, input: Record<string, unknown>) {
  requireCapability(actor, RENTAL_CHARGE_RECORD);
  only(input, ["agreementId", "kind", "periodStart", "periodEnd", "taxEvidence", "notes", "idempotencyKey"]);
  const agreementId = text(input.agreementId, "agreementId"), key = text(input.idempotencyKey, "idempotencyKey"), notes = optText(input.notes, "notes", 1000);
  const kind = input.kind;
  if (kind !== "PERIOD" && kind !== "DELIVERY" && kind !== "INSTALL") refuse("CHARGE_KIND_INVALID", "INVALID_INPUT", "kind is PERIOD, DELIVERY or INSTALL");
  const tax = parseTaxEvidence(input.taxEvidence);
  const fp = fingerprintOf([agreementId, kind, input.periodStart ?? null, input.periodEnd ?? null, tax]);
  return inTransaction(pool, async (c) => {
    const { rows: prior } = await c.query(`SELECT id, request_fingerprint FROM eos_rental.rental_charges WHERE tenant_id = $1 AND idempotency_key = $2`, [actor.tenantId, key]);
    if (prior[0]) {
      if (prior[0].request_fingerprint !== fp) refuse("IDEMPOTENCY_KEY_REUSED", "CONFLICT", "that key recorded a different charge");
      const pkg = await prepareRentalChargePackageOn(c, actor, String(prior[0].id));
      return Object.freeze({ outcome: "replayed" as const, chargeId: String(prior[0].id), billingPackage: pkg });
    }
    const a = await lockAgreement(c, actor.tenantId, agreementId);
    if (!["ACTIVE", "CLOSED"].includes(a.status)) refuse("RENTAL_AGREEMENT_NOT_ACTIVE", "PRECONDITION_FAILED", `a ${String(a.status)} agreement is not billed`);
    // ONE governed company (fails closed; CONSOLIDATED refused).
    await resolveOperatingCompanyFromKey(c, actor.tenantId, a.operating_company_key);
    const t = await currentTermsOn(c, actor.tenantId, agreementId);
    let periodStart: string | null = null, periodEnd: string | null = null, count = 1, unit: bigint;
    if (kind === "PERIOD") {
      periodStart = isoDate(input.periodStart, "periodStart");
      periodEnd = isoDate(input.periodEnd, "periodEnd");
      if (periodStart < (dateText(a.start_date) as string)) refuse("RENTAL_PERIOD_BEFORE_START", "PRECONDITION_FAILED", "the period starts before the agreement");
      if (periodEnd > (dateText(t.expected_end_date) as string)) {
        refuse("RENTAL_PERIOD_BEYOND_TERM", "PRECONDITION_FAILED", "the period runs past the agreed expected end; extend the agreement first");
      }
      const whole = wholePeriods(periodStart, periodEnd, String(t.billing_frequency));
      if (whole === null) {
        refuse("RENTAL_PARTIAL_PERIOD_UNRULED", "PRECONDITION_FAILED",
          `the span is not a whole number of ${String(t.billing_frequency)} periods; proration is not a governed rule`);
      }
      count = whole as number;
      unit = BigInt(t.rate_minor);
    } else {
      if (input.periodStart !== undefined || input.periodEnd !== undefined) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", "a one-time charge carries no period");
      const agreed = kind === "DELIVERY" ? t.delivery_charge_minor : t.install_charge_minor;
      if (agreed === null || agreed === undefined) refuse("RENTAL_CHARGE_NOT_AGREED", "PRECONDITION_FAILED", `the agreement's terms carry no ${String(kind).toLowerCase()} charge`);
      unit = BigInt(agreed);
    }
    const id = `rch_${randomUUID()}`;
    try {
      await c.query(`INSERT INTO eos_rental.rental_charges (id, tenant_id, agreement_id, kind, terms_version, period_start, period_end, period_count, unit_amount_minor,
          amount_minor, currency, notes, idempotency_key, request_fingerprint, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [id, actor.tenantId, agreementId, kind, t.version, periodStart, periodEnd, count, unit.toString(), (unit * BigInt(count)).toString(), a.currency, notes, key, fp, actor.principalId]);
    } catch (err) {
      const msg = String((err as Error).message ?? "");
      if (msg.includes("RENTAL_PERIOD_ALREADY_CHARGED")) refuse("RENTAL_PERIOD_ALREADY_CHARGED", "CONFLICT", "that period overlaps a period already charged on this agreement");
      if ((err as { code?: string }).code === "23505") refuse("RENTAL_CHARGE_ALREADY_RECORDED", "CONFLICT", `the agreement's ${String(kind).toLowerCase()} charge is already recorded`);
      throw err;
    }
    await c.query(`INSERT INTO eos_rental.rental_charge_tax_evidence (tenant_id, charge_id, version, status, tax_minor, reason, recorded_by) VALUES ($1,$2,1,$3,$4,$5,$6)`,
      [actor.tenantId, id, tax.status, tax.amountMinor, tax.reason, actor.principalId]);
    await audit(c, actor, "rental.charge.record", "rental_charge", id, { agreementId, kind, periodStart, periodEnd, count, amountMinor: (unit * BigInt(count)).toString() }, notes);
    const pkg = await prepareRentalChargePackageOn(c, actor, id);
    return Object.freeze({ outcome: "recorded" as const, chargeId: id, billingPackage: pkg });
  });
}

function parseTaxEvidence(v: unknown): { status: "DETERMINED" | "NOT_DETERMINED"; amountMinor: string | null; reason: string } {
  if (!v || typeof v !== "object" || Array.isArray(v)) refuse("TAX_EVIDENCE_REQUIRED", "INVALID_INPUT", "taxEvidence {status, amountMinor?} is required -- tax is never assumed");
  const t = v as Record<string, unknown>;
  only(t, ["status", "amountMinor", "reason"]);
  if (t.status === "DETERMINED") {
    const amt = minor(t.amountMinor, "taxEvidence.amountMinor") as bigint;
    return { status: "DETERMINED", amountMinor: amt.toString(), reason: optText(t.reason, "reason", 1000) ?? "tax determined at charge" };
  }
  if (t.status === "NOT_DETERMINED") {
    if (t.amountMinor !== undefined) refuse("TAX_EVIDENCE_INVALID", "INVALID_INPUT", "a NOT_DETERMINED tax carries no amount");
    return { status: "NOT_DETERMINED", amountMinor: null, reason: optText(t.reason, "reason", 1000) ?? "tax not yet determined" };
  }
  return refuse("TAX_EVIDENCE_INVALID", "INVALID_INPUT", "taxEvidence.status is DETERMINED or NOT_DETERMINED");
}

/** A later tax-evidence version for a HELD charge; the package is re-evaluated (a new version supersedes the HELD one). */
export async function determineRentalChargeTax(pool: Pool, actor: RentalActor, input: Record<string, unknown>) {
  requireCapability(actor, RENTAL_CHARGE_RECORD);
  only(input, ["chargeId", "taxEvidence"]);
  const chargeId = text(input.chargeId, "chargeId");
  const tax = parseTaxEvidence(input.taxEvidence);
  return inTransaction(pool, async (c) => {
    const { rows: ch } = await c.query(`SELECT id FROM eos_rental.rental_charges WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, chargeId]);
    if (!ch[0]) refuse("RENTAL_CHARGE_NOT_FOUND", "NOT_FOUND", "no rental charge with that id");
    const { rows: last } = await c.query(`SELECT version, status FROM eos_rental.rental_charge_tax_evidence WHERE tenant_id = $1 AND charge_id = $2 ORDER BY version DESC LIMIT 1`,
      [actor.tenantId, chargeId]);
    if (last[0]?.status === "DETERMINED") refuse("RENTAL_TAX_ALREADY_DETERMINED", "CONFLICT", "the charge's tax is already determined; a correction is a provider-side matter");
    await c.query(`INSERT INTO eos_rental.rental_charge_tax_evidence (tenant_id, charge_id, version, status, tax_minor, reason, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [actor.tenantId, chargeId, Number(last[0]?.version ?? 0) + 1, tax.status, tax.amountMinor, tax.reason, actor.principalId]);
    const pkg = await prepareRentalChargePackageOn(c, actor, chargeId);
    return Object.freeze({ outcome: "recorded" as const, chargeId, billingPackage: pkg });
  });
}

// ════════════════════ reads ════════════════════

export async function readFleetUnitOn(db: Queryable, tenantId: string, fleetUnitId: string) {
  const { rows } = await db.query(
    `SELECT f.*, c.location_type::text AS location_type, c.location_id, c.status::text AS custody_status,
            e.account_id AS custodian_account_id, e.customer_location_id AS custodian_site_id, a.name AS custodian_name, l.name AS site_name,
            w.name AS warehouse_name, ag.rental_agreement_number, ag.id AS agreement_id
       FROM eos_rental.fleet_units f
       JOIN eos_ops.serialized_custody c ON c.tenant_id = f.tenant_id AND c.part_id = f.part_id AND c.serial_number = f.serial_number
       LEFT JOIN eos_ops.equipment e ON c.location_type = 'EQUIPMENT' AND e.tenant_id = c.tenant_id AND e.id = c.location_id
       LEFT JOIN eos_crm.accounts a ON a.tenant_id = e.tenant_id AND a.id = e.account_id
       LEFT JOIN eos_crm.account_locations l ON l.tenant_id = e.tenant_id AND l.id = e.customer_location_id
       LEFT JOIN eos_ops.warehouses w ON c.location_type = 'WAREHOUSE' AND w.tenant_id = c.tenant_id AND w.id = c.location_id
       LEFT JOIN eos_rental.rental_assignments s ON s.id = f.current_assignment_id
       LEFT JOIN eos_rental.rental_agreements ag ON ag.id = s.agreement_id
      WHERE f.tenant_id = $1 AND f.id = $2`, [tenantId, fleetUnitId]);
  const f = rows[0] ?? refuse("FLEET_UNIT_NOT_FOUND", "NOT_FOUND", "no rental fleet unit with that id");
  const { rows: ev } = await db.query(`SELECT * FROM eos_rental.fleet_unit_events WHERE tenant_id = $1 AND fleet_unit_id = $2 ORDER BY occurred_at, id`, [tenantId, fleetUnitId]);
  const { rows: ins } = await db.query(`SELECT * FROM eos_rental.rental_inspections WHERE tenant_id = $1 AND fleet_unit_id = $2 ORDER BY inspected_at, id`, [tenantId, fleetUnitId]);
  return Object.freeze({
    ...fleetUnitSummary(f),
    events: ev.map((e) => ({ id: String(e.id), type: String(e.event_type), from: e.from_availability ?? null, to: String(e.to_availability),
      agreementId: e.agreement_id ?? null, assignmentId: e.assignment_id ?? null, workOrderId: e.work_order_id ?? null, equipmentId: e.equipment_id ?? null,
      locationType: e.location_type ?? null, locationId: e.location_id ?? null, reason: e.reason ?? null, actor: String(e.actor_principal_id),
      occurredAt: new Date(e.occurred_at).toISOString() })),
    inspections: ins.map((i) => ({ id: String(i.id), outcome: String(i.outcome), conditionNotes: String(i.condition_notes), inspectedBy: String(i.inspected_by),
      inspectedAt: new Date(i.inspected_at).toISOString() })),
  });
}

function fleetUnitSummary(f: Record<string, any>) {
  return {
    id: String(f.id), partId: String(f.part_id), serialNumber: String(f.serial_number), displayName: String(f.display_name),
    ownerOperatingCompanyKey: String(f.owner_operating_company_key), availability: String(f.availability), currentAssignmentId: f.current_assignment_id ?? null,
    agreement: f.agreement_id ? { id: String(f.agreement_id), number: String(f.rental_agreement_number) } : null,
    location: { type: String(f.location_type), id: String(f.location_id), label: f.location_type === "EQUIPMENT" ? (f.site_name ?? null) : (f.warehouse_name ?? null) },
    // Who holds it: the customer (custodian / site user) while deployed, otherwise the owning company itself.
    custodian: f.location_type === "EQUIPMENT"
      ? { kind: "CUSTOMER", accountId: f.custodian_account_id ?? null, name: f.custodian_name ?? null, siteId: f.custodian_site_id ?? null, siteName: f.site_name ?? null }
      : { kind: "OWNER", operatingCompanyKey: String(f.owner_operating_company_key) },
  };
}

export async function readRentalAgreementOn(db: Queryable, tenantId: string, agreementId: string) {
  const { rows } = await db.query(`SELECT g.*, a.name AS account_name, l.name AS site_name FROM eos_rental.rental_agreements g
      LEFT JOIN eos_crm.accounts a ON a.tenant_id = g.tenant_id AND a.id = g.account_id
      LEFT JOIN eos_crm.account_locations l ON l.tenant_id = g.tenant_id AND l.id = g.customer_location_id
     WHERE g.tenant_id = $1 AND g.id = $2`, [tenantId, agreementId]);
  const g = rows[0] ?? refuse("RENTAL_AGREEMENT_NOT_FOUND", "NOT_FOUND", "no Rental Agreement with that id");
  const { rows: terms } = await db.query(`SELECT * FROM eos_rental.rental_agreement_terms WHERE tenant_id = $1 AND agreement_id = $2 ORDER BY version`, [tenantId, agreementId]);
  const { rows: asg } = await db.query(`SELECT s.*, f.display_name, f.part_id, f.serial_number FROM eos_rental.rental_assignments s JOIN eos_rental.fleet_units f ON f.id = s.fleet_unit_id
     WHERE s.tenant_id = $1 AND s.agreement_id = $2 ORDER BY s.reserved_at, s.id`, [tenantId, agreementId]);
  const { rows: ch } = await db.query(
    `SELECT c.*, te.status AS tax_status, te.tax_minor, p.id AS package_id, p.status AS package_status, p.readiness_exceptions, p.total_minor,
            o.id AS obligation_id, o.status AS obligation_status, b.outstanding_minor
       FROM eos_rental.rental_charges c
       LEFT JOIN LATERAL (SELECT status, tax_minor FROM eos_rental.rental_charge_tax_evidence x WHERE x.charge_id = c.id ORDER BY version DESC LIMIT 1) te ON TRUE
       LEFT JOIN eos_finance.billing_packages p ON p.tenant_id = c.tenant_id AND p.source_kind = 'RENTAL_CHARGE' AND p.rental_charge_id = c.id AND p.status IN ('HELD', 'READY')
       LEFT JOIN eos_finance.obligations o ON o.tenant_id = p.tenant_id AND o.source_domain = 'BILLING_PACKAGE' AND o.source_record_id = p.id
       LEFT JOIN eos_finance.obligation_balances b ON b.tenant_id = o.tenant_id AND b.obligation_id = o.id
      WHERE c.tenant_id = $1 AND c.agreement_id = $2 ORDER BY c.period_start NULLS FIRST, c.recorded_at`, [tenantId, agreementId]);
  const { rows: wos } = await db.query(`SELECT id, work_order_number, work_order_type::text AS type, status::text AS status, equipment_id FROM eos_ops.work_orders
     WHERE tenant_id = $1 AND rental_agreement_id = $2 ORDER BY created_at`, [tenantId, agreementId]);
  return Object.freeze({
    id: String(g.id), number: String(g.rental_agreement_number), status: String(g.status), operatingCompanyKey: String(g.operating_company_key),
    customer: { accountId: String(g.account_id), name: g.account_name ?? null }, site: { id: String(g.customer_location_id), name: g.site_name ?? null },
    startDate: dateText(g.start_date), currency: String(g.currency), deliveryRequirements: g.delivery_requirements ?? null, returnExpectations: g.return_expectations ?? null,
    disposition: "RENTAL" as const, ownershipTransfers: false as const,
    currentTerms: termsView(terms[terms.length - 1]), termsHistory: terms.map(termsView),
    assignments: asg.map((s) => ({ id: String(s.id), fleetUnitId: String(s.fleet_unit_id), displayName: String(s.display_name), partId: String(s.part_id),
      serialNumber: String(s.serial_number), status: String(s.status), replacesAssignmentId: s.replaces_assignment_id ?? null,
      deploymentWorkOrderId: s.deployment_work_order_id ?? null, equipmentId: s.equipment_id ?? null, deployedAt: s.deployed_at ? new Date(s.deployed_at).toISOString() : null,
      expectedPickupDate: dateText(s.expected_pickup_date), returnedAt: s.returned_at ? new Date(s.returned_at).toISOString() : null, returnWarehouseId: s.return_warehouse_id ?? null })),
    charges: ch.map((c) => ({ id: String(c.id), kind: String(c.kind), termsVersion: Number(c.terms_version), periodStart: dateText(c.period_start), periodEnd: dateText(c.period_end),
      periodCount: Number(c.period_count), unitAmountMinor: String(c.unit_amount_minor), amountMinor: String(c.amount_minor), currency: String(c.currency),
      taxEvidence: { status: String(c.tax_status), amountMinor: c.tax_minor === null ? null : String(c.tax_minor) },
      billingPackage: c.package_id ? { id: String(c.package_id), status: String(c.package_status), readinessExceptions: [...(c.readiness_exceptions ?? [])],
        totalMinor: c.total_minor === null ? null : String(c.total_minor) } : null,
      receivable: c.obligation_id ? { obligationId: String(c.obligation_id), status: String(c.obligation_status), outstandingMinor: String(c.outstanding_minor) } : null })),
    workOrders: wos.map((w) => ({ id: String(w.id), number: String(w.work_order_number), type: String(w.type), status: String(w.status), equipmentId: w.equipment_id ?? null })),
  });
}

function termsView(t: Record<string, any>) {
  return Object.freeze({ version: Number(t.version), changeKind: String(t.change_kind), rateMinor: String(t.rate_minor), billingFrequency: String(t.billing_frequency),
    expectedEndDate: dateText(t.expected_end_date), deliveryChargeMinor: t.delivery_charge_minor === null ? null : String(t.delivery_charge_minor),
    installChargeMinor: t.install_charge_minor === null ? null : String(t.install_charge_minor), reason: String(t.reason), recordedBy: String(t.recorded_by),
    recordedAt: new Date(t.recorded_at).toISOString() });
}

export async function readFleetUnit(pool: Pool, actor: RentalActor, input: Record<string, unknown>) {
  requireCapability(actor, RENTAL_READ);
  return readFleetUnitOn(pool, actor.tenantId, text(input.fleetUnitId, "fleetUnitId"));
}
export async function readRentalAgreement(pool: Pool, actor: RentalActor, input: Record<string, unknown>) {
  requireCapability(actor, RENTAL_READ);
  return readRentalAgreementOn(pool, actor.tenantId, text(input.agreementId, "agreementId"));
}

export async function listRentalAgreements(pool: Pool, actor: RentalActor, input: Record<string, unknown>) {
  requireCapability(actor, RENTAL_READ);
  only(input, ["status"]);
  if (input.status !== undefined && !["DRAFT", "ACTIVE", "CLOSED", "CANCELLED"].includes(String(input.status))) refuse("STATUS_INVALID", "INVALID_INPUT", "status is DRAFT, ACTIVE, CLOSED or CANCELLED");
  const { rows } = await pool.query(
    `SELECT g.id, g.rental_agreement_number, g.status, g.operating_company_key, g.account_id, a.name AS account_name, g.start_date, t.expected_end_date, t.rate_minor,
            t.billing_frequency, g.currency,
            (SELECT count(*)::int FROM eos_rental.rental_assignments s WHERE s.agreement_id = g.id AND s.status IN ('DEPLOYED', 'RETURN_PENDING')) AS units_out
       FROM eos_rental.rental_agreements g
       LEFT JOIN eos_crm.accounts a ON a.tenant_id = g.tenant_id AND a.id = g.account_id
       JOIN LATERAL (SELECT * FROM eos_rental.rental_agreement_terms x WHERE x.agreement_id = g.id ORDER BY version DESC LIMIT 1) t ON TRUE
      WHERE g.tenant_id = $1 AND ($2::text IS NULL OR g.status = $2) ORDER BY g.created_at DESC LIMIT 200`, [actor.tenantId, input.status ?? null]);
  return Object.freeze({ items: rows.map((r) => ({ id: String(r.id), number: String(r.rental_agreement_number), status: String(r.status), operatingCompanyKey: String(r.operating_company_key),
    customer: { accountId: String(r.account_id), name: r.account_name ?? null }, startDate: dateText(r.start_date), expectedEndDate: dateText(r.expected_end_date),
    rateMinor: String(r.rate_minor), billingFrequency: String(r.billing_frequency), currency: String(r.currency), unitsOut: Number(r.units_out) })) });
}

export async function listFleetUnits(pool: Pool, actor: RentalActor, input: Record<string, unknown>) {
  requireCapability(actor, RENTAL_READ);
  only(input, ["availability"]);
  if (input.availability !== undefined && !RENTAL_AVAILABILITY.includes(input.availability as never)) refuse("AVAILABILITY_INVALID", "INVALID_INPUT", `availability is one of ${RENTAL_AVAILABILITY.join(", ")}`);
  const { rows } = await pool.query(`SELECT id FROM eos_rental.fleet_units WHERE tenant_id = $1 AND ($2::text IS NULL OR availability = $2) ORDER BY display_name, id LIMIT 500`,
    [actor.tenantId, input.availability ?? null]);
  const items: ReturnType<typeof fleetUnitSummary>[] = [];
  for (const r of rows) {
    const { events: _e, inspections: _i, ...summary } = await readFleetUnitOn(pool, actor.tenantId, String(r.id));
    items.push(summary);
  }
  return Object.freeze({ items });
}

/**
 * THE RENTAL WORKSPACE -- exception-first answers to: what is available, reserved, going out, on rent (where, who holds it),
 * needs service, due back, being returned, awaiting inspection, and what has a billing exception. Dates are the owning
 * company's business date (the governed resolver), never a UTC cut.
 */
export async function readRentalWorkspace(pool: Pool, actor: RentalActor, input: Record<string, unknown>) {
  requireCapability(actor, RENTAL_READ);
  only(input, ["dueWithinDays"]);
  const within = input.dueWithinDays === undefined ? 7 : Number(input.dueWithinDays);
  if (!Number.isInteger(within) || within < 0 || within > 90) refuse("DUE_WINDOW_INVALID", "INVALID_INPUT", "dueWithinDays is 0..90");
  const t = actor.tenantId;
  const { rows: units } = await pool.query(`SELECT id FROM eos_rental.fleet_units WHERE tenant_id = $1 ORDER BY display_name, id LIMIT 1000`, [t]);
  const fleet: ReturnType<typeof fleetUnitSummary>[] = [];
  for (const u of units) {
    const { events: _e, inspections: _i, ...summary } = await readFleetUnitOn(pool, t, String(u.id));
    fleet.push(summary);
  }
  const by = (a: string) => fleet.filter((f) => f.availability === a);
  // Going out: RESERVED units whose agreement has an INSTALL Work Order not yet completed (delivery scheduled / in progress).
  const { rows: goingOut } = await pool.query(
    `SELECT s.fleet_unit_id, w.id AS work_order_id, w.work_order_number, w.status::text AS status FROM eos_rental.rental_assignments s
       JOIN eos_ops.work_orders w ON w.tenant_id = s.tenant_id AND w.rental_agreement_id = s.agreement_id AND w.work_order_type = 'INSTALL'
                                 AND w.equipment_id IS NULL AND w.status::text NOT IN ('COMPLETED', 'CANCELLED', 'CLOSED')
      WHERE s.tenant_id = $1 AND s.status = 'RESERVED'`, [t]);
  const { rows: due } = await pool.query(
    `SELECT g.id, g.rental_agreement_number, g.operating_company_key, te.expected_end_date,
            eos_policy.operating_company_business_date(g.tenant_id, oc.operating_company_id, now()) AS today,
            (SELECT count(*)::int FROM eos_rental.rental_assignments s WHERE s.agreement_id = g.id AND s.status IN ('DEPLOYED', 'RETURN_PENDING')) AS units_out
       FROM eos_rental.rental_agreements g
       JOIN LATERAL (SELECT expected_end_date FROM eos_rental.rental_agreement_terms x WHERE x.agreement_id = g.id ORDER BY version DESC LIMIT 1) te ON TRUE
       JOIN eos_policy.tenant_operating_company_keys oc ON oc.tenant_id = g.tenant_id AND oc.operating_company_key = g.operating_company_key AND oc.status = 'ACTIVE'
      WHERE g.tenant_id = $1 AND g.status = 'ACTIVE'`, [t]);
  const dueBack = due.filter((d) => Number(d.units_out) > 0).map((d) => {
    const end = dateText(d.expected_end_date) as string, today = dateText(d.today) as string;
    const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    return { agreementId: String(d.id), number: String(d.rental_agreement_number), expectedEndDate: end, businessDate: today, daysUntilDue: days, overdue: days < 0, unitsOut: Number(d.units_out) };
  }).filter((d) => d.daysUntilDue <= within);
  // Billing exceptions: a HELD rental package (says why), and an agreement with equipment out whose charged periods stop before today.
  const { rows: held } = await pool.query(
    `SELECT p.id, p.rental_agreement_id, p.rental_charge_id, p.readiness_exceptions, g.rental_agreement_number FROM eos_finance.billing_packages p
       JOIN eos_rental.rental_agreements g ON g.id = p.rental_agreement_id
      WHERE p.tenant_id = $1 AND p.source_kind = 'RENTAL_CHARGE' AND p.status = 'HELD'`, [t]);
  const { rows: uncharged } = await pool.query(
    `SELECT g.id, g.rental_agreement_number, max(c.period_end) AS charged_through,
            eos_policy.operating_company_business_date(g.tenant_id, oc.operating_company_id, now()) AS today
       FROM eos_rental.rental_agreements g
       JOIN eos_policy.tenant_operating_company_keys oc ON oc.tenant_id = g.tenant_id AND oc.operating_company_key = g.operating_company_key AND oc.status = 'ACTIVE'
       LEFT JOIN eos_rental.rental_charges c ON c.agreement_id = g.id AND c.kind = 'PERIOD'
      WHERE g.tenant_id = $1 AND g.status = 'ACTIVE'
        AND EXISTS (SELECT 1 FROM eos_rental.rental_assignments s WHERE s.agreement_id = g.id AND s.status IN ('DEPLOYED', 'RETURN_PENDING'))
      GROUP BY g.id, g.rental_agreement_number, oc.operating_company_id, g.tenant_id`, [t]);
  const billingExceptions = [
    ...held.map((h) => ({ kind: "RENTAL_PACKAGE_HELD", agreementId: String(h.rental_agreement_id), number: String(h.rental_agreement_number),
      chargeId: String(h.rental_charge_id), packageId: String(h.id), reasons: [...(h.readiness_exceptions ?? [])] })),
    ...uncharged.filter((u) => u.charged_through === null || (dateText(u.charged_through) as string) <= (dateText(u.today) as string)).map((u) => ({
      kind: "DEPLOYED_WITHOUT_CURRENT_CHARGE", agreementId: String(u.id), number: String(u.rental_agreement_number),
      chargedThrough: dateText(u.charged_through), businessDate: dateText(u.today) })),
  ];
  const counts = Object.fromEntries(RENTAL_AVAILABILITY.map((a) => [a, by(a).length]));
  const deployedOrOut = fleet.filter((f) => ["ON_RENT", "RETURN_PENDING"].includes(f.availability)).length;
  return Object.freeze({
    counts: { ...counts, fleet: fleet.length, goingOut: goingOut.length, dueBack: dueBack.length, billingExceptions: billingExceptions.length },
    // Point-in-time utilization: units at a customer over the fleet (Analysis derives time-weighted utilization from the event log).
    utilization: { unitsOut: deployedOrOut, fleet: fleet.length },
    available: by("AVAILABLE"), reserved: by("RESERVED"),
    goingOut: goingOut.map((g) => ({ fleetUnitId: String(g.fleet_unit_id), workOrderId: String(g.work_order_id), workOrderNumber: String(g.work_order_number), status: String(g.status) })),
    onRent: by("ON_RENT"), serviceHold: by("SERVICE_HOLD"), returnPending: by("RETURN_PENDING"), inspection: by("INSPECTION"), unavailable: by("UNAVAILABLE"),
    dueBack, billingExceptions,
  });
}
