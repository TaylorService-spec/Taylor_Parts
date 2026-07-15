// Seeds the Firestore + Auth emulator with the accounts the driver
// needs to sign in through the real Login.jsx UI: an admin, and a
// dispatcher (ChatGPT architecture review on PR #93: this fixture is
// ROLES.DISPATCHER by security role, not ROLES.TECHNICIAN -- see the
// dispatcher-vs-technician nav-access gotcha below) whose linked
// Employee has operationalRoles: ["PARTS_MANAGER"] -- the exact
// NEEDS_PLANNING-eligibility scenario firestore.rules'
// canSubmitManualZeroHistoryQuantity() and
// shared/inventory/RequestReorderControl.jsx both gate on.
//
// Uses firebase-admin (devDependency, added for this driver) rather
// than plain REST -- confirmed live that unauthenticated REST writes
// to users/{userId} are denied by firestore.rules' `allow write: if
// false` (role docs are provisioned by an admin only, never a
// client), the same reason functions/test/employeesRules.test.js uses
// the Admin SDK for its own seeding. Admin SDK writes bypass security
// rules entirely by design.
//
// Run against a live Firestore + Auth emulator pair:
//   firebase emulators:start --only firestore,auth --project taylor-parts
// then, from field-ops-app-vite/:
//   node .claude/skills/run-field-ops-app-vite/seed.mjs
//
// Only ever writes to 127.0.0.1:8080/9099 (FIRESTORE_EMULATOR_HOST/
// FIREBASE_AUTH_EMULATOR_HOST below) -- never touches the live
// "taylor-parts" project.
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { fileURLToPath } from "node:url";

const app = initializeApp({ projectId: "taylor-parts" });
const db = getFirestore(app);
const auth = getAuth(app);

export const DRIVER_ACCOUNTS = {
  admin: { email: "driver-admin@example.test", password: "driver-pass-123", uid: null },
  eligiblePartsManager: { email: "driver-parts-manager@example.test", password: "driver-pass-123", uid: null },
  ineligibleDispatcher: { email: "driver-dispatcher@example.test", password: "driver-pass-123", uid: null },
  // Inventory Operational Queue, PR A -- dedicated account for the
  // "query failure renders error, not empty" assertion. Its
  // users/{uid}.role is set to an invalid value ONCE, here, at seed
  // time, and is NEVER mutated afterward. This is deliberate, not an
  // oversight: the Firestore emulator was confirmed (2026-07-12,
  // investigating a false-negative on this exact assertion) to cache a
  // security rule's get()-based role lookup PER UID for the emulator
  // process's lifetime -- mutating an EXISTING, previously-validated
  // uid's role (e.g. flipping DRIVER_ACCOUNTS.admin's role mid-session)
  // silently keeps succeeding against the STALE cached value, a real
  // emulator/production parity gap, not an application bug (production
  // Firestore does correctly invalidate this; only the emulator doesn't
  // reproduce that here). A uid whose role is invalid from its very
  // first-ever evaluation is rejected correctly and deterministically --
  // confirmed directly against this exact query shape. See driver.mjs's
  // verify-pr-a query-failure check for the isolated SDK-level assertion
  // this fixture exists for (a full authenticated browser session can't
  // reach this state at all -- App.jsx's own isDomainVisible() route
  // gating requires a recognized admin/dispatcher/technician role before
  // rendering Inventory in the first place, so an invalid role can never
  // reach the "All Assigned Work" UI to click through -- this is why the
  // check is a direct SDK-level listener assertion, not a browser one).
  queryFailureProbe: { email: "driver-query-failure-probe@example.test", password: "driver-pass-123", uid: null },
  // Issue #100 (docs/specifications/inventory-nav-access-alignment.md,
  // docs/implementation-plans/inventory-nav-access-alignment.md, PR 0)
  // -- five fixtures exercising role=technician + operationalRoles
  // combinations no existing account produces (every prior fixture
  // deliberately avoids seeding a real role=technician account for
  // Inventory scenarios -- see eligiblePartsManager's own comment
  // above and SKILL.md's Gotchas). PR 0 itself adds no nav/route/Rules
  // change that consumes these -- they exist so PR 1a/1b/2a/2b/3a/3b's
  // browser/SDK-level coverage has real accounts to sign in as.
  technicianPartsManager: { email: "driver-technician-parts-manager@example.test", password: "driver-pass-123", uid: null },
  technicianWarehouseManager: { email: "driver-technician-warehouse-manager@example.test", password: "driver-pass-123", uid: null },
  technicianPartsAssociate: { email: "driver-technician-parts-associate@example.test", password: "driver-pass-123", uid: null },
  // Ineligible: real reciprocal Employee link, ACTIVE, but zero
  // eligible operationalRoles -- must be denied every capability the
  // three eligible fixtures above satisfy.
  technicianIneligible: { email: "driver-technician-ineligible@example.test", password: "driver-pass-123", uid: null },
  // Broken linkage: users/{uid}.employeeId points at an employees
  // document that is never created -- proves fail-closed behavior for
  // an unresolved/broken link specifically, not merely an empty
  // operationalRoles array.
  technicianBrokenLink: { email: "driver-technician-broken-link@example.test", password: "driver-pass-123", uid: null },
  // Issue #100 PR 3b -- the Specification's own "Union behavior" design
  // (an Employee with two eligible operationalRoles sees BOTH
  // corresponding nav items simultaneously, no exclusivity/precedence)
  // recommended a dedicated multi-role fixture in whichever UI PR lands
  // last -- PR 3b, since all three tracks (manager/warehouse/mine) are
  // now implemented. ACTIVE, reciprocally linked, operationalRoles:
  // ["PARTS_ASSOCIATE", "WAREHOUSE_MANAGER"].
  technicianMultiRole: { email: "driver-technician-multi-role@example.test", password: "driver-pass-123", uid: null },
  // Issue #232 unit E4 -- Equipment. The Specification's compatibility matrix
  // (§Seed compatibility) gives admin/dispatcher the full Equipment surface and
  // restricts a technician to Equipment reachable through their OWN assigned Work
  // Orders. That self-scope needs two accounts no existing fixture produces, because
  // every prior technician fixture links via users/{uid}.employeeId (Inventory's
  // operationalRoles model) and none carries the users/{uid}.technicianId that
  // fieldops_wos' isOwnTechnician() actually reads:
  //   assigned   -- technicianId matches the assignedTechId on Work Orders that link
  //                 to Equipment: the only technician who may reach any of it.
  //   unassigned -- a real, well-formed technician with ZERO Work Orders linking to
  //                 Equipment: proves self-scope denies by ABSENCE OF ASSIGNMENT,
  //                 not merely by a broken link or a wrong role.
  // Deliberately NOT added: an "inactive employee" persona. Equipment authority per
  // §11 is role + technician self-scope; it never consults employees/{id}, so an
  // employmentStatus fixture would be dead weight asserting nothing. Inventory's
  // technicianBrokenLink (role=technician, no technicianId) already covers
  // fail-closed on unresolved linkage, and queryFailureProbe covers an invalid role.
  equipmentTechAssigned: { email: "driver-equipment-tech-assigned@example.test", password: "driver-pass-123", uid: null },
  equipmentTechUnassigned: { email: "driver-equipment-tech-unassigned@example.test", password: "driver-pass-123", uid: null },
};

async function ensureAuthUser(acct) {
  try {
    const existing = await auth.getUserByEmail(acct.email);
    acct.uid = existing.uid;
  } catch {
    const created = await auth.createUser({ email: acct.email, password: acct.password, emailVerified: true });
    acct.uid = created.uid;
  }
}

// Notification identity fix (docs/specifications/notification-identity.md,
// Issue #145) -- one dedicated REAL catalog part (data/partsCatalog.ts
// -- PartDetail.jsx's getCatalogItem(partId) short-circuits to an
// "Unknown part" message for any id not in that fixed catalog list, so
// this fixture reuses TST-1004..TST-1007 rather than inventing new
// ids) per Notification Panel section / PartsList.jsx queue this
// fixture needs to exercise, each seeded with TWO reorder_requests
// documents: an ACTIVE one (the status that section/queue actually
// surfaces) and a TERMINAL (CANCELLED) sibling for the SAME part with
// a deliberately LATER createdAt. This is the exact defect scenario:
// the old partId-only navigation would have resolved to the terminal
// sibling (newest by createdAt, no status filter) instead of the
// active document a real notification click
// should land on. Exported so driver.mjs can assert against the exact
// expected requestId per case, not just "some request for this part."
export const NOTIFICATION_IDENTITY_FIXTURE = {
  pendingReview: { partId: "TST-1004", activeId: "driver-seed-notif-pending-active", status: "PENDING_REVIEW" },
  readyForPartsManager: { partId: "TST-1005", activeId: "driver-seed-notif-readypm-active", status: "READY_FOR_PARTS_MANAGER" },
  assignedToYou: { partId: "TST-1006", activeId: "driver-seed-notif-assigned-active", status: "ASSIGNED_TO_PARTS_ASSOCIATE" },
  purchasingStarted: { partId: "TST-1007", activeId: "driver-seed-notif-purchasing-active", status: "PURCHASING_IN_PROGRESS" },
};

// Cancel/Void schema deployment sequence, PR 6 of 6 (docs/specifications/
// reorder-request-cancellation.md). Two real catalog parts (data/
// partsCatalog.ts), each seeded fresh (eligible, not-yet-terminal) for
// driver.mjs's verify-cancel-void command to actually transition
// through the real UI/domain functions, not pre-seeded as already
// CANCELLED/VOIDED -- the whole point is to exercise
// cancelReorderRequest()/voidPurchaseOrder() live. cancelEligible sits
// at ASSIGNED_TO_PARTS_ASSOCIATE (one of the three reachable
// pre-order statuses; any of the three would do -- this one exercises
// ReorderRequestStartPurchasing's Cancel action specifically).
// voidEligible sits at ORDERED with a linked reorder_purchase_orders
// document already recorded (Void requires one to exist), assigned to
// the admin driver account so the same account satisfies BOTH
// Rules conditions (isAdminOrDispatcher() AND current assignee) with
// no second account needed.
export const CANCEL_VOID_FIXTURE = {
  cancelEligible: { partId: "TST-1008", requestId: "driver-seed-cancel-eligible", status: "ASSIGNED_TO_PARTS_ASSOCIATE" },
  voidEligible: { partId: "TST-1009", requestId: "driver-seed-void-eligible", status: "ORDERED" },
};

