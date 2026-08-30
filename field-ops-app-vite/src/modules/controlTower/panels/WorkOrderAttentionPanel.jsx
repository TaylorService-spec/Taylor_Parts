import { Link } from "react-router-dom";
import StatusPill from "../../../shared/ui/StatusPill.jsx";
import { WO_ATTENTION_TYPE } from "../../../domain/workOrderAttentionProjection";
import { SECTION_ID } from "../../../domain/serviceOperationsNorthStar";

// The attention block — pattern 3, and the FIRST thing in the work area (Service Operations North
// Star P1). A pure presenter: every row it renders was built by domain/serviceOperationsNorthStar.js's
// serviceOperationsAttention(), which composes domain/workOrderAttentionProjection.js. This component
// classifies nothing.
//
// ── The two rulings that shape what is NOT here ─────────────────────────────────────────────────
//
// SO-N1 — NO RISK SEVERITY WORDS. The design drew "Urgent / Stalled / Parts blocked" severity labels
// on these rows. This projection has no severity and deliberately never will: attention semantics
// (does someone need to act?) and risk severity (how badly is this work order going?) are different
// questions over different data, and workOrderAttentionProjection.js's own header warns that one
// shared badge vocabulary across the two is how they come to mean nothing. What each row carries is
// the governed distinction the projection actually makes — ACTION_ITEM vs NOTIFICATION — rendered as
// "Action needed" / "In progress". Risk severity lives in the At risk table, one section down.
//
// SO-N2 — NO "URGENT" SECTION. The sections are WO_ATTENTION_SECTION_ORDER's four, in that order.
// Unassigned work needing a dispatcher is already Ready to Schedule; deriving it a second time here
// (`unfinished && !assignedTechId`) would show one work order twice under two names, and would put a
// business derivation back into JSX.
//
// SO-N4 — NO OWNER. recipientRole is a role, not a person. A row states the work order, the account
// and (where the governed item carries one) the technician. It never invents someone accountable.
//
// CLEAN RENDERS NOTHING. Not an empty box, not an "all clear" banner — the grammar's attention block
// is absent when there is nothing to attend to, so a clean day looks clean instead of looking like a
// panel that failed to load.

function AttentionRow({ item }) {
  const actionNeeded = item.attentionType === WO_ATTENTION_TYPE.ACTION_ITEM;

  return (
    <li className={`ns-attention__item ${actionNeeded ? "is-blocking" : "is-attention"}`}>
      <span className="ns-attention__severity">
        {actionNeeded ? "Action needed" : "In progress"}
      </span>
      <span className="ns-attention__fact">
        <strong>{item.woNumber}</strong>
        {item.account ? <> · {item.account}</> : null}
        {item.technicianName ? <> · {item.technicianName}</> : null}
      </span>
      <Link className="ns-attention__link" to={item.href}>
        Open work order →
      </Link>
    </li>
  );
}

export default function WorkOrderAttentionPanel({ attention }) {
  const sections = attention?.sections ?? [];
  const total = attention?.total ?? 0;
  // SO-G5. The projection defines a Parts Blocked section, but this page supplies no
  // partsReadinessByWorkOrderId, so that section can never populate here. Where there IS an attention
  // list, an absent Parts section would be read as "and no parts problems" — a claim this page cannot
  // make — so the boundary is stated inside the block. It disappears on its own the day a caller wires
  // the readiness read in.
  const partsUnavailable = attention?.partsReadinessConnected === false;

  // CLEAN RENDERS NOTHING — including the parts disclosure. The grammar's attention block is absent
  // when there is nothing to attend to, and a block containing only a capability note is still a
  // block: it would put a permanent box on every clean day, which is the exact "no blank regions, no
  // panels that look broken" case the honest-state model exists to prevent. An absent block makes no
  // claim about parts either way; a present one that omitted the section would.
  if (total === 0) return null;

  return (
    <section className="ns-section ns-attention" id={SECTION_ID.attention} aria-label="Needs attention">
      <div className="ns-section__head">
        <h2 className="ns-section__title">Needs attention</h2>
        {total > 0 ? <StatusPill tone="attention" label={String(total)} asText /> : null}
      </div>

      {sections.map((section) => (
        <div key={section.sectionLabel}>
          <p className="ns-attention__section-label">{section.sectionLabel}</p>
          <ul className="ns-attention__list">
            {section.items.map((item) => (
              <AttentionRow key={item.attentionItemId} item={item} />
            ))}
          </ul>
        </div>
      ))}

      {partsUnavailable ? (
        <div>
          <p className="ns-attention__section-label">Parts Blocked</p>
          <p className="ns-state ns-state--not-enabled">
            Parts readiness isn&rsquo;t connected to this page yet.
          </p>
        </div>
      ) : null}
    </section>
  );
}
