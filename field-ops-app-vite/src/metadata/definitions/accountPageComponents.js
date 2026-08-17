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
// Two of accountRecordPage's nine non-header sections render generically enough for
// MetadataRecordPage to compose them correctly today: none of the three FIELD_GROUP sections
// (identity, commercialProfile, notesAndIdentifiers) name a componentId — pageDefinition.js's own
// contract reserves componentId for componentized kinds, and MetadataRecordPage.jsx's <Section>
// renders nothing for a FIELD_GROUP with no registered component. Swapping those in today would
// not describe the existing surface, it would blank three panels AccountDetail.jsx currently
// renders in full. The four RELATED_LIST sections (opportunities, salesOrders, contacts,
// locations) need a real listResolver/listRenderer pair wired to the list runtime and the
// existing account-scoped list hooks — a second lane's worth of work, out of THIS lane's
// writeScope (accountPageComponents.js, this test file, and a minimal AccountDetail.jsx edit
// only).
//
// What DOES render safely through the metadata path today: the five componentId-bearing
// sections. Of those, this lane actually SWAPS three of AccountDetail.jsx's existing
// hand-rendered calls for a MetadataRecordPage render — the MAIN-column sections that are already
// contiguous and in the same order in both accountPage.js and AccountDetail.jsx (financials ->
// activityAndNotes -> serviceActivity, exported below as accountRecordPageMainSubset).
//
// AccountHealthStrip and accountAttentionSection are both REGISTERED here (so the
// registry-completeness test holds for every componentId accountRecordPage names) but
// deliberately left HAND-RENDERED in AccountDetail.jsx, for two different reasons:
//   - accountHealthStrip sits in the HIGHLIGHTS region above the two-column body, and wrapping it
//     in MetadataRecordPage's own HIGHLIGHTS container class would be a layout change this lane
//     cannot verify is neutral.
//   - accountAttentionSection is the ONLY section accountRecordPage's SIDE region carries a
//     capabilityRequirement on today (exported below as accountRecordPageSideSubset, and
//     verified by this lane's tests). Rendering a subset with exactly one gated section and
//     nothing ungated hits MetadataRecordPage's own "zero visible sections is DENIED, not empty"
//     rule the instant finance.read is denied — the page then shows a page-level "Not available
//     to you" FailureState in that slot, in place of AccountAttentionSection's own existing,
//     more accurate per-source degrade (it already renders friendly loading/denied/unavailable
//     notes and simply says nothing when there is nothing to flag). That is a real, user-visible
//     regression for anyone without finance.read, caught by test/accountDetailFailClosed.test.jsx
//     while wiring this up. accountRecordPageSideSubset is kept defined and tested for the day
//     the SIDE region carries a second, ungated section — the same shape that already makes the
//     MAIN subset safe.
//
// A partial, honest wiring beats a full one that silently changes what a user sees.
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

/** SIDE-column subset: Account Attention. */
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
