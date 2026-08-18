import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAccount } from "../../hooks/useAccount";
import { useLocationsForAccount } from "../../hooks/useLocationsForAccount";
import { useContactsForAccount } from "../../hooks/useContactsForAccount";
import { updateAccount } from "../../domain/accounts";
import { accountStatusTone, accountRelationshipTone, accountLineOfBusinessTone } from "../../domain/accountPortfolio";
import { createLocation } from "../../domain/locations";
import { createContact, primaryContactState } from "../../domain/contacts";
import { formatAddress } from "../../domain/address";
import { ACCOUNT_RELATIONSHIP_TYPE, ACCOUNT_LINE_OF_BUSINESS, accountStatusLabel } from "../../domain/constants";
import AccountForm from "./AccountForm";
import ContactImportModal from "./ContactImportModal";
import ContactCreateModal from "./ContactCreateModal";
import LocationCreateModal from "./LocationCreateModal";
import AccountHealthStrip from "./AccountHealthStrip";
import AccountAttentionSection from "./AccountAttentionSection";
import { useAccountAr } from "../../hooks/useAccountAr";
import { accountArView } from "../../domain/accountArView";
import { useAccountWorkOrderCount } from "../../hooks/useAccountServiceActivity";
import { fetchAccountOpenWorkOrderCount } from "../../domain/accountWorkOrders";
import { useEmployeeDirectory } from "../../hooks/useEmployeeDirectory";
import { resolveOwnerIdentity, resolveContactIdentity, resolveTaxStatus } from "../../domain/commercialProfile";
import IdentityLine from "./IdentityLine";
import LoadingState from "../../shared/ui/LoadingState";
import EmptyState from "../../shared/ui/EmptyState";
import FailureState from "../../shared/ui/FailureState";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ActionRail from "../../shared/ui/ActionRail.jsx";
import ContextBand from "../../shared/ui/ContextBand.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import { useAuth } from "../../auth/AuthContext";
import MetadataRecordPage from "../../metadata/MetadataRecordPage.jsx";
import {
  accountRecordPageMainSubset,
  accountPageListResolver,
  accountPageEntityResolver,
  useAccountPageCapabilityDecisions,
} from "../../metadata/definitions/accountPageComponents.js";

// X-ACCOUNT-PAGE-WIRING -- Financials / Activity & Notes / Service Activity (the MAIN-column
// componentId sections, in accountPage.js's own order) now render through MetadataRecordPage
// against the real accountRecordPage definition (definitions/accountPage.js), using a subset of
// its sections -- see accountPageComponents.js's WIRING SCOPE note for exactly what remains
// hand-rendered below and why (the header identity, health strip, Account Attention, the
// Contacts/Locations RELATED_LIST sections, and the two FIELD_GROUP sections). Capability
// decisions come from useAccountPageCapabilityDecisions, the same trusted
// resolveEffectiveAccessCallable-backed, fail-closed gate access/useReportCapabilities.js
// already uses, requesting exactly the ids accountRecordPage declares.
//
// X-ACCOUNT-PAGE-WIRING-COMPLETE -- re-evaluated after MetadataRecordPage's three renderer gaps
// closed (commit 27b109bb: FIELD_GROUP entityResolver, RELATED_LIST default binding, `embedded`).
// Closing those gaps made every remaining section mechanically renderable; it did not make any of
// them SAFE to render here. Each was checked against what it would actually replace and found to
// render measurably worse -- see accountPageComponents.js's WIRING SCOPE block for the full,
// per-section evidence (a section-level finance.read gate hiding Account Attention's ungated
// Work-Order half for every current viewer; a forced duplicate live read plus lost Add/Import
// CRUD and lost post-add focus-handoff for Contacts/Locations; raw unresolved reference ids and a
// lost taxStatus safe-default for Commercial Profile; a lost collapsed-by-default layout for
// Notes & Identifiers). No section below was moved. Locked in by test/accountPageComponents.test.jsx.
//
// A-ACCOUNT-WIRE-CALLABLE-LISTS-2 -- Opportunities and Sales Orders (both RELATED_LIST,
// CALLABLE-readVia) are now ALSO wired through the same MetadataRecordPage call, as the first
// two sections of accountRecordPageMainSubset (accountPage.js's own order: opportunities ->
// salesOrders -> financials -> activityAndNotes -> serviceActivity). Their two prior blockers
// (a raw-epoch-millisecond TIMESTAMP column; DefaultRelatedList wiring no row navigation) closed
// with commit 6998306f -- see accountPageComponents.js's WIRING SCOPE note for the full
// re-verification and the one new REGISTRATION_PENDING finding (opportunity.js's own
// rowNavigationTo names a route that does not exist; handled inside accountPageComponents.js's
// listResolver, not here). AccountOpportunitiesSection.jsx / AccountSalesOrdersSection.jsx are no
// longer mounted here -- their own account-scoped hooks/components remain unmodified and
// available for other callers, but this page reads both through the metadata RELATED_LIST path.

