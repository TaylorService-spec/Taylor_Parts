import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ContextBand from "../../shared/ui/ContextBand.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import ActionRail from "../../shared/ui/ActionRail.jsx";
import { Button } from "../../shared/ui/primitives/index.js";
import { useOpportunities } from "../../hooks/useOpportunities.js";
import { useOpportunityTransitions } from "../../hooks/useOpportunityTransitions.js";
import {
  buildOpportunityPipeline, channelLabel, stageProgress,
  OPPORTUNITY_VIEW, OPPORTUNITY_VIEW_LABEL, OPPORTUNITY_EMPTY_TEXT,
  normalizeOpportunityView, selectOpportunityView,
} from "../../domain/opportunityLifecycle.js";
import { useSearchParams } from "react-router-dom";
import { UNRESOLVED_REFERENCE_LABEL } from "../../metadata/referenceResolution.js";
import { opportunityDetailModel, OPPORTUNITY_DATA_CLASS } from "../../domain/opportunityFieldModel.js";
import { opportunityWriteReadiness } from "../../access/opportunityWriteReadiness.js";
import { isoDate, parseLocalDate } from "../../domain/localDateInput.js";
import OpportunityLifecycleControl from "./OpportunityLifecycleControl.jsx";
import SalesAgreementPanel from "./SalesAgreementPanel.jsx";
import { useSalesAgreement } from "../../hooks/useSalesAgreement.js";
import { SALES_AGREEMENT_READ_CAPABILITY } from "../../access/salesAgreementCapabilityAccess.js";
import { useOpportunitySectionSave } from "../../hooks/useOpportunitySectionSave.js";
import { isOpportunityEditable } from "../../domain/opportunitySectionSave.js";
import StageProgressTrack from "../../shared/ui/StageProgressTrack.jsx";
import NewOpportunityForm from "./NewOpportunityForm.jsx";
import { loadErrorMessage } from "../../domain/loadErrorMessage";

// Sales — Opportunity OPERATING Workspace. The commercial pipeline is the entry point to Sales (ratified:
// Opportunity Management, NOT Account→Create Work Order). This surface reads opportunities through the
// injected source seam (hooks/useOpportunities → access/opportunitySource) and renders them on the Wave-0
// composition primitives (WorkspaceShell / ContextBand / StatusPill / ActionRail). It is a PIPELINE built for
// rapid scanning + comparison, not a metric-card CRM dashboard and not a giant-card-per-opportunity page.
//
// EDITING-READY (design requirement): the workspace is intended to become an operating workspace where
// authorized users MAINTAIN Opportunity information once the governed write authority is activated. The detail
// pane is therefore composed for BOTH read/scan AND edit/operate WITHOUT another structural redesign — but it
// is NOT a permanent wall of form controls. It reads cleanly by default; editing is CONTEXTUAL and SECTION-
// LEVEL (one section at a time), which is the interaction that recomposes cleanly from desktop down to phone
// (a section edit is a small stacked form, never a desktop grid squeezed narrow).
//
// WRITE-READINESS: field editing AND lifecycle transitions AND create are all governed writes; all three
// are gated by the SAME write-readiness seam (access/opportunityWriteReadiness), fed by the REAL trusted
// effective-access signal (access/useOpportunityCapabilities → resolveEffectiveAccessCallable), wired at the
// production mount in App.jsx. Any caller that does NOT inject a `readiness` prop (including every existing
// test render here) still gets the seam's own fail-closed default (opportunityWriteReadiness() with no
// deps evaluates to disabled) — this component never assumes writes are live; it only ever reads through
// the injected/defaulted seam. When capabilityGranted flips server-side, the SAME affordances (Edit, the
// lifecycle chevrons/actions, New opportunity) go live with no structural change here.

// isoDate/parseLocalDate live in domain/localDateInput.js (shared with NewOpportunityForm.jsx without a
// circular import); re-exported here so the existing `import { isoDate, parseLocalDate } from
// ".../SalesWorkspace.jsx"` call site (test/salesWorkspaceDate.test.jsx) is unchanged.
export { isoDate, parseLocalDate };

