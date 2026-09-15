// COMMERCIAL C5 -- the ONE-TIME Commercial data migration: the SNAPSHOT format and the PURE source census.
//
// docs/architecture/commercial-c5-data-migration-plan.md is the plan. This module is the part of it that needs no
// database: it parses an exported snapshot of the legacy Firestore `opportunities`, `sales_agreements` and
// `sales_orders` documents, classifies EVERY stored field, canonicalizes each record into the eos_commercial row shape
// it would be copied as, and decides the source DISPOSITION (discard + reseed vs migrate). The PostgreSQL half --
// owner / accountable person / Account / catalog resolution, copy and verify -- is commercialC5Target.ts.
//
// ════════════════════ WHY A FILE ════════════════════
//
// The copy tool never loads a Firebase module. The Firestore read is a separate, read-only operator export step in
// functions/scripts (never imported by runtime code) that writes this file; census, copy and verify consume it. The
// exact bytes that were measured are a durable, hashable artifact rather than a moment in a live collection.
//
// ════════════════════ THE FORMAT (version 1) ════════════════════
//
//   { "format": "EOS_COMMERCIAL_SNAPSHOT", "version": 1,
//     "source": { "environmentId": "<registry id>", "firebaseProjectId": "<project>", "exportedAt": "<ISO>" },
//     "opportunities":   [ { "id": "<document id>", "data": { ...document fields } }, ... ],
//     "salesAgreements": [ ... ],
//     "salesOrders":     [ ... ] }
//
// A Firestore Timestamp is { "$timestamp": { "seconds": <int>, "nanoseconds": <int> } }; any other non-JSON value is
// { "$unsupported": "<type>" } and blocks the record. Any other top-level key is refused at parse.
//
// ════════════════════ WHAT "CANONICAL" MEANS HERE ════════════════════
//
// The row the governed C2 command layer would hold for the same business facts: the same vocabularies (the lifecycle
// modules are imported, not restated), the same line business-unit derivation (financialAttribution.ts), the same
// operating-company registry (commercialCompanyScope.ts). A value those authorities would refuse BLOCKS -- it is never
// repaired, defaulted or guessed. Every stored field is classified in FIELD_DISPOSITIONS below; an unclassified field
// blocks (UNCLASSIFIED_SOURCE_FIELD), so a shape this census has never seen cannot slip through silently.
//
// Mapping classes (the plan's §2): A canonical (copied) · B derived (recomputed, not copied) · C legacy defect/variant ·
// D2 deferred execution state (NOT migrated as authority; counted) · E Owner decision · P provenance (evidence only) ·
// F fixture marker. `acceptedByUid` is P for the row but is the KEY of the governed accepting-Principal resolution
// (commercialC5Target.ts): an ACCEPTED Agreement without one blocks (ACCEPTING_PRINCIPAL_UID_MISSING).
//
// ════════════════════ RESPONSIBILITY AXES ARE READ, NEVER COLLAPSED ════════════════════
//
// OWNER != ACCOUNTABLE != ASSIGNEE. The owner is read from `ownerEmployeeId`; the accountable person ONLY through the
// governed storage declaration (readStoredAccountablePerson) and never defaulted from the owner here -- whether a
// missing accountable person may be DERIVED from the owner is the creation rule's question, answered against the
// governed Employee authority in commercialC5Target.ts. A Firebase uid (`createdByUid`, `updatedByUid`,
// `acceptedByUid`) is NOT an EOS Principal id: it is carried only as provenance evidence.
import { createHash } from "node:crypto";
import { OPPORTUNITY_OUTCOMES, OPPORTUNITY_STAGES, SALES_CHANNELS, OPPORTUNITY_LINE_KINDS } from "../opportunity/opportunityLifecycle";
import { AGREEMENT_LINE_CONDITIONS, FULFILLMENT_INTENTS, SALES_AGREEMENT_STATES } from "../salesAgreement/salesAgreementLifecycle";
import { SALES_ORDER_STATES } from "../salesOrder/salesOrderLifecycle";
import { AttributionError, deriveLineBusinessUnit } from "../finance/financialAttribution";
import { resolveCommercialCompanyScope } from "../ownership/commercialCompanyScope";
import {
  ACCOUNTABILITY_EXCEPTION_FIELD,
  ACCOUNTABLE_PERSON_FIELD,
  ACCOUNTABLE_PERSON_SOURCE_FIELD,
  accountabilityRecordContext,
  readStoredAccountablePerson,
  type AccountabilityRecordContext,
  type AccountablePersonSource,
} from "../responsibility/accountablePersonStorage";
import { certificationExclusionReason } from "../catalogMaster/catalogSnapshot";

export const COMMERCIAL_SNAPSHOT_FORMAT = "EOS_COMMERCIAL_SNAPSHOT";
export const COMMERCIAL_SNAPSHOT_VERSION = 1;

/** The three families, in FK order. Snapshot key, Firestore collection, accountability family, number series. */
export const C5_FAMILIES = Object.freeze([
  Object.freeze({ family: "opportunity" as const, key: "opportunities" as const, collection: "opportunities", series: "OPPORTUNITY" as const, prefix: "OPP", numberField: "opportunityNumber" }),
  Object.freeze({ family: "salesAgreement" as const, key: "salesAgreements" as const, collection: "sales_agreements", series: "SALES_AGREEMENT" as const, prefix: "SA", numberField: "salesAgreementNumber" }),
  Object.freeze({ family: "salesOrder" as const, key: "salesOrders" as const, collection: "sales_orders", series: "SALES_ORDER" as const, prefix: "SO", numberField: "salesOrderNumber" }),
]);
export type C5Family = (typeof C5_FAMILIES)[number]["family"];
export type C5SnapshotKey = (typeof C5_FAMILIES)[number]["key"];
export type C5Series = (typeof C5_FAMILIES)[number]["series"];

/**
 * The governed accountability eligibility policy (Owner ruling 2026-09-14). RESTATED rather than imported because the
 * C2 command layer may be imported only by itself and the C4 transport (commercialCommandLayer.test.mjs); the offline
 * C5 test proves this object equals commercialCommandKernel.ts's, value for value.
 */
export const C5_ACCOUNTABILITY_ELIGIBILITY_V1 = Object.freeze({
  policyId: "COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1",
  eligibleStatuses: Object.freeze(["ACTIVE", "CONTRACTOR"] as const),
});

/** The FINANCIAL_REVIEW_P1 fixture marker (functions/scripts/financialReviewFixtures.mjs MARKER_FIELD), asserted by test. */
export const FINANCIAL_REVIEW_FIXTURE_MARKER = "financialReviewP1";

/**
 * Owner disposition rulings that cover a source environment. DATA, so the census can state which ruling it applied.
 *
 * D3 (2026-09-14): platform-sandbox Firestore Commercial data is disposable nonprod fixture data by default -- not
 * migrated, census preserved -- UNLESS a record looks valuable. The recorded census it was ruled against is the
 * ownership reconciliation's (docs/assessments/eos-ownership-model-reconciliation.md:281-292: 14 / 5 / 17). A snapshot
 * holding MORE records per family than that census is not covered (records created after the ruling), and any VALUE
 * SIGNAL on a record without fixture provenance stops the ruling from applying.
 */
export const OWNER_DISPOSITION_RULINGS = Object.freeze([
  Object.freeze({
    id: "D3",
    date: "2026-09-14",
    environmentId: "platform-sandbox",
    firebaseProjectId: "eos-platform-sandbox",
    disposition: "DISPOSABLE_NONPROD_FIXTURE" as const,
    recordedCensus: Object.freeze({ opportunities: 14, salesAgreements: 5, salesOrders: 17 }),
    evidence: "docs/assessments/eos-ownership-model-reconciliation.md:281-292",
  }),
]);

export const PRODUCTION_FIREBASE_PROJECT_ID = "taylor-parts";

export class CommercialSnapshotError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CommercialSnapshotError";
  }
}

export interface SnapshotDocument {
  readonly id: string;
  readonly data: Record<string, unknown>;
}

