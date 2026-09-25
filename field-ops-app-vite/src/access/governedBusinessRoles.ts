// GENERATED FILE — DO NOT EDIT.
//
// Generated from the canonical EOS access contract by scripts/syncAccessContracts.mjs.
// Edit the canonical source under functions/src/access/ and re-run the generator;
// edits made here are overwritten and CI fails on drift.

// Enterprise Access & Administration Platform (Issue #226) -- eight
// governed business Role definitions, added per Owner direction on
// Issue #226 (two comments dated 2026-07-16, main head
// `d4bae4b54496a515cf60cfc9018409559d98ea02`). Fixed by docs/
// specifications/enterprise-access-and-administration-platform.md §26
// and sequenced by docs/implementation-plans/enterprise-access-and-
// administration-platform.md §21 (Row 1a).
//
// These are NOT compatibility Roles -- see compatibilityRoles.ts for
// the three seeded `admin`/`dispatcher`/`technician` Roles that
// reproduce today's raw-role matrix exactly and serve as the shadow-
// mode parity oracle (Spec §7/§18). Deliberately kept in a SEPARATE
// module so this file's inert, new-capability content never blurs that
// file's own narrow, byte-for-byte-reproduction scope.
//
// PURE, dependency-free data module, same posture as
// compatibilityRoles.ts: declaring these Role objects grants nothing to
// anyone. No Rule/Function/claim reads this yet; `AdminRolesPermissions.jsx`'s
// ASSIGNABLE_ROLES still derives from COMPATIBILITY_ROLES only (Spec
// §26.3). Every Permission id referenced below already exists in
// permissionCatalog.ts -- this file registers no new capability id;
// where a role's stated mapping principle names a capability with no
// existing id, that is recorded as a catalog gap in Spec §26.4, not
// granted here via a substitute id (see that section for the full list).
//
// SHARED EOS ACCESS CONTRACT. This module exists in both the Functions and
// frontend packages because there is no shared-module tooling in this repo. It is
// maintained as ONE canonical source and mechanically synchronized by
// scripts/syncAccessContracts.mjs -- never by hand-editing two copies.
import type { Role } from "../types/access";
import { ADMIN_ROLE } from "./compatibilityRoles";
import { PERMISSION_CATALOG } from "./permissionCatalog";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE OWNER CAPABILITY CONTRACT (Owner ruling A, 2026-09-24 -- NARROW, do not widen)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// WHAT WAS WRONG. Owner's grant used to be defined as `[...ADMIN_ROLE.permissions, ...reports]`,
// on the stated reasoning that deriving it "can never silently drift apart from ADMIN_ROLE".
// It cannot drift, which is true and is exactly the defect: it makes Owner and Administrator the
// SAME Role by construction. ADMIN_ROLE.permissions is itself derived as ADMIN_CURATED_PERMISSIONS
// plus the ENTIRE PERMISSION_CATALOG (Owner ruling 2026-08-19), so `owner` declared every one of
// the 151 catalog ids, 60 of them inside the governed PostgreSQL capability vocabulary, with ZERO
// difference from admin in either direction. A derivation that can only ever produce equality is
// not a safeguard against drift; it is a refusal to state the distinction.
//
// THE DISTINCTION, as ruled:
//   Owner  = business / enterprise OVERSIGHT authority.
//   Admin  = access / security / PLATFORM ADMINISTRATION authority.
// They overlap heavily -- both see almost everything -- and they are not the same Role. The
// separation is not "Owner sees less"; it is "Owner does not execute the floor, and does not run
// the platform's own administration tooling".
//
// WHY IT MATTERS, MEASURED rather than argued. In live nonprod eos_policy the Role `owner` holds
// 47 grants and `admin` holds 66: owner is a STRICT SUBSET, 19 admin-only, 0 owner-only. Because
// the seed writes role_capabilities from THIS catalog, naming `owner` on a Principal would have
// made the next seed apply widen the live Owner Role by ~20 rows, every one of them currently
// admin-only. That is the widening ruling S5 forbids, and it is why
// `roleCapabilityAuthorityBaseline.json` already carries an owner x 19 `catalogDeclaredNotActivated`
// block: the catalog was declaring an authority the business never granted.
//
// HOW THIS LIST WAS BUILT. Not by copying the live grant set into source. Every id below was
// decided against a named Taylor business responsibility, and the result was THEN compared with
// live nonprod; the full per-capability contract (capability - Object - action - rationale -
// OWNER_REQUIRED - ADMIN_ONLY) is pinned by ownerCapabilityContract.test.mjs, which also proves
// the subset property this lane exists to establish.
//
// DELIBERATELY NOT DERIVED FROM ADMIN_ROLE. Owner's permission list is now written out. Two ids
// Owner should hold would be picked up for free by a spread and are therefore stated explicitly
// instead -- see OWNER_ENTERPRISE_PERFORMANCE_AUTHORITY and OWNER_ACCOUNT_RELATIONSHIP_AUTHORITY.
// The previously-recorded reason for NOT listing the performance-goal ids ("admin composes the
// whole catalog and owner composes admin, so the explicit list was a duplicate that encoded a
// false distinction") was correct while Owner spread admin and is FALSE the moment it stops:
// deleting that spread deletes the Owner's own goal authority unless it is re-declared here. The
// same reversal applies to the CRM activity ids granted by Owner ruling 2026-08-19.
//
// CONDITIONS ARE STILL INHERITED FROM ADMIN, AND THAT IS NOT THE SAME MISTAKE. A
// conditionsByPermission entry can only RESTRICT a grant Owner already holds; it can never add
// one. Inheriting admin's permission list was fail-OPEN (anything admin gained, Owner gained);
// inheriting admin's condition map is fail-CLOSED (anything admin is constrained by, Owner is
// constrained by too). Today that map holds exactly one entry, the isOwnAssignment Condition on
// reorder.purchaseOrder.void, which Owner holds and must carry.

// ─── 1. ENTERPRISE VISIBILITY ────────────────────────────────────────────────────────────────
// Oversight is, first and mostly, the right to LOOK. The Owner is accountable for the whole
// business, so every cross-domain read the catalog registers is Owner's: what was sold, what is
// owed, what is in stock, who works here, what happened and who can do what. No read on this list
// separates Owner from Administrator and none is meant to -- ruling reference point: migration
// 1762041600000 granted admin.securityPolicy.read and admin.principalAccess.read to exactly
// {admin, owner}, so administration READS are explicitly a shared authority.
const OWNER_ENTERPRISE_VISIBILITY = [
  "admin.principalAccess.read",
  "audit.event.read",
  "customer.record.read",
  "employee.record.read",
  "equipment.compatibility.view",
  "fulfillment.coordinatedVisit.read",
  "inventory.action.read",
  "inventory.analytics.read",
  "inventory.balance.read",
  // NOT inventory.catalog.alias.read. A recorded decision (scannerReleaseReadiness.test.mjs,
  // INVENTORY_LOOKUP_READER_ROLE) says resolving a Part alias belongs to the lookup FUNCTIONAL
  // Role and that "reusing it by position is the mistake that capability was created to avoid".
  // Owner is a position. The ADMIN_ROLE spread used to hand it over anyway; ruling A does not.
  "inventory.catalog.read",
  "inventory.location.bin.read",
  "inventory.location.display.read",
  "inventory.serializedAsset.read",
  "inventory.transaction.read",
  "opportunity.read",
  "reorder.purchaseOrder.read",
  "reorder.request.read.own",
  "salesAgreement.read",
  "salesOrder.read",
  "service.inboundWork.read",
  "warehouse.record.read",
  "warehouse.stockLocation.read",
  "warehouse.transferOrder.read",
];

// ─── 2. PEOPLE AND ACCESS ACCOUNTABILITY ─────────────────────────────────────────────────────
// The one group where the Owner/Administrator line has to be drawn by argument rather than by
// domain, because every id here lives on an Administration Object. The line drawn is: the Owner
// decides EMPLOYMENT and ACCOUNTABILITY facts; the Administrator runs the platform.
//
//   Job Role, Work Eligibility, Operational Scope, profile and account status are BUSINESS facts
//   about a person's position, competence, coverage and employment (EMP-RT-08; the 2026-09-17
//   Workforce authority rulings). Who holds which position is the Owner's call, not IT's.
//
//   admin.roleAssignment.write and admin.accessRequest.decide are genuine access administration,
//   and Owner holds them anyway for a stated reason: `privileged: true` Roles require a SECOND,
//   distinct approver (Spec 15). A decider population of one cannot satisfy two-person approval,
//   and an Owner who cannot assign a Security Role can be locked out of their own business by
//   their own administrator. Held as the accountable second approver, not as a platform duty.
//
//   admin.credentialReset.initiate restores an employee's access when the administrator is
//   unavailable. It resets a credential; it never reveals one.
const OWNER_PEOPLE_AND_ACCESS_ACCOUNTABILITY = [
  "admin.accessRequest.decide",
  "admin.credentialReset.initiate",
  "admin.employeeJobRole.write",
  "admin.employeeOperationalScope.write",
  "admin.employeeProfile.write",
  "admin.employeeWorkEligibility.write",
  "admin.roleAssignment.write",
  "admin.userStatus.write",
];

// ─── 3. COMMERCIAL AUTHORITY ─────────────────────────────────────────────────────────────────
// The Owner's own book of business: the customer relationships, the pipeline, the agreements they
// draft and the orders they raise. Territory/coverage design is here rather than under Sales
// because the shape of the commercial organisation is an ownership decision -- the same ruling
// that placed Marketing "equal to salesManager" rather than beneath it.
//
// TWO COMMERCIAL ACTS ARE DELIBERATELY ABSENT, both on maker/checker grounds, and both match live
// nonprod: `opportunity.createSalesOrder` and `salesAgreement.accept`. Owner can edit an
// Opportunity's stage and value, and Owner drafts the Agreement -- so Owner must not also be the
// actor who converts that Opportunity into a committed Sales Order, nor the actor who records the
// counterparty's acceptance of the document Owner wrote. Excluding them costs the Owner nothing
// real (Owner can raise a Sales Order directly via salesOrder.write) and removes the only two
// places where one person could originate and bind the same commitment.
const OWNER_COMMERCIAL_AUTHORITY = [
  "coverage.read",
  "coverage.write",
  "crm.activity.create",
  "crm.activity.read",
  "customer.record.create",
  "customer.record.read",
  "customer.record.update",
  "opportunity.read",
  "opportunity.write",
  "salesAgreement.create",
  "salesAgreement.read",
  "salesAgreement.updateDraft",
  "salesOrder.fulfill",
  "salesOrder.read",
  "salesOrder.service",
  "salesOrder.write",
  "workOrder.create",
  "workOrder.transition",
];

// WHY salesOrder.fulfill / .service ARE HERE and opportunity.createSalesOrder IS NOT, although all
// three are Phase 6a "spine" ids the 2026-08-14 spec assigned to owner/admin as one block of 13.
// The two rules this lane used, in order:
//   - Where a MEASUREMENT exists, it wins. opportunity.createSalesOrder is one of the 19 keys the
//     live nonprod authority grants to admin and withholds from owner, and ruling A is precisely
//     that the catalog must stop contradicting that.
//   - Where no measurement exists, the RECORDED SPEC wins over a fresh reading. fulfill and service
//     are not in the governed PostgreSQL vocabulary at all, so nothing measured speaks to them; a
//     first-principles reading would call them fulfilment execution and drop them, but the spec
//     named owner explicitly and this lane does not overturn recorded decisions on inference.
// So Owner holds 12 of the 13, and the one it loses it loses on evidence.

// ─── 4. FINANCIAL AUTHORITY ──────────────────────────────────────────────────────────────────
// Money in, money out, and the policy that governs how it is seen. Issuing an invoice, applying a
// payment, recording an adjustment and recording a refund are the four acts that move the
// business's cash position, and the Owner is the party accountable for it. The visibility tiers
// and the accounting-policy profile are enterprise financial governance: the Owner configures the
// policy, which is why financialPolicyAuthorityActivation.test.mjs pins CONFIGURE to exactly
// {admin, owner} and refuses it to every finance Role -- supplying or approving a policy confers
// no authority to configure it.
//
// NOT HERE: `customer.governedField.write`. Payment terms, tax status and commercial profile are
// CREDIT CONTROL, and the catalog homes that id on accountingManager / financeManager. The party
// accountable for revenue must not be the party who unilaterally relaxes a customer's credit
// terms. Live nonprod agrees (admin-only today); the intended long-run home is Finance, not admin.
const OWNER_FINANCIAL_AUTHORITY = [
  "finance.adjustment.record",
  "finance.invoice.issue",
  "finance.payment.apply",
  "finance.read",
  "finance.refund.record",
  "finance.visibility.businessUnit",
  "finance.visibility.company",
  "finance.visibility.consolidated",
  "finance.visibility.self",
  "finance.visibility.team",
  "financialPolicy.profile.configure",
  "financialPolicy.profile.read",
];

