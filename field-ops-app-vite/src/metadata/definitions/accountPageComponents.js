// accountRecordPage — component registration + the real capability resolver.
//
// GOVERNANCE: docs/governance/metadata-architecture-ip-boundary.md §6, §8;
// docs/specifications/metadata-architecture.md §7-§8.
//
// This is the "later wiring lane" metadataAccountPageDefinition.test.mjs's
// "componentId sections use REGISTERED-id shape ... named for a later wiring lane" test refers
// to. accountPage.js (definitions/accountPage.js) names five componentIds it does not itself
// register — REGISTRATION_PENDING there by design, since a definition may only ever hold an id
// string (§8). This module is where those ids become the REAL, EXISTING section components
// already shipping in src/modules/accounts/ — nothing here is a redesign, and nothing here
// invents a component that was not already rendering on AccountDetail.jsx.
//
// §8 — REGISTERED HERE, NEVER IN THE DEFINITION. componentRegistry.register() is called from
// application code (this module), not from accountPage.js. Re-registering an id throws (the
// registry's own contract — see registry.js) rather than silently shadowing an earlier
// registration, which is why `registerAccountPageComponents` is idempotent-by-import (ES module
// evaluation runs it exactly once per process) and only re-invoked deliberately in tests after
// componentRegistry.__resetForTest().
//
// ─────────────────────────────────────────────────────────────────────────────
// WIRING SCOPE — a partial, honest wiring, not a full swap
//
// AS OF X-ACCOUNT-PAGE-WIRING-COMPLETE: MetadataRecordPage's three former renderer gaps are
// CLOSED (commit 27b109bb — a generic FIELD_GROUP renderer, a default RELATED_LIST binding,
// and the `embedded` prop). Every one of accountRecordPage's nine non-header sections can now
// MECHANICALLY produce output through MetadataRecordPage. That is a necessary condition for
// wiring a section in, not a sufficient one — this lane evaluated the remaining six sections
// (accountAttention, the four RELATED_LIST sections, and the two FIELD_GROUP sections) against
// what they would actually replace and found a concrete, cited reason each one still renders
// WORSE through metadata than hand-rendered (see the block below this one for the full,
// per-section evidence). None of the six were wired.
//
// What DOES render through the metadata path (as of A-ACCOUNT-WIRE-CALLABLE-LISTS-2, see
// below): the same three componentId sections the prior lane already swapped (financials ->
// activityAndNotes -> serviceActivity), PLUS the Opportunities and Sales Orders RELATED_LIST
// sections — all five now exported together as accountRecordPageMainSubset, in accountPage.js's
// own order (opportunities -> salesOrders -> financials -> activityAndNotes -> serviceActivity).
//
// AccountHealthStrip and accountAttentionSection are both REGISTERED here (so the
// registry-completeness test holds for every componentId accountRecordPage names) but
// deliberately left HAND-RENDERED in AccountDetail.jsx.
//
// X-ACCOUNT-WIRE-CALLABLE-LISTS — commit 6c6480d8 later closed the ONE structural blocker
// this lane's own "opportunities / salesOrders" finding above named (no CALLABLE-read path).
// That gap closing did not change the count above: opportunities/salesOrders were
// RE-EVALUATED (not re-assumed fixed) and were left hand-rendered at that point, for two
// different, newly-found reasons (a raw-epoch-millisecond TIMESTAMP column, and
// DefaultRelatedList wiring no row navigation at all) — recorded on the ledger as
// X-LIST-TIMESTAMP-FORMATTING / X-LIST-ROW-NAVIGATION (docs/orchestration/metadata-program/
// LEDGER.md) and reviewed in PR #1202.
//
// A-ACCOUNT-WIRE-CALLABLE-LISTS-2 — commit 6998306f closed BOTH of those blockers in the
// renderer (outside this module's writeScope both times, exactly as PR #1202 predicted):
// cellValue() (listPresentation.js) now has a TIMESTAMP/DATE branch through the shared
// formatTimestamp() (domain/displayTimestamp.js), and DefaultRelatedList (MetadataRecordPage.jsx)
// now builds onRowClick from a resolved list definition's own rowNavigationTo. RE-VERIFIED
// against the real opportunity.js/salesOrder.js/account.js — not re-assumed fixed a second
// time — and both sections are now WIRED (see accountRecordPageMainSubset below).
//
// One thing verification surfaced that was NOT part of either closed blocker: opportunity.js's
// own rowNavigationTo ("/sales/opportunities/:id") names a route that has never existed
// anywhere in App.jsx — confirmed by a repo-wide route search; the only Opportunity-adjacent
// route is the shared workspace at /customers/opportunities, which takes no :id. That file is
// was reported by that lane as REGISTRATION_PENDING and has since been REMOVED from
// opportunity.js at the integration step, rather than stripped here: a consumer defending
// against a bad declaration leaves the bad declaration in place for the next consumer.
// Opportunities rows are therefore honestly non-focusable via DefaultRelatedList's own
// already-tested "absent rowNavigationTo" branch. Sales Orders' rowNavigationTo
// ("/customers/opportunities/sales-order/:salesOrderId") IS a real, working route
// (App.jsx -> SalesOrderDetail.jsx) and is wired through unmodified.
//
// ─────────────────────────────────────────────────────────────────────────────
// X-ACCOUNT-PAGE-WIRING-COMPLETE — re-evaluated after the renderer's three gaps closed
// (commit 27b109bb: FIELD_GROUP's entityResolver, RELATED_LIST's default binding, and the
// `embedded` prop). Closing those gaps made MORE sections MECHANICALLY renderable through
// MetadataRecordPage — it did not make all of them SAFE to render that way. Each candidate
// below was evaluated against the real components/definitions it would replace, not just
// against whether MetadataRecordPage could now produce SOME output for it. None passed;
// each stays hand-rendered for a specific, cited reason. "A partial, honest wiring beats a
// full one that silently changes what a user sees" (the standing rule this lane inherited)
// held again, for entirely new reasons than the ones that applied before 27b109bb.
//
// accountAttentionSection (SIDE, componentId path, `embedded` now available) — NOT wired,
// and `embedded` does not rescue it. `embedded` only fixes the REGION-level symptom (a
// zero-section plan becoming a page-level FailureState); it does nothing about the
// SECTION-level cause: accountPage.js declares ONE capability, finance.read, for a
// component that internally composes TWO sources at two different authority levels
// (AccountAttentionSection.jsx: `useAccountAr`, finance.read-gated, PLUS
// `useAccountAttentionWorkOrders`, an UNGATED Rules-by-role client read of scheduled Work
// Orders). MetadataRecordPage's capabilityRequirement is a single boolean gate on the whole
// section (§6 — applyVisibility has no concept of "partially visible"), so wiring this
// section can only honor the COARSER of the two authorities: when finance.read is denied,
// the entire section vanishes, including the ungated Work-Order-past-due half a hand-mounted
// AccountAttentionSection would still show (with its own honest "Accounts Receivable: not
// authorized to view" note beside the real WO items — see that component's `sourceStatusNote`).
// This is not a theoretical edge case: finance.read is registered catalog-wide `active:false`
// (permissionCatalog.ts) — DENIED for every current viewer — so wiring this section today
// would make the whole Account Attention panel disappear for 100% of users, silently
// discarding real, currently-visible Work-Order attention data. That is exactly the "lost
// graceful degradation" case the honesty constraint on this lane names. Locked in by
// test/accountPageComponents.test.jsx's "embedded does not rescue…" test below.
//
// accountHealthStrip (HIGHLIGHTS, componentId path) — unchanged from the prior lane's
// finding: it sits above the two-column body, and wrapping it in MetadataRecordPage's own
// HIGHLIGHTS container class would be a layout change this lane still cannot verify is
// neutral without a visual pass. Left hand-rendered per this task's own instruction not to
// ship an unverified visual change.
//
// contacts / locations (RELATED_LIST, GAP 2's default binding) — SUPERSEDED by
// A-ACCOUNT-WIRE-CONTACTS-LOCATIONS (X-RELATED-LIST-ACTIONS, #1211, unblocked this). Both
// were mechanically compatible with DefaultRelatedList (readVia CLIENT_DIRECT, and
// account.js declares both parent-side relationships) but wiring EITHER through the
// DEFAULT binding specifically would still (a) start a SECOND, independent live read of
// the exact same collection query AccountDetail.jsx already runs via
// useContactsForAccount / useLocationsForAccount — data those hooks must keep supplying
// regardless (contacts feeds PrimaryContactSummary and CommercialProfileSection's
// billing-contact resolution) — the exact double-read anti-pattern this file's own
// AR-double-read note tracks (#1094/#1095); and (b), before X-RELATED-LIST-ACTIONS,
// MetadataListGrid had no per-row ref hook to reproduce the post-add keyboard-focus
// handoff (`pendingContactFocus`/`pendingLocationFocus`).
//
// Both are now WIRED — through their OWN `listRenderer` (a SEPARATE MetadataRecordPage
// call, accountRecordPageContactsLocationsSubset below), never DefaultRelatedList: (a) is
// closed by `buildAccountRelatedListPresentation`, which builds the identical
// listPresentation.js render model from the SAME live `contacts`/`locations` hook data
// AccountDetail.jsx already holds — one subscription, reused, never a second one; (b) is
// closed by MetadataListGrid's new `focusRowKey`/`onFocusHandled` (X-RELATED-LIST-ACTIONS),
// wired to the exact same `pendingContactFocus`/`pendingLocationFocus` state AccountDetail.jsx
// already owned. "+ Add Contact" / "Import Contacts" / "+ Add Location" and their modals stay
// exactly as hand-rendered, mounted by AccountDetail.jsx alongside the new
// MetadataRecordPage call — no equivalent exists inside MetadataListGrid/DefaultRelatedList,
// so this lane did not attempt to invent one there. See
// test/accountPageComponents.test.jsx's "contacts / locations RELATED_LIST — WIRED" suite
// for the full re-verification (account scoping, no document id in any cell, the flattened
// Location address / stringified Contact isPrimary fixes below, and the focus-handoff
// parity proof).
//
// opportunities / salesOrders (RELATED_LIST, GAP 2's default binding) — SUPERSEDED by
// A-ACCOUNT-WIRE-CALLABLE-LISTS-2 (see the WIRING SCOPE block above): both BLOCKER 1 and
// BLOCKER 2 below closed with commit 6998306f, and both sections are now WIRED into
// accountRecordPageMainSubset. The paragraph and the two BLOCKER entries below are kept
// verbatim as the historical record of what was true at X-ACCOUNT-WIRE-CALLABLE-LISTS (PR
// #1202) — they no longer describe the current renderer.
//
// opportunities / salesOrders (RELATED_LIST, GAP 2's default binding) — RE-EVALUATED under
// X-ACCOUNT-WIRE-CALLABLE-LISTS after commit 6c6480d8 closed the exact structural blocker
// named below (MetadataRecordPage now routes a RELATED_LIST by the entity's declared
// `readVia`, via callableListSource.js). The CALLABLE gap is genuinely closed — verified
// against the REAL opportunity.js/salesOrder.js/account.js definitions in
// test/accountPageComponents.test.jsx: the account-scoped read goes through the trusted
// callable, correctly scoped to `accountId` via account.js's own relationship, shows the
// real reference number as identity (opportunityNumber / salesOrderNumber, never a document
// id), and a `truncated: true` response honestly renders "Showing the most recent N."
// (MetadataListGrid) rather than presenting a capped page as the whole set. The
// section-level capability gate (opportunity.read/salesOrder.read both registered
// active:false catalog-wide) makes the WHOLE section vanish on denial rather than rendering
// MetadataListGrid's own DENIED state — but that is NOT a new capability regression: it is
// the SAME "absent from the DOM, not merely invisible" behavior already accepted for
// financials/activityAndNotes when THEY were wired (X-ACCOUNT-PAGE-WIRING-COMPLETE, "the
// correct fail-closed reading of accountPage.js's own declaration, not a regression"). See
// the "RE-EVALUATED under X-ACCOUNT-WIRE-CALLABLE-LISTS" tests below.
//
// Still NOT wired — for two DIFFERENT, newly-found reasons, neither fixable inside this
// lane's writeScope (both live in MetadataRecordPage.jsx / listPresentation.js):
//
//   BLOCKER 1 (opportunities only) — opportunity.js declares `expectedCloseAt` as a
//   TIMESTAMP column (epoch milliseconds, its own field comment). listPresentation.js's
//   `cellValue()` has NO formatting branch for TIMESTAMP at all (only ENUM/ENUM_SET resolve;
//   everything else is returned raw), and MetadataListGrid prints that value verbatim into
//   the cell — confirmed repo-wide: no TIMESTAMP renderer exists anywhere in
//   src/metadata/listPresentation.js or MetadataListGrid.jsx today. Wiring the Opportunities
//   related list would show the literal epoch-millisecond number (e.g. "1755993600000") in
//   the "Expected close" column, where AccountOpportunitiesSection today shows a real
//   formatted date via its own `formatDate()`. That is a genuine, confirmed-on-every-row
//   display regression, not a hypothetical one — locked in by the "renders a raw
//   epoch-millisecond timestamp" test below.
//
//   BLOCKER 2 (both, more severe for salesOrders) — DefaultRelatedList
//   (MetadataRecordPage.jsx) passes MetadataListGrid no `onRowClick`, and `rowNavigationTo`
//   (declared on both opportunityRelatedList and salesOrderRelatedList) has NO consumer
//   anywhere in src/ today — confirmed by a repo-wide grep. A wired row would be inert: no
//   click, no keyboard focus (`tabIndex` stays undefined), no link. For Opportunities that
//   loses a mild convenience (today's link only goes to the shared `/opportunities`
//   workspace — AccountOpportunitiesSection's own comment already says the app has no real
//   per-Opportunity route). For Sales Orders it is a real, material loss: App.jsx registers
//   a genuine per-record route (`opportunities/sales-order/:salesOrderId` ->
//   SalesOrderDetail.jsx), and AccountSalesOrdersSection's Link to it today is the only way
//   to open a specific Sales Order from the Account page — wiring would remove that
//   capability entirely, with nothing to replace it. Locked in by the "rows carry no link and
//   no click handler" test below.
//
// Both blockers were structural gaps in files outside this lane's writeScope
// (MetadataRecordPage.jsx, listPresentation.js) — reported at the time as
// REGISTRATION_PENDING / out-of-scope, and left hand-rendered pending that fix.
//
// BOTH CLOSED by commit 6998306f (ledger ids X-LIST-TIMESTAMP-FORMATTING,
// X-LIST-ROW-NAVIGATION) — cellValue() now formats TIMESTAMP/DATE through
// domain/displayTimestamp.js's formatTimestamp(), and DefaultRelatedList now builds
// onRowClick from a resolved list definition's rowNavigationTo. RE-VERIFIED (not
// re-assumed) under A-ACCOUNT-WIRE-CALLABLE-LISTS-2 against the real definitions; see the
// WIRING SCOPE block above for the one thing that verification separately surfaced
// (opportunity.js's own rowNavigationTo value is wrong / points at a route that does not
// exist — REGISTRATION_PENDING there, unrelated to either blocker just closed). Opportunities
// and Sales Orders are now WIRED into accountRecordPageMainSubset below.
//
// commercialProfile (FIELD_GROUP, GAP 1's generic renderer) — the generic FieldGroup renderer
// (`cellValue()` off the raw stored value) has no live identity-resolution step, but two of
// this section's seven fields need one: `accountOwnerEmployeeId` / `billingContactId` are
// REFERENCE fields, and cellValue has no REFERENCE handling — it would print the raw stored
// employee/contact DOCUMENT ID, where CommercialProfileSection today shows the CURRENT
// resolved name via IdentityLine (account.js's own field comment: "the CURRENT resolved
// identity ... never the stored snapshot"). Separately, `taxStatus` must resolve an ABSENT
// stored value to the safe default "Unknown", never a blank (account.js's field comment,
// domain/commercialProfile.js's resolveTaxStatus()) — the generic renderer has no such
// fallback and would show "—" for an unset taxStatus, a different and incorrect fact. Both
// are real data-correctness regressions, not formatting ones. Left hand-rendered.
//
// notesAndIdentifiers (FIELD_GROUP, GAP 1's generic renderer) — no identity-resolution or
// safe-default gap (every field is a plain STRING/TEXT, shown as-is by both paths), but the
// section is declared `collapsedByDefault: true` and AccountDetail.jsx renders it as a
// collapsed `<details>/<summary>` — MetadataRecordPage's <Section> has no collapse concept
// and would render it permanently expanded. That is a confirmed (not merely unverifiable)
// layout change, the same category the health-strip note above and this task's own
// instructions treat as disqualifying. Left hand-rendered.
// ─────────────────────────────────────────────────────────────────────────────
//
// §6 — CAPABILITY DECISIONS COME FROM THE REAL RESOLVER, NEVER INVENTED HERE.
//
// accountPage.js declares capabilityRequirement ids (opportunity.read, salesOrder.read,
// finance.read, crm.activity.read) verified against permissionCatalog.ts and account.js's
// relationship declarations — but a PageDefinition only ever DECLARES; it cannot decide (§6).
// useAccountPageCapabilityDecisions below is the caller's real resolver, and it is NOT a new
// resolver: it is the SAME trusted resolveEffectiveAccessCallable + the SAME fail-closed,
// version-fresh gate access/reportCapabilityAccess.js already exports and
// access/useReportCapabilities.js / access/useOpportunityCapabilities.js already use — those
// primitives (interpretAccessResult, buildHasCapability, the version/feed state machine) are
// explicitly capability-id-agnostic (see useOpportunityCapabilities.js's own header: "the pure
// primitives are shared rather than duplicated"). The only thing specific to this page is WHICH
// capability ids to ask for, and that list is not hand-typed here — it is read directly off
// accountRecordPage via pageRuntime.js's own declaredPageCapabilities(), so it can never drift
// from what the definition actually declares.
//
// No suitable EXISTING hook already requests exactly this id set (useOpportunityCapabilities
// requests only the Opportunity write id; useReportCapabilities requests the Report Builder +
// governed-surface ids) — composing the shared primitives with this page's own declared id list
// is the sanctioned extension point those two hooks already demonstrate, not an invented
// resolver. An empty/loading decision map DENIES every gated section (fail-closed, exactly as
// applyVisibility already requires) — this file passes no permissive default and never widens a
// denial into a grant.

