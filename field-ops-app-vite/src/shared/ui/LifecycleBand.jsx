import { useState } from "react";

// THE LIFECYCLE BAND — the spine as the loudest horizontal element on a record page.
//
// LifecycleChevrons already renders a progression, and it stays: it was built for a TABLE ROW,
// which is scanned, and it is deliberately quiet. A record page is read, and the approved
// composition draws the same progression as notched chevrons running the width of the measure, the
// current stage filled, and one line of recorded fact opening beneath whichever stage is clicked.
//
// Same contract as LifecycleChevrons, and the same deliberate ignorance: this component is
// BUSINESS-RULE-FREE. It is handed steps + a terminal badge + a function that returns the recorded
// detail for a step, and it knows nothing about work orders, statuses, or which transition is legal.
// For the Work Order that knowledge lives in domain/workOrderNorthStar.js (workOrderSpine and
// workOrderStageDetail), so the band and the chevrons cannot disagree about where a record is —
// they consume one derivation.
//
// Each step: { key, label, status: "complete" | "current" | "future" }.
// `terminal`: { key, label } | null — an appended badge for a record that ended off the spine
// (Cancelled). It is not a step and is never clickable: a cancelled work order did not reach it
// through the spine.
// `detailFor(key)`: () => { tone, lead, fact } | null — one line of RECORDED fact for that step.
// `tail`: optional node rendered after the chips (the composition puts lineage there).
export default function LifecycleBand({
  steps = [],
  terminal = null,
  detailFor = null,
  tail = null,
  label = "Lifecycle",
  ariaLabel,
}) {
  // The stage a reader opened. `null` means "follow the record" — the current step — so a live
  // transition moves the open strip with it until the reader chooses a stage themselves.
  const [openKey, setOpenKey] = useState(null);

  const currentKey = steps.find((s) => s.status === "current")?.key
    // A record with no current step (cancelled, or a status the spine does not recognise) opens the
    // last step it genuinely reached rather than nothing at all.
    ?? [...steps].reverse().find((s) => s.status === "complete")?.key
    ?? steps[0]?.key
    ?? null;

  const shownKey = openKey ?? currentKey;
  const detail = detailFor && shownKey ? detailFor(shownKey) : null;

  return (
    <>
      <ol className="ns-lifecycle" aria-label={ariaLabel ?? label}>
        <li className="ns-lifecycle__label" aria-hidden="true">{label}</li>
        {steps.map((step, i) => (
          <li key={step.key}>
            <button
              type="button"
              className={[
                "ns-chip",
                `ns-chip--${step.status}`,
                i === 0 ? "ns-chip--first" : "",
                i === steps.length - 1 && !terminal ? "ns-chip--last" : "",
              ].filter(Boolean).join(" ")}
              aria-expanded={shownKey === step.key}
              aria-current={step.status === "current" ? "step" : undefined}
              // Clicking the open stage returns to following the record rather than closing to a
              // blank strip — the band always says something about where the work order is.
              onClick={() => setOpenKey(shownKey === step.key && openKey !== null ? null : step.key)}
            >
              {step.status === "complete" ? "✓ " : ""}{step.label}
              {step.status === "current" ? <span className="ns-chip__pulse" aria-hidden="true" /> : null}
            </button>
          </li>
        ))}
        {terminal ? (
          <li>
            <span className="ns-chip ns-chip--terminal ns-chip--last">{terminal.label}</span>
          </li>
        ) : null}
        {tail ? <li className="ns-lifecycle__tail">{tail}</li> : null}
      </ol>
      {/* Reserved height, so opening a stage never reflows the work beneath the band. */}
      <div className="ns-stage-detail">
        {detail ? (
          <p className={`ns-stage-detail__row is-${detail.tone}`}>
            <span className="ns-stage-detail__lead">{detail.lead}</span>
            {detail.fact ? <span>{detail.fact}</span> : null}
          </p>
        ) : null}
      </div>
    </>
  );
}