// ─────────────────────────────────────────────────────────────────────────────
// S-CRM-OPPORTUNITIES — metadata list runtime migration EVALUATED, DECLINED.
//
// The task: render this pipeline's table through the metadata list runtime
// (metadata/listPresentation.js's buildListPresentation + metadata/MetadataListGrid.jsx),
// driven by the real `opportunityIndexList` (metadata/definitions/opportunity.js). Investigated
// in full before writing anything; three independent, compounding blockers were found, any ONE
// of which is disqualifying on its own, and none fixable from inside this file's writeScope
// (only this module + its test file):
//
// BLOCKER 1 — no INDEX-surface hook can drive a CALLABLE-read entity at all.
// hooks/useMetadataList.js (the hook every migrated INDEX surface uses, e.g.
// modules/accounts/AccountsList.jsx) imports `fetchPage` ONLY from metadata/firestoreListSource.js
// — it has no readVia branch. opportunityEntity declares `readVia: "CALLABLE"` (opportunity.js's
// own header: "opportunities is deny-all in Firestore Rules"). Running this workspace's list
// through useMetadataList would issue a raw client `getDocs` against a deny-all collection —
// permission-denied for 100% of callers, including one holding the real `opportunity.read`
// capability. Only metadata/MetadataRecordPage.jsx's DefaultRelatedList branches by readVia
// (selectListSource); no INDEX-surface equivalent exists. Fixing this means editing
// hooks/useMetadataList.js, which is shared list-runtime infrastructure other lanes' surfaces
// already depend on (e.g. S-CRM-CUSTOMERS) — out of this lane's writeScope.
//
// BLOCKER 2 — even a CALLABLE-aware INDEX hook could not serve this list as declared.
// metadata/callableListSource.js hardcodes a SINGLE response-key mapping
// (listOpportunitiesForAccount -> "opportunities") and THROWS without a parent-scope filter to
// send as that callable's `accountId` argument (`descriptor.filters[0]`) — it is built for a
// RELATED section scoped to one Account, not an unscoped INDEX. The real governed unscoped read
// this workspace already uses is a DIFFERENT callable, `listOpportunityContext`
// (access/opportunitySource.js's governedOpportunitySource — "returns the caller's whole
// authorized scope with no accountId filter"), which callableListSource.js has no mapping for.
// Fixing this also means editing shared list-runtime files, not this one.
//
// BLOCKER 3 — even reusing this workspace's OWN existing governed read (no double-read; the
// same sanctioned pattern accountPageComponents.js's buildAccountRelatedListPresentation
// established for Contacts/Locations: feed already-loaded rows into buildListPresentation
// purely for rendering) would still drop real, currently-shown information:
//   (a) opportunityIndexList's declared columns (opportunityNumber, accountId, stage,
//       salesChannel, expectedValue, expectedCloseAt) have no "Attention / next action" column
//       — this pipeline's actual triage signal (buildOpportunityPipeline's attention derivation
//       + the raw `nextAction` field, both rendered by PipelineRow below). opportunity.js
//       deliberately does NOT declare `nextAction` as a field ("read but never written [...]
//       NOT declared here") — there is no column declaration this migration could even ask for.
//       Rendering through the declared list as-is would silently remove that column: a real,
//       confirmed regression, not a hypothetical one.
//   (b) accountId is REFERENCE with nothing to resolve it TO without a second live read.
//       listOpportunityContext's own projection deliberately returns accountId only — no
//       denormalized name ("does NOT copy Customer name/PII into the Opportunity for
//       rendering", opportunityReadService.ts) — and mapOpportunityReadResult
//       (access/opportunitySource.js) hard-codes `accountNameById: {}` for every REAL governed
//       result; only the synthetic fixture source populates it. A real `resolveReference` here
//       would have to issue a per-row Account read — exactly the N+1 pattern this task's own
//       instructions forbid. (This also means today's hand-written "Customer" column silently
//       falls back to the raw `accountId` document id once real governed data replaces the
//       synthetic fixtures — domain/opportunityLifecycle.js's `buildPipelineRow`:
//       `accountNameById[opp.accountId] ?? opp.customerName ?? opp.accountId ?? "—"` — a
//       pre-existing defect in a file outside this lane's writeScope, reported rather than
//       fixed here.)
//
// This pipeline therefore stays hand-rendered — the metadata list runtime cannot yet reproduce
// its master-detail selection, attention-sorted triage column, editable sections, lifecycle
// actions, or create flow, and forcing just the table through `opportunityIndexList` as declared
// today would be a confirmed functional regression (dropped Attention/next column), not a
// faithful migration. Recorded on docs/orchestration/metadata-program/LEDGER.md as
// S-CRM-OPPORTUNITIES declined-for-cause, matching the two prior declines in this program.
// ─────────────────────────────────────────────────────────────────────────────