// Sprint 2.0.2 -- Customer Foundation. Internal name AccountDetail;
// rendered UI says "Customer Detail" throughout.
//
// Customer/Account Business Model -- Customer PR 2 (docs/specifications/
// customer-account-business-model.md). Reworked from a flat panel into the
// approved SIX-SECTION layout (not tabs, per the Owner's direction), in
// reading order: Account Summary -> Financial Summary -> Contacts ->
// Locations -> Service Activity -> Notes/Identifiers. Financial Summary and
// Service Activity are INERT mount points only in this PR -- their live
// behavior (provider states, Work Order counts/timeline) is deliberately
// deferred to PR 3/PR 4. Reuses the ported address/contact domain layer
// (formatAddress, primaryContactState, AddressFields) rather than
// re-implementing it.
const RELATIONSHIP_LABEL = {
  [ACCOUNT_RELATIONSHIP_TYPE.CUSTOMER]: "Customer",
  [ACCOUNT_RELATIONSHIP_TYPE.VENDOR]: "Vendor",
};

const LINE_OF_BUSINESS_LABEL = {
  [ACCOUNT_LINE_OF_BUSINESS.TAYLOR]: "Taylor",
  [ACCOUNT_LINE_OF_BUSINESS.VENTANA]: "Ventana",
};

// Renders relationship-type badges inline. An Account with no
// relationshipTypes renders nothing (never a silent default to "Customer").
function RelationshipBadges({ relationshipTypes }) {
  const types = relationshipTypes ?? [];
  const ordered = Object.values(ACCOUNT_RELATIONSHIP_TYPE).filter((t) => types.includes(t));
  if (ordered.length === 0) return null;
  return (
    <>
      {ordered.map((t) => (
        <StatusPill key={t} tone={accountRelationshipTone(t)} label={RELATIONSHIP_LABEL[t] ?? t} />
      ))}
    </>
  );
}

// Renders line-of-business badges inline (W1, LOB wireframe §3.8). An Account
// with no lineOfBusiness renders nothing (never a silent default to "Taylor").
function LineOfBusinessBadges({ lineOfBusiness }) {
  const values = lineOfBusiness ?? [];
  const ordered = Object.values(ACCOUNT_LINE_OF_BUSINESS).filter((c) => values.includes(c));
  if (ordered.length === 0) return null;
  return (
    <>
      {ordered.map((c) => (
        <StatusPill key={c} tone={accountLineOfBusinessTone(c)} label={LINE_OF_BUSINESS_LABEL[c] ?? c} />
      ))}
    </>
  );
}

// Issue #214 PR-2 -- the inline ContactForm / LocationForm that used to render
// below the live lists have been replaced by ContactCreateModal /
// LocationCreateModal (shared Modal + System-A form primitives). See those files.

// Primary-contact summary for the Account Summary section -- reuses
// primaryContactState()'s three states; the MULTIPLE case surfaces the
// same non-silent warning the source derivation was built for.
function PrimaryContactSummary({ contacts }) {
  const primary = primaryContactState(contacts);
  if (primary.state === "ONE") {
    return <div className="fo-muted">Primary contact: {primary.contact.name}</div>;
  }
  if (primary.state === "MULTIPLE") {
    return (
      <div className="fo-warning">
        Warning: {primary.contacts.length} contacts are marked primary — resolve to a single primary contact.
      </div>
    );
  }
  return null; // NONE -> omit, never fabricate a primary
}