// ─── 5. PROCUREMENT AND STOCK-COMMITMENT AUTHORITY ───────────────────────────────────────────
// Spending the business's money, and moving its stock between its own warehouses, are commitments
// -- decisions with a cost. Executing them is not.
//
//   RAISE and AUTHORISE are Owner's: create a reorder request, approve or reject one, cancel one,
//   raise the Purchase Order, and void a PO on the isOwnAssignment Condition that travels with it.
//   Create a transfer order -- deciding stock should move is planning.
//
//   The BUYER'S WORKFLOW is not Owner's: startPurchasing, postPurchasingUpdate,
//   recordPurchaseOrder and markReceived are the Purchasing Manager's sequence, and
//   transfer dispatch / receive / cancel are the warehouse floor executing a decision already
//   made. Owner raises the transfer; Owner does not put it on the truck.
//
// RECORDED, NOT HIDDEN: Owner holds both `reorder.request.create.manual` and
// `reorder.request.approve`, which is the very segregation PURCHASING_MANAGER_ROLE is denied
// ("whoever raises an order must not approve it"). That is how live nonprod stands for admin too,
// and it is defensible only because the Owner is the terminal approver -- there is nobody above
// them to escalate to. Stated here so a later ruling can overturn it deliberately.
// Also recorded: `reorder.request.create.system` names the AUTOMATIC replenishment raiser. A human
// Role holding a system-actor verb is questionable for any Role; it is retained because live
// nonprod grants it and this lane may not narrow BELOW live (see the subset proof).
const OWNER_PROCUREMENT_AUTHORITY = [
  "inventory.catalog.manage",
  "inventory.transfer.create",
  "reorder.purchaseOrder.create",
  "reorder.purchaseOrder.void",
  "reorder.request.approve",
  "reorder.request.cancel",
  "reorder.request.create.manual",
  "reorder.request.create.system",
  "reorder.request.reject",
];

// ─── 6. ENTERPRISE PERFORMANCE AUTHORITY ─────────────────────────────────────────────────────
// Setting, approving, superseding and retiring the goals the business is measured against is the
// definition of enterprise oversight, and the Owner's own goal policy names Owner. These five ids
// were removed from this file once, correctly, because Owner composed admin and admin composed the
// whole catalog -- so listing them was a duplicate that read as a distinction. Removing the
// composition puts them back: without this list the Owner would hold NO goal verb at all.
const OWNER_ENTERPRISE_PERFORMANCE_AUTHORITY = [
  "performance.goal.approve",
  "performance.goal.create",
  "performance.goal.read",
  "performance.goal.retire",
  "performance.goal.supersede",
];

// ─── 7. REPORTING (Issue #325 / ADR-007 W1 + W-SAVE) ─────────────────────────────────────────
// DEAD PREDICATE, FIXED. This list used to be
//   PERMISSION_CATALOG.filter((p) => p.id.startsWith("report.") && p.active !== false)
// with the stated reason that "Owner's catalog membership should reflect exactly what's currently
// reportable". DECISIONS #167 then moved the whole report.* family to `active: false` so
// production is fail-closed, and pushed the active/inactive split down to the ACTIVATION layer
// (environmentCapabilityOverrides.ts activates 36 of the 39 in eos-platform-sandbox and withholds
// the three sensitive fields). From that moment the predicate matched NOTHING: it evaluated to the
// empty array, and Owner held report.* only by accident, through the ADMIN_ROLE spread that this
// change removes.
//
// So the filter is not merely dead, it is load-bearing in the wrong direction: leaving it in place
// while removing the spread would silently delete Owner's ONE genuinely Owner-only authority and
// break the W-SAVE ruling that "only the approved W-SAVE role (Owner) holds the five new ids".
//
// The fix is to stop filtering catalog MEMBERSHIP on ACTIVATION state, which was always a category
// error: register != grant != activate. Owner holds every registered report.* id; the resolver's
// own active check plus the per-environment overrides decide which of them resolve ALLOW, which is
// where that decision belongs and is already proven by reportingActivationBoundary.test.mjs.
const OWNER_REPORT_PERMISSIONS = PERMISSION_CATALOG.filter((p) =>
  p.id.startsWith("report."),
).map((p) => p.id);

// ─── EXCLUDED BY DECISION ────────────────────────────────────────────────────────────────────
// Exported so the exclusion is a checkable artifact rather than an absence, and so the Sample
// Company manifest can finally assert these as Owner `forbiddenCapabilities` -- which it could not
// do while the compiled catalog handed Owner every one of them.
//
// All 19 are inside the governed PostgreSQL capability vocabulary and all 19 are admin-only in
// live nonprod. Two further vocabulary ids the old spread also gave Owner are not listed here
// because they are admin-only in neither sense -- see OWNER_EXCLUDED_NOT_AN_AUTHORITY below.
export const OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES = Object.freeze([
  // Platform administration. Bulk-loading records through the import pipeline is migration
  // TOOLING (nonprod-only by the Catalog Lane 2 ruling), not a business act.
  "admin.dataImport.execute",
  // Credit control. See OWNER_FINANCIAL_AUTHORITY.
  "customer.governedField.write",
  // Field execution -- installing equipment at a customer site is the installer's act.
  "equipment.install",
  // Reference-data administration -- curating the equipment model catalog.
  "equipment.model.manage",
  // Part lifecycle administration. Owner may EDIT a Part (inventory.catalog.manage, Owner ruling
  // 2026-08-19); changing its lifecycle status stays with the durable catalog administrator.
  "inventory.catalog.activate",
  // Cycle counting is warehouse execution end to end, and one Role holding submit AND reconcile
  // is a recorded internal-control problem already; Owner does not need to join it.
  "inventory.cycleCount.cancel",
  "inventory.cycleCount.create",
  "inventory.cycleCount.reconcile",
  "inventory.cycleCount.submit",
  // Physical stock handling -- putting it away, taking it in, moving it. Floor work.
  "inventory.placement.record",
  "inventory.stock.receive",
  "inventory.stock.relocate",
  // Executing a transfer Owner may already have raised. Raise != dispatch/receive/cancel.
  "inventory.transfer.cancel",
  "inventory.transfer.dispatch",
  "inventory.transfer.receive",
  // Maker/checker -- see OWNER_COMMERCIAL_AUTHORITY.
  "opportunity.createSalesOrder",
  "salesAgreement.accept",
  // Not in PERMISSION_CATALOG at all, so the compiled Owner never declared them; listed because
  // the five-row Work Order lifecycle activation ruling excluded `owner` EXPLICITLY and that
  // exclusion must survive any future registration of these ids.
  "workOrder.lifecycle.cancel",
  "workOrder.lifecycle.dispatch",
]);

// Vocabulary ids the old ADMIN_ROLE spread also handed Owner, excluded for reasons that are NOT
// "admin holds it and Owner does not". Kept separate so the 19 above stay exactly the admin-only
// set that the manifest asserts.
export const OWNER_EXCLUDED_NOT_AN_AUTHORITY = Object.freeze([
  // Assigning a reorder request to a buyer is work COORDINATION, not oversight.
  "reorder.request.assign",
  // SUPERSEDED. Retained in eos_policy only as migration evidence after the 2026-09-17 ruling
  // moved whole-queue visibility out of the capability key and into Operational Scope; the
  // manifest's own words are that it "may never be granted again".
  "reorder.request.read.queue",
]);

// Outside the governed vocabulary, and excluded on the same Owner/Administrator line:
//   admin.dataImport.stage, administration.emailIntake.{read,manage}   platform administration
//   equipment.compatibility.{correct,import,verify}                    reference-data curation
//   inventory.action.create                                            stock correction, floor work
//   inventory.location.bin.manage                                      warehouse layout admin
//   inventory.returns.intake, inventory.serializedAsset.acquire        physical intake
//   reorder.request.{startPurchasing,postPurchasingUpdate,
//                    recordPurchaseOrder,markReceived}                 the buyer's workflow
//   salesOrder.{fulfill,service}                                       fulfilment execution
//   service.inboundWork.{accept,decline,attachExisting}                intake triage
//   workOrder.labor.{record,correct}, workOrder.parts.plan             technician / planner work
//   workOrder.cancel                                                   see immediately below
//
// `workOrder.cancel` deserves its own sentence. It is the LEGACY id for the act that
// `workOrder.lifecycle.cancel` now names -- the canonical vocabulary deliberately omits it as a
// duplicate. The five-row activation ruling excluded `owner` from lifecycle.cancel explicitly, so
// leaving the legacy id on Owner would have granted through the Firebase-era resolver exactly the
// authority the governed ruling withholds. Removing it is the only way the two agree.

// SIX LIVE OWNER GRANTS CANNOT BE DECLARED HERE, and their absence is a catalog gap, not a
// decision: admin.securityPolicy.read, finance.invoice.read, finance.payment.read,
// inventory.manufacturer.read, reorder.request.read and workflowDefinition.read exist in the
// eos_policy vocabulary but have NO id in PERMISSION_CATALOG. Declaring them would be registering
// a new capability, which this lane is forbidden to do. Owner already holds all six in live
// nonprod; this catalog simply cannot say so yet. Registering them is the activation lane's work.

const OWNER_PERMISSIONS = [
  ...new Set([
    ...OWNER_ENTERPRISE_VISIBILITY,
    ...OWNER_PEOPLE_AND_ACCESS_ACCOUNTABILITY,
    ...OWNER_COMMERCIAL_AUTHORITY,
    ...OWNER_FINANCIAL_AUTHORITY,
    ...OWNER_PROCUREMENT_AUTHORITY,
    ...OWNER_ENTERPRISE_PERFORMANCE_AUTHORITY,
    ...OWNER_REPORT_PERMISSIONS,
  ]),
];

// Restrictions only -- see the header note. Inheriting admin's condition map can never widen Owner.
const OWNER_CONDITIONS = ADMIN_ROLE.conditionsByPermission;

// Spec §26.2 -- least-privilege baseline. Deliberately zero permissions:
// "grants no broad domain access by title alone" is satisfied by an
// empty grant set, not by a narrowed-but-nonempty one.
export const GENERAL_EMPLOYEE_ROLE: Role = Object.freeze({
  id: "generalEmployee",
  name: "General Employee",
  description:
    "Least-privilege governed baseline Role. Grants no domain capability by itself -- every further capability comes from an explicit additional Role assignment.",
  systemSeed: true,
  compatibility: false,
  permissions: [],
}) as Role;

// Spec §26.2 -- office/customer/service coordination; explicitly no
// governed-field (financial) write and no lifecycle-execution ids
// (transition/cancel), only creation/coordination.
export const OFFICE_MANAGER_ROLE: Role = Object.freeze({
  id: "officeManager",
  name: "Office Manager",
  description:
    "Office/customer/service coordination: Customer record read/create/update and Work Order creation. No governed-field write, no Work Order lifecycle execution, no role administration.",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "customer.record.read",
    "customer.record.create",
    "customer.record.update",
    "workOrder.create",
  ],
}) as Role;

// Spec §26.2 -- Customer/CRM coverage from the existing catalog only;
// quote/sales-pipeline/reporting capabilities are a recorded catalog
// gap (Spec §26.4), not granted here.
// MARKETING -- Owner ruling 2026-08-19: "need a marketing top top equal to salesManager".
// A top-level commercial position, peer to Sales Manager rather than reporting through it
// (roleHierarchy.ts places both directly under admin), which is what "equal to" fixes: on
// the same level, Marketing neither sees into Sales' people nor sits beneath them.
//
// GRANTED WHAT EXISTS, WHICH IS LESS THAN THE MATRIX ASKS FOR. The CRUD matrix gives
// Marketing CRED over "Marketing Initiatives", and NO marketing capability exists in the
// permission catalog at all -- there is no id to grant. Creating the Role with the reads it
// can actually hold is honest; inventing a capability the engine does not enforce would
// produce a Role that looks authorized and is not. Marketing Initiatives is recorded as a
// catalog gap alongside Commissions, Technician Time and Notifications.
//
// Contacts and Customer Locations, which the matrix also gives Marketing, are governed by
// firestore.rules today and have no capability either -- so they are not expressible here.
export const MARKETING_MANAGER_ROLE: Role = Object.freeze({
  id: "marketingManager",
  name: "Marketing Manager",
  description:
    "Top-level Marketing position, peer to Sales Manager. Read visibility across Customers, Opportunities and Sales Orders for segmentation and campaign targeting. Marketing Initiative capabilities are a recorded permission-catalog gap -- no marketing.* id exists to grant.",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "customer.record.read",
    "opportunity.read",
    "salesOrder.read",
  ],
}) as Role;

// PURCHASING MANAGER -- Owner roster 2026-08-20 (Tom; Erik holds it as a second role
// alongside Accounting Manager).
//
// Carries the purchasing WORKFLOW, which is a sequence rather than one write: see what needs
// buying, take it into purchasing, record the resulting Purchase Order, keep it current.
// Granting create without the queue read would produce a buyer who cannot see what needs
// buying.
//
// Reads mirror the CRUD matrix's Purchasing row -- it must see the catalog, stock, transfers
// and serialized assets it is buying against, and the AR side of what it commits.
//
// THREE OMISSIONS, EACH A DECISION:
//   - reorder.request.approve / .reject: whoever raises an order must not approve it. The
//     matrix's own segregation-of-duties principle, applied to the role that raises them.
//   - reorder.purchaseOrder.void: carries an isOwnAssignment Condition everywhere it is
//     held; granting it unconditioned here would exceed admin's own authority.
//   - No finance WRITE. The matrix gives Purchasing read-only on Invoices/AR.
export const PURCHASING_MANAGER_ROLE: Role = Object.freeze({
  id: "purchasingManager",
  name: "Purchasing Manager",
  description:
    "Procurement authority: raises and maintains Purchase Orders through the governed reorder workflow, with read visibility across catalog, stock, transfers, serialized assets and AR. Cannot approve or void what it raises.",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "customer.record.read",
    "finance.read",
    "inventory.action.read",
    "inventory.balance.read",
    "inventory.catalog.read",
    "inventory.serializedAsset.read",
    "inventory.transaction.read",
    "reorder.purchaseOrder.create",
    "reorder.purchaseOrder.read",
    "reorder.request.postPurchasingUpdate",
    "reorder.request.read.queue",
    "reorder.request.recordPurchaseOrder",
    "reorder.request.startPurchasing",
    "salesOrder.read",
    "warehouse.transferOrder.read",
  ],
}) as Role;

