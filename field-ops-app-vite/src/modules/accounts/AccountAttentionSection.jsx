import { Link } from "react-router-dom";
import { useAccountAr } from "../../hooks/useAccountAr.js";
import { useAccountAttentionWorkOrders } from "../../hooks/useAccountAttentionWorkOrders.js";
import { accountArView } from "../../domain/accountArView.js";
import {
  ACCOUNT_ATTENTION_SOURCE_STATUS,
  accountAttentionItems,
  groupAccountAttentionItemsBySection,
} from "../../domain/accountAttentionProjection.js";
import {
  deriveAccountIntelligence,
  ACCOUNT_INTELLIGENCE_REASON,
} from "../../domain/accountIntelligence.js";

// ACCOUNT ATTENTION -- one bordered surface, two sections that never merge, and (only when it has
// something true to say) one line of explanation beneath the facts it explains.
//
// ════════════════════ WHAT THIS COMPONENT STILL DOES NOT DO ════════════════════
//
// It computes nothing. Both reads feed the ONE shared projection
// (domain/accountAttentionProjection.js), exactly as before, and AR and Work-Order past-due are
// still DELIBERATELY never merged or ranked into a single list: an overdue invoice is a
// collections concern and a past-due job is a scheduling concern, and there is no shared unit that
// would make one "worse" than the other. Each keeps its own section, its own fields, and its own
// honest note when its source could not be confirmed.
//
// ════════════════════ SILENCE IS THE HEALTHY STATE (design decision A-D1) ════════════════════
//
// When BOTH sources are READY and neither found anything, this renders NOTHING -- no surface, no
// green "all clear", no "Nothing needs attention on this account right now." receipt. That line
// used to render here and has been removed on purpose. A reader scanning a page for what needs
// them should find an empty space where trouble would have been; a receipt confirming the absence
// of trouble is one more thing to read on every healthy account, and it competes with the facts
// that are real. A source that could NOT be confirmed still speaks, in its own note -- silence is
// only ever earned by a confirmed-healthy read, never by a failed one.
//
// ════════════════════ THE INTELLIGENCE LINE (design section A9) ════════════════════
//
// domain/accountIntelligence.js has existed, fully tested, with NO consumer anywhere in the app.
// The approved composition gives it its place: inside this surface, BELOW the governed facts it
// explains, as explanation only. It is not a recommendation, not an action, not a chat. Its own
// contract already guarantees that (allowedRecommendation is structurally null and it falls silent
// on NO_ATTENTION / SOURCE_DEGRADED / INPUT_INVALID); this component adds no slot for one, so
// there is nowhere for a recommendation to appear even if one were someday produced.
//
// Nothing about the underlying authority changed to wire it: it consumes the SAME
// accountAttentionItems() result already computed above -- no extra read, no new source.

function sourceStatusNote(label, status) {
  switch (status) {
    case ACCOUNT_ATTENTION_SOURCE_STATUS.LOADING:
      return `Loading ${label}…`;
    case ACCOUNT_ATTENTION_SOURCE_STATUS.DENIED:
      return `${label}: not available to you.`;
    case ACCOUNT_ATTENTION_SOURCE_STATUS.UNAVAILABLE:
      return `${label}: couldn’t be read. Try again later.`;
    default:
      return null;
  }
}

// One AR row: the invoice, its governed outstanding text and day count, and a link into the AR
// section on this same page. AR data is REFERENCED here, never restated -- the numbers below are
// accountArView's own formatted strings, the same ones the Accounts receivable table renders.
function ArRow({ item }) {
  return (
    <li className="ns-attn__row">
      <span className="ns-attn__fact">
        Invoice <strong>{item.invoiceNumber}</strong>
        {item.outstandingText ? <span className="ns-attn__emph"> · {item.outstandingText}</span> : null}
        {item.daysOverdueText ? <span className="ns-attn__emph"> · {item.daysOverdueText}</span> : null}
      </span>
      <Link to={item.deepLink} className="ns-attn__link">
        Review <span aria-hidden="true">→</span>
      </Link>
    </li>
  );
}