// Account Commercial Profile -- PR 1. Renders the informational fields. Every
// ID-bearing field shows its CURRENT resolved identity via IdentityLine (never
// the stored snapshot), so loading/resolved/unknown/error stay distinct.
// PO-required only renders when a real boolean is stored (a malformed stored
// value is surfaced in the edit form, not silently shown as Yes/No here).
function CommercialProfileSection({ account, contacts, contactsLoading, contactsError, byUserId, directoryLoading, directoryError }) {
  const currency = account.defaultCurrency || null;
  const invoiceMethod = account.invoiceDeliveryMethod || null;
  const hasPo = account.purchaseOrderRequired === true || account.purchaseOrderRequired === false;

  // Governed enum fields (PR 2). paymentTerms is shown only when set; tax
  // status is ALWAYS resolved (absent => UNKNOWN safe default, never silently
  // TAXABLE) and shown whenever the profile section renders. `hasTaxStatus`
  // (an explicitly stored value) is one of the signals that the section has
  // content, so a stored UNKNOWN still surfaces the section.
  const paymentTerms = account.paymentTerms || null;
  const hasTaxStatus = typeof account.taxStatus === "string" && account.taxStatus !== "";
  const taxStatus = resolveTaxStatus(account.taxStatus);

  const ownerIdentity = resolveOwnerIdentity(account.accountOwner, {
    byUserId,
    loading: directoryLoading,
    error: directoryError,
  });
  const billingIdentity = resolveContactIdentity(account.billingContact?.contactId, {
    contacts,
    loading: contactsLoading,
    error: contactsError,
  });

  const hasAny =
    currency ||
    invoiceMethod ||
    hasPo ||
    paymentTerms ||
    hasTaxStatus ||
    ownerIdentity.state !== "unset" ||
    billingIdentity.state !== "unset";

  return (
    <section className="wo-history">
      <h4>Commercial Profile</h4>
      {hasAny ? (
        <div className="fo-muted">
          <IdentityLine label="Owner" identity={ownerIdentity} />
          {currency && <div>Default currency: {currency}</div>}
          {paymentTerms && <div>Payment terms: {paymentTerms}</div>}
          {hasPo && <div>Purchase order required: {account.purchaseOrderRequired ? "Yes" : "No"}</div>}
          {invoiceMethod && <div>Invoice delivery: {invoiceMethod}</div>}
          {/* Safe default made visible: an Account with a profile always shows
              a tax status, resolving an absent value to UNKNOWN. */}
          <div>Tax status: {taxStatus}</div>
          <IdentityLine label="Billing contact" identity={billingIdentity} />
        </div>
      ) : (
        <p className="fo-muted">No commercial profile set yet.</p>
      )}
    </section>
  );
}