// Inventory Operational Queue, PR A (docs/specifications/inventory-
// operational-queue.md) -- "All Assigned Work" oversight and the
// assignment picker's securityRole eligibility filter.
//
// otherUserAssignedRequest: assigned to a uid that is NOT any
// DRIVER_ACCOUNTS entry -- the exact "Manager B sees a request assigned
// to user A, without being the assignee" scenario the Specification's
// Acceptance criteria requires. Its assignee uid IS linked to a real
// Employee record (otherAssigneeEmployee below) -- Final Review requires
// "All Assigned Work" to resolve and display the current assignee via
// resolveActorDisplayName(), never a raw uid, so this fixture's assignee
// must itself be resolvable to prove that resolution actually happens
// (a dangling, unresolvable uid would only prove the raw-uid FALLBACK
// path, the opposite of what this assertion needs to demonstrate).
//
// securityRoleEmployees: four Employees, all ACTIVE/PARTS_ASSOCIATE-
// eligible-by-operationalRoles/linked-user (so they'd all appear in the
// picker's query results absent the securityRole filter this PR adds),
// differing only in securityRole -- proves the filter's four real
// outcomes: technician excluded (ordinary, no warning), missing/invalid
// excluded WITH the admin-visible warning (the data-quality case), and
// a valid non-technician role included normally.
export const PR_A_FIXTURE = {
  otherUserAssignedRequest: {
    partId: "TST-1010",
    requestId: "driver-seed-all-assigned-other-user",
    assignedToUserId: "driver-seed-other-user-not-signed-in",
  },
  otherAssigneeEmployee: {
    employeeId: "driver-emp-other-assignee",
    displayName: "Other Parts Associate",
    userId: "driver-seed-other-user-not-signed-in",
  },
  // Final Review correction: resolveActorDisplayName() falls back to the
  // raw uid when no Employee links to the assignee's userId at all --
  // this fixture's assignee is DELIBERATELY unlinked (no Employee
  // document references this uid anywhere), proving "All Assigned Work"
  // shows "Unknown assignee" for this case instead of that raw uid.
  unresolvableAssigneeRequest: {
    partId: "TST-1011",
    requestId: "driver-seed-all-assigned-unresolvable",
    assignedToUserId: "driver-seed-unresolvable-user-no-employee-link",
  },
  securityRoleEmployees: {
    eligible: { employeeId: "driver-emp-securityrole-eligible", displayName: "Eligible Dispatcher Assoc", securityRole: "dispatcher" },
    technician: { employeeId: "driver-emp-securityrole-technician", displayName: "Excluded Technician Assoc", securityRole: "technician" },
    missing: { employeeId: "driver-emp-securityrole-missing", displayName: "Missing Role Data Assoc" }, // securityRole deliberately omitted
    invalid: { employeeId: "driver-emp-securityrole-invalid", displayName: "Invalid Role Data Assoc", securityRole: "not_a_real_role" },
  },
};

// Customer/Account Business Model -- Customer PR 3, Service Activity
// (docs/specifications/customer-account-business-model.md). One Account
// with a deterministic set of fieldops_wos documents covering every
// WorkOrderStatus bucket, seeded via the Admin SDK (bypasses the
// client-denied fieldops_wos write rule, same as every other fixture
// here). `statuses` is index-0 = NEWEST; driver.mjs derives the exact
// expected counts from it (no magic numbers) and asserts:
//   - Completed count = COMPLETED + CLOSED
//   - Open count = the eight non-terminal, non-cancelled statuses
//   - CANCELLED excluded from BOTH counts, but still present in the
//     timeline (the newest row is CANCELLED on purpose)
//   - bounded first page (pageSize), cursor Load More to the end
// woId "sa-wo-<ii>" / woNumber "WO-SA-<iii>" by index; createdAt staggered
// so index 0 is newest.
export const SERVICE_ACTIVITY_FIXTURE = {
  accountId: "acct-service-activity",
  pageSize: 10,
  statuses: [
    "CANCELLED", // 0 -- newest; in the timeline, excluded from counts
    "WORK_IN_PROGRESS",
    "COMPLETED",
    "CREATED",
    "CLOSED",
    "SCHEDULED",
    "DISPATCHED",
    "ACCEPTED",
    "EN_ROUTE",
    "ARRIVED",
    "READY_TO_DISPATCH",
    "COMPLETED",
    "CREATED",
    "CANCELLED", // 13 -- oldest; in the timeline, excluded from counts
  ],
};

// Inventory Operational Queue, PR C (docs/specifications/inventory-
// operational-queue.md) -- Reorder Request History. One real catalog
// part reused across every fixture row (History never dedupes by part,
// so this is deliberate, not an oversight); `statuses` is index-0 =
// NEWEST, createdAt staggered so index 0 has the largest timestamp --
// same "index-0-is-newest" convention SERVICE_ACTIVITY_FIXTURE already
// established, for the same reason (driver.mjs derives exact expected
// ordering/counts from this array directly, no magic numbers). 14 items,
// matching HISTORY_PAGE_SIZE (10) with page 1 = indices 0-9 and page 2 =
// indices 10-13 -- enough to exercise bounded-first-page, cursor Load
// More, and end-of-history all in one fixture. All four terminal
// statuses (CANCELLED/VOIDED/RECEIVED/REJECTED) appear at least twice.
export const HISTORY_FIXTURE = {
  partId: "TST-1012",
  pageSize: 10,
  requestIdPrefix: "driver-seed-history",
  // Index 6 (RECEIVED) is deliberately NOT on the first page (indices
  // 0-9 ARE on the first page for pageSize 10 -- see below) -- reused as
  // the "on second page" exact-id-lookup case; index 13 is the oldest,
  // deliberately used as the "definitely not loaded without Load More"
  // case for the SAME assertion, kept for whichever is more convenient
  // in driver.mjs.
  statuses: [
    "CANCELLED", // 0 -- newest, first page
    "VOIDED", // 1
    "RECEIVED", // 2
    "REJECTED", // 3
    "CANCELLED", // 4
    "VOIDED", // 5
    "RECEIVED", // 6
    "REJECTED", // 7
    "CANCELLED", // 8
    "VOIDED", // 9 -- last item on the first page (indices 0-9, pageSize 10)
    "RECEIVED", // 10 -- first item that requires Load More
    "REJECTED", // 11
    "CANCELLED", // 12
    "VOIDED", // 13 -- oldest
  ],
};

// Account Commercial Profile -- PR 1 (docs/specifications/
// account-commercial-profile-and-financial-forecast-horizons.md). Three
// Accounts exercising the informational Commercial Profile + identity
// display, plus one Employee the owner references so the directory resolves
// a CURRENT name (deliberately DIFFERENT from the stored snapshot, to prove
// re-resolution isn't merely echoing the persisted snapshot):
//   - resolved: every field set; billingContact is a real Contact ON the
//               Account; accountOwner links to ownerEmployee (resolves to a
//               current name). Its stored assignedToDisplayName is a stale
//               snapshot the UI must NOT surface.
//   - unknown:  accountOwner links to a userId with NO Employee, and
//               billingContact references a Contact NOT on the Account -- so
//               both resolve to "Unknown ..." after a COMPLETED lookup.
//   - edit:     no profile yet; drives the edit round-trip (as a resolved-
//               assignor dispatcher) and the unresolved-assignor fail-closed
//               check (as the admin account, whose users/{uid} has no
//               employeeId, so its assignor identity never resolves).
export const COMMERCIAL_PROFILE_FIXTURE = {
  resolvedAccountId: "acct-cp-resolved",
  unknownAccountId: "acct-cp-unknown",
  editAccountId: "acct-cp-edit",
  ownerEmployee: { employeeId: "cp-owner-emp", userId: "cp-owner-user", displayName: "Commercial Owner" },
  resolvedBillingContact: { id: "cp-contact-1", name: "Billing Contact Person" },
  editBillingContact: { id: "cp-edit-contact-1", name: "Edit Billing Contact" },
  ghostOwnerUserId: "cp-owner-ghost-user-no-employee",
  foreignContactId: "cp-foreign-contact-not-on-this-account",
  staleOwnerSnapshotName: "Commercial Owner (STALE snapshot)",
};

// Account Commercial Profile -- PR 2 (docs/specifications/
// account-commercial-profile-and-financial-forecast-horizons.md). Two
// Accounts for the GOVERNED enum fields (paymentTerms/taxStatus). Neither
// carries an accountOwner or billingContact, so the edit form validates with
// only the governed fields in play -- letting driver.mjs's verify-governed-
// fields exercise the Rules-layer admin-only-edit denial cleanly (a
// dispatcher changing paymentTerms is rejected by Rules, not by the UI
// hiding the field):
//   - governed:     paymentTerms + taxStatus + a currency both set, for the
//                   admin render check AND the dispatcher rules-denial check.
//   - safeDefault:  a currency set but NO taxStatus stored, proving the
//                   absent => UNKNOWN safe-default render (never TAXABLE).
export const GOVERNED_FIELDS_FIXTURE = {
  governedAccountId: "acct-governed-fields",
  safeDefaultAccountId: "acct-governed-safe-default",
  paymentTerms: "NET_30",
  taxStatus: "EXEMPT",
};

// Customer Results Dashboard -- four accounts spanning every status and both
// relationship shapes, all carrying the unique `sharedTag` (so a tag filter
// isolates exactly these four regardless of other fixtures), plus `soloTag` on
// ONLY the Active one (so an Archived + soloTag combo is a guaranteed
// filtered-no-results case). Statuses use the ACCOUNT_STATUS display values.
export const DASHBOARD_FIXTURE = {
  sharedTag: "DashboardTest",
  soloTag: "DashOnlyTag",
  accounts: [
    { id: "dash-active-customer", name: "Dash Active Customer", status: "Active", relationshipTypes: ["CUSTOMER"], tags: ["DashboardTest", "DashOnlyTag"] },
    { id: "dash-prospect-vendor", name: "Dash Prospect Vendor", status: "Prospect", relationshipTypes: ["VENDOR"], tags: ["DashboardTest"] },
    { id: "dash-inactive-both", name: "Dash Inactive Both", status: "Inactive", relationshipTypes: ["CUSTOMER", "VENDOR"], tags: ["DashboardTest"] },
    { id: "dash-archived-none", name: "Dash Archived None", status: "Archived", relationshipTypes: [], tags: ["DashboardTest"] },
  ],
};

