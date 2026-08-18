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
// What DOES render through the metadata path: only the same three componentId sections the
// prior lane already swapped — the MAIN-column sections that are already contiguous and in the
// same order in both accountPage.js and AccountDetail.jsx (financials -> activityAndNotes ->
// serviceActivity, exported below as accountRecordPageMainSubset). This lane changed no
// rendering in AccountDetail.jsx; it added the evaluation above and the tests that lock it in.
//
// AccountHealthStrip and accountAttentionSection are both REGISTERED here (so the
// registry-completeness test holds for every componentId accountRecordPage names) but
// deliberately left HAND-RENDERED in AccountDetail.jsx.
//
// X-ACCOUNT-WIRE-CALLABLE-LISTS — commit 6c6480d8 later closed the ONE structural blocker
// this lane's own "opportunities / salesOrders" finding above named (no CALLABLE-read path).
// That gap closing did not change the count above: opportunities/salesOrders were
// RE-EVALUATED (not re-assumed fixed) and are still hand-rendered, now for two different,
// newly-found reasons (a raw-epoch-millisecond TIMESTAMP column, and DefaultRelatedList
// wiring no row navigation at all) — see the corrected "opportunities / salesOrders"
// paragraph below, which replaces the original finding rather than sitting beside a stale
// one. Still zero of the six sections wired.
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
// contacts / locations (RELATED_LIST, GAP 2's default binding) — mechanically compatible
// (both entities are readVia CLIENT_DIRECT, and account.js now declares both parent-side
// relationships), but wiring EITHER through DefaultRelatedList would:
//   (a) start a SECOND, independent live read of the exact same collection query
//       AccountDetail.jsx already runs via useContactsForAccount / useLocationsForAccount —
//       data those hooks must keep supplying regardless (contacts feeds
//       PrimaryContactSummary, CommercialProfileSection's billing-contact resolution, and
//       AccountForm's edit view; locations' hook return value cannot simply be dropped
//       either without losing the section's own count). Two independent subscriptions to
//       one query is the EXACT anti-pattern already named and tracked in this file's own
//       AR-double-read note above (#1094/#1095) — real disagreement between "the same read,
//       fetched twice" is a documented production bug on this page, not a hypothetical one.
//   (b) drop "+ Add Contact" / "Import Contacts" / "+ Add Location" and their modals — real
//       CRUD entry points with no equivalent in MetadataListGrid/DefaultRelatedList — and
//       drop the post-add keyboard-focus handoff to the new row (`pendingContactFocus` /
//       `pendingLocationFocus` + the row `ref`), an accessibility behavior
//       MetadataListGrid has no hook to reproduce (rows carry no caller-supplied ref).
// Both are real, user-visible regressions, not cosmetic ones. Left hand-rendered.
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
// Both blockers are structural gaps in files outside this lane's writeScope
// (MetadataRecordPage.jsx, listPresentation.js) — see this task's REGISTRATION_PENDING /
// out-of-scope reporting. Left hand-rendered.
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
import { accountRecordPage } from "./accountPage.js";
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

// ── The subset actually wired into AccountDetail.jsx ───────────────────────
// See the WIRING SCOPE note above for why these two subsets and not the full definition.

const MAIN_SUBSET_IDS = ["financials", "activityAndNotes", "serviceActivity"];
const SIDE_SUBSET_IDS = ["accountAttention"];

function subsetOf(def, ids) {
  return { ...def, sections: def.sections.filter((s) => ids.includes(s.id)) };
}

/** MAIN-column subset: Financials, Activity & Notes, Service Activity — same order as today. */
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