import { createElement, useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { doc, onSnapshot } from "firebase/firestore";
import { componentRegistry } from "../registry.js";
import { declaredPageCapabilities } from "../pageRuntime.js";
import { buildListPresentation } from "../listPresentation.js";
import { accountRecordPage } from "./accountPage.js";
import { accountEntity } from "./account.js";
import { opportunityEntity, opportunityRelatedList } from "./opportunity.js";
import { salesOrderEntity, salesOrderRelatedList } from "./salesOrder.js";
import { contactEntity, contactRelatedList } from "./contact.js";
import { locationEntity, locationRelatedList } from "./location.js";
import { functions, db } from "../../firebase/firebase";
import { USERS_COLLECTION } from "../../domain/constants";
import {
  VERSION_STATUS,
  FEED_STATUS,
  SIGNED_OUT_VERSION,
  IDLE_FEED,
  isValidObservedVersion,
  interpretAccessResult,
  buildHasCapability,
} from "../../access/reportCapabilityAccess.js";
import AccountHealthStrip from "../../modules/accounts/AccountHealthStrip.jsx";
import AccountFinancialsSection from "../../modules/accounts/AccountFinancialsSection.jsx";
import ActivityAndNotesSection from "../../modules/accounts/ActivityAndNotesSection.jsx";
import ServiceActivitySection from "../../modules/accounts/ServiceActivitySection.jsx";
import AccountAttentionSection from "../../modules/accounts/AccountAttentionSection.jsx";
import { useAccountAr } from "../../hooks/useAccountAr";
import { accountArView } from "../../domain/accountArView";
import { useAccountWorkOrderCount } from "../../hooks/useAccountServiceActivity";
import { fetchAccountOpenWorkOrderCount } from "../../domain/accountWorkOrders";

// ── Adapters ────────────────────────────────────────────────────────────────
// MetadataRecordPage's <Section> calls a registered component as `<Component section record />`
// (pageRuntime.js / MetadataRecordPage.jsx). The existing section components were built for
// AccountDetail.jsx's own prop shapes (mostly a bare `accountId`); these adapters translate
// `record` into exactly the props each one already takes — they do not change what any of them
// render, only how they are addressed. Written with createElement rather than JSX: this file is
// a plain .js module (the writeScope names it "the registration module", not a .jsx component
// file), and this project's toolchain does not parse JSX syntax outside .jsx.

function AccountHealthStripSection({ record }) {
  const accountId = record?.id ?? null;
  const arState = useAccountAr(accountId);
  const workOrderCount = useAccountWorkOrderCount(accountId, fetchAccountOpenWorkOrderCount);
  return createElement(AccountHealthStrip, { workOrderCount, arView: accountArView(arState) });
}

function AccountFinancialsSectionAdapter({ record }) {
  return createElement(AccountFinancialsSection, { accountId: record?.id ?? null });
}

function AccountActivityAndNotesSectionAdapter({ record }) {
  return createElement(ActivityAndNotesSection, { accountId: record?.id ?? null });
}

function AccountServiceActivitySectionAdapter({ record }) {
  return createElement(ServiceActivitySection, { accountId: record?.id ?? null });
}

function AccountAttentionSectionAdapter({ record }) {
  return createElement(AccountAttentionSection, { accountId: record?.id ?? null });
}

// The exact five componentIds accountPage.js names — read off the definition, never hand-typed,
// so this list cannot silently drift from what accountRecordPage actually declares.
const COMPONENT_MAP = {
  accountHealthStrip: AccountHealthStripSection,
  accountFinancialsSection: AccountFinancialsSectionAdapter,
  accountActivityAndNotesSection: AccountActivityAndNotesSectionAdapter,
  accountServiceActivity: AccountServiceActivitySectionAdapter,
  accountAttentionSection: AccountAttentionSectionAdapter,
};

/** Every componentId accountRecordPage's sections name, deduplicated. */
export function accountPageComponentIds() {
  return [...new Set(accountRecordPage.sections.map((s) => s.componentId).filter(Boolean))];
}

/**
 * Register every component id accountRecordPage names. Throws on a second call (registry.js's
 * own contract: re-registering an id is refused rather than silently shadowed) — that is
 * deliberate, not a bug to work around; a caller that needs to re-register in a test resets the
 * registry first (componentRegistry.__resetForTest()).
 */
export function registerAccountPageComponents() {
  const ids = accountPageComponentIds();
  const missing = ids.filter((id) => !COMPONENT_MAP[id]);
  if (missing.length) {
    // Fail loudly at registration time rather than silently excluding a section at render time —
    // accountPage.js and this module must name the same five ids.
    throw new Error(`accountPageComponents: no component mapped for ${missing.join(", ")}`);
  }
  for (const id of ids) {
    componentRegistry.register({ id, kind: "RECORD_SECTION", component: COMPONENT_MAP[id] });
  }
  return ids;
}

// Registers once per process: ES module evaluation is cached, so importing this module from
// AccountDetail.jsx (or anywhere else) any number of times runs this exactly once. Tests reset
// the registry explicitly and call registerAccountPageComponents() again themselves.
registerAccountPageComponents();

// ── RELATED_LIST resolvers for Opportunities / Sales Orders ────────────────
// A-ACCOUNT-WIRE-CALLABLE-LISTS-2 — DefaultRelatedList (MetadataRecordPage.jsx) needs a
// `listResolver` (section.listId -> ListViewDefinition) and an `entityResolver` (entityId ->
// EntityDefinition) to drive the RELATED_LIST sections accountPage.js declares. These map
// exactly the same listId/entityId strings accountPage.js/account.js/opportunity.js/
// salesOrder.js already name — no id invented here.
//
// opportunityRelatedList's own `rowNavigationTo` ("/sales/opportunities/:id") is wired to a
// route that does not exist anywhere in App.jsx (a repo-wide route search finds only the
// shared workspace at /customers/opportunities, which takes no :id param) — a pre-existing
// defect in definitions/opportunity.js, outside this module's writeScope, reported as
// REGISTRATION_PENDING (see the WIRING SCOPE note above for the exact fix needed there).
// Wiring that value verbatim would send a click to a page that 404s, which this task's own
// instruction refuses ("do not wire a broken route"). opportunity.js no longer declares one
// at all, so DefaultRelatedList's own already-tested "rowNavigationTo absent" branch renders
// exactly the honest degrade this needs: non-focusable rows, no onClick/onKeyDown.
// salesOrderRelatedList's rowNavigationTo
// ("/customers/opportunities/sales-order/:salesOrderId") IS real (App.jsx ->
// SalesOrderDetail.jsx) and is used unmodified.
// Used unmodified. The stale route this used to strip has been removed from opportunity.js
// itself, so there is nothing left to defend against here.
const ACCOUNT_OPPORTUNITIES_RELATED_LIST = opportunityRelatedList;

const ACCOUNT_PAGE_LIST_MAP = {
  "account.opportunities": ACCOUNT_OPPORTUNITIES_RELATED_LIST,
  "account.salesOrders": salesOrderRelatedList,
  "account.contacts": contactRelatedList,
  "account.locations": locationRelatedList,
};

const ACCOUNT_PAGE_ENTITY_MAP = {
  account: accountEntity,
  opportunity: opportunityEntity,
  salesOrder: salesOrderEntity,
  contact: contactEntity,
  location: locationEntity,
};

/** Resolves a RELATED_LIST section's `listId` to the real ListViewDefinition it names. */
export function accountPageListResolver(listId) {
  return ACCOUNT_PAGE_LIST_MAP[listId] ?? null;
}

/** Resolves an entityId to the real EntityDefinition it names (account/opportunity/salesOrder). */
export function accountPageEntityResolver(entityId) {
  return ACCOUNT_PAGE_ENTITY_MAP[entityId] ?? null;
}

// ── The subset actually wired into AccountDetail.jsx ───────────────────────
// See the WIRING SCOPE note above for why these two subsets and not the full definition.

// accountPage.js's own array order already places these five MAIN-region sections
// opportunities -> salesOrders -> financials -> activityAndNotes -> serviceActivity;
// subsetOf's filter preserves that order, so this list does not also have to re-sequence.
const MAIN_SUBSET_IDS = ["opportunities", "salesOrders", "financials", "activityAndNotes", "serviceActivity"];
const SIDE_SUBSET_IDS = ["accountAttention"];

function subsetOf(def, ids) {
  return { ...def, sections: def.sections.filter((s) => ids.includes(s.id)) };
}

/**
 * MAIN-column subset: Opportunities, Sales Orders, Financials, Activity & Notes, Service
 * Activity — same order as today. Opportunities/Sales Orders are RELATED_LIST sections;
 * rendering them requires passing accountPageListResolver/accountPageEntityResolver to
 * MetadataRecordPage (AccountDetail.jsx does).
 */
export const accountRecordPageMainSubset = subsetOf(accountRecordPage, MAIN_SUBSET_IDS);

/**
 * SIDE-column subset: Account Attention.
 *
 * Kept defined and tested (test/accountPageComponents.test.jsx), NOT because a future lane
 * merely needs to flip a switch — even with `embedded` (GAP 3) this subset is evaluated and
 * REJECTED for AccountDetail.jsx's own render, see the SIDE-region note in the "WIRING SCOPE"
 * block above. Adopting it would require either accountPage.js declaring a finer-grained
 * capability model than "one capabilityRequirement per section" (out of this lane's writeScope,
 * and a real change to §6's section-level contract), or AccountAttentionSection itself losing
 * its own ungated Work-Order-past-due degrade — neither is this lane's call to make.
 */
export const accountRecordPageSideSubset = subsetOf(accountRecordPage, SIDE_SUBSET_IDS);

// ── Contacts / Locations — X-RELATED-LIST-ACTIONS wiring ───────────────────
//
// A SEPARATE MetadataRecordPage subset/call, not folded into accountRecordPageMainSubset
// above. Reason: this subset supplies its own `listRenderer` (see
// buildAccountRelatedListPresentation / makeAccountRelatedListRenderer below), and
// `listRenderer` — once given to MetadataRecordPage — wins for EVERY RELATED_LIST section
// that render pass touches (MetadataRecordPage.jsx's `Section`: "if (listRenderer) return
// listRenderer(...)", unconditionally, no per-listId fallback to DefaultRelatedList). Folding
// contacts/locations into the same call as Opportunities/Sales Orders would silently switch
// THOSE off the real DefaultRelatedList/CALLABLE binding accountRecordPageMainSubset's own
// comment block re-verified — a regression this lane has no reason to cause. Two calls, two
// independent bindings, exactly the same precedent accountRecordPageSideSubset already set
// for the SIDE region.
const CONTACTS_LOCATIONS_SUBSET_IDS = ["contacts", "locations"];

/**
 * The Contacts + Locations subset, in accountPage.js's own order (60, 70 — immediately
 * after Service Activity, matching AccountDetail.jsx's historical "3. Contacts / 4.
 * Locations" numbering).
 */
export const accountRecordPageContactsLocationsSubset = subsetOf(accountRecordPage, CONTACTS_LOCATIONS_SUBSET_IDS);

/**
 * WHY THESE TWO SECTIONS DO NOT USE THE DEFAULT RELATED_LIST BINDING
 * (DefaultRelatedList, MetadataRecordPage.jsx), even though both entities are readVia
 * CLIENT_DIRECT and account.js now declares both parent-side relationships (the mechanical
 * blocker accountPageComponents.js's own WIRING SCOPE note used to cite is closed):
 *
 * DefaultRelatedList's useRelatedListPresentation issues its OWN independent live
 * Firestore read of the account-scoped query. AccountDetail.jsx ALREADY runs that exact
 * read via useContactsForAccount / useLocationsForAccount — data those hooks must keep
 * supplying regardless (contacts feeds PrimaryContactSummary and
 * CommercialProfileSection's billing-contact resolution; the raw `locations` array backs
 * the section's own count). A second, independent subscription to the SAME query is the
 * exact double-read anti-pattern this file's own AR note already tracks as a real,
 * previously-shipped bug (#1094/#1095: two independent reads of one authoritative source
 * disagreeing on screen), not a hypothetical one here.
 *
 * `buildAccountRelatedListPresentation` below is the fix: it builds the SAME
 * `listPresentation.js` render model DefaultRelatedList would, from the rows
 * AccountDetail.jsx's own live hooks already hold — one subscription, one source of
 * truth, reused by both the section display and every other consumer of that hook's data.
 */
function classifyRelatedListError(message) {
  if (!message) return null;
  // useContactsForAccount / useLocationsForAccount surface domain/loadErrorMessage.js's
  // already-TRANSLATED, safe copy — never the raw Firebase error code
  // useRelatedListPresentation's own `e?.code === "permission-denied"` check relies on.
  // loadErrorMessage(err) returns exactly one of three fixed strings, and
  // "permission-denied" is the only one that mentions permission — this substitutes for
  // the raw code these two hooks do not expose, rather than inventing a new one. If that
  // copy ever changes, this classification needs to change with it.
  return /permission/i.test(message) ? "denied" : "unavailable";
}

/**
 * Locations' addressCity/addressState/addressZip columns are declared as flat fieldIds
 * (location.js: v1 FIELD_TYPE has no composite/struct type), but the STORED document nests
 * them under an `address` map (location.js's own header; shared/address/AddressFields.jsx).
 * DefaultRelatedList's own firestoreListSource.js spreads the raw doc verbatim
 * (`{ id: d.id, ...d.data() }`) and would hit this identical gap if it ever read Locations —
 * it is not specific to reusing AccountDetail's hook data. Flattened here, before a row ever
 * reaches the shared `cellValue()`, rather than left to silently resolve to `undefined` (a
 * blank City/State cell on every row — not a "—", nothing at all, since cellValue only
 * treats null/undefined/"" as absent and returns raw values otherwise unchanged).
 */
function mapLocationRow(location) {
  return {
    id: location.id,
    name: location.name,
    addressCity: location.address?.city ?? null,
    addressState: location.address?.state ?? null,
    addressZip: location.address?.zip ?? null,
    accessNotes: location.accessNotes ?? null,
    createdAt: location.createdAt ?? null,
    updatedAt: location.updatedAt ?? null,
  };
}

/**
 * contact.js declares `isPrimary` as BOOLEAN, but listPresentation.js's `cellValue()` has
 * NO BOOLEAN branch (only ENUM/ENUM_SET/TIMESTAMP/DATE resolve; everything else returns the
 * raw value unchanged) and MetadataListGrid renders `{cell.value}` directly — React renders
 * neither `true` nor `false` as visible text, so an unmapped BOOLEAN column would render
 * BLANK for every row, primary and non-primary alike: indistinguishable, and therefore not
 * the human-meaningful value this wiring is required to produce. Mapped to a real string
 * ("Primary" / null, `null` rendering the grid's normal blank-cell case) before the row ever
 * reaches `cellValue()` — the same restraint contact.js's own field comment already takes
 * for `role` (free text, not invented), applied here to a rendering gap instead of a data
 * gap.
 */
function mapContactRow(contact) {
  return {
    id: contact.id,
    name: contact.name,
    role: contact.role ?? null,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    isPrimary: contact.isPrimary ? "Primary" : null,
  };
}

const ACCOUNT_RELATED_LIST_ROW_MAPPERS = {
  "account.contacts": mapContactRow,
  "account.locations": mapLocationRow,
};

/**
 * Builds a RELATED_LIST presentation model (listPresentation.js's own shape — the same one
 * DefaultRelatedList feeds MetadataListGrid) from rows a caller's OWN live hook already
 * holds, rather than performing a second independent read. `rows` is the hook's full,
 * already account-scoped array (never re-filtered or re-scoped here — the scoping already
 * happened in the Firestore query useContactsForAccount / useLocationsForAccount itself);
 * `loading`/`error` are that same hook's own state.
 *
 * The DENIED/UNAVAILABLE distinction reuses `buildListPresentation`'s own state machine
 * (via `classifyRelatedListError`) for correctness, but the DISPLAYED message is the hook's
 * own real error text, not `listPresentation.js`'s generic canned copy
 * (`emptyMessageFor()`) — an existing, out-of-scope external contract
 * (test/accountDetailFailClosed.test.jsx) already asserts the exact hook-provided string
 * reaches the screen for a denied Contacts read, and that string is more specific than the
 * generic fallback in any case.
 */
export function buildAccountRelatedListPresentation({ listId, rows, loading = false, error = null }) {
  const listDef = accountPageListResolver(listId);
  const entity = listDef ? accountPageEntityResolver(listDef.entityId) : null;
  const mapRow = ACCOUNT_RELATED_LIST_ROW_MAPPERS[listId] ?? ((r) => r);
  const errorStatus = classifyRelatedListError(error);
  const presentation = buildListPresentation({
    def: listDef,
    entity,
    page: errorStatus ? null : { rows: (rows ?? []).map(mapRow), hasMore: false },
    loading,
    errorStatus,
    filtersActive: false,
  });
  // Preserve the hook's own real error text over listPresentation.js's generic copy — see
  // the doc comment above.
  return errorStatus && error ? { ...presentation, emptyMessage: error } : presentation;
}

// ── The real capability resolver ────────────────────────────────────────────
// Read directly off the definition — never a hand-typed list that could drift from what
// accountPage.js actually declares.
export const ACCOUNT_PAGE_CAPABILITY_REQUEST = declaredPageCapabilities(accountRecordPage);

const RESOLVE_EFFECTIVE_ACCESS_CALLABLE = "resolveEffectiveAccessCallable";

// Same default firebase-backed seams as useReportCapabilities.js / useOpportunityCapabilities.js;
// `deps` lets a test inject fakes. Production always uses these real ones.
function defaultSubscribeAccessVersion(uid, handlers) {
  return onSnapshot(
    doc(db, USERS_COLLECTION, uid),
    (snap) => handlers.next(snap.exists() ? snap.get("accessVersion") : undefined),
    () => handlers.error(),
  );
}
function defaultCallFeed(permissionIds) {
  return httpsCallable(functions, RESOLVE_EFFECTIVE_ACCESS_CALLABLE)({ permissionIds });
}

/**
 * The Account record page's real, fail-closed capability decisions — suitable for
 * MetadataRecordPage's `capabilityDecisions` prop directly.
 *
 * Same two-source freshness contract as useReportCapabilities.js: a live users/{uid}.accessVersion
 * subscription, re-fetched against resolveEffectiveAccessCallable whenever a valid new version is
 * observed, granting ONLY when the feed's resolved version exactly matches the currently observed
 * one. While loading, signed out, erroring, or between an accessVersion bump and the matching
 * re-fetch, every requested id is DENIED — which is exactly the "empty map hides every gated
 * section" contract applyVisibility (pageRuntime.js) already requires; this hook supplies no
 * permissive default and never substitutes `true` for "don't know yet".
 */
export function useAccountPageCapabilityDecisions(user, deps = {}) {
  const uid = user?.uid ?? null;
  const subscribeAccessVersion = deps.subscribeAccessVersion ?? defaultSubscribeAccessVersion;
  const callFeed = deps.callFeed ?? defaultCallFeed;

  const [version, setVersion] = useState(SIGNED_OUT_VERSION);
  const [feed, setFeed] = useState(IDLE_FEED);

  useEffect(() => {
    if (!uid) { setVersion(SIGNED_OUT_VERSION); return undefined; }
    setVersion({ status: VERSION_STATUS.LOADING, uid, version: null });
    const unsubscribe = subscribeAccessVersion(uid, {
      next: (rawVersion) => {
        setVersion(isValidObservedVersion(rawVersion)
          ? { status: VERSION_STATUS.READY, uid, version: rawVersion }
          : { status: VERSION_STATUS.ERROR, uid, version: null });
      },
      error: () => setVersion({ status: VERSION_STATUS.ERROR, uid, version: null }),
    });
    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [uid, subscribeAccessVersion]);

  useEffect(() => {
    if (version.status !== VERSION_STATUS.READY || version.uid !== uid || !isValidObservedVersion(version.version)) {
      setFeed(IDLE_FEED);
      return undefined;
    }
    const targetVersion = version.version;
    let cancelled = false;
    setFeed({ status: FEED_STATUS.LOADING, forUid: uid, forVersion: targetVersion, decisions: null });

    Promise.resolve()
      .then(() => callFeed(ACCOUNT_PAGE_CAPABILITY_REQUEST))
      .then((res) => {
        if (cancelled) return;
        const interpreted = interpretAccessResult(res?.data);
        setFeed(interpreted.ok
          ? { status: FEED_STATUS.READY, forUid: uid, forVersion: interpreted.accessVersion, decisions: interpreted.decisions }
          : { status: FEED_STATUS.ERROR, forUid: uid, forVersion: targetVersion, decisions: null });
      })
      .catch(() => {
        if (cancelled) return;
        setFeed({ status: FEED_STATUS.ERROR, forUid: uid, forVersion: targetVersion, decisions: null });
      });

    return () => { cancelled = true; };
  }, [uid, version.status, version.uid, version.version, callFeed]);

  const hasCapability = buildHasCapability({ version, feed }, uid);
  // A plain { capabilityId: boolean } map — MetadataRecordPage/applyVisibility's expected shape —
  // built fresh from the same fail-closed gate useReportCapabilities exposes as a function.
  return useMemo(
    () => Object.fromEntries(ACCOUNT_PAGE_CAPABILITY_REQUEST.map((id) => [id, hasCapability(id)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uid, version.status, version.uid, version.version, feed.status, feed.forUid, feed.forVersion, feed.decisions],
  );
}