// SHOP MANAGER -- Owner roster 2026-08-20 (Willie).
//
// GRANTED NOTHING, DELIBERATELY. The roster names the position and the CRUD matrix's
// User-to-Role sheet describes it in Service terms, but the matrix's Role x Object grid has
// NO Shop Manager row -- there is no stated authority to implement.
//
// The alternative was to copy Service Manager's grants on the strength of a similar
// description. That would be inventing authority the business has not specified, and an
// invented grant is indistinguishable from a decided one once it is in the file. An empty
// Role is honest: the position exists, is assignable, and holds nothing until the matrix
// says what it holds. Same posture as the other org-chart positions awaiting a row.
// SHOP MANAGER / SHOP ASSOCIATE -- SERVICE roles, not warehouse roles.
//
// The earlier description here said the matrix "declares no Role x Object row for it". That was true
// of the Role Object Summary sheet consulted at the time; the canonical Detailed CRUD sheet declares
// all 24 rows for both Shop roles. The authority below is derived from those rows and from nothing
// else -- deliberately NOT copied from Warehouse Associate, Parts Associate, Technician or Service
// Manager, all of which the stale Summary sheet had conflated them with.
//
// What the canonical rows actually say: Work Orders CRE, Dispatch Schedule CRE, Technician Time CRE,
// Equipment CRE, with READ on parts catalog, inventory stock and serialized assets. That is a shop
// floor doing service work -- not receiving, not transfers, not inventory adjustment. The Summary
// sheet's version of these roles (Receiving CRE, Transfer Orders CRE) was warehouse authority pasted
// onto a service role.
//
// Dispatch Schedule and Technician Time map to workOrder.transition and to no capability
// respectively; the latter is RULE_GOVERNED, so an empty mapping is the honest answer rather than an
// invented capability.
export const SHOP_MANAGER_ROLE: Role = Object.freeze({
  id: "shopManager",
  name: "Shop Manager",
  description:
    "Service-organization position running the shop floor. Creates and transitions Work Orders, works the dispatch schedule and technician time, and reads parts catalog, inventory stock and serialized assets. Deliberately holds no receiving, transfer or inventory-adjustment authority -- those belong to Parts and Warehouse.",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "customer.record.read",
    "audit.event.read",
    "finance.read",
    "inventory.balance.read",
    "inventory.catalog.read",
    "inventory.serializedAsset.read",
    "inventory.transaction.read",
    "salesOrder.read",
    "workOrder.create",
    "workOrder.transition",
  ],
}) as Role;

// Present in the canonical matrix with its own 24 rows, and previously absent from this registry
// entirely -- the workbook defined a role the platform had no way to represent or grant.
//
// Its capability set equals Shop Manager's today. INTENTIONAL_OVERLAP: the business runs both over
// the same shop responsibilities, and inventing a difference so the titles diverge would encode a
// distinction nobody has made. Where they should differ, that is an employee-level assignment.
export const SHOP_ASSOCIATE_ROLE: Role = Object.freeze({
  id: "shopAssociate",
  name: "Shop Associate",
  description:
    "Service-organization position beneath the Shop Manager, working the shop floor. Same operational authority as Shop Manager today (INTENTIONAL_OVERLAP); per-person differences are made through employee-level functional-Role assignment rather than by splitting the business Role.",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "customer.record.read",
    "finance.read",
    "inventory.balance.read",
    "inventory.catalog.read",
    "inventory.serializedAsset.read",
    "inventory.transaction.read",
    "salesOrder.read",
    "workOrder.create",
    "workOrder.transition",
  ],
}) as Role;

export const SALES_MANAGER_ROLE: Role = Object.freeze({
  id: "salesManager",
  name: "Sales Manager",
  description:
    "Customer/CRM read/create/update. Quote, sales-pipeline, and reporting capabilities are a recorded permission-catalog gap (Spec §26.4), not yet grantable.",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "customer.record.create",
    "customer.record.read",
    "customer.record.update",
    "audit.event.read",
    "finance.read",
    // FIN-004 REACH, Owner ruling 2026-09-02. `finance.read` above is the fact-family gate;
    // this is the reach. Both are required and either alone reaches nothing. GRANT != ACTIVATION:
    // registered `active:false`, so it denies wherever it is not per-environment activated.
    // TEAM, not CONSOLIDATED: reach is the employees the governed role hierarchy places under
    // this principal (access/hierarchicalVisibility.ts), resolved at load time. An unresolved or
    // empty hierarchy yields a BLOCKED scope and zero reach -- it never widens to everyone.
    "finance.visibility.team",
    "inventory.balance.read",
    "inventory.catalog.read",
    "inventory.transaction.read",
    // Sales Agreement (Slice 4). The commercial commitment is this role's instrument: drafting terms,
    // revising them during negotiation, and recording the customer's acceptance are the sales job,
    // and without them the WON -> priced Sales Order path this role ALREADY holds cannot be reached
    // at all. Granted to exactly the three roles that already hold opportunity.createSalesOrder --
    // Salesperson, Sales Manager, General Manager -- because that capability is now unreachable
    // without these, and a role that can create the order but not the commitment it comes from
    // holds an authority it cannot exercise.
    //
    // ACCEPT IS GRANTED WITH A RECORDED CAVEAT: there is no approval-limit or discount-authority
    // model in this repo, so acceptance is all-or-nothing per role and a Salesperson may bind the
    // same terms a General Manager can. That is a real governance gap to close deliberately, not a
    // reason to withhold the capability that makes the chain work.
    "salesAgreement.create",
    "salesAgreement.updateDraft",
    "salesAgreement.accept",
    "salesAgreement.read",
    "opportunity.createSalesOrder",
    "opportunity.read",
    "opportunity.write",
    "salesOrder.read",
    "salesOrder.write",
    // PERFORMANCE GOAL AUTHORITY -- the Owner names Sales Manager for salesperson and sales-team
    // goals. THIS ROLE CANNOT REACH A TECHNICIAN'S GOALS, and not because anything checks its name:
    // an EMPLOYEE-scoped goal requires the subject to be inside this principal's governed
    // hierarchical visibility, and roleHierarchy.ts places technicians under the Service Manager
    // branch, not under Sales. The Owner's "a Sales Manager may not edit technician goals merely
    // because they can reach an administrative screen" is enforced by that existing model, not by a
    // title comparison.
    //
    // THIS IS THE FIRST AUTHORITY DIFFERENCE BETWEEN salesManager AND salesperson. The note on
    // SALESPERSON_ROLE below has been updated to match; the two Roles are no longer identical, and
    // the difference is deliberate rather than drift.
    "performance.goal.read",
    "performance.goal.create",
    "performance.goal.approve",
    "performance.goal.supersede",
    "performance.goal.retire",
  ],
}) as Role;

// Spec §26.2 -- the individual contributor the Sales Manager is over. Created
// 2026-08-19 on the Owner's clarification that "salesManager and Sales are
// different -- the manager is over the salesperson".
//
// ITS CAPABILITIES WERE IDENTICAL TO SALES MANAGER'S until the Performance Goal
// Authority landed, and the ONE difference now is worth stating precisely, because
// the reasoning below still holds everywhere else: salesManager holds the four goal
// WRITE verbs (create/approve/supersede/retire) and this Role holds only
// performance.goal.read.
//
// That is not the deferred coverage model arriving by accident. It is narrower than
// coverage and differently shaped: it confers no authority over a report's RECORDS,
// only over their TARGET, and the reach it grants is bounded by the ALREADY-EXISTING
// hierarchical-visibility model rather than by a new one. The Owner's rule that an
// employee does not manage their own target is what makes the asymmetry necessary --
// if both Roles held the write verbs, a salesperson could author their own quota.
//
// EVERYWHERE ELSE the two Roles remain deliberately identical, and the original
// reasoning is unchanged: the difference between them is ORGANISATIONAL, not
// authorizational. A manager holds no authority over their reports' records, because
// "a manager sees their team's work" requires the coverage/territory model the Owner
// explicitly deferred ("record and preserve the seams, do NOT build during the
// runway"). Giving salesManager a wider grant here would be building that model by
// accident, one capability at a time.
//
// The same pattern already exists in this file: accountingManager and financeManager
// are intentionally identical (DECISIONS #114). Two Roles that resolve the same way
// are not a defect when the distinction they encode is real and the authority
// difference has not been designed yet.
export const SALESPERSON_ROLE: Role = Object.freeze({
  id: "salesperson",
  name: "Salesperson",
  description:
    "Individual sales contributor: Customer read/create/update and full Opportunity authority, plus read visibility of the committed order and of stock. Identical in capability to Sales Manager today -- the manager relationship is organisational and confers no additional authority until the deferred coverage/territory model lands.",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "customer.record.create",
    "customer.record.read",
    "customer.record.update",
    "finance.read",
    // FIN-004 REACH, Owner ruling 2026-09-02. `finance.read` above is the fact-family gate;
    // this is the reach. Both are required and either alone reaches nothing. GRANT != ACTIVATION:
    // registered `active:false`, so it denies wherever it is not per-environment activated.
    // SELF binds to `users/{uid}.employeeId` at load time. No linked Employee => zero reach:
    // a record credited to nobody is nobody's SELF record.
    "finance.visibility.self",
    "inventory.balance.read",
    "inventory.catalog.read",
    "inventory.transaction.read",
    // Sales Agreement (Slice 4). The commercial commitment is this role's instrument: drafting terms,
    // revising them during negotiation, and recording the customer's acceptance are the sales job,
    // and without them the WON -> priced Sales Order path this role ALREADY holds cannot be reached
    // at all. Granted to exactly the three roles that already hold opportunity.createSalesOrder --
    // Salesperson, Sales Manager, General Manager -- because that capability is now unreachable
    // without these, and a role that can create the order but not the commitment it comes from
    // holds an authority it cannot exercise.
    //
    // ACCEPT IS GRANTED WITH A RECORDED CAVEAT: there is no approval-limit or discount-authority
    // model in this repo, so acceptance is all-or-nothing per role and a Salesperson may bind the
    // same terms a General Manager can. That is a real governance gap to close deliberately, not a
    // reason to withhold the capability that makes the chain work.
    "salesAgreement.create",
    "salesAgreement.updateDraft",
    "salesAgreement.accept",
    "salesAgreement.read",
    "opportunity.createSalesOrder",
    "opportunity.read",
    "opportunity.write",
    "salesOrder.read",
    "salesOrder.write",
    // PERFORMANCE GOAL AUTHORITY -- READ ONLY, and that is the whole grant. A person must be able to
    // see the target they are measured against; authoring it is someone else's act (the Owner:
    // "Employees do NOT automatically manage their own targets").
    //
    // READ IS NOT REACH. This Role is a leaf in roleHierarchy.ts, so its governed hierarchical
    // visibility resolves to its own employeeId and nothing else -- holding this id at global scope
    // still shows this person exactly one person's goals: their own.
    "performance.goal.read",
  ],
}) as Role;

// THE TWO MONEY ROLES SHARE ONE LIST, BECAUSE THEY ARE ONE POLICY.
//
// OWNER REVERSAL 2026-08-18: "accountingManager should be like financeManager for now." This
// DELIBERATELY supersedes the earlier Owner requirement that the two Roles "remain distinct".
// That distinction was drawn from the one id that happened to differentiate them, not from a
// described difference in the two jobs. Re-affirmed by Owner ruling 2026-09-02.
//
// WHY A SHARED CONSTANT AND NOT TWO LISTS. The two lists DID drift, and drifted badly: on
// 2026-09-02 accountingManager held 17 permissions and financeManager held 5 -- including every
// `finance.*` id, so the Role named Finance Manager could not read a single financial fact. Both
// descriptions said "intentionally identical" the whole time. Nothing caught it because the
// pinning test was DIRECTIONAL (accounting ⊇ finance, length >=), which both held at 17 vs 5 and
// which passes while its own comment ("the two are identical again") is false.
//
// Two arrays that must be equal are two chances to be wrong. One array is zero. This is the
// smallest change that makes the recorded policy structurally true rather than aspirationally
// true -- it introduces no abstraction, no factory and no indirection: it is one shared literal.
// If the Owner ever rules the two Roles apart, split this constant in that same change; the
// equality test below will require it.
//
// Spec §26.2 -- accounting-reporting capabilities beyond these still do not exist in the
// catalog (Spec §26.4).
const MONEY_MANAGER_PERMISSIONS = [
  "audit.event.read",
  "customer.governedField.write",
  "customer.record.read",
  "finance.adjustment.record",
  "finance.invoice.issue",
  "finance.payment.apply",
  "finance.read",
  "finance.refund.record",
  // FIN-004 REACH, Owner ruling 2026-09-02. The fact-family gate above answers "may this
  // principal see AR facts at all"; this answers "how far". Both are required and either alone
  // reaches nothing. CONSOLIDATED is the Owner's explicit choice for the money Roles.
  // GRANT != ACTIVATION: registered `active:false`, so this denies everywhere it is not
  // per-environment activated, and production activates nothing.
  "finance.visibility.consolidated",
  // CERT-FIN-02 financial policy VISIBILITY, Owner ruling (financial-policy authority). READ only,
  // and deliberately not `.configure`: the Owner ruled that supplying or approving an accounting
  // policy does not by itself confer EOS configuration authority, so the money Roles can SEE which
  // costing method and recognition point govern the numbers they work with, and cannot change them.
  // Configuration stays with the administrative company authority (admin / owner).
  //
  // It lands in MONEY_MANAGER_PERMISSIONS rather than on either Role, because Accounting Manager and
  // Finance Manager are "intentionally identical ... so they cannot drift apart without an explicit
  // code change" -- granting one and not the other is exactly the drift that list exists to prevent.
  "financialPolicy.profile.read",
  "inventory.action.read",
  "inventory.balance.read",
  "inventory.catalog.read",
  "inventory.serializedAsset.read",
  "inventory.transaction.read",
  "opportunity.read",
  "reorder.purchaseOrder.read",
  "salesOrder.read",
  "warehouse.transferOrder.read",
] as const;