// Demo Customers -- ten deterministic, emulator-only Accounts for the Customer
// Results Dashboard, spanning every status (4 Active / 3 Prospect / 2 Inactive
// / 1 Archived), all four relationship shapes (Customer / Vendor / both /
// unset), and varied tags, billing addresses, notes, external identifiers,
// currencies, purchaseOrderRequired flags, invoice delivery methods, payment
// terms, and tax statuses. Several intentionally omit optional fields.
//
// Every value is a valid enum: status = ACCOUNT_STATUS display value;
// relationshipTypes in {CUSTOMER, VENDOR}; defaultCurrency a valid ISO 4217
// code (domain/commercialProfile.js's ISO_4217_CURRENCIES); invoiceDeliveryMethod
// in INVOICE_DELIVERY_METHOD; paymentTerms in PAYMENT_TERMS; taxStatus in
// TAX_STATUS (domain/constants.js). billingAddress is the {street,city,state,zip}
// shape AccountForm/AccountDetail read; the four external-identifier fields
// (customerNumber/erpId/accountingId/legacyId) render with their own labels in
// AccountDetail -- never a raw Firestore document id.
//
// DELIBERATELY avoids DASHBOARD_FIXTURE's sharedTag ("DashboardTest") and
// soloTag ("DashOnlyTag") and uses its OWN unique document ids/names, so
// verify-customer-dashboard's tag-filter assertions (which expect exactly the
// four DASHBOARD_FIXTURE accounts for "DashboardTest", and zero for
// Archived + "DashOnlyTag") are unaffected. The dashboard's status/total card
// counts are derived LIVE from the whole accounts collection by driver.mjs, so
// these extra accounts are absorbed automatically -- no driver.mjs change is
// needed or made. `ageMs` is how long ago the account was "last updated"
// (updatedAt = now - ageMs), staggered so "Last update" spans just now /
// minutes / hours / days / months / years; createdAt is set a little older
// still. Timestamps are Date.now() epoch-ms numbers -- the same convention
// domain/accounts.js writes and formatLastUpdate() reads.
const _MIN = 60_000;
const _HOUR = 60 * _MIN;
const _DAY = 24 * _HOUR;
const _MONTH = 30 * _DAY;
const _YEAR = 365 * _DAY;

export const DEMO_CUSTOMERS = [
  {
    id: "demo-cust-01-summit-mechanical",
    name: "Summit Mechanical Services",
    status: "Active",
    relationshipTypes: ["CUSTOMER"],
    tags: ["Priority", "HVAC"],
    billingAddress: { street: "1420 Ridgeline Dr", city: "Denver", state: "CO", zip: "80202" },
    notes: "Preferred service partner; quarterly maintenance contract.",
    customerNumber: "SMS-1001",
    defaultCurrency: "USD",
    purchaseOrderRequired: true,
    invoiceDeliveryMethod: "EMAIL",
    paymentTerms: "NET_30",
    taxStatus: "TAXABLE",
    ageMs: 5 * _MIN,
  },
  {
    id: "demo-cust-02-harbor-point",
    name: "Harbor Point Logistics",
    status: "Active",
    relationshipTypes: ["CUSTOMER", "VENDOR"], // both
    tags: ["Logistics", "National"],
    billingAddress: { street: "88 Wharf St", city: "Seattle", state: "WA", zip: "98101" },
    notes: "Buys and supplies; dual relationship account.",
    erpId: "ERP-88213",
    defaultCurrency: "USD",
    purchaseOrderRequired: true,
    invoiceDeliveryMethod: "PORTAL",
    paymentTerms: "NET_60",
    taxStatus: "EXEMPT",
    ageMs: 3 * _HOUR,
  },
  {
    id: "demo-cust-03-cedar-valley-foods",
    name: "Cedar Valley Foods",
    status: "Active",
    relationshipTypes: ["VENDOR"],
    tags: ["Food Service"],
    billingAddress: { street: "77 Orchard Rd", city: "Toronto", state: "ON", zip: "M5H 2N2" },
    // notes intentionally absent
    // no external identifier intentionally absent
    defaultCurrency: "CAD",
    purchaseOrderRequired: false,
    invoiceDeliveryMethod: "MAIL",
    paymentTerms: "NET_90",
    taxStatus: "RESELLER",
    ageMs: 4 * _DAY,
  },
  {
    id: "demo-cust-04-northwind-traders",
    name: "Northwind Traders",
    status: "Active",
    relationshipTypes: [], // unset relationship
    tags: ["Retail", "Seasonal"],
    billingAddress: { street: "500 Market Ave", city: "Boston", state: "MA", zip: "02110" },
    notes: "Seasonal ordering; no relationship classification yet.",
    accountingId: "QB-4471",
    defaultCurrency: "EUR",
    purchaseOrderRequired: true,
    invoiceDeliveryMethod: "EDI",
    paymentTerms: "COD",
    taxStatus: "TAXABLE",
    ageMs: 30_000, // just now (< 1 min)
  },
  {
    id: "demo-cust-05-blue-ridge-property",
    name: "Blue Ridge Property Group",
    status: "Prospect",
    relationshipTypes: ["CUSTOMER"],
    tags: ["Real Estate"],
    billingAddress: { street: "9 Summit Ct", city: "Asheville", state: "NC", zip: "28801" },
    notes: "Evaluating a facilities-wide service agreement.",
    defaultCurrency: "USD",
    purchaseOrderRequired: false,
    invoiceDeliveryMethod: "EMAIL",
    // paymentTerms + taxStatus intentionally absent (prospect, not yet set)
    ageMs: 2 * _MONTH,
  },
  {
    id: "demo-cust-06-pacific-coast-supply",
    name: "Pacific Coast Supply Co",
    status: "Prospect",
    relationshipTypes: ["VENDOR"],
    tags: ["Wholesale", "West Coast"],
    billingAddress: { street: "310 Cannery Row", city: "Monterey", state: "CA", zip: "93940" },
    // notes intentionally absent
    legacyId: "LEG-2007",
    defaultCurrency: "GBP",
    purchaseOrderRequired: true,
    invoiceDeliveryMethod: "PORTAL",
    paymentTerms: "NET_30",
    taxStatus: "UNKNOWN",
    ageMs: 9 * _DAY,
  },
  {
    id: "demo-cust-07-ironclad-manufacturing",
    name: "Ironclad Manufacturing",
    status: "Prospect",
    relationshipTypes: ["CUSTOMER", "VENDOR"], // both
    tags: ["Manufacturing"],
    // Deliberately minimal: no billingAddress, notes, external id, or any
    // commercial-profile field -- exercises the "many absent optional fields"
    // display path end to end.
    ageMs: 2 * _YEAR,
  },
  {
    id: "demo-cust-08-maple-leaf-distributors",
    name: "Maple Leaf Distributors",
    status: "Inactive",
    relationshipTypes: ["CUSTOMER"],
    tags: ["Dormant"],
    billingAddress: { street: "215 Birchwood Blvd", city: "Sydney", state: "NSW", zip: "2000" },
    notes: "Account dormant since last contract lapsed.",
    customerNumber: "MLD-556",
    defaultCurrency: "AUD",
    purchaseOrderRequired: false,
    invoiceDeliveryMethod: "MAIL",
    paymentTerms: "NET_60",
    taxStatus: "EXEMPT",
    ageMs: 5 * _MONTH,
  },
  {
    id: "demo-cust-09-old-town-hardware",
    name: "Old Town Hardware",
    status: "Inactive",
    relationshipTypes: [], // unset relationship
    // tags intentionally absent
    billingAddress: { street: "42 Main St", city: "Savannah", state: "GA", zip: "31401" },
    notes: "Legacy walk-in account; retained for history.",
    defaultCurrency: "USD",
    purchaseOrderRequired: false,
    // no invoiceDeliveryMethod / paymentTerms / taxStatus intentionally absent
    ageMs: 3 * _YEAR,
  },
  {
    id: "demo-cust-10-legacy-freight",
    name: "Legacy Freight Systems",
    status: "Archived",
    relationshipTypes: ["VENDOR"],
    tags: ["Archived", "Closed"],
    billingAddress: { street: "1 Depot Way", city: "Kansas City", state: "MO", zip: "64101" },
    notes: "Relationship closed; archived for audit trail.",
    erpId: "ERP-00019",
    defaultCurrency: "JPY",
    purchaseOrderRequired: true,
    invoiceDeliveryMethod: "EDI",
    paymentTerms: "NET_90",
    taxStatus: "TAXABLE",
    ageMs: 4 * _YEAR,
  },
];

// Customer Results Dashboard -- seeds the ten DEMO_CUSTOMERS via the Admin SDK
// (bypasses the client-gated accounts rules, same as every other fixture here).
// Only fields actually present on each fixture object are written -- absent
// optional fields are genuinely omitted (never written as null), so the
// dashboard/detail exercise their real "field absent" rendering. createdAt is
// staggered a little older than updatedAt for realism.
async function seedDemoCustomersFixture() {
  const now = Date.now();
  for (const c of DEMO_CUSTOMERS) {
    const { id, ageMs, ...fields } = c;
    const updatedAt = now - ageMs;
    const createdAt = updatedAt - 30 * _DAY; // created a month before its last update
    await db.doc(`accounts/${id}`).set({ ...fields, createdAt, updatedAt });
  }
}

