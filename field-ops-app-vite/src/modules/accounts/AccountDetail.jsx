import { useCallback, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { objectListPathWithState, OBJECT_LIST_KEY } from "../../navigation/objectRoutes.js";
import { accountRecordPage } from "../../metadata/definitions/accountPage.js";
import { ACCOUNT_GOVERNED_FIELD_IDS } from "../../metadata/definitions/account.js";
import { fieldEditability } from "../../metadata/pageDefinition.js";
import { savedListState } from "../../navigation/listStateMemory.js";
import { useAccount } from "../../hooks/useAccount";
import { useLocationsForAccount } from "../../hooks/useLocationsForAccount";
import { useContactsForAccount } from "../../hooks/useContactsForAccount";
import { updateAccount } from "../../domain/accounts";
import { createLocation } from "../../domain/locations";
import { createContact, primaryContactState } from "../../domain/contacts";
import { formatAddress } from "../../domain/address";
import { telHref } from "../../domain/phoneLink.js";
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
import FailureState from "../../shared/ui/FailureState";
import RecordIdentity from "../../shared/ui/RecordIdentity.jsx";
import ActionRail from "../../shared/ui/ActionRail.jsx";
import { Button } from "../../shared/ui/primitives/index.js";
import {
  accountHeader,
  accountClassification,
  accountLifecycle,
  accountTermsDigest,
} from "../../domain/accountNorthStar.js";
import { formatClockTime } from "../../domain/displayTimestamp.js";
import { useIsPhone } from "../../navigation/useIsPhone.js";
import { useAuth } from "../../auth/AuthContext";
import MetadataRecordPage from "../../metadata/MetadataRecordPage.jsx";
import MetadataListGrid from "../../metadata/MetadataListGrid.jsx";
import {
  accountRecordPageCommercialSubset,
  accountRecordPageArSubset,
  accountRecordPageServiceSubset,
  accountRecordPageContactsLocationsSubset,
  accountArGranted,
  accountCommercialGranted,
  accountPageListResolver,
  accountPageEntityResolver,
  useAccountPageCapabilityDecisions,
  buildAccountRelatedListPresentation,
} from "../../metadata/definitions/accountPageComponents.js";

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE CUSTOMER RECORD, AGAINST THE APPROVED ACCOUNT NORTH STAR P1 COMPOSITION.
//
// This page was migrated to the North Star grammar once already (#1511) using the FAMILY grammar,
// because no Owner-approved Account composition existed yet. One now does
// (design_handoff_account/North Star - Account P1.dc.html), and this file is the reconciliation
// against it -- a PRESENTATION pass, not a rebuild. Every read, write, capability gate, honest
// state and derivation on this page is the one that was already here. What moved is where facts
// sit and how they are drawn.
//
// WHAT THE APPROVED DESIGN CHANGED, IN ORDER:
//
//   1. CONTACTS LEAD THE RAIL. They rendered at the bottom of the main column, below every related
//      list -- "who do I call" was the last thing on the page. This is the load-bearing change.
//   2. STANDING IS ONE RULED ROW, not a grid of metric cards (AccountHealthStrip.jsx).
//   3. ATTENTION AND ITS EXPLANATION SHARE ONE BORDERED SURFACE, and the explanation sits BELOW
//      the governed facts it explains (AccountAttentionSection.jsx).
//   4. CLASSIFICATION MOVED INTO THE KICKER. It is identity, not a fact in the row beneath it.
//   5. THE TERMS DIGEST JOINED THE HEADER FACTS (accountTermsDigest).
//   6. RECEIVABLES GOT THEIR OWN MAIN-COLUMN SECTION rather than living inside a generic
//      financials block (AccountArSection.jsx).
//   7. STANDING NOW PRECEDES ATTENTION. Attention still comes before everything it warns about;
//      the three real numbers come first, as the approved composition draws them.
//   8. OPPORTUNITIES AND SALES ORDERS ARE ONE SECTION -- "Commercial activity" -- rather than two
//      sibling related lists. See the note on that section for why they remain TWO metadata
//      sections underneath (their capability gates are not the same gate).
//   9. REAL TABLET AND PHONE COMPOSITIONS. The page used to be a stacked desktop.
//
// WHAT DID NOT CHANGE, AND MUST NOT: the writes (updateAccount / createContact / createLocation),
// the capability decisions, the fail-closed gates, the distinct unavailable-vs-not-found states,
// the no-lifecycle rule (ND-11), the name-is-identity rule (DECISIONS #106), and the two-section
// attention rule.
//
// ── A-NS-1, a premise the design and the repository disagree on ──────────────────────────────
// The approved design's note says "useAccount is not a subscription". It is one -- hooks/
// useAccount.js uses onSnapshot. The design's CONCLUSION is implemented exactly as written (no
// live badge; honest "Read-checked <time> · Refresh" wording), because that wording is true under
// either premise: the data is at least as fresh as the stamp. Recorded rather than silently
// resolved, and it changes no business behavior, so it needed no ruling.
// ══════════════════════════════════════════════════════════════════════════════════════════════

// ════════════════════ THE LABEL MAPS THAT USED TO LIVE HERE ════════════════════
//
// `RELATIONSHIP_LABEL` and `LINE_OF_BUSINESS_LABEL` were declared in this file, and
// `metadata/definitions/account.js` already declared exactly the same two maps as `enumLabels` on
// the same two fields. Two copies of "CUSTOMER means Customer", free to drift, is the NS-P4 defect
// the whole migration exists to remove — and there was a third in `wholeUnitAssetDisplay.js`.
//
// `accountClassification()` in domain/accountNorthStar.js now reads the CANONICAL definition, and
// preserves both rules these components carried: an Account with no values renders nothing (never a
// silent default to "Customer" or "Taylor"), and the order follows the vocabulary rather than
// however the stored array happens to be sorted.

// THE KICKER, which is where the classification now lives.
//
// The record family word comes first ("Customer" — this is a customer record), then the account's
// own classification in the vocabulary's order. A relationship whose label IS the family word is
// not printed twice: an ordinary customer reads "Customer", not "Customer · Customer". An account
// with no classification at all renders the family word alone — never a silent default to
// "Taylor", which is the rule accountClassification() exists to keep.
function accountKicker(classification) {
  const words = ["Customer"];
  for (const item of [...classification.relationships, ...classification.linesOfBusiness]) {
    if (!words.includes(item.label)) words.push(item.label);
  }
  return words.join(" · ");
}

// Issue #214 PR-2 -- the inline ContactForm / LocationForm that used to render
// below the live lists have been replaced by ContactCreateModal /
// LocationCreateModal (shared Modal + System-A form primitives). See those files.

// THE PRIMARY CONTACT — "who do I call", answered honestly or not at all.
//
// ════════════════════ THE SELECTION RULE IS THE WHOLE COMPONENT ════════════════════
//
// primaryContactState() owns the answer and this component never second-guesses it. Its three
// states stay three states:
//
//   ONE       the governed primary. Its name, and — where a Call affordance is offered — a `tel:`
//             built from THAT contact's own stored phone and nothing else.
//   MULTIPLE  the ambiguity is surfaced, exactly as it always was. No contact is silently chosen,
//             and no Call is offered: picking one merely to have something to dial would be the
//             page inventing an answer the data does not hold.
//   NONE      stated. No contact is fabricated and no Call target is invented.
//
// A primary contact with no stored phone gets NO active Call control — never an account-level
// number, never a different contact who happens to have one. "This contact has no phone number" is
// the true answer; substituting a reachable number for an unreachable person is not a fallback,
// it is a different fact.
//
// ════════════════════ WHAT "CALL" IS ════════════════════
//
// A `tel:` URI over an already-stored value (domain/phoneLink.js). EOS hands the number to the
// device; the operating system opens the dialer, shows the number and asks the person whether to
// place the call. There is no write, no callable, no command, no telephony service and no
// automation here — and no contact prioritisation: the number dialled is the number of the ONE
// contact the record itself marks primary.
//
// The displayed number is the stored string, unchanged. Nothing is reformatted back into the
// record, and no Contact document is touched.
function PrimaryContactPanel({ contacts, loading, error, withCall = false }) {
  if (error) {
    return (
      <div className="ns-primary">
        <span className="ns-primary__label">Primary contact</span>
        <p className="ns-state">Contacts couldn’t be read, so the primary contact is unknown.</p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="ns-primary">
        <span className="ns-primary__label">Primary contact</span>
        <p className="ns-state">Loading contacts…</p>
      </div>
    );
  }

  const primary = primaryContactState(contacts);

  if (primary.state === "MULTIPLE") {
    return (
      <div className="ns-primary">
        <span className="ns-primary__label">Primary contact</span>
        <p className="ns-state ns-primary__ambiguous">
          {primary.contacts.length} contacts are marked primary — resolve to a single primary
          contact. No one of them is treated as the primary until that is settled.
        </p>
      </div>
    );
  }

  if (primary.state === "NONE") {
    return (
      <div className="ns-primary">
        <span className="ns-primary__label">Primary contact</span>
        <p className="ns-state">No contact on this customer is marked primary.</p>
      </div>
    );
  }

  const contact = primary.contact;
  const href = telHref(contact.phone);

  return (
    <div className="ns-primary">
      <span className="ns-primary__label">Primary contact</span>
      <div className="ns-primary__body">
        <span className="ns-primary__who">
          <strong>{contact.name}</strong>
          {contact.role ? <span className="ns-primary__role"> · {contact.role}</span> : null}
          {/* The stored value, rendered as stored. */}
          {contact.phone ? <span className="ns-primary__phone">{contact.phone}</span> : null}
        </span>
        {withCall &&
          (href ? (
            <a className="ns-primary__call" href={href}>
              Call
            </a>
          ) : (
            <span className="ns-primary__nocall">No phone number recorded</span>
          ))}
      </div>
    </div>
  );
}

// Account Commercial Profile -- PR 1. Renders the informational fields. Every
// ID-bearing field shows its CURRENT resolved identity via IdentityLine (never
// the stored snapshot), so loading/resolved/unknown/error stay distinct.
// PO-required only renders when a real boolean is stored (a malformed stored
// value is surfaced in the edit form, not silently shown as Yes/No here).
//
// It is a rail dl in the approved composition rather than a stack of lines, and tax status is
// ALWAYS stated — an absent value resolves to Unknown, NEVER silently to Taxable. That safe
// default is domain/commercialProfile.js's, applied here and in the header's terms digest, which
// is the same derivation read twice, not two derivations.
function CommercialProfileSection({ account, contacts, contactsLoading, contactsError, byUserId, directoryLoading, directoryError }) {
  const currency = account.defaultCurrency || null;
  const invoiceMethod = account.invoiceDeliveryMethod || null;
  const hasPo = account.purchaseOrderRequired === true || account.purchaseOrderRequired === false;

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
    <section className="ns-rail__section" aria-label="Commercial profile">
      <h3 className="ns-rail__title">Commercial profile</h3>
      {hasAny ? (
        <dl className="ns-rail__dl">
          <IdentityLine label="Owner" identity={ownerIdentity} variant="definition" />
          {paymentTerms && (
            <>
              <dt>Terms</dt>
              <dd>{paymentTerms}</dd>
            </>
          )}
          {/* Safe default made visible: an Account with a profile always shows a tax status,
              resolving an absent value to UNKNOWN. */}
          <dt>Tax status</dt>
          <dd>{taxStatus}</dd>
          {hasPo && (
            <>
              <dt>PO required</dt>
              <dd>{account.purchaseOrderRequired ? "Yes" : "No"}</dd>
            </>
          )}
          {invoiceMethod && (
            <>
              <dt>Invoicing</dt>
              <dd>{invoiceMethod}</dd>
            </>
          )}
          <IdentityLine label="Billing contact" identity={billingIdentity} variant="definition" />
          {currency && (
            <>
              <dt>Currency</dt>
              <dd>{currency}</dd>
            </>
          )}
        </dl>
      ) : (
        <p className="ns-state">No commercial profile set yet.</p>
      )}
    </section>
  );
}