export const ACCOUNTING_MANAGER_ROLE: Role = Object.freeze({
  id: "accountingManager",
  name: "Accounting Manager",
  description:
    "Customer visibility, governed commercial-field write, Sales Order and Purchase Order read, and CONSOLIDATED financial reach. Intentionally identical to Finance Manager (Owner rulings 2026-08-18, 2026-09-02) — both Roles are built from the same MONEY_MANAGER_PERMISSIONS list, so they cannot drift apart without an explicit code change.",
  systemSeed: true,
  compatibility: false,
  permissions: [...MONEY_MANAGER_PERMISSIONS],
}) as Role;

// Spec §26.2 -- financial oversight/policy authority. PARITY RESTORED 2026-09-02 (Owner
// ruling): this Role had drifted to five permissions with no `finance.*` id at all, so the
// Role named Finance Manager could not read a single financial fact. It is built from the
// same MONEY_MANAGER_PERMISSIONS list as Accounting Manager -- see that constant for why the
// list is shared rather than repeated. Margin/cost visibility remains a recorded catalog gap
// (Spec §26.4) and is unaffected by this restoration: FIN-BLOCK-003 governs cost, not reach.
export const FINANCE_MANAGER_ROLE: Role = Object.freeze({
  id: "financeManager",
  name: "Finance Manager",
  description:
    "Financial oversight/policy: Customer read visibility, governed commercial-field write authority (Issue #175), both sides of the committed-money picture (Sales Orders out, Purchase Orders in), and CONSOLIDATED financial reach. Intentionally identical to Accounting Manager (Owner rulings 2026-08-18, 2026-09-02) — both Roles are built from the same MONEY_MANAGER_PERMISSIONS list. Margin/cost visibility is a recorded permission-catalog gap (Spec §26.4).",
  systemSeed: true,
  compatibility: false,
  permissions: [...MONEY_MANAGER_PERMISSIONS],
}) as Role;

// Spec §26.2 -- full existing Work Order lifecycle authority
// (technicians/dispatch/Work Orders) plus field-inventory read
// visibility. Deliberately excludes reorder.*/inventory.action.* --
// reorder/purchasing execution authority stays with the Roles Issue
// #100 already scopes it to (expressed as Conditions on `technician`,
// Spec §9), not duplicated here as an unconditioned grant. Equipment
// capabilities are a recorded catalog gap (Spec §26.4).
export const FIELD_MANAGER_ROLE: Role = Object.freeze({
  // THE ID STAYS "fieldManager"; ONLY THE LABEL CHANGES. Owner ruling 2026-08-19:
  // "service Manager is fieldManager" -- the business calls this position Service
  // Manager, and the CRUD matrix lists it under that name. The id is load-bearing in a
  // way the label is not: it is what live role assignments, roleHierarchy.ts and the
  // access audit trail all reference, so renaming it would orphan every existing grant
  // to silently rename a job title. The name is what people read; the id is what the
  // system resolves. They are allowed to differ, and here they must.
  id: "fieldManager",
  name: "Service Manager",
  description:
    "Service Manager (id `fieldManager`). Technicians/dispatch/Work Orders: full Work Order lifecycle authority plus field-inventory read visibility. Equipment capabilities are a recorded permission-catalog gap (Spec §26.4).",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "customer.record.read",
    "audit.event.read",
    "finance.read",
    "fulfillment.coordinatedVisit.read",
    "inventory.balance.read",
    "inventory.catalog.manage",
    "inventory.catalog.read",
    "inventory.serializedAsset.read",
    "inventory.transaction.read",
    "salesOrder.read",
    "workOrder.cancel",
    "workOrder.create",
    "workOrder.transition",
    // PERFORMANCE GOAL AUTHORITY -- this Role IS the org chart's Service Manager, whom the Owner
    // names for technician and service-team goals. Dispatcher and technician sit beneath it in
    // roleHierarchy.ts, so its EMPLOYEE-goal reach resolves to exactly its own service branch and
    // reaches no salesperson, no warehouse associate and no peer manager.
    "performance.goal.read",
    "performance.goal.create",
    "performance.goal.approve",
    "performance.goal.supersede",
    "performance.goal.retire",
  ],
}) as Role;

// Spec §26.2/§27.4 -- cross-domain operational oversight (Customer,
// Service, Inventory, Warehouse, Purchasing) via read-heavy grants plus
// Work Order lifecycle authority. Deliberately excludes
// customer.record.create/update (oversight is not direct customer-
// editing authority in this conservative reading),
// customer.governedField.write, and every admin.*/reorder.request.assign/
// approve/reject/cancel id ("no automatic role administration"). The
// three warehouse.*.read ids (Spec §27.2) close the Warehouse-specific
// catalog gap §26.4 originally recorded here.
export const OPERATIONS_MANAGER_ROLE: Role = Object.freeze({
  id: "operationsManager",
  name: "Operations Manager",
  description:
    "Cross-domain operational oversight across Customer, Service, Inventory, Warehouse, and Purchasing. Can open a Customer record but not amend one. No role administration, no governed-field write, no reorder decision authority.",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "audit.event.read",
    "customer.record.read",
    // Owner ruling 2026-08-18: "operationsManager should be able to create accounts also".
    // CREATE only -- customer.record.update and customer.governedField.write stay DENIED, so
    // this Role can open a new Customer but cannot amend an existing one. That asymmetry is
    // intentional and pinned by test; it is not an oversight to be "completed" later.
    "customer.record.create",
    "workOrder.create",
    "workOrder.transition",
    "workOrder.cancel",
    "inventory.transaction.read",
    "inventory.action.read",
    "reorder.request.read.queue",
    "reorder.purchaseOrder.read",
    "warehouse.record.read",
    "warehouse.stockLocation.read",
    "warehouse.transferOrder.read",
    // Owner ruling (grantable-governed-roles workstream): Operations Manager is one of the five
    // roles named in Owner's proposed fulfillment.coordinatedVisit.read grant set ({owner, admin,
    // operationsManager, fieldManager, dispatcher}) -- cross-domain operational oversight is
    // exactly the reader this coordinated-Work-Order projection is for. Still active:false (grant
    // is not activation); see compatibilityRoles.ts's own comment.
    "fulfillment.coordinatedVisit.read",
    // Catalog curation -- Owner ruling 2026-08-19, same ruling that granted it to admin.
    // Cross-domain operational oversight includes fixing a wrong Part or Manufacturer
    // record rather than escalating it to whoever holds inventoryCatalogAdministrator.
    //
    // MANAGE only, NOT activate: lifecycle status stays with inventoryCatalogAdministrator.
    // This Role already holds inventory.transaction.read and inventory.action.read, and
    // catalog READ resolves for it through the compatibility layer, so the curation pair is
    // coherent.
    //
    // DELIBERATELY NOT granted to fieldManager. The Owner held that one back: catalog.manage
    // mints canonical Parts, and a field/service role creating new Part records at the point
    // of a repair is how duplicate catalog rows start. There is no duplicate detection in
    // this system today, so the inlet stays closed until there is. Revisit with dedup, not
    // before.
    "inventory.catalog.manage",
    // PERFORMANCE GOAL AUTHORITY -- the Owner names Operations Manager for technician, service-team,
    // parts/warehouse-location and company/branch operational goals. Reach is not conferred by this
    // grant: a LOCATION-scoped goal is resolved at { type: "location", value: warehouseId }, so this
    // Role reaches a warehouse's goals only through an assignment that actually covers it.
    "performance.goal.read",
    "performance.goal.create",
    "performance.goal.approve",
    "performance.goal.supersede",
    "performance.goal.retire",
  ],
}) as Role;

// === ORG-CHART POSITIONS (Owner chart, 2026-08-19) ==========================
//
// Seven Roles that exist so the organisation chart is fully expressible in
// functions/src/access/roleHierarchy.ts. Every one of them ships with NO
// permissions.
//
// That is deliberate, not an oversight. A Role's POSITION and a Role's AUTHORITY
// are separate systems here: position decides whose work you can see, permissions
// decide what you can do. Inventing capability sets for seven Roles at once would
// be guessing at seven business decisions the Owner has not made, and every guess
// would be live authority. An empty Role grants nothing and denies nothing that
// was not already denied -- so these can be assigned today for their hierarchy
// effect, and their capabilities granted later, one Owner ruling at a time.
//
// A NAME COLLISION WORTH UNDERSTANDING. warehouseManager, partsManager and
// partsAssociate already exist as OPERATIONAL ROLES on the employee record
// (WAREHOUSE_MANAGER / PARTS_MANAGER / PARTS_ASSOCIATE, domain/constants.js).
// Those are operational QUALIFICATIONS -- "is this person trained and assigned to
// run a warehouse" -- and this platform deliberately keeps them separate from
// security authorization (Spec §9). The Roles below are the SECURITY side of the
// same job title. They are not the same object, they are not interchangeable, and
// one does not imply the other. Holding the operational role still drives the
// operational-role home screens exactly as before; holding the governed Role adds
// a position in the visibility tree.

// GENERAL MANAGER -- the highest broad BUSINESS role, and deliberately NOT security administration.
//
// The capability grant the description above deferred ("a separate Owner decision") was made on
// 2026-08-21 from the canonical Detailed CRUD sheet, with one explicit override.
//
// THE OVERRIDE, because it is the load-bearing part. The workbook grants General Manager CRED on
// both Users and Roles / Permissions. Implementing that literally would create a NON-PRIVILEGED role
// holding admin.roleAssignment.write -- a self-escalation path, since a General Manager could grant
// themselves any Role including owner, through the ordinary grant path rather than the privileged
// two-person one. Owner decision: General Manager is business operations, not access administration.
// Owner and Admin retain privileged security administration.
//
// So Users and Roles / Permissions map to NO capabilities here, and governedBusinessRoles.test.ts
// asserts this Role resolves zero `admin.*` -- proven by injecting one and watching it fail.
//
// Audit read IS granted: reading the audit log is management visibility, not the ability to change
// who can do what.
export const GENERAL_MANAGER_ROLE: Role = Object.freeze({
  id: "generalManager",
  name: "General Manager",
  description:
    "Org-chart position in the top block, between Owner and the branch heads. Holds broad business and operational authority per the canonical business-intent matrix, and NO security administration: no admin.* capability, no Role assignment, no capability grant, and therefore no self-escalation path. Privileged access administration remains with Owner and Admin.",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "customer.record.create",
    "customer.record.read",
    "customer.record.update",
    "audit.event.read",
    "finance.adjustment.record",
    "finance.invoice.issue",
    "finance.payment.apply",
    "finance.read",
    "finance.refund.record",
    // FIN-004 REACH, Owner ruling 2026-09-02. `finance.read` above is the fact-family gate;
    // this is the reach. Both are required and either alone reaches nothing. GRANT != ACTIVATION:
    // registered `active:false`, so it denies wherever it is not per-environment activated.
    "finance.visibility.consolidated",
    // CERT-FIN-02 financial policy VISIBILITY, Owner ruling. READ only, and deliberately NOT
    // `.configure`: this Role holds "NO security administration ... Privileged access administration
    // remains with Owner and Admin", and company financial configuration belongs on that side of the
    // line. A General Manager who issues invoices and records adjustments is working with numbers
    // this policy governs, which is what earns the read.
    "financialPolicy.profile.read",
    "inventory.action.read",
    "inventory.balance.read",
    "inventory.catalog.manage",
    "inventory.catalog.read",
    "inventory.serializedAsset.read",
    "inventory.transaction.read",
    // Sales Agreement (Slice 4). The commercial commitment is this role's instrument: drafting terms,
    // revising them during negotiation, and recording the customer's acceptance are the sales job,
    // and without them the WON -> priced Sales Order path this role ALREADY holds cannot be reached
    // at all. Granted to exactly the three roles that already hold opportunity.createSalesOrder --
    // Salesperson, Sales Manager, General Manager -- because that capability is now unreachable
    // without these, and a role that can create the order but not the commitment it comes from
    // holds an authority it cannot exercise.
    //
    // ACCEPT IS GRANTED WITH A RECORDED CAVEAT: there is no approval-limit or discount-authority
    // model in this repo, so acceptance is all-or-nothing per role and a Salesperson may bind the
    // same terms a General Manager can. That is a real governance gap to close deliberately, not a
    // reason to withhold the capability that makes the chain work.
    "salesAgreement.create",
    "salesAgreement.updateDraft",
    "salesAgreement.accept",
    "salesAgreement.read",
    "opportunity.createSalesOrder",
    "opportunity.read",
    "opportunity.write",
    "reorder.purchaseOrder.create",
    "reorder.purchaseOrder.read",
    "reorder.request.postPurchasingUpdate",
    "salesOrder.read",
    "salesOrder.write",
    "warehouse.transferOrder.read",
    "workOrder.create",
    "workOrder.transition",
    // PERFORMANCE GOAL AUTHORITY -- the Owner's goal-management policy names General Manager for
    // every goal type, including firm strategic goals. Holding all five verbs is not firm-wide
    // reach: each act still resolves the capability AT THE GOAL'S OWN TARGET SCOPE, and an
    // EMPLOYEE-scoped goal is additionally narrowed to this Role's governed hierarchical
    // visibility. Approve is held alongside create ON PURPOSE -- self-approval is refused
    // unconditionally (FIN-007), so holding both permits approving a COLLEAGUE's draft and never
    // one's own.
    "performance.goal.read",
    "performance.goal.create",
    "performance.goal.approve",
    "performance.goal.supersede",
    "performance.goal.retire",
    // EMPLOYEE BUSINESS RECORD READ -- Owner ruling A (2026-09-14). Business visibility of who works here, their
    // lifecycle and reporting line; NOT admin.*, and it reveals no Principal, Role, credential or account status.
    "employee.record.read",
  ],
}) as Role;