// Work Order Wizard (Platform Task 1) -- ONE Account that has exactly one
// Location, so the driver's verify-wo-wizard can walk all four steps of the
// creation wizard (Step 2 requires a selectable location to advance). Seeded
// via the Admin SDK like every other fixture. Deliberately its own dedicated
// account (not reused from DASHBOARD/DEMO, which have no locations) with a
// distinctive, searchable name so GlobalSearch resolves it unambiguously in
// Step 1. Adds no reorder/inventory data.
export const WIZARD_FIXTURE = {
  accountId: "acct-wo-wizard",
  accountName: "Wizard Test Customer",
  locationId: "wo-wizard-loc-1",
  locationName: "Wizard Main Site",
};

async function seedWizardFixture() {
  const now = Date.now();
  await db.doc(`accounts/${WIZARD_FIXTURE.accountId}`).set({
    name: WIZARD_FIXTURE.accountName,
    status: "Active",
    relationshipTypes: ["CUSTOMER"],
    createdAt: now,
    updatedAt: now,
  });
  await db.doc(`locations/${WIZARD_FIXTURE.locationId}`).set({
    accountId: WIZARD_FIXTURE.accountId,
    name: WIZARD_FIXTURE.locationName,
    createdAt: now,
    updatedAt: now,
  });
}

// Contact CSV import (Issue #209) -- a DEDICATED account with exactly one
// pre-existing Contact, so verify-contact-csv-import can prove the duplicate
// policy (a CSV row matching this contact's email is SKIPPED, never overwritten)
// against a known-clean starting state independent of other fixtures' contacts.
export const CSV_IMPORT_FIXTURE = {
  accountId: "acct-csv-import",
  accountName: "CSV Import Co",
  existingContactId: "csv-existing-contact-1",
  existingContactName: "Existing Contact",
  existingContactEmail: "existing@csv.test",
};

async function seedCsvImportFixture() {
  const now = Date.now();
  await db.doc(`accounts/${CSV_IMPORT_FIXTURE.accountId}`).set({
    name: CSV_IMPORT_FIXTURE.accountName,
    status: "Active",
    relationshipTypes: ["CUSTOMER"],
    createdAt: now,
    updatedAt: now,
  });
  await db.doc(`contacts/${CSV_IMPORT_FIXTURE.existingContactId}`).set({
    accountId: CSV_IMPORT_FIXTURE.accountId,
    name: CSV_IMPORT_FIXTURE.existingContactName,
    email: CSV_IMPORT_FIXTURE.existingContactEmail,
    phone: null,
    role: null,
    isPrimary: true,
    createdAt: now,
    updatedAt: now,
  });
}

// Work Order wizard -- Customer picker (customer-search visibility). Accounts
// that all match "test", exercising every result state the picker must show:
//   - two IDENTICALLY named "Test Plumbing Co" accounts distinguished ONLY by
//     billing city/state + their location context (the duplicate-name case);
//   - "Testerson Electric" with NO billing address and NO locations -> secondary
//     line falls back to its external customer number, locations show "No
//     locations";
//   - "Best Test Services" with FOUR locations -> "+N more locations" overflow.
// Each carries its own `locations` (accountId-scoped) so the picker's ONE
// batched `accountId in [...]` query resolves them. Distinctive ids; realistic
// names; no raw ids surfaced by the UI.
export const WO_CUSTOMER_SEARCH_FIXTURE = {
  accounts: [
    {
      id: "wocs-test-plumbing-denver",
      name: "Test Plumbing Co",
      status: "Active",
      billingAddress: { street: "1420 Ridgeline Dr", city: "Denver", state: "CO", zip: "80202" },
      locations: [
        { id: "wocs-loc-tpden-main", name: "Main Shop", address: { city: "Denver", state: "CO" } },
        { id: "wocs-loc-tpden-north", name: "North Yard", address: { city: "Boulder", state: "CO" } },
      ],
    },
    {
      id: "wocs-test-plumbing-austin",
      name: "Test Plumbing Co", // duplicate name -- distinguished by billing + location
      status: "Prospect",
      billingAddress: { street: "88 Congress Ave", city: "Austin", state: "TX", zip: "73301" },
      locations: [{ id: "wocs-loc-tpaus-hq", name: "Austin HQ", address: { city: "Austin", state: "TX" } }],
    },
    {
      id: "wocs-testerson-electric",
      name: "Testerson Electric",
      status: "Active",
      customerNumber: "TEST-9001", // no billingAddress -> secondary falls back to this
      locations: [], // no locations -> "No locations"
    },
    {
      id: "wocs-best-test-services",
      name: "Best Test Services",
      status: "Active",
      billingAddress: { street: "9 Biscayne Blvd", city: "Miami", state: "FL", zip: "33101" },
      locations: [
        { id: "wocs-loc-bts-a", name: "Airport Depot", address: { city: "Miami", state: "FL" } },
        { id: "wocs-loc-bts-b", name: "Brickell Office", address: { city: "Miami", state: "FL" } },
        { id: "wocs-loc-bts-c", name: "Coral Gables Yard", address: { city: "Coral Gables", state: "FL" } },
        { id: "wocs-loc-bts-d", name: "Doral Warehouse", address: { city: "Doral", state: "FL" } },
      ],
    },
  ],
};