// One past-due Work Order row. woNumber, deepLink and the section label are workOrderPastDueItem's
// OWN output, reused verbatim -- this component never re-derives what past due means or re-labels
// the section it belongs to.
function PastDueRow({ item }) {
  return (
    <li className="ns-attn__row">
      <span className="ns-attn__fact">
        Work order <strong>{item.woNumber}</strong>
        <span className="ns-attn__emph"> · scheduled window passed, still open</span>
      </span>
      <Link to={item.deepLink} className="ns-attn__link">
        Open <span aria-hidden="true">→</span>
      </Link>
    </li>
  );
}

export default function AccountAttentionSection({ accountId }) {
  const arRead = useAccountAr(accountId);
  const woRead = useAccountAttentionWorkOrders(accountId);

  const arView = accountArView({ loading: arRead.loading, errorStatus: arRead.errorStatus, result: arRead.result });
  const projection = accountAttentionItems({
    accountId,
    arView,
    workOrders: woRead.loading || woRead.error ? null : woRead.workOrders,
  });
  const { items, sourceStatus } = projection;
  const sections = groupAccountAttentionItemsBySection(items);

  const arNote = sourceStatusNote("Accounts Receivable", sourceStatus.ar);
  // A truncated (possibly-incomplete) account-scoped WO read degrades to the same honest
  // "could not be read" note as a failed read -- never a confidently under-reported past-due list
  // (mirrors accountArView.js's own "a truncated page is never labeled ready" rule).
  const woStatusForNote = woRead.truncated ? ACCOUNT_ATTENTION_SOURCE_STATUS.UNAVAILABLE : sourceStatus.workOrder;
  const woNote = sourceStatusNote("Work order attention", woStatusForNote);

  const bothHealthy =
    sourceStatus.ar === ACCOUNT_ATTENTION_SOURCE_STATUS.READY &&
    sourceStatus.workOrder === ACCOUNT_ATTENTION_SOURCE_STATUS.READY &&
    !woRead.truncated;

  // A-D1: confirmed healthy and empty renders nothing at all.
  if (items.length === 0 && bothHealthy) return null;

  // The intelligence contract is derived from the SAME projection. A truncated WO read is a
  // degraded source even though the projection labels it READY, so it is passed through as
  // UNAVAILABLE here -- an explanation built on a possibly-incomplete list is exactly the
  // "missing context with confident wording" deriveAccountIntelligence refuses to produce.
  const intelligence = deriveAccountIntelligence({
    items,
    sourceStatus: woRead.truncated
      ? { ...sourceStatus, workOrder: ACCOUNT_ATTENTION_SOURCE_STATUS.UNAVAILABLE }
      : sourceStatus,
  });
  const speaks = intelligence.speak && intelligence.reason === ACCOUNT_INTELLIGENCE_REASON.READY;

  return (
    <section className="ns-attn" aria-label="Attention">
      <div className="ns-attn__head">
        <span className="ns-attn__kicker">Attention</span>
        <span className="ns-attn__aside">
          Two conditions, kept apart on purpose — a collections concern and a scheduling concern
          share no scale.
        </span>
      </div>
      {arNote && <p className="ns-attn__note">{arNote}</p>}
      {woNote && <p className="ns-attn__note">{woNote}</p>}
      {sections.length > 0 && (
        <div className="ns-attn__sections">
          {sections.map((section) => (
            <div className="ns-attn__section" key={section.sectionLabel}>
              <h3 className="ns-attn__section-title">{section.sectionLabel}</h3>
              <ul className="ns-attn__list">
                {section.items.map((item) =>
                  item.domain === "ar" ? (
                    <ArRow key={item.attentionItemId} item={item} />
                  ) : (
                    <PastDueRow key={item.attentionItemId} item={item} />
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
      {speaks && (
        <p className="ns-attn__intel">
          <span className="ns-attn__intel-label">Intelligence</span>
          {intelligence.observedFact}{" "}
          <span className="ns-attn__intel-bound">
            Explanation only — EOS has no governed follow-up action for an account, so none is
            recommended.
          </span>
        </p>
      )}
    </section>
  );
}