export const WAREHOUSE_MANAGER_ROLE: Role = Object.freeze({
  id: "warehouseManager",
  name: "Warehouse Manager",
  description:
    "Org-chart position: head of the warehouse branch under Operations, with Warehouse Associates beneath. Distinct from the WAREHOUSE_MANAGER operational role on the employee record, which is an operational qualification rather than a security Role. R-32 (#152): this Role now carries the warehouse-manager authority that was previously routed through the technician compatibility Role, and its reorder-create and inventory-transaction bindings are grantable ONLY at location scope.",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "audit.event.read",
    "customer.record.read",
    "inventory.action.read",
    "inventory.balance.read",
    "inventory.catalog.manage",
    "inventory.catalog.read",
    "inventory.serializedAsset.read",
    "inventory.transaction.read",
    "reorder.purchaseOrder.read",
    "reorder.request.create.manual",
    "salesOrder.read",
    "warehouse.transferOrder.read",
    // PERFORMANCE GOAL AUTHORITY -- the Owner names Warehouse Manager for parts/warehouse LOCATION
    // goals, and only "where its governed scope actually covers the target". That qualifier needs no
    // new mechanism: a LOCATION goal resolves the capability at { type: "location", value:
    // warehouseId }, so a manager assigned wh-north reaches wh-north and is refused wh-south by the
    // SAME value match that already governs reorder.request.create.manual on this Role.
    //
    // The goal verbs are deliberately NOT listed in scopesByPermission below. An EMPLOYEE-scoped
    // goal for a warehouse associate is asked at global scope and narrowed by hierarchy instead, so
    // a location-only binding would make authoring one impossible.
    "performance.goal.read",
    "performance.goal.create",
    "performance.goal.approve",
    "performance.goal.supersede",
    "performance.goal.retire",
  ],
  // R-32 (#152) -- PER-BINDING assignment-scope policy. THIS Role's grant of THESE permissions may
  // only be conferred by a RoleAssignment scoped to a single governed Warehouse. Absent entries are
  // unrestricted, so every other permission above still resolves from a global assignment exactly as
  // it did before R-32 -- that is what makes `warehouseManager @ global` and
  // `warehouseManager @ location:wh-main` COMPOSABLE rather than rivals.
  // 
  // SCOPE IS DECLARED ON THE BINDING, NOT THE CAPABILITY. `inventory.transaction.read` is carried by
  // eighteen Roles -- salesperson, controller, accountingManager among them -- every one legitimately
  // global. Restricting the capability id would break seventeen Roles to constrain one.
  // 
  // NOT DECLARED HERE, deliberately: `inventory.catalog.read` (global reference data, R-32 section 6).
  scopesByPermission: {
    "reorder.request.create.manual": ["location"],
    "inventory.transaction.read": ["location"],
  },
}) as Role;

export const WAREHOUSE_ASSOCIATE_ROLE: Role = Object.freeze({
  id: "warehouseAssociate",
  name: "Warehouse Associate",
  description:
    "Org-chart position beneath the Warehouse Manager. Carries no permissions of its own.",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "inventory.action.read",
    "inventory.balance.read",
    "inventory.catalog.read",
    "inventory.serializedAsset.read",
    "inventory.transaction.read",
    "reorder.purchaseOrder.read",
    "salesOrder.read",
    "warehouse.transferOrder.read",
    // PERFORMANCE GOAL AUTHORITY -- READ ONLY, and that is the whole grant. A person must be able to
    // see the target they are measured against; authoring it is someone else's act (the Owner:
    // "Employees do NOT automatically manage their own targets").
    //
    // READ IS NOT REACH. This Role is a leaf in roleHierarchy.ts, so its governed hierarchical
    // visibility resolves to its own employeeId and nothing else -- holding this id at global scope
    // still shows this person exactly one person's goals: their own.
    "performance.goal.read",
  ],
}) as Role;

export const PARTS_MANAGER_ROLE: Role = Object.freeze({
  id: "partsManager",
  name: "Parts Manager",
  description:
    "Org-chart position: head of the parts branch under Operations, with Parts Associates beneath. Distinct from the PARTS_MANAGER operational role on the employee record. R-32 (#152): this Role now carries the parts-manager authority that was previously routed through the technician compatibility Role, and its reorder-create and inventory-transaction bindings are grantable ONLY at location scope.",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "audit.event.read",
    "customer.record.read",
    "finance.adjustment.record",
    "finance.invoice.issue",
    "finance.read",
    "inventory.balance.read",
    "inventory.catalog.manage",
    "inventory.catalog.read",
    "inventory.serializedAsset.read",
    "inventory.transaction.read",
    "reorder.request.assign",
    "reorder.request.create.manual",
    "reorder.request.read.queue",
    "salesOrder.read",
    "workOrder.create",
    "workOrder.transition",
    // PERFORMANCE GOAL AUTHORITY -- the Owner names Parts Manager for Parts Associate goals and for
    // parts/warehouse LOCATION goals at their governed location. "A Parts Manager for wh-north may
    // not modify a goal for a location outside their governed location authority" is enforced by the
    // existing value match on a location-scoped assignment, never by a check that reads this Role's
    // name. Not listed in scopesByPermission below, for the reason given on WAREHOUSE_MANAGER_ROLE.
    "performance.goal.read",
    "performance.goal.create",
    "performance.goal.approve",
    "performance.goal.supersede",
    "performance.goal.retire",
  ],
  // R-32 (#152) -- PER-BINDING assignment-scope policy; see WAREHOUSE_MANAGER_ROLE above for the full
  // rationale. The eleven permissions NOT listed here (finance.*, workOrder.*, customer.record.read,
  // salesOrder.read, the catalog ids) stay unrestricted and keep resolving from a global assignment.
  // 
  // reorder.request.read.queue and reorder.request.assign are DELIBERATELY ABSENT (R-32 section 6):
  // their runtime enforcement is Rules-backed and status-scoped, not location-scoped, and inventing a
  // location policy for a binding nothing evaluates would be asserting semantics we have not measured.
  scopesByPermission: {
    "reorder.request.create.manual": ["location"],
    "inventory.transaction.read": ["location"],
  },
}) as Role;

export const PARTS_ASSOCIATE_ROLE: Role = Object.freeze({
  id: "partsAssociate",
  name: "Parts Associate",
  description:
    "Org-chart position beneath the Parts Manager. Distinct from the PARTS_ASSOCIATE operational role on the employee record. Carries no permissions of its own.",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "customer.record.read",
    "finance.read",
    "inventory.balance.read",
    "inventory.catalog.read",
    "inventory.serializedAsset.read",
    "inventory.transaction.read",
    "salesOrder.read",
    "workOrder.create",
    "workOrder.transition",
    // PERFORMANCE GOAL AUTHORITY -- READ ONLY, and that is the whole grant. A person must be able to
    // see the target they are measured against; authoring it is someone else's act (the Owner:
    // "Employees do NOT automatically manage their own targets").
    //
    // READ IS NOT REACH. This Role is a leaf in roleHierarchy.ts, so its governed hierarchical
    // visibility resolves to its own employeeId and nothing else -- holding this id at global scope
    // still shows this person exactly one person's goals: their own.
    "performance.goal.read",
  ],
}) as Role;

// CONTROLLER -- financial execution authority, granted 2026-08-21 from the canonical business-intent
// matrix. The description previously deferred this ("granted separately and deliberately"); this is
// that grant.
//
// Its capability set is identical to Accounting Manager's. That is INTENTIONAL_OVERLAP, not a defect:
// the business currently runs those two positions over the same financial responsibilities, and
// manufacturing a difference purely so the titles diverge would encode a distinction the business has
// not made. Where they should differ later, the difference is made by changing what is assigned to
// the EMPLOYEE, which is where governance is meant to live.
export const CONTROLLER_ROLE: Role = Object.freeze({
  id: "controller",
  name: "Controller",
  description:
    "Org-chart position beneath the Finance Manager, alongside Accounting. Holds financial execution authority -- AR read, invoice issue, payment apply, adjustment and refund record -- plus broad operational read. Deliberately identical to Accounting Manager today (INTENTIONAL_OVERLAP); per-person differences are made through employee-level assignment.",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "customer.record.read",
    "audit.event.read",
    "finance.adjustment.record",
    "finance.invoice.issue",
    "finance.payment.apply",
    "finance.read",
    "finance.refund.record",
    // CERT-FIN-02 financial policy VISIBILITY, Owner ruling. READ only. A Controller books the
    // financial execution this policy governs -- which costing method relieved a number, and at
    // which event -- so seeing the policy is part of doing the job. Changing it is not:
    // configuration stays with the administrative company authority (admin / owner).
    "financialPolicy.profile.read",
    "inventory.action.read",
    "inventory.balance.read",
    "inventory.catalog.read",
    "inventory.serializedAsset.read",
    "inventory.transaction.read",
    "opportunity.read",
    "reorder.purchaseOrder.read",
    "salesOrder.read",
    "warehouse.transferOrder.read",
  ],
}) as Role;

// SUPPORT STAFF -- deliberately narrow, and worth recording WHY the number is this small.
//
// The stale Role Object Summary sheet showed Support Staff with full AR and payments write, identical
// to Controller. That row was copy-pasted from Accounting Manager: the canonical Detailed CRUD sheet
// grants Support Staff Read on Accounts, Contacts and Notifications and nothing else.
//
// A reconciliation built from the Summary would have handed a support role invoice-issue, payment-
// apply and refund authority on the strength of a spreadsheet copy-paste. Two capabilities is the
// honest answer.
export const SUPPORT_STAFF_ROLE: Role = Object.freeze({
  id: "supportStaff",
  name: "Support Staff",
  description:
    "Org-chart position beneath Accounting. Read-only on customer records and contact activity per the canonical business-intent matrix. Notifications access is Rules-governed rather than capability-governed.",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "customer.record.read",
  ],
}) as Role;

// Spec §26.2 -- privileged BUSINESS OVERSIGHT Role, NARROWED 2026-09-24 (Owner
// ruling A). It previously "matched ADMIN_ROLE's exact grant rather than
// inventing a broader one", which sounded conservative and was not: admin's
// grant IS the whole catalog, so matching it made Owner and Administrator one
// Role wearing two names. Owner now holds an explicitly stated contract -- see
// THE OWNER CAPABILITY CONTRACT at the top of this file for the per-capability
// reasoning and for the 19 admin-only capabilities it deliberately excludes.
//
// "Privileged/full-access but never a security bypass" is still satisfied the
// same way: every id Owner holds resolves through the same governed resolver
// (resolveEffectivePermission.ts), Scope, Condition and audit path as anyone
// else's, with no special case anywhere. `privileged: true` (same as
// ADMIN_ROLE) means grant/revoke requires a second, distinct approver (Spec
// §15) -- Owner is never single-admin-assignable.
export const OWNER_ROLE: Role = Object.freeze({
  id: "owner",
  name: "Owner",
  description:
    "Privileged business and enterprise OVERSIGHT Role: enterprise visibility, people and access accountability, commercial, financial, procurement, performance-goal and reporting authority, through the same governed resolver, Scope, Condition and audit path as every other Role -- never a bypass. Deliberately NOT the Administrator: platform administration, warehouse execution and the two maker/checker commercial acts are excluded (OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES). The only Role with report.* access.",
  systemSeed: true,
  compatibility: false,
  privileged: true,
  permissions: OWNER_PERMISSIONS,
  conditionsByPermission: OWNER_CONDITIONS,
}) as Role;

// INV-1 Post-Phase-1 -- temporary, execution-scoped Role for the approved
// 190-Part CREATE run (Decision #42; CREATE Execution Authorization gate).
// NOT one of Spec §26's eight business-oversight Roles: it exists solely to
// make `inventory.catalog.manage` grantable to the approved operator for the
// ONE approved CREATE execution, then be revoked immediately after execution
// and reconciliation. Least privilege by construction: carries ONLY
// `inventory.catalog.manage` (create/edit canonical Part records through the
// trusted Part Master service) -- deliberately NOT `inventory.catalog.
// activate` (lifecycle changes remain a separate step) and no other id.
// `privileged: false` per the Privileged Approval Scope Correction
// (docs/governance/privileged-approval-classification.md): two-person
// approval is reserved for capabilities that can materially administer
// security/access policy, grant platform/security-admin authority, change
// role/permission definitions or tenant isolation, deploy/weaken security
// enforcement, bypass trusted-command authorization, or alter/suppress audit
// evidence. `inventory.catalog.manage` is ordinary OPERATIONAL authority
// (create/edit descriptive Part records through the trusted service) -- it
// administers no security, grants no admin authority, changes no policy, and
// cannot touch audit integrity -- so it requires ONE authorized Owner/admin
// plus append-only audit, not a second approver. Least privilege is
// unchanged: carries ONLY `inventory.catalog.manage` (NOT `inventory.
// catalog.activate`, no other id). Declaring this object grants nothing: a
// principal gains the capability only when a governed, audited roleAssignment
// (functions/src/access/trustedWriterCommands.ts) assigns them this roleId,
// and loses it the instant that assignment is revoked (revoke after CREATE
// execution and reconciliation).
export const INVENTORY_CREATE_EXECUTOR_ROLE: Role = Object.freeze({
  id: "inventoryCreateExecutor",
  name: "Inventory CREATE Executor (temporary)",
  description:
    "Temporary execution-scoped Role for the approved Part Master CREATE run (INV-1, Decision #42). Grants only inventory.catalog.manage (operational authority -- single-approver + audited, not two-person); assigned to the approved operator for one CREATE execution and revoked immediately after execution and reconciliation.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: ["inventory.catalog.manage"],
}) as Role;