export default function AccountDetail() {
  const { accountId } = useParams();
  const navigate = useNavigate();
  // Guarded rather than a bare destructure: production always renders inside AuthProvider (App.jsx),
  // but several existing AccountDetail tests render this component with no AuthProvider ancestor --
  // useAuth() (useContext(AuthContext), no default value) returns undefined there. Falling back to
  // {} keeps `user` undefined/null in that case, which useAccountPageCapabilityDecisions already
  // treats as signed-out (fail-closed, denies every capability) -- never a permissive default.
  const { user } = useAuth() ?? {};
  const { account, loading, error: accountError, retry: retryAccount } = useAccount(accountId);
  const { data: locations, error: locationsError, retry: retryLocations } = useLocationsForAccount(accountId);
  const { data: contacts, loading: contactsLoading, error: contactsError } = useContactsForAccount(accountId);
  const { byUserId, loading: directoryLoading, error: directoryError } = useEmployeeDirectory();
  // The real, fail-closed capability decisions for accountRecordPage's declared ids -- see
  // accountPageComponents.js. Denies everything while loading/signed-out/erroring; never a
  // permissive default.
  const capabilityDecisions = useAccountPageCapabilityDecisions(user);
  // Health-strip inputs. Both are EXISTING authoritative account-scoped reads.
  //
  // This comment used to claim the strip and the AR area "can never disagree" because they share
  // the AR read. They share the read FUNCTION, not the read: AccountArSection and
  // AccountAttentionSection each call useAccountAr(accountId) independently, so one page load
  // issues three separate listAccountInvoiceAr requests. They can disagree, and they did -- see
  // issue #1094, where the strip reported Unavailable beside a section showing a real balance.
  // Single-read ownership is tracked separately as #1095; do not restore the invariant claim
  // until one owner actually holds the read.
  const arState = useAccountAr(accountId);
  // fetchFn must be a stable module-level reference (the hook keys its effect on it).
  const workOrderCount = useAccountWorkOrderCount(accountId, fetchAccountOpenWorkOrderCount);

  const [isEditing, setIsEditing] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // One polite live region per section; written by both the import and the
  // single-add create flow (they never run at once).
  const [contactAnnouncement, setContactAnnouncement] = useState("");
  const [locationAnnouncement, setLocationAnnouncement] = useState("");
  // The contact/location id to move focus to once the live subscription renders
  // its row (matched by id internally; the id is never rendered/announced).
  const [pendingContactFocus, setPendingContactFocus] = useState(null);
  const [pendingLocationFocus, setPendingLocationFocus] = useState(null);
  const contactRowRef = useRef(null);
  const locationRowRef = useRef(null);

  // After a successful import OR single add, focus the target Contact's row once
  // the live useContactsForAccount subscription has delivered it.
  useEffect(() => {
    if (pendingContactFocus && contactRowRef.current) {
      contactRowRef.current.focus();
      setPendingContactFocus(null);
    }
  }, [pendingContactFocus, contacts]);

  // Same for a newly added Location once useLocationsForAccount delivers it.
  useEffect(() => {
    if (pendingLocationFocus && locationRowRef.current) {
      locationRowRef.current.focus();
      setPendingLocationFocus(null);
    }
  }, [pendingLocationFocus, locations]);

  if (loading) return <div className="fo-panel"><LoadingState>Loading customer…</LoadingState></div>;

  // A read FAILURE and a NOT-FOUND are different facts and must stay
  // distinguishable (site-work #4): one means we could not look, the other
  // means we looked and it is not there. Reporting a denied/failed read as
  // "not found" would tell the user the customer does not exist when it may
  // simply not be theirs to see.
  if (accountError) {
    return (
      <div className="fo-panel">
        <FailureState
          title="Customer unavailable"
          message={accountError}
          action={<button type="button" onClick={retryAccount}>Retry</button>}
        />
      </div>
    );
  }

  if (!account) {
    return (
      <div className="fo-panel">
        <FailureState
          message="This customer could not be found."
          action={<button type="button" onClick={() => navigate("/customers")}>Back to Customers</button>}
        />
      </div>
    );
  }

  async function handleEditSubmit(values) {
    await updateAccount(account.id, values);
    setIsEditing(false);
  }

  // Called by LocationCreateModal. On a blocked/denied write this THROWS so the
  // modal stays open with safe copy and nothing is persisted. On success: close
  // once, announce the resolved name, queue focus onto the new row (the live
  // subscription inserts it) -- the raw id is only an internal match key.
  async function handleAddLocation(values) {
    const created = await createLocation(account.id, values);
    if (created?.blocked) {
      const blockedErr = new Error("write blocked");
      blockedErr.blocked = true;
      throw blockedErr;
    }
    setShowLocationModal(false);
    setPendingLocationFocus(created.id);
    setLocationAnnouncement(`Location ${created.name} added.`);
  }

  // Called by ContactCreateModal -- same contract as handleAddLocation.
  async function handleAddContact(values) {
    const created = await createContact(account.id, values);
    if (created?.blocked) {
      const blockedErr = new Error("write blocked");
      blockedErr.blocked = true;
      throw blockedErr;
    }
    setShowContactModal(false);
    setPendingContactFocus(created.id);
    setContactAnnouncement(`Contact ${created.name} added.`);
  }

  // Called by ContactImportModal on a successful atomic import. Close the modal,
  // announce the totals, and queue focus onto the first imported Contact; the live
  // subscription renders the new rows itself (no manual insert/refetch).
  function handleImported({ importedIds, importedCount, skippedDuplicates, rejected, firstName }) {
    setShowImport(false);
    setPendingContactFocus(importedIds?.[0] ?? null);
    const skipPart = skippedDuplicates ? `, ${skippedDuplicates} duplicate${skippedDuplicates === 1 ? "" : "s"} skipped` : "";
    const rejPart = rejected ? `, ${rejected} rejected` : "";
    setContactAnnouncement(
      `Imported ${importedCount} contact${importedCount === 1 ? "" : "s"}${skipPart}${rejPart}${firstName ? ` — first: ${firstName}` : ""}.`
    );
  }

  const billingLine = formatAddress(account.billingAddress);
  const hasIdentifiers =
    account.customerNumber || account.erpId || account.accountingId || account.legacyId;

  const actions = (
    <ActionRail
      start={<button type="button" onClick={() => navigate("/customers")} className="fo-link-btn">&larr; Back to Customers</button>}
      primary={!isEditing ? <button type="button" className="fo-btn-primary" onClick={() => setIsEditing(true)}>Edit</button> : null}
    />
  );

  return (
    <WorkspaceShell title={account.name} actions={actions}>
      {isEditing ? (
        <AccountForm
          initialValues={account}
          onSubmit={handleEditSubmit}
          onCancel={() => setIsEditing(false)}
          submitLabel="Save Changes"
          contacts={contacts}
          contactsLoading={contactsLoading}
          contactsError={contactsError}
        />
      ) : (
        <>
          {/* HEADER -- identity and relationship metadata in the shared ContextBand primitive
              (previously imported here but never rendered). Only authoritative values appear;
              ContextBand itself drops any item whose label is null. */}
          <section className="fo-account-summary">
            <div className="fo-pill-row">
              {account.status && (
                <StatusPill tone={accountStatusTone(account.status)} label={accountStatusLabel(account.status)} />
              )}
              <RelationshipBadges relationshipTypes={account.relationshipTypes} />
              <LineOfBusinessBadges lineOfBusiness={account.lineOfBusiness} />
            </div>

            <ContextBand
              items={[
                account.customerNumber ? { key: "customerNumber", label: "Customer #", value: account.customerNumber } : null,
                billingLine ? { key: "billing", label: "Billing", value: billingLine } : null,
                (account.tags ?? []).length > 0 ? { key: "tags", label: "Tags", value: account.tags.join(", ") } : null,
              ].filter(Boolean)}
            />
            <PrimaryContactSummary contacts={contacts} />
          </section>

          {/* HEALTH STRIP -- only metrics with a real account-scoped authority behind them.
              See domain/accountHealthStrip.js for what is deliberately absent and why. */}
          <AccountHealthStrip workOrderCount={workOrderCount} arView={accountArView(arState)} />
          {/* MAIN BODY -- roughly 2/3 primary + 1/3 secondary on desktop, collapsing to a
              single column on narrow viewports (see .fo-account-layout in index.css).
              PRIMARY holds the operational record surfaces; SECONDARY holds profile and
              relationship context. */}
          <div className="fo-account-layout">
            <div className="fo-account-primary">

          {/* Wave 7 completion, PARTS 2/3 -- account-scoped Opportunity + Sales Order reads now
              exist (listOpportunitiesForAccount / listSalesOrdersForAccount), so these sections are
              real record surfaces, not an empty shell implying "this account has none." Ordered
              Opportunities, then Sales Orders, above Financials in the PRIMARY column -- same
              order as always, now produced by accountRecordPageMainSubset (accountPage.js's own
              section order) rather than hand-sequenced here.

              A-ACCOUNT-WIRE-CALLABLE-LISTS-2: both sections now render through the single
              MetadataRecordPage call below (RELATED_LIST, CALLABLE readVia via
              callableListSource.js) rather than AccountOpportunitiesSection/
              AccountSalesOrdersSection directly. The two blockers that kept them hand-rendered
              (opportunity.js's expectedCloseAt TIMESTAMP column rendering as a raw epoch number;
              DefaultRelatedList wiring no row navigation) both closed with commit 6998306f --
              cellValue() now formats TIMESTAMP/DATE, and DefaultRelatedList now builds onRowClick
              from a resolved list definition's rowNavigationTo. Sales Orders keeps its real
              per-order route (opportunities/sales-order/:salesOrderId -> SalesOrderDetail.jsx,
              App.jsx) via salesOrderRelatedList's own rowNavigationTo, wired through unmodified.
              Opportunities has no equivalent per-record route anywhere in App.jsx today --
              opportunity.js's own rowNavigationTo names one that does not exist, a pre-existing
              defect outside this file's/accountPageComponents.js's writeScope for that specific
              file (definitions/opportunity.js) -- so accountPageComponents.js's listResolver
              strips it, and Opportunities rows render honestly non-focusable (no onClick, no
              tabIndex) rather than link to a page that would 404. See accountPageComponents.js's
              WIRING SCOPE note for the full evidence and the REGISTRATION_PENDING finding. */}

          {/* Accounts Receivable + the provider-dependent financial surfaces, ACTIVITY & NOTES,
              and Service Activity -- X-ACCOUNT-PAGE-WIRING: these three are exactly
              accountRecordPage's MAIN-column componentId sections (financials, activityAndNotes,
              serviceActivity), in the same order accountPage.js and this file already agreed on,
              now rendered through MetadataRecordPage against the real definition + the real
              capability decisions rather than called directly. Section-level behavior is
              unchanged (same components, same accountId), and financials/activityAndNotes stay
              gated on finance.read/crm.activity.read exactly as accountPage.js declares --
              crm.activity.read is registered active:false catalog-wide, so Activity & Notes will
              not render here until that capability is separately activated, which is the correct
              fail-closed reading of accountPage.js's own declaration, not a regression. Same
              fail-closed reading now applies to opportunity.read/salesOrder.read, both also
              registered active:false catalog-wide -- Opportunities/Sales Orders will not render
              here until either is separately activated, matching the already-accepted
              financials/activityAndNotes precedent, not a new regression. */}
          <MetadataRecordPage
            definition={accountRecordPageMainSubset}
            record={account}
            capabilityDecisions={capabilityDecisions}
            listResolver={accountPageListResolver}
            entityResolver={accountPageEntityResolver}
          />

          {/* 3. Contacts
              X-ACCOUNT-PAGE-WIRING-COMPLETE: evaluated for the metadata RELATED_LIST default
              binding (accountPage.js: listId account.contacts, entity readVia CLIENT_DIRECT --
              mechanically compatible) and left hand-rendered. `contacts` (useContactsForAccount,
              below) is required regardless for PrimaryContactSummary in the header and
              CommercialProfileSection's billing-contact resolution, so wiring the list display
              alone would start a SECOND, independent live read of the same query -- the exact
              double-read anti-pattern this file's AR note already tracks as a real bug (#1094/
              #1095), not a hypothetical one. Swapping the whole section would additionally drop
              "+ Add Contact" / "Import Contacts" and the post-add focus handoff to the new row
              (pendingContactFocus + contactRowRef) -- MetadataListGrid exposes no per-row ref. See
              accountPageComponents.js's WIRING SCOPE note. */}
          <section className="wo-history">
            <h4>Contacts ({contactsError ? "—" : contacts.length})</h4>
            <p className="fo-sr-only" role="status" aria-live="polite">{contactAnnouncement}</p>
            {contactsError ? (
              // site-work #8: a FAILED read is not "No contacts yet" -- mirrors the
              // Locations section's fail-closed pattern below. Rendering the false
              // empty state would hide real Contacts (duplicate-contact / mis-routed
              // -service risk); fail closed to an actionable failure instead.
              <div className="fo-inline-error" role="alert" data-contacts-error>
                {contactsError}
              </div>
            ) : contacts.length === 0 ? (
              <EmptyState variant="database" message="No contacts yet." />
            ) : (
              contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="wo-history-row"
                  ref={contact.id === pendingContactFocus ? contactRowRef : undefined}
                  tabIndex={contact.id === pendingContactFocus ? -1 : undefined}
                >
                  <strong>{contact.name}</strong>
                  {contact.isPrimary && <StatusPill tone="positive" label="Primary" />}
                  {contact.phone && <span className="fo-muted"> -- {contact.phone}</span>}
                  {contact.email && <span className="fo-muted"> -- {contact.email}</span>}
                </div>
              ))
            )}
            {/* Add Contact opens the shared-Modal creation flow; Import Contacts
                keeps its own separate CSV modal. No inline form below the list. */}
            <div className="fo-btn-row">
              <button type="button" onClick={() => setShowContactModal(true)}>+ Add Contact</button>
              <button type="button" onClick={() => setShowImport(true)}>Import Contacts</button>
            </div>
          </section>

          {showContactModal && (
            <ContactCreateModal
              accountName={account.name}
              onCreate={handleAddContact}
              onClose={() => setShowContactModal(false)}
            />
          )}

          {showImport && (
            <ContactImportModal
              accountId={account.id}
              accountName={account.name}
              existingContacts={contacts}
              onClose={() => setShowImport(false)}
              onImported={handleImported}
            />
          )}

          {/* 4. Locations -- add-only (no Location edit action exists)
              X-ACCOUNT-PAGE-WIRING-COMPLETE: same evaluation and outcome as Contacts above --
              readVia CLIENT_DIRECT is mechanically compatible with the RELATED_LIST default
              binding, but `locations` (useLocationsForAccount) still owns this section's count
              and error/retry state, and swapping the list display would either duplicate that
              live read or drop it, plus drop "+ Add Location" and the post-add focus handoff
              (pendingLocationFocus + locationRowRef). Left hand-rendered. */}
          <section className="wo-history">
            <h4>Locations ({locationsError ? "—" : locations.length})</h4>
            <p className="fo-sr-only" role="status" aria-live="polite">{locationAnnouncement}</p>
            {locationsError ? (
              // #291: a FAILED read is not "No locations yet". Fail closed to an
              // actionable failure with retry, never an empty state that would tell the
              // user this customer has no locations when we simply could not look.
              <div className="fo-inline-error" role="alert" data-location-error>
                {locationsError}{" "}
                <button type="button" className="fo-link-btn" onClick={retryLocations}>Retry</button>
              </div>
            ) : locations.length === 0 ? (
              <EmptyState variant="database" message="No locations yet." />
            ) : (
              locations.map((loc) => {
                const locLine = formatAddress(loc.address);
                return (
                  <div
                    key={loc.id}
                    className="wo-history-row"
                    ref={loc.id === pendingLocationFocus ? locationRowRef : undefined}
                    tabIndex={loc.id === pendingLocationFocus ? -1 : undefined}
                  >
                    <strong>{loc.name}</strong>
                    {locLine && <span className="fo-muted"> -- {locLine}</span>}
                    {loc.accessNotes && <div className="fo-muted">{loc.accessNotes}</div>}
                  </div>
                );
              })
            )}
            {/* Add Location opens the shared-Modal creation flow; no inline form. */}
            <button type="button" onClick={() => setShowLocationModal(true)}>+ Add Location</button>
          </section>

          {showLocationModal && (
            <LocationCreateModal
              accountName={account.name}
              onCreate={handleAddLocation}
              onClose={() => setShowLocationModal(false)}
            />
          )}

            </div>
            <aside className="fo-account-secondary" aria-label="Account context">

          {/* Commercial Profile -- informational fields + current-name identity (PR 1)
              X-ACCOUNT-PAGE-WIRING-COMPLETE: evaluated for the metadata FIELD_GROUP generic
              renderer (accountPage.js: commercialProfile, GAP 1's `entityResolver`) and left
              hand-rendered. The generic renderer's cellValue() has no REFERENCE-field
              resolution -- accountOwnerEmployeeId/billingContactId would show the raw stored
              employee/contact id where CommercialProfileSection shows the CURRENT resolved name
              via IdentityLine -- and no taxStatus safe default, so an absent taxStatus would
              render "—" instead of the required "Unknown" (domain/commercialProfile.js's
              resolveTaxStatus(), see account.js's own field comment). Both are data-correctness
              regressions, not formatting ones. See accountPageComponents.js's WIRING SCOPE
              note. */}
          <CommercialProfileSection
            account={account}
            contacts={contacts}
            contactsLoading={contactsLoading}
            contactsError={contactsError}
            byUserId={byUserId}
            directoryLoading={directoryLoading}
            directoryError={directoryError}
          />

          {/* Account Attention -- bounded and account-scoped, composed from existing
              authorities (AR overdue + Work Order past due). Renders nothing when there
              is nothing to say. The Marketing seam mounts alongside and stays absent
              while no provider exists: an optional section with nothing to say should
              contribute nothing, not a permanent apology.
              X-ACCOUNT-PAGE-WIRING-COMPLETE: still NOT routed through MetadataRecordPage,
              re-evaluated after `embedded` (GAP 3) shipped. `embedded` fixes the REGION-level
              symptom (a zero-section plan no longer becomes a page-level FailureState) but not
              the SECTION-level cause: accountPage.js declares ONE capability
              (finance.read) for this section, while AccountAttentionSection internally
              composes TWO sources at different authority levels -- AR via useAccountAr
              (finance.read-gated) and Work-Order-past-due via useAccountAttentionWorkOrders
              (UNGATED, Rules-by-role only). A section-level capabilityRequirement can only
              honor the coarser of the two, so wiring this through metadata would hide the
              entire panel -- including the ungated Work-Order half -- whenever finance.read
              is denied. finance.read is registered catalog-wide active:false today, i.e.
              denied for every current viewer, so that is not a theoretical edge case: it
              would blank this panel for 100% of users right now. Hand-rendered to keep
              AccountAttentionSection's real per-source degrade; see accountPageComponents.js's
              WIRING SCOPE note and test/accountPageComponents.test.jsx for the full case. */}
          <AccountAttentionSection accountId={account.id} />

          {/* ACTIVITY & NOTES -- the durable, attributed CRM interaction history. Primary
              column: it is a record surface a salesperson works in, not sidebar context. */}
          {/* 6. Notes / Identifiers -- collapsed by default
              X-ACCOUNT-PAGE-WIRING-COMPLETE: evaluated for the metadata FIELD_GROUP generic
              renderer (accountPage.js: notesAndIdentifiers) and left hand-rendered. No data
              gap this time (every field is plain STRING/TEXT) -- but this section is declared
              collapsedByDefault: true and MetadataRecordPage's <Section> has no collapse
              concept, so wiring it would silently change the page from collapsed to always
              expanded, a confirmed layout change. See accountPageComponents.js's WIRING
              SCOPE note. */}
          <details className="fo-account-collapsible">
            <summary>Notes &amp; Identifiers</summary>
            {account.notes ? (
              <div className="wo-inventory"><strong>Notes:</strong> {account.notes}</div>
            ) : (
              <p className="fo-muted">No notes.</p>
            )}
            {hasIdentifiers ? (
              <div className="fo-muted">
                {account.customerNumber && <div>Customer #: {account.customerNumber}</div>}
                {account.erpId && <div>ERP ID: {account.erpId}</div>}
                {account.accountingId && <div>Accounting ID: {account.accountingId}</div>}
                {account.legacyId && <div>Legacy ID: {account.legacyId}</div>}
              </div>
            ) : (
              <p className="fo-muted">No external identifiers.</p>
            )}
          </details>
            </aside>
          </div>
        </>
      )}
    </WorkspaceShell>
  );
}