import {
  DetailSection, ownerName, currency, shortDate,
} from "./opportunitySections.jsx";

function OpportunityDetail({ row, readiness, onSaveSection, onChanged, saveDeps, directory, hasCapability }) {
  const [editingSection, setEditingSection] = useState(null);
  const model = useMemo(
    // The SAME resolver the ContextBand uses, so the two can never disagree about who owns a deal —
    // which is how the second raw-id site survived the first fix.
    () => opportunityDetailModel(row, {
      format: { currency, date: shortDate },
      resolveOwnerName: (employeeId) => ownerName(employeeId, directory),
    }),
    [row, directory]
  );
  // Called unconditionally (rules-of-hooks) — `row?.id ?? null` scopes the transition idempotency cache to
  // whichever Opportunity is selected right now; useOpportunityTransitions resets its cache on an id change.
  const transitions = useOpportunityTransitions(row?.id ?? null);
  // Same unconditional-call discipline: the governed section-save command, scoped to whichever
  // Opportunity is selected right now.
  const sectionSave = useOpportunitySectionSave(row?.id ?? null, saveDeps);
  // Same unconditional-call discipline (rules of hooks): scoped to whichever Opportunity is
  // selected, and re-read from scratch when that changes.
  // Gated on the READ capability: an ungranted caller issues no request at all, so a feature that
  // is not deployed cannot fill the console with failed round trips.
  const agreement = useSalesAgreement(row?.id ?? null, {
    enabled: hasCapability?.(SALES_AGREEMENT_READ_CAPABILITY) === true,
  });
  if (!row) return <p className="fo-muted">Select an opportunity to see its detail.</p>;

  // WON and LOST are terminal. The command refuses to edit them (CLOSED) because the deal terms
  // of a WON Opportunity are what the Sales Order was derived from -- editing them afterwards
  // would make the two disagree with no record of which is right.
  const recordEditable = isOpportunityEditable(row);

  const facts = [
    { key: "customer", label: "Customer", value: row.customerName },
    { key: "channel", label: "Channel", value: channelLabel(row.channel) },
    { key: "stage", label: "State", value: <StatusPill tone={row.commercial.tone} label={row.commercial.label} /> },
    { key: "value", label: "Est. value", value: currency(row.expectedValue) },
    { key: "close", label: "Expected close", value: shortDate(row.expectedCloseAt) },
    // AN EMPLOYEE ID IS NOT A PERSON (DECISIONS #106). This rendered `row.ownerEmployeeId` raw —
    // found by the new dynamic-detail certification sweep the moment this pane became reachable,
    // which is exactly what that sweep was added to do.
    //
    // The directory the workspace already holds resolves it. When it cannot — an owner who has
    // left, a record predating the directory, or a caller whose role cannot read employees at all
    // (that collection is admin/dispatcher only) — the shared unresolved label says so rather than
    // printing the key.
    {
      key: "owner",
      label: "Owner",
      value: row.ownerEmployeeId
        ? (ownerName(row.ownerEmployeeId, directory) ?? <span className="fo-muted">{UNRESOLVED_REFERENCE_LABEL}</span>)
        : "—",
    },
    // Sales Order lineage (Owner-ratified 2026-08-15: "Preserve Opportunity -> Sales Order
    // lineage visibly"). WON-with-no-SO-yet is an honest, distinct state from "not applicable" --
    // never hidden just because the row isn't WON (a real link should always be reachable the
    // moment it exists, regardless of stage/outcome).
    {
      key: "salesOrder",
      label: "Sales Order",
      // The link's LABEL is what it is, not the key it routes by. This rendered the raw document
      // id as a business identifier -- the exact substitution DECISIONS #106 forbids. The
      // Opportunity row does not carry the SO number, so the honest label is the generic one.
      value: row.salesOrderId
        ? <Link to={`/customers/opportunities/sales-order/${row.salesOrderId}`}>View Sales Order</Link>
        : row.outcome === "WON"
          ? <span className="fo-muted">Not created yet</span>
          : "—",
    },
  ];

  // Render order: commercial / need / solution / next-action / qualification (editable), then a Lifecycle
  // section (governed actions), then attention (derived) + record (read-only) which the model also supplies.
  const bySlot = Object.fromEntries(model.sections.map((s) => [s.id, s]));
  const editableOrder = ["commercial", "need", "solution", "nextAction", "qualification"];

  const renderSection = (id) => {
    const section = bySlot[id];
    if (!section) return null;
    return (
      <DetailSection
        key={id}
        section={section}
        editing={editingSection === id}
        onEnterEdit={setEditingSection}
        onCancelEdit={() => setEditingSection(null)}
        readiness={readiness}
        editable={recordEditable}
        saving={!!sectionSave.pending[id]}
        outcome={sectionSave.outcome?.sectionId === id ? sectionSave.outcome : null}
        directory={directory}
        onSave={async (sectionId, draft) => {
          // `onSaveSection` stays an injection seam for tests; unwired callers get the real
          // governed command rather than an inert form. This is the wiring that was missing --
          // the command and every affordance around it already existed.
          const result = onSaveSection
            ? await onSaveSection(sectionId, draft, row.updatedAtMillis)
            : await sectionSave.saveSection(sectionId, draft, row.updatedAtMillis);

          // The section closes only on a save that actually happened. Everything else keeps the
          // form open with the draft intact, because the user has something to do with it --
          // including NO_CHANGES, which closed silently at first and so reported nothing at all:
          // the message lives IN the form, and a form that closes takes its own explanation with
          // it. Pressing Save and having the panel vanish with no word is indistinguishable from
          // a save that worked.
          if (result?.kind === "applied" || result?.kind === "replayed") {
            setEditingSection(null);
            // Re-read authoritatively. Never patch the row locally: the server owns the new
            // version token, and a locally-invented one would fail the NEXT save with a
            // conflict the user could not explain.
            onChanged?.();
          }
          return result;
        }}
      />
    );
  };

  return (
    <div className="fo-sales-detail">
      {/* THE RECORD PAGE'S ONE ENTRY POINT FROM HERE (North Star family 4).
          An Opportunity now has a URL. Without this link it would have no reachable one: the
          pipeline is where people find deals, and a record page nothing navigates to is a page
          that exists only for people who already know its address.
          The label is the governed reference where there is one and a plain phrase where there is
          not -- never the document id (DECISIONS #106), which is exactly what `row.id` is. */}
      {row.id ? (
        <p className="fo-sales-detail__open-record">
          <Link to={`/customers/opportunities/${row.id}`}>
            {row.opportunityNumber ? `Open ${row.opportunityNumber}` : "Open the full record"}
          </Link>
        </p>
      ) : null}
      <ContextBand items={facts} />
      {editableOrder.map(renderSection)}
      <section className="fo-sales-detail__block" aria-label="Lifecycle" data-dataclass={OPPORTUNITY_DATA_CLASS.LIFECYCLE_ACTION}>
        <div className="fo-sales-detail__block-head"><h4>Lifecycle</h4></div>
        <OpportunityLifecycleControl row={row} readiness={readiness} transitions={transitions} onChanged={onChanged} />
      </section>
      {/* THE COMMERCIAL COMMITMENT. Placed directly after Lifecycle because winning this
          Opportunity now REQUIRES an accepted agreement -- the two are one decision, and putting
          the agreement further down would hide the precondition for the button above it. */}
      <section className="fo-sales-detail__block" aria-label="Sales Agreement">
        <SalesAgreementPanel agreement={agreement} hasCapability={hasCapability} />
      </section>
      {renderSection("attention")}
      {renderSection("record")}
    </div>
  );
}