// Durable catalog/reference-data administrator -- Option A of the accepted
// role design in docs/releases/supplier-master-promotion-package.md §A
// ("Adopt Option A"), referenced as accepted by the Part Master RC
// (docs/releases/part-master-write-rc.md §"Exact production delta" item 2),
// the Manufacturer RC, and the three catalog sandbox-handoff docs. Until now
// the design existed only in prose and in `// future inventoryCatalogAdministrator`
// comments in index.ts / partMasterCallables.ts / manufacturerCallables.ts /
// partSupplierItemCallables.ts, so there was no Role object to assign to
// anyone -- the catalog write callables were unreachable by construction
// rather than merely ungranted.
//
// One catalog authority, not three: `inventory.catalog.manage` +
// `inventory.catalog.activate` govern ALL catalog reference data -- Parts,
// Manufacturers, and (reused per DECISIONS #78) Suppliers. A supplier-only
// or part-only role would fragment a single authority and mint symmetry-only
// structure; §A rejects that explicitly.
//
// Least privilege, exactly two ids and nothing else. The pair is one coherent
// resource authority (`resource: "inventory.catalog"`, actions `manage` +
// `activate`), so granting both to one purpose-built role is the minimal
// auditable unit. Catalog write deliberately stays OFF `admin`/`owner`
// (see the `inventoryCreateExecutor` rationale above): catalog write is a
// specific operational authority, not a title-based one.
//
// Durable, unlike `inventoryCreateExecutor` -- that role is execution-scoped,
// `.manage`-only, and revoked after one approved CREATE run. This one is a
// standing role for ongoing catalog administration, and carries `.activate`
// (lifecycle status changes) which the executor deliberately does not.
//
// `privileged: false` per docs/governance/privileged-approval-classification.md,
// on the same reasoning recorded for `inventoryCreateExecutor`: catalog write
// administers no security/access policy, grants no admin authority, changes no
// role/permission definition or tenant isolation, bypasses no trusted-command
// authorization, and cannot alter or suppress audit evidence. It is ordinary
// operational authority -- one authorized approver plus append-only audit,
// not two-person approval.
//
// Mints NO new capability id, so it stays consistent with R-1 convergence:
// R-1 governs how capabilities map to Roles, and this is a clean
// single-resource Role with nothing for convergence to retire.
//
// DECLARING THIS OBJECT GRANTS NOTHING. A principal gains these capabilities
// only through a governed, audited `roleAssignments/{id}` write via the access
// command path (functions/src/access/trustedWriterCommands.ts), which bumps
// `accessVersion` and syncs claims. §A names that grant as "the protected
// grant action" -- it is a separate authorization from this definition, and no
// grant is performed here, in any environment.
export const INVENTORY_CATALOG_ADMINISTRATOR_ROLE: Role = Object.freeze({
  id: "inventoryCatalogAdministrator",
  name: "Inventory Catalog Administrator",
  description:
    "Durable least-privilege Role for governed catalog reference data: reading the governed catalog, creating and curating Parts, Manufacturers and Suppliers, and changing their lifecycle status. Carries exactly inventory.catalog.read + inventory.catalog.manage + inventory.catalog.activate and nothing else. Declaring it grants nothing; a principal holds it only via a governed, audited roleAssignment.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  // inventory.catalog.read ADDED 2026-08-16 (Owner decision). Live E2E: partsManager could open the
  // catalog surface and then got HTTP 403 from getManufacturerCatalog -- correct enforcement of the
  // Role as written, but the Role scope was operationally incomplete. A principal authorized to
  // MANAGE and ACTIVATE governed catalog data must be able to READ the catalog required to do that
  // work; curating a Part against a manufacturer list you cannot see is not a coherent authority.
  //
  // Deliberately narrow: the catalog read ONLY. This confers no stock, transfer, cycle-count,
  // receiving or transaction read authority, and the Role stays privileged:false -- it administers
  // reference data, not access. No admin/owner bypass is involved: admin already resolves this id
  // through its own compatibility grant, unchanged by this edit.
  permissions: ["inventory.catalog.read", "inventory.catalog.manage", "inventory.catalog.activate"],
}) as Role;

// Work Order parts planner -- the durable least-privilege Role for the governed WO parts-planning
// producer (setWorkOrderPartsPlan, capability workOrder.parts.plan).
//
// WHY THIS EXISTS. The capability was registered active:false and carried by NO Role, so there was
// literally nothing to grant: the planning UI shipped and activated but every principal resolved
// DENY, with no assignable Role to fix it. Defining the Role is what makes the grant possible; it is
// not itself a grant.
//
// Least privilege: exactly one capability id. Planning is not reserving and not consuming -- this
// Role confers no inventory movement, no reservation, and no execution authority, matching the
// command's own PLAN != RESERVE != USE invariant.
//
// `privileged: false` per docs/governance/privileged-approval-classification.md, on the same
// reasoning recorded for inventoryCreateExecutor and inventoryCatalogAdministrator: planning parts
// administers no security/access policy, grants no admin authority, changes no role/permission
// definition, bypasses no trusted-command authorization, and cannot alter or suppress audit
// evidence. Ordinary operational authority -- one authorized approver plus append-only audit.
//
// DECLARING THIS OBJECT GRANTS NOTHING. A principal holds it only through a governed, audited
// roleAssignments write, which bumps accessVersion and syncs claims.
export const WORK_ORDER_PARTS_PLANNER_ROLE: Role = Object.freeze({
  id: "workOrderPartsPlanner",
  name: "Work Order Parts Planner",
  description:
    "Durable least-privilege Role for planning parts on a Work Order through the governed setWorkOrderPartsPlan command. Carries exactly workOrder.parts.plan and nothing else: planning is not reserving and not consuming. Declaring it grants nothing; a principal holds it only via a governed, audited roleAssignment.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: ["workOrder.parts.plan"],
}) as Role;

// CRM activity contributor -- the durable least-privilege Role for the CRM Activity authority
// (crm.activity.create + crm.activity.read).
//
// Same situation as above: both capabilities were registered active:false and carried by NO Role, so
// the Activity & Notes surface could ship, activate, and still deny everyone.
//
// The two ids are kept as separate capabilities deliberately, so a future read-only Role remains
// possible without redefining the authority. This Role holds both because a salesperson who records
// interaction history necessarily also reads it; a read-only variant is a separate future Role, not a
// reason to fragment this one now.
//
// Least privilege: exactly these two ids. It confers no Account, Opportunity or Sales Order write
// authority -- the activity record references those objects and never restates or mutates them.
//
// `privileged: false` on the same reasoning as its siblings. DECLARING THIS OBJECT GRANTS NOTHING.
export const CRM_ACTIVITY_CONTRIBUTOR_ROLE: Role = Object.freeze({
  id: "crmActivityContributor",
  name: "CRM Activity Contributor",
  description:
    "Durable least-privilege Role for recording and reading governed CRM activity/notes on an Account. Carries exactly crm.activity.create + crm.activity.read and nothing else; it confers no Account, Opportunity or Sales Order write authority. Declaring it grants nothing; a principal holds it only via a governed, audited roleAssignment.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: ["crm.activity.create", "crm.activity.read"],
}) as Role;

// Inventory transfer operator -- the durable least-privilege Role for the governed Transfer Order
// authority (create -> dispatch -> receive, plus cancel).
//
// Same situation the two Roles above were written for: all four ids were registered active:false and
// carried by NO Role, so the Transfer surface could ship, be activated in an environment, and still
// deny every principal. Activation is not authorization; this Role is the authorization half.
//
// WHY ONE ROLE FOR ALL FOUR: a transfer is a single custody movement whose steps are performed by the
// same operational owner -- whoever sends stock is who confirms it arrived, and cancel is the same
// authority declining to complete its own movement. Splitting dispatch from receive would not create
// segregation of duties, it would only make an ordinary transfer un-completable by its owner. Cycle
// Count below is split precisely because that separation IS meaningful there.
//
// Least privilege: exactly these four ids. It confers no catalog write, no receiving authority, and
// no stock adjustment power -- a transfer moves existing units between locations and creates none.
//
// `privileged: false` on the same reasoning as its siblings: it administers no security/access
// policy, grants no admin authority, bypasses no trusted-command authorization, and cannot alter or
// suppress audit evidence. DECLARING THIS OBJECT GRANTS NOTHING.
export const INVENTORY_TRANSFER_OPERATOR_ROLE: Role = Object.freeze({
  id: "inventoryTransferOperator",
  name: "Inventory Transfer Operator",
  description:
    "Durable least-privilege Role for moving stock between inventory locations through the governed Transfer Order commands. Carries exactly inventory.transfer.create/dispatch/receive/cancel and nothing else; it confers no catalog write, receiving, or stock-adjustment authority. Declaring it grants nothing; a principal holds it only via a governed, audited roleAssignment.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: [
    "inventory.transfer.create",
    "inventory.transfer.dispatch",
    "inventory.transfer.receive",
    "inventory.transfer.cancel",
  ],
}) as Role;

// Cycle count counter -- opens a count, submits the counted figures, and may cancel a count it
// opened. Deliberately does NOT carry inventory.cycleCount.reconcile.
//
// SEGREGATION OF DUTIES, not fragmentation for its own sake. Reconciling a cycle count is what turns
// a claimed variance into a real ledger adjustment -- it is the step that changes on-hand quantity.
// Letting the same principal both report the count and approve the adjustment it implies would mean
// one person could write inventory to any number they chose and have it accepted, with no second
// party in the path. That is the classic inventory-shrinkage control, and it is the reason these four
// ids are split across two Roles rather than collected into one convenient "cycle count" Role.
//
// A principal may of course hold both Roles where an organisation accepts that risk; the point is
// that doing so is then an explicit, audited grant decision rather than an invisible default.
//
// `privileged: false` on the same reasoning as its siblings. DECLARING THIS OBJECT GRANTS NOTHING.
export const INVENTORY_CYCLE_COUNT_COUNTER_ROLE: Role = Object.freeze({
  id: "inventoryCycleCountCounter",
  name: "Inventory Cycle Count Counter",
  description:
    "Durable least-privilege Role for performing a physical cycle count: opening a count, submitting counted quantities, and cancelling one. Carries exactly inventory.cycleCount.create/submit/cancel and deliberately NOT inventory.cycleCount.reconcile, so the principal who reports a variance is not also the one who approves the adjustment. Declaring it grants nothing; a principal holds it only via a governed, audited roleAssignment.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: [
    "inventory.cycleCount.create",
    "inventory.cycleCount.submit",
    "inventory.cycleCount.cancel",
  ],
}) as Role;

// Cycle count reconciler -- the approving half of the control described above. Carries exactly
// inventory.cycleCount.reconcile: the authority to accept a submitted count and let it adjust
// on-hand quantity through the governed reconcile command's own append-only ledger write.
//
// It carries no ability to open or submit a count, which is what keeps the two halves independent:
// a reconciler can only ever act on a count somebody else reported.
//
// `privileged: false`. Reconciling adjusts inventory, not access: it administers no security policy,
// grants no admin authority, and cannot alter or suppress the audit evidence of its own decision --
// the adjustment and its Audit Event are written in the command's single transaction.
// DECLARING THIS OBJECT GRANTS NOTHING.
export const INVENTORY_CYCLE_COUNT_RECONCILER_ROLE: Role = Object.freeze({
  id: "inventoryCycleCountReconciler",
  name: "Inventory Cycle Count Reconciler",
  description:
    "Durable least-privilege Role for approving a submitted cycle count and allowing it to adjust on-hand quantity. Carries exactly inventory.cycleCount.reconcile and nothing else -- notably no authority to open or submit a count, so a reconciler can only act on a count reported by someone else. Declaring it grants nothing; a principal holds it only via a governed, audited roleAssignment.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: ["inventory.cycleCount.reconcile"],
}) as Role;

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// SCANNER OPERATIONS -- the four Roles that make the scanner reachable by the people it was built for.
//
// WHY NEW ROLES RATHER THAN PERMISSIONS ON warehouseAssociate / partsAssociate. Those four are
// ORG-CHART POSITIONS and carry no permissions by design -- "Carries no permissions of its own" is
// written into each of them. Position says where someone sits; a functional Role says what they may
// do, and a principal holds both. Putting scanner capabilities onto a position Role would collapse
// that distinction and make every future warehouse hire an inventory writer by virtue of their job
// title. These follow INVENTORY_TRANSFER_OPERATOR_ROLE's pattern exactly.
//
// DECLARING ANY OF THESE GRANTS NOTHING. A principal holds one only via a governed, audited
// roleAssignment.

// Put-away operator -- the floor job: stow what has arrived, stage what is going out.
//
// Carries bin.read because a stow must confirm the rack is real before anything goes into it, and
// placement.record because that is the act itself. It deliberately does NOT carry bin.manage:
// putAwayCommand.ts states the rule plainly -- "a warehouse operator stows all day and should never
// be able to retire a rack." Nor does it carry inventory.stock.receive: accepting stock into the
// company's custody and recording where it was put are different authorities, and Decision #116 is
// what makes that separation possible. A placement writes no ledger event, changes no quantity and
// touches no balance, which is precisely why this Role is safe to hand out widely.
//
// SINCE BIN-P6 (Decision #170) A BIN IS A CUSTODY LOCATION, so this Role alone no longer completes an
// AUTHORITATIVE put-away: moving quantity from the warehouse floor into a bin is a relocation, and that
// authority lives in INVENTORY_STOCK_RELOCATION_OPERATOR_ROLE below (Owner ruling B1, 2026-09-10).
// The person doing authoritative put-away holds BOTH Roles. placement.record still implies nothing
// about movement -- placement authority is not movement authority.
export const INVENTORY_PUT_AWAY_OPERATOR_ROLE: Role = Object.freeze({
  id: "inventoryPutAwayOperator",
  name: "Inventory Put-Away Operator",
  description:
    "Durable least-privilege Role for stowing and staging stock: confirming a bin exists and recording that stock was placed in it. Carries exactly inventory.location.bin.read and inventory.placement.record. It confers NO authority to create or retire racking, no receiving authority, and no ability to change any quantity or move stock between locations -- a placement records where stock was put, never what there is. Authoritative put-away into bin custody (Decision #170) additionally requires the Inventory Stock Relocation Operator Role. Declaring it grants nothing; a principal holds it only via a governed, audited roleAssignment.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: [
    "inventory.location.bin.read",
    "inventory.placement.record",
  ],
}) as Role;

