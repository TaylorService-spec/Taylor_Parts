// Synthetic EOS_CRM_SNAPSHOT fixtures for the CRM cutover proofs. No real customer data: every name, id and address is
// invented, and uids are obviously fake. Shapes mirror the stored variants the census documents
// (docs/architecture/crm-cutover-plan.md §1): client-written Timestamp Accounts, epoch-millisecond Contacts and sites,
// the nested and flat address shapes, and a Certification-world fixture.

export const ts = (iso) => {
  const ms = Date.parse(iso);
  return { $timestamp: { seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1_000_000 } };
};

export const EXPORTED_AT = "2026-09-14T12:00:00.000Z";
export const FAKE_UID_A = "fakeFirebaseUidAlpha0001";
export const FAKE_UID_B = "fakeFirebaseUidBravo0002";

export function accountDoc(id, overrides = {}) {
  return {
    id,
    data: {
      name: `Fixture Customer ${id}`,
      nameLower: `fixture customer ${id}`.toLowerCase(),
      status: "ACTIVE",
      accountOwner: {
        assignedToEmployeeId: "emp-owner-1",
        assignedToUserId: FAKE_UID_A,
        assignedToDisplayName: "Owner Snapshot Name",
        assignedByEmployeeId: "emp-manager-1",
        assignedByUserId: FAKE_UID_B,
        assignedByDisplayName: "Manager Snapshot Name",
        assignedAt: 1_756_000_000_000,
      },
      billingAddress: { street: "1 Fixture Way", city: "Testville", state: "AZ", zip: "85001" },
      relationshipTypes: ["CUSTOMER"],
      lineOfBusiness: ["TAYLOR"],
      tags: ["fixture"],
      notes: null,
      customerNumber: null,
      erpId: null,
      accountingId: null,
      legacyId: null,
      defaultCurrency: "USD",
      purchaseOrderRequired: false,
      invoiceDeliveryMethod: "EMAIL",
      paymentTerms: null,
      taxStatus: null,
      billingContact: null,
      createdAt: ts("2025-01-02T03:04:05.678Z"),
      updatedAt: ts("2025-06-07T08:09:10.111Z"),
      ...overrides,
    },
  };
}

export function contactDoc(id, accountId, overrides = {}) {
  return {
    id,
    data: {
      accountId,
      name: `Fixture Person ${id}`,
      phone: "555-0100",
      email: `${id}@fixture.invalid`,
      role: "Buyer",
      isPrimary: false,
      owner: { type: "USER", id: "emp-owner-1" },
      createdAt: 1_735_787_045_678,
      createdBy: FAKE_UID_A,
      updatedAt: 1_736_787_045_678,
      updatedBy: FAKE_UID_B,
      ...overrides,
    },
  };
}

export function locationDoc(id, accountId, overrides = {}) {
  return {
    id,
    data: {
      accountId,
      name: `Fixture Site ${id}`,
      address: { street: "9 Site Road", city: "Testville", state: "AZ", zip: "85002" },
      accessNotes: "Dock at rear",
      owner: { type: "USER", id: "emp-owner-1" },
      createdAt: 1_735_787_045_678,
      updatedAt: 1_736_787_045_678,
      ...overrides,
    },
  };
}

export function snapshotOf({ accounts = [], contacts = [], locations = [], environmentId = "platform-sandbox", firebaseProjectId = "eos-platform-sandbox" } = {}) {
  return {
    format: "EOS_CRM_SNAPSHOT",
    version: 1,
    exporter: "FIREBASE_EXIT_MIGRATION_ONLY",
    source: { environmentId, firebaseProjectId, exportedAt: EXPORTED_AT },
    accounts,
    contacts,
    locations,
  };
}

/**
 * A copy-ready world once owners resolve: two owned Accounts, a legacy ownerless Account with no children, a billing
 * Contact, a Contact with no stated owner (derived from its Account's owner at cutover), a flat-address site.
 */
export function cleanSnapshot() {
  return snapshotOf({
    accounts: [
      accountDoc("acct-alpha", { billingContact: { contactId: "con-alpha-ap" }, paymentTerms: "NET_30", taxStatus: "TAXABLE" }),
      accountDoc("acct-bravo", { status: "PROSPECT", accountOwner: { assignedToEmployeeId: "emp-owner-2", assignedToUserId: FAKE_UID_B, assignedToDisplayName: "Second Owner", assignedByEmployeeId: "emp-manager-1", assignedByUserId: FAKE_UID_A, assignedByDisplayName: "Manager Snapshot Name", assignedAt: 1_756_000_000_001 }, billingAddress: null, relationshipTypes: ["VENDOR", "CUSTOMER"], lineOfBusiness: ["VENTANA", "TAYLOR"] }),
      accountDoc("acct-ownerless", { accountOwner: null }),
    ],
    contacts: [
      contactDoc("con-alpha-ap", "acct-alpha", { isPrimary: true }),
      contactDoc("con-bravo-1", "acct-bravo", { owner: undefined, role: null }),
    ],
    locations: [
      locationDoc("loc-alpha-main", "acct-alpha"),
      locationDoc("loc-bravo-flat", "acct-bravo", { address: undefined, addressLine1: "5 Flat St", city: "Flatland", state: "NM" }),
    ],
  });
}

/** Strip `undefined` overrides the way a JSON round trip (the real file) would. */
export const asFile = (snapshot) => JSON.parse(JSON.stringify(snapshot));

export const resolvingFacts = (ids = ["emp-owner-1", "emp-owner-2"]) => ({
  resolvableEmployeeIds: new Set(ids),
  commercialAccountIds: [],
  existingAccountIds: new Set(),
});
