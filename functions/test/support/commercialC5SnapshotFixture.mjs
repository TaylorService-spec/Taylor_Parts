// FIXTURE COMMERCIAL SNAPSHOTS for the C5 suites. Shaped exactly like what scripts/exportCommercialSnapshot.js writes:
// Firestore documents verbatim (the shapes the Firestore callables persist -- opportunityCallables.ts,
// salesAgreementCallables.ts, closeOpportunityAsWon.ts), Timestamps tagged as $timestamp. They carry the legacy
// variants the live estate carries (createdAtMillis, closedAtMillis, D2 execution quantities, legacy uids) so the
// census has something real to report and the copy has something real to leave behind.

export const SANDBOX_ENV = "platform-sandbox";
export const SANDBOX_PROJECT = "eos-platform-sandbox";

export const ts = (seconds, nanoseconds = 0) => ({ $timestamp: { seconds, nanoseconds } });
const T0 = 1767225600; // 2026-01-01T00:00:00Z
export const EMP = Object.freeze({ owner: "emp-owner-a", accountable: "emp-acct-b", terminated: "emp-term-c", credited: "emp-credit-d" });

/** Ids carry a prefix so two snapshots (the in-process proofs and the CLI proof) never collide on global primary keys. */
export function commercialDocs(p = "") {
  const opp1 = {
    id: `${p}opp-1`,
    data: {
      opportunityNumber: "OPP-2026-000007", accountId: `${p}acct-1`, ownerEmployeeId: EMP.owner, operatingCompanyId: "taylor", salesChannel: "RETAIL",
      creditedSalespersonId: EMP.credited, stage: "DECISION", outcome: "WON", closedAt: ts(T0 + 86400 * 40, 250000000), need: "  two coolers  ",
      expectedValue: 12500.5, expectedCloseAt: (T0 + 86400 * 45) * 1000, nextAction: " ",
      lines: [{ kind: "EQUIPMENT_MODEL", ref: "ACME--CW-100", qty: 1 }, { kind: "SERVICE", ref: "SVC-INSTALL", qty: 1 }],
      accountableEmployeeId: EMP.accountable, accountablePersonSource: "EXPLICIT",
      createdByUid: "uid-creator", updatedByUid: "uid-updater", updatedAtMillis: (T0 + 86400 * 40) * 1000,
      salesAgreementId: `${p}sa-1`, salesOrderId: `${p}so-1`,
      createdAt: ts(T0 + 86400 * 10, 123456789), updatedAt: ts(T0 + 86400 * 40, 250000000),
    },
  };
  const opp2 = {
    id: `${p}opp-2`,
    data: {
      opportunityNumber: "OPP-2026-000009", accountId: `${p}acct-1`, ownerEmployeeId: EMP.owner, operatingCompanyId: null, salesChannel: "NATIONAL_ACCOUNTS",
      stage: "QUOTING", outcome: null, need: null, expectedValue: null, expectedCloseAt: null,
      lines: [{ kind: "PART", ref: "P-100", qty: 2 }],
      createdByUid: "uid-creator", updatedAtMillis: (T0 + 86400 * 20) * 1000,
      createdAt: ts(T0 + 86400 * 20), updatedAt: ts(T0 + 86400 * 20),
    },
  };
  const opp3 = {
    id: `${p}opp-3`,
    data: {
      opportunityNumber: "OPP-2025-000003", accountId: `${p}acct-2`, ownerEmployeeId: EMP.owner, operatingCompanyId: "ventana", salesChannel: "RETAIL",
      stage: "SOLUTION", outcome: "LOST", closedAtMillis: (T0 - 86400 * 10) * 1000,
      lines: [],
      accountableEmployeeId: EMP.terminated, accountablePersonSource: "DERIVED_FROM_RECORD_OWNER",
      createdByUid: "uid-creator", createdAtMillis: (T0 - 86400 * 60) * 1000,
    },
  };
  const sa1 = {
    id: `${p}sa-1`,
    data: {
      salesAgreementNumber: "SA-2026-000004", accountId: `${p}acct-1`, ownerEmployeeId: EMP.owner, operatingCompanyId: "taylor", creditedSalespersonId: EMP.credited,
      locationId: `${p}loc-1`, sourceOpportunityId: `${p}opp-1`, customerPO: "PO-77", isLease: false, fulfillmentIntent: "BOTH",
      shippingInstructions: "dock 3", shipVia: null, specialInstructions: "call first", currency: "USD", state: "ACCEPTED",
      lines: [
        { lineId: "line-1", kind: "EQUIPMENT_MODEL", ref: "ACME--CW-100", businessUnitId: "EQUIPMENT_SALES", quantity: 1, unitPrice: 900000, condition: "NEW", warranty: "1 year", estimatedArrivalMillis: (T0 + 86400 * 60) * 1000, extendedMinor: 900000 },
        { lineId: "line-2", kind: "SERVICE", ref: "SVC-INSTALL", businessUnitId: "INSTALLATION", quantity: 1, unitPrice: 50000, condition: null, warranty: null, estimatedArrivalMillis: null, extendedMinor: 50000 },
      ],
      totals: { subtotalMinor: 950000, shippingMinor: 10000, installChargeMinor: 0, taxMinor: 7600, totalMinor: 967600, downPaymentMinor: 100000, tradeInMinor: 0, balanceMinor: 867600 },
      accountableEmployeeId: EMP.accountable, accountablePersonSource: "EXPLICIT",
      acceptedAtMillis: (T0 + 86400 * 39) * 1000, acceptedByUid: "uid-accepter",
      createdByUid: "uid-creator", updatedByUid: "uid-accepter", createdAtMillis: (T0 + 86400 * 30) * 1000, updatedAtMillis: (T0 + 86400 * 39) * 1000,
      salesOrderId: `${p}so-1`, createdAt: ts(T0 + 86400 * 30), updatedAt: ts(T0 + 86400 * 39),
    },
  };
  const so1 = {
    id: `${p}so-1`,
    data: {
      salesOrderNumber: "SO-2026-000011", accountId: `${p}acct-1`, ownerEmployeeId: EMP.owner, operatingCompanyId: "taylor", creditedSalespersonId: EMP.credited,
      salesChannel: "RETAIL", currency: "USD", bookedAtMillis: (T0 + 86400 * 39) * 1000, locationId: `${p}loc-1`, sourceOpportunityId: `${p}opp-1`,
      sourceAgreementId: `${p}sa-1`, sourceOpportunityNumber: "OPP-2026-000007", customerPO: "PO-77", notes: "call first", state: "IN_FULFILLMENT",
      lines: [
        { lineId: "line-1", kind: "EQUIPMENT_MODEL", ref: "ACME--CW-100", businessUnitId: "EQUIPMENT_SALES", orderedQty: 1, allocatedQty: 1, fulfilledQty: 1, billedQty: 0, unitPrice: 900000 },
        { lineId: "line-2", kind: "SERVICE", ref: "SVC-INSTALL", businessUnitId: "INSTALLATION", orderedQty: 1, allocatedQty: 0, fulfilledQty: 0, billedQty: 0, unitPrice: 50000 },
      ],
      fulfillmentReadiness: "PARTIAL", serviceWorkOrderIds: [],
      accountableEmployeeId: EMP.accountable, accountablePersonSource: "DERIVED_FROM_RECORD_OWNER",
      createdByUid: "uid-creator", updatedByUid: "uid-updater", createdAtMillis: (T0 + 86400 * 40) * 1000, updatedAtMillis: (T0 + 86400 * 40) * 1000,
      createdAt: ts(T0 + 86400 * 40, 999999999), updatedAt: ts(T0 + 86400 * 41),
    },
  };
  // Identified Certification fixtures: always excluded, never copied, never blocking.
  const oppCw = { id: `${p}cw-opp-1`, data: { ...opp2.data, opportunityNumber: "OPP-2026-000002", certificationWorld: { version: 1 } } };
  const soCw = { id: `${p}cw-so-1`, data: { ...so1.data, salesOrderNumber: "SO-2026-000099", sourceOpportunityId: null, sourceAgreementId: null, sourceOpportunityNumber: null, dataProvenance: "SYNTHETIC_CERTIFICATION_FACT" } };
  return { opp1, opp2, opp3, sa1, so1, oppCw, soCw };
}

export function snapshotOf({ opportunities = [], salesAgreements = [], salesOrders = [], environmentId = SANDBOX_ENV, projectId = SANDBOX_PROJECT } = {}) {
  return {
    format: "EOS_COMMERCIAL_SNAPSHOT", version: 1,
    source: { environmentId, firebaseProjectId: projectId, exportedAt: "2026-09-15T00:00:00.000Z" },
    opportunities, salesAgreements, salesOrders,
  };
}

/** The clean, migration-required snapshot: 3 Opportunities, 1 Agreement, 1 Order, 2 Certification fixtures. */
export function cleanSnapshot(p = "", overrides = {}) {
  const d = commercialDocs(p);
  return snapshotOf({ opportunities: [d.opp1, d.opp2, d.opp3, d.oppCw], salesAgreements: [d.sa1], salesOrders: [d.so1, d.soCw], ...overrides });
}

export const clone = (v) => JSON.parse(JSON.stringify(v));