// Bin administrator -- labelling the racking, and retiring it.
//
// A different audience from the operator above, and a much smaller one. Retiring a bin moves no
// stock, but it removes a destination the floor depends on, and a bin that vanishes mid-shift is how
// a stow ends up recorded somewhere nobody intended. bin.read is included because administering a
// bin requires resolving it first.
export const INVENTORY_BIN_ADMINISTRATOR_ROLE: Role = Object.freeze({
  id: "inventoryBinAdministrator",
  name: "Inventory Bin Administrator",
  description:
    "Durable least-privilege Role for maintaining the physical bin registry: creating, deactivating and reactivating bins within a warehouse. Carries exactly inventory.location.bin.manage and inventory.location.bin.read. A bin is a custody location inside its warehouse (Decision #160/#170), but administering one moves no stock and changes no balance. It carries no authority to place or relocate stock into a bin. Declaring it grants nothing; a principal holds it only via a governed, audited roleAssignment.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: [
    "inventory.location.bin.manage",
    "inventory.location.bin.read",
  ],
}) as Role;

// Stock relocation operator -- moving stock WITHIN one warehouse's custody (Owner ruling B1,
// 2026-09-10; Decision #170): warehouse floor -> bin, bin -> bin, bin -> floor, through the governed
// relocateStock command (Scan -> Move stock).
//
// WHY NOT inventoryTransferOperator: Transfer is CROSS-CUSTODY authority (create/dispatch/receive/
// cancel between warehouses and trucks). Granting it to someone so they can shelve stock would be
// excessive, so same-warehouse relocation is its own authority and its own Role.
//
// Carries exactly what the Move stock scanner needs: bin.read to resolve a scanned bin label,
// catalog.alias.read because the scanner resolves barcodes and aliases through the governed
// resolveScannedPartIdentifier read, catalog.read because a movement operator must see WHICH Part the
// scan resolved (the governed lookupScannedPart projection -- read-only, never a catalog write; Owner
// ruling 2026-09-10), and stock.relocate -- the act itself. NOT placement.record
// (put-away holds both Roles), NOT bin.manage, NOT inventory.transfer.*, NOT stock.receive, NOT
// cycle count. `privileged: false`: it administers no access policy and cannot suppress the audit
// event its relocation writes. DECLARING THIS OBJECT GRANTS NOTHING.
export const INVENTORY_STOCK_RELOCATION_OPERATOR_ROLE: Role = Object.freeze({
  id: "inventoryStockRelocationOperator",
  name: "Inventory Stock Relocation Operator",
  description:
    "Durable least-privilege Role for moving stock between locations of the SAME warehouse (floor to bin, bin to bin, bin to floor) through the governed relocateStock command. Carries exactly inventory.location.bin.read, inventory.catalog.read, inventory.catalog.alias.read and inventory.stock.relocate -- the two catalog reads are read-only, so a movement operator can see which Part a scan resolved. It confers NO Transfer authority (no cross-warehouse or truck movement), no placement recording, no racking administration, no receiving and no cycle-count authority, and it creates or destroys no quantity -- a relocation conserves the warehouse total. Declaring it grants nothing; a principal holds it only via a governed, audited roleAssignment.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: [
    "inventory.location.bin.read",
    "inventory.catalog.read",
    "inventory.catalog.alias.read",
    "inventory.stock.relocate",
  ],
}) as Role;

// Transfer receiver -- accepting a Transfer that has arrived, and nothing else (Owner ruling B1,
// 2026-09-10). Closes the technician over-grant: the only Role carrying inventory.transfer.receive was
// inventoryTransferOperator, which also creates, dispatches and cancels. A technician accepting stock
// onto their truck needs the receive step alone. A functional Role, not a technician-title grant: a
// person holds it alongside their position Role. DECLARING THIS OBJECT GRANTS NOTHING.
export const INVENTORY_TRANSFER_RECEIVER_ROLE: Role = Object.freeze({
  id: "inventoryTransferReceiver",
  name: "Inventory Transfer Receiver",
  description:
    "Durable least-privilege Role for accepting an in-transit Transfer at its destination (a warehouse or a technician's truck). Carries exactly inventory.transfer.receive. It confers NO authority to create, dispatch or cancel a Transfer, and no receiving, relocation or stock-adjustment authority. Declaring it grants nothing; a principal holds it only via a governed, audited roleAssignment.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: ["inventory.transfer.receive"],
}) as Role;

// Returns intake clerk -- recording that something came back.
//
// Carries intake and NOTHING adjacent, because Decision #118 makes intake and disposition separate
// authorities and a return must never automatically restore sellable stock. There is deliberately no
// disposition capability here -- not because it was forgotten, but because disposition does not
// exist, and its open decisions are packaged in
// docs/product/returns-disposition-decision-package.md. When it exists it gets its own Role.
export const INVENTORY_RETURNS_INTAKE_CLERK_ROLE: Role = Object.freeze({
  id: "inventoryReturnsIntakeClerk",
  name: "Inventory Returns Intake Clerk",
  description:
    "Durable least-privilege Role for taking a return in: recording what came back, from where, in what condition, and leaving it AWAITING_DISPOSITION. Carries exactly inventory.returns.intake. It confers NO disposition authority and cannot restore anything to sellable stock -- intake and disposition are separate authorities (Decision #118). Declaring it grants nothing; a principal holds it only via a governed, audited roleAssignment.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: [
    "inventory.returns.intake",
  ],
}) as Role;

// Inventory lookup reader -- the read bundle a scanning operator needs to answer "what is this".
//
// Every id here is a READ. Nothing in this Role can write anything, which is what makes it the one
// scanner Role safe to grant broadly -- including to people who never touch stock.
//
// A BUNDLE rather than four Roles because these four reads answer one question between them: what is
// this thing, what is it called elsewhere, how many are there, and where. Splitting them would
// produce Roles nobody would ever grant separately, which is fragmentation rather than least

// ═══════════════════════════════════ REPORTING ═══════════════════════════════════
//
// Owner decision 2026-08-21. Reporting authority is TIERED and CAPABILITY-DRIVEN, expressed as
// three functional Roles rather than 39 capability ids copied into ten business titles.
//
// WHY FUNCTIONAL ROLES AND NOT BUSINESS-TITLE COMPOSITION. Reporting is read of data the Role can
// already see -- a Sales Manager reading a customer report learns nothing they could not read
// record by record. But the 34 object/field reads are NOT uniform in sensitivity, and a single
// bundle attached to manager titles would hand payment terms to whoever inherited a manager's list.
// Keeping reporting separately grantable is what lets it be withheld from one person without
// redesigning their job.
//
// THE CATALOG CANNOT EXPRESS EVERY SENSITIVITY THE OWNER ASKED FOR, and no id was invented to
// pretend otherwise. See REPORTING_SENSITIVITY_CAPABILITY_GAP below.

// Tier 1 -- ordinary operational reporting. The 26 ACTIVE non-sensitive object/field reads over
// Customer, Contact, Location and Equipment, plus the non-destructive definition operations.
//
// Deliberately EXCLUDES the five finance-sensitive customer fields (tier 2) and
// report.definition.delete (owner-only). Also excludes the three currently-inactive reads
// (customer notes, customer accountOwner, location accessNotes): they are plausibly sensitive and
// resolve DENY regardless, so adding them would be a grant made on a guess.
export const REPORT_VIEWER_ROLE: Role = Object.freeze({
  id: "reportViewer",
  name: "Report Viewer",
  description:
    "Ordinary operational reporting: read the non-sensitive Customer, Contact, Location and Equipment report fields and open saved report definitions. Carries no finance-sensitive field, no authoring and no delete. Declaring it grants nothing; a principal holds it only via a governed, audited roleAssignment.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: [
    "report.definition.read",
    "report.customer.read",
    "report.customer.field.name.read",
    "report.customer.field.status.read",
    "report.customer.field.relationshipTypes.read",
    "report.customer.field.tags.read",
    "report.customer.field.externalIds.read",
    "report.customer.field.createdAt.read",
    "report.contact.read",
    "report.contact.field.name.read",
    "report.contact.field.email.read",
    "report.contact.field.phone.read",
    "report.contact.field.role.read",
    "report.contact.field.customer.read",
    "report.location.read",
    "report.location.field.name.read",
    "report.location.field.address.read",
    "report.location.field.customer.read",
    "report.equipment.read",
    "report.equipment.field.name.read",
    "report.equipment.field.status.read",
    "report.equipment.field.identity.read",
    "report.equipment.field.dates.read",
    "report.equipment.field.notes.read",
    "report.equipment.field.customer.read",
    "report.equipment.field.location.read",
    "report.equipment.field.createdAt.read",
  ],
}) as Role;

// Tier 2 -- finance-oriented reporting. The five customer fields that carry commercial terms.
//
// ADDITIVE, NOT A SUPERSET. A holder needs reportViewer as well to read ordinary fields; this Role
// carries ONLY the sensitive five, so it can be withheld from an operations manager who legitimately
// holds tier 1. Making it a superset would have made "reporting access" one decision instead of two.
export const REPORT_FINANCE_VIEWER_ROLE: Role = Object.freeze({
  id: "reportFinanceViewer",
  name: "Report Finance Viewer",
  description:
    "Finance-oriented reporting: the commercial-terms Customer report fields (payment terms, tax status, commercial profile, billing contact, billing address). Additive to reportViewer rather than a superset, so ordinary and finance-sensitive reporting stay two separate grants. Declaring it grants nothing.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: [
    "report.customer.field.paymentTerms.read",
    "report.customer.field.taxStatus.read",
    "report.customer.field.commercialProfile.read",
    "report.customer.field.billingContact.read",
    "report.customer.field.billingAddress.read",
  ],
}) as Role;

// Tier 3 -- saved-report authoring. Creating, renaming and duplicating definitions.
//
// report.definition.delete is DELIBERATELY ABSENT and stays Owner/Admin-only per the Owner's
// decision. Authoring a shared definition and destroying one are different acts: a delete removes
// something other people depend on, and there is no per-definition ownership model to scope it.
export const REPORT_AUTHOR_ROLE: Role = Object.freeze({
  id: "reportAuthor",
  name: "Report Author",
  description:
    "Saved-report authoring: create, rename and duplicate report definitions. Deliberately excludes report.definition.delete, which remains Owner/Admin-only because destroying a shared definition is not authoring one. Declaring it grants nothing.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: [
    "report.definition.create",
    "report.definition.rename",
    "report.definition.duplicate",
  ],
}) as Role;

// ═══════════════════════════════ EQUIPMENT CATALOG ═══════════════════════════════
//
// Owner decision 2026-08-21. A STANDALONE functional Role for equipment model/compatibility
// administration, explicitly NOT composed into Service Manager, Shop Manager, Shop Associate,
// Technician, Parts Associate, or any Installed Base authority.
//
// WHY STANDALONE. Working ON equipment is not administering the equipment MODEL CATALOG. That
// conflation is not hypothetical here -- it produced one of the three semantic mapping errors this
// program caught, where a CRUD cell reading "edit equipment" would have handed catalog
// administration to technicians and shop staff because they service the customer's units.
//
// The Installed Base -- the customer's actual assets -- is a different object and remains governed
// separately. Nothing in this Role touches it.
//
// MIRRORS inventoryCatalogAdministrator exactly, which is the argument for its shape: the part
// master is administered by a standalone Role rather than by a manager title, and the equipment
// model catalog is the same kind of object.
//
// THE FOUR COMPATIBILITY IDS ARE NOT INCLUDED. equipment.compatibility.view / .import / .verify /
// .correct stay Owner/Admin-only: the Equipment Compatibility engine (D4) is still a draft, and the
// Owner ruled that draft authority is not activated merely because a Role now exists to hold it.
// Defining this Role with only what has a finished engine behind it is the honest scope; the
// compatibility ids can be added by a later decision when there is something to authorize.
export const EQUIPMENT_CATALOG_ADMINISTRATOR_ROLE: Role = Object.freeze({
  id: "equipmentCatalogAdministrator",
  name: "Equipment Catalog Administrator",
  description:
    "Administers the governed equipment MODEL catalog (equipment.model.manage). Standalone and least-privilege, mirroring inventoryCatalogAdministrator for the part master. Confers no authority over the customer Installed Base, no Work Order authority, and none of the draft Equipment Compatibility capabilities. Declaring it grants nothing.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: ["equipment.model.manage"],
}) as Role;

// ═══════════════════════════════════ RECEIVING ═══════════════════════════════════
//
// Owner decision 2026-08-21, from the coverage finding: Receiving had ZERO assigned workers and 32
// operable ones, every one of them through legacy compatibility authority.
//
// WHY A STANDALONE ROLE RATHER THAN COMPOSITION INTO warehouseAssociate. Business intent does not
// say every warehouse or parts worker receives stock. Receiving is a station: someone stands at the
// dock, accepts custody of goods into the company, and is accountable for what was accepted.
// Composing it into an associate title would recreate at the governed level exactly the problem the
// coverage finding exposed -- everyone able to receive, nobody responsible for it.
//
// It also honours a deferral that is already recorded: compatibilityRoles.ts notes PARTS_ASSOCIATE
// is DEFERRED for inventory.stock.receive "until a separately ratified scoped model or an explicit
// Owner acceptance of global Receiving authority". Composing receiving into an associate Role would
// quietly resolve that deferral by the back door. A standalone Role leaves it exactly where it is.
//
// RECEIVING IS NOT TRANSFER. inventory.transfer.receive moves custody BETWEEN internal locations;
// inventory.stock.receive accepts goods INTO the company from outside. The transfer operator does
// not get this id and must not.
export const INVENTORY_RECEIVING_CLERK_ROLE: Role = Object.freeze({
  id: "inventoryReceivingClerk",
  name: "Inventory Receiving Clerk",
  description:
    "Accepts purchased stock into the company's custody (inventory.stock.receive). A station, not a job title: assigned per employee so receiving has named accountability rather than being available to everyone who works in a warehouse. Confers no transfer, put-away, count or catalog authority. Declaring it grants nothing.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: ["inventory.stock.receive"],
}) as Role;