export interface CommercialSnapshot {
  readonly source: { readonly environmentId: string; readonly firebaseProjectId: string; readonly exportedAt: string };
  readonly opportunities: readonly SnapshotDocument[];
  readonly salesAgreements: readonly SnapshotDocument[];
  readonly salesOrders: readonly SnapshotDocument[];
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const asciiSort = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const TOP_LEVEL_KEYS = new Set(["format", "version", "source", "opportunities", "salesAgreements", "salesOrders"]);

/** Structural parse. Content problems are census findings, not parse errors. */
export function parseCommercialSnapshot(json: unknown): CommercialSnapshot {
  if (!isPlain(json) || json.format !== COMMERCIAL_SNAPSHOT_FORMAT || json.version !== COMMERCIAL_SNAPSHOT_VERSION) {
    throw new CommercialSnapshotError("SNAPSHOT_FORMAT_INVALID", `not an ${COMMERCIAL_SNAPSHOT_FORMAT} version ${COMMERCIAL_SNAPSHOT_VERSION} file`);
  }
  const extra = Object.keys(json).filter((k) => !TOP_LEVEL_KEYS.has(k));
  if (extra.length > 0) {
    throw new CommercialSnapshotError("SNAPSHOT_FORMAT_INVALID", `unexpected top-level keys ${extra.join(", ")}: only the three Commercial collections are allowlisted`);
  }
  const source = json.source;
  if (!isPlain(source) || typeof source.environmentId !== "string" || source.environmentId === ""
    || typeof source.firebaseProjectId !== "string" || source.firebaseProjectId === "" || typeof source.exportedAt !== "string") {
    throw new CommercialSnapshotError("SNAPSHOT_FORMAT_INVALID", "source.environmentId, source.firebaseProjectId and source.exportedAt are required");
  }
  const docs = (name: C5SnapshotKey): SnapshotDocument[] => {
    const list = json[name];
    if (!Array.isArray(list)) throw new CommercialSnapshotError("SNAPSHOT_FORMAT_INVALID", `${name} must be a list`);
    return list.map((d, i) => {
      if (!isPlain(d) || typeof d.id !== "string" || !isPlain(d.data)) {
        throw new CommercialSnapshotError("SNAPSHOT_FORMAT_INVALID", `${name}[${i}] must be { id, data }`);
      }
      return { id: d.id, data: d.data };
    });
  };
  return {
    source: { environmentId: source.environmentId, firebaseProjectId: source.firebaseProjectId, exportedAt: source.exportedAt },
    opportunities: docs("opportunities"),
    salesAgreements: docs("salesAgreements"),
    salesOrders: docs("salesOrders"),
  };
}

// ════════════════════ value readers ════════════════════

interface TimestampValue { seconds: number; nanoseconds: number }

function readTimestamp(v: unknown): TimestampValue | null {
  if (!isPlain(v) || Object.keys(v).length !== 1 || !isPlain(v.$timestamp) || Object.keys(v.$timestamp).length !== 2) return null;
  const { seconds, nanoseconds } = v.$timestamp;
  if (!Number.isSafeInteger(seconds) || !Number.isInteger(nanoseconds) || (nanoseconds as number) < 0 || (nanoseconds as number) > 999_999_999) return null;
  return { seconds: seconds as number, nanoseconds: nanoseconds as number };
}

/** A Firestore Timestamp as the canonical microsecond ISO string PostgreSQL stores. */
export function timestampIso(t: TimestampValue): string {
  const base = new Date(t.seconds * 1000).toISOString().slice(0, 19);
  return `${base}.${String(Math.floor(t.nanoseconds / 1000)).padStart(6, "0")}Z`;
}

/** Epoch milliseconds as the canonical microsecond ISO string. */
export function millisIso(ms: number): string {
  const d = new Date(ms);
  return `${d.toISOString().slice(0, 23)}000Z`;
}

const isMillis = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && !Number.isNaN(new Date(v).getTime());
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const usableId = (v: unknown): v is string => typeof v === "string" && v !== "" && v.trim() === v && !v.includes("/");
const minorUnits = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const posInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const containsUnsupported = (v: unknown): boolean =>
  Array.isArray(v) ? v.some(containsUnsupported) : isPlain(v) ? Object.prototype.hasOwnProperty.call(v, "$unsupported") || Object.values(v).some(containsUnsupported) : false;

// ════════════════════ numbers ════════════════════

export type NumberReading =
  | { readonly state: "VALID"; readonly series: C5Series; readonly year: number; readonly sequence: number }
  | { readonly state: "SENTINEL_YEAR"; readonly series: C5Series; readonly sequence: number }
  | { readonly state: "MISSING" }
  | { readonly state: "INVALID_FORMAT"; readonly detail: string };

/**
 * `<PREFIX>-<YYYY>-<######>` exactly as the C1 PostgreSQL allocator formats it (and the three Firestore allocators before it).
 * The `SO-0000-######` year is salesOrderNumberBackfill.ts's UNKNOWN_YEAR_SENTINEL: a legal stored number that names no
 * calendar year, preserved verbatim and never used to seed a counter (number_counters.year is 1970..9999).
 */
export function readBusinessNumber(family: C5Family, value: unknown): NumberReading {
  const spec = C5_FAMILIES.find((f) => f.family === family)!;
  if (value === undefined || value === null || value === "") return { state: "MISSING" };
  if (typeof value !== "string") return { state: "INVALID_FORMAT", detail: `not a string (${typeof value})` };
  const m = new RegExp(`^${spec.prefix}-([0-9]{4})-([0-9]{6,})$`).exec(value);
  if (!m) return { state: "INVALID_FORMAT", detail: `not ${spec.prefix}-YYYY-######` };
  const sequence = Number(m[2]);
  if (!Number.isSafeInteger(sequence) || sequence < 1 || String(sequence).padStart(6, "0") !== m[2]) {
    return { state: "INVALID_FORMAT", detail: "the sequence is not a positive zero-padded integer" };
  }
  if (m[1] === "0000") return { state: "SENTINEL_YEAR", series: spec.series, sequence };
  const year = Number(m[1]);
  if (year < 1970) return { state: "INVALID_FORMAT", detail: `year ${m[1]} is outside 1970..9999` };
  return { state: "VALID", series: spec.series, year, sequence };
}

// ════════════════════ field dispositions ════════════════════

export type FieldClass = "A" | "B" | "C" | "D2" | "E" | "P" | "F";

/** Every stored field of each family, classified. The plan's §2 tables are this, in prose. */
export const FIELD_DISPOSITIONS: Readonly<Record<C5Family, Readonly<Record<string, FieldClass>>>> = Object.freeze({
  opportunity: Object.freeze({
    opportunityNumber: "A", accountId: "A", ownerEmployeeId: "A", operatingCompanyId: "A", salesChannel: "A", stage: "A",
    outcome: "A", closedAt: "A", need: "A", expectedValue: "A", expectedCloseAt: "A", nextAction: "A", creditedSalespersonId: "A",
    lines: "A", createdAt: "A", updatedAt: "A", [ACCOUNTABLE_PERSON_FIELD]: "A", [ACCOUNTABLE_PERSON_SOURCE_FIELD]: "A",
    // the Firestore optimistic-concurrency token (epoch ms); PostgreSQL starts its own edit_version at 1
    updatedAtMillis: "B",
    // forward links; PostgreSQL derives them from sales_agreements.opportunity_id / sales_orders.opportunity_id
    salesAgreementId: "B", salesOrderId: "B",
    closedAtMillis: "C", createdAtMillis: "C",
    createdByUid: "P", updatedByUid: "P",
    // Owner ruling (C5 closeout): legacy EVIDENCE only -- no column, not mapped to need or anything else, never blocks
    name: "P",
    [ACCOUNTABILITY_EXCEPTION_FIELD]: "E",
    certificationWorld: "F", dataProvenance: "F", [FINANCIAL_REVIEW_FIXTURE_MARKER]: "F",
  }),
  salesAgreement: Object.freeze({
    salesAgreementNumber: "A", accountId: "A", ownerEmployeeId: "A", operatingCompanyId: "A", creditedSalespersonId: "A",
    locationId: "A", sourceOpportunityId: "A", customerPO: "A", isLease: "A", fulfillmentIntent: "A", shippingInstructions: "A",
    shipVia: "A", specialInstructions: "A", currency: "A", state: "A", lines: "A", acceptedAtMillis: "A", createdAt: "A",
    updatedAt: "A", [ACCOUNTABLE_PERSON_FIELD]: "A", [ACCOUNTABLE_PERSON_SOURCE_FIELD]: "A",
    // the charges inside are A; subtotal / total / balance are recomputed arithmetic (B)
    totals: "A",
    salesOrderId: "B",
    createdAtMillis: "C", updatedAtMillis: "C",
    createdByUid: "P", updatedByUid: "P", acceptedByUid: "P",
    [ACCOUNTABILITY_EXCEPTION_FIELD]: "E",
    certificationWorld: "F", dataProvenance: "F", [FINANCIAL_REVIEW_FIXTURE_MARKER]: "F",
  }),
  salesOrder: Object.freeze({
    salesOrderNumber: "A", accountId: "A", ownerEmployeeId: "A", operatingCompanyId: "A", creditedSalespersonId: "A",
    salesChannel: "A", currency: "A", bookedAtMillis: "A", locationId: "A", sourceOpportunityId: "A", sourceAgreementId: "A",
    customerPO: "A", notes: "A", state: "A", lines: "A", createdAt: "A", updatedAt: "A",
    [ACCOUNTABLE_PERSON_FIELD]: "A", [ACCOUNTABLE_PERSON_SOURCE_FIELD]: "A",
    // a denormalized echo of the source Opportunity's number (checked, not copied)
    sourceOpportunityNumber: "B",
    createdAtMillis: "C", updatedAtMillis: "C",
    // D2 (DEFERRED): allocation / fulfillment / service Work Order execution state is NOT migrated as authority
    fulfillmentReadiness: "D2", fulfillmentReadinessCounts: "D2", allocatedAt: "D2", serviceWorkOrderIds: "D2",
    createdByUid: "P", updatedByUid: "P",
    [ACCOUNTABILITY_EXCEPTION_FIELD]: "E",
    certificationWorld: "F", dataProvenance: "F", [FINANCIAL_REVIEW_FIXTURE_MARKER]: "F",
  }),
});

export const LINE_FIELD_DISPOSITIONS: Readonly<Record<C5Family, Readonly<Record<string, FieldClass>>>> = Object.freeze({
  opportunity: Object.freeze({ kind: "A", ref: "A", qty: "A" }),
  salesAgreement: Object.freeze({
    lineId: "B", kind: "A", ref: "A", businessUnitId: "A", quantity: "A", unitPrice: "A", condition: "A", warranty: "A",
    estimatedArrivalMillis: "A", extendedMinor: "B",
  }),
  salesOrder: Object.freeze({
    lineId: "B", kind: "A", ref: "A", businessUnitId: "A", orderedQty: "A", unitPrice: "A",
    allocatedQty: "D2", fulfilledQty: "D2", billedQty: "D2",
  }),
});

const D2_LINE_QUANTITIES = ["allocatedQty", "fulfilledQty", "billedQty"] as const;

// ════════════════════ canonical rows ════════════════════

export interface OpportunityLine { readonly lineNumber: number; readonly kind: string; readonly ref: string; readonly qty: number }
export interface AgreementLine {
  readonly lineNumber: number; readonly kind: string; readonly ref: string; readonly businessUnit: string; readonly quantity: number;
  readonly unitPriceMinor: number | null; readonly condition: string | null; readonly warranty: string | null; readonly estimatedArrivalAt: string | null;
}
export interface OrderLine {
  readonly lineNumber: number; readonly kind: string; readonly ref: string; readonly businessUnit: string; readonly orderedQty: number;
  readonly unitPriceMinor: number | null;
}

interface CanonicalBase {
  readonly id: string;
  readonly number: string;
  readonly accountId: string;
  readonly ownerEmployeeId: string;
  readonly operatingCompanyKey: string | null;
  readonly creditedSalespersonEmployeeId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface CanonicalOpportunity extends CanonicalBase {
  readonly salesChannel: string; readonly stage: string; readonly outcome: string | null; readonly closedAt: string | null;
  readonly need: string | null; readonly expectedValue: number | null; readonly expectedCloseAt: string | null; readonly nextAction: string | null;
  readonly lines: readonly OpportunityLine[];
}
export interface CanonicalSalesAgreement extends CanonicalBase {
  readonly opportunityId: string | null; readonly state: string; readonly currency: string | null; readonly locationId: string | null;
  readonly customerPo: string | null; readonly isLease: boolean | null; readonly fulfillmentIntent: string | null;
  readonly shippingInstructions: string | null; readonly shipVia: string | null; readonly specialInstructions: string | null;
  readonly shippingMinor: number | null; readonly installChargeMinor: number | null; readonly taxMinor: number | null;
  readonly downPaymentMinor: number | null; readonly tradeInMinor: number | null; readonly acceptedAt: string | null;
  readonly lines: readonly AgreementLine[];
}
export interface CanonicalSalesOrder extends CanonicalBase {
  readonly opportunityId: string | null; readonly salesAgreementId: string | null; readonly state: string; readonly salesChannel: string;
  readonly currency: string | null; readonly bookedAt: string | null; readonly locationId: string | null; readonly customerPo: string | null;
  readonly notes: string | null; readonly lines: readonly OrderLine[];
}

/** The recorded (or absent) accountable person of one source record, and the record's lifecycle context. */
export interface SourceAccountability {
  readonly family: C5Family;
  readonly id: string;
  readonly context: AccountabilityRecordContext;
  readonly state: "PRESENT" | "ABSENT";
  readonly accountableEmployeeId: string | null;
  readonly recordedSource: AccountablePersonSource | null;
}

export interface C5Finding { readonly family: C5Family; readonly id: string; readonly code: string; readonly detail?: string }

export interface CanonicalCommercial {
  readonly opportunities: readonly CanonicalOpportunity[];
  readonly salesAgreements: readonly CanonicalSalesAgreement[];
  readonly salesOrders: readonly CanonicalSalesOrder[];
  readonly accountability: readonly SourceAccountability[];
}

// ════════════════════ canonicalization ════════════════════

type Result<T> = { ok: true; record: T; accountability: SourceAccountability; evidence: C5Finding[] } | { ok: false; findings: C5Finding[]; evidence: C5Finding[] };

class Collector {
  readonly findings: C5Finding[] = [];
  /** Advisory legacy evidence (never blocks). */
  readonly evidence: C5Finding[] = [];
  constructor(readonly family: C5Family, readonly id: string) {}
  add(code: string, detail?: string): null { this.findings.push({ family: this.family, id: this.id, code, ...(detail === undefined ? {} : { detail }) }); return null; }
}

function optionalText(c: Collector, data: Record<string, unknown>, field: string): string | null {
  const v = data[field];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return c.add("FIELD_TYPE_INVALID", `${field} is ${typeof v}`);
  return v.trim() === "" ? null : v.trim();
}

function requiredEmployeeId(c: Collector, data: Record<string, unknown>, field: string, code: string): string | null {
  const v = data[field];
  if (!usableId(v)) return c.add(code, `${field} is not a usable Employee id`);
  return v;
}

function optionalEmployeeId(c: Collector, data: Record<string, unknown>, field: string): string | null {
  const v = data[field];
  if (v === undefined || v === null) return null;
  if (!usableId(v)) return c.add("CREDITED_SALESPERSON_INVALID", `${field} is not a usable Employee id`);
  return v;
}

function operatingCompany(c: Collector, data: Record<string, unknown>): string | null {
  const v = data.operatingCompanyId;
  if (v === undefined || v === null) return null;
  try {
    return resolveCommercialCompanyScope(v);
  } catch {
    return c.add("OPERATING_COMPANY_INVALID", `operatingCompanyId ${JSON.stringify(v)} is not a governed operating company`);
  }
}

function stamps(c: Collector, data: Record<string, unknown>): { createdAt: string; updatedAt: string } | null {
  const created = readTimestamp(data.createdAt);
  let createdAt: string | null = created ? timestampIso(created) : null;
  if (createdAt === null && data.createdAt !== undefined && data.createdAt !== null) return c.add("CREATED_AT_INVALID", "createdAt is not a Timestamp");
  if (createdAt === null && isMillis(data.createdAtMillis)) createdAt = millisIso(data.createdAtMillis);
  if (createdAt === null) return c.add("CREATED_AT_MISSING", "neither createdAt nor createdAtMillis; a creation time is never fabricated");
  const updated = readTimestamp(data.updatedAt);
  if (updated === null && data.updatedAt !== undefined && data.updatedAt !== null) return c.add("UPDATED_AT_INVALID", "updatedAt is not a Timestamp");
  const updatedAt = updated ? timestampIso(updated) : isMillis(data.updatedAtMillis) ? millisIso(data.updatedAtMillis) : createdAt;
  return { createdAt, updatedAt };
}

function number(c: Collector, family: C5Family, data: Record<string, unknown>): string | null {
  const spec = C5_FAMILIES.find((f) => f.family === family)!;
  const reading = readBusinessNumber(family, data[spec.numberField]);
  if (reading.state === "MISSING") return c.add("NUMBER_MISSING", `${spec.numberField} is absent (run the governed number backfill at the source; a number is never minted by the migration)`);
  if (reading.state === "INVALID_FORMAT") return c.add("NUMBER_FORMAT_INVALID", `${spec.numberField} ${JSON.stringify(data[spec.numberField])}: ${reading.detail}`);
  return data[spec.numberField] as string;
}

function accountabilityOf(c: Collector, family: C5Family, data: Record<string, unknown>): SourceAccountability | null {
  const stored = readStoredAccountablePerson(data);
  if (data[ACCOUNTABILITY_EXCEPTION_FIELD] !== undefined) {
    c.add("ACCOUNTABILITY_EXCEPTION_NO_TARGET", "an accountability exception is recorded; no governed exception writer or column exists (Owner decision)");
  }
  if (stored.state === "UNREADABLE") return c.add("ACCOUNTABLE_PERSON_UNREADABLE", stored.detail ?? undefined);
  if (data[ACCOUNTABLE_PERSON_SOURCE_FIELD] !== undefined && stored.source === null) {
    return c.add("ACCOUNTABLE_PERSON_SOURCE_INVALID", "the stored accountable-person source is not a governed source");
  }
  if (stored.state === "PRESENT" && stored.source === null) {
    return c.add("ACCOUNTABLE_PERSON_SOURCE_UNRECORDED", "an accountable person without its recorded source; the source is never inferred");
  }
  if (stored.state === "ABSENT" && stored.source !== null) {
    return c.add("ACCOUNTABLE_PERSON_SOURCE_WITHOUT_PERSON", "a recorded source with no accountable person");
  }
  return {
    family, id: c.id, context: accountabilityRecordContext(family, data), state: stored.state,
    accountableEmployeeId: stored.accountableEmployeeId, recordedSource: stored.source,
  };
}

function classifyFields(c: Collector, family: C5Family, data: Record<string, unknown>): void {
  for (const [field, value] of Object.entries(data)) {
    const cls = FIELD_DISPOSITIONS[family][field];
    if (cls === undefined) c.add("UNCLASSIFIED_SOURCE_FIELD", field);
    else if (cls === "E" && field !== ACCOUNTABILITY_EXCEPTION_FIELD) c.add("FIELD_REQUIRES_OWNER_DECISION", `${field} has no eos_commercial target`);
    if (containsUnsupported(value)) c.add("UNSUPPORTED_VALUE", field);
  }
}

function linesOf(c: Collector, family: C5Family, data: Record<string, unknown>, requireNonEmpty: boolean): Record<string, unknown>[] | null {
  const lines = data.lines;
  if (lines === undefined || lines === null) return requireNonEmpty ? c.add("NO_LINES") : [];
  if (!Array.isArray(lines) || !lines.every(isPlain)) return c.add("LINES_INVALID", "lines is not a list of maps");
  if (requireNonEmpty && lines.length === 0) return c.add("NO_LINES");
  lines.forEach((l, i) => {
    for (const k of Object.keys(l)) if (LINE_FIELD_DISPOSITIONS[family][k] === undefined) c.add("UNCLASSIFIED_LINE_FIELD", `lines[${i}].${k}`);
    if ("serial" in l || "serialNumber" in l || "serializedAssetId" in l || "equipmentId" in l) c.add("SERIALIZED_LINE_FORBIDDEN", `lines[${i}]`);
    if (!(OPPORTUNITY_LINE_KINDS as readonly string[]).includes(l.kind as string)) c.add("LINE_KIND_INVALID", `lines[${i}].kind`);
    if (typeof l.ref !== "string" || l.ref === "" || l.ref.trim() !== l.ref) c.add("LINE_REF_INVALID", `lines[${i}].ref must be a non-blank, trimmed product reference`);
    if (family !== "opportunity" && l.lineId !== undefined && l.lineId !== `line-${i + 1}`) {
      c.add("LINE_ID_NOT_POSITIONAL", `lines[${i}].lineId ${JSON.stringify(l.lineId)} is not line-${i + 1}; downstream line references would break`);
    }
  });
  return lines as Record<string, unknown>[];
}

function businessUnit(c: Collector, l: Record<string, unknown>, i: number): string | null {
  try {
    return deriveLineBusinessUnit(l.kind as "EQUIPMENT_MODEL" | "PART" | "SERVICE", (l.businessUnitId ?? null) as string | null);
  } catch (err) {
    return c.add("BUSINESS_UNIT_UNRESOLVABLE", `lines[${i}]: ${err instanceof AttributionError ? err.code : "invalid"}`);
  }
}

function finish<T>(c: Collector, record: T | null, accountability: SourceAccountability | null): Result<T> {
  if (c.findings.length > 0 || record === null || accountability === null) return { ok: false, findings: c.findings, evidence: c.evidence };
  return { ok: true, record, accountability, evidence: c.evidence };
}

export function canonicalizeOpportunity(doc: SnapshotDocument): Result<CanonicalOpportunity> {
  const c = new Collector("opportunity", doc.id);
  const d = doc.data;
  classifyFields(c, "opportunity", d);
  if (!usableId(doc.id)) c.add("ID_INVALID");
  const num = number(c, "opportunity", d);
  const accountId = requiredEmployeeId(c, d, "accountId", "ACCOUNT_ID_INVALID");
  const owner = requiredEmployeeId(c, d, "ownerEmployeeId", "OWNER_MISSING");
  const credited = optionalEmployeeId(c, d, "creditedSalespersonId");
  const company = operatingCompany(c, d);
  if (!(SALES_CHANNELS as readonly string[]).includes(d.salesChannel as string)) c.add("SALES_CHANNEL_INVALID", String(d.salesChannel));
  if (!(OPPORTUNITY_STAGES as readonly string[]).includes(d.stage as string)) c.add("STAGE_INVALID", `stage ${JSON.stringify(d.stage)}; a record without a governed lifecycle is never given one`);
  const outcome = d.outcome === undefined || d.outcome === null ? null : d.outcome;
  if (outcome !== null && !(OPPORTUNITY_OUTCOMES as readonly string[]).includes(outcome as string)) c.add("OUTCOME_INVALID", String(outcome));
  const closedTs = readTimestamp(d.closedAt);
  const closedAt = closedTs ? timestampIso(closedTs) : isMillis(d.closedAtMillis) ? millisIso(d.closedAtMillis) : null;
  if (outcome !== null && closedAt === null) c.add("CLOSED_AT_MISSING", "a decided Opportunity without a close time");
  if (outcome === null && closedAt !== null) c.add("CLOSED_AT_WITHOUT_OUTCOME");
  let expectedValue: number | null = null;
  if (d.expectedValue !== undefined && d.expectedValue !== null) {
    if (typeof d.expectedValue !== "number" || !Number.isFinite(d.expectedValue)) c.add("EXPECTED_VALUE_INVALID");
    else expectedValue = d.expectedValue;
  }
  let expectedCloseAt: string | null = null;
  if (d.expectedCloseAt !== undefined && d.expectedCloseAt !== null) {
    if (!isMillis(d.expectedCloseAt)) c.add("EXPECTED_CLOSE_AT_INVALID");
    else expectedCloseAt = millisIso(d.expectedCloseAt);
  }
  const t = stamps(c, d);
  const rawLines = linesOf(c, "opportunity", d, false) ?? [];
  const lines: OpportunityLine[] = rawLines.map((l, i) => {
    if (!posInt(l.qty)) c.add("LINE_QTY_INVALID", `lines[${i}].qty`);
    return { lineNumber: i + 1, kind: String(l.kind), ref: String(l.ref), qty: l.qty as number };
  });
  if (outcome === "WON" && lines.length === 0) c.add("NO_LINES", "a WON Opportunity without lines");
  const accountability = accountabilityOf(c, "opportunity", d);
  if (d.name !== undefined && d.name !== null) c.evidence.push({ family: "opportunity", id: doc.id, code: "OPPORTUNITY_NAME_LEGACY_EVIDENCE_NOT_MIGRATED", detail: typeof d.name === "string" ? d.name.slice(0, 200) : typeof d.name });
  const record = num && accountId && owner && t ? {
    id: doc.id, number: num, accountId, ownerEmployeeId: owner, operatingCompanyKey: company, creditedSalespersonEmployeeId: credited,
    salesChannel: String(d.salesChannel), stage: String(d.stage), outcome: outcome as string | null, closedAt,
    need: optionalText(c, d, "need"), expectedValue, expectedCloseAt, nextAction: optionalText(c, d, "nextAction"),
    createdAt: t.createdAt, updatedAt: t.updatedAt, lines,
  } : null;
  return finish(c, record, accountability);
}

export function canonicalizeSalesAgreement(doc: SnapshotDocument): Result<CanonicalSalesAgreement> {
  const c = new Collector("salesAgreement", doc.id);
  const d = doc.data;
  classifyFields(c, "salesAgreement", d);
  if (!usableId(doc.id)) c.add("ID_INVALID");
  const num = number(c, "salesAgreement", d);
  const accountId = requiredEmployeeId(c, d, "accountId", "ACCOUNT_ID_INVALID");
  const owner = requiredEmployeeId(c, d, "ownerEmployeeId", "OWNER_MISSING");
  const credited = optionalEmployeeId(c, d, "creditedSalespersonId");
  const company = operatingCompany(c, d);
  const state = d.state;
  if (!(SALES_AGREEMENT_STATES as readonly string[]).includes(state as string)) c.add("STATE_INVALID", `state ${JSON.stringify(state)}`);
  const currency = d.currency === undefined || d.currency === null ? null : d.currency;
  if (currency !== null && currency !== "USD") c.add("CURRENCY_INVALID", String(currency));
  const opportunityId = d.sourceOpportunityId === undefined || d.sourceOpportunityId === null ? null : d.sourceOpportunityId;
  if (opportunityId !== null && !usableId(opportunityId)) c.add("LINEAGE_ID_INVALID", "sourceOpportunityId");
  if (d.isLease !== undefined && d.isLease !== null && typeof d.isLease !== "boolean") c.add("IS_LEASE_INVALID");
  const intent = d.fulfillmentIntent === undefined || d.fulfillmentIntent === null ? null : d.fulfillmentIntent;
  if (intent !== null && !(FULFILLMENT_INTENTS as readonly string[]).includes(intent as string)) c.add("FULFILLMENT_INTENT_INVALID");
  const totals = d.totals === undefined || d.totals === null ? {} : d.totals;
  if (!isPlain(totals)) c.add("TOTALS_INVALID");
  const charge = (k: string): number | null => {
    const v = isPlain(totals) ? totals[k] : undefined;
    if (v === undefined || v === null) return null;
    if (!minorUnits(v)) return c.add("MONEY_INVALID", `totals.${k}`);
    return v;
  };
  const acceptedAt = isMillis(d.acceptedAtMillis) ? millisIso(d.acceptedAtMillis) : null;
  if (d.acceptedAtMillis !== undefined && d.acceptedAtMillis !== null && acceptedAt === null) c.add("ACCEPTED_AT_INVALID");
  if (state === "ACCEPTED" && acceptedAt === null) c.add("ACCEPTED_AT_MISSING", "an ACCEPTED agreement without its acceptance time");
  if (state === "ACCEPTED" && !nonEmpty(d.acceptedByUid)) {
    c.add("ACCEPTING_PRINCIPAL_UID_MISSING", "an ACCEPTED agreement without acceptedByUid: the historical accepter cannot be resolved to an EOS Principal, and is never substituted or inferred");
  }
  if (state !== "ACCEPTED" && acceptedAt !== null) c.add("ACCEPTED_AT_WITHOUT_ACCEPTANCE");
  const t = stamps(c, d);
  const rawLines = linesOf(c, "salesAgreement", d, true) ?? [];
  const lines: AgreementLine[] = rawLines.map((l, i) => {
    if (!posInt(l.quantity)) c.add("LINE_QTY_INVALID", `lines[${i}].quantity`);
    if (l.unitPrice !== undefined && l.unitPrice !== null && !minorUnits(l.unitPrice)) c.add("MONEY_INVALID", `lines[${i}].unitPrice`);
    if (state === "ACCEPTED" && (l.unitPrice === undefined || l.unitPrice === null)) c.add("UNPRICED_ACCEPTED_LINE", `lines[${i}]`);
    const condition = l.condition === undefined || l.condition === null || l.condition === "" ? null : l.condition;
    if (condition !== null && !(AGREEMENT_LINE_CONDITIONS as readonly string[]).includes(condition as string)) c.add("LINE_CONDITION_INVALID", `lines[${i}]`);
    let eta: string | null = null;
    if (l.estimatedArrivalMillis !== undefined && l.estimatedArrivalMillis !== null) {
      if (!isMillis(l.estimatedArrivalMillis)) c.add("LINE_ETA_INVALID", `lines[${i}]`);
      else eta = millisIso(l.estimatedArrivalMillis);
    }
    const warranty = typeof l.warranty === "string" && l.warranty.trim() !== "" ? l.warranty.trim() : null;
    return {
      lineNumber: i + 1, kind: String(l.kind), ref: String(l.ref), businessUnit: businessUnit(c, l, i) ?? "", quantity: l.quantity as number,
      unitPriceMinor: minorUnits(l.unitPrice) ? l.unitPrice : null, condition: condition as string | null, warranty, estimatedArrivalAt: eta,
    };
  });
  const accountability = accountabilityOf(c, "salesAgreement", d);
  const record = num && accountId && owner && t ? {
    id: doc.id, number: num, accountId, ownerEmployeeId: owner, operatingCompanyKey: company, creditedSalespersonEmployeeId: credited,
    opportunityId: opportunityId as string | null, state: String(state), currency: currency as string | null,
    locationId: optionalText(c, d, "locationId"), customerPo: optionalText(c, d, "customerPO"),
    isLease: typeof d.isLease === "boolean" ? d.isLease : null, fulfillmentIntent: intent as string | null,
    shippingInstructions: optionalText(c, d, "shippingInstructions"), shipVia: optionalText(c, d, "shipVia"),
    specialInstructions: optionalText(c, d, "specialInstructions"),
    shippingMinor: charge("shippingMinor"), installChargeMinor: charge("installChargeMinor"), taxMinor: charge("taxMinor"),
    downPaymentMinor: charge("downPaymentMinor"), tradeInMinor: charge("tradeInMinor"), acceptedAt,
    createdAt: t.createdAt, updatedAt: t.updatedAt, lines,
  } : null;
  return finish(c, record, accountability);
}

export function canonicalizeSalesOrder(doc: SnapshotDocument): Result<CanonicalSalesOrder> {
  const c = new Collector("salesOrder", doc.id);
  const d = doc.data;
  classifyFields(c, "salesOrder", d);
  if (!usableId(doc.id)) c.add("ID_INVALID");
  const num = number(c, "salesOrder", d);
  const accountId = requiredEmployeeId(c, d, "accountId", "ACCOUNT_ID_INVALID");
  const owner = requiredEmployeeId(c, d, "ownerEmployeeId", "OWNER_MISSING");
  const credited = optionalEmployeeId(c, d, "creditedSalespersonId");
  const company = operatingCompany(c, d);
  if (company === null && !c.findings.some((f) => f.code === "OPERATING_COMPANY_INVALID")) {
    c.add("COMPANY_REQUIRED", "a Sales Order row requires operating_company_key; it is never inferred or defaulted");
  }
  const state = d.state;
  if (!(SALES_ORDER_STATES as readonly string[]).includes(state as string)) c.add("STATE_INVALID", `state ${JSON.stringify(state)}`);
  if (!(SALES_CHANNELS as readonly string[]).includes(d.salesChannel as string)) c.add("SALES_CHANNEL_INVALID", String(d.salesChannel));
  const currency = d.currency === undefined || d.currency === null ? null : d.currency;
  if (currency !== null && currency !== "USD") c.add("CURRENCY_INVALID", String(currency));
  const link = (field: string): string | null => {
    const v = d[field];
    if (v === undefined || v === null) return null;
    if (!usableId(v)) return c.add("LINEAGE_ID_INVALID", field);
    return v;
  };
  const opportunityId = link("sourceOpportunityId");
  const salesAgreementId = link("sourceAgreementId");
  let bookedAt: string | null = null;
  if (d.bookedAtMillis !== undefined && d.bookedAtMillis !== null) {
    if (!isMillis(d.bookedAtMillis)) c.add("BOOKED_AT_INVALID");
    else bookedAt = millisIso(d.bookedAtMillis);
  }
  const t = stamps(c, d);
  const rawLines = linesOf(c, "salesOrder", d, true) ?? [];
  const lines: OrderLine[] = rawLines.map((l, i) => {
    if (!posInt(l.orderedQty)) c.add("LINE_QTY_INVALID", `lines[${i}].orderedQty`);
    if (l.unitPrice !== undefined && l.unitPrice !== null && !minorUnits(l.unitPrice)) c.add("MONEY_INVALID", `lines[${i}].unitPrice`);
    return {
      lineNumber: i + 1, kind: String(l.kind), ref: String(l.ref), businessUnit: businessUnit(c, l, i) ?? "", orderedQty: l.orderedQty as number,
      unitPriceMinor: minorUnits(l.unitPrice) ? l.unitPrice : null,
    };
  });
  const accountability = accountabilityOf(c, "salesOrder", d);
  const record = num && accountId && owner && t ? {
    id: doc.id, number: num, accountId, ownerEmployeeId: owner, operatingCompanyKey: company, creditedSalespersonEmployeeId: credited,
    opportunityId, salesAgreementId, state: String(state), salesChannel: String(d.salesChannel), currency: currency as string | null, bookedAt,
    locationId: optionalText(c, d, "locationId"), customerPo: optionalText(c, d, "customerPO"), notes: optionalText(c, d, "notes"),
    createdAt: t.createdAt, updatedAt: t.updatedAt, lines,
  } : null;
  return finish(c, record, accountability);
}

// ════════════════════ the source census ════════════════════

export type C5Disposition = "DISPOSABLE_FIXTURE_ONLY" | "MIGRATION_REQUIRED_OR_OWNER_REVIEW" | "STOP_FOR_OWNER_DECISION" | "NO_SOURCE_RECORDS";

export interface DispositionDecision {
  readonly disposition: C5Disposition;
  /** Why, in the plan's §4 vocabulary. */
  readonly basis: string;
  readonly ownerRulingApplied: string | null;
  /** Records without fixture provenance (the ones a DISPOSABLE decision would discard on an Owner ruling, not on markers). */
  readonly recordsWithoutFixtureProvenance: readonly { family: C5Family; id: string }[];
  /** Downstream-business evidence on a record without fixture provenance. Any one stops an Owner "disposable" ruling. */
  readonly valueSignals: readonly C5Finding[];
  /** What the operator does next. */
  readonly path: string;
}

export interface LegacyActorProvenance {
  readonly family: C5Family;
  readonly id: string;
  readonly createdByUid: string | null;
  readonly updatedByUid: string | null;
  readonly acceptedByUid: string | null;
}

export interface NumberSeriesYear { readonly series: C5Series; readonly year: number; readonly count: number; readonly maxSequence: number; readonly numbers: readonly string[] }

/**
 * The SOURCE-VISIBLE high-water per series/year (Owner ruling, C5 closeout): the highest VALID business number in the
 * COMPLETE frozen snapshot -- migrated records AND records excluded from migration (Certification fixtures, other
 * fixtures, records blocked by a finding) -- so PostgreSQL never re-issues a number a person has seen. Invalid numbers
 * and the SO-0000 sentinel year never contribute.
 */
export interface SourceVisibleHighWater {
  readonly series: C5Series; readonly year: number; readonly maxSequence: number; readonly number: string;
  readonly fromFamilyId: { readonly family: C5Family; readonly id: string };
  readonly includesExcludedRecords: boolean;
}

export function sourceVisibleHighWater(snapshot: CommercialSnapshot, migratedIds: ReadonlySet<string>): SourceVisibleHighWater[] {
  const best = new Map<string, SourceVisibleHighWater>();
  for (const f of C5_FAMILIES) {
    for (const d of snapshot[f.key]) {
      const value = d.data[f.numberField];
      const reading = readBusinessNumber(f.family, value);
      if (reading.state !== "VALID") continue;
      const key = `${reading.series}|${reading.year}`;
      const cur = best.get(key);
      const excluded = !migratedIds.has(`${f.family}|${d.id}`);
      if (!cur || reading.sequence > cur.maxSequence) {
        best.set(key, { series: reading.series, year: reading.year, maxSequence: reading.sequence, number: value as string, fromFamilyId: { family: f.family, id: d.id }, includesExcludedRecords: excluded || (cur?.includesExcludedRecords ?? false) });
      } else if (excluded) {
        best.set(key, { ...cur, includesExcludedRecords: true });
      }
    }
  }
  return [...best.values()].sort((a, b) => asciiSort(`${a.series}|${a.year}`, `${b.series}|${b.year}`));
}

export interface CommercialSourceCensus {
  readonly source: CommercialSnapshot["source"];
  readonly counts: { readonly opportunities: number; readonly salesAgreements: number; readonly salesOrders: number };
  readonly ids: { readonly opportunities: readonly string[]; readonly salesAgreements: readonly string[]; readonly salesOrders: readonly string[] };
  readonly certificationExcluded: {
    readonly counts: { readonly opportunities: number; readonly salesAgreements: number; readonly salesOrders: number };
    readonly records: readonly C5Finding[];
  };
  readonly fixtureProvenance: readonly C5Finding[];
  readonly selected: { readonly opportunities: readonly string[]; readonly salesAgreements: readonly string[]; readonly salesOrders: readonly string[] };
  readonly findings: readonly C5Finding[];
  readonly advisories: readonly C5Finding[];
  readonly numbers: {
    readonly bySeriesYear: readonly NumberSeriesYear[];
    readonly sourceVisibleHighWater: readonly SourceVisibleHighWater[];
    readonly sentinelYear: readonly { family: C5Family; id: string; number: string }[];
    readonly duplicates: readonly { series: C5Series; number: string; ids: string[] }[];
  };
  readonly d2Excluded: {
    readonly fieldPresence: Record<string, number>;
    readonly recordsWithExecutionQuantities: readonly C5Finding[];
  };
  readonly lifecycle: { readonly opportunities: Record<string, number>; readonly salesAgreements: Record<string, number>; readonly salesOrders: Record<string, number> };
  readonly references: {
    readonly employeeIds: readonly string[];
    readonly accountIds: readonly string[];
    readonly locationIds: readonly string[];
    readonly catalog: readonly { kind: "PART" | "EQUIPMENT_MODEL"; ref: string }[];
  };
  readonly disposition: DispositionDecision;
  readonly blockers: readonly string[];
  readonly canonicalDigest: string;
}

const countInto = (bag: Record<string, number>, key: string) => { bag[key] = (bag[key] ?? 0) + 1; };
const sortedBag = (bag: Record<string, number>) => Object.fromEntries(Object.entries(bag).sort(([a], [b]) => asciiSort(a, b)));
const findingSort = (a: C5Finding, b: C5Finding) => asciiSort(`${a.family}|${a.id}|${a.code}|${a.detail ?? ""}`, `${b.family}|${b.id}|${b.code}|${b.detail ?? ""}`);

/** Fixture provenance of a NON-certification record, or null. Markers only -- never guessed from an id or a name. */
export function fixtureProvenanceOf(data: Record<string, unknown>): string | null {
  if (Object.prototype.hasOwnProperty.call(data, FINANCIAL_REVIEW_FIXTURE_MARKER)) return `FIXTURE:${FINANCIAL_REVIEW_FIXTURE_MARKER}-marker`;
  return null;
}

/** Downstream business evidence on a source document -- the plan's §4.2 "looks valuable" list, exactly. */
export function valueSignalsOf(family: C5Family, doc: SnapshotDocument): C5Finding[] {
  if (family !== "salesOrder") return [];
  const out: C5Finding[] = [];
  const d = doc.data;
  const lines = Array.isArray(d.lines) ? d.lines.filter(isPlain) : [];
  for (const q of ["billedQty", "fulfilledQty"] as const) {
    if (lines.some((l) => typeof l[q] === "number" && (l[q] as number) > 0)) out.push({ family, id: doc.id, code: `VALUE_SIGNAL:${q}>0` });
  }
  if (Array.isArray(d.serviceWorkOrderIds) && d.serviceWorkOrderIds.length > 0) out.push({ family, id: doc.id, code: "VALUE_SIGNAL:serviceWorkOrderIds" });
  if (d.state === "CLOSED") out.push({ family, id: doc.id, code: "VALUE_SIGNAL:state=CLOSED" });
  return out;
}

/**
 * THE DISPOSITION DECISION (plan §4). Pure, and ordered:
 *
 *   1. PRODUCTION source (`taylor-parts`), with ANY count including zero   -> STOP_FOR_OWNER_DECISION. Production is never
 *      declared empty or disposable by a tool.
 *   2. No record at all (nonprod)                                          -> NO_SOURCE_RECORDS.
 *   3. Every record is an identified Certification fixture or carries a fixture marker -> DISPOSABLE_FIXTURE_ONLY
 *      (basis ALL_RECORDS_FIXTURE_PROVENANCE).
 *   4. An Owner ruling covers this environment, the snapshot holds no more records per family than the ruling's recorded
 *      census, and no record without fixture provenance carries a VALUE SIGNAL -> DISPOSABLE_FIXTURE_ONLY (basis
 *      OWNER_RULING_<id>).
 *   5. Otherwise                                                           -> MIGRATION_REQUIRED_OR_OWNER_REVIEW.
 *
 * DISPOSABLE means: the documented path is DISCARD + RESEED with this census preserved as evidence. Nothing here, and
 * nothing in any C5 tool, deletes a source document.
 */
export function decideDisposition(snapshot: CommercialSnapshot): DispositionDecision {
  const all = C5_FAMILIES.flatMap((f) => snapshot[f.key].map((doc) => ({ family: f.family, doc })));
  const unmarked = all.filter(({ doc }) => certificationExclusionReason(doc.data) === null && fixtureProvenanceOf(doc.data) === null);
  const recordsWithoutFixtureProvenance = unmarked.map(({ family, doc }) => ({ family, id: doc.id }))
    .sort((a, b) => asciiSort(`${a.family}|${a.id}`, `${b.family}|${b.id}`));
  const valueSignals = unmarked.flatMap(({ family, doc }) => valueSignalsOf(family, doc)).sort(findingSort);
  const base = { recordsWithoutFixtureProvenance, valueSignals };
  if (snapshot.source.firebaseProjectId === PRODUCTION_FIREBASE_PROJECT_ID) {
    return { ...base, disposition: "STOP_FOR_OWNER_DECISION", basis: "PRODUCTION_SOURCE", ownerRulingApplied: null,
      path: "STOP. Production Commercial data is never declared empty or disposable by a tool; report the census to the Owner." };
  }
  if (all.length === 0) {
    return { ...base, disposition: "NO_SOURCE_RECORDS", basis: "EMPTY_NONPROD_SNAPSHOT", ownerRulingApplied: null,
      path: "Nothing to migrate or discard. Preserve this census as evidence." };
  }
  const discard = "DISCARD + RESEED: do not copy; preserve this census, the snapshot and its sha256 as evidence; reseed nonprod through the governed synthetic seed. Never delete the source.";
  if (unmarked.length === 0) {
    return { ...base, disposition: "DISPOSABLE_FIXTURE_ONLY", basis: "ALL_RECORDS_FIXTURE_PROVENANCE", ownerRulingApplied: null, path: discard };
  }
  const ruling = OWNER_DISPOSITION_RULINGS.find((r) => r.environmentId === snapshot.source.environmentId && r.firebaseProjectId === snapshot.source.firebaseProjectId);
  if (ruling) {
    const exceeds = C5_FAMILIES.filter((f) => snapshot[f.key].length > ruling.recordedCensus[f.key]).map((f) => f.key);
    if (exceeds.length === 0 && valueSignals.length === 0) {
      return { ...base, disposition: "DISPOSABLE_FIXTURE_ONLY", basis: `OWNER_RULING_${ruling.id}`, ownerRulingApplied: ruling.id, path: discard };
    }
    return { ...base, disposition: "MIGRATION_REQUIRED_OR_OWNER_REVIEW",
      basis: exceeds.length > 0 ? `OWNER_RULING_${ruling.id}_NOT_APPLICABLE:COUNTS_EXCEED_RECORDED_CENSUS:${exceeds.join(",")}` : `OWNER_RULING_${ruling.id}_NOT_APPLICABLE:VALUE_SIGNALS`,
      ownerRulingApplied: null,
      path: "STOP for Owner review: records look valuable or post-date the ruling. Migrate (copy with explicit confirmation) only on an Owner decision." };
  }
  return { ...base, disposition: "MIGRATION_REQUIRED_OR_OWNER_REVIEW", basis: "RECORDS_WITHOUT_FIXTURE_PROVENANCE", ownerRulingApplied: null,
    path: "Migrate (copy with explicit confirmation once every blocker is clear) or obtain an Owner disposition ruling." };
}

export function canonicalDigest(c: Omit<CanonicalCommercial, "accountability"> & { accountability: readonly SourceAccountability[] }): string {
  const h = createHash("sha256");
  for (const key of ["opportunities", "salesAgreements", "salesOrders", "accountability"] as const) {
    h.update(`--${key}--\n`);
    for (const r of c[key]) h.update(JSON.stringify(r) + "\n");
  }
  return h.digest("hex");
}

/**
 * Census the snapshot and produce the canonical records a copy would write.
 *
 * Identified Certification fixtures are excluded BEFORE canonicalization: never copied, never blocking, listed with
 * reason. Legacy uids go to provenance evidence only. Findings that reference other records (lineage) are computed over
 * the SELECTED set: a record whose parent is excluded or invalid blocks rather than dangling.
 */
export function censusCommercialSnapshot(snapshot: CommercialSnapshot): {
  census: CommercialSourceCensus; canonical: CanonicalCommercial; legacyActorProvenance: LegacyActorProvenance[];
} {
  const findings: C5Finding[] = [];
  const advisories: C5Finding[] = [];
  const excluded: C5Finding[] = [];
  const fixtures: C5Finding[] = [];
  const excludedCounts = { opportunities: 0, salesAgreements: 0, salesOrders: 0 };
  const provenance: LegacyActorProvenance[] = [];
  const d2Presence: Record<string, number> = {};
  const d2Execution: C5Finding[] = [];
  const lifecycle = { opportunities: {} as Record<string, number>, salesAgreements: {} as Record<string, number>, salesOrders: {} as Record<string, number> };
  const accountability: SourceAccountability[] = [];

  const select = <T extends CanonicalBase>(key: C5SnapshotKey, family: C5Family, canonicalize: (d: SnapshotDocument) => Result<T>): T[] => {
    const seen = new Map<string, number>();
    for (const d of snapshot[key]) seen.set(d.id, (seen.get(d.id) ?? 0) + 1);
    for (const [id, n] of seen) if (n > 1) findings.push({ family, id, code: "DUPLICATE_DOCUMENT_ID", detail: String(n) });
    const out: T[] = [];
    for (const d of snapshot[key]) {
      const exclusion = certificationExclusionReason(d.data);
      if (exclusion !== null) { excludedCounts[key] += 1; excluded.push({ family, id: d.id, code: exclusion }); continue; }
      const fixture = fixtureProvenanceOf(d.data);
      if (fixture !== null) fixtures.push({ family, id: d.id, code: fixture });
      countInto(lifecycle[key], String(family === "opportunity" ? `${d.data.stage}/${d.data.outcome ?? "OPEN"}` : d.data.state));
      for (const [field, cls] of Object.entries(FIELD_DISPOSITIONS[family])) if (cls === "D2" && d.data[field] !== undefined) countInto(d2Presence, `${family}.${field}`);
      if (family === "salesOrder" && Array.isArray(d.data.lines)) {
        const lines = d.data.lines.filter(isPlain);
        for (const q of D2_LINE_QUANTITIES) {
          if (lines.some((l) => l[q] !== undefined)) countInto(d2Presence, `${family}.lines[].${q}`);
          if (lines.some((l) => typeof l[q] === "number" && (l[q] as number) > 0)) d2Execution.push({ family, id: d.id, code: `D2_EXECUTION_NOT_MIGRATED:${q}` });
        }
      }
      const uid = (v: unknown) => (typeof v === "string" ? v : null);
      provenance.push({ family, id: d.id, createdByUid: uid(d.data.createdByUid), updatedByUid: uid(d.data.updatedByUid), acceptedByUid: uid(d.data.acceptedByUid) });
      const r = canonicalize(d);
      advisories.push(...r.evidence);
      if (!r.ok) { findings.push(...r.findings); continue; }
      if ((seen.get(d.id) ?? 0) > 1) continue;
      out.push(r.record);
      accountability.push(r.accountability);
      if (family === "salesOrder" && (r.record as unknown as CanonicalSalesOrder).lines.some((l) => l.unitPriceMinor === null)) {
        advisories.push({ family, id: d.id, code: "UNPRICED_ORDER_LINES_CARRIED_AS_NULL", detail: "a legacy defect carried verbatim; a price is never invented" });
      }
      if (family === "salesOrder" && (r.record as unknown as CanonicalSalesOrder).bookedAt === null) advisories.push({ family, id: d.id, code: "BOOKED_AT_ABSENT_LEGACY" });
    }
    return out.sort((a, b) => asciiSort(a.id, b.id));
  };

  let opportunities = select("opportunities", "opportunity", canonicalizeOpportunity);
  let salesAgreements = select("salesAgreements", "salesAgreement", canonicalizeSalesAgreement);
  let salesOrders = select("salesOrders", "salesOrder", canonicalizeSalesOrder);

  // ── numbers: duplicates per series (the snapshot is one tenant's source), sentinel years, per series/year maxima
  const all = [
    ...opportunities.map((r) => ({ family: "opportunity" as const, r })),
    ...salesAgreements.map((r) => ({ family: "salesAgreement" as const, r })),
    ...salesOrders.map((r) => ({ family: "salesOrder" as const, r })),
  ];
  const byNumber = new Map<string, { series: C5Series; ids: string[] }>();
  const bySeriesYear = new Map<string, { series: C5Series; year: number; numbers: string[]; max: number }>();
  const sentinel: { family: C5Family; id: string; number: string }[] = [];
  for (const { family, r } of all) {
    const reading = readBusinessNumber(family, r.number);
    if (reading.state !== "VALID" && reading.state !== "SENTINEL_YEAR") continue;
    const key = `${reading.series}|${r.number}`;
    byNumber.set(key, { series: reading.series, ids: [...(byNumber.get(key)?.ids ?? []), r.id] });
    if (reading.state === "SENTINEL_YEAR") { sentinel.push({ family, id: r.id, number: r.number }); continue; }
    const sy = `${reading.series}|${reading.year}`;
    const cur = bySeriesYear.get(sy) ?? { series: reading.series, year: reading.year, numbers: [], max: 0 };
    cur.numbers.push(r.number);
    cur.max = Math.max(cur.max, reading.sequence);
    bySeriesYear.set(sy, cur);
    if (Number(r.createdAt.slice(0, 4)) !== reading.year) advisories.push({ family, id: r.id, code: "NUMBER_YEAR_DIFFERS_FROM_CREATED_AT_YEAR", detail: r.number });
  }
  const duplicates = [...byNumber.entries()].filter(([, v]) => v.ids.length > 1)
    .map(([k, v]) => ({ series: v.series, number: k.split("|")[1], ids: [...v.ids].sort(asciiSort) }))
    .sort((a, b) => asciiSort(`${a.series}|${a.number}`, `${b.series}|${b.number}`));
  for (const dup of duplicates) {
    const family = C5_FAMILIES.find((f) => f.series === dup.series)!.family;
    for (const id of dup.ids) findings.push({ family, id, code: "DUPLICATE_BUSINESS_NUMBER", detail: dup.number });
  }
  for (const s of sentinel) advisories.push({ family: s.family, id: s.id, code: "SENTINEL_YEAR_NUMBER_PRESERVED_NO_COUNTER", detail: s.number });

  // ── lineage over the SELECTED, VALID set (one Agreement per Opportunity; one Order per Opportunity and per Agreement)
  const oppById = new Map(opportunities.map((o) => [o.id, o]));
  const saById = new Map(salesAgreements.map((a) => [a.id, a]));
  const lineage = (family: C5Family, id: string, code: string, detail?: string) => findings.push({ family, id, code, ...(detail ? { detail } : {}) });
  const once = (rows: { id: string; key: string | null }[], family: C5Family, code: string) => {
    const seen = new Map<string, string[]>();
    for (const r of rows) if (r.key !== null) seen.set(r.key, [...(seen.get(r.key) ?? []), r.id]);
    for (const [key, ids] of seen) if (ids.length > 1) for (const id of ids) lineage(family, id, code, key);
  };
  for (const a of salesAgreements) {
    if (a.opportunityId === null) continue;
    const o = oppById.get(a.opportunityId);
    if (!o) lineage("salesAgreement", a.id, "LINEAGE_OPPORTUNITY_NOT_SELECTED", a.opportunityId);
    else if (o.accountId !== a.accountId) lineage("salesAgreement", a.id, "LINEAGE_ACCOUNT_MISMATCH", `opportunity ${o.id}`);
  }
  once(salesAgreements.map((a) => ({ id: a.id, key: a.opportunityId })), "salesAgreement", "LINEAGE_MULTIPLE_AGREEMENTS_PER_OPPORTUNITY");
  for (const s of salesOrders) {
    if (s.opportunityId !== null) {
      const o = oppById.get(s.opportunityId);
      if (!o) lineage("salesOrder", s.id, "LINEAGE_OPPORTUNITY_NOT_SELECTED", s.opportunityId);
      else if (o.accountId !== s.accountId) lineage("salesOrder", s.id, "LINEAGE_ACCOUNT_MISMATCH", `opportunity ${o.id}`);
    }
    if (s.salesAgreementId !== null) {
      const a = saById.get(s.salesAgreementId);
      if (!a) lineage("salesOrder", s.id, "LINEAGE_AGREEMENT_NOT_SELECTED", s.salesAgreementId);
      else {
        if (a.accountId !== s.accountId) lineage("salesOrder", s.id, "LINEAGE_ACCOUNT_MISMATCH", `agreement ${a.id}`);
        if (a.opportunityId !== s.opportunityId) lineage("salesOrder", s.id, "LINEAGE_AGREEMENT_OPPORTUNITY_MISMATCH", `agreement ${a.id}`);
        if (a.state !== "ACCEPTED") lineage("salesOrder", s.id, "LINEAGE_AGREEMENT_NOT_ACCEPTED", `agreement ${a.id} is ${a.state}`);
      }
    }
  }
  once(salesOrders.map((s) => ({ id: s.id, key: s.opportunityId })), "salesOrder", "LINEAGE_MULTIPLE_ORDERS_PER_OPPORTUNITY");
  once(salesOrders.map((s) => ({ id: s.id, key: s.salesAgreementId })), "salesOrder", "LINEAGE_MULTIPLE_ORDERS_PER_AGREEMENT");
  // derived forward links and echoes must agree with the lineage they echo (checked, never copied)
  const docOf = (key: C5SnapshotKey, id: string) => snapshot[key].find((d) => d.id === id)?.data ?? {};
  for (const o of opportunities) {
    const d = docOf("opportunities", o.id);
    const agreement = salesAgreements.find((a) => a.opportunityId === o.id)?.id ?? null;
    const order = salesOrders.find((s) => s.opportunityId === o.id)?.id ?? null;
    if (d.salesAgreementId !== undefined && d.salesAgreementId !== null && d.salesAgreementId !== agreement) lineage("opportunity", o.id, "LINEAGE_FORWARD_LINK_DISAGREES", `salesAgreementId ${String(d.salesAgreementId)}`);
    if (d.salesOrderId !== undefined && d.salesOrderId !== null && d.salesOrderId !== order) lineage("opportunity", o.id, "LINEAGE_FORWARD_LINK_DISAGREES", `salesOrderId ${String(d.salesOrderId)}`);
  }
  for (const a of salesAgreements) {
    const d = docOf("salesAgreements", a.id);
    const order = salesOrders.find((s) => s.salesAgreementId === a.id)?.id ?? null;
    if (d.salesOrderId !== undefined && d.salesOrderId !== null && d.salesOrderId !== order) lineage("salesAgreement", a.id, "LINEAGE_FORWARD_LINK_DISAGREES", `salesOrderId ${String(d.salesOrderId)}`);
  }
  for (const s of salesOrders) {
    const echo = docOf("salesOrders", s.id).sourceOpportunityNumber;
    if (echo !== undefined && echo !== null && (s.opportunityId === null || oppById.get(s.opportunityId)?.number !== echo)) {
      lineage("salesOrder", s.id, "SOURCE_OPPORTUNITY_NUMBER_ECHO_DISAGREES", String(echo));
    }
  }

  // A record with any finding is not copyable; its children are then reported as depending on a blocked parent. The
  // canonical set a copy would write is the records with no finding at all.
  const blocked = new Set(findings.map((f) => `${f.family}|${f.id}`));
  opportunities = opportunities.filter((r) => !blocked.has(`opportunity|${r.id}`));
  salesAgreements = salesAgreements.filter((r) => !blocked.has(`salesAgreement|${r.id}`));
  salesOrders = salesOrders.filter((r) => !blocked.has(`salesOrder|${r.id}`));
  const kept = new Set([...opportunities.map((r) => `opportunity|${r.id}`), ...salesAgreements.map((r) => `salesAgreement|${r.id}`), ...salesOrders.map((r) => `salesOrder|${r.id}`)]);
  const keptAccountability = accountability.filter((a) => kept.has(`${a.family}|${a.id}`))
    .sort((a, b) => asciiSort(`${a.family}|${a.id}`, `${b.family}|${b.id}`));

  const employeeIds = new Set<string>();
  const accountIds = new Set<string>();
  const locationIds = new Set<string>();
  const catalog = new Map<string, { kind: "PART" | "EQUIPMENT_MODEL"; ref: string }>();
  for (const r of [...opportunities, ...salesAgreements, ...salesOrders] as (CanonicalBase & { lines: readonly { kind: string; ref: string }[]; locationId?: string | null })[]) {
    employeeIds.add(r.ownerEmployeeId);
    if (r.creditedSalespersonEmployeeId) employeeIds.add(r.creditedSalespersonEmployeeId);
    accountIds.add(r.accountId);
    if (r.locationId) locationIds.add(r.locationId);
    for (const l of r.lines) if (l.kind === "PART" || l.kind === "EQUIPMENT_MODEL") catalog.set(`${l.kind}|${l.ref}`, { kind: l.kind, ref: l.ref });
  }
  for (const a of keptAccountability) if (a.accountableEmployeeId) employeeIds.add(a.accountableEmployeeId);

  const canonical: CanonicalCommercial = { opportunities, salesAgreements, salesOrders, accountability: keptAccountability };
  const disposition = decideDisposition(snapshot);
  const blockers = [...new Set(findings.map((f) => f.code))].sort(asciiSort);
  const idsOf = (key: C5SnapshotKey) => snapshot[key].map((d) => d.id).sort(asciiSort);
  const census: CommercialSourceCensus = {
    source: snapshot.source,
    counts: { opportunities: snapshot.opportunities.length, salesAgreements: snapshot.salesAgreements.length, salesOrders: snapshot.salesOrders.length },
    ids: { opportunities: idsOf("opportunities"), salesAgreements: idsOf("salesAgreements"), salesOrders: idsOf("salesOrders") },
    certificationExcluded: { counts: excludedCounts, records: excluded.sort(findingSort) },
    fixtureProvenance: fixtures.sort(findingSort),
    selected: { opportunities: opportunities.map((r) => r.id), salesAgreements: salesAgreements.map((r) => r.id), salesOrders: salesOrders.map((r) => r.id) },
    findings: findings.sort(findingSort),
    advisories: advisories.sort(findingSort),
    numbers: {
      bySeriesYear: [...bySeriesYear.values()].map((v) => ({ series: v.series, year: v.year, count: v.numbers.length, maxSequence: v.max, numbers: v.numbers.sort(asciiSort) }))
        .sort((a, b) => asciiSort(`${a.series}|${a.year}`, `${b.series}|${b.year}`)),
      sourceVisibleHighWater: sourceVisibleHighWater(snapshot, kept),
      sentinelYear: sentinel.sort((a, b) => asciiSort(a.number, b.number)),
      duplicates,
    },
    d2Excluded: { fieldPresence: sortedBag(d2Presence), recordsWithExecutionQuantities: d2Execution.sort(findingSort) },
    lifecycle: { opportunities: sortedBag(lifecycle.opportunities), salesAgreements: sortedBag(lifecycle.salesAgreements), salesOrders: sortedBag(lifecycle.salesOrders) },
    references: {
      employeeIds: [...employeeIds].sort(asciiSort), accountIds: [...accountIds].sort(asciiSort), locationIds: [...locationIds].sort(asciiSort),
      catalog: [...catalog.values()].sort((a, b) => asciiSort(`${a.kind}|${a.ref}`, `${b.kind}|${b.ref}`)),
    },
    disposition,
    blockers,
    canonicalDigest: canonicalDigest(canonical),
  };
  provenance.sort((a, b) => asciiSort(`${a.family}|${a.id}`, `${b.family}|${b.id}`));
  return { census, canonical, legacyActorProvenance: provenance };
}
