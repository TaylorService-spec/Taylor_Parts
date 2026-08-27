import {
  OPPORTUNITY_STAGES,
  OPPORTUNITY_VIEW,
  channelLabel,
  stageLabel,
} from "./opportunityLifecycle.js";

// THE OPPORTUNITY COLLECTION ROW, DERIVED ONCE — North Star List P1v4.
//
// PURE. No React, no read, no clock. Everything here is a re-wording of facts
// `buildOpportunityPipeline` already derived, so the list and the record cannot disagree about a
// deal, and a tab cannot disagree with the rows it opens.
//
// ════════════════════ WHY THIS IS NOT IN THE COMPONENT ════════════════════
//
// Every rule below is a truth claim about a business record — what counts as unresolved, what an
// absent value is allowed to look like, whether an agreement exists. Those belong somewhere
// testable without a DOM, and somewhere a second surface can reuse without copying. The component
// renders what this returns and decides nothing.

/** The counts the header sentence and the view tabs both read. One source, so they cannot drift. */
export function opportunityListCounts(pipeline, { viewerEmployeeId = null } = {}) {
  const open = pipeline?.rows ?? [];
  const all = pipeline?.all ?? [];
  const needsAttention = pipeline?.counts?.needsAttention ?? 0;
  const atDecision = pipeline?.stageCounts?.DECISION ?? 0;
  // NULL, NOT ZERO, when the viewer is unknown. A "0" on the My-opportunities tab is a claim that
  // the viewer has no work; the truth is that we could not tell whose work is whose, and the view
  // itself says so. The tab renders no count rather than a confident wrong one.
  const mine = viewerEmployeeId ? open.filter((r) => r.ownerEmployeeId === viewerEmployeeId).length : null;
  return {
    open: pipeline?.counts?.open ?? 0,
    mine,
    needsAttention,
    atDecision,
    byView: {
      [OPPORTUNITY_VIEW.OPEN]: open.length,
      [OPPORTUNITY_VIEW.MINE]: mine,
      [OPPORTUNITY_VIEW.NEEDS_ATTENTION]: needsAttention,
      [OPPORTUNITY_VIEW.AT_DECISION]: atDecision,
      [OPPORTUNITY_VIEW.WON]: pipeline?.counts?.won ?? 0,
      [OPPORTUNITY_VIEW.LOST]: pipeline?.counts?.lost ?? 0,
      [OPPORTUNITY_VIEW.ALL]: all.length,
    },
  };
}

