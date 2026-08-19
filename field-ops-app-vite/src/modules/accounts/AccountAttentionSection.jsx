import { Link } from "react-router-dom";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import { useAccountAr } from "../../hooks/useAccountAr.js";
import { useAccountAttentionWorkOrders } from "../../hooks/useAccountAttentionWorkOrders.js";
import { accountArView } from "../../domain/accountArView.js";
import {
  ACCOUNT_ATTENTION_TYPE,
  ACCOUNT_ATTENTION_SOURCE_STATUS,
  accountAttentionItems,
  groupAccountAttentionItemsBySection,
} from "../../domain/accountAttentionProjection.js";

// Wave 7 extension, PART 1.6 -- the Account Attention section: a self-contained, presentational consumer
// of domain/accountAttentionProjection.js. SELF-CONTAINED BY DESIGN -- AccountDetail.jsx is being
// redesigned concurrently, so this component owns its own reads (useAccountAr +
// useAccountAttentionWorkOrders) and can be dropped into that redesign wherever it lands, needing only
// `accountId`. It computes nothing itself: both underlying reads feed the ONE shared projection, exactly
// like WorkOrderAttentionPanel.jsx does for ControlTower.
//
// AR and WO past-due are DELIBERATELY never merged into one ranked list -- each renders under its own
// section with its own fields (see accountAttentionProjection.js's header). A source that could not be
// confirmed (denied/unavailable/loading) renders its OWN honest note instead of silently contributing a
// fake zero to the total.
function sourceStatusNote(label, status) {
  switch (status) {
    case ACCOUNT_ATTENTION_SOURCE_STATUS.LOADING:
      return `Loading ${label}…`;
    case ACCOUNT_ATTENTION_SOURCE_STATUS.DENIED:
      return `${label}: not authorized to view.`;
    case ACCOUNT_ATTENTION_SOURCE_STATUS.UNAVAILABLE:
      return `${label}: currently unavailable. Try again later.`;
    default:
      return null;
  }
}

function AttentionRow({ item }) {
  return (
    <Link to={item.deepLink} className="work-order-card fo-attention-row">
      <h4 className="fo-attention-row__title">
        {item.domain === "ar" ? item.invoiceNumber : item.woNumber}
        {item.attentionType === ACCOUNT_ATTENTION_TYPE.ACTION_ITEM ? (
          <StatusPill tone="attention" label="Action needed" />
        ) : (
          <StatusPill tone="info" label="In progress" />
        )}
      </h4>
      {item.domain === "ar" ? (
        <div className="fo-muted">
          {item.outstandingText}
          {item.daysOverdueText ? ` · ${item.daysOverdueText}` : ""}
        </div>
      ) : null}
    </Link>
  );
}

export default function AccountAttentionSection({ accountId }) {
  const arRead = useAccountAr(accountId);
  const woRead = useAccountAttentionWorkOrders(accountId);

  const arView = accountArView({ loading: arRead.loading, errorStatus: arRead.errorStatus, result: arRead.result });
  const { items, sourceStatus } = accountAttentionItems({
    accountId,
    arView,
    workOrders: woRead.loading || woRead.error ? null : woRead.workOrders,
  });
  const sections = groupAccountAttentionItemsBySection(items);
  const total = items.length;

  const arNote = sourceStatusNote("Accounts Receivable", sourceStatus.ar);
  // A truncated (possibly-incomplete) account-scoped WO read degrades to the same honest "unavailable"
  // note as a failed read -- never a confidently under-reported past-due list (mirrors
  // accountArView.js's own "a truncated page is never labeled ready" rule).
  const woStatusForNote = woRead.truncated ? ACCOUNT_ATTENTION_SOURCE_STATUS.UNAVAILABLE : sourceStatus.workOrder;
  const woNote = sourceStatusNote("Work order attention", woStatusForNote);

  const bothHealthy =
    sourceStatus.ar === ACCOUNT_ATTENTION_SOURCE_STATUS.READY &&
    sourceStatus.workOrder === ACCOUNT_ATTENTION_SOURCE_STATUS.READY &&
    !woRead.truncated;

  return (
    <section className="wo-history">
      <h3>Account Attention{total > 0 ? ` (${total})` : ""}</h3>
      {arNote && <p className="fo-muted">{arNote}</p>}
      {woNote && <p className="fo-muted">{woNote}</p>}
      {total === 0 && bothHealthy && <p className="fo-muted">Nothing needs attention on this account right now.</p>}
      {sections.map((section) => (
        <div key={section.sectionLabel}>
          <p className="fo-notification-panel-section">{section.sectionLabel}</p>
          {section.items.map((item) => (
            <AttentionRow key={item.attentionItemId} item={item} />
          ))}
        </div>
      ))}
    </section>
  );
}