// X-RELATED-LIST-ACTIONS wiring for the Contacts/Locations sections -- A-ACCOUNT-WIRE-CONTACTS-
// LOCATIONS. The section HEADING (with its live row count) and the "+ Add ..." / "Import ..."
// affordances stay hand-rendered here -- MetadataListGrid / DefaultRelatedList have no equivalent
// -- while the row grid itself, the four EMPTY/DENIED/UNAVAILABLE/READY states, and the
// post-create keyboard-focus handoff all route through the real metadata list runtime
// (buildAccountRelatedListPresentation + MetadataListGrid's own focusRowKey/onFocusHandled).
//
// It renders in the RAIL now rather than the main column, which is the approved composition's one
// load-bearing move. Nothing about the list, its reads or its writes changed with it.
function RelatedListSection({ heading, presentation, onRetry, focusRowKey, onFocusHandled, announcement, actions, children }) {
  return (
    <section className="ns-rail__section">
      <h3 className="ns-rail__title">{heading}</h3>
      <p className="fo-sr-only" role="status" aria-live="polite">{announcement}</p>
      {children}
      <MetadataListGrid
        presentation={presentation}
        onRetry={onRetry}
        caption={heading}
        focusRowKey={focusRowKey ?? undefined}
        onFocusHandled={onFocusHandled}
      />
      {actions && actions.length > 0 && (
        <div className="ns-rail__actions">
          {actions.map((action) => (
            <button key={action.label} type="button" className="fo-link-btn" onClick={action.onClick}>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export default function AccountDetail() {
  const { accountId } = useParams();
  const navigate = useNavigate();
  // BACK TO CUSTOMERS MEANS CUSTOMERS, whether this record was opened from the list, from a
  // dashboard tile or from a pasted link -- and it lands on the list the person was actually using,
  // filters and sort intact. Browser history would give one control four different behaviours; a
  // hardcoded "/customers" would reset their work. The route comes from the nav config so a
  // re-parented item follows automatically.
  const backToCustomers = () =>
    objectListPathWithState(OBJECT_LIST_KEY.CUSTOMERS, savedListState("customers"));
  // Guarded rather than a bare destructure: production always renders inside AuthProvider (App.jsx),
  // but several existing AccountDetail tests render this component with no AuthProvider ancestor --
  // useAuth() (useContext(AuthContext), no default value) returns undefined there. Falling back to
  // {} keeps `user` undefined/null in that case, which useAccountPageCapabilityDecisions already
  // treats as signed-out (fail-closed, denies every capability) -- never a permissive default.
  const { user, role } = useAuth() ?? {};

  // WIDTH CHOOSES COMPOSITION, NEVER AUTHORITY (see navigation/useIsPhone.js). The phone renders a
  // different ANSWER STACK -- identity, attention, standing, primary contact, activity, with
  // profile/receivables/notes behind "More" -- because a customer record read on a phone is being
  // read to answer one question, not to be surveyed. Every capability gate, every read and every
  // write below is identical at every width; rotating a phone changes nothing about what a person
  // may see or do.
  const isPhone = useIsPhone();

  // THE TWO GOVERNED FIELDS, AND WHO MAY CHANGE THEM.
  //
  // firestore.rules' accountGovernedFieldsUnchanged() lets a dispatcher update an Account only if
  // paymentTerms and taxStatus are UNCHANGED; an admin may change them. This mirrors that rule for
  // PRESENTATION -- it decides which pencils appear, and it decides nothing else. Rules remain the
  // enforcement: a dispatcher who reaches the write anyway is denied at the server, exactly as
  // AccountForm already relies on (it does not hide these fields from them either).
  const isAdmin = role === "admin";
  const accountEditability = useCallback(
    (fieldId) => fieldEditability(accountRecordPage, fieldId, {
      isAdmin,
      adminOnlyFieldIds: ACCOUNT_GOVERNED_FIELD_IDS,
    }),
    [isAdmin],
  );

  // A pencil opens the SAME governed form the page-level Edit opens, focused on the field that was
  // clicked. There is no per-field write path and this does not invent one: every save still goes
  // through AccountForm -> handleEditSubmit -> updateAccount, with Rules deciding.
  const [focusFieldId, setFocusFieldId] = useState(null);
  const editField = useCallback((fieldId) => {
    setFocusFieldId(fieldId);
    setIsEditing(true);
  }, []);
  const { account, loading, error: accountError, retry: retryAccount, checkedAt } = useAccount(accountId);
  const { data: locations, loading: locationsLoading, error: locationsError, retry: retryLocations } = useLocationsForAccount(accountId);
  const { data: contacts, loading: contactsLoading, error: contactsError, retry: retryContacts } = useContactsForAccount(accountId);
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
          action={<button type="button" onClick={() => navigate(backToCustomers())}>Back to Customers</button>}
        />
      </div>
    );
  }

  // On a blocked/denied write this THROWS so AccountForm's own catch keeps the
  // edit form open with an honest saveError message (see accountSaveErrorMessage)
  // -- same contract as handleAddLocation/handleAddContact below. Without this
  // check a blocked write resolved `{ blocked: true }` (it does not reject) and
  // fell straight through to setIsEditing(false), closing the form as if the
  // save succeeded while silently discarding the user's edits.
  async function handleEditSubmit(values) {
    const result = await updateAccount(account.id, values);
    if (result?.blocked) {
      const blockedErr = new Error("write blocked");
      blockedErr.blocked = true;
      throw blockedErr;
    }
    setIsEditing(false);
    setFocusFieldId(null);
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

  // The RELATED_LIST binding for accountRecordPage's "contacts" / "locations" sections.
  // `listRenderer` (MetadataRecordPage's own injection point) always wins over the default binding
  // for every RELATED_LIST section that call touches -- which is why this stays a SEPARATE
  // MetadataRecordPage call from the commercial one.
  //
  // Contacts leads, and it carries the governed primary-contact state above its rows: the count,
  // the ONE primary, or the MULTIPLE ambiguity, never a silently chosen one.
  function accountRelatedListRenderer({ listId }) {
    if (listId === "account.contacts") {
      return (
        <RelatedListSection
          heading={`Contacts (${contactsError ? "—" : contacts.length})`}
          presentation={buildAccountRelatedListPresentation({
            listId,
            rows: contacts,
            loading: contactsLoading,
            error: contactsError,
          })}
          onRetry={retryContacts}
          focusRowKey={pendingContactFocus}
          onFocusHandled={() => setPendingContactFocus(null)}
          announcement={contactAnnouncement}
          actions={[
            { label: "+ Add contact", onClick: () => setShowContactModal(true) },
            { label: "Import", onClick: () => setShowImport(true) },
          ]}
        >
          {/* No Call affordance in the rail: the prominent Call control belongs to the phone
              answer stack, and a second desktop calling surface is not something the approved
              composition asks for. The primary-contact STATE is stated at every width. */}
          <PrimaryContactPanel
            contacts={contacts}
            loading={contactsLoading}
            error={contactsError}
            withCall={false}
          />
        </RelatedListSection>
      );
    }
    if (listId === "account.locations") {
      return (
        <RelatedListSection
          heading={`Locations (${locationsError ? "—" : locations.length})`}
          presentation={buildAccountRelatedListPresentation({
            listId,
            rows: locations,
            loading: locationsLoading,
            error: locationsError,
          })}
          onRetry={retryLocations}
          focusRowKey={pendingLocationFocus}
          onFocusHandled={() => setPendingLocationFocus(null)}
          announcement={locationAnnouncement}
          actions={[{ label: "+ Add location", onClick: () => setShowLocationModal(true) }]}
        />
      );
    }
    return null;
  }

  const billingLine = formatAddress(account.billingAddress);
  const hasIdentifiers =
    account.customerNumber || account.erpId || account.accountingId || account.legacyId;

  const header = accountHeader(account);
  const classification = accountClassification(account);
  const lifecycle = accountLifecycle();
  // Read once, at the granularity this page composes at -- see accountPageComponents.js.
  const arGranted = accountArGranted(capabilityDecisions);
  const commercialGranted = accountCommercialGranted(capabilityDecisions);
  const termsDigest = accountTermsDigest(account);
  // The owner, resolved to a CURRENT name, never the stored id or a stale snapshot. Absent and
  // still-resolving both render nothing in the header rather than a placeholder fact.
  const ownerIdentity = resolveOwnerIdentity(account.accountOwner, {
    byUserId,
    loading: directoryLoading,
    error: directoryError,
  });
  const ownerFact =
    ownerIdentity.state === "unset" || ownerIdentity.state === "loading" ? null : ownerIdentity.name;

  const actions = (
    <ActionRail
      start={<button type="button" onClick={() => navigate(backToCustomers())} className="fo-link-btn">&larr; Back to Customers</button>}
      primary={!isEditing ? <Button variant="primary" onClick={() => setIsEditing(true)}>Edit customer</Button> : null}
    />
  );

  // ── The composed pieces, defined once and ordered per composition below ────────────────────

  // COMMERCIAL ACTIVITY -- ONE section, TWO governed reads.
  //
  // The approved composition draws opportunities and orders as a single section in one row
  // grammar, and that is what renders. Underneath they remain two metadata RELATED_LIST sections
  // on purpose: they are gated by DIFFERENT capabilities (opportunity.read / salesOrder.read), and
  // collapsing them into one metadata section would force one gate to answer for both -- a
  // fail-closed granularity loss, to satisfy a visual. Two declarations, one section on the page.
  //
  // Opportunity rows stay honestly non-navigable: no opportunity record page exists anywhere in
  // App.jsx, so a row that looked clickable would 404. The reason is stated rather than left as an
  // unexplained dead row, and no route is invented here to fix it.
  const commercialActivity = (
    <section className="ns-section" aria-label="Commercial activity">
      <div className="ns-section__head">
        <h2 className="ns-section__title">Commercial activity</h2>
        <span className="ns-section__meta">· opportunities and orders for this account</span>
      </div>
      {/* `embedded`: this render is a FRAGMENT of a hand-composed page, not the page. Without it
          a fully-denied subset claims "you do not have access to any part of this record" -- a
          page-level sentence about a section, beside a page that is plainly still rendering. */}
      <MetadataRecordPage
        definition={accountRecordPageCommercialSubset}
        record={account}
        onEditField={editField}
        editability={accountEditability}
        capabilityDecisions={capabilityDecisions}
        listResolver={accountPageListResolver}
        entityResolver={accountPageEntityResolver}
        embedded
      />
      {commercialGranted ? (
        <p className="ns-table__note">
          Opportunity rows can’t open yet — no opportunity page exists. Orders link to their records.
        </p>
      ) : (
        // The section keeps its place and says why it is empty. An empty commercial section with
        // no explanation reads as "this customer has no orders", which is a different fact.
        <p className="ns-state ns-state--denied">Not available to you.</p>
      )}
    </section>
  );

  // ACCOUNTS RECEIVABLE -- its own main-column section (AccountArSection carries the heading), and
  // still gated on finance.read exactly as accountPage.js declares it.
  //
  // A-D2 -- WHEN finance.read DENIES AR, THE FINANCIAL GEOGRAPHY STAYS. MetadataRecordPage hides a
  // gated section by rendering nothing, which on this page would remove the financial region
  // entirely for a salesperson -- and a customer record with no financial region reads as a
  // customer who owes nothing. That is the one thing this page must never imply. So the section
  // keeps its title and states the denial in the approved words. It is a presentation of the SAME
  // fail-closed decision, not a second gate: nothing below reaches a read.
  const receivables = arGranted ? (
    <MetadataRecordPage
      definition={accountRecordPageArSubset}
      record={account}
      onEditField={editField}
      editability={accountEditability}
      capabilityDecisions={capabilityDecisions}
      listResolver={accountPageListResolver}
      entityResolver={accountPageEntityResolver}
      embedded
    />
  ) : (
    <section className="ns-section" aria-label="Accounts receivable">
      <div className="ns-section__head">
        <h2 className="ns-section__title">Accounts receivable</h2>
      </div>
      {/* Not zero, not empty, not absent — a different answer from all three. */}
      <p className="ns-state ns-state--denied">Not available to you.</p>
    </section>
  );

  // SERVICE ACTIVITY, then Activity & Notes. crm.activity.read is registered active:false
  // catalog-wide, so Activity & Notes renders nowhere it is not separately activated -- the
  // correct fail-closed reading of accountPage.js's own declaration, not a regression. It sits
  // last because the approved composition names three main-column sections and this is not one of
  // them; where it IS activated it appends rather than displacing them.
  const serviceActivity = (
    <MetadataRecordPage
      definition={accountRecordPageServiceSubset}
      record={account}
      onEditField={editField}
      editability={accountEditability}
      capabilityDecisions={capabilityDecisions}
      listResolver={accountPageListResolver}
      entityResolver={accountPageEntityResolver}
      embedded
    />
  );

  // CONTACTS FIRST, then Locations -- accountRecordPageContactsLocationsSubset's own order.
  const contactsAndLocations = (
    <MetadataRecordPage
      definition={accountRecordPageContactsLocationsSubset}
      record={account}
      capabilityDecisions={capabilityDecisions}
      listResolver={accountPageListResolver}
      entityResolver={accountPageEntityResolver}
      listRenderer={accountRelatedListRenderer}
      embedded
    />
  );

  const commercialProfile = (
    <CommercialProfileSection
      account={account}
      contacts={contacts}
      contactsLoading={contactsLoading}
      contactsError={contactsError}
      byUserId={byUserId}
      directoryLoading={directoryLoading}
      directoryError={directoryError}
    />
  );

  // NOTES & IDENTIFIERS -- collapsed by default, matching accountPage.js's own
  // collapsedByDefault: true. Low-value metadata stays secondary; it is not promoted into the
  // primary hierarchy because it happens to be easy to render.
  const notesAndIdentifiers = (
    <section className="ns-rail__section">
      <details className="ns-rail__details">
        <summary className="ns-rail__title">Notes &amp; identifiers</summary>
        {account.notes ? (
          <p className="ns-rail__meta">{account.notes}</p>
        ) : (
          <p className="ns-state">No notes.</p>
        )}
        {hasIdentifiers ? (
          <div className="ns-rail__meta">
            {account.customerNumber && <div>Customer #: {account.customerNumber}</div>}
            {account.erpId && <div>ERP ID: {account.erpId}</div>}
            {account.accountingId && <div>Accounting ID: {account.accountingId}</div>}
            {account.legacyId && <div>Legacy ID: {account.legacyId}</div>}
          </div>
        ) : (
          <p className="ns-state">No external identifiers.</p>
        )}
      </details>
    </section>
  );

  const standing = <AccountHealthStrip workOrderCount={workOrderCount} arView={accountArView(arState)} />;
  const attention = <AccountAttentionSection accountId={account.id} />;

  return (
    <div className={isPhone ? "ns-page ns-page--phone" : "ns-page"}>
      {/* THE UTILITY LINE. Context left; on the right, what is TRUE about this read.
          No live badge -- the approved composition asks for honest freshness wording instead, and
          Refresh re-subscribes through useAccount's own retry (no new read path). A page with no
          answer yet says nothing rather than stamping a time it cannot evidence. */}
      <div className="ns-page__utility">
        <span className="ns-page__context">
          <Link to={backToCustomers()}>CRM/Sales → Customers</Link>
          {header.name ? ` → ${header.name}` : null}
        </span>
        <span className="ns-page__freshness">
          {checkedAt ? `Read-checked ${formatClockTime(checkedAt)} · ` : null}
          <button type="button" className="fo-link-btn" onClick={retryAccount}>Refresh</button>
        </span>
      </div>
      <div className="ns-rulepair" />

      {isEditing ? (
        <AccountForm
          initialValues={account}
          onSubmit={handleEditSubmit}
          focusFieldId={focusFieldId}
          onCancel={() => { setIsEditing(false); setFocusFieldId(null); }}
          submitLabel="Save Changes"
          contacts={contacts}
          contactsLoading={contactsLoading}
          contactsError={contactsError}
        />
      ) : (
        <>
          {/* THE RECORD HEADER. The status is stated ONCE, as a sentence, and the classification
              is stated in words in the KICKER rather than as facts beneath the title — it is
              identity, not a detail about the record.

              THE TITLE IS THE NAME. An Account has no governed reference — customerNumber, erpId,
              accountingId and legacyId are all EXTERNAL identifiers from other systems, and none of
              them is what anybody here calls the customer. The document id is never a fallback
              (DECISIONS #106). */}
          <RecordIdentity
            kicker={accountKicker(classification)}
            reference={header.name}
            fallbackName="Account — no name recorded"
            statusWords={header.statusSentence ?? header.statusWords}
            statusTone={header.statusTone}
            statusVariant="sentence"
            facts={[
              ownerFact ? { key: "owner", label: "Owner", value: ownerFact } : null,
              billingLine ? { key: "billing", label: "Billing", value: billingLine } : null,
              account.customerNumber ? { key: "customerNumber", label: "Customer #", value: account.customerNumber } : null,
              termsDigest ? { key: "terms", label: null, value: termsDigest } : null,
            ].filter(Boolean)}
            actions={actions}
          />

          {/* ND-11 — WHY THERE IS NO LIFECYCLE BAND HERE.
              NS-P1 asks every record page for a visible lifecycle spine. This record does not have
              one: `status` is an ordinary editable field written through `updateAccount`, with no
              transition command anywhere and nothing enforcing an order. ACTIVE / INACTIVE /
              PROSPECT / ARCHIVED look like a progression, and drawing them as four chevrons would
              assert a rule the engine does not hold. Stated in words rather than left as an
              unexplained difference from the other two record families. */}
          <p className="ns-gap-note">{lifecycle.reason}</p>

          {isPhone ? (
            /* THE PHONE ANSWER STACK. Not a squeezed desktop: identity → attention → standing →
               primary contact → activity, with profile, receivables and notes behind "More".
               The order is the order the questions are asked in on a phone. */
            <>
              {attention}
              {standing}
              <PrimaryContactPanel
                contacts={contacts}
                loading={contactsLoading}
                error={contactsError}
                withCall
              />
              <div className="ns-record-body">
                <div>
                  {commercialActivity}
                  {serviceActivity}
                </div>
                <aside className="ns-rail" aria-label="Account context">
                  <details className="ns-more">
                    <summary className="ns-more__summary">More</summary>
                    {contactsAndLocations}
                    {commercialProfile}
                    {receivables}
                    {notesAndIdentifiers}
                  </details>
                </aside>
              </div>
            </>
          ) : (
            <>
              {/* STANDING -- only metrics with a real account-scoped authority behind them.
                  See domain/accountHealthStrip.js for what is deliberately absent and why. */}
              {standing}

              {/* ATTENTION, IN ITS CORRECT PLACE (NS-P2): after the three real numbers, and
                  BEFORE everything it warns about. It is deliberately NOT flattened into the
                  shared AttentionBand: accountAttentionProjection.js states that AR and
                  Work-Order past-due are never merged into one ranked list, and a flat band has
                  nowhere to put its per-source honest notes. */}
              {attention}

              <div className="ns-record-body">
                <div>
                  {commercialActivity}
                  {receivables}
                  {serviceActivity}
                </div>
                <aside className="ns-rail" aria-label="Account context">
                  {/* CONTACTS LEAD THE RAIL. "Who do I call" no longer lives at the bottom of the
                      page — this is the approved composition's load-bearing change from #1511. */}
                  {contactsAndLocations}
                  {commercialProfile}
                  {notesAndIdentifiers}
                </aside>
              </div>
            </>
          )}

          {/* The create/import modals mount at PAGE level, never inside the rail: a modal nested
              in the phone composition's collapsed "More" disclosure would not render at all. */}
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

          {showLocationModal && (
            <LocationCreateModal
              accountName={account.name}
              onCreate={handleAddLocation}
              onClose={() => setShowLocationModal(false)}
            />
          )}
        </>
      )}
    </div>
  );
}