// One scannable pipeline row. Attention-bearing rows carry a left marker + an inline pill so the queue reads
// at a glance; the stage pill uses the shared semantic tone so "attention looks like attention" everywhere.
function PipelineRow({ row, selected, onSelect }) {
  const progress = stageProgress(row);
  return (
    <tr
      className={`fo-sales-row ${selected ? "is-selected" : ""} ${row.attentionTone === "attention" ? "is-attention" : ""}`.trim()}
      onClick={() => onSelect(row.id)}
      // Live-pilot SALES-001 finding (ACCESSIBILITY): pipeline rows were mouse-only (no role/tabindex/key
      // handler), so a keyboard/AT user could not select an opportunity to open its detail. Make each row a
      // keyboard-operable option — focusable, Enter/Space selects.
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(row.id);
        }
      }}
      aria-selected={selected}
    >
      {/* data-label drives the phone recomposition (thead hidden; each cell labelled). The `secondary`
          columns are the lower-priority ones (Channel, Expected close) — deferred at constrained widths and
          still shown in the detail pane for the selected opportunity, so information is deferred not lost. */}
      <td className="fo-sales-row__customer" data-label="Customer">{row.customerName}</td>
      {/* Stage reads as PROGRESSION, not just a state. The pill alone answered "what state is this in"
          but never "how far along is it", which is the question a pipeline is scanned for -- so the
          same domain projection the detail chevrons use (stageProgress) also drives a compact track
          here. Both surfaces therefore move together; neither has its own idea of the stage order. */}
      <td data-label="Stage">
        <div className="fo-sales-row__stage">
          <StatusPill tone={row.commercial.tone} label={row.commercial.label} />
          <StageProgressTrack steps={progress.stages} terminal={progress.terminal} />
        </div>
      </td>
      <td className="fo-sales-col--secondary" data-label="Channel">{channelLabel(row.channel)}</td>
      <td className="fo-sales-row__value" data-label="Est. value">{currency(row.expectedValue)}</td>
      <td className="fo-sales-col--secondary" data-label="Expected close">{shortDate(row.expectedCloseAt)}</td>
      <td className="fo-sales-row__next" data-label="Attention / next">
        {row.attention.length > 0 ? (
          <StatusPill tone={row.attentionTone} label={row.attention[0].label} asText />
        ) : (
          <span className="fo-muted">{row.nextAction || "—"}</span>
        )}
      </td>
    </tr>
  );
}