/** Grouped digits, no symbol. See `value` below for why that is not a styling choice. */
const groupNumber = (n) => (typeof n === "number" && Number.isFinite(n) ? n.toLocaleString() : null);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Short date, no clock. `expectedCloseAt` is a DATE; a time of day would be invented precision. */
function shortDate(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * ONE ROW.
 *
 * @param row          a pipeline row from `buildOpportunityPipeline`
 * @param nowMillis    injected, so "closing in N days" is deterministic in a test
 * @param resolveOwner (employeeId) => name | null. INJECTED, not imported: this file must stay
 *                     pure, and the caller already holds one directory subscription for the whole
 *                     page. Resolution is a map lookup per row, never a read per row.
 */
export function opportunityListRow(row, { nowMillis = Date.now(), resolveOwner = null } = {}) {
  const id = row?.id ?? null;

  // IDENTITY (G1). There is no Opportunity Name field in the data model, so identity is the
  // governed reference with `need` as the secondary line — exactly what P1v4 specifies. A record
  // written before numbering says so; the document id is NEVER the label (DECISIONS #106), and it
  // is not even carried onto this object so a renderer cannot reach for it.
  const reference = row?.opportunityNumber ?? "Opportunity — not numbered";

  // CUSTOMER (G4). The governed list read resolves account names server-side and the client source
  // carries them through, so a name is normally present. When it is not, the ABSENCE is stated —
  // never the accountId, which is the defect DECISIONS #106 exists to forbid.
  const rawName = typeof row?.customerName === "string" ? row.customerName.trim() : "";
  const customerName = rawName && rawName !== "—" ? rawName : null;

  const stageIndex = OPPORTUNITY_STAGES.indexOf(row?.stage);
  const outcome = row?.outcome ?? null;

  // ATTENTION. The domain's own derivation, worded by it. This file picks no severities and
  // invents no ranking: `row.attention[0]` is the reason the pipeline itself sorted on.
  const first = Array.isArray(row?.attention) && row.attention.length > 0 ? row.attention[0] : null;

  const close = typeof row?.expectedCloseAt === "number" ? row.expectedCloseAt : null;
  const daysToClose = close != null ? Math.round((close - nowMillis) / DAY_MS) : null;

  return {
    id,
    href: id ? `/customers/opportunities/${encodeURIComponent(id)}` : "/customers/opportunities",
    reference,
    need: typeof row?.need === "string" && row.need.trim() ? row.need.trim() : null,

    customer: {
      name: customerName,
      // P1v4's exact wording. Says which fact is missing, so nobody reads it as "no customer".
      fallback: "Customer — name unavailable",
    },
    channel: row?.channel ? channelLabel(row.channel) : null,
    // The governed stage KEY, carried alongside the words so filtering matches on the key and never
    // on a label -- a reworded label must not silently change what a filter selects.
    stageKey: row?.stage ?? null,

    stage: {
      // Closed deals read by OUTCOME, open ones by STAGE — the same reading `commercialState`
      // applies everywhere else. "n of 6" is a compact position, never the record page's chevrons.
      words: outcome ? (outcome === "WON" ? "Won" : "Lost") : (row?.stage ? stageLabel(row.stage) : "—"),
      position: outcome || stageIndex < 0 ? null : `${stageIndex + 1} of ${OPPORTUNITY_STAGES.length}`,
      tone: outcome === "WON" ? "positive" : outcome === "LOST" ? "muted" : row?.stage === "DECISION" ? "attention" : "info",
    },

    attention: { words: first?.label ?? null, tone: first ? row.attentionTone : null },

    // EST. VALUE (G5). `expectedValue` is stored as a plain number with NO currency field, so no
    // symbol is rendered — asserting "$" would claim a unit nobody recorded, which is the exact
    // defect found live on the old workspace. Absent is "Not estimated", never 0: a zero reads as
    // a worthless deal rather than an unestimated one.
    value: { amount: groupNumber(row?.expectedValue), fallback: "Not estimated" },

    close: {
      date: shortDate(close),
      // "· 9d" only when the close is genuinely near, and only from the stored date.
      note: daysToClose != null && daysToClose >= 0 && daysToClose <= 14 ? `${daysToClose}d` : null,
      overdue: daysToClose != null && daysToClose < 0,
      fallback: "Not recorded",
    },

    // ════════════════ AGREEMENT / ORDER (G2, G3) ════════════════
    //
    // WHAT THE LIST READ ACTUALLY KNOWS, verified against the projection rather than assumed:
    // `salesAgreementId` and `salesOrderId` ARE returned, so EXISTENCE is free. Neither reference
    // (`salesAgreementNumber`, `salesOrderNumber`) is returned, and neither state is.
    //
    // So this column states existence and stops. It does NOT print the ids — a document id is not
    // a label — and it does NOT resolve them, because resolving per row is the N+1 fan-out G2
    // forbids and would put one round trip per visible opportunity on a scanning surface.
    //
    // `known: false` is what lets the renderer style an absence as an absence rather than as a
    // value, without re-deciding what absence means.
    commercial: {
      agreement: row?.salesAgreementId
        ? { known: true, words: "Agreement" }
        : { known: false, words: "No agreement" },
      order: row?.salesOrderId
        ? { known: true, words: "Order created" }
        : { known: false, words: "Order not created" },
    },

    // OWNER. The row carries an employee id; the NAME comes from the same directory resolution the
    // record page uses, so the two surfaces cannot disagree about who owns a deal.
    //
    // Three states, not two, and the distinction is the point: an opportunity with NO owner is
    // "Unassigned" (a real business condition, and a reason to act), while one whose owner id the
    // directory could not resolve is "Unresolved" (a data problem, and not the salesperson's).
    // Collapsing them would either hide unassigned work or blame the directory for it. The id is
    // never shown in either case.
    owner: (() => {
      const employeeId = row?.ownerEmployeeId ?? null;
      if (!employeeId) return { name: null, fallback: "Unassigned", assigned: false };
      const resolved = typeof resolveOwner === "function" ? resolveOwner(employeeId) : null;
      const name = typeof resolved === "string" && resolved.trim() ? resolved.trim() : null;
      return { name, fallback: "Unresolved", assigned: true };
    })(),
  };
}

// ════════════════════════════════════════════ NARROWING WHAT IS ALREADY LOADED
//
// Search and stage filtering run over rows the governed read ALREADY returned. That is the whole
// reason they are allowed to exist here: neither one re-queries, so neither one can widen what a
// caller may see. A filter that fetched would be a read this page has no authority to perform.
//
// The corollary is stated on screen rather than hidden: these narrow the CURRENT VIEW, and the
// result line says so. A filter that silently searched beyond the loaded page would be worse than
// no search at all, because the emptiness would look authoritative.

/** Fields a search may match. Deliberately short — and deliberately excludes every id. */
const searchable = (row) => [row.reference, row.need, row.customer.name, row.owner.name];

/**
 * @param rows   derived list rows (from `opportunityListRow`)
 * @param query  free text; matched case-insensitively against the fields above
 * @param stages Set/array of governed stage keys, or empty for "any"
 */
export function filterOpportunityRows(rows, { query = "", stages = [] } = {}) {
  const q = typeof query === "string" ? query.trim().toLowerCase() : "";
  const wanted = new Set(Array.isArray(stages) ? stages : [...(stages ?? [])]);
  return (rows ?? []).filter((row) => {
    // Stage words are the GOVERNED six. Filtering on the label would break the moment a label is
    // reworded, so this matches the key the domain sorts and derives on.
    if (wanted.size > 0 && !wanted.has(row.stageKey)) return false;
    if (!q) return true;
    // A document id is not searchable ON PURPOSE. Making ids findable is how they end up pasted
    // into conversations as if they were references (DECISIONS #106) -- and the governed reference
    // is already here, which is the thing people actually quote.
    return searchable(row).some((v) => typeof v === "string" && v.toLowerCase().includes(q));
  });
}

/** The result sentence. States what is shown, out of what, and WHY it is narrowed. */
export function opportunityResultContext({ shown, inView, viewLabel, query = "", stageCount = 0 }) {
  const narrowed = [];
  if (query.trim()) narrowed.push("a search");
  if (stageCount > 0) narrowed.push(`${stageCount} stage${stageCount === 1 ? "" : "s"}`);
  const noun = shown === 1 ? "opportunity" : "opportunities";
  const base = narrowed.length === 0
    ? `Showing ${shown} ${noun} in ${viewLabel}`
    // The DENOMINATOR is the view, not the collection: this narrows what is loaded, and claiming
    // "of 59 total" would imply the search reached records this page never read.
    : `Showing ${shown} of ${inView} ${noun} in ${viewLabel} — narrowed by ${narrowed.join(" and ")}`;
  return base;
}