// ═══════════════════════ SERIALIZED EQUIPMENT — TWO STATIONS, NOT ONE ═══════════════════════
//
// Owner decision 2026-08-23. Both capabilities existed, held by admin and owner only through the
// legacy compatibility superset -- authority that exists with nobody accountable for it, which is
// exactly the coverage finding that produced INVENTORY_RECEIVING_CLERK_ROLE.
//
// WHY TWO ROLES AND NOT ONE "equipment lifecycle" ROLE. Bringing a machine into the company's books
// and placing that machine at a customer are different accountable acts. Combined in one Role, a
// single person could declare a unit into existence out of nothing -- non-PO acquisition asserts
// ownership with no supplier, no order and no receipt to check it against -- and then install it at
// a customer, with no second party anywhere in the chain. The unit's entire history from
// non-existence to customer premises would rest on one person's word.
//
// That is the same control the platform already keeps between inventory.stock.receive (goods enter
// the company) and inventory.transfer.receive (goods move inside it), and between the cycle-count
// counter and the reconciler. Splitting it costs nothing; combining it cannot be undone by
// assignment.
//
// NEITHER ROLE CONFERS THE OTHER, and neither carries receiving, transfer, put-away, count or
// catalog authority. An employee who needs two stations is staffed for two stations, visibly.

export const INVENTORY_SERIALIZED_ASSET_ACQUIRER_ROLE: Role = Object.freeze({
  id: "inventorySerializedAssetAcquirer",
  name: "Inventory Serialized Asset Acquirer",
  description:
    "Brings an already-owned serialized machine onto the books without a purchase (inventory.serializedAsset.acquire) -- opening balances, legacy migration, units the company already holds. A station with named accountability, because a non-PO acquisition asserts ownership with no supplier document to check it against. Confers NO equipment.install: acquiring a unit into company custody is not authority to place it at a customer. Confers no receiving, transfer, put-away, count or catalog authority. Declaring it grants nothing.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: ["inventory.serializedAsset.acquire"],
}) as Role;

export const EQUIPMENT_INSTALLER_ROLE: Role = Object.freeze({
  id: "equipmentInstaller",
  name: "Equipment Installer",
  description:
    "Installs a serialized machine at a customer location, creating the Equipment record (equipment.install). Irreversible by design: Equipment accountId and locationId are immutable after create and nothing clears the asset's currentEquipmentId, so this authority places a unit permanently. Confers NO inventory.serializedAsset.acquire: an installer works from units the company already holds, and cannot bring the unit it installs into existence. Confers no receiving, transfer or catalog authority, no customer reassignment, and no equipment recovery -- recovery is an unimplemented authority (EQUIPMENT RECOVERY AUTHORITY GAP) and this Role must not be read as covering it. Declaring it grants nothing.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: ["equipment.install"],
}) as Role;

// privilege.
export const INVENTORY_LOOKUP_READER_ROLE: Role = Object.freeze({
  id: "inventoryLookupReader",
  name: "Inventory Lookup Reader",
  description:
    "Durable least-privilege READ-ONLY Role for looking a part up by code, barcode or serial and seeing what is on hand and where. Carries exactly inventory.balance.read, inventory.catalog.alias.read, inventory.serializedAsset.read and inventory.location.display.read. Every id is a read: this Role writes nothing, moves nothing, and confers no catalog administration -- notably NOT inventory.catalog.manage, which administers aliases rather than resolving them. Declaring it grants nothing; a principal holds it only via a governed, audited roleAssignment.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: [
    "inventory.balance.read",
    "inventory.catalog.alias.read",
    "inventory.serializedAsset.read",
    "inventory.location.display.read",
  ],
}) as Role;

// ═══════════════════════════════ TECHNICIAN LABOR — TWO STATIONS ═══════════════════════════════
//
// Labor Domain V1. Recording your own time and correcting somebody's recorded time are different
// acts with different accountability -- a technician fixing their own typo and a manager adjusting a
// crew's hours are not the same authority even when the keystrokes match. So two Roles, following
// the same reasoning that split acquisition from installation.
//
// NEITHER IS THE `technician` COMPATIBILITY ROLE. Job title is not authorization: a technician who
// has not been staffed to record labor does not record labor, and a manager who never touches a van
// may still correct it.
//
// Both capabilities are registered active:false and are activated in NO environment, so these Roles
// currently confer nothing anywhere -- activation is a separate, Owner-authorized decision.

export const TECHNICIAN_LABOR_RECORDER_ROLE: Role = Object.freeze({
  id: "technicianLaborRecorder",
  name: "Technician Labor Recorder",
  description:
    "Records labor the holder personally performed, on Work Orders assigned to them (workOrder.labor.record). Never for another technician -- the command carries no technicianId and refuses one. Confers NO correction authority: a mistake goes to whoever holds workOrder.labor.correct. Confers no visibility of labor cost, rates or billing. Declaring it grants nothing.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: ["workOrder.labor.record"],
}) as Role;

export const WORK_ORDER_LABOR_CORRECTOR_ROLE: Role = Object.freeze({
  id: "workOrderLaborCorrector",
  name: "Work Order Labor Corrector",
  description:
    "Corrects a recorded labor entry by reversing it and recording a replacement (workOrder.labor.correct). The original is never deleted -- it keeps its author and values and points at what replaced it, so a changed total can always be explained. Confers NO authority to record new labor, and no rate, cost or billing visibility. Declaring it grants nothing.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: ["workOrder.labor.correct"],
}) as Role;


// PERFORMANCE GOAL SUBJECT -- the narrow, durable READ grant that lets a person see the target they
// are measured against.
//
// WHY A SEPARATE ROLE RATHER THAN ADDING THE ID TO `technician` / `dispatcher`. Those two are
// COMPATIBILITY Roles, and their contract is precise: each "reproduces today's security-role matrix
// EXACTLY". They are the parity ORACLE the shadow harness scores the resolver against, so putting a
// capability on one that has no legacy counterpart would corrupt the measuring instrument to add a
// feature. The governed business Roles (salesperson, partsAssociate, warehouseAssociate) carry
// performance.goal.read directly because they are under no such contract; this Role exists for the
// principals whose position is expressed only as a compatibility Role.
//
// Carries EXACTLY ONE id, and it is a read. It confers no authority to author, approve, supersede or
// retire anything, and no reach over any metric's ACTUAL. Holding it at global scope still shows the
// holder only the goals their governed hierarchical visibility reaches -- for a leaf position, that
// is their own and nobody else's.
export const PERFORMANCE_GOAL_SUBJECT_ROLE: Role = Object.freeze({
  id: "performanceGoalSubject",
  name: "Performance Goal Subject",
  description:
    "Durable least-privilege READ-ONLY Role: see the performance goals within your own governed visibility. Carries exactly performance.goal.read -- it authors nothing, approves nothing, and confers no reach over any metric's actual. Intended for principals whose position is expressed as a compatibility Role (technician, dispatcher), which cannot carry it directly without corrupting the parity oracle. Declaring it grants nothing; a principal holds it only via a governed, audited roleAssignment.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: ["performance.goal.read"],
}) as Role;

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// EMAIL CONNECTIONS + INBOUND WORK -- two Roles, because there are two audiences and they are not the
// same people.
//
// The administrator who authorizes a Microsoft 365 or Google Workspace connection and decides which
// mailbox is the warranty mailbox is doing configuration. The Service coordinator who reads what arrived
// and turns it into a Work Order is doing operations. Giving the coordinator the administration Role so
// they could work the queue -- the shortcut this split exists to prevent -- would hand every queue worker
// the ability to repoint the company's inbound mail.
//
// DECLARING EITHER OBJECT GRANTS NOTHING. A principal holds one only via a governed, audited
// roleAssignment, and the capabilities themselves are registered active:false besides.
export const EMAIL_INTAKE_ADMINISTRATOR_ROLE: Role = Object.freeze({
  id: "emailIntakeAdministrator",
  name: "Email Intake Administrator",
  description:
    "Durable least-privilege Role for configuring EOS email intake: provider connections, operational mailboxes and routing rules. Carries exactly administration.emailIntake.read/manage and deliberately NOT any service.inboundWork.* id, so configuring the mailboxes confers no authority to accept, decline or attach the work that arrives in them. Declaring it grants nothing; a principal holds it only via a governed, audited roleAssignment.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: ["administration.emailIntake.read", "administration.emailIntake.manage"],
}) as Role;

// The operational half. Carries the queue read and all three decisions: in a service business the person
// who reviews an inbound request is the person who accepts or turns it away, and splitting the decisions
// across two Roles would describe an approval step this workflow does not have. The ids stay separate in
// the catalog so an organisation that DOES want that separation can express it without a code change.
export const SERVICE_INBOUND_WORK_REVIEWER_ROLE: Role = Object.freeze({
  id: "serviceInboundWorkReviewer",
  name: "Service Inbound Work Reviewer",
  description:
    "Durable least-privilege Role for working the Service Inbound Work queue: read a request, then accept it into a governed Work Order, decline it with a reason, or attach it to existing work. Carries no administration.emailIntake.* id -- a reviewer cannot connect, disconnect or repoint a mailbox. Declaring it grants nothing; a principal holds it only via a governed, audited roleAssignment.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: [
    "service.inboundWork.read",
    "service.inboundWork.accept",
    "service.inboundWork.decline",
    "service.inboundWork.attachExisting",
  ],
}) as Role;

export const GOVERNED_BUSINESS_ROLES: Readonly<Record<string, Role>> = Object.freeze({
  generalEmployee: GENERAL_EMPLOYEE_ROLE,
  officeManager: OFFICE_MANAGER_ROLE,
  salesManager: SALES_MANAGER_ROLE,
  marketingManager: MARKETING_MANAGER_ROLE,
  purchasingManager: PURCHASING_MANAGER_ROLE,
  shopManager: SHOP_MANAGER_ROLE,
  shopAssociate: SHOP_ASSOCIATE_ROLE,
  salesperson: SALESPERSON_ROLE,
  generalManager: GENERAL_MANAGER_ROLE,
  warehouseManager: WAREHOUSE_MANAGER_ROLE,
  warehouseAssociate: WAREHOUSE_ASSOCIATE_ROLE,
  partsManager: PARTS_MANAGER_ROLE,
  partsAssociate: PARTS_ASSOCIATE_ROLE,
  controller: CONTROLLER_ROLE,
  supportStaff: SUPPORT_STAFF_ROLE,
  accountingManager: ACCOUNTING_MANAGER_ROLE,
  financeManager: FINANCE_MANAGER_ROLE,
  fieldManager: FIELD_MANAGER_ROLE,
  operationsManager: OPERATIONS_MANAGER_ROLE,
  owner: OWNER_ROLE,
  inventoryCreateExecutor: INVENTORY_CREATE_EXECUTOR_ROLE,
  inventoryCatalogAdministrator: INVENTORY_CATALOG_ADMINISTRATOR_ROLE,
  workOrderPartsPlanner: WORK_ORDER_PARTS_PLANNER_ROLE,
  crmActivityContributor: CRM_ACTIVITY_CONTRIBUTOR_ROLE,
  inventoryTransferOperator: INVENTORY_TRANSFER_OPERATOR_ROLE,
  inventoryCycleCountCounter: INVENTORY_CYCLE_COUNT_COUNTER_ROLE,
  inventoryCycleCountReconciler: INVENTORY_CYCLE_COUNT_RECONCILER_ROLE,
  inventoryPutAwayOperator: INVENTORY_PUT_AWAY_OPERATOR_ROLE,
  inventoryBinAdministrator: INVENTORY_BIN_ADMINISTRATOR_ROLE,
  inventoryStockRelocationOperator: INVENTORY_STOCK_RELOCATION_OPERATOR_ROLE,
  inventoryTransferReceiver: INVENTORY_TRANSFER_RECEIVER_ROLE,
  inventoryReturnsIntakeClerk: INVENTORY_RETURNS_INTAKE_CLERK_ROLE,
  inventoryLookupReader: INVENTORY_LOOKUP_READER_ROLE,
  reportViewer: REPORT_VIEWER_ROLE,
  reportFinanceViewer: REPORT_FINANCE_VIEWER_ROLE,
  reportAuthor: REPORT_AUTHOR_ROLE,
  equipmentCatalogAdministrator: EQUIPMENT_CATALOG_ADMINISTRATOR_ROLE,
  inventoryReceivingClerk: INVENTORY_RECEIVING_CLERK_ROLE,
  inventorySerializedAssetAcquirer: INVENTORY_SERIALIZED_ASSET_ACQUIRER_ROLE,
  equipmentInstaller: EQUIPMENT_INSTALLER_ROLE,
  technicianLaborRecorder: TECHNICIAN_LABOR_RECORDER_ROLE,
  workOrderLaborCorrector: WORK_ORDER_LABOR_CORRECTOR_ROLE,
  performanceGoalSubject: PERFORMANCE_GOAL_SUBJECT_ROLE,
  emailIntakeAdministrator: EMAIL_INTAKE_ADMINISTRATOR_ROLE,
  serviceInboundWorkReviewer: SERVICE_INBOUND_WORK_REVIEWER_ROLE,
});