async function seedWoCustomerSearchFixture() {
  const now = Date.now();
  for (const a of WO_CUSTOMER_SEARCH_FIXTURE.accounts) {
    const { id, locations, ...fields } = a;
    await db.doc(`accounts/${id}`).set({
      ...fields,
      relationshipTypes: ["CUSTOMER"],
      createdAt: now,
      updatedAt: now,
    });
    for (const loc of locations) {
      await db.doc(`locations/${loc.id}`).set({
        accountId: id,
        name: loc.name,
        ...(loc.address ? { address: loc.address } : {}),
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

async function seedReorderRequestFixture(docId, { partId, status, currentOwner, assignedToUserId, createdAt }) {
  const isCancelled = status === "CANCELLED";
  await db.doc(`reorder_requests/${docId}`).set({
    partId,
    recommendationStatus: "READY",
    urgency: "HIGH",
    quantitySource: "ANALYTICS",
    recommendedQty: 5,
    requestedQty: 5,
    status,
    currentOwner,
    requestedBy: DRIVER_ACCOUNTS.admin.uid,
    createdAt,
    reviewedBy: DRIVER_ACCOUNTS.admin.uid,
    reviewedAt: createdAt,
    reviewDecision: "APPROVED",
    reviewNotes: null,
    assignedToUserId: assignedToUserId ?? null,
    assignedBy: assignedToUserId ? DRIVER_ACCOUNTS.admin.uid : null,
    assignedAt: assignedToUserId ? createdAt : null,
    purchasingStartedAt: status === "PURCHASING_IN_PROGRESS" ? createdAt : null,
    purchasingStartedBy: status === "PURCHASING_IN_PROGRESS" ? assignedToUserId : null,
    purchasingNotes: null,
    vendorContacted: null,
    expectedAvailabilityDate: null,
    lastPurchasingUpdateAt: null,
    lastPurchasingUpdateBy: null,
    purchaseOrderId: null,
    orderedBy: null,
    orderedAt: null,
    receivedBy: null,
    receivedAt: null,
    cancelledBy: isCancelled ? DRIVER_ACCOUNTS.admin.uid : null,
    cancelledAt: isCancelled ? createdAt : null,
    cancellationReason: isCancelled ? "Test fixture -- terminal sibling for notification identity verification" : null,
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
  });
}

async function seedNotificationIdentityFixture() {
  const now = Date.now();
  const currentOwnerByStatus = {
    PENDING_REVIEW: "INVENTORY",
    READY_FOR_PARTS_MANAGER: "PARTS_MANAGER",
    ASSIGNED_TO_PARTS_ASSOCIATE: "PARTS_ASSOCIATE",
    PURCHASING_IN_PROGRESS: "PARTS_ASSOCIATE",
  };
  const assignedToUserIdByStatus = {
    PENDING_REVIEW: null,
    READY_FOR_PARTS_MANAGER: null,
    ASSIGNED_TO_PARTS_ASSOCIATE: DRIVER_ACCOUNTS.admin.uid,
    PURCHASING_IN_PROGRESS: DRIVER_ACCOUNTS.admin.uid,
  };

  for (const c of Object.values(NOTIFICATION_IDENTITY_FIXTURE)) {
    const currentOwner = currentOwnerByStatus[c.status];
    const assignedToUserId = assignedToUserIdByStatus[c.status];

    // Active document -- older createdAt. Every notification/queue
    // link for this case must resolve here.
    await seedReorderRequestFixture(c.activeId, {
      partId: c.partId,
      status: c.status,
      currentOwner,
      assignedToUserId,
      createdAt: now - 60_000,
    });

    // Terminal sibling, same part, deliberately NEWER createdAt -- the
    // document the pre-fix, partId-only navigation would have
    // resolved to instead.
    await seedReorderRequestFixture(`${c.activeId}-terminal`, {
      partId: c.partId,
      status: "CANCELLED",
      currentOwner,
      assignedToUserId,
      createdAt: now,
    });
  }
}

async function seedCancelVoidFixture() {
  const now = Date.now();

  // A prior run of driver.mjs's verify-cancel-void command may have
  // already voided voidEligible against this same emulator instance
  // (the emulator holds state across repeated `node seed.mjs` calls
  // within one `emulators:start` session -- it's only `reorder_requests`/
  // `reorder_purchase_orders` this function unconditionally overwrites
  // below). voidPurchaseOrder()'s own voidRef.exists() guard would
  // then reject a second void attempt as "already been voided" even
  // though the Reorder Request side was reset back to ORDERED --
  // clearing any leftover void record first makes reseeding fully
  // deterministic, the same guarantee every other fixture in this file
  // already has by unconditionally overwriting its own documents.
  await db.doc(`reorder_purchase_order_voids/${CANCEL_VOID_FIXTURE.voidEligible.requestId}`).delete();

  // Cancel-eligible: ASSIGNED_TO_PARTS_ASSOCIATE, assigned to admin so
  // ReorderRequestStartPurchasing's Cancel action is reachable by the
  // same account driver.mjs signs in as (Cancel itself is
  // unrestricted to a specific individual -- isAdminOrDispatcher()
  // alone -- but the assignment still needs to exist for this status
  // to be reachable).
  await seedReorderRequestFixture(CANCEL_VOID_FIXTURE.cancelEligible.requestId, {
    partId: CANCEL_VOID_FIXTURE.cancelEligible.partId,
    status: CANCEL_VOID_FIXTURE.cancelEligible.status,
    currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: DRIVER_ACCOUNTS.admin.uid,
    createdAt: now,
  });

  // Void-eligible: ORDERED, assigned to admin (so the same account
  // satisfies BOTH Rules conditions -- isAdminOrDispatcher() AND
  // current assignee), with a linked reorder_purchase_orders document
  // already recorded -- Void's Purchase-Order-existence proof requires
  // one to exist before the void write is even attempted.
  const { requestId, partId } = CANCEL_VOID_FIXTURE.voidEligible;
  await db.doc(`reorder_requests/${requestId}`).set({
    partId,
    recommendationStatus: "READY",
    urgency: "HIGH",
    quantitySource: "ANALYTICS",
    recommendedQty: 3,
    requestedQty: 3,
    status: "ORDERED",
    currentOwner: "PARTS_ASSOCIATE",
    requestedBy: DRIVER_ACCOUNTS.admin.uid,
    createdAt: now,
    reviewedBy: DRIVER_ACCOUNTS.admin.uid,
    reviewedAt: now,
    reviewDecision: "APPROVED",
    reviewNotes: null,
    assignedToUserId: DRIVER_ACCOUNTS.admin.uid,
    assignedBy: DRIVER_ACCOUNTS.admin.uid,
    assignedAt: now,
    purchasingStartedAt: now,
    purchasingStartedBy: DRIVER_ACCOUNTS.admin.uid,
    purchasingNotes: null,
    vendorContacted: null,
    expectedAvailabilityDate: null,
    lastPurchasingUpdateAt: null,
    lastPurchasingUpdateBy: null,
    purchaseOrderId: requestId,
    orderedBy: DRIVER_ACCOUNTS.admin.uid,
    orderedAt: now,
    receivedBy: null,
    receivedAt: null,
    cancelledBy: null,
    cancelledAt: null,
    cancellationReason: null,
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
  });

  await db.doc(`reorder_purchase_orders/${requestId}`).set({
    reorderRequestId: requestId,
    partId,
    supplierName: "Driver Fixture Supplier",
    externalPoNumber: "DRIVER-PO-1",
    orderedQuantity: 3,
    orderedDate: new Date(now).toISOString().slice(0, 10),
    expectedArrivalDate: null,
    status: "ORDERED",
    createdBy: DRIVER_ACCOUNTS.admin.uid,
    createdAt: now,
  });
}

// Inventory Operational Queue, PR A (docs/specifications/inventory-
// operational-queue.md). One currently-assigned Reorder Request owned
// by a uid other than any signed-in driver account (cross-user
// oversight fixture), plus four Employees exercising the assignment
// picker's securityRole filter's four outcomes.
async function seedPrAFixture() {
  const now = Date.now();

  await seedReorderRequestFixture(PR_A_FIXTURE.otherUserAssignedRequest.requestId, {
    partId: PR_A_FIXTURE.otherUserAssignedRequest.partId,
    status: "ASSIGNED_TO_PARTS_ASSOCIATE",
    currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: PR_A_FIXTURE.otherUserAssignedRequest.assignedToUserId,
    createdAt: now,
  });

  // Linked Employee for the cross-user assignee above -- resolvable via
  // resolveActorDisplayName(), so "All Assigned Work"'s Assignee column
  // renders a real display name for this fixture, not the raw-uid
  // fallback (see PR_A_FIXTURE's own header comment for why this
  // matters for that specific assertion).
  const otherAssignee = PR_A_FIXTURE.otherAssigneeEmployee;
  await db.doc(`employees/${otherAssignee.employeeId}`).set({
    employeeId: otherAssignee.employeeId,
    displayName: otherAssignee.displayName,
    employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_ASSOCIATE"],
    userId: otherAssignee.userId,
    securityRole: "dispatcher",
    createdAt: now,
    updatedAt: now,
  });

  // Unresolvable-assignee fixture -- deliberately NO matching Employee
  // document anywhere for this uid (see PR_A_FIXTURE's own comment).
  await seedReorderRequestFixture(PR_A_FIXTURE.unresolvableAssigneeRequest.requestId, {
    partId: PR_A_FIXTURE.unresolvableAssigneeRequest.partId,
    status: "PURCHASING_IN_PROGRESS",
    currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: PR_A_FIXTURE.unresolvableAssigneeRequest.assignedToUserId,
    createdAt: now,
  });

  for (const emp of Object.values(PR_A_FIXTURE.securityRoleEmployees)) {
    await db.doc(`employees/${emp.employeeId}`).set({
      employeeId: emp.employeeId,
      displayName: emp.displayName,
      employmentStatus: "ACTIVE",
      operationalRoles: ["PARTS_ASSOCIATE"],
      // Non-null so requireLinkedUser's `where("userId", "!=", null)`
      // clause includes these fixtures -- doesn't need to resolve to a
      // real users/{uid} document, since the picker never reads one
      // (see PR_A_FIXTURE's own header comment above).
      userId: `driver-seed-securityrole-user-${emp.employeeId}`,
      // securityRole intentionally omitted entirely for the "missing"
      // fixture -- `"securityRole" in emp` is false, matching the exact
      // pre-A0 legacy-document shape this filter must also catch.
      ...(("securityRole" in emp) ? { securityRole: emp.securityRole } : {}),
      createdAt: now,
      updatedAt: now,
    });
  }
}

// Inventory Health / Parts Catalog separation (PR B, docs/specifications/
// inventory-operational-queue.md). Extracted from seed()'s body so
// driver.mjs's verify-inventory-health-catalog command can delete these
// two parts' inventory_transactions (emulator-only, via the exported
// `db` below) to deterministically render both Inventory Health tabs
// empty for the exact-empty-state-message assertions, then call this
// again to restore them before continuing -- rather than adding any
// production-visible test-only UI behavior to the app itself.
export async function seedLedgerTransactions() {
  // One RESERVED ledger transaction against a real catalog SKU
  // (TST-1001, data/partsCatalog.ts) -- no CONSUMED transaction at
  // all, so this part has ledger activity (shows up in the "Needs
  // Reorder" queue) but zero usage history, i.e. exactly the
  // NEEDS_PLANNING state this whole sprint exists to handle. Matches
  // this repo's own root-cause finding: this is real production
  // state, not a contrived edge case (docs/assessments/inventory-
  // zero-history-reorder-behavior.md).
  await db.doc("inventory_transactions/driver-seed-tx-1").set({
    workOrderId: "driver-seed-wo-1",
    partId: "TST-1001",
    type: "RESERVED",
    quantity: 2,
    timestamp: Date.now(),
  });

  // A second part (TST-1002) WITH real CONSUMED history -- exercises
  // the READY path (recommendationStatus: READY, urgency computed,
  // one-click submit), the contrasting case to TST-1001 above.
  //
  // Inventory Health / Parts Catalog separation (PR B) -- the "Show
  // All" tab this driver's submit-ready command used to fall back to
  // (per the run-field-ops-app-vite skill's own now-stale Gotcha:
  // "TST-1002's seeded usage came out LOW urgency in practice") is
  // REMOVED. Inventory Health now shows only Critical & High and
  // Needs Planning -- a LOW/MEDIUM-urgency READY part is no longer
  // reachable from either tab. Bumped total 30-day CONSUMED quantity
  // from 10 to 30 (avgDailyUsage 1.0/day, reorderPoint 8.5,
  // availableStock 6 <= reorderPoint) to deterministically land
  // TST-1002 in HIGH, with comfortable margin above the ~21.2-unit
  // HIGH threshold -- resolves the old gotcha instead of working
  // around it. This value is never asserted directly by any test --
  // every assertion checks the analytics engine's own computed output
  // (the rendered urgency badge/tab count), never this input.
  const now = Date.now();
  await db.doc("inventory_transactions/driver-seed-tx-2").set({
    workOrderId: "driver-seed-wo-2",
    partId: "TST-1002",
    type: "CONSUMED",
    quantity: 15,
    timestamp: now - 24 * 60 * 60 * 1000,
  });
  await db.doc("inventory_transactions/driver-seed-tx-3").set({
    workOrderId: "driver-seed-wo-3",
    partId: "TST-1002",
    type: "CONSUMED",
    quantity: 15,
    timestamp: now - 2 * 24 * 60 * 60 * 1000,
  });
}

// Customer/Account Business Model -- Customer PR 3, Service Activity.
// Seeds the SERVICE_ACTIVITY_FIXTURE Account + its fieldops_wos documents.
// createdAt is written as a JS Date -> Firestore Timestamp (what the client
// reads via .toDate()), staggered so index 0 is the newest row.
async function seedServiceActivityFixture() {
  const base = Date.now();
  await db.doc(`accounts/${SERVICE_ACTIVITY_FIXTURE.accountId}`).set({
    name: "Service Activity Co",
    status: "Active",
    relationshipTypes: ["CUSTOMER"],
    createdAt: base,
    updatedAt: base,
  });
  await Promise.all(
    SERVICE_ACTIVITY_FIXTURE.statuses.map((status, i) => {
      const id = `sa-wo-${String(i).padStart(2, "0")}`;
      return db.doc(`fieldops_wos/${id}`).set({
        woNumber: `WO-SA-${String(i).padStart(3, "0")}`,
        status,
        customerId: SERVICE_ACTIVITY_FIXTURE.accountId,
        locationId: "sa-loc-1",
        priority: 3,
        type: "SERVICE_CALL",
        createdAt: new Date(base - i * 60_000),
        updatedAt: new Date(base - i * 60_000),
      });
    })
  );
}

// Inventory Operational Queue, PR C -- Reorder Request History. Reuses
// seedReorderRequestFixture() (above) directly -- History's fixture is
// structurally the same "one reorder_requests document" shape every
// other fixture in this file already writes, just with a terminal
// `status` and no `currentOwner`/`assignedToUserId` (no owner/assignee
// -- once a request reaches a terminal status, it isn't queued for
// anyone anymore). `createdAt` staggered so HISTORY_FIXTURE.statuses'
// index 0 is the newest, matching that constant's own documented
// index-0-is-newest convention.
export async function seedHistoryFixture() {
  // History has no per-entity scope (unlike Service Activity's
  // accountId filter) -- it queries the WHOLE reorder_requests
  // collection for terminal statuses, so it correctly, legitimately
  // also surfaces OTHER fixtures' terminal-status documents (e.g.
  // NOTIFICATION_IDENTITY_FIXTURE's "-terminal" CANCELLED siblings,
  // always seeded a few moments before this function runs in seed()'s
  // own call order). A large forward offset (not just Date.now())
  // guarantees every item in this 14-row, 60s-staggered fixture sorts
  // newer than anything else seeded moments earlier in the same run,
  // so driver.mjs's exact-order assertions aren't contaminated by that
  // legitimate cross-fixture overlap -- this is a fixture-ordering
  // concern only, not something the application needs to know or care
  // about (a real production reorder_requests collection has exactly
  // this same "many unrelated terminal requests, ordered by real
  // createdAt" shape).
  const base = Date.now() + 1_000_000;
  await Promise.all(
    HISTORY_FIXTURE.statuses.map((status, i) =>
      seedReorderRequestFixture(`${HISTORY_FIXTURE.requestIdPrefix}-${String(i).padStart(2, "0")}`, {
        partId: HISTORY_FIXTURE.partId,
        status,
        currentOwner: null,
        assignedToUserId: null,
        createdAt: base - i * 60_000,
      })
    )
  );
}

// Account Commercial Profile -- PR 1. Seeds the three Accounts + owner
// Employee + Contacts the COMMERCIAL_PROFILE_FIXTURE describes. All via the
// Admin SDK (bypasses the client-gated accounts/contacts/employees rules,
// same as every other fixture here). The owner Employee is ACTIVE with a
// linked userId so it is BOTH directory-resolvable (useEmployeeDirectory)
// AND selectable in the edit form's picker (buildAssignableEmployeesQuery:
// employmentStatus ACTIVE + userId != null).
async function seedCommercialProfileFixture() {
  const now = Date.now();
  const F = COMMERCIAL_PROFILE_FIXTURE;

  await db.doc(`employees/${F.ownerEmployee.employeeId}`).set({
    employeeId: F.ownerEmployee.employeeId,
    displayName: F.ownerEmployee.displayName,
    employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_ASSOCIATE"],
    userId: F.ownerEmployee.userId,
    securityRole: "dispatcher",
    createdAt: now,
    updatedAt: now,
  });

  await db.doc(`contacts/${F.resolvedBillingContact.id}`).set({
    accountId: F.resolvedAccountId,
    name: F.resolvedBillingContact.name,
    isPrimary: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.doc(`contacts/${F.editBillingContact.id}`).set({
    accountId: F.editAccountId,
    name: F.editBillingContact.name,
    isPrimary: true,
    createdAt: now,
    updatedAt: now,
  });

  // A COMPLETE assignor snapshot (resolved Employee), reused by the two
  // pre-populated accounts so their accountOwner is itself a valid, complete
  // Person Assignment -- the display/identity states under test are about the
  // ASSIGNEE resolving or not, independent of the assignor.
  const completeAssignor = {
    assignedByEmployeeId: "driver-emp-parts-manager",
    assignedByUserId: DRIVER_ACCOUNTS.eligiblePartsManager.uid,
    assignedByDisplayName: "Driver Parts Manager",
  };

  await db.doc(`accounts/${F.resolvedAccountId}`).set({
    name: "Resolved Profile Co",
    status: "Active",
    relationshipTypes: ["CUSTOMER"],
    defaultCurrency: "USD",
    purchaseOrderRequired: true,
    invoiceDeliveryMethod: "EMAIL",
    billingContact: { contactId: F.resolvedBillingContact.id },
    accountOwner: {
      assignedToEmployeeId: F.ownerEmployee.employeeId,
      assignedToUserId: F.ownerEmployee.userId,
      assignedToDisplayName: F.staleOwnerSnapshotName, // stored snapshot; UI must show the CURRENT name instead
      ...completeAssignor,
      assignedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  });

  await db.doc(`accounts/${F.unknownAccountId}`).set({
    name: "Unknown Profile Co",
    status: "Active",
    relationshipTypes: ["CUSTOMER"],
    defaultCurrency: "GBP",
    purchaseOrderRequired: false,
    invoiceDeliveryMethod: "MAIL",
    billingContact: { contactId: F.foreignContactId }, // no Contact with this id on this Account
    accountOwner: {
      assignedToEmployeeId: "cp-owner-ghost-emp",
      assignedToUserId: F.ghostOwnerUserId, // no Employee links to this userId
      assignedToDisplayName: "Ghost Owner (snapshot only)",
      ...completeAssignor,
      assignedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  });

  await db.doc(`accounts/${F.editAccountId}`).set({
    name: "Editable Profile Co",
    status: "Active",
    relationshipTypes: ["CUSTOMER"],
    createdAt: now,
    updatedAt: now,
  });
}

// Account Commercial Profile -- PR 2. Seeds the two GOVERNED_FIELDS_FIXTURE
// Accounts via the Admin SDK (bypasses the client-gated accounts rules, same
// as every other fixture here). Deliberately NO accountOwner/billingContact
// on either -- see the fixture's header comment for why (clean Rules-denial
// exercise in the edit form).
async function seedGovernedFieldsFixture() {
  const now = Date.now();
  const F = GOVERNED_FIELDS_FIXTURE;

  await db.doc(`accounts/${F.governedAccountId}`).set({
    name: "Governed Fields Co",
    status: "Active",
    relationshipTypes: ["CUSTOMER"],
    defaultCurrency: "USD",
    paymentTerms: F.paymentTerms,
    taxStatus: F.taxStatus,
    createdAt: now,
    updatedAt: now,
  });

  // No taxStatus stored at all -> the Commercial Profile section must render
  // "Tax status: UNKNOWN" (the absent => UNKNOWN safe default, never TAXABLE).
  await db.doc(`accounts/${F.safeDefaultAccountId}`).set({
    name: "Safe Default Co",
    status: "Active",
    relationshipTypes: ["CUSTOMER"],
    defaultCurrency: "USD",
    createdAt: now,
    updatedAt: now,
  });
}

// Issue #100 -- PR 0. Seeds the five technician-role fixtures above:
// three eligible (one operationalRoles entry each), one ineligible
// (real link, ACTIVE, zero eligible roles), one broken-linkage
// (employeeId points at a document that is never created). No
// reorder_requests/inventory_transactions/inventory_actions documents
// are seeded here -- PR 0 adds no query/Rules change that would ever
// read them for these accounts; later PRs' own fixtures cover that.
async function seedIssue100RoleFixtures() {
  const now = Date.now();

  // securityRole is a denormalized mirror of the linked users/{uid}.role
  // (docs/PROJECT_ARCHITECTURE.md's Person Assignment Platform Service
  // Standard) -- useAssignableEmployees()'s PARTS_ASSOCIATE-eligibility
  // query (buildAssignableEmployeesQuery()) filters only on
  // employmentStatus/operationalRoles/userId, so any ACTIVE Employee
  // with operationalRoles containing "PARTS_ASSOCIATE" and a linked
  // userId is included in its result regardless of securityRole --
  // EmployeeAssignmentPicker.jsx's own client-side
  // applyPartsAssociateSecurityRoleEligibility() then separately flags
  // any candidate whose securityRole is missing/null/invalid-enum as a
  // data-quality warning. Without this field, driver-emp-technician-
  // parts-associate below was silently inflating that warning count
  // from PR_A_FIXTURE's own intentional 2 to 3, since it matches this
  // exact query scope. All four securityRole values here mirror each
  // fixture's own linked users/{uid}.role ("technician") exactly, same
  // as functions/scripts/provisionEmployeeAccess.js's production
  // invariant.
  await db.doc("employees/driver-emp-technician-parts-manager").set({
    employeeId: "driver-emp-technician-parts-manager",
    displayName: "Driver Technician Parts Manager",
    employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_MANAGER"],
    securityRole: "technician",
    userId: DRIVER_ACCOUNTS.technicianPartsManager.uid,
    createdAt: now,
    updatedAt: now,
  });
  await db.doc(`users/${DRIVER_ACCOUNTS.technicianPartsManager.uid}`).set({
    role: "technician",
    employeeId: "driver-emp-technician-parts-manager",
  });

  await db.doc("employees/driver-emp-technician-warehouse-manager").set({
    employeeId: "driver-emp-technician-warehouse-manager",
    displayName: "Driver Technician Warehouse Manager",
    employmentStatus: "ACTIVE",
    operationalRoles: ["WAREHOUSE_MANAGER"],
    securityRole: "technician",
    userId: DRIVER_ACCOUNTS.technicianWarehouseManager.uid,
    createdAt: now,
    updatedAt: now,
  });
  await db.doc(`users/${DRIVER_ACCOUNTS.technicianWarehouseManager.uid}`).set({
    role: "technician",
    employeeId: "driver-emp-technician-warehouse-manager",
  });

  await db.doc("employees/driver-emp-technician-parts-associate").set({
    employeeId: "driver-emp-technician-parts-associate",
    displayName: "Driver Technician Parts Associate",
    employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_ASSOCIATE"],
    securityRole: "technician",
    userId: DRIVER_ACCOUNTS.technicianPartsAssociate.uid,
    createdAt: now,
    updatedAt: now,
  });
  await db.doc(`users/${DRIVER_ACCOUNTS.technicianPartsAssociate.uid}`).set({
    role: "technician",
    employeeId: "driver-emp-technician-parts-associate",
  });

  await db.doc("employees/driver-emp-technician-ineligible").set({
    employeeId: "driver-emp-technician-ineligible",
    displayName: "Driver Technician Ineligible",
    employmentStatus: "ACTIVE",
    operationalRoles: [],
    securityRole: "technician",
    userId: DRIVER_ACCOUNTS.technicianIneligible.uid,
    createdAt: now,
    updatedAt: now,
  });
  await db.doc(`users/${DRIVER_ACCOUNTS.technicianIneligible.uid}`).set({
    role: "technician",
    employeeId: "driver-emp-technician-ineligible",
  });

  // No employees/driver-emp-technician-broken-link-does-not-exist
  // document is ever written -- that's the entire point of this
  // fixture.
  await db.doc(`users/${DRIVER_ACCOUNTS.technicianBrokenLink.uid}`).set({
    role: "technician",
    employeeId: "driver-emp-technician-broken-link-does-not-exist",
  });

  // Issue #100 PR 3b -- multi-role union fixture (see DRIVER_ACCOUNTS'
  // own comment above). Two eligible operationalRoles -> both the
  // "Warehouse Manager" and "My Purchasing" subnav items must render
  // simultaneously, no exclusivity/precedence between them.
  await db.doc("employees/driver-emp-technician-multi-role").set({
    employeeId: "driver-emp-technician-multi-role",
    displayName: "Driver Technician Multi Role",
    employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_ASSOCIATE", "WAREHOUSE_MANAGER"],
    securityRole: "technician",
    userId: DRIVER_ACCOUNTS.technicianMultiRole.uid,
    createdAt: now,
    updatedAt: now,
  });
  await db.doc(`users/${DRIVER_ACCOUNTS.technicianMultiRole.uid}`).set({
    role: "technician",
    employeeId: "driver-emp-technician-multi-role",
  });
}

// Inventory Health / Parts Catalog separation (PR B) -- exported so
// driver.mjs can delete/restore inventory_transactions documents
// directly (Admin SDK, emulator-only) for the empty-state assertions
// above. Not used for any other purpose -- every other driver.mjs
// interaction with the app goes through the real signed-in browser
// session, never this direct Admin SDK handle.
// ============================================================================
// Issue #232 unit E4 -- Equipment & Installed Asset Management fixtures.
//
// Additive: every id below is new, and nothing here mutates an existing fixture.
//
// THE INVALID CASES ARE NOT SEEDED. Per the Specification, an Equipment's Location
// must belong to its owning Account (§4) -- so a cross-Account Equipment document is
// a state the system must never hold, and writing one as "baseline data" would seed
// exactly the corruption E3's Rules exist to prevent (and would leave later readers
// unable to tell a fixture from a real defect). Instead `EQUIPMENT_FIXTURE.attempts`
// describes operations later Rules/browser tests ATTEMPT and must see DENIED. The
// only documents created here are valid ones.
//
// Timestamps are relative offsets from a single `now`, so Service History ordering is
// deterministic across reseeds even though the absolute values move. Every write is a
// .set() on a fixed id, so reseeding is idempotent and repeatable.
export const EQUIPMENT_FIXTURE = {
  // Two Accounts, so cross-Account denial has a real second tenant to point at.
  alphaAccountId: "acct-equip-alpha",
  betaAccountId: "acct-equip-beta",
  // Alpha owns two Locations -- the move destination has to be a SIBLING Location of
  // the same Account for a move to be legal at all.
  alphaLocation1Id: "equip-loc-alpha-1",
  alphaLocation2Id: "equip-loc-alpha-2",
  betaLocation1Id: "equip-loc-beta-1",

  // Duplicate names are LEGAL (§8: the display name is the human reference, not a
  // unique key). Two Equipment share this name at different Locations of the same
  // Account, so any surface that treats a name as an identifier breaks here.
  duplicateName: "Rooftop Unit",

  // --- valid Equipment -----------------------------------------------------
  activeWithHistoryId: "equip-alpha-rtu-1",     // ACTIVE, duplicate name, 3 linked WOs
  activeNoHistoryId: "equip-alpha-rtu-2",       // ACTIVE, duplicate name, ZERO linked WOs
  inactiveId: "equip-alpha-chiller",            // INACTIVE
  retiredId: "equip-alpha-boiler",              // RETIRED (reachable only via trusted retire)
  movedId: "equip-alpha-ahu-moved",             // ACTIVE, now at Location 2, serviced at 1
  sparseId: "equip-alpha-sparse",               // every optional field absent
  betaEquipmentId: "equip-beta-rtu-1",          // other tenant -- must never be readable cross-Account

  // --- personas ------------------------------------------------------------
  assignedTechnicianId: "equip-tech-assigned",
  unassignedTechnicianId: "equip-tech-unassigned",

  // --- linked Work Orders ---------------------------------------------------
  historyWorkOrderIds: ["equip-wo-rtu1-newest", "equip-wo-rtu1-middle", "equip-wo-rtu1-oldest"],
  movedWorkOrderIds: ["equip-wo-moved-after", "equip-wo-moved-before"],
  unassignedTechWorkOrderId: "equip-wo-unassigned-tech",  // real WO, links to NO Equipment
  betaWorkOrderId: "equip-wo-beta",

  // --- operations later tests must see DENIED (never written here) ----------
  attempts: {
    // A Location belonging to a DIFFERENT Account than the Equipment names.
    crossAccountCreate: {
      equipmentId: "equip-attempt-cross-account",
      accountId: "acct-equip-alpha",
      locationId: "equip-loc-beta-1",
      name: "Cross-Account Attempt",
    },
    // A Location that does not exist at all.
    danglingLocationCreate: {
      equipmentId: "equip-attempt-dangling-location",
      accountId: "acct-equip-alpha",
      locationId: "equip-loc-does-not-exist",
      name: "Dangling Location Attempt",
    },
    // An ordinary edit trying to re-own / move / re-status (§4: denied by Rules,
    // independently of the client guard E2 already applies).
    reownEdit: { equipmentId: "equip-alpha-rtu-1", accountId: "acct-equip-beta" },
    moveViaEdit: { equipmentId: "equip-alpha-rtu-1", locationId: "equip-loc-alpha-2" },
    retireViaEdit: { equipmentId: "equip-alpha-rtu-1", status: "RETIRED" },
    // Trusted/audit field injection from a client.
    trustedFieldInjection: {
      equipmentId: "equip-alpha-rtu-1",
      fields: { movedBy: "equip-tech-assigned", movedAt: 1, auditEventId: "forged", retiredBy: "forged" },
    },
    // Deletes are ALWAYS denied, for every principal including admin (§11).
    deleteAny: { equipmentId: "equip-alpha-rtu-1" },
    // Self-scope: the unassigned technician reaching for Equipment they hold no
    // assignment to, and the beta tenant's Equipment from an alpha-scoped principal.
    unassignedTechnicianRead: { equipmentId: "equip-alpha-rtu-1" },
    crossTenantRead: { equipmentId: "equip-beta-rtu-1" },
  },
};

async function seedEquipmentFixture() {
  const F = EQUIPMENT_FIXTURE;
  const now = Date.now();

  // -- Accounts + Locations (all relationships VALID) ------------------------
  await db.doc(`accounts/${F.alphaAccountId}`).set({
    name: "Alpha Facilities Co",
    status: "Active",
    relationshipTypes: ["CUSTOMER"],
    defaultCurrency: "USD",
    createdAt: now,
    updatedAt: now,
  });
  await db.doc(`accounts/${F.betaAccountId}`).set({
    name: "Beta Property Group",
    status: "Active",
    relationshipTypes: ["CUSTOMER"],
    defaultCurrency: "USD",
    createdAt: now,
    updatedAt: now,
  });

  for (const [id, accountId, name] of [
    [F.alphaLocation1Id, F.alphaAccountId, "Alpha -- Main Plant"],
    [F.alphaLocation2Id, F.alphaAccountId, "Alpha -- North Annex"],
    [F.betaLocation1Id, F.betaAccountId, "Beta -- Harbor Tower"],
  ]) {
    await db.doc(`locations/${id}`).set({ accountId, name, createdAt: now, updatedAt: now });
  }

  // -- Equipment -------------------------------------------------------------
  // Manufacturer/model/serial variations across the set: differing manufacturers,
  // same manufacturer with different models, and serials whose casing/format differ,
  // so search and disambiguation have something real to separate.
  const equipment = [
    {
      id: F.activeWithHistoryId, locationId: F.alphaLocation1Id, name: F.duplicateName,
      status: "ACTIVE", manufacturer: "Carrier", model: "48TCED12", serialNumber: "SN-ALPHA-0001",
      assetTag: "AT-1001", installedDate: "2019-04-02", warrantyExpiresDate: "2029-04-02",
      notes: "Quarterly PM. Duplicate display name with the North Annex unit -- deliberate.",
    },
    {
      // Same NAME as the record above, different Location: proves a name is not an id.
      id: F.activeNoHistoryId, locationId: F.alphaLocation2Id, name: F.duplicateName,
      status: "ACTIVE", manufacturer: "Trane", model: "Precedent 4TCC3", serialNumber: "sn-alpha-0002",
      assetTag: "AT-1002", installedDate: "2021-09-15", warrantyExpiresDate: null,
      notes: null,
    },
    {
      id: F.inactiveId, locationId: F.alphaLocation1Id, name: "Basement Chiller",
      status: "INACTIVE", manufacturer: "York", model: "YCAL0080", serialNumber: "SN-ALPHA-0003",
      assetTag: "AT-1003", installedDate: "2016-01-20", warrantyExpiresDate: "2021-01-20",
      notes: "Isolated pending compressor replacement.",
    },
    {
      // RETIRED is reachable in production ONLY through the trusted, audited retire
      // action (§5) -- seeded directly here because E4 has no trusted writer to call
      // (Issue #15) and the retired-state surfaces still need a record to render.
      id: F.retiredId, locationId: F.alphaLocation2Id, name: "Annex Boiler",
      status: "RETIRED", manufacturer: "Lochinvar", model: "CBN1501", serialNumber: "SN-ALPHA-0004",
      assetTag: "AT-1004", installedDate: "2008-11-05", warrantyExpiresDate: "2013-11-05",
      notes: "Decommissioned; retained for service history.",
    },
    {
      // Valid moved-equipment CONTEXT: currently installed at Location 2, but its
      // older Work Order was performed while it was at Location 1 -- so its Service
      // History legitimately spans two Locations. No audit/move record is invented
      // here: the move Audit Event is trusted-writer output (§5, E19/#15-gated), and
      // fabricating one would forge exactly the evidence the audit trail exists to be.
      id: F.movedId, locationId: F.alphaLocation2Id, name: "Air Handler 2",
      status: "ACTIVE", manufacturer: "Carrier", model: "39M", serialNumber: "SN-ALPHA-0005",
      assetTag: "AT-1005", installedDate: "2020-06-11", warrantyExpiresDate: "2030-06-11",
      notes: "Relocated from Main Plant to North Annex.",
    },
    {
      // Every optional field absent -- not null, ABSENT. Proves the read surfaces
      // handle a minimal record without inventing defaults.
      id: F.sparseId, locationId: F.alphaLocation1Id, name: "Unlabeled Pump",
      status: "ACTIVE",
    },
  ];

  for (const e of equipment) {
    const { id, ...rest } = e;
    await db.doc(`equipment/${id}`).set({
      accountId: F.alphaAccountId,
      ...rest,
      createdAt: now,
      updatedAt: now,
    });
  }

  // The other tenant's Equipment: the target of cross-Account read denial.
  await db.doc(`equipment/${F.betaEquipmentId}`).set({
    accountId: F.betaAccountId,
    locationId: F.betaLocation1Id,
    name: "Harbor Rooftop",
    status: "ACTIVE",
    manufacturer: "Lennox",
    model: "KGA092",
    serialNumber: "SN-BETA-0001",
    assetTag: "AT-2001",
    createdAt: now,
    updatedAt: now,
  });

  // -- Technician personas ---------------------------------------------------
  // users/{uid}.technicianId is what fieldops_wos' isOwnTechnician() reads; the
  // fieldops_technicians document is the directory entry the app resolves names from.
  for (const [acct, technicianId, displayName] of [
    [DRIVER_ACCOUNTS.equipmentTechAssigned, F.assignedTechnicianId, "Equip Assigned Tech"],
    [DRIVER_ACCOUNTS.equipmentTechUnassigned, F.unassignedTechnicianId, "Equip Unassigned Tech"],
  ]) {
    await db.doc(`users/${acct.uid}`).set({ role: "technician", technicianId });
    await db.doc(`fieldops_technicians/${technicianId}`).set({
      name: displayName,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  // -- Work Orders linking to Equipment --------------------------------------
  // Newest first by createdAt, so equipmentServiceHistory()'s ordering is pinned.
  const [newest, middle, oldest] = F.historyWorkOrderIds;
  const linked = [
    { id: newest, equipmentId: F.activeWithHistoryId, locationId: F.alphaLocation1Id, status: "COMPLETED", type: "SERVICE_CALL", woNumber: "WO-EQ-001", age: 30 * _DAY },
    { id: middle, equipmentId: F.activeWithHistoryId, locationId: F.alphaLocation1Id, status: "COMPLETED", type: "PM", woNumber: "WO-EQ-002", age: 200 * _DAY },
    { id: oldest, equipmentId: F.activeWithHistoryId, locationId: F.alphaLocation1Id, status: "CANCELLED", type: "SERVICE_CALL", woNumber: "WO-EQ-003", age: 2 * _YEAR },
    // The moved unit: the newer WO is at its CURRENT Location, the older at its
    // previous one -- history that legitimately spans Locations.
    { id: F.movedWorkOrderIds[0], equipmentId: F.movedId, locationId: F.alphaLocation2Id, status: "COMPLETED", type: "PM", woNumber: "WO-EQ-004", age: 10 * _DAY },
    { id: F.movedWorkOrderIds[1], equipmentId: F.movedId, locationId: F.alphaLocation1Id, status: "COMPLETED", type: "SERVICE_CALL", woNumber: "WO-EQ-005", age: 1 * _YEAR },
  ];

  for (const wo of linked) {
    await db.doc(`fieldops_wos/${wo.id}`).set({
      woNumber: wo.woNumber,
      status: wo.status,
      customerId: F.alphaAccountId,
      locationId: wo.locationId,
      equipmentId: wo.equipmentId,
      assignedTechId: F.assignedTechnicianId,
      priority: 3,
      type: wo.type,
      createdAt: new Date(now - wo.age),
      updatedAt: new Date(now - wo.age),
    });
  }

  // A real Work Order for the unassigned technician that links to NO Equipment: they
  // are a legitimate, well-formed technician with work of their own -- they simply
  // hold no assignment reaching any Equipment. Denial here is about SCOPE, not shape.
  await db.doc(`fieldops_wos/${F.unassignedTechWorkOrderId}`).set({
    woNumber: "WO-EQ-006",
    status: "ASSIGNED",
    customerId: F.alphaAccountId,
    locationId: F.alphaLocation1Id,
    assignedTechId: F.unassignedTechnicianId,
    priority: 3,
    type: "SERVICE_CALL",
    createdAt: new Date(now - _DAY),
    updatedAt: new Date(now - _DAY),
  });

  // The other tenant's Work Order, assigned to the SAME technician as alpha's work:
  // proves cross-Account Equipment denial cannot be satisfied merely by holding some
  // assignment somewhere.
  await db.doc(`fieldops_wos/${F.betaWorkOrderId}`).set({
    woNumber: "WO-EQ-007",
    status: "COMPLETED",
    customerId: F.betaAccountId,
    locationId: F.betaLocation1Id,
    equipmentId: F.betaEquipmentId,
    assignedTechId: F.assignedTechnicianId,
    priority: 3,
    type: "SERVICE_CALL",
    createdAt: new Date(now - 5 * _DAY),
    updatedAt: new Date(now - 5 * _DAY),
  });
}

export { db };

// Customer Results Dashboard -- seeds DASHBOARD_FIXTURE's four accounts (one per
// status, varied relationships/tags) via the Admin SDK.
async function seedDashboardFixture() {
  const now = Date.now();
  for (const a of DASHBOARD_FIXTURE.accounts) {
    await db.doc(`accounts/${a.id}`).set({
      name: a.name,
      status: a.status,
      relationshipTypes: a.relationshipTypes,
      tags: a.tags,
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function seed() {
  for (const acct of Object.values(DRIVER_ACCOUNTS)) {
    await ensureAuthUser(acct);
  }

  await db.doc(`users/${DRIVER_ACCOUNTS.admin.uid}`).set({ role: "admin" });

  await db.doc("employees/driver-emp-parts-manager").set({
    employeeId: "driver-emp-parts-manager",
    displayName: "Driver Parts Manager",
    employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_MANAGER"],
    userId: DRIVER_ACCOUNTS.eligiblePartsManager.uid,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  // ROLES.DISPATCHER, not ROLES.TECHNICIAN -- discovered live via the
  // driver: navConfig.js's ROLE_NAV_ACCESS gates the "Inventory" nav
  // item to admin/dispatcher only, so a pure technician-role user
  // can't reach this screen through navigation at all regardless of
  // Employee operationalRoles (a separate, real UX gap, not fixed
  // here -- see SKILL.md's Gotchas). dispatcher has nav access AND
  // still exercises RequestReorderControl's actual eligibility check
  // (role === "admin" || operationalRoles.includes(...) -- blind to
  // isAdminOrDispatcher()), same scenario PR 2's Rules test already
  // covers ("dispatcher whose linked Employee has operationalRoles:
  // WAREHOUSE_MANAGER").
  await db.doc(`users/${DRIVER_ACCOUNTS.eligiblePartsManager.uid}`).set({
    role: "dispatcher",
    employeeId: "driver-emp-parts-manager",
  });

  await db.doc(`users/${DRIVER_ACCOUNTS.ineligibleDispatcher.uid}`).set({ role: "dispatcher" });

  // Invalid from the moment this document is first ever created -- see
  // DRIVER_ACCOUNTS.queryFailureProbe's own header comment for why this
  // must never be mutated after this point.
  await db.doc(`users/${DRIVER_ACCOUNTS.queryFailureProbe.uid}`).set({ role: "invalid_role_for_query_failure_probe" });

  await seedLedgerTransactions();

  // A legacy-shape Reorder Request -- no requestedQty/recommendationStatus/
  // quantitySource key at all (the exact shape createReorderRequest()
  // wrote before PR 3, and what the still-live PR #91 transitional
  // rules branch still accepts). status READY_FOR_PARTS_MANAGER so it
  // renders in PartsList.jsx's "Parts Manager Queue" table -- proves
  // getDisplayQty()'s fallback (domain/inventoryReorderRequests.js)
  // live, in the actual browser, not just via the standalone assertion
  // script PR #92's Final Review fix was verified with.
  await db.doc("reorder_requests/driver-seed-legacy-request").set({
    partId: "TST-1003",
    urgency: "HIGH",
    recommendedQty: 7,
    status: "READY_FOR_PARTS_MANAGER",
    currentOwner: "PARTS_MANAGER",
    requestedBy: DRIVER_ACCOUNTS.admin.uid,
    createdAt: Date.now(),
    reviewedBy: DRIVER_ACCOUNTS.admin.uid,
    reviewedAt: Date.now(),
    reviewDecision: "APPROVED",
    reviewNotes: null,
  });

  await seedNotificationIdentityFixture();
  await seedCancelVoidFixture();
  await seedPrAFixture();
  await seedServiceActivityFixture();
  await seedHistoryFixture();
  await seedCommercialProfileFixture();
  await seedGovernedFieldsFixture();
  await seedDashboardFixture();
  await seedDemoCustomersFixture();
  await seedWizardFixture();
  await seedCsvImportFixture();
  await seedWoCustomerSearchFixture();
  await seedIssue100RoleFixtures();
  await seedEquipmentFixture();

  console.log("Seeded driver accounts:");
  for (const [key, acct] of Object.entries(DRIVER_ACCOUNTS)) {
    console.log(`  ${key}: ${acct.email} / ${acct.password} (uid ${acct.uid})`);
  }
}

// Only self-run when executed directly (`node seed.mjs`) -- driver.mjs
// imports DRIVER_ACCOUNTS (email/password only, uid not needed there)
// without triggering a reseed on every command. fileURLToPath()
// comparison (not a raw `file://` string template) because Windows
// file:// URLs have a third slash before the drive letter
// (file:///D:/...) that a naive template literal comparison misses --
// confirmed live: the naive version silently never matched, so `node
// seed.mjs` printed nothing and seeded nothing.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