// Props are optional injection seams for tests/activation: `readiness` defaults to the fail-closed write-
// readiness seam; `onSaveSection` OVERRIDES the governed save command (tests inject it; production leaves it
// out and gets the real one, hooks/useOpportunitySectionSave). `saveDeps`/`createDeps` inject a mocked
// command client; `directory` injects an employee-directory double for the owner picker. Production renders
// <SalesWorkspace readiness={...} /> from App.jsx's connected wrapper, which computes readiness from the REAL
// trusted capability feed (access/useOpportunityCapabilities); a caller that passes none of these (every
// existing test here) still gets the seam's own fail-closed default and writes nothing.
// `hasCapability` defaults to fail-closed for every caller that injects none -- the same discipline
// `readiness` already follows, and the reason SalesOrderActions' live-but-unauthorized buttons were
// a defect rather than a cosmetic issue.
export default function SalesWorkspace({ readiness, onSaveSection, source, createDeps, saveDeps, directory, hasCapability = () => false } = {}) {
  const { opportunities, accountNameById, status, synthetic, loading, error, refetch } = useOpportunities(source);
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);
  // Write-readiness through the seam. Fail-closed by default (governed write built but inert unless a real
  // `readiness` is injected); every create/edit/lifecycle affordance renders disabled/honest. When capability
  // is granted, the seam flips and the SAME affordances become live — no structural change here.
  const writeReadiness = readiness ?? opportunityWriteReadiness();

  // Fixed "now" for the render pass so attention derivation is stable within a paint; sourced once from the
  // clock rather than per-row (deterministic across the whole projection).
  const pipeline = useMemo(
    () => buildOpportunityPipeline(opportunities, { nowMillis: Date.now(), accountNameById }),
    [opportunities, accountNameById]
  );

  // WHICH SLICE OF HISTORY IS ON SCREEN, in the URL.
  //
  // URL-stated so refresh and Back preserve it, matching what every metadata list here already does
  // through useListCriteria -- this pipeline is not a metadata list, so it holds the one parameter
  // itself rather than borrowing a hook built for a different shape. An unknown value normalises to
  // OPEN in the domain rather than throwing at the router.
  const [searchParams, setSearchParams] = useSearchParams();
  const view = normalizeOpportunityView(searchParams.get("view"));
  const setView = (next) => {
    const params = new URLSearchParams(searchParams);
    // OPEN is the default, so it leaves no parameter behind -- a shared link stays clean and the
    // default can be changed later without stale URLs pinning the old one.
    if (next === OPPORTUNITY_VIEW.OPEN) params.delete("view");
    else params.set("view", next);
    setSearchParams(params, { replace: true });
    setSelectedId(null); // the previous selection may not exist in the new view
  };

  // FILTERS facts that already exist -- it never re-derives stage, attention or closure.
  const selected = useMemo(() => selectOpportunityView(pipeline, view), [pipeline, view]);

  const selectedRow = useMemo(
    // ADDRESSABLE SELECTION. `?opportunity=<id>` selects a row, so another surface can link to a
    // specific deal's pane. The Opportunity record page's "View agreement" needs it: the agreement's
    // own surface IS this pane (there is no per-agreement route in this build), and a link that
    // landed on an unselected pipeline would be the "beautiful dead end" the brief forbids.
    //
    // It is a SELECTION HINT, not authority: an id that matches no visible row falls through to the
    // existing default exactly as before, and nothing about what the reader may see changes. The
    // explicit click (`selectedId`) still wins, so following the link and then clicking another row
    // behaves normally.
    () => pipeline.all.find((r) => r.id === selectedId)
      ?? pipeline.all.find((r) => r.id === searchParams.get("opportunity"))
      ?? selected.rows[0] ?? null,
    [pipeline, selected, selectedId, searchParams]
  );

  const contextItems = [
    { key: "open", label: "Open", value: pipeline.counts.open },
    { key: "attention", label: "Needs attention", value: pipeline.counts.needsAttention },
    { key: "won", label: "Won", value: pipeline.counts.won },
    { key: "lost", label: "Lost", value: pipeline.counts.lost },
  ];

  // The disabled-state reason is exposed BOTH as an accessible label (keyboard/AT) and as visible on-page
  // text (below), not tooltip-only — consistent with the disabled lifecycle actions in the detail. When
  // readiness IS enabled, the button opens the governed New Opportunity form (NewOpportunityForm.jsx); a
  // successful create authoritatively refetches (never fabricates the row) and selects the new opportunity.
  const createEnabled = writeReadiness.enabled;
  const actions = (
    <ActionRail
      primary={
        <Button
          type="button"
          variant={createEnabled ? "primary" : "protected"}
          aria-label={createEnabled ? "New opportunity" : `New opportunity — ${writeReadiness.reason}`}
          title={createEnabled ? undefined : writeReadiness.reason}
          reason={createEnabled ? undefined : writeReadiness.reason}
          onClick={createEnabled ? () => setCreating(true) : undefined}
        >
          New opportunity
        </Button>
      }
    />
  );

  const attention =
    pipeline.counts.needsAttention > 0 ? (
      <p className="fo-sales-attention">
        <StatusPill tone="attention" label={`${pipeline.counts.needsAttention} opportunit${pipeline.counts.needsAttention === 1 ? "y" : "ies"} need attention`} />
        <span className="fo-muted"> — sorted to the top of the pipeline.</span>
      </p>
    ) : null;

  // Whether these rows are sample fixtures is the SOURCE's fact, not a function of the source having
  // loaded. This previously read `status === "ready"`, which labelled every successfully-loaded pipeline
  // "synthetic" -- so the live governed pipeline told the user its real Opportunities were samples. An
  // honesty banner that fires on real data is worse than no banner: it teaches people to disbelieve
  // true records.
  const isSynthetic = synthetic === true;

  return (
    <WorkspaceShell
      title="Opportunities"
      density="compact"
      actions={actions}
      context={<ContextBand items={contextItems} />}
      attention={attention}
      supporting={
        <OpportunityDetail
          row={selectedRow}
          readiness={writeReadiness}
          hasCapability={hasCapability}
          onSaveSection={onSaveSection}
          onChanged={refetch}
          saveDeps={saveDeps}
          directory={directory}
        />
      }
    >
      {creating && (
        <NewOpportunityForm
          readiness={writeReadiness}
          deps={createDeps}
          onClose={() => setCreating(false)}
          onCreated={(opportunityId) => {
            setCreating(false);
            refetch();
            if (opportunityId) setSelectedId(opportunityId);
          }}
        />
      )}
      {isSynthetic && (
        <p className="fo-sales-banner fo-muted">
          Showing synthetic sample opportunities. The live sales pipeline connects in a later cycle.
          {!createEnabled && <>{" "}{writeReadiness.reason}</>}
        </p>
      )}
      {/* FOUR DIFFERENT FACTS, NOT ONE. The source deliberately reports `ready | denied | unavailable
          | error` and the hook carries `loading` alongside them -- then every non-ready value was
          rendered as "the source is not connected yet". That sentence was actively misleading for the
          most common case: `opportunity.read` is granted to NO Role today, so a real caller is
          DENIED, and denial was being reported as a missing integration. One tells you to wait for a
          later cycle; the other tells you to ask for access. They are not the same instruction.

          Distinguishing them here matches AccountSalesOrdersSection, which already refuses to let
          denied or unavailable borrow the empty state's copy. */}
      {loading ? (
        <p className="fo-muted">Loading opportunities…</p>
      ) : status === "denied" ? (
        <p className="fo-muted" role="alert">
          You do not have permission to view the opportunity pipeline.
        </p>
      ) : status === "error" ? (
        <p className="fo-muted" role="alert">{loadErrorMessage(error, { entity: "opportunities" })}</p>
      ) : status !== "ready" ? (
        // Genuinely not wired: no source configured for this environment. Distinct from a
        // successfully-read but empty pipeline below.
        <p className="fo-muted">The opportunity pipeline source is not connected yet.</p>
      ) : (
        <>
          {/* THE HISTORY CONTROL. Rendered whenever the read succeeded -- including when the current
              view is empty, because a control that disappears exactly when you need it to escape an
              empty view is worse than no control. Radio semantics, not buttons: these are four
              mutually exclusive views of one list, and a screen reader should hear that.

              The counts stay in the ContextBand above as plain text. They are NOT wired as the
              controls: a number that looks clickable and is not is its own defect, and turning the
              band into an input would change a component four other workspaces share. */}
          <div className="fo-sales-views" role="radiogroup" aria-label="Opportunity view">
            {[OPPORTUNITY_VIEW.OPEN, OPPORTUNITY_VIEW.WON, OPPORTUNITY_VIEW.LOST, OPPORTUNITY_VIEW.ALL].map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                className={`fo-sales-view ${view === v ? "is-active" : ""}`.trim()}
                onClick={() => setView(v)}
              >
                {OPPORTUNITY_VIEW_LABEL[v]}
                {v !== OPPORTUNITY_VIEW.ALL && (
                  <span className="fo-sales-view__count">
                    {v === OPPORTUNITY_VIEW.OPEN ? pipeline.counts.open
                      : v === OPPORTUNITY_VIEW.WON ? pipeline.counts.won
                      : pipeline.counts.lost}
                  </span>
                )}
              </button>
            ))}
          </div>
          {selected.rows.length === 0 ? (
        // FOUR DIFFERENT EMPTINESSES, four sentences. A quiet queue, a business that has never won,
        // one that has never lost, and one with no opportunities at all are different facts with
        // different next actions -- and "nothing here" tells a new tenant their data failed to load.
        <p className="fo-muted">{OPPORTUNITY_EMPTY_TEXT[selected.emptyReason] ?? OPPORTUNITY_EMPTY_TEXT.none}</p>
      ) : (
        // Overflow-safe wrapper: the pipeline can NEVER paint over the detail rail (the original intermediate-
        // width defect — the 6-col table overflowed its grid cell and overlapped the detail aside). The wrapper
        // is a guarantee; the real recomposition is the column-priority + phone-block CSS, which keeps the
        // table fitting so the guard scrollbar effectively never appears.
        <div className="fo-sales-pipeline-wrap">
          <table className="fo-sales-pipeline">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Stage</th>
                <th className="fo-sales-col--secondary">Channel</th>
                <th>Est. value</th>
                <th className="fo-sales-col--secondary">Expected close</th>
                <th>Attention / next</th>
              </tr>
            </thead>
            <tbody>
              {selected.rows.map((row) => (
                <PipelineRow key={row.id} row={row} selected={selectedRow?.id === row.id} onSelect={setSelectedId} />
              ))}
            </tbody>
          </table>
        </div>
          )}
        </>
      )}
    </WorkspaceShell>
  );
}
